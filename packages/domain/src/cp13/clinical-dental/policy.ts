import {
  isDentalFindingReviewStatus,
  isDentalFindingSource,
  isDentalFindingStatus,
  isDentalFindingType,
  isDentalSurface,
  isDentalToothNumber,
  type ConsentEnforcementState,
  type DentalFindingReviewStatus,
  type DentalFindingSource,
  type DentalFindingStatus,
  type DentalFindingType,
  type DentalSurface,
  type DentalToothNumber,
  type MediaType
} from "../../index.ts";

export const CLINICAL_MEDIA_MAX_BYTES = 100 * 1024 * 1024;
export const CLINICAL_MEDIA_UPLOAD_TTL_MS = 10 * 60 * 1000;
export const CLINICAL_MEDIA_ACCESS_MIN_SECONDS = 30;
export const CLINICAL_MEDIA_ACCESS_MAX_SECONDS = 300;

export type ClinicalConsentWorkflow =
  | "encounter_create"
  | "encounter_start"
  | "clinical_note_draft"
  | "clinical_note_sign"
  | "prescription_draft"
  | "prescription_sign"
  | "dental_finding_write"
  | "dental_snapshot"
  | "media_reserve"
  | "media_receive"
  | "media_complete"
  | "media_access";

export type ClinicalConsentBlockReason =
  | "treatment_consent_required"
  | "photo_capture_consent_required"
  | "photo_sharing_consent_required"
  | "ai_audio_consent_required";

export interface ClinicalConsentDecision {
  readonly allowed: boolean;
  readonly workflow: ClinicalConsentWorkflow;
  readonly reason: "consent_granted" | ClinicalConsentBlockReason;
  readonly evaluatedAt: string;
}

export interface DentalFindingWritePolicyInput {
  readonly toothNumber?: string;
  readonly surface?: string | null;
  readonly findingType?: string;
  readonly status?: string;
  readonly reviewStatus?: string;
  readonly source?: string;
}

export interface DentalFindingWritePolicyResult {
  toothNumber?: DentalToothNumber;
  surface?: DentalSurface | null;
  findingType?: DentalFindingType;
  status?: DentalFindingStatus;
  reviewStatus?: DentalFindingReviewStatus;
  source?: DentalFindingSource;
}

export class ClinicalDentalPolicyError extends Error {
  readonly code:
    | "CONSENT_REQUIRED"
    | "DOCTOR_REVIEW_REQUIRED"
    | "INVALID_DENTAL_FINDING"
    | "INVALID_MEDIA_BUDGET";
  readonly details: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: ClinicalDentalPolicyError["code"],
    message: string,
    details: Readonly<Record<string, string | number | boolean | null>> = {}
  ) {
    super(message);
    this.name = "ClinicalDentalPolicyError";
    this.code = code;
    this.details = details;
  }
}

export function evaluateClinicalConsent(
  state: Readonly<ConsentEnforcementState>,
  workflow: ClinicalConsentWorkflow,
  options: { readonly mediaType?: MediaType } = {}
): ClinicalConsentDecision {
  const evaluatedAt = state.evaluatedAt;
  const mediaType = options.mediaType;

  if (workflow === "media_access" && isPhotoOrXray(mediaType)) {
    return state.photoSharingAllowed
      ? allowed(workflow, evaluatedAt)
      : blocked(workflow, "photo_sharing_consent_required", evaluatedAt);
  }

  if (
    (workflow === "media_reserve" ||
      workflow === "media_receive" ||
      workflow === "media_complete") &&
    isPhotoOrXray(mediaType)
  ) {
    return state.photoCaptureAllowed
      ? allowed(workflow, evaluatedAt)
      : blocked(workflow, "photo_capture_consent_required", evaluatedAt);
  }

  if (mediaType === "audio_chunk") {
    return state.aiAudioCaptureAllowed
      ? allowed(workflow, evaluatedAt)
      : blocked(workflow, "ai_audio_consent_required", evaluatedAt);
  }

  return state.treatmentAllowed
    ? allowed(workflow, evaluatedAt)
    : blocked(workflow, "treatment_consent_required", evaluatedAt);
}

