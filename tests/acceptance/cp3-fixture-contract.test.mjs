import assert from "node:assert/strict";
import test from "node:test";
import { buildCp3SmokePlan } from "../../scripts/cp3-contract-smoke.mjs";
import {
  loadCp3Scenario,
  summarizeCp3Scenario,
  validateCp3Scenario
} from "../../scripts/validate-cp3-fixtures.mjs";

test("CP3 synthetic scenario is deterministic and local-test only", async () => {
  const scenario = await loadCp3Scenario();

  assert.equal(validateCp3Scenario(scenario), true);
  assert.deepEqual(summarizeCp3Scenario(scenario), {
    tenants: 2,
    clinics: 2,
    actors: 6,
    patients: 2,
    appointments: 2,
    intakeResponses: 2,
    consentRecords: 3,
    encounters: 2,
    clinicalNotes: 2,
    prescriptions: 1,
    flowSteps: 14,
    roleTenantExpectations: 10
  });
});

test("CP3 scenario covers new patient and returning patient clinical paths", async () => {
  const scenario = await loadCp3Scenario();
  const steps = new Set(scenario.flow.steps.map((step) => step.key));

  for (const stepKey of [
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
  ]) {
    assert.ok(steps.has(stepKey), `${stepKey} missing from CP3 flow`);
  }

  const newPatient = scenario.patients.find((patient) => patient.key === "newPatient");
  assert.equal(newPatient.patientClassification, "new");

  const returningPatient = scenario.patients.find((patient) => patient.key === "returningPatient");
  assert.equal(returningPatient.patientClassification, "returning");
  assert.equal(returningPatient.returningPrepSeed.medicalHistoryChangePromptRequired, true);
});

test("CP3 scenario requires audit, timeline, and domain event evidence", async () => {
  const scenario = await loadCp3Scenario();
  const timelineRequiredSteps = [
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
    "submit-returning-patient-paper-card-intake",
    "start-returning-patient-encounter"
  ];

  for (const step of scenario.flow.steps) {
    assert.ok(step.expectedAudit.length > 0, `${step.key} must declare audit evidence`);
    for (const event of step.expectedAudit) {
      assert.ok(event.action, `${step.key} audit expectation needs action`);
      assert.ok(event.phiFields.length > 0, `${step.key} audit must name PHI fields`);
    }
  }

  for (const stepKey of timelineRequiredSteps) {
    const step = scenario.flow.steps.find((candidate) => candidate.key === stepKey);
    assert.ok(step.timelineExpectations.length > 0, `${stepKey} must declare timeline evidence`);
  }

  const allEvents = new Set(scenario.flow.steps.flatMap((step) => step.expectedEvents));
  for (const eventName of [
    "form_response.submitted",
    "consent.created",
    "encounter.started",
    "clinical_note.draft_created",
    "clinical_note.signed",
    "prescription.draft_created",
    "prescription.signed",
    "clinical_note.amended",
    "consent.revoked"
  ]) {
    assert.ok(allEvents.has(eventName), `${eventName} missing from expected events`);
  }
});

test("CP3 scenario includes role denial, tenant denial, and doctor-only sign contracts", async () => {
  const scenario = await loadCp3Scenario();

  for (const expectation of [
    ["assistant-cannot-sign-clinical-note", "missing_permission"],
    ["assistant-cannot-sign-prescription", "missing_permission"],
    ["accountant-cannot-read-clinical-encounter", "missing_permission"],
    ["wrong-tenant-assistant-cannot-read-primary-prep", "tenant_mismatch"],
    ["signed-note-version-cannot-be-overwritten", "immutable_signed_artifact"],
    ["ai-audio-capture-denied-after-consent-revocation", "consent_revoked"]
  ]) {
    const [key, expectedReason] = expectation;
    assert.ok(
      scenario.roleTenantExpectations.some(
        (candidate) =>
          candidate.key === key &&
          candidate.expected === "deny" &&
          candidate.expectedReason === expectedReason
      ),
      `${key} denial missing`
    );
  }

  assert.ok(
    scenario.roleTenantExpectations.some(
      (expectation) =>
        expectation.key === "doctor-can-sign-clinical-note" && expectation.expected === "allow"
    )
  );
  assert.ok(
    scenario.roleTenantExpectations.some(
      (expectation) =>
        expectation.key === "doctor-can-sign-prescription" && expectation.expected === "allow"
    )
  );
});

