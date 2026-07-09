#!/usr/bin/env node
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const options = parseArgs(process.argv.slice(2));
const headers = options.subject
  ? { "x-clinic-os-dev-subject": options.subject }
  : { authorization: `Bearer ${options.token}` };
const scenarios = [
  { name: "health_ready", path: "/health/ready", headers: {} },
  { name: "runtime_identity", path: "/v1/me", headers },
  { name: "patient_list", path: "/v1/patients", headers }
];
const results = {};

for (const scenario of scenarios) {
  const timings = [];
  for (let index = 0; index < options.iterations; index += 1) {
    const startedAt = performance.now();
    const response = await fetch(`${options.baseUrl}${scenario.path}`, {
      headers: scenario.headers
    });
    const elapsedMs = performance.now() - startedAt;
    assert.equal(
      response.status,
      200,
      `${scenario.name} returned HTTP ${response.status} during baseline run`
    );
    await response.arrayBuffer();
    timings.push(elapsedMs);
  }
  timings.sort((left, right) => left - right);
  results[scenario.name] = {
    iterations: timings.length,
    p50_ms: round(percentile(timings, 0.5)),
    p95_ms: round(percentile(timings, 0.95)),
    max_ms: round(timings.at(-1) ?? 0)
  };
}

console.log(
  JSON.stringify(
    {
      environment: "local_synthetic_e3",
      concurrency: 1,
      warmup: "first request included",
      results,
      limitations: [
        "Developer-machine baseline only; this is not a load, capacity, staging, or production SLO result.",
        "Responses are synthetic and no identifiers or payload content are emitted."
      ]
    },
    null,
    2
  )
);

function parseArgs(args) {
  const valueFor = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const baseUrl = valueFor("--base-url") ?? "http://127.0.0.1:4100";
  const subject = valueFor("--subject") ?? "seed-owner";
  const token = valueFor("--token");
  const iterations = Number.parseInt(valueFor("--iterations") ?? "25", 10);
  assert.match(baseUrl, /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/u);
  assert.equal(Number.isInteger(iterations) && iterations >= 5 && iterations <= 500, true);
  assert.equal(
    Boolean(subject) || Boolean(token),
    true,
    "A local subject or bearer token is required."
  );
  return { baseUrl, subject, token, iterations };
}

function percentile(sorted, quantile) {
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index] ?? 0;
}

function round(value) {
  return Math.round(value * 100) / 100;
}
