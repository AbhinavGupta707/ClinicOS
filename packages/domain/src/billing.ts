import type { DentalToothNumber } from "./dental.ts";
import type { UUID } from "./ids.ts";

export const BILLING_CURRENCIES = ["INR"] as const;
export type BillingCurrency = (typeof BILLING_CURRENCIES)[number];

export const PRICEBOOK_PROCEDURE_STATUSES = ["active", "retired"] as const;
export type PricebookProcedureStatus = (typeof PRICEBOOK_PROCEDURE_STATUSES)[number];

export const TREATMENT_PLAN_STATUSES = [
  "draft",
  "presented",
  "accepted",
  "declined",
  "deferred",
  "cancelled"
] as const;
export type TreatmentPlanStatus = (typeof TREATMENT_PLAN_STATUSES)[number];

export const TREATMENT_PLAN_ITEM_STATUSES = [
  "planned",
  "accepted",
  "completed",
  "cancelled"
] as const;
export type TreatmentPlanItemStatus = (typeof TREATMENT_PLAN_ITEM_STATUSES)[number];

export const PROCEDURE_PERFORMED_STATUSES = [
  "completed",
  "entered_in_error"
] as const;
export type ProcedurePerformedStatus = (typeof PROCEDURE_PERFORMED_STATUSES)[number];

export const INVOICE_STATUSES = ["issued", "void", "cancelled"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_PAYMENT_STATUSES = [
  "unpaid",
  "payment_requested",
  "partially_paid",
  "paid",
  "overpaid",
  "reconciliation_required",
  "refunded",
  "cancelled"
] as const;
export type InvoicePaymentStatus = (typeof INVOICE_PAYMENT_STATUSES)[number];

export const PAYMENT_REQUEST_TYPES = ["payment_link", "dynamic_qr"] as const;
export type PaymentRequestType = (typeof PAYMENT_REQUEST_TYPES)[number];

export const PAYMENT_REQUEST_STATUSES = [
  "requested",
  "provider_created",
  "sent",
  "expired",
  "cancelled",
  "failed"
] as const;
export type PaymentRequestStatus = (typeof PAYMENT_REQUEST_STATUSES)[number];

export const PAYMENT_PROVIDERS = ["manual", "razorpay", "simulator"] as const;
export type PaymentProviderKey = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_TRANSACTION_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "refunded",
  "manually_recorded",
  "reconciliation_required"
] as const;
export type PaymentTransactionStatus = (typeof PAYMENT_TRANSACTION_STATUSES)[number];

export const PAYMENT_VERIFICATION_STATUSES = [
  "not_required_manual",
  "verified",
  "signature_failed",
  "provider_unavailable",
  "requires_review"
] as const;
export type PaymentVerificationStatus = (typeof PAYMENT_VERIFICATION_STATUSES)[number];

export const RECEIPT_STATUSES = ["generated", "void"] as const;
export type ReceiptStatus = (typeof RECEIPT_STATUSES)[number];

