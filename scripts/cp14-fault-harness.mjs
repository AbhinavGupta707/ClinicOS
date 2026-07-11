#!/usr/bin/env node
import {
  authorizeSyntheticHarness,
  boundedInteger,
  parseCp14Arguments,
  safeJson,
  stopRequested
} from "./cp14-observability-harness-lib.mjs";

const scenarios = new Set([
  "cache_connection_failure",
  "database_latency",
  "exporter_failure",
  "media_scanner_failure",
  "provider_timeout",
  "temporal_unavailable"
]);

export function buildFaultPlan(argv) {
  const args = parseCp14Arguments(argv);
  const authorization = authorizeSyntheticHarness(args, "fault");
  if (typeof args.scenario !== "string" || !scenarios.has(args.scenario)) {
    throw new Error("CP14_FAULT_SCENARIO_INVALID");
  }
  if (args.execute === true) throw new Error("CP14_FAULT_LIVE_EXECUTION_FORBIDDEN");
  const durationMs = boundedInteger(
    args["duration-ms"],
    30_000,
    1_000,
    300_000,
    "CP14_FAULT_DURATION_INVALID"
  );
  return Object.freeze({
    authorization,
    mode: "deterministic_simulation",
    scenario: args.scenario,
    durationMs,
    expectedControls: expectedControls(args.scenario),
    mutationAllowed: false
  });
}

export function simulateFaultPlan(plan) {
  if (stopRequested(plan.authorization.stopFile)) return { status: "stopped", assertions: [] };
  return {
    status: "pass",
    assertions: plan.expectedControls.map((control) => ({ control, observed: "simulated" }))
  };
}

function expectedControls(scenario) {
  const common = ["bounded_timeout", "safe_error_code", "alert_evaluation", "recovery_signal"];
  if (scenario === "exporter_failure") return [...common, "production_startup_fail_closed"];
  if (scenario === "media_scanner_failure") return [...common, "media_remains_quarantined"];
  if (scenario === "cache_connection_failure") return [...common, "readiness_removed"];
  return [...common, "backpressure_evaluated"];
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const plan = buildFaultPlan(process.argv.slice(2));
    process.stdout.write(safeJson({ plan, result: simulateFaultPlan(plan) }));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "CP14_FAULT_FAILED"}\n`);
    process.exitCode = 1;
  }
}
