import test from "node:test";
import assert from "node:assert/strict";
import {
  financialPosition,
  safeMinor,
  validateFinancialCommand,
  providerRefundAllocation
} from "../src/financial-operations.ts";
test("credits change charges, refunds return money, reversals correct evidence", () => {
  assert.deepEqual(
    financialPosition({
      totalMinor: 100000,
      creditMinor: 20000,
      paidMinor: 40000,
      refundedMinor: 0
    }),
    { netChargeMinor: 80000, netPaidMinor: 40000, balanceMinor: 40000, refundableMinor: 0 }
  );
  assert.deepEqual(
    financialPosition({
      totalMinor: 100000,
      creditMinor: 100000,
      paidMinor: 60000,
      refundedMinor: 10000,
      reversedMinor: 5000
    }),
    { netChargeMinor: 0, netPaidMinor: 45000, balanceMinor: 0, refundableMinor: 45000 }
  );
  for (const amount of [-1, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => safeMinor(amount), RangeError);
  assert.throws(() =>
    financialPosition({ totalMinor: 100, creditMinor: 101, paidMinor: 0, refundedMinor: 0 })
  );
  assert.throws(() =>
    financialPosition({ totalMinor: 100, creditMinor: 0, paidMinor: 10, refundedMinor: 11 })
  );
});
test("commands require original evidence and reject ignored authority fields", () => {
  const common = { reason: "Synthetic correction", reference: "synthetic-ref" };
  assert.doesNotThrow(() =>
    validateFinancialCommand({
      ...common,
      kind: "advance_received",
      patientId: "p",
      amountMinor: 100,
      method: "cash"
    })
  );
  assert.throws(() =>
    validateFinancialCommand({
      ...common,
      kind: "payment_refund",
      patientId: "p",
      amountMinor: 100
    })
  );
  assert.throws(() =>
    validateFinancialCommand({
      ...common,
      kind: "expense",
      amountMinor: 100,
      method: "cash",
      patientId: "p"
    })
  );
  assert.throws(() =>
    validateFinancialCommand({
      ...common,
      kind: "invoice_credit",
      patientId: "p",
      invoiceId: "i",
      invoiceItemId: "line",
      expectedVersion: 1,
      amountMinor: 1
    })
  );
});

test("provider excess refunds preserve applied settlement until excess is exhausted", () => {
  assert.deepEqual(
    providerRefundAllocation({
      appliedMinor: 10000,
      unallocatedMinor: 2000,
      nextRefundedMinor: 2000,
      refundMinor: 2000
    }),
    { invoiceRefundMinor: 0, unallocatedRefundMinor: 2000, fullyRefunded: false }
  );
  assert.deepEqual(
    providerRefundAllocation({
      appliedMinor: 10000,
      unallocatedMinor: 2000,
      nextRefundedMinor: 7000,
      refundMinor: 5000
    }),
    { invoiceRefundMinor: 5000, unallocatedRefundMinor: 0, fullyRefunded: false }
  );
  assert.deepEqual(
    providerRefundAllocation({
      appliedMinor: 10000,
      unallocatedMinor: 2000,
      nextRefundedMinor: 12000,
      refundMinor: 5000
    }),
    { invoiceRefundMinor: 5000, unallocatedRefundMinor: 0, fullyRefunded: true }
  );
  assert.throws(() =>
    providerRefundAllocation({
      appliedMinor: 10000,
      unallocatedMinor: 2000,
      nextRefundedMinor: 12001,
      refundMinor: 12001
    })
  );
});

test("money returns require their actual method rather than assuming the original collection method", () => {
  const returned = {
    kind: "advance_returned" as const,
    patientId: "p",
    targetEntryId: "a",
    amountMinor: 100,
    reference: "return",
    reason: "Synthetic return"
  };
  assert.throws(() => validateFinancialCommand(returned), /payment method/);
  assert.doesNotThrow(() => validateFinancialCommand({ ...returned, method: "bank_transfer" }));
});
