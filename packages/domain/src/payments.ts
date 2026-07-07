export const MANUAL_PAYMENT_METHODS = [
  "cash",
  "card",
  "static_upi",
  "bank_transfer",
  "cheque",
  "other"
] as const;
export type ManualPaymentMethod = (typeof MANUAL_PAYMENT_METHODS)[number];

export interface ManualPaymentEvidenceInput {
  amountPaise: number;
  currency: string;
  method: ManualPaymentMethod;
  reason: string;
  reference: string;
  receivedAt?: string | null;
  evidence?: Record<string, unknown>;
}

export interface PaymentApplicationInput {
  invoiceTotalAmountPaise: number;
  invoiceAmountPaidPaise: number;
  transactionAmountPaise: number;
  isDuplicate?: boolean;
}

export interface PaymentApplicationResult {
  appliedAmountPaise: number;
  overpaymentAmountPaise: number;
  nextAmountPaidPaise: number;
  nextAmountDuePaise: number;
  nextPaymentState: "payment_requested" | "partially_paid" | "paid";
  requiresReconciliation: boolean;
}

const MANUAL_PAYMENT_METHOD_SET = new Set<string>(MANUAL_PAYMENT_METHODS);

export function isManualPaymentMethod(value: unknown): value is ManualPaymentMethod {
  return typeof value === "string" && MANUAL_PAYMENT_METHOD_SET.has(value);
}

export function assertPositiveMoneyPaise(amountPaise: number, field = "amountPaise"): void {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new Error(`${field} must be a positive integer paise amount.`);
  }
}

export function assertManualPaymentEvidence(input: ManualPaymentEvidenceInput): void {
  assertPositiveMoneyPaise(input.amountPaise);

  if (!/^[A-Z]{3}$/.test(input.currency)) {
    throw new Error("Manual payment currency must be an ISO 4217 uppercase code.");
  }
  if (!isManualPaymentMethod(input.method)) {
    throw new Error(`Unsupported manual payment method: ${input.method}.`);
  }
  if (!input.reason.trim()) {
    throw new Error("Manual payment requires an audit reason.");
  }
  if (!input.reference.trim()) {
    throw new Error("Manual payment requires a receipt, UPI, bank, or clinic-approved reference.");
  }
}

export function applyPaymentToInvoice(
  input: PaymentApplicationInput
): PaymentApplicationResult {
  assertPositiveMoneyPaise(input.invoiceTotalAmountPaise, "invoiceTotalAmountPaise");
  if (!Number.isInteger(input.invoiceAmountPaidPaise) || input.invoiceAmountPaidPaise < 0) {
    throw new Error("invoiceAmountPaidPaise must be a non-negative integer paise amount.");
  }
  assertPositiveMoneyPaise(input.transactionAmountPaise, "transactionAmountPaise");

  const currentPaid = Math.min(input.invoiceAmountPaidPaise, input.invoiceTotalAmountPaise);
  const remainingDue = Math.max(0, input.invoiceTotalAmountPaise - currentPaid);
  const appliedAmountPaise = input.isDuplicate
    ? 0
    : Math.min(input.transactionAmountPaise, remainingDue);
  const overpaymentAmountPaise = input.isDuplicate
    ? input.transactionAmountPaise
    : Math.max(0, input.transactionAmountPaise - appliedAmountPaise);
  const nextAmountPaidPaise = currentPaid + appliedAmountPaise;
  const nextAmountDuePaise = Math.max(0, input.invoiceTotalAmountPaise - nextAmountPaidPaise);

  return {
    appliedAmountPaise,
    overpaymentAmountPaise,
    nextAmountPaidPaise,
    nextAmountDuePaise,
    nextPaymentState:
      nextAmountDuePaise === 0 ? "paid" : nextAmountPaidPaise > 0 ? "partially_paid" : "payment_requested",
    requiresReconciliation: overpaymentAmountPaise > 0 || Boolean(input.isDuplicate)
  };
}
