#!/usr/bin/env node
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { loadCp9Scenario, validateCp9Scenario } from "./validate-cp9-fixtures.mjs";

const TOKEN_ENV_BY_ACTOR = {
  assistant: "CLINICOS_CP9_ASSISTANT_TOKEN",
  owner: "CLINICOS_CP9_OWNER_TOKEN"
};

const LOCAL_DEV_SUBJECT_BY_ACTOR = {
  assistant: "seed-assistant",
  owner: "seed-owner"
};

function parseArgs(argv) {
  const options = {
    authMode: process.env.CLINICOS_CP9_AUTH_MODE ?? "local-dev-subject",
    baseUrl: process.env.CLINICOS_CP9_API_BASE_URL ?? "",
    concurrency: null,
    dryRun: false,
    totalRequests: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--base-url") {
      options.baseUrl = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--auth-mode") {
      options.authMode = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (arg === "--concurrency") {
      options.concurrency = Number.parseInt(argv[index + 1] ?? "", 10);
      index += 1;
      continue;
    }
    if (arg === "--requests") {
      options.totalRequests = Number.parseInt(argv[index + 1] ?? "", 10);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

export function buildCp9LoadPlan(scenario, options = {}) {
  validateCp9Scenario(scenario);
  const thresholds = {
    ...scenario.performanceSmoke.thresholds,
    ...(Number.isInteger(options.concurrency) ? { concurrency: options.concurrency } : {}),
    ...(Number.isInteger(options.totalRequests) ? { totalRequests: options.totalRequests } : {})
  };
  assert.ok(thresholds.concurrency > 0, "concurrency must be positive");
  assert.ok(thresholds.totalRequests >= thresholds.concurrency, "requests must cover concurrency");

  return {
    deferredEndpoints: scenario.performanceSmoke.deferredEndpoints,
    endpoints: scenario.performanceSmoke.endpoints.filter((endpoint) => endpoint.liveImplemented),
    mode: scenario.performanceSmoke.mode,
    name: scenario.performanceSmoke.name,
    thresholds
  };
}

function actorForEndpoint(scenario, actorKey) {
  if (!actorKey) return null;
  const actor = scenario.actors.find((candidate) => candidate.key === actorKey);
  assert.ok(actor, `Unknown actor key ${actorKey}`);
  return actor;
}

function headersForEndpoint(scenario, endpoint, options) {
  const headers = { Accept: "application/json" };
  if (!endpoint.requiresAuth) return headers;

  const actor = actorForEndpoint(scenario, endpoint.actorKey);
  assert.ok(actor, `Endpoint ${endpoint.key} requires an actor`);
  const primaryClinic = scenario.clinics.find((clinic) => clinic.key === "primaryClinic");
  assert.ok(primaryClinic, "primaryClinic fixture is required");

  const scopedHeaders = {
    ...headers,
    "X-Clinic-Id": primaryClinic.id,
    "X-ClinicOS-Actor-Id": actor.id,
    "X-ClinicOS-Clinic-Id": actor.clinicId,
    "X-ClinicOS-Tenant-Id": actor.tenantId
  };

  if (options.authMode === "fixture-headers" || options.authMode === "local-dev-subject") {
    const subject = LOCAL_DEV_SUBJECT_BY_ACTOR[actor.key];
    assert.ok(subject, `No local dev subject mapping for ${actor.key}`);
    return {
      ...scopedHeaders,
      "X-Clinic-OS-Dev-Subject": subject,
      "X-ClinicOS-Dev-Subject": subject
    };
  }

  const tokenEnv = TOKEN_ENV_BY_ACTOR[actor.key];
  const token = tokenEnv ? process.env[tokenEnv] : "";
  assert.ok(token, `Missing ${tokenEnv} for ${actor.key}.`);
  return { ...scopedHeaders, Authorization: `Bearer ${token}` };
}

function printDryRun(plan) {
  const thresholds = plan.thresholds;
  console.log("CP9 clinic-hours load smoke dry run plan:");
  console.log(
    [
      `mode=${plan.mode}`,
      `concurrency=${thresholds.concurrency}`,
      `requests=${thresholds.totalRequests}`,
      `p95<=${thresholds.maxP95LatencyMs}ms`,
      `p99<=${thresholds.maxP99LatencyMs}ms`,
      `errorRate<=${thresholds.maxErrorRate}`,
      `429Rate<=${thresholds.maxStatus429Rate}`
    ].join(" ")
  );
  for (const endpoint of plan.endpoints) {
    console.log(
      [
        "load".padEnd(6),
        endpoint.method.padEnd(4),
        endpoint.path,
        `actor=${endpoint.actorKey ?? "public"}`,
        `expect=${endpoint.expectedStatus}`
      ].join(" ")
    );
  }
  console.log("CP9 load-deferred endpoints:");
  for (const endpoint of plan.deferredEndpoints) {
    console.log(`defer ${endpoint.routeFamily} ${endpoint.path} reason=${endpoint.reason}`);
  }
}

async function runLoadSmoke(scenario, plan, options) {
  assert.ok(options.baseUrl, "Set --base-url or CLINICOS_CP9_API_BASE_URL for live load smoke.");
  assert.ok(plan.endpoints.length > 0, "No live implemented endpoints are available for load smoke.");

  const queue = Array.from({ length: plan.thresholds.totalRequests }, (_, index) => {
    return plan.endpoints[index % plan.endpoints.length];
  });
  const results = [];
  let cursor = 0;

  async function worker() {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const endpoint = queue[index];
      results.push(await executeEndpoint(scenario, endpoint, options));
    }
  }

  await Promise.all(Array.from({ length: plan.thresholds.concurrency }, () => worker()));
  const summary = summarizeResults(results);
  assertLoadThresholds(summary, plan.thresholds);
  console.log(JSON.stringify(summary, null, 2));
}

async function executeEndpoint(scenario, endpoint, options) {
  const url = new URL(endpoint.path, options.baseUrl);
  const started = performance.now();
  try {
    const response = await fetch(url, {
      headers: headersForEndpoint(scenario, endpoint, options),
      method: endpoint.method
    });
    const body = await response.arrayBuffer();
    const durationMs = performance.now() - started;
    const ok = response.status === endpoint.expectedStatus;
    return {
      durationMs,
      endpointKey: endpoint.key,
      ok,
      responseBytes: body.byteLength,
      status: response.status
    };
  } catch (error) {
    return {
      durationMs: performance.now() - started,
      endpointKey: endpoint.key,
      error: error instanceof Error ? error.message : String(error),
      ok: false,
      responseBytes: 0,
      status: 0
    };
  }
}

function summarizeResults(results) {
  const durations = results.map((result) => result.durationMs).sort((left, right) => left - right);
  const failed = results.filter((result) => !result.ok);
  const status429 = results.filter((result) => result.status === 429);
  return {
    errorRate: failed.length / results.length,
    failedRequests: failed.length,
    maxResponseBytes: Math.max(...results.map((result) => result.responseBytes)),
    p95LatencyMs: percentile(durations, 0.95),
    p99LatencyMs: percentile(durations, 0.99),
    status429Rate: status429.length / results.length,
    successfulRequests: results.length - failed.length,
    totalRequests: results.length
  };
}

function assertLoadThresholds(summary, thresholds) {
  assert.ok(
    summary.p95LatencyMs <= thresholds.maxP95LatencyMs,
    `p95 ${summary.p95LatencyMs.toFixed(1)}ms exceeded ${thresholds.maxP95LatencyMs}ms`
  );
  assert.ok(
    summary.p99LatencyMs <= thresholds.maxP99LatencyMs,
    `p99 ${summary.p99LatencyMs.toFixed(1)}ms exceeded ${thresholds.maxP99LatencyMs}ms`
  );
  assert.ok(summary.errorRate <= thresholds.maxErrorRate, `errorRate ${summary.errorRate} exceeded threshold`);
  assert.ok(
    summary.status429Rate <= thresholds.maxStatus429Rate,
    `429Rate ${summary.status429Rate} exceeded threshold`
  );
  assert.ok(
    summary.maxResponseBytes <= thresholds.maxResponseBytes,
    `response payload ${summary.maxResponseBytes} exceeded ${thresholds.maxResponseBytes} bytes`
  );
}

function percentile(sortedValues, fraction) {
  if (sortedValues.length === 0) return 0;
  const index = Math.min(sortedValues.length - 1, Math.ceil(sortedValues.length * fraction) - 1);
  return sortedValues[index];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenario = await loadCp9Scenario();
  const plan = buildCp9LoadPlan(scenario, options);

  if (options.dryRun) {
    printDryRun(plan);
    return;
  }

  await runLoadSmoke(scenario, plan, options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
