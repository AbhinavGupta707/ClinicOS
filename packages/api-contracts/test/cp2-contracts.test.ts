import test from "node:test";
import assert from "node:assert/strict";
import {
  CP2_EVENT_TYPES,
  CP2_OPENAPI_ENDPOINT_NOTES,
  createCp2EventEnvelope,
  isAllowedAppointmentStatusTransition,
  isAllowedLeadStatusTransition,
  parseAppointmentCreateRequest,
  parseCp2EventEnvelope,
  parseLeadCreateRequest,
  parseLeadStatusUpdateRequest,
  parsePatientCreateRequest
} from "../src/index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000002";
const userId = "10000000-0000-4000-8000-000000000003";
const patientId = "10000000-0000-4000-8000-000000000004";
const providerUserId = "10000000-0000-4000-8000-000000000005";
const appointmentTypeId = "10000000-0000-4000-8000-000000000006";
const appointmentId = "10000000-0000-4000-8000-000000000007";
const leadId = "10000000-0000-4000-8000-000000000008";
const eventId = "10000000-0000-4000-8000-000000000009";

function context() {
  return {
    tenantId,
    clinicId,
    actor: { type: "user", id: userId },
    correlationId: "corr-cp2-contract-test",
    idempotencyKey: "idem-cp2-contract-test"
  };
}

test("patient create requires tenant, clinic, actor, idempotency, and source provenance", () => {
  const valid = parsePatientCreateRequest({
    ...context(),
    patient: {
      fullName: "Rhea Synthetic",
      phone: "+919876543210",
      gender: "female",
      source: "whatsapp",
      provenance: {
        kind: "patient_message",
        providerKey: "whatsapp_bsp",
        externalRef: "wamid.synthetic",
        receivedAt: "2026-07-07T04:00:00.000Z"
      }
    }
  });

  assert.equal(valid.success, true);

  const invalid = parsePatientCreateRequest({
    ...context(),
    unexpected: true,
    patient: {
      fullName: "Rhea Synthetic",
      phone: "9876543210",
      gender: "female",
      source: "whatsapp"
    }
  });

  assert.equal(invalid.success, false);
  assert.match(JSON.stringify(invalid), /Unknown field/);
  assert.match(JSON.stringify(invalid), /provenance/);
  assert.match(JSON.stringify(invalid), /E\.164/);
});

test("lead create stores operational source attribution and rejects over-broad payloads", () => {
  const valid = parseLeadCreateRequest({
    ...context(),
    lead: {
      primaryContact: "+919876543210",
      contactName: "Rhea Synthetic",
      intent: "appointment_request",
      source: "practo",
      provenance: {
        kind: "external_system",
        providerKey: "practo",
        externalRef: "booking-123",
        rawEventId: "raw-123",
        receivedAt: "2026-07-07T04:05:00.000Z"
      },
      sourceDetail: {
        externalRef: "booking-123",
        doctorName: "Dr Synthetic"
      },
      receivedAt: "2026-07-07T04:05:00.000Z"
    }
  });

  assert.equal(valid.success, true);

  const invalid = parseLeadCreateRequest({
    ...context(),
    lead: {
      primaryContact: "+919876543210",
      intent: "appointment_request",
      source: "practo",
      provenance: {
        kind: "external_system",
        externalRef: "booking-123"
      },
      sourceDetail: {
        rawClinicalComplaint: "tooth pain"
      },
      receivedAt: "2026-07-07T04:05:00.000Z"
    }
  });

  assert.equal(invalid.success, false);
  assert.match(JSON.stringify(invalid), /providerKey/);
  assert.match(JSON.stringify(invalid), /Unknown field/);
});

test("lead status transitions are constrained", () => {
  assert.equal(isAllowedLeadStatusTransition("new", "matched"), true);
  assert.equal(isAllowedLeadStatusTransition("matched", "converted"), true);
  assert.equal(isAllowedLeadStatusTransition("new", "converted"), false);

  const invalid = parseLeadStatusUpdateRequest({
    ...context(),
    leadId,
    fromStatus: "new",
    toStatus: "converted",
    reason: "skipping match"
  });

  assert.equal(invalid.success, false);
  assert.match(JSON.stringify(invalid), /Cannot transition/);
});

