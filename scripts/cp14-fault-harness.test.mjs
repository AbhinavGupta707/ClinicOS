import assert from "node:assert/strict";
import test from "node:test";
import { buildFaultPlan, simulateFaultPlan } from "./cp14-fault-harness.mjs";

const baseArguments = [
  "--environment=synthetic",
  "--synthetic-only",
  "--stop-file=/tmp/clinicos-cp14-fault.stop",
  "--rollback-plan=remove_fault_injection",
  "--scenario=exporter_failure"
];

test("fault harness proves exporter failure behavior only through deterministic simulation", () => {
  const plan = buildFaultPlan(baseArguments);
  assert.equal(plan.mode, "deterministic_simulation");
  assert.equal(plan.mutationAllowed, false);
  assert.deepEqual(
    simulateFaultPlan(plan).assertions.map((assertion) => assertion.control),
    [
      "bounded_timeout",
      "safe_error_code",
      "alert_evaluation",
      "recovery_signal",
      "production_startup_fail_closed"
    ]
  );
});

test("fault harness rejects production-like targets and execution mode", () => {
  assert.throws(
    () =>
      buildFaultPlan(
        baseArguments.map((value) =>
          value === "--environment=synthetic" ? "--environment=staging" : value
        )
      ),
    /CP14_SYNTHETIC_ENVIRONMENT_REQUIRED/u
  );
  assert.throws(
    () => buildFaultPlan([...baseArguments, "--execute"]),
    /CP14_FAULT_LIVE_EXECUTION_FORBIDDEN/u
  );
});
