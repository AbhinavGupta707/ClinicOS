import assert from "node:assert/strict";
import test from "node:test";
import {
  FIREWORKS_DECISION_MODEL_CANDIDATES,
  FireworksGatewayError,
  defaultFireworksModelCatalog,
  type FireworksEmbeddingRequest,
  type FireworksEmbeddingResult,
  type FireworksGatewayPort,
  type FireworksReadiness,
  type FireworksRequestProvenance,
  type FireworksRerankRequest,
  type FireworksRerankResult,
  type FireworksStructuredRequest,
  type FireworksStructuredResult,
  type FireworksTask,
  type FireworksTranscriptionRequest,
  type FireworksTranscriptionResult
} from "../../../packages/integrations/dist/ai-provider.js";
import {
  Cp16AiApplicationError,
  type Cp16AiApplicationPolicyEvidence,
  type Cp16AiInvocationClaim,
  type Cp16AiInvocationIdentity,
  type Cp16AiInvocationPersistencePort,
  type Cp16AiPersistedProviderResult,
  type Cp16AiProviderResultDisposition
} from "../src/features/cp16-ai/contracts.ts";
import { Cp16AiService } from "../src/features/cp16-ai/service.ts";

const APPLICATION_POLICY_DIGEST = "b".repeat(64);
const PROVIDER_POLICY_DIGEST = "a".repeat(64);
const scope = Object.freeze({
  tenantId: "tenant-a",
  clinicId: "clinic-a",
  patientId: "patient-a",
  encounterId: "encounter-a",
  actorUserId: "doctor-a",
  correlationId: "correlation-a",
  idempotencyKey: "ai-job-a"
});

test("CP16 service persists draft and independent review before returning review-only output", async () => {
  const events: string[] = [];
  const persistence = new PersistenceHarness(events);
  const gateway = new GatewayHarness(events);
  const service = createService({ events, persistence, gateway });
  const result = await service.createReviewedClinicalDraft({
    ...scope,
    sourceText: "Synthetic source for a bounded clinical draft.",
    sourceAnchorIds: ["anchor-1"],
    estimatedInputTokens: 20,
    safetyReviewEstimatedInputTokens: 60
  });

  assert.equal(result.reviewOnly, true);
  assert.deepEqual(result.allowedActions, []);
  assert.equal(result.appliedRecordId, null);
  assert.deepEqual(events, [
    "claim:clinical_structured_draft",
    "policy:clinical_structured_draft",
    "provider:clinical_structured_draft",
    "commit:clinical_structured_draft",
    "claim:clinical_safety_review",
    "policy:clinical_safety_review",
    "provider:clinical_safety_review",
    "commit:clinical_safety_review"
  ]);
  assert.equal(persistence.commits.length, 2);
  for (const commit of persistence.commits) {
    assert.equal(commit.identity.actorUserId, "doctor-a");
    assert.equal(commit.identity.processingStage, "clinical_processing");
    assert.match(commit.identity.requestFingerprint, /^[a-f0-9]{64}$/);
    assert.match(commit.identity.providerCallIdempotencyDigest, /^[a-f0-9]{64}$/);
    assert.equal(commit.applicationPolicyEvidence.snapshotDigest, APPLICATION_POLICY_DIGEST);
    assert.equal(commit.applicationPolicyEvidence.reasonCode, "consent_current");
    assert.equal(commit.result.value.provenance.consentSnapshotDigest, PROVIDER_POLICY_DIGEST);
    assert.notEqual(
      commit.applicationPolicyEvidence.snapshotDigest,
      commit.result.value.provenance.consentSnapshotDigest
    );
    assert.equal(commit.disposition, "review_only_ready");
  }
});

test("CP16 completed claims reuse the atomically persisted result without a duplicate provider cost", async () => {
  const events: string[] = [];
  const persistence = new PersistenceHarness(events);
  const gateway = new GatewayHarness(events);
  const service = createService({ events, persistence, gateway });
  const request = structuredRequest("bounded_extraction");
  const first = await service.processReviewOnlyText(request);
  const second = await service.processReviewOnlyText(request);
  assert.deepEqual(second, first);
  assert.equal(gateway.structuredCalls.length, 1);
  assert.equal(events.filter((event) => event === "policy:bounded_extraction").length, 2);
  assert.equal(persistence.commits.length, 1);
});

