import {
  decideRazorpayEvent,
  razorpayBusinessKey,
  type NormalizedRazorpayEvent,
  type RazorpayAccountScope,
  type RazorpayEventDecision
} from "../../../../../packages/domain/src/cp15/razorpay/index.ts";
import type {
  RazorpayAuditRecord,
  RazorpayProcessingMetadata,
  RazorpayRawWebhookInput,
  RazorpayTransactionalPort,
  RazorpayUnitOfWorkPort,
  RazorpayVerifiedEventEvidence,
  RazorpayWebhookVerifierPort,
  RazorpayWebhookProcessingResult
} from "./contracts.ts";

export class RazorpayProcessingError extends Error {
  readonly code: "EVENT_IN_PROGRESS" | "DURABLE_EVIDENCE_CONFLICT" | "INVALID_VERIFIED_EVENT";
  readonly retryable: boolean;

  constructor(code: RazorpayProcessingError["code"], message: string, retryable = false) {
    super(message);
    this.name = "RazorpayProcessingError";
    this.code = code;
    this.retryable = retryable;
  }
}

export async function processRawRazorpayWebhook(input: {
  readonly raw: RazorpayRawWebhookInput;
  readonly verifier: RazorpayWebhookVerifierPort;
  readonly unitOfWork: RazorpayUnitOfWorkPort;
  readonly metadata: RazorpayProcessingMetadata;
  readonly now: () => Date;
}): Promise<RazorpayWebhookProcessingResult> {
  const verified = input.verifier.verify(input.raw);
  const event = verified.event;
  const account = verified.account;
  const evidence: RazorpayVerifiedEventEvidence = {
    rawBodySha256: event.rawBodySha256,
    signatureSha256: event.signatureSha256,
    verifiedSecretVersion: event.verifiedSecretVersion,
    rawBodyLength: verified.rawBodyLength,
    usedPreviousSecret: verified.usedPreviousSecret,
    normalizedEvent: event
  };
  const now = validNow(input.now).toISOString();
  return input.unitOfWork.transaction(account, async (transaction) => {
    const claim = await transaction.claimProviderEvent({
      account,
      providerEventId: event.providerEventId,
      eventName: event.eventName,
      evidence,
      leaseOwner: requiredToken(input.metadata.requestId, "requestId"),
      leaseExpiresAt: new Date(Date.parse(now) + 30_000).toISOString(),
      receivedAt: validIso(input.metadata.receivedAt, "metadata.receivedAt")
    });
    if (claim.outcome === "duplicate") {
      if (!evidenceEqual(claim.storedEvidence, evidence)) {
        throw new RazorpayProcessingError(
          "DURABLE_EVIDENCE_CONFLICT",
          "Duplicate Razorpay event evidence differs from its durable record."
        );
      }
      return { ...claim.storedResult, status: "duplicate", replayed: true };
    }
    if (claim.outcome === "in_progress") {
      throw new RazorpayProcessingError(
        "EVENT_IN_PROGRESS",
        "The verified Razorpay event is already being processed.",
        true
      );
    }
    if (claim.outcome === "evidence_conflict") {
      throw new RazorpayProcessingError(
        "DURABLE_EVIDENCE_CONFLICT",
        "Razorpay event identifier conflicts with durable verification evidence."
      );
    }

    const existingPayment = await transaction.findPaymentEffect(event.providerPaymentId);
    const resolvedInvoiceId = event.invoiceId ?? existingPayment?.invoiceId ?? null;
    const [invoice, paymentRequest] = await Promise.all([
      transaction.findInvoice(resolvedInvoiceId),
      transaction.findPaymentRequest({
        providerRequestId: event.providerRequestId,
        invoiceId: resolvedInvoiceId
      })
    ]);
    const businessKey = razorpayBusinessKey(event);
    const decision = decideRazorpayEvent({
      account,
      event,
      invoice,
      paymentRequest,
      existingPayment,
      businessEffectExists: false
    });
    if (decision.kind !== "ignore") {
      const businessClaim = await transaction.claimBusinessEffect(decision.businessKey);
      if (businessClaim === "duplicate") {
        return completeIgnored(transaction, {
          account,
          event,
          eventRecordId: claim.eventRecordId,
          businessKey: decision.businessKey,
          reason: "duplicate_business_effect",
          requestId: input.metadata.requestId,
          now
        });
      }
    }
    return applyDecision(transaction, {
      account,
      event,
      decision,
      eventRecordId: claim.eventRecordId,
      invoiceId: invoice?.invoiceId ?? null,
      providerRequestId: paymentRequest?.providerRequestId ?? null,
      fallbackBusinessKey: businessKey,
      requestId: input.metadata.requestId,
      now
    });
  });
}

