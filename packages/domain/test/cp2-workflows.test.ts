import test from "node:test";
import assert from "node:assert/strict";
import {
  assertAppointmentTransition,
  assertLeadTransition,
  buildMorningDashboard,
  buildPatientDuplicateSuggestions,
  detectAppointmentConflicts,
  type AppointmentRecord,
  type LeadRecord,
  type PatientRecord,
  type QueueEntryRecord,
  type TaskRecord
} from "../src/index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000101";
const patientId = "10000000-0000-4000-8000-000000002001";
const providerUserId = "10000000-0000-4000-8000-000000001002";
const appointmentTypeId = "10000000-0000-4000-8000-000000003001";
const chairId = "10000000-0000-4000-8000-000000004001";

test("patient duplicate suggestions rank exact phone matches first", () => {
  const candidates: PatientRecord[] = [
    patient("10000000-0000-4000-8000-000000002001", "Rhea Synthetic", "+91 98765 43210"),
    patient("10000000-0000-4000-8000-000000002002", "Rhea Synthetic Sharma", "+91 90000 00000")
  ];

  const suggestions = buildPatientDuplicateSuggestions(
    { fullName: "Rhea Synthetic", phone: "9876543210" },
    candidates
  );

  assert.equal(suggestions.length, 2);
  assert.equal(suggestions[0].patient.id, candidates[0].id);
  assert.deepEqual(suggestions[0].reasons, ["phone_exact", "name_exact"]);
  assert.ok(suggestions[0].score > suggestions[1].score);
});

test("appointment conflict detection flags provider and chair overlaps only for active statuses", () => {
  const existing: AppointmentRecord[] = [
    appointment("10000000-0000-4000-8000-000000006001", "booked", "2026-07-07T09:00:00.000Z", "2026-07-07T09:30:00.000Z"),
    appointment("10000000-0000-4000-8000-000000006002", "cancelled", "2026-07-07T09:15:00.000Z", "2026-07-07T09:45:00.000Z")
  ];

  const conflicts = detectAppointmentConflicts(
    {
      providerUserId,
      chairId,
      startAt: "2026-07-07T09:15:00.000Z",
      endAt: "2026-07-07T09:45:00.000Z"
    },
    existing
  );

  assert.deepEqual(
    conflicts.map((conflict) => conflict.reason).sort(),
    ["chair_overlap", "provider_overlap"]
  );
});

test("workflow transitions reject illegal lead and appointment jumps", () => {
  assert.doesNotThrow(() => assertLeadTransition("new", "matched"));
  assert.throws(() => assertLeadTransition("booked", "contacted"), /cannot transition/);

  assert.doesNotThrow(() => assertAppointmentTransition("confirmed", "checked_in"));
  assert.throws(() => assertAppointmentTransition("completed", "checked_in"), /cannot transition/);
});

test("morning dashboard separates unconfirmed, queue, and new versus returning patients", () => {
  const appointments = [
    appointment("10000000-0000-4000-8000-000000006001", "booked", "2026-07-07T09:00:00.000Z", "2026-07-07T09:30:00.000Z"),
    appointment("10000000-0000-4000-8000-000000006002", "confirmed", "2026-07-07T10:00:00.000Z", "2026-07-07T10:30:00.000Z")
  ];
  const dashboard = buildMorningDashboard({
    date: "2026-07-07",
    appointments,
    leads: [lead()],
    tasks: [task()],
    queue: [queueEntry(appointments[1].id)],
    returningPatientIds: new Set([patientId])
  });

  assert.equal(dashboard.totalAppointments, 2);
  assert.equal(dashboard.appointmentCounts.booked, 1);
  assert.equal(dashboard.unconfirmedAppointments.length, 1);
  assert.equal(dashboard.queue.length, 1);
  assert.deepEqual(dashboard.returningPatientAppointmentIds, appointments.map((candidate) => candidate.id));
});

function patient(id: string, fullName: string, phone: string): PatientRecord {
  return {
    id,
    tenantId,
    clinicId,
    fullName,
    phone,
    email: null,
    dateOfBirth: null,
    gender: "unknown",
    abhaAddress: null,
    source: "manual",
    createdAt: "2026-07-06T09:00:00.000Z",
    updatedAt: "2026-07-06T09:00:00.000Z"
  };
}

function appointment(
  id: string,
  status: AppointmentRecord["status"],
  startAt: string,
  endAt: string
): AppointmentRecord {
  return {
    id,
    tenantId,
    clinicId,
    patientId,
    leadId: null,
    providerUserId,
    appointmentTypeId,
    chairId,
    status,
    startAt,
    endAt,
    source: "manual",
    reason: null,
    notes: null,
    createdAt: "2026-07-06T09:00:00.000Z",
    updatedAt: "2026-07-06T09:00:00.000Z"
  };
}

function lead(): LeadRecord {
  return {
    id: "10000000-0000-4000-8000-000000007001",
    tenantId,
    clinicId,
    patientId: null,
    primaryContact: "+919999999999",
    status: "new",
    intent: "appointment_request",
    source: "whatsapp",
    sourceDetail: {},
    firstSeenAt: "2026-07-07T08:00:00.000Z",
    lastActivityAt: "2026-07-07T08:00:00.000Z",
    createdByUserId: null
  };
}

function task(): TaskRecord {
  return {
    id: "10000000-0000-4000-8000-000000008001",
    tenantId,
    clinicId,
    patientId,
    leadId: null,
    appointmentId: null,
    invoiceId: null,
    encounterId: null,
    treatmentPlanId: null,
    procedurePerformedId: null,
    taskType: "confirmation",
    sourceWorkflow: "appointment_confirmation",
    sourceRecordType: null,
    sourceRecordId: null,
    title: "Confirm appointment",
    description: null,
    priority: "normal",
    status: "open",
    dueAt: "2026-07-07T08:30:00.000Z",
    assignedToUserId: null,
    assignedByUserId: null,
    completedByUserId: null,
    completedAt: null,
    completionEvidence: {},
    cancelledReason: null,
    idempotencyKey: null,
    createdByUserId: null,
    updatedByUserId: null,
    statusChangedAt: "2026-07-07T08:00:00.000Z",
    createdAt: "2026-07-07T08:00:00.000Z",
    updatedAt: "2026-07-07T08:00:00.000Z"
  };
}

function queueEntry(appointmentId: string): QueueEntryRecord {
  return {
    id: "10000000-0000-4000-8000-000000009001",
    tenantId,
    clinicId,
    appointmentId,
    patientId,
    providerUserId,
    status: "waiting",
    position: 1,
    checkedInAt: "2026-07-07T10:01:00.000Z",
    calledAt: null,
    completedAt: null
  };
}
