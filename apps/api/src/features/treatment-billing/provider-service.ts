import type { BillingRepositoryPort } from "@clinic-os/db";
import type {
  DomainEventType,
  InvoiceDetail,
  PaymentTransactionRecord,
  UUID
} from "@clinic-os/domain";
import type { PaymentProviderWebhookEvent } from "@clinic-os/integrations";
import {
  decideVerifiedCp13ProviderPayment,
  type Cp13PaymentReconciliationReason
} from "../../../../../packages/domain/src/cp13/treatment-billing/invariants.ts";
import { ApiError } from "../../errors.ts";
import type { ApiResponse } from "../../framework/contracts.ts";
import type { ClinicFeatureRequestMetadata } from "../contracts.ts";

export interface VerifiedRazorpayPaymentEventRequest {
  readonly operationId: "receiveRazorpayPaymentWebhook";
  readonly accountScope: {
    readonly tenantId: UUID;
    readonly clinicId: UUID;
    readonly providerAccountKey: string;
  };
  readonly verification: {
    readonly status: "verified";
    readonly providerKey: "razorpay";
    readonly rawBodySha256: string;
    readonly signatureSha256: string;
  };
  readonly event: PaymentProviderWebhookEvent;
  readonly metadata: ClinicFeatureRequestMetadata;
}

export interface PaymentProviderEventResultProjection {
  readonly status: "processed" | "duplicate" | "ignored" | "reconciliation_required";
  readonly replayed: boolean;
  readonly invoice: Record<string, unknown> | null;
  readonly transaction: Record<string, unknown> | null;
  readonly reconciliationItem: PaymentReconciliationProjection | null;
  readonly providerEvent: Record<string, unknown>;
}

export interface DurablePaymentProviderEventResultProjection extends PaymentProviderEventResultProjection {
  readonly verificationEvidence: PaymentProviderEventEvidenceProjection;
}

export interface PaymentProviderEventEvidenceProjection {
  readonly rawBodySha256: string;
  readonly signatureSha256: string;
  readonly normalizedEvent: Record<string, unknown>;
}

export interface PaymentReconciliationProjection {
  readonly id: UUID;
  readonly reason: Cp13PaymentReconciliationReason;
  readonly invoiceId: UUID | null;
  readonly patientId: UUID | null;
  readonly capturedAmountMinor: number;
  readonly appliedAmountMinor: number;
  readonly unallocatedAmountMinor: number;
  readonly currency: string | null;
  readonly status: "open";
}

export interface DurablePaymentProviderEventPort {
  claimVerifiedEvent(input: {
    readonly providerAccountKey: string;
    readonly providerEventId: string;
    readonly idempotencyKey: string;
    readonly eventName: string;
    readonly eventKind: string;
    readonly rawBodySha256: string;
    readonly signatureSha256: string;
    readonly normalizedEvent: Record<string, unknown>;
    readonly receivedAt: string;
    readonly leaseOwner: string;
    readonly leaseExpiresAt: string;
  }): Promise<
    | { readonly outcome: "claimed"; readonly eventId: UUID }
    | {
        readonly outcome: "duplicate";
        readonly eventId: UUID;
        readonly storedEvidence: PaymentProviderEventEvidenceProjection;
        readonly result: DurablePaymentProviderEventResultProjection;
      }
    | { readonly outcome: "in_progress"; readonly eventId: UUID }
  >;
  createReconciliation(input: {
    readonly providerEventRecordId: UUID;
    readonly invoiceId: UUID | null;
    readonly patientId: UUID | null;
    readonly reason: Cp13PaymentReconciliationReason;
    readonly capturedAmountMinor: number;
    readonly appliedAmountMinor: number;
    readonly unallocatedAmountMinor: number;
    readonly currency: string | null;
    readonly evidence: Record<string, unknown>;
  }): Promise<PaymentReconciliationProjection>;
  completeEvent(input: {
    readonly providerEventRecordId: UUID;
    readonly processingStatus: "applied" | "ignored" | "reconciliation_required" | "failed";
    readonly processedAt: string;
    readonly result: DurablePaymentProviderEventResultProjection;
  }): Promise<void>;
}

