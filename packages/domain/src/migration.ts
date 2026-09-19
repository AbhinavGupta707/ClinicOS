import type {
  PatientDuplicateCandidate,
  PatientGender,
  PatientRecord,
  PatientSource
} from "./patient.ts";
import { buildPatientDuplicateSuggestions, normalizePhone } from "./patient.ts";
import type { UUID } from "./ids.ts";
import type { AppointmentRecord, AppointmentStatus } from "./appointment.ts";
import type { LeadSource } from "./lead.ts";

export const MIGRATION_IMPORT_TYPES = [
  "patients",
  "practitioners",
  "appointments",
  "invoices",
  "payments",
  "clinical_notes",
  "media_inventory"
] as const;

export type MigrationImportType = (typeof MIGRATION_IMPORT_TYPES)[number];

export const MIGRATION_BATCH_STATES = [
  "uploaded",
  "parsed",
  "validated",
  "needs_review",
  "ready_to_commit",
  "committed",
  "partially_committed",
  "failed",
  "rolled_back"
] as const;

export type MigrationBatchState = (typeof MIGRATION_BATCH_STATES)[number];

export const MIGRATION_ROW_STATUSES = [
  "invalid",
  "needs_review",
  "ready_to_commit",
  "committed",
  "skipped",
  "rolled_back",
  "failed"
] as const;

export type MigrationRowStatus = (typeof MIGRATION_ROW_STATUSES)[number];

export const MIGRATION_MATCH_STATUSES = [
  "none",
  "duplicate_candidate",
  "conflict",
  "resolved",
  "skipped"
] as const;

export type MigrationMatchStatus = (typeof MIGRATION_MATCH_STATUSES)[number];

export const MIGRATION_CONFLICT_TYPES = [
  "duplicate_patient",
  "verified_record_overlap",
  "invalid_reference",
  "field_conflict"
] as const;

export type MigrationConflictType = (typeof MIGRATION_CONFLICT_TYPES)[number];

export const MIGRATION_RESOLUTION_ACTIONS = [
  "create_new",
  "link_existing",
  "skip"
] as const;

export type MigrationResolutionAction = (typeof MIGRATION_RESOLUTION_ACTIONS)[number];

export const IMPORTED_RECORD_VERIFICATION_STATUSES = [
  "imported_unverified",
  "reviewed_verified",
  "rolled_back"
] as const;

export type ImportedRecordVerificationStatus =
  (typeof IMPORTED_RECORD_VERIFICATION_STATUSES)[number];

export interface MigrationBatchRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  importType: MigrationImportType;
  sourceSystem: string;
  sourceFileName: string | null;
  sourceChecksum: string | null;
  state: MigrationBatchState;
  uploadedByUserId: UUID;
  committedByUserId: UUID | null;
  rolledBackByUserId: UUID | null;
  rowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  conflictRowCount: number;
  readyRowCount: number;
  committedRowCount: number;
  rolledBackRowCount: number;
  failedRowCount: number;
  committedAt: string | null;
  rolledBackAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationValidationIssue {
  field: string;
  code: string;
  message: string;
}

export interface PatientMigrationNormalizedRecord {
  recordType: "patient";
  externalReference: string | null;
  fullName: string;
  phone: string;
  normalizedPhone: string;
  email: string | null;
  dateOfBirth: string | null;
  gender: PatientGender;
  source: PatientSource;
  sourceDetail: Record<string, unknown>;
}

export interface PractitionerMigrationNormalizedRecord {
  recordType: "provider_user";
  externalReference: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  sourceDetail: Record<string, unknown>;
}

export type ImportableAppointmentStatus = Exclude<
  AppointmentStatus,
  "checked_in" | "in_consult"
>;

