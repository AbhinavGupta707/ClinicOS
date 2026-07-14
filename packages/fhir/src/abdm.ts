export const REQUIRED_ABDM_CREDENTIAL_KEYS = [
  "clientId",
  "clientSecret",
  "baseUrl",
  "hipId",
  "hiuId",
  "cmId"
] as const;

export const ABDM_PUBLISHED_FHIR_IG = Object.freeze({
  canonical: "https://nrces.in/ndhm/fhir/r4",
  packageId: "ndhm.in",
  version: "6.5.0",
  packageSpec: "ndhm.in#6.5.0"
} as const);

export interface AbdmOfficialActivationEvidence {
  /** Opaque identifier of the provider-side registration, not a credential. */
  readonly registrationId: string;
  readonly environment: "sandbox";
  readonly igPackage: typeof ABDM_PUBLISHED_FHIR_IG.packageSpec;
  readonly registeredAt: string;
  readonly sandboxEvidenceId: string;
  readonly status: "sandbox_verified";
  readonly validatorEvidenceId: string;
  readonly verifiedAt: string;
}

export interface AbdmCapabilityBoundaryInput {
  readonly activation: AbdmOfficialActivationEvidence | null;
  readonly evaluatedAt: string;
}

export interface AbdmCapabilityBoundaryResult {
  readonly activationStatus: "sandbox_verified" | "unregistered";
  readonly availability: "sandbox_only" | "unavailable";
  readonly evaluatedAt: string;
  readonly igPackage: typeof ABDM_PUBLISHED_FHIR_IG.packageSpec;
  readonly liveExchangeAllowed: false;
  readonly reason:
    | "official_activation_absent"
    | "official_activation_invalid"
    | "production_activation_not_supported"
    | "sandbox_verified";
  readonly registered: boolean;
}

export type AbdmCredentialKey = (typeof REQUIRED_ABDM_CREDENTIAL_KEYS)[number];

export interface AbdmCredentials {
  baseUrl?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  cmId?: string | null;
  hipId?: string | null;
  hiuId?: string | null;
}

export interface AbdmFeatureFlags {
  abdmEnabled: boolean;
  abhaLinkingEnabled: boolean;
  careContextLinkingEnabled: boolean;
  consentExchangeEnabled: boolean;
  sandboxActivationApproved?: boolean;
  simulatorMode: boolean;
}

export interface AbdmPatientPosture {
  abhaAddress?: string | null;
  abhaConsentActive: boolean;
  dataExchangeConsentActive: boolean;
  patientId: string;
}

export interface AbdmCareContextProjection {
  careContextReference?: string | null;
  consentStatus: "expired" | "granted" | "not_requested" | "revoked";
  display: string;
  id: string;
  linkedAt?: string | null;
  patientId: string;
  resourceReference: string;
  type: "document" | "encounter";
}

export interface AbdmReadinessInput {
  careContexts: AbdmCareContextProjection[];
  credentials: AbdmCredentials;
  evaluatedAt: string;
  featureFlags: AbdmFeatureFlags;
  officialActivation?: AbdmOfficialActivationEvidence | null;
  patient: AbdmPatientPosture;
}

export type AbdmConfigurationStatus =
  "disabled" | "not_configured" | "sandbox_configured_unapproved" | "sandbox_ready";
export type AbdmAvailabilityStatus = "sandbox_ready" | "simulator_ready" | "unavailable";
export type AbdmExchangeMode = "disabled" | "fixture_only" | "sandbox_only";
export type AbdmSubReadinessStatus =
  | "consent_required"
  | "disabled"
  | "no_care_contexts"
  | "not_configured"
  | "patient_not_linked"
  | "sandbox_ready"
  | "simulator_ready";

export interface AbdmReadinessResult {
  abhaLinking: {
    abhaAddressRecorded: boolean;
    consentActive: boolean;
    status: AbdmSubReadinessStatus;
  };
  availabilityStatus: AbdmAvailabilityStatus;
  careContextLinking: {
    linkedContexts: number;
    projectedContexts: number;
    status: AbdmSubReadinessStatus;
  };
  configurationStatus: AbdmConfigurationStatus;
  consentExchange: {
    activeConsentLogs: number;
    consentActive: boolean;
    status: AbdmSubReadinessStatus;
  };
  evaluatedAt: string;
  exchangeMode: AbdmExchangeMode;
  featureFlags: AbdmFeatureFlags;
  liveExchangeAllowed: false;
  missingCredentialKeys: AbdmCredentialKey[];
  notes: string[];
  simulatorOnly: boolean;
}

