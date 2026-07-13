import type {
  NormalizedRazorpayEvent,
  RazorpayAccountScope,
  RazorpayEventDecision,
  RazorpayInvoiceSettlementSnapshot,
  RazorpayPaymentEffectSnapshot,
  RazorpayPaymentRequestBinding
} from "./types.ts";

const EVENT_RANK: Readonly<Record<NormalizedRazorpayEvent["eventName"], number>> = Object.freeze({
  "payment.failed": 10,
  "payment.authorized": 20,
  "payment.captured": 30,
  "payment_link.partially_paid": 30,
  "payment_link.paid": 30,
  "qr_code.credited": 30,
  "refund.created": 40,
  "refund.failed": 40,
  "refund.processed": 50,
  "payment.dispute.created": 60,
  "payment.dispute.under_review": 61,
  "payment.dispute.won": 62,
  "payment.dispute.lost": 62,
  "payment.dispute.closed": 63,
  "payment_link.cancelled": 70,
  "payment_link.expired": 70,
  "qr_code.created": 5,
  "qr_code.closed": 70
});

export function razorpayEventRank(eventName: NormalizedRazorpayEvent["eventName"]): number {
  return EVENT_RANK[eventName];
}

export function decideRazorpayEvent(input: {
  readonly account: RazorpayAccountScope;
  readonly event: NormalizedRazorpayEvent;
  readonly invoice: RazorpayInvoiceSettlementSnapshot | null;
  readonly paymentRequest: RazorpayPaymentRequestBinding | null;
  readonly existingPayment: RazorpayPaymentEffectSnapshot | null;
  readonly businessEffectExists: boolean;
}): RazorpayEventDecision {
  const { account, event, invoice, paymentRequest, existingPayment } = input;
  const businessKey = razorpayBusinessKey(event);
  const amountMinor = validMinor(event.amountMinor) ? event.amountMinor : 0;

  if (event.accountId !== account.razorpayAccountId) {
    return reconcile("account_scope_mismatch", businessKey, amountMinor);
  }
  if (
    (event.tenantId !== null && event.tenantId !== account.tenantId) ||
    (event.clinicId !== null && event.clinicId !== account.clinicId)
  ) {
    return reconcile("account_scope_mismatch", businessKey, amountMinor);
  }
  if (input.businessEffectExists) return { kind: "ignore", reason: "duplicate_business_effect" };

  if (event.eventName === "payment.authorized") {
    return { kind: "ignore", reason: "authorized_not_captured" };
  }
  if (
    event.eventName === "qr_code.created" ||
    event.eventName === "refund.created" ||
    event.eventName === "refund.failed"
  ) {
    return { kind: "ignore", reason: "non_financial_event" };
  }
  if (isDispute(event.eventName)) {
    return reconcile("dispute_requires_review", businessKey, amountMinor);
  }
  if (isRequestClosure(event.eventName)) {
    if (!paymentRequest) return reconcile("missing_payment_request", businessKey, 0);
    return {
      kind: "observe_request_state",
      businessKey,
      nextRequestStatus:
        event.eventName === "payment_link.cancelled"
          ? "cancelled"
          : event.eventName === "payment_link.expired"
            ? "expired"
            : "closed"
    };
  }
  if (event.eventName === "refund.processed") {
    if (!event.providerPaymentId || !event.providerRefundId || !existingPayment) {
      return reconcile("refund_without_payment", businessKey, amountMinor);
    }
    if (!invoice || invoice.invoiceId !== existingPayment.invoiceId) {
      return reconcile("invoice_mismatch", businessKey, amountMinor);
    }
    if (!validMinor(event.amountMinor) || event.amountMinor <= 0) {
      return reconcile("invalid_amount", businessKey, 0);
    }
    if (event.currency !== invoice.currency) {
      return reconcile("currency_mismatch", businessKey, event.amountMinor);
    }
    const nextRefunded = existingPayment.refundedAmountMinor + event.amountMinor;
    if (nextRefunded > existingPayment.capturedAmountMinor) {
      return reconcile("refund_exceeds_captured", businessKey, event.amountMinor);
    }
    return {
      kind: "record_refund",
      businessKey,
      refundAmountMinor: event.amountMinor,
      nextRefundedAmountMinor: nextRefunded
    };
  }

  if (!invoice || !event.invoiceId)
    return reconcile("missing_invoice_reference", businessKey, amountMinor);
  if (event.invoiceId !== invoice.invoiceId)
    return reconcile("invoice_mismatch", businessKey, amountMinor);
  if (event.patientId !== null && event.patientId !== invoice.patientId) {
    return reconcile("patient_mismatch", businessKey, amountMinor);
  }
  if (invoice.status !== "issued")
    return reconcile("invoice_not_issuable", businessKey, amountMinor);
  if (!validMinor(event.amountMinor) || event.amountMinor <= 0) {
    return reconcile("invalid_amount", businessKey, 0);
  }
  if (event.currency !== invoice.currency)
    return reconcile("currency_mismatch", businessKey, event.amountMinor);
  if (existingPayment && razorpayEventRank(event.eventName) < existingPayment.lastRank) {
    return { kind: "ignore", reason: "stale_event" };
  }

  if (event.eventName === "payment.failed") {
    return { kind: "record_failure", businessKey, amountMinor: event.amountMinor };
  }
  if (!isSettlement(event.eventName) || !event.providerPaymentId || !event.paymentCaptured) {
    return reconcile("unsupported_event", businessKey, event.amountMinor);
  }
  if (!paymentRequest) return reconcile("missing_payment_request", businessKey, event.amountMinor);
  if (paymentRequest.invoiceId !== invoice.invoiceId) {
    return reconcile("invoice_mismatch", businessKey, event.amountMinor);
  }
  if (paymentRequest.patientId !== invoice.patientId) {
    return reconcile("patient_mismatch", businessKey, event.amountMinor);
  }
  if (paymentRequest.currency !== event.currency) {
    return reconcile("currency_mismatch", businessKey, event.amountMinor);
  }
  if (!paymentRequest.acceptPartial && event.amountMinor !== paymentRequest.amountMinor) {
    return reconcile("amount_mismatch", businessKey, event.amountMinor);
  }
  const appliedAmountMinor = Math.min(event.amountMinor, Math.max(0, invoice.balanceMinor));
  const unallocatedAmountMinor = event.amountMinor - appliedAmountMinor;
  if (appliedAmountMinor === 0) {
    return reconcile("overpayment", businessKey, event.amountMinor);
  }
  return {
    kind: "record_payment",
    businessKey,
    capturedAmountMinor: event.amountMinor,
    appliedAmountMinor,
    unallocatedAmountMinor,
    reconciliationReason: unallocatedAmountMinor > 0 ? "overpayment" : null,
    nextRequestStatus:
      appliedAmountMinor < invoice.balanceMinor || event.eventName === "payment_link.partially_paid"
        ? "partially_paid"
        : "paid"
  };
}

