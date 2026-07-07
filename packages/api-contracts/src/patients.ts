import type { SourceAttribution } from "./validation.ts";
import {
  addOptional,
  asRecord,
  ensureAllowedKeys,
  hasAnyOwnField,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalRecord,
  optionalString,
  optionalStringArray,
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

export const PATIENT_GENDERS = ["female", "male", "other", "unknown"] as const;
export type PatientGender = (typeof PATIENT_GENDERS)[number];

export const PATIENT_TIMELINE_ITEM_TYPES = [
  "patient",
  "attribution",
  "lead",
  "appointment",
  "queue",
  "message",
  "clinical_note",
  "prescription",
  "media",
  "invoice",
  "payment",
  "task",
  "consent"
] as const;
export type PatientTimelineItemType = (typeof PATIENT_TIMELINE_ITEM_TYPES)[number];

export interface PatientSearchRequest extends RequestContext {
  query?: string;
  phone?: string;
  source?: SourceAttribution["source"];
  includeInactive?: boolean;
  limit?: number;
}

export interface PatientCreatePayload extends SourceAttribution {
  fullName: string;
  phone: string;
  email?: string;
  dateOfBirth?: string;
  gender: PatientGender;
  externalPatientRef?: string;
  duplicateCandidateIds?: string[];
  metadata?: Record<string, unknown>;
}

export interface PatientCreateRequest extends MutationRequestContext {
  patient: PatientCreatePayload;
}

export interface PatientUpdatePatch {
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  gender?: PatientGender;
  metadata?: Record<string, unknown>;
}

export interface PatientUpdateRequest extends MutationRequestContext {
  patientId: string;
  patch: PatientUpdatePatch;
  reason: string;
}

export interface PatientTimelineRequest extends RequestContext {
  patientId: string;
  cursor?: string;
  limit?: number;
  includeSensitive?: boolean;
  itemTypes?: PatientTimelineItemType[];
}

export interface PatientSummary {
  id: string;
  tenantId: string;
  clinicId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  gender: PatientGender;
  source: SourceAttribution["source"];
  provenance: SourceAttribution["provenance"];
  createdAt: string;
  updatedAt: string;
}

export interface PatientSearchResponse {
  patients: PatientSummary[];
  duplicateCandidates: PatientSummary[];
  nextCursor: string | null;
}

export interface PatientMutationResponse {
  patient: PatientSummary;
  timelineItemId: string;
  emittedEventTypes: ("patient.created" | "patient.updated" | "attribution.touch.created")[];
}

export interface PatientTimelineItem {
  id: string;
  patientId: string;
  itemType: PatientTimelineItemType;
  occurredAt: string;
  title: string;
  summary: string;
  source?: SourceAttribution["provenance"];
  sensitive: boolean;
  eventType?: string;
  resourceId?: string;
}

export interface PatientTimelineResponse {
  patientId: string;
  items: PatientTimelineItem[];
  nextCursor: string | null;
}

export function parsePatientSearchRequest(
  input: unknown
): ContractParseResult<PatientSearchRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      [
        "tenantId",
        "clinicId",
        "actor",
        "correlationId",
        "requestId",
        "query",
        "phone",
        "source",
        "includeInactive",
        "limit"
      ],
      "$",
      issues
    );

    const context = parseRequestContext(record, "$", issues);
    const request: PatientSearchRequest = {
      ...context
    };

    addOptional(request, "query", optionalString(record, "query", "$", issues));
    addOptional(request, "phone", optionalString(record, "phone", "$", issues, { phone: true }));
    addOptional(
      request,
      "source",
      optionalEnum(
        record,
        "source",
        "$",
        [
          "whatsapp",
          "call",
          "walk_in",
          "practo",
          "google",
          "referral",
          "manual",
          "manual_import",
          "external_system"
        ] as const,
        issues
      )
    );
    addOptional(
      request,
      "includeInactive",
      optionalBoolean(record, "includeInactive", "$", issues)
    );
    addOptional(
      request,
      "limit",
      optionalNumber(record, "limit", "$", issues, { integer: true, min: 1, max: 100 })
    );

    if (!request.query && !request.phone && !request.source) {
      issues.push({
        path: "$",
        message: "Patient search requires at least one of query, phone, or source."
      });
    }

    return request;
  });
}

