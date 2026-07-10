import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CLINICAL_CARE_OPERATIONS } from "../src/modules/clinical-care/index.ts";
import { CLINICAL_MEDIA_OPERATIONS } from "../src/modules/clinical-media/index.ts";
import { DENTAL_TREATMENT_OPERATIONS } from "../src/modules/dental-treatment/index.ts";
import { DURABLE_INTEGRITY_OPERATIONS } from "../src/modules/durable-integrity/index.ts";

test("CP13 clinical/dental uses the frozen transaction-bound module operations", () => {
  for (const operation of [
    "listPatientConsents",
    "createConsent",
    "revokeConsent",
    "findEncounterById",
    "saveClinicalNoteDraft",
    "signClinicalNote",
    "amendClinicalNote",
    "createPrescription",
    "signPrescription"
  ]) {
    assert.ok(CLINICAL_CARE_OPERATIONS.includes(operation as never), operation);
  }
  for (const operation of [
    "getDentalChart",
    "createDentalFinding",
    "updateDentalFinding",
    "listDentalFindingHistory",
    "createDentalChartSnapshot"
  ]) {
    assert.ok(DENTAL_TREATMENT_OPERATIONS.includes(operation as never), operation);
  }
  for (const operation of [
    "createMediaUploadReservation",
    "findMediaUploadReservationById",
    "completeMediaUpload",
    "listPatientMediaAssets",
    "findMediaAssetById"
  ]) {
    assert.ok(CLINICAL_MEDIA_OPERATIONS.includes(operation as never), operation);
  }
});

test("CP13 canonical migration closes wrong-patient links and persists provider-owned receipts", async () => {
  const sql = await readFile(
    new URL("../migrations/0017_cp13_durable_integrity.sql", import.meta.url),
    "utf8"
  );
  for (const expected of [
    "encounters_cp13_appointment_patient_fk",
    "clinical_note_versions_cp13_encounter_patient_fk",
    "prescriptions_cp13_encounter_patient_fk",
    "dental_findings_cp13_encounter_patient_fk",
    "media_uploads_cp13_encounter_patient_fk",
    "media_uploads_cp13_finding_patient_fk",
    "media_assets_cp13_encounter_patient_fk",
    "media_assets_cp13_finding_patient_fk",
    "create table clinical_media_receipts",
    "receipt_fingerprint",
    "provider_artifact_fingerprint",
    "clinical_media_receipts_state_consistency_check",
    "alter table clinical_media_receipts force row level security"
  ]) {
    assert.match(sql, new RegExp(expected), expected);
  }
  assert.ok(DURABLE_INTEGRITY_OPERATIONS.includes("recordClinicalMediaReceipt"));
  assert.ok(DURABLE_INTEGRITY_OPERATIONS.includes("findProviderEligibility"));
  assert.match(sql, /references patients\(tenant_id, clinic_id, id\) on delete restrict/u);
  assert.match(sql, /existing clinical media rows may retain client original filenames/u);
  assert.doesNotMatch(sql, /patients\s*\(tenant_id, primary_clinic_id/u);
  assert.doesNotMatch(sql, /provider_artifact_reference|object_version text/u);
});
