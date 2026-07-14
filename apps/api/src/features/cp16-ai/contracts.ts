import type {
  FireworksClinicalScope,
  FireworksEmbeddingResult,
  FireworksRerankResult,
  FireworksRequestProvenance,
  FireworksStructuredResult,
  FireworksTask,
  FireworksTranscriptionResult
} from "@clinic-os/integrations";

export type Cp16AiProcessingStage = "clinical_processing" | "capture_processing";

export interface Cp16AiProcessingPolicyRequest extends FireworksClinicalScope {
  readonly task: FireworksTask;
  readonly stage: Cp16AiProcessingStage;
  readonly evaluatedAt: string;
}

export interface Cp16AiProcessingPolicyDecision {
  readonly allowed: boolean;
  readonly reasonCode: string;
  readonly snapshotDigest: string;
}

export interface Cp16AiProcessingPolicyGate {
  evaluate(input: Cp16AiProcessingPolicyRequest): Promise<Cp16AiProcessingPolicyDecision>;
}

export type Cp16AiPersistedProviderResult =
  | { readonly kind: "structured"; readonly value: FireworksStructuredResult }
  | { readonly kind: "transcription"; readonly value: FireworksTranscriptionResult }
  | { readonly kind: "embedding"; readonly value: FireworksEmbeddingResult }
  | { readonly kind: "rerank"; readonly value: FireworksRerankResult };

export type Cp16AiProviderResultDisposition = "review_only_ready" | "blocked";

export interface Cp16AiInvocationIdentity extends FireworksClinicalScope {
  readonly task: FireworksTask;
  readonly processingStage: Cp16AiProcessingStage;
  /** Groups all task steps in one application workflow without exposing the caller key. */
  readonly workflowIdempotencyDigest: string;
  /** Shared with the usage guard; unique for tenant + task + caller idempotency key. */
  readonly providerCallIdempotencyDigest: string;
  /** Detects reuse of an idempotency key with different bounded input. */
  readonly requestFingerprint: string;
}

export interface Cp16AiApplicationPolicyEvidence {
  readonly stage: Cp16AiProcessingStage;
  readonly evaluatedAt: string;
  readonly reasonCode: string;
  readonly snapshotDigest: string;
}

export type Cp16AiInvocationClaim =
  | { readonly outcome: "claimed"; readonly invocationId: string }
  | { readonly outcome: "in_progress"; readonly invocationId: string }
  | { readonly outcome: "idempotency_conflict"; readonly invocationId: string }
  | {
      readonly outcome: "completed";
      readonly invocationId: string;
      readonly disposition: Cp16AiProviderResultDisposition;
      readonly result: Cp16AiPersistedProviderResult;
    }
  | {
      readonly outcome: "provider_succeeded_persistence_uncertain";
      readonly invocationId: string;
    }
  | {
      readonly outcome: "provider_outcome_uncertain";
      readonly invocationId: string;
    };

/**
 * Durable implementations own transactions and encrypted PHI storage. `commitProviderResult`
 * must atomically persist the artifact/transcript/retrieval result, every provenance field
 * (including consent/request/response/provider-request digests and usage/attempt/latency), the
 * invocation/job terminal state, an audit row, and its outbox event. It must never log the result.
 *
 * If commit outcome is unknown, `recordProviderSucceededPersistenceUncertain` must first read the
 * same providerCallIdempotencyDigest: preserve a completed commit if present, otherwise upsert the
 * terminal reconciliation state. Neither path may issue another provider call.
 *
 * Every terminal recorder below must atomically update the invocation/job state, append an
 * attributable audit row, and enqueue its reconciliation/operations outbox event under the same
 * tenant + clinic RLS transaction. Replays must compare the entire identity and be idempotent.
 */
export interface Cp16AiInvocationPersistencePort {
  /** Claim must compare the entire identity and return idempotency_conflict on any scope/fingerprint drift. */
  claimInvocation(input: Cp16AiInvocationIdentity): Promise<Cp16AiInvocationClaim>;
  commitProviderResult(input: {
    readonly identity: Cp16AiInvocationIdentity;
    readonly invocationId: string;
    readonly disposition: Cp16AiProviderResultDisposition;
    readonly applicationPolicyEvidence: Cp16AiApplicationPolicyEvidence;
    readonly result: Cp16AiPersistedProviderResult;
    readonly occurredAt: string;
  }): Promise<void>;
  /** For a definitely pre-provider or definitely failed provider path; never an ambiguous dispatch. */
  recordTerminalFailure(input: {
    readonly identity: Cp16AiInvocationIdentity;
    readonly invocationId: string;
    readonly reasonCode: string;
    readonly applicationPolicyEvidence: Cp16AiApplicationPolicyEvidence | null;
    readonly occurredAt: string;
  }): Promise<void>;
  recordProviderSucceededPersistenceUncertain(input: {
    readonly identity: Cp16AiInvocationIdentity;
    readonly invocationId: string;
    readonly provenance: FireworksRequestProvenance;
    readonly applicationPolicyEvidence: Cp16AiApplicationPolicyEvidence;
    readonly reason:
      | "usage_settlement_outcome_unknown"
      | "atomic_result_commit_outcome_unknown";
    readonly occurredAt: string;
  }): Promise<void>;
  /**
   * Records an ambiguous dispatch without provider-success provenance or an artifact. The durable
   * reconciler may investigate provider/billing evidence but must never repeat the provider call.
   */
  recordProviderOutcomeUncertain(input: {
    readonly identity: Cp16AiInvocationIdentity;
    readonly invocationId: string;
    readonly applicationPolicyEvidence: Cp16AiApplicationPolicyEvidence;
    readonly reason: "transport_outcome_unknown";
    readonly occurredAt: string;
  }): Promise<void>;
}

export class Cp16AiApplicationError extends Error {
  readonly code:
    | "POLICY_BLOCKED"
    | "UNSAFE_AI_OUTPUT"
    | "INVALID_RUNTIME"
    | "PERSISTENCE_UNAVAILABLE"
    | "INVOCATION_IN_PROGRESS"
    | "IDEMPOTENCY_CONFLICT"
    | "PROVIDER_OUTCOME_UNCERTAIN"
    | "PROVIDER_SUCCEEDED_PERSISTENCE_UNCERTAIN";

  constructor(code: Cp16AiApplicationError["code"], message: string) {
    super(message);
    this.name = "Cp16AiApplicationError";
    this.code = code;
  }
}
