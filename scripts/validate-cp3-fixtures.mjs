#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const CP3_SCENARIO_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp3",
  "intake_consent_encounter_flow.json"
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_EMAIL_PATTERN = /^[^@\s]+@example\.test$/;
const TEST_PHONE_PATTERN = /^\+91993000\d{4}$/;
const REQUIRED_EVENTS = [
  "form_response.submitted",
  "consent.created",
  "encounter.started",
  "clinical_note.draft_created",
  "clinical_note.signed",
  "prescription.draft_created",
  "prescription.signed",
  "clinical_note.amended",
  "consent.revoked"
];
const REQUIRED_STEPS = [
  "submit-new-patient-digital-intake",
  "capture-new-patient-treatment-consent",
  "capture-new-patient-ai-audio-consent",
  "start-new-patient-encounter",
  "draft-new-patient-note-as-assistant",
  "sign-new-patient-note-as-doctor",
  "create-new-patient-prescription-as-doctor",
  "sign-new-patient-prescription-as-doctor",
  "amend-signed-note-as-doctor",
  "revoke-new-patient-ai-audio-consent",
  "verify-ai-audio-readiness-blocked",
  "submit-returning-patient-paper-card-intake",
  "read-returning-patient-prep-summary",
  "start-returning-patient-encounter"
];

