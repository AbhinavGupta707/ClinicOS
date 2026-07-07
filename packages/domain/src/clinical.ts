import type { UUID } from "./ids.ts";

export const INTAKE_FORM_TYPES = ["patient_intake", "medical_history", "consent_capture"] as const;
export type IntakeFormType = (typeof INTAKE_FORM_TYPES)[number];

export const INTAKE_SUBMISSION_SOURCES = ["digital", "assistant_paper_card"] as const;
export type IntakeSubmissionSource = (typeof INTAKE_SUBMISSION_SOURCES)[number];

export interface IntakeFormTemplateRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  code: string;
  displayName: string;
  formType: IntakeFormType;
  version: number;
  schema: Record<string, unknown>;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface IntakeFormSubmissionRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  templateId: UUID;
  templateVersion: number;
  source: IntakeSubmissionSource;
  responses: Record<string, unknown>;
  medicalHistorySnapshot: Record<string, unknown>;
  provenance: Record<string, unknown>;
  submittedByUserId: UUID;
  submittedAt: string;
}

export const CONSENT_PURPOSES = [
  "treatment_registration",
  "privacy_notice",
  "whatsapp_communication",
  "marketing_recall",
  "ai_audio_capture",
  "raw_audio_retention",
  "photo_capture",
  "photo_sharing",
  "abdm_abha",
  "procedure_treatment"
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const CONSENT_CAPTURE_METHODS = [
  "digital_patient",
  "assistant_paper_card",
  "clinic_staff",
  "imported_record"
] as const;
export type ConsentCaptureMethod = (typeof CONSENT_CAPTURE_METHODS)[number];

export type ConsentStatus = "active" | "revoked";
export type ConsentBlockReason =
  | "consent_granted"
  | "consent_missing"
  | "consent_revoked"
  | "consent_not_yet_effective";

export interface ConsentRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  templateCode: string;
  templateVersion: number;
  captureMethod: ConsentCaptureMethod;
  grantedByName: string | null;
  relationshipToPatient: string | null;
  evidence: Record<string, unknown>;
  provenance: Record<string, unknown>;
  createdByUserId: UUID;
  createdAt: string;
  revokedByUserId: UUID | null;
  revokedAt: string | null;
  revocationReason: string | null;
}

export interface ConsentEnforcementState {
  patientId: UUID;
  evaluatedAt: string;
  activePurposes: ConsentPurpose[];
  revokedPurposes: ConsentPurpose[];
  treatmentAllowed: boolean;
  whatsappCommunicationAllowed: boolean;
  marketingRecallAllowed: boolean;
  aiAudioCaptureAllowed: boolean;
  rawAudioRetentionAllowed: boolean;
  photoCaptureAllowed: boolean;
  photoSharingAllowed: boolean;
  abdmAbhaAllowed: boolean;
}

export interface ConsentRequirementDecision {
  purpose: ConsentPurpose;
  allowed: boolean;
  reason: ConsentBlockReason;
  evaluatedAt: string;
  consentId: UUID | null;
}

export interface AiAudioReadinessDecision {
  allowed: boolean;
  evaluatedAt: string;
  requiredPurposes: ConsentPurpose[];
  decisions: ConsentRequirementDecision[];
  blockedReasons: ConsentRequirementDecision[];
}

export const ENCOUNTER_STATUSES = [
  "scheduled",
  "drafting",
  "ready_for_sign",
  "signed",
  "amended",
  "closed",
  "cancelled"
] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

export interface EncounterRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  appointmentId: UUID | null;
  providerUserId: UUID;
  status: EncounterStatus;
  reason: string | null;
  medicalHistorySnapshot: Record<string, unknown>;
  startedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClinicalNoteContent {
  chiefComplaint?: string;
  history?: string;
  examination?: string;
  investigations?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  treatmentPerformed?: string;
  followUpInstructions?: string;
  additionalSections?: Record<string, unknown>;
}

export const CLINICAL_NOTE_VERSION_STATUSES = ["draft", "signed", "amended"] as const;
export type ClinicalNoteVersionStatus = (typeof CLINICAL_NOTE_VERSION_STATUSES)[number];

export interface ClinicalNoteVersionRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  encounterId: UUID;
  patientId: UUID;
  versionNumber: number;
  status: ClinicalNoteVersionStatus;
  content: ClinicalNoteContent;
  amendmentReason: string | null;
  amendedFromVersionId: UUID | null;
  signedByUserId: UUID | null;
  signedAt: string | null;
  createdByUserId: UUID;
  createdAt: string;
}

export interface PrescriptionMedication {
  name: string;
  strength?: string;
  route?: string;
  frequency: string;
  duration: string;
  instructions?: string;
}

