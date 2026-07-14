import { DescribeKeyCommand, KMSClient } from "@aws-sdk/client-kms";
import type { ClinicOsConfig } from "@clinic-os/config";
import {
  FIREWORKS_REQUIRED_CLINICAL_EVALUATION_VERSION,
  FIREWORKS_TASKS,
  FetchFireworksHttpTransport,
  FireworksGateway,
  createAwsProviderSecretResolver,
  createFireworksModelCatalog,
  defaultFireworksModelCatalog,
  type FireworksActivationConfiguration,
  type FireworksClinicalEvaluationEvidence,
  type FireworksModelAvailabilityEvidence,
  type FireworksModelCatalog,
  type FireworksTask
} from "@clinic-os/integrations";
import { createConsoleMetricRecorder, type MetricRecorder } from "@clinic-os/observability";
import type { ApiDependencyProbe } from "../../health.ts";
import { Cp16AiService } from "../../features/cp16-ai/index.ts";
import { FireworksAiGatewayProvider } from "./fireworks-ai-gateway-provider.ts";
import { ObservabilityFireworksMetricsSink } from "./fireworks-metrics.ts";
import { PostgresCp16AiInvocationPersistence } from "./postgres-ai-invocations.ts";
import { PostgresCp16AiPolicyGate } from "./postgres-ai-policy.ts";
import type { Cp16AiUnitOfWork } from "./postgres-ai-shared.ts";
import { PostgresFireworksUsageGuard } from "./postgres-ai-usage.ts";
import { AwsKmsCp16ProtectedPayloadCodec, type Cp16KmsCommandSender } from "./protected-payload.ts";

export interface Cp16FireworksRuntime {
  readonly provider: FireworksAiGatewayProvider;
  readonly probes: readonly ApiDependencyProbe[];
}

/**
 * Registers the live provider only after configuration has passed the global fail-closed schema.
 * With live calls disabled the caller must preserve the existing honest unavailable provider.
 */
export function createCp16FireworksRuntime(input: {
  readonly config: ClinicOsConfig;
  readonly unitOfWork: Cp16AiUnitOfWork;
  readonly metrics?: MetricRecorder;
  readonly now?: () => Date;
}): Cp16FireworksRuntime | null {
  const configuration = input.config.providers.ai;
  if (!configuration.activation.liveCallsEnabled) return null;
  if (
    configuration.llmProvider !== "fireworks" ||
    configuration.transcriptionProvider !== "fireworks"
  ) {
    throw new Error("CP16 live AI requires Fireworks for both LLM and transcription.");
  }
  const keyId = input.config.interoperability?.payloadKmsKeyId;
  if (!keyId) throw new Error("CP16 live AI requires the protected-payload KMS key.");

  const now = input.now ?? (() => new Date());
  const catalog = configuredCatalog(input.config);
  const activation = activationConfiguration(input.config, catalog);
  const kms = new KMSClient({ region: input.config.storage.region });
  const payloads = new AwsKmsCp16ProtectedPayloadCodec({
    kms: kms as unknown as Cp16KmsCommandSender,
    keyId
  });
  const policy = new PostgresCp16AiPolicyGate(input.unitOfWork);
  const usage = new PostgresFireworksUsageGuard({
    unitOfWork: input.unitOfWork,
    catalog,
    monthlyBudgetCents: configuration.limits.monthlyBudgetCents,
    perClinicDailyBudgetCents: configuration.limits.perClinicDailyBudgetCents,
    now
  });
  const metrics = new ObservabilityFireworksMetricsSink(
    input.metrics ?? createConsoleMetricRecorder()
  );
  const gateway = new FireworksGateway({
    activation,
    catalog,
    secretResolver: createAwsProviderSecretResolver({ region: input.config.storage.region }),
    transport: new FetchFireworksHttpTransport(),
    consentPolicy: policy,
    usageGuard: usage,
    killSwitch: {
      isKillActive: async () => configuration.activation.killSwitch
    },
    metrics,
    maximumAudioBytes: configuration.limits.maxAudioBytes,
    maximumAudioDurationMs: configuration.limits.maxAudioDurationSeconds * 1_000,
    maximumAttempts: configuration.limits.maxAttempts,
    now
  });
  const persistence = new PostgresCp16AiInvocationPersistence({
    unitOfWork: input.unitOfWork,
    payloads,
    now
  });
  const service = new Cp16AiService({ gateway, processingPolicy: policy, persistence, now });
  return {
    provider: new FireworksAiGatewayProvider({ gateway, service }),
    probes: [
      {
        name: "cp16_fireworks_gateway",
        required: true,
        async check() {
          const readiness = await gateway.readiness();
          if (!readiness.operational) {
            throw new Error(`Fireworks gateway is not ready: ${readiness.reasonCode}.`);
          }
        }
      },
      {
        name: "cp16_ai_payload_kms",
        required: true,
        async check() {
          const result = await kms.send(new DescribeKeyCommand({ KeyId: keyId }));
          if (!result.KeyMetadata?.Enabled) {
            throw new Error("CP16 AI protected-payload KMS key is unavailable.");
          }
        }
      }
    ]
  };
}

