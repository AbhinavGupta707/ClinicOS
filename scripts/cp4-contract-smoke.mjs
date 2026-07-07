#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { loadCp4Scenario, validateCp4Scenario } from "./validate-cp4-fixtures.mjs";

const CP4_UPLOAD_BYTES = Buffer.from("ClinicOS CP4 synthetic bitewing upload bytes\n", "utf8");
const CP4_UPLOAD_DIGEST = createHash("sha256").update(CP4_UPLOAD_BYTES).digest("hex");
const LIVE_DENTAL_FLOW_KEYS = [
  "read-encounter-for-dental-chart",
  "create-tooth-finding-as-assistant",
  "review-update-finding-as-doctor",
  "create-chart-snapshot"
];
const LIVE_TIMELINE_FLOW_KEY = "read-patient-timeline-after-media";

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
    .map((expectation) => ({ expectation, path: liveDenialPath(expectation.path) }))
    .filter((entry) => entry.path)
    .map(({ expectation, path }) => ({
      key: expectation.key,
      actorKey: expectation.actorKey,
      method: expectation.method,
      path,
      idempotencyKey: `cp4-${expectation.key}`,
      expectedStatus: expectedStatusList(expectation.expectedStatus),
      expectedReason: expectation.expectedReason,
      body: signedAccessBody(expectation.requestBody),
      assertion: `${liveDenialOperation(expectation.operation)} must deny ${expectation.actorKey} with ${expectation.expectedReason}.`
    }));
}

function liveDenialPath(path) {
  if (!path) return null;
  if (path.endsWith("/links")) return null;
  return path.replace("/signed-access", "/signed-url");
}

function liveDenialOperation(operation) {
  return operation.replace("/signed-access", "/signed-url");
}

function signedAccessBody(body) {
  if (body === undefined || body === null) return undefined;
  const cloned = clonePlain(body);
  if (cloned && typeof cloned === "object" && "purpose" in cloned) {
    return { expiresInSeconds: 300 };
  }
  return cloned;
}

