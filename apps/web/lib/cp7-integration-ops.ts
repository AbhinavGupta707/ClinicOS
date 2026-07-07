export type Cp7IntegrationOpsSource = "api" | "cp7_fixture";

export type ProviderHealthStatus = "available" | "degraded" | "not_configured" | "unavailable";
export type CapabilityStatus = "available" | "degraded" | "unavailable";

export type Cp7ProviderKey =
  | "exotel"
  | "google_business_profile"
  | "manual_import"
  | "razorpay"
  | "whatsapp_cloud";

export interface ProviderCapability {
  detail: string;
  key: string;
  label: string;
  status: CapabilityStatus;
}

export interface ProviderHealthCard {
  activationChecks: string[];
  capabilities: ProviderCapability[];
  category: "messaging" | "migration" | "payments" | "source" | "telephony";
  checkedAt: string;
  evidence: string;
  id: string;
  label: string;
  mode: string;
  providerKey: Cp7ProviderKey;
  status: ProviderHealthStatus;
}

export type DeadLetterStatus = "blocked" | "ignored" | "replayed" | "replay_requested" | "unreviewed";

export interface DeadLetterEvent {
  attempts: number;
  eventType: string;
  failedAt: string;
  id: string;
  lastError: string;
  outcomeDetail: string;
  providerKey: Cp7ProviderKey;
  replayAvailable: boolean;
  replayBlockedReason?: string;
  replayedAt?: string;
  status: DeadLetterStatus;
}

export type MigrationBatchStatus =
  | "committed"
  | "failed"
  | "needs_review"
  | "ready_to_commit"
  | "uploaded"
  | "validated";

export type MigrationRowStatus = "committed" | "conflict" | "ready_to_commit" | "rejected" | "valid";
export type MigrationConflictStatus = "resolved" | "unresolved";

export interface MigrationRow {
  externalReference: string;
  id: string;
  issue?: string;
  preview: string;
  rowNumber: number;
  status: MigrationRowStatus;
  target: "appointment" | "invoice" | "patient";
}

export interface MigrationConflict {
  candidateSummary: string;
  id: string;
  resolution?: "keep_existing_verified_record" | "import_as_unverified";
  rowId: string;
  status: MigrationConflictStatus;
  type: "possible_duplicate" | "verified_record_conflict";
}

export interface MigrationCommitState {
  blockedReason?: string;
  committedAt?: string;
  committedRows: number;
  state: "blocked" | "committed" | "ready" | "unavailable";
}

export interface MigrationBatch {
  commit: MigrationCommitState;
  conflicts: MigrationConflict[];
  id: string;
  rows: MigrationRow[];
  sourceSystem: "ray_csv_export" | "synthetic_csv";
  status: MigrationBatchStatus;
  uploadedAt: string;
}

export interface Cp7TimelineItem {
  at: string;
  detail: string;
  id: string;
  kind:
    | "dead_letter.replayed"
    | "migration.batch_committed"
    | "migration.conflict_resolved"
    | "provider.health_checked";
  title: string;
}

export interface Cp7Readiness {
  googleSource: "manual_source_only" | "provider_unavailable";
  migrationCommit: "blocked_review_required" | "committed" | "ready_to_commit";
  razorpayWebhook: "webhook_url_missing" | "verified_callback_ready";
  replay: "backend_route_unavailable" | "fixture_review_only" | "ready";
  telephony: "manual_entry_only" | "provider_unavailable";
  whatsapp: "configured_degraded" | "not_configured";
}

export interface Cp7IntegrationOpsData {
  api?: {
    environment?: string;
    requestIds: string[];
  };
  deadLetters: DeadLetterEvent[];
  migrationBatches: MigrationBatch[];
  providers: ProviderHealthCard[];
  readiness: Cp7Readiness;
  source: Cp7IntegrationOpsSource;
  timeline: Cp7TimelineItem[];
  today: string;
}

export type Cp7ProblemCode =
  | "AUTH_REQUIRED"
  | "CONTRACT_MISMATCH"
  | "CP7_ENDPOINT_NOT_REGISTERED"
  | "NETWORK_UNAVAILABLE"
  | "SERVER_ERROR"
  | "UNKNOWN";