export function configuredCatalog(config: ClinicOsConfig): FireworksModelCatalog {
  const base = defaultFireworksModelCatalog();
  const models = config.providers.ai.fireworks.models;
  const configuredModels: Readonly<Record<FireworksTask, string>> = {
    clinical_structured_draft: models.clinicalStructuredDraft,
    clinical_safety_review: models.clinicalSafetyReview,
    bounded_extraction: models.boundedExtraction,
    long_context_summary: models.longContextSummary,
    retrieval_embedding: models.retrievalEmbedding,
    retrieval_rerank: models.retrievalRerank,
    speech_quality: models.speechQuality,
    speech_low_latency: models.speechLowLatency
  };
  return createFireworksModelCatalog(
    Object.fromEntries(
      FIREWORKS_TASKS.map((task) => [
        task,
        {
          ...base[task],
          modelId: configuredModels[task],
          maximumInputTokens: Math.min(
            base[task].maximumInputTokens,
            config.providers.ai.limits.maxInputTokens
          ),
          maximumOutputTokens: Math.min(
            base[task].maximumOutputTokens,
            config.providers.ai.limits.maxOutputTokens
          )
        }
      ])
    ) as Record<FireworksTask, FireworksModelCatalog[FireworksTask]>
  );
}

export function activationConfiguration(
  config: ClinicOsConfig,
  catalog: FireworksModelCatalog
): FireworksActivationConfiguration {
  const ai = config.providers.ai;
  return Object.freeze({
    liveEnabled: ai.activation.liveCallsEnabled,
    serviceAccountSecretRef: ai.fireworksApiKeySecretRef ?? null,
    serviceAccountId: ai.fireworksServiceAccountId ?? null,
    serviceAccountApproved: ai.activation.serviceAccountApproved,
    dataProcessingAgreementApproved: ai.activation.dataProcessingAgreementApproved,
    healthcareContractApproved: ai.activation.healthcareContractApproved,
    noTrainingNoRetentionApproved:
      ai.activation.providerContractApproved &&
      ai.activation.noTrainingApproved &&
      ai.activation.zeroRetentionApproved,
    residencyApproved: ai.activation.dataResidencyApproved,
    budgetApproved: ai.limits.monthlyBudgetCents > 0 && ai.limits.perClinicDailyBudgetCents > 0,
    modelAvailabilityEvidence: parseAvailabilityEvidence(
      ai.fireworks.modelAvailabilityEvidenceJson,
      catalog
    ),
    clinicalEvaluationEvidence: parseEvaluationEvidence(
      ai.fireworks.clinicalEvaluationEvidenceJson,
      catalog,
      ai.activation.clinicalEvalApproved
    )
  });
}

function parseAvailabilityEvidence(
  raw: string | undefined,
  catalog: FireworksModelCatalog
): Readonly<Record<FireworksTask, FireworksModelAvailabilityEvidence>> {
  const record = strictTaskRecord(raw, "model availability");
  return Object.freeze(
    Object.fromEntries(
      FIREWORKS_TASKS.map((task) => {
        const value = strictObject(record[task], `model availability ${task}`);
        assertExactKeys(value, ["available", "checkedAt", "evidenceDigest", "modelId"]);
        const evidence: FireworksModelAvailabilityEvidence = {
          modelId: exactString(value.modelId, catalog[task].modelId),
          available: exactBoolean(value.available),
          checkedAt: canonicalInstant(value.checkedAt),
          evidenceDigest: sha256Digest(value.evidenceDigest)
        };
        return [task, Object.freeze(evidence)];
      })
    ) as Record<FireworksTask, FireworksModelAvailabilityEvidence>
  );
}

function parseEvaluationEvidence(
  raw: string | undefined,
  catalog: FireworksModelCatalog,
  globallyApproved: boolean
): Readonly<Record<FireworksTask, FireworksClinicalEvaluationEvidence>> {
  const record = strictTaskRecord(raw, "clinical evaluation");
  return Object.freeze(
    Object.fromEntries(
      FIREWORKS_TASKS.map((task) => {
        const value = strictObject(record[task], `clinical evaluation ${task}`);
        assertExactKeys(value, [
          "approved",
          "evaluatedAt",
          "evaluationVersion",
          "evidenceDigest",
          "modelId",
          "promptVersion",
          "schemaVersion"
        ]);
        const evidence: FireworksClinicalEvaluationEvidence = {
          modelId: exactString(value.modelId, catalog[task].modelId),
          promptVersion: exactString(value.promptVersion, catalog[task].promptVersion),
          schemaVersion: exactString(value.schemaVersion, catalog[task].schemaVersion),
          approved: globallyApproved && exactBoolean(value.approved),
          evaluationVersion: exactString(
            value.evaluationVersion,
            FIREWORKS_REQUIRED_CLINICAL_EVALUATION_VERSION
          ),
          evaluatedAt: canonicalInstant(value.evaluatedAt),
          evidenceDigest: sha256Digest(value.evidenceDigest)
        };
        return [task, Object.freeze(evidence)];
      })
    ) as Record<FireworksTask, FireworksClinicalEvaluationEvidence>
  );
}

function strictTaskRecord(raw: string | undefined, field: string): Record<string, unknown> {
  if (!raw) throw new Error(`Fireworks ${field} evidence is missing.`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Fireworks ${field} evidence is invalid JSON.`);
  }
  const value = strictObject(parsed, field);
  assertExactKeys(value, [...FIREWORKS_TASKS]);
  return value;
}

function strictObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Fireworks ${field} evidence is not an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error("Fireworks evidence contains missing or unreviewed fields.");
  }
}

function exactString(value: unknown, expected: string): string {
  if (value !== expected)
    throw new Error("Fireworks evidence does not match the configured model.");
  return expected;
}

function exactBoolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("Fireworks evidence approval is invalid.");
  return value;
}

function canonicalInstant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new Error("Fireworks evidence timestamp is invalid.");
  }
  const canonical = new Date(value).toISOString();
  if (canonical !== value) throw new Error("Fireworks evidence timestamp is not canonical.");
  return canonical;
}

function sha256Digest(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    throw new Error("Fireworks evidence digest is invalid.");
  }
  return value;
}
