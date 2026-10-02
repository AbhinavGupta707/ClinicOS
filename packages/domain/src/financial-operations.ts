/** Money stays in integer paise. A charge reduction and a money return are distinct facts. */
export const FINANCIAL_COMMANDS = [
  "invoice_credit",
  "payment_reversal",
  "payment_refund",
  "advance_received",
  "advance_allocated",
  "advance_returned",
  "allocation_reversed",
  "expense",
  "expense_reversal"
] as const;
export type FinancialCommandKind = (typeof FINANCIAL_COMMANDS)[number];
export interface FinancialCommandInput {
  kind: FinancialCommandKind;
  patientId?: string;
  invoiceId?: string;
  invoiceItemId?: string;
  paymentTransactionId?: string;
  targetEntryId?: string;
  expectedVersion?: number;
  amountMinor?: number;
  method?: string;
  reason: string;
  reference: string;
}
export function safeMinor(value: unknown): number {
  const n = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
    throw new RangeError("Money must be non-negative integer paise within the supported range.");
  return n;
}
export function financialPosition(input: {
  totalMinor: number;
  creditMinor: number;
  paidMinor: number;
  refundedMinor: number;
  reversedMinor?: number;
}) {
  const total = safeMinor(input.totalMinor),
    credit = safeMinor(input.creditMinor),
    paid = safeMinor(input.paidMinor),
    refund = safeMinor(input.refundedMinor),
    reverse = safeMinor(input.reversedMinor ?? 0);
  if (credit > total || refund + reverse > paid || !Number.isSafeInteger(refund + reverse))
    throw new RangeError("Financial evidence is inconsistent; reconcile before continuing.");
  const netPaid = paid - refund - reverse,
    netCharge = total - credit;
  return {
    netChargeMinor: netCharge,
    netPaidMinor: netPaid,
    balanceMinor: Math.max(netCharge - netPaid, 0),
    refundableMinor: Math.max(netPaid - netCharge, 0)
  };
}
export function validateFinancialCommand(input: FinancialCommandInput): void {
  const fields: Record<FinancialCommandKind, readonly string[]> = {
    invoice_credit: ["patientId", "invoiceId", "invoiceItemId", "expectedVersion"],
    payment_reversal: [
      "patientId",
      "invoiceId",
      "paymentTransactionId",
      "expectedVersion",
      "amountMinor"
    ],
    payment_refund: [
      "patientId",
      "invoiceId",
      "paymentTransactionId",
      "expectedVersion",
      "amountMinor",
      "method"
    ],
    advance_received: ["patientId", "amountMinor", "method"],
    advance_allocated: [
      "patientId",
      "invoiceId",
      "targetEntryId",
      "expectedVersion",
      "amountMinor"
    ],
    advance_returned: ["patientId", "targetEntryId", "amountMinor", "method"],
    allocation_reversed: [
      "patientId",
      "invoiceId",
      "targetEntryId",
      "expectedVersion",
      "amountMinor"
    ],
    expense: ["amountMinor", "method"],
    expense_reversal: ["targetEntryId"]
  };
  if (!FINANCIAL_COMMANDS.includes(input.kind)) throw new RangeError("Unknown financial action.");
  if (
    Object.keys(input).some(
      (k) => !["kind", "reason", "reference", ...fields[input.kind]].includes(k)
    )
  )
    throw new RangeError("A supplied field does not belong to this financial action.");
  for (const [key, max] of [
    ["reason", 1000],
    ["reference", 160]
  ] as const)
    if (typeof input[key] !== "string" || !input[key].trim() || input[key].length > max)
      throw new RangeError(`A bounded ${key} is required.`);
  if (
    !["invoice_credit", "expense_reversal"].includes(input.kind) &&
    safeMinor(input.amountMinor) === 0
  )
    throw new RangeError("Enter a positive amount.");
  const invoice = [
    "invoice_credit",
    "payment_reversal",
    "payment_refund",
    "advance_allocated",
    "allocation_reversed"
  ].includes(input.kind);
  if (
    invoice &&
    (!input.invoiceId || !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion! < 1)
  )
    throw new RangeError("Choose a current invoice and refresh its financial version.");
  if (!["expense", "expense_reversal"].includes(input.kind) && !input.patientId)
    throw new RangeError("Choose the patient account.");
  if (input.kind === "invoice_credit" && !input.invoiceItemId)
    throw new RangeError("Choose an original invoice line to credit.");
  if (["payment_reversal", "payment_refund"].includes(input.kind) && !input.paymentTransactionId)
    throw new RangeError("Choose the original payment.");
  if (
    ["advance_allocated", "advance_returned", "allocation_reversed", "expense_reversal"].includes(
      input.kind
    ) &&
    !input.targetEntryId
  )
    throw new RangeError("Choose the original financial entry.");
  if (
    ["advance_received", "expense", "payment_refund", "advance_returned"].includes(input.kind) &&
    !["cash", "upi", "card", "bank_transfer", "cheque", "other"].includes(input.method ?? "")
  )
    throw new RangeError("Choose a payment method.");
}

/** Return excess capture first; only the remaining refund reduces invoice settlement. */
export function providerRefundAllocation(input: {
  appliedMinor: number;
  unallocatedMinor: number;
  nextRefundedMinor: number;
  refundMinor: number;
}) {
  const applied = safeMinor(input.appliedMinor),
    excess = safeMinor(input.unallocatedMinor),
    next = safeMinor(input.nextRefundedMinor),
    refund = safeMinor(input.refundMinor);
  const captured = safeMinor(applied + excess);
  if (next > captured || refund > next)
    throw new RangeError("Provider refund exceeds captured evidence.");
  const before = next - refund;
  const invoiceRefundMinor = Math.max(next - excess, 0) - Math.max(before - excess, 0);
  return {
    invoiceRefundMinor,
    unallocatedRefundMinor: refund - invoiceRefundMinor,
    fullyRefunded: next === captured
  };
}
