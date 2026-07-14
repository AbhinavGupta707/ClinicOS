import { createHash } from "node:crypto";
import type { AdapterCapability, ProviderHealth } from "./provider-contracts.js";

export * from "./cp16/fireworks/audio.js";
export * from "./cp16/fireworks/catalog.js";
export * from "./cp16/fireworks/errors.js";
export * from "./cp16/fireworks/gateway.js";
export * from "./cp16/fireworks/structured-output.js";
export * from "./cp16/fireworks/transport.js";
export * from "./cp16/fireworks/types.js";

export type AiGatewayProviderKey = "simulator" | "unconfigured" | "live_disabled";
export type AiGatewayProviderMode = "simulator" | "unconfigured" | "live_disabled" | "live";
export type UUID = string;
export interface AiGatewayTranscriptSegment {
  readonly id: UUID;
  readonly sequence: number;
  readonly speakerRole: "doctor" | "assistant" | "patient" | "unknown";
  readonly text: string;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
}

export interface AiGatewayDraftRequest {
  readonly tenantId: UUID;
  readonly clinicId: UUID;
  readonly patientId: UUID;
  readonly encounterId: UUID;
  readonly actorUserId: UUID;
  readonly sessionId: UUID;
  readonly segments: readonly AiGatewayTranscriptSegment[];
  readonly sourceAnchorIds: readonly UUID[];
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface AiGatewayDraftResult {
  readonly providerMode: AiGatewayProviderMode;
  readonly providerKey: AiGatewayProviderKey | string;
  readonly providerRequestDigest: string;
  readonly clinicalNoteDraft: {
    readonly content: {
      readonly chiefComplaint?: string;
      readonly history?: string;
      readonly examination?: string;
      readonly assessment?: string;
      readonly treatmentPlan?: string;
      readonly followUpInstructions?: string;
      readonly confidence: number;
      readonly requiresDoctorAttention: string[];
    };
    readonly confidence: number;
    readonly warnings: string[];
    readonly sourceAnchorIds: readonly UUID[];
  };
  readonly dentalChartPatchDraft: {
    readonly content: {
      readonly encounterId: UUID;
      readonly findings: Array<{
        readonly toothNumber: string;
        readonly findingType: string;
        readonly status: "active" | "watch" | "treated" | "historical";
        readonly confidence: number;
        readonly description: string;
        readonly sourceAnchorIds: readonly UUID[];
      }>;
      readonly warnings: string[];
    };
    readonly confidence: number;
    readonly warnings: string[];
    readonly sourceAnchorIds: readonly UUID[];
  };
  readonly actionProposals: Array<{
    readonly proposalType: "create_task";
    readonly title: string;
    readonly description: string;
    readonly proposedPayload: Record<string, unknown>;
    readonly requiredPermission: "task.manage";
    readonly sourceAnchorIds: readonly UUID[];
  }>;
}

export interface AiGatewayProvider {
  readonly providerKey: AiGatewayProviderKey | string;
  readonly providerMode: AiGatewayProviderMode;
  capabilities(): readonly AdapterCapability[];
  healthCheck(): Promise<ProviderHealth>;
  generateDrafts(request: AiGatewayDraftRequest): Promise<AiGatewayDraftResult>;
}

export class AiGatewayProviderError extends Error {
  readonly providerKey: string;
  readonly status: "not_configured" | "unavailable";
  readonly details: Record<string, unknown>;

  constructor(input: {
    providerKey: string;
    status: AiGatewayProviderError["status"];
    message: string;
    details?: Record<string, unknown>;
  }) {
    super(input.message);
    this.name = "AiGatewayProviderError";
    this.providerKey = input.providerKey;
    this.status = input.status;
    this.details = input.details ?? {};
  }
}

export class DeterministicAiGatewaySimulator implements AiGatewayProvider {
  readonly providerKey = "simulator";
  readonly providerMode = "simulator";
  readonly #now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.#now = options.now ?? (() => new Date());
  }

