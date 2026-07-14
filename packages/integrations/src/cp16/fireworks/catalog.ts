import {
  FIREWORKS_TASKS,
  type FireworksModelCatalog,
  type FireworksTask,
  type FireworksTaskModelConfiguration
} from "./types.js";

export const FIREWORKS_DECISION_MODEL_CANDIDATES: Readonly<Record<FireworksTask, string>> =
  Object.freeze({
    clinical_structured_draft: "accounts/fireworks/models/deepseek-v4-pro",
    clinical_safety_review: "accounts/fireworks/models/glm-5p2",
    bounded_extraction: "accounts/fireworks/models/deepseek-v4-flash",
    long_context_summary: "accounts/fireworks/models/kimi-k2p6",
    retrieval_embedding: "fireworks/qwen3-embedding-8b",
    retrieval_rerank: "fireworks/qwen3-reranker-8b",
    speech_quality: "whisper-v3",
    speech_low_latency: "whisper-v3-turbo"
  });

/** Must match the version emitted by the owned domain evaluation harness. */
export const FIREWORKS_REQUIRED_CLINICAL_EVALUATION_VERSION = "cp16-ai-eval-v1" as const;

export function createFireworksModelCatalog(
  configured: Readonly<Record<FireworksTask, FireworksTaskModelConfiguration>>
): FireworksModelCatalog {
  const keys = Object.keys(configured).sort();
  const expected = [...FIREWORKS_TASKS].sort();
  if (JSON.stringify(keys) !== JSON.stringify(expected)) {
    throw new Error("Fireworks task catalog must contain every approved task exactly once.");
  }
  return Object.freeze(
    Object.fromEntries(
      FIREWORKS_TASKS.map((task) => {
        const value = configured[task];
        if (value.modelId !== FIREWORKS_DECISION_MODEL_CANDIDATES[task]) {
          throw new Error(`Fireworks model for ${task} is not in the CP16 decision allowlist.`);
        }
        return [
          task,
          Object.freeze({
            modelId: safeVersion(value.modelId, "modelId", 160),
            promptVersion: safeVersion(value.promptVersion, "promptVersion", 64),
            schemaVersion: safeVersion(value.schemaVersion, "schemaVersion", 64),
            maximumInputTokens: boundedInteger(value.maximumInputTokens, 1, 200_000),
            maximumOutputTokens: boundedInteger(value.maximumOutputTokens, 1, 16_384)
          })
        ];
      })
    ) as unknown as FireworksModelCatalog
  );
}

export function defaultFireworksModelCatalog(): FireworksModelCatalog {
  return createFireworksModelCatalog(
    Object.fromEntries(
      FIREWORKS_TASKS.map((task) => [
        task,
        {
          modelId: FIREWORKS_DECISION_MODEL_CANDIDATES[task],
          promptVersion: `cp16-${task}-prompt-v1`,
          schemaVersion: task.startsWith("speech_")
            ? "cp16-fireworks-transcript-v1"
            : task.startsWith("retrieval_")
              ? `cp16-fireworks-${task}-v1`
              : "cp16-review-only-artifact-v1",
          maximumInputTokens:
            task === "long_context_summary" ? 64_000 : task.startsWith("speech_") ? 1 : 8_192,
          maximumOutputTokens: task.startsWith("retrieval_") || task.startsWith("speech_") ? 1 : 2_048
        }
      ])
    ) as unknown as Record<FireworksTask, FireworksTaskModelConfiguration>
  );
}

function safeVersion(value: string, field: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[A-Za-z0-9._:/-]+$/u.test(value)
  ) {
    throw new Error(`Fireworks ${field} is invalid.`);
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error("Fireworks token limit is invalid.");
  }
  return value;
}
