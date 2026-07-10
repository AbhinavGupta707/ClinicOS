import type { InvoiceRecord, PatientInstructionRecord } from "../../index.ts";

export const CP13_MANUAL_PAYMENT_METHODS = Object.freeze([
  "cash",
  "upi",
  "card",
  "bank_transfer",
  "cheque",
  "other"
] as const);

export type Cp13ManualPaymentMethod = (typeof CP13_MANUAL_PAYMENT_METHODS)[number];

export type Cp13ProviderPaymentEventKind =
  "payment_succeeded" | "payment_failed" | "payment_authorized" | "payment_ignored";

export type Cp13PaymentReconciliationReason =
  | "overpayment"
  | "missing_invoice_reference"
  | "currency_mismatch"
  | "invalid_provider_amount"
  | "scope_mismatch"
  | "manual_review_required";

export type Cp13ProviderPaymentDecision =
  | { readonly kind: "ignore" }
  | {
      readonly kind: "record_failed";
      readonly amountMinor: number;
    }
  | {
      readonly kind: "record_succeeded";
      readonly appliedAmountMinor: number;
      readonly capturedAmountMinor: number;
      readonly unallocatedAmountMinor: number;
      readonly reconciliationReason: "overpayment" | null;
    }
  | {
      readonly kind: "reconcile_without_settlement";
      readonly capturedAmountMinor: number;
      readonly reason: Exclude<
        Cp13PaymentReconciliationReason,
        "missing_invoice_reference" | "scope_mismatch"
      >;
    };

const MANUAL_PAYMENT_METHOD_SET = new Set<string>(CP13_MANUAL_PAYMENT_METHODS);

export function assertCp13ManualPaymentEvidence(input: {
  readonly amountMinor: number;
  readonly currency: string;
  readonly method: string;
  readonly reason: string;
  readonly reference: string;
  readonly evidence: Readonly<Record<string, unknown>>;
}): asserts input is typeof input & { readonly method: Cp13ManualPaymentMethod } {
  assertPositiveMinorAmount(input.amountMinor, "amountMinor");
  if (input.currency !== "INR") {
    throw new Error("Manual payment currency must be INR.");
  }
  if (!MANUAL_PAYMENT_METHOD_SET.has(input.method)) {
    throw new Error(`Unsupported manual payment method: ${input.method}.`);
  }
  if (input.reason.trim().length === 0) {
    throw new Error("Manual payment requires an audit reason.");
  }
  if (input.reference.trim().length === 0) {
    throw new Error("Manual payment requires a clinic-approved reference.");
  }
  if (Object.keys(input.evidence).length === 0) {
    throw new Error("Manual payment requires non-empty supporting evidence.");
  }
}

export function assertInvoiceCreationReferencesCompletedEvidence(input: {
  readonly treatmentPlanId?: string | null;
  readonly procedurePerformedIds?: readonly string[];
}): void {
  if (!input.treatmentPlanId && (input.procedurePerformedIds?.length ?? 0) === 0) {
    throw new Error(
      "Invoice creation requires a treatment plan or completed procedure evidence reference."
    );
  }
}

export function normalizeCp13PaymentRequestType(
  requestType: "payment_link" | "invoice_qr"
): "payment_link" | "dynamic_qr" {
  return requestType === "invoice_qr" ? "dynamic_qr" : "payment_link";
}

export function decideVerifiedCp13ProviderPayment(input: {
  readonly eventKind: Cp13ProviderPaymentEventKind;
  readonly amountMinor: number | null;
  readonly currency: string | null;
  readonly invoice: Pick<InvoiceRecord, "balanceMinor" | "currency" | "status">;
}): Cp13ProviderPaymentDecision {
  if (input.eventKind === "payment_authorized" || input.eventKind === "payment_ignored") {
    return { kind: "ignore" };
  }

  if (input.invoice.status !== "issued") {
    return {
      kind: "reconcile_without_settlement",
      capturedAmountMinor: nonNegativeProviderAmount(input.amountMinor),
      reason: "manual_review_required"
    };
  }

  if (input.currency !== input.invoice.currency) {
    return {
      kind: "reconcile_without_settlement",
      capturedAmountMinor: nonNegativeProviderAmount(input.amountMinor),
      reason: "currency_mismatch"
    };
  }

  if (!Number.isSafeInteger(input.amountMinor) || (input.amountMinor ?? 0) <= 0) {
    return {
      kind: "reconcile_without_settlement",
      capturedAmountMinor: 0,
      reason: "invalid_provider_amount"
    };
  }

  const capturedAmountMinor = input.amountMinor as number;
  if (input.eventKind === "payment_failed") {
    return { kind: "record_failed", amountMinor: capturedAmountMinor };
  }

  const appliedAmountMinor = Math.min(capturedAmountMinor, input.invoice.balanceMinor);
  const unallocatedAmountMinor = capturedAmountMinor - appliedAmountMinor;
  if (appliedAmountMinor === 0) {
    return {
      kind: "reconcile_without_settlement",
      capturedAmountMinor,
      reason: "overpayment"
    };
  }

  return {
    kind: "record_succeeded",
    appliedAmountMinor,
    capturedAmountMinor,
    unallocatedAmountMinor,
    reconciliationReason: unallocatedAmountMinor > 0 ? "overpayment" : null
  };
}

export function assertInstructionRemainsRequestEvidence(
  instruction: Pick<
    PatientInstructionRecord,
    | "status"
    | "providerConfirmationReceived"
    | "providerDeliveryConfirmedAt"
    | "deliveredAt"
    | "readAt"
  >
): void {
  if (!["ready_for_print", "send_requested"].includes(instruction.status)) {
    throw new Error("Patient instruction must remain print-ready or send-request evidence.");
  }
  if (
    instruction.providerConfirmationReceived ||
    instruction.providerDeliveryConfirmedAt !== null ||
    instruction.deliveredAt !== null ||
    instruction.readAt !== null
  ) {
    throw new Error("Instruction request cannot claim provider delivery or patient read evidence.");
  }
}

function assertPositiveMinorAmount(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer minor-unit amount.`);
  }
}

function nonNegativeProviderAmount(value: number | null): number {
  return Number.isSafeInteger(value) && (value ?? -1) >= 0 ? (value as number) : 0;
}
