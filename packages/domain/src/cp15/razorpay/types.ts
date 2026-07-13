export const RAZORPAY_EVENT_NAMES = Object.freeze([
  "payment.authorized",
  "payment.captured",
  "payment.failed",
  "payment_link.paid",
  "payment_link.partially_paid",
  "payment_link.cancelled",
  "payment_link.expired",
  "qr_code.created",
  "qr_code.credited",
  "qr_code.closed",
  "refund.created",
  "refund.processed",
  "refund.failed",
  "payment.dispute.created",
  "payment.dispute.under_review",
  "payment.dispute.won",
  "payment.dispute.lost",
  "payment.dispute.closed"
] as const);

export type RazorpayEventName = (typeof RAZORPAY_EVENT_NAMES)[number];

export type RazorpayActivationState =
  | "absent"
  | "registered"
  | "configured"
  | "sandbox_verified"
  | "production_verified"
  | "degraded"
  | "disabled";

export type RazorpayResourceKind = "payment" | "payment_link" | "qr_code" | "refund" | "dispute";

export interface RazorpayAccountScope {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly externalAccountId: string;
  readonly razorpayAccountId: string;
  readonly mode: "test" | "live";
}

export interface NormalizedRazorpayEvent {
  readonly provider: "razorpay";
  readonly providerEventId: string;
  readonly eventName: RazorpayEventName;
  readonly resourceKind: RazorpayResourceKind;
  readonly accountId: string;
  readonly occurredAt: string;
  readonly rawBodySha256: string;
  readonly signatureSha256: string;
  readonly verifiedSecretVersion: string;
  readonly invoiceId: string | null;
  readonly patientId: string | null;
  readonly tenantId: string | null;
  readonly clinicId: string | null;
  readonly providerPaymentId: string | null;
  readonly providerRequestId: string | null;
  readonly providerRefundId: string | null;
  readonly providerDisputeId: string | null;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly paymentCaptured: boolean;
  readonly providerStatus: string | null;
  readonly method: string | null;
}

export interface RazorpayInvoiceSettlementSnapshot {
  readonly invoiceId: string;
  readonly patientId: string;
  readonly status: "draft" | "issued" | "cancelled" | "void";
  readonly currency: string;
  readonly totalMinor: number;
  readonly paidMinor: number;
  readonly refundedMinor: number;
  readonly balanceMinor: number;
}

export interface RazorpayPaymentRequestBinding {
  readonly providerRequestId: string;
  readonly invoiceId: string;
  readonly patientId: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly requestKind: "payment_link" | "invoice_qr";
  readonly acceptPartial: boolean;
  readonly status: "created" | "partially_paid" | "paid" | "cancelled" | "expired" | "closed";
}

export interface RazorpayPaymentEffectSnapshot {
  readonly providerPaymentId: string;
  readonly invoiceId: string;
  readonly capturedAmountMinor: number;
  readonly refundedAmountMinor: number;
  readonly lastRank: number;
}

export type RazorpayReconciliationReason =
  | "account_scope_mismatch"
  | "missing_invoice_reference"
  | "missing_payment_request"
  | "invoice_mismatch"
  | "patient_mismatch"
  | "currency_mismatch"
  | "amount_mismatch"
  | "invalid_amount"
  | "invoice_not_issuable"
  | "overpayment"
  | "refund_without_payment"
  | "refund_exceeds_captured"
  | "dispute_requires_review"
  | "out_of_order_conflict"
  | "unsupported_event";

export type RazorpayEventDecision =
  | {
      readonly kind: "record_payment";
      readonly businessKey: string;
      readonly capturedAmountMinor: number;
      readonly appliedAmountMinor: number;
      readonly unallocatedAmountMinor: number;
      readonly reconciliationReason: "overpayment" | null;
      readonly nextRequestStatus: "partially_paid" | "paid";
    }
  | {
      readonly kind: "record_failure";
      readonly businessKey: string;
      readonly amountMinor: number;
    }
  | {
      readonly kind: "record_refund";
      readonly businessKey: string;
      readonly refundAmountMinor: number;
      readonly nextRefundedAmountMinor: number;
    }
  | {
      readonly kind: "observe_request_state";
      readonly businessKey: string;
      readonly nextRequestStatus: "cancelled" | "expired" | "closed";
    }
  | {
      readonly kind: "ignore";
      readonly reason:
        | "authorized_not_captured"
        | "non_financial_event"
        | "duplicate_business_effect"
        | "stale_event";
    }
  | {
      readonly kind: "reconcile";
      readonly reason: RazorpayReconciliationReason;
      readonly businessKey: string;
      readonly amountMinor: number;
      readonly safeAppliedAmountMinor: number;
    };
