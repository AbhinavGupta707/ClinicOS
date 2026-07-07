import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildClinicOsPatientEncounterDocumentBundle,
  validateClinicOsFhirBundle
} from "../src/index.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp9",
  "fhir_abdm_readiness_fixture.json"
);

test("CP9 projection generates the deterministic patient encounter document bundle", async () => {
  const fixture = await loadFixture();
  const projectedBundle = buildClinicOsPatientEncounterDocumentBundle(fixture.sourceEvidence);

  assert.deepEqual(projectedBundle, fixture.fhirBundle);

  const validation = validateClinicOsFhirBundle(projectedBundle, {
    forbiddenSerializedSubstrings: fixture.validationExpectations.forbiddenSerializedSubstrings,
    requiredResourceTypes: fixture.validationExpectations.requiredResourceTypes
  });

  assert.equal(validation.valid, true, validation.errors.join("\n"));
  assert.deepEqual(validation.summary.resourceCounts, {
    Composition: 1,
    DocumentReference: 1,
    Encounter: 1,
    Organization: 1,
    Patient: 1,
    Practitioner: 1,
    Provenance: 1
  });
});

test("CP9 FHIR document evidence does not leak storage internals", async () => {
  const fixture = await loadFixture();
  const serialized = JSON.stringify(fixture.fhirBundle);

  for (const forbidden of fixture.validationExpectations.forbiddenSerializedSubstrings) {
    assert.equal(serialized.includes(forbidden), false, `${forbidden} leaked into FHIR bundle`);
  }

  const documentReference = fixture.fhirBundle.entry
    .map((entry) => entry.resource)
    .find((resource) => resource.resourceType === "DocumentReference");

  assert.equal(
    documentReference.content[0].attachment.url,
    "urn:clinicos:document-evidence:30000000-0000-4000-8000-000000009102"
  );
  assert.equal(documentReference.subject.reference, "Patient/30000000-0000-4000-8000-000000002001");
  assert.equal(
    documentReference.context.encounter[0].reference,
    "Encounter/30000000-0000-4000-8000-000000008001"
  );
});

async function loadFixture() {
  return JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
}
