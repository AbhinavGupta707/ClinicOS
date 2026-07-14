import { createHash } from "node:crypto";
import {
  audioEndpoint,
  audioRequestDigest,
  buildAudioMultipart,
  parseTranscriptionResponse,
  validateControlledAudio
} from "./audio.js";
import {
  FIREWORKS_REQUIRED_CLINICAL_EVALUATION_VERSION,
  createFireworksModelCatalog
} from "./catalog.js";
import { FIREWORKS_TASKS } from "./types.js";
import {
  FireworksGatewayError,
  FireworksUsageGuardError,
  sanitizedFireworksError
} from "./errors.js";
import {
  FIREWORKS_REVIEW_ONLY_JSON_SCHEMA,
  buildStructuredMessages,
  parseReviewOnlyArtifact
} from "./structured-output.js";
import type { FireworksHttpResponse } from "./transport.js";
import type {
  FireworksEmbeddingRequest,
  FireworksEmbeddingResult,
  FireworksGatewayOptions,
  FireworksMetricEvent,
  FireworksReadiness,
  FireworksRequestProvenance,
  FireworksRerankRequest,
  FireworksRerankResult,
  FireworksStructuredRequest,
  FireworksStructuredResult,
  FireworksTask,
  FireworksTranscriptionRequest,
  FireworksTranscriptionResult,
  FireworksUsageActual,
  FireworksUsageReservation,
  FireworksUsageRequest
} from "./types.js";
import {
  boundedInputText,
  boundedString,
  finiteNumber,
  invalid,
  opaqueIdentifier,
  parseBoundedJson,
  providerUsage,
  safeInteger,
  strictObject
} from "./validation.js";

const CHAT_URL = "https://api.fireworks.ai/inference/v1/chat/completions";
const EMBEDDING_URL = "https://api.fireworks.ai/inference/v1/embeddings";
const RERANK_URL = "https://api.fireworks.ai/inference/v1/rerank";
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

interface ParsedProviderResult<T> {
  readonly data: T;
  readonly usage: FireworksUsageActual;
}

interface AttemptResult<T> {
  readonly value: T;
  readonly provenance: FireworksRequestProvenance;
}

export interface FireworksGatewayPort {
  readiness(): Promise<FireworksReadiness>;
  generateStructured(input: FireworksStructuredRequest): Promise<FireworksStructuredResult>;
  transcribe(input: FireworksTranscriptionRequest): Promise<FireworksTranscriptionResult>;
  embed(input: FireworksEmbeddingRequest): Promise<FireworksEmbeddingResult>;
  rerank(input: FireworksRerankRequest): Promise<FireworksRerankResult>;
}

type ResolvedFireworksGatewayOptions = Required<
  Pick<
    FireworksGatewayOptions,
    | "maximumAudioBytes"
    | "maximumAudioDurationMs"
    | "timeoutMs"
    | "maximumAttempts"
    | "modelAvailabilityMaximumAgeMs"
    | "circuitFailureThreshold"
    | "circuitOpenMs"
    | "now"
    | "random"
    | "sleep"
  >
> &
  Omit<
    FireworksGatewayOptions,
    | "maximumAudioBytes"
    | "maximumAudioDurationMs"
    | "timeoutMs"
    | "maximumAttempts"
    | "modelAvailabilityMaximumAgeMs"
    | "circuitFailureThreshold"
    | "circuitOpenMs"
    | "now"
    | "random"
    | "sleep"
  >;

export class FireworksGateway implements FireworksGatewayPort {
  readonly #options: ResolvedFireworksGatewayOptions;
  #consecutiveFailures = 0;
  #circuitOpenedUntil = 0;

  constructor(options: FireworksGatewayOptions) {
    let catalog;
    try {
      catalog = createFireworksModelCatalog(options.catalog);
    } catch {
      throw sanitizedFireworksError("not_configured", "Fireworks model catalog is not approved.");
    }
    this.#options = {
      ...options,
      catalog,
      maximumAudioBytes: boundedInteger(
        options.maximumAudioBytes ?? 25 * 1024 * 1024,
        1_024,
        100 * 1024 * 1024
      ),
      maximumAudioDurationMs: boundedInteger(
        options.maximumAudioDurationMs ?? 60 * 60 * 1_000,
        1_000,
        4 * 60 * 60 * 1_000
      ),
      timeoutMs: boundedInteger(options.timeoutMs ?? 20_000, 100, 60_000),
      maximumAttempts: boundedInteger(options.maximumAttempts ?? 3, 1, 4),
      modelAvailabilityMaximumAgeMs: boundedInteger(
        options.modelAvailabilityMaximumAgeMs ?? 5 * 60_000,
        1_000,
        60 * 60_000
      ),
      circuitFailureThreshold: boundedInteger(options.circuitFailureThreshold ?? 3, 1, 20),
      circuitOpenMs: boundedInteger(options.circuitOpenMs ?? 30_000, 1_000, 10 * 60_000),
      now: options.now ?? (() => new Date()),
      random: options.random ?? Math.random,
      sleep:
        options.sleep ??
        ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    };
    validateActivationShape(this.#options.activation);
  }

