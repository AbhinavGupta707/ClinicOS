import assert from "node:assert/strict";
import test from "node:test";
import {
  assertClinicalSummaryAuthorizedScope,
  buildClinicalSummaryDocument,
  ClinicOsFhirError,
  clinicalSummaryPatientIdentifiers,
  decideExactAuthorizedEncounterMatch,
  decideExactAuthorizedPatientMatch,
  minimizeClinicalSummaryImport,
  parseClinicalSummaryDocument
} from "../src/index.ts";
import { consentFixture, GENERATED_AT, IDS, sourceFixture } from "./cp16-fixture.ts";

test("CP16 import parses bounded JSON, binds scope, minimizes data and matches one exact patient", () => {
  const artifact = artifactFixture();
  const parsed = parseClinicalSummaryDocument(JSON.stringify(artifact.bundle));
  assertClinicalSummaryAuthorizedScope(parsed, {
    tenantId: IDS.tenant,
    clinicId: IDS.clinic,
    patientId: IDS.patient
  });
  const identifiers = clinicalSummaryPatientIdentifiers(parsed);
  const decision = decideExactAuthorizedPatientMatch({
    identifiers,
    expectedPatientVersion: 4,
    scope: { tenantId: IDS.tenant, clinicId: IDS.clinic, patientId: IDS.patient },
    candidates: [
      {
        tenantId: IDS.tenant,
        clinicId: IDS.clinic,
        patientId: IDS.patient,
        rowVersion: 4,
        identifiers
      }
    ]
  });
  assert.equal(decision.kind, "matched");
  const minimized = minimizeClinicalSummaryImport(parsed);
  const encounterDecision = decideExactAuthorizedEncounterMatch({
    candidates: [
      {
        tenantId: IDS.tenant,
        clinicId: IDS.clinic,
        patientId: IDS.patient,
        encounterId: IDS.encounter,
        rowVersion: 7,
        identifiers: [minimized.encounter.identifier]
      }
    ],
    expectedEncounterVersion: minimized.encounter.version,
    identifier: minimized.encounter.identifier,
    scope: { tenantId: IDS.tenant, clinicId: IDS.clinic, patientId: IDS.patient }
  });
  assert.equal(encounterDecision.kind, "matched");
  assert.equal(minimized.encounter.version, 7);
  assert.equal(minimized.medicationRequests.length, 1);
  assert.equal(minimized.bundleDigest.value, artifact.digest.value);
});

test("CP16 import quarantines missing, ambiguous, cross-patient and stale encounter matches", () => {
  const minimized = minimizeClinicalSummaryImport(artifactFixture().bundle);
  const base = {
    expectedEncounterVersion: 7,
    identifier: minimized.encounter.identifier,
    scope: { tenantId: IDS.tenant, clinicId: IDS.clinic, patientId: IDS.patient }
  };
  const candidate = {
    tenantId: IDS.tenant,
    clinicId: IDS.clinic,
    patientId: IDS.patient,
    encounterId: IDS.encounter,
    rowVersion: 7,
    identifiers: [minimized.encounter.identifier]
  };
  assert.equal(
    decideExactAuthorizedEncounterMatch({ ...base, candidates: [] }).reason,
    "missing_exact_encounter_match"
  );
  assert.equal(
    decideExactAuthorizedEncounterMatch({
      ...base,
      candidates: [candidate, { ...candidate }]
    }).reason,
    "ambiguous_exact_encounter_match"
  );
  assert.equal(
    decideExactAuthorizedEncounterMatch({
      ...base,
      candidates: [{ ...candidate, patientId: "30000000-0000-4000-8000-000000000011" }]
    }).reason,
    "missing_exact_encounter_match"
  );
  assert.equal(
    decideExactAuthorizedEncounterMatch({
      ...base,
      candidates: [{ ...candidate, encounterId: "30000000-0000-4000-8000-000000000011" }]
    }).reason,
    "target_encounter_mismatch"
  );
  assert.equal(
    decideExactAuthorizedEncounterMatch({
      ...base,
      candidates: [{ ...candidate, rowVersion: 8 }]
    }).reason,
    "encounter_version_conflict"
  );
});

