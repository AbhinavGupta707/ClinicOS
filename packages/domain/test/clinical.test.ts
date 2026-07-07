import test from "node:test";
import assert from "node:assert/strict";
import {
  assertClinicalNoteCanBeSigned,
  assertEncounterTransition,
  assertPrescriptionCanBeSigned,
  buildConsentEnforcementState,
  type ClinicalNoteVersionRecord,
  type ConsentRecord,
  type PrescriptionRecord
} from "../src/index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000101";
const patientId = "10000000-0000-4000-8000-000000002001";
const userId = "10000000-0000-4000-8000-000000001002";
const encounterId = "10000000-0000-4000-8000-000000010001";

test("consent enforcement exposes AI/audio blocking after revocation", () => {
  const created = consent("10000000-0000-4000-8000-000000011001", "ai_audio_capture", "active");
  const revoked = {
    ...created,
    status: "revoked" as const,
    revokedByUserId: userId,
    revokedAt: "2026-07-07T10:00:00.000Z",
    revocationReason: "Patient withdrew consent"
  };

  const activeState = buildConsentEnforcementState(patientId, [created]);
  assert.equal(activeState.aiAudioCaptureAllowed, true);
  assert.deepEqual(activeState.activePurposes, ["ai_audio_capture"]);

  const revokedState = buildConsentEnforcementState(patientId, [created, revoked]);
  assert.equal(revokedState.aiAudioCaptureAllowed, false);
  assert.deepEqual(revokedState.revokedPurposes, ["ai_audio_capture"]);
});

test("encounter and clinical note invariants reject unsafe transitions and empty signatures", () => {
  assert.doesNotThrow(() => assertEncounterTransition("scheduled", "drafting"));
  assert.throws(() => assertEncounterTransition("signed", "drafting"), /cannot transition/);

  const emptyDraft = note("draft", {});
  assert.throws(() => assertClinicalNoteCanBeSigned(emptyDraft), /content is required/);

  const populatedDraft = note("draft", { diagnosis: "Reversible pulpitis" });
  assert.doesNotThrow(() => assertClinicalNoteCanBeSigned(populatedDraft));

  const signed = note("signed", { diagnosis: "Reversible pulpitis" });
  assert.throws(() => assertClinicalNoteCanBeSigned(signed), /Only a draft/);
});

test("prescription signing requires a draft with at least one complete medication", () => {
  const draft = prescription("draft", [
    {
      name: "Amoxicillin",
      frequency: "BD",
      duration: "5 days"
    }
  ]);
  assert.doesNotThrow(() => assertPrescriptionCanBeSigned(draft));

  assert.throws(() => assertPrescriptionCanBeSigned(prescription("draft", [])), /at least one/);
  assert.throws(() => assertPrescriptionCanBeSigned(prescription("signed", draft.medications)), /Only a draft/);
});

function consent(
  id: string,
  purpose: ConsentRecord["purpose"],
  status: ConsentRecord["status"]
): ConsentRecord {
  return {
    id,
    tenantId,
    clinicId,
    patientId,
    purpose,
    status,
    templateCode: "privacy-v1",
    templateVersion: 1,
    captureMethod: "clinic_staff",
    grantedByName: "Rhea Synthetic",
    relationshipToPatient: "self",
    evidence: {},
    provenance: {},
    createdByUserId: userId,
    createdAt: "2026-07-07T09:00:00.000Z",
    revokedByUserId: null,
    revokedAt: null,
    revocationReason: null
  };
}

function note(
  status: ClinicalNoteVersionRecord["status"],
  content: ClinicalNoteVersionRecord["content"]
): ClinicalNoteVersionRecord {
  return {
    id: "10000000-0000-4000-8000-000000012001",
    tenantId,
    clinicId,
    encounterId,
    patientId,
    versionNumber: 1,
    status,
    content,
    amendmentReason: null,
    amendedFromVersionId: null,
    signedByUserId: status === "draft" ? null : userId,
    signedAt: status === "draft" ? null : "2026-07-07T10:00:00.000Z",
    createdByUserId: userId,
    createdAt: "2026-07-07T09:30:00.000Z"
  };
}

function prescription(
  status: PrescriptionRecord["status"],
  medications: PrescriptionRecord["medications"]
): PrescriptionRecord {
  return {
    id: "10000000-0000-4000-8000-000000013001",
    tenantId,
    clinicId,
    encounterId,
    patientId,
    status,
    medications,
    notes: null,
    createdByUserId: userId,
    createdAt: "2026-07-07T09:45:00.000Z",
    signedByUserId: status === "draft" ? null : userId,
    signedAt: status === "draft" ? null : "2026-07-07T10:00:00.000Z"
  };
}
