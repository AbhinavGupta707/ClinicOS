import {
  CP13_DUE_GENERATION_CONTINUE_AS_NEW_BATCH_THRESHOLD,
  CP13_MAX_DUE_GENERATION_BATCH_SIZE,
  type Cp13ClaimedPaymentIntent,
  type Cp13DueGenerationBatchResult,
  type Cp13DueGenerationProgress,
  type Cp13DueGenerationWorkflowInput,
  type Cp13FinalizePaymentRequestRecoveryRequest,
  type Cp13PaymentIntentIdentity,
  type Cp13PaymentProviderCustomer,
  type Cp13PaymentRequestArtifact,
  type Cp13PaymentRequestRecoveryResult,
  type Cp13ProviderPaymentRequestRecoveryRequest,
  type Cp13ProviderPaymentRequestRecoveryResult,
  type Cp13WorkflowFailure
} from "./cp13-contracts.js";

export type Cp13DueGenerationStep =
  | {
      readonly action: "continue";
      readonly progress: Cp13DueGenerationProgress;
    }
  | {
      readonly action: "continue_as_new";
      readonly progress: Cp13DueGenerationProgress;
      readonly input: Cp13DueGenerationWorkflowInput;
    }
  | {
      readonly action: "terminal";
      readonly progress: Cp13DueGenerationProgress;
    };

export function createCp13DueGenerationProgress(
  input: Cp13DueGenerationWorkflowInput
): Cp13DueGenerationProgress {
  assertDueGenerationWorkflowInput(input);
  const continuation = input.continuation;
  return {
    generationKind: input.generationKind,
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    eventId: input.eventId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    requestedAt: input.requestedAt,
    asOf: input.asOf,
    batchSize: input.batchSize,
    status: "running",
    cursor: continuation?.cursor ?? input.cursor,
    processedCount: continuation?.processedCount ?? 0,
    createdCount: continuation?.createdCount ?? 0,
    skippedCount: continuation?.skippedCount ?? 0,
    batchCount: continuation?.batchCount ?? 0,
    continueAsNewCount: continuation?.continueAsNewCount ?? 0
  };
}

export function advanceCp13DueGeneration(
  input: Cp13DueGenerationWorkflowInput,
  current: Cp13DueGenerationProgress,
  batch: Cp13DueGenerationBatchResult
): Cp13DueGenerationStep {
  assertDueGenerationBatchResult(input.batchSize, batch);
  const batchCount = current.batchCount + 1;
  const base = {
    ...current,
    processedCount: current.processedCount + batch.processedCount,
    createdCount: current.createdCount + batch.createdCount,
    skippedCount: current.skippedCount + batch.skippedCount,
    batchCount
  };

  if (batch.complete) {
    return {
      action: "terminal",
      progress: {
        ...base,
        status: "completed",
        cursor: null
      }
    };
  }

  if (
    batch.processedCount === 0 ||
    batch.nextCursor === null ||
    batch.nextCursor.length === 0 ||
    batch.nextCursor === current.cursor
  ) {
    return {
      action: "terminal",
      progress: {
        ...base,
        status: "failed",
        cursor: current.cursor,
        failureClassification: "permanent",
        failureCode: "DUE_GENERATION_NO_PROGRESS"
      }
    };
  }
  const progress: Cp13DueGenerationProgress = {
    ...base,
    cursor: batch.nextCursor
  };
  if (batchCount % CP13_DUE_GENERATION_CONTINUE_AS_NEW_BATCH_THRESHOLD !== 0) {
    return { action: "continue", progress };
  }

  return {
    action: "continue_as_new",
    progress: {
      ...progress,
      continueAsNewCount: progress.continueAsNewCount + 1
    },
    input: {
      ...input,
      cursor: batch.nextCursor,
      continuation: {
        cursor: batch.nextCursor,
        processedCount: progress.processedCount,
        createdCount: progress.createdCount,
        skippedCount: progress.skippedCount,
        batchCount: progress.batchCount,
        continueAsNewCount: progress.continueAsNewCount + 1
      }
    }
  };
}

