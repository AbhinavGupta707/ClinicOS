import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

const tokenEnvByActor = {
  accountant: "CLINICOS_CP10_ACCOUNTANT_TOKEN",
  assistant: "CLINICOS_CP10_ASSISTANT_TOKEN",
  doctor: "CLINICOS_CP10_DOCTOR_TOKEN",
  owner: "CLINICOS_CP10_OWNER_TOKEN",
  wrongTenantOwner: "CLINICOS_CP10_WRONG_TENANT_OWNER_TOKEN"
};

const localSubjectByActor = {
  accountant: "seed-accountant",
  assistant: "seed-assistant",
  doctor: "seed-doctor",
  owner: "seed-owner",
  wrongTenantOwner: "seed-isolation-owner"
};

export async function runCp11RuntimeSmoke(options) {
  assert.ok(options.baseUrl, "Set --base-url or CLINICOS_CP10_API_BASE_URL for live smoke.");
  const databaseUrl = process.env.DATABASE_URL ?? "";
  assert.ok(databaseUrl, "DATABASE_URL is required to verify durable audit/outbox evidence.");

  const baseUrl = new URL(options.baseUrl);
  const identities = new Map();
  const runtimeToken = randomUUID();
  const idempotencyPrefix = `cp11-${runtimeToken}`;

  const health = await requestRaw("GET", "/health/ready", { expectedStatus: 200 });
  assert.equal(health.body.status, "ready");
  assert.equal(
    health.body.repository_mode,
    "postgres",
    "E3 live smoke refuses fixture repository fallback"
  );
  assert.equal(health.body.evidence_tier, "E3_durable");

  const assistant = await identity("assistant");
  const doctor = await identity("doctor");
  const owner = await identity("owner");
  const accountant = await identity("accountant");
  const wrongTenantOwner = await identity("wrongTenantOwner");
  const clinic = activeClinic(assistant);
  assert.equal(activeClinic(doctor).id, clinic.id);
  assert.equal(activeClinic(owner).id, clinic.id);
  assert.equal(activeClinic(accountant).id, clinic.id);
  assert.notEqual(activeClinic(wrongTenantOwner).id, clinic.id);

  const appointmentTypes = await request("assistant", "GET", "/v1/appointment-types", {
    expectedStatus: 200
  });
  const chairs = await request("assistant", "GET", "/v1/chairs", { expectedStatus: 200 });
  const providerSchedules = await request(
    "assistant",
    "GET",
    `/v1/provider-schedules?providerId=${encodeURIComponent(doctor.user.id)}`,
    { expectedStatus: 200 }
  );
  const appointmentType = appointmentTypes.body.appointmentTypes.find((item) => item.active);
  const chair = chairs.body.chairs.find((item) => item.active);
  assert.ok(appointmentType, "No active runtime appointment type was returned.");
  assert.ok(chair, "No active runtime chair was returned.");
  assert.ok(
    providerSchedules.body.providerSchedules.length > 0,
    "No runtime doctor schedule was returned."
  );

  const validationFailure = await request("assistant", "POST", "/v1/patients", {
    body: { fullName: "CP11 Validation Synthetic", source: "manual" },
    expectedStatus: 400
  });
  assert.equal(validationFailure.body.error.code, "VALIDATION_ERROR");

  const phoneSuffix = String(
    Number.parseInt(runtimeToken.replaceAll("-", "").slice(0, 9), 16) % 1_000_000_000
  ).padStart(9, "0");
  const patient = await request("assistant", "POST", "/v1/patients", {
    body: {
      fullName: `CP11 Runtime Synthetic ${runtimeToken.slice(0, 8)}`,
      phone: `+919${phoneSuffix}`,
      source: "manual",
      sourceDetail: { evidence: "cp11_runtime_id_smoke" }
    },
    expectedStatus: 201,
    idempotencyKey: `${idempotencyPrefix}-patient`
  });
  const patientId = patient.body.patient.id;
  assert.match(patientId, /^[0-9a-f-]{36}$/iu);

  const lead = await request("assistant", "POST", "/v1/leads", {
    body: {
      source: "manual",
      primaryContact: `+919${phoneSuffix}`,
      intent: "appointment_request",
      sourceDetail: { evidence: "cp11_runtime_id_smoke" }
    },
    expectedStatus: 201,
    idempotencyKey: `${idempotencyPrefix}-lead`
  });
  const leadId = lead.body.lead.id;
  await request("assistant", "POST", `/v1/leads/${leadId}/match-patient`, {
    body: { patientId },
    expectedStatus: 200,
    idempotencyKey: `${idempotencyPrefix}-lead-match`
  });

  const clinicDate = clinicLocalDate(new Date(), clinic.timezone);
  const existingAppointments = await request(
    "assistant",
    "GET",
    `/v1/appointments?date=${encodeURIComponent(clinicDate)}`,
    { expectedStatus: 200 }
  );
  const bookedStartTimes = new Set(
    existingAppointments.body.appointments.map((candidate) => candidate.startAt)
  );
  const startAt = Array.from({ length: 24 }, (_, index) => {
    const totalMinutes = 8 * 60 + index * 30;
    const hour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
    const minute = String(totalMinutes % 60).padStart(2, "0");
    return `${clinicDate}T${hour}:${minute}:00.000Z`;
  }).find((candidate) => !bookedStartTimes.has(candidate));
  assert.ok(startAt, "No free synthetic appointment slot remained for the clinic-local day.");
  const appointment = await request(
    "assistant",
    "POST",
    `/v1/leads/${leadId}/convert-to-appointment`,
    {
      body: {
        providerUserId: doctor.user.id,
        appointmentTypeId: appointmentType.id,
        chairId: chair.id,
        startAt,
        durationMinutes: 30,
        reason: "CP11 runtime synthetic consultation"
      },
      expectedStatus: 201,
      idempotencyKey: `${idempotencyPrefix}-appointment`
    }
  );
  const appointmentId = appointment.body.appointment.id;

  const deniedRole = await request("accountant", "POST", "/v1/appointments", {
    body: {
      patientId,
      providerUserId: doctor.user.id,
      appointmentTypeId: appointmentType.id,
      chairId: chair.id,
      startAt: `${clinicDate}T11:00:00.000Z`,
      durationMinutes: 30,
      source: "manual"
    },
    expectedStatus: 403
  });
  assert.equal(deniedRole.body.error.details.required_permission, "schedule.write");

  await request("assistant", "POST", `/v1/appointments/${appointmentId}/confirm`, {
    body: {},
    expectedStatus: 200,
    idempotencyKey: `${idempotencyPrefix}-confirm`
  });
  const checkIn = await request("assistant", "POST", `/v1/appointments/${appointmentId}/check-in`, {
    body: {},
    expectedStatus: 200,
    idempotencyKey: `${idempotencyPrefix}-check-in`
  });
  assert.equal(checkIn.body.queueEntry.status, "waiting");
  const duplicateCheckIn = await request(
    "assistant",
    "POST",
    `/v1/appointments/${appointmentId}/check-in`,
    {
      body: {},
      expectedStatus: 200,
      idempotencyKey: `${idempotencyPrefix}-check-in`
    }
  );
  assert.equal(duplicateCheckIn.body.queueEntry.id, checkIn.body.queueEntry.id);

  const dayQueue = await request(
    "assistant",
    "GET",
    `/v1/dashboard/morning?date=${encodeURIComponent(clinicDate)}`,
    { expectedStatus: 200 }
  );
  assert.ok(dayQueue.body.dashboard.queue.some((entry) => entry.patientId === patientId));

  const consent = await request("assistant", "POST", `/v1/patients/${patientId}/consents`, {
    body: {
      purpose: "ai_audio_capture",
      templateCode: "ai-audio-v1",
      templateVersion: 1,
      captureMethod: "clinic_staff",
      grantedByName: "CP11 Runtime Synthetic",
      relationshipToPatient: "self",
      provenance: { kind: "manual_entry", evidence: "cp11_runtime_id_smoke" }
    },
    expectedStatus: 201,
    idempotencyKey: `${idempotencyPrefix}-consent`
  });
  assert.equal(consent.body.enforcementState.aiAudioCaptureAllowed, true);

  const encounter = await request("assistant", "POST", "/v1/encounters", {
    body: {
      patientId,
      appointmentId,
      providerUserId: doctor.user.id,
      reason: "CP11 runtime synthetic consultation"
    },
    expectedStatus: 201,
    idempotencyKey: `${idempotencyPrefix}-encounter`
  });
  const encounterId = encounter.body.encounter.id;
  await request("assistant", "POST", `/v1/encounters/${encounterId}/start`, {
    body: {},
    expectedStatus: 200,
    idempotencyKey: `${idempotencyPrefix}-encounter-start`
  });
  await request("assistant", "PATCH", `/v1/encounters/${encounterId}`, {
    body: {
      content: {
        chiefComplaint: "Synthetic verification only",
        examination: "No real clinical data",
        diagnosis: "Synthetic test record",
        treatmentPlan: "No treatment; verification evidence"
      },
      readyForSign: true
    },
    expectedStatus: 200,
    idempotencyKey: `${idempotencyPrefix}-draft`
  });
  const deniedSign = await request("assistant", "POST", `/v1/encounters/${encounterId}/sign-note`, {
    body: {},
    expectedStatus: 403,
    idempotencyKey: `${idempotencyPrefix}-sign-denied`
  });
  assert.equal(deniedSign.body.error.details.required_permission, "clinical.note.sign");
  const signed = await request("doctor", "POST", `/v1/encounters/${encounterId}/sign-note`, {
    body: {},
    expectedStatus: 200,
    idempotencyKey: `${idempotencyPrefix}-sign`
  });
  assert.equal(signed.body.note.status, "signed");

  const audit = await request(
    "owner",
    "GET",
    `/v1/audit-events?patientId=${encodeURIComponent(patientId)}&limit=100`,
    { expectedStatus: 200 }
  );
  assert.ok(audit.body.auditEvents.some((event) => event.action === "patient.checked_in"));
  assert.ok(audit.body.auditEvents.some((event) => event.action === "clinical_note.signed"));

  const readiness = await request("owner", "GET", "/v1/pilot-readiness", {
    expectedStatus: 200
  });
  assert.equal(readiness.body.readiness.pilotGoLiveStatus, "blocked");

  const tenantDenied = await request(
    "wrongTenantOwner",
    "GET",
    `/v1/patients/${encodeURIComponent(patientId)}`,
    { expectedStatus: 404 }
  );
  assert.equal(tenantDenied.body.error.code, "NOT_FOUND");

  const outboxEvents = await readOutboxEvidence(databaseUrl, {
    tenantId: assistant.tenant.id,
    clinicId: clinic.id,
    actorUserId: assistant.user.id,
    patientId
  });
  assert.ok(outboxEvents.includes("patient.checked_in"));
  assert.ok(outboxEvents.includes("clinical_note.signed"));

  return {
    runtimeIds: {
      tenantId: assistant.tenant.id,
      clinicId: clinic.id,
      patientId,
      leadId,
      appointmentId,
      encounterId
    },
    assertions: {
      durableRepositoryNoFixtureFallback: "pass",
      runtimeIdentityDiscovery: "pass",
      leadPatientAppointmentQueue: "pass",
      consentEncounterSignedNote: "pass",
      roleDenial: "pass",
      duplicateSubmissionIdempotent: "pass",
      auditAndOutbox: "pass",
      ownerReadinessBlocked: "pass",
      crossTenantDenial: "pass"
    }
  };

  async function identity(actorKey) {
    if (identities.has(actorKey)) return identities.get(actorKey);
    const response = await requestRaw("GET", "/v1/me", {
      actorKey,
      expectedStatus: 200,
      includeClinic: false
    });
    identities.set(actorKey, response.body);
    return response.body;
  }

  async function request(actorKey, method, path, requestOptions) {
    await identity(actorKey);
    return requestRaw(method, path, { ...requestOptions, actorKey, includeClinic: true });
  }

  async function requestRaw(method, path, requestOptions) {
    const headers = {
      accept: "application/json",
      ...authHeaders(requestOptions.actorKey, options.authMode)
    };
    if (requestOptions.body !== undefined) headers["content-type"] = "application/json";
    if (requestOptions.idempotencyKey) headers["idempotency-key"] = requestOptions.idempotencyKey;
    if (requestOptions.includeClinic) {
      headers["x-clinic-id"] = activeClinic(identities.get(requestOptions.actorKey)).id;
    }
    const response = await fetch(new URL(path, baseUrl), {
      method,
      headers,
      body: requestOptions.body === undefined ? undefined : JSON.stringify(requestOptions.body)
    });
    const body = await parseResponseBody(response);
    assert.equal(
      response.status,
      requestOptions.expectedStatus,
      `${method} ${path} expected ${requestOptions.expectedStatus}, got ${response.status}: ${JSON.stringify(body)}`
    );
    return { response, body };
  }
}