export const PRESCRIPTION_STATUSES = ["draft", "signed"] as const;
export type PrescriptionStatus = (typeof PRESCRIPTION_STATUSES)[number];

export interface PrescriptionRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  encounterId: UUID;
  patientId: UUID;
  status: PrescriptionStatus;
  medications: PrescriptionMedication[];
  notes: string | null;
  createdByUserId: UUID;
  createdAt: string;
  signedByUserId: UUID | null;
  signedAt: string | null;
}

const ENCOUNTER_TRANSITIONS: Readonly<Record<EncounterStatus, readonly EncounterStatus[]>> = {
  scheduled: ["drafting", "cancelled"],
  drafting: ["ready_for_sign", "signed", "cancelled"],
  ready_for_sign: ["drafting", "signed", "cancelled"],
  signed: ["amended", "closed"],
  amended: ["amended", "closed"],
  closed: [],
  cancelled: []
};

export function isIntakeFormType(value: string): value is IntakeFormType {
  return (INTAKE_FORM_TYPES as readonly string[]).includes(value);
}

export function isIntakeSubmissionSource(value: string): value is IntakeSubmissionSource {
  return (INTAKE_SUBMISSION_SOURCES as readonly string[]).includes(value);
}

export function isConsentPurpose(value: string): value is ConsentPurpose {
  return (CONSENT_PURPOSES as readonly string[]).includes(value);
}

export function isConsentCaptureMethod(value: string): value is ConsentCaptureMethod {
  return (CONSENT_CAPTURE_METHODS as readonly string[]).includes(value);
}

export function isEncounterStatus(value: string): value is EncounterStatus {
  return (ENCOUNTER_STATUSES as readonly string[]).includes(value);
}

export function assertEncounterTransition(from: EncounterStatus, to: EncounterStatus): void {
  if (from === to) return;

  if (!ENCOUNTER_TRANSITIONS[from].includes(to)) {
    throw new Error(`Encounter status cannot transition from ${from} to ${to}.`);
  }
}

export function normalizeClinicalNoteContent(input: ClinicalNoteContent): ClinicalNoteContent {
  return {
    chiefComplaint: trimOptional(input.chiefComplaint),
    history: trimOptional(input.history),
    examination: trimOptional(input.examination),
    investigations: trimOptional(input.investigations),
    diagnosis: trimOptional(input.diagnosis),
    treatmentPlan: trimOptional(input.treatmentPlan),
    treatmentPerformed: trimOptional(input.treatmentPerformed),
    followUpInstructions: trimOptional(input.followUpInstructions),
    ...(input.additionalSections ? { additionalSections: input.additionalSections } : {})
  };
}

export function hasClinicalNoteContent(content: ClinicalNoteContent): boolean {
  const normalized = normalizeClinicalNoteContent(content);
  return Object.entries(normalized).some(([, value]) => {
    if (typeof value === "string") return value.trim().length > 0;
    if (value && typeof value === "object") return Object.keys(value).length > 0;
    return false;
  });
}

export function assertClinicalNoteCanBeSigned(note: ClinicalNoteVersionRecord): void {
  if (note.status !== "draft") {
    throw new Error("Only a draft clinical note can be signed.");
  }

  if (!hasClinicalNoteContent(note.content)) {
    throw new Error("Clinical note content is required before signing.");
  }
}

export function assertClinicalNoteDraftMutationAllowed(
  note: Pick<ClinicalNoteVersionRecord, "status">
): void {
  if (note.status === "signed" || note.status === "amended") {
    throw new Error("Signed clinical notes are immutable; create a linked amendment instead.");
  }
}

export function assertClinicalNoteCanBeAmended(note: ClinicalNoteVersionRecord): void {
  if (note.status !== "signed" && note.status !== "amended") {
    throw new Error("Only a signed clinical note version can be amended.");
  }
}

export function assertClinicalNoteAmendmentAllowed(
  note: Pick<ClinicalNoteVersionRecord, "status">,
  input: { reason?: string | null }
): void {
  if (note.status !== "signed" && note.status !== "amended") {
    throw new Error("Only signed clinical notes can be amended.");
  }

  if (!input.reason?.trim()) {
    throw new Error("Clinical note amendments require a reason.");
  }
}

export function assertPrescriptionCanBeSigned(prescription: PrescriptionRecord): void {
  if (prescription.status !== "draft") {
    throw new Error("Only a draft prescription can be signed.");
  }

  assertPrescriptionMedicationList(prescription.medications);
}

