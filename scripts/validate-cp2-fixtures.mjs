#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const CP2_SCENARIO_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp2",
  "lead_patient_appointment_flow.json"
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_EMAIL_PATTERN = /^[^@\s]+@example\.test$/;
const TEST_PHONE_PATTERN = /^\+91990000\d{4}$/;
const REQUIRED_EVENTS = [
  "external.lead.received",
  "external.lead.matched",
  "patient.created",
  "attribution.touch.created",
  "appointment.created",
  "lead.converted_to_appointment",
  "appointment.confirmed",
  "patient.checked_in",
  "queue.entry_created"
];
const REQUIRED_STEPS = [
  "capture-whatsapp-returning-lead",
  "match-whatsapp-returning-lead",
  "capture-google-lead",
  "match-google-lead",
  "create-patient-from-lead",
  "convert-lead-to-appointment",
  "confirm-appointment",
  "check-in-patient",
  "read-queue-after-check-in",
  "read-dashboard-after-check-in"
];

function assertUuid(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string UUID`);
  assert.match(value, UUID_PATTERN, `${label} must be a deterministic v4-style UUID`);
}

function assertKnownReference(ids, value, label) {
  assertUuid(value, label);
  assert.ok(ids.has(value), `${label} references unknown id ${value}`);
}

function assertIsoWithOffset(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(
    value,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    `${label} must include a timezone offset`
  );
}

function assertUniqueEntityId(ids, value, label) {
  assertUuid(value, label);
  assert.ok(!ids.has(value), `${label} duplicates entity id ${value}`);
  ids.add(value);
}

function flattenEventNames(scenario) {
  const names = new Set();

  for (const lead of scenario.leads) {
    for (const eventName of lead.expectedEvents ?? []) names.add(eventName);
  }

  for (const step of scenario.flow.steps) {
    for (const eventName of step.expectedEvents ?? []) names.add(eventName);
  }

  return names;
}

function flattenTimelineEntries(scenario) {
  const entries = new Set();

  for (const patient of scenario.patients) {
    for (const entry of patient.timelineSeed ?? []) entries.add(entry.type);
  }

  for (const step of scenario.flow.steps) {
    for (const expectation of step.timelineExpectations ?? []) entries.add(expectation.entryType);
  }

  return entries;
}

function assertLocalSyntheticOnly(scenario) {
  assert.equal(scenario.fixtureUse.localOnly, true, "fixture must be marked local-only");
  assert.equal(scenario.fixtureUse.syntheticOnly, true, "fixture must be marked synthetic-only");
  assert.equal(
    scenario.fixtureUse.productionUseDenied,
    true,
    "fixture must explicitly deny production use"
  );
  assert.deepEqual(
    scenario.fixtureUse.allowedEnvironments,
    ["local", "development", "test", "ci"],
    "fixture environments must be constrained to local/dev/test/ci"
  );

  const serialized = JSON.stringify(scenario);
  const forbiddenPatterns = [
    /@gmail\.com/i,
    /@yahoo\./i,
    /@hotmail\./i,
    /razorpay_live/i,
    /sk_live/i,
    /whatsapp_access_token/i,
    /abha[_-]?(address|number)/i
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(
      pattern.test(serialized),
      false,
      `fixture contains forbidden live-data pattern ${pattern}`
    );
  }
}

export async function loadCp2Scenario(scenarioPath = CP2_SCENARIO_PATH) {
  const raw = await readFile(scenarioPath, "utf8");
  return JSON.parse(raw);
}

export function validateCp2Scenario(scenario) {
  assert.equal(scenario.schemaVersion, "clinic-os.cp2.qa-fixture.v1");
  assertLocalSyntheticOnly(scenario);

  assert.equal(scenario.clock.businessDate, "2026-07-07");
  assert.equal(scenario.clock.timezone, "Asia/Kolkata");
  assertIsoWithOffset(scenario.clock.fixedNow, "clock.fixedNow");

  const entityIds = new Set();
  const knownTenantIds = new Set();
  const knownClinicIds = new Set();
  const knownActorIds = new Set();
  const knownPatientIds = new Set();
  const knownLeadIds = new Set();
  const knownAppointmentTypeIds = new Set();
  const knownAppointmentIds = new Set();

  for (const tenant of scenario.tenants) {
    assertUniqueEntityId(entityIds, tenant.id, `tenant ${tenant.key}.id`);
    knownTenantIds.add(tenant.id);
  }

  for (const clinic of scenario.clinics) {
    assertUniqueEntityId(entityIds, clinic.id, `clinic ${clinic.key}.id`);
    assertKnownReference(knownTenantIds, clinic.tenantId, `clinic ${clinic.key}.tenantId`);
    knownClinicIds.add(clinic.id);
  }

  for (const actor of scenario.actors) {
    assertUniqueEntityId(entityIds, actor.id, `actor ${actor.key}.id`);
    assert.match(
      actor.email,
      TEST_EMAIL_PATTERN,
      `actor ${actor.key}.email must use .example.test`
    );
    assertKnownReference(knownTenantIds, actor.tenantId, `actor ${actor.key}.tenantId`);
    assertKnownReference(knownClinicIds, actor.clinicId, `actor ${actor.key}.clinicId`);
    knownActorIds.add(actor.id);
  }

  for (const patient of scenario.patients) {
    assertUniqueEntityId(entityIds, patient.id, `patient ${patient.key}.id`);
    assert.match(
      patient.email,
      TEST_EMAIL_PATTERN,
      `patient ${patient.key}.email must use .example.test`
    );
    assert.match(
      patient.phone,
      TEST_PHONE_PATTERN,
      `patient ${patient.key}.phone must use reserved fixture range`
    );
    assertKnownReference(knownTenantIds, patient.tenantId, `patient ${patient.key}.tenantId`);
    assertKnownReference(knownClinicIds, patient.clinicId, `patient ${patient.key}.clinicId`);
    knownPatientIds.add(patient.id);

    for (const entry of patient.timelineSeed ?? []) {
      assertIsoWithOffset(entry.occurredAt, `patient ${patient.key}.timelineSeed.occurredAt`);
    }
  }

  for (const lead of scenario.leads) {
    assertUniqueEntityId(entityIds, lead.id, `lead ${lead.key}.id`);
    assert.match(
      lead.primaryContact,
      TEST_PHONE_PATTERN,
      `lead ${lead.key}.primaryContact must use reserved fixture range`
    );
    assertKnownReference(knownTenantIds, lead.tenantId, `lead ${lead.key}.tenantId`);
    assertKnownReference(knownClinicIds, lead.clinicId, `lead ${lead.key}.clinicId`);
    assertIsoWithOffset(lead.receivedAt, `lead ${lead.key}.receivedAt`);
    assert.ok(Array.isArray(lead.expectedEvents), `lead ${lead.key} must declare expectedEvents`);
    knownLeadIds.add(lead.id);

    if (lead.expectedPatientMatch?.patientId) {
      assertKnownReference(
        knownPatientIds,
        lead.expectedPatientMatch.patientId,
        `lead ${lead.key}.expectedPatientMatch.patientId`
      );
    }
  }

  for (const appointmentType of scenario.appointmentTypes) {
    assertUniqueEntityId(
      entityIds,
      appointmentType.id,
      `appointmentType ${appointmentType.key}.id`
    );
    assert.ok(
      appointmentType.defaultDurationMinutes > 0,
      `appointmentType ${appointmentType.key} needs positive duration`
    );
    knownAppointmentTypeIds.add(appointmentType.id);
  }

  for (const appointment of scenario.appointments) {
    assertUniqueEntityId(entityIds, appointment.id, `appointment ${appointment.key}.id`);
    assertKnownReference(
      knownTenantIds,
      appointment.tenantId,
      `appointment ${appointment.key}.tenantId`
    );
    assertKnownReference(
      knownClinicIds,
      appointment.clinicId,
      `appointment ${appointment.key}.clinicId`
    );
    assertKnownReference(
      knownPatientIds,
      appointment.patientId,
      `appointment ${appointment.key}.patientId`
    );
    assertKnownReference(knownLeadIds, appointment.leadId, `appointment ${appointment.key}.leadId`);
    assertKnownReference(
      knownAppointmentTypeIds,
      appointment.appointmentTypeId,
      `appointment ${appointment.key}.appointmentTypeId`
    );
    assertIsoWithOffset(
      appointment.scheduledStart,
      `appointment ${appointment.key}.scheduledStart`
    );
    assertIsoWithOffset(appointment.scheduledEnd, `appointment ${appointment.key}.scheduledEnd`);
    assert.ok(
      appointment.statusSequence.includes("booked"),
      `appointment ${appointment.key} must include booked status`
    );
    knownAppointmentIds.add(appointment.id);
  }

  const leadSources = new Set(scenario.leads.map((lead) => lead.source));
  for (const source of ["whatsapp", "google", "phone"]) {
    assert.ok(leadSources.has(source), `fixture must cover ${source} lead source`);
  }

  const stepKeys = scenario.flow.steps.map((step) => step.key);
  assert.deepEqual(stepKeys, REQUIRED_STEPS, "CP2 flow step order changed unexpectedly");
  assert.deepEqual(
    scenario.flow.actorSequence,
    scenario.flow.steps.map((step) => step.actorKey),
    "actorSequence must mirror step actor keys"
  );

  for (const step of scenario.flow.steps) {
    assert.ok(step.method && step.path, `flow step ${step.key} must declare method/path`);
    assert.ok(step.idempotencyKey, `flow step ${step.key} must declare idempotencyKey`);
    assert.ok(
      Number.isInteger(step.expectedStatus),
      `flow step ${step.key} must declare expectedStatus`
    );
    assert.ok(
      Array.isArray(step.expectedAudit),
      `flow step ${step.key} must declare expectedAudit`
    );

    for (const event of step.expectedAudit) {
      assert.ok(event.action, `flow step ${step.key} audit event needs action`);
      assert.ok(
        Array.isArray(event.phiFields),
        `flow step ${step.key} audit event needs phiFields`
      );
      if (UUID_PATTERN.test(event.resourceId)) {
        assertUuid(event.resourceId, `flow step ${step.key} audit resourceId`);
      }
    }
  }

  const eventNames = flattenEventNames(scenario);
  for (const eventName of REQUIRED_EVENTS) {
    assert.ok(eventNames.has(eventName), `fixture must expect ${eventName}`);
  }

  const timelineEntries = flattenTimelineEntries(scenario);
  for (const entryType of scenario.responseAssertions.timeline.newPatientMustInclude) {
    assert.ok(
      timelineEntries.has(entryType),
      `fixture must require ${entryType} timeline evidence`
    );
  }

  assert.ok(
    scenario.roleTenantExpectations.some(
      (expectation) =>
        expectation.expected === "deny" && expectation.expectedReason === "tenant_mismatch"
    ),
    "fixture must include wrong-tenant denial expectation"
  );
  assert.ok(
    scenario.roleTenantExpectations.some(
      (expectation) =>
        expectation.expected === "deny" && expectation.expectedReason === "missing_permission"
    ),
    "fixture must include unauthorized-role denial expectation"
  );
  assert.ok(
    scenario.roleTenantExpectations.some(
      (expectation) => expectation.actorKey === "receptionist" && expectation.expected === "allow"
    ),
    "fixture must include receptionist check-in allowance"
  );

  const afterCheckIn = scenario.dashboardSnapshots.find(
    (snapshot) => snapshot.key === "afterNewPatientCheckIn"
  );
  assert.ok(afterCheckIn, "fixture must include after-check-in dashboard snapshot");
  assert.equal(
    afterCheckIn.expected.queueWaitingCount,
    1,
    "after-check-in dashboard must expect one queue entry"
  );
  assert.equal(
    afterCheckIn.expected.newPatientVisible,
    true,
    "after-check-in dashboard must show new patient flag"
  );
  assert.equal(
    afterCheckIn.expected.returningPatientVisible,
    true,
    "after-check-in dashboard must show returning patient flag"
  );

  return true;
}

export function summarizeCp2Scenario(scenario) {
  return {
    tenants: scenario.tenants.length,
    clinics: scenario.clinics.length,
    actors: scenario.actors.length,
    patients: scenario.patients.length,
    leads: scenario.leads.length,
    appointments: scenario.appointments.length,
    flowSteps: scenario.flow.steps.length,
    roleTenantExpectations: scenario.roleTenantExpectations.length
  };
}

async function main() {
  const scenario = await loadCp2Scenario();
  validateCp2Scenario(scenario);
  const summary = summarizeCp2Scenario(scenario);
  console.log("CP2 fixture validation passed.");
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
