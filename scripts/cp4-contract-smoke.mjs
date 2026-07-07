#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { loadCp4Scenario, validateCp4Scenario } from "./validate-cp4-fixtures.mjs";

const TOKEN_ENV_BY_ACTOR = {
  owner: "CLINICOS_CP4_OWNER_TOKEN",
  doctor: "CLINICOS_CP4_DOCTOR_TOKEN",
  assistant: "CLINICOS_CP4_ASSISTANT_TOKEN",
  receptionist: "CLINICOS_CP4_RECEPTIONIST_TOKEN",
  accountant: "CLINICOS_CP4_ACCOUNTANT_TOKEN",
  wrongTenantAssistant: "CLINICOS_CP4_WRONG_TENANT_ASSISTANT_TOKEN"
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
    baseUrl: process.env.CLINICOS_CP4_API_BASE_URL ?? "",
    authMode: process.env.CLINICOS_CP4_AUTH_MODE ?? "bearer",
    auditPath: process.env.CLINICOS_CP4_AUDIT_API_PATH ?? ""
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
    expectedBodyIncludes: step.expectedBodyIncludes ?? [],
    expectedBodyMustNotInclude: step.expectedBodyMustNotInclude ?? [],
    body: clonePlain(step.requestBody)
  };
}

function buildNegativeRequests(scenario) {
  return scenario.roleTenantExpectations
    .filter((expectation) => expectation.expected === "deny" && expectation.liveSmoke !== false)
    .map((expectation) => ({
      key: expectation.key,
      actorKey: expectation.actorKey,
      method: expectation.method,
      path: expectation.path,
      idempotencyKey: `cp4-${expectation.key}`,
      expectedStatus: expectedStatusList(expectation.expectedStatus),
      expectedReason: expectation.expectedReason,
      body: clonePlain(expectation.requestBody),
      assertion: `${expectation.operation} must deny ${expectation.actorKey} with ${expectation.expectedReason}.`
    }));
}

function buildPostFlowVerification(scenario) {
  const patient = byKey(scenario.patients, "chartingPatient", "patient");
  const chart = byKey(scenario.dentalCharts, "chartingPatientAdultChart", "dentalChart");
  const finding = byKey(scenario.dentalFindings, "tooth16OcclusalCaries", "dentalFinding");
  const uploadedXray = byKey(scenario.mediaAssets, "uploadedBitewingXray", "mediaAsset");
  const study = byKey(scenario.imagingStudies, "syntheticBitewingStudy", "imagingStudy");
  const forbiddenFields = scenario.responseAssertions.mediaPrivacy.publicResponsesMustNotExpose;

  return [
    {
      key: "read-dental-chart-history",
      actorKey: "doctor",
      method: "GET",
      path: `/v1/patients/${patient.id}/dental-chart`,
      idempotencyKey: "cp4-read-dental-chart-history",
      expectedStatus: [200],
      expectedBodyIncludes: [chart.id, finding.id, "history", "FDI", "toothNumber"],
      expectedBodyMustNotInclude: forbiddenFields,
      assertion: "Dental chart read must expose tooth-level finding history without storage paths."
    },
    {
      key: "read-media-asset-metadata",
      actorKey: "doctor",
      method: "GET",
      path: `/v1/media-assets/${uploadedXray.id}`,
      idempotencyKey: "cp4-read-media-asset-metadata",
      expectedStatus: [200],
      expectedBodyIncludes: [uploadedXray.id, "xray", "scan_passed", "mediated_signed_url_only"],
      expectedBodyMustNotInclude: forbiddenFields,
      assertion: "Media metadata read must not expose raw object storage keys."
    },
    {
      key: "read-imaging-study-coexistence-summary",
      actorKey: "doctor",
      method: "GET",
      path: `/v1/patients/${patient.id}/imaging-studies/${study.id}`,
      idempotencyKey: "cp4-read-imaging-study-coexistence-summary",
      expectedStatus: [200],
      expectedBodyIncludes: ["manual_upload", "metadata_import", "coexistence_imported"],
      expectedBodyMustNotInclude: forbiddenFields,
      assertion:
        "Imaging study summary must preserve upload/import provenance without implying PACS replacement."
    },
    {
      key: "read-patient-timeline-verification",
      actorKey: "doctor",
      method: "GET",
      path: `/v1/patients/${patient.id}/timeline`,
      idempotencyKey: "cp4-read-patient-timeline-verification",
      expectedStatus: [200],
      expectedBodyIncludes: scenario.responseAssertions.timeline.chartingPatientMustInclude,
      expectedBodyMustNotInclude: forbiddenFields,
      assertion:
        "Patient timeline must include encounter, dental finding, chart snapshot, media, DICOM metadata, external link, and media view events."
    }
  ];
}

export function buildCp4SmokePlan(scenario) {
  validateCp4Scenario(scenario);

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

function assertSerializedExcludes(value, needles, label) {
  const serialized = JSON.stringify(value);
  for (const needle of needles) {
    assert.equal(serialized.includes(needle), false, `${label} exposed ${needle}`);
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

  console.log("CP4 API smoke dry run plan:");
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

    if (row.expectedBodyIncludes?.length) {
      console.log(`       includes=${row.expectedBodyIncludes.join(",")}`);
    }

    if (row.expectedBodyMustNotInclude?.length) {
      console.log(`       excludes=${row.expectedBodyMustNotInclude.join(",")}`);
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
  assert.ok(options.baseUrl, "Set --base-url or CLINICOS_CP4_API_BASE_URL for live smoke.");

  for (const request of plan.flowRequests) {
    const liveRequest = resolveLiveRequest(request);
    const { body } = await executeRequest(options.baseUrl, scenario, liveRequest, options);
    assertSerializedIncludes(body, request.expectedBodyIncludes, request.key);
    assertSerializedExcludes(body, request.expectedBodyMustNotInclude, request.key);
    console.log(`pass ${request.key}`);
  }

  for (const request of plan.postFlowVerification) {
    const liveRequest = resolveLiveRequest(request);
    const { body } = await executeRequest(options.baseUrl, scenario, liveRequest, options);
    assertSerializedIncludes(body, request.expectedBodyIncludes, request.key);
    assertSerializedExcludes(body, request.expectedBodyMustNotInclude, request.key);
    console.log(`pass ${request.key}`);
  }

  if (options.auditPath) {
    const auditRequest = {
      key: "read-audit-evidence",
      actorKey: "owner",
      method: "GET",
      path: options.auditPath,
      idempotencyKey: "cp4-read-audit-evidence",
      expectedStatus: [200],
      body: undefined
    };
    const { body } = await executeRequest(options.baseUrl, scenario, auditRequest, options);
    assertSerializedIncludes(
      body,
      [
        "dental_finding.created",
        "dental_chart.snapshot_created",
        "media.created",
        "media.linked",
        "media.viewed"
      ],
      auditRequest.key
    );
    console.log(`pass ${auditRequest.key}`);
  } else {
    console.log(
      "skip audit API probe; set CLINICOS_CP4_AUDIT_API_PATH after audit read endpoint is merged."
    );
  }

  for (const request of plan.negativeRequests) {
    const liveRequest = resolveLiveRequest(request);
    const { body } = await executeRequest(options.baseUrl, scenario, liveRequest, options);
    assertSerializedIncludes(body, [request.expectedReason], request.key);
    assertSerializedExcludes(
      body,
      scenario.responseAssertions.mediaPrivacy.publicResponsesMustNotExpose,
      request.key
    );
    console.log(`pass ${request.key}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenario = await loadCp4Scenario();
  const plan = buildCp4SmokePlan(scenario);

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
