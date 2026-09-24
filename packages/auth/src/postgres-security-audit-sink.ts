import { createHash } from "node:crypto";
import {
  canonicalSecurityAuditPayload,
  validateRequiredSecurityAuditIntent,
  type RequiredSecurityAuditIntent
} from "./security-audit.ts";

export interface DurableSecurityAuditSink {
  readonly durability: "durable_append_only";
  append(intent: RequiredSecurityAuditIntent): Promise<void>;
  readiness(): Promise<void>;
}

interface AuditSqlClient {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<{ rows: T[] }>;
  release(error?: boolean): void;
}
export interface AuditSqlPool {
  connect(): Promise<AuditSqlClient>;
}

export class SecurityAuditSinkError extends Error {
  readonly code: "dependency_unavailable" | "conflicting_evidence";
  constructor(code: SecurityAuditSinkError["code"]) {
    super(
      code === "conflicting_evidence"
        ? "Required security audit conflicts with retained evidence."
        : "Required security audit storage is unavailable."
    );
    this.name = "SecurityAuditSinkError";
    this.code = code;
  }
}

/** Global identity evidence, including events before a tenant membership exists. */
export class PostgresSecurityAuditSink implements DurableSecurityAuditSink {
  readonly durability = "durable_append_only" as const;
  readonly #pool: AuditSqlPool;
  readonly #commandTimeoutMs: number;

  constructor(pool: AuditSqlPool, options: { commandTimeoutMs?: number } = {}) {
    if (typeof pool.connect !== "function")
      throw new Error("Security audit requires an owned connection pool.");
    this.#pool = pool;
    this.#commandTimeoutMs = options.commandTimeoutMs ?? 5_000;
    if (
      !Number.isSafeInteger(this.#commandTimeoutMs) ||
      this.#commandTimeoutMs < 100 ||
      this.#commandTimeoutMs > 10_000
    ) {
      throw new Error("Invalid security audit command deadline.");
    }
  }

  async append(raw: RequiredSecurityAuditIntent): Promise<void> {
    const intent = validateRequiredSecurityAuditIntent(raw);
    const canonical = JSON.stringify(canonicalSecurityAuditPayload(intent));
    const key = sha256(`clinicos:identity-security-audit:v1\u0000${intent.deduplicationKey}`);
    const digest = sha256(canonical);
    await this.#transaction(async (client) => {
      await client.query("select set_config('app.security_audit_key', $1, true)", [key]);
      // The unique key arbitrates concurrent writers. A new READ COMMITTED statement
      // sees the winner after ON CONFLICT waits; never overwrite existing evidence.
      await client.query(
        `insert into public.identity_security_audit_events
        (deduplication_key, payload_digest, canonical_payload, schema_version, action, subject,
         reason_code, issuer, authorized_party, tenant_id, clinic_id, occurred_at, source_adapter_version)
        values ($1, $2, $3::jsonb, 1, $4, $5, $6, $7, $8, $9::uuid, $10::uuid, $11::timestamptz, 'redis-session-audit-v1')
        on conflict (deduplication_key) do nothing`,
        [
          key,
          digest,
          canonical,
          intent.action,
          intent.subject,
          intent.reasonCode,
          "issuer" in intent ? intent.issuer : null,
          "authorizedParty" in intent ? intent.authorizedParty : null,
          intent.tenantId ?? null,
          intent.clinicId ?? null,
          intent.occurredAt
        ]
      );
      const result = await client.query<{ payload_digest: string; matches: boolean }>(
        "select payload_digest, canonical_payload = $2::jsonb as matches from public.identity_security_audit_events where deduplication_key = $1",
        [key, canonical]
      );
      if (
        result.rows.length !== 1 ||
        result.rows[0].payload_digest !== digest ||
        result.rows[0].matches !== true
      ) {
        throw new SecurityAuditSinkError("conflicting_evidence");
      }
    });
  }

  async readiness(): Promise<void> {
    await this.#transaction(async (client) => {
      const result = await client.query<{ ready: boolean }>(`select
        has_table_privilege(current_user, 'identity_security_audit_events', 'SELECT') and
        has_table_privilege(current_user, 'identity_security_audit_events', 'INSERT') and
        not has_table_privilege(current_user, 'identity_security_audit_events', 'UPDATE,DELETE,TRUNCATE') and
        (select relrowsecurity and relforcerowsecurity from pg_class
         where oid = 'identity_security_audit_events'::regclass) and
        not (select rolsuper or rolbypassrls from pg_roles where rolname = current_user)
        as ready`);
      if (result.rows[0]?.ready !== true)
        throw new SecurityAuditSinkError("dependency_unavailable");
      await client.query(
        "select payload_digest from public.identity_security_audit_events limit 0"
      );
    });
  }

  async #transaction(execute: (client: AuditSqlClient) => Promise<void>): Promise<void> {
    let client: AuditSqlClient | undefined;
    let discard = false;
    let acquisitionExpired = false;
    try {
      client = await deadline(
        this.#pool.connect().then((connection) => {
          if (acquisitionExpired) connection.release(true);
          return connection;
        }),
        () => {
          acquisitionExpired = true;
        },
        this.#commandTimeoutMs
      );
      const rawClient = client!;
      client = {
        query: <T>(sql: string, values?: readonly unknown[]) =>
          deadline(
            rawClient.query<T>(sql, values),
            () => {
              discard = true;
            },
            this.#commandTimeoutMs
          ),
        release: (failed) => rawClient.release(failed)
      };
      await client.query("begin isolation level read committed");
      await client.query("set local statement_timeout = '3000ms'");
      await client.query("set local lock_timeout = '2000ms'");
      await client.query("set local synchronous_commit = on");
      await execute(client);
      await client.query("commit");
    } catch (error) {
      if (client && !discard) {
        try {
          await client.query("rollback");
        } catch {
          discard = true;
        }
      }
      if (error instanceof SecurityAuditSinkError) throw error;
      throw new SecurityAuditSinkError("dependency_unavailable");
    } finally {
      client?.release(discard);
    }
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function deadline<T>(
  operation: Promise<T>,
  expired: () => void,
  milliseconds: number
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          expired();
          reject(new SecurityAuditSinkError("dependency_unavailable"));
        }, milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}