export interface BillingLineTotals {
  subtotalMinor: number;
  discountMinor: number;
  taxableMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface PricebookProcedureRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  code: string;
  displayName: string;
  category: string;
  description: string | null;
  defaultUnitPriceMinor: number;
  currency: BillingCurrency;
  taxRateBasisPoints: number;
  status: PricebookProcedureStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TreatmentPlanRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  rowVersion: number;
  patientId: UUID;
  encounterId: UUID | null;
  title: string;
  status: TreatmentPlanStatus;
  currency: BillingCurrency;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  clinicalSummary: string | null;
  presentedAt: string | null;
  acceptedAt: string | null;
  acceptedByUserId: UUID | null;
  acceptedByName: string | null;
  acceptanceEvidence: Record<string, unknown>;
  createdByUserId: UUID;
  updatedByUserId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

export interface TreatmentPlanPhaseRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  treatmentPlanId: UUID;
  phaseIndex: number;
  title: string;
  description: string | null;
  estimatedStartAfterDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface TreatmentPlanEstimateItemRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  treatmentPlanId: UUID;
  phaseId: UUID;
  pricebookProcedureId: UUID;
  dentalFindingId: UUID | null;
  toothNumber: DentalToothNumber | null;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxRateBasisPoints: number;
  taxMinor: number;
  totalMinor: number;
  estimatedVisits: number;
  priority: string | null;
  notes: string | null;
  status: TreatmentPlanItemStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TreatmentPlanPhaseWithItems extends TreatmentPlanPhaseRecord {
  estimateItems: TreatmentPlanEstimateItemRecord[];
}

export interface TreatmentPlanDetail {
  treatmentPlan: TreatmentPlanRecord;
  phases: TreatmentPlanPhaseWithItems[];
}

export interface ProcedurePerformedRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  encounterId: UUID;
  treatmentPlanId: UUID;
  treatmentPlanEstimateItemId: UUID;
  pricebookProcedureId: UUID;
  dentalFindingId: UUID | null;
  invoiceId: UUID | null;
  toothNumber: DentalToothNumber | null;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxRateBasisPoints: number;
  taxMinor: number;
  totalMinor: number;
  status: ProcedurePerformedStatus;
  performedByUserId: UUID;
  performedAt: string;
  notes: string | null;
  outcome: string | null;
  provenance: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  invoiceNumber: string;
  status: InvoiceStatus;
  paymentStatus: InvoicePaymentStatus;
  currency: BillingCurrency;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidMinor: number;
  refundedMinor: number;
  balanceMinor: number;
  treatmentPlanId: UUID | null;
  issuedAt: string;
  dueAt: string | null;
  createdByUserId: UUID;
  updatedByUserId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceItemRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  invoiceId: UUID;
  patientId: UUID;
  procedurePerformedId: UUID;
  treatmentPlanEstimateItemId: UUID;
  pricebookProcedureId: UUID;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxRateBasisPoints: number;
  taxMinor: number;
  totalMinor: number;
  createdAt: string;
}

export interface PaymentRequestRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  invoiceId: UUID;
  patientId: UUID;
  provider: PaymentProviderKey;
  requestType: PaymentRequestType;
  status: PaymentRequestStatus;
  amountMinor: number;
  currency: BillingCurrency;
  providerReferenceId: string | null;
  providerUrl: string | null;
  providerQrPayload: string | null;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
  createdByUserId: UUID;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentTransactionRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  invoiceId: UUID;
  patientId: UUID;
  paymentRequestId: UUID | null;
  provider: PaymentProviderKey;
  providerPaymentId: string | null;
  providerOrderId: string | null;
  amountMinor: number;
  currency: BillingCurrency;
  method: string;
  status: PaymentTransactionStatus;
  verificationStatus: PaymentVerificationStatus;
  reconciliationStatus: "matched" | "requires_review";
  idempotencyKey: string | null;
  receivedAt: string;
  recordedByUserId: UUID | null;
  receiptId: UUID | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface ReceiptPaymentAllocation {
  paymentTransactionId: UUID;
  amountMinor: number;
}

export interface ReceiptRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  invoiceId: UUID;
  patientId: UUID;
  receiptNumber: string;
  status: ReceiptStatus;
  amountMinor: number;
  currency: BillingCurrency;
  paymentAllocations: ReceiptPaymentAllocation[];
  generatedByUserId: UUID;
  generatedAt: string;
  voidedByUserId: UUID | null;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface InvoiceDetail {
  invoice: InvoiceRecord;
  items: InvoiceItemRecord[];
  paymentRequests: PaymentRequestRecord[];
  payments: PaymentTransactionRecord[];
  receipts: ReceiptRecord[];
}

export interface CreateTreatmentPlanPhaseInput {
  title: string;
  description?: string | null;
  estimatedStartAfterDays?: number | null;
  items: CreateTreatmentPlanEstimateItemInput[];
}

export interface CreateTreatmentPlanEstimateItemInput {
  pricebookProcedureId: UUID;
  dentalFindingId?: UUID | null;
  toothNumber?: string | null;
  quantity?: number;
  unitPriceMinor?: number | null;
  discountMinor?: number;
  taxRateBasisPoints?: number | null;
  estimatedVisits?: number;
  priority?: string | null;
  notes?: string | null;
}