export interface AppointmentMigrationNormalizedRecord {
  recordType: "appointment";
  externalReference: string;
  patientExternalReference: string;
  providerExternalReference: string;
  appointmentTypeCode: string;
  chairCode: string | null;
  startAt: string;
  endAt: string;
  status: ImportableAppointmentStatus;
  source: LeadSource;
  reason: null;
  notes: null;
  sourceDetail: Record<string, unknown>;
}

export type MigrationNormalizedRecord =
  | PatientMigrationNormalizedRecord
  | PractitionerMigrationNormalizedRecord
  | AppointmentMigrationNormalizedRecord;

export interface MigrationConflictRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  batchId: UUID;
  rowId: UUID;
  conflictType: MigrationConflictType;
  severity: "review" | "blocking";
  targetRecordType: string | null;
  targetRecordId: UUID | null;
  fieldName: string | null;
  summary: string;
  evidence: Record<string, unknown>;
  status: "open" | "resolved" | "ignored";
  resolutionAction: MigrationResolutionAction | null;
  resolvedByUserId: UUID | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationRowRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  batchId: UUID;
  rowNumber: number;
  importType: MigrationImportType;
  externalRecordId: string | null;
  rawPayloadDigest: string;
  rawPayloadRef: {
    rowId: UUID;
    digest: string;
    retained: true;
  };
  normalizedRecord: MigrationNormalizedRecord | null;
  validationErrors: MigrationValidationIssue[];
  status: MigrationRowStatus;
  matchStatus: MigrationMatchStatus;
  resolutionAction: MigrationResolutionAction | null;
  resolutionTargetRecordType: string | null;
  resolutionTargetRecordId: UUID | null;
  resolutionNote: string | null;
  committedRecordType: string | null;
  committedRecordId: UUID | null;
  errorMessage: string | null;
  conflicts: MigrationConflictRecord[];
  createdAt: string;
  updatedAt: string;
}

export interface MigrationBatchDetail {
  batch: MigrationBatchRecord;
  rows: MigrationRowRecord[];
  conflicts: MigrationConflictRecord[];
}

export interface ImportedRecordLinkRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  batchId: UUID;
  rowId: UUID;
  importType: MigrationImportType;
  sourceSystem: string;
  externalRecordId: string | null;
  targetRecordType: string;
  targetRecordId: UUID;
  linkType: "created_from_import" | "linked_existing";
  verificationStatus: ImportedRecordVerificationStatus;
  verifiedByUserId: UUID | null;
  verifiedAt: string | null;
  metadata: Record<string, unknown>;
  createdByUserId: UUID;
  createdAt: string;
  updatedAt: string;
}

export interface MigrationCommitRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  batchId: UUID;
  action: "commit" | "rollback";
  status: "succeeded" | "partially_succeeded" | "failed";
  idempotencyKey: string | null;
  requestedByUserId: UUID;
  summary: Record<string, unknown>;
  errorSummary: Record<string, unknown> | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface MigrationCommitResult {
  batch: MigrationBatchRecord;
  commit: MigrationCommitRecord;
  rows: MigrationRowRecord[];
  importedRecordLinks: ImportedRecordLinkRecord[];
}

export interface MigrationRollbackResult {
  batch: MigrationBatchRecord;
  rollback: MigrationCommitRecord;
  rows: MigrationRowRecord[];
  importedRecordLinks: ImportedRecordLinkRecord[];
  blockedLinks: ImportedRecordLinkRecord[];
}

export interface PatientImportRowDraft {
  rowNumber: number;
  rawPayload: Record<string, unknown>;
  externalReference: string | null;
  fullName: string;
  phone: string;
  email: string | null;
  dateOfBirth: string | null;
  gender: PatientGender;
  source: PatientSource;
  sourceDetail: Record<string, unknown>;
}

export interface PatientImportValidationResult {
  rowNumber: number;
  rawPayload: Record<string, unknown>;
  externalReference: string | null;
  normalizedRecord: PatientMigrationNormalizedRecord | null;
  validationErrors: MigrationValidationIssue[];
}