test("appointment create requires idempotency, provenance, chronological times, and override reasons", () => {
  const valid = parseAppointmentCreateRequest({
    ...context(),
    appointment: {
      patientId,
      providerUserId,
      appointmentTypeId,
      startAt: "2026-07-07T05:00:00.000Z",
      endAt: "2026-07-07T05:30:00.000Z",
      status: "booked",
      source: "whatsapp",
      provenance: {
        kind: "patient_message",
        providerKey: "whatsapp_bsp",
        externalRef: "wamid.synthetic"
      },
      conflictPolicy: "reject"
    }
  });

  assert.equal(valid.success, true);

  const invalid = parseAppointmentCreateRequest({
    tenantId,
    clinicId,
    actor: { type: "user", id: userId },
    correlationId: "corr-without-idem",
    appointment: {
      patientId,
      providerUserId,
      appointmentTypeId,
      startAt: "2026-07-07T05:30:00.000Z",
      endAt: "2026-07-07T05:00:00.000Z",
      status: "booked",
      source: "manual",
      provenance: {
        kind: "manual_entry"
      },
      conflictPolicy: "allow_with_permission"
    }
  });

  assert.equal(invalid.success, false);
  assert.match(JSON.stringify(invalid), /idempotencyKey/);
  assert.match(JSON.stringify(invalid), /endAt must be after startAt/);
  assert.match(JSON.stringify(invalid), /Override reason/);
});

test("appointment status transitions cover confirmation, check-in, and no-show", () => {
  assert.equal(isAllowedAppointmentStatusTransition("booked", "confirmed"), true);
  assert.equal(isAllowedAppointmentStatusTransition("confirmed", "checked_in"), true);
  assert.equal(isAllowedAppointmentStatusTransition("confirmed", "no_show"), true);
  assert.equal(isAllowedAppointmentStatusTransition("completed", "no_show"), false);
});

test("CP2 event envelope requires canonical event type and provenance", () => {
  assert.ok(CP2_EVENT_TYPES.includes("lead.created"));
  assert.ok(CP2_EVENT_TYPES.includes("appointment.confirmation_requested"));
  assert.ok(CP2_EVENT_TYPES.includes("task.due"));

  const envelope = createCp2EventEnvelope({
    eventId,
    eventType: "appointment.created",
    tenantId,
    clinicId,
    actor: { type: "user", id: userId },
    correlationId: "corr-event",
    source: { kind: "patient_message", providerKey: "whatsapp_bsp", externalRef: "wamid.synthetic" },
    aggregate: { type: "appointment", id: appointmentId },
    patientId,
    payload: {
      appointmentId,
      patientId
    }
  });

  const parsed = parseCp2EventEnvelope(envelope);
  assert.equal(parsed.success, true);

  const invalid = parseCp2EventEnvelope({
    ...envelope,
    eventType: "appointment.maybe",
    source: undefined
  });

  assert.equal(invalid.success, false);
  assert.match(JSON.stringify(invalid), /canonical Checkpoint 2 event type/);
  assert.match(JSON.stringify(invalid), /source/);
});

test("OpenAPI notes enumerate the backend and frontend CP2 integration surface", () => {
  const operationIds = CP2_OPENAPI_ENDPOINT_NOTES.map((endpoint) => endpoint.operationId);

  assert.ok(operationIds.includes("createPatient"));
  assert.ok(operationIds.includes("createLead"));
  assert.ok(operationIds.includes("convertLeadToAppointment"));
  assert.ok(operationIds.includes("createAppointment"));
  assert.ok(operationIds.includes("confirmAppointment"));
  assert.ok(operationIds.includes("checkInAppointment"));
  assert.ok(operationIds.includes("markAppointmentNoShow"));
  assert.ok(operationIds.includes("listQueue"));
  assert.ok(operationIds.includes("getAssistantMorningDashboard"));
  assert.equal(
    CP2_OPENAPI_ENDPOINT_NOTES.filter((endpoint) => endpoint.requiresIdempotencyKey).length > 0,
    true
  );
});