test("CP16 standalone text processing cannot bypass independent draft safety review", async () => {
  const events: string[] = [];
  const persistence = new PersistenceHarness(events);
  const gateway = new GatewayHarness(events);
  const service = createService({ events, persistence, gateway });
  const bypass = structuredRequest("clinical_structured_draft") as unknown as Parameters<
    typeof service.processReviewOnlyText
  >[0];
  await assert.rejects(
    service.processReviewOnlyText(bypass),
    applicationCode("INVALID_RUNTIME")
  );
  assert.deepEqual(events, []);
  assert.equal(gateway.structuredCalls.length, 0);
});

test("CP16 idempotency reuse with changed PHI fingerprint fails before another provider call", async () => {
  const events: string[] = [];
  const persistence = new PersistenceHarness(events);
  const gateway = new GatewayHarness(events);
  const service = createService({ events, persistence, gateway });
  const original = structuredRequest("long_context_summary", "source one");
  await service.processReviewOnlyText(original);
  await assert.rejects(
    service.processReviewOnlyText({ ...original, patientId: "patient-b" }),
    applicationCode("IDEMPOTENCY_CONFLICT")
  );
  assert.equal(gateway.structuredCalls.length, 1);
});

test("CP16 ambiguous atomic result commit enters terminal reconciliation and never recalls provider", async () => {
  const events: string[] = [];
  const persistence = new PersistenceHarness(events, { failCommit: true });
  const gateway = new GatewayHarness(events);
  const service = createService({ events, persistence, gateway });
  const request = structuredRequest("bounded_extraction");
  await assert.rejects(
    service.processReviewOnlyText(request),
    applicationCode("PROVIDER_SUCCEEDED_PERSISTENCE_UNCERTAIN")
  );
  assert.equal(persistence.uncertain.length, 1);
  assert.equal(persistence.uncertain[0]?.reason, "atomic_result_commit_outcome_unknown");
  assert.equal(persistence.uncertain[0]?.applicationPolicyEvidence.snapshotDigest, APPLICATION_POLICY_DIGEST);
  await assert.rejects(
    service.processReviewOnlyText(request),
    applicationCode("PROVIDER_SUCCEEDED_PERSISTENCE_UNCERTAIN")
  );
  assert.equal(gateway.structuredCalls.length, 1);
});

test("CP16 ambiguous usage settlement preserves sanitized provider success evidence and is non-retryable", async () => {
  const events: string[] = [];
  const persistence = new PersistenceHarness(events);
  const gateway = new GatewayHarness(events, { usageUncertain: true });
  const service = createService({ events, persistence, gateway });
  const request = structuredRequest("bounded_extraction");
  await assert.rejects(
    service.processReviewOnlyText(request),
    applicationCode("PROVIDER_SUCCEEDED_PERSISTENCE_UNCERTAIN")
  );
  assert.equal(persistence.commits.length, 0);
  assert.equal(persistence.uncertain.length, 1);
  assert.equal(persistence.uncertain[0]?.reason, "usage_settlement_outcome_unknown");
  assert.equal(persistence.uncertain[0]?.provenance.status, "review_only");
  await assert.rejects(
    service.processReviewOnlyText(request),
    applicationCode("PROVIDER_SUCCEEDED_PERSISTENCE_UNCERTAIN")
  );
  assert.equal(gateway.structuredCalls.length, 1);
});