function assertUuid(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string UUID`);
  assert.match(value, UUID_PATTERN, `${label} must be a deterministic v4-style UUID`);
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

function assertKnownReference(ids, value, label) {
  assertUuid(value, label);
  assert.ok(ids.has(value), `${label} references unknown id ${value}`);
}

function assertKnownKey(keys, value, label) {
  assert.equal(typeof value, "string", `${label} must be a string key`);
  assert.ok(keys.has(value), `${label} references unknown key ${value}`);
}

function byKey(collection, key, label) {
  const match = collection.find((item) => item.key === key);
  assert.ok(match, `Unknown ${label} key: ${key}`);
  return match;
}

function flattenEventNames(scenario) {
  const names = new Set();

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
    for (const expectation of step.timelineExpectations ?? []) {
      entries.add(expectation.entryType);
    }
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
  const emails = serialized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const email of emails) {
    assert.match(email, TEST_EMAIL_PATTERN, `${email} must use .example.test`);
  }

  const forbiddenPatterns = [
    /@gmail\.com/i,
    /@yahoo\./i,
    /@hotmail\./i,
    /razorpay_live/i,
    /sk_live/i,
    /whatsapp_access_token/i,
    /abha[_-]?(address|number)/i,
    /aadhaar/i,
    /pan[_-]?card/i
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(
      pattern.test(serialized),
      false,
      `fixture contains forbidden live-data pattern ${pattern}`
    );
  }
}

function normalizeStatusList(status) {
  return Array.isArray(status) ? status : [status];
}

export async function loadCp3Scenario(scenarioPath = CP3_SCENARIO_PATH) {
  const raw = await readFile(scenarioPath, "utf8");
  return JSON.parse(raw);
}

export function validateCp3Scenario(scenario) {
  assert.equal(scenario.schemaVersion, "clinic-os.cp3.qa-fixture.v1");
  assertLocalSyntheticOnly(scenario);

  assert.equal(scenario.clock.businessDate, "2026-07-07");
  assert.equal(scenario.clock.timezone, "Asia/Kolkata");
  assertIsoWithOffset(scenario.clock.fixedNow, "clock.fixedNow");

  const entityIds = new Set();
  const knownTenantIds = new Set();
  const knownClinicIds = new Set();
  const knownActorKeys = new Set();
  const knownPatientIds = new Set();
  const knownAppointmentIds = new Set();
  const knownIntakeTemplateIds = new Set();
  const knownConsentPolicyIds = new Set();
  const knownConsentRecordIds = new Set();
  const knownEncounterIds = new Set();
  const knownClinicalNoteIds = new Set();
  const knownClinicalNoteVersionIds = new Set();

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
    assert.match(actor.email, TEST_EMAIL_PATTERN, `actor ${actor.key}.email must be synthetic`);
    assertKnownReference(knownTenantIds, actor.tenantId, `actor ${actor.key}.tenantId`);
    assertKnownReference(knownClinicIds, actor.clinicId, `actor ${actor.key}.clinicId`);
    knownActorKeys.add(actor.key);
  }

  for (const patient of scenario.patients) {
    assertUniqueEntityId(entityIds, patient.id, `patient ${patient.key}.id`);
    assert.match(patient.email, TEST_EMAIL_PATTERN, `patient ${patient.key}.email`);
    assert.match(
      patient.phone,
      TEST_PHONE_PATTERN,
      `patient ${patient.key}.phone must use reserved CP3 fixture range`
    );
    assertKnownReference(knownTenantIds, patient.tenantId, `patient ${patient.key}.tenantId`);
    assertKnownReference(knownClinicIds, patient.clinicId, `patient ${patient.key}.clinicId`);
    knownPatientIds.add(patient.id);

    for (const entry of patient.timelineSeed ?? []) {
      assertIsoWithOffset(entry.occurredAt, `patient ${patient.key}.timelineSeed.occurredAt`);
    }
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
    assertKnownKey(
      knownActorKeys,
      appointment.providerActorKey,
      `appointment ${appointment.key}.providerActorKey`
    );
    assertIsoWithOffset(
      appointment.scheduledStart,
      `appointment ${appointment.key}.scheduledStart`
    );
    assertIsoWithOffset(appointment.scheduledEnd, `appointment ${appointment.key}.scheduledEnd`);
    assert.ok(
      appointment.statusSequence.includes("checked_in"),
      `appointment ${appointment.key} must include checked_in`
    );
    knownAppointmentIds.add(appointment.id);
  }

  for (const template of scenario.intakeTemplates) {
    assertUniqueEntityId(entityIds, template.id, `intakeTemplate ${template.key}.id`);
    assert.ok(template.requiredSections.length > 0, `intakeTemplate ${template.key} needs fields`);
    knownIntakeTemplateIds.add(template.id);
  }

  for (const response of scenario.intakeResponses) {
    assertUniqueEntityId(entityIds, response.id, `intakeResponse ${response.key}.id`);
    assertKnownReference(
      knownIntakeTemplateIds,
      response.templateId,
      `intakeResponse ${response.key}.templateId`
    );
    assertKnownReference(
      knownPatientIds,
      response.patientId,
      `intakeResponse ${response.key}.patientId`
    );
    assertKnownReference(
      knownAppointmentIds,
      response.appointmentId,
      `intakeResponse ${response.key}.appointmentId`
    );
    assertKnownKey(
      knownActorKeys,
      response.submittedByActorKey,
      `intakeResponse ${response.key}.submittedByActorKey`
    );
    assertIsoWithOffset(response.submittedAt, `intakeResponse ${response.key}.submittedAt`);
  }

  for (const policy of scenario.consentPolicies) {
    assertUniqueEntityId(entityIds, policy.id, `consentPolicy ${policy.key}.id`);
    assert.ok(policy.purpose, `consentPolicy ${policy.key} needs purpose`);
    assert.ok(
      policy.requiresActiveConsentBefore.length > 0,
      `consentPolicy ${policy.key} needs enforcement hooks`
    );
    knownConsentPolicyIds.add(policy.id);
  }

  for (const record of scenario.consentRecords) {
    assertUniqueEntityId(entityIds, record.id, `consentRecord ${record.key}.id`);
    assertKnownReference(
      knownConsentPolicyIds,
      record.policyId,
      `consentRecord ${record.key}.policyId`
    );
    assertKnownReference(
      knownPatientIds,
      record.patientId,
      `consentRecord ${record.key}.patientId`
    );
    assertKnownKey(
      knownActorKeys,
      record.capturedByActorKey,
      `consentRecord ${record.key}.capturedByActorKey`
    );
    assertIsoWithOffset(record.capturedAt, `consentRecord ${record.key}.capturedAt`);
    if (record.status === "revoked") {
      assertKnownKey(
        knownActorKeys,
        record.revokedByActorKey,
        `consentRecord ${record.key}.revokedByActorKey`
      );
      assertIsoWithOffset(record.revokedAt, `consentRecord ${record.key}.revokedAt`);
      assert.ok(record.revocationReason, `consentRecord ${record.key} needs revocationReason`);
    }
    knownConsentRecordIds.add(record.id);
  }

  for (const encounter of scenario.encounters) {
    assertUniqueEntityId(entityIds, encounter.id, `encounter ${encounter.key}.id`);
    assertKnownReference(knownTenantIds, encounter.tenantId, `encounter ${encounter.key}.tenantId`);
    assertKnownReference(knownClinicIds, encounter.clinicId, `encounter ${encounter.key}.clinicId`);
    assertKnownReference(
      knownPatientIds,
      encounter.patientId,
      `encounter ${encounter.key}.patientId`
    );
    assertKnownReference(
      knownAppointmentIds,
      encounter.appointmentId,
      `encounter ${encounter.key}.appointmentId`
    );
    assertKnownKey(
      knownActorKeys,
      encounter.providerActorKey,
      `encounter ${encounter.key}.providerActorKey`
    );
    assertIsoWithOffset(encounter.startedAt, `encounter ${encounter.key}.startedAt`);
    assert.ok(
      encounter.lifecycle.includes("encounter_started"),
      `encounter ${encounter.key} must include encounter_started`
    );
    knownEncounterIds.add(encounter.id);
  }

  for (const note of scenario.clinicalNotes) {
    assertUniqueEntityId(entityIds, note.id, `clinicalNote ${note.key}.id`);
    assertKnownReference(
      knownEncounterIds,
      note.encounterId,
      `clinicalNote ${note.key}.encounterId`
    );
    assertKnownReference(knownPatientIds, note.patientId, `clinicalNote ${note.key}.patientId`);
    assert.ok(note.versions.length > 0, `clinicalNote ${note.key} needs versions`);
    knownClinicalNoteIds.add(note.id);

    const noteVersionIds = new Set();
    for (const version of note.versions) {
      assertUniqueEntityId(
        entityIds,
        version.id,
        `clinicalNote ${note.key}.version ${version.key}.id`
      );
      assert.ok(!noteVersionIds.has(version.id), `clinicalNote ${note.key} duplicates version`);
      noteVersionIds.add(version.id);
      knownClinicalNoteVersionIds.add(version.id);

      assert.equal(
        Number.isInteger(version.version),
        true,
        `clinicalNote ${note.key}.${version.key}.version must be integer`
      );
      assertKnownKey(
        knownActorKeys,
        version.draftedByActorKey,
        `clinicalNote ${note.key}.${version.key}.draftedByActorKey`
      );

      if (version.status === "signed") {
        assertKnownKey(
          knownActorKeys,
          version.signedByActorKey,
          `clinicalNote ${note.key}.${version.key}.signedByActorKey`
        );
        assertIsoWithOffset(version.signedAt, `clinicalNote ${note.key}.${version.key}.signedAt`);
        assert.equal(version.immutable, true, `signed version ${version.key} must be immutable`);
        assert.match(version.signedHash, /^sha256:/, `signed version ${version.key} needs hash`);
      }

      if (version.amendmentOfVersionId) {
        assertUuid(version.amendmentOfVersionId, `clinicalNote ${note.key}.amendmentOfVersionId`);
        assert.ok(
          noteVersionIds.has(version.amendmentOfVersionId),
          `amendment ${version.key} must link to an earlier version in the same note`
        );
        assert.ok(version.amendmentReason, `amendment ${version.key} requires reason`);
        assert.match(
          version.preservesPreviousSignedHash,
          /^sha256:/,
          `amendment ${version.key} must preserve prior signed hash`
        );
      }
    }
  }

  for (const prescription of scenario.prescriptions) {
    assertUniqueEntityId(entityIds, prescription.id, `prescription ${prescription.key}.id`);
    assertKnownReference(
      knownEncounterIds,
      prescription.encounterId,
      `prescription ${prescription.key}.encounterId`
    );
    assertKnownReference(
      knownPatientIds,
      prescription.patientId,
      `prescription ${prescription.key}.patientId`
    );
    assertKnownKey(
      knownActorKeys,
      prescription.createdByActorKey,
      `prescription ${prescription.key}.createdByActorKey`
    );
    assertIsoWithOffset(prescription.createdAt, `prescription ${prescription.key}.createdAt`);
    assert.ok(prescription.items.length > 0, `prescription ${prescription.key} needs items`);
    if (prescription.status === "signed") {
      assertKnownKey(
        knownActorKeys,
        prescription.signedByActorKey,
        `prescription ${prescription.key}.signedByActorKey`
      );
      assertIsoWithOffset(prescription.signedAt, `prescription ${prescription.key}.signedAt`);
      assert.match(prescription.signedHash, /^sha256:/, "signed prescription needs hash");
    }
  }

  assert.deepEqual(
    scenario.flow.steps.map((step) => step.key),
    REQUIRED_STEPS,
    "CP3 flow step order changed unexpectedly"
  );
  assert.deepEqual(
    scenario.flow.actorSequence,
    scenario.flow.steps.map((step) => step.actorKey),
    "actorSequence must mirror step actor keys"
  );

  for (const step of scenario.flow.steps) {
    assertKnownKey(knownActorKeys, step.actorKey, `flow step ${step.key}.actorKey`);
    assert.ok(step.method && step.path, `flow step ${step.key} must declare method/path`);
    assert.ok(step.idempotencyKey, `flow step ${step.key} must declare idempotencyKey`);
    assert.ok(
      normalizeStatusList(step.expectedStatus).every((status) => Number.isInteger(status)),
      `flow step ${step.key} must declare integer expectedStatus`
    );
    assert.ok(
      Array.isArray(step.expectedEvents),
      `flow step ${step.key} must declare expectedEvents`
    );
    assert.ok(
      Array.isArray(step.expectedAudit),
      `flow step ${step.key} must declare expectedAudit`
    );
    if (step.method !== "GET") {
      assert.ok(step.requestBody, `flow step ${step.key} must declare requestBody`);
    }

    for (const event of step.expectedAudit) {
      assert.ok(event.action, `flow step ${step.key} audit event needs action`);
      assert.ok(
        Array.isArray(event.phiFields),
        `flow step ${step.key} audit event needs phiFields`
      );
      assert.ok(
        event.phiFields.length > 0,
        `flow step ${step.key} audit event must name PHI-sensitive fields`
      );
      if (UUID_PATTERN.test(event.resourceId)) {
        assertUuid(event.resourceId, `flow step ${step.key} audit resourceId`);
      }
    }

    for (const expectation of step.timelineExpectations) {
      assertKnownReference(
        knownPatientIds,
        expectation.patientId,
        `flow step ${step.key}.timeline.patientId`
      );
      assert.ok(expectation.entryType, `flow step ${step.key}.timeline entryType`);
    }
  }

  const eventNames = flattenEventNames(scenario);
  for (const eventName of REQUIRED_EVENTS) {
    assert.ok(eventNames.has(eventName), `fixture must expect ${eventName}`);
  }

  const timelineEntries = flattenTimelineEntries(scenario);
  for (const entryType of scenario.responseAssertions.timeline.newPatientMustInclude) {
    assert.ok(timelineEntries.has(entryType), `fixture must require ${entryType} timeline entry`);
  }
  for (const entryType of scenario.responseAssertions.timeline.returningPatientMustInclude) {
    assert.ok(timelineEntries.has(entryType), `fixture must require ${entryType} timeline entry`);
  }

  for (const expectation of scenario.roleTenantExpectations) {
    assertKnownKey(knownActorKeys, expectation.actorKey, `role expectation ${expectation.key}`);
    assertKnownReference(
      knownTenantIds,
      expectation.targetTenantId,
      `role expectation ${expectation.key}.targetTenantId`
    );
    assertKnownReference(
      knownClinicIds,
      expectation.targetClinicId,
      `role expectation ${expectation.key}.targetClinicId`
    );
    assert.ok(
      expectation.requiredPermissions.length > 0,
      `role expectation ${expectation.key} needs permissions`
    );
    assert.ok(
      ["allow", "deny"].includes(expectation.expected),
      `role expectation ${expectation.key} expected must be allow/deny`
    );
    if (expectation.expected === "deny") {
      assert.ok(expectation.expectedReason, `denial ${expectation.key} needs expectedReason`);
      assert.ok(expectation.method && expectation.path, `denial ${expectation.key} needs request`);
      assert.ok(
        normalizeStatusList(expectation.expectedStatus).length > 0,
        `denial ${expectation.key} needs expectedStatus`
      );
    }
  }

  for (const expectedReason of [
    "missing_permission",
    "tenant_mismatch",
    "immutable_signed_artifact",
    "consent_revoked"
  ]) {
    assert.ok(
      scenario.roleTenantExpectations.some(
        (expectation) =>
          expectation.expected === "deny" && expectation.expectedReason === expectedReason
      ),
      `fixture must include ${expectedReason} denial`
    );
  }

  const signedNoteAssertions = scenario.responseAssertions.signedNoteImmutability;
  assertKnownReference(
    knownClinicalNoteIds,
    signedNoteAssertions.noteId,
    "signedNoteImmutability.noteId"
  );
  assertKnownReference(
    knownClinicalNoteVersionIds,
    signedNoteAssertions.signedVersionId,
    "signedNoteImmutability.signedVersionId"
  );
  assertKnownReference(
    knownClinicalNoteVersionIds,
    signedNoteAssertions.amendedVersionId,
    "signedNoteImmutability.amendedVersionId"
  );
  assert.equal(
    byKey(
      scenario.roleTenantExpectations,
      signedNoteAssertions.overwriteDeniedByExpectationKey,
      "roleTenantExpectation"
    ).expectedReason,
    "immutable_signed_artifact"
  );
  assert.equal(signedNoteAssertions.amendmentRequiresReason, true);
  assert.equal(signedNoteAssertions.previousSignedHashMustBePreserved, true);
  assert.equal(signedNoteAssertions.signedVersionsAreImmutable, true);

  const consentAssertions = scenario.responseAssertions.consentEnforcement;
  assertKnownReference(
    knownPatientIds,
    consentAssertions.patientId,
    "consentEnforcement.patientId"
  );
  assertKnownReference(
    knownConsentRecordIds,
    consentAssertions.consentRecordId,
    "consentEnforcement.consentRecordId"
  );
  assert.equal(consentAssertions.purpose, "AI_AUDIO_CAPTURE");
  assert.equal(consentAssertions.readyBeforeRevocation, true);
  assert.equal(consentAssertions.readyAfterRevocation, false);
  assert.equal(consentAssertions.blockingReason, "consent_revoked");
  assert.deepEqual(consentAssertions.blockedCapabilities, [
    "audio_capture",
    "transcription",
    "ai_draft"
  ]);
  assert.equal(
    byKey(
      scenario.roleTenantExpectations,
      consentAssertions.futureCaptureDeniedByExpectationKey,
      "roleTenantExpectation"
    ).expectedReason,
    "consent_revoked"
  );

  const aiAudioConsent = byKey(
    scenario.consentRecords,
    "newPatientAiAudioConsent",
    "consentRecord"
  );
  assert.equal(aiAudioConsent.status, "revoked", "AI/audio consent must finish revoked");
  assert.equal(aiAudioConsent.purpose, "AI_AUDIO_CAPTURE");

  assert.ok(
    scenario.e2eSelectorContract.requiredTestIds.length >= 20,
    "E2E selector contract must name expected browser workflow selectors"
  );

  return true;
}

export function summarizeCp3Scenario(scenario) {
  return {
    tenants: scenario.tenants.length,
    clinics: scenario.clinics.length,
    actors: scenario.actors.length,
    patients: scenario.patients.length,
    appointments: scenario.appointments.length,
    intakeResponses: scenario.intakeResponses.length,
    consentRecords: scenario.consentRecords.length,
    encounters: scenario.encounters.length,
    clinicalNotes: scenario.clinicalNotes.length,
    prescriptions: scenario.prescriptions.length,
    flowSteps: scenario.flow.steps.length,
    roleTenantExpectations: scenario.roleTenantExpectations.length
  };
}

async function main() {
  const scenario = await loadCp3Scenario();
  validateCp3Scenario(scenario);
  const summary = summarizeCp3Scenario(scenario);
  console.log("CP3 fixture validation passed.");
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
