import { createHash, randomUUID } from "node:crypto";
import { buildSetLocalRlsStatements, type SqlQueryClient } from "@clinic-os/db";
import { asUuid } from "@clinic-os/domain";
import type { AuditEventRecord } from "@clinic-os/security";
import type { Cp16AiInvocationIdentity } from "../../features/cp16-ai/contracts.ts";

export interface Cp16AiUnitOfWork {
  run<T>(
    callback: (context: {
      readonly auditSink?: { appendAuditEvent(event: AuditEventRecord): Promise<void> };
      readonly sqlClient?: SqlQueryClient;
    }) => Promise<T>
  ): Promise<T>;
}

export interface Cp16AiScope {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly actorUserId: string;
}

export async function withAiScope<T>(
  unitOfWork: Cp16AiUnitOfWork,
  scope: Cp16AiScope,
  execute: (client: SqlQueryClient) => Promise<T>
): Promise<T> {
  assertAiScope(scope);
  return unitOfWork.run(async ({ sqlClient }) => {
    if (!sqlClient) throw new Error("AI durability requires a transaction-bound SQL client.");
    for (const statement of buildSetLocalRlsStatements({
      tenantId: asUuid(scope.tenantId, "AI tenantId"),
      clinicId: asUuid(scope.clinicId, "AI clinicId"),
      userId: asUuid(scope.actorUserId, "AI actorUserId")
    })) {
      await sqlClient.query(statement.sql, [...statement.values]);
    }
    return execute(sqlClient);
  });
}

export function assertInvocationIdentity(identity: Cp16AiInvocationIdentity): void {
  assertAiScope(identity);
  if (!uuid(identity.patientId) || !uuid(identity.encounterId)) {
    throw new Error("AI patient or encounter scope is invalid.");
  }
  for (const digest of [
    identity.workflowIdempotencyDigest,
    identity.providerCallIdempotencyDigest,
    identity.requestFingerprint
  ]) {
    if (!sha256Digest(digest)) throw new Error("AI invocation digest is invalid.");
  }
  if (!/^[A-Za-z0-9._:@/-]{1,256}$/u.test(identity.correlationId)) {
    throw new Error("AI correlation identity is invalid.");
  }
}

export async function appendAiEvidence(
  client: SqlQueryClient,
  input: {
    readonly identity: Cp16AiInvocationIdentity;
    readonly invocationId: string;
    readonly action: string;
    readonly eventType: string;
    readonly occurredAt: string;
    readonly metadata: Readonly<Record<string, unknown>>;
  }
): Promise<void> {
  const audit = await client.query<{ readonly id: string }>(
    `insert into audit_events (
       id, tenant_id, clinic_id, actor_type, actor_id, action, category, risk_level,
       phi_involved, resource_type, resource_id, patient_id, correlation_id, metadata, occurred_at
     ) values (
       $1,$2,$3,'user',$4,$5,'clinical','high',true,'cp16_ai_invocation',$6,$7,$8,$9::jsonb,$10::timestamptz
     ) returning id`,
    [
      randomUUID(),
      input.identity.tenantId,
      input.identity.clinicId,
      input.identity.actorUserId,
      input.action,
      input.invocationId,
      input.identity.patientId,
      input.identity.correlationId,
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
       $1,$2,$3,$4,'1.0','user',$5,'cp16_ai_invocation',$6,$7,$8,$9,$10::jsonb,$11::timestamptz
     ) on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing
     returning id`,
    [
      randomUUID(),
      input.identity.tenantId,
      input.identity.clinicId,
      input.eventType,
      input.identity.actorUserId,
      input.invocationId,
      input.identity.patientId,
      `cp16:ai:${input.eventType}:${input.identity.providerCallIdempotencyDigest}`,
      input.identity.correlationId,
      JSON.stringify(input.metadata),
      input.occurredAt
    ]
  );
  if (audit.rows.length !== 1 || outbox.rows.length !== 1) {
    throw new Error("AI audit/outbox evidence was not committed atomically.");
  }
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function sha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/u.test(value);
}

export function uuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

export function validInstant(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value)) || !/(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    throw new Error(`AI ${field} is invalid.`);
  }
  return new Date(value).toISOString();
}

export function safePositiveInteger(value: unknown, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new Error(`AI ${field} is invalid.`);
  }
  return value as number;
}

function assertAiScope(scope: Cp16AiScope): void {
  if (!uuid(scope.tenantId) || !uuid(scope.clinicId) || !uuid(scope.actorUserId)) {
    throw new Error("AI RLS scope is invalid.");
  }
}