export interface AbdmReadinessLogSummary {
  abhaLinkingStatus: AbdmSubReadinessStatus;
  availabilityStatus: AbdmAvailabilityStatus;
  careContextCount: number;
  careContextLinkingStatus: AbdmSubReadinessStatus;
  configurationStatus: AbdmConfigurationStatus;
  consentExchangeStatus: AbdmSubReadinessStatus;
  evaluatedAt: string;
  exchangeMode: AbdmExchangeMode;
  liveExchangeAllowed: false;
  missingCredentialKeys: AbdmCredentialKey[];
  simulatorOnly: boolean;
}

export function evaluateAbdmReadiness(input: AbdmReadinessInput): AbdmReadinessResult {
  const missingCredentialKeys = missingAbdmCredentialKeys(input.credentials);
  const flags = input.featureFlags;
  const linkedContexts = input.careContexts.filter((context) =>
    Boolean(context.careContextReference)
  );
  const consentGrantedContexts = input.careContexts.filter(
    (context) => context.consentStatus === "granted"
  );

  if (!flags.abdmEnabled) {
    return {
      abhaLinking: {
        abhaAddressRecorded: Boolean(input.patient.abhaAddress),
        consentActive: input.patient.abhaConsentActive,
        status: "disabled"
      },
      availabilityStatus: "unavailable",
      careContextLinking: {
        linkedContexts: linkedContexts.length,
        projectedContexts: input.careContexts.length,
        status: "disabled"
      },
      configurationStatus: "disabled",
      consentExchange: {
        activeConsentLogs: consentGrantedContexts.length,
        consentActive: input.patient.dataExchangeConsentActive,
        status: "disabled"
      },
      evaluatedAt: input.evaluatedAt,
      exchangeMode: "disabled",
      featureFlags: flags,
      liveExchangeAllowed: false,
      missingCredentialKeys,
      notes: [
        "ABDM feature flag is disabled; ClinicOS FHIR projections remain local exchange artifacts."
      ],
      simulatorOnly: flags.simulatorMode
    };
  }

  const configured = missingCredentialKeys.length === 0;
  const sandboxReady =
    configured &&
    flags.sandboxActivationApproved === true &&
    isValidOfficialActivation(input.officialActivation ?? null);
  const configurationStatus: AbdmConfigurationStatus = !configured
    ? "not_configured"
    : sandboxReady
      ? "sandbox_ready"
      : "sandbox_configured_unapproved";
  const availabilityStatus: AbdmAvailabilityStatus = sandboxReady ? "sandbox_ready" : "unavailable";
  const exchangeMode: AbdmExchangeMode = sandboxReady ? "sandbox_only" : "fixture_only";

  return {
    abhaLinking: {
      abhaAddressRecorded: Boolean(input.patient.abhaAddress),
      consentActive: input.patient.abhaConsentActive,
      status: subStatus({
        configured,
        consentActive: input.patient.abhaConsentActive,
        enabled: flags.abhaLinkingEnabled,
        hasRecord: Boolean(input.patient.abhaAddress),
        sandboxReady,
        simulatorMode: flags.simulatorMode
      })
    },
    availabilityStatus,
    careContextLinking: {
      linkedContexts: linkedContexts.length,
      projectedContexts: input.careContexts.length,
      status: careContextStatus({
        configured,
        enabled: flags.careContextLinkingEnabled,
        projectedContexts: input.careContexts.length,
        sandboxReady,
        simulatorMode: flags.simulatorMode
      })
    },
    configurationStatus,
    consentExchange: {
      activeConsentLogs: consentGrantedContexts.length,
      consentActive: input.patient.dataExchangeConsentActive,
      status: consentExchangeStatus({
        configured,
        consentActive: input.patient.dataExchangeConsentActive,
        enabled: flags.consentExchangeEnabled,
        sandboxReady,
        simulatorMode: flags.simulatorMode
      })
    },
    evaluatedAt: input.evaluatedAt,
    exchangeMode,
    featureFlags: flags,
    liveExchangeAllowed: false,
    missingCredentialKeys,
    notes: readinessNotes(configurationStatus, availabilityStatus),
    simulatorOnly: !sandboxReady
  };
}

export function evaluateAbdmCapabilityBoundary(
  input: AbdmCapabilityBoundaryInput
): AbdmCapabilityBoundaryResult {
  if (!validIsoInstant(input.evaluatedAt)) {
    throw new Error(
      "ABDM capability evaluation requires an ISO timestamp with an explicit offset."
    );
  }
  if (!input.activation) {
    return {
      activationStatus: "unregistered",
      availability: "unavailable",
      evaluatedAt: input.evaluatedAt,
      igPackage: ABDM_PUBLISHED_FHIR_IG.packageSpec,
      liveExchangeAllowed: false,
      reason: "official_activation_absent",
      registered: false
    };
  }
  if (!isValidOfficialActivation(input.activation)) {
    return {
      activationStatus: "unregistered",
      availability: "unavailable",
      evaluatedAt: input.evaluatedAt,
      igPackage: ABDM_PUBLISHED_FHIR_IG.packageSpec,
      liveExchangeAllowed: false,
      reason: "official_activation_invalid",
      registered: false
    };
  }
  return {
    activationStatus: "sandbox_verified",
    availability: "sandbox_only",
    evaluatedAt: input.evaluatedAt,
    igPackage: ABDM_PUBLISHED_FHIR_IG.packageSpec,
    liveExchangeAllowed: false,
    reason: "sandbox_verified",
    registered: true
  };
}

