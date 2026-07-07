#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { loadCp6Scenario, validateCp6Scenario } from "./validate-cp6-fixtures.mjs";

const TOKEN_ENV_BY_ACTOR = {
  owner: "CLINICOS_CP6_OWNER_TOKEN",
  assistant: "CLINICOS_CP6_ASSISTANT_TOKEN",
  accountant: "CLINICOS_CP6_ACCOUNTANT_TOKEN",
  wrongTenantOwner: "CLINICOS_CP6_WRONG_TENANT_OWNER_TOKEN"
};

const LOCAL_DEV_SUBJECT_BY_ACTOR = {
  owner: "seed-owner",
  assistant: "seed-assistant",
  accountant: "seed-accountant",
  wrongTenantOwner: "seed-owner"
};

function parseArgs(argv) {
  const options = {
    dryRun: false,
    baseUrl: process.env.CLINICOS_CP6_API_BASE_URL ?? "",
    authMode: process.env.CLINICOS_CP6_AUTH_MODE ?? "bearer"
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
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function clonePlain(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function expectedStatusList(expectedStatus) {
  return Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
}

function requestFromStep(step) {
  return {
    key: step.key,
    routeFamily: step.routeFamily,
    actorKey: step.actorKey,
    method: step.method,
    path: step.path,
    expectedStatus: expectedStatusList(step.expectedStatus),
    expectedEvents: step.expectedEvents ?? [],
    expectedBodyIncludes: step.expectedBodyIncludes ?? [],
    expectedBodyMustNotInclude: step.expectedBodyMustNotInclude ?? [],
    liveImplemented: step.liveImplemented === true,
    body: clonePlain(step.requestBody)
  };
}

function buildNegativeRequests(scenario) {
  return scenario.roleTenantExpectations
    .filter((expectation) => expectation.expected === "deny")
    .map((expectation) => ({
      key: expectation.key,
      actorKey: expectation.actorKey,
      method: expectation.method,
      path: expectation.path,
      expectedStatus: expectedStatusList(expectation.expectedStatus),
      expectedReason: expectation.expectedReason,
      liveSmoke: expectation.liveSmoke === true,
      body: clonePlain(expectation.requestBody)
    }));
}

function buildPostFlowVerification(scenario) {
  const readDashboard = scenario.flow.steps.find((step) => step.key === "read-owner-dashboard");
  assert.ok(readDashboard, "read-owner-dashboard step is required");

  return [
    {
      ...requestFromStep(readDashboard),
      key: "verify-owner-dashboard-source-backed-aggregate",
      expectedBodyIncludes: ["revenue", "recalls", "labs", "inventory", "incidents"],
      expectedBodyMustNotInclude: ["CP6 Google Synthetic", "+919960000001", "medicalHistory"],
      assertion:
        "Owner dashboard must expose aggregate source-backed metrics without patient names, phones, or clinical notes."
    }
  ];
}

export function buildCp6SmokePlan(scenario) {
  validateCp6Scenario(scenario);

  return {
    flowRequests: scenario.flow.steps.map(requestFromStep),
    negativeRequests: buildNegativeRequests(scenario),
    postFlowVerification: buildPostFlowVerification(scenario)
  };
}

function actorForRequest(scenario, actorKey) {
  const actor = scenario.actors.find((candidate) => candidate.key === actorKey);
  assert.ok(actor, `Unknown actor key ${actorKey}`);
  return actor;
}

function headersForRequest(scenario, request, options) {
  const actor = actorForRequest(scenario, request.actorKey);
  const usesLocalDevSubject =
    options.authMode === "fixture-headers" || options.authMode === "local-dev-subject";
  const primaryClinic = scenario.clinics.find((clinic) => clinic.key === "primaryClinic");
  assert.ok(primaryClinic, "primaryClinic fixture is required");

  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Clinic-Id": request.actorKey === "wrongTenantOwner" ? actor.clinicId : primaryClinic.id,
    "X-ClinicOS-Tenant-Id": actor.tenantId,
    "X-ClinicOS-Clinic-Id": actor.clinicId,
    "X-ClinicOS-Actor-Id": actor.id
  };

  if (usesLocalDevSubject) {
    const subject = LOCAL_DEV_SUBJECT_BY_ACTOR[actor.key];
    assert.ok(subject, `No local dev subject mapping for ${actor.key}`);
    return {
      ...headers,
      "X-Clinic-OS-Dev-Subject": subject,
      "X-ClinicOS-Dev-Subject": subject,
      "X-ClinicOS-Fixture-Actor": actor.key,
      "X-ClinicOS-Fixture-Role": actor.roleSlug
    };
  }

  const tokenEnv = TOKEN_ENV_BY_ACTOR[actor.key];
  const token = tokenEnv ? process.env[tokenEnv] : "";
  assert.ok(token, `Missing ${tokenEnv} for ${actor.key}.`);
  return { ...headers, Authorization: `Bearer ${token}` };
}

async function parseResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function assertSerializedIncludes(value, needles, label) {
  const serialized = JSON.stringify(value);
  for (const needle of needles) {
    assert.ok(serialized.includes(needle), `${label} did not include ${needle}`);
  }
}

function assertSerializedExcludes(value, needles, label) {
  const serialized = JSON.stringify(value);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `${label} exposed ${needle}`);
  }
}

