# Checkpoint 9 FHIR/ABDM Fixtures

These fixtures are deterministic, synthetic, and local/test-only.

- `fhir_abdm_readiness_fixture.json` contains a ClinicOS source-evidence snapshot, the generated FHIR R4-shaped patient/encounter/document bundle, and the ABDM readiness result for empty ABDM credentials.
- ABDM fields are intentionally feature-gated and unavailable for live exchange in this fixture. Do not use this fixture to call ABDM sandbox or production endpoints.
- Document evidence uses mediated `urn:clinicos:` references only. It must not include object keys, raw storage paths, bucket names, or signed URLs.
