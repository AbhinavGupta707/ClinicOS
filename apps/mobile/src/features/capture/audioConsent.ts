import type { PermissionResponse } from "expo";
import type { ConsentEnforcementState } from "../../lib/apiClient.ts";

export type PermissionState =
  | { state: "checking" }
  | { state: "requestable" }
  | { state: "granted" }
  | { state: "denied"; canAskAgain: boolean }
  | { state: "unavailable"; reason: string };

export type AudioConsentState =
  | { state: "checking" }
  | { state: "allowed" }
  | { state: "missing" }
  | { state: "revoked" }
  | { state: "unavailable" };

export interface AudioControlDecision {
  enabled: boolean;
  reason:
    | "ready"
    | "native_only"
    | "no_patient"
    | "no_verified_encounter"
    | "consent_checking"
    | "consent_missing"
    | "consent_revoked"
    | "consent_unavailable"
    | "permission_checking"
    | "permission_required"
    | "permission_denied";
  title: string;
  detail: string;
}

export function permissionStateFromResponse(response: PermissionResponse | null): PermissionState {
  if (!response) return { state: "checking" };
  if (response.granted) return { state: "granted" };
  if (response.status === "undetermined") return { state: "requestable" };
  return { state: "denied", canAskAgain: response.canAskAgain };
}

export function audioConsentState(
  enforcement: ConsentEnforcementState | null | undefined
): AudioConsentState {
  if (enforcement === undefined) return { state: "checking" };
  if (enforcement === null) return { state: "unavailable" };
  if (
    enforcement.revokedPurposes.includes("ai_audio_capture") ||
    enforcement.revokedPurposes.includes("raw_audio_retention")
  ) {
    return { state: "revoked" };
  }
  if (!enforcement.aiAudioCaptureAllowed || !enforcement.rawAudioRetentionAllowed) {
    return { state: "missing" };
  }
  return { state: "allowed" };
}

export function evaluateAudioControl(input: {
  native: boolean;
  patientId: string | null;
  encounterVerified: boolean;
  consent: AudioConsentState;
  permission: PermissionState;
}): AudioControlDecision {
  if (!input.native) {
    return decision("native_only", "Physical device required", "Clinical audio capture is not available on web.");
  }
  if (!input.patientId) {
    return decision("no_patient", "Choose a patient", "Select the patient before checking audio consent.");
  }
  if (!input.encounterVerified) {
    return decision(
      "no_verified_encounter",
      "Verify an active encounter",
      "Audio is encounter-bound and cannot start from an unverified identifier."
    );
  }
  if (input.consent.state === "checking") {
    return decision("consent_checking", "Checking consent", "Recording remains disabled while consent is checked.");
  }
  if (input.consent.state === "revoked") {
    return decision("consent_revoked", "Consent revoked", "Queued audio for this patient must be purged; no recording can start.");
  }
  if (input.consent.state === "missing") {
    return decision("consent_missing", "Required consent missing", "Active AI/audio capture and raw-audio retention consent are both required.");
  }
  if (input.consent.state === "unavailable") {
    return decision("consent_unavailable", "Consent unavailable", "Recording fails closed until the live consent state can be read.");
  }
  if (input.permission.state === "checking") {
    return decision("permission_checking", "Checking microphone", "Microphone permission is still being checked.");
  }
  if (input.permission.state === "requestable") {
    return decision("permission_required", "Microphone permission required", "Request microphone access only after consent and encounter checks pass.");
  }
  if (input.permission.state === "denied" || input.permission.state === "unavailable") {
    return decision("permission_denied", "Microphone unavailable", "Enable microphone access in system settings, then recheck it.");
  }
  return {
    enabled: true,
    reason: "ready",
    title: "Ready to record",
    detail: "Consent, encounter binding, and microphone permission are active."
  };
}

function decision(
  reason: Exclude<AudioControlDecision["reason"], "ready">,
  title: string,
  detail: string
): AudioControlDecision {
  return { enabled: false, reason, title, detail };
}
