import type { ClinicalNoteContent } from "./clinical.ts";
import type { UUID } from "./ids.ts";

export const AI_PROVIDER_MODES = ["simulator", "unconfigured", "live_disabled"] as const;
export type AiProviderMode = (typeof AI_PROVIDER_MODES)[number];

export const AI_SESSION_STATUSES = [
  "capture_ready",
  "processing",
  "ready_for_review",
  "blocked",
  "retention_deleted",
  "cancelled"
] as const;
export type AiSessionStatus = (typeof AI_SESSION_STATUSES)[number];

export const AI_JOB_TYPES = ["transcription", "draft_generation", "retention_delete"] as const;
export type AiJobType = (typeof AI_JOB_TYPES)[number];

export const AI_JOB_STATUSES = ["queued", "running", "succeeded", "failed", "blocked"] as const;
export type AiJobStatus = (typeof AI_JOB_STATUSES)[number];

export const AI_SOURCE_ANCHOR_TYPES = [
  "transcript_segment",
  "media_asset",
  "clinical_context",
  "external_document"
] as const;
export type AiSourceAnchorType = (typeof AI_SOURCE_ANCHOR_TYPES)[number];

export const AI_OUTPUT_TYPES = ["clinical_note_draft", "dental_chart_patch_draft"] as const;
export type AiOutputType = (typeof AI_OUTPUT_TYPES)[number];

export const AI_OUTPUT_REVIEW_STATUSES = [
  "needs_review",
  "approved_review_only",
  "rejected",
  "superseded"
] as const;
export type AiOutputReviewStatus = (typeof AI_OUTPUT_REVIEW_STATUSES)[number];

export const AI_ACTION_PROPOSAL_TYPES = [
  "create_task",
  "draft_patient_message",
  "create_billing_follow_up",
  "create_lab_case"
] as const;
export type AiActionProposalType = (typeof AI_ACTION_PROPOSAL_TYPES)[number];

export const AI_REVIEW_DECISIONS = ["approve", "reject", "request_changes"] as const;
export type AiReviewDecision = (typeof AI_REVIEW_DECISIONS)[number];

export interface AiRetentionPolicy {
  rawAudioRetention: "disabled" | "retain_until";
  rawAudioDeleteAfterHours: number;
  transcriptDeleteAfterDays: number;
  aiOutputRetainForEvaluationDays: number;
  providerTrainingAllowed: false;
  providerRawPayloadStorage: "digest_only";
  dataResidency: "simulator_local_only" | "approved_region_required";
}

export interface AiConsentSnapshot {
  evaluatedAt: string;
  aiAudioCaptureAllowed: boolean;
  rawAudioRetentionAllowed: boolean;
  decisionReasons: Array<{
    purpose: string;
    allowed: boolean;
    reason: string;
    consentId: UUID | null;
  }>;
}

export interface AiSessionRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  encounterId: UUID;
  status: AiSessionStatus;
  providerMode: AiProviderMode;
  llmProviderKey: string;
  transcriptionProviderKey: string;
  consentSnapshot: AiConsentSnapshot;
  retentionPolicy: AiRetentionPolicy;
  languageHint: string | null;
  startedByUserId: UUID;
  startedAt: string;
  endedAt: string | null;
  rawAudioDeletedAt: string | null;
  transcriptDeletedAt: string | null;
  metadata: Record<string, unknown>;
}

export interface AiTranscriptSegmentRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  sessionId: UUID;
  patientId: UUID;
  encounterId: UUID;
  sequence: number;
  speakerRole: "doctor" | "assistant" | "patient" | "unknown";
  text: string;
  startsAtMs: number;
  endsAtMs: number;
  sourceHash: string;
  createdByUserId: UUID;
  createdAt: string;
}

export interface AiSourceAnchorRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  sessionId: UUID;
  patientId: UUID;
  encounterId: UUID;
  anchorType: AiSourceAnchorType;
  sourceRecordType: string;
  sourceRecordId: UUID | string;
  transcriptSegmentId: UUID | null;
  startsAtMs: number | null;
  endsAtMs: number | null;
  textQuoteDigest: string | null;
  supported: boolean;
  unsupportedReason: string | null;
  createdAt: string;
}

export interface DentalChartPatchDraftContent {
  encounterId: UUID;
  findings: Array<{
    toothNumber: string;
    surface?: string | null;
    findingType: string;
    description?: string;
    severity?: string | null;
    status: "active" | "watch" | "treated" | "historical";
    confidence: number;
    sourceAnchorIds: UUID[];
  }>;
  warnings: string[];
}

export interface AiClinicalNoteDraftContent extends ClinicalNoteContent {
  confidence: number;
  requiresDoctorAttention: string[];
}