  async readiness(): Promise<FireworksReadiness> {
    const checkedDate = validNow(this.#options.now);
    const checkedAt = checkedDate.toISOString();
    const activation = activationFailure(this.#options, null, checkedDate);
    if (activation && activation.status !== "disabled") {
      return readinessResult(this.#options, checkedAt, activation.status, activation.code);
    }
    if (activation?.status === "disabled") {
      try {
        await this.#resolveCredential();
      } catch {
        return readinessResult(
          this.#options,
          checkedAt,
          "not_configured",
          "service_account_key_unavailable"
        );
      }
      return readinessResult(this.#options, checkedAt, "disabled", activation.code);
    }
    if (this.#circuitOpenedUntil > checkedDate.getTime()) {
      return readinessResult(
        this.#options,
        checkedAt,
        "circuit_open",
        "transient_failure_circuit_open"
      );
    }
    for (const task of FIREWORKS_TASKS) {
      if (await this.#options.killSwitch.isKillActive({ task, checkedAt })) {
        return readinessResult(this.#options, checkedAt, "disabled", "kill_switch_active");
      }
    }
    try {
      await this.#resolveCredential();
    } catch {
      return readinessResult(
        this.#options,
        checkedAt,
        "not_configured",
        "service_account_key_unavailable"
      );
    }
    return readinessResult(this.#options, checkedAt, "ready", "activation_approved");
  }

  async generateStructured(input: FireworksStructuredRequest): Promise<FireworksStructuredResult> {
    const configuration = this.#options.catalog[input.task];
    const scope = validateScope(input);
    const sourceText = boundedInputText(input.sourceText, configuration.maximumInputTokens * 8);
    const sourceAnchorIds = validateSourceAnchors(input.sourceAnchorIds);
    validateTokenEstimate(input.estimatedInputTokens, configuration.maximumInputTokens);
    const messages = buildStructuredMessages({
      task: input.task,
      configuration,
      sourceText,
      sourceAnchorIds
    });
    const requestBody = encodeJson({
      model: configuration.modelId,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: FIREWORKS_REVIEW_ONLY_JSON_SCHEMA
      },
      tool_choice: "none",
      stream: false,
      n: 1,
      temperature: 0,
      max_tokens: configuration.maximumOutputTokens
    });
    const result = await this.#execute({
      task: input.task,
      scope,
      estimatedInputTokens: input.estimatedInputTokens,
      maximumOutputTokens: configuration.maximumOutputTokens,
      audioBytes: 0,
      audioDurationMs: 0,
      requestDigest: digest(requestBody),
      invoke: (credential) =>
        this.#options.transport.postJson({
          url: CHAT_URL,
          authorization: credential,
          body: requestBody,
          timeoutMs: this.#options.timeoutMs,
          maximumResponseBytes: 2 * 1024 * 1024
        }),
      parse: (response) => {
        const parsed = parseChatResponse({
          response,
          task: input.task,
          modelId: configuration.modelId,
          maximumInputTokens: configuration.maximumInputTokens,
          maximumOutputTokens: configuration.maximumOutputTokens
        });
        return {
          data: parseReviewOnlyArtifact({
            value: parsed.content,
            task: input.task,
            configuration,
            allowedSourceAnchorIds: sourceAnchorIds
          }),
          usage: { ...parsed.usage, audioBytes: 0, audioDurationMs: 0 }
        };
      }
    });
    return Object.freeze({ artifact: result.value, provenance: result.provenance });
  }

  async transcribe(input: FireworksTranscriptionRequest): Promise<FireworksTranscriptionResult> {
    const configuration = this.#options.catalog[input.task];
    const scope = validateScope(input);
    validateControlledAudio({
      request: input,
      maximumBytes: this.#options.maximumAudioBytes,
      maximumDurationMs: this.#options.maximumAudioDurationMs
    });
    const multipart = buildAudioMultipart({ request: input, modelId: configuration.modelId });
    const result = await this.#execute({
      task: input.task,
      scope,
      estimatedInputTokens: 0,
      maximumOutputTokens: 0,
      audioBytes: input.bytes.byteLength,
      audioDurationMs: input.durationMs,
      requestDigest: audioRequestDigest(input, configuration.modelId),
      invoke: (credential) =>
        this.#options.transport.postMultipart({
          url: audioEndpoint(input.task),
          authorization: credential,
          contentType: multipart.contentType,
          body: multipart.body,
          timeoutMs: this.#options.timeoutMs,
          maximumResponseBytes: 16 * 1024 * 1024
        }),
      parse: (response) => ({
        data: parseTranscriptionResponse({
          value: parseBoundedJson(response.body),
          expectedDurationMs: input.durationMs,
          maximumDurationMs: this.#options.maximumAudioDurationMs
        }),
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          audioBytes: input.bytes.byteLength,
          audioDurationMs: input.durationMs
        }
      })
    });
    return Object.freeze({ ...result.value, provenance: result.provenance });
  }

  async embed(input: FireworksEmbeddingRequest): Promise<FireworksEmbeddingResult> {
    const configuration = this.#options.catalog.retrieval_embedding;
    const scope = validateScope(input);
    const inputs = validateRetrievalInputs(input.inputs, 64);
    validateTokenEstimate(input.estimatedInputTokens, configuration.maximumInputTokens);
    const requestBody = encodeJson({ model: configuration.modelId, input: inputs });
    const result = await this.#execute({
      task: input.task,
      scope,
      estimatedInputTokens: input.estimatedInputTokens,
      maximumOutputTokens: 0,
      audioBytes: 0,
      audioDurationMs: 0,
      requestDigest: digest(requestBody),
      invoke: (credential) =>
        this.#options.transport.postJson({
          url: EMBEDDING_URL,
          authorization: credential,
          body: requestBody,
          timeoutMs: this.#options.timeoutMs,
          maximumResponseBytes: 8 * 1024 * 1024
        }),
      parse: (response) =>
        parseEmbeddingResponse(
          response,
          configuration.modelId,
          inputs.length,
          configuration.maximumInputTokens
        )
    });
    return Object.freeze({ embeddings: result.value, provenance: result.provenance });
  }

  async rerank(input: FireworksRerankRequest): Promise<FireworksRerankResult> {
    const configuration = this.#options.catalog.retrieval_rerank;
    const scope = validateScope(input);
    const query = boundedInputText(input.query, 16_384);
    const documents = validateRetrievalInputs(input.documents, 128);
    const topN = boundedInteger(input.topN, 1, documents.length);
    validateTokenEstimate(input.estimatedInputTokens, configuration.maximumInputTokens);
    const requestBody = encodeJson({
      model: configuration.modelId,
      query,
      documents,
      top_n: topN,
      return_documents: false,
      task: "Rank only by relevance to the supplied clinical retrieval query; return scores, not document text."
    });
    const result = await this.#execute({
      task: input.task,
      scope,
      estimatedInputTokens: input.estimatedInputTokens,
      maximumOutputTokens: 0,
      audioBytes: 0,
      audioDurationMs: 0,
      requestDigest: digest(requestBody),
      invoke: (credential) =>
        this.#options.transport.postJson({
          url: RERANK_URL,
          authorization: credential,
          body: requestBody,
          timeoutMs: this.#options.timeoutMs,
          maximumResponseBytes: 2 * 1024 * 1024
        }),
      parse: (response) =>
        parseRerankResponse(
          response,
          configuration.modelId,
          documents.length,
          topN,
          configuration.maximumInputTokens
        )
    });
    return Object.freeze({ results: result.value, provenance: result.provenance });
  }

  async #execute<T>(input: {
    readonly task: FireworksTask;
    readonly scope: ReturnType<typeof validateScope>;
    readonly estimatedInputTokens: number;
    readonly maximumOutputTokens: number;
    readonly audioBytes: number;
    readonly audioDurationMs: number;
    readonly requestDigest: string;
    readonly invoke: (credential: string) => Promise<FireworksHttpResponse>;
    readonly parse: (response: FireworksHttpResponse) => ParsedProviderResult<T>;
  }): Promise<AttemptResult<T>> {
    const configuration = this.#options.catalog[input.task];
    const usageRequest: FireworksUsageRequest = {
      tenantId: input.scope.tenantId,
      clinicId: input.scope.clinicId,
      actorUserId: input.scope.actorUserId,
      tenantDigest: digest(input.scope.tenantId),
      correlationDigest: digest(input.scope.correlationId),
      requestDigest: input.requestDigest,
      idempotencyDigest: fireworksProviderCallIdempotencyDigest({
        tenantId: input.scope.tenantId,
        task: input.task,
        idempotencyKey: input.scope.idempotencyKey
      }),
      task: input.task,
      estimatedInputTokens: input.estimatedInputTokens,
      maximumOutputTokens: input.maximumOutputTokens,
      audioBytes: input.audioBytes,
      audioDurationMs: input.audioDurationMs,
      maximumAttempts: this.#options.maximumAttempts
    };
    let reservation;
    try {
      reservation = await this.#options.usageGuard.reserve(usageRequest);
    } catch (error) {
      if (error instanceof FireworksUsageGuardError && error.code === "idempotency_conflict") {
        throw sanitizedFireworksError(
          "idempotency_conflict",
          "Fireworks usage reservation conflicts with its original scope or request."
        );
      }
      throw sanitizedFireworksError("budget_exhausted", "Fireworks quota or budget is exhausted.");
    }
    const startedAt = validNow(this.#options.now).getTime();
    let attemptCount = 0;
    let lastConsentSnapshotDigest = "";
    let completionAttempted = false;
    let observedUsage: FireworksUsageActual | null = null;
    let responseMayHaveCost = false;
    let reservationMarkedUncertain = false;
    try {
      while (attemptCount < this.#options.maximumAttempts) {
        attemptCount += 1;
        const preflight = await this.#preflight(input.task, input.scope);
        lastConsentSnapshotDigest = preflight.consentSnapshotDigest;
        let response: FireworksHttpResponse;
        try {
          response = await input.invoke(preflight.credential);
        } catch (error) {
          let providerError = normalizeProviderError(error);
          if (
            providerError.providerHttpStatus === null &&
            providerError.code !== "invalid_request" &&
            providerError.code !== "provider_outcome_uncertain"
          ) {
            providerError = sanitizedFireworksError(
              "provider_outcome_uncertain",
              "Fireworks provider outcome is uncertain after a transport failure."
            );
          }
          if (providerError.code === "provider_outcome_uncertain") {
            this.#recordFailure(true);
            await markReservationUncertain(reservation, "transport_outcome_unknown");
            reservationMarkedUncertain = true;
          } else if (
            providerError.providerHttpStatus !== null &&
            providerError.providerHttpStatus >= 200 &&
            providerError.providerHttpStatus < 300
          ) {
            await markReservationUncertain(reservation, "provider_response_usage_unknown");
            reservationMarkedUncertain = true;
          }
          throw providerError;
        }
        if (TRANSIENT_STATUSES.has(response.status)) {
          this.#recordFailure(true);
          if (attemptCount < this.#options.maximumAttempts) {
            await this.#retryDelay(attemptCount, response.headers["retry-after"] ?? null);
            continue;
          }
          throw sanitizedFireworksError(
            "provider_unavailable",
            "Fireworks transient failure limit was reached.",
            {
              retryable: true,
              providerHttpStatus: response.status
            }
          );
        }
        if (response.status < 200 || response.status >= 300) {
          throw sanitizedFireworksError(
            "provider_rejected",
            "Fireworks rejected the bounded request.",
            {
              providerHttpStatus: response.status
            }
          );
        }
        responseMayHaveCost = true;
        const parsed = input.parse(response);
        observedUsage = parsed.usage;
        this.#recordSuccess();
        const latencyMs = Math.max(0, validNow(this.#options.now).getTime() - startedAt);
        const provenance: FireworksRequestProvenance = Object.freeze({
          provider: "fireworks",
          task: input.task,
          modelId: configuration.modelId,
          promptVersion: configuration.promptVersion,
          schemaVersion: configuration.schemaVersion,
          serviceAccountDigest: digest(this.#options.activation.serviceAccountId!),
          actorDigest: digest(input.scope.actorUserId),
          tenantDigest: digest(input.scope.tenantId),
          correlationDigest: digest(input.scope.correlationId),
          consentSnapshotDigest: lastConsentSnapshotDigest,
          requestDigest: input.requestDigest,
          responseDigest: digest(response.body),
          providerRequestIdDigest: providerRequestIdDigest(response.headers),
          inputTokens: parsed.usage.inputTokens,
          outputTokens: parsed.usage.outputTokens,
          audioBytes: parsed.usage.audioBytes,
          audioDurationMs: parsed.usage.audioDurationMs,
          latencyMs,
          attemptCount,
          status: "review_only"
        });
        completionAttempted = true;
        try {
          await reservation.complete({ ...parsed.usage, attemptCount });
        } catch {
          await markReservationUncertain(reservation, "completion_outcome_unknown");
          reservationMarkedUncertain = true;
          throw sanitizedFireworksError(
            "provider_succeeded_persistence_uncertain",
            "Fireworks provider success requires persistence reconciliation and must not be retried automatically.",
            { provenance }
          );
        }
        this.#recordMetric({
          task: input.task,
          status: "succeeded",
          reasonCode: "review_only",
          attemptCount,
          usage: parsed.usage,
          latencyMs,
          scope: input.scope
        });
        return { value: parsed.data, provenance };
      }
      throw sanitizedFireworksError("provider_unavailable", "Fireworks attempts were exhausted.");
    } catch (error) {
      if (responseMayHaveCost && !completionAttempted && !reservationMarkedUncertain) {
        await markReservationUncertain(reservation, "provider_response_usage_unknown");
        reservationMarkedUncertain = true;
      }
      if (!completionAttempted && !reservationMarkedUncertain) {
        try {
          await reservation.cancel();
        } catch {
          // Cancellation is best-effort; preserve the original sanitized failure.
        }
      }
      const normalized = normalizeProviderError(error);
      this.#recordMetric({
        task: input.task,
        status:
          normalized.code === "provider_succeeded_persistence_uncertain"
            ? "provider_succeeded_persistence_uncertain"
            : normalized.code === "provider_outcome_uncertain"
              ? "provider_outcome_uncertain"
              : normalized.retryable
                ? "unavailable"
                : "rejected",
        reasonCode: normalized.code,
        attemptCount,
        usage: observedUsage ?? {
          inputTokens: 0,
          outputTokens: 0,
          audioBytes: input.audioBytes,
          audioDurationMs: input.audioDurationMs
        },
        latencyMs: Math.max(0, validNow(this.#options.now).getTime() - startedAt),
        scope: input.scope
      });
      throw normalized;
    }
  }

  async #preflight(
    task: FireworksTask,
    scope: ReturnType<typeof validateScope>
  ): Promise<{ readonly credential: string; readonly consentSnapshotDigest: string }> {
    const now = validNow(this.#options.now);
    const activation = activationFailure(this.#options, task, now);
    if (activation) {
      throw sanitizedFireworksError(
        activation.status === "not_configured" ? "not_configured" : "policy_blocked",
        "Fireworks activation prerequisites are incomplete."
      );
    }
    if (this.#circuitOpenedUntil > now.getTime()) {
      throw sanitizedFireworksError("circuit_open", "Fireworks circuit breaker is open.", {
        retryable: true
      });
    }
    const checkedAt = now.toISOString();
    if (await this.#options.killSwitch.isKillActive({ task, checkedAt })) {
      throw sanitizedFireworksError(
        "kill_switch_active",
        "Fireworks is disabled by the clinical safety kill switch."
      );
    }
    const policy = await this.#options.consentPolicy.evaluate({
      ...scope,
      task,
      stage: "provider_call",
      evaluatedAt: checkedAt
    });
    if (
      !policy.allowed ||
      typeof policy.snapshotDigest !== "string" ||
      !/^[a-f0-9]{64}$/u.test(policy.snapshotDigest)
    ) {
      throw sanitizedFireworksError(
        "policy_blocked",
        "Fireworks consent or processing policy blocked the call."
      );
    }
    const credential = await this.#resolveCredential();
    return Object.freeze({ credential, consentSnapshotDigest: policy.snapshotDigest });
  }

  async #resolveCredential(): Promise<string> {
    const secretRef = this.#options.activation.serviceAccountSecretRef;
    if (!secretRef || !validSecretReference(secretRef)) {
      throw sanitizedFireworksError(
        "not_configured",
        "Fireworks service-account secret reference is not configured."
      );
    }
    let credential: string;
    try {
      credential = await this.#options.secretResolver.resolveSecret(secretRef);
    } catch {
      throw sanitizedFireworksError(
        "not_configured",
        "Fireworks service-account key is unavailable."
      );
    }
    if (
      credential.length < 16 ||
      credential.length > 8_192 ||
      /[\s\0]/u.test(credential) ||
      /^Bearer\s/iu.test(credential)
    ) {
      throw sanitizedFireworksError(
        "not_configured",
        "Fireworks service-account key is unavailable."
      );
    }
    return credential;
  }

  async #retryDelay(attempt: number, retryAfter: string | null): Promise<void> {
    const serverDelay =
      retryAfter && /^\d{1,3}$/u.test(retryAfter) ? Number(retryAfter) * 1_000 : 0;
    const exponential = Math.min(2_000, 100 * 2 ** Math.max(0, attempt - 1));
    const jitter = Math.floor(Math.min(0.999999, Math.max(0, this.#options.random())) * 100);
    await this.#options.sleep(Math.min(5_000, Math.max(serverDelay, exponential + jitter)));
  }

  #recordFailure(transient: boolean): void {
    if (!transient) return;
    this.#consecutiveFailures += 1;
    if (this.#consecutiveFailures >= this.#options.circuitFailureThreshold) {
      this.#circuitOpenedUntil =
        validNow(this.#options.now).getTime() + this.#options.circuitOpenMs;
    }
  }

  #recordSuccess(): void {
    this.#consecutiveFailures = 0;
    this.#circuitOpenedUntil = 0;
  }

  #recordMetric(input: {
    readonly task: FireworksTask;
    readonly status: FireworksMetricEvent["status"];
    readonly reasonCode: string;
    readonly attemptCount: number;
    readonly usage: FireworksUsageActual;
    readonly latencyMs: number;
    readonly scope: ReturnType<typeof validateScope>;
  }): void {
    const configuration = this.#options.catalog[input.task];
    try {
      this.#options.metrics.record(
        Object.freeze({
          provider: "fireworks",
          task: input.task,
          modelId: configuration.modelId,
          promptVersion: configuration.promptVersion,
          schemaVersion: configuration.schemaVersion,
          serviceAccountDigest: this.#options.activation.serviceAccountId
            ? digest(this.#options.activation.serviceAccountId)
            : null,
          actorDigest: digest(input.scope.actorUserId),
          tenantDigest: digest(input.scope.tenantId),
          correlationDigest: digest(input.scope.correlationId),
          status: input.status,
          reasonCode: /^[a-z0-9_]{1,64}$/u.test(input.reasonCode)
            ? input.reasonCode
            : "provider_error",
          attemptCount: input.attemptCount,
          inputTokens: input.usage.inputTokens,
          outputTokens: input.usage.outputTokens,
          audioBytes: input.usage.audioBytes,
          audioDurationMs: input.usage.audioDurationMs,
          latencyMs: input.latencyMs
        })
      );
    } catch {
      // Metrics are deliberately best-effort and contain no PHI. A sink failure must
      // never turn a successfully validated review-only result into a retried call.
    }
  }
}

