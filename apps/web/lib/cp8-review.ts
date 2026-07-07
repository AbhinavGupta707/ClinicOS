import type { ClinicRole } from "./roles";

export type Cp8ReviewSource = "api" | "cp8_fixture";
export type Cp8ReviewMode = "actions" | "chart" | "notes";
export type Cp8ReviewerRole = "assistant" | "doctor" | "owner";
export type Cp8ReviewStatus =
  | "approval_recorded"
  | "edited_draft"
  | "pending_review"
  | "rejected";
export type Cp8ReviewDecision = "approve" | "edit" | "reject";
export type Cp8DraftKind = "action_proposal" | "clinical_note" | "dental_chart_patch";

export interface Cp8SourceAnchor {
  excerpt: string;
  id: string;
  label: string;
  timeRange: string;
}

export interface Cp8ReviewAuditItem {
  actorName: string;
  at: string;
  decision: Cp8ReviewDecision;
  detail: string;
  id: string;
}

interface Cp8DraftBase {
  applicationState: "not_applied" | "not_applied_fixture" | "waiting_for_backend";
  confidence: number;
  encounterLabel: string;
  id: string;
  importantClaimAnchorIds: string[];
  kind: Cp8DraftKind;
  patientName: string;
  requiredReviewer: Cp8ReviewerRole;
  retainedForEvaluation: boolean;
  reviewDecisionHref?: string;
  sourceAnchors: Cp8SourceAnchor[];
  status: Cp8ReviewStatus;
  title: string;
  warnings: string[];
}

export interface Cp8ClinicalNoteDraft extends Cp8DraftBase {
  kind: "clinical_note";
  sections: {
    assessment: string;
    chiefComplaint: string;
    examination: string;
    history: string;
    plan: string;
  };
}

export interface Cp8DentalFindingDraft {
  confidence: number;
  description: string;
  findingType: string;
  sourceAnchorIds: string[];
  status: "active" | "historical" | "treated" | "watch";
  surface?: string;
  toothNumber: string;
}

export interface Cp8DentalChartPatchDraft extends Cp8DraftBase {
  findings: Cp8DentalFindingDraft[];
  kind: "dental_chart_patch";
}

export interface Cp8ActionProposal extends Cp8DraftBase {
  actionType:
    | "create_follow_up_task"
    | "draft_payment_reminder"
    | "send_post_op_instruction";
  kind: "action_proposal";
  proposedTool: string;
  riskLevel: "high" | "low" | "medium";
  summary: string;
}

export type Cp8ReviewItem =
  | Cp8ActionProposal
  | Cp8ClinicalNoteDraft
  | Cp8DentalChartPatchDraft;

export interface Cp8ReviewData {
  api?: {
    environment?: string;
    requestId?: string;
  };
  items: Cp8ReviewItem[];
  reviewAudit: Cp8ReviewAuditItem[];
  source: Cp8ReviewSource;
  today: string;
}

export type Cp8ProblemCode =
  | "AUTH_REQUIRED"
  | "CONTRACT_MISMATCH"
  | "CP8_REVIEW_CONTRACT_NOT_CONFIGURED"
  | "CP8_REVIEW_ENDPOINT_NOT_REGISTERED"
  | "NETWORK_UNAVAILABLE"
  | "SERVER_ERROR"
  | "UNKNOWN";

