import { createHash } from "node:crypto";
import {
  FireworksGatewayError,
  fireworksProviderCallIdempotencyDigest,
  type FireworksClinicalScope,
  type FireworksEmbeddingRequest,
  type FireworksEmbeddingResult,
  type FireworksGatewayPort,
  type FireworksRerankRequest,
  type FireworksRerankResult,
  type FireworksRequestProvenance,
  type FireworksReviewOnlyArtifact,
  type FireworksStructuredRequest,
  type FireworksStructuredResult,
  type FireworksTask,
  type FireworksTranscriptionRequest,
  type FireworksTranscriptionResult
} from "@clinic-os/integrations";
import {
  Cp16AiApplicationError,
  type Cp16AiInvocationIdentity,
  type Cp16AiInvocationClaim,
  type Cp16AiInvocationPersistencePort,
  type Cp16AiApplicationPolicyEvidence,
  type Cp16AiPersistedProviderResult,
  type Cp16AiProcessingPolicyGate,
  type Cp16AiProcessingStage,
  type Cp16AiProviderResultDisposition
} from "./contracts.ts";

type StructuredDraftInput = Omit<FireworksStructuredRequest, "task"> & {
  readonly safetyReviewEstimatedInputTokens: number;
};
type StandaloneReviewOnlyTextRequest = FireworksStructuredRequest & {
  readonly task: "bounded_extraction" | "long_context_summary";
};
type PersistedResultKind = Cp16AiPersistedProviderResult["kind"];
type ValueFor<K extends PersistedResultKind> = Extract<
  Cp16AiPersistedProviderResult,
  { readonly kind: K }
>["value"];
interface Cp16AiProcessingPolicyDecisionWithEvidence {
  readonly allowed: boolean;
  readonly evidence: Cp16AiApplicationPolicyEvidence;
}

export interface Cp16ReviewedClinicalDraft {
  readonly reviewOnly: true;
  readonly draft: FireworksStructuredResult;
  readonly independentSafetyReview: FireworksStructuredResult;
  readonly allowedActions: readonly never[];
  readonly appliedRecordId: null;
}

export class Cp16AiService {
  readonly #gateway: FireworksGatewayPort;
  readonly #processingPolicy: Cp16AiProcessingPolicyGate;
  readonly #persistence: Cp16AiInvocationPersistencePort;
  readonly #now: () => Date;

  constructor(input: {
    readonly gateway: FireworksGatewayPort;
    readonly processingPolicy: Cp16AiProcessingPolicyGate;
    readonly persistence: Cp16AiInvocationPersistencePort;
    readonly now: () => Date;
  }) {
    this.#gateway = input.gateway;
    this.#processingPolicy = input.processingPolicy;
    this.#persistence = input.persistence;
    this.#now = input.now;
  }

