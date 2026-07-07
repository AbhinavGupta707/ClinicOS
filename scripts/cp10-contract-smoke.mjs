#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { loadCp10Scenario, validateCp10Scenario } from "./validate-cp10-fixtures.mjs";

const TOKEN_ENV_BY_ACTOR = {
  accountant: "CLINICOS_CP10_ACCOUNTANT_TOKEN",
  assistant: "CLINICOS_CP10_ASSISTANT_TOKEN",
  auditor: "CLINICOS_CP10_AUDITOR_TOKEN",
  doctor: "CLINICOS_CP10_DOCTOR_TOKEN",
  owner: "CLINICOS_CP10_OWNER_TOKEN",
  platformSupport: "CLINICOS_CP10_PLATFORM_SUPPORT_TOKEN",
  receptionist: "CLINICOS_CP10_RECEPTIONIST_TOKEN",
  wrongTenantOwner: "CLINICOS_CP10_WRONG_TENANT_OWNER_TOKEN"
};

const LOCAL_DEV_SUBJECT_BY_ACTOR = {
  accountant: "seed-accountant",
  assistant: "seed-assistant",
  auditor: "seed-owner",
  doctor: "seed-doctor",
  owner: "seed-owner",
  platformSupport: "seed-owner",
  receptionist: "seed-receptionist",
  wrongTenantOwner: "seed-owner"
};

function parseArgs(argv) {
  const options = {
    authMode: process.env.CLINICOS_CP10_AUTH_MODE ?? "bearer",
    baseUrl: process.env.CLINICOS_CP10_API_BASE_URL ?? "",
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

function requestFromStep(segment, step) {
  return {
    actorKey: step.actorKey,
    checkpoint: segment.checkpoint,
    expectedStatus: expectedStatusList(step.expectedStatus),
    key: `${segment.key}:${step.key}`,
    liveImplemented: step.liveImplemented === true,
    method: step.method,
    path: step.path,
    providerBoundary: step.providerBoundary,
    routeFamilies: [...segment.routeFamilies],
    segmentKey: segment.key
  };
}

function requestFromTenantExpectation(expectation) {
  return {
    actorKey: expectation.actorKey,
    expectedReason: expectation.expectedReason,
    expectedStatus: expectedStatusList(expectation.expectedStatus),
    key: expectation.key,
    liveImplemented: expectation.liveImplemented === true,
    method: expectation.method,
    path: expectation.path,
    requiredPermission: expectation.requiredPermission
  };
}

function buildLiveReadinessProbes(plan) {
  const routeRequests = plan.workflowRequests.filter(
    (request) =>
      request.liveImplemented &&
      request.method === "GET" &&
      !request.path.includes("{") &&
      ["read-day-queue", "read-pricebook", "read-provider-health", "read-owner-dashboard"].some(
        (suffix) => request.key.endsWith(`:${suffix}`)
      )
  );

  return [
    {
      actorKey: "assistant",
      expectedStatus: [200],
      key: "health-ready",
      liveImplemented: true,
      method: "GET",
      path: "/health/ready"
    },
    ...routeRequests
  ];
}

export function buildCp10SmokePlan(scenario) {
  validateCp10Scenario(scenario);

  const workflowRequests = scenario.clinicDayWorkflow.segments.flatMap((segment) =>
    segment.steps.map((step) => requestFromStep(segment, step))
  );
  const tenantIsolationRequests = scenario.tenantIsolationAssertions.map(
    requestFromTenantExpectation
  );
  const plan = {
    browserSmokePlan: scenario.browserSmokePlan,
    deferredEvidence: scenario.fixtureOnlyOrDeferredEvidence,
    migrationDryRunEvidence: scenario.migrationDryRunEvidence,
    providerUnavailableChecks: scenario.providerUnavailableChecks,
    roleMatrix: scenario.roleMatrix,
    sourceReferences: scenario.sourceReferences,
    tenantIsolationRequests,
    workflowRequests
  };

  return {
    ...plan,
    liveReadinessProbes: buildLiveReadinessProbes(plan)
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

async function executeRequest(baseUrl, scenario, request, options) {
  const url = new URL(request.path, baseUrl);
  const response = await fetch(url, {
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
  console.log("CP10 release-candidate clinic-day dry run plan:");
  for (const row of plan.workflowRequests) {
    printRequestRow("flow", row);
  }

  console.log("CP10 role matrix:");
  for (const row of plan.roleMatrix) {
    console.log(
      [
        "role".padEnd(6),
        `actor=${row.actorKey}`,
        `roleSlug=${row.roleSlug}`,
        `allow=${row.mustAllowPermissions.join(",") || "none"}`,
        `deny=${row.mustDenyPermissions.join(",") || "none"}`
      ].join(" ")
    );
  }

  console.log("CP10 tenant-isolation assertions:");
  for (const row of plan.tenantIsolationRequests) {
    printRequestRow("deny", row);
    console.log(`       reason=${row.expectedReason}`);
  }

  console.log("CP10 provider unavailable/no-credential checks:");
  for (const row of plan.providerUnavailableChecks) {
    console.log(
      [
        "provider",
        `key=${row.key}`,
        `provider=${row.providerKey}`,
        `mode=${row.mode}`,
        `liveReady=${row.liveProviderReady ? "yes" : "no"}`,
        `states=${row.mustReportState.join(",")}`,
        `mustNotClaim=${row.mustNotClaim.join(",")}`
      ].join(" ")
    );
  }

  console.log("CP10 migration dry-run references:");
  for (const row of plan.migrationDryRunEvidence) {
    console.log(`migration key=${row.key} source=${row.source}`);
    if (row.requiredRoutes.length) console.log(`       routes=${row.requiredRoutes.join(",")}`);
    console.log(`       preserve=${row.mustPreserve.join(",")}`);
  }

  console.log("CP10 deferred/fixture-only evidence:");
  for (const row of plan.deferredEvidence) {
    console.log(`deferred key=${row.key} checkpoint=${row.checkpoint} reason=${row.reason}`);
  }

  console.log("CP10 browser smoke plan:");
  console.log(`browser mode=${plan.browserSmokePlan.mode}`);
  for (const row of plan.browserSmokePlan.surfaces) {
    console.log(`browser key=${row.key} role=${row.role} paths=${row.paths.join(",")}`);
  }
}

function printRequestRow(type, row) {
  console.log(
    [
      type.padEnd(6),
      row.method.padEnd(4),
      row.path,
      `actor=${row.actorKey}`,
      row.segmentKey ? `segment=${row.segmentKey}` : "",
      row.requiredPermission ? `permission=${row.requiredPermission}` : "",
      `expect=${expectedStatusList(row.expectedStatus).join("/")}`,
      `live=${row.liveImplemented ? "yes" : "no"}`
    ]
      .filter(Boolean)
      .join(" ")
  );
  if (row.routeFamilies?.length) console.log(`       families=${row.routeFamilies.join(",")}`);
  if (row.providerBoundary) console.log(`       providerBoundary=${row.providerBoundary}`);
}

async function runLiveReadinessSmoke(scenario, plan, options) {
  assert.ok(options.baseUrl, "Set --base-url or CLINICOS_CP10_API_BASE_URL for live smoke.");

  for (const request of plan.liveReadinessProbes) {
    await executeRequest(options.baseUrl, scenario, request, options);
    console.log(`pass ${request.key}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenario = await loadCp10Scenario();
  const plan = buildCp10SmokePlan(scenario);

  if (options.dryRun) {
    printDryRun(plan);
    return;
  }

  await runLiveReadinessSmoke(scenario, plan, options);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