export interface Cp7EndpointIssue {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export interface Cp7IntegrationOpsProblem {
  code: Cp7ProblemCode;
  detail?: string;
  endpoints: Cp7EndpointIssue[];
  message: string;
}

export type Cp7IntegrationOpsLoadState =
  | { data: Cp7IntegrationOpsData; status: "ready" }
  | { problem: Cp7IntegrationOpsProblem; status: "unavailable" };

interface EndpointResponse {
  payload: unknown;
  requestId?: string;
  status: number;
}

interface EndpointFailure extends Cp7EndpointIssue {
  isEndpointFailure: true;
}

export const CP7_REQUIRED_ENDPOINTS = [
  "GET /v1/provider-health",
  "GET /v1/dead-letter-events?status=unreviewed",
  "POST /v1/dead-letter-events/{deadLetterEventId}/replay",
  "GET /v1/migration-batches?status=needs_review",
  "GET /v1/migration-batches/{migrationBatchId}",
  "POST /v1/migration-batches/{migrationBatchId}/conflicts/{conflictId}/resolve",
  "POST /v1/migration-batches/{migrationBatchId}/commit"
] as const;

export const PROVIDER_STATUS_LABELS: Record<ProviderHealthStatus, string> = {
  available: "Available",
  degraded: "Degraded",
  not_configured: "Not configured",
  unavailable: "Unavailable"
};

export const CAPABILITY_STATUS_LABELS: Record<CapabilityStatus, string> = {
  available: "Available",
  degraded: "Degraded",
  unavailable: "Unavailable"
};

export const MIGRATION_BATCH_STATUS_LABELS: Record<MigrationBatchStatus, string> = {
  committed: "Committed",
  failed: "Failed",
  needs_review: "Needs review",
  ready_to_commit: "Ready to commit",
  uploaded: "Uploaded",
  validated: "Validated"
};

export const DEAD_LETTER_STATUS_LABELS: Record<DeadLetterStatus, string> = {
  blocked: "Blocked",
  ignored: "Ignored",
  replay_requested: "Replay requested",
  replayed: "Replayed",
  unreviewed: "Unreviewed"
};

const FIXTURE_ENVIRONMENTS = new Set(["development", "dev", "local", "test"]);

export function getCp7TodayInputValue(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function isCp7FixtureAllowed() {
  const fixtureRequested =
    process.env.NEXT_PUBLIC_CLINIC_OS_USE_CP7_INTEGRATION_OPS_FIXTURE === "true";
  const environment = process.env.NEXT_PUBLIC_CLINIC_OS_ENV ?? process.env.NODE_ENV;

  return fixtureRequested && FIXTURE_ENVIRONMENTS.has(environment);
}

export function createFixtureCp7IntegrationOpsData(
  today = getCp7TodayInputValue()
): Cp7IntegrationOpsData {
  const checkedAt = `${today}T10:15:00+05:30`;

  return {
    api: {
      environment: "local synthetic CP7 fixture",
      requestIds: ["fixture-cp7-integration-ops"]
    },
    deadLetters: [
      {
        attempts: 3,
        eventType: "whatsapp.status.webhook.normalization_failed",
        failedAt: `${today}T09:40:00+05:30`,
        id: "cp7DeadLetterWhatsappStatus",
        lastError: "Status webhook could not be trusted because signed callback verification is not active.",
        outcomeDetail:
          "Replay can be requested in this local fixture, but no patient message status is advanced.",
        providerKey: "whatsapp_cloud",
        replayAvailable: true,
        status: "unreviewed"
      },
      {
        attempts: 5,
        eventType: "telephony.missed_call.provider_event",
        failedAt: `${today}T08:55:00+05:30`,
        id: "cp7DeadLetterTelephonyUnavailable",
        lastError: "Telephony provider account is unavailable; no callback route is registered.",
        outcomeDetail:
          "Manual missed-call entry remains the only supported recovery path until provider setup exists.",
        providerKey: "exotel",
        replayAvailable: false,
        replayBlockedReason: "Telephony provider credentials and callback registration are missing.",
        status: "blocked"
      }
    ],
    migrationBatches: [
      {
        commit: {
          blockedReason: "Resolve duplicate review before committing.",
          committedRows: 0,
          state: "blocked"
        },
        conflicts: [
          {
            candidateSummary: "Existing verified ClinicOS patient with same phone; keep existing record.",
            id: "cp7ConflictDuplicatePatient",
            rowId: "cp7MigrationRowDuplicatePatient",
            status: "unresolved",
            type: "possible_duplicate"
          }
        ],
        id: "cp7MigrationBatchRayPatients",
        rows: [
          {
            externalReference: "ray-patient-001",
            id: "cp7MigrationRowNewPatient",
            preview: "Synthetic imported patient, phone ending 7001, marked unverified until reviewed.",
            rowNumber: 2,
            status: "valid",
            target: "patient"
          },
          {
            externalReference: "ray-patient-002",
            id: "cp7MigrationRowDuplicatePatient",
            issue: "Possible duplicate of a verified ClinicOS patient.",
            preview: "Synthetic duplicate candidate, phone ending 7002.",
            rowNumber: 3,
            status: "conflict",
            target: "patient"
          },
          {
            externalReference: "ray-patient-003",
            id: "cp7MigrationRowRejectedPatient",
            issue: "Missing required phone number and consent provenance.",
            preview: "Rejected synthetic row with incomplete contact fields.",
            rowNumber: 4,
            status: "rejected",
            target: "patient"
          }
        ],
        sourceSystem: "ray_csv_export",
        status: "needs_review",
        uploadedAt: `${today}T08:30:00+05:30`
      }
    ],
    providers: [
      {
        activationChecks: [
          "Meta Cloud sandbox identifiers and access token are present in local preflight.",
          "Hosted webhook URL and signed callback verification still need the deployment surface.",
          "Live outbound smoke must stay behind the explicit CP7 live-send flag."
        ],
        capabilities: [
          {
            detail: "Template send is sandbox-capable after provider adapter merge; this UI does not claim a live send.",
            key: "outbound_templates",
            label: "Outbound templates",
            status: "degraded"
          },
          {
            detail: "Inbound/status events require verified webhook callback registration.",
            key: "delivery_status",
            label: "Inbound and delivery status",
            status: "degraded"
          },
          {
            detail: "Opt-out enforcement belongs at provider boundary and must be contract-tested before live use.",
            key: "opt_out_enforcement",
            label: "Opt-out enforcement",
            status: "degraded"
          }
        ],
        category: "messaging",
        checkedAt,
        evidence:
          "WhatsApp is configured/degraded: sandbox credentials exist, but this local web lane has no deployed verified callback.",
        id: "whatsapp-cloud",
        label: "WhatsApp Cloud",
        mode: "configured/degraded",
        providerKey: "whatsapp_cloud",
        status: "degraded"
      },
      {
        activationChecks: [
          "Razorpay sandbox key and webhook secret are present from CP5/CP7 preflight.",
          "RAZORPAY_WEBHOOK_URL is empty, so provider-paid state still needs a verified HTTPS callback.",
          "CP7 only displays health; CP5 payment reconciliation remains the payment source of truth."
        ],
        capabilities: [
          {
            detail: "Payment links and QR requests are covered by the CP5 provider contract.",
            key: "payment_links",
            label: "Payment links and QR",
            status: "available"
          },
          {
            detail: "Signed webhook processing exists, but hosted callback registration is missing.",
            key: "receive_webhooks",
            label: "Receive webhooks",
            status: "degraded"
          }
        ],
        category: "payments",
        checkedAt,
        evidence: "Razorpay webhook URL missing; no payment is marked paid from this dashboard.",
        id: "razorpay",
        label: "Razorpay",
        mode: "sandbox webhook URL missing",
        providerKey: "razorpay",
        status: "degraded"
      },
      {
        activationChecks: [
          "Exotel-style account SID, API key, token, and callback secret are empty.",
          "Live missed-call capture is hidden until provider registration exists.",
          "Clinic-approved manual missed-call capture remains the safe fallback."
        ],
        capabilities: [
          {
            detail: "No telephony account/callback is configured.",
            key: "missed_calls",
            label: "Missed-call capture",
            status: "unavailable"
          },
          {
            detail: "No recording links are accepted without a configured, permissioned provider.",
            key: "call_recordings",
            label: "Call recordings",
            status: "unavailable"
          }
        ],
        category: "telephony",
        checkedAt,
        evidence: "Telephony unavailable; do not show live missed-call capture as active.",
        id: "telephony-exotel",
        label: "Telephony",
        mode: "provider unavailable",
        providerKey: "exotel",
        status: "unavailable"
      },
      {
        activationChecks: [
          "Google Business Profile OAuth/account variables are not configured.",
          "Manual Google source attribution is allowed and remains ClinicOS-owned.",
          "No Google API read/write dependency is active."
        ],
        capabilities: [
          {
            detail: "Manual source detail and external reference can be captured without Google API access.",
            key: "manual_source",
            label: "Manual source attribution",
            status: "available"
          },
          {
            detail: "Business Profile API access is not configured.",
            key: "google_business_profile_api",
            label: "Google Business Profile API",
            status: "unavailable"
          }
        ],
        category: "source",
        checkedAt,
        evidence: "Google is manual/source only; no live profile API dependency is active.",
        id: "google-business",
        label: "Google Business Profile",
        mode: "manual/source only",
        providerKey: "google_business_profile",
        status: "not_configured"
      },
      {
        activationChecks: [
          "Synthetic CSV path is local/test only.",
          "Rows are marked imported/unverified until review.",
          "Verified ClinicOS records are never overwritten silently."
        ],
        capabilities: [
          {
            detail: "CSV review is available in the CP7 fixture and must map to durable migration routes when merged.",
            key: "csv_review",
            label: "CSV review",
            status: "available"
          },
          {
            detail: "Commit is blocked until duplicate conflicts are resolved.",
            key: "reviewed_commit",
            label: "Reviewed commit",
            status: "degraded"
          }
        ],
        category: "migration",
        checkedAt,
        evidence: "Migration fixture path is available for review and commit safety checks.",
        id: "manual-import",
        label: "Manual import",
        mode: "local fixture review",
        providerKey: "manual_import",
        status: "degraded"
      }
    ],
    readiness: {
      googleSource: "manual_source_only",
      migrationCommit: "blocked_review_required",
      razorpayWebhook: "webhook_url_missing",
      replay: "fixture_review_only",
      telephony: "provider_unavailable",
      whatsapp: "configured_degraded"
    },
    source: "cp7_fixture",
    timeline: [
      {
        at: checkedAt,
        detail:
          "Provider dashboard recorded configured, degraded, unavailable, and manual/source-only states without live success claims.",
        id: "cp7-provider-health-checked",
        kind: "provider.health_checked",
        title: "Provider capability review"
      }
    ],
    today
  };
}

export async function loadCp7IntegrationOps(
  signal?: AbortSignal,
  today = getCp7TodayInputValue()
): Promise<Cp7IntegrationOpsLoadState> {
  if (isCp7FixtureAllowed()) {
    return {
      data: createFixtureCp7IntegrationOpsData(today),
      status: "ready"
    };
  }

  try {
    return await loadLiveCp7IntegrationOps(signal, today);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    const failure = isEndpointFailure(error)
      ? error
      : {
          endpoint: "FETCH /v1/provider-health",
          message: error instanceof Error ? error.message : "Network unavailable",
          status: 0
        };

    return {
      problem: classifyCp7EndpointFailures([failure]),
      status: "unavailable"
    };
  }
}

export async function loadLiveCp7IntegrationOps(
  signal?: AbortSignal,
  today = getCp7TodayInputValue()
): Promise<Cp7IntegrationOpsLoadState> {
  const results = await Promise.allSettled([
    fetchEndpoint("/v1/provider-health", {}, signal),
    fetchEndpoint("/v1/dead-letter-events", { status: "unreviewed" }, signal),
    fetchEndpoint("/v1/migration-batches", { status: "needs_review" }, signal)
  ]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason)
    .map((reason): Cp7EndpointIssue =>
      isEndpointFailure(reason)
        ? reason
        : {
            endpoint: "FETCH /v1/provider-health",
            message: reason instanceof Error ? reason.message : "Network unavailable",
            status: 0
          }
    );

  if (failures.length > 0) {
    return {
      problem: classifyCp7EndpointFailures(failures),
      status: "unavailable"
    };
  }

  const fulfilledResponses = results.map((result) => {
    if (result.status !== "fulfilled") {
      throw new Error("Unexpected CP7 endpoint result state.");
    }
    return result.value;
  });
  const providerResponse = fulfilledResponses[0];
  const deadLetterResponse = fulfilledResponses[1];
  const migrationResponse = fulfilledResponses[2];

  if (!providerResponse || !deadLetterResponse || !migrationResponse) {
    throw new Error("CP7 endpoint result missing after route checks.");
  }

  const normalized = normalizeCp7LivePayload({
    deadLettersPayload: deadLetterResponse.payload,
    migrationPayload: migrationResponse.payload,
    providerPayload: providerResponse.payload,
    requestIds: [
      providerResponse.requestId,
      deadLetterResponse.requestId,
      migrationResponse.requestId
    ].filter((requestId): requestId is string => Boolean(requestId)),
    today
  });

  if ("code" in normalized) {
    return {
      problem: normalized,
      status: "unavailable"
    };
  }

  return {
    data: normalized,
    status: "ready"
  };
}

export function applyFixtureReplayDeadLetter(
  data: Cp7IntegrationOpsData,
  input: { actorName: string; deadLetterEventId: string; reason: string }
): Cp7IntegrationOpsData {
  const event = data.deadLetters.find((candidate) => candidate.id === input.deadLetterEventId);
  if (!event) {
    throw new Error("Select a failed event before replay.");
  }
  if (!event.replayAvailable) {
    throw new Error(event.replayBlockedReason ?? "Replay is not available for this event.");
  }

  const replayedAt = new Date().toISOString();

  return {
    ...data,
    deadLetters: data.deadLetters.map((candidate) =>
      candidate.id === input.deadLetterEventId
        ? {
            ...candidate,
            attempts: candidate.attempts + 1,
            outcomeDetail:
              "Replay request was recorded in the local fixture; no provider-confirmed patient message state was created.",
            replayedAt,
            status: "replayed" as const
          }
        : candidate
    ),
    readiness: {
      ...data.readiness,
      replay: "fixture_review_only"
    },
    timeline: prependTimeline(
      data.timeline,
      "dead_letter.replayed",
      "Dead-letter replay reviewed",
      `${input.actorName} requested fixture replay for ${event.eventType}; provider success is still unconfirmed.`,
      replayedAt
    )
  };
}

export function applyFixtureResolveMigrationConflict(
  data: Cp7IntegrationOpsData,
  input: {
    actorName: string;
    batchId: string;
    conflictId: string;
    resolution: MigrationConflict["resolution"];
  }
): Cp7IntegrationOpsData {
  const batch = data.migrationBatches.find((candidate) => candidate.id === input.batchId);
  if (!batch) {
    throw new Error("Select a migration batch before resolving conflicts.");
  }
  const conflict = batch.conflicts.find((candidate) => candidate.id === input.conflictId);
  if (!conflict) {
    throw new Error("Select an unresolved conflict before resolving it.");
  }

  const resolvedAt = new Date().toISOString();
  const updatedBatches = data.migrationBatches.map((candidate) => {
    if (candidate.id !== input.batchId) return candidate;

    const conflicts = candidate.conflicts.map((item) =>
      item.id === input.conflictId
        ? {
            ...item,
            resolution: input.resolution,
            status: "resolved" as const
          }
        : item
    );
    const hasOpenConflicts = conflicts.some((item) => item.status === "unresolved");

    return {
      ...candidate,
      commit: {
        committedRows: 0,
        state: hasOpenConflicts ? ("blocked" as const) : ("ready" as const),
        ...(hasOpenConflicts ? { blockedReason: "Resolve duplicate review before committing." } : {})
      },
      conflicts,
      rows: candidate.rows.map((row) =>
        row.id === conflict.rowId
          ? {
              ...row,
              issue: "Resolved by keeping existing verified ClinicOS record.",
              status: "ready_to_commit" as const
            }
          : row
      ),
      status: hasOpenConflicts ? candidate.status : ("ready_to_commit" as const)
    };
  });

  return {
    ...data,
    migrationBatches: updatedBatches,
    readiness: {
      ...data.readiness,
      migrationCommit: "ready_to_commit"
    },
    timeline: prependTimeline(
      data.timeline,
      "migration.conflict_resolved",
      "Migration conflict resolved",
      `${input.actorName} chose ${input.resolution}; verified ClinicOS records will not be overwritten.`,
      resolvedAt
    )
  };
}

export function applyFixtureCommitMigrationBatch(
  data: Cp7IntegrationOpsData,
  input: { actorName: string; batchId: string }
): Cp7IntegrationOpsData {
  const batch = data.migrationBatches.find((candidate) => candidate.id === input.batchId);
  if (!batch) {
    throw new Error("Select a migration batch before commit.");
  }

  const unresolvedConflict = batch.conflicts.find((conflict) => conflict.status === "unresolved");
  if (unresolvedConflict) {
    throw new Error("Resolve migration conflicts before commit.");
  }

  const committedAt = new Date().toISOString();
  const committedRows = batch.rows.filter((row) =>
    ["ready_to_commit", "valid"].includes(row.status)
  ).length;

  return {
    ...data,
    migrationBatches: data.migrationBatches.map((candidate) =>
      candidate.id === input.batchId
        ? {
            ...candidate,
            commit: {
              committedAt,
              committedRows,
              state: "committed" as const
            },
            rows: candidate.rows.map((row) =>
              ["ready_to_commit", "valid"].includes(row.status)
                ? {
                    ...row,
                    status: "committed" as const
                  }
                : row
            ),
            status: "committed" as const
          }
        : candidate
    ),
    readiness: {
      ...data.readiness,
      migrationCommit: "committed"
    },
    timeline: prependTimeline(
      data.timeline,
      "migration.batch_committed",
      "Migration batch committed",
      `${input.actorName} committed ${committedRows} reviewed rows; rejected rows stayed out and verified records were preserved.`,
      committedAt
    )
  };
}

export async function replayLiveDeadLetterEvent(
  deadLetterEventId: string,
  input: { actorName: string; reason: string },
  signal?: AbortSignal
) {
  return postEndpoint(
    `/v1/dead-letter-events/${encodeURIComponent(deadLetterEventId)}/replay`,
    {
      reason: input.reason,
      reviewedByName: input.actorName,
      source: "cp7_integration_ops_surface"
    },
    signal
  );
}

export async function resolveLiveMigrationConflict(
  batchId: string,
  conflictId: string,
  input: {
    actorName: string;
    notes: string;
    resolution: MigrationConflict["resolution"];
  },
  signal?: AbortSignal
) {
  return postEndpoint(
    `/v1/migration-batches/${encodeURIComponent(batchId)}/conflicts/${encodeURIComponent(
      conflictId
    )}/resolve`,
    {
      notes: input.notes,
      resolution: input.resolution,
      reviewedByName: input.actorName
    },
    signal
  );
}

export async function commitLiveMigrationBatch(
  batchId: string,
  input: { actorName: string },
  signal?: AbortSignal
) {
  return postEndpoint(
    `/v1/migration-batches/${encodeURIComponent(batchId)}/commit`,
    {
      committedByName: input.actorName,
      safetyConfirmation: "reviewed_rows_only_no_silent_overwrite"
    },
    signal
  );
}

export function classifyCp7EndpointFailures(
  failures: Cp7EndpointIssue[]
): Cp7IntegrationOpsProblem {
  const hasAuthFailure = failures.some(
    (failure) => failure.status === 401 || failure.status === 403
  );
  const hasMissingEndpoint = failures.some((failure) => failure.status === 404);
  const hasNetworkFailure = failures.some((failure) => failure.status === 0);
  const hasServerFailure = failures.some((failure) => failure.status && failure.status >= 500);

  if (hasAuthFailure) {
    return {
      code: "AUTH_REQUIRED",
      endpoints: failures,
      message: "Sign in through the configured identity provider before opening CP7 integration ops."
    };
  }

  if (hasMissingEndpoint) {
    return {
      code: "CP7_ENDPOINT_NOT_REGISTERED",
      endpoints: failures,
      message:
        "One or more CP7 integration endpoints are not registered in this environment. Check route registration and official activation before debugging permissions or runtime state."
    };
  }

  if (hasNetworkFailure) {
    return {
      code: "NETWORK_UNAVAILABLE",
      endpoints: failures,
      message: "The ClinicOS API could not be reached for CP7 integration ops."
    };
  }

  if (hasServerFailure) {
    return {
      code: "SERVER_ERROR",
      endpoints: failures,
      message: "The ClinicOS API is reachable but could not load CP7 integration ops."
    };
  }

  return {
    code: "UNKNOWN",
    endpoints: failures,
    message: "The CP7 integration ops API returned an unexpected response."
  };
}

export function getProviderStatusCount(data: Cp7IntegrationOpsData, status: ProviderHealthStatus) {
  return data.providers.filter((provider) => provider.status === status).length;
}

export function getOpenDeadLetterCount(data: Cp7IntegrationOpsData) {
  return data.deadLetters.filter((event) => ["blocked", "unreviewed"].includes(event.status)).length;
}

export function getUnresolvedMigrationConflictCount(data: Cp7IntegrationOpsData) {
  return data.migrationBatches.reduce(
    (count, batch) =>
      count + batch.conflicts.filter((conflict) => conflict.status === "unresolved").length,
    0
  );
}

function normalizeCp7LivePayload(input: {
  deadLettersPayload: unknown;
  migrationPayload: unknown;
  providerPayload: unknown;
  requestIds: string[];
  today: string;
}): Cp7IntegrationOpsData | Cp7IntegrationOpsProblem {
  const providers = readArray(input.providerPayload, ["providers", "providerHealth"]).filter(
    isProviderHealthCard
  );
  const deadLetters = readArray(input.deadLettersPayload, [
    "deadLetters",
    "deadLetterEvents",
    "events"
  ]).filter(isDeadLetterEvent);
  const migrationBatches = readArray(input.migrationPayload, [
    "migrationBatches",
    "batches"
  ]).filter(isMigrationBatch);

  if (providers.length === 0 || !Array.isArray(deadLetters) || !Array.isArray(migrationBatches)) {
    return {
      code: "CONTRACT_MISMATCH",
      endpoints: CP7_REQUIRED_ENDPOINTS.map((endpoint) => ({
        endpoint,
        message: "The endpoint returned a payload outside the CP7 integration ops contract."
      })),
      message:
        "CP7 integration endpoints are reachable but do not match the expected provider/dead-letter/migration read contract."
    };
  }

  return {
    api: {
      environment: "live boundary",
      requestIds: input.requestIds
    },
    deadLetters,
    migrationBatches,
    providers,
    readiness: deriveReadiness(providers, deadLetters, migrationBatches),
    source: "api",
    timeline: [
      {
        at: new Date().toISOString(),
        detail: "Loaded CP7 provider, dead-letter, and migration read models from API routes.",
        id: "cp7-live-read",
        kind: "provider.health_checked",
        title: "CP7 live read"
      }
    ],
    today: input.today
  };
}

function deriveReadiness(
  providers: ProviderHealthCard[],
  deadLetters: DeadLetterEvent[],
  migrationBatches: MigrationBatch[]
): Cp7Readiness {
  const providerByKey = new Map(providers.map((provider) => [provider.providerKey, provider]));
  const migrationReady = migrationBatches.some((batch) => batch.commit.state === "ready");
  const migrationCommitted = migrationBatches.some((batch) => batch.commit.state === "committed");
  const replayReady = deadLetters.some((event) => event.replayAvailable);

  return {
    googleSource:
      providerByKey.get("google_business_profile")?.mode === "manual/source only"
        ? "manual_source_only"
        : "provider_unavailable",
    migrationCommit: migrationCommitted
      ? "committed"
      : migrationReady
        ? "ready_to_commit"
        : "blocked_review_required",
    razorpayWebhook:
      providerByKey.get("razorpay")?.status === "available"
        ? "verified_callback_ready"
        : "webhook_url_missing",
    replay: replayReady ? "ready" : "backend_route_unavailable",
    telephony:
      providerByKey.get("exotel")?.status === "available"
        ? "manual_entry_only"
        : "provider_unavailable",
    whatsapp:
      providerByKey.get("whatsapp_cloud")?.status === "degraded"
        ? "configured_degraded"
        : "not_configured"
  };
}

function readArray(payload: unknown, keys: string[]) {
  if (!isRecord(payload)) return [];

  for (const key of keys) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
  }

  return [];
}

function isProviderHealthCard(value: unknown): value is ProviderHealthCard {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    isCp7ProviderKey(value.providerKey) &&
    isProviderHealthStatus(value.status) &&
    Array.isArray(value.capabilities)
  );
}

