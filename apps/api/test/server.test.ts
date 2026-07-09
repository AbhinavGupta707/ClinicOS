import assert from "node:assert/strict";
import test from "node:test";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import { FixedClock } from "@clinic-os/domain";
import {
  createClinicOsApiServer,
  InMemoryAuditSink,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository
} from "../src/index.ts";

const config = {
  nodeEnv: "development",
  clinicOsEnv: "local",
  isProductionLike: false,
  services: {
    databaseUrl: "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os",
    redisUrl: "redis://localhost:6379",
    temporalAddress: "localhost:7233"
  },
  auth: {
    keycloakBaseUrl: "http://localhost:8080",
    keycloakRealm: "clinic-os-local",
    keycloakClientId: "clinic-os-web"
  },
  storage: {
    region: "ap-south-1",
    bucket: "clinic-os-local"
  },
  providers: {
    whatsapp: { provider: "simulator", appSecretProofRequired: false },
    payment: { provider: "simulator", qrMode: "payment_link_qr" },
    telephony: { provider: "simulator", regionSubdomain: "api.in.exotel.com" },
    ai: { llmProvider: "simulator", transcriptionProvider: "simulator" }
  },
  pilotInputs: {
    syntheticDataOnly: true
  }
};

test("API health and local synthetic /v1/me fixture boot through HTTP", async (t) => {
  const auditSink = new InMemoryAuditSink();
  const server = createClinicOsApiServer({
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    operationsRepository: new LocalFixtureClinicOperationsRepository(),
    auditSink,
    useLocalAuthFixture: true,
    repositoryMode: "fixture"
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip(
        "Socket binding is blocked in this sandbox; run the API boot smoke outside the sandbox."
      );
      return;
    }

    throw error;
  }

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const health = await fetch(`${baseUrl}/health/ready`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, "ready");

    const me = await fetch(`${baseUrl}/v1/me`, {
      headers: {
        "x-clinic-os-dev-subject": "seed-assistant"
      }
    });

    assert.equal(me.status, 200);
    const body = await me.json();
    assert.equal(body.user.email, "assistant@demo.clinicos.local");
    assert.equal(body.clinics[0].displayName, "Synthetic Dental Clinic");
    assert.equal(body.permissions.includes("schedule.write"), true);
    assert.equal(auditSink.events.length, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
});

test("CP2 local fixture API supports lead to appointment to check-in workflow with isolation and permissions", async (t) => {
  const auditSink = new InMemoryAuditSink();
  const operationsRepository = new LocalFixtureClinicOperationsRepository({
    clock: new FixedClock("2026-07-07T10:00:00.000Z")
  });
  const server = createClinicOsApiServer({
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    operationsRepository,
    auditSink,
    useLocalAuthFixture: true,
    repositoryMode: "fixture"
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip(
        "Socket binding is blocked in this sandbox; run the API boot smoke outside the sandbox."
      );
      return;
    }

    throw error;
  }

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const patientResponse = await postJson(baseUrl, "/v1/patients", {
      fullName: "Rhea Synthetic",
      phone: "+91 98765 43210",
      source: "whatsapp",
      sourceDetail: { threadId: "synthetic-whatsapp-thread" }
    });
    assert.equal(patientResponse.status, 201);
    const patientBody = await patientResponse.json();
    assert.equal(patientBody.duplicateSuggestions.length, 1);
    assert.equal(patientBody.patient.source, "whatsapp");

    const leadResponse = await postJson(baseUrl, "/v1/leads", {
      source: "whatsapp",
      primaryContact: "+91 98765 43210",
      intent: "appointment_request",
      sourceDetail: { patientName: "Rhea Synthetic", externalRef: "wamid.synthetic" }
    });
    assert.equal(leadResponse.status, 201);
    const leadBody = await leadResponse.json();

    const matchResponse = await postJson(baseUrl, `/v1/leads/${leadBody.lead.id}/match-patient`, {
      patientId: patientBody.patient.id
    });
    assert.equal(matchResponse.status, 200);
    assert.equal((await matchResponse.json()).lead.status, "matched");

    const appointmentResponse = await postJson(
      baseUrl,
      `/v1/leads/${leadBody.lead.id}/convert-to-appointment`,
      {
        providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
        appointmentTypeId: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
        chairId: CHECKPOINT1_SEED_IDS.chairs.operatoryOne,
        startAt: "2026-07-07T09:00:00.000Z",
        durationMinutes: 30,
        reason: "Initial consultation"
      }
    );
    assert.equal(appointmentResponse.status, 201);
    const appointmentBody = await appointmentResponse.json();
    assert.equal(appointmentBody.appointment.status, "booked");
    assert.equal(appointmentBody.lead.status, "booked");

    const conflictResponse = await postJson(baseUrl, "/v1/appointments", {
      patientId: patientBody.patient.id,
      providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
      appointmentTypeId: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
      chairId: CHECKPOINT1_SEED_IDS.chairs.operatoryOne,
      startAt: "2026-07-07T09:15:00.000Z",
      durationMinutes: 30,
      source: "manual"
    });
    assert.equal(conflictResponse.status, 409);
    assert.equal((await conflictResponse.json()).error.code, "CONFLICT");

    const confirmResponse = await postJson(
      baseUrl,
      `/v1/appointments/${appointmentBody.appointment.id}/confirm`,
      {}
    );
    assert.equal(confirmResponse.status, 200);
    assert.equal((await confirmResponse.json()).appointment.status, "confirmed");

    const checkInResponse = await postJson(
      baseUrl,
      `/v1/appointments/${appointmentBody.appointment.id}/check-in`,
      {}
    );
    assert.equal(checkInResponse.status, 200);
    const checkInBody = await checkInResponse.json();
    assert.equal(checkInBody.appointment.status, "checked_in");
    assert.equal(checkInBody.queueEntry.status, "waiting");

    const dashboardResponse = await fetch(`${baseUrl}/v1/dashboard/morning?date=2026-07-07`, {
      headers: assistantHeaders()
    });
    assert.equal(dashboardResponse.status, 200);
    const dashboardBody = await dashboardResponse.json();
    assert.equal(dashboardBody.dashboard.appointmentCounts.checked_in, 1);
    assert.equal(dashboardBody.dashboard.queue.length, 1);

    const deniedResponse = await postJson(
      baseUrl,
      "/v1/appointments",
      {
        patientId: patientBody.patient.id,
        providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
        appointmentTypeId: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
        startAt: "2026-07-07T11:00:00.000Z",
        durationMinutes: 30,
        source: "manual"
      },
      { "x-clinic-os-dev-subject": "seed-accountant" }
    );
    assert.equal(deniedResponse.status, 403);
    assert.equal((await deniedResponse.json()).error.details.required_permission, "schedule.write");

    assert.equal(operationsRepository.queueEntries.length, 1);
    assert.ok(
      operationsRepository.outboxEvents.some((event) => event.eventType === "patient.checked_in")
    );
    assert.ok(auditSink.events.some((event) => event.action === "patient.checked_in"));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
});

function assistantHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    "x-clinic-os-dev-subject": "seed-assistant",
    ...extra
  };
}

function postJson(baseUrl, path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: assistantHeaders(headers),
    body: JSON.stringify(body)
  });
}
