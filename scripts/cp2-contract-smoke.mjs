#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { loadCp2Scenario, validateCp2Scenario } from "./validate-cp2-fixtures.mjs";

const TOKEN_ENV_BY_ACTOR = {
  owner: "CLINICOS_CP2_OWNER_TOKEN",
  assistant: "CLINICOS_CP2_ASSISTANT_TOKEN",
  receptionist: "CLINICOS_CP2_RECEPTIONIST_TOKEN",
  accountant: "CLINICOS_CP2_ACCOUNTANT_TOKEN",
  doctor: "CLINICOS_CP2_DOCTOR_TOKEN",
  wrongTenantAssistant: "CLINICOS_CP2_WRONG_TENANT_ASSISTANT_TOKEN"
};

const LOCAL_DEV_SUBJECT_BY_ACTOR = {
  owner: "seed-owner",
  assistant: "seed-assistant",
  receptionist: "seed-receptionist",
  accountant: "seed-accountant",
  doctor: "seed-doctor",
  wrongTenantAssistant: "seed-assistant"
};

const LOCAL_DEV_TENANT_ID = "10000000-0000-4000-8000-000000000001";
const LOCAL_DEV_CLINIC_ID = "10000000-0000-4000-8000-000000000101";
const LOCAL_DEV_DOCTOR_USER_ID = "10000000-0000-4000-8000-000000001002";
const LOCAL_DEV_APPOINTMENT_TYPE_ID = "10000000-0000-4000-8000-000000003001";
const LOCAL_DEV_CHAIR_ID = "10000000-0000-4000-8000-000000004001";
const FIXED_FIXTURE_SERVICE_DATE = "2026-07-07";