function isDeadLetterEvent(value: unknown): value is DeadLetterEvent {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    isCp7ProviderKey(value.providerKey) &&
    typeof value.eventType === "string" &&
    typeof value.lastError === "string" &&
    typeof value.replayAvailable === "boolean" &&
    isDeadLetterStatus(value.status)
  );
}

function isMigrationBatch(value: unknown): value is MigrationBatch {
  if (!isRecord(value)) return false;

  return (
    typeof value.id === "string" &&
    isMigrationBatchStatus(value.status) &&
    Array.isArray(value.rows) &&
    Array.isArray(value.conflicts) &&
    isRecord(value.commit)
  );
}

function isCp7ProviderKey(value: unknown): value is Cp7ProviderKey {
  return (
    value === "exotel" ||
    value === "google_business_profile" ||
    value === "manual_import" ||
    value === "razorpay" ||
    value === "whatsapp_cloud"
  );
}

function isProviderHealthStatus(value: unknown): value is ProviderHealthStatus {
  return (
    value === "available" ||
    value === "degraded" ||
    value === "not_configured" ||
    value === "unavailable"
  );
}

function isDeadLetterStatus(value: unknown): value is DeadLetterStatus {
  return (
    value === "blocked" ||
    value === "ignored" ||
    value === "replayed" ||
    value === "replay_requested" ||
    value === "unreviewed"
  );
}

