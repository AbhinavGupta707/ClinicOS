import test from "node:test";
import assert from "node:assert/strict";
import { classifyAuditAction, createAuditEvent, redactPhi } from "../src/index.ts";

test("PHI audit actions require patient id", () => {
  assert.throws(
    () =>
      createAuditEvent({
        tenantId: "10000000-0000-4000-8000-000000000001",
        actor: { type: "user", id: "10000000-0000-4000-8000-000000001001" },
        action: "patient.record.viewed"
      }),
    /requires patientId/
  );
});

test("audit classifications mark sensitive access", () => {
  const classification = classifyAuditAction("media.viewed");
  assert.equal(classification.phiInvolved, true);
  assert.equal(classification.riskLevel, "high");
  assert.equal(classification.category, "phi_access");
});

test("CP4 media audit classifications cover upload and signed access", () => {
  for (const action of ["media.upload_requested", "media.upload_completed", "media.viewed"] as const) {
    const classification = classifyAuditAction(action);
    assert.equal(classification.phiInvolved, true);
    assert.equal(classification.requiresPatientId, true);
    assert.equal(classification.category, "phi_access");
  }

  assert.throws(
    () =>
      createAuditEvent({
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000101",
        actor: { type: "user", id: "10000000-0000-4000-8000-000000001003" },
        action: "media.upload_completed"
      }),
    /requires patientId/
  );
});

test("CP3 audit classifications cover intake consent encounter note prescription and timeline actions", () => {
  for (const action of [
    "patient.timeline.viewed",
    "form_response.submitted",
    "consent.created",
    "consent.revoked",
    "consent.enforcement.checked",
    "encounter.created",
    "encounter.started",
    "encounter.completed",
    "clinical_prep.viewed",
    "clinical_note.draft_created",
    "clinical_note.signed",
    "clinical_note.amended",
    "prescription.draft_created",
    "prescription.signed"
  ] as const) {
    const classification = classifyAuditAction(action);
    assert.equal(classification.phiInvolved, true, `${action} should involve PHI`);
    assert.equal(classification.requiresPatientId, true, `${action} should require patientId`);
  }

  assert.equal(classifyAuditAction("consent.revoked").category, "privacy");
  assert.equal(classifyAuditAction("consent.revoked").riskLevel, "critical");
  assert.equal(classifyAuditAction("clinical_note.amended").riskLevel, "critical");

  assert.throws(
    () =>
      createAuditEvent({
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000002",
        actor: { type: "user", id: "10000000-0000-4000-8000-000000001001" },
        action: "consent.revoked"
      }),
    /requires patientId/
  );
});

test("checkpoint 2 workflow audit actions are PHI-linked where patient state changes", () => {
  for (const action of [
    "appointment.created",
    "appointment.confirmation_requested",
    "appointment.confirmed",
    "appointment.no_show",
    "patient.checked_in",
    "queue.entry_created",
    "queue.entry_updated",
    "lead.matched_to_patient",
    "lead.converted_to_appointment"
  ] as const) {
    const classification = classifyAuditAction(action);
    assert.equal(classification.phiInvolved, true);
    assert.equal(classification.requiresPatientId, true);
  }
});

test("CP2 audit classifications cover lead appointment and queue events", () => {
  const leadCreated = classifyAuditAction("lead.created");
  assert.equal(leadCreated.phiInvolved, true);
  assert.equal(leadCreated.requiresPatientId, false);

  const leadMatched = classifyAuditAction("lead.matched_to_patient");
  assert.equal(leadMatched.riskLevel, "high");
  assert.equal(leadMatched.requiresPatientId, true);

  const noShow = classifyAuditAction("appointment.no_show");
  assert.equal(noShow.category, "phi_access");
  assert.equal(noShow.riskLevel, "high");

  assert.throws(
    () =>
      createAuditEvent({
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000002",
        actor: { type: "user", id: "10000000-0000-4000-8000-000000001001" },
        action: "patient.checked_in"
      }),
    /requires patientId/
  );
});

test("PHI redaction masks nested patient and free-text identifiers", () => {
  const redacted = redactPhi({
    event: "patient.record.viewed",
    patient: {
      fullName: "Rhea Synthetic",
      phone: "+91 98765 43210",
      email: "rhea.synthetic@example.test"
    },
    message: "Call +91 98765 43210 or email rhea.synthetic@example.test"
  });

  assert.equal(redacted.patient.fullName, "[REDACTED]");
  assert.equal(redacted.patient.phone, "[REDACTED]");
  assert.equal(redacted.patient.email, "[REDACTED]");
  assert.match(redacted.message, /\*+3210/);
  assert.match(redacted.message, /r\*\*\*@example\.test/);
});

test("PHI redaction covers CP3 intake consent clinical note prescription and audio payloads", () => {
  const redacted = redactPhi({
    formResponse: {
      chiefComplaint: "Pain near molar, call +91 98765 43210",
      medicalHistory: "Diabetes and penicillin allergy"
    },
    consentSignature: "Rhea Synthetic",
    encounter: {
      clinicalNote: "Patient reports swelling.",
      observations: "Swelling lower left quadrant",
      treatmentPlan: "RCT discussion",
      treatmentPerformed: "Temporary restoration"
    },
    prescriptionItems: [{ medicationName: "Amoxicillin", dosage: "500mg" }],
    audio: {
      transcript: "Patient says rhea.synthetic@example.test",
      rawAudioUrl: "s3://private/audio.wav"
    }
  });

  assert.equal(redacted.formResponse, "[REDACTED]");
  assert.equal(redacted.consentSignature, "[REDACTED]");
  assert.equal(redacted.encounter.clinicalNote, "[REDACTED]");
  assert.equal(redacted.encounter.observations, "[REDACTED]");
  assert.equal(redacted.encounter.treatmentPlan, "[REDACTED]");
  assert.equal(redacted.encounter.treatmentPerformed, "[REDACTED]");
  assert.equal(redacted.prescriptionItems, "[REDACTED]");
  assert.equal(redacted.audio.transcript, "[REDACTED]");
  assert.equal(redacted.audio.rawAudioUrl, "[REDACTED]");
});

test("PHI redaction covers media object keys, filenames, and signed URLs", () => {
  const redacted = redactPhi({
    media: {
      originalFilename: "Rhea Synthetic intraoral photo.jpg",
      objectKey:
        "local/tenants/10000000-0000-4000-8000-000000000001/clinics/10000000-0000-4000-8000-000000000101/patients/10000000-0000-4000-8000-000000002001/media/private.jpg",
      signedUrl: "https://storage.example.test/private-media-token",
      dicomMetadata: { PatientName: "Rhea Synthetic" }
    }
  });

  assert.equal(redacted.media.originalFilename, "[REDACTED]");
  assert.equal(redacted.media.objectKey, "[REDACTED]");
  assert.equal(redacted.media.signedUrl, "[REDACTED]");
  assert.equal(redacted.media.dicomMetadata, "[REDACTED]");
});
