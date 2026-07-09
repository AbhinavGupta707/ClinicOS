import type { SourceAttribution } from "./validation.ts";
import {
  addOptional,
  asRecord,
  compareIsoDateTimes,
  ensureAllowedKeys,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalString,
  parseMutationContext,
  parseRequestContext,
  parseSourceAttribution,
  parseWithIssues,
  requiredEnum,
  requiredString,
  type ContractParseResult,
  type MutationRequestContext,
  type RequestContext
} from "./validation.ts";

export const APPOINTMENT_STATUSES = [
  "requested",
  "booked",
  "confirmed",
  "checked_in",
  "in_consult",
  "completed",
  "cancelled",
  "no_show"
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_TRANSITIONS = {
  requested: ["booked", "confirmed", "cancelled", "no_show"],
  booked: ["confirmed", "checked_in", "cancelled", "no_show"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_consult", "completed", "cancelled"],
  in_consult: ["completed"],
  completed: [],
  cancelled: ["booked"],
  no_show: ["booked"]
} as const satisfies Record<AppointmentStatus, readonly AppointmentStatus[]>;

export const CONFIRMATION_CHANNELS = ["manual", "whatsapp", "sms", "phone_call"] as const;
export type ConfirmationChannel = (typeof CONFIRMATION_CHANNELS)[number];

export interface AppointmentListRequest extends RequestContext {
  date?: string;
  providerId?: string;
  patientId?: string;
  status?: AppointmentStatus;
  source?: SourceAttribution["source"];
  includeCancelled?: boolean;
}

export interface AppointmentCreatePayload extends SourceAttribution {
  patientId: string;
  providerUserId: string;
  appointmentTypeId: string;
  startAt: string;
  endAt: string;
  chairId?: string;
  roomId?: string;
  reason?: string;
  status: "requested" | "booked";
  conflictPolicy: "reject" | "allow_with_permission";
  overrideReason?: string;
}

export interface AppointmentCreateRequest extends MutationRequestContext {
  appointment: AppointmentCreatePayload;
}

export interface AppointmentRequestConfirmationRequest extends MutationRequestContext {
  appointmentId: string;
  channel: ConfirmationChannel;
  messageTemplateId?: string;
}

export interface AppointmentConfirmRequest extends MutationRequestContext {
  appointmentId: string;
  channel: ConfirmationChannel;
  confirmedAt: string;
}

export interface AppointmentCheckInRequest extends MutationRequestContext {
  appointmentId: string;
  patientId: string;
  checkedInAt: string;
  queue: {
    providerUserId?: string;
    chairId?: string;
    roomId?: string;
    priority?: number;
  };
}

export interface AppointmentNoShowRequest extends MutationRequestContext {
  appointmentId: string;
  patientId: string;
  markedAt: string;
  reason?: string;
}

export interface AppointmentSummary {
  id: string;
  tenantId: string;
  clinicId: string;
  patientId: string;
  providerUserId: string;
  appointmentTypeId: string;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  source: SourceAttribution["source"];
  provenance: SourceAttribution["provenance"];
  confirmationStatus: "not_requested" | "requested" | "confirmed" | "failed";
}

export interface AppointmentListResponse {
  appointments: AppointmentSummary[];
  nextCursor: string | null;
}

export interface AppointmentMutationResponse {
  appointment: AppointmentSummary;
  queueEntryId?: string;
  emittedEventTypes: (
    | "appointment.created"
    | "appointment.confirmation_requested"
    | "appointment.confirmed"
    | "appointment.no_show"
    | "patient.checked_in"
    | "queue.entry_created"
    | "attribution.touch.created"
  )[];
}

export function isAllowedAppointmentStatusTransition(
  from: AppointmentStatus,
  to: AppointmentStatus
): boolean {
  return (APPOINTMENT_STATUS_TRANSITIONS[from] as readonly AppointmentStatus[]).includes(to);
}

export function parseAppointmentListRequest(
  input: unknown
): ContractParseResult<AppointmentListRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      [
        "tenantId",
        "clinicId",
        "actor",
        "correlationId",
        "requestId",
        "date",
        "providerId",
        "patientId",
        "status",
        "source",
        "includeCancelled"
      ],
      "$",
      issues
    );

    const request: AppointmentListRequest = { ...parseRequestContext(record, "$", issues) };
    addOptional(request, "date", optionalString(record, "date", "$", issues, { dateOnly: true }));
    addOptional(request, "providerId", optionalString(record, "providerId", "$", issues, { uuid: true }));
    addOptional(request, "patientId", optionalString(record, "patientId", "$", issues, { uuid: true }));
    addOptional(request, "status", optionalEnum(record, "status", "$", APPOINTMENT_STATUSES, issues));
    addOptional(request, "source", optionalEnum(record, "source", "$", [
      "whatsapp",
      "call",
      "walk_in",
      "practo",
      "google",
      "referral",
      "manual",
      "manual_import",
      "external_system"
    ] as const, issues));
    addOptional(request, "includeCancelled", optionalBoolean(record, "includeCancelled", "$", issues));

    if (!request.date && !request.providerId && !request.patientId && !request.status) {
      issues.push({
        path: "$",
        message: "Appointment list requires at least one of date, providerId, patientId, or status."
      });
    }

    return request;
  });
}