function parseChatResponse(input: {
  readonly response: FireworksHttpResponse;
  readonly task: FireworksStructuredRequest["task"];
  readonly modelId: string;
  readonly maximumInputTokens: number;
  readonly maximumOutputTokens: number;
}): {
  readonly content: unknown;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
} {
  const value = strictObject(
    parseBoundedJson(input.response.body),
    ["id", "created", "model", "choices", "object", "usage"],
    ["perf_metrics", "prompt_token_ids"]
  );
  if (value.model !== input.modelId || value.object !== "chat.completion") invalid();
  boundedString(value.id, 1, 256);
  safeInteger(value.created, 0, Number.MAX_SAFE_INTEGER);
  if (!Array.isArray(value.choices) || value.choices.length !== 1) invalid();
  const choice = strictObject(
    value.choices[0],
    ["index", "message", "finish_reason"],
    ["logprobs", "raw_output"]
  );
  safeInteger(choice.index, 0, 0);
  if (choice.finish_reason === "length") {
    throw sanitizedFireworksError(
      "truncated_response",
      "Fireworks structured response was truncated."
    );
  }
  if (choice.finish_reason !== "stop") invalid();
  const message = strictObject(
    choice.message,
    ["role", "content"],
    ["reasoning_content", "tool_calls", "token_ids"]
  );
  if (message.role !== "assistant" || typeof message.content !== "string") invalid();
  const toolsSafe =
    message.tool_calls === undefined ||
    message.tool_calls === null ||
    (Array.isArray(message.tool_calls) && message.tool_calls.length === 0);
  const reasoningSafe =
    message.reasoning_content === undefined ||
    message.reasoning_content === null ||
    message.reasoning_content === "";
  if (
    !toolsSafe ||
    !reasoningSafe ||
    (choice.raw_output !== undefined && choice.raw_output !== null)
  ) {
    throw sanitizedFireworksError(
      "unsafe_output",
      "Fireworks returned tools, reasoning, or raw output outside the approved boundary."
    );
  }
  return {
    content: parseBoundedJson(Buffer.from(message.content, "utf8")),
    usage: providerUsage(value.usage, input.maximumInputTokens, input.maximumOutputTokens)
  };
}