export function missingAbdmCredentialKeys(credentials: AbdmCredentials): AbdmCredentialKey[] {
  return REQUIRED_ABDM_CREDENTIAL_KEYS.filter((key) => !credentials[key]?.trim());
}

export function redactAbdmReadinessForLogs(
  readiness: AbdmReadinessResult
): AbdmReadinessLogSummary {
  return {
    abhaLinkingStatus: readiness.abhaLinking.status,
    availabilityStatus: readiness.availabilityStatus,
    careContextCount: readiness.careContextLinking.projectedContexts,
    careContextLinkingStatus: readiness.careContextLinking.status,
    configurationStatus: readiness.configurationStatus,
    consentExchangeStatus: readiness.consentExchange.status,
    evaluatedAt: readiness.evaluatedAt,
    exchangeMode: readiness.exchangeMode,
    liveExchangeAllowed: false,
    missingCredentialKeys: [...readiness.missingCredentialKeys],
    simulatorOnly: readiness.simulatorOnly
  };
}

function subStatus(input: {
  configured: boolean;
  consentActive: boolean;
  enabled: boolean;
  hasRecord: boolean;
  sandboxReady: boolean;
  simulatorMode: boolean;
}): AbdmSubReadinessStatus {
  if (!input.enabled) return "disabled";
  if (!input.configured) return "not_configured";
  if (!input.consentActive) return "consent_required";
  if (!input.hasRecord) return "patient_not_linked";
  if (input.sandboxReady) return "sandbox_ready";
  return input.simulatorMode ? "simulator_ready" : "not_configured";
}

function careContextStatus(input: {
  configured: boolean;
  enabled: boolean;
  projectedContexts: number;
  sandboxReady: boolean;
  simulatorMode: boolean;
}): AbdmSubReadinessStatus {
  if (!input.enabled) return "disabled";
  if (!input.configured) return "not_configured";
  if (input.projectedContexts === 0) return "no_care_contexts";
  if (input.sandboxReady) return "sandbox_ready";
  return input.simulatorMode ? "simulator_ready" : "not_configured";
}

function consentExchangeStatus(input: {
  configured: boolean;
  consentActive: boolean;
  enabled: boolean;
  sandboxReady: boolean;
  simulatorMode: boolean;
}): AbdmSubReadinessStatus {
  if (!input.enabled) return "disabled";
  if (!input.configured) return "not_configured";
  if (!input.consentActive) return "consent_required";
  if (input.sandboxReady) return "sandbox_ready";
  return input.simulatorMode ? "simulator_ready" : "not_configured";
}

function readinessNotes(
  configurationStatus: AbdmConfigurationStatus,
  availabilityStatus: AbdmAvailabilityStatus
): string[] {
  if (configurationStatus === "not_configured") {
    return [
      "ABDM credentials are absent; do not call live ABDM endpoints.",
      "FHIR projections and ABDM care-context posture are fixture/simulator-only until credentials and approvals exist."
    ];
  }
  if (configurationStatus === "sandbox_configured_unapproved") {
    return [
      "ABDM credential fields are present, but sandbox activation approval is not recorded.",
      "Keep exchange unavailable except for explicit sandbox readiness checks."
    ];
  }
  if (availabilityStatus === "sandbox_ready") {
    return [
      "ABDM sandbox readiness is present, but live patient exchange remains disabled until compliance activation."
    ];
  }
  return ["ABDM exchange is unavailable."];
}

function isValidOfficialActivation(
  activation: AbdmOfficialActivationEvidence | null
): activation is AbdmOfficialActivationEvidence {
  return Boolean(
    activation &&
    activation.environment === "sandbox" &&
    activation.status === "sandbox_verified" &&
    activation.igPackage === ABDM_PUBLISHED_FHIR_IG.packageSpec &&
    /^[A-Za-z0-9._:-]{8,128}$/u.test(activation.registrationId) &&
    /^[A-Za-z0-9._:-]{8,128}$/u.test(activation.sandboxEvidenceId) &&
    /^[A-Za-z0-9._:-]{8,128}$/u.test(activation.validatorEvidenceId) &&
    validIsoInstant(activation.registeredAt) &&
    validIsoInstant(activation.verifiedAt)
  );
}

function validIsoInstant(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}