export function parseAppointmentCreateRequest(
  input: unknown
): ContractParseResult<AppointmentCreateRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      ["tenantId", "clinicId", "actor", "correlationId", "requestId", "idempotencyKey", "appointment"],
      "$",
      issues
    );

    const appointmentRecord = asRecord(record.appointment, "$.appointment", issues) ?? {};
    ensureAllowedKeys(
      appointmentRecord,
      [
        "patientId",
        "providerUserId",
        "appointmentTypeId",
        "startAt",
        "endAt",
        "chairId",
        "roomId",
        "reason",
        "status",
        "source",
        "provenance",
        "conflictPolicy",
        "overrideReason"
      ],
      "$.appointment",
      issues
    );

    const startAt = requiredString(appointmentRecord, "startAt", "$.appointment", issues, { isoDateTime: true });
    const endAt = requiredString(appointmentRecord, "endAt", "$.appointment", issues, { isoDateTime: true });
    const conflictPolicy = requiredEnum(appointmentRecord, "conflictPolicy", "$.appointment", [
      "reject",
      "allow_with_permission"
    ] as const, issues);
    const overrideReason = optionalString(appointmentRecord, "overrideReason", "$.appointment", issues);

    if (startAt && endAt && compareIsoDateTimes(startAt, endAt) >= 0) {
      issues.push({ path: "$.appointment.endAt", message: "Appointment endAt must be after startAt." });
    }

    if (conflictPolicy === "allow_with_permission" && !overrideReason) {
      issues.push({
        path: "$.appointment.overrideReason",
        message: "Override reason is required when conflict policy allows override."
      });
    }

    const appointment: AppointmentCreatePayload = {
      ...parseSourceAttribution(appointmentRecord, "$.appointment", issues),
      patientId: requiredString(appointmentRecord, "patientId", "$.appointment", issues, { uuid: true }),
      providerUserId: requiredString(appointmentRecord, "providerUserId", "$.appointment", issues, { uuid: true }),
      appointmentTypeId: requiredString(appointmentRecord, "appointmentTypeId", "$.appointment", issues, { uuid: true }),
      startAt,
      endAt,
      status: requiredEnum(appointmentRecord, "status", "$.appointment", ["requested", "booked"] as const, issues),
      conflictPolicy
    };

    addOptional(appointment, "chairId", optionalString(appointmentRecord, "chairId", "$.appointment", issues));
    addOptional(appointment, "roomId", optionalString(appointmentRecord, "roomId", "$.appointment", issues));
    addOptional(appointment, "reason", optionalString(appointmentRecord, "reason", "$.appointment", issues));
    addOptional(appointment, "overrideReason", overrideReason);

    return {
      ...parseMutationContext(record, "$", issues),
      appointment
    };
  });
}