function parseEmbeddingResponse(
  response: FireworksHttpResponse,
  modelId: string,
  inputCount: number,
  maximumInputTokens: number
): ParsedProviderResult<readonly (readonly number[])[]> {
  const value = strictObject(parseBoundedJson(response.body), ["data", "model", "object", "usage"]);
  if (
    value.model !== modelId ||
    value.object !== "list" ||
    !Array.isArray(value.data) ||
    value.data.length !== inputCount
  )
    invalid();
  let dimension: number | null = null;
  const indices = new Set<number>();
  const embeddingsByIndex = value.data.map((item) => {
    const record = strictObject(item, ["index", "embedding", "object"]);
    const index = safeInteger(record.index, 0, inputCount - 1);
    if (indices.has(index) || record.object !== "embedding" || !Array.isArray(record.embedding))
      invalid();
    indices.add(index);
    if (record.embedding.length < 1 || record.embedding.length > 16_384) invalid();
    dimension ??= record.embedding.length;
    if (record.embedding.length !== dimension) invalid();
    return Object.freeze({
      index,
      embedding: Object.freeze(
        record.embedding.map((entry) => finiteNumber(entry, -1_000_000, 1_000_000))
      )
    });
  });
  embeddingsByIndex.sort((left, right) => left.index - right.index);
  const embeddings = embeddingsByIndex.map((item) => item.embedding);
  const usage = providerUsage(value.usage, maximumInputTokens, 0);
  return {
    data: Object.freeze(embeddings),
    usage: { ...usage, audioBytes: 0, audioDurationMs: 0 }
  };
}

