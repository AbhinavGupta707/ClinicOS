#!/usr/bin/env node
import {
  authorizeSyntheticHarness,
  parseCp14Arguments,
  safeJson,
  stopRequested
} from "./cp14-observability-harness-lib.mjs";

const scenarios = new Set([
  "audit_export_verification",
  "media_restore",
  "postgres_restore",
  "region_failover",
  "signing_key_rotation"
]);

export function buildRecoveryPlan(argv) {
  const args = parseCp14Arguments(argv);
  const authorization = authorizeSyntheticHarness(args, "recovery");
  if (typeof args.scenario !== "string" || !scenarios.has(args.scenario)) {
    throw new Error("CP14_RECOVERY_SCENARIO_INVALID");
  }
  if (args.mode !== "plan" && args.mode !== "simulate") {
    throw new Error("CP14_RECOVERY_LIVE_EXECUTION_FORBIDDEN");
  }
  if (args["restore-source"] !== "synthetic-fixture" || args.target !== "isolated-local") {
    throw new Error("CP14_RECOVERY_ISOLATION_REQUIRED");
  }
  return Object.freeze({
    authorization,
    mode: args.mode,
    scenario: args.scenario,
    restoreSource: "synthetic-fixture",
    target: "isolated-local",
    phases: recoveryPhases(args.scenario),
    cloudMutationAllowed: false,
    destructiveOperationAllowed: false
  });
}

export function simulateRecoveryPlan(plan) {
  if (stopRequested(plan.authorization.stopFile)) return { status: "stopped", completedPhases: [] };
  if (plan.mode === "plan") return { status: "planned", completedPhases: [] };
  return {
    status: "pass",
    completedPhases: plan.phases.map((phase) => `${phase}:synthetic_verified`)
  };
}

function recoveryPhases(scenario) {
  const common = [
    "preflight",
    "isolate",
    "verify_source",
    "exercise",
    "reconcile",
    "rollback",
    "review"
  ];
  if (scenario === "region_failover") return [...common, "failback_plan"];
  if (scenario === "postgres_restore") return [...common, "rpo_rto_measurement"];
  if (scenario === "media_restore") return [...common, "quarantine_revalidation"];
  return common;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const plan = buildRecoveryPlan(process.argv.slice(2));
    process.stdout.write(safeJson({ plan, result: simulateRecoveryPlan(plan) }));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "CP14_RECOVERY_FAILED"}\n`);
    process.exitCode = 1;
  }
}
