import assert from "node:assert/strict";
import test from "node:test";
import { parseNativeOperationResponse } from "@clinic-os/api-contracts";
import { FixedClock } from "@clinic-os/domain";
import { permissionsForOperation } from "../src/framework/route-registry.ts";
import type {
  ClinicFeatureExecutionContext,
  ClinicFeatureOperationRequest
} from "../src/features/contracts.ts";
import { CP13_FRONT_OFFICE_OPERATION_IDS } from "../src/features/cp13-operation-ownership.ts";
import {
  createFrontOfficeFeatureHandlerMap,
  FRONT_OFFICE_FEATURE_HANDLERS
} from "../src/features/front-office/index.ts";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CLINIC_ID = "10000000-0000-4000-8000-000000000002";
const ACTOR_ID = "10000000-0000-4000-8000-000000000003";
const PATIENT_ID = "10000000-0000-4000-8000-000000000004";
const LEAD_ID = "10000000-0000-4000-8000-000000000005";
const APPOINTMENT_ID = "10000000-0000-4000-8000-000000000006";
const QUEUE_ID = "10000000-0000-4000-8000-000000000007";
const APPOINTMENT_TYPE_ID = "10000000-0000-4000-8000-000000000030";
const CHAIR_ID = "10000000-0000-4000-8000-000000000031";

test("handler factory has exact frozen coverage for all 26 front-office operations", () => {
  assert.deepEqual(
    Object.keys(createFrontOfficeFeatureHandlerMap()).sort(),
    [...CP13_FRONT_OFFICE_OPERATION_IDS].sort()
  );
  assert.equal(Object.keys(FRONT_OFFICE_FEATURE_HANDLERS).length, 26);
});

test("central policy denies wrong-role capability sets before feature dispatch", () => {
  assert.deepEqual(permissionsForOperation("createPatient"), ["patient.write"]);
  assert.deepEqual(permissionsForOperation("checkInAppointment"), ["queue.manage"]);
  assert.deepEqual(permissionsForOperation("createIntakeFormTemplate"), ["clinic.manage"]);
  assert.deepEqual(permissionsForOperation("getPatientPrepSummary"), [
    "patient.read",
    "patient.phi.read",
    "clinical.note.read"
  ]);
});

test("patient creation fails closed before writes when duplicate candidates exist", async () => {
  const patient = patientRecord();
  const events = evidenceRecorder();
  let createCalls = 0;
  let duplicateInput: unknown;
  const context = featureContext(
    {
      patientAdministration: {
        findPatientDuplicateCandidates: async (input: unknown) => {
          duplicateInput = input;
          return [patient];
        },
        createPatient: async () => {
          createCalls += 1;
          return patient;
        },
        createAttributionTouch: async () => ({
          id: "10000000-0000-4000-8000-000000000020",
          patientId: PATIENT_ID,
          source: "manual"
        })
      }
    },
    events
  );

  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.createPatient!(
      request("createPatient", {
        body: { fullName: "Synthetic Patient", phone: "+919999990001", source: "manual" },
        headers: { "idempotency-key": "cp13-create-patient-001" }
      }),
      context
    ),
    (error: unknown) => apiError(error, 409)
  );
  assert.deepEqual(duplicateInput, { fullName: "Synthetic Patient", phone: "+919999990001" });
  assert.equal(createCalls, 0);
  assert.deepEqual(events, { audit: [], outbox: [] });
});

test("unique patient creation records patient and attribution evidence", async () => {
  const events = evidenceRecorder();
  const context = featureContext(
    {
      patientAdministration: {
        findPatientDuplicateCandidates: async () => [],
        createPatient: async () => patientRecord(),
        createAttributionTouch: async () => ({
          id: "10000000-0000-4000-8000-000000000020",
          patientId: PATIENT_ID,
          source: "manual"
        })
      }
    },
    events
  );
  const response = await FRONT_OFFICE_FEATURE_HANDLERS.createPatient!(
    request("createPatient", {
      body: { fullName: "Synthetic Patient", phone: "+919999990001", source: "manual" },
      headers: { "idempotency-key": "cp13-create-patient-unique" }
    }),
    context
  );
  assertContractResponse("createPatient", response);
  assert.equal(
    events.audit.some((event) => event.action === "attribution.touch.created"),
    true
  );
  assert.equal(
    events.outbox.every((event) => event.idempotencyKey === "cp13-create-patient-unique"),
    true
  );
});