function activeClinic(identity) {
  const clinic = identity.clinics[0];
  assert.ok(clinic, "Runtime identity has no active clinic.");
  return clinic;
}

function authHeaders(actorKey, authMode) {
  if (authMode === "fixture-headers" || authMode === "local-dev-subject") {
    const subject = localSubjectByActor[actorKey ?? "assistant"];
    assert.ok(subject, `No local subject is registered for ${actorKey}.`);
    return { "x-clinic-os-dev-subject": subject };
  }
  const tokenEnvironmentVariable = tokenEnvByActor[actorKey ?? "assistant"];
  const token = tokenEnvironmentVariable ? process.env[tokenEnvironmentVariable] : "";
  assert.ok(token, `Missing ${tokenEnvironmentVariable} for ${actorKey}.`);
  return { authorization: `Bearer ${token}` };
}

function clinicLocalDate(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((candidate) => candidate.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addClinicDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

async function readOutboxEvidence(databaseUrl, scope) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [scope.tenantId]);
    await client.query("select set_config('app.clinic_id', $1, true)", [scope.clinicId]);
    await client.query("select set_config('app.user_id', $1, true)", [scope.actorUserId]);
    const result = await client.query(
      "select event_type from outbox_events where patient_id = $1 order by occurred_at",
      [scope.patientId]
    );
    return result.rows.map((row) => row.event_type);
  } finally {
    await client.query("rollback");
    client.release();
    await pool.end();
  }
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