async function applyDecision(
  transaction: RazorpayTransactionalPort,
  input: {
    readonly account: RazorpayAccountScope;
    readonly event: NormalizedRazorpayEvent;
    readonly decision: RazorpayEventDecision;
    readonly eventRecordId: string;
    readonly invoiceId: string | null;
    readonly providerRequestId: string | null;
    readonly fallbackBusinessKey: string;
    readonly requestId: string;
    readonly now: string;
  }
): Promise<RazorpayWebhookProcessingResult> {
  if (input.decision.kind === "ignore") {
    return completeIgnored(transaction, {
      ...input,
      businessKey: input.fallbackBusinessKey,
      reason: input.decision.reason
    });
  }
  if (input.decision.kind === "reconcile") {
    return reconcile(transaction, { ...input, decision: input.decision });
  }

  let effectRecordId: string;
  let action: RazorpayAuditRecord["action"];
  let aggregateType: "payment_transaction" | "payment_refund" | "payment_request";
  if (input.decision.kind === "record_payment") {
    const recorded = await transaction.recordPayment({
      eventRecordId: input.eventRecordId,
      event: input.event,
      decision: input.decision
    });
    effectRecordId = recorded.effectRecordId;
    action = "payment.succeeded";
    aggregateType = "payment_transaction";
    if (input.providerRequestId) {
      await transaction.updatePaymentRequestState({
        providerRequestId: input.providerRequestId,
        status: input.decision.nextRequestStatus,
        eventRecordId: input.eventRecordId
      });
    }
  } else if (input.decision.kind === "record_failure") {
    const recorded = await transaction.recordFailure({
      eventRecordId: input.eventRecordId,
      event: input.event,
      decision: input.decision
    });
    effectRecordId = recorded.effectRecordId;
    action = "payment.failed";
    aggregateType = "payment_transaction";
  } else if (input.decision.kind === "record_refund") {
    const recorded = await transaction.recordRefund({
      eventRecordId: input.eventRecordId,
      event: input.event,
      decision: input.decision
    });
    effectRecordId = recorded.effectRecordId;
    action = "payment.refunded";
    aggregateType = "payment_refund";
  } else {
    if (!input.providerRequestId) {
      return reconcile(transaction, {
        ...input,
        decision: {
          kind: "reconcile",
          reason: "missing_payment_request",
          businessKey: input.decision.businessKey,
          amountMinor: 0,
          safeAppliedAmountMinor: 0
        }
      });
    }
    const recorded = await transaction.updatePaymentRequestState({
      providerRequestId: input.providerRequestId,
      status: input.decision.nextRequestStatus,
      eventRecordId: input.eventRecordId
    });
    effectRecordId = recorded.effectRecordId;
    action = "billing.payment.changed";
    aggregateType = "payment_request";
  }

  await appendEvidence(transaction, {
    ...input,
    action,
    aggregateType,
    aggregateId: effectRecordId,
    businessKey: input.decision.businessKey,
    reason: null
  });
  if (input.decision.kind === "record_payment" && input.decision.reconciliationReason) {
    const reconciled = await transaction.createReconciliation({
      eventRecordId: input.eventRecordId,
      event: input.event,
      invoiceId: input.invoiceId,
      reason: input.decision.reconciliationReason,
      amountMinor: input.decision.capturedAmountMinor,
      safeAppliedAmountMinor: input.decision.appliedAmountMinor,
      businessKey: `${input.decision.businessKey}:overpayment`
    });
    await appendEvidence(transaction, {
      ...input,
      action: "payment.reconciliation_required",
      aggregateType: "payment_reconciliation",
      aggregateId: reconciled.reconciliationId,
      businessKey: `${input.decision.businessKey}:overpayment`,
      reason: input.decision.reconciliationReason
    });
    const result = resultFor(input, {
      status: "reconciliation_required",
      businessKey: input.decision.businessKey,
      effectRecordId,
      reconciliationId: reconciled.reconciliationId,
      reason: input.decision.reconciliationReason
    });
    await transaction.completeProviderEvent({
      eventRecordId: input.eventRecordId,
      processingStatus: "reconciliation_required",
      processedAt: input.now,
      result
    });
    return result;
  }
  const result = resultFor(input, {
    status: "applied",
    businessKey: input.decision.businessKey,
    effectRecordId,
    reconciliationId: null,
    reason: null
  });
  await transaction.completeProviderEvent({
    eventRecordId: input.eventRecordId,
    processingStatus: "applied",
    processedAt: input.now,
    result
  });
  return result;
}