  async createReviewedClinicalDraft(
    input: StructuredDraftInput
  ): Promise<Cp16ReviewedClinicalDraft> {
    const draftRequest: FireworksStructuredRequest = {
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      actorUserId: input.actorUserId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      task: "clinical_structured_draft",
      sourceText: input.sourceText,
      sourceAnchorIds: input.sourceAnchorIds,
      estimatedInputTokens: input.estimatedInputTokens
    };
    const draft = await this.#runPersisted({
      kind: "structured",
      task: draftRequest.task,
      stage: "clinical_processing",
      scope: draftRequest,
      requestFingerprint: structuredFingerprint(draftRequest),
      invoke: () => this.#gateway.generateStructured(draftRequest),
      disposition: structuredDisposition
    });

    const safetyRequest: FireworksStructuredRequest = {
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      actorUserId: input.actorUserId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      task: "clinical_safety_review",
      sourceText: JSON.stringify({
        originalSource: input.sourceText,
        candidateDraft: draft.artifact
      }),
      sourceAnchorIds: input.sourceAnchorIds,
      estimatedInputTokens: input.safetyReviewEstimatedInputTokens
    };
    const independentSafetyReview = await this.#runPersisted({
      kind: "structured",
      task: safetyRequest.task,
      stage: "clinical_processing",
      scope: safetyRequest,
      requestFingerprint: structuredFingerprint(safetyRequest),
      invoke: () => this.#gateway.generateStructured(safetyRequest),
      disposition: structuredDisposition
    });

    return Object.freeze({
      reviewOnly: true,
      draft,
      independentSafetyReview,
      allowedActions: Object.freeze([]) as readonly never[],
      appliedRecordId: null
    });
  }

  async processReviewOnlyText(
    input: StandaloneReviewOnlyTextRequest
  ): Promise<FireworksStructuredResult> {
    if (input.task !== "bounded_extraction" && input.task !== "long_context_summary") {
      throw new Cp16AiApplicationError(
        "INVALID_RUNTIME",
        "Clinical draft and safety-review tasks must use the independent review workflow."
      );
    }
    return this.#runPersisted({
      kind: "structured",
      task: input.task,
      stage: "clinical_processing",
      scope: input,
      requestFingerprint: structuredFingerprint(input),
      invoke: () => this.#gateway.generateStructured(input),
      disposition: structuredDisposition
    });
  }

  async transcribeForReview(
    input: FireworksTranscriptionRequest
  ): Promise<FireworksTranscriptionResult> {
    return this.#runPersisted({
      kind: "transcription",
      task: input.task,
      stage: "capture_processing",
      scope: input,
      requestFingerprint: transcriptionFingerprint(input),
      invoke: () => this.#gateway.transcribe(input),
      disposition: (value) => (value.reviewOnly === true ? "review_only_ready" : "blocked")
    });
  }

  async embedForRetrieval(input: FireworksEmbeddingRequest): Promise<FireworksEmbeddingResult> {
    return this.#runPersisted({
      kind: "embedding",
      task: input.task,
      stage: "clinical_processing",
      scope: input,
      requestFingerprint: retrievalFingerprint(input, input.inputs),
      invoke: () => this.#gateway.embed(input),
      disposition: () => "review_only_ready"
    });
  }

  async rerankForRetrieval(input: FireworksRerankRequest): Promise<FireworksRerankResult> {
    return this.#runPersisted({
      kind: "rerank",
      task: input.task,
      stage: "clinical_processing",
      scope: input,
      requestFingerprint: retrievalFingerprint(input, [input.query, ...input.documents]),
      invoke: () => this.#gateway.rerank(input),
      disposition: () => "review_only_ready"
    });
  }

  async #runPersisted<K extends PersistedResultKind>(input: {
    readonly kind: K;
    readonly task: FireworksTask;
    readonly stage: Cp16AiProcessingStage;
    readonly scope: FireworksClinicalScope;
    readonly requestFingerprint: string;
    readonly invoke: () => Promise<ValueFor<K>>;
    readonly disposition: (value: ValueFor<K>) => Cp16AiProviderResultDisposition;
  }): Promise<ValueFor<K>> {
    const identity = invocationIdentity(
      input.scope,
      input.task,
      input.stage,
      input.requestFingerprint
    );
    let claim: Cp16AiInvocationClaim;
    try {
      claim = await this.#persistence.claimInvocation(identity);
    } catch {
      throw new Cp16AiApplicationError(
        "PERSISTENCE_UNAVAILABLE",
        "AI invocation persistence is unavailable; no provider call was made."
      );
    }
    if (claim.outcome === "in_progress") {
      throw new Cp16AiApplicationError(
        "INVOCATION_IN_PROGRESS",
        "AI invocation is already in progress."
      );
    }
    if (claim.outcome === "idempotency_conflict") {
      throw new Cp16AiApplicationError(
        "IDEMPOTENCY_CONFLICT",
        "AI idempotency key conflicts with its original request."
      );
    }
    if (claim.outcome === "provider_succeeded_persistence_uncertain") {
      throw persistenceUncertain();
    }
    if (claim.outcome === "provider_outcome_uncertain") {
      throw providerOutcomeUncertain();
    }

    let policyDecision: Cp16AiProcessingPolicyDecisionWithEvidence;
    try {
      policyDecision = await this.#evaluateProcessingPolicy(input.task, input.stage, input.scope);
    } catch (error) {
      if (claim.outcome === "claimed") {
        await this.#safeTerminalFailure(identity, claim.invocationId, reasonCode(error), null);
      }
      throw error;
    }
    if (!policyDecision.allowed) {
      if (claim.outcome === "claimed") {
        await this.#safeTerminalFailure(
          identity,
          claim.invocationId,
          "policy_blocked",
          policyDecision.evidence
        );
      }
      throw policyBlocked();
    }

    if (claim.outcome === "completed") {
      if (claim.result.kind !== input.kind) {
        throw new Cp16AiApplicationError(
          "IDEMPOTENCY_CONFLICT",
          "AI persisted result type is inconsistent."
        );
      }
      if (claim.disposition === "blocked") throw unsafeOutput();
      return claim.result.value as ValueFor<K>;
    }

    let value: ValueFor<K>;
    try {
      value = await input.invoke();
    } catch (error) {
      if (
        error instanceof FireworksGatewayError &&
        error.code === "provider_succeeded_persistence_uncertain" &&
        error.provenance
      ) {
        await this.#safePersistenceUncertain(
          identity,
          claim.invocationId,
          error.provenance,
          policyDecision.evidence,
          "usage_settlement_outcome_unknown"
        );
        throw persistenceUncertain();
      }
      if (error instanceof FireworksGatewayError && error.code === "provider_outcome_uncertain") {
        await this.#safeProviderOutcomeUncertain(
          identity,
          claim.invocationId,
          policyDecision.evidence
        );
        throw providerOutcomeUncertain();
      }
      await this.#safeTerminalFailure(
        identity,
        claim.invocationId,
        reasonCode(error),
        policyDecision.evidence
      );
      throw error;
    }

    const disposition = input.disposition(value);
    const result = { kind: input.kind, value } as Cp16AiPersistedProviderResult;
    try {
      await this.#persistence.commitProviderResult({
        identity,
        invocationId: claim.invocationId,
        disposition,
        applicationPolicyEvidence: policyDecision.evidence,
        result,
        occurredAt: validNow(this.#now).toISOString()
      });
    } catch {
      await this.#safePersistenceUncertain(
        identity,
        claim.invocationId,
        provenanceOf(value),
        policyDecision.evidence,
        "atomic_result_commit_outcome_unknown"
      );
      throw persistenceUncertain();
    }
    if (disposition === "blocked") throw unsafeOutput();
    return value;
  }

  async #evaluateProcessingPolicy(
    task: FireworksTask,
    stage: Cp16AiProcessingStage,
    scope: FireworksClinicalScope
  ): Promise<Cp16AiProcessingPolicyDecisionWithEvidence> {
    const evaluatedAt = validNow(this.#now).toISOString();
    let decision;
    try {
      decision = await this.#processingPolicy.evaluate({ ...scope, task, stage, evaluatedAt });
    } catch {
      throw new Cp16AiApplicationError(
        "POLICY_BLOCKED",
        "AI consent or processing policy is unavailable."
      );
    }
    if (
      typeof decision.reasonCode !== "string" ||
      !/^[a-z0-9_]{1,64}$/u.test(decision.reasonCode) ||
      !/^[a-f0-9]{64}$/u.test(decision.snapshotDigest)
    ) {
      throw policyBlocked();
    }
    return Object.freeze({
      allowed: decision.allowed,
      evidence: Object.freeze({
        stage,
        evaluatedAt,
        reasonCode: decision.reasonCode,
        snapshotDigest: decision.snapshotDigest
      })
    });
  }

  async #safeTerminalFailure(
    identity: Cp16AiInvocationIdentity,
    invocationId: string,
    code: string,
    applicationPolicyEvidence: Cp16AiApplicationPolicyEvidence | null
  ): Promise<void> {
    try {
      await this.#persistence.recordTerminalFailure({
        identity,
        invocationId,
        reasonCode: /^[a-z0-9_]{1,64}$/u.test(code) ? code : "provider_failure",
        applicationPolicyEvidence,
        occurredAt: validNow(this.#now).toISOString()
      });
    } catch {
      // Preserve the original sanitized failure; the durable claim remains visible for recovery.
    }
  }

  async #safePersistenceUncertain(
    identity: Cp16AiInvocationIdentity,
    invocationId: string,
    provenance: FireworksRequestProvenance,
    applicationPolicyEvidence: Cp16AiApplicationPolicyEvidence,
    reason: "usage_settlement_outcome_unknown" | "atomic_result_commit_outcome_unknown"
  ): Promise<void> {
    try {
      await this.#persistence.recordProviderSucceededPersistenceUncertain({
        identity,
        invocationId,
        provenance,
        applicationPolicyEvidence,
        reason,
        occurredAt: validNow(this.#now).toISOString()
      });
    } catch {
      // Never retry a successful provider call merely because reconciliation persistence failed.
    }
  }

  async #safeProviderOutcomeUncertain(
    identity: Cp16AiInvocationIdentity,
    invocationId: string,
    applicationPolicyEvidence: Cp16AiApplicationPolicyEvidence
  ): Promise<void> {
    try {
      await this.#persistence.recordProviderOutcomeUncertain({
        identity,
        invocationId,
        applicationPolicyEvidence,
        reason: "transport_outcome_unknown",
        occurredAt: validNow(this.#now).toISOString()
      });
    } catch {
      // The durable claim prevents automatic recall even if reconciliation persistence is down.
    }
  }
}