function parseRerankResponse(
  response: FireworksHttpResponse,
  modelId: string,
  documentCount: number,
  topN: number,
  maximumInputTokens: number
): ParsedProviderResult<readonly { readonly index: number; readonly relevanceScore: number }[]> {
  const value = strictObject(parseBoundedJson(response.body), ["object", "model", "data", "usage"]);
  if (
    value.object !== "list" ||
    value.model !== modelId ||
    !Array.isArray(value.data) ||
    value.data.length < 1 ||
    value.data.length > topN
  )
    invalid();
  const seen = new Set<number>();
  let previous = Number.POSITIVE_INFINITY;
  const results = value.data.map((item) => {
    const record = strictObject(item, ["index", "relevance_score"], ["document"]);
    if (record.document !== undefined) {
      throw sanitizedFireworksError(
        "invalid_response",
        "Fireworks reranker returned document text despite redaction policy."
      );
    }
    const index = safeInteger(record.index, 0, documentCount - 1);
    const relevanceScore = finiteNumber(record.relevance_score, 0, 1);
    if (seen.has(index) || relevanceScore > previous) invalid();
    seen.add(index);
    previous = relevanceScore;
    return Object.freeze({ index, relevanceScore });
  });
  const usage = providerUsage(value.usage, maximumInputTokens, 0);
  return { data: Object.freeze(results), usage: { ...usage, audioBytes: 0, audioDurationMs: 0 } };
}

