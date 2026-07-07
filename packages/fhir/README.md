# FHIR Package

FHIR R4 projection, validation fixtures, ABDM readiness helpers, and interoperability tests.

## Checkpoint 9 Scope

- Projects ClinicOS source-of-truth records into FHIR R4-shaped exchange bundles.
- Covers patient, encounter, clinical-note `Composition`, clinical evidence `DocumentReference`, and `Provenance` for the CP9 vertical slice.
- Validates structural invariants locally: bundle/resource IDs, local references, required resource types, `meta.profile` presence, and privacy markers such as object keys or raw storage paths.
- Models ABDM readiness only. Empty ABDM credentials produce `not_configured` and `unavailable` readiness with `fixture_only` exchange mode; no live ABDM client is implemented here.

The canonical CP9 sample is `fixtures/synthetic/cp9/fhir_abdm_readiness_fixture.json`.
