#!/usr/bin/env node
import {
  assertLoopbackTarget,
  authorizeSyntheticHarness,
  boundedInteger,
  parseCp14Arguments,
  safeJson,
  stopRequested
} from "./cp14-observability-harness-lib.mjs";

const allowedPaths = ["/health/live", "/health/ready"];

export function buildLoadPlan(argv) {
  const args = parseCp14Arguments(argv);
  const authorization = authorizeSyntheticHarness(args, "load");
  const target = assertLoopbackTarget(args.target, allowedPaths);
  const requests = boundedInteger(args.requests, 100, 1, 10_000, "CP14_LOAD_REQUESTS_INVALID");
  const concurrency = boundedInteger(args.concurrency, 5, 1, 50, "CP14_LOAD_CONCURRENCY_INVALID");
  const maximumDurationMs = boundedInteger(
    args["maximum-duration-ms"],
    60_000,
    1_000,
    600_000,
    "CP14_LOAD_DURATION_INVALID"
  );
  if (args.execute === true && args["dry-run"] === true)
    throw new Error("CP14_LOAD_MODE_AMBIGUOUS");
  return Object.freeze({
    authorization,
    mode: args.execute === true ? "execute_local" : "dry_run",
    method: "GET",
    target,
    requests,
    concurrency,
    maximumDurationMs,
    mutationAllowed: false
  });
}

export async function executeLocalLoadPlan(plan, dependencies = {}) {
  if (plan.mode !== "execute_local") return { status: "planned", completed: 0, failures: 0 };
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const isStopped = dependencies.stopRequested ?? stopRequested;
  const monotonicNow = dependencies.monotonicNow ?? (() => performance.now());
  const startedAt = monotonicNow();
  let completed = 0;
  let failures = 0;
  for (let offset = 0; offset < plan.requests; offset += plan.concurrency) {
    if (isStopped(plan.authorization.stopFile)) return { status: "stopped", completed, failures };
    if (monotonicNow() - startedAt >= plan.maximumDurationMs) {
      return { status: "duration_exhausted", completed, failures };
    }
    const batchSize = Math.min(plan.concurrency, plan.requests - offset);
    const results = await Promise.allSettled(
      Array.from({ length: batchSize }, () =>
        fetchImpl(plan.target, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(5_000)
        })
      )
    );
    for (const result of results) {
      completed += 1;
      if (result.status === "rejected" || !result.value.ok) failures += 1;
    }
  }
  return { status: failures === 0 ? "pass" : "fail", completed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const plan = buildLoadPlan(process.argv.slice(2));
    const result = await executeLocalLoadPlan(plan);
    process.stdout.write(safeJson({ plan, result }));
    if (result.status === "fail") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "CP14_LOAD_FAILED"}\n`);
    process.exitCode = 1;
  }
}