function validateScope(input: {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly patientId: string;
  readonly encounterId: string;
  readonly actorUserId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}) {
  return Object.freeze({
    tenantId: opaqueIdentifier(input.tenantId, "tenantId", 128),
    clinicId: opaqueIdentifier(input.clinicId, "clinicId", 128),
    patientId: opaqueIdentifier(input.patientId, "patientId", 128),
    encounterId: opaqueIdentifier(input.encounterId, "encounterId", 128),
    actorUserId: opaqueIdentifier(input.actorUserId, "actorUserId", 128),
    correlationId: opaqueIdentifier(input.correlationId, "correlationId", 256),
    idempotencyKey: opaqueIdentifier(input.idempotencyKey, "idempotencyKey", 256)
  });
}

function validateSourceAnchors(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 128) {
    throw sanitizedFireworksError(
      "invalid_request",
      "Fireworks source anchors are missing or oversized."
    );
  }
  const anchors = value.map((anchor) => opaqueIdentifier(anchor, "sourceAnchorId", 128));
  if (new Set(anchors).size !== anchors.length) {
    throw sanitizedFireworksError(
      "invalid_request",
      "Fireworks source anchors contain duplicates."
    );
  }
  return Object.freeze(anchors);
}

function validateRetrievalInputs(
  value: readonly string[],
  maximumItems: number
): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximumItems) {
    throw sanitizedFireworksError("invalid_request", "Fireworks retrieval input count is invalid.");
  }
  return Object.freeze(value.map((item) => boundedInputText(item, 64 * 1024)));
}

