import assert from "node:assert/strict";
import test from "node:test";
import {
  decideRazorpayEvent,
  type NormalizedRazorpayEvent,
  type RazorpayInvoiceSettlementSnapshot,
  type RazorpayPaymentRequestBinding
} from "../src/cp15/razorpay/index.ts";

const account = {
  tenantId: "tenant-1",
  clinicId: "clinic-1",
  externalAccountId: "external-1",
  razorpayAccountId: "acc_test",
  mode: "test" as const
};

const invoice: RazorpayInvoiceSettlementSnapshot = {
  invoiceId: "invoice-1",
  patientId: "patient-1",
  status: "issued",
  currency: "INR",
  totalMinor: 10_000,
  paidMinor: 0,
  refundedMinor: 0,
  balanceMinor: 10_000
};

const request: RazorpayPaymentRequestBinding = {
  providerRequestId: "plink_1",
  invoiceId: invoice.invoiceId,
  patientId: invoice.patientId,
  amountMinor: 10_000,
  currency: "INR",
  requestKind: "payment_link",
  acceptPartial: true,
  status: "created"
};

test("authorized client/provider state never settles an invoice", () => {
  const decision = decide({
    event: event({ eventName: "payment.authorized", paymentCaptured: true })
  });
  assert.deepEqual(decision, { kind: "ignore", reason: "authorized_not_captured" });
});

test("captured partial payment applies only the captured installment", () => {
  const decision = decide({
    event: event({ eventName: "payment_link.partially_paid", amountMinor: 4_000 })
  });
  assert.deepEqual(decision, {
    kind: "record_payment",
    businessKey: "razorpay:payment:pay_1:captured",
    capturedAmountMinor: 4_000,
    appliedAmountMinor: 4_000,
    unallocatedAmountMinor: 0,
    reconciliationReason: null,
    nextRequestStatus: "partially_paid"
  });
});

test("overpayment is capped at invoice balance and requires reconciliation", () => {
  const decision = decide({
    invoice: { ...invoice, paidMinor: 8_000, balanceMinor: 2_000 },
    event: event({ amountMinor: 3_000 })
  });
  assert.equal(decision.kind, "record_payment");
  if (decision.kind !== "record_payment") return;
  assert.equal(decision.appliedAmountMinor, 2_000);
  assert.equal(decision.unallocatedAmountMinor, 1_000);
  assert.equal(decision.reconciliationReason, "overpayment");
});

test("account and currency mismatch fail closed into reconciliation", () => {
  assert.equal(decide({ event: event({ accountId: "acc_other" }) }).kind, "reconcile");
  const currency = decide({ event: event({ currency: "USD" }) });
  assert.equal(currency.kind, "reconcile");
  if (currency.kind === "reconcile") assert.equal(currency.reason, "currency_mismatch");
  const tenant = decide({ event: event({ tenantId: "tenant-other" }) });
  assert.equal(tenant.kind, "reconcile");
  if (tenant.kind === "reconcile") assert.equal(tenant.reason, "account_scope_mismatch");
  const closedInvoice = decide({ invoice: { ...invoice, status: "void" } });
  assert.equal(closedInvoice.kind, "reconcile");
  if (closedInvoice.kind === "reconcile") {
    assert.equal(closedInvoice.reason, "invoice_not_issuable");
  }
});

test("duplicate and stale financial effects do not apply twice", () => {
  assert.deepEqual(decide({ businessEffectExists: true }), {
    kind: "ignore",
    reason: "duplicate_business_effect"
  });
  assert.deepEqual(
    decide({
      existingPayment: {
        providerPaymentId: "pay_1",
        invoiceId: invoice.invoiceId,
        capturedAmountMinor: 10_000,
        refundedAmountMinor: 1_000,
        lastRank: 50
      }
    }),
    { kind: "ignore", reason: "stale_event" }
  );
  assert.deepEqual(
    decide({
      event: event({
        eventName: "payment.failed",
        paymentCaptured: false,
        providerStatus: "failed"
      }),
      existingPayment: {
        providerPaymentId: "pay_1",
        invoiceId: invoice.invoiceId,
        capturedAmountMinor: 10_000,
        refundedAmountMinor: 0,
        lastRank: 30
      }
    }),
    { kind: "ignore", reason: "stale_event" }
  );
});