test("lead matching refuses reassignment and wrong-tenant resources fail at scoped ports", async () => {
  let matchCalls = 0;
  const context = featureContext({
    patientAdministration: {
      findLeadById: async () =>
        leadRecord({ patientId: "10000000-0000-4000-8000-000000000099", status: "matched" }),
      findPatientById: async (patientId: string) =>
        patientId === PATIENT_ID ? patientRecord() : null,
      matchLeadToPatient: async () => {
        matchCalls += 1;
        return leadRecord();
      }
    }
  });
  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.matchLeadToPatient!(
      request("matchLeadToPatient", { path: { leadId: LEAD_ID }, body: { patientId: PATIENT_ID } }),
      context
    ),
    (error: unknown) => apiError(error, 409)
  );
  assert.equal(matchCalls, 0);

  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.getPatient!(
      request("getPatient", { path: { patientId: "10000000-0000-4000-8000-000000000098" } }),
      context
    ),
    (error: unknown) => apiError(error, 404)
  );
});

test("appointment booking validates scoped configuration, rejects conflicts and disables override", async () => {
  const events = evidenceRecorder();
  let createCalls = 0;
  let hasConflict = true;
  const appointment = appointmentRecord();
  const context = featureContext(
    {
      patientAdministration: { findPatientById: async () => patientRecord() },
      scheduling: {
        ...validSchedulingConfiguration(),
        findAppointmentConflicts: async () =>
          hasConflict ? [{ appointmentId: "conflict", reason: "provider_overlap" }] : [],
        createAppointment: async () => {
          createCalls += 1;
          return appointment;
        }
      }
    },
    events
  );
  const baseBody = {
    patientId: PATIENT_ID,
    providerUserId: ACTOR_ID,
    appointmentTypeId: APPOINTMENT_TYPE_ID,
    startAt: "2026-07-10T08:00:00.000Z"
  };
  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.createAppointment!(
      request("createAppointment", { body: baseBody }),
      context
    ),
    (error: unknown) => apiError(error, 409)
  );
  assert.equal(createCalls, 0);

  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.createAppointment!(
      request("createAppointment", { body: { ...baseBody, allowConflictOverride: true } }),
      context
    ),
    (error: unknown) => apiError(error, 409)
  );
  assert.equal(createCalls, 0);

  hasConflict = false;
  const response = await FRONT_OFFICE_FEATURE_HANDLERS.createAppointment!(
    request("createAppointment", { body: baseBody }),
    context
  );
  assert.equal(response.status, 201);
  assertContractResponse("createAppointment", response);
  assert.equal(createCalls, 1);
  assert.equal(
    events.outbox.some((event) => event.eventType === "appointment.confirmation_requested"),
    true
  );
  assert.equal(
    events.audit.some(
      (event) => (event.metadata as { conflictOverride?: boolean }).conflictOverride === false
    ),
    true
  );
});

test("appointment booking rejects inactive or foreign configuration and unavailable providers", async () => {
  const body = {
    patientId: PATIENT_ID,
    providerUserId: ACTOR_ID,
    appointmentTypeId: APPOINTMENT_TYPE_ID,
    chairId: CHAIR_ID,
    startAt: "2026-07-10T08:00:00.000Z"
  };
  const patientAdministration = { findPatientById: async () => patientRecord() };

  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.createAppointment!(
      request("createAppointment", { body }),
      featureContext({
        patientAdministration,
        scheduling: {
          ...validSchedulingConfiguration(),
          listAppointmentTypes: async () => [appointmentTypeRecord({ active: false })]
        }
      })
    ),
    (error: unknown) => apiError(error, 404)
  );
  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.createAppointment!(
      request("createAppointment", { body }),
      featureContext({
        patientAdministration,
        scheduling: {
          ...validSchedulingConfiguration(),
          listChairs: async () => [chairRecord({ active: false })]
        }
      })
    ),
    (error: unknown) => apiError(error, 404)
  );
  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.createAppointment!(
      request("createAppointment", { body }),
      featureContext({
        patientAdministration,
        scheduling: {
          ...validSchedulingConfiguration(),
          listChairs: async () => [
            chairRecord({ clinicId: "10000000-0000-4000-8000-000000000099" })
          ]
        }
      })
    ),
    (error: unknown) => apiError(error, 404)
  );
  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.createAppointment!(
      request("createAppointment", { body }),
      featureContext({
        patientAdministration,
        scheduling: {
          ...validSchedulingConfiguration(),
          listProviderSchedules: async () => [
            providerScheduleRecord({ clinicId: "10000000-0000-4000-8000-000000000099" })
          ]
        }
      })
    ),
    (error: unknown) => apiError(error, 409)
  );
  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.createAppointment!(
      request("createAppointment", { body }),
      featureContext({
        patientAdministration,
        scheduling: {
          ...validSchedulingConfiguration(),
          listProviderSchedules: async () => [providerScheduleRecord({ active: false })]
        }
      })
    ),
    (error: unknown) => apiError(error, 409)
  );
});

