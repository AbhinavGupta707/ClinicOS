import assert from "node:assert/strict";
import test from "node:test";
import {
  buildClinicalSummaryDocument,
  canonicalizeClinicOsJson,
  ClinicOsFhirError,
  clinicOsFhirR4CapabilityStatement,
  officialAbdmValidatorCommand,
  officialFhirR4ValidatorCommand,
  validateClinicalSummaryDocument
} from "../src/index.ts";
import { consentFixture, GENERATED_AT, IDS, sourceFixture } from "./cp16-fixture.ts";

test("CP16 export builds a deterministic closed FHIR R4 document with consent and provenance", () => {
  const artifact = buildClinicalSummaryDocument({
    actor: { userId: IDS.actor, displayName: "Dr Synthetic" },
    bundleId: IDS.bundle,
    consent: consentFixture(),
    generatedAt: GENERATED_AT,
    source: sourceFixture()
  });
  const repeated = buildClinicalSummaryDocument({
    actor: { userId: IDS.actor, displayName: "Dr Synthetic" },
    bundleId: IDS.bundle,
    consent: consentFixture(),
    generatedAt: GENERATED_AT,
    source: sourceFixture()
  });

  assert.equal(artifact.bundle.type, "document");
  assert.equal(artifact.bundle.entry[0].resource.resourceType, "Composition");
  assert.equal(artifact.digest.value, repeated.digest.value);
  assert.equal(
    canonicalizeClinicOsJson(artifact.bundle),
    canonicalizeClinicOsJson(repeated.bundle)
  );
  assert.deepEqual(
    artifact.bundle.entry.map((entry) => entry.resource.resourceType),
    [
      "Composition",
      "Patient",
      "Encounter",
      "Practitioner",
      "Organization",
      "Organization",
      "Consent",
      "DocumentReference",
      "MedicationRequest",
      "Provenance"
    ]
  );
  const documentReference = artifact.bundle.entry.find(
    (entry) => entry.resource.resourceType === "DocumentReference"
  )?.resource;
  assert.equal(
    documentReference?.resourceType === "DocumentReference"
      ? documentReference.content[0]?.attachment.hash
      : null,
    Buffer.from("a".repeat(64), "hex").toString("base64")
  );

  const validation = validateClinicalSummaryDocument(artifact.bundle);
  assert.equal(validation.valid, true, JSON.stringify(validation.outcome));
});

test("CP16 export rejects invalid clinical timelines and unbounded optional source text", () => {
  const future = sourceFixture();
  assert.throws(
    () =>
      buildClinicalSummaryDocument({
        actor: { userId: IDS.actor, displayName: "Dr Synthetic" },
        bundleId: IDS.bundle,
        consent: consentFixture(),
        generatedAt: GENERATED_AT,
        source: {
          ...future,
          encounter: { ...future.encounter, closedAt: "2026-07-14T11:00:00.000Z" }
        }
      }),
    (error) =>
      error instanceof ClinicOsFhirError &&
      error.outcome.issue[0].details.coding[0].code === "FHIR_SOURCE_TIMELINE_INVALID"
  );

  const unbounded = sourceFixture();
  assert.throws(
    () =>
      buildClinicalSummaryDocument({
        actor: { userId: IDS.actor, displayName: "Dr Synthetic" },
        bundleId: IDS.bundle,
        consent: consentFixture(),
        generatedAt: GENERATED_AT,
        source: {
          ...unbounded,
          prescriptions: unbounded.prescriptions.map((prescription) => ({
            ...prescription,
            notes: "x".repeat(2_001)
          }))
        }
      }),
    ClinicOsFhirError
  );
});

test("CP16 export fails closed for revoked consent and cross-tenant source rows", () => {
  assert.throws(
    () =>
      buildClinicalSummaryDocument({
        actor: { userId: IDS.actor, displayName: "Dr Synthetic" },
        bundleId: IDS.bundle,
        consent: consentFixture({ status: "revoked", revokedAt: GENERATED_AT }),
        generatedAt: GENERATED_AT,
        source: sourceFixture()
      }),
    (error) =>
      error instanceof ClinicOsFhirError &&
      error.outcome.issue[0].details.coding[0].code === "FHIR_CONSENT_REVOKED"
  );

  const source = sourceFixture();
  const wrongScope = {
    ...source,
    patient: { ...source.patient, tenantId: "40000000-0000-4000-8000-000000000001" }
  };
  assert.throws(
    () =>
      buildClinicalSummaryDocument({
        actor: { userId: IDS.actor, displayName: "Dr Synthetic" },
        bundleId: IDS.bundle,
        consent: consentFixture(),
        generatedAt: GENERATED_AT,
        source: wrongScope
      }),
    (error) => error instanceof ClinicOsFhirError && error.httpStatus === 403
  );
});

test("CP16 capability is versioned R4 core and validator contracts keep ABDM 6.5.0 separate", () => {
  const capability = clinicOsFhirR4CapabilityStatement();
  assert.equal(capability.fhirVersion, "4.0.1");
  assert.equal(capability.version, "1.0.0");
  assert.deepEqual(
    capability.document.map((document) => document.mode),
    ["producer", "consumer"]
  );

  const core = officialFhirR4ValidatorCommand({
    validatorJarPath: "/opt/fhir/validator_cli.jar",
    artifactPath: "/restricted/clinical-summary.json"
  });
  const abdm = officialAbdmValidatorCommand({
    validatorJarPath: "/opt/fhir/validator_cli.jar",
    artifactPath: "/restricted/abdm-document.json"
  });
  assert.equal(core.evidenceState, "E4_pending");
  assert.equal(core.args.includes("ndhm.in#6.5.0"), false);
  assert.equal(abdm.args.includes("ndhm.in#6.5.0"), true);
});
