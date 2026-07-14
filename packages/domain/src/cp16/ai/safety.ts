export const CP16_AI_PROHIBITED_ACTIONS = [
  "sign_clinical_record",
  "prescribe",
  "bill",
  "merge_patient",
  "release_export",
  "send_patient_message",
  "mutate_clinical_record"
] as const;

export type Cp16AiProhibitedAction = (typeof CP16_AI_PROHIBITED_ACTIONS)[number];

export type Cp16AiPurpose =
  | "clinical_draft"
  | "clinical_safety_review"
  | "bounded_extraction"
  | "long_context_summary"
  | "retrieval"
  | "speech_transcription";

export interface Cp16AiConsentPolicySnapshot {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly patientId: string;
  readonly encounterId: string;
  readonly purpose: Cp16AiPurpose;
  readonly consentId: string | null;
  readonly consentVersion: string | null;
  readonly consentStatus: "granted" | "denied" | "revoked" | "missing";
  readonly policyAllowed: boolean;
  readonly evaluatedAt: string;
  readonly expiresAt: string;
}

export interface Cp16AiPolicyDecision {
  readonly allowed: boolean;
  readonly code:
    | "allowed_for_review_only"
    | "consent_required"
    | "consent_revoked"
    | "policy_blocked"
    | "stale_policy_snapshot"
    | "scope_mismatch";
  readonly reviewOnly: true;
  readonly prohibitedActions: readonly Cp16AiProhibitedAction[];
}

export function evaluateCp16AiPolicy(input: {
  readonly expectedScope: Pick<
    Cp16AiConsentPolicySnapshot,
    "tenantId" | "clinicId" | "patientId" | "encounterId" | "purpose"
  >;
  readonly snapshot: Cp16AiConsentPolicySnapshot;
  readonly now: string;
}): Cp16AiPolicyDecision {
  const now = parseIso(input.now, "now");
  const evaluatedAt = parseIso(input.snapshot.evaluatedAt, "evaluatedAt");
  const expiresAt = parseIso(input.snapshot.expiresAt, "expiresAt");
  const deny = (code: Exclude<Cp16AiPolicyDecision["code"], "allowed_for_review_only">) =>
    Object.freeze({
      allowed: false,
      code,
      reviewOnly: true as const,
      prohibitedActions: CP16_AI_PROHIBITED_ACTIONS
    });

  if (
    input.snapshot.tenantId !== input.expectedScope.tenantId ||
    input.snapshot.clinicId !== input.expectedScope.clinicId ||
    input.snapshot.patientId !== input.expectedScope.patientId ||
    input.snapshot.encounterId !== input.expectedScope.encounterId ||
    input.snapshot.purpose !== input.expectedScope.purpose
  ) {
    return deny("scope_mismatch");
  }
  if (evaluatedAt > now || expiresAt <= now || now - evaluatedAt > 60_000) {
    return deny("stale_policy_snapshot");
  }
  if (input.snapshot.consentStatus === "revoked") return deny("consent_revoked");
  if (
    input.snapshot.consentStatus !== "granted" ||
    !input.snapshot.consentId ||
    !input.snapshot.consentVersion
  ) {
    return deny("consent_required");
  }
  if (!input.snapshot.policyAllowed) return deny("policy_blocked");
  return Object.freeze({
    allowed: true,
    code: "allowed_for_review_only",
    reviewOnly: true,
    prohibitedActions: CP16_AI_PROHIBITED_ACTIONS
  });
}

export function assertReviewOnlyAiArtifact(input: {
  readonly reviewOnly: unknown;
  readonly requestedAction?: unknown;
  readonly appliedRecordId?: unknown;
}): void {
  if (input.reviewOnly !== true || input.appliedRecordId !== null) {
    throw new Error("CP16 AI output must remain review-only and unapplied.");
  }
  if (
    typeof input.requestedAction === "string" &&
    (CP16_AI_PROHIBITED_ACTIONS as readonly string[]).includes(input.requestedAction)
  ) {
    throw new Error("CP16 AI output requested a prohibited autonomous action.");
  }
}

function parseIso(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`CP16 AI ${field} must be a canonical ISO timestamp.`);
  }
  return parsed;
}