test("check-in creates queue and invalid terminal queue transitions are denied", async () => {
  const events = evidenceRecorder();
  let appointment = appointmentRecord({ status: "confirmed" });
  let queue = queueRecord({ status: "waiting" });
  let createQueueCalls = 0;
  const context = featureContext(
    {
      scheduling: {
        findAppointmentById: async () => appointment,
        updateAppointmentStatus: async () => {
          appointment = appointmentRecord({ status: "checked_in" });
          return appointment;
        },
        createQueueEntry: async () => {
          createQueueCalls += 1;
          return queue;
        },
        listQueueEntries: async () => [queue],
        updateQueueEntry: async () => queueRecord({ status: "waiting" })
      }
    },
    events
  );
  const checkedIn = await FRONT_OFFICE_FEATURE_HANDLERS.checkInAppointment!(
    request("checkInAppointment", { path: { appointmentId: APPOINTMENT_ID } }),
    context
  );
  assert.equal((checkedIn.body as { queueEntry: { status: string } }).queueEntry.status, "waiting");
  assertContractResponse("checkInAppointment", checkedIn);
  assert.equal(
    events.outbox.some((event) => event.eventType === "queue.entry_created"),
    true
  );
  const duplicate = await FRONT_OFFICE_FEATURE_HANDLERS.checkInAppointment!(
    request("checkInAppointment", { path: { appointmentId: APPOINTMENT_ID } }),
    context
  );
  assert.equal((duplicate.body as { queueEntry: { id: string } }).queueEntry.id, QUEUE_ID);
  assert.equal(createQueueCalls, 1);
  assert.equal(
    events.outbox.filter((event) => event.eventType === "queue.entry_created").length,
    1
  );

  queue = queueRecord({ status: "completed" });
  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.updateQueueEntry!(
      request("updateQueueEntry", {
        path: { queueEntryId: QUEUE_ID },
        body: { status: "waiting" }
      }),
      context
    ),
    (error: unknown) => apiError(error, 409)
  );
});

test("check-in rejects appointments outside the active clinic-local queue day before mutation", async () => {
  let updateCalls = 0;
  const context = featureContext({
    scheduling: {
      findAppointmentById: async () =>
        appointmentRecord({ status: "confirmed", startAt: "2026-07-12T08:00:00.000Z" }),
      updateAppointmentStatus: async () => {
        updateCalls += 1;
        return appointmentRecord({ status: "checked_in" });
      }
    }
  });
  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.checkInAppointment!(
      request("checkInAppointment", { path: { appointmentId: APPOINTMENT_ID } }),
      context
    ),
    (error: unknown) => apiError(error, 409)
  );
  assert.equal(updateCalls, 0);
});

test("patient timeline exposes attribution as its own public category", async () => {
  const context = featureContext({
    patientAdministration: {
      findPatientById: async () => patientRecord(),
      findPatientTimeline: async () => [
        {
          id: "10000000-0000-4000-8000-000000000080",
          tenantId: TENANT_ID,
          clinicId: CLINIC_ID,
          patientId: PATIENT_ID,
          itemType: "attribution_touch_created",
          sourceTable: "attribution_touches",
          sourceId: "10000000-0000-4000-8000-000000000081",
          occurredAt: "2026-07-10T08:00:00.000Z",
          title: "Attribution captured",
          summary: null,
          metadata: {}
        }
      ]
    }
  });
  const response = await FRONT_OFFICE_FEATURE_HANDLERS.getPatientTimeline!(
    request("getPatientTimeline", { path: { patientId: PATIENT_ID }, query: { limit: 10 } }),
    context
  );
  assertContractResponse("getPatientTimeline", response);
  assert.equal(
    (response.body as { timeline: Array<{ itemType: string }> }).timeline[0]?.itemType,
    "attribution"
  );
});

