import type { UUID } from "./ids.ts";

export const CONSENT_PURPOSES = [
  "treatment_registration",
  "privacy_notice_acknowledgement",
  "whatsapp_communication",
  "marketing_recall_communication",
  "ai_audio_capture",
  "raw_audio_retention",
  "photo_capture",
  "photo_sharing",
  "abdm_data_sharing",
  "procedure_treatment"
] as const;

export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];
export type ConsentStatus = "granted" | "revoked" | "expired";
export type ConsentBlockReason =
  | "consent_granted"
  | "consent_missing"
  | "consent_revoked"
  | "consent_expired"
  | "consent_not_yet_effective";

export interface ConsentRecordLike {
  id: UUID | string;
  patientId: UUID | string;
  purpose: ConsentPurpose;
  status: ConsentStatus;
  grantedAt: string;
  revokedAt?: string | null;
  expiresAt?: string | null;
  templateVersion?: string | null;
  provenance?: string | null;
}

export interface ConsentRequirementDecision {
  purpose: ConsentPurpose;
  allowed: boolean;
  reason: ConsentBlockReason;
  evaluatedAt: string;
  consentId: UUID | string | null;
}

export interface AiAudioReadinessDecision {
  allowed: boolean;
  evaluatedAt: string;
  requiredPurposes: ConsentPurpose[];
  decisions: ConsentRequirementDecision[];
  blockedReasons: ConsentRequirementDecision[];
}

export function evaluateConsentRequirement(
  consents: readonly ConsentRecordLike[],
  purpose: ConsentPurpose,
  options: { evaluatedAt?: string } = {}
): ConsentRequirementDecision {
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  const evaluatedTime = toTime(evaluatedAt);
  const latestConsent = latestConsentForPurpose(consents, purpose);

  if (!latestConsent) {
    return blockedConsentDecision(purpose, "consent_missing", evaluatedAt, null);
  }

  const grantedTime = toTime(latestConsent.grantedAt);

  if (grantedTime > evaluatedTime) {
    return blockedConsentDecision(
      purpose,
      "consent_not_yet_effective",
      evaluatedAt,
      latestConsent.id
    );
  }

  if (latestConsent.status === "revoked") {
    return blockedConsentDecision(purpose, "consent_revoked", evaluatedAt, latestConsent.id);
  }

  if (latestConsent.revokedAt && toTime(latestConsent.revokedAt) <= evaluatedTime) {
    return blockedConsentDecision(purpose, "consent_revoked", evaluatedAt, latestConsent.id);
  }

  if (latestConsent.status === "expired") {
    return blockedConsentDecision(purpose, "consent_expired", evaluatedAt, latestConsent.id);
  }

  if (latestConsent.expiresAt && toTime(latestConsent.expiresAt) <= evaluatedTime) {
    return blockedConsentDecision(purpose, "consent_expired", evaluatedAt, latestConsent.id);
  }

  return {
    purpose,
    allowed: true,
    reason: "consent_granted",
    evaluatedAt,
    consentId: latestConsent.id
  };
}

export function evaluateAiAudioReadiness(
  consents: readonly ConsentRecordLike[],
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

export interface ClinicalNotePolicySubject {
  id: UUID | string;
  patientId: UUID | string;
  encounterId: UUID | string;
  status: string;
  signedAt?: string | null;
}

export function assertClinicalNoteDraftMutationAllowed(note: ClinicalNotePolicySubject): void {
  if (note.status === "signed" || note.status === "amended") {
    throw new Error("Signed clinical notes are immutable; create a linked amendment instead.");
  }
}

export function assertClinicalNoteCanBeSigned(note: ClinicalNotePolicySubject): void {
  if (note.status !== "draft" && note.status !== "ready_for_sign") {
    throw new Error(`Clinical note in ${note.status} state cannot be signed.`);
  }
}

export function assertClinicalNoteAmendmentAllowed(
  note: ClinicalNotePolicySubject,
  input: { reason?: string | null }
): void {
  if (note.status !== "signed") {
    throw new Error("Only signed clinical notes can be amended.");
  }

  if (!input.reason?.trim()) {
    throw new Error("Clinical note amendments require a reason.");
  }
}

export interface PrescriptionPolicySubject {
  id: UUID | string;
  patientId: UUID | string;
  encounterId: UUID | string;
  status: string;
  signedAt?: string | null;
}

export function assertPrescriptionCanBeSigned(prescription: PrescriptionPolicySubject): void {
  if (prescription.status !== "draft") {
    throw new Error(`Prescription in ${prescription.status} state cannot be signed.`);
  }
}

function latestConsentForPurpose(
  consents: readonly ConsentRecordLike[],
  purpose: ConsentPurpose
): ConsentRecordLike | null {
  return (
    consents
      .filter((consent) => consent.purpose === purpose)
      .toSorted((left, right) => consentTimestamp(right) - consentTimestamp(left))[0] ?? null
  );
}

function consentTimestamp(consent: ConsentRecordLike): number {
  if (consent.status === "revoked" && consent.revokedAt) {
    return toTime(consent.revokedAt);
  }

  return toTime(consent.grantedAt);
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
  consentId: UUID | string | null
): ConsentRequirementDecision {
  return {
    purpose,
    allowed: false,
    reason,
    evaluatedAt,
    consentId
  };
}
