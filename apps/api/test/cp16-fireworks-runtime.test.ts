import assert from "node:assert/strict";
import test from "node:test";
import { parseClinicOsEnv } from "@clinic-os/config";
import {
  FIREWORKS_TASKS,
  defaultFireworksModelCatalog,
  type FireworksMetricEvent
} from "@clinic-os/integrations";
import {
  activationConfiguration,
  configuredCatalog
} from "../src/providers/cp16/fireworks-runtime.ts";
import { ObservabilityFireworksMetricsSink } from "../src/providers/cp16/fireworks-metrics.ts";

const digest = "a".repeat(64);
const baseCatalog = defaultFireworksModelCatalog();

test("CP16 Fireworks runtime binds activation to exact model, prompt, and schema", () => {
  const config = approvedConfig();
  const catalog = configuredCatalog(config);
  const activation = activationConfiguration(config, catalog);

  assert.equal(activation.liveEnabled, true);
  assert.equal(activation.noTrainingNoRetentionApproved, true);
  assert.equal(activation.budgetApproved, true);
  for (const task of FIREWORKS_TASKS) {
    assert.equal(activation.modelAvailabilityEvidence[task].modelId, catalog[task].modelId);
    assert.equal(activation.modelAvailabilityEvidence[task].available, true);
    assert.equal(activation.clinicalEvaluationEvidence[task].modelId, catalog[task].modelId);
    assert.equal(
      activation.clinicalEvaluationEvidence[task].promptVersion,
      catalog[task].promptVersion
    );
    assert.equal(
      activation.clinicalEvaluationEvidence[task].schemaVersion,
      catalog[task].schemaVersion
    );
    assert.equal(activation.clinicalEvaluationEvidence[task].evaluationVersion, "cp16-ai-eval-v1");
    assert.equal(activation.clinicalEvaluationEvidence[task].approved, true);
  }
});

test("CP16 Fireworks runtime rejects missing, extra, or drifted activation evidence", () => {
  const config = approvedConfig({
    FIREWORKS_MODEL_AVAILABILITY_EVIDENCE_JSON: JSON.stringify({
      ...availabilityEvidence(),
      unreviewed_task: {
        modelId: "unreviewed",
        available: true,
        checkedAt: "2026-07-14T00:00:00.000Z",
        evidenceDigest: digest
      }
    })
  });

  assert.throws(
    () => activationConfiguration(config, configuredCatalog(config)),
    /missing or unreviewed fields/u
  );
});

test("CP16 Fireworks runtime exports bounded PHI-free metrics", () => {
  const calls: unknown[][] = [];
  const sink = new ObservabilityFireworksMetricsSink({
    increment: (...input) => calls.push(["increment", ...input]),
    timing: (...input) => calls.push(["timing", ...input]),
    gauge: (...input) => calls.push(["gauge", ...input])
  });
  sink.record(metricEvent());

  assert.deepEqual(calls[0], [
    "increment",
    "clinic_os.ai.provider_calls",
    1,
    {
      provider: "fireworks",
      task: "clinical_structured_draft",
      status: "succeeded"
    }
  ]);
  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /service-account-digest|tenant-digest|actor-digest/u);
});

function approvedConfig(overrides: Record<string, string> = {}) {
  return parseClinicOsEnv({
    NODE_ENV: "development",
    CLINIC_OS_ENV: "local",
    DATABASE_URL: "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os",
    REDIS_URL: "redis://localhost:6379",
    KEYCLOAK_BASE_URL: "http://localhost:8080",
    KEYCLOAK_REALM: "clinic-os-local",
    KEYCLOAK_CLIENT_ID: "clinic-os-web",
    S3_BUCKET: "clinic-os-local",
    LLM_PROVIDER: "fireworks",
    TRANSCRIPTION_PROVIDER: "fireworks",
    FIREWORKS_API_KEY_SECRET_REF: "clinicos/local/fireworks-inference-key",
    FIREWORKS_SERVICE_ACCOUNT_ID: "clinicos-staging-inference",
    CLINIC_OS_AI_LIVE_CALLS_ENABLED: "true",
    CLINIC_OS_AI_KILL_SWITCH: "false",
    CLINIC_OS_AI_PROVIDER_CONTRACT_APPROVED: "true",
    CLINIC_OS_AI_SERVICE_ACCOUNT_APPROVED: "true",
    CLINIC_OS_AI_DPA_APPROVED: "true",
    CLINIC_OS_AI_HEALTHCARE_CONTRACT_APPROVED: "true",
    CLINIC_OS_AI_NO_TRAINING_APPROVED: "true",
    CLINIC_OS_AI_ZERO_RETENTION_APPROVED: "true",
    CLINIC_OS_AI_DATA_RESIDENCY_APPROVED: "true",
    CLINIC_OS_AI_CLINICAL_EVAL_APPROVED: "true",
    CLINIC_OS_AI_MONTHLY_BUDGET_CENTS: "25000",
    CLINIC_OS_AI_PER_CLINIC_DAILY_BUDGET_CENTS: "1000",
    FIREWORKS_MODEL_AVAILABILITY_EVIDENCE_JSON: JSON.stringify(availabilityEvidence()),
    FIREWORKS_CLINICAL_EVALUATION_EVIDENCE_JSON: JSON.stringify(evaluationEvidence()),
    CLINIC_OS_CP16_PAYLOAD_KMS_KEY_ID:
      "arn:aws:kms:ap-south-1:123456789012:key/11111111-1111-1111-1111-111111111111",
    ...overrides
  });
}

function availabilityEvidence() {
  return Object.fromEntries(
    FIREWORKS_TASKS.map((task) => [
      task,
      {
        modelId: baseCatalog[task].modelId,
        available: true,
        checkedAt: "2026-07-14T00:00:00.000Z",
        evidenceDigest: digest
      }
    ])
  );
}

function evaluationEvidence() {
  return Object.fromEntries(
    FIREWORKS_TASKS.map((task) => [
      task,
      {
        modelId: baseCatalog[task].modelId,
        promptVersion: baseCatalog[task].promptVersion,
        schemaVersion: baseCatalog[task].schemaVersion,
        approved: true,
        evaluationVersion: "cp16-ai-eval-v1",
        evaluatedAt: "2026-07-14T00:00:00.000Z",
        evidenceDigest: digest
      }
    ])
  );
}

function metricEvent(): FireworksMetricEvent {
  return {
    provider: "fireworks",
    task: "clinical_structured_draft",
    modelId: baseCatalog.clinical_structured_draft.modelId,
    promptVersion: baseCatalog.clinical_structured_draft.promptVersion,
    schemaVersion: baseCatalog.clinical_structured_draft.schemaVersion,
    serviceAccountDigest: "service-account-digest",
    actorDigest: "actor-digest",
    tenantDigest: "tenant-digest",
    correlationDigest: "correlation-digest",
    status: "succeeded",
    reasonCode: "review_only",
    attemptCount: 1,
    inputTokens: 10,
    outputTokens: 5,
    audioBytes: 0,
    audioDurationMs: 0,
    latencyMs: 25
  };
}