test("morning dashboard uses only the approved authoritative cross-domain read port", async () => {
  let requestedDate: string | undefined;
  const context = featureContext({
    clinicOperations: {
      loadDashboardData: async (date: string) => {
        requestedDate = date;
        return {
          appointments: [appointmentRecord()],
          leads: [leadRecord()],
          tasks: [
            {
              id: "10000000-0000-4000-8000-000000000050",
              rowVersion: 1,
              status: "open"
            }
          ],
          queue: [queueRecord({ status: "waiting" })],
          returningPatientIds: new Set([PATIENT_ID])
        };
      }
    }
  });
  const response = await FRONT_OFFICE_FEATURE_HANDLERS.getMorningDashboard!(
    request("getMorningDashboard"),
    context
  );
  const dashboard = (
    response.body as {
      dashboard: { openTasks: unknown[]; returningPatientAppointmentIds: string[] };
    }
  ).dashboard;
  assertContractResponse("getMorningDashboard", response);
  assert.equal(requestedDate, "2026-07-11");
  assert.equal(dashboard.openTasks.length, 1);
  assert.deepEqual(dashboard.returningPatientAppointmentIds, [APPOINTMENT_ID]);
});

test("intake rejects inactive templates and successful submission emits audit/outbox evidence", async () => {
  const events = evidenceRecorder();
  let active = false;
  const context = featureContext(
    {
      patientAdministration: { findPatientById: async () => patientRecord() },
      clinicalCare: {
        findIntakeFormTemplateById: async () => ({ id: "template", active }),
        createIntakeFormSubmission: async () => ({ id: "submission", patientId: PATIENT_ID })
      }
    },
    events
  );
  const req = request("submitPatientIntakeForm", {
    path: { patientId: PATIENT_ID },
    headers: { "idempotency-key": "cp13-intake-001" },
    body: { templateId: "10000000-0000-4000-8000-000000000040", responses: {} }
  });
  await assert.rejects(
    FRONT_OFFICE_FEATURE_HANDLERS.submitPatientIntakeForm!(req, context),
    (error: unknown) => apiError(error, 404)
  );
  active = true;
  const response = await FRONT_OFFICE_FEATURE_HANDLERS.submitPatientIntakeForm!(req, context);
  assert.equal(response.status, 201);
  assertContractResponse("submitPatientIntakeForm", response);
  assert.equal(
    events.audit.some((event) => event.action === "form_response.submitted"),
    true
  );
  assert.equal(
    events.outbox.some((event) => event.eventType === "form_response.submitted"),
    true
  );
});

function request(
  operationId: (typeof CP13_FRONT_OFFICE_OPERATION_IDS)[number],
  input: {
    path?: Record<string, unknown>;
    query?: Record<string, unknown>;
    headers?: Record<string, unknown>;
    body?: Record<string, unknown>;
  } = {}
): ClinicFeatureOperationRequest {
  return {
    operationId,
    access: {
      clinicId: CLINIC_ID,
      clinic: {
        id: CLINIC_ID,
        tenantId: TENANT_ID,
        slug: "synthetic",
        displayName: "Synthetic",
        status: "active",
        timezone: "Asia/Kolkata"
      },
      clinics: [],
      context: {
        tenant: {
          id: TENANT_ID,
          slug: "synthetic",
          legalName: "Synthetic",
          displayName: "Synthetic",
          status: "active"
        },
        user: {
          id: ACTOR_ID,
          displayName: "Synthetic User",
          email: null,
          phone: null,
          status: "active"
        },
        memberships: [],
        clinicAssignments: [],
        roleAssignments: []
      }
    },
    parsed: {
      path: input.path ?? {},
      query: input.query ?? {},
      headers: input.headers ?? {},
      ...(input.body ? { body: input.body } : {})
    },
    metadata: {
      requestId: "cp13-request-001",
      receivedAt: new Date("2026-07-10T20:00:00.000Z"),
      ipAddress: null,
      userAgent: null
    }
  } as unknown as ClinicFeatureOperationRequest;
}

