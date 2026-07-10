import { createHash } from "node:crypto";
import type { JsonValue } from "@clinic-os/api-contracts";
import type { OutboxEventInput, RequestAuditEventInput } from "@clinic-os/db";
import type {
  CorrectiveActionRecord,
  DomainEventType,
  RecallRecord,
  SopRunDetail,
  TaskRecord,
  UUID
} from "@clinic-os/domain";
import { classifyAuditAction, type KnownAuditAction } from "@clinic-os/security";
import { ApiError } from "../../errors.ts";
import {
  featureOutboxIdempotencyKey,
  type ClinicFeatureExecutionContext,
  type ClinicFeatureOperationHandler,
  type ClinicFeatureOperationRequest
} from "../contracts.ts";
import type { ContinuityOperationsOperationId } from "./types.ts";

export type ContinuityOperationsHandler =
  ClinicFeatureOperationHandler<ContinuityOperationsOperationId>;

export type JsonObject = Readonly<Record<string, JsonValue>>;

export function requestBody(request: ClinicFeatureOperationRequest): JsonObject {
  return jsonObject(request.parsed.body ?? {}, "body");
}

export function requestPath(request: ClinicFeatureOperationRequest): JsonObject {
  return jsonObject(request.parsed.path, "path");
}

export function requestQuery(request: ClinicFeatureOperationRequest): JsonObject {
  return jsonObject(request.parsed.query, "query");
}

export function requestHeader(request: ClinicFeatureOperationRequest, name: string): string | null {
  const value = jsonObject(request.parsed.headers, "headers")[name];
  return typeof value === "string" ? value : null;
}

export function jsonObject(value: unknown, location: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Uint8Array) {
    throw new ApiError(
      500,
      "CONFIGURATION_ERROR",
      `Parsed operation ${location} was not a JSON object.`
    );
  }
  return value as JsonObject;
}

export function stringValue(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new ApiError(500, "CONFIGURATION_ERROR", `Parsed ${field} was unavailable.`);
  }
  return value;
}

export function optionalStringValue(value: JsonValue | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError(500, "CONFIGURATION_ERROR", "Parsed optional string was invalid.");
  }
  return value;
}

export function numberValue(value: JsonValue | undefined, field: string): number {
  if (typeof value !== "number") {
    throw new ApiError(500, "CONFIGURATION_ERROR", `Parsed ${field} was unavailable.`);
  }
  return value;
}

export function optionalNumberValue(value: JsonValue | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number") {
    throw new ApiError(500, "CONFIGURATION_ERROR", "Parsed optional number was invalid.");
  }
  return value;
}

export function optionalBooleanValue(value: JsonValue | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new ApiError(500, "CONFIGURATION_ERROR", "Parsed optional boolean was invalid.");
  }
  return value;
}

export function arrayValue(value: JsonValue | undefined, field: string): readonly JsonValue[] {
  if (!Array.isArray(value)) {
    throw new ApiError(500, "CONFIGURATION_ERROR", `Parsed ${field} was unavailable.`);
  }
  return value;
}

export function uuidValue(value: JsonValue | undefined, field: string): UUID {
  return stringValue(value, field) as UUID;
}

export function optionalUuidValue(value: JsonValue | undefined): UUID | null | undefined {
  const parsed = optionalStringValue(value);
  return parsed as UUID | null | undefined;
}

export function recordValue(value: JsonValue | undefined): Record<string, unknown> {
  if (value === undefined) return {};
  return { ...jsonObject(value, "record") };
}

export function pageLimit(query: JsonObject): number | null {
  const limit = query.limit;
  return typeof limit === "number" ? limit : null;
}

export function applyLimit<T>(rows: readonly T[], limit: number | null): T[] {
  return rows.slice(0, limit ?? rows.length);
}

export function ok(body: unknown) {
  return { status: 200, body };
}

export function created(body: unknown) {
  return { status: 201, body };
}

export function accepted(body: unknown) {
  return { status: 202, body };
}

export function notFound(message: string, details: Record<string, unknown> = {}): never {
  throw new ApiError(404, "NOT_FOUND", message, details);
}

export function conflict(message: string, details: Record<string, unknown> = {}): never {
  throw new ApiError(409, "CONFLICT", message, details);
}

export function validation(message: string, details: Record<string, unknown> = {}): never {
  throw new ApiError(422, "VALIDATION_ERROR", message, details);
}

export function domainValidation(operation: () => void): void {
  try {
    operation();
  } catch (error) {
    validation(error instanceof Error ? error.message : "Domain validation failed.");
  }
}