export function failCp13DueGeneration(
  current: Cp13DueGenerationProgress,
  failure: Cp13WorkflowFailure
): Cp13DueGenerationProgress {
  return {
    ...current,
    status: "failed",
    failureClassification: failure.classification,
    failureCode: failure.code
  };
}

export function paymentIntentIdentityMatches(
  expected: Cp13PaymentIntentIdentity,
  actual: Cp13PaymentIntentIdentity
): boolean {
  return (
    expected.tenantId === actual.tenantId &&
    expected.clinicId === actual.clinicId &&
    expected.actorUserId === actual.actorUserId &&
    expected.patientId === actual.patientId &&
    expected.invoiceId === actual.invoiceId &&
    expected.durableIntentId === actual.durableIntentId &&
    expected.intentDigest === actual.intentDigest &&
    expected.requestType === actual.requestType
  );
}

export function claimedPaymentIntentIsAuthoritative(
  expected: Cp13PaymentIntentIdentity,
  actual: Cp13ClaimedPaymentIntent
): boolean {
  return (
    paymentIntentIdentityMatches(expected, actual) &&
    isNonEmpty(actual.claimToken) &&
    isNonEmpty(actual.providerKey) &&
    actual.providerKey.length <= 128 &&
    actual.claimToken.length <= 512 &&
    Number.isSafeInteger(actual.amountMinor) &&
    actual.amountMinor > 0 &&
    actual.amountMinor <= 2_147_483_647 &&
    /^[A-Z]{3,8}$/u.test(actual.currency) &&
    isNullableCanonicalText(actual.description, 4_096) &&
    isNullableRfc3339Instant(actual.expiresAt) &&
    isCanonicalPaymentCustomer(actual.customer) &&
    isBoundedPaymentMetadata(actual.metadata)
  );
}

export function toProviderPaymentRequestRecoveryRequest(
  intent: Cp13ClaimedPaymentIntent,
  context: {
    readonly eventId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  }
): Cp13ProviderPaymentRequestRecoveryRequest {
  return { ...intent, ...context };
}

export function planProviderPaymentResolution(
  identity: Cp13PaymentIntentIdentity,
  intent: Cp13ClaimedPaymentIntent,
  provider: Cp13ProviderPaymentRequestRecoveryResult,
  context: {
    readonly eventId: string;
    readonly correlationId: string;
    readonly idempotencyKey: string;
  }
): Cp13FinalizePaymentRequestRecoveryRequest {
  const base = {
    ...identity,
    claimToken: claimedPaymentIntentIsAuthoritative(identity, intent) ? intent.claimToken : null,
    ...context
  };

  if (!claimedPaymentIntentIsAuthoritative(identity, intent)) {
    return {
      ...base,
      resolution: {
        status: "reconciliation_required",
        reasonCode: "PAYMENT_INTENT_AUTHORITY_MISMATCH"
      }
    };
  }

  if (provider.outcome === "ambiguous") {
    return {
      ...base,
      resolution: {
        status: "reconciliation_required",
        reasonCode: safeCp13FailureCode(provider.reasonCode, "PAYMENT_PROVIDER_RECOVERY_AMBIGUOUS"),
        sourceEvidenceId: provider.providerEvidenceId
      }
    };
  }

  if (provider.outcome === "permanent_failure") {
    return {
      ...base,
      resolution: {
        status: "failed",
        failure: {
          classification: "permanent",
          code: safeCp13FailureCode(provider.failureCode, "PAYMENT_PROVIDER_RECOVERY_FAILED")
        },
        sourceEvidenceId: provider.providerEvidenceId
      }
    };
  }

  if (
    provider.providerKey !== intent.providerKey ||
    !isNonEmpty(provider.providerRequestId) ||
    !isNonEmpty(provider.providerEvidenceId) ||
    !artifactMatchesRequestType(identity.requestType, provider.artifact)
  ) {
    return {
      ...base,
      resolution: {
        status: "reconciliation_required",
        reasonCode: "PAYMENT_PROVIDER_RECOVERY_MISMATCH",
        sourceEvidenceId: provider.providerEvidenceId
      }
    };
  }

  return {
    ...base,
    resolution: {
      status: "requested",
      providerKey: provider.providerKey,
      providerRequestId: provider.providerRequestId,
      artifact: provider.artifact,
      providerEvidenceId: provider.providerEvidenceId
    }
  };
}