export interface PaymentProviderTransactionEvidencePort {
  appendIntegrationAudit(input: {
    readonly action:
      | "billing.payment.changed"
      | "payment.succeeded"
      | "payment.failed"
      | "payment.reconciliation_required";
    readonly patientId: UUID | null;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly metadata: Record<string, unknown>;
    readonly ipAddress: string | null;
    readonly userAgent: string | null;
    readonly correlationId: string;
    readonly occurredAt: string;
  }): Promise<void>;
  appendOutboxEvent(input: {
    readonly eventType: DomainEventType;
    readonly aggregateType: string;
    readonly aggregateId: UUID;
    readonly patientId?: UUID | null;
    readonly idempotencyKey: string;
    readonly correlationId: string;
    readonly payload: Record<string, unknown>;
    readonly occurredAt: string;
  }): Promise<void>;
}

export interface TreatmentBillingProviderExecutionContext {
  readonly billing: BillingRepositoryPort;
  readonly providerEvents: DurablePaymentProviderEventPort;
  readonly evidence: PaymentProviderTransactionEvidencePort;
  readonly now: () => Date;
}

export interface TreatmentBillingProviderOperationService {
  readonly operationIds: readonly ["receiveRazorpayPaymentWebhook"];
  receiveRazorpayPaymentWebhook(
    request: VerifiedRazorpayPaymentEventRequest,
    context: TreatmentBillingProviderExecutionContext
  ): Promise<ApiResponse>;
}

export function createTreatmentBillingProviderOperationService(): TreatmentBillingProviderOperationService {
  return Object.freeze({
    operationIds: ["receiveRazorpayPaymentWebhook"] as const,
    receiveRazorpayPaymentWebhook: applyVerifiedRazorpayPaymentEvent
  });
}

