import type { ProviderSecretResolver } from "../../provider-secret-resolver.js";
import type { FireworksHttpTransport } from "./transport.js";

export const FIREWORKS_TASKS = [
  "clinical_structured_draft",
  "clinical_safety_review",
  "bounded_extraction",
  "long_context_summary",
  "retrieval_embedding",
  "retrieval_rerank",
  "speech_quality",
  "speech_low_latency"
] as const;

export type FireworksTask = (typeof FIREWORKS_TASKS)[number];
export type FireworksTextTask = Extract<
  FireworksTask,
  | "clinical_structured_draft"
  | "clinical_safety_review"
  | "bounded_extraction"
  | "long_context_summary"
>;
export type FireworksSpeechTask = Extract<FireworksTask, "speech_quality" | "speech_low_latency">;

export interface FireworksTaskModelConfiguration {
  readonly modelId: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly maximumInputTokens: number;
  readonly maximumOutputTokens: number;
}

export type FireworksModelCatalog = Readonly<
  Record<FireworksTask, FireworksTaskModelConfiguration>
>;

export interface FireworksModelAvailabilityEvidence {
  readonly modelId: string;
  readonly available: boolean;
  readonly checkedAt: string;
  readonly evidenceDigest: string;
}

export interface FireworksClinicalEvaluationEvidence {
  readonly modelId: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly approved: boolean;
  readonly evaluationVersion: string;
  readonly evaluatedAt: string;
  readonly evidenceDigest: string;
}

export interface FireworksActivationConfiguration {
  readonly liveEnabled: boolean;
  readonly serviceAccountSecretRef: string | null;
  readonly serviceAccountId: string | null;
  readonly serviceAccountApproved: boolean;
  readonly dataProcessingAgreementApproved: boolean;
  readonly healthcareContractApproved: boolean;
  readonly noTrainingNoRetentionApproved: boolean;
  readonly residencyApproved: boolean;
  readonly budgetApproved: boolean;
  /** Must come from a fresh activation-time model-list/readiness observation. */
  readonly modelAvailabilityEvidence: Readonly<
    Record<FireworksTask, FireworksModelAvailabilityEvidence>
  >;
  /** Must come from the versioned per-task evaluation harness for the exact configured model. */
  readonly clinicalEvaluationEvidence: Readonly<
    Record<FireworksTask, FireworksClinicalEvaluationEvidence>
  >;
}

export type FireworksReadinessStatus =
  "not_configured" | "policy_blocked" | "ready" | "degraded" | "circuit_open" | "disabled";

export interface FireworksTaskReadiness {
  readonly task: FireworksTask;
  readonly modelId: string;
  readonly status: "approved" | "model_unavailable" | "evaluation_pending";
}

export interface FireworksReadiness {
  readonly provider: "fireworks";
  readonly status: FireworksReadinessStatus;
  readonly operational: boolean;
  readonly reasonCode: string;
  readonly checkedAt: string;
  readonly secretReferenceConfigured: boolean;
  readonly serviceAccountConfigured: boolean;
  readonly tasks: readonly FireworksTaskReadiness[];
}