export function safeCp13FailureCode(value: string, fallback: string): string {
  return isSafeCp13FailureCode(value) ? value : fallback;
}

export function paymentRecoveryResultIsAuthoritative(
  expected: Cp13PaymentIntentIdentity,
  result: Cp13PaymentRequestRecoveryResult
): boolean {
  if (!paymentIntentIdentityMatches(expected, result) || !isNonEmptyBounded(result.evidenceId, 512))
    return false;
  if (result.status === "requested") {
    return (
      isNonEmptyBounded(result.providerKey, 128) &&
      isNonEmptyBounded(result.providerRequestId, 512) &&
      artifactMatchesRequestType(expected.requestType, result.artifact)
    );
  }
  return result.status === "failed"
    ? isSafeCp13FailureCode(result.failure.code)
    : isSafeCp13FailureCode(result.reconciliationReasonCode);
}

export function artifactMatchesRequestType(
  requestType: Cp13PaymentIntentIdentity["requestType"],
  artifact: Cp13PaymentRequestArtifact
): boolean {
  if (requestType === "payment_link") {
    return (
      artifact.kind === "payment_link" &&
      artifact.paymentUrl.length <= 2_048 &&
      isUsableHttpsUrl(artifact.paymentUrl)
    );
  }
  return (
    artifact.kind === "invoice_qr" &&
    (isNonEmptyBounded(artifact.qrString, 32_768) ||
      (artifact.qrImageUrl !== null &&
        artifact.qrImageUrl.length <= 2_048 &&
        isUsableHttpsUrl(artifact.qrImageUrl)))
  );
}

function assertDueGenerationWorkflowInput(input: Cp13DueGenerationWorkflowInput): void {
  if (
    !isNonEmpty(input.tenantId) ||
    !isNonEmpty(input.clinicId) ||
    !isNonEmpty(input.actorUserId) ||
    !isNonEmpty(input.eventId) ||
    !isNonEmpty(input.correlationId) ||
    !isNonEmpty(input.idempotencyKey) ||
    !isNonEmpty(input.requestedAt) ||
    !isNonEmpty(input.asOf)
  ) {
    throw new Error("CP13 due-generation workflow identity is invalid.");
  }
  if (
    !Number.isInteger(input.batchSize) ||
    input.batchSize < 1 ||
    input.batchSize > CP13_MAX_DUE_GENERATION_BATCH_SIZE
  ) {
    throw new Error("CP13 due-generation batchSize must be an integer from 1 through 25.");
  }
  if (input.cursor !== null && (input.cursor.length === 0 || input.cursor.length > 2_048)) {
    throw new Error("CP13 due-generation cursor must be null or a non-empty opaque string.");
  }
  const continuation = input.continuation;
  if (
    continuation &&
    (!isNonNegativeInteger(continuation.processedCount) ||
      !isNonNegativeInteger(continuation.createdCount) ||
      !isNonNegativeInteger(continuation.skippedCount) ||
      !isNonNegativeInteger(continuation.batchCount) ||
      !isNonNegativeInteger(continuation.continueAsNewCount) ||
      continuation.createdCount + continuation.skippedCount > continuation.processedCount ||
      continuation.batchCount % CP13_DUE_GENERATION_CONTINUE_AS_NEW_BATCH_THRESHOLD !== 0 ||
      continuation.continueAsNewCount !==
        continuation.batchCount / CP13_DUE_GENERATION_CONTINUE_AS_NEW_BATCH_THRESHOLD ||
      continuation.cursor !== input.cursor)
  ) {
    throw new Error("CP13 due-generation continuation state is invalid.");
  }
}

