import type { SourceAttribution } from "./validation.ts";
import {
  addOptional,
  asRecord,
  ensureAllowedKeys,
  optionalNumber,
  optionalRecord,
  optionalString,
  parseMutationContext,
  parseRequestContext,
  parseSourceAttribution,
  parseWithIssues,
  requiredEnum,
  requiredNumber,
  requiredString,
  type ContractParseResult,
  type MutationRequestContext,
  type RequestContext
} from "./validation.ts";

export const LEAD_STATUSES = [
  "new",
  "needs_review",
  "matched",
  "converted",
  "dismissed",
  "closed"
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_INTENTS = [
  "appointment_request",
  "pricing_question",
  "emergency",
  "follow_up",
  "general_query",
  "unknown"
] as const;
export type LeadIntent = (typeof LEAD_INTENTS)[number];

export const LEAD_STATUS_TRANSITIONS = {
  new: ["needs_review", "matched", "dismissed", "closed"],
  needs_review: ["new", "matched", "dismissed", "closed"],
  matched: ["converted", "dismissed", "closed"],
  converted: ["closed"],
  dismissed: ["new", "closed"],
  closed: []
} as const satisfies Record<LeadStatus, readonly LeadStatus[]>;

export interface LeadCreatePayload extends SourceAttribution {
  primaryContact: string;
  contactName?: string;
  intent: LeadIntent;
  sourceDetail?: {
    externalRef?: string;
    doctorName?: string;
    rawNotificationText?: string;
    campaign?: string;
  };
  receivedAt: string;
}

export interface LeadCreateRequest extends MutationRequestContext {
  lead: LeadCreatePayload;
}

export interface LeadListRequest extends RequestContext {
  source?: SourceAttribution["source"];
  status?: LeadStatus;
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  limit?: number;
}

export interface LeadMatchPatientRequest extends MutationRequestContext {
  leadId: string;
  patientId: string;
  confidence: number;
  rationale: string;
}

export interface LeadConvertToAppointmentRequest extends MutationRequestContext {
  leadId: string;
  patientId: string;
  appointmentDraft: {
    providerUserId: string;
    appointmentTypeId: string;
    startAt: string;
    endAt: string;
    chairId?: string;
    reason?: string;
  };
}

export interface LeadStatusUpdateRequest extends MutationRequestContext {
  leadId: string;
  fromStatus: LeadStatus;
  toStatus: LeadStatus;
  reason: string;
}

export interface LeadSummary {
  id: string;
  tenantId: string;
  clinicId: string;
  status: LeadStatus;
  primaryContact: string;
  contactName: string | null;
  intent: LeadIntent;
  source: SourceAttribution["source"];
  provenance: SourceAttribution["provenance"];
  matchedPatientId: string | null;
  convertedAppointmentId: string | null;
  receivedAt: string;
  updatedAt: string;
}

export interface LeadListResponse {
  leads: LeadSummary[];
  nextCursor: string | null;
}

export interface LeadMutationResponse {
  lead: LeadSummary;
  emittedEventTypes: (
    | "lead.created"
    | "lead.matched_to_patient"
    | "lead.converted_to_appointment"
    | "attribution.touch.created"
  )[];
}

export function isAllowedLeadStatusTransition(from: LeadStatus, to: LeadStatus): boolean {
  return LEAD_STATUS_TRANSITIONS[from].includes(to);
}

export function parseLeadCreateRequest(input: unknown): ContractParseResult<LeadCreateRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      ["tenantId", "clinicId", "actor", "correlationId", "requestId", "idempotencyKey", "lead"],
      "$",
      issues
    );

    const context = parseMutationContext(record, "$", issues);
    const leadRecord = asRecord(record.lead, "$.lead", issues) ?? {};
    ensureAllowedKeys(
      leadRecord,
      ["primaryContact", "contactName", "intent", "source", "provenance", "sourceDetail", "receivedAt"],
      "$.lead",
      issues
    );

    const attribution = parseSourceAttribution(leadRecord, "$.lead", issues);
    const sourceDetailRecord = leadRecord.sourceDetail
      ? asRecord(leadRecord.sourceDetail, "$.lead.sourceDetail", issues)
      : undefined;
    const lead: LeadCreatePayload = {
      ...attribution,
      primaryContact: requiredString(leadRecord, "primaryContact", "$.lead", issues, { phone: true }),
      intent: requiredEnum(leadRecord, "intent", "$.lead", LEAD_INTENTS, issues),
      receivedAt: requiredString(leadRecord, "receivedAt", "$.lead", issues, { isoDateTime: true })
    };

    addOptional(lead, "contactName", optionalString(leadRecord, "contactName", "$.lead", issues));

    if (sourceDetailRecord) {
      ensureAllowedKeys(
        sourceDetailRecord,
        ["externalRef", "doctorName", "rawNotificationText", "campaign"],
        "$.lead.sourceDetail",
        issues
      );
      lead.sourceDetail = {};
      addOptional(lead.sourceDetail, "externalRef", optionalString(sourceDetailRecord, "externalRef", "$.lead.sourceDetail", issues));
      addOptional(lead.sourceDetail, "doctorName", optionalString(sourceDetailRecord, "doctorName", "$.lead.sourceDetail", issues));
      addOptional(
        lead.sourceDetail,
        "rawNotificationText",
        optionalString(sourceDetailRecord, "rawNotificationText", "$.lead.sourceDetail", issues)
      );
      addOptional(lead.sourceDetail, "campaign", optionalString(sourceDetailRecord, "campaign", "$.lead.sourceDetail", issues));
    }

    return { ...context, lead };
  });
}