function structuredDisposition(value: FireworksStructuredResult): Cp16AiProviderResultDisposition {
  const artifact: FireworksReviewOnlyArtifact = value.artifact;
  return artifact.reviewOnly === true &&
    Array.isArray(artifact.proposedActions) &&
    artifact.proposedActions.length === 0 &&
    artifact.safety.status !== "blocked"
    ? "review_only_ready"
    : "blocked";
}

function invocationIdentity(
  scope: FireworksClinicalScope,
  task: FireworksTask,
  processingStage: Cp16AiProcessingStage,
  requestFingerprint: string
): Cp16AiInvocationIdentity {
  if (!/^[a-f0-9]{64}$/u.test(requestFingerprint)) {
    throw new Cp16AiApplicationError("INVALID_RUNTIME", "AI request fingerprint is invalid.");
  }
  return Object.freeze({
    tenantId: validIdentifier(scope.tenantId, "tenantId", 128),
    clinicId: validIdentifier(scope.clinicId, "clinicId", 128),
    patientId: validIdentifier(scope.patientId, "patientId", 128),
    encounterId: validIdentifier(scope.encounterId, "encounterId", 128),
    actorUserId: validIdentifier(scope.actorUserId, "actorUserId", 128),
    correlationId: validIdentifier(scope.correlationId, "correlationId", 256),
    idempotencyKey: validIdentifier(scope.idempotencyKey, "idempotencyKey", 256),
    task,
    processingStage,
    workflowIdempotencyDigest: digest(`${scope.tenantId}\0${scope.idempotencyKey}`),
    providerCallIdempotencyDigest: fireworksProviderCallIdempotencyDigest({
      tenantId: scope.tenantId,
      task,
      idempotencyKey: scope.idempotencyKey
    }),
    requestFingerprint
  });
}

