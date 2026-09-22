import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import {
  checkInAppointment,
  confirmAppointment,
  convertLeadToAppointment,
  createAppointment,
  createLead,
  createPatient,
  getMorningDashboard,
  getPatientTimeline,
  InMemoryAuditSink,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  matchLeadToPatient
} from "../src/index.ts";

const expectedIssuer = "http://localhost:8080/realms/clinicos-local";
const acceptedAudience = "clinic-os-api";

test("CP2 services execute lead to checked-in dashboard workflow without socket fixture", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant");
  const workflowDate = new Date().toISOString().slice(0, 10);

  const patientResponse = await createPatient(assistant, dependencies, {
    fullName: "Rhea Synthetic",
    phone: "+91 98765 43210",
    source: "whatsapp"
  });
  assert.equal(patientResponse.status, 201);
  assert.equal(patientResponse.body.duplicateSuggestions.length, 1);

  const leadResponse = await createLead(assistant, dependencies, {
    source: "whatsapp",
    primaryContact: "+91 98765 43210",
    intent: "appointment_request",
    sourceDetail: { patientName: "Rhea Synthetic", externalRef: "wamid.synthetic" }
  });
  const lead = leadResponse.body.lead;
  const patient = patientResponse.body.patient;

  const matchResponse = await matchLeadToPatient(assistant, dependencies, lead.id, {
    patientId: patient.id
  });
  assert.equal(matchResponse.body.lead.status, "matched");

  const appointmentResponse = await convertLeadToAppointment(assistant, dependencies, lead.id, {
    providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
    appointmentTypeId: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
    chairId: CHECKPOINT1_SEED_IDS.chairs.operatoryOne,
    startAt: `${workflowDate}T09:00:00.000Z`,
    durationMinutes: 30,
    reason: "Initial consultation"
  });
  const appointment = appointmentResponse.body.appointment;
  assert.equal(appointment.status, "booked");

  await assert.rejects(
    () =>
      createAppointment(assistant, dependencies, {
        patientId: patient.id,
        providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
        appointmentTypeId: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
        chairId: CHECKPOINT1_SEED_IDS.chairs.operatoryOne,
        startAt: `${workflowDate}T09:15:00.000Z`,
        durationMinutes: 30,
        source: "manual"
      }),
    /conflicts/
  );

  const confirmed = await confirmAppointment(assistant, dependencies, appointment.id);
  assert.equal(confirmed.body.appointment.status, "confirmed");

  const checkedIn = await checkInAppointment(assistant, dependencies, appointment.id);
  assert.equal(checkedIn.body.appointment.status, "checked_in");
  assert.equal(checkedIn.body.queueEntry.status, "waiting");

  const dashboard = await getMorningDashboard(assistant, dependencies, workflowDate);
  assert.equal(dashboard.body.dashboard.appointmentCounts.checked_in, 1);
  assert.equal(dashboard.body.dashboard.queue.length, 1);
  assert.equal(dashboard.body.dashboard.clinicDayAppointments.length, 1);
  const clinicDayAppointment = dashboard.body.dashboard.clinicDayAppointments[0];
  assert.equal(clinicDayAppointment.id, appointment.id);
  assert.equal(clinicDayAppointment.patientId, patient.id);
  assert.equal(clinicDayAppointment.patientName, "Rhea Synthetic");
  assert.equal(clinicDayAppointment.providerName, "Dr Kabir Doctor");
  assert.equal(clinicDayAppointment.appointmentTypeName, "Consultation");
  assert.equal(clinicDayAppointment.chairName, "Operatory 1");
  assert.equal(clinicDayAppointment.queueStatus, "waiting");
  assert.ok(clinicDayAppointment.queueEntryId);
  assert.equal(dashboard.body.dashboard.dataAsOf, clinicDayAppointment.updatedAt);
  assert.ok(auditSink.events.some((event) => event.action === "patient.checked_in"));
  assert.ok(repository.outboxEvents.some((event) => event.eventType === "patient.checked_in"));

  const accountant = await operationsContext("seed-accountant");
  await assert.rejects(
    () =>
      createAppointment(accountant, dependencies, {
        patientId: patient.id,
        providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
        appointmentTypeId: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
        startAt: `${workflowDate}T11:00:00.000Z`,
        durationMinutes: 30,
        source: "manual"
      }),
    /missing_permission/
  );
});

