#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { loadCp3Scenario, validateCp3Scenario } from "./validate-cp3-fixtures.mjs";

const TOKEN_ENV_BY_ACTOR = {
  owner: "CLINICOS_CP3_OWNER_TOKEN",
  doctor: "CLINICOS_CP3_DOCTOR_TOKEN",
  assistant: "CLINICOS_CP3_ASSISTANT_TOKEN",
  receptionist: "CLINICOS_CP3_RECEPTIONIST_TOKEN",
  accountant: "CLINICOS_CP3_ACCOUNTANT_TOKEN",
  wrongTenantAssistant: "CLINICOS_CP3_WRONG_TENANT_ASSISTANT_TOKEN"
};

const LOCAL_DEV_SUBJECT_BY_ACTOR = {
  owner: "seed-owner",
  doctor: "seed-doctor",
  assistant: "seed-assistant",
  receptionist: "seed-receptionist",
  accountant: "seed-accountant",
  wrongTenantAssistant: "seed-assistant"
};

function parseArgs(argv) {
  const options = {
    dryRun: false,
    baseUrl: process.env.CLINICOS_CP3_API_BASE_URL ?? "",
    authMode: process.env.CLINICOS_CP3_AUTH_MODE ?? "bearer",
    auditPath: process.env.CLINICOS_CP3_AUDIT_API_PATH ?? ""
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

    if (arg === "--audit-path") {
      options.auditPath = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function byKey(collection, key, label) {
  const match = collection.find((item) => item.key === key);
  assert.ok(match, `Unknown ${label} key: ${key}`);
  return match;
}

function clonePlain(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function actorForRequest(scenario, actorKey) {
  return byKey(scenario.actors, actorKey, "actor");
}

function normalizeApiPath(path) {
  if (path.startsWith("/v1/")) return path;
  if (path.startsWith("/")) return `/v1${path}`;
  return `/v1/${path}`;
}

function expectedStatusList(expectedStatus) {
  return Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
}

function requestFromStep(step) {
  return {
    key: step.key,
    actorKey: step.actorKey,
    method: step.method,
    path: step.path,
    idempotencyKey: step.idempotencyKey,
    expectedStatus: expectedStatusList(step.expectedStatus),
    expectedEvents: step.expectedEvents,
    expectedAudit: step.expectedAudit,
    timelineExpectations: step.timelineExpectations,
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
      idempotencyKey: `cp3-${expectation.key}`,
      expectedStatus: expectedStatusList(expectation.expectedStatus),
      expectedReason: expectation.expectedReason,
      body: clonePlain(expectation.requestBody),
      assertion: `${expectation.operation} must deny ${expectation.actorKey} with ${expectation.expectedReason}.`
    }));
}

function buildPostFlowVerification(scenario) {
  const newPatient = byKey(scenario.patients, "newPatient", "patient");
  const returningPatient = byKey(scenario.patients, "returningPatient", "patient");
  const newNote = byKey(scenario.clinicalNotes, "newPatientNote", "clinicalNote");
  const consent = scenario.responseAssertions.consentEnforcement;

  return [
    {
      key: "read-new-patient-timeline",
      actorKey: "assistant",
      method: "GET",
      path: `/v1/patients/${newPatient.id}/timeline`,
      idempotencyKey: "cp3-read-new-patient-timeline",
      expectedStatus: [200],
      expectedBodyIncludes: scenario.responseAssertions.timeline.newPatientMustInclude,
      assertion:
        "New patient timeline must include intake, consent, encounter, signed note, prescription, amendment, and consent revocation entries."
    },
    {
      key: "read-returning-patient-timeline",
      actorKey: "doctor",
      method: "GET",
      path: `/v1/patients/${returningPatient.id}/timeline`,
      idempotencyKey: "cp3-read-returning-patient-timeline",
      expectedStatus: [200],
      expectedBodyIncludes: scenario.responseAssertions.timeline.returningPatientMustInclude,
      assertion: "Returning patient timeline must include paper-card intake and encounter start."
    },
    {
      key: "read-signed-note-version-history",
      actorKey: "doctor",
      method: "GET",
      path: `/v1/clinical-notes/${newNote.id}/versions`,
      idempotencyKey: "cp3-read-signed-note-version-history",
      expectedStatus: [200],
      expectedBodyIncludes: [
        scenario.responseAssertions.signedNoteImmutability.signedVersionId,
        scenario.responseAssertions.signedNoteImmutability.amendedVersionId,
        "amendmentReason"
      ],
      assertion: "Signed note history must expose immutable v1 and linked amended v2."
    },
    {
      key: "read-ai-audio-readiness-after-revocation",
      actorKey: "assistant",
      method: "GET",
      path: consent.readinessEndpoint,
      idempotencyKey: "cp3-read-ai-audio-readiness-after-revocation",
      expectedStatus: [200],
      expectedBodyIncludes: [consent.blockingReason, ...consent.blockedCapabilities],
      assertion:
        "AI/audio readiness must be false after consent revocation and explain blocked capabilities."
    }
  ];
}

export function buildCp3SmokePlan(scenario) {
  validateCp3Scenario(scenario);

  return {
    flowRequests: scenario.flow.steps.map(requestFromStep),
    negativeRequests: buildNegativeRequests(scenario),
    postFlowVerification: buildPostFlowVerification(scenario)
  };
}

function headersForRequest(scenario, request, options) {
  const actor = actorForRequest(scenario, request.actorKey);
  const usesLocalDevSubject =
    options.authMode === "fixture-headers" || options.authMode === "local-dev-subject";
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Idempotency-Key": request.idempotencyKey,
    "X-Clinic-Id": actor.clinicId,
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
  assert.ok(
    token,
    `Missing ${tokenEnv} for ${actor.key}; set --auth-mode fixture-headers only for local-only auth adapters.`
  );

  return {
    ...headers,
    Authorization: `Bearer ${token}`
  };
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

function resolveLiveRequest(request) {
  return {
    ...request,
    path: normalizeApiPath(request.path),
    body: clonePlain(request.body)
  };
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

  console.log("CP3 API smoke dry run plan:");
  for (const row of rows) {
    console.log(
      [
        row.type.padEnd(6),
        row.method.padEnd(4),
        row.path,
        `actor=${row.actorKey}`,
        `expect=${expectedStatusList(row.expectedStatus).join("/")}`
      ].join(" ")
    );

    if (row.expectedEvents?.length) {
      console.log(`       events=${row.expectedEvents.join(",")}`);
    }

    if (row.expectedAudit?.length) {
      console.log(`       audit=${row.expectedAudit.map((event) => event.action).join(",")}`);
    }

    if (row.expectedReason) {
      console.log(`       reason=${row.expectedReason}`);
    }

    if (row.assertion) {
      console.log(`       assertion=${row.assertion}`);
    }
  }
}

async function runLiveSmoke(scenario, plan, options) {
  assert.ok(options.baseUrl, "Set --base-url or CLINICOS_CP3_API_BASE_URL for live smoke.");

  for (const request of plan.flowRequests) {
    const liveRequest = resolveLiveRequest(request);
    const { body } = await executeRequest(options.baseUrl, scenario, liveRequest, options);
    if (request.key === "verify-ai-audio-readiness-blocked") {
      assertSerializedIncludes(body, ["consent_revoked"], request.key);
    }
    console.log(`pass ${request.key}`);
  }

  for (const request of plan.postFlowVerification) {
    const liveRequest = resolveLiveRequest(request);
    const { body } = await executeRequest(options.baseUrl, scenario, liveRequest, options);
    assertSerializedIncludes(body, request.expectedBodyIncludes, request.key);
    console.log(`pass ${request.key}`);
  }

  if (options.auditPath) {
    const auditRequest = {
      key: "read-audit-evidence",
      actorKey: "owner",
      method: "GET",
      path: options.auditPath,
      idempotencyKey: "cp3-read-audit-evidence",
      expectedStatus: [200],
      body: undefined
    };
    const { body } = await executeRequest(options.baseUrl, scenario, auditRequest, options);
    assertSerializedIncludes(
      body,
      [
        "form_response.submitted",
        "consent.created",
        "clinical_note.signed",
        "clinical_note.amended",
        "consent.revoked"
      ],
      auditRequest.key
    );
    console.log(`pass ${auditRequest.key}`);
  } else {
    console.log(
      "skip audit API probe; set CLINICOS_CP3_AUDIT_API_PATH after audit read endpoint is merged."
    );
  }

  for (const request of plan.negativeRequests) {
    const liveRequest = resolveLiveRequest(request);
    const { body } = await executeRequest(options.baseUrl, scenario, liveRequest, options);
    assertSerializedIncludes(body, [request.expectedReason], request.key);
    console.log(`pass ${request.key}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenario = await loadCp3Scenario();
  const plan = buildCp3SmokePlan(scenario);

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