function structuredFingerprint(input: FireworksStructuredRequest): string {
  return digest(
    JSON.stringify({
      task: input.task,
      clinicalScopeDigest: clinicalScopeDigest(input),
      sourceDigest: digest(input.sourceText),
      sourceAnchorIds: input.sourceAnchorIds,
      estimatedInputTokens: input.estimatedInputTokens
    })
  );
}

function transcriptionFingerprint(input: FireworksTranscriptionRequest): string {
  return digest(
    JSON.stringify({
      task: input.task,
      clinicalScopeDigest: clinicalScopeDigest(input),
      audioDigest: digest(input.bytes),
      mimeType: input.mimeType,
      durationMs: input.durationMs,
      durationVerified: input.durationVerified,
      language: input.language ?? null,
      medicalTermHintDigests: (input.medicalTermHints ?? []).map((term) => digest(term))
    })
  );
}

function retrievalFingerprint(
  input: FireworksEmbeddingRequest | FireworksRerankRequest,
  values: readonly string[]
): string {
  return digest(
    JSON.stringify({
      task: input.task,
      clinicalScopeDigest: clinicalScopeDigest(input),
      valueDigests: values.map((value) => digest(value)),
      estimatedInputTokens: input.estimatedInputTokens,
      topN: "topN" in input ? input.topN : null
    })
  );
}

function provenanceOf(value: ValueFor<PersistedResultKind>): FireworksRequestProvenance {
  return value.provenance;
}

function clinicalScopeDigest(scope: FireworksClinicalScope): string {
  return digest(
    JSON.stringify({
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: scope.patientId,
      encounterId: scope.encounterId,
      actorUserId: scope.actorUserId
    })
  );
}

function validIdentifier(value: string, field: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[A-Za-z0-9._:@/-]+$/u.test(value)
  ) {
    throw new Cp16AiApplicationError("INVALID_RUNTIME", `AI ${field} is invalid.`);
  }
  return value;
}

function reasonCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { readonly code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_]{1,64}$/u.test(code)) {
      return code.toLowerCase();
    }
  }
  return "provider_failure";
}

function unsafeOutput(): Cp16AiApplicationError {
  return new Cp16AiApplicationError(
    "UNSAFE_AI_OUTPUT",
    "AI output was blocked and cannot enter a clinical workflow."
  );
}

function policyBlocked(): Cp16AiApplicationError {
  return new Cp16AiApplicationError(
    "POLICY_BLOCKED",
    "AI consent or processing policy blocked this operation."
  );
}

function persistenceUncertain(): Cp16AiApplicationError {
  return new Cp16AiApplicationError(
    "PROVIDER_SUCCEEDED_PERSISTENCE_UNCERTAIN",
    "AI provider succeeded but durable persistence requires reconciliation; do not retry."
  );
}

function providerOutcomeUncertain(): Cp16AiApplicationError {
  return new Cp16AiApplicationError(
    "PROVIDER_OUTCOME_UNCERTAIN",
    "AI provider dispatch outcome is uncertain; reconcile before any retry."
  );
}

function validNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Cp16AiApplicationError("INVALID_RUNTIME", "AI policy clock is unavailable.");
  }
  return value;
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
