import type {
  AiActionProposalRecord,
  AiDraftOutputRecord,
  AiReviewDecisionRecord,
  AiSessionRecord,
  AiSourceAnchorRecord
} from "./ai.ts";
import type {
  ClinicalNoteVersionRecord,
  ConsentRecord,
  EncounterRecord,
  IntakeFormSubmissionRecord,
  PatientInstructionRecord,
  PrescriptionRecord
} from "./clinical.ts";
import type {
  DentalChartRecord,
  DentalChartSnapshotRecord,
  DentalFindingHistoryRecord,
  DentalFindingRecord
} from "./dental.ts";
import type { UUID } from "./ids.ts";
import type { PublicMediaAsset } from "./media.ts";
import type { PatientRecord, PatientTimelineItem } from "./patient.ts";

export const PATIENT_RECORD_EXPORT_SECTIONS = [
  "demographics",
  "consents",
  "timeline",
  "intake",
  "encounters",
  "clinical_notes",
  "prescriptions",
  "instructions",
  "dental_chart",
  "media",
  "billing",
  "ai_evidence",
  "privacy_audit"
] as const;
export type PatientRecordExportSection = (typeof PATIENT_RECORD_EXPORT_SECTIONS)[number];

export const DEFAULT_PATIENT_RECORD_EXPORT_SECTIONS: readonly PatientRecordExportSection[] = [
  "demographics",
  "consents",
  "timeline",
  "intake",
  "encounters",
  "clinical_notes",
  "prescriptions",
  "instructions",
  "dental_chart",
  "media",
  "billing",
  "ai_evidence",
  "privacy_audit"
];

export const DATA_EXPORT_STATUSES = ["requested", "completed", "failed", "cancelled"] as const;
export type DataExportStatus = (typeof DATA_EXPORT_STATUSES)[number];

export const AUDIT_REVIEW_STATUSES = ["reviewed", "escalated", "dismissed"] as const;
export type AuditReviewStatus = (typeof AUDIT_REVIEW_STATUSES)[number];

export const DELETION_REQUEST_STATUSES = [
  "requested",
  "approved_pending_retention_job",
  "rejected",
  "completed",
  "cancelled"
] as const;
export type DeletionRequestStatus = (typeof DELETION_REQUEST_STATUSES)[number];

export const DELETION_REQUEST_TYPES = [
  "patient_requested_deletion",
  "transient_payload_redaction",
  "correction_request"
] as const;
export type DeletionRequestType = (typeof DELETION_REQUEST_TYPES)[number];

export const RETENTION_JOB_MODES = ["dry_run", "execute"] as const;
export type RetentionJobMode = (typeof RETENTION_JOB_MODES)[number];

export const RETENTION_RUN_STATUSES = ["completed", "failed"] as const;
export type RetentionRunStatus = (typeof RETENTION_RUN_STATUSES)[number];

export const RETENTION_ACTION_STATUSES = ["planned", "completed", "skipped", "blocked"] as const;
export type RetentionActionStatus = (typeof RETENTION_ACTION_STATUSES)[number];

export const RETENTION_ACTION_KINDS = [
  "ai_transcript_delete",
  "ai_raw_audio_reference_delete",
  "data_export_payload_redact",
  "protected_clinical_record_skipped",
  "protected_audit_record_skipped"
] as const;
export type RetentionActionKind = (typeof RETENTION_ACTION_KINDS)[number];

export const BREAK_GLASS_ACCESS_STATUSES = [
  "requested",
  "approved",
  "denied",
  "revoked",
  "expired"
] as const;
export type BreakGlassAccessStatus = (typeof BREAK_GLASS_ACCESS_STATUSES)[number];

export const BREAK_GLASS_ACCESS_CATEGORIES = [
  "patient_record",
  "clinical_notes",
  "dental_chart",
  "media",
  "billing",
  "ai_evidence"
] as const;
export type BreakGlassAccessCategory = (typeof BREAK_GLASS_ACCESS_CATEGORIES)[number];

export interface AuditEventForReviewRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID | null;
  actorType: "user" | "system" | "integration" | "ai";
  actorId: string;
  action: string;
  category: "security" | "administration" | "phi_access" | "clinical" | "billing" | "operations" | "quality" | "integration" | "privacy";
  riskLevel: "low" | "medium" | "high" | "critical";
  phiInvolved: boolean;
  resourceType: string | null;
  resourceId: string | null;
  patientId: UUID | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string | null;
  occurredAt: string;
  review: AuditReviewRecord | null;
}