function buildLiveMediaRequests(scenario) {
  const patient = byKey(scenario.patients, "chartingPatient", "patient");
  const finding = byKey(scenario.dentalFindings, "tooth16OcclusalCaries", "dentalFinding");
  const uploadedXray = byKey(scenario.mediaAssets, "uploadedBitewingXray", "mediaAsset");
  const forbiddenFields = scenario.responseAssertions.mediaPrivacy.publicResponsesMustNotExpose;

  return [
    {
      key: "request-xray-upload-url",
      actorKey: "assistant",
      method: "POST",
      path: "/v1/media/upload-urls",
      idempotencyKey: "cp4-request-xray-upload-url",
      expectedStatus: [201],
      expectedEvents: ["media.upload_requested"],
      expectedAudit: [
        {
          action: "media.upload_requested",
          phiFields: ["patientId", "mediaType", "tags"],
          resourceType: "media_upload",
          resourceId: "{uploadId}"
        }
      ],
      expectedBodyIncludes: ["upload", "uploadTarget", "uploadUrl", "expiresAt"],
      expectedBodyMustNotInclude: forbiddenFields,
      body: {
        dentalFindingId: finding.id,
        encounterId: finding.encounterId,
        fileSizeBytes: CP4_UPLOAD_BYTES.byteLength,
        mediaType: "xray",
        mimeType: uploadedXray.mimeType,
        originalFilename: "cp4-synthetic-bitewing.png",
        patientId: patient.id,
        provenance: uploadedXray.provenance,
        sha256Digest: CP4_UPLOAD_DIGEST,
        tags: uploadedXray.tags,
        toothNumber: finding.toothNumber
      },
      capture: {
        uploadId: ["upload", "id"],
        uploadUrl: ["uploadTarget", "uploadUrl"]
      }
    },
    {
      key: "upload-xray-content",
      actorKey: "assistant",
      method: "PUT",
      path: "{uploadUrl}",
      idempotencyKey: "cp4-upload-xray-content",
      expectedStatus: [200],
      expectedEvents: [],
      expectedAudit: [],
      expectedBodyIncludes: ["upload", "object", CP4_UPLOAD_DIGEST],
      expectedBodyMustNotInclude: forbiddenFields,
      rawBody: CP4_UPLOAD_BYTES,
      contentType: uploadedXray.mimeType,
      requiredHeaders: {
        "x-clinic-os-upload-id": "{uploadId}"
      }
    },
    {
      key: "complete-xray-upload",
      actorKey: "assistant",
      method: "POST",
      path: "/v1/media/uploads/{uploadId}/complete",
      idempotencyKey: "cp4-complete-xray-upload",
      expectedStatus: [201],
      expectedEvents: ["media.upload_completed"],
      expectedAudit: [
        {
          action: "media.upload_completed",
          phiFields: ["patientId", "mediaAssetId", "scanStatus"],
          resourceType: "media_asset",
          resourceId: "{mediaAssetId}"
        }
      ],
      expectedBodyIncludes: ["mediaAsset", "xray", "clean"],
      expectedBodyMustNotInclude: forbiddenFields,
      body: {
        contentLength: CP4_UPLOAD_BYTES.byteLength,
        dicomMetadata: {
          metadataOnly: false,
          source: "cp4_contract_smoke"
        },
        encounterId: finding.encounterId,
        mimeType: uploadedXray.mimeType,
        patientId: patient.id,
        scanStatus: "clean",
        sha256Digest: CP4_UPLOAD_DIGEST
      },
      capture: {
        mediaAssetId: ["mediaAsset", "id"]
      }
    },
    {
      key: "list-patient-media-after-upload",
      actorKey: "doctor",
      method: "GET",
      path: `/v1/patients/${patient.id}/media`,
      idempotencyKey: "cp4-list-patient-media-after-upload",
      expectedStatus: [200],
      expectedEvents: [],
      expectedAudit: [],
      expectedBodyIncludes: ["mediaAssets", "xray", "{mediaAssetId}"],
      expectedBodyMustNotInclude: forbiddenFields
    },
    {
      key: "request-signed-media-view",
      actorKey: "doctor",
      method: "POST",
      path: "/v1/media/assets/{mediaAssetId}/signed-url",
      idempotencyKey: "cp4-request-signed-media-view",
      expectedStatus: [200],
      expectedEvents: ["media.viewed"],
      expectedAudit: [
        {
          action: "media.viewed",
          phiFields: ["patientId", "mediaAssetId", "viewerActorId"],
          resourceType: "media_asset",
          resourceId: "{mediaAssetId}"
        }
      ],
      expectedBodyIncludes: ["mediaAsset", "access", "signedUrl", "expiresAt"],
      expectedBodyMustNotInclude: forbiddenFields,
      body: {
        expiresInSeconds: 300
      }
    }
  ];
}

function buildPostFlowVerification(scenario) {
  const patient = byKey(scenario.patients, "chartingPatient", "patient");
  const chart = byKey(scenario.dentalCharts, "chartingPatientAdultChart", "dentalChart");
  const finding = byKey(scenario.dentalFindings, "tooth16OcclusalCaries", "dentalFinding");
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
      key: "list-patient-media-verification",
      actorKey: "doctor",
      method: "GET",
      path: `/v1/patients/${patient.id}/media`,
      idempotencyKey: "cp4-list-patient-media-verification",
      expectedStatus: [200],
      expectedBodyIncludes: ["mediaAssets", "xray", "{mediaAssetId}"],
      expectedBodyMustNotInclude: forbiddenFields,
      assertion:
        "Media listing must expose clinical media metadata without raw object storage keys."
    },
    {
      key: "read-patient-timeline-verification",
      actorKey: "doctor",
      method: "GET",
      path: `/v1/patients/${patient.id}/timeline`,
      idempotencyKey: "cp4-read-patient-timeline-verification",
      expectedStatus: [200],
      expectedBodyIncludes: [
        "dental_finding.created",
        "dental_finding.updated",
        "dental_chart.snapshot_created",
        "media.upload_completed"
      ],
      expectedBodyMustNotInclude: forbiddenFields,
      assertion:
        "Patient timeline must include dental finding, chart snapshot, and durable media upload evidence."
    }
  ];
}

