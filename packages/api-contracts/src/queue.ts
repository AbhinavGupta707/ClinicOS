import {
  addOptional,
  ensureAllowedKeys,
  optionalEnum,
  optionalNumber,
  optionalString,
  parseMutationContext,
  parseRequestContext,
  parseWithIssues,
  requiredEnum,
  requiredString,
  type ContractParseResult,
  type MutationRequestContext,
  type RequestContext
} from "./validation.ts";

export const QUEUE_ENTRY_STATUSES = [
  "waiting",
  "called",
  "in_consult",
  "completed",
  "left",
  "cancelled"
] as const;
export type QueueEntryStatus = (typeof QUEUE_ENTRY_STATUSES)[number];

export interface QueueListRequest extends RequestContext {
  date: string;
  providerId?: string;
  status?: QueueEntryStatus;
}

export interface QueueUpdateRequest extends MutationRequestContext {
  queueEntryId: string;
  status?: QueueEntryStatus;
  position?: number;
  roomId?: string;
  chairId?: string;
  reason?: string;
}

export interface QueueEntrySummary {
  id: string;
  tenantId: string;
  clinicId: string;
  appointmentId: string;
  patientId: string;
  providerUserId: string | null;
  status: QueueEntryStatus;
  position: number;
  newOrReturning: "new" | "returning" | "unknown";
  checkedInAt: string;
  updatedAt: string;
}

export interface QueueListResponse {
  date: string;
  entries: QueueEntrySummary[];
}

export interface QueueMutationResponse {
  entry: QueueEntrySummary;
  emittedEventTypes: ("queue.entry_updated" | "patient.checked_in")[];
}

export function parseQueueListRequest(input: unknown): ContractParseResult<QueueListRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      ["tenantId", "clinicId", "actor", "correlationId", "requestId", "date", "providerId", "status"],
      "$",
      issues
    );

    const request: QueueListRequest = {
      ...parseRequestContext(record, "$", issues),
      date: requiredString(record, "date", "$", issues, { dateOnly: true })
    };
    addOptional(request, "providerId", optionalString(record, "providerId", "$", issues, { uuid: true }));
    addOptional(request, "status", optionalEnum(record, "status", "$", QUEUE_ENTRY_STATUSES, issues));

    return request;
  });
}

export function parseQueueUpdateRequest(input: unknown): ContractParseResult<QueueUpdateRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      [
        "tenantId",
        "clinicId",
        "actor",
        "correlationId",
        "requestId",
        "idempotencyKey",
        "queueEntryId",
        "status",
        "position",
        "roomId",
        "chairId",
        "reason"
      ],
      "$",
      issues
    );

    const request: QueueUpdateRequest = {
      ...parseMutationContext(record, "$", issues),
      queueEntryId: requiredString(record, "queueEntryId", "$", issues, { uuid: true })
    };
    addOptional(request, "status", optionalEnum(record, "status", "$", QUEUE_ENTRY_STATUSES, issues));
    addOptional(request, "position", optionalNumber(record, "position", "$", issues, { integer: true, min: 0, max: 500 }));
    addOptional(request, "roomId", optionalString(record, "roomId", "$", issues));
    addOptional(request, "chairId", optionalString(record, "chairId", "$", issues));
    addOptional(request, "reason", optionalString(record, "reason", "$", issues));

    if (
      request.status === undefined &&
      request.position === undefined &&
      request.roomId === undefined &&
      request.chairId === undefined
    ) {
      issues.push({ path: "$", message: "Queue update requires status, position, roomId, or chairId." });
    }

    return request;
  });
}
