import test from "node:test";
import assert from "node:assert/strict";
import {
  CP5_EVENT_TYPES,
  assertInvoiceReceiptable,
  assertTreatmentPlanAcceptable,
  assertTreatmentPlanMutable,
  calculateBillingLineTotals,
  calculateInvoicePaymentStatus,
  createDomainEventEnvelope,
  isCp5EventType,
  isDomainEventType,
  isSettledPaymentTransaction,
  sumBillingLineTotals,
  type InvoiceRecord,
  type PaymentTransactionRecord,
  type TreatmentPlanRecord
} from "../src/index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000101";
const patientId = "10000000-0000-4000-8000-000000002001";

test("billing line totals use minor units and reject impossible discounts", () => {
  const first = calculateBillingLineTotals({
    quantity: 2,
    unitPriceMinor: 125000,
    discountMinor: 5000,
    taxRateBasisPoints: 1800
  });
  const second = calculateBillingLineTotals({
    quantity: 1,
    unitPriceMinor: 100000,
    discountMinor: 0,
    taxRateBasisPoints: 0
  });

  assert.deepEqual(first, {
    subtotalMinor: 250000,
    discountMinor: 5000,
    taxableMinor: 245000,
    taxMinor: 44100,
    totalMinor: 289100
  });
  assert.deepEqual(sumBillingLineTotals([first, second]), {
    subtotalMinor: 350000,
    discountMinor: 5000,
    taxMinor: 44100,
    totalMinor: 389100
  });
  assert.throws(
    () => calculateBillingLineTotals({ unitPriceMinor: 1000, discountMinor: 1001 }),
    /discountMinor cannot exceed/
  );
});

test("treatment plan acceptance requires mutable priced evidence", () => {
  assert.doesNotThrow(() =>
    assertTreatmentPlanAcceptable(plan({ status: "presented", totalMinor: 250000 }), 1)
  );
  assert.throws(
    () => assertTreatmentPlanAcceptable(plan({ status: "accepted", totalMinor: 250000 }), 1),
    /cannot be accepted/
  );
  assert.throws(
    () => assertTreatmentPlanAcceptable(plan({ status: "draft", totalMinor: 0 }), 1),
    /total must be greater than zero/
  );
  assert.throws(() => assertTreatmentPlanMutable(plan({ status: "accepted" })), /cannot be edited/);
});

test("invoice payment state and receipt eligibility require settled evidence", () => {
  assert.equal(
    calculateInvoicePaymentStatus({ totalMinor: 500000, paidMinor: 0, hasPaymentRequest: true }),
    "payment_requested"
  );
  assert.equal(calculateInvoicePaymentStatus({ totalMinor: 500000, paidMinor: 250000 }), "partially_paid");
  assert.equal(calculateInvoicePaymentStatus({ totalMinor: 500000, paidMinor: 500000 }), "paid");
  assert.equal(
    calculateInvoicePaymentStatus({
      totalMinor: 500000,
      paidMinor: 500000,
      hasReconciliationIssue: true
    }),
    "reconciliation_required"
  );

  const manualPayment = payment({
    status: "manually_recorded",
    verificationStatus: "not_required_manual"
  });
  const unsignedProviderPayment = payment({
    status: "succeeded",
    verificationStatus: "signature_failed"
  });

  assert.equal(isSettledPaymentTransaction(manualPayment), true);
  assert.equal(isSettledPaymentTransaction(unsignedProviderPayment), false);
  assert.doesNotThrow(() =>
    assertInvoiceReceiptable({ invoice: invoice({ status: "issued" }), payments: [manualPayment] })
  );
  assert.throws(
    () =>
      assertInvoiceReceiptable({
        invoice: invoice({ status: "issued" }),
        payments: [unsignedProviderPayment]
      }),
    /settled, unreceipted payment evidence/
  );
});

test("CP5 domain event taxonomy covers billing and payment evidence events", () => {
  for (const eventType of CP5_EVENT_TYPES) {
    assert.equal(isCp5EventType(eventType), true);
    assert.equal(isDomainEventType(eventType), true);
  }

  const envelope = createDomainEventEnvelope({
    eventType: "invoice.created",
    tenantId,
    clinicId,
    actor: { type: "user", id: "10000000-0000-4000-8000-000000001004" },
    correlationId: "cp5-billing-test",
    source: { kind: "manual_entry" },
    aggregate: { type: "invoice", id: "10000000-0000-4000-8000-000000070001" },
    patientId,
    payload: {
      invoiceNumber: "INV-20260707-0001",
      totalMinor: 250000
    }
  });

  assert.equal(envelope.eventType, "invoice.created");
  assert.equal(envelope.patientId, patientId);
  assert.equal(envelope.aggregate.type, "invoice");
});

function plan(
  overrides: Partial<Pick<TreatmentPlanRecord, "status" | "totalMinor">>
): Pick<TreatmentPlanRecord, "status" | "totalMinor"> {
  return {
    status: "draft",
    totalMinor: 250000,
    ...overrides
  };
}

function invoice(
  overrides: Partial<Pick<InvoiceRecord, "status">>
): Pick<InvoiceRecord, "status"> {
  return {
    status: "issued",
    ...overrides
  };
}

function payment(
  overrides: Partial<PaymentTransactionRecord>
): PaymentTransactionRecord {
  return {
    id: "10000000-0000-4000-8000-000000071001",
    tenantId,
    clinicId,
    invoiceId: "10000000-0000-4000-8000-000000070001",
    patientId,
    paymentRequestId: null,
    provider: "manual",
    providerPaymentId: null,
    providerOrderId: null,
    amountMinor: 250000,
    currency: "INR",
    method: "cash",
    status: "manually_recorded",
    verificationStatus: "not_required_manual",
    reconciliationStatus: "matched",
    idempotencyKey: null,
    receivedAt: "2026-07-07T10:00:00.000Z",
    recordedByUserId: "10000000-0000-4000-8000-000000001004",
    receiptId: null,
    metadata: {},
    createdAt: "2026-07-07T10:00:00.000Z",
    updatedAt: "2026-07-07T10:00:00.000Z",
    ...overrides
  };
}
