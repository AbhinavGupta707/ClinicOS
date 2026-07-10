import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CLINICAL_CARE_OPERATIONS } from "../src/modules/clinical-care/index.ts";
import { CLINICAL_MEDIA_OPERATIONS } from "../src/modules/clinical-media/index.ts";
import { DENTAL_TREATMENT_OPERATIONS } from "../src/modules/dental-treatment/index.ts";

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

test("CP13 schema proposal closes wrong-patient links and proposes provider-owned content receipts", async () => {
  const sql = await readFile(
    new URL("../schema-proposals/cp13/clinical-dental.sql", import.meta.url),
    "utf8"
  );
  for (const expected of [
    "encounters_cp13_appointment_patient_fk",
    "clinical_notes_cp13_encounter_patient_fk",
    "prescriptions_cp13_encounter_patient_fk",
    "dental_findings_cp13_encounter_patient_fk",
    "media_uploads_cp13_encounter_patient_fk",
    "media_uploads_cp13_finding_patient_fk",
    "media_assets_cp13_encounter_patient_fk",
    "media_assets_cp13_finding_patient_fk",
    "content_received_at",
    "received_content_length",
    "received_mime_type",
    "received_sha256_digest",
    "received_object_version",
    "media_uploads_cp13_received_content_consistent"
  ]) {
    assert.match(sql, new RegExp(expected), expected);
  }
  assert.match(sql, /on delete set null \(appointment_id\)/u);
  assert.match(sql, /on delete set null \(encounter_id\)/u);
  assert.match(sql, /on delete set null \(dental_finding_id\)/u);
  assert.match(sql, /on patients \(tenant_id, clinic_id, id\)/u);
  assert.match(sql, /references patients \(tenant_id, clinic_id, id\) on delete restrict/u);
  assert.match(
    sql,
    /clinical_notes_cp13_encounter_patient_fk[\s\S]*?references encounters \(tenant_id, clinic_id, id, patient_id\) on delete restrict/u
  );
  assert.match(
    sql,
    /prescriptions_cp13_encounter_patient_fk[\s\S]*?references encounters \(tenant_id, clinic_id, id, patient_id\) on delete restrict/u
  );
  assert.doesNotMatch(sql, /primary_clinic_id|on delete cascade/u);
  assert.match(sql, /This is not a canonical migration/u);
  assert.doesNotMatch(sql, /scan_status\s*=\s*:/u);
});
