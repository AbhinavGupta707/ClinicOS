import { createHash, timingSafeEqual } from "node:crypto";
import {
  validateRequiredSecurityAuditIntent,
  type RequiredSecurityAuditIntent
} from "@clinic-os/auth";
import type { SqlConnectionFactory, SqlQueryClient } from "@clinic-os/db";
import type { IdentitySecurityAuditOutbox } from "./contracts.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class PostgresIdentitySecurityAuditOutboxError extends Error {
  constructor(message = "The required security-audit dependency is unavailable.") {
    super(message);
    this.name = "PostgresIdentitySecurityAuditOutboxError";
  }
}

/** Durable standalone transaction for required identity denials that precede domain mutation. */
export class PostgresIdentitySecurityAuditOutbox implements IdentitySecurityAuditOutbox {
  readonly atomicity = "durable_transactional_outbox" as const;
  readonly durability = "distributed_durable" as const;
  readonly #connections: SqlConnectionFactory;
  readonly #traceContextProvider: (() => string | undefined) | undefined;

  constructor(
    connections: SqlConnectionFactory,
    options: { traceContextProvider?: () => string | undefined } = {}
  ) {
    this.#connections = connections;
    this.#traceContextProvider = options.traceContextProvider;
  }

  async readiness(): Promise<void> {
    const client = await this.#acquire();
    try {
      await client.query("select 1");
    } catch {
      throw unavailable();
    } finally {
      client.release?.();
    }
  }

  async persistRequired(rawIntent: RequiredSecurityAuditIntent): Promise<void> {
    const intent = validateRequiredSecurityAuditIntent(rawIntent);
    if (
      !intent.tenantId ||
      !intent.clinicId ||
      !UUID.test(intent.tenantId) ||
      !UUID.test(intent.clinicId)
    ) {
      throw new PostgresIdentitySecurityAuditOutboxError(
        "Required API security audit is missing verified clinic scope."
      );
    }
    const canonical = canonicalIntent(intent);
    const digest = sha256(JSON.stringify(canonical));
    const auditId = deterministicUuid(`security-audit\u001f${intent.tenantId}\u001f${digest}`);
    const outboxId = deterministicUuid(`security-outbox\u001f${intent.tenantId}\u001f${digest}`);
    const aggregateId = deterministicUuid(`security-aggregate\u001f${intent.subject}`);
    const idempotencyKey = `security-audit:${sha256(intent.deduplicationKey)}`;
    const client = await this.#acquire();

    try {
      await client.query("begin");
      const traceparent = validatedTraceparent(this.#traceContextProvider?.());
      if (traceparent) {
        await client.query("select set_config('app.traceparent', $1, true)", [traceparent]);
      }
      await client.query(
        `select set_config('app.tenant_id', $1, true),
                set_config('app.clinic_id', $2, true),
                set_config('app.user_id', $3, true)`,
        [intent.tenantId, intent.clinicId, ""]
      );
      await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [idempotencyKey]);
      const existingAudit = await client.query<{
        tenant_id: string;
        clinic_id: string;
        action: string;
      }>(
        `select tenant_id, clinic_id, action from audit_events
         where id = $1::uuid for update`,
        [auditId]
      );
      const existingOutbox = await client.query<{
        tenant_id: string;
        clinic_id: string;
        event_type: string;
        payload: { securityAuditDigestSha256?: unknown };
      }>(
        `select tenant_id, clinic_id, event_type, payload from outbox_events
         where id = $1::uuid for update`,
        [outboxId]
      );
      if (existingAudit.rows.length || existingOutbox.rows.length) {
        assertExactReplay(
          existingAudit.rows[0],
          existingOutbox.rows[0],
          intent,
          intent.tenantId,
          intent.clinicId,
          digest
        );
        await client.query("commit");
        return;
      }

      const metadata = {
        securityAuditDigestSha256: digest,
        reasonCode: intent.reasonCode,
        authorizedParty: "authorizedParty" in intent ? intent.authorizedParty : null,
        roleSlugs: intent.action === "auth.mfa.denied" ? [...intent.roleSlugs] : []
      };
      await client.query(
        `insert into audit_events (
           id, tenant_id, clinic_id, actor_type, actor_id, action, category, risk_level,
           phi_involved, resource_type, resource_id, correlation_id, metadata, occurred_at
         ) values (
           $1::uuid, $2::uuid, $3::uuid, 'user', $4, $5, 'identity_security', 'high',
           false, 'identity_session', $6::uuid, $7, $8::jsonb, $9::timestamptz
         )`,
        [
          auditId,
          intent.tenantId,
          intent.clinicId,
          intent.subject,
          intent.action,
          aggregateId,
          idempotencyKey,
          JSON.stringify(metadata),
          intent.occurredAt
        ]
      );
      await client.query(
        `insert into outbox_events (
           id, tenant_id, clinic_id, event_type, schema_version, actor_type, actor_id,
           aggregate_type, aggregate_id, idempotency_key, correlation_id, payload, occurred_at
         ) values (
           $1::uuid, $2::uuid, $3::uuid, $4, '1.0', 'user', $5,
           'identity_session', $6::uuid, $7, $7, $8::jsonb, $9::timestamptz
         )`,
        [
          outboxId,
          intent.tenantId,
          intent.clinicId,
          `security.${intent.action}`,
          intent.subject,
          aggregateId,
          idempotencyKey,
          JSON.stringify({ securityAuditDigestSha256: digest, intent: canonical }),
          intent.occurredAt
        ]
      );
      await client.query("commit");
    } catch (error) {
      try {
        await client.query("rollback");
      } catch {
        // Preserve the fail-closed audit error.
      }
      if (error instanceof PostgresIdentitySecurityAuditOutboxError) throw error;
      throw unavailable();
    } finally {
      client.release?.();
    }
  }