export interface AuditReviewRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  auditEventId: UUID;
  reviewStatus: AuditReviewStatus;
  disposition: string;
  notes: string | null;
  reviewedByUserId: UUID;
  reviewedAt: string;
  createdAt: string;
}

export interface CreateAuditReviewInput {
  reviewStatus: AuditReviewStatus;
  disposition: string;
  notes?: string | null;
}

export interface PatientRecordExportManifest {
  schemaVersion: "cp9.patient_record_export.v1";
  generatedAt: string;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  sections: PatientRecordExportSection[];
  format: "json";
  safety: {
    rawStorageReferences: "excluded";
    rawProviderPayloads: "excluded";
    auditMetadata: "phi_redacted";
    tenantScoped: true;
  };
}

export interface PatientRecordExportAiEvidence {
  sessions: AiSessionRecord[];
  sourceAnchors: AiSourceAnchorRecord[];
  draftOutputs: AiDraftOutputRecord[];
  actionProposals: AiActionProposalRecord[];
  reviewDecisions: AiReviewDecisionRecord[];
}

export interface PatientRecordExportSnapshot {
  manifest: PatientRecordExportManifest;
  patient: PatientRecord | null;
  consents: ConsentRecord[];
  timeline: PatientTimelineItem[];
  intakeSubmissions: IntakeFormSubmissionRecord[];
  encounters: EncounterRecord[];
  clinicalNotes: ClinicalNoteVersionRecord[];
  prescriptions: PrescriptionRecord[];
  instructions: PatientInstructionRecord[];
  dentalChart: {
    chart: DentalChartRecord | null;
    findings: DentalFindingRecord[];
    findingHistory: DentalFindingHistoryRecord[];
    snapshots: DentalChartSnapshotRecord[];
  };
  mediaAssets: PublicMediaAsset[];
  billing: {
    invoices: Record<string, unknown>[];
    paymentRequests: Record<string, unknown>[];
    paymentTransactions: Record<string, unknown>[];
    receipts: Record<string, unknown>[];
  };
  aiEvidence: PatientRecordExportAiEvidence;
  privacyAuditTrail: AuditEventForReviewRecord[];
}

export interface PatientRecordExportRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  status: DataExportStatus;
  format: "json";
  sections: PatientRecordExportSection[];
  requestedByUserId: UUID;
  completedByUserId: UUID | null;
  requestedAt: string;
  completedAt: string | null;
  manifest: PatientRecordExportManifest;
  payload: PatientRecordExportSnapshot | null;
  payloadDigest: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePatientRecordExportInput {
  patientId: UUID;
  sections: PatientRecordExportSection[];
  reason: string;
  format: "json";
}

export interface DeletionRequestRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  requestType: DeletionRequestType;
  status: DeletionRequestStatus;
  reason: string;
  requestedByUserId: UUID;
  requestedAt: string;
  reviewedByUserId: UUID | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  scope: {
    requestedCategories: string[];
    protectedClinicalRecords: "not_deleted";
    protectedAuditRecords: "not_deleted";
  };
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeletionRequestInput {
  patientId: UUID;
  requestType: DeletionRequestType;
  reason: string;
  requestedCategories: string[];
}

export interface ReviewDeletionRequestInput {
  decision: "approve" | "reject" | "cancel";
  reviewReason: string;
}

export interface RetentionRunRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  mode: RetentionJobMode;
  status: RetentionRunStatus;
  policyCode: string;
  asOf: string;
  deletionRequestId: UUID | null;
  startedByUserId: UUID;
  startedAt: string;
  completedAt: string;
  summary: {
    eligibleTransientPayloads: number;
    completedActions: number;
    protectedRecordsSkipped: number;
  };
  createdAt: string;
}

export interface RetentionActionRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  runId: UUID;
  patientId: UUID | null;
  actionKind: RetentionActionKind;
  status: RetentionActionStatus;
  targetType: string;
  targetId: string;
  protectedRecord: boolean;
  evidence: Record<string, unknown>;
  completedAt: string | null;
  createdAt: string;
}