async function applyVerifiedRazorpayPaymentEvent(
  request: VerifiedRazorpayPaymentEventRequest,
  context: TreatmentBillingProviderExecutionContext
): Promise<ApiResponse> {
  assertVerifiedRequest(request);
  const now = validNow(context).toISOString();
  const normalizedEvent = safeProviderEvent(request.event);
  const verificationEvidence = providerEventVerificationEvidence(request, normalizedEvent);
  const claim = await context.providerEvents.claimVerifiedEvent({
    providerAccountKey: request.accountScope.providerAccountKey,
    providerEventId: request.event.providerEventId,
    idempotencyKey: request.event.idempotencyKey,
    eventName: request.event.eventName,
    eventKind: request.event.eventKind,
    rawBodySha256: request.verification.rawBodySha256,
    signatureSha256: request.verification.signatureSha256,
    normalizedEvent,
    receivedAt: request.metadata.receivedAt.toISOString(),
    leaseOwner: request.metadata.requestId,
    leaseExpiresAt: new Date(new Date(now).getTime() + 30_000).toISOString()
  });
  if (claim.outcome === "duplicate") {
    const mismatchFields = [
      ...providerEventEvidenceMismatchFields(claim.storedEvidence, verificationEvidence),
      ...providerEventEvidenceMismatchFields(
        claim.result.verificationEvidence,
        verificationEvidence
      )
    ].filter((field, index, fields) => fields.indexOf(field) === index);
    if (mismatchFields.length > 0) {
      throw new ApiError(
        409,
        "CONFLICT",
        "A duplicate provider event does not match its stored verified evidence.",
        {
          reason: "provider_event_evidence_mismatch",
          reconciliation_required: true,
          provider_event_record_id: claim.eventId,
          mismatch_fields: mismatchFields
        }
      );
    }
    return {
      status: 200,
      body: {
        ...publicProviderEventResult(claim.result),
        status: "duplicate",
        replayed: true
      }
    };
  }
  if (claim.outcome === "in_progress") {
    throw new ApiError(
      503,
      "DEPENDENCY_UNAVAILABLE",
      "A verified payment event with this identifier is already being processed.",
      { reason: "provider_event_in_progress", retry_after_seconds: 5 }
    );
  }

  const providerEvent = normalizedEvent;
  const scopeMismatch =
    (request.event.tenantId && request.event.tenantId !== request.accountScope.tenantId) ||
    (request.event.clinicId && request.event.clinicId !== request.accountScope.clinicId);
  if (scopeMismatch) {
    return reconcileAndComplete(request, context, claim.eventId, {
      reason: "scope_mismatch",
      invoice: null,
      capturedAmountMinor: nonNegativeAmount(request.event.amountPaise),
      appliedAmountMinor: 0,
      providerEvent,
      processedAt: now
    });
  }

  const invoiceId = isUuid(request.event.invoiceId) ? (request.event.invoiceId as UUID) : null;
  if (!invoiceId) {
    return reconcileAndComplete(request, context, claim.eventId, {
      reason: "missing_invoice_reference",
      invoice: null,
      capturedAmountMinor: nonNegativeAmount(request.event.amountPaise),
      appliedAmountMinor: 0,
      providerEvent,
      processedAt: now
    });
  }
  const invoice = await context.billing.findInvoiceById(invoiceId);
  if (!invoice) {
    return reconcileAndComplete(request, context, claim.eventId, {
      reason: "missing_invoice_reference",
      invoice: null,
      capturedAmountMinor: nonNegativeAmount(request.event.amountPaise),
      appliedAmountMinor: 0,
      providerEvent,
      processedAt: now
    });
  }
  if (request.event.patientId && request.event.patientId !== invoice.invoice.patientId) {
    return reconcileAndComplete(request, context, claim.eventId, {
      reason: "scope_mismatch",
      invoice,
      capturedAmountMinor: nonNegativeAmount(request.event.amountPaise),
      appliedAmountMinor: 0,
      providerEvent,
      processedAt: now
    });
  }
  if (request.event.eventKind === "payment_succeeded" && !request.event.providerPaymentId?.trim()) {
    return reconcileAndComplete(request, context, claim.eventId, {
      reason: "manual_review_required",
      invoice,
      capturedAmountMinor: nonNegativeAmount(request.event.amountPaise),
      appliedAmountMinor: 0,
      providerEvent,
      processedAt: now
    });
  }

  const existing = invoice.payments.find(
    (payment) =>
      payment.provider === "razorpay" &&
      (payment.idempotencyKey === request.event.idempotencyKey ||
        Boolean(
          request.event.providerPaymentId &&
          payment.providerPaymentId === request.event.providerPaymentId
        ))
  );
  if (existing) {
    const result = resultProjection({
      status: "duplicate",
      replayed: true,
      invoice,
      transaction: existing,
      reconciliationItem: null,
      providerEvent,
      verificationEvidence
    });
    await context.providerEvents.completeEvent({
      providerEventRecordId: claim.eventId,
      processingStatus: "applied",
      processedAt: now,
      result
    });
    return { status: 200, body: publicProviderEventResult(result) };
  }

  const decision = decideVerifiedCp13ProviderPayment({
    eventKind: request.event.eventKind,
    amountMinor: request.event.amountPaise ?? null,
    currency: request.event.currency ?? null,
    invoice: invoice.invoice
  });
  if (decision.kind === "ignore") {
    const result = resultProjection({
      status: "ignored",
      replayed: false,
      invoice,
      transaction: null,
      reconciliationItem: null,
      providerEvent,
      verificationEvidence
    });
    await context.evidence.appendIntegrationAudit(
      integrationAudit(
        request,
        "billing.payment.changed",
        invoice.invoice.patientId,
        claim.eventId,
        {
          status: "ignored"
        },
        now
      )
    );
    await context.providerEvents.completeEvent({
      providerEventRecordId: claim.eventId,
      processingStatus: "ignored",
      processedAt: now,
      result
    });
    return { status: 200, body: publicProviderEventResult(result) };
  }
  if (decision.kind === "reconcile_without_settlement") {
    return reconcileAndComplete(request, context, claim.eventId, {
      reason: decision.reason,
      invoice,
      capturedAmountMinor: decision.capturedAmountMinor,
      appliedAmountMinor: 0,
      providerEvent,
      processedAt: now
    });
  }

  const transaction = await context.billing.recordPaymentTransaction({
    invoiceId,
    provider: "razorpay",
    providerPaymentId: request.event.providerPaymentId ?? null,
    providerOrderId: request.event.providerPaymentRequestId ?? null,
    amountMinor:
      decision.kind === "record_failed" ? decision.amountMinor : decision.appliedAmountMinor,
    currency: invoice.invoice.currency,
    method:
      request.event.method ?? (decision.kind === "record_failed" ? "provider_failure" : "provider"),
    status: decision.kind === "record_failed" ? "failed" : "succeeded",
    verificationStatus: "verified",
    reconciliationStatus:
      decision.kind === "record_succeeded" && decision.reconciliationReason
        ? "requires_review"
        : "matched",
    idempotencyKey: request.event.idempotencyKey,
    receivedAt: request.event.occurredAt,
    recordedByUserId: null,
    metadata: {
      providerEventRecordId: claim.eventId,
      providerEventId: request.event.providerEventId,
      rawBodySha256: request.verification.rawBodySha256,
      capturedAmountMinor:
        decision.kind === "record_failed" ? decision.amountMinor : decision.capturedAmountMinor,
      appliedAmountMinor: decision.kind === "record_failed" ? 0 : decision.appliedAmountMinor,
      unallocatedAmountMinor:
        decision.kind === "record_failed" ? 0 : decision.unallocatedAmountMinor
    }
  });
  if (!transaction) throw new Error("Verified provider transaction lost its resolved invoice.");
  const updatedInvoice = await context.billing.findInvoiceById(invoiceId);
  if (!updatedInvoice) throw new Error("Invoice disappeared after verified provider transaction.");

  let reconciliationItem: PaymentReconciliationProjection | null = null;
  let status: PaymentProviderEventResultProjection["status"] = "processed";
  if (decision.kind === "record_succeeded" && decision.reconciliationReason) {
    status = "reconciliation_required";
    reconciliationItem = await context.providerEvents.createReconciliation({
      providerEventRecordId: claim.eventId,
      invoiceId,
      patientId: invoice.invoice.patientId,
      reason: decision.reconciliationReason,
      capturedAmountMinor: decision.capturedAmountMinor,
      appliedAmountMinor: decision.appliedAmountMinor,
      unallocatedAmountMinor: decision.unallocatedAmountMinor,
      currency: invoice.invoice.currency,
      evidence: providerEvidence(request)
    });
  }
  const action =
    status === "reconciliation_required"
      ? "payment.reconciliation_required"
      : decision.kind === "record_failed"
        ? "payment.failed"
        : "payment.succeeded";
  await context.evidence.appendIntegrationAudit(
    integrationAudit(
      request,
      action,
      invoice.invoice.patientId,
      claim.eventId,
      {
        invoiceId,
        paymentTransactionId: transaction.id,
        reconciliationItemId: reconciliationItem?.id ?? null
      },
      now
    )
  );
  await context.evidence.appendOutboxEvent({
    eventType: action,
    aggregateType: "payment_transaction",
    aggregateId: transaction.id,
    patientId: invoice.invoice.patientId,
    idempotencyKey: `cp13:razorpay:${request.event.providerEventId}`,
    correlationId: request.metadata.requestId,
    payload: {
      invoiceId,
      paymentTransactionId: transaction.id,
      providerEventRecordId: claim.eventId,
      providerEventId: request.event.providerEventId,
      reconciliationItemId: reconciliationItem?.id ?? null,
      status
    },
    occurredAt: now
  });
  const result = resultProjection({
    status,
    replayed: false,
    invoice: updatedInvoice,
    transaction,
    reconciliationItem,
    providerEvent,
    verificationEvidence
  });
  await context.providerEvents.completeEvent({
    providerEventRecordId: claim.eventId,
    processingStatus:
      status === "reconciliation_required"
        ? "reconciliation_required"
        : decision.kind === "record_failed"
          ? "failed"
          : "applied",
    processedAt: now,
    result
  });
  return { status: 200, body: publicProviderEventResult(result) };
}

