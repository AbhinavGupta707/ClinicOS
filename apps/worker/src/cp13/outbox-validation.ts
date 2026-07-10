import {
  CP13_MAX_DUE_GENERATION_BATCH_SIZE,
  CP13_WORKFLOW_SCHEMA_VERSION,
  CP13_WORKFLOW_VERSION,
  type Cp13DueGenerationKind,
  type Cp13DueGenerationWorkflowInput,
  type Cp13PaymentRequestRecoveryWorkflowInput
} from "@clinic-os/workflow";
import { permanentOutboxFailure } from "../outbox/errors.js";
import type { OutboxEventRecord } from "../outbox/types.js";

export function cp13WorkflowPayload(event: OutboxEventRecord): Record<string, unknown> {
  const wrapped = event.payload["workflow"];
  if (wrapped !== undefined && !hasOnlyKeys(event.payload, ["workflow"])) {
    throw permanentOutboxFailure(
      "CP13_WORKFLOW_PAYLOAD_INVALID",
      `${event.eventType} payload cannot mix workflow input with sibling fields`
    );
  }
  const candidate = wrapped ?? event.payload;
  if (!isRecord(candidate)) {
    throw permanentOutboxFailure(
      "CP13_WORKFLOW_PAYLOAD_INVALID",
      `${event.eventType} payload must contain a workflow object`
    );
  }
  return candidate;
}

export function parseDueGenerationWorkflowInput(
  event: OutboxEventRecord,
  generationKind: Cp13DueGenerationKind
): Cp13DueGenerationWorkflowInput {
  const candidate = cp13WorkflowPayload(event);
  if (
    !hasOnlyKeys(candidate, ["generationKind", "asOf", "batchSize", "cursor"]) ||
    candidate.generationKind !== generationKind ||
    !isIsoInstant(candidate.asOf) ||
    !Number.isSafeInteger(candidate.batchSize) ||
    Number(candidate.batchSize) < 1 ||
    Number(candidate.batchSize) > CP13_MAX_DUE_GENERATION_BATCH_SIZE ||
    !isNullableOpaqueCursor(candidate.cursor) ||
    candidate.continuation !== undefined
  ) {
    throw permanentOutboxFailure(
      "CP13_DUE_GENERATION_PAYLOAD_INVALID",
      `${event.eventType} must contain a frozen, bounded CP13 due-generation input`
    );
  }
  if (event.aggregateType !== "clinic" || event.aggregateId !== event.clinicId) {
    throw permanentOutboxFailure(
      "CP13_DUE_GENERATION_ENVELOPE_INVALID",
      "due-generation requests must be scoped to the outbox clinic aggregate"
    );
  }
  return {
    ...cp13WorkflowIdentityFromEnvelope(event),
    generationKind,
    asOf: candidate.asOf,
    batchSize: Number(candidate.batchSize),
    cursor: candidate.cursor
  } as Cp13DueGenerationWorkflowInput;
}

export function parsePaymentRecoveryWorkflowInput(
  event: OutboxEventRecord
): Cp13PaymentRequestRecoveryWorkflowInput {
  const candidate = cp13WorkflowPayload(event);
  if (
    !hasOnlyKeys(candidate, [
      "patientId",
      "invoiceId",
      "durableIntentId",
      "intentDigest",
      "intentStatus",
      "requestType"
    ]) ||
    !isNonEmptyString(candidate.patientId) ||
    !isNonEmptyString(candidate.invoiceId) ||
    !isNonEmptyString(candidate.durableIntentId) ||
    !isSha256Digest(candidate.intentDigest) ||
    candidate.intentStatus !== "pending_provider_request" ||
    (candidate.requestType !== "payment_link" && candidate.requestType !== "invoice_qr")
  ) {
    throw permanentOutboxFailure(
      "CP13_PAYMENT_RECOVERY_PAYLOAD_INVALID",
      "payment recovery requires only a pending durable intent identity and digest"
    );
  }
  if (
    event.aggregateType !== "payment_request_intent" ||
    event.aggregateId !== candidate.durableIntentId
  ) {
    throw permanentOutboxFailure(
      "CP13_PAYMENT_RECOVERY_ENVELOPE_INVALID",
      "payment recovery intent must match the outbox aggregate"
    );
  }
  return {
    ...cp13WorkflowIdentityFromEnvelope(event),
    patientId: candidate.patientId,
    invoiceId: candidate.invoiceId,
    durableIntentId: candidate.durableIntentId,
    intentDigest: candidate.intentDigest,
    intentStatus: "pending_provider_request",
    requestType: candidate.requestType
  } as Cp13PaymentRequestRecoveryWorkflowInput;
}

export function cp13WorkflowIdentityFromEnvelope(event: OutboxEventRecord) {
  if (
    !isNonEmptyString(event.tenantId) ||
    !isNonEmptyString(event.clinicId) ||
    !isNonEmptyString(event.eventId) ||
    !isNonEmptyString(event.correlationId) ||
    !isNonEmptyString(event.idempotencyKey) ||
    event.schemaVersion !== CP13_WORKFLOW_SCHEMA_VERSION ||
    event.actor.type !== "user" ||
    !isNonEmptyString(event.actor.id) ||
    !isIsoInstant(event.occurredAt)
  ) {
    throw permanentOutboxFailure(
      "CP13_WORKFLOW_ENVELOPE_INVALID",
      "CP13 workflow identity requires a complete authoritative outbox envelope"
    );
  }
  return {
    schemaVersion: event.schemaVersion,
    workflowVersion: CP13_WORKFLOW_VERSION,
    tenantId: event.tenantId,
    clinicId: event.clinicId,
    actorUserId: event.actor.id,
    eventId: event.eventId,
    correlationId: event.correlationId,
    idempotencyKey: event.idempotencyKey,
    requestedAt: event.occurredAt
  } as const;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed);
  return Object.keys(value).every((key) => allowedKeys.has(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableOpaqueCursor(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && value.length > 0 && value.length <= 2_048);
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