function validateTokenEstimate(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw sanitizedFireworksError(
      "invalid_request",
      "Fireworks input token estimate exceeds its task limit."
    );
  }
}

function encodeJson(value: unknown): Uint8Array {
  const encoded = Buffer.from(JSON.stringify(value), "utf8");
  if (encoded.byteLength > 2 * 1024 * 1024) {
    throw sanitizedFireworksError("invalid_request", "Fireworks request exceeds its byte limit.");
  }
  return encoded;
}

function activationFailure(
  options: ResolvedFireworksGatewayOptions,
  task: FireworksTask | null,
  now: Date
): {
  readonly status: "not_configured" | "policy_blocked" | "disabled";
  readonly code: string;
} | null {
  const activation = options.activation;
  if (
    !activation.serviceAccountSecretRef ||
    !validSecretReference(activation.serviceAccountSecretRef)
  ) {
    return { status: "not_configured", code: "service_account_secret_ref_missing" };
  }
  if (!activation.serviceAccountId || !validServiceAccountId(activation.serviceAccountId)) {
    return { status: "not_configured", code: "service_account_id_missing" };
  }
  if (
    !activation.serviceAccountApproved ||
    !activation.dataProcessingAgreementApproved ||
    !activation.healthcareContractApproved ||
    !activation.noTrainingNoRetentionApproved ||
    !activation.residencyApproved ||
    !activation.budgetApproved
  ) {
    return { status: "policy_blocked", code: "provider_policy_approval_pending" };
  }
  const tasks = task ? [task] : FIREWORKS_TASKS;
  if (tasks.some((candidate) => !modelAvailabilityApproved(options, candidate, now))) {
    return { status: "policy_blocked", code: "model_availability_approval_pending" };
  }
  if (tasks.some((candidate) => !clinicalEvaluationApproved(options, candidate, now))) {
    return { status: "policy_blocked", code: "clinical_evaluation_approval_pending" };
  }
  if (!activation.liveEnabled) return { status: "disabled", code: "live_enable_disabled" };
  return null;
}

function readinessResult(
  options: ResolvedFireworksGatewayOptions,
  checkedAt: string,
  status: FireworksReadiness["status"],
  reasonCode: string
): FireworksReadiness {
  const now = new Date(checkedAt);
  return Object.freeze({
    provider: "fireworks",
    status,
    operational: status === "ready",
    reasonCode,
    checkedAt,
    secretReferenceConfigured: Boolean(
      options.activation.serviceAccountSecretRef &&
      validSecretReference(options.activation.serviceAccountSecretRef)
    ),
    serviceAccountConfigured: Boolean(
      options.activation.serviceAccountId &&
      validServiceAccountId(options.activation.serviceAccountId)
    ),
    tasks: Object.freeze(
      FIREWORKS_TASKS.map((task) =>
        Object.freeze({
          task,
          modelId: options.catalog[task].modelId,
          status: !modelAvailabilityApproved(options, task, now)
            ? ("model_unavailable" as const)
            : !clinicalEvaluationApproved(options, task, now)
              ? ("evaluation_pending" as const)
              : ("approved" as const)
        })
      )
    )
  });
}