async function reconcileAndComplete(
  request: VerifiedRazorpayPaymentEventRequest,
  context: TreatmentBillingProviderExecutionContext,
  providerEventRecordId: UUID,
  input: {
    readonly reason: Cp13PaymentReconciliationReason;
    readonly invoice: InvoiceDetail | null;
    readonly capturedAmountMinor: number;
    readonly appliedAmountMinor: number;
    readonly providerEvent: Record<string, unknown>;
    readonly processedAt: string;
  }
): Promise<ApiResponse> {
  const reconciliationItem = await context.providerEvents.createReconciliation({
    providerEventRecordId,
    invoiceId: input.invoice?.invoice.id ?? null,
    patientId: input.invoice?.invoice.patientId ?? null,
    reason: input.reason,
    capturedAmountMinor: input.capturedAmountMinor,
    appliedAmountMinor: input.appliedAmountMinor,
    unallocatedAmountMinor: input.capturedAmountMinor - input.appliedAmountMinor,
    currency: request.event.currency ?? null,
    evidence: providerEvidence(request)
  });
  await context.evidence.appendIntegrationAudit(
    integrationAudit(
      request,
      "payment.reconciliation_required",
      input.invoice?.invoice.patientId ?? null,
      providerEventRecordId,
      {
        reason: input.reason,
        invoiceId: input.invoice?.invoice.id ?? null,
        reconciliationItemId: reconciliationItem.id
      },
      input.processedAt
    )
  );
  await context.evidence.appendOutboxEvent({
    eventType: "payment.reconciliation_required",
    aggregateType: "payment_reconciliation",
    aggregateId: reconciliationItem.id,
    patientId: input.invoice?.invoice.patientId ?? null,
    idempotencyKey: `cp13:razorpay:${request.event.providerEventId}`,
    correlationId: request.metadata.requestId,
    payload: {
      providerEventRecordId,
      providerEventId: request.event.providerEventId,
      invoiceId: input.invoice?.invoice.id ?? null,
      reconciliationItemId: reconciliationItem.id,
      reason: input.reason
    },
    occurredAt: input.processedAt
  });
  const result = resultProjection({
    status: "reconciliation_required",
    replayed: false,
    invoice: input.invoice,
    transaction: null,
    reconciliationItem,
    providerEvent: input.providerEvent,
    verificationEvidence: providerEventVerificationEvidence(request, input.providerEvent)
  });
  await context.providerEvents.completeEvent({
    providerEventRecordId,
    processingStatus: "reconciliation_required",
    processedAt: input.processedAt,
    result
  });
  return { status: 200, body: publicProviderEventResult(result) };
}