  capabilities(): readonly AdapterCapability[] {
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerKey: "ai_gateway",
      status: "available",
      checkedAt: this.#now().toISOString(),
      capabilities: [],
      message: "Deterministic local AI simulator is active. No live AI/STT provider calls are made."
    };
  }

  async generateDrafts(request: AiGatewayDraftRequest): Promise<AiGatewayDraftResult> {
    const orderedSegments = [...request.segments].sort(
      (left, right) => left.sequence - right.sequence
    );
    if (orderedSegments.length === 0) {
      throw new AiGatewayProviderError({
        providerKey: this.providerKey,
        status: "unavailable",
        message: "Transcript segments are required before simulator draft generation."
      });
    }

    const allText = orderedSegments.map((segment) => segment.text.trim()).join(" ");
    const primaryAnchorIds = request.sourceAnchorIds.slice(
      0,
      Math.max(1, request.sourceAnchorIds.length)
    );
    const firstAnchor = primaryAnchorIds[0];
    const lower = allText.toLowerCase();
    const toothNumber = lower.includes("36") ? "36" : lower.includes("46") ? "46" : "16";
    const complaint = sentenceOrDefault(
      orderedSegments[0]?.text,
      "Patient reported dental discomfort."
    );
    const findingText = lower.includes("caries")
      ? "Caries mentioned in the consultation transcript."
      : "Tooth-level concern mentioned in the consultation transcript.";

    return {
      providerMode: this.providerMode,
      providerKey: this.providerKey,
      providerRequestDigest: digest({
        patientId: request.patientId,
        encounterId: request.encounterId,
        sessionId: request.sessionId,
        segments: orderedSegments.map((segment) => ({
          id: segment.id,
          sequence: segment.sequence,
          textDigest: digest(segment.text)
        }))
      }),
      clinicalNoteDraft: {
        content: {
          chiefComplaint: complaint,
          history: "Draft generated from consented transcript segments.",
          examination: findingText,
          assessment: "Review required before this draft can become part of the clinical record.",
          treatmentPlan: "Doctor to review transcript anchors and finalize plan.",
          followUpInstructions: "Review-only AI draft; no patient communication has been sent.",
          confidence: 0.74,
          requiresDoctorAttention: ["Verify tooth number and diagnosis before signing."]
        },
        confidence: 0.74,
        warnings: ["Simulator output is deterministic and review-only."],
        sourceAnchorIds: firstAnchor ? [firstAnchor] : []
      },
      dentalChartPatchDraft: {
        content: {
          encounterId: request.encounterId,
          findings: [
            {
              toothNumber,
              findingType: lower.includes("caries") ? "caries" : "other",
              status: "active",
              confidence: 0.68,
              description: findingText,
              sourceAnchorIds: firstAnchor ? [firstAnchor] : []
            }
          ],
          warnings: ["Dental chart patch is not applied until reviewed in the chart workflow."]
        },
        confidence: 0.68,
        warnings: ["Verify tooth and finding before applying any chart change."],
        sourceAnchorIds: firstAnchor ? [firstAnchor] : []
      },
      actionProposals: [
        {
          proposalType: "create_task",
          title: "Review AI scribe draft",
          description: "Doctor or assistant should review the AI draft and transcript anchors.",
          proposedPayload: {
            taskType: "clinical_follow_up",
            sourceWorkflow: "ai_scribe",
            title: "Review AI scribe draft",
            description: "Review-only proposal generated by deterministic simulator."
          },
          requiredPermission: "task.manage",
          sourceAnchorIds: firstAnchor ? [firstAnchor] : []
        }
      ]
    };
  }
}

export class UnavailableAiGatewayProvider implements AiGatewayProvider {
  readonly providerMode: AiGatewayProviderMode;
  readonly providerKey: AiGatewayProviderKey;
  readonly #message: string;
  readonly #now: () => Date;

  constructor(input: {
    providerKey: AiGatewayProviderKey;
    providerMode?: AiGatewayProviderMode;
    message: string;
    now?: () => Date;
  }) {
    this.providerKey = input.providerKey;
    this.providerMode = input.providerMode ?? input.providerKey;
    this.#message = input.message;
    this.#now = input.now ?? (() => new Date());
  }

  capabilities(): readonly AdapterCapability[] {
    return [];
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerKey: "ai_gateway",
      status: this.providerKey === "unconfigured" ? "not_configured" : "unavailable",
      checkedAt: this.#now().toISOString(),
      capabilities: [],
      message: this.#message
    };
  }

  async generateDrafts(): Promise<AiGatewayDraftResult> {
    throw new AiGatewayProviderError({
      providerKey: this.providerKey,
      status: this.providerKey === "unconfigured" ? "not_configured" : "unavailable",
      message: this.#message
    });
  }
}

export function createAiGatewayProvider(
  input: {
    llmProvider?: string | null;
    transcriptionProvider?: string | null;
    liveCallsEnabled?: boolean;
    openaiApiKey?: string | null;
    fireworksApiKey?: string | null;
    deepgramApiKey?: string | null;
    dataResidencyApproved?: boolean;
    now?: () => Date;
  } = {}
): AiGatewayProvider {
  const llmProvider = input.llmProvider ?? "simulator";
  const transcriptionProvider = input.transcriptionProvider ?? "simulator";

  if (llmProvider === "simulator" && transcriptionProvider === "simulator") {
    return new DeterministicAiGatewaySimulator({ now: input.now });
  }

  if (llmProvider === "unconfigured" || transcriptionProvider === "unconfigured") {
    return new UnavailableAiGatewayProvider({
      providerKey: "unconfigured",
      message:
        "AI gateway is not configured. Use simulator mode or complete provider/data-residency activation.",
      now: input.now
    });
  }

  if (!input.liveCallsEnabled || !input.dataResidencyApproved) {
    return new UnavailableAiGatewayProvider({
      providerKey: "live_disabled",
      providerMode: "live_disabled",
      message:
        "Live AI/STT calls are disabled until credentials, no-training/no-retention posture, and data residency are approved.",
      now: input.now
    });
  }

  const hasCredential =
    (llmProvider === "openai" && nonEmpty(input.openaiApiKey)) ||
    (llmProvider === "fireworks" && nonEmpty(input.fireworksApiKey));
  const hasTranscriptionCredential =
    transcriptionProvider === "openai"
      ? nonEmpty(input.openaiApiKey)
      : transcriptionProvider === "deepgram"
        ? nonEmpty(input.deepgramApiKey)
        : false;

  if (!hasCredential || !hasTranscriptionCredential) {
    return new UnavailableAiGatewayProvider({
      providerKey: "unconfigured",
      message: "Live AI/STT provider credentials are incomplete.",
      now: input.now
    });
  }

  return new UnavailableAiGatewayProvider({
    providerKey: "live_disabled",
    providerMode: "live_disabled",
    message:
      "Live AI gateway adapter is intentionally not active in CP8; simulator is the only executable provider.",
    now: input.now
  });
}

function sentenceOrDefault(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed.endsWith(".") ? trimmed : `${trimmed}.`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
