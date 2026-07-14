import { createHash, randomUUID } from "node:crypto";
import { buildSetLocalRlsStatements, type SqlQueryClient } from "@clinic-os/db";
import { asUuid } from "@clinic-os/domain";
import type { AuthenticatedInteroperabilityContext } from "../../features/cp16-interoperability/index.ts";

export interface Cp16InteroperabilityUnitOfWork {
  run<T>(callback: (context: { readonly sqlClient?: SqlQueryClient }) => Promise<T>): Promise<T>;
}

export async function withInteroperabilityScope<T>(
  unitOfWork: Cp16InteroperabilityUnitOfWork,
  context: AuthenticatedInteroperabilityContext,
  execute: (client: SqlQueryClient) => Promise<T>
): Promise<T> {
  assertInteroperabilityContext(context);
  return unitOfWork.run(async ({ sqlClient }) => {
    if (!sqlClient) throw new Error("Interoperability requires a transaction-bound SQL client.");
    for (const statement of buildSetLocalRlsStatements({
      tenantId: asUuid(context.tenantId, "interoperability tenantId"),
      clinicId: asUuid(context.clinicId, "interoperability clinicId"),
      userId: asUuid(context.actorUserId, "interoperability actorUserId")
    })) {
      await sqlClient.query(statement.sql, [...statement.values]);
    }
    return execute(sqlClient);
  });
}

export async function appendInteroperabilityEvidence(
  client: SqlQueryClient,
  input: {
    readonly context: AuthenticatedInteroperabilityContext;
    readonly action: string;
    readonly eventType: string;
    readonly aggregateType: string;
    readonly aggregateId: string;
    readonly patientId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
    readonly occurredAt: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  }
): Promise<{ readonly auditAppended: true; readonly outboxAppended: true }> {
  const auditId = randomUUID();
  const outboxId = randomUUID();
  const audit = await client.query<{ readonly id: string }>(
    `insert into audit_events (
       id, tenant_id, clinic_id, actor_type, actor_id, action, category, risk_level,
       phi_involved, resource_type, resource_id, patient_id, correlation_id, metadata, occurred_at
     ) values (
       $1,$2,$3,'user',$4,$5,'clinical','high',true,$6,$7,$8,$9,$10::jsonb,$11::timestamptz
     ) returning id`,
    [
      auditId,
      input.context.tenantId,
      input.context.clinicId,
      input.context.actorUserId,
      input.action,
      input.aggregateType,
      input.aggregateId,
      input.patientId,
      input.correlationId,
      JSON.stringify(input.metadata),
      input.occurredAt
    ]
  );
  const outbox = await client.query<{ readonly id: string }>(
    `insert into outbox_events (
       id, tenant_id, clinic_id, event_type, schema_version, actor_type, actor_id,
       aggregate_type, aggregate_id, patient_id, idempotency_key, correlation_id,
       payload, occurred_at
     ) values (
       $1,$2,$3,$4,'1.0','user',$5,$6,$7,$8,$9,$10,$11::jsonb,$12::timestamptz
     ) on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing
     returning id`,
    [
      outboxId,
      input.context.tenantId,
      input.context.clinicId,
      input.eventType,
      input.context.actorUserId,
      input.aggregateType,
      input.aggregateId,
      input.patientId,
      input.idempotencyKey,
      input.correlationId,
      JSON.stringify(input.metadata),
      input.occurredAt
    ]
  );
  if (audit.rows.length !== 1 || outbox.rows.length !== 1) {
    throw new Error("Interoperability audit/outbox evidence was not committed atomically.");
  }
  return { auditAppended: true, outboxAppended: true };
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function assertInteroperabilityContext(context: AuthenticatedInteroperabilityContext): void {
  if (
    context.verified !== true ||
    !uuid(context.tenantId) ||
    !uuid(context.clinicId) ||
    !uuid(context.actorUserId)
  ) {
    throw new Error("Authenticated interoperability context is invalid.");
  }
}

export function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

export function positiveInteger(value: unknown, field: string): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) < 1) {
    throw new Error(`Interoperability ${field} is invalid.`);
  }
  return parsed as number;
}

export function iso(value: unknown, field: string): string {
  const normalized = value instanceof Date ? value.toISOString() : String(value ?? "");
  if (!Number.isFinite(Date.parse(normalized)) || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(normalized)) {
    throw new Error(`Interoperability ${field} is invalid.`);
  }
  return normalized;
}