async function executeRequest(baseUrl, scenario, request, options) {
  const url = new URL(request.path, baseUrl);
  const response = await fetch(url, {
    method: request.method,
    headers: headersForRequest(scenario, request, options),
    body: request.body === undefined ? undefined : JSON.stringify(request.body)
  });
  const body = await parseResponseBody(response);
  const acceptedStatuses = expectedStatusList(request.expectedStatus);
  assert.ok(
    acceptedStatuses.includes(response.status),
    `${request.key} expected ${acceptedStatuses.join("/")} but got ${response.status}: ${JSON.stringify(body)}`
  );
  return { response, body };
}

function printDryRun(plan) {
  const rows = [
    ...plan.flowRequests.map((request) => ({ type: "flow", ...request })),
    ...plan.postFlowVerification.map((request) => ({ type: "verify", ...request })),
    ...plan.negativeRequests.map((request) => ({ type: "deny", ...request }))
  ];

  console.log("CP6 API smoke dry run plan:");
  for (const row of rows) {
    console.log(
      [
        row.type.padEnd(6),
        row.method.padEnd(4),
        row.path,
        `actor=${row.actorKey}`,
        `family=${row.routeFamily ?? "role-denial"}`,
        `expect=${expectedStatusList(row.expectedStatus).join("/")}`,
        `live=${row.liveImplemented || row.liveSmoke ? "yes" : "no"}`
      ].join(" ")
    );
    if (row.expectedEvents?.length) console.log(`       events=${row.expectedEvents.join(",")}`);
    if (row.expectedBodyIncludes?.length)
      console.log(`       includes=${row.expectedBodyIncludes.join(",")}`);
    if (row.expectedBodyMustNotInclude?.length)
      console.log(`       excludes=${row.expectedBodyMustNotInclude.join(",")}`);
    if (row.expectedReason) console.log(`       reason=${row.expectedReason}`);
    if (row.assertion) console.log(`       assertion=${row.assertion}`);
  }
}

async function runLiveSmoke(scenario, plan, options) {
  assert.ok(options.baseUrl, "Set --base-url or CLINICOS_CP6_API_BASE_URL for live smoke.");
  const executable = [
    ...plan.flowRequests.filter((request) => request.liveImplemented),
    ...plan.postFlowVerification.filter((request) => request.liveImplemented),
    ...plan.negativeRequests.filter((request) => request.liveSmoke)
  ];

  for (const request of executable) {
    const { body } = await executeRequest(options.baseUrl, scenario, request, options);
    assertSerializedIncludes(body, request.expectedBodyIncludes ?? [], request.key);
    assertSerializedExcludes(body, request.expectedBodyMustNotInclude ?? [], request.key);
    if (request.expectedReason) assertSerializedIncludes(body, [request.expectedReason], request.key);
    console.log(`pass ${request.key}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenario = await loadCp6Scenario();
  const plan = buildCp6SmokePlan(scenario);

  if (options.dryRun) {
    printDryRun(plan);
    return;
  }

  await runLiveSmoke(scenario, plan, options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