  async #acquire(): Promise<SqlQueryClient> {
    try {
      return this.#connections.connect ? await this.#connections.connect() : this.#connections;
    } catch {
      throw unavailable();
    }
  }
}

function validatedTraceparent(value: string | undefined): string | undefined {
  return value && /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u.test(value) ? value : undefined;
}

function canonicalIntent(intent: RequiredSecurityAuditIntent): Record<string, unknown> {
  return {
    schemaVersion: intent.schemaVersion,
    action: intent.action,
    occurredAt: intent.occurredAt,
    subject: intent.subject,
    tenantId: intent.tenantId ?? null,
    clinicId: intent.clinicId ?? null,
    issuer: "issuer" in intent ? intent.issuer : null,
    authorizedParty: "authorizedParty" in intent ? intent.authorizedParty : null,
    reasonCode: intent.reasonCode,
    roleSlugs: intent.action === "auth.mfa.denied" ? [...intent.roleSlugs].sort() : [],
    transition: "transition" in intent ? intent.transition : null,
    commandId: "commandId" in intent ? intent.commandId : null
  };
}

function assertExactReplay(
  audit: { tenant_id: string; clinic_id: string; action: string } | undefined,
  outbox:
    | {
        tenant_id: string;
        clinic_id: string;
        event_type: string;
        payload: { securityAuditDigestSha256?: unknown };
      }
    | undefined,
  intent: RequiredSecurityAuditIntent,
  tenantId: string,
  clinicId: string,
  digest: string
): void {
  if (
    !audit ||
    !outbox ||
    audit.tenant_id !== tenantId ||
    audit.clinic_id !== clinicId ||
    audit.action !== intent.action ||
    outbox.tenant_id !== tenantId ||
    outbox.clinic_id !== clinicId ||
    outbox.event_type !== `security.${intent.action}` ||
    typeof outbox.payload?.securityAuditDigestSha256 !== "string" ||
    !safeEqual(outbox.payload.securityAuditDigestSha256, digest)
  ) {
    throw new PostgresIdentitySecurityAuditOutboxError(
      "Required security-audit idempotency state is inconsistent."
    );
  }
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function unavailable(): PostgresIdentitySecurityAuditOutboxError {
  return new PostgresIdentitySecurityAuditOutboxError();
}
