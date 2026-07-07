import type { ConsentEnforcementState } from "../../lib/apiClient";

export interface AudioControlDecision {
  enabled: boolean;
  reason:
    | "ready"
    | "no_patient"
    | "consent_missing"
    | "consent_revoked"
    | "retention_not_configured"
    | "adapter_unavailable";
  title: string;
  detail: string;
}

export interface NativeAudioCapability {
  reason: string;
  state: "ready" | "unavailable";
}

export function evaluateAudioControl(input: {
  patientId: string | null;
  enforcementState: ConsentEnforcementState | null;
}): AudioControlDecision {
  if (!input.patientId) {
    return {
      enabled: false,
      reason: "no_patient",
      title: "Choose a patient first",
      detail: "Audio capture is unavailable until a patient and encounter context are selected."
    };
  }

  if (!input.enforcementState) {
    return {
      enabled: false,
      reason: "consent_missing",
      title: "Consent status unavailable",
      detail: "Audio capture stays disabled until ClinicOS can read the patient consent record."
    };
  }

  if (input.enforcementState.revokedPurposes.includes("ai_audio_capture")) {
    return {
      enabled: false,
      reason: "consent_revoked",
      title: "Audio consent revoked",
      detail: "The patient withdrew AI/audio consent. Recording cannot start from mobile."
    };
  }

  if (!input.enforcementState.aiAudioCaptureAllowed) {
    return {
      enabled: false,
      reason: "consent_missing",
      title: "Audio consent missing",
      detail: "Record audio only after active AI/audio documentation consent is captured."
    };
  }

  if (!input.enforcementState.rawAudioRetentionAllowed) {
    return {
      enabled: false,
      reason: "retention_not_configured",
      title: "Retention policy required",
      detail: "ClinicOS must have active raw-audio retention consent and policy before recording."
    };
  }

  return {
    enabled: true,
    reason: "ready",
    title: "Audio controls ready",
    detail: "The patient has active AI/audio consent and raw-audio retention is configured."
  };
}

export function applyNativeAudioCapability(
  consentDecision: AudioControlDecision,
  nativeCapability: NativeAudioCapability
): AudioControlDecision {
  if (nativeCapability.state === "ready") {
    return consentDecision;
  }

  return {
    enabled: false,
    reason: "adapter_unavailable",
    title: "Native audio adapter unavailable",
    detail: `${nativeCapability.reason} Consent gate: ${consentDecision.title}. ${consentDecision.detail}`
  };
}