test("CP16 ambiguous transport outcome records no provider-success claim and never recalls provider", async () => {
  const events: string[] = [];
  const persistence = new PersistenceHarness(events);
  const gateway = new GatewayHarness(events, { outcomeUncertain: true });
  const service = createService({ events, persistence, gateway });
  const request = structuredRequest("bounded_extraction");
  await assert.rejects(
    service.processReviewOnlyText(request),
    applicationCode("PROVIDER_OUTCOME_UNCERTAIN")
  );
  assert.equal(persistence.commits.length, 0);
  assert.equal(persistence.uncertain.length, 0);
  assert.equal(persistence.outcomeUncertain.length, 1);
  assert.equal(persistence.outcomeUncertain[0]?.reason, "transport_outcome_unknown");
  assert.equal("provenance" in persistence.outcomeUncertain[0]!, false);
  await assert.rejects(
    service.processReviewOnlyText(request),
    applicationCode("PROVIDER_OUTCOME_UNCERTAIN")
  );
  assert.equal(gateway.structuredCalls.length, 1);
});

test("CP16 denied capture policy persists attributable evidence before any STT provider call", async () => {
  const events: string[] = [];
  const persistence = new PersistenceHarness(events);
  const gateway = new GatewayHarness(events);
  const service = createService({ events, persistence, gateway, policyAllowed: false });
  await assert.rejects(
    service.transcribeForReview(audioRequest()),
    applicationCode("POLICY_BLOCKED")
  );
  assert.equal(gateway.transcriptionCalls.length, 0);
  assert.equal(persistence.failures.length, 1);
  assert.equal(persistence.failures[0]?.identity.actorUserId, "doctor-a");
  assert.equal(persistence.failures[0]?.identity.processingStage, "capture_processing");
  assert.equal(persistence.failures[0]?.applicationPolicyEvidence?.snapshotDigest, APPLICATION_POLICY_DIGEST);
  assert.equal(persistence.failures[0]?.reasonCode, "policy_blocked");
});

test("CP16 blocked model output is durably marked blocked and never enters a clinical workflow", async () => {
  const events: string[] = [];
  const persistence = new PersistenceHarness(events);
  const gateway = new GatewayHarness(events, { blockedTask: "clinical_safety_review" });
  const service = createService({ events, persistence, gateway });
  await assert.rejects(
    service.createReviewedClinicalDraft({
      ...scope,
      sourceText: "Synthetic source.",
      sourceAnchorIds: ["anchor-1"],
      estimatedInputTokens: 10,
      safetyReviewEstimatedInputTokens: 30
    }),
    applicationCode("UNSAFE_AI_OUTPUT")
  );
  assert.equal(persistence.commits.length, 2);
  assert.equal(persistence.commits.at(-1)?.disposition, "blocked");
});