export function parseAppointmentRequestConfirmationRequest(
  input: unknown
): ContractParseResult<AppointmentRequestConfirmationRequest> {
  return parseAppointmentAction(input, "confirmation_requested");
}

export function parseAppointmentConfirmRequest(
  input: unknown
): ContractParseResult<AppointmentConfirmRequest> {
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
        "appointmentId",
        "channel",
        "confirmedAt"
      ],
      "$",
      issues
    );

    return {
      ...parseMutationContext(record, "$", issues),
      appointmentId: requiredString(record, "appointmentId", "$", issues, { uuid: true }),
      channel: requiredEnum(record, "channel", "$", CONFIRMATION_CHANNELS, issues),
      confirmedAt: requiredString(record, "confirmedAt", "$", issues, { isoDateTime: true })
    };
  });
}

export function parseAppointmentCheckInRequest(
  input: unknown
): ContractParseResult<AppointmentCheckInRequest> {
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
        "appointmentId",
        "patientId",
        "checkedInAt",
        "queue"
      ],
      "$",
      issues
    );

    const queueRecord = asRecord(record.queue, "$.queue", issues) ?? {};
    ensureAllowedKeys(queueRecord, ["providerUserId", "chairId", "roomId", "priority"], "$.queue", issues);
    const queue: AppointmentCheckInRequest["queue"] = {};

    addOptional(queue, "providerUserId", optionalString(queueRecord, "providerUserId", "$.queue", issues, { uuid: true }));
    addOptional(queue, "chairId", optionalString(queueRecord, "chairId", "$.queue", issues));
    addOptional(queue, "roomId", optionalString(queueRecord, "roomId", "$.queue", issues));
    addOptional(queue, "priority", optionalNumber(queueRecord, "priority", "$.queue", issues, { integer: true, min: 0, max: 100 }));

    return {
      ...parseMutationContext(record, "$", issues),
      appointmentId: requiredString(record, "appointmentId", "$", issues, { uuid: true }),
      patientId: requiredString(record, "patientId", "$", issues, { uuid: true }),
      checkedInAt: requiredString(record, "checkedInAt", "$", issues, { isoDateTime: true }),
      queue
    };
  });
}

export function parseAppointmentNoShowRequest(
  input: unknown
): ContractParseResult<AppointmentNoShowRequest> {
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
        "appointmentId",
        "patientId",
        "markedAt",
        "reason"
      ],
      "$",
      issues
    );

    const request: AppointmentNoShowRequest = {
      ...parseMutationContext(record, "$", issues),
      appointmentId: requiredString(record, "appointmentId", "$", issues, { uuid: true }),
      patientId: requiredString(record, "patientId", "$", issues, { uuid: true }),
      markedAt: requiredString(record, "markedAt", "$", issues, { isoDateTime: true })
    };
    addOptional(request, "reason", optionalString(record, "reason", "$", issues));

    return request;
  });
}

function parseAppointmentAction(
  input: unknown,
  _action: "confirmation_requested"
): ContractParseResult<AppointmentRequestConfirmationRequest> {
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
        "appointmentId",
        "channel",
        "messageTemplateId"
      ],
      "$",
      issues
    );

    const request: AppointmentRequestConfirmationRequest = {
      ...parseMutationContext(record, "$", issues),
      appointmentId: requiredString(record, "appointmentId", "$", issues, { uuid: true }),
      channel: requiredEnum(record, "channel", "$", CONFIRMATION_CHANNELS, issues)
    };
    addOptional(request, "messageTemplateId", optionalString(record, "messageTemplateId", "$", issues, { uuid: true }));

    return request;
  });
}
