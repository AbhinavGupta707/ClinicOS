import assert from "node:assert/strict";
import test from "node:test";
import { ACTIVE_NATIVE_HTTP_OPERATIONS } from "@clinic-os/api-contracts";
import {
  ALL_CP13_CLINIC_DAY_OPERATION_IDS,
  CP13_CLINIC_DAY_OPERATION_OWNERS,
  CP13_TREATMENT_BILLING_CLINIC_OPERATION_IDS,
  CP13_TREATMENT_BILLING_PROVIDER_OPERATION_IDS
} from "../src/features/cp13-operation-ownership.ts";

test("CP13 clinic-day ownership covers CP2-CP6 exactly once", () => {
  const expected = ACTIVE_NATIVE_HTTP_OPERATIONS.filter((operation) =>
    ["CP2", "CP3", "CP4", "CP5", "CP6"].includes(operation.checkpoint)
  ).map((operation) => operation.operationId);
  const owned = Object.values(CP13_CLINIC_DAY_OPERATION_OWNERS).flat();

  assert.equal(owned.length, 94);
  assert.equal(new Set(owned).size, owned.length);
  assert.deepEqual([...owned].sort(), [...expected].sort());
  assert.deepEqual([...ALL_CP13_CLINIC_DAY_OPERATION_IDS].sort(), [...expected].sort());
});

test("CP13 ownership keeps shared compatibility files out of worker path design", () => {
  assert.equal(CP13_CLINIC_DAY_OPERATION_OWNERS.frontOffice.length, 26);
  assert.equal(CP13_CLINIC_DAY_OPERATION_OWNERS.clinicalDental.length, 22);
  assert.equal(CP13_CLINIC_DAY_OPERATION_OWNERS.treatmentBilling.length, 12);
  assert.equal(CP13_CLINIC_DAY_OPERATION_OWNERS.continuityOperations.length, 34);
  assert.deepEqual(CP13_TREATMENT_BILLING_PROVIDER_OPERATION_IDS, [
    "receiveRazorpayPaymentWebhook"
  ]);
  assert.equal(CP13_TREATMENT_BILLING_CLINIC_OPERATION_IDS.length, 11);
});
