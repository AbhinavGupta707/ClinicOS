import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCp13ManualPaymentEvidence,
  assertInstructionRemainsRequestEvidence,
  assertInvoiceCreationReferencesCompletedEvidence,
  decideVerifiedCp13ProviderPayment,
  normalizeCp13PaymentRequestType
} from "../src/cp13/treatment-billing/invariants.ts";

const issuedInvoice = {
  status: "issued" as const,
  currency: "INR" as const,
  balanceMinor: 6_000
};

test("CP13 treatment billing keeps all money in safe integer minor units", () => {
  assert.doesNotThrow(() =>
    assertCp13ManualPaymentEvidence({
      amountMinor: 2_500,
      currency: "INR",
      method: "upi",
      reason: "Clinic counter payment verified by accountant.",
      reference: "SYNTHETIC-UPI-001",
      evidence: { recordedFrom: "synthetic_counter_register" }
    })
  );
  assert.throws(
    () =>
      assertCp13ManualPaymentEvidence({
        amountMinor: 25.5,
        currency: "INR",
        method: "upi",
        reason: "Fractional minor units are forbidden.",
        reference: "SYNTHETIC-UPI-002",
        evidence: { recordedFrom: "synthetic_counter_register" }
      }),
    /positive safe integer minor-unit/u
  );
  assert.throws(
    () =>
      assertCp13ManualPaymentEvidence({
        amountMinor: 2_500,
        currency: "INR",
        method: "cash",
        reason: "Missing evidence is unsafe.",
        reference: "SYNTHETIC-CASH-001",
        evidence: {}
      }),
    /non-empty supporting evidence/u
  );
});

test("CP13 provider decisions preserve partial payment and isolate overpayment", () => {
  assert.deepEqual(
    decideVerifiedCp13ProviderPayment({
      eventKind: "payment_succeeded",
      amountMinor: 2_500,
      currency: "INR",
      invoice: issuedInvoice
    }),
    {
      kind: "record_succeeded",
      appliedAmountMinor: 2_500,
      capturedAmountMinor: 2_500,
      unallocatedAmountMinor: 0,
      reconciliationReason: null
    }
  );
  assert.deepEqual(
    decideVerifiedCp13ProviderPayment({
      eventKind: "payment_succeeded",
      amountMinor: 7_000,
      currency: "INR",
      invoice: issuedInvoice
    }),
    {
      kind: "record_succeeded",
      appliedAmountMinor: 6_000,
      capturedAmountMinor: 7_000,
      unallocatedAmountMinor: 1_000,
      reconciliationReason: "overpayment"
    }
  );
  assert.deepEqual(
    decideVerifiedCp13ProviderPayment({
      eventKind: "payment_succeeded",
      amountMinor: 6_000,
      currency: "USD",
      invoice: issuedInvoice
    }),
    {
      kind: "reconcile_without_settlement",
      capturedAmountMinor: 6_000,
      reason: "currency_mismatch"
    }
  );
});

test("CP13 invoice and instruction invariants reject fake completion", () => {
  assert.throws(
    () => assertInvoiceCreationReferencesCompletedEvidence({ procedurePerformedIds: [] }),
    /completed procedure evidence/u
  );
  assert.equal(normalizeCp13PaymentRequestType("invoice_qr"), "dynamic_qr");
  assert.doesNotThrow(() =>
    assertInstructionRemainsRequestEvidence({
      status: "send_requested",
      providerConfirmationReceived: false,
      providerDeliveryConfirmedAt: null,
      deliveredAt: null,
      readAt: null
    })
  );
  assert.throws(
    () =>
      assertInstructionRemainsRequestEvidence({
        status: "send_requested",
        providerConfirmationReceived: true,
        providerDeliveryConfirmedAt: null,
        deliveredAt: null,
        readAt: null
      }),
    /cannot claim provider delivery/u
  );
});