export interface CreateTreatmentPlanInput {
  encounterId?: UUID | null;
  title: string;
  clinicalSummary?: string | null;
  status?: Extract<TreatmentPlanStatus, "draft" | "presented">;
  phases: CreateTreatmentPlanPhaseInput[];
}

export interface UpdateTreatmentPlanInput {
  title?: string;
  clinicalSummary?: string | null;
  status?: Extract<TreatmentPlanStatus, "draft" | "presented" | "declined" | "deferred" | "cancelled">;
  phases?: CreateTreatmentPlanPhaseInput[];
}

export interface AcceptTreatmentPlanInput {
  acceptedByName?: string | null;
  acceptanceEvidence?: Record<string, unknown>;
}

export interface CreateProcedurePerformedInput {
  treatmentPlanId: UUID;
  treatmentPlanEstimateItemId: UUID;
  performedAt?: string | null;
  notes?: string | null;
  outcome?: string | null;
  provenance?: Record<string, unknown>;
}

export interface CreateInvoiceInput {
  patientId?: UUID | null;
  treatmentPlanId?: UUID | null;
  procedurePerformedIds?: UUID[];
  dueAt?: string | null;
}

export interface CreatePaymentRequestInput {
  invoiceId: UUID;
  provider: PaymentProviderKey;
  requestType: PaymentRequestType;
  amountMinor: number;
  currency?: BillingCurrency;
  providerReferenceId?: string | null;
  providerUrl?: string | null;
  providerQrPayload?: string | null;
  expiresAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface RecordPaymentTransactionInput {
  invoiceId: UUID;
  paymentRequestId?: UUID | null;
  provider: PaymentProviderKey;
  providerPaymentId?: string | null;
  providerOrderId?: string | null;
  amountMinor: number;
  currency?: BillingCurrency;
  method: string;
  status: PaymentTransactionStatus;
  verificationStatus: PaymentVerificationStatus;
  reconciliationStatus?: "matched" | "requires_review";
  idempotencyKey?: string | null;
  receivedAt?: string | null;
  recordedByUserId?: UUID | null;
  metadata?: Record<string, unknown>;
}

export interface CreateReceiptInput {
  paymentTransactionIds?: UUID[];
}

export function isBillingCurrency(value: string): value is BillingCurrency {
  return (BILLING_CURRENCIES as readonly string[]).includes(value);
}

export function isTreatmentPlanStatus(value: string): value is TreatmentPlanStatus {
  return (TREATMENT_PLAN_STATUSES as readonly string[]).includes(value);
}

export function isInvoiceStatus(value: string): value is InvoiceStatus {
  return (INVOICE_STATUSES as readonly string[]).includes(value);
}

export function isInvoicePaymentStatus(value: string): value is InvoicePaymentStatus {
  return (INVOICE_PAYMENT_STATUSES as readonly string[]).includes(value);
}

export function isPaymentProviderKey(value: string): value is PaymentProviderKey {
  return (PAYMENT_PROVIDERS as readonly string[]).includes(value);
}

export function isPaymentTransactionStatus(value: string): value is PaymentTransactionStatus {
  return (PAYMENT_TRANSACTION_STATUSES as readonly string[]).includes(value);
}

export function isPaymentVerificationStatus(value: string): value is PaymentVerificationStatus {
  return (PAYMENT_VERIFICATION_STATUSES as readonly string[]).includes(value);
}

export function assertMinorCurrencyAmount(value: number, field = "amountMinor"): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer minor-unit amount.`);
  }
}

export function assertPositiveMinorCurrencyAmount(value: number, field = "amountMinor"): void {
  assertMinorCurrencyAmount(value, field);
  if (value === 0) {
    throw new Error(`${field} must be greater than zero.`);
  }
}

export function calculateBillingLineTotals(input: {
  quantity?: number;
  unitPriceMinor: number;
  discountMinor?: number;
  taxRateBasisPoints?: number;
}): BillingLineTotals {
  const quantity = input.quantity ?? 1;
  const discountMinor = input.discountMinor ?? 0;
  const taxRateBasisPoints = input.taxRateBasisPoints ?? 0;

  if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 999) {
    throw new Error("quantity must be a positive integer not greater than 999.");
  }

  assertMinorCurrencyAmount(input.unitPriceMinor, "unitPriceMinor");
  assertMinorCurrencyAmount(discountMinor, "discountMinor");

  if (!Number.isInteger(taxRateBasisPoints) || taxRateBasisPoints < 0 || taxRateBasisPoints > 10000) {
    throw new Error("taxRateBasisPoints must be an integer between 0 and 10000.");
  }

  const subtotalMinor = input.unitPriceMinor * quantity;

  if (discountMinor > subtotalMinor) {
    throw new Error("discountMinor cannot exceed the line subtotal.");
  }

  const taxableMinor = subtotalMinor - discountMinor;
  const taxMinor = Math.round((taxableMinor * taxRateBasisPoints) / 10000);

  return {
    subtotalMinor,
    discountMinor,
    taxableMinor,
    taxMinor,
    totalMinor: taxableMinor + taxMinor
  };
}

export function sumBillingLineTotals(
  items: readonly Pick<BillingLineTotals, "subtotalMinor" | "discountMinor" | "taxMinor" | "totalMinor">[]
): Pick<BillingLineTotals, "subtotalMinor" | "discountMinor" | "taxMinor" | "totalMinor"> {
  return items.reduce(
    (totals, item) => ({
      subtotalMinor: totals.subtotalMinor + item.subtotalMinor,
      discountMinor: totals.discountMinor + item.discountMinor,
      taxMinor: totals.taxMinor + item.taxMinor,
      totalMinor: totals.totalMinor + item.totalMinor
    }),
    { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 }
  );
}

export function assertTreatmentPlanMutable(plan: Pick<TreatmentPlanRecord, "status">): void {
  if (["accepted", "cancelled"].includes(plan.status)) {
    throw new Error(`Treatment plan cannot be edited after it is ${plan.status}.`);
  }
}

export function assertTreatmentPlanAcceptable(
  plan: Pick<TreatmentPlanRecord, "status" | "totalMinor">,
  itemCount: number
): void {
  if (!["draft", "presented"].includes(plan.status)) {
    throw new Error(`Treatment plan cannot be accepted from ${plan.status} state.`);
  }

  if (itemCount <= 0) {
    throw new Error("Treatment plan requires at least one estimate item before acceptance.");
  }

  if (plan.totalMinor <= 0) {
    throw new Error("Treatment plan total must be greater than zero before acceptance.");
  }
}

export function isSettledPaymentTransaction(
  payment: Pick<PaymentTransactionRecord, "status" | "verificationStatus">
): boolean {
  if (payment.status === "manually_recorded") {
    return payment.verificationStatus === "not_required_manual";
  }

  return payment.status === "succeeded" && payment.verificationStatus === "verified";
}

export function calculateInvoicePaymentStatus(input: {
  totalMinor: number;
  paidMinor: number;
  refundedMinor?: number;
  hasPaymentRequest?: boolean;
  hasReconciliationIssue?: boolean;
  invoiceStatus?: InvoiceStatus;
}): InvoicePaymentStatus {
  if (input.invoiceStatus === "cancelled" || input.invoiceStatus === "void") return "cancelled";
  if (input.hasReconciliationIssue) return "reconciliation_required";

  const refundedMinor = input.refundedMinor ?? 0;
  if (refundedMinor > 0 && input.paidMinor === 0) return "refunded";
  if (input.paidMinor <= 0) return input.hasPaymentRequest ? "payment_requested" : "unpaid";
  if (input.paidMinor < input.totalMinor) return "partially_paid";
  if (input.paidMinor === input.totalMinor) return "paid";
  return "overpaid";
}

export function assertInvoiceReceiptable(input: {
  invoice: Pick<InvoiceRecord, "status">;
  payments: readonly PaymentTransactionRecord[];
}): void {
  if (input.invoice.status !== "issued") {
    throw new Error("Receipts can only be generated for issued invoices.");
  }

  const availablePayments = input.payments.filter(
    (payment) => isSettledPaymentTransaction(payment) && !payment.receiptId
  );

  if (availablePayments.length === 0) {
    throw new Error("Receipt generation requires settled, unreceipted payment evidence.");
  }
}