class PersistenceHarness implements Cp16AiInvocationPersistencePort {
  readonly events: string[];
  readonly options: { readonly failCommit?: boolean };
  readonly commits: Array<{
    identity: Cp16AiInvocationIdentity;
    invocationId: string;
    disposition: Cp16AiProviderResultDisposition;
    applicationPolicyEvidence: Cp16AiApplicationPolicyEvidence;
    result: Cp16AiPersistedProviderResult;
  }> = [];
  readonly failures: Array<Parameters<Cp16AiInvocationPersistencePort["recordTerminalFailure"]>[0]> = [];
  readonly uncertain: Array<Parameters<Cp16AiInvocationPersistencePort["recordProviderSucceededPersistenceUncertain"]>[0]> = [];
  readonly outcomeUncertain: Array<Parameters<Cp16AiInvocationPersistencePort["recordProviderOutcomeUncertain"]>[0]> = [];
  readonly #records = new Map<string, {
    identity: Cp16AiInvocationIdentity;
    invocationId: string;
    state: "claimed" | "completed" | "failed" | "uncertain" | "outcome_uncertain";
    disposition?: Cp16AiProviderResultDisposition;
    result?: Cp16AiPersistedProviderResult;
  }>();

  constructor(events: string[], options: { readonly failCommit?: boolean } = {}) {
    this.events = events;
    this.options = options;
  }

  async claimInvocation(identity: Cp16AiInvocationIdentity): Promise<Cp16AiInvocationClaim> {
    this.events.push(`claim:${identity.task}`);
    const key = identity.providerCallIdempotencyDigest;
    const existing = this.#records.get(key);
    if (existing) {
      if (existing.identity.requestFingerprint !== identity.requestFingerprint) {
        return { outcome: "idempotency_conflict", invocationId: existing.invocationId };
      }
      if (existing.state === "uncertain") {
        return { outcome: "provider_succeeded_persistence_uncertain", invocationId: existing.invocationId };
      }
      if (existing.state === "outcome_uncertain") {
        return { outcome: "provider_outcome_uncertain", invocationId: existing.invocationId };
      }
      if (existing.state === "completed") {
        return {
          outcome: "completed",
          invocationId: existing.invocationId,
          disposition: existing.disposition!,
          result: existing.result!
        };
      }
      return { outcome: "in_progress", invocationId: existing.invocationId };
    }
    const invocationId = `invocation-${this.#records.size + 1}`;
    this.#records.set(key, { identity, invocationId, state: "claimed" });
    return { outcome: "claimed", invocationId };
  }

  async commitProviderResult(
    input: Parameters<Cp16AiInvocationPersistencePort["commitProviderResult"]>[0]
  ): Promise<void> {
    this.events.push(`commit:${input.identity.task}`);
    if (this.options.failCommit) throw new Error("atomic commit outcome unknown");
    this.commits.push(input);
    const record = this.#records.get(input.identity.providerCallIdempotencyDigest)!;
    record.state = "completed";
    record.disposition = input.disposition;
    record.result = input.result;
  }

  async recordTerminalFailure(
    input: Parameters<Cp16AiInvocationPersistencePort["recordTerminalFailure"]>[0]
  ): Promise<void> {
    this.failures.push(input);
    const record = this.#records.get(input.identity.providerCallIdempotencyDigest)!;
    record.state = "failed";
  }

  async recordProviderSucceededPersistenceUncertain(
    input: Parameters<Cp16AiInvocationPersistencePort["recordProviderSucceededPersistenceUncertain"]>[0]
  ): Promise<void> {
    this.events.push(`uncertain:${input.identity.task}`);
    this.uncertain.push(input);
    const record = this.#records.get(input.identity.providerCallIdempotencyDigest)!;
    if (record.state !== "completed") record.state = "uncertain";
  }

  async recordProviderOutcomeUncertain(
    input: Parameters<Cp16AiInvocationPersistencePort["recordProviderOutcomeUncertain"]>[0]
  ): Promise<void> {
    this.events.push(`outcome-uncertain:${input.identity.task}`);
    this.outcomeUncertain.push(input);
    const record = this.#records.get(input.identity.providerCallIdempotencyDigest)!;
    if (record.state !== "completed") record.state = "outcome_uncertain";
  }
}

class GatewayHarness implements FireworksGatewayPort {
  readonly events: string[];
  readonly options: {
    readonly usageUncertain?: boolean;
    readonly outcomeUncertain?: boolean;
    readonly blockedTask?: FireworksStructuredRequest["task"];
  };
  readonly structuredCalls: FireworksStructuredRequest[] = [];
  readonly transcriptionCalls: FireworksTranscriptionRequest[] = [];

  constructor(
    events: string[],
    options: {
      readonly usageUncertain?: boolean;
      readonly outcomeUncertain?: boolean;
      readonly blockedTask?: FireworksStructuredRequest["task"];
    } = {}
  ) {
    this.events = events;
    this.options = options;
  }

  async readiness(): Promise<FireworksReadiness> {
    throw new Error("not used");
  }

  async generateStructured(input: FireworksStructuredRequest): Promise<FireworksStructuredResult> {
    this.events.push(`provider:${input.task}`);
    this.structuredCalls.push(input);
    const result = structuredResult(input.task, this.options.blockedTask === input.task);
    if (this.options.outcomeUncertain) {
      throw new FireworksGatewayError({
        code: "provider_outcome_uncertain",
        message: "sanitized",
        retryable: false
      });
    }
    if (this.options.usageUncertain) {
      throw new FireworksGatewayError({
        code: "provider_succeeded_persistence_uncertain",
        message: "sanitized",
        retryable: false,
        provenance: result.provenance
      });
    }
    return result;
  }