test("CP16 import quarantines missing, ambiguous, wrong-target and stale exact matches", () => {
  const identifiers = clinicalSummaryPatientIdentifiers(artifactFixture().bundle);
  const base = {
    identifiers,
    expectedPatientVersion: 4,
    scope: { tenantId: IDS.tenant, clinicId: IDS.clinic, patientId: IDS.patient }
  };
  assert.equal(
    decideExactAuthorizedPatientMatch({ ...base, candidates: [] }).reason,
    "missing_exact_match"
  );
  const candidate = {
    tenantId: IDS.tenant,
    clinicId: IDS.clinic,
    patientId: IDS.patient,
    rowVersion: 4,
    identifiers
  };
  assert.equal(
    decideExactAuthorizedPatientMatch({
      ...base,
      candidates: [candidate, { ...candidate, patientId: "30000000-0000-4000-8000-000000000011" }]
    }).reason,
    "ambiguous_exact_match"
  );
  assert.equal(
    decideExactAuthorizedPatientMatch({
      ...base,
      candidates: [{ ...candidate, patientId: "30000000-0000-4000-8000-000000000011" }]
    }).reason,
    "target_patient_mismatch"
  );
  assert.equal(
    decideExactAuthorizedPatientMatch({ ...base, candidates: [{ ...candidate, rowVersion: 5 }] })
      .reason,
    "patient_version_conflict"
  );
});

test("CP16 import rejects arbitrary URLs, extensions, missing closure and oversized strings", () => {
  assert.throws(
    () => parseClinicalSummaryDocument(Uint8Array.from([0xff, 0xfe])),
    (error) => error instanceof ClinicOsFhirError && error.httpStatus === 400
  );

  const urlBundle = structuredClone(artifactFixture().bundle);
  const documentReference = urlBundle.entry.find(
    (entry) => entry.resource.resourceType === "DocumentReference"
  ).resource;
  documentReference.content[0].attachment.url = "https://attacker.invalid/phi";
  assert.throws(
    () => parseClinicalSummaryDocument(JSON.stringify(urlBundle)),
    (error) => error instanceof ClinicOsFhirError && error.httpStatus === 422
  );

  const arbitrarySystem = structuredClone(artifactFixture().bundle);
  const patient = arbitrarySystem.entry.find(
    (entry) => entry.resource.resourceType === "Patient"
  ).resource;
  patient.identifier.push({
    system: "urn:attacker:unregistered-system",
    value: "covert-identifier"
  });
  assert.throws(
    () => parseClinicalSummaryDocument(JSON.stringify(arbitrarySystem)),
    (error) => error instanceof ClinicOsFhirError && error.httpStatus === 422
  );

  const unknownNestedField = structuredClone(artifactFixture().bundle);
  unknownNestedField.entry[1].resource.name[0].unregistered = "covert-field";
  assert.throws(
    () => parseClinicalSummaryDocument(JSON.stringify(unknownNestedField)),
    (error) => error instanceof ClinicOsFhirError && error.httpStatus === 422
  );

  const malformedNestedShape = structuredClone(artifactFixture().bundle);
  const malformedEncounter = malformedNestedShape.entry.find(
    (entry) => entry.resource.resourceType === "Encounter"
  ).resource;
  malformedEncounter.class = null;
  assert.throws(
    () => parseClinicalSummaryDocument(JSON.stringify(malformedNestedShape)),
    (error) => error instanceof ClinicOsFhirError && error.httpStatus === 422
  );

  const extensionBundle = structuredClone(artifactFixture().bundle);
  extensionBundle.entry[1].resource.extension = [
    { url: "https://attacker.invalid/ext", valueString: "x" }
  ];
  assert.throws(
    () => parseClinicalSummaryDocument(JSON.stringify(extensionBundle)),
    ClinicOsFhirError
  );

  const missingReference = structuredClone(artifactFixture().bundle);
  const encounter = missingReference.entry.find(
    (entry) => entry.resource.resourceType === "Encounter"
  ).resource;
  encounter.subject.reference = "Patient/30000000-0000-4000-8000-000000009999";
  assert.throws(
    () => parseClinicalSummaryDocument(JSON.stringify(missingReference)),
    ClinicOsFhirError
  );

  const crossBoundGraph = structuredClone(artifactFixture().bundle);
  const clinic = crossBoundGraph.entry.find(
    (entry) => entry.resource.resourceType === "Organization" && entry.resource.id === IDS.clinic
  ).resource;
  clinic.partOf.reference = `Organization/${IDS.clinic}`;
  assert.throws(
    () => parseClinicalSummaryDocument(JSON.stringify(crossBoundGraph)),
    (error) => error instanceof ClinicOsFhirError && error.httpStatus === 422
  );

  assert.throws(
    () =>
      parseClinicalSummaryDocument(
        JSON.stringify({ ...artifactFixture().bundle, padding: "x".repeat(101) }),
        {
          maxBytes: 2_000_000,
          maxDepth: 24,
          maxEntries: 256,
          maxObjectKeys: 20_000,
          maxStringLength: 100,
          maxStrings: 10_000
        }
      ),
    (error) => error instanceof ClinicOsFhirError && error.httpStatus === 413
  );
});

function artifactFixture() {
  return buildClinicalSummaryDocument({
    actor: { userId: IDS.actor, displayName: "Dr Synthetic" },
    bundleId: IDS.bundle,
    consent: consentFixture(),
    generatedAt: GENERATED_AT,
    source: sourceFixture()
  });
}
