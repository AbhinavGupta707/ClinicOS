import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildClinicOsPatientEncounterDocumentBundle,
  evaluateAbdmReadiness,
  validateClinicOsFhirBundle
} from "../../packages/fhir/src/index.ts";

const FIXTURE_PATH = new URL(
  "../../fixtures/synthetic/cp9/fhir_abdm_readiness_fixture.json",
  import.meta.url
);

test("CP9 FHIR/ABDM fixture contract validates locally without network validators", async () => {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const projectedBundle = buildClinicOsPatientEncounterDocumentBundle(fixture.sourceEvidence);

  assert.deepEqual(projectedBundle, fixture.fhirBundle);

  const validation = validateClinicOsFhirBundle(fixture.fhirBundle, {
    forbiddenSerializedSubstrings: fixture.validationExpectations.forbiddenSerializedSubstrings,
    requiredResourceTypes: fixture.validationExpectations.requiredResourceTypes
  });

  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.equal(validation.summary.entries, 7);
  assert.equal(validation.summary.resourceCounts.Patient, 1);
  assert.equal(validation.summary.resourceCounts.Encounter, 1);
  assert.equal(validation.summary.resourceCounts.DocumentReference, 1);

  const readiness = evaluateAbdmReadiness(fixture.abdmReadiness.input);
  assert.deepEqual(readiness, fixture.abdmReadiness.expected);
  assert.equal(readiness.configurationStatus, "not_configured");
  assert.equal(readiness.availabilityStatus, "unavailable");
  assert.equal(readiness.liveExchangeAllowed, false);
});
