import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPaymentToInvoice,
  assertManualPaymentEvidence,
  type ManualPaymentEvidenceInput
} from "../src/index.ts";

test("payment application represents partial payments without marking an invoice paid", () => {
  const result = applyPaymentToInvoice({
    invoiceTotalAmountPaise: 12_000,
    invoiceAmountPaidPaise: 0,
    transactionAmountPaise: 5_000
  });

  assert.equal(result.appliedAmountPaise, 5_000);
  assert.equal(result.overpaymentAmountPaise, 0);
  assert.equal(result.nextAmountPaidPaise, 5_000);
  assert.equal(result.nextAmountDuePaise, 7_000);
  assert.equal(result.nextPaymentState, "partially_paid");
  assert.equal(result.requiresReconciliation, false);
});

test("payment application caps overpayment and marks the remainder for reconciliation", () => {
  const result = applyPaymentToInvoice({
    invoiceTotalAmountPaise: 12_000,
    invoiceAmountPaidPaise: 10_000,
    transactionAmountPaise: 5_000
  });

  assert.equal(result.appliedAmountPaise, 2_000);
  assert.equal(result.overpaymentAmountPaise, 3_000);
  assert.equal(result.nextAmountPaidPaise, 12_000);
  assert.equal(result.nextAmountDuePaise, 0);
  assert.equal(result.nextPaymentState, "paid");
  assert.equal(result.requiresReconciliation, true);
});

test("duplicate payment application never inflates paid totals", () => {
  const result = applyPaymentToInvoice({
    invoiceTotalAmountPaise: 12_000,
    invoiceAmountPaidPaise: 5_000,
    transactionAmountPaise: 5_000,
    isDuplicate: true
  });

  assert.equal(result.appliedAmountPaise, 0);
  assert.equal(result.overpaymentAmountPaise, 5_000);
  assert.equal(result.nextAmountPaidPaise, 5_000);
  assert.equal(result.nextAmountDuePaise, 7_000);
  assert.equal(result.requiresReconciliation, true);
});

test("manual payment evidence requires method, amount, reason, and reference", () => {
  const input: ManualPaymentEvidenceInput = {
    amountPaise: 1_500,
    currency: "INR",
    method: "static_upi",
    reason: "Patient paid against the clinic-approved fallback QR.",
    reference: "UPI-REF-001"
  };

  assert.doesNotThrow(() => assertManualPaymentEvidence(input));
  assert.throws(
    () => assertManualPaymentEvidence({ ...input, reference: "" }),
    /requires a receipt, UPI, bank, or clinic-approved reference/
  );
});
