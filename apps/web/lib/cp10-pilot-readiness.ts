export type Cp10ReadinessSource = "api" | "cp10_fixture";

export type Cp10PilotReadinessStatus = "ready" | "unavailable" | "deferred" | "blocked";

export type Cp10PilotReadinessCategory =
  | "clinic_setup"
  | "workflow"
  | "provider"
  | "data_migration"
  | "operations"
  | "security_compliance"
  | "training";

export interface Cp10PilotReadinessItem {
  activationPath: string[];
  category: Cp10PilotReadinessCategory;
  evidence: string;
  externalBlocker: boolean;
  id: string;
  label: string;
  routeContracts: string[];
  status: Cp10PilotReadinessStatus;
}

export interface Cp10PilotReadinessSummary {
  blocked: number;
  deferred: number;
  ready: number;
  total: number;
  unavailable: number;
}

export interface Cp10PilotReadinessPlan {
  clinicId?: string;
  clinicName: string;
  environment: string;
  generatedAt: string;
  items: Cp10PilotReadinessItem[];
  liveVerificationGaps: Cp10PilotReadinessItem[];
  localConfigurationStatus: Cp10PilotReadinessStatus;
  pilotGoLiveStatus: Cp10PilotReadinessStatus;
  safety: {
    noLiveProviderActivation: boolean;
    noRealPhi: boolean;
    noSecretValues: boolean;
    syntheticOnly: boolean;
  };
  schemaVersion: "cp10.pilot_readiness.v1";
  source: Cp10ReadinessSource;
  summary: Cp10PilotReadinessSummary;
  tenantId?: string;
}

export type Cp10ProblemCode =
  | "AUTH_REQUIRED"
  | "CONTRACT_MISMATCH"
  | "CP10_ENDPOINT_NOT_REGISTERED"
  | "NETWORK_UNAVAILABLE"
  | "SERVER_ERROR"
  | "UNKNOWN";

