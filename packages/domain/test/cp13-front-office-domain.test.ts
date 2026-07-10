import assert from "node:assert/strict";
import test from "node:test";
import { FixedClock } from "../src/time.ts";
import {
  appointmentClinicLocalDate,
  assertFrontOfficeQueueTransition,
  buildFrontOfficePrepSummary,
  providerScheduleCoversAppointment,
  resolveAppointmentWindow,
  resolveClinicDay
} from "../src/cp13/front-office/index.ts";

test("front-office appointment windows reject reversed intervals", () => {
  assert.deepEqual(
    resolveAppointmentWindow({ startAt: "2026-07-10T08:00:00.000Z", durationMinutes: 45 }),
    { startAt: "2026-07-10T08:00:00.000Z", endAt: "2026-07-10T08:45:00.000Z" }
  );
  assert.throws(
    () =>
      resolveAppointmentWindow({
        startAt: "2026-07-10T08:00:00.000Z",
        endAt: "2026-07-10T07:59:00.000Z"
      }),
    /later than startAt/
  );
});

test("clinic day is derived in the clinic timezone instead of slicing UTC", () => {
  const clock = new FixedClock("2026-07-10T20:00:00.000Z");
  assert.equal(resolveClinicDay({ clock, clinicTimeZone: "Asia/Kolkata" }), "2026-07-11");
  assert.equal(
    resolveClinicDay({ requestedDate: "2026-07-15", clock, clinicTimeZone: "Asia/Kolkata" }),
    "2026-07-15"
  );
});

test("provider schedule coverage uses the clinic-local date, weekday and working window", () => {
  const schedule = {
    id: "10000000-0000-4000-8000-000000000001",
    tenantId: "10000000-0000-4000-8000-000000000002",
    clinicId: "10000000-0000-4000-8000-000000000003",
    providerUserId: "10000000-0000-4000-8000-000000000004",
    dayOfWeek: 5,
    startsAt: "09:00:00",
    endsAt: "17:00:00",
    effectiveFrom: "2026-07-01",
    effectiveUntil: null,
    active: true
  };
  assert.equal(
    appointmentClinicLocalDate("2026-07-10T08:00:00.000Z", "Asia/Kolkata"),
    "2026-07-10"
  );
  assert.equal(
    providerScheduleCoversAppointment(schedule, {
      startAt: "2026-07-10T08:00:00.000Z",
      endAt: "2026-07-10T08:30:00.000Z",
      clinicTimeZone: "Asia/Kolkata"
    }),
    true
  );
  assert.equal(
    providerScheduleCoversAppointment(schedule, {
      startAt: "2026-07-10T12:00:00.000Z",
      endAt: "2026-07-10T12:30:00.000Z",
      clinicTimeZone: "Asia/Kolkata"
    }),
    false
  );
});

test("queue transitions fail closed after terminal completion", () => {
  assert.doesNotThrow(() => assertFrontOfficeQueueTransition("waiting", "called"));
  assert.throws(
    () => assertFrontOfficeQueueTransition("completed", "waiting"),
    /cannot transition/
  );
});

test("prep summary selects the latest durable intake and clinical-only history", () => {
  const patient = {
    id: "10000000-0000-4000-8000-000000000001",
    tenantId: "10000000-0000-4000-8000-000000000002",
    clinicId: "10000000-0000-4000-8000-000000000003",
    rowVersion: 1,
    fullName: "Synthetic Patient",
    phone: "+919999990001",
    email: null,
    dateOfBirth: null,
    gender: "unknown" as const,
    abhaAddress: null,
    source: "manual" as const,
    createdAt: "2026-07-10T07:00:00.000Z",
    updatedAt: "2026-07-10T07:00:00.000Z"
  };
  const submission = (id: string, submittedAt: string, snapshot: Record<string, unknown>) => ({
    id,
    tenantId: patient.tenantId,
    clinicId: patient.clinicId,
    patientId: patient.id,
    templateId: "10000000-0000-4000-8000-000000000004",
    templateVersion: 1,
    source: "digital" as const,
    responses: {},
    medicalHistorySnapshot: snapshot,
    provenance: {},
    submittedByUserId: "10000000-0000-4000-8000-000000000005",
    submittedAt
  });
  const timeline = [
    {
      id: "10000000-0000-4000-8000-000000000006",
      tenantId: patient.tenantId,
      clinicId: patient.clinicId,
      patientId: patient.id,
      itemType: "appointment_created" as const,
      sourceTable: "appointments",
      sourceId: "10000000-0000-4000-8000-000000000007",
      occurredAt: "2026-07-10T08:00:00.000Z",
      title: "Appointment",
      summary: null,
      metadata: {}
    },
    {
      id: "10000000-0000-4000-8000-000000000008",
      tenantId: patient.tenantId,
      clinicId: patient.clinicId,
      patientId: patient.id,
      itemType: "clinical_note_signed" as const,
      sourceTable: "clinical_note_versions",
      sourceId: "10000000-0000-4000-8000-000000000009",
      occurredAt: "2026-07-10T09:00:00.000Z",
      title: "Signed note",
      summary: null,
      metadata: {}
    }
  ];
  const summary = buildFrontOfficePrepSummary({
    patient,
    appointment: null,
    generatedAt: "2026-07-10T10:00:00.000Z",
    intakeSubmissions: [
      submission("10000000-0000-4000-8000-000000000010", "2026-07-10T08:00:00.000Z", {}),
      submission("10000000-0000-4000-8000-000000000011", "2026-07-10T09:00:00.000Z", {
        allergy: "reviewed"
      })
    ],
    consents: [],
    consentEnforcementState: {
      patientId: patient.id,
      evaluatedAt: "2026-07-10T10:00:00.000Z",
      activePurposes: [],
      revokedPurposes: [],
      treatmentAllowed: false,
      whatsappCommunicationAllowed: false,
      marketingRecallAllowed: false,
      aiAudioCaptureAllowed: false,
      rawAudioRetentionAllowed: false,
      photoCaptureAllowed: false,
      photoSharingAllowed: false,
      abdmAbhaAllowed: false
    },
    timeline
  });

  assert.equal(summary.latestIntakeResponse?.id, "10000000-0000-4000-8000-000000000011");
  assert.equal(summary.medicalHistoryChangePromptRequired, false);
  assert.deepEqual(
    summary.priorClinicalTimeline.map((item) => item.itemType),
    ["clinical_note_signed"]
  );
  assert.deepEqual(summary.dataCoverage, {
    appointment: "available",
    consent: "available",
    intake: "available",
    timeline: "available"
  });
});