export function assertClinicalConsent(
  state: Readonly<ConsentEnforcementState>,
  workflow: ClinicalConsentWorkflow,
  options: { readonly mediaType?: MediaType } = {}
): ClinicalConsentDecision {
  const decision = evaluateClinicalConsent(state, workflow, options);
  if (!decision.allowed) {
    throw new ClinicalDentalPolicyError(
      "CONSENT_REQUIRED",
      "Active purpose-specific consent is required for this clinical action.",
      { workflow, reason: decision.reason, evaluated_at: decision.evaluatedAt }
    );
  }
  return decision;
}

export function applyDentalFindingWritePolicy(
  input: Readonly<DentalFindingWritePolicyInput>,
  options: {
    readonly actorIsDoctor: boolean;
    readonly currentSource?: DentalFindingSource;
    readonly currentReviewStatus?: DentalFindingReviewStatus;
  }
): DentalFindingWritePolicyResult {
  const result: DentalFindingWritePolicyResult = {};

  if (input.toothNumber !== undefined) {
    if (!isDentalToothNumber(input.toothNumber)) {
      throw invalidDental("toothNumber", input.toothNumber);
    }
    result.toothNumber = input.toothNumber;
  }

  if (input.surface !== undefined) {
    if (input.surface !== null && !isDentalSurface(input.surface)) {
      throw invalidDental("surface", input.surface);
    }
    result.surface = input.surface;
  }

  if (input.findingType !== undefined) {
    if (!isDentalFindingType(input.findingType)) {
      throw invalidDental("findingType", input.findingType);
    }
    result.findingType = input.findingType;
  }

  if (input.status !== undefined) {
    if (!isDentalFindingStatus(input.status)) {
      throw invalidDental("status", input.status);
    }
    result.status = input.status;
  }

  if (input.source !== undefined) {
    if (!isDentalFindingSource(input.source)) {
      throw invalidDental("source", input.source);
    }
    result.source = input.source;
  }

  if (input.reviewStatus !== undefined) {
    if (!isDentalFindingReviewStatus(input.reviewStatus)) {
      throw invalidDental("reviewStatus", input.reviewStatus);
    }
    result.reviewStatus = input.reviewStatus;
  }

  const effectiveSource = result.source ?? options.currentSource ?? "manual";
  const requestedReview = result.reviewStatus ?? options.currentReviewStatus ?? "needs_review";
  if (requestedReview === "reviewed" && !options.actorIsDoctor) {
    throw new ClinicalDentalPolicyError(
      "DOCTOR_REVIEW_REQUIRED",
      "Only a doctor can mark a dental finding as reviewed.",
      { required_role: "doctor" }
    );
  }

  if (effectiveSource === "ai_draft" && !options.actorIsDoctor) {
    result.reviewStatus = "needs_review";
  }

  const effectiveFindingType = result.findingType;
  const effectiveSurface = result.surface;
  if (effectiveFindingType === "missing" && effectiveSurface) {
    throw new ClinicalDentalPolicyError(
      "INVALID_DENTAL_FINDING",
      "A missing-tooth finding cannot carry a tooth surface.",
      { field: "surface", finding_type: "missing" }
    );
  }

  return result;
}

export function assertClinicalMediaBudget(fileSizeBytes: number): void {
  if (
    !Number.isSafeInteger(fileSizeBytes) ||
    fileSizeBytes < 1 ||
    fileSizeBytes > CLINICAL_MEDIA_MAX_BYTES
  ) {
    throw new ClinicalDentalPolicyError(
      "INVALID_MEDIA_BUDGET",
      "Clinical media size is outside the supported upload budget.",
      { maximum_bytes: CLINICAL_MEDIA_MAX_BYTES }
    );
  }
}

function isPhotoOrXray(mediaType: MediaType | undefined): boolean {
  return mediaType === "intraoral_photo" || mediaType === "xray";
}

function allowed(workflow: ClinicalConsentWorkflow, evaluatedAt: string): ClinicalConsentDecision {
  return { allowed: true, workflow, reason: "consent_granted", evaluatedAt };
}

function blocked(
  workflow: ClinicalConsentWorkflow,
  reason: ClinicalConsentBlockReason,
  evaluatedAt: string
): ClinicalConsentDecision {
  return { allowed: false, workflow, reason, evaluatedAt };
}

function invalidDental(field: string, value: string): ClinicalDentalPolicyError {
  return new ClinicalDentalPolicyError(
    "INVALID_DENTAL_FINDING",
    `Invalid dental finding ${field}.`,
    { field, value }
  );
}