function isMigrationBatchStatus(value: unknown): value is MigrationBatchStatus {
  return (
    value === "committed" ||
    value === "failed" ||
    value === "needs_review" ||
    value === "ready_to_commit" ||
    value === "uploaded" ||
    value === "validated"
  );
}

function getWorkflowApiBaseUrl() {
  return process.env.NEXT_PUBLIC_CLINIC_OS_API_BASE_URL ?? "";
}

function buildWorkflowUrl(path: string, params?: Record<string, string>) {
  const baseUrl = getWorkflowApiBaseUrl().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`, getBrowserOrigin());

  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

function getBrowserOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost";
}

async function fetchEndpoint(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<EndpointResponse> {
  const response = await fetch(buildWorkflowUrl(path, params), {
    credentials: "include",
    headers: {
      Accept: "application/json"
    },
    signal
  });
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw endpointFailureFromResponse("GET", path, response, payload);
  }

  return {
    payload,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

async function postEndpoint(path: string, body: unknown, signal?: AbortSignal) {
  const response = await fetch(buildWorkflowUrl(path), {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": `web-cp7-${crypto.randomUUID()}`
    },
    method: "POST",
    signal
  });
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw endpointFailureFromResponse("POST", path, response, payload);
  }

  return payload;
}

async function parseJsonSafely(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json() as Promise<unknown>;
}

function endpointFailureFromResponse(
  method: "GET" | "POST",
  path: string,
  response: Response,
  payload: unknown
): EndpointFailure {
  return {
    endpoint: `${method} ${path}`,
    isEndpointFailure: true,
    message: readErrorMessage(payload) ?? `HTTP ${response.status}`,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

function isEndpointFailure(value: unknown): value is EndpointFailure {
  return isRecord(value) && value.isEndpointFailure === true;
}

function getRequestId(response: Response, payload: unknown) {
  if (isRecord(payload)) {
    const topLevel = readString(payload, [
      "request_id",
      "requestId",
      "correlation_id",
      "correlationId"
    ]);
    const error = isRecord(payload.error) ? payload.error : null;
    const nested = error
      ? readString(error, ["request_id", "requestId", "correlation_id", "correlationId"])
      : null;

    return topLevel ?? nested ?? response.headers.get("x-request-id") ?? undefined;
  }

  return response.headers.get("x-request-id") ?? undefined;
}

function readErrorMessage(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const error = isRecord(payload.error) ? payload.error : null;

  return (
    readString(payload, ["message", "detail", "error_description"]) ??
    (error ? readString(error, ["message", "detail", "error_description"]) : null)
  );
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function timelineItem(
  kind: Cp7TimelineItem["kind"],
  title: string,
  detail: string,
  at: string
): Cp7TimelineItem {
  return {
    at,
    detail,
    id: `${kind}-${at}`,
    kind,
    title
  };
}

function prependTimeline(
  items: Cp7TimelineItem[],
  kind: Cp7TimelineItem["kind"],
  title: string,
  detail: string,
  at: string
) {
  return [timelineItem(kind, title, detail, at), ...items].sort((left, right) =>
    right.at.localeCompare(left.at)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