export interface FireworksClinicalScope {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly patientId: string;
  readonly encounterId: string;
  readonly actorUserId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface FireworksConsentPolicyRequest extends FireworksClinicalScope {
  readonly task: FireworksTask;
  readonly stage: "provider_call";
  readonly evaluatedAt: string;
}

export interface FireworksConsentPolicyDecision {
  readonly allowed: boolean;
  readonly reasonCode: string;
  readonly snapshotDigest: string;
}

export interface FireworksConsentPolicyGate {
  evaluate(input: FireworksConsentPolicyRequest): Promise<FireworksConsentPolicyDecision>;
}

export interface FireworksKillSwitch {
  isKillActive(input: {
    readonly task: FireworksTask;
    readonly checkedAt: string;
  }): Promise<boolean>;
}

export interface FireworksUsageRequest {
  /** Internal RLS/attribution scope. These raw identifiers must never enter metrics or logs. */
  readonly tenantId: string;
  readonly clinicId: string;
  readonly actorUserId: string;
  readonly tenantDigest: string;
  readonly correlationDigest: string;
  readonly requestDigest: string;
  /** Durable usage reservations must use this digest as their idempotency key. */
  readonly idempotencyDigest: string;
  readonly task: FireworksTask;
  readonly estimatedInputTokens: number;
  readonly maximumOutputTokens: number;
  readonly audioBytes: number;
  readonly audioDurationMs: number;
  /** Budget reservations must cover the worst-case configured provider attempts. */
  readonly maximumAttempts: number;
}

export interface FireworksUsageActual {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly audioBytes: number;
  readonly audioDurationMs: number;
}

export interface FireworksUsageSettlement extends FireworksUsageActual {
  /** Includes the successful attempt and every prior received transient response. */
  readonly attemptCount: number;
}

export interface FireworksUsageReservation {
  complete(actual: FireworksUsageSettlement): Promise<void>;
  cancel(): Promise<void>;
  markUncertain(input: {
    readonly reason:
      | "transport_outcome_unknown"
      | "provider_response_usage_unknown"
      | "completion_outcome_unknown";
  }): Promise<void>;
}

export interface FireworksUsageGuard {
  /**
   * Must atomically enforce tenant/clinic budgets, quota and concurrency, and bind the full raw
   * RLS scope plus request digest to idempotencyDigest. No raw scope may enter logs or metrics.
   */
  reserve(input: FireworksUsageRequest): Promise<FireworksUsageReservation>;
}

export interface FireworksMetricEvent {
  readonly provider: "fireworks";
  readonly task: FireworksTask;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly serviceAccountDigest: string | null;
  readonly actorDigest: string;
  readonly tenantDigest: string;
  readonly correlationDigest: string;
  readonly status:
    | "succeeded"
    | "rejected"
    | "unavailable"
    | "provider_outcome_uncertain"
    | "provider_succeeded_persistence_uncertain";
  readonly reasonCode: string;
  readonly attemptCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly audioBytes: number;
  readonly audioDurationMs: number;
  readonly latencyMs: number;
}

export interface FireworksMetricsSink {
  record(event: FireworksMetricEvent): void;
}

export interface FireworksRequestProvenance {
  readonly provider: "fireworks";
  readonly task: FireworksTask;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly serviceAccountDigest: string;
  readonly actorDigest: string;
  readonly tenantDigest: string;
  readonly correlationDigest: string;
  readonly consentSnapshotDigest: string;
  readonly requestDigest: string;
  readonly responseDigest: string;
  readonly providerRequestIdDigest: string | null;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly audioBytes: number;
  readonly audioDurationMs: number;
  readonly latencyMs: number;
  readonly attemptCount: number;
  readonly status: "review_only";
}

export interface FireworksReviewOnlyArtifact {
  readonly task: FireworksTextTask;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly reviewOnly: true;
  readonly summary: string;
  readonly evidence: readonly {
    readonly statement: string;
    readonly sourceAnchorIds: readonly string[];
    readonly confidence: number;
  }[];
  readonly uncertainty: {
    readonly level: "low" | "medium" | "high";
    readonly reasons: readonly string[];
  };
  readonly warnings: readonly string[];
  readonly safety: {
    readonly status: "pass_to_human_review" | "blocked";
    readonly concerns: readonly string[];
  };
  readonly proposedActions: readonly never[];
}

export interface FireworksStructuredRequest extends FireworksClinicalScope {
  readonly task: FireworksTextTask;
  readonly sourceText: string;
  readonly sourceAnchorIds: readonly string[];
  readonly estimatedInputTokens: number;
}

export interface FireworksStructuredResult {
  readonly artifact: FireworksReviewOnlyArtifact;
  readonly provenance: FireworksRequestProvenance;
}

export type FireworksAudioMimeType = "audio/wav" | "audio/flac" | "audio/mpeg" | "audio/mp4";

export interface FireworksTranscriptionRequest extends FireworksClinicalScope {
  readonly task: FireworksSpeechTask;
  readonly source: "authorized_private_media";
  readonly bytes: Uint8Array;
  readonly mimeType: FireworksAudioMimeType;
  readonly durationMs: number;
  readonly durationVerified: true;
  readonly language?: string;
  readonly medicalTermHints?: readonly string[];
}

export interface FireworksTranscriptionWord {
  readonly word: string;
  readonly language: string;
  readonly probability: number;
  readonly hallucinationScore: number;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
}

export interface FireworksTranscriptionSegment {
  readonly id: number;
  readonly text: string;
  readonly language: string;
  readonly startsAtMs: number;
  readonly endsAtMs: number;
  readonly words: readonly FireworksTranscriptionWord[];
}

export interface FireworksTranscriptionResult {
  readonly language: string;
  readonly durationMs: number;
  readonly text: string;
  readonly words: readonly FireworksTranscriptionWord[];
  readonly segments: readonly FireworksTranscriptionSegment[];
  readonly reviewOnly: true;
  readonly provenance: FireworksRequestProvenance;
}

export interface FireworksEmbeddingRequest extends FireworksClinicalScope {
  readonly task: "retrieval_embedding";
  readonly inputs: readonly string[];
  readonly estimatedInputTokens: number;
}

export interface FireworksEmbeddingResult {
  readonly embeddings: readonly (readonly number[])[];
  readonly provenance: FireworksRequestProvenance;
}

export interface FireworksRerankRequest extends FireworksClinicalScope {
  readonly task: "retrieval_rerank";
  readonly query: string;
  readonly documents: readonly string[];
  readonly topN: number;
  readonly estimatedInputTokens: number;
}

export interface FireworksRerankResult {
  readonly results: readonly { readonly index: number; readonly relevanceScore: number }[];
  readonly provenance: FireworksRequestProvenance;
}

export interface FireworksGatewayOptions {
  readonly activation: FireworksActivationConfiguration;
  readonly catalog: FireworksModelCatalog;
  readonly secretResolver: ProviderSecretResolver;
  readonly transport: FireworksHttpTransport;
  readonly consentPolicy: FireworksConsentPolicyGate;
  readonly usageGuard: FireworksUsageGuard;
  readonly killSwitch: FireworksKillSwitch;
  readonly metrics: FireworksMetricsSink;
  readonly maximumAudioBytes?: number;
  readonly maximumAudioDurationMs?: number;
  readonly timeoutMs?: number;
  readonly maximumAttempts?: number;
  readonly modelAvailabilityMaximumAgeMs?: number;
  readonly circuitFailureThreshold?: number;
  readonly circuitOpenMs?: number;
  readonly now: () => Date;
  readonly random?: () => number;
  readonly sleep?: (milliseconds: number) => Promise<void>;
}
