import type {
  NormalizedRazorpayEvent,
  RazorpayAccountScope,
  RazorpayEventDecision,
  RazorpayInvoiceSettlementSnapshot,
  RazorpayPaymentEffectSnapshot,
  RazorpayPaymentRequestBinding,
  RazorpayReconciliationReason
} from "../../../../../packages/domain/src/cp15/razorpay/index.ts";

export interface RazorpayVerifiedEventEvidence {
  readonly rawBodySha256: string;
  readonly signatureSha256: string;
  readonly verifiedSecretVersion: string;
  readonly rawBodyLength: number;
  readonly usedPreviousSecret: boolean;
  readonly normalizedEvent: NormalizedRazorpayEvent;
}

export interface RazorpayWebhookProcessingResult {
  readonly status: "applied" | "duplicate" | "ignored" | "reconciliation_required";
  readonly replayed: boolean;
  readonly providerEventId: string;
  readonly eventRecordId: string;
  readonly businessKey: string | null;
  readonly effectRecordId: string | null;
  readonly reconciliationId: string | null;
  readonly reason: string | null;
}

export type RazorpayEventClaim =
  | { readonly outcome: "claimed"; readonly eventRecordId: string }
  | { readonly outcome: "in_progress"; readonly eventRecordId: string }
  | {
      readonly outcome: "duplicate";
      readonly eventRecordId: string;
      readonly storedEvidence: RazorpayVerifiedEventEvidence;
      readonly storedResult: RazorpayWebhookProcessingResult;
    }
  | { readonly outcome: "evidence_conflict"; readonly eventRecordId: string };

export interface RazorpayTransactionalPort {
  claimProviderEvent(input: {
    readonly account: RazorpayAccountScope;
    readonly providerEventId: string;
    readonly eventName: string;
    readonly evidence: RazorpayVerifiedEventEvidence;
    readonly leaseOwner: string;
    readonly leaseExpiresAt: string;
    readonly receivedAt: string;
  }): Promise<RazorpayEventClaim>;
  findInvoice(invoiceId: string | null): Promise<RazorpayInvoiceSettlementSnapshot | null>;
  findPaymentRequest(input: {
    readonly providerRequestId: string | null;
    readonly invoiceId: string | null;
  }): Promise<RazorpayPaymentRequestBinding | null>;
  findPaymentEffect(
    providerPaymentId: string | null
  ): Promise<RazorpayPaymentEffectSnapshot | null>;
  /**
   * Serialize this key inside the current database transaction (for example with an
   * account-scoped transaction advisory lock), then inspect the durable business-effect ledger.
   * The matching record/apply method must finalize that ledger row before transaction commit.
   */
  claimBusinessEffect(businessKey: string): Promise<"claimed" | "duplicate">;
  recordPayment(input: {
    readonly eventRecordId: string;
    readonly event: NormalizedRazorpayEvent;
    readonly decision: Extract<RazorpayEventDecision, { kind: "record_payment" }>;
  }): Promise<{ readonly effectRecordId: string }>;
  recordFailure(input: {
    readonly eventRecordId: string;
    readonly event: NormalizedRazorpayEvent;
    readonly decision: Extract<RazorpayEventDecision, { kind: "record_failure" }>;
  }): Promise<{ readonly effectRecordId: string }>;
  recordRefund(input: {
    readonly eventRecordId: string;
    readonly event: NormalizedRazorpayEvent;
    readonly decision: Extract<RazorpayEventDecision, { kind: "record_refund" }>;
  }): Promise<{ readonly effectRecordId: string }>;
  updatePaymentRequestState(input: {
    readonly providerRequestId: string;
    readonly status: "cancelled" | "expired" | "closed" | "partially_paid" | "paid";
    readonly eventRecordId: string;
  }): Promise<{ readonly effectRecordId: string }>;
  createReconciliation(input: {
    readonly eventRecordId: string;
    readonly event: NormalizedRazorpayEvent;
    readonly invoiceId: string | null;
    readonly reason: RazorpayReconciliationReason;
    readonly amountMinor: number;
    readonly safeAppliedAmountMinor: number;
    readonly businessKey: string;
  }): Promise<{ readonly reconciliationId: string }>;
  appendAudit(input: RazorpayAuditRecord): Promise<void>;
  appendOutbox(input: RazorpayOutboxRecord): Promise<void>;
  completeProviderEvent(input: {
    readonly eventRecordId: string;
    readonly processingStatus: "applied" | "ignored" | "reconciliation_required";
    readonly processedAt: string;
    readonly result: RazorpayWebhookProcessingResult;
  }): Promise<void>;
}

export interface RazorpayUnitOfWorkPort {
  transaction<T>(
    account: RazorpayAccountScope,
    execute: (transaction: RazorpayTransactionalPort) => Promise<T>
  ): Promise<T>;
}

export interface RazorpayAuditRecord {
  readonly action:
    | "payment.succeeded"
    | "payment.failed"
    | "payment.refunded"
    | "payment.reconciliation_required"
    | "billing.payment.changed";
  readonly tenantId: string;
  readonly clinicId: string;
  readonly resourceType: "razorpay_provider_event";
  readonly resourceId: string;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface RazorpayOutboxRecord {
  readonly eventType:
    | "payment.succeeded"
    | "payment.failed"
    | "payment.refunded"
    | "payment.reconciliation_required"
    | "integration.raw_event.received";
  readonly aggregateType:
    | "payment_transaction"
    | "payment_refund"
    | "payment_reconciliation"
    | "payment_request"
    | "provider_event";
  readonly aggregateId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface RazorpayProcessingMetadata {
  readonly requestId: string;
  readonly receivedAt: string;
}

export interface RazorpayRawWebhookInput {
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly rawBody: Uint8Array;
  readonly receivedAt: string;
}

export interface RazorpayVerifiedWebhookInput {
  readonly account: RazorpayAccountScope;
  readonly event: NormalizedRazorpayEvent;
  readonly rawBodyLength: number;
  readonly usedPreviousSecret: boolean;
}

export interface RazorpayWebhookVerifierPort {
  /** Must perform the bounded raw-body HMAC check before parsing or returning an event. */
  verify(raw: RazorpayRawWebhookInput): RazorpayVerifiedWebhookInput;
}