test("processed refunds are bounded to the matching captured payment", () => {
  const existingPayment = {
    providerPaymentId: "pay_1",
    invoiceId: invoice.invoiceId,
    capturedAmountMinor: 10_000,
    refundedAmountMinor: 2_000,
    lastRank: 30
  };
  const processed = decide({
    existingPayment,
    event: event({
      eventName: "refund.processed",
      resourceKind: "refund",
      providerRefundId: "rfnd_1",
      amountMinor: 3_000
    })
  });
  assert.deepEqual(processed, {
    kind: "record_refund",
    businessKey: "razorpay:refund:rfnd_1:processed",
    refundAmountMinor: 3_000,
    nextRefundedAmountMinor: 5_000
  });
  const excessive = decide({
    existingPayment,
    event: event({
      eventName: "refund.processed",
      resourceKind: "refund",
      providerRefundId: "rfnd_2",
      amountMinor: 9_000
    })
  });
  assert.equal(excessive.kind, "reconcile");
  if (excessive.kind === "reconcile") assert.equal(excessive.reason, "refund_exceeds_captured");
  const missingCapture = decide({
    existingPayment: null,
    event: event({
      eventName: "refund.processed",
      resourceKind: "refund",
      providerRefundId: "rfnd_missing",
      amountMinor: 1_000
    })
  });
  assert.equal(missingCapture.kind, "reconcile");
  if (missingCapture.kind === "reconcile") {
    assert.equal(missingCapture.reason, "refund_without_payment");
  }
});

test("all dispute outcomes remain manual reconciliation evidence", () => {
  for (const eventName of [
    "payment.dispute.created",
    "payment.dispute.under_review",
    "payment.dispute.won",
    "payment.dispute.lost",
    "payment.dispute.closed"
  ] as const) {
    const decision = decide({
      event: event({ eventName, resourceKind: "dispute", providerDisputeId: "disp_1" })
    });
    assert.equal(decision.kind, "reconcile");
    if (decision.kind === "reconcile") assert.equal(decision.reason, "dispute_requires_review");
  }
});

function decide(
  overrides: {
    event?: NormalizedRazorpayEvent;
    invoice?: RazorpayInvoiceSettlementSnapshot | null;
    paymentRequest?: RazorpayPaymentRequestBinding | null;
    existingPayment?: Parameters<typeof decideRazorpayEvent>[0]["existingPayment"];
    businessEffectExists?: boolean;
  } = {}
) {
  return decideRazorpayEvent({
    account,
    event: overrides.event ?? event(),
    invoice: overrides.invoice === undefined ? invoice : overrides.invoice,
    paymentRequest: overrides.paymentRequest === undefined ? request : overrides.paymentRequest,
    existingPayment: overrides.existingPayment ?? null,
    businessEffectExists: overrides.businessEffectExists ?? false
  });
}

function event(overrides: Partial<NormalizedRazorpayEvent> = {}): NormalizedRazorpayEvent {
  return {
    provider: "razorpay",
    providerEventId: "evt_1",
    eventName: "payment.captured",
    resourceKind: "payment",
    accountId: account.razorpayAccountId,
    occurredAt: "2026-07-13T10:00:00.000Z",
    rawBodySha256: "a".repeat(64),
    signatureSha256: "b".repeat(64),
    verifiedSecretVersion: "v2",
    invoiceId: invoice.invoiceId,
    patientId: invoice.patientId,
    tenantId: account.tenantId,
    clinicId: account.clinicId,
    providerPaymentId: "pay_1",
    providerRequestId: request.providerRequestId,
    providerRefundId: null,
    providerDisputeId: null,
    amountMinor: 10_000,
    currency: "INR",
    paymentCaptured: true,
    providerStatus: "captured",
    method: "upi",
    ...overrides
  };
}