export interface AiDraftOutputRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  sessionId: UUID;
  jobId: UUID | null;
  patientId: UUID;
  encounterId: UUID;
  outputType: AiOutputType;
  reviewStatus: AiOutputReviewStatus;
  content: AiClinicalNoteDraftContent | DentalChartPatchDraftContent;
  confidence: number;
  warnings: string[];
  sourceAnchorIds: UUID[];
  unsupportedSourceAnchorIds: UUID[];
  schemaVersion: string;
  providerMode: AiProviderMode;
  providerRequestDigest: string;
  createdByUserId: UUID;
  createdAt: string;
  reviewedByUserId: UUID | null;
  reviewedAt: string | null;
}

export interface AiActionProposalRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  sessionId: UUID;
  outputId: UUID | null;
  patientId: UUID;
  encounterId: UUID;
  proposalType: AiActionProposalType;
  reviewStatus: AiOutputReviewStatus;
  title: string;
  description: string;
  proposedPayload: Record<string, unknown>;
  requiredPermission: string;
  sourceAnchorIds: UUID[];
  unsupportedSourceAnchorIds: UUID[];
  providerMode: AiProviderMode;
  createdByUserId: UUID;
  createdAt: string;
  reviewedByUserId: UUID | null;
  reviewedAt: string | null;
}

export interface AiReviewDecisionRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  sessionId: UUID;
  targetType: "draft_output" | "action_proposal";
  targetId: UUID;
  decision: AiReviewDecision;
  reason: string;
  editedContent: Record<string, unknown> | null;
  appliedWorkflow: "review_only";
  appliedRecordId: null;
  reviewedByUserId: UUID;
  reviewedAt: string;
}

export interface AiJobRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  sessionId: UUID;
  patientId: UUID;
  encounterId: UUID;
  jobType: AiJobType;
  status: AiJobStatus;
  providerMode: AiProviderMode;
  providerKey: string;
  inputDigest: string;
  outputSummary: Record<string, unknown>;
  errorCode: string | null;
  errorMessage: string | null;
  createdByUserId: UUID;
  createdAt: string;
  completedAt: string | null;
}

export interface AiSessionDetail {
  session: AiSessionRecord;
  transcriptSegments: AiTranscriptSegmentRecord[];
  sourceAnchors: AiSourceAnchorRecord[];
  jobs: AiJobRecord[];
  draftOutputs: AiDraftOutputRecord[];
  actionProposals: AiActionProposalRecord[];
  reviewDecisions: AiReviewDecisionRecord[];
}

export function isAiProviderMode(value: string): value is AiProviderMode {
  return (AI_PROVIDER_MODES as readonly string[]).includes(value);
}

export function isAiOutputReviewStatus(value: string): value is AiOutputReviewStatus {
  return (AI_OUTPUT_REVIEW_STATUSES as readonly string[]).includes(value);
}

export function isAiReviewDecision(value: string): value is AiReviewDecision {
  return (AI_REVIEW_DECISIONS as readonly string[]).includes(value);
}

export function isAiSourceAnchorType(value: string): value is AiSourceAnchorType {
  return (AI_SOURCE_ANCHOR_TYPES as readonly string[]).includes(value);
}

export function assertSupportedSourceAnchors(
  anchors: readonly Pick<AiSourceAnchorRecord, "id" | "supported" | "unsupportedReason">[],
  sourceAnchorIds: readonly UUID[]
): void {
  const byId = new Map(anchors.map((anchor) => [anchor.id, anchor]));

  for (const sourceAnchorId of sourceAnchorIds) {
    const anchor = byId.get(sourceAnchorId);
    if (!anchor) {
      throw new Error(`Source anchor ${sourceAnchorId} was not found.`);
    }

    if (!anchor.supported) {
      throw new Error(
        `Source anchor ${sourceAnchorId} is unsupported: ${anchor.unsupportedReason ?? "unsupported_source"}`
      );
    }
  }
}

export function defaultAiRetentionPolicy(input: {
  rawAudioRetentionAllowed: boolean;
  providerMode: AiProviderMode;
}): AiRetentionPolicy {
  return {
    rawAudioRetention: input.rawAudioRetentionAllowed ? "retain_until" : "disabled",
    rawAudioDeleteAfterHours: input.rawAudioRetentionAllowed ? 24 : 0,
    transcriptDeleteAfterDays: 30,
    aiOutputRetainForEvaluationDays: 365,
    providerTrainingAllowed: false,
    providerRawPayloadStorage: "digest_only",
    dataResidency:
      input.providerMode === "simulator" ? "simulator_local_only" : "approved_region_required"
  };
}
