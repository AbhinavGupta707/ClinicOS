import assert from "node:assert/strict";
import test from "node:test";
import { buildRecoveryPlan, simulateRecoveryPlan } from "./cp14-recovery-drill.mjs";

const baseArguments = [
  "--environment=synthetic",
  "--synthetic-only",
  "--stop-file=/tmp/clinicos-cp14-recovery.stop",
  "--rollback-plan=discard_isolated_restore",
  "--scenario=postgres_restore",
  "--restore-source=synthetic-fixture",
  "--target=isolated-local",
  "--mode=simulate"
];

test("recovery simulation includes reconciliation, rollback, and RPO/RTO measurement", () => {
  const plan = buildRecoveryPlan(baseArguments);
  assert.equal(plan.cloudMutationAllowed, false);
  assert.equal(plan.destructiveOperationAllowed, false);
  assert.deepEqual(plan.phases, [
    "preflight",
    "isolate",
    "verify_source",
    "exercise",
    "reconcile",
    "rollback",
    "review",
    "rpo_rto_measurement"
  ]);
  assert.equal(simulateRecoveryPlan(plan).status, "pass");
});

test("recovery harness rejects live modes and non-isolated sources", () => {
  assert.throws(
    () =>
      buildRecoveryPlan(
        baseArguments.map((value) => (value === "--mode=simulate" ? "--mode=execute" : value))
      ),
    /CP14_RECOVERY_LIVE_EXECUTION_FORBIDDEN/u
  );
  assert.throws(
    () =>
      buildRecoveryPlan(
        baseArguments.map((value) =>
          value === "--target=isolated-local" ? "--target=pilot-prod" : value
        )
      ),
    /CP14_RECOVERY_ISOLATION_REQUIRED/u
  );
});
