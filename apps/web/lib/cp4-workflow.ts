import type { ClinicRole } from "./roles";

export type Cp4WorkflowSource = "api" | "cp4_fixture";

export type DentalSurface = "buccal" | "distal" | "lingual" | "mesial" | "occlusal";

export type DentalFindingType =
  | "caries"
  | "cervical_erosion"
  | "crown"
  | "missing_tooth"
  | "mobility"
  | "periodontal_note"
  | "rct"
  | "restoration"
  | "watch_item";

export type DentalFindingSeverity = "low" | "moderate" | "high";

export type DentalFindingStatus = "active" | "resolved" | "reviewed" | "watch";

export type MediaKind = "document" | "external_link" | "intraoral_photo" | "xray";

export type MediaTag =
  | "before_after"
  | "consent_form"
  | "document"
  | "intraoral_photo"
  | "lab_file"
  | "prescription"
  | "xray";

export type MediaAttachmentTarget = "encounter" | "finding" | "patient" | "tooth";

export interface Cp4Patient {
  displayName: string;
  id: string;
  kind: "new" | "returning";
  visitReason: string;
}

export interface Cp4Encounter {
  chair: string;
  id: string;
  patientId: string;
  providerName: string;
  scheduledAt: string;
  status: "checked_in" | "encounter_started" | "ready_for_review";
}

export interface DentalFindingHistoryEntry {
  actorName: string;
  actorRole: ClinicRole;
  at: string;
  detail: string;
  id: string;
  kind: "created" | "media_linked" | "reviewed" | "updated";
}

export interface DentalFinding {
  authorName: string;
  authorRole: ClinicRole;
  createdAt: string;
  encounterId: string;
  history: DentalFindingHistoryEntry[];
  id: string;
  note: string;
  patientId: string;
  reviewState: "needs_doctor_review" | "reviewed";
  severity: DentalFindingSeverity;
  status: DentalFindingStatus;
  surfaces: DentalSurface[];
  toothNumber: string;
  type: DentalFindingType;
  updatedAt?: string;
}

export interface MediaAttachmentContext {
  encounterId?: string;
  findingId?: string;
  patientId: string;
  target: MediaAttachmentTarget;
  toothNumber?: string;
}

export interface MediaAsset {
  attachedAt: string;
  context: MediaAttachmentContext;
  createdBy: string;
  displayName: string;
  id: string;
  kind: MediaKind;
  lastViewedAt?: string;
  referenceLabel: string;
  signedAccess?: {
    expiresAt: string;
    state: "issued";
  };
  tag: MediaTag;
}

export interface ChartHistoryEntry {
  actorName: string;
  at: string;
  detail: string;
  findingCount: number;
  id: string;
  title: string;
}

export interface Cp4TimelineItem {
  at: string;
  detail: string;
  id: string;
  kind:
    | "dental_chart.snapshot_created"
    | "dental_finding.created"
    | "dental_finding.updated"
    | "media.created"
    | "media.linked"
    | "media.viewed";
  title: string;
}

export interface Cp4WorkflowData {
  api?: {
    environment?: string;
    requestIds: string[];
  };
  chartHistory: ChartHistoryEntry[];
  encounters: Cp4Encounter[];
  findings: DentalFinding[];
  mediaAssets: MediaAsset[];
  patients: Cp4Patient[];
  source: Cp4WorkflowSource;
  timeline: Cp4TimelineItem[];
  today: string;
}

export type Cp4WorkflowProblemCode =
  | "AUTH_REQUIRED"
  | "CONTRACT_MISMATCH"
  | "CP4_ENDPOINT_NOT_REGISTERED"
  | "NETWORK_UNAVAILABLE"
  | "SERVER_ERROR"
  | "UNKNOWN";

