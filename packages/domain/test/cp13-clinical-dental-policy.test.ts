import assert from "node:assert/strict";
import test from "node:test";
import type { ConsentEnforcementState } from "../src/clinical.ts";
import {
  applyDentalFindingWritePolicy,
  assertClinicalMediaBudget,
  evaluateClinicalConsent,
  CLINICAL_MEDIA_MAX_BYTES,
  ClinicalDentalPolicyError
} from "../src/cp13/clinical-dental/index.ts";

const baseConsent: ConsentEnforcementState = {
  patientId: "10000000-0000-4000-8000-000000002001",
  evaluatedAt: "2032-02-03T04:05:06.000Z",
  activePurposes: [],
  revokedPurposes: [],
  treatmentAllowed: false,
  whatsappCommunicationAllowed: false,
  marketingRecallAllowed: false,
  aiAudioCaptureAllowed: false,
  rawAudioRetentionAllowed: false,
  photoCaptureAllowed: false,
  photoSharingAllowed: false,
  abdmAbhaAllowed: false
};

test("CP13 consent policy gates treatment, photo capture, sharing, and audio independently", () => {
  assert.deepEqual(evaluateClinicalConsent(baseConsent, "encounter_start"), {
    allowed: false,
    workflow: "encounter_start",
    reason: "treatment_consent_required",
    evaluatedAt: baseConsent.evaluatedAt
  });
  assert.equal(
    evaluateClinicalConsent({ ...baseConsent, treatmentAllowed: true }, "encounter_start").allowed,
    true
  );
  assert.equal(
    evaluateClinicalConsent({ ...baseConsent, photoCaptureAllowed: true }, "media_complete", {
      mediaType: "intraoral_photo"
    }).allowed,
    true
  );
  assert.equal(
    evaluateClinicalConsent(
      { ...baseConsent, photoCaptureAllowed: true, photoSharingAllowed: false },
      "media_access",
      { mediaType: "xray" }
    ).reason,
    "photo_sharing_consent_required"
  );
  assert.equal(
    evaluateClinicalConsent({ ...baseConsent, aiAudioCaptureAllowed: true }, "media_receive", {
      mediaType: "audio_chunk"
    }).allowed,
    true
  );
});

test("CP13 dental policy preserves FDI integrity and keeps AI drafts non-authoritative", () => {
  const assistantDraft = applyDentalFindingWritePolicy(
    {
      toothNumber: "16",
      surface: "occlusal",
      findingType: "caries",
      source: "ai_draft",
      reviewStatus: "needs_review"
    },
    { actorIsDoctor: false }
  );
  assert.equal(assistantDraft.reviewStatus, "needs_review");

  assert.throws(
    () =>
      applyDentalFindingWritePolicy(
        { toothNumber: "19", findingType: "caries" },
        { actorIsDoctor: true }
      ),
    (error) => error instanceof ClinicalDentalPolicyError && error.code === "INVALID_DENTAL_FINDING"
  );
  assert.throws(
    () =>
      applyDentalFindingWritePolicy(
        { toothNumber: "16", findingType: "missing", surface: "occlusal" },
        { actorIsDoctor: true }
      ),
    /cannot carry a tooth surface/u
  );
  assert.throws(
    () =>
      applyDentalFindingWritePolicy(
        { toothNumber: "16", findingType: "caries", reviewStatus: "reviewed" },
        { actorIsDoctor: false }
      ),
    (error) => error instanceof ClinicalDentalPolicyError && error.code === "DOCTOR_REVIEW_REQUIRED"
  );
});

test("CP13 media budget rejects empty, oversized, and unsafe numeric lengths", () => {
  assert.doesNotThrow(() => assertClinicalMediaBudget(CLINICAL_MEDIA_MAX_BYTES));
  for (const value of [0, CLINICAL_MEDIA_MAX_BYTES + 1, Number.NaN, 1.25]) {
    assert.throws(
      () => assertClinicalMediaBudget(value),
      (error) => error instanceof ClinicalDentalPolicyError && error.code === "INVALID_MEDIA_BUDGET"
    );
  }
});