function assertVerifiedRequest(request: VerifiedRazorpayPaymentEventRequest): void {
  if (
    request.verification.status !== "verified" ||
    request.verification.providerKey !== "razorpay" ||
    request.event.providerKey !== "razorpay"
  ) {
    throw new ApiError(403, "PERMISSION_DENIED", "Razorpay event was not signature verified.");
  }
  if (
    !isSha256(request.verification.rawBodySha256) ||
    request.verification.rawBodySha256 !== request.event.rawBodySha256 ||
    !isSha256(request.verification.signatureSha256)
  ) {
    throw new ApiError(400, "VALIDATION_ERROR", "Verified Razorpay evidence digest is invalid.");
  }
  if (
    !request.accountScope.providerAccountKey.trim() ||
    !request.event.providerEventId.trim() ||
    !request.event.idempotencyKey.trim()
  ) {
    throw new ApiError(400, "VALIDATION_ERROR", "Verified Razorpay event identity is incomplete.");
  }
}

function integrationAudit(
  request: VerifiedRazorpayPaymentEventRequest,
  action: PaymentProviderTransactionEvidencePort["appendIntegrationAudit"] extends (
    input: infer T
  ) => Promise<void>
    ? T extends { action: infer TAction }
      ? TAction
      : never
    : never,
  patientId: UUID | null,
  resourceId: UUID,
  metadata: Record<string, unknown>,
  occurredAt: string
) {
  return {
    action,
    patientId,
    resourceType: "payment_provider_event",
    resourceId,
    metadata: {
      providerKey: "razorpay",
      providerEventId: request.event.providerEventId,
      rawBodySha256: request.verification.rawBodySha256,
      ...metadata
    },
    ipAddress: request.metadata.ipAddress,
    userAgent: request.metadata.userAgent,
    correlationId: request.metadata.requestId,
    occurredAt
  } as const;
}