export interface PractitionerImportRowDraft {
  rowNumber: number;
  rawPayload: Record<string, unknown>;
  externalReference: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  sourceDetail: Record<string, unknown>;
}

export interface PractitionerImportValidationResult {
  rowNumber: number;
  rawPayload: Record<string, unknown>;
  externalReference: string;
  normalizedRecord: PractitionerMigrationNormalizedRecord | null;
  validationErrors: MigrationValidationIssue[];
}

export interface AppointmentImportRowDraft {
  rowNumber: number;
  rawPayload: Record<string, unknown>;
  externalReference: string;
  patientExternalReference: string;
  providerExternalReference: string;
  appointmentTypeCode: string;
  chairCode: string | null;
  startAt: string;
  endAt: string;
  status: string;
  source: string;
  sourceDetail: Record<string, unknown>;
}

export interface AppointmentImportValidationResult {
  rowNumber: number;
  rawPayload: Record<string, unknown>;
  externalReference: string;
  normalizedRecord: AppointmentMigrationNormalizedRecord | null;
  validationErrors: MigrationValidationIssue[];
}

const PATIENT_IMPORT_SOURCES = new Set<PatientSource>([
  "manual",
  "whatsapp",
  "phone",
  "call",
  "walkin",
  "practo",
  "google",
  "website",
  "instagram",
  "referral",
  "recall_campaign",
  "imported",
  "external_system"
]);

const PATIENT_GENDERS = new Set<PatientGender>(["female", "male", "other", "unknown"]);
const APPOINTMENT_IMPORT_STATUSES = new Set<ImportableAppointmentStatus>([
  "requested",
  "booked",
  "confirmed",
  "completed",
  "cancelled",
  "no_show"
]);
const APPOINTMENT_IMPORT_SOURCES = new Set<LeadSource>([
  "manual",
  "whatsapp",
  "phone",
  "call",
  "walkin",
  "practo",
  "google",
  "website",
  "instagram",
  "referral",
  "recall_campaign"
]);

export function isMigrationImportType(value: unknown): value is MigrationImportType {
  return typeof value === "string" && MIGRATION_IMPORT_TYPES.includes(value as MigrationImportType);
}

export function isMigrationResolutionAction(value: unknown): value is MigrationResolutionAction {
  return (
    typeof value === "string" &&
    MIGRATION_RESOLUTION_ACTIONS.includes(value as MigrationResolutionAction)
  );
}

export function parsePatientMigrationCsv(csv: string): PatientImportRowDraft[] {
  const records = parseCsvRecords(csv);
  if (records.length === 0) return [];

  const [headers, ...rows] = records;
  const normalizedHeaders = headers.map(normalizeHeader);

  return rows
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row, index) => {
      const rawPayload: Record<string, unknown> = {};
      for (let column = 0; column < normalizedHeaders.length; column += 1) {
        rawPayload[normalizedHeaders[column] || `column_${column + 1}`] = row[column] ?? "";
      }

      return coercePatientImportRow(rawPayload, index + 2);
    });
}

export function coercePatientImportRows(rows: readonly Record<string, unknown>[]): PatientImportRowDraft[] {
  return rows.map((row, index) => coercePatientImportRow(row, index + 1));
}