export function razorpayBusinessKey(event: NormalizedRazorpayEvent): string {
  if (event.eventName === "refund.processed" && event.providerRefundId) {
    return `razorpay:refund:${event.providerRefundId}:processed`;
  }
  if (isDispute(event.eventName) && event.providerDisputeId) {
    return `razorpay:dispute:${event.providerDisputeId}:${event.eventName}`;
  }
  if (isSettlement(event.eventName) && event.providerPaymentId) {
    return `razorpay:payment:${event.providerPaymentId}:captured`;
  }
  if (event.eventName === "payment.failed" && event.providerPaymentId) {
    return `razorpay:payment:${event.providerPaymentId}:failed`;
  }
  return `razorpay:event:${event.providerEventId}`;
}

function reconcile(
  reason: Extract<RazorpayEventDecision, { kind: "reconcile" }>["reason"],
  businessKey: string,
  amountMinor: number
): RazorpayEventDecision {
  return { kind: "reconcile", reason, businessKey, amountMinor, safeAppliedAmountMinor: 0 };
}

function validMinor(value: number | null): value is number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0;
}

function isSettlement(event: NormalizedRazorpayEvent["eventName"]): boolean {
  return [
    "payment.captured",
    "payment_link.paid",
    "payment_link.partially_paid",
    "qr_code.credited"
  ].includes(event);
}

function isRequestClosure(event: NormalizedRazorpayEvent["eventName"]): boolean {
  return ["payment_link.cancelled", "payment_link.expired", "qr_code.closed"].includes(event);
}

function isDispute(event: NormalizedRazorpayEvent["eventName"]): boolean {
  return event.startsWith("payment.dispute.");
}
