import assert from "node:assert/strict";
import test from "node:test";
import { buildLoadPlan, executeLocalLoadPlan } from "./cp14-load-harness.mjs";

const baseArguments = [
  "--environment=local",
  "--synthetic-only",
  "--stop-file=/tmp/clinicos-cp14-load.stop",
  "--rollback-plan=stop_load_and_drain",
  "--target=http://127.0.0.1:8082/health/ready",
  "--requests=4",
  "--concurrency=2"
];

test("load harness permits only loopback GET health targets", () => {
  assert.equal(buildLoadPlan(baseArguments).mutationAllowed, false);
  assert.throws(
    () =>
      buildLoadPlan(
        baseArguments.map((argument) =>
          argument.startsWith("--target=") ? "--target=https://pilot.example/v1/patients" : argument
        )
      ),
    /CP14_LOOPBACK_TARGET_FORBIDDEN/u
  );
});

test("load execution is bounded and uses the injected local transport", async () => {
  const plan = buildLoadPlan([...baseArguments, "--execute"]);
  let calls = 0;
  const result = await executeLocalLoadPlan(plan, {
    stopRequested: () => false,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true };
    }
  });
  assert.deepEqual(result, { status: "pass", completed: 4, failures: 0 });
  assert.equal(calls, 4);
});