export function validatePatientImportRow(
  draft: PatientImportRowDraft
): PatientImportValidationResult {
  const validationErrors: MigrationValidationIssue[] = [];

  if (!draft.externalReference?.trim()) {
    validationErrors.push({
      field: "externalReference",
      code: "required",
      message: "Patient externalReference is required."
    });
  }

  if (!draft.fullName.trim()) {
    validationErrors.push({
      field: "fullName",
      code: "required",
      message: "Patient fullName is required."
    });
  }

  if (!draft.phone.trim()) {
    validationErrors.push({
      field: "phone",
      code: "required",
      message: "Patient phone is required."
    });
  }

  const normalizedPhone = normalizePhone(draft.phone);
  if (draft.phone.trim() && normalizedPhone.replace(/\D/g, "").length < 10) {
    validationErrors.push({
      field: "phone",
      code: "invalid_phone",
      message: "Patient phone must include at least 10 digits."
    });
  }

  if (draft.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.email)) {
    validationErrors.push({
      field: "email",
      code: "invalid_email",
      message: "Email must be a valid address when provided."
    });
  }

  if (draft.dateOfBirth && !isIsoDate(draft.dateOfBirth)) {
    validationErrors.push({
      field: "dateOfBirth",
      code: "invalid_date",
      message: "dateOfBirth must use YYYY-MM-DD."
    });
  }

  if (validationErrors.length > 0) {
    return {
      rowNumber: draft.rowNumber,
      rawPayload: draft.rawPayload,
      externalReference: draft.externalReference,
      normalizedRecord: null,
      validationErrors
    };
  }

  return {
    rowNumber: draft.rowNumber,
    rawPayload: draft.rawPayload,
    externalReference: draft.externalReference,
    normalizedRecord: {
      recordType: "patient",
      externalReference: draft.externalReference,
      fullName: draft.fullName.trim(),
      phone: draft.phone.trim(),
      normalizedPhone,
      email: draft.email,
      dateOfBirth: draft.dateOfBirth,
      gender: draft.gender,
      source: "imported",
      sourceDetail: {
        originalSource: draft.source,
        ...draft.sourceDetail
      }
    },
    validationErrors: []
  };
}

export function parsePractitionerMigrationCsv(csv: string): PractitionerImportRowDraft[] {
  return parseMigrationCsv(csv, coercePractitionerImportRow);
}

export function coercePractitionerImportRows(
  rows: readonly Record<string, unknown>[]
): PractitionerImportRowDraft[] {
  return rows.map((row, index) => coercePractitionerImportRow(row, index + 1));
}

export function validatePractitionerImportRow(
  draft: PractitionerImportRowDraft
): PractitionerImportValidationResult {
  const validationErrors: MigrationValidationIssue[] = [];
  if (!draft.externalReference.trim()) {
    validationErrors.push({
      field: "externalReference",
      code: "required",
      message: "Practitioner externalReference is required."
    });
  }
  if (!draft.displayName.trim()) {
    validationErrors.push({
      field: "displayName",
      code: "required",
      message: "Practitioner displayName is required for operator review."
    });
  }
  if (draft.email && !isPlausibleEmail(draft.email)) {
    validationErrors.push({
      field: "email",
      code: "invalid_email",
      message: "Email must be a valid address when provided."
    });
  }
  if (draft.phone && normalizePhone(draft.phone).replace(/\D/g, "").length < 10) {
    validationErrors.push({
      field: "phone",
      code: "invalid_phone",
      message: "Practitioner phone must include at least 10 digits when provided."
    });
  }

  return {
    rowNumber: draft.rowNumber,
    rawPayload: draft.rawPayload,
    externalReference: draft.externalReference.trim(),
    normalizedRecord:
      validationErrors.length > 0
        ? null
        : {
            recordType: "provider_user",
            externalReference: draft.externalReference.trim(),
            displayName: draft.displayName.trim(),
            email: normalizedNullableText(draft.email),
            phone: normalizedNullableText(draft.phone),
            sourceDetail: draft.sourceDetail
          },
    validationErrors
  };
}

export function parseAppointmentMigrationCsv(csv: string): AppointmentImportRowDraft[] {
  return parseMigrationCsv(csv, coerceAppointmentImportRow);
}

export function coerceAppointmentImportRows(
  rows: readonly Record<string, unknown>[]
): AppointmentImportRowDraft[] {
  return rows.map((row, index) => coerceAppointmentImportRow(row, index + 1));
}