export function parseLeadListRequest(input: unknown): ContractParseResult<LeadListRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      [
        "tenantId",
        "clinicId",
        "actor",
        "correlationId",
        "requestId",
        "source",
        "status",
        "query",
        "dateFrom",
        "dateTo",
        "limit"
      ],
      "$",
      issues
    );

    const context = parseRequestContext(record, "$", issues);
    const request: LeadListRequest = { ...context };

    addOptional(request, "source", requiredOptionalSource(record, issues));
    addOptional(request, "status", requiredOptionalLeadStatus(record, issues));
    addOptional(request, "query", optionalString(record, "query", "$", issues));
    addOptional(request, "dateFrom", optionalString(record, "dateFrom", "$", issues, { dateOnly: true }));
    addOptional(request, "dateTo", optionalString(record, "dateTo", "$", issues, { dateOnly: true }));
    addOptional(request, "limit", optionalNumber(record, "limit", "$", issues, { integer: true, min: 1, max: 100 }));

    return request;
  });
}

export function parseLeadMatchPatientRequest(
  input: unknown
): ContractParseResult<LeadMatchPatientRequest> {
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
        "leadId",
        "patientId",
        "confidence",
        "rationale"
      ],
      "$",
      issues
    );

    return {
      ...parseMutationContext(record, "$", issues),
      leadId: requiredString(record, "leadId", "$", issues, { uuid: true }),
      patientId: requiredString(record, "patientId", "$", issues, { uuid: true }),
      confidence: requiredNumber(record, "confidence", "$", issues, { min: 0, max: 1 }),
      rationale: requiredString(record, "rationale", "$", issues)
    };
  });
}

export function parseLeadConvertToAppointmentRequest(
  input: unknown
): ContractParseResult<LeadConvertToAppointmentRequest> {
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
        "leadId",
        "patientId",
        "appointmentDraft"
      ],
      "$",
      issues
    );

    const draftRecord = asRecord(record.appointmentDraft, "$.appointmentDraft", issues) ?? {};
    ensureAllowedKeys(
      draftRecord,
      ["providerUserId", "appointmentTypeId", "startAt", "endAt", "chairId", "reason"],
      "$.appointmentDraft",
      issues
    );
    const startAt = requiredString(draftRecord, "startAt", "$.appointmentDraft", issues, { isoDateTime: true });
    const endAt = requiredString(draftRecord, "endAt", "$.appointmentDraft", issues, { isoDateTime: true });

    if (Date.parse(startAt) >= Date.parse(endAt)) {
      issues.push({ path: "$.appointmentDraft.endAt", message: "Appointment endAt must be after startAt." });
    }

    const draft: LeadConvertToAppointmentRequest["appointmentDraft"] = {
      providerUserId: requiredString(draftRecord, "providerUserId", "$.appointmentDraft", issues, { uuid: true }),
      appointmentTypeId: requiredString(draftRecord, "appointmentTypeId", "$.appointmentDraft", issues, { uuid: true }),
      startAt,
      endAt
    };
    addOptional(draft, "chairId", optionalString(draftRecord, "chairId", "$.appointmentDraft", issues));
    addOptional(draft, "reason", optionalString(draftRecord, "reason", "$.appointmentDraft", issues));

    return {
      ...parseMutationContext(record, "$", issues),
      leadId: requiredString(record, "leadId", "$", issues, { uuid: true }),
      patientId: requiredString(record, "patientId", "$", issues, { uuid: true }),
      appointmentDraft: draft
    };
  });
}

export function parseLeadStatusUpdateRequest(
  input: unknown
): ContractParseResult<LeadStatusUpdateRequest> {
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
        "leadId",
        "fromStatus",
        "toStatus",
        "reason"
      ],
      "$",
      issues
    );

    const fromStatus = requiredEnum(record, "fromStatus", "$", LEAD_STATUSES, issues);
    const toStatus = requiredEnum(record, "toStatus", "$", LEAD_STATUSES, issues);

    if (fromStatus && toStatus && !isAllowedLeadStatusTransition(fromStatus, toStatus)) {
      issues.push({ path: "$.toStatus", message: `Cannot transition lead from ${fromStatus} to ${toStatus}.` });
    }

    return {
      ...parseMutationContext(record, "$", issues),
      leadId: requiredString(record, "leadId", "$", issues, { uuid: true }),
      fromStatus,
      toStatus,
      reason: requiredString(record, "reason", "$", issues)
    };
  });
}

function requiredOptionalSource(
  record: Record<string, unknown>,
  issues: Parameters<typeof optionalString>[3]
): SourceAttribution["source"] | undefined {
  const source = optionalString(record, "source", "$", issues);
  if (source === undefined) return undefined;
  if (!["whatsapp", "call", "walk_in", "practo", "google", "referral", "manual", "manual_import", "external_system"].includes(source)) {
    issues.push({ path: "$.source", message: "Expected a valid lead source." });
  }
  return source as SourceAttribution["source"];
}

function requiredOptionalLeadStatus(
  record: Record<string, unknown>,
  issues: Parameters<typeof optionalString>[3]
): LeadStatus | undefined {
  const status = optionalString(record, "status", "$", issues);
  if (status === undefined) return undefined;
  if (!LEAD_STATUSES.includes(status as LeadStatus)) {
    issues.push({ path: "$.status", message: `Expected one of: ${LEAD_STATUSES.join(", ")}.` });
  }
  return status as LeadStatus;
}