function parseArgs(argv) {
  const options = {
    dryRun: false,
    baseUrl: process.env.CLINICOS_CP2_API_BASE_URL ?? "",
    authMode: process.env.CLINICOS_CP2_AUTH_MODE ?? "bearer",
    auditPath: process.env.CLINICOS_CP2_AUDIT_API_PATH ?? ""
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

export function resolveFixtureRef(scenario, ref) {
  const [collectionName, key, ...rest] = ref.split(".");
  let value = scenario[collectionName];

  if (Array.isArray(value)) {
    value = byKey(value, key, collectionName);
  } else if (key) {
    value = value?.[key];
  }

  for (const segment of rest) {
    value = value?.[segment];
  }

  assert.notEqual(value, undefined, `Unable to resolve fixture ref ${ref}`);
  return clonePlain(value);
}

function actorForStep(scenario, actorKey) {
  return byKey(scenario.actors, actorKey, "actor");
}

function doctorProviderId(scenario, appointment) {
  const provider = actorForStep(scenario, appointment.providerActorKey);
  return provider.id;
}

function bodyForStep(scenario, step) {
  if (step.method === "GET") return undefined;

  const fixture = resolveFixtureRef(scenario, step.bodyFixtureRef);

  if (step.key.startsWith("capture-")) {
    return {
      tenantId: fixture.tenantId,
      clinicId: fixture.clinicId,
      source: fixture.source,
      primaryContact: fixture.primaryContact,
      displayName: fixture.displayName,
      intent: fixture.intent,
      receivedAt: fixture.receivedAt,
      sourceDetail: fixture.sourceDetail
    };
  }

  if (step.key.startsWith("match-")) {
    return {
      expectedStrategy: fixture.strategy,
      selectedPatientId: fixture.duplicateSuggestions.length > 0 ? fixture.patientId : null,
      createPatientWhenNoMatch: fixture.duplicateSuggestions.length === 0
    };
  }

  if (step.key === "create-patient-from-lead") {
    return {
      tenantId: fixture.tenantId,
      clinicId: fixture.clinicId,
      fullName: fixture.fullName,
      phone: fixture.phone,
      email: fixture.email,
      dateOfBirth: fixture.dateOfBirth,
      gender: fixture.gender,
      source: fixture.source,
      sourceAttribution: fixture.sourceAttribution,
      leadId: byKey(scenario.leads, "googleNewPatientLead", "lead").id
    };
  }

  if (step.key === "convert-lead-to-appointment") {
    return {
      tenantId: fixture.tenantId,
      clinicId: fixture.clinicId,
      patientId: fixture.patientId,
      appointmentTypeId: fixture.appointmentTypeId,
      providerId: doctorProviderId(scenario, fixture),
      scheduledStart: fixture.scheduledStart,
      scheduledEnd: fixture.scheduledEnd,
      chair: fixture.chair,
      sourceAttribution: fixture.sourceAttribution
    };
  }

  if (step.key === "confirm-appointment") {
    return {
      confirmedAt: scenario.clock.fixedNow,
      confirmationMode: "manual",
      confirmationSource: "front_desk"
    };
  }

  if (step.key === "check-in-patient") {
    return {
      checkedInAt: "2026-07-07T11:20:00+05:30",
      queueEntryId: fixture,
      queueStatus: "waiting"
    };
  }

  throw new Error(`No request body mapping for step ${step.key}`);
}

function normalizeApiPath(path) {
  if (path.startsWith("/v1/")) return path;
  if (path.startsWith("/")) return `/v1${path}`;
  return `/v1/${path}`;
}

function stripScopeFields(body) {
  if (!body || typeof body !== "object") return body;
  const { tenantId: _tenantId, clinicId: _clinicId, ...rest } = body;
  return rest;
}

function replaceRuntimeIds(path, state) {
  return path
    .replaceAll(FIXED_FIXTURE_SERVICE_DATE, state.serviceDate ?? FIXED_FIXTURE_SERVICE_DATE)
    .replaceAll(
      "20000000-0000-4000-8000-000000003001",
      state.returningLeadId ?? "20000000-0000-4000-8000-000000003001"
    )
    .replaceAll(
      "20000000-0000-4000-8000-000000003002",
      state.googleLeadId ?? "20000000-0000-4000-8000-000000003002"
    )
    .replaceAll(
      "20000000-0000-4000-8000-000000002002",
      state.newPatientId ?? "20000000-0000-4000-8000-000000002002"
    )
    .replaceAll(
      "20000000-0000-4000-8000-000000005001",
      state.appointmentId ?? "20000000-0000-4000-8000-000000005001"
    );
}

function adaptBodyForLiveLocal(request, body, state) {
  if (body === undefined) return undefined;

  if (request.key === "capture-whatsapp-returning-lead") {
    return stripScopeFields({
      ...body,
      displayName: "Rhea Synthetic",
      primaryContact: "+919876543210",
      sourceDetail: {
        ...body.sourceDetail,
        patientName: "Rhea Synthetic",
        localFixtureAdapted: true
      }
    });
  }

  if (request.key === "capture-google-lead") {
    return stripScopeFields({
      ...body,
      displayName: state.newPatientName,
      primaryContact: state.newPatientPhone,
      sourceDetail: {
        ...body.sourceDetail,
        patientName: state.newPatientName,
        localFixtureAdapted: true,
        runId: state.runId
      }
    });
  }

  if (request.key === "match-whatsapp-returning-lead") {
    const patientId = state.returningPatientId;
    assert.ok(patientId, "Returning lead capture did not expose a patient match suggestion.");
    return { patientId };
  }

  if (request.key === "match-google-lead") {
    if (!state.googlePatientId) {
      return { skipLive: "Google lead correctly had no duplicate patient to match before create." };
    }
    return { patientId: state.googlePatientId };
  }

  if (request.key === "create-patient-from-lead") {
    return stripScopeFields({
      fullName: state.newPatientName ?? body.fullName,
      phone: state.newPatientPhone ?? body.phone,
      email: state.newPatientEmail ?? body.email,
      dateOfBirth: body.dateOfBirth,
      gender: body.gender,
      source: body.source,
      sourceDetail: { ...(body.sourceAttribution ?? {}), runId: state.runId },
      leadId: state.googleLeadId
    });
  }

  if (
    request.key === "convert-lead-to-appointment" ||
    request.key === "deny-doctor-book-appointment"
  ) {
    const scheduledStart = state.appointmentStartAt ?? body.scheduledStart;
    const scheduledEnd = state.appointmentEndAt ?? body.scheduledEnd;
    return stripScopeFields({
      patientId: state.newPatientId ?? body.patientId,
      providerUserId: LOCAL_DEV_DOCTOR_USER_ID,
      appointmentTypeId: LOCAL_DEV_APPOINTMENT_TYPE_ID,
      chairId: LOCAL_DEV_CHAIR_ID,
      startAt: scheduledStart,
      endAt: scheduledEnd,
      source: body.sourceAttribution?.source ?? "manual",
      status: "booked"
    });
  }

  return stripScopeFields(body);
}

function resolveLiveRequest(request, options, state) {
  const resolved = {
    ...request,
    path: replaceRuntimeIds(normalizeApiPath(request.path), state),
    body: clonePlain(request.body)
  };

  if (options.authMode === "fixture-headers" || options.authMode === "local-dev-subject") {
    resolved.body = adaptBodyForLiveLocal(resolved, resolved.body, state);

    if (resolved.key === "deny-cross-tenant-patient-create") {
      resolved.actorKey = "wrongTenantAssistant";
    }

    if (resolved.body?.skipLive) {
      resolved.skipLive = resolved.body.skipLive;
      resolved.body = undefined;
    }
  }

  return resolved;
}

function expectedStatusList(expectedStatus) {
  return Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
}

function headersForRequest(scenario, request, options) {
  const actor = actorForStep(scenario, request.actorKey);
  const usesLocalDevSubject =
    options.authMode === "fixture-headers" || options.authMode === "local-dev-subject";
  const requestTenantId = usesLocalDevSubject ? LOCAL_DEV_TENANT_ID : actor.tenantId;
  const requestClinicId =
    usesLocalDevSubject && actor.key !== "wrongTenantAssistant"
      ? LOCAL_DEV_CLINIC_ID
      : actor.clinicId;
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Idempotency-Key": request.idempotencyKey,
    "X-Clinic-Id": requestClinicId,
    "X-ClinicOS-Tenant-Id": requestTenantId,
    "X-ClinicOS-Clinic-Id": requestClinicId,
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

function buildNegativeRequests(scenario) {
  const patient = byKey(scenario.patients, "expectedNewPatient", "patient");
  const appointment = byKey(scenario.appointments, "newPatientAppointment", "appointment");
  const wrongTenant = byKey(scenario.tenants, "wrongTenant", "tenant");
  const wrongTenantClinic = byKey(scenario.clinics, "wrongTenantClinic", "clinic");

  return [
    {
      key: "deny-accountant-create-patient",
      actorKey: "accountant",
      method: "POST",
      path: "/v1/patients",
      idempotencyKey: "cp2-deny-accountant-create-patient",
      expectedStatus: [403],
      body: {
        tenantId: patient.tenantId,
        clinicId: patient.clinicId,
        fullName: "Denied Accountant Synthetic",
        phone: "+919900009001",
        email: "denied.accountant@example.test",
        source: "manual"
      },
      assertion: "Accountant lacks patient.write and must not create PHI-bearing patient records."
    },
    {
      key: "deny-doctor-book-appointment",
      actorKey: "doctor",
      method: "POST",
      path: "/v1/appointments",
      idempotencyKey: "cp2-deny-doctor-book-appointment",
      expectedStatus: [403],
      body: {
        tenantId: appointment.tenantId,
        clinicId: appointment.clinicId,
        patientId: appointment.patientId,
        appointmentTypeId: appointment.appointmentTypeId,
        providerId: doctorProviderId(scenario, appointment),
        scheduledStart: "2026-07-07T13:00:00+05:30",
        scheduledEnd: "2026-07-07T13:30:00+05:30",
        chair: "Chair 1"
      },
      assertion:
        "Doctor lacks schedule.write in the CP1 role model, so appointment booking must be denied."
    },
    {
      key: "deny-cross-tenant-patient-create",
      actorKey: "assistant",
      method: "POST",
      path: "/v1/patients",
      idempotencyKey: "cp2-deny-cross-tenant-patient-create",
      expectedStatus: [403, 404],
      body: {
        tenantId: wrongTenant.id,
        clinicId: wrongTenantClinic.id,
        fullName: "Wrong Tenant Synthetic",
        phone: "+919900009002",
        email: "wrong.tenant.synthetic@example.test",
        source: "manual"
      },
      assertion: "Primary-tenant assistant must be denied when targeting another tenant or clinic."
    },
    {
      key: "deny-wrong-tenant-read-primary-appointments",
      actorKey: "wrongTenantAssistant",
      method: "GET",
      path: `/v1/appointments?date=${scenario.clock.businessDate}&tenantId=${appointment.tenantId}`,
      idempotencyKey: "cp2-deny-wrong-tenant-read-primary-appointments",
      expectedStatus: [403, 404],
      body: undefined,
      assertion: "Wrong-tenant assistant must not see the primary tenant schedule."
    }
  ];
}

export function buildCp2SmokePlan(scenario) {
  validateCp2Scenario(scenario);

  const flowRequests = scenario.flow.steps.map((step) => ({
    key: step.key,
    actorKey: step.actorKey,
    method: step.method,
    path: step.path,
    idempotencyKey: step.idempotencyKey,
    expectedStatus: [step.expectedStatus],
    expectedEvents: step.expectedEvents,
    expectedAudit: step.expectedAudit,
    timelineExpectations: step.timelineExpectations,
    body: bodyForStep(scenario, step)
  }));

  return {
    flowRequests,
    negativeRequests: buildNegativeRequests(scenario),
    postFlowVerification: [
      {
        key: "read-new-patient-timeline",
        actorKey: "assistant",
        method: "GET",
        path: "/v1/patients/20000000-0000-4000-8000-000000002002/timeline",
        idempotencyKey: "cp2-read-new-patient-timeline",
        expectedStatus: [200],
        assertion:
          "Timeline must contain patient.created, attribution.touch.created, appointment.created, appointment.confirmed, patient.checked_in, and queue.entry_created."
      }
    ]
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

function assertStepResponse(step, body, state) {
  if (step.key === "match-whatsapp-returning-lead") {
    assertSerializedIncludes(body, [state.returningPatientId], step.key);
  }

  if (step.key === "create-patient-from-lead") {
    assertSerializedIncludes(body, [state.newPatientName, state.newPatientPhone], step.key);
  }

  if (step.key === "convert-lead-to-appointment") {
    assertSerializedIncludes(body, [state.newPatientId, state.googleLeadId], step.key);
  }

  if (step.key === "read-queue-after-check-in") {
    assertSerializedIncludes(body, [state.queueEntryId, state.newPatientId], step.key);
  }

  if (step.key === "read-dashboard-after-check-in") {
    assertSerializedIncludes(body, [state.newPatientId, "queue"], step.key);
  }
}

function updateRuntimeStateFromResponse(request, body, state) {
  if (request.key === "capture-whatsapp-returning-lead") {
    state.returningLeadId = body?.lead?.id;
    state.returningPatientId =
      body?.patientMatchSuggestions?.[0]?.patientId ??
      body?.patientMatchSuggestions?.[0]?.patient?.id;
  }

  if (request.key === "capture-google-lead") {
    state.googleLeadId = body?.lead?.id;
    state.googlePatientId =
      body?.patientMatchSuggestions?.[0]?.patientId ??
      body?.patientMatchSuggestions?.[0]?.patient?.id;
  }

  if (request.key === "create-patient-from-lead") {
    state.newPatientId = body?.patient?.id;
    state.googleLeadId = body?.matchedLead?.id ?? state.googleLeadId;
  }

  if (request.key === "convert-lead-to-appointment") {
    state.appointmentId = body?.appointment?.id;
  }

  if (request.key === "check-in-patient") {
    state.queueEntryId = body?.queueEntry?.id;
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

  console.log("CP2 API smoke dry run plan:");
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

    if (row.assertion) {
      console.log(`       assertion=${row.assertion}`);
    }
  }
}

async function runLiveSmoke(scenario, plan, options) {
  assert.ok(options.baseUrl, "Set --base-url or CLINICOS_CP2_API_BASE_URL for live smoke.");
  const runId = String(Date.now()).slice(-10);
  const serviceDate = new Date().toISOString().slice(0, 10);
  const slotMinuteOfDay = 8 * 60 + (Number(runId.slice(-5)) % (10 * 60));
  const appointmentStart = new Date(`${serviceDate}T00:00:00.000Z`);
  appointmentStart.setUTCMinutes(slotMinuteOfDay);
  const appointmentEnd = new Date(appointmentStart.getTime() + 30 * 60 * 1000);
  const state = {
    runId,
    serviceDate,
    appointmentStartAt: appointmentStart.toISOString(),
    appointmentEndAt: appointmentEnd.toISOString(),
    newPatientName: `Naya ${runId}`,
    newPatientPhone: `+91${runId}`,
    newPatientEmail: `naya.${runId}@example.test`
  };

  for (const request of plan.flowRequests) {
    const liveRequest = resolveLiveRequest(request, options, state);
    if (liveRequest.skipLive) {
      console.log(`pass ${request.key} (${liveRequest.skipLive})`);
      continue;
    }
    const { body } = await executeRequest(options.baseUrl, scenario, liveRequest, options);
    updateRuntimeStateFromResponse(request, body, state);
    assertStepResponse(request, body, state);
    console.log(`pass ${request.key}`);
  }

  for (const request of plan.postFlowVerification) {
    const liveRequest = resolveLiveRequest(request, options, state);
    const { body } = await executeRequest(options.baseUrl, scenario, liveRequest, options);
    assertSerializedIncludes(
      body,
      ["patient.created", "appointment.created", "patient.checked_in"],
      request.key
    );
    console.log(`pass ${request.key}`);
  }

  if (options.auditPath) {
    const auditRequest = {
      key: "read-audit-evidence",
      actorKey: "owner",
      method: "GET",
      path: options.auditPath,
      idempotencyKey: "cp2-read-audit-evidence",
      expectedStatus: [200],
      body: undefined
    };
    const { body } = await executeRequest(options.baseUrl, scenario, auditRequest, options);
    assertSerializedIncludes(
      body,
      ["patient.created", "appointment.created", "patient.checked_in"],
      auditRequest.key
    );
    console.log(`pass ${auditRequest.key}`);
  } else {
    console.log(
      "skip audit API probe; set CLINICOS_CP2_AUDIT_API_PATH after audit read endpoint is merged."
    );
  }

  for (const request of plan.negativeRequests) {
    const liveRequest = resolveLiveRequest(request, options, state);
    await executeRequest(options.baseUrl, scenario, liveRequest, options);
    console.log(`pass ${request.key}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const scenario = await loadCp2Scenario();
  const plan = buildCp2SmokePlan(scenario);

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