export function validateAppointmentImportRow(
  draft: AppointmentImportRowDraft
): AppointmentImportValidationResult {
  const validationErrors: MigrationValidationIssue[] = [];
  for (const [field, value] of [
    ["externalReference", draft.externalReference],
    ["patientExternalReference", draft.patientExternalReference],
    ["providerExternalReference", draft.providerExternalReference],
    ["appointmentTypeCode", draft.appointmentTypeCode],
    ["startAt", draft.startAt],
    ["endAt", draft.endAt]
  ] as const) {
    if (!value.trim()) {
      validationErrors.push({ field, code: "required", message: `${field} is required.` });
    }
  }

  const startAt = normalizeIsoInstant(draft.startAt);
  const endAt = normalizeIsoInstant(draft.endAt);
  if (draft.startAt.trim() && !startAt) {
    validationErrors.push({
      field: "startAt",
      code: "invalid_instant",
      message: "startAt must be an ISO-8601 instant with Z or an explicit UTC offset."
    });
  }
  if (draft.endAt.trim() && !endAt) {
    validationErrors.push({
      field: "endAt",
      code: "invalid_instant",
      message: "endAt must be an ISO-8601 instant with Z or an explicit UTC offset."
    });
  }
  if (startAt && endAt) {
    const duration = Date.parse(endAt) - Date.parse(startAt);
    if (duration <= 0 || duration > 86_400_000) {
      validationErrors.push({
        field: "endAt",
        code: "invalid_window",
        message: "Appointment endAt must be after startAt and no more than 24 hours later."
      });
    }
  }
  if (!APPOINTMENT_IMPORT_STATUSES.has(draft.status as ImportableAppointmentStatus)) {
    validationErrors.push({
      field: "status",
      code: "unsupported_status",
      message:
        "Appointment status must be requested, booked, confirmed, completed, cancelled, or no_show."
    });
  }
  if (!APPOINTMENT_IMPORT_SOURCES.has(draft.source as LeadSource)) {
    validationErrors.push({
      field: "source",
      code: "unsupported_source",
      message: "Appointment source must use a canonical ClinicOS source value."
    });
  }

  return {
    rowNumber: draft.rowNumber,
    rawPayload: draft.rawPayload,
    externalReference: draft.externalReference.trim(),
    normalizedRecord:
      validationErrors.length > 0 || !startAt || !endAt
        ? null
        : {
            recordType: "appointment",
            externalReference: draft.externalReference.trim(),
            patientExternalReference: draft.patientExternalReference.trim(),
            providerExternalReference: draft.providerExternalReference.trim(),
            appointmentTypeCode: draft.appointmentTypeCode.trim(),
            chairCode: normalizedNullableText(draft.chairCode),
            startAt,
            endAt,
            status: draft.status as ImportableAppointmentStatus,
            source: draft.source as LeadSource,
            reason: null,
            notes: null,
            sourceDetail: draft.sourceDetail
          },
    validationErrors
  };
}

export function differingAppointmentImportFields(
  normalizedRecord: AppointmentMigrationNormalizedRecord,
  appointment: Pick<
    AppointmentRecord,
    | "patientId"
    | "providerUserId"
    | "appointmentTypeId"
    | "chairId"
    | "startAt"
    | "endAt"
    | "status"
    | "source"
  >,
  resolved: {
    patientId: UUID;
    providerUserId: UUID;
    appointmentTypeId: UUID;
    chairId: UUID | null;
  }
): string[] {
  const fields: string[] = [];
  if (appointment.patientId !== resolved.patientId) fields.push("patientExternalReference");
  if (appointment.providerUserId !== resolved.providerUserId) {
    fields.push("providerExternalReference");
  }
  if (appointment.appointmentTypeId !== resolved.appointmentTypeId) {
    fields.push("appointmentTypeCode");
  }
  if (appointment.chairId !== resolved.chairId) fields.push("chairCode");
  if (appointment.startAt !== normalizedRecord.startAt) fields.push("startAt");
  if (appointment.endAt !== normalizedRecord.endAt) fields.push("endAt");
  if (appointment.status !== normalizedRecord.status) fields.push("status");
  if (appointment.source !== normalizedRecord.source) fields.push("source");
  return fields;
}