export function parsePatientCreateRequest(
  input: unknown
): ContractParseResult<PatientCreateRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      ["tenantId", "clinicId", "actor", "correlationId", "requestId", "idempotencyKey", "patient"],
      "$",
      issues
    );

    const context = parseMutationContext(record, "$", issues);
    const patientRecord = asRecord(record.patient, "$.patient", issues) ?? {};
    ensureAllowedKeys(
      patientRecord,
      [
        "fullName",
        "phone",
        "email",
        "dateOfBirth",
        "gender",
        "source",
        "provenance",
        "externalPatientRef",
        "duplicateCandidateIds",
        "metadata"
      ],
      "$.patient",
      issues
    );

    const attribution = parseSourceAttribution(patientRecord, "$.patient", issues);
    const patient: PatientCreatePayload = {
      ...attribution,
      fullName: requiredString(patientRecord, "fullName", "$.patient", issues),
      phone: requiredString(patientRecord, "phone", "$.patient", issues, { phone: true }),
      gender: requiredEnum(patientRecord, "gender", "$.patient", PATIENT_GENDERS, issues)
    };

    addOptional(patient, "email", optionalString(patientRecord, "email", "$.patient", issues));
    addOptional(
      patient,
      "dateOfBirth",
      optionalString(patientRecord, "dateOfBirth", "$.patient", issues, { dateOnly: true })
    );
    addOptional(
      patient,
      "externalPatientRef",
      optionalString(patientRecord, "externalPatientRef", "$.patient", issues)
    );
    addOptional(
      patient,
      "duplicateCandidateIds",
      optionalStringArray(patientRecord, "duplicateCandidateIds", "$.patient", issues, {
        uuid: true
      })
    );
    addOptional(
      patient,
      "metadata",
      optionalRecord(patientRecord, "metadata", "$.patient", issues)
    );

    return {
      ...context,
      patient
    };
  });
}

export function parsePatientUpdateRequest(
  input: unknown
): ContractParseResult<PatientUpdateRequest> {
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
        "patientId",
        "patch",
        "reason"
      ],
      "$",
      issues
    );

    const context = parseMutationContext(record, "$", issues);
    const patchRecord = asRecord(record.patch, "$.patch", issues) ?? {};
    ensureAllowedKeys(
      patchRecord,
      ["fullName", "phone", "email", "dateOfBirth", "gender", "metadata"],
      "$.patch",
      issues
    );

    if (
      !hasAnyOwnField(patchRecord, [
        "fullName",
        "phone",
        "email",
        "dateOfBirth",
        "gender",
        "metadata"
      ])
    ) {
      issues.push({ path: "$.patch", message: "Patch must include at least one patient field." });
    }

    const patch: PatientUpdatePatch = {};
    addOptional(patch, "fullName", optionalString(patchRecord, "fullName", "$.patch", issues));
    addNullableString(patch, "phone", patchRecord, "$.patch", issues, { phone: true });
    addNullableString(patch, "email", patchRecord, "$.patch", issues);
    addNullableString(patch, "dateOfBirth", patchRecord, "$.patch", issues, { dateOnly: true });
    addOptional(
      patch,
      "gender",
      optionalEnum(patchRecord, "gender", "$.patch", PATIENT_GENDERS, issues)
    );
    addOptional(patch, "metadata", optionalRecord(patchRecord, "metadata", "$.patch", issues));

    return {
      ...context,
      patientId: requiredString(record, "patientId", "$", issues, { uuid: true }),
      patch,
      reason: requiredString(record, "reason", "$", issues)
    };
  });
}

export function parsePatientTimelineRequest(
  input: unknown
): ContractParseResult<PatientTimelineRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      [
        "tenantId",
        "clinicId",
        "actor",
        "correlationId",
        "requestId",
        "patientId",
        "cursor",
        "limit",
        "includeSensitive",
        "itemTypes"
      ],
      "$",
      issues
    );

    const context = parseRequestContext(record, "$", issues);
    const request: PatientTimelineRequest = {
      ...context,
      patientId: requiredString(record, "patientId", "$", issues, { uuid: true })
    };

    addOptional(request, "cursor", optionalString(record, "cursor", "$", issues));
    addOptional(
      request,
      "limit",
      optionalNumber(record, "limit", "$", issues, { integer: true, min: 1, max: 100 })
    );
    addOptional(
      request,
      "includeSensitive",
      optionalBoolean(record, "includeSensitive", "$", issues)
    );
    addOptional(
      request,
      "itemTypes",
      optionalStringArray(record, "itemTypes", "$", issues)?.map((item, index) => {
        if (!PATIENT_TIMELINE_ITEM_TYPES.includes(item as PatientTimelineItemType)) {
          issues.push({
            path: `$.itemTypes[${index}]`,
            message: `Expected one of: ${PATIENT_TIMELINE_ITEM_TYPES.join(", ")}.`
          });
        }
        return item as PatientTimelineItemType;
      })
    );

    return request;
  });
}

function addNullableString<T extends Record<string, unknown>>(
  target: T,
  key: string,
  record: Record<string, unknown>,
  path: string,
  issues: Parameters<typeof optionalString>[3],
  options: Parameters<typeof optionalString>[4] = {}
): void {
  if (!(key in record)) {
    return;
  }

  if (record[key] === null) {
    Object.assign(target, { [key]: null });
    return;
  }

  const value = optionalString(record, key, path, issues, options);
  if (value !== undefined) {
    Object.assign(target, { [key]: value });
  }
}