export interface Cp4EndpointIssue {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export interface Cp4WorkflowProblem {
  code: Cp4WorkflowProblemCode;
  detail?: string;
  endpoints: Cp4EndpointIssue[];
  message: string;
}

export type Cp4WorkflowLoadState =
  | { data: Cp4WorkflowData; status: "ready" }
  | { problem: Cp4WorkflowProblem; status: "unauthenticated" | "unavailable" };

export interface FindingDraftInput {
  actorName: string;
  actorRole: ClinicRole;
  encounterId: string;
  note: string;
  patientId: string;
  severity: DentalFindingSeverity;
  status: DentalFindingStatus;
  surfaces: DentalSurface[];
  toothNumber: string;
  type: DentalFindingType;
}

export interface FindingUpdateInput {
  actorName: string;
  actorRole: ClinicRole;
  findingId: string;
  note: string;
  status: DentalFindingStatus;
}

export interface MediaAttachInput {
  actorName: string;
  actorRole: ClinicRole;
  encounterId: string;
  externalReference: string;
  file?: File;
  findingId?: string;
  kind: MediaKind;
  patientId: string;
  tag: MediaTag;
  target: MediaAttachmentTarget;
  toothNumber?: string;
}

export interface MediaViewInput {
  actorName: string;
  mediaId: string;
}

interface EndpointResponse {
  payload: unknown;
  requestId?: string;
  status: number;
}

interface EndpointFailure {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export const CP4_REQUIRED_ENDPOINTS = [
  "GET /v1/clinical-workflows/cp4?date=",
  "POST /v1/patients/{patientId}/dental-findings",
  "PATCH /v1/dental-findings/{findingId}",
  "POST /v1/dental-chart-snapshots",
  "GET /v1/patients/{patientId}/media",
  "POST /v1/media/upload-urls",
  "PUT /v1/media/uploads/{uploadId}/content",
  "POST /v1/media/uploads/{uploadId}/complete",
  "POST /v1/media/assets/{mediaAssetId}/signed-url"
] as const;

export const PERMANENT_TOOTH_NUMBERS = [
  "18",
  "17",
  "16",
  "15",
  "14",
  "13",
  "12",
  "11",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "48",
  "47",
  "46",
  "45",
  "44",
  "43",
  "42",
  "41",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38"
] as const;

export const DENTAL_SURFACES: DentalSurface[] = [
  "mesial",
  "distal",
  "occlusal",
  "buccal",
  "lingual"
];

export const FINDING_TYPE_LABELS: Record<DentalFindingType, string> = {
  caries: "Caries",
  cervical_erosion: "Cervical erosion",
  crown: "Crown",
  missing_tooth: "Missing tooth",
  mobility: "Mobility",
  periodontal_note: "Periodontal note",
  rct: "RCT",
  restoration: "Restoration",
  watch_item: "Watch item"
};

export const FINDING_STATUS_LABELS: Record<DentalFindingStatus, string> = {
  active: "Active",
  resolved: "Resolved",
  reviewed: "Reviewed",
  watch: "Watch"
};

export const FINDING_SEVERITY_LABELS: Record<DentalFindingSeverity, string> = {
  high: "High",
  low: "Low",
  moderate: "Moderate"
};

export const SURFACE_LABELS: Record<DentalSurface, string> = {
  buccal: "Buccal",
  distal: "Distal",
  lingual: "Lingual",
  mesial: "Mesial",
  occlusal: "Occlusal"
};

export const MEDIA_KIND_LABELS: Record<MediaKind, string> = {
  document: "Document",
  external_link: "External reference",
  intraoral_photo: "Intraoral photo",
  xray: "X-ray"
};

export const MEDIA_TAG_LABELS: Record<MediaTag, string> = {
  before_after: "Before/after",
  consent_form: "Consent form",
  document: "Document",
  intraoral_photo: "Intraoral photo",
  lab_file: "Lab file",
  prescription: "Prescription",
  xray: "X-ray"
};

const FIXTURE_ENVIRONMENTS = new Set(["development", "dev", "local", "test"]);
let fixtureIdCounter = 0;

export function getTodayInputValue(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function isCp4FixtureAllowed() {
  const fixtureRequested = process.env.NEXT_PUBLIC_CLINIC_OS_USE_CP4_WORKFLOW_FIXTURE === "true";
  const environment = process.env.NEXT_PUBLIC_CLINIC_OS_ENV ?? process.env.NODE_ENV;

  return fixtureRequested && FIXTURE_ENVIRONMENTS.has(environment);
}

export function getFindingsForTooth(data: Cp4WorkflowData, patientId: string, toothNumber: string) {
  return data.findings
    .filter((finding) => finding.patientId === patientId && finding.toothNumber === toothNumber)
    .sort((first, second) => Date.parse(second.createdAt) - Date.parse(first.createdAt));
}

export function getMediaForContext(
  data: Cp4WorkflowData,
  patientId: string,
  toothNumber?: string,
  findingId?: string
) {
  return data.mediaAssets
    .filter((asset) => {
      if (asset.context.patientId !== patientId) {
        return false;
      }

      if (findingId && asset.context.findingId === findingId) {
        return true;
      }

      if (toothNumber && asset.context.toothNumber === toothNumber) {
        return true;
      }

      return asset.context.target === "patient" || asset.context.target === "encounter";
    })
    .sort((first, second) => Date.parse(second.attachedAt) - Date.parse(first.attachedAt));
}

export function createFixtureCp4WorkflowData(today = getTodayInputValue()): Cp4WorkflowData {
  const patientId = "cp4SyntheticPatient";
  const encounterId = "cp4SyntheticEncounter";
  const createdAt = `${today}T04:40:00.000Z`;
  const mediaAt = `${today}T04:44:00.000Z`;

  const baselineFinding: DentalFinding = {
    authorName: "doctor fixture user",
    authorRole: "doctor",
    createdAt,
    encounterId,
    history: [
      {
        actorName: "doctor fixture user",
        actorRole: "doctor",
        at: createdAt,
        detail: "Watch item recorded on tooth 36 in local fixture mode.",
        id: "cp4-finding-history-1",
        kind: "created"
      }
    ],
    id: "cp4FindingWatch36",
    note: "Synthetic watch item for occlusal staining. Local fixture only.",
    patientId,
    reviewState: "reviewed",
    severity: "low",
    status: "watch",
    surfaces: ["occlusal"],
    toothNumber: "36",
    type: "watch_item"
  };

  const baselineMedia: MediaAsset = {
    attachedAt: mediaAt,
    context: {
      encounterId,
      findingId: baselineFinding.id,
      patientId,
      target: "finding",
      toothNumber: baselineFinding.toothNumber
    },
    createdBy: "assistant fixture user",
    displayName: "Synthetic bitewing reference",
    id: "cp4MediaBitewing36",
    kind: "xray",
    referenceLabel: "External X-ray software reference XR-SYN-36",
    tag: "xray"
  };

  return {
    api: {
      environment: "local synthetic CP4 fixture",
      requestIds: ["fixture-cp4-workflow"]
    },
    chartHistory: [
      {
        actorName: "doctor fixture user",
        at: createdAt,
        detail: "Initial synthetic dental chart snapshot for tooth 36 watch item.",
        findingCount: 1,
        id: "cp4-chart-snapshot-1",
        title: "Chart snapshot created"
      }
    ],
    encounters: [
      {
        chair: "Chair 1",
        id: encounterId,
        patientId,
        providerName: "Dr Synthetic Rao",
        scheduledAt: `${today}T04:30:00.000Z`,
        status: "encounter_started"
      }
    ],
    findings: [baselineFinding],
    mediaAssets: [baselineMedia],
    patients: [
      {
        displayName: "Synthetic dental patient",
        id: patientId,
        kind: "returning",
        visitReason: "CP4 dental chart and media workflow verification"
      }
    ],
    source: "cp4_fixture",
    timeline: [
      timelineItem(
        "media.linked",
        "Media linked",
        "Synthetic bitewing reference linked to tooth 36 finding.",
        mediaAt
      ),
      timelineItem(
        "media.created",
        "Media metadata created",
        "Media metadata exists without exposing object storage keys.",
        mediaAt
      ),
      timelineItem(
        "dental_chart.snapshot_created",
        "Chart snapshot created",
        "Initial dental chart history is available.",
        createdAt
      ),
      timelineItem(
        "dental_finding.created",
        "Dental finding created",
        "Watch item recorded on tooth 36.",
        createdAt
      )
    ],
    today
  };
}

export async function loadCp4Workflow(
  signal?: AbortSignal,
  today = getTodayInputValue()
): Promise<Cp4WorkflowLoadState> {
  if (isCp4FixtureAllowed()) {
    return {
      data: createFixtureCp4WorkflowData(today),
      status: "ready"
    };
  }

  try {
    const workflow = await fetchEndpoint("/v1/clinical-workflows/cp4", { date: today }, signal);
    const normalized = normalizeCp4WorkflowPayload(workflow.payload, today, workflow.requestId);

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
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    if (isEndpointFailure(error)) {
      const problem = classifyCp4EndpointFailures([error]);

      return {
        problem,
        status: problem.code === "AUTH_REQUIRED" ? "unauthenticated" : "unavailable"
      };
    }

    return {
      problem: {
        code: "NETWORK_UNAVAILABLE",
        detail: error instanceof Error ? error.message : undefined,
        endpoints: CP4_REQUIRED_ENDPOINTS.map((endpoint) => ({
          endpoint,
          message: "The endpoint could not be reached from the web app."
        })),
        message: "The CP4 workflow API could not be reached."
      },
      status: "unavailable"
    };
  }
}

export async function createLiveFinding(input: FindingDraftInput, signal?: AbortSignal) {
  return postEndpoint(
    `/v1/patients/${encodeURIComponent(input.patientId)}/dental-findings`,
    {
      encounterId: input.encounterId,
      findingType: input.type,
      note: input.note,
      provenance: {
        actorName: input.actorName,
        actorRole: input.actorRole,
        kind: "clinic_staff_entry"
      },
      severity: input.severity,
      status: input.status,
      surfaces: input.surfaces,
      toothNumber: input.toothNumber
    },
    signal
  );
}

export async function updateLiveFinding(input: FindingUpdateInput, signal?: AbortSignal) {
  return patchEndpoint(
    `/v1/dental-findings/${encodeURIComponent(input.findingId)}`,
    {
      note: input.note,
      provenance: {
        actorName: input.actorName,
        actorRole: input.actorRole,
        kind: "clinic_staff_update"
      },
      status: input.status
    },
    signal
  );
}

export async function attachLiveMedia(input: MediaAttachInput, signal?: AbortSignal) {
  if (input.kind === "external_link") {
    throw new Error(
      "Live external imaging references are deferred to the dedicated imaging-link adapter workflow."
    );
  }

  if (!input.file) {
    throw new Error("Live media upload requires a selected file.");
  }

  const mimeType = input.file.type || "application/octet-stream";
  const sha256Digest = await sha256DigestForFile(input.file);
  const uploadPayload = await postEndpoint(
    "/v1/media/upload-urls",
    {
      dentalFindingId: input.target === "finding" ? input.findingId : null,
      encounterId: input.encounterId,
      fileSizeBytes: input.file.size,
      mediaType: mediaKindToApiMediaType(input.kind),
      mimeType,
      originalFilename: input.file.name,
      patientId: input.patientId,
      provenance: {
        actorName: input.actorName,
        actorRole: input.actorRole,
        kind: "clinic_staff_upload",
        referenceLabel: input.externalReference.trim() || null
      },
      sha256Digest,
      tags: [input.tag],
      toothNumber:
        input.target === "tooth" || input.target === "finding" ? input.toothNumber : null
    },
    signal
  );

  const uploadContract = parseUploadContract(uploadPayload);
  const uploadResponse = await fetch(buildWorkflowUrl(uploadContract.uploadUrl), {
    body: input.file,
    headers: {
      ...uploadContract.requiredHeaders,
      "Content-Type": mimeType
    },
    method: "PUT",
    signal
  });

  if (!uploadResponse.ok) {
    throw new Error(`Signed upload failed with HTTP ${uploadResponse.status}.`);
  }

  return postEndpoint(
    `/v1/media/uploads/${encodeURIComponent(uploadContract.uploadId)}/complete`,
    {
      contentLength: input.file.size,
      dicomMetadata:
        input.kind === "xray"
          ? { referenceLabel: input.externalReference.trim() || null, source: "browser_upload" }
          : {},
      encounterId: input.encounterId,
      mimeType,
      patientId: input.patientId,
      scanStatus: defaultLiveMediaScanStatus(),
      sha256Digest
    },
    signal
  );
}

export async function requestLiveMediaView(input: MediaViewInput, signal?: AbortSignal) {
  return postEndpoint(
    `/v1/media/assets/${encodeURIComponent(input.mediaId)}/signed-url`,
    {
      actorName: input.actorName,
      expiresInSeconds: 300,
      purpose: "clinical_review"
    },
    signal
  );
}

export function applyFixtureAddFinding(data: Cp4WorkflowData, input: FindingDraftInput) {
  const createdAt = new Date().toISOString();
  const finding: DentalFinding = {
    authorName: input.actorName,
    authorRole: input.actorRole,
    createdAt,
    encounterId: input.encounterId,
    history: [
      {
        actorName: input.actorName,
        actorRole: input.actorRole,
        at: createdAt,
        detail: `${FINDING_TYPE_LABELS[input.type]} recorded on tooth ${input.toothNumber}.`,
        id: nextFixtureId("cp4-finding-history"),
        kind: "created"
      }
    ],
    id: nextFixtureId("cp4-finding"),
    note: input.note.trim() || "No note entered.",
    patientId: input.patientId,
    reviewState: input.actorRole === "doctor" ? "reviewed" : "needs_doctor_review",
    severity: input.severity,
    status: input.status,
    surfaces: input.surfaces,
    toothNumber: input.toothNumber,
    type: input.type
  };

  return addSnapshot(
    {
      ...data,
      findings: [finding, ...data.findings],
      timeline: prependTimeline(
        data.timeline,
        "dental_finding.created",
        "Dental finding created",
        `${FINDING_TYPE_LABELS[input.type]} recorded on tooth ${input.toothNumber}.`,
        createdAt
      )
    },
    {
      actorName: input.actorName,
      at: createdAt,
      detail: `${FINDING_TYPE_LABELS[input.type]} added for tooth ${input.toothNumber}.`,
      title: "Finding added"
    }
  );
}

export function applyFixtureUpdateFinding(data: Cp4WorkflowData, input: FindingUpdateInput) {
  const updatedAt = new Date().toISOString();
  const finding = data.findings.find((item) => item.id === input.findingId);
  const historyKind: DentalFindingHistoryEntry["kind"] =
    input.status === "reviewed" ? "reviewed" : "updated";

  if (!finding) {
    return data;
  }

  const nextData: Cp4WorkflowData = {
    ...data,
    findings: data.findings.map((item) =>
      item.id === input.findingId
        ? {
            ...item,
            history: [
              {
                actorName: input.actorName,
                actorRole: input.actorRole,
                at: updatedAt,
                detail: `Status changed to ${FINDING_STATUS_LABELS[input.status]}.`,
                id: nextFixtureId("cp4-finding-history"),
                kind: historyKind
              },
              ...item.history
            ],
            note: input.note.trim() || item.note,
            reviewState: input.status === "reviewed" ? "reviewed" : item.reviewState,
            status: input.status,
            updatedAt
          }
        : item
    ),
    timeline: prependTimeline(
      data.timeline,
      "dental_finding.updated",
      "Dental finding updated",
      `Tooth ${finding.toothNumber} finding status changed to ${FINDING_STATUS_LABELS[input.status]}.`,
      updatedAt
    )
  };

  return addSnapshot(nextData, {
    actorName: input.actorName,
    at: updatedAt,
    detail: `Finding on tooth ${finding.toothNumber} updated.`,
    title: "Finding updated"
  });
}

export function applyFixtureAttachMedia(data: Cp4WorkflowData, input: MediaAttachInput) {
  const attachedAt = new Date().toISOString();
  const mediaId = nextFixtureId("cp4-media");
  const context = buildMediaContext(input);
  const displayName =
    input.file?.name ??
    input.externalReference.trim() ??
    `${MEDIA_KIND_LABELS[input.kind]} ${mediaId}`;
  const asset: MediaAsset = {
    attachedAt,
    context,
    createdBy: input.actorName,
    displayName,
    id: mediaId,
    kind: input.kind,
    referenceLabel:
      input.externalReference.trim() ||
      "Local fixture upload completion; no object storage key is exposed.",
    tag: input.tag
  };

  const linkedFinding =
    context.findingId && data.findings.find((finding) => finding.id === context.findingId);
  const mediaLinkedHistory: DentalFindingHistoryEntry = {
    actorName: input.actorName,
    actorRole: input.actorRole,
    at: attachedAt,
    detail: `${MEDIA_KIND_LABELS[input.kind]} linked to this finding.`,
    id: nextFixtureId("cp4-finding-history"),
    kind: "media_linked"
  };
  const nextFindings = linkedFinding
    ? data.findings.map((finding) =>
        finding.id === linkedFinding.id
          ? {
              ...finding,
              history: [mediaLinkedHistory, ...finding.history]
            }
          : finding
      )
    : data.findings;

  return addSnapshot(
    {
      ...data,
      findings: nextFindings,
      mediaAssets: [asset, ...data.mediaAssets],
      timeline: prependTimeline(
        prependTimeline(
          data.timeline,
          "media.created",
          "Media metadata created",
          `${MEDIA_KIND_LABELS[input.kind]} metadata created through the CP4 provider boundary.`,
          attachedAt
        ),
        "media.linked",
        "Media linked",
        `${MEDIA_KIND_LABELS[input.kind]} linked to ${formatMediaTarget(context)}.`,
        attachedAt
      )
    },
    {
      actorName: input.actorName,
      at: attachedAt,
      detail: `${MEDIA_KIND_LABELS[input.kind]} linked to ${formatMediaTarget(context)}.`,
      title: "Media linked"
    }
  );
}

export function applyFixtureViewMedia(data: Cp4WorkflowData, input: MediaViewInput) {
  const viewedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  const asset = data.mediaAssets.find((item) => item.id === input.mediaId);

  if (!asset) {
    return data;
  }

  return {
    ...data,
    mediaAssets: data.mediaAssets.map((item) =>
      item.id === input.mediaId
        ? {
            ...item,
            lastViewedAt: viewedAt,
            signedAccess: {
              expiresAt,
              state: "issued" as const
            }
          }
        : item
    ),
    timeline: prependTimeline(
      data.timeline,
      "media.viewed",
      "Media viewed",
      `${asset.displayName} viewed through mediated signed access.`,
      viewedAt
    )
  };
}

export function classifyCp4EndpointFailures(failures: Cp4EndpointIssue[]): Cp4WorkflowProblem {
  const hasAuthFailure = failures.some(
    (failure) => failure.status === 401 || failure.status === 403
  );
  const hasMissingEndpoint = failures.some((failure) => failure.status === 404);
  const hasServerFailure = failures.some((failure) => failure.status && failure.status >= 500);

  if (hasAuthFailure) {
    return {
      code: "AUTH_REQUIRED",
      endpoints: failures,
      message: "Sign in through the configured identity provider before opening CP4 workflows."
    };
  }

  if (hasMissingEndpoint) {
    return {
      code: "CP4_ENDPOINT_NOT_REGISTERED",
      endpoints: failures,
      message: "One or more CP4 workflow endpoints are not registered in this environment."
    };
  }

  if (hasServerFailure) {
    return {
      code: "SERVER_ERROR",
      endpoints: failures,
      message: "The ClinicOS API is reachable but could not load the CP4 workflow."
    };
  }

  return {
    code: "UNKNOWN",
    endpoints: failures,
    message: "The CP4 workflow API returned an unexpected response."
  };
}

function addSnapshot(
  data: Cp4WorkflowData,
  input: {
    actorName: string;
    at: string;
    detail: string;
    title: string;
  }
): Cp4WorkflowData {
  const snapshot: ChartHistoryEntry = {
    actorName: input.actorName,
    at: input.at,
    detail: input.detail,
    findingCount: data.findings.length,
    id: nextFixtureId("cp4-chart-snapshot"),
    title: input.title
  };

  return {
    ...data,
    chartHistory: [snapshot, ...data.chartHistory],
    timeline: prependTimeline(
      data.timeline,
      "dental_chart.snapshot_created",
      "Chart snapshot created",
      input.detail,
      input.at
    )
  };
}

function buildMediaContext(input: MediaAttachInput): MediaAttachmentContext {
  return {
    encounterId: input.encounterId,
    findingId: input.target === "finding" ? input.findingId : undefined,
    patientId: input.patientId,
    target: input.target,
    toothNumber:
      input.target === "tooth" || input.target === "finding" ? input.toothNumber : undefined
  };
}

function formatMediaTarget(context: MediaAttachmentContext) {
  if (context.target === "finding" && context.findingId) {
    return `finding ${context.findingId}`;
  }

  if (context.target === "tooth" && context.toothNumber) {
    return `tooth ${context.toothNumber}`;
  }

  if (context.target === "encounter") {
    return "the encounter";
  }

  return "the patient";
}

function timelineItem(
  kind: Cp4TimelineItem["kind"],
  title: string,
  detail: string,
  at: string
): Cp4TimelineItem {
  return {
    at,
    detail,
    id: `${kind}-${at}`,
    kind,
    title
  };
}

function prependTimeline(
  items: Cp4TimelineItem[],
  kind: Cp4TimelineItem["kind"],
  title: string,
  detail: string,
  at: string
) {
  return [timelineItem(kind, title, detail, at), ...items].sort(
    (first, second) => Date.parse(second.at) - Date.parse(first.at)
  );
}

function nextFixtureId(prefix: string) {
  fixtureIdCounter += 1;

  return `${prefix}-${fixtureIdCounter}`;
}

function normalizeCp4WorkflowPayload(
  payload: unknown,
  today: string,
  requestId?: string
): Cp4WorkflowData | Cp4WorkflowProblem {
  if (!isRecord(payload)) {
    return {
      code: "CONTRACT_MISMATCH",
      endpoints: CP4_REQUIRED_ENDPOINTS.map((endpoint) => ({
        endpoint,
        message: "The endpoint returned a non-object payload."
      })),
      message: "The CP4 workflow endpoint is reachable but does not match the expected contract."
    };
  }

  const patients = Array.isArray(payload.patients) ? payload.patients.filter(isCp4Patient) : null;
  const encounters = Array.isArray(payload.encounters)
    ? payload.encounters.filter(isCp4Encounter)
    : null;
  const findings = Array.isArray(payload.findings)
    ? payload.findings.filter(isDentalFinding)
    : null;
  const mediaAssets = Array.isArray(payload.mediaAssets)
    ? payload.mediaAssets.filter(isMediaAsset)
    : Array.isArray(payload.media_assets)
      ? payload.media_assets.filter(isMediaAsset)
      : null;
  const chartHistory = Array.isArray(payload.chartHistory)
    ? payload.chartHistory.filter(isChartHistoryEntry)
    : Array.isArray(payload.chart_history)
      ? payload.chart_history.filter(isChartHistoryEntry)
      : null;
  const timeline = Array.isArray(payload.timeline)
    ? payload.timeline.filter(isCp4TimelineItem)
    : null;

  if (!patients || !encounters || !findings || !mediaAssets || !chartHistory || !timeline) {
    return {
      code: "CONTRACT_MISMATCH",
      detail:
        "Expected patients, encounters, findings, mediaAssets, chartHistory, and timeline arrays.",
      endpoints: CP4_REQUIRED_ENDPOINTS.map((endpoint) => ({
        endpoint,
        message: "Contract mismatch"
      })),
      message: "The CP4 workflow endpoint is reachable but missing required workflow data."
    };
  }

  return {
    api: {
      environment: "api",
      requestIds: requestId ? [requestId] : []
    },
    chartHistory,
    encounters,
    findings,
    mediaAssets,
    patients,
    source: "api",
    timeline,
    today
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

function mediaKindToApiMediaType(kind: MediaKind) {
  switch (kind) {
    case "document":
      return "document";
    case "intraoral_photo":
      return "intraoral_photo";
    case "xray":
      return "xray";
    case "external_link":
      throw new Error(
        "Live external imaging references are deferred to the dedicated imaging-link adapter workflow."
      );
  }
}

function defaultLiveMediaScanStatus() {
  const environment = process.env.NEXT_PUBLIC_CLINIC_OS_ENV ?? process.env.NODE_ENV;
  return FIXTURE_ENVIRONMENTS.has(environment ?? "") ? "clean" : "pending";
}

async function sha256DigestForFile(file: File) {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return null;
  }

  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function parseUploadContract(payload: unknown) {
  if (!isRecord(payload)) {
    throw new Error("Media upload URL response did not match the expected contract.");
  }

  const upload = isRecord(payload.upload) ? payload.upload : payload;
  const uploadTarget = isRecord(payload.uploadTarget) ? payload.uploadTarget : payload;
  const uploadId =
    readString(upload, ["id", "uploadId", "upload_id"]) ??
    readString(payload, ["uploadId", "upload_id", "id"]);
  const uploadUrl = readString(uploadTarget, ["uploadUrl", "upload_url", "signedUploadUrl"]);

  if (!uploadId || !uploadUrl) {
    throw new Error("Media upload URL response did not include upload id and upload URL.");
  }

  return {
    requiredHeaders: recordToStringMap(uploadTarget.requiredHeaders),
    uploadId,
    uploadUrl
  };
}

function recordToStringMap(value: unknown) {
  if (!isRecord(value)) return {};

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, entry]) =>
      typeof entry === "string" ? [[key, entry] as const] : []
    )
  );
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
    throw endpointFailureFromResponse(path, response, payload);
  }