export interface Cp10EndpointIssue {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export interface Cp10PilotReadinessProblem {
  code: Cp10ProblemCode;
  detail?: string;
  endpoints: Cp10EndpointIssue[];
  message: string;
}

export type Cp10PilotReadinessLoadState =
  | { data: Cp10PilotReadinessPlan; status: "ready" }
  | { problem: Cp10PilotReadinessProblem; status: "unavailable" };

interface EndpointResponse {
  payload: unknown;
  requestId?: string;
  status: number;
}

interface EndpointFailure extends Cp10EndpointIssue {
  isEndpointFailure: true;
}

export const CP10_REQUIRED_ENDPOINTS = ["GET /v1/pilot-readiness"] as const;

export const CP10_STATUS_LABELS: Record<Cp10PilotReadinessStatus, string> = {
  blocked: "Blocked",
  deferred: "Deferred",
  ready: "Ready",
  unavailable: "Unavailable"
};

export const CP10_CATEGORY_LABELS: Record<Cp10PilotReadinessCategory, string> = {
  clinic_setup: "Clinic setup",
  data_migration: "Data migration",
  operations: "Operations",
  provider: "Provider",
  security_compliance: "Security and compliance",
  training: "Training",
  workflow: "Workflow"
};

const FIXTURE_ENVIRONMENTS = new Set(["development", "dev", "local", "test"]);

export function getCp10TodayInputValue(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function isCp10FixtureAllowed() {
  const fixtureRequested =
    process.env.NEXT_PUBLIC_CLINIC_OS_USE_CP10_PILOT_FIXTURE === "true";
  const environment = process.env.NEXT_PUBLIC_CLINIC_OS_ENV ?? process.env.NODE_ENV;

  return fixtureRequested && FIXTURE_ENVIRONMENTS.has(environment);
}

export function createFixtureCp10PilotReadinessPlan(
  today = getCp10TodayInputValue()
): Cp10PilotReadinessPlan {
  const generatedAt = `${today}T11:00:00+05:30`;
  const items: Cp10PilotReadinessItem[] = [
    item({
      category: "clinic_setup",
      evidence: "Synthetic Dental Clinic is the active local pilot context.",
      id: "clinic-profile",
      label: "Pilot clinic profile",
      routeContracts: ["GET /v1/me"],
      status: "ready"
    }),
    item({
      category: "clinic_setup",
      evidence: "Pilot evidence is synthetic-only and safe for local QA, screenshots, and training.",
      id: "synthetic-data-posture",
      label: "No-real-PHI pilot data posture",
      routeContracts: [],
      status: "ready"
    }),
    item({
      category: "data_migration",
      evidence: "Synthetic patient and appointment export paths are configured for local CP10.",
      id: "patient-appointment-import-inputs",
      label: "Patient and appointment import inputs",
      routeContracts: [
        "POST /v1/migration-batches",
        "GET /v1/migration-batches/{migrationBatchId}",
        "POST /v1/migration-batches/{migrationBatchId}/rows/{rowId}/resolve"
      ],
      status: "ready"
    }),
    item({
      category: "clinic_setup",
      evidence: "Synthetic pricebook input path is configured.",
      id: "pricebook-configuration",
      label: "Pricebook configuration",
      routeContracts: ["GET /v1/pricebook/procedures"],
      status: "ready"
    }),
    item({
      category: "training",
      evidence: "Synthetic consent, post-op, recall, and payment templates are configured.",
      id: "template-configuration",
      label: "Template configuration",
      routeContracts: ["GET /v1/form-templates", "POST /v1/patients/{patientId}/instructions"],
      status: "ready"
    }),
    item({
      category: "workflow",
      evidence:
        "CP2-CP9 workflow evidence is available for the implemented dental-first clinic day.",
      id: "workflow-full-clinic-day",
      label: "Full clinic-day implemented workflow chain",
      routeContracts: [
        "GET /v1/leads",
        "POST /v1/patients/{patientId}/dental-findings",
        "POST /v1/invoices",
        "GET /v1/owner-dashboard"
      ],
      status: "ready"
    }),
    item({
      category: "provider",
      evidence:
        "WhatsApp sandbox values may exist locally, but hosted signed webhook registration is not configured.",
      externalBlocker: true,
      id: "provider-whatsapp",
      label: "WhatsApp messaging activation",
      routeContracts: ["POST /v1/webhooks/whatsapp/{accountId}", "GET /v1/provider-health"],
      status: "blocked"
    }),
    item({
      category: "provider",
      evidence:
        "Razorpay sandbox credentials may exist locally, but provider-paid state requires a signed HTTPS callback.",
      externalBlocker: true,
      id: "provider-razorpay",
      label: "Razorpay payment activation",
      routeContracts: ["POST /v1/payment-webhooks/razorpay", "GET /v1/provider-health"],
      status: "blocked"
    }),
    item({
      category: "provider",
      evidence: "Telephony/missed-call capture remains deferred until an official provider is configured.",
      externalBlocker: true,
      id: "provider-telephony",
      label: "Telephony/missed-call activation",
      routeContracts: ["Provider-signed telephony callback route", "GET /v1/provider-health"],
      status: "deferred"
    }),
    item({
      category: "provider",
      evidence: "Live AI and transcription remain deferred until provider, retention, and residency approval.",
      externalBlocker: true,
      id: "provider-ai-scribe",
      label: "Live AI/transcription activation",
      routeContracts: [
        "POST /v1/encounters/{encounterId}/ai-scribe/sessions",
        "POST /v1/ai-scribe/sessions/{sessionId}/review-decisions"
      ],
      status: "deferred"
    }),
    item({
      category: "operations",
      evidence: "Terraform apply and cloud resource creation are not verified in local CP10 evidence.",
      externalBlocker: true,
      id: "ops-cloud-pilot-prod",
      label: "AWS pilot-prod deployment",
      routeContracts: ["Terraform validation profile", "Restore dry-run evidence"],
      status: "blocked"
    }),
    item({
      category: "operations",
      evidence: "Synthetic restore dry-run evidence exists; live restore remains external.",
      externalBlocker: true,
      id: "ops-backup-restore",
      label: "Backup and restore readiness",
      routeContracts: ["scripts/cp9-restore-drill.mjs --dry-run"],
      status: "deferred"
    }),
    item({
      category: "operations",
      evidence: "Physical-device smoke is an external verification gap.",
      externalBlocker: true,
      id: "ops-physical-device",
      label: "Physical-device mobile verification",
      routeContracts: ["Expo/mobile capture app checks"],
      status: "deferred"
    })
  ];
  const summary = summarize(items);

  return {
    clinicId: "synthetic-clinic",
    clinicName: "Synthetic Dental Clinic",
    environment: "local",
    generatedAt,
    items,
    liveVerificationGaps: items.filter(
      (candidate) => candidate.externalBlocker || candidate.status === "blocked"
    ),
    localConfigurationStatus: "ready",
    pilotGoLiveStatus: "blocked",
    safety: {
      noLiveProviderActivation: true,
      noRealPhi: true,
      noSecretValues: true,
      syntheticOnly: true
    },
    schemaVersion: "cp10.pilot_readiness.v1",
    source: "cp10_fixture",
    summary,
    tenantId: "synthetic-tenant"
  };
}

export async function loadCp10PilotReadiness(
  signal?: AbortSignal,
  today = getCp10TodayInputValue()
): Promise<Cp10PilotReadinessLoadState> {
  if (isCp10FixtureAllowed()) {
    return {
      data: createFixtureCp10PilotReadinessPlan(today),
      status: "ready"
    };
  }

  try {
    return await loadLiveCp10PilotReadiness(signal);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    const failure = isEndpointFailure(error)
      ? error
      : {
          endpoint: "FETCH /v1/pilot-readiness",
          message: error instanceof Error ? error.message : "Network unavailable",
          status: 0
        };

    return {
      problem: classifyCp10EndpointFailures([failure]),
      status: "unavailable"
    };
  }
}

export async function loadLiveCp10PilotReadiness(
  signal?: AbortSignal
): Promise<Cp10PilotReadinessLoadState> {
  const response = await fetchEndpoint("/v1/pilot-readiness", signal);
  const normalized = normalizeCp10ReadinessPayload(response.payload);

  if ("code" in normalized) {
    return {
      problem: normalized,
      status: "unavailable"
    };
  }

  return {
    data: {
      ...normalized,
      source: "api"
    },
    status: "ready"
  };
}

export function classifyCp10EndpointFailures(
  failures: readonly Cp10EndpointIssue[]
): Cp10PilotReadinessProblem {
  const first = failures[0];
  const endpoints = failures.length > 0 ? [...failures] : [];

  if (failures.some((failure) => failure.status === 401 || failure.status === 403)) {
    return {
      code: "AUTH_REQUIRED",
      endpoints,
      message: "Sign in as an owner before opening pilot readiness."
    };
  }

  if (failures.some((failure) => failure.status === 404)) {
    return {
      code: "CP10_ENDPOINT_NOT_REGISTERED",
      endpoints,
      message:
        "The CP10 pilot readiness endpoint is not registered in this environment. Check route registration and official activation before debugging permissions or runtime state."
    };
  }

  if (failures.some((failure) => (failure.status ?? 0) >= 500)) {
    return {
      code: "SERVER_ERROR",
      endpoints,
      message: "The ClinicOS API is reachable but pilot readiness could not be loaded."
    };
  }

  if (failures.some((failure) => failure.status === 0)) {
    return {
      code: "NETWORK_UNAVAILABLE",
      detail: first?.message,
      endpoints,
      message: "The ClinicOS API could not be reached for pilot readiness."
    };
  }

  return {
    code: "UNKNOWN",
    detail: first?.message,
    endpoints,
    message: "Pilot readiness returned an unexpected response."
  };
}

function item(
  input: Omit<Cp10PilotReadinessItem, "activationPath" | "externalBlocker"> & {
    activationPath?: string[];
    externalBlocker?: boolean;
  }
): Cp10PilotReadinessItem {
  const inferredExternalBlocker =
    input.status === "blocked" ||
    input.status === "deferred" ||
    input.status === "unavailable";

  return {
    activationPath: input.activationPath ?? [
      "Keep evidence aligned with the canonical CP10 readiness contract."
    ],
    category: input.category,
    evidence: input.evidence,
    externalBlocker: input.externalBlocker ?? inferredExternalBlocker,
    id: input.id,
    label: input.label,
    routeContracts: input.routeContracts,
    status: input.status
  };
}

function summarize(items: readonly Cp10PilotReadinessItem[]): Cp10PilotReadinessSummary {
  return items.reduce<Cp10PilotReadinessSummary>(
    (summary, readinessItem) => ({
      ...summary,
      [readinessItem.status]: summary[readinessItem.status] + 1,
      total: summary.total + 1
    }),
    { blocked: 0, deferred: 0, ready: 0, total: 0, unavailable: 0 }
  );
}

function getApiBaseUrl() {
  return process.env.NEXT_PUBLIC_CLINIC_OS_API_BASE_URL ?? "";
}

function buildUrl(path: string) {
  const baseUrl = getApiBaseUrl().replace(/\/$/, "");
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

async function fetchEndpoint(path: string, signal?: AbortSignal): Promise<EndpointResponse> {
  const response = await fetch(buildUrl(path), {
    credentials: "include",
    headers: {
      Accept: "application/json"
    },
    signal
  });
  const payload = await parseJsonSafely(response);
  const requestId = requestIdFrom(response, payload);

  if (!response.ok) {
    throw {
      endpoint: `GET ${path}`,
      isEndpointFailure: true,
      message: errorMessageFrom(payload) ?? response.statusText,
      requestId,
      status: response.status
    } satisfies EndpointFailure;
  }

  return {
    payload,
    requestId,
    status: response.status
  };
}

function normalizeCp10ReadinessPayload(
  payload: unknown
): Cp10PilotReadinessPlan | Cp10PilotReadinessProblem {
  if (!isRecord(payload) || !isRecord(payload.readiness)) {
    return {
      code: "CONTRACT_MISMATCH",
      endpoints: [{ endpoint: "GET /v1/pilot-readiness", message: "Missing readiness object." }],
      message: "Pilot readiness did not return the CP10 readiness contract."
    };
  }

  const readiness = payload.readiness;
  if (
    readiness.schemaVersion !== "cp10.pilot_readiness.v1" ||
    !Array.isArray(readiness.items) ||
    !isRecord(readiness.summary) ||
    !isRecord(readiness.safety)
  ) {
    return {
      code: "CONTRACT_MISMATCH",
      endpoints: [
        { endpoint: "GET /v1/pilot-readiness", message: "Unexpected readiness schema." }
      ],
      message: "Pilot readiness is reachable but does not match the CP10 schema."
    };
  }

  return readiness as unknown as Cp10PilotReadinessPlan;
}

async function parseJsonSafely(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return null;
  return response.json() as Promise<unknown>;
}

function requestIdFrom(response: Response, payload: unknown) {
  if (!isRecord(payload)) return response.headers.get("x-request-id") ?? undefined;

  const topLevel = readString(payload, ["requestId", "request_id"]);
  const error = isRecord(payload.error) ? payload.error : null;
  const nested = error ? readString(error, ["requestId", "request_id"]) : null;

  return topLevel ?? nested ?? response.headers.get("x-request-id") ?? undefined;
}

function errorMessageFrom(payload: unknown) {
  if (!isRecord(payload)) return null;
  if (typeof payload.message === "string") return payload.message;
  if (isRecord(payload.error) && typeof payload.error.message === "string") {
    return payload.error.message;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) return value;
  }
  return null;
}

function isEndpointFailure(value: unknown): value is EndpointFailure {
  return isRecord(value) && value.isEndpointFailure === true;
}
