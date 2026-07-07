import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateClinicOsFhirBundle } from "../src/index.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp9",
  "fhir_abdm_readiness_fixture.json"
);

test("CP9 local FHIR validator catches missing references", async () => {
  const fixture = await loadFixture();
  const brokenBundle = structuredClone(fixture.fhirBundle);
  const encounter = brokenBundle.entry
    .map((entry) => entry.resource)
    .find((resource) => resource.resourceType === "Encounter");

  encounter.subject.reference = "Patient/missing-patient";

  const validation = validateClinicOsFhirBundle(brokenBundle, {
    requiredResourceTypes: fixture.validationExpectations.requiredResourceTypes
  });

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) => error.includes("Patient/missing-patient")),
    validation.errors.join("\n")
  );
});

test("CP9 local FHIR validator requires profile-ish metadata", async () => {
  const fixture = await loadFixture();
  const brokenBundle = structuredClone(fixture.fhirBundle);
  const patient = brokenBundle.entry
    .map((entry) => entry.resource)
    .find((resource) => resource.resourceType === "Patient");

  patient.meta.profile = [];

  const validation = validateClinicOsFhirBundle(brokenBundle);

  assert.equal(validation.valid, false);
  assert.ok(
    validation.errors.some((error) =>
      error.includes("Patient/30000000-0000-4000-8000-000000002001 meta.profile")
    ),
    validation.errors.join("\n")
  );
});

async function loadFixture() {
  return JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
}