export function duplicateCandidatesForPatientImport(
  normalizedRecord: PatientMigrationNormalizedRecord,
  existingPatients: Parameters<typeof buildPatientDuplicateSuggestions>[1]
): PatientDuplicateCandidate[] {
  return buildPatientDuplicateSuggestions(
    {
      fullName: normalizedRecord.fullName,
      phone: normalizedRecord.phone
    },
    existingPatients
  );
}

export function differingPatientImportFields(
  normalizedRecord: PatientMigrationNormalizedRecord,
  patient: Pick<PatientRecord, "fullName" | "phone" | "email" | "dateOfBirth" | "gender">
): Array<"fullName" | "phone" | "email" | "dateOfBirth" | "gender"> {
  const differingFields: Array<
    "fullName" | "phone" | "email" | "dateOfBirth" | "gender"
  > = [];

  if (normalizedRecord.fullName.trim() !== patient.fullName.trim()) {
    differingFields.push("fullName");
  }
  if (normalizedRecord.normalizedPhone !== normalizePhone(patient.phone ?? "")) {
    differingFields.push("phone");
  }
  if (normalizedNullableText(normalizedRecord.email) !== normalizedNullableText(patient.email)) {
    differingFields.push("email");
  }
  if (normalizedRecord.dateOfBirth !== patient.dateOfBirth) {
    differingFields.push("dateOfBirth");
  }
  if (normalizedRecord.gender !== patient.gender) {
    differingFields.push("gender");
  }

  return differingFields;
}

export function summarizeMigrationBatchState(input: {
  totalRows: number;
  invalidRows: number;
  conflictRows: number;
  readyRows: number;
}): MigrationBatchState {
  if (input.totalRows === 0) return "uploaded";
  if (input.conflictRows > 0) return "needs_review";
  if (input.readyRows > 0) return "ready_to_commit";
  return input.invalidRows > 0 ? "validated" : "parsed";
}

function coercePatientImportRow(
  row: Record<string, unknown>,
  rowNumber: number
): PatientImportRowDraft {
  const fullName = pickString(row, ["fullName", "full_name", "name", "patientName", "patient_name"]);
  const source = pickString(row, ["source", "sourceType", "source_type"]) || "imported";
  const gender = pickString(row, ["gender"]) || "unknown";

  return {
    rowNumber,
    rawPayload: { ...row },
    externalReference:
      pickNullableString(row, [
        "externalReference",
        "external_reference",
        "externalId",
        "external_id",
        "legacyId",
        "legacy_id"
      ]) ?? null,
    fullName,
    phone: pickString(row, ["phone", "mobile", "primaryContact", "primary_contact"]),
    email: pickNullableString(row, ["email"]) ?? null,
    dateOfBirth: pickNullableString(row, ["dateOfBirth", "date_of_birth", "dob"]) ?? null,
    gender: PATIENT_GENDERS.has(gender as PatientGender) ? (gender as PatientGender) : "unknown",
    source: PATIENT_IMPORT_SOURCES.has(source as PatientSource)
      ? (source as PatientSource)
      : "imported",
    sourceDetail: {
      rawSource: source
    }
  };
}

function coercePractitionerImportRow(
  row: Record<string, unknown>,
  rowNumber: number
): PractitionerImportRowDraft {
  return {
    rowNumber,
    rawPayload: { ...row },
    externalReference: pickString(row, [
      "externalReference",
      "external_reference",
      "externalId",
      "external_id",
      "practitionerId",
      "practitioner_id",
      "providerId",
      "provider_id"
    ]),
    displayName: pickString(row, [
      "displayName",
      "display_name",
      "name",
      "practitionerName",
      "practitioner_name",
      "providerName",
      "provider_name"
    ]),
    email: pickNullableString(row, ["email"]) ?? null,
    phone: pickNullableString(row, ["phone", "mobile"]) ?? null,
    sourceDetail: {}
  };
}