function assertDueGenerationBatchResult(
  batchSize: number,
  batch: Cp13DueGenerationBatchResult
): void {
  if (
    !isNonNegativeInteger(batch.processedCount) ||
    !isNonNegativeInteger(batch.createdCount) ||
    !isNonNegativeInteger(batch.skippedCount) ||
    batch.processedCount > batchSize ||
    batch.createdCount > batch.processedCount ||
    batch.skippedCount > batch.processedCount ||
    batch.createdCount + batch.skippedCount > batch.processedCount ||
    !isNonEmptyBounded(batch.evidenceId, 512) ||
    (batch.nextCursor !== null && batch.nextCursor.length > 2_048) ||
    (batch.complete && batch.nextCursor !== null)
  ) {
    throw new Error("CP13 due-generation activity returned an invalid batch result.");
  }
}

function isNonNegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function isNonEmpty(value: string | null): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonEmptyBounded(value: string | null, maxLength: number): value is string {
  return isNonEmpty(value) && value.length <= maxLength;
}

function isUsableHttpsUrl(value: string | null): boolean {
  if (!isNonEmpty(value)) return false;
  return /^https:\/\/[^\s/$.?#].[^\s]*$/iu.test(value);
}

const FORBIDDEN_PAYMENT_METADATA_KEYS = new Set(
  [
    "__proto__",
    "constructor",
    "prototype",
    "amount",
    "amountMinor",
    "amountPaise",
    "actor",
    "actorId",
    "actorUserId",
    "clinicId",
    "createdByUserId",
    "currencyAuthority",
    "discountMinor",
    "objectKey",
    "price",
    "priceAuthority",
    "providerSecret",
    "rawProviderPayload",
    "signature",
    "signatureValue",
    "tenantId",
    "totalAuthority",
    "totalMinor",
    "unitPrice",
    "unitPriceMinor",
    "accessToken",
    "apiKey",
    "apiToken",
    "appSecret",
    "clientSecret",
    "keySecret",
    "password",
    "privateKey"
  ].map(normalizeMetadataKey)
);

function isNullableCanonicalText(value: string | null, maxLength: number): boolean {
  return (
    value === null || (value.length > 0 && value.length <= maxLength && value === value.trim())
  );
}

function isNullableRfc3339Instant(value: string | null): boolean {
  return (
    value === null ||
    (value.length >= 20 &&
      value.length <= 40 &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value))
  );
}

function isCanonicalPaymentCustomer(value: Cp13PaymentProviderCustomer | null): boolean {
  if (value === null) return true;
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.some((key) => key !== "name" && key !== "email" && key !== "contact")) return false;
  return keys.every((key) => {
    const entry = value[key as keyof Cp13PaymentProviderCustomer];
    return (
      entry === undefined ||
      entry === null ||
      (typeof entry === "string" && isNullableCanonicalText(entry, 4_096))
    );
  });
}

function isBoundedPaymentMetadata(value: Readonly<Record<string, unknown>>): boolean {
  if (!isPlainRecord(value) || Object.keys(value).length > 64) return false;
  return isBoundedJsonValue(value, 0, { remaining: 65_536 });
}

function isBoundedJsonValue(value: unknown, depth: number, budget: { remaining: number }): boolean {
  if (depth > 12 || --budget.remaining < 0) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") {
    budget.remaining -= value.length;
    return value.length <= 32_768 && budget.remaining >= 0;
  }
  if (Array.isArray(value)) {
    return (
      value.length <= 256 && value.every((entry) => isBoundedJsonValue(entry, depth + 1, budget))
    );
  }
  if (!isPlainRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > 256) return false;
  return entries.every(([key, entry]) => {
    budget.remaining -= key.length;
    return (
      key.length <= 256 &&
      budget.remaining >= 0 &&
      !FORBIDDEN_PAYMENT_METADATA_KEYS.has(normalizeMetadataKey(key)) &&
      isBoundedJsonValue(entry, depth + 1, budget)
    );
  });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeMetadataKey(value: string): string {
  return value.replace(/[^a-z0-9]/giu, "").toLowerCase();
}

function isSafeCp13FailureCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{2,79}$/u.test(value);
}
