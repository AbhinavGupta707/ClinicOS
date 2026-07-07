#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { loadCp8Scenario, validateCp8Scenario } from "./validate-cp8-fixtures.mjs";

const TOKEN_ENV_BY_ACTOR = {
  doctor: "CLINICOS_CP8_DOCTOR_TOKEN",
  assistant: "CLINICOS_CP8_ASSISTANT_TOKEN",
  receptionist: "CLINICOS_CP8_RECEPTIONIST_TOKEN"
};

const LOCAL_DEV_SUBJECT_BY_ACTOR = {
  doctor: "seed-doctor",
  assistant: "seed-assistant",
  receptionist: "seed-receptionist"
};

function parseArgs(argv) {
  const options = {
    authMode: process.env.CLINICOS_CP8_AUTH_MODE ?? "bearer",
    baseUrl: process.env.CLINICOS_CP8_API_BASE_URL ?? "",
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

function requestFromStep(step) {
  return {
    actorKey: step.actorKey,
    body: clonePlain(step.requestBody),
    expectedBodyIncludes: step.expectedBodyIncludes ?? [],
    expectedBodyMustNotInclude: step.expectedBodyMustNotInclude ?? [],
    expectedStatus: expectedStatusList(step.expectedStatus),
    key: step.key,
    liveImplemented: step.liveImplemented === true,
    method: step.method,
    path: step.path,
    routeFamily: step.routeFamily
  };
}

export function buildCp8SmokePlan(scenario) {
  validateCp8Scenario(scenario);
  const flowRequests = scenario.flow.steps.map(requestFromStep);
  const safetyRequests = flowRequests.filter((request) =>
    ["ai-consent-block", "ai-review-boundary", "ai-review-decision"].includes(request.routeFamily)
  );
  const fixtureOnlyEvidence = [
    {
      key: "unsupported-claim-validator",
      reason: "Validator rejects unanchored clinical claims before review.",
      source: "unsafeOutputs.unsupportedDiagnosisOutput"
    },
    {
      key: "wrong-tooth-validator",
      reason: "Validator rejects tooth output when source segment names a different FDI tooth.",
      source: "unsafeOutputs.wrongToothChartPatchOutput"
    },
    {
      key: "browser-mobile-checklist",
      reason:
        "Review UX/mobile route selectors and 390px no-overflow checks are documented until UI lanes merge.",
      source: "browserSmokeChecklist"
    }
  ];

  return { fixtureOnlyEvidence, flowRequests, safetyRequests };
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
    "X-Clinic-Id": primaryClinic.id,
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
  console.log("CP8 AI safety API smoke dry run plan:");
  for (const row of plan.flowRequests) {
    console.log(
      [
        "flow".padEnd(6),
        row.method.padEnd(4),
        row.path,
        `actor=${row.actorKey}`,
        `family=${row.routeFamily}`,
        `expect=${expectedStatusList(row.expectedStatus).join("/")}`,
        `live=${row.liveImplemented ? "yes" : "no"}`
      ].join(" ")
    );
    if (row.expectedBodyIncludes.length)
      console.log(`       includes=${row.expectedBodyIncludes.join(",")}`);
    if (row.expectedBodyMustNotInclude.length) {
      console.log(`       excludes=${row.expectedBodyMustNotInclude.join(",")}`);
    }
  }
  console.log("CP8 fixture-only/deferred evidence:");
  for (const row of plan.fixtureOnlyEvidence) {
    console.log(`fixture ${row.key} source=${row.source} reason=${row.reason}`);
  }
}

async function runLiveSmoke(scenario, plan, options) {
  assert.ok(options.baseUrl, "Set --base-url or CLINICOS_CP8_API_BASE_URL for live smoke.");
  const executable = plan.flowRequests.filter((request) => request.liveImplemented);

  if (executable.length === 0) {
    console.log(
      "No CP8 requests are marked liveImplemented in this safety lane fixture; dry-run contract and validator evidence are expected until backend/review/mobile lanes merge canonical routes."
    );
    return;
  }

  for (const request of executable) {
    const { body } = await executeRequest(options.baseUrl, scenario, request, options);
    assertSerializedIncludes(body, request.expectedBodyIncludes, request.key);
    assertSerializedExcludes(body, request.expectedBodyMustNotInclude, request.key);
    console.log(`pass ${request.key}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenario = await loadCp8Scenario();
  const plan = buildCp8SmokePlan(scenario);

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