  async transcribe(input: FireworksTranscriptionRequest): Promise<FireworksTranscriptionResult> {
    this.events.push(`provider:${input.task}`);
    this.transcriptionCalls.push(input);
    return {
      language: "en",
      durationMs: input.durationMs,
      text: "Synthetic transcript",
      words: [],
      segments: [],
      reviewOnly: true,
      provenance: provenance(input.task)
    };
  }

  async embed(_input: FireworksEmbeddingRequest): Promise<FireworksEmbeddingResult> {
    throw new Error("not used");
  }

  async rerank(_input: FireworksRerankRequest): Promise<FireworksRerankResult> {
    throw new Error("not used");
  }
}

function createService(input: {
  events: string[];
  persistence: PersistenceHarness;
  gateway: GatewayHarness;
  policyAllowed?: boolean;
}) {
  return new Cp16AiService({
    gateway: input.gateway,
    persistence: input.persistence,
    processingPolicy: {
      async evaluate(request) {
        input.events.push(`policy:${request.task}`);
        return {
          allowed: input.policyAllowed ?? true,
          reasonCode: input.policyAllowed === false ? "consent_revoked" : "consent_current",
          snapshotDigest: APPLICATION_POLICY_DIGEST
        };
      }
    },
    now: () => new Date("2026-07-14T10:00:00.000Z")
  });
}

function structuredRequest<T extends FireworksStructuredRequest["task"]>(
  task: T,
  sourceText = "Synthetic source."
): FireworksStructuredRequest & { readonly task: T } {
  return {
    ...scope,
    task,
    sourceText,
    sourceAnchorIds: ["anchor-1"],
    estimatedInputTokens: 10
  };
}

function structuredResult(
  task: FireworksStructuredRequest["task"],
  blocked = false
): FireworksStructuredResult {
  const config = defaultFireworksModelCatalog()[task];
  return {
    artifact: {
      task,
      promptVersion: config.promptVersion,
      schemaVersion: config.schemaVersion,
      reviewOnly: true,
      summary: "Synthetic summary.",
      evidence: [{ statement: "Fact.", sourceAnchorIds: ["anchor-1"], confidence: 0.9 }],
      uncertainty: { level: "low", reasons: [] },
      warnings: [],
      safety: { status: blocked ? "blocked" : "pass_to_human_review", concerns: blocked ? ["unsafe"] : [] },
      proposedActions: []
    },
    provenance: provenance(task)
  };
}

function provenance(task: FireworksTask): FireworksRequestProvenance {
  const config = defaultFireworksModelCatalog()[task];
  return {
    provider: "fireworks",
    task,
    modelId: FIREWORKS_DECISION_MODEL_CANDIDATES[task],
    promptVersion: config.promptVersion,
    schemaVersion: config.schemaVersion,
    serviceAccountDigest: "1".repeat(64),
    actorDigest: "2".repeat(64),
    tenantDigest: "3".repeat(64),
    correlationDigest: "4".repeat(64),
    consentSnapshotDigest: PROVIDER_POLICY_DIGEST,
    requestDigest: "5".repeat(64),
    responseDigest: "6".repeat(64),
    providerRequestIdDigest: "7".repeat(64),
    inputTokens: 10,
    outputTokens: 20,
    audioBytes: 0,
    audioDurationMs: 0,
    latencyMs: 30,
    attemptCount: 1,
    status: "review_only"
  };
}

function audioRequest(): FireworksTranscriptionRequest {
  const bytes = Buffer.alloc(44);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WAVE", 8, "ascii");
  return {
    ...scope,
    task: "speech_quality",
    source: "authorized_private_media",
    bytes,
    mimeType: "audio/wav",
    durationMs: 1_000,
    durationVerified: true
  };
}

function applicationCode(code: Cp16AiApplicationError["code"]): (error: unknown) => boolean {
  return (error: unknown) => error instanceof Cp16AiApplicationError && error.code === code;
}