export interface Cp8EndpointIssue {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export interface Cp8ReviewProblem {
  code: Cp8ProblemCode;
  detail?: string;
  endpoints: Cp8EndpointIssue[];
  message: string;
}

export type Cp8ReviewLoadState =
  | { data: Cp8ReviewData; status: "ready" }
  | { problem: Cp8ReviewProblem; status: "unavailable" };

interface EndpointResponse {
  payload: unknown;
  requestId?: string;
  status: number;
}

interface EndpointFailure extends Cp8EndpointIssue {
  isEndpointFailure: true;
}

const FIXTURE_ENVIRONMENTS = new Set(["development", "dev", "local", "test"]);

export const CP8_REQUIRED_CONTRACTS = [
  "Configured AI Backend review queue read route",
  "Backend-provided per-item review decision route",
  "Review payload includes source anchors, warnings, confidence, retention, and required reviewer",
  "Decision response confirms review only; clinical/application state changes remain backend-owned"
] as const;

export const CP8_STATUS_LABELS: Record<Cp8ReviewStatus, string> = {
  approval_recorded: "Approval recorded",
  edited_draft: "Edited draft",
  pending_review: "Pending review",
  rejected: "Rejected"
};

export const CP8_ROLE_LABELS: Record<Cp8ReviewerRole, string> = {
  assistant: "Assistant",
  doctor: "Doctor",
  owner: "Owner"
};

export function getCp8TodayInputValue(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function isCp8FixtureAllowed() {
  const fixtureRequested = process.env.NEXT_PUBLIC_CLINIC_OS_USE_CP8_REVIEW_FIXTURE === "true";
  const environment = process.env.NEXT_PUBLIC_CLINIC_OS_ENV ?? process.env.NODE_ENV;

  return fixtureRequested && FIXTURE_ENVIRONMENTS.has(environment);
}

export function getCp8ReviewQueuePath() {
  const configured = process.env.NEXT_PUBLIC_CLINIC_OS_CP8_REVIEW_QUEUE_PATH?.trim();

  return configured && configured.length > 0 ? configured : null;
}

export function createFixtureCp8ReviewData(today = getCp8TodayInputValue()): Cp8ReviewData {
  const noteAnchors: Cp8SourceAnchor[] = [
    {
      excerpt: "Upper right molar hurts when chewing; pain started three days ago.",
      id: "cp8AnchorPain",
      label: "Transcript 00:42-00:58",
      timeRange: "00:42-00:58"
    },
    {
      excerpt: "Percussion tenderness around 16 and no facial swelling noted.",
      id: "cp8AnchorExam",
      label: "Transcript 03:10-03:24",
      timeRange: "03:10-03:24"
    },
    {
      excerpt: "Doctor discussed restoration after X-ray review and advised return if swelling appears.",
      id: "cp8AnchorPlan",
      label: "Transcript 07:02-07:20",
      timeRange: "07:02-07:20"
    }
  ];
  const chartAnchors: Cp8SourceAnchor[] = [
    {
      excerpt: "There is occlusal caries on 36; mark it active, moderate depth.",
      id: "cp8AnchorTooth36",
      label: "Transcript 04:12-04:21",
      timeRange: "04:12-04:21"
    },
    {
      excerpt: "Watch 37 distal; not treating today.",
      id: "cp8AnchorTooth37",
      label: "Transcript 04:22-04:30",
      timeRange: "04:22-04:30"
    }
  ];
  const actionAnchors: Cp8SourceAnchor[] = [
    {
      excerpt: "Please send the post-op instructions after the filling and book a one-week review.",
      id: "cp8AnchorInstruction",
      label: "Transcript 09:01-09:15",
      timeRange: "09:01-09:15"
    }
  ];

  return {
    api: {
      environment: "local synthetic CP8 fixture",
      requestId: "fixture-cp8-review"
    },
    items: [
      {
        applicationState: "not_applied_fixture",
        confidence: 0.82,
        encounterLabel: "Encounter 2026-07-07 10:30",
        id: "cp8ClinicalNoteDraft",
        importantClaimAnchorIds: ["cp8AnchorPain", "cp8AnchorExam", "cp8AnchorPlan"],
        kind: "clinical_note",
        patientName: "Synthetic review patient",
        requiredReviewer: "doctor",
        retainedForEvaluation: true,
        sections: {
          assessment: "Possible reversible pulpitis related to tooth 16; confirm with radiograph.",
          chiefComplaint: "Pain on chewing around upper right molar for three days.",
          examination: "Percussion tenderness around 16. No facial swelling documented.",
          history: "Patient reports no fever and no analgesic allergy in the captured transcript.",
          plan: "Review X-ray, restore if indicated, and return urgently if swelling develops."
        },
        sourceAnchors: noteAnchors,
        status: "pending_review",
        title: "Clinical note draft from AI scribe",
        warnings: [
          "Assessment is a draft; diagnosis must be confirmed by the doctor.",
          "Allergy statement must be checked against the patient chart before signing."
        ]
      },
      {
        applicationState: "not_applied_fixture",
        confidence: 0.76,
        encounterLabel: "Encounter 2026-07-07 10:30",
        findings: [
          {
            confidence: 0.88,
            description: "Moderate occlusal caries heard in dictated charting.",
            findingType: "caries",
            sourceAnchorIds: ["cp8AnchorTooth36"],
            status: "active",
            surface: "occlusal",
            toothNumber: "36"
          },
          {
            confidence: 0.64,
            description: "Distal surface needs monitoring; no treatment today.",
            findingType: "watch_area",
            sourceAnchorIds: ["cp8AnchorTooth37"],
            status: "watch",
            surface: "distal",
            toothNumber: "37"
          }
        ],
        id: "cp8DentalChartPatch",
        importantClaimAnchorIds: ["cp8AnchorTooth36", "cp8AnchorTooth37"],
        kind: "dental_chart_patch",
        patientName: "Synthetic review patient",
        requiredReviewer: "assistant",
        retainedForEvaluation: true,
        sourceAnchors: chartAnchors,
        status: "pending_review",
        title: "Dental chart patch draft",
        warnings: [
          "Tooth 37 confidence is below review threshold; verify before chart write.",
          "This patch has not changed the durable odontogram."
        ]
      },
      {
        actionType: "send_post_op_instruction",
        applicationState: "not_applied_fixture",
        confidence: 0.91,
        encounterLabel: "Encounter 2026-07-07 10:30",
        id: "cp8ActionPostOpInstruction",
        importantClaimAnchorIds: ["cp8AnchorInstruction"],
        kind: "action_proposal",
        patientName: "Synthetic review patient",
        proposedTool: "patient_instruction.request",
        requiredReviewer: "assistant",
        retainedForEvaluation: true,
        riskLevel: "medium",
        sourceAnchors: actionAnchors,
        status: "pending_review",
        summary:
          "Prepare approved post-op instruction request and one-week follow-up task for staff review.",
        title: "Post-op instruction proposal",
        warnings: [
          "No message or task is sent from this draft review surface.",
          "Provider delivery must come from the backend instruction workflow."
        ]
      }
    ],
    reviewAudit: [
      {
        actorName: "system fixture",
        at: `${today}T10:45:00+05:30`,
        decision: "edit",
        detail: "AI output generated as draft-only review material with retained source anchors.",
        id: "cp8AuditDraftGenerated"
      }
    ],
    source: "cp8_fixture",
    today
  };
}

export async function loadCp8Review(
  signal?: AbortSignal,
  today = getCp8TodayInputValue()
): Promise<Cp8ReviewLoadState> {
  if (isCp8FixtureAllowed()) {
    return {
      data: createFixtureCp8ReviewData(today),
      status: "ready"
    };
  }

  const reviewQueuePath = getCp8ReviewQueuePath();
  if (!reviewQueuePath) {
    return {
      problem: {
        code: "CP8_REVIEW_CONTRACT_NOT_CONFIGURED",
        endpoints: CP8_REQUIRED_CONTRACTS.map((endpoint) => ({
          endpoint,
          message: "Awaiting AI Backend lane route registration or explicit web env configuration."
        })),
        message:
          "CP8 AI review is not active in this environment because no backend review queue contract is configured. Check registration/discovery and official activation before debugging permissions or runtime state."
      },
      status: "unavailable"
    };
  }

  try {
    return await loadLiveCp8Review(reviewQueuePath, signal, today);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    const failure = isEndpointFailure(error)
      ? error
      : {
          endpoint: `GET ${reviewQueuePath}`,
          message: error instanceof Error ? error.message : "Network unavailable",
          status: 0
        };

    return {
      problem: classifyCp8EndpointFailures([failure]),
      status: "unavailable"
    };
  }
}

export async function loadLiveCp8Review(
  reviewQueuePath: string,
  signal?: AbortSignal,
  today = getCp8TodayInputValue()
): Promise<Cp8ReviewLoadState> {
  const response = await fetchEndpoint(reviewQueuePath, {}, signal);
  const normalized = normalizeCp8LivePayload(response.payload, {
    requestId: response.requestId,
    reviewQueuePath,
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

export function canRoleReviewCp8Item(item: Cp8ReviewItem, roles: ClinicRole[]) {
  if (item.requiredReviewer === "doctor") {
    return roles.includes("doctor");
  }
  if (item.requiredReviewer === "assistant") {
    return roles.includes("assistant") || roles.includes("doctor");
  }

  return roles.includes("owner");
}

export function applyFixtureCp8ReviewDecision(
  data: Cp8ReviewData,
  input: {
    actorName: string;
    decision: Cp8ReviewDecision;
    detail: string;
    itemId: string;
    roles: ClinicRole[];
  }
): Cp8ReviewData {
  const item = data.items.find((candidate) => candidate.id === input.itemId);
  if (!item) {
    throw new Error("Select an AI draft or proposal before recording a decision.");
  }
  if (!canRoleReviewCp8Item(item, input.roles)) {
    throw new Error(`${CP8_ROLE_LABELS[item.requiredReviewer]} review is required for this item.`);
  }
  if (item.status === "rejected" && input.decision === "approve") {
    throw new Error("Rejected AI output remains retained for evaluation and cannot be approved here.");
  }

  const decidedAt = new Date().toISOString();
  const status = statusForDecision(input.decision);
  const applicationState =
    input.decision === "approve" ? "not_applied_fixture" : item.applicationState;
  const reviewDetail = detailForDecision(input.decision, input.detail);

  return {
    ...data,
    items: data.items.map((candidate) =>
      candidate.id === input.itemId
        ? {
            ...candidate,
            applicationState,
            retainedForEvaluation: true,
            status
          }
        : candidate
    ),
    reviewAudit: [
      {
        actorName: input.actorName,
        at: decidedAt,
        decision: input.decision,
        detail: reviewDetail,
        id: `cp8Review-${input.itemId}-${decidedAt}`
      },
      ...data.reviewAudit
    ]
  };
}

export async function submitLiveCp8ReviewDecision(
  item: Cp8ReviewItem,
  input: {
    actorName: string;
    decision: Cp8ReviewDecision;
    detail: string;
  },
  signal?: AbortSignal
) {
  if (!item.reviewDecisionHref) {
    throw new Error(
      "The backend did not provide a review decision route for this AI output. Re-check CP8 route registration before attempting review."
    );
  }

  return postEndpoint(
    item.reviewDecisionHref,
    {
      decision: input.decision,
      reviewedByName: input.actorName,
      reviewNote: input.detail,
      safetyConfirmation:
        "review_decision_only_no_clinical_application_without_backend_confirmation",
      source: "cp8_review_surface"
    },
    signal
  );
}

export function classifyCp8EndpointFailures(failures: Cp8EndpointIssue[]): Cp8ReviewProblem {
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
      message: "Sign in with a doctor or assistant role before opening CP8 AI review."
    };
  }

  if (hasMissingEndpoint) {
    return {
      code: "CP8_REVIEW_ENDPOINT_NOT_REGISTERED",
      endpoints: failures,
      message:
        "One or more CP8 AI review endpoints are not registered in this environment. Check route registration and official activation before debugging permissions or runtime state."
    };
  }

  if (hasNetworkFailure) {
    return {
      code: "NETWORK_UNAVAILABLE",
      endpoints: failures,
      message: "The ClinicOS API could not be reached for CP8 AI review."
    };
  }

  if (hasServerFailure) {
    return {
      code: "SERVER_ERROR",
      endpoints: failures,
      message: "The ClinicOS API is reachable but could not load CP8 AI review."
    };
  }

  return {
    code: "UNKNOWN",
    endpoints: failures,
    message: "The CP8 AI review API returned an unexpected response."
  };
}

export function getCp8ItemsForMode(data: Cp8ReviewData, mode: Cp8ReviewMode) {
  const kindByMode: Record<Cp8ReviewMode, Cp8DraftKind> = {
    actions: "action_proposal",
    chart: "dental_chart_patch",
    notes: "clinical_note"
  };

  return data.items.filter((item) => item.kind === kindByMode[mode]);
}

export function getCp8PendingCount(data: Cp8ReviewData) {
  return data.items.filter((item) => item.status === "pending_review").length;
}

export function getCp8WarningCount(data: Cp8ReviewData) {
  return data.items.reduce((count, item) => count + item.warnings.length, 0);
}

export function getCp8RejectedRetainedCount(data: Cp8ReviewData) {
  return data.items.filter((item) => item.status === "rejected" && item.retainedForEvaluation)
    .length;
}

function statusForDecision(decision: Cp8ReviewDecision): Cp8ReviewStatus {
  if (decision === "approve") return "approval_recorded";
  if (decision === "reject") return "rejected";

  return "edited_draft";
}

function detailForDecision(decision: Cp8ReviewDecision, detail: string) {
  if (decision === "approve") {
    return `${detail} Review decision recorded only; no note signing, dental chart write, message, task, payment, or billing action was applied by the fixture.`;
  }
  if (decision === "reject") {
    return `${detail} Rejected output remains retained for evaluation and audit.`;
  }

  return `${detail} Draft text was edited locally for review; backend application is still pending.`;
}

function normalizeCp8LivePayload(
  payload: unknown,
  input: { requestId?: string; reviewQueuePath: string; today: string }
): Cp8ReviewData | Cp8ReviewProblem {
  const record = isRecord(payload) ? payload : {};
  const rawItems = readArray(record, ["items", "reviewItems", "drafts"]);
  const items = rawItems.map(normalizeLiveItem).filter((item): item is Cp8ReviewItem => Boolean(item));

  if (items.length === 0) {
    return {
      code: "CONTRACT_MISMATCH",
      endpoints: [
        {
          endpoint: `GET ${input.reviewQueuePath}`,
          message:
            "The endpoint did not return CP8 review items with source anchors, warnings, confidence, and required reviewer."
        }
      ],
      message:
        "CP8 AI review is reachable but does not match the expected draft/proposal review contract."
    };
  }

  return {
    api: {
      environment: "live boundary",
      requestId: input.requestId
    },
    items,
    reviewAudit: [],
    source: "api",
    today: input.today
  };
}

function normalizeLiveItem(value: unknown): Cp8ReviewItem | null {
  if (!isRecord(value)) return null;

  const kind = readString(value, ["kind", "type"]);
  const base = normalizeLiveBase(value);
  if (!base) return null;

  if (kind === "clinical_note") {
    const sections = readRecord(value, ["sections", "draft"]);
    return {
      ...base,
      kind,
      sections: {
        assessment: readString(sections, ["assessment"]) ?? "",
        chiefComplaint: readString(sections, ["chiefComplaint", "chief_complaint"]) ?? "",
        examination: readString(sections, ["examination"]) ?? "",
        history: readString(sections, ["history"]) ?? "",
        plan: readString(sections, ["plan"]) ?? ""
      }
    };
  }

  if (kind === "dental_chart_patch") {
    return {
      ...base,
      findings: readArray(value, ["findings"])
        .map(normalizeLiveFinding)
        .filter((finding): finding is Cp8DentalFindingDraft => Boolean(finding)),
      kind
    };
  }

  if (kind === "action_proposal") {
    return {
      ...base,
      actionType:
        readActionType(value, ["actionType", "action_type"]) ?? "create_follow_up_task",
      kind,
      proposedTool: readString(value, ["proposedTool", "tool"]) ?? "unconfigured.tool",
      riskLevel: readRiskLevel(value, ["riskLevel", "risk_level"]) ?? "medium",
      summary: readString(value, ["summary", "description"]) ?? base.title
    };
  }

  return null;
}

function normalizeLiveBase(value: Record<string, unknown>): Omit<Cp8ReviewItem, "kind"> | null {
  const id = readString(value, ["id"]);
  const title = readString(value, ["title"]);
  if (!id || !title) return null;

  const sourceAnchors = readArray(value, ["sourceAnchors", "source_anchors"])
    .map(normalizeSourceAnchor)
    .filter((anchor): anchor is Cp8SourceAnchor => Boolean(anchor));
  const warnings = readStringArray(value, ["warnings"]);
  const requiredReviewer = readReviewerRole(value, ["requiredReviewer", "required_reviewer"]);

  return {
    applicationState: "waiting_for_backend",
    confidence: readNumber(value, ["confidence"]) ?? 0,
    encounterLabel: readString(value, ["encounterLabel", "encounter_label"]) ?? "Encounter",
    id,
    importantClaimAnchorIds: readStringArray(value, [
      "importantClaimAnchorIds",
      "important_claim_anchor_ids"
    ]),
    patientName: readString(value, ["patientName", "patient_name"]) ?? "Patient",
    requiredReviewer: requiredReviewer ?? "doctor",
    retainedForEvaluation: readBoolean(value, ["retainedForEvaluation", "retained_for_evaluation"]) ?? true,
    reviewDecisionHref: readStringFromNested(value, [
      ["reviewDecisionHref"],
      ["links", "reviewDecision"],
      ["links", "review_decision"]
    ]),
    sourceAnchors,
    status: readStatus(value, ["status"]) ?? "pending_review",
    title,
    warnings
  };
}

function normalizeLiveFinding(value: unknown): Cp8DentalFindingDraft | null {
  if (!isRecord(value)) return null;

  const toothNumber = readString(value, ["toothNumber", "tooth_number"]);
  const findingType = readString(value, ["findingType", "finding_type"]);
  if (!toothNumber || !findingType) return null;

  return {
    confidence: readNumber(value, ["confidence"]) ?? 0,
    description: readString(value, ["description"]) ?? "",
    findingType,
    sourceAnchorIds: readStringArray(value, ["sourceAnchorIds", "source_anchor_ids"]),
    status: readFindingStatus(value, ["status"]) ?? "active",
    surface: readString(value, ["surface"]) ?? undefined,
    toothNumber
  };
}

function normalizeSourceAnchor(value: unknown): Cp8SourceAnchor | null {
  if (!isRecord(value)) return null;

  const id = readString(value, ["id"]);
  const excerpt = readString(value, ["excerpt", "text"]);
  if (!id || !excerpt) return null;

  return {
    excerpt,
    id,
    label: readString(value, ["label"]) ?? "Source",
    timeRange: readString(value, ["timeRange", "time_range"]) ?? "n/a"
  };
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
      "Idempotency-Key": `web-cp8-${crypto.randomUUID()}`
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
  const message = readErrorMessage(payload) ?? response.statusText;

  return {
    endpoint: `${method} ${path}`,
    isEndpointFailure: true,
    message,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

function isEndpointFailure(error: unknown): error is EndpointFailure {
  return isRecord(error) && error.isEndpointFailure === true;
}

function getRequestId(response: Response, payload: unknown) {
  return (
    response.headers.get("x-request-id") ??
    (isRecord(payload) ? readString(payload, ["requestId", "request_id"]) : null) ??
    undefined
  );
}

function readErrorMessage(payload: unknown) {
  if (!isRecord(payload)) return null;

  const error = payload.error;
  if (isRecord(error)) {
    return readString(error, ["message", "code"]);
  }

  return readString(payload, ["message", "error"]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (isRecord(value)) return value;
  }

  return {};
}

function readArray(record: unknown, keys: string[]) {
  if (!isRecord(record)) return [];

  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }

  return [];
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

function readStringFromNested(record: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = record;

    for (const key of path) {
      current = isRecord(current) ? current[key] : undefined;
    }

    if (typeof current === "string" && current.trim().length > 0) {
      return current;
    }
  }

  return undefined;
}

function readStringArray(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  }

  return [];
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function readBoolean(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "boolean") {
      return value;
    }
  }

  return null;
}

function readReviewerRole(record: Record<string, unknown>, keys: string[]): Cp8ReviewerRole | null {
  const value = readString(record, keys);

  return value === "assistant" || value === "doctor" || value === "owner" ? value : null;
}

function readStatus(record: Record<string, unknown>, keys: string[]): Cp8ReviewStatus | null {
  const value = readString(record, keys);

  return value === "approval_recorded" ||
    value === "edited_draft" ||
    value === "pending_review" ||
    value === "rejected"
    ? value
    : null;
}

function readFindingStatus(
  record: Record<string, unknown>,
  keys: string[]
): Cp8DentalFindingDraft["status"] | null {
  const value = readString(record, keys);

  return value === "active" || value === "historical" || value === "treated" || value === "watch"
    ? value
    : null;
}

function readRiskLevel(
  record: Record<string, unknown>,
  keys: string[]
): Cp8ActionProposal["riskLevel"] | null {
  const value = readString(record, keys);

  return value === "high" || value === "low" || value === "medium" ? value : null;
}

function readActionType(
  record: Record<string, unknown>,
  keys: string[]
): Cp8ActionProposal["actionType"] | null {
  const value = readString(record, keys);

  return value === "create_follow_up_task" ||
    value === "draft_payment_reminder" ||
    value === "send_post_op_instruction"
    ? value
    : null;
}