test("CP3 signed note immutability requires amendment instead of overwrite", async () => {
  const scenario = await loadCp3Scenario();
  const note = scenario.clinicalNotes.find((candidate) => candidate.key === "newPatientNote");
  const signedV1 = note.versions.find((version) => version.key === "newPatientNoteSignedV1");
  const amendedV2 = note.versions.find((version) => version.key === "newPatientNoteAmendedV2");

  assert.equal(signedV1.status, "signed");
  assert.equal(signedV1.immutable, true);
  assert.match(signedV1.signedHash, /^sha256:/);

  assert.equal(amendedV2.status, "signed");
  assert.equal(amendedV2.immutable, true);
  assert.equal(amendedV2.amendmentOfVersionId, signedV1.id);
  assert.equal(amendedV2.preservesPreviousSignedHash, signedV1.signedHash);
  assert.ok(amendedV2.amendmentReason);

  assert.equal(
    scenario.responseAssertions.signedNoteImmutability.overwriteDeniedByExpectationKey,
    "signed-note-version-cannot-be-overwritten"
  );
});

test("CP3 consent revocation blocks future AI/audio readiness and capture", async () => {
  const scenario = await loadCp3Scenario();
  const aiAudioConsent = scenario.consentRecords.find(
    (consent) => consent.key === "newPatientAiAudioConsent"
  );

  assert.equal(aiAudioConsent.purpose, "AI_AUDIO_CAPTURE");
  assert.equal(aiAudioConsent.status, "revoked");
  assert.ok(aiAudioConsent.revocationReason);

  assert.deepEqual(scenario.responseAssertions.consentEnforcement, {
    patientId: "30000000-0000-4000-8000-000000002001",
    consentRecordId: "30000000-0000-4000-8000-000000007002",
    purpose: "AI_AUDIO_CAPTURE",
    readinessEndpoint:
      "/v1/patients/30000000-0000-4000-8000-000000002001/ai-audio-readiness?encounterId=30000000-0000-4000-8000-000000008001",
    readyBeforeRevocation: true,
    readyAfterRevocation: false,
    blockedCapabilities: ["audio_capture", "transcription", "ai_draft"],
    blockingReason: "consent_revoked",
    futureCaptureDeniedByExpectationKey: "ai-audio-capture-denied-after-consent-revocation"
  });

  const revokeStep = scenario.flow.steps.find(
    (step) => step.key === "revoke-new-patient-ai-audio-consent"
  );
  assert.deepEqual(revokeStep.expectedEvents, ["consent.revoked"]);

  const readinessStep = scenario.flow.steps.find(
    (step) => step.key === "verify-ai-audio-readiness-blocked"
  );
  assert.equal(readinessStep.method, "GET");
});

test("CP3 smoke plan can be built from documented contracts", async () => {
  const scenario = await loadCp3Scenario();
  const plan = buildCp3SmokePlan(scenario);

  assert.equal(plan.flowRequests.length, 14);
  assert.equal(plan.negativeRequests.length, 6);
  assert.equal(plan.postFlowVerification.length, 4);
  assert.deepEqual(
    plan.flowRequests.map((request) => `${request.method} ${request.path}`),
    [
      "POST /v1/patients/30000000-0000-4000-8000-000000002001/intake-responses",
      "POST /v1/patients/30000000-0000-4000-8000-000000002001/consents",
      "POST /v1/patients/30000000-0000-4000-8000-000000002001/consents",
      "POST /v1/encounters",
      "POST /v1/encounters/30000000-0000-4000-8000-000000008001/clinical-notes/drafts",
      "POST /v1/clinical-notes/30000000-0000-4000-8000-000000009001/sign",
      "POST /v1/encounters/30000000-0000-4000-8000-000000008001/prescriptions",
      "POST /v1/prescriptions/30000000-0000-4000-8000-000000010001/sign",
      "POST /v1/clinical-notes/30000000-0000-4000-8000-000000009001/amendments",
      "POST /v1/consents/30000000-0000-4000-8000-000000007002/revoke",
      "GET /v1/patients/30000000-0000-4000-8000-000000002001/ai-audio-readiness?encounterId=30000000-0000-4000-8000-000000008001",
      "POST /v1/patients/30000000-0000-4000-8000-000000002002/intake-responses",
      "GET /v1/patients/30000000-0000-4000-8000-000000002002/prep-summary?appointmentId=30000000-0000-4000-8000-000000003002",
      "POST /v1/encounters"
    ]
  );
});