export interface RunRetentionJobInput {
  mode: RetentionJobMode;
  asOf: string;
  policyCode: string;
  patientId?: UUID | null;
  deletionRequestId?: UUID | null;
  transcriptDeleteAfterDays: number;
}

export interface RetentionRunResult {
  run: RetentionRunRecord;
  actions: RetentionActionRecord[];
}

export interface BreakGlassAccessRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  requestedByUserId: UUID;
  patientId: UUID;
  reason: string;
  status: BreakGlassAccessStatus;
  accessCategories: BreakGlassAccessCategory[];
  accessScope: {
    patientId: UUID;
    resourceTypes: BreakGlassAccessCategory[];
    clinicalJustification: string;
  };
  requestedAt: string;
  expiresAt: string;
  reviewedByUserId: UUID | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBreakGlassAccessInput {
  patientId: UUID;
  reason: string;
  expiresAt: string;
  accessCategories: BreakGlassAccessCategory[];
}

export interface ReviewBreakGlassAccessInput {
  decision: "approve" | "deny" | "revoke";
  reviewReason: string;
}

const MAX_BREAK_GLASS_DURATION_MS = 8 * 60 * 60 * 1000;
const MIN_REASON_LENGTH = 12;

export function isPatientRecordExportSection(value: string): value is PatientRecordExportSection {
  return (PATIENT_RECORD_EXPORT_SECTIONS as readonly string[]).includes(value);
}

export function isAuditReviewStatus(value: string): value is AuditReviewStatus {
  return (AUDIT_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isDeletionRequestType(value: string): value is DeletionRequestType {
  return (DELETION_REQUEST_TYPES as readonly string[]).includes(value);
}

export function isRetentionJobMode(value: string): value is RetentionJobMode {
  return (RETENTION_JOB_MODES as readonly string[]).includes(value);
}

export function isBreakGlassAccessCategory(value: string): value is BreakGlassAccessCategory {
  return (BREAK_GLASS_ACCESS_CATEGORIES as readonly string[]).includes(value);
}

export function normalizePatientRecordExportSections(
  values: readonly string[] | undefined
): PatientRecordExportSection[] {
  if (!values || values.length === 0) return [...DEFAULT_PATIENT_RECORD_EXPORT_SECTIONS];

  const sections = new Set<PatientRecordExportSection>();
  for (const value of values) {
    if (!isPatientRecordExportSection(value)) {
      throw new Error(`Unknown patient export section: ${value}`);
    }
    sections.add(value);
  }

  return [...sections].sort();
}

export function assertBreakGlassRequestPolicy(
  input: Pick<CreateBreakGlassAccessInput, "reason" | "expiresAt" | "accessCategories">,
  now = new Date()
): void {
  if (input.reason.trim().length < MIN_REASON_LENGTH) {
    throw new Error("Break-glass reason must be specific and at least 12 characters.");
  }

  if (input.accessCategories.length === 0) {
    throw new Error("Break-glass scope must include at least one access category.");
  }

  const expiresAt = new Date(input.expiresAt);
  if (!Number.isFinite(expiresAt.getTime())) {
    throw new Error("Break-glass expiry must be a valid timestamp.");
  }

  if (expiresAt.getTime() <= now.getTime()) {
    throw new Error("Break-glass expiry must be in the future.");
  }

  if (expiresAt.getTime() - now.getTime() > MAX_BREAK_GLASS_DURATION_MS) {
    throw new Error("Break-glass expiry cannot exceed 8 hours.");
  }
}

export function breakGlassAccessIsActive(
  access: Pick<BreakGlassAccessRecord, "status" | "expiresAt" | "revokedAt">,
  at = new Date()
): boolean {
  return (
    access.status === "approved" &&
    access.revokedAt === null &&
    new Date(access.expiresAt).getTime() > at.getTime()
  );
}

export function assertRetentionRunPolicy(
  input: Pick<RunRetentionJobInput, "mode" | "transcriptDeleteAfterDays">
): void {
  if (!Number.isInteger(input.transcriptDeleteAfterDays) || input.transcriptDeleteAfterDays < 0) {
    throw new Error("Retention transcriptDeleteAfterDays must be a non-negative integer.");
  }

  if (!isRetentionJobMode(input.mode)) {
    throw new Error("Retention job mode must be dry_run or execute.");
  }
}
