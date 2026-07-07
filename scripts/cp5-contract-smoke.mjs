#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { loadCp5Scenario, validateCp5Scenario } from "./validate-cp5-fixtures.mjs";

const TOKEN_ENV_BY_ACTOR = {
  owner: "CLINICOS_CP5_OWNER_TOKEN",
  doctor: "CLINICOS_CP5_DOCTOR_TOKEN",
  assistant: "CLINICOS_CP5_ASSISTANT_TOKEN",
  receptionist: "CLINICOS_CP5_RECEPTIONIST_TOKEN",
  accountant: "CLINICOS_CP5_ACCOUNTANT_TOKEN",
  wrongTenantAssistant: "CLINICOS_CP5_WRONG_TENANT_ASSISTANT_TOKEN"
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
    baseUrl: process.env.CLINICOS_CP5_API_BASE_URL ?? "",
    authMode: process.env.CLINICOS_CP5_AUTH_MODE ?? "bearer",
    auditPath: process.env.CLINICOS_CP5_AUDIT_API_PATH ?? ""
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
    providerWebhook: step.providerWebhook === true,
    requestHeaders: clonePlain(step.requestHeaders),
    expectedStatus: expectedStatusList(step.expectedStatus),
    expectedEvents: step.expectedEvents,
    expectedAudit: step.expectedAudit,
    timelineExpectations: step.timelineExpectations,
    expectedBodyIncludes: step.expectedBodyIncludes ?? [],
    expectedBodyMustNotInclude: step.expectedBodyMustNotInclude ?? [],
    expectedState: clonePlain(step.expectedState),
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
      idempotencyKey: `cp5-${expectation.key}`,
      expectedStatus: expectedStatusList(expectation.expectedStatus),
      expectedReason: expectation.expectedReason,
      body: clonePlain(expectation.requestBody),
      assertion: `${expectation.operation} must deny ${expectation.actorKey} with ${expectation.expectedReason}.`
    }));
}

function buildPostFlowVerification(scenario) {
  const patient = byKey(scenario.patients, "checkoutPatient", "patient");
  const invoice = byKey(scenario.invoices, "rctInvoice", "invoice");
  const receipt = byKey(scenario.receipts, "rctReceipt", "receipt");
  const instructionDelivery = scenario.responseAssertions.instructionDelivery;

  return [
    {
      key: "read-final-invoice-state",
      actorKey: "receptionist",
      method: "GET",
      path: `/v1/invoices/${invoice.id}`,
      idempotencyKey: "cp5-read-final-invoice-state",
      expectedStatus: [200],
      expectedBodyIncludes: [
        "paid",
        String(invoice.totalAmountPaise),
        String(invoice.paidAmountPaise),
        receipt.receiptNumber
      ],
      assertion:
        "Final invoice read must show full payment from verified provider and audited manual transactions."
    },
    {
      key: "read-checkout-patient-timeline",
      actorKey: "doctor",
      method: "GET",
      path: `/v1/patients/${patient.id}/timeline`,
      idempotencyKey: "cp5-read-checkout-patient-timeline",
      expectedStatus: [200],
      expectedBodyIncludes: scenario.responseAssertions.timeline.checkoutPatientMustInclude,
      expectedBodyMustNotInclude: ["providerDeliveryConfirmedAt", "deliveredAt", "readAt"],
      assertion:
        "Patient timeline must include treatment, invoice, payment, receipt, prescription, print, and send-request evidence without fake delivery."
    },
    {
      key: "read-accountant-invoice-summary",
      actorKey: "accountant",
      method: "GET",
      path: `/v1/invoices/${invoice.id}`,
      idempotencyKey: "cp5-read-accountant-invoice-summary",
      expectedStatus: [200],
      expectedBodyIncludes: ["paid", String(invoice.totalAmountPaise), "invoice"],
      expectedBodyMustNotInclude: ["medications", "signedHash", "diagnosis", "toothNumber"],
      assertion:
        "Accountant invoice summary must expose billing state without default clinical-output detail."
    },
    {
      key: "verify-instruction-send-request-evidence",
      actorKey: "receptionist",
      method: "GET",
      path: `/v1/patients/${patient.id}/timeline`,
      idempotencyKey: "cp5-verify-instruction-send-request-evidence",
      expectedStatus: [200],
      expectedBodyIncludes: [
        instructionDelivery.patientVisibleDeliveryStatus,
        instructionDelivery.outboxEventTypes[0],
        "providerConfirmationReceived"
      ],
      expectedBodyMustNotInclude: instructionDelivery.mustNotClaimStatuses,
      assertion:
        "Instruction send evidence must remain provider/request/outbox evidence until provider confirmation exists."
    }
  ];
}

export function buildCp5SmokePlan(scenario) {
  validateCp5Scenario(scenario);

  return {
    flowRequests: scenario.flow.steps.map(requestFromStep),
    negativeRequests: buildNegativeRequests(scenario),
    postFlowVerification: buildPostFlowVerification(scenario)
  };
}

function headersForRequest(scenario, request, options) {
  const actor = actorForRequest(scenario, request.actorKey);

  if (request.providerWebhook) {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-ClinicOS-Provider-Simulator": actor.key,
      ...(request.requestHeaders ?? {})
    };
  }

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

  console.log("CP5 API smoke dry run plan:");
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

    if (row.providerWebhook) {
      console.log(
        `       providerWebhook=true signatureHeader=${row.requestHeaders?.["X-Razorpay-Signature"] ?? "missing"}`
      );
    }

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

    if (row.expectedState) {
      console.log(`       state=${JSON.stringify(row.expectedState)}`);
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
  assert.ok(options.baseUrl, "Set --base-url or CLINICOS_CP5_API_BASE_URL for live smoke.");

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
      idempotencyKey: "cp5-read-audit-evidence",
      expectedStatus: [200],
      body: undefined
    };
    const { body } = await executeRequest(options.baseUrl, scenario, auditRequest, options);
    assertSerializedIncludes(
      body,
      [
        "treatment_plan.created",
        "invoice.created",
        "payment.webhook.rejected",
        "payment.manual_recorded",
        "receipt.generated",
        "prescription.signed",
        "instruction.send_requested"
      ],
      auditRequest.key
    );
    console.log(`pass ${auditRequest.key}`);
  } else {
    console.log(
      "skip audit API probe; set CLINICOS_CP5_AUDIT_API_PATH after audit read endpoint is merged."
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
  const scenario = await loadCp5Scenario();
  const plan = buildCp5SmokePlan(scenario);

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