function coerceAppointmentImportRow(
  row: Record<string, unknown>,
  rowNumber: number
): AppointmentImportRowDraft {
  const source = pickString(row, ["source", "bookingSource", "booking_source"]);
  const status = pickString(row, ["status", "appointmentStatus", "appointment_status"]);
  return {
    rowNumber,
    rawPayload: { ...row },
    externalReference: pickString(row, [
      "externalReference",
      "external_reference",
      "externalId",
      "external_id",
      "appointmentId",
      "appointment_id"
    ]),
    patientExternalReference: pickString(row, [
      "patientExternalReference",
      "patient_external_reference",
      "patientExternalId",
      "patient_external_id"
    ]),
    providerExternalReference: pickString(row, [
      "providerExternalReference",
      "provider_external_reference",
      "practitionerExternalReference",
      "practitioner_external_reference",
      "providerExternalId",
      "provider_external_id"
    ]),
    appointmentTypeCode: pickString(row, [
      "appointmentTypeCode",
      "appointment_type_code",
      "typeCode",
      "type_code"
    ]),
    chairCode: pickNullableString(row, ["chairCode", "chair_code", "roomCode", "room_code"]),
    startAt: pickString(row, ["startAt", "start_at", "startsAt", "starts_at"]),
    endAt: pickString(row, ["endAt", "end_at", "endsAt", "ends_at"]),
    status,
    source,
    sourceDetail: { rawSource: source, rawStatus: status }
  };
}

function parseMigrationCsv<T>(
  csv: string,
  coerce: (row: Record<string, unknown>, rowNumber: number) => T
): T[] {
  const records = parseCsvRecords(csv);
  if (records.length === 0) return [];
  const [headers, ...rows] = records;
  const normalizedHeaders = headers.map(normalizeHeader);
  return rows
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row, index) => {
      const rawPayload: Record<string, unknown> = {};
      for (let column = 0; column < normalizedHeaders.length; column += 1) {
        rawPayload[normalizedHeaders[column] || `column_${column + 1}`] = row[column] ?? "";
      }
      return coerce(rawPayload, index + 2);
    });
}

function pickString(row: Record<string, unknown>, keys: readonly string[]): string {
  return pickNullableString(row, keys) ?? "";
}

function normalizedNullableText(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}

function isPlausibleEmail(value: string): boolean {
  if (value.length > 254) return false;

  let atIndex = -1;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "@") {
      if (atIndex !== -1) return false;
      atIndex = index;
    }
    if (character.trim().length === 0) return false;
  }

  if (atIndex <= 0 || atIndex >= value.length - 1) return false;
  if (atIndex > 64) return false;

  const domain = value.slice(atIndex + 1);
  const dotIndex = domain.indexOf(".");
  return dotIndex > 0 && dotIndex < domain.length - 1;
}

function pickNullableString(row: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }

  return null;
}

function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    const next = csv[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      record.push(field);
      field = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      continue;
    }

    field += char;
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  return records.map((row) => row.map((cell) => cell.trim()));
}

function normalizeHeader(header: string): string {
  const trimmed = header.trim();
  if (!trimmed) return "";

  return trimmed
    .replace(/^\uFEFF/, "")
    .replace(/[^a-zA-Z0-9]+(.)/g, (_match, letter: string) => letter.toUpperCase())
    .replace(/^[A-Z]/, (letter) => letter.toLowerCase());
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeIsoInstant(value: string): string | null {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/u.exec(
    trimmed
  );
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offsetHourText, offsetMinuteText] =
    match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ];
  if (
    year === 0 ||
    !daysInMonth ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59 ||
    offsetHour > 23 ||
    offsetMinute > 59
  ) {
    return null;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