  return {
    payload,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

async function postEndpoint(path: string, body: unknown, signal?: AbortSignal) {
  return writeEndpoint("POST", path, body, signal);
}

async function patchEndpoint(path: string, body: unknown, signal?: AbortSignal) {
  return writeEndpoint("PATCH", path, body, signal);
}

async function writeEndpoint(
  method: "PATCH" | "POST",
  path: string,
  body: unknown,
  signal?: AbortSignal
) {
  const response = await fetch(buildWorkflowUrl(path), {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": `web-cp4-${crypto.randomUUID()}`
    },
    method,
    signal
  });
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw endpointFailureFromResponse(path, response, payload);
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
  path: string,
  response: Response,
  payload: unknown
): EndpointFailure {
  return {
    endpoint: `${response.status === 0 ? "FETCH" : "HTTP"} ${path}`,
    message: readErrorMessage(payload) ?? `HTTP ${response.status}`,
    requestId: getRequestId(response, payload),
    status: response.status
  };
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

  const error = payload.error;

  if (typeof payload.message === "string") {
    return payload.message;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return error.message;
  }

  return null;
}

function isEndpointFailure(value: unknown): value is EndpointFailure {
  return typeof value === "object" && value !== null && "endpoint" in value && "message" in value;
}

function isCp4Patient(value: unknown): value is Cp4Patient {
  return isRecord(value) && typeof value.id === "string" && typeof value.displayName === "string";
}

function isCp4Encounter(value: unknown): value is Cp4Encounter {
  return isRecord(value) && typeof value.id === "string" && typeof value.patientId === "string";
}

function isDentalFinding(value: unknown): value is DentalFinding {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.patientId === "string" &&
    typeof value.toothNumber === "string" &&
    Array.isArray(value.surfaces)
  );
}

function isMediaAsset(value: unknown): value is MediaAsset {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.displayName === "string" &&
    isRecord(value.context)
  );
}

function isChartHistoryEntry(value: unknown): value is ChartHistoryEntry {
  return isRecord(value) && typeof value.id === "string" && typeof value.title === "string";
}

function isCp4TimelineItem(value: unknown): value is Cp4TimelineItem {
  return isRecord(value) && typeof value.id === "string" && typeof value.kind === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
