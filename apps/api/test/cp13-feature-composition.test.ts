import assert from "node:assert/strict";
import test from "node:test";
import type { PaymentProvider } from "@clinic-os/integrations";
import { createCp13ClinicFeatureHandlerMap } from "../src/features/cp13-composition.ts";
import {
  ALL_CP13_CLINIC_FEATURE_OPERATION_IDS,
  CP13_TREATMENT_BILLING_PROVIDER_OPERATION_IDS
} from "../src/features/cp13-operation-ownership.ts";

test("CP13 master composition registers every clinic feature exactly once", () => {
  const handlers = createCp13ClinicFeatureHandlerMap({
    paymentProvider: {} as PaymentProvider,
    clinicalDental: {}
  });

  assert.equal(Object.isFrozen(handlers), true);
  assert.equal(Object.keys(handlers).length, 93);
  assert.deepEqual(
    Object.keys(handlers).sort(),
    [...ALL_CP13_CLINIC_FEATURE_OPERATION_IDS].sort()
  );
  assert.equal(
    CP13_TREATMENT_BILLING_PROVIDER_OPERATION_IDS.some((operationId) => operationId in handlers),
    false
  );
});