test("morning dashboard caps a busy clinic day and reports truncation truthfully", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const dependencies = { repository, auditSink: new InMemoryAuditSink() };
  const assistant = await operationsContext("seed-assistant");
  const patient = (
    await createPatient(assistant, dependencies, {
      fullName: "Busy Day Synthetic",
      phone: "+91 98765 49999",
      source: "manual"
    })
  ).body.patient;
  const firstAppointment = (
    await createAppointment(assistant, dependencies, {
      patientId: patient.id,
      providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
      appointmentTypeId: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
      chairId: null,
      startAt: "2026-07-06T09:00:00.000Z",
      durationMinutes: 30,
      source: "manual"
    })
  ).body.appointment;
  repository.appointments.push(
    ...Array.from({ length: 500 }, (_, index) => ({
      ...firstAppointment,
      id: randomUUID() as typeof firstAppointment.id,
      reason: `Synthetic contract-bound appointment ${index + 2}`
    }))
  );

  const dashboard = await getMorningDashboard(
    assistant,
    dependencies,
    "2026-07-06"
  );

  assert.equal(dashboard.body.dashboard.appointmentsTruncated, true);
  assert.equal(dashboard.body.dashboard.todaysAppointments.length, 500);
  assert.equal(dashboard.body.dashboard.clinicDayAppointments.length, 500);
});

test("creating a patient from a source lead matches the lead before conversion", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant");

  const leadResponse = await createLead(assistant, dependencies, {
    source: "google",
    primaryContact: "+91 99000 01002",
    intent: "appointment_request",
    sourceDetail: { patientName: "Ira Synthetic", campaign: "cp2-regression" }
  });
  const lead = leadResponse.body.lead;

  const patientResponse = await createPatient(assistant, dependencies, {
    fullName: "Ira Synthetic",
    phone: "+91 99000 01002",
    email: "ira.synthetic@example.test",
    gender: "female",
    source: "google",
    sourceDetail: { campaign: "cp2-regression" },
    leadId: lead.id
  });
  assert.equal(patientResponse.status, 201);
  assert.equal(patientResponse.body.matchedLead.id, lead.id);
  assert.equal(patientResponse.body.matchedLead.patientId, patientResponse.body.patient.id);
  assert.ok(auditSink.events.some((event) => event.action === "lead.matched_to_patient"));

  const appointmentResponse = await convertLeadToAppointment(assistant, dependencies, lead.id, {
    providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
    appointmentTypeId: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
    chairId: CHECKPOINT1_SEED_IDS.chairs.operatoryOne,
    startAt: `${new Date().toISOString().slice(0, 10)}T14:00:00.000Z`,
    durationMinutes: 30,
    reason: "Lead-created patient conversion"
  });
  assert.equal(appointmentResponse.status, 201);
  assert.equal(appointmentResponse.body.appointment.patientId, patientResponse.body.patient.id);
});

test("patient timeline reads are audited with CP3-specific PHI access classification", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant");

  const timelineResponse = await getPatientTimeline(
    assistant,
    dependencies,
    CHECKPOINT1_SEED_IDS.patients.rheaSynthetic
  );

  assert.equal(timelineResponse.status, 200);
  assert.ok(timelineResponse.body.timeline.length > 0);
  assert.ok(
    auditSink.events.some(
      (event) =>
        event.action === "patient.timeline.viewed" &&
        event.patientId === CHECKPOINT1_SEED_IDS.patients.rheaSynthetic
    )
  );
});

async function operationsContext(subject) {
  const identityRepository = new LocalFixtureIdentityRepository();
  const claims = {
    ...createClaims(subject),
    exp: Math.floor(new Date("2026-07-07T08:00:00.000Z").getTime() / 1000) + 300
  };
  const principal = principalFromVerifiedKeycloakClaims(claims, {
    expectedIssuer,
    acceptedAudiences: [acceptedAudience],
    acceptedClientIds: [acceptedAudience],
    now: new Date("2026-07-07T08:00:00.000Z")
  });
  const snapshot = await identityRepository.findAccessByKeycloakSubject(subject);

  assert.ok(snapshot);

  return {
    requestId: `req_${subject}`,
    accessContext: buildAccessContext({
      principal,
      tenant: snapshot.tenant,
      user: snapshot.user,
      memberships: snapshot.memberships,
      clinicAssignments: snapshot.clinicAssignments,
      roleAssignments: snapshot.roleAssignments
    }),
    clinicId: CHECKPOINT1_SEED_IDS.clinicId,
    ipAddress: "127.0.0.1",
    userAgent: "node-test"
  };
}

function createClaims(subject) {
  return {
    sub: subject,
    iss: expectedIssuer,
    aud: acceptedAudience,
    azp: acceptedAudience,
    exp: 0,
    iat: Math.floor(new Date("2026-07-07T08:00:00.000Z").getTime() / 1000)
  };
}