export function assertPrescriptionMedicationList(
  medications: readonly PrescriptionMedication[]
): void {
  if (!Array.isArray(medications) || medications.length === 0) {
    throw new Error("Prescription requires at least one medication.");
  }

  for (const [index, medication] of medications.entries()) {
    if (!medication.name.trim()) {
      throw new Error(`Medication ${index + 1} requires a name.`);
    }

    if (!medication.frequency.trim()) {
      throw new Error(`Medication ${index + 1} requires a frequency.`);
    }

    if (!medication.duration.trim()) {
      throw new Error(`Medication ${index + 1} requires a duration.`);
    }
  }
}

export function buildConsentEnforcementState(
  patientId: UUID,
  consents: readonly ConsentRecord[],
  evaluatedAt = new Date().toISOString()
): ConsentEnforcementState {
  const latestByPurpose = latestConsentByPurpose(consents);
  const activePurposes = [...latestByPurpose.values()]
    .filter((consent) => consent.status === "active")
    .map((consent) => consent.purpose)
    .sort();
  const revokedPurposes = [...latestByPurpose.values()]
    .filter((consent) => consent.status === "revoked")
    .map((consent) => consent.purpose)
    .sort();
  const active = new Set(activePurposes);

  return {
    patientId,
    evaluatedAt,
    activePurposes,
    revokedPurposes,
    treatmentAllowed:
      active.has("treatment_registration") || active.has("procedure_treatment"),
    whatsappCommunicationAllowed: active.has("whatsapp_communication"),
    marketingRecallAllowed: active.has("marketing_recall"),
    aiAudioCaptureAllowed: active.has("ai_audio_capture"),
    rawAudioRetentionAllowed:
      active.has("ai_audio_capture") && active.has("raw_audio_retention"),
    photoCaptureAllowed: active.has("photo_capture"),
    photoSharingAllowed: active.has("photo_capture") && active.has("photo_sharing"),
    abdmAbhaAllowed: active.has("abdm_abha")
  };
}

export function evaluateConsentRequirement(
  consents: readonly ConsentRecord[],
  purpose: ConsentPurpose,
  options: { evaluatedAt?: string } = {}
): ConsentRequirementDecision {
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  const evaluatedTime = toTime(evaluatedAt);
  const consent = latestConsentByPurpose(consents).get(purpose);

  if (!consent) {
    return blockedConsentDecision(purpose, "consent_missing", evaluatedAt, null);
  }

  if (toTime(consent.createdAt) > evaluatedTime) {
    return blockedConsentDecision(purpose, "consent_not_yet_effective", evaluatedAt, consent.id);
  }

  if (consent.status === "revoked") {
    return blockedConsentDecision(purpose, "consent_revoked", evaluatedAt, consent.id);
  }

  return {
    purpose,
    allowed: true,
    reason: "consent_granted",
    evaluatedAt,
    consentId: consent.id
  };
}

export function evaluateAiAudioReadiness(
  consents: readonly ConsentRecord[],
  options: { evaluatedAt?: string; requireRawAudioRetention?: boolean } = {}
): AiAudioReadinessDecision {
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  const requiredPurposes: ConsentPurpose[] = ["ai_audio_capture"];

  if (options.requireRawAudioRetention) {
    requiredPurposes.push("raw_audio_retention");
  }

  const decisions = requiredPurposes.map((purpose) =>
    evaluateConsentRequirement(consents, purpose, { evaluatedAt })
  );
  const blockedReasons = decisions.filter((decision) => !decision.allowed);

  return {
    allowed: blockedReasons.length === 0,
    evaluatedAt,
    requiredPurposes,
    decisions,
    blockedReasons
  };
}

function latestConsentByPurpose(consents: readonly ConsentRecord[]): Map<ConsentPurpose, ConsentRecord> {
  const latestByPurpose = new Map<ConsentPurpose, ConsentRecord>();

  for (const consent of consents) {
    const existing = latestByPurpose.get(consent.purpose);
    if (!existing || consentSortTimestamp(consent) >= consentSortTimestamp(existing)) {
      latestByPurpose.set(consent.purpose, consent);
    }
  }

  return latestByPurpose;
}

function consentSortTimestamp(consent: ConsentRecord): number {
  return Math.max(toTime(consent.revokedAt), toTime(consent.createdAt));
}

function toTime(value: string | null | undefined): number {
  if (!value) return 0;
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
}

function blockedConsentDecision(
  purpose: ConsentPurpose,
  reason: Exclude<ConsentBlockReason, "consent_granted">,
  evaluatedAt: string,
  consentId: UUID | null
): ConsentRequirementDecision {
  return {
    purpose,
    allowed: false,
    reason,
    evaluatedAt,
    consentId
  };
}

function trimOptional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