function validateActivationShape(value: FireworksGatewayOptions["activation"]): void {
  if (
    !value ||
    typeof value !== "object" ||
    !value.modelAvailabilityEvidence ||
    typeof value.modelAvailabilityEvidence !== "object" ||
    !value.clinicalEvaluationEvidence ||
    typeof value.clinicalEvaluationEvidence !== "object"
  ) {
    throw sanitizedFireworksError("not_configured", "Fireworks activation approvals are invalid.");
  }
  const availabilityKeys = Object.keys(value.modelAvailabilityEvidence).sort();
  const evaluationKeys = Object.keys(value.clinicalEvaluationEvidence).sort();
  const expected = [...FIREWORKS_TASKS].sort();
  if (
    JSON.stringify(availabilityKeys) !== JSON.stringify(expected) ||
    JSON.stringify(evaluationKeys) !== JSON.stringify(expected)
  ) {
    throw sanitizedFireworksError(
      "not_configured",
      "Fireworks activation task approvals are incomplete."
    );
  }
}

function modelAvailabilityApproved(
  options: ResolvedFireworksGatewayOptions,
  task: FireworksTask,
  now: Date
): boolean {
  const evidence = options.activation.modelAvailabilityEvidence[task];
  const checkedAt = canonicalTimestamp(evidence.checkedAt);
  return (
    evidence.available === true &&
    evidence.modelId === options.catalog[task].modelId &&
    /^[a-f0-9]{64}$/u.test(evidence.evidenceDigest) &&
    checkedAt !== null &&
    checkedAt <= now.getTime() &&
    now.getTime() - checkedAt <= options.modelAvailabilityMaximumAgeMs
  );
}

function clinicalEvaluationApproved(
  options: ResolvedFireworksGatewayOptions,
  task: FireworksTask,
  now: Date
): boolean {
  const evidence = options.activation.clinicalEvaluationEvidence[task];
  const evaluatedAt = canonicalTimestamp(evidence.evaluatedAt);
  return (
    evidence.approved === true &&
    evidence.modelId === options.catalog[task].modelId &&
    evidence.promptVersion === options.catalog[task].promptVersion &&
    evidence.schemaVersion === options.catalog[task].schemaVersion &&
    evidence.evaluationVersion === FIREWORKS_REQUIRED_CLINICAL_EVALUATION_VERSION &&
    /^[a-f0-9]{64}$/u.test(evidence.evidenceDigest) &&
    evaluatedAt !== null &&
    evaluatedAt <= now.getTime()
  );
}

function canonicalTimestamp(value: string): number | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function validSecretReference(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 512 &&
    !/[\s\0\r\n]/u.test(value) &&
    (/^arn:aws(?:-[a-z]+)?:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/u.test(
      value
    ) ||
      /^[A-Za-z0-9/_+=.@-]+$/u.test(value))
  );
}

function validServiceAccountId(value: string): boolean {
  return value.length >= 1 && value.length <= 256 && /^[A-Za-z0-9._:@/-]+$/u.test(value);
}

function normalizeProviderError(error: unknown): FireworksGatewayError {
  if (error instanceof FireworksGatewayError) return error;
  return sanitizedFireworksError(
    "provider_outcome_uncertain",
    "Fireworks provider outcome is uncertain after a transport failure."
  );
}

async function markReservationUncertain(
  reservation: FireworksUsageReservation,
  reason:
    "transport_outcome_unknown" | "provider_response_usage_unknown" | "completion_outcome_unknown"
): Promise<void> {
  try {
    await reservation.markUncertain({ reason });
  } catch {
    // The invocation-level reconciliation state remains mandatory and automatic retry stays off.
  }
}

function providerRequestIdDigest(
  headers: Readonly<Record<string, string | undefined>>
): string | null {
  const requestId = headers["x-request-id"] ?? headers["request-id"];
  return requestId && requestId.length <= 512 ? digest(requestId) : null;
}

function validNow(now: () => Date): Date {
  const value = now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw sanitizedFireworksError("not_configured", "Fireworks clock is unavailable.");
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw sanitizedFireworksError("not_configured", "Fireworks bounded configuration is invalid.");
  }
  return value;
}

function digest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fireworksProviderCallIdempotencyDigest(input: {
  readonly tenantId: string;
  readonly task: FireworksTask;
  readonly idempotencyKey: string;
}): string {
  return digest(`${input.tenantId}\0${input.task}\0${input.idempotencyKey}`);
}