export async function appendEvidence(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext,
  input: {
    action: KnownAuditAction;
    eventType: DomainEventType;
    aggregateType: string;
    aggregateId: UUID;
    patientId?: UUID | null;
    metadata?: Record<string, unknown>;
    payload: Record<string, unknown>;
    ordinal?: number;
  }
): Promise<void> {
  const occurredAt = context.clock.now().toISOString();
  await appendAudit(request, context, {
    action: input.action,
    resourceType: input.aggregateType,
    resourceId: input.aggregateId,
    patientId: input.patientId,
    metadata: input.metadata ?? input.payload,
    occurredAt,
    ordinal: input.ordinal ?? 0
  });
  const event: OutboxEventInput = {
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    patientId: input.patientId ?? null,
    idempotencyKey: featureOutboxIdempotencyKey(request, {
      eventType: input.eventType,
      aggregateId: input.aggregateId,
      ordinal: input.ordinal
    }),
    correlationId: request.metadata.requestId,
    payload: input.payload,
    occurredAt
  };
  await context.evidence.appendOutboxEvent(event);
}

export async function appendAudit(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext,
  input: {
    action: KnownAuditAction;
    resourceType: string | null;
    resourceId: string | null;
    patientId?: UUID | null;
    metadata?: Record<string, unknown>;
    occurredAt?: string;
    ordinal?: number;
  }
): Promise<void> {
  const classification = classifyAuditAction(input.action);
  if (classification.requiresPatientId && !input.patientId) {
    throw new ApiError(500, "CONFIGURATION_ERROR", "Required audit patient scope was missing.");
  }
  const event: RequestAuditEventInput = {
    id: deterministicAuditId(
      request.metadata.requestId,
      input.action,
      input.resourceId,
      input.ordinal ?? 0
    ),
    action: input.action,
    category: classification.category,
    riskLevel: classification.riskLevel,
    phiInvolved: classification.phiInvolved,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    patientId: input.patientId ?? null,
    metadata: input.metadata ?? {},
    ipAddress: request.metadata.ipAddress,
    userAgent: request.metadata.userAgent,
    correlationId: request.metadata.requestId,
    occurredAt: input.occurredAt ?? context.clock.now().toISOString()
  };
  await context.evidence.appendAuditEvent(event);
}

function deterministicAuditId(
  requestId: string,
  action: string,
  resourceId: string | null,
  ordinal: number
): string {
  const hex = createHash("sha256")
    .update(`${requestId}\u0000${action}\u0000${resourceId ?? ""}\u0000${ordinal}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16] ?? "0", 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join("")}-${hex.slice(8, 12).join("")}-${hex
    .slice(12, 16)
    .join("")}-${hex.slice(16, 20).join("")}-${hex.slice(20).join("")}`;
}

export function publicTask(task: TaskRecord) {
  const { tenantId: _tenantId, clinicId: _clinicId, ...publicRecord } = task;
  return publicRecord;
}

export function publicRecall(recall: RecallRecord) {
  const { tenantId: _tenantId, clinicId: _clinicId, ...publicRecord } = recall;
  return publicRecord;
}

export function publicSopRun(detail: SopRunDetail) {
  const { tenantId: _tenantId, clinicId: _clinicId, ...run } = detail.run;
  return {
    ...run,
    items: detail.items.map(({ tenantId: _itemTenant, clinicId: _itemClinic, ...item }) => item)
  };
}

export function publicCorrectiveAction(action: CorrectiveActionRecord, now: Date) {
  const { tenantId: _tenantId, clinicId: _clinicId, ...publicRecord } = action;
  const overdue =
    (action.status === "open" || action.status === "in_progress") &&
    Date.parse(action.dueAt) < now.getTime();
  return {
    ...publicRecord,
    effectiveStatus: overdue ? "overdue" : action.status,
    overdue
  };
}

export function taskEvidencePayload(task: TaskRecord): Record<string, unknown> {
  return {
    taskType: task.taskType,
    sourceWorkflow: task.sourceWorkflow,
    sourceRecordType: task.sourceRecordType,
    sourceRecordId: task.sourceRecordId,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    assignedToUserId: task.assignedToUserId,
    hasCompletionEvidence: Object.keys(task.completionEvidence).length > 0,
    durableIdempotencyKeyPresent: task.idempotencyKey !== null
  };
}

export function recallEvidencePayload(recall: RecallRecord): Record<string, unknown> {
  return {
    recallRuleId: recall.recallRuleId,
    status: recall.status,
    dueAt: recall.dueAt,
    taskId: recall.taskId,
    appointmentId: recall.appointmentId,
    sourceProcedurePerformedId: recall.sourceProcedurePerformedId,
    sourceInvoiceId: recall.sourceInvoiceId,
    providerConfirmationReceived: false
  };
}

export function sopEvidencePayload(detail: SopRunDetail): Record<string, unknown> {
  return {
    templateId: detail.run.templateId,
    scheduleId: detail.run.scheduleId,
    taskId: detail.run.taskId,
    dueAt: detail.run.dueAt,
    status: detail.run.status,
    itemCount: detail.items.length,
    completedItemCount: detail.items.filter((item) => item.status === "done").length,
    requiredItemCount: detail.items.filter((item) => item.evidenceRequired).length
  };
}