export function buildCp4SmokePlan(scenario) {
  validateCp4Scenario(scenario);
  const liveDentalRequests = LIVE_DENTAL_FLOW_KEYS.map((key) =>
    requestFromStep(byKey(scenario.flow.steps, key, "flow step"))
  );
  const liveTimelineRequest = {
    ...requestFromStep(byKey(scenario.flow.steps, LIVE_TIMELINE_FLOW_KEY, "flow step")),
    expectedBodyIncludes: [
      "dental_finding.created",
      "dental_finding.updated",
      "dental_chart.snapshot_created",
      "media.upload_completed"
    ]
  };
  const fixtureOnlyRequests = scenario.flow.steps
    .filter(
      (step) => !LIVE_DENTAL_FLOW_KEYS.includes(step.key) && step.key !== LIVE_TIMELINE_FLOW_KEY
    )
    .filter(
      (step) =>
        !["request-xray-upload-url", "complete-xray-upload", "request-signed-media-view"].includes(
          step.key
        )
    )
    .map(requestFromStep);

  return {
    fixtureOnlyRequests,
    flowRequests: [...liveDentalRequests, ...buildLiveMediaRequests(scenario), liveTimelineRequest],
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

function substituteState(value, state) {
  if (typeof value === "string") {
    return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
      assert.ok(state[key], `Missing live smoke state value for ${key}`);
      return state[key];
    });
  }

  if (Array.isArray(value)) return value.map((item) => substituteState(item, state));

  if (value && typeof value === "object" && !Buffer.isBuffer(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, substituteState(item, state)])
    );
  }

  return value;
}

function resolveLiveRequest(request, state = {}) {
  return {
    ...request,
    body: substituteState(clonePlain(request.body), state),
    expectedBodyIncludes: substituteState(request.expectedBodyIncludes, state),
    path: normalizeApiPath(substituteState(request.path, state)),
    requiredHeaders: substituteState(request.requiredHeaders ?? {}, state)
  };
}

async function executeRequest(baseUrl, scenario, request, options) {
  const url = new URL(request.path, baseUrl);
  const headers = {
    ...headersForRequest(scenario, request, options),
    ...request.requiredHeaders
  };
  if (request.contentType) headers["Content-Type"] = request.contentType;
  const response = await fetch(url, {
    method: request.method,
    headers,
    body:
      request.rawBody === undefined
        ? request.body === undefined
          ? undefined
          : JSON.stringify(request.body)
        : request.rawBody
  });
  const body = await parseResponseBody(response);
  const acceptedStatuses = expectedStatusList(request.expectedStatus);

  assert.ok(
    acceptedStatuses.includes(response.status),
    `${request.key} expected ${acceptedStatuses.join("/")} but got ${response.status}: ${JSON.stringify(body)}`
  );

  return { response, body };
}

function captureState(request, body, state) {
  if (!request.capture) return;
  for (const [stateKey, path] of Object.entries(request.capture)) {
    let value = body;
    for (const segment of path) {
      value = value?.[segment];
    }
    assert.equal(typeof value, "string", `${request.key} did not expose ${path.join(".")}`);
    state[stateKey] = value;
  }
}

function printDryRun(plan) {
  const rows = [
    ...plan.flowRequests.map((request) => ({ type: "flow", ...request })),
    ...plan.postFlowVerification.map((request) => ({ type: "verify", ...request })),
    ...plan.negativeRequests.map((request) => ({ type: "deny", ...request }))
  ];

  console.log("CP4 API smoke dry run plan:");
  if (plan.fixtureOnlyRequests?.length) {
    console.log(
      `fixture-only ${plan.fixtureOnlyRequests.length} deferred imaging/link evidence steps are excluded from live API smoke`
    );
  }
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
  const state = {};

  for (const request of plan.flowRequests) {
    const liveRequest = resolveLiveRequest(request, state);
    const { body } = await executeRequest(options.baseUrl, scenario, liveRequest, options);
    captureState(liveRequest, body, state);
    assertSerializedIncludes(body, liveRequest.expectedBodyIncludes, request.key);
    assertSerializedExcludes(body, request.expectedBodyMustNotInclude, request.key);
    console.log(`pass ${request.key}`);
  }

  for (const request of plan.postFlowVerification) {
    const liveRequest = resolveLiveRequest(request, state);
    const { body } = await executeRequest(options.baseUrl, scenario, liveRequest, options);
    assertSerializedIncludes(body, liveRequest.expectedBodyIncludes, request.key);
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
        "media.upload_requested",
        "media.upload_completed",
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
    const liveRequest = resolveLiveRequest(request, state);
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