function providerEvidence(request: VerifiedRazorpayPaymentEventRequest) {
  return {
    providerKey: "razorpay",
    providerEventId: request.event.providerEventId,
    providerPaymentId: request.event.providerPaymentId ?? null,
    rawBodySha256: request.verification.rawBodySha256,
    signatureSha256: request.verification.signatureSha256,
    verificationStatus: "verified"
  };
}

function providerEventVerificationEvidence(
  request: VerifiedRazorpayPaymentEventRequest,
  normalizedEvent: Record<string, unknown>
): PaymentProviderEventEvidenceProjection {
  return {
    rawBodySha256: request.verification.rawBodySha256,
    signatureSha256: request.verification.signatureSha256,
    normalizedEvent
  };
}

function providerEventEvidenceMismatchFields(
  stored: PaymentProviderEventEvidenceProjection,
  incoming: PaymentProviderEventEvidenceProjection
): string[] {
  const mismatches: string[] = [];
  if (stored.rawBodySha256 !== incoming.rawBodySha256) mismatches.push("raw_body_sha256");
  if (stored.signatureSha256 !== incoming.signatureSha256) mismatches.push("signature_sha256");
  if (stableJson(stored.normalizedEvent) !== stableJson(incoming.normalizedEvent)) {
    mismatches.push("normalized_event");
  }
  return mismatches;
}

function safeProviderEvent(event: PaymentProviderWebhookEvent) {
  return {
    providerKey: event.providerKey,
    providerEventId: event.providerEventId,
    eventName: event.eventName,
    eventKind: event.eventKind,
    occurredAt: event.occurredAt,
    invoiceId: event.invoiceId ?? null,
    patientId: event.patientId ?? null,
    providerPaymentId: event.providerPaymentId ?? null,
    providerPaymentRequestId: event.providerPaymentRequestId ?? null,
    amountMinor: event.amountPaise ?? null,
    currency: event.currency ?? null,
    method: event.method ?? null,
    rawBodySha256: event.rawBodySha256
  };
}

function resultProjection(input: {
  readonly status: PaymentProviderEventResultProjection["status"];
  readonly replayed: boolean;
  readonly invoice: InvoiceDetail | null;
  readonly transaction: PaymentTransactionRecord | null;
  readonly reconciliationItem: PaymentReconciliationProjection | null;
  readonly providerEvent: Record<string, unknown>;
  readonly verificationEvidence: PaymentProviderEventEvidenceProjection;
}): DurablePaymentProviderEventResultProjection {
  return {
    status: input.status,
    replayed: input.replayed,
    invoice: input.invoice ? publicInvoice(input.invoice) : null,
    transaction: input.transaction ? publicTransaction(input.transaction) : null,
    reconciliationItem: input.reconciliationItem,
    providerEvent: input.providerEvent,
    verificationEvidence: input.verificationEvidence
  };
}

function publicProviderEventResult(
  result: DurablePaymentProviderEventResultProjection
): PaymentProviderEventResultProjection {
  const { verificationEvidence: _verificationEvidence, ...publicResult } = result;
  return publicResult;
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entryValue]) => entryValue !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entryValue]) => [key, stableJsonValue(entryValue)])
    );
  }
  return value;
}

function publicInvoice(detail: InvoiceDetail) {
  return {
    id: detail.invoice.id,
    patientId: detail.invoice.patientId,
    invoiceNumber: detail.invoice.invoiceNumber,
    status: detail.invoice.status,
    paymentStatus: detail.invoice.paymentStatus,
    currency: detail.invoice.currency,
    totalMinor: detail.invoice.totalMinor,
    paidMinor: detail.invoice.paidMinor,
    refundedMinor: detail.invoice.refundedMinor,
    balanceMinor: detail.invoice.balanceMinor,
    updatedAt: detail.invoice.updatedAt
  };
}

function publicTransaction(payment: PaymentTransactionRecord) {
  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    patientId: payment.patientId,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    verificationStatus: payment.verificationStatus,
    reconciliationStatus: payment.reconciliationStatus,
    receivedAt: payment.receivedAt
  };
}

function validNow(context: TreatmentBillingProviderExecutionContext): Date {
  const value = context.now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Provider event clock returned an invalid instant.");
  }
  return value;
}

function nonNegativeAmount(value: number | null | undefined): number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? (value as number) : 0;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  );
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/u.test(value);
}