async function reconcile(
  transaction: RazorpayTransactionalPort,
  input: {
    readonly account: RazorpayAccountScope;
    readonly event: NormalizedRazorpayEvent;
    readonly decision: Extract<RazorpayEventDecision, { kind: "reconcile" }>;
    readonly eventRecordId: string;
    readonly invoiceId: string | null;
    readonly requestId: string;
    readonly now: string;
  }
): Promise<RazorpayWebhookProcessingResult> {
  const created = await transaction.createReconciliation({
    eventRecordId: input.eventRecordId,
    event: input.event,
    invoiceId: input.invoiceId,
    reason: input.decision.reason,
    amountMinor: input.decision.amountMinor,
    safeAppliedAmountMinor: input.decision.safeAppliedAmountMinor,
    businessKey: input.decision.businessKey
  });
  await appendEvidence(transaction, {
    ...input,
    action: "payment.reconciliation_required",
    aggregateType: "payment_reconciliation",
    aggregateId: created.reconciliationId,
    businessKey: input.decision.businessKey,
    reason: input.decision.reason
  });
  const result = resultFor(input, {
    status: "reconciliation_required",
    businessKey: input.decision.businessKey,
    effectRecordId: null,
    reconciliationId: created.reconciliationId,
    reason: input.decision.reason
  });
  await transaction.completeProviderEvent({
    eventRecordId: input.eventRecordId,
    processingStatus: "reconciliation_required",
    processedAt: input.now,
    result
  });
  return result;
}

async function completeIgnored(
  transaction: RazorpayTransactionalPort,
  input: {
    readonly account: RazorpayAccountScope;
    readonly event: NormalizedRazorpayEvent;
    readonly eventRecordId: string;
    readonly businessKey: string;
    readonly reason: string;
    readonly requestId: string;
    readonly now: string;
  }
): Promise<RazorpayWebhookProcessingResult> {
  await appendEvidence(transaction, {
    ...input,
    action: "billing.payment.changed",
    aggregateType: "provider_event",
    aggregateId: input.eventRecordId
  });
  const result = resultFor(input, {
    status: "ignored",
    businessKey: input.businessKey,
    effectRecordId: null,
    reconciliationId: null,
    reason: input.reason
  });
  await transaction.completeProviderEvent({
    eventRecordId: input.eventRecordId,
    processingStatus: "ignored",
    processedAt: input.now,
    result
  });
  return result;
}

async function appendEvidence(
  transaction: RazorpayTransactionalPort,
  input: {
    readonly account: RazorpayAccountScope;
    readonly event: NormalizedRazorpayEvent;
    readonly eventRecordId: string;
    readonly action: RazorpayAuditRecord["action"];
    readonly aggregateType:
      | "payment_transaction"
      | "payment_refund"
      | "payment_reconciliation"
      | "payment_request"
      | "provider_event";
    readonly aggregateId: string;
    readonly businessKey: string;
    readonly reason?: string | null;
    readonly requestId: string;
    readonly now: string;
  }
): Promise<void> {
  const metadata = {
    provider: "razorpay",
    providerEventId: input.event.providerEventId,
    eventName: input.event.eventName,
    rawBodySha256: input.event.rawBodySha256,
    businessKey: input.businessKey,
    reason: input.reason ?? null
  } as const;
  await transaction.appendAudit({
    action: input.action,
    tenantId: input.account.tenantId,
    clinicId: input.account.clinicId,
    resourceType: "razorpay_provider_event",
    resourceId: input.eventRecordId,
    occurredAt: input.now,
    correlationId: input.requestId,
    metadata
  });
  await transaction.appendOutbox({
    eventType: outboxEventType(input.action),
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    idempotencyKey: `cp15:razorpay:${input.event.providerEventId}:${input.action}`,
    correlationId: input.requestId,
    occurredAt: input.now,
    payload: metadata
  });
}

function outboxEventType(
  action: RazorpayAuditRecord["action"]
): Parameters<RazorpayTransactionalPort["appendOutbox"]>[0]["eventType"] {
  return action === "billing.payment.changed" ? "integration.raw_event.received" : action;
}

function resultFor(
  input: { readonly event: NormalizedRazorpayEvent; readonly eventRecordId: string },
  result: Omit<RazorpayWebhookProcessingResult, "providerEventId" | "eventRecordId" | "replayed">
): RazorpayWebhookProcessingResult {
  return {
    ...result,
    providerEventId: input.event.providerEventId,
    eventRecordId: input.eventRecordId,
    replayed: false
  };
}

function evidenceEqual(
  left: RazorpayVerifiedEventEvidence,
  right: RazorpayVerifiedEventEvidence
): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortJson(entry)])
    );
  }
  return value;
}

function validNow(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    throw new Error("Razorpay processing clock is invalid.");
  return value;
}

function validIso(value: string, field: string): string {
  if (!Number.isFinite(Date.parse(value)))
    throw new RazorpayProcessingError("INVALID_VERIFIED_EVENT", `${field} is invalid.`);
  return new Date(value).toISOString();
}

function requiredToken(value: string, field: string): string {
  if (!value.trim() || value.length > 200)
    throw new RazorpayProcessingError("INVALID_VERIFIED_EVENT", `${field} is invalid.`);
  return value;
}