function featureContext(
  overrides: Record<string, Record<string, unknown>> = {},
  evidence = evidenceRecorder()
): ClinicFeatureExecutionContext {
  const empty = {};
  return {
    clock: new FixedClock("2026-07-10T20:00:00.000Z"),
    repositories: {
      patientAdministration: overrides.patientAdministration ?? empty,
      scheduling: overrides.scheduling ?? empty,
      clinicalCare: overrides.clinicalCare ?? empty,
      clinicOperations: overrides.clinicOperations ?? empty,
      dentalTreatment: empty,
      billing: empty,
      continuity: empty,
      privacySecurity: empty,
      dataIntegrations: empty,
      aiScribe: empty,
      clinicalMedia: empty
    },
    evidence: {
      appendAuditEvent: async (event: Record<string, unknown>) => {
        evidence.audit.push(event);
      },
      appendOutboxEvent: async (event: Record<string, unknown>) => {
        evidence.outbox.push(event);
      }
    },
    requestGuards: empty
  } as unknown as ClinicFeatureExecutionContext;
}

function evidenceRecorder() {
  return { audit: [] as Record<string, unknown>[], outbox: [] as Record<string, unknown>[] };
}

function patientRecord() {
  return {
    id: PATIENT_ID,
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    rowVersion: 1,
    fullName: "Synthetic Patient",
    phone: "+919999990001",
    email: null,
    dateOfBirth: null,
    gender: "unknown",
    abhaAddress: null,
    source: "manual",
    createdAt: "2026-07-10T07:00:00.000Z",
    updatedAt: "2026-07-10T07:00:00.000Z"
  };
}

function leadRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: LEAD_ID,
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    rowVersion: 1,
    patientId: PATIENT_ID,
    primaryContact: "+919999990001",
    status: "matched",
    intent: "appointment_request",
    source: "manual",
    sourceDetail: {},
    firstSeenAt: "2026-07-10T07:00:00.000Z",
    lastActivityAt: "2026-07-10T07:00:00.000Z",
    createdByUserId: ACTOR_ID,
    ...overrides
  };
}

function appointmentRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: APPOINTMENT_ID,
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    rowVersion: 1,
    patientId: PATIENT_ID,
    leadId: LEAD_ID,
    providerUserId: ACTOR_ID,
    appointmentTypeId: APPOINTMENT_TYPE_ID,
    chairId: null,
    status: "booked",
    startAt: "2026-07-11T08:00:00.000Z",
    endAt: "2026-07-11T08:30:00.000Z",
    source: "manual",
    reason: null,
    notes: null,
    createdAt: "2026-07-10T07:00:00.000Z",
    updatedAt: "2026-07-10T07:00:00.000Z",
    ...overrides
  };
}

function appointmentTypeRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: APPOINTMENT_TYPE_ID,
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    code: "consultation",
    displayName: "Consultation",
    defaultDurationMinutes: 30,
    color: null,
    active: true,
    ...overrides
  };
}

function chairRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: CHAIR_ID,
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    code: "chair-1",
    displayName: "Chair 1",
    active: true,
    ...overrides
  };
}

function providerScheduleRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: "10000000-0000-4000-8000-000000000032",
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    providerUserId: ACTOR_ID,
    dayOfWeek: 5,
    startsAt: "09:00",
    endsAt: "17:00",
    effectiveFrom: "2026-07-01",
    effectiveUntil: null,
    active: true,
    ...overrides
  };
}

function validSchedulingConfiguration() {
  return {
    listAppointmentTypes: async () => [appointmentTypeRecord()],
    listChairs: async () => [chairRecord()],
    listProviderSchedules: async () => [providerScheduleRecord()],
    findAppointmentConflicts: async () => []
  };
}

function queueRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: QUEUE_ID,
    tenantId: TENANT_ID,
    clinicId: CLINIC_ID,
    rowVersion: 1,
    appointmentId: APPOINTMENT_ID,
    patientId: PATIENT_ID,
    providerUserId: ACTOR_ID,
    status: "waiting",
    position: 1,
    checkedInAt: "2026-07-11T08:00:00.000Z",
    calledAt: null,
    completedAt: null,
    ...overrides
  };
}

function apiError(error: unknown, status: number): boolean {
  return (
    typeof error === "object" && error !== null && "status" in error && error.status === status
  );
}

function assertContractResponse(operationId: string, response: { status: number; body: unknown }) {
  const parsed = parseNativeOperationResponse(operationId, response.status, response.body);
  assert.equal(parsed.success, true, JSON.stringify(parsed));
}
