import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { buildSetLocalRlsStatements } from "@clinic-os/db";
import type { UUID } from "@clinic-os/domain";
import type { ProviderReconciliationScope } from "./provider-reconciliation-processor.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

export interface ClaimedProviderReconciliationScope extends ProviderReconciliationScope {
  readonly leaseOwner: string;
}

export interface ProviderReconciliationScopeSource {
  claimDueScopes(input: {
    readonly workerId: string;
    readonly limit: number;
    readonly now: string;
    readonly leaseUntil: string;
  }): Promise<readonly ClaimedProviderReconciliationScope[]>;
  refreshScope(
    scope: ClaimedProviderReconciliationScope,
    observedAt: string
  ): Promise<"refreshed" | "removed" | "lease_lost">;
  countDue(observedAt: string): Promise<number>;
}

export class PostgresProviderReconciliationScopeSource implements ProviderReconciliationScopeSource {
  readonly #pool: Pick<Pool, "connect" | "query">;

  constructor(pool: Pick<Pool, "connect" | "query">) {
    this.#pool = pool;
  }

  async claimDueScopes(input: {
    readonly workerId: string;
    readonly limit: number;
    readonly now: string;
    readonly leaseUntil: string;
  }): Promise<readonly ClaimedProviderReconciliationScope[]> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(input.workerId)) {
      throw new Error("Provider reconciliation worker identifier is invalid.");
    }
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("Provider reconciliation scope limit must be between 1 and 100.");
    }
    const now = canonicalTimestamp(input.now, "now");
    const leaseUntil = canonicalTimestamp(input.leaseUntil, "leaseUntil");
    if (Date.parse(leaseUntil) <= Date.parse(now)) {
      throw new Error("Provider reconciliation scope lease must end after claim time.");
    }
    const leaseOwner = `${input.workerId}:scope:${randomBytes(12).toString("hex")}`;
    const result = await this.#pool.query<{
      tenant_id: string;
      clinic_id: string;
      lease_owner: string;
    }>(
      `/* cp15:claim-provider-reconciliation-scopes */
       with due as (
         select tenant_id, clinic_id
           from provider_reconciliation_scope_queue
          where due_at <= $1::timestamptz
            and (lease_expires_at is null or lease_expires_at <= $1::timestamptz)
          order by due_at, tenant_id, clinic_id
          limit $2
          for update skip locked
       )
       update provider_reconciliation_scope_queue scope
          set lease_owner = $3, lease_expires_at = $4::timestamptz,
              updated_at = $1::timestamptz
         from due
        where scope.tenant_id = due.tenant_id and scope.clinic_id = due.clinic_id
       returning scope.tenant_id, scope.clinic_id, scope.lease_owner`,
      [now, input.limit, leaseOwner, leaseUntil]
    );
    return result.rows.map((row) => ({
      tenantId: validUuid(row.tenant_id, "tenantId"),
      clinicId: validUuid(row.clinic_id, "clinicId"),
      leaseOwner: requiredLeaseOwner(row.lease_owner)
    }));
  }

  async refreshScope(
    scope: ClaimedProviderReconciliationScope,
    observedAt: string
  ): Promise<"refreshed" | "removed" | "lease_lost"> {
    const tenantId = validUuid(scope.tenantId, "tenantId");
    const clinicId = validUuid(scope.clinicId, "clinicId");
    const leaseOwner = requiredLeaseOwner(scope.leaseOwner);
    const at = canonicalTimestamp(observedAt, "observedAt");
    return scopedTransaction(this.#pool, { tenantId, clinicId }, async (client) => {
      const locked = await client.query<{ lease_owner: string | null }>(
        `/* cp15:lock-provider-reconciliation-scope */
         select lease_owner
           from provider_reconciliation_scope_queue
          where tenant_id = $1 and clinic_id = $2
          for update`,
        [tenantId, clinicId]
      );
      if (locked.rows[0]?.lease_owner !== leaseOwner) return "lease_lost";
      const next = await client.query<{ due_at: string | null }>(
        `/* cp15:calculate-provider-reconciliation-scope-due */
         select min(candidate.due_at)::text as due_at
           from (
             select case
                      when status in ('pending', 'provider_unavailable')
                        then coalesce(next_attempt_at, created_at)
                      when status = 'leased' then lease_expires_at
                    end as due_at
              from meta_whatsapp_reconciliation_jobs
              where tenant_id = $1 and clinic_id = $2
                and status in ('pending', 'provider_unavailable', 'leased')
             union all
             select case
                      when status = 'pending' then created_at
                      when status = 'retry_scheduled' then next_attempt_at
                      when status = 'leased' then lease_expires_at
                    end as due_at
              from razorpay_reconciliation_jobs
              where tenant_id = $1 and clinic_id = $2
                and status in ('pending', 'retry_scheduled', 'leased')
           ) candidate`,
        [tenantId, clinicId]
      );
      const dueAt = next.rows[0]?.due_at;
      if (!dueAt) {
        const removed = await client.query(
          `/* cp15:remove-provider-reconciliation-scope */
           delete from provider_reconciliation_scope_queue
            where tenant_id = $1 and clinic_id = $2 and lease_owner = $3`,
          [tenantId, clinicId, leaseOwner]
        );
        return removed.rowCount === 1 ? "removed" : "lease_lost";
      }
      const refreshed = await client.query(
        `/* cp15:refresh-provider-reconciliation-scope */
         update provider_reconciliation_scope_queue
            set due_at = $4::timestamptz, lease_owner = null, lease_expires_at = null,
                updated_at = $5::timestamptz
          where tenant_id = $1 and clinic_id = $2 and lease_owner = $3`,
        [tenantId, clinicId, leaseOwner, canonicalTimestamp(dueAt, "dueAt"), at]
      );
      return refreshed.rowCount === 1 ? "refreshed" : "lease_lost";
    });
  }

  async countDue(observedAt: string): Promise<number> {
    const at = canonicalTimestamp(observedAt, "observedAt");
    const result = await this.#pool.query<{ count: string }>(
      `/* cp15:count-provider-reconciliation-scopes */
       select count(*)::text as count
         from provider_reconciliation_scope_queue
        where due_at <= $1::timestamptz
          and (lease_expires_at is null or lease_expires_at <= $1::timestamptz)`,
      [at]
    );
    const count = Number(result.rows[0]?.count ?? "0");
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("Provider reconciliation due scope count is invalid.");
    }
    return count;
  }
}

async function scopedTransaction<T>(
  pool: Pick<Pool, "connect">,
  scope: ProviderReconciliationScope,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const statement of buildSetLocalRlsStatements({
      tenantId: scope.tenantId as UUID,
      clinicId: scope.clinicId as UUID,
      userId: null
    })) {
      await client.query(statement.sql, [...statement.values]);
    }
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

function validUuid(value: string, field: string): string {
  if (!UUID_PATTERN.test(value)) throw new Error(`Provider reconciliation ${field} is invalid.`);
  return value;
}

function requiredLeaseOwner(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(value)) {
    throw new Error("Provider reconciliation scope lease owner is invalid.");
  }
  return value;
}

function canonicalTimestamp(value: string, field: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`Provider reconciliation ${field} must be a canonical timestamp.`);
  }
  return value;
}
