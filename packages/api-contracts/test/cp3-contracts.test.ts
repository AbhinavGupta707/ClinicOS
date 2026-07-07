import test from "node:test";
import assert from "node:assert/strict";
import {
  CP3_EVENT_TYPES,
  CP3_OPENAPI_ENDPOINT_NOTES,
  createCp3EventEnvelope,
  parseClinicalNoteAmendRequest,
  parseClinicalNoteDraftSaveRequest,
  parseConsentCreateRequest,
  parseConsentRevokeRequest,
  parseCp3EventEnvelope,
  parseEncounterCreateRequest,
  parseIntakeFormSubmissionRequest,
  parsePrescriptionCreateRequest,
  parsePrescriptionSignRequest
} from "../src/index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000101";
const userId = "10000000-0000-4000-8000-000000001002";
const patientId = "10000000-0000-4000-8000-000000002001";
const templateId = "10000000-0000-4000-8000-000000010001";
const encounterId = "10000000-0000-4000-8000-000000010002";
const prescriptionId = "10000000-0000-4000-8000-000000010003";

function context() {
  return {
    tenantId,
    clinicId,
    actor: { type: "user", id: userId },
    correlationId: "corr-cp3-contract-test",
    idempotencyKey: "idem-cp3-contract-test"
  };
}

test("intake submission supports digital and assistant paper-card provenance", () => {
  const valid = parseIntakeFormSubmissionRequest({
    ...context(),
    patientId,
    formResponse: {
      templateId,
      source: "assistant_paper_card",
      responses: { chiefComplaint: "Pain on biting" },
      medicalHistorySnapshot: { allergies: ["penicillin"] },
      provenance: { kind: "manual_entry", capturedAt: "2026-07-07T09:00:00.000Z" }
    }
  });

  assert.equal(valid.success, true);

  const invalid = parseIntakeFormSubmissionRequest({
    ...context(),
    patientId,
    formResponse: {
      templateId,
      source: "clipboard",
      responses: {},
      extra: true
    }
  });

  assert.equal(invalid.success, false);
  assert.match(JSON.stringify(invalid), /Expected one of/);
  assert.match(JSON.stringify(invalid), /Unknown field/);
  assert.match(JSON.stringify(invalid), /provenance/);
});

test("consent create and revoke contracts require purpose, template version, and reason", () => {
  assert.equal(
    parseConsentCreateRequest({
      ...context(),
      patientId,
      consent: {
        purpose: "ai_audio_capture",
        templateCode: "ai-audio-v1",
        templateVersion: 1,
        captureMethod: "digital_patient",
        provenance: { kind: "manual_entry" }
      }
    }).success,
    true
  );

  const revoke = parseConsentRevokeRequest({
    ...context(),
    patientId,
    consentId: "10000000-0000-4000-8000-000000010004",
    reason: "Patient withdrew AI/audio consent"
  });
  assert.equal(revoke.success, true);

  const invalid = parseConsentCreateRequest({
    ...context(),
    patientId,
    consent: {
      purpose: "vibes",
      templateCode: "bad",
      templateVersion: 0,
      captureMethod: "spoken",
      provenance: { kind: "manual_entry" }
    }
  });
  assert.equal(invalid.success, false);
  assert.match(JSON.stringify(invalid), /Expected one of/);
  assert.match(JSON.stringify(invalid), /Expected >= 1/);
});

test("encounter note and prescription contracts enforce clinical payload shape", () => {
  assert.equal(
    parseEncounterCreateRequest({
      ...context(),
      encounter: {
        patientId,
        providerUserId: userId,
        reason: "Initial consultation"
      }
    }).success,
    true
  );
  assert.equal(
    parseClinicalNoteDraftSaveRequest({
      ...context(),
      encounterId,
      content: {
        diagnosis: "Reversible pulpitis",
        treatmentPlan: "Restoration"
      },
      readyForSign: true
    }).success,
    true
  );
  assert.equal(
    parseClinicalNoteAmendRequest({
      ...context(),
      encounterId,
      content: { followUpInstructions: "Return if pain persists" },
      amendmentReason: "Add follow-up guidance"
    }).success,
    true
  );

  const prescription = parsePrescriptionCreateRequest({
    ...context(),
    encounterId,
    medications: [
      {
        name: "Ibuprofen",
        frequency: "TDS",
        duration: "3 days"
      }
    ]
  });
  assert.equal(prescription.success, true);
  assert.equal(parsePrescriptionSignRequest({ ...context(), prescriptionId }).success, true);

  const invalidPrescription = parsePrescriptionCreateRequest({
    ...context(),
    encounterId,
    medications: []
  });
  assert.equal(invalidPrescription.success, false);
  assert.match(JSON.stringify(invalidPrescription), /at least one medication/);
});

test("CP3 event envelope and OpenAPI notes enumerate doctor-only signature routes", () => {
  assert.ok(CP3_EVENT_TYPES.includes("clinical_note.signed"));
  assert.ok(CP3_EVENT_TYPES.includes("prescription.signed"));

  const envelope = createCp3EventEnvelope({
    eventId: "10000000-0000-4000-8000-000000010005",
    eventType: "clinical_note.signed",
    tenantId,
    clinicId,
    actor: { type: "user", id: userId },
    correlationId: "corr-cp3-event",
    source: { kind: "manual_entry" },
    aggregate: { type: "clinical_note", id: "10000000-0000-4000-8000-000000010006" },
    patientId,
    payload: { encounterId }
  });

  assert.equal(parseCp3EventEnvelope(envelope).success, true);
  assert.equal(parseCp3EventEnvelope({ ...envelope, eventType: "clinical_note.vibes" }).success, false);

  const doctorOnlyOperationIds = CP3_OPENAPI_ENDPOINT_NOTES.filter(
    (endpoint) => endpoint.doctorOnly
  ).map((endpoint) => endpoint.operationId);
  assert.deepEqual(doctorOnlyOperationIds.sort(), [
    "amendEncounterClinicalNote",
    "signEncounterClinicalNote",
    "signPrescription"
  ]);
});
