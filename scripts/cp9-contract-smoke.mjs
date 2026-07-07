#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { loadCp9Scenario, validateCp9Scenario } from "./validate-cp9-fixtures.mjs";

const TOKEN_ENV_BY_ACTOR = {
  accountant: "CLINICOS_CP9_ACCOUNTANT_TOKEN",
  assistant: "CLINICOS_CP9_ASSISTANT_TOKEN",
  auditor: "CLINICOS_CP9_AUDITOR_TOKEN",
  doctor: "CLINICOS_CP9_DOCTOR_TOKEN",
  owner: "CLINICOS_CP9_OWNER_TOKEN",
  platformAdmin: "CLINICOS_CP9_PLATFORM_ADMIN_TOKEN",
  wrongTenantOwner: "CLINICOS_CP9_WRONG_TENANT_OWNER_TOKEN"
};

const LOCAL_DEV_SUBJECT_BY_ACTOR = {
  accountant: "seed-accountant",
  assistant: "seed-assistant",
  auditor: "seed-owner",
  doctor: "seed-doctor",
  owner: "seed-owner",
  platformAdmin: "seed-owner",
  wrongTenantOwner: "seed-owner"
};

function parseArgs(argv) {
  const options = {
    authMode: process.env.CLINICOS_CP9_AUTH_MODE ?? "bearer",
    baseUrl: process.env.CLINICOS_CP9_API_BASE_URL ?? "",
    dryRun: false
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

function requestFromContract(contract) {
  return {
    actorKey: contract.actorKey,
    body: clonePlain(contract.requestBody),
    expectedAuditActions: contract.expectedAuditActions ?? [],
    expectedBodyIncludes: contract.expectedBodyIncludes ?? [],
    expectedBodyMustNotInclude: contract.expectedBodyMustNotInclude ?? [],
    expectedReason: contract.expectedReason,
    expectedStatus: expectedStatusList(contract.expectedStatus),
    key: contract.key,
    liveImplemented: contract.liveImplemented === true,
    method: contract.method,
    ownerLane: contract.ownerLane,
    path: contract.path,
    requiredPermission: contract.requiredPermission,
    routeFamily: contract.routeFamily
  };
}

function requestFromTenantExpectation(expectation) {
  return {
    actorKey: expectation.actorKey,
    body: clonePlain(expectation.requestBody),
    expectedReason: expectation.expectedReason,
    expectedStatus: expectedStatusList(expectation.expectedStatus),
    key: expectation.key,
    liveImplemented: expectation.liveImplemented === true,
    method: expectation.method,
    path: expectation.path,
    requiredPermission: expectation.requiredPermission,
    routeFamily: expectation.routeFamily
  };
}

export function buildCp9SmokePlan(scenario) {
  validateCp9Scenario(scenario);

  return {
    fixtureOnlyEvidence: scenario.fixtureOnlyEvidence,
    routeContracts: scenario.routeContracts.map(requestFromContract),
    tenantIsolationRequests: scenario.tenantIsolationExpectations.map(requestFromTenantExpectation)
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
    "X-ClinicOS-Actor-Id": actor.id,
    "X-ClinicOS-Clinic-Id": actor.clinicId,
    "X-ClinicOS-Tenant-Id": actor.tenantId
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
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
    headers: headersForRequest(scenario, request, options),
    method: request.method
  });
  const body = await parseResponseBody(response);
  const acceptedStatuses = expectedStatusList(request.expectedStatus);
  assert.ok(
    acceptedStatuses.includes(response.status),
    `${request.key} expected ${acceptedStatuses.join("/")} but got ${response.status}: ${JSON.stringify(body)}`
  );
  return { body, response };
}

function printDryRun(plan) {
  console.log("CP9 interoperability/security/ops API smoke dry run plan:");
  for (const row of plan.routeContracts) {
    printRequestRow("route", row);
  }
  console.log("CP9 tenant-isolation dry run plan:");
  for (const row of plan.tenantIsolationRequests) {
    printRequestRow("deny", row);
  }
  console.log("CP9 fixture-only/deferred evidence:");
  for (const row of plan.fixtureOnlyEvidence) {
    console.log(`fixture ${row.key} reason=${row.reason}`);
  }
}

function printRequestRow(type, row) {
  console.log(
    [
      type.padEnd(6),
      row.method.padEnd(4),
      row.path,
      `actor=${row.actorKey}`,
      `family=${row.routeFamily}`,
      `permission=${row.requiredPermission}`,
      `expect=${expectedStatusList(row.expectedStatus).join("/")}`,
      `live=${row.liveImplemented ? "yes" : "no"}`
    ].join(" ")
  );
  if (row.ownerLane) console.log(`       owner=${row.ownerLane}`);
  if (row.expectedReason) console.log(`       reason=${row.expectedReason}`);
  if (row.expectedAuditActions?.length) {
    console.log(`       audit=${row.expectedAuditActions.join(",")}`);
  }
  if (row.expectedBodyIncludes?.length) {
    console.log(`       includes=${row.expectedBodyIncludes.join(",")}`);
  }
  if (row.expectedBodyMustNotInclude?.length) {
    console.log(`       excludes=${row.expectedBodyMustNotInclude.join(",")}`);
  }
}

async function runLiveSmoke(scenario, plan, options) {
  assert.ok(options.baseUrl, "Set --base-url or CLINICOS_CP9_API_BASE_URL for live smoke.");
  const executable = [
    ...plan.routeContracts.filter((request) => request.liveImplemented),
    ...plan.tenantIsolationRequests.filter((request) => request.liveImplemented)
  ];

  if (executable.length === 0) {
    console.log(
      "No CP9 compliance/FHIR/security route contracts are marked liveImplemented. This is expected until Security/Privacy and FHIR/ABDM lanes publish canonical routes."
    );
    return;
  }

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
  const scenario = await loadCp9Scenario();
  const plan = buildCp9SmokePlan(scenario);

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
