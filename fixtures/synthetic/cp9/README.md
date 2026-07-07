# Checkpoint 9 Synthetic Fixtures

These fixtures are deterministic, synthetic, and local/test-only. They must not contain real PHI, production secrets, real ABHA identifiers, live provider payloads, or production export artifacts.

## FHIR/ABDM

- `fhir_abdm_readiness_fixture.json` contains a ClinicOS source-evidence snapshot, the generated FHIR R4-shaped patient/encounter/document bundle, and the ABDM readiness result for empty ABDM credentials.
- ABDM fields are intentionally feature-gated and unavailable for live exchange in this fixture. Do not use this fixture to call ABDM sandbox or production endpoints.
- Document evidence uses mediated `urn:clinicos:` references only. It must not include object keys, raw storage paths, bucket names, or signed URLs.

## Performance QA

- `performance_qa_flow.json` covers performance, tenant-isolation, and browser QA evidence.
- CP9 Security/Privacy route contracts use the canonical merged API routes. FHIR remains projection-package evidence until a later checkpoint adds a live FHIR API route.
- The load smoke uses only local synthetic data and read-oriented clinic-hours endpoints unless explicitly configured with a live base URL.
- Browser smoke must verify registered CP9 surfaces honestly show unavailable state until a lane activates a real CP9 product workflow.

Run:

```sh
node scripts/validate-cp9-fixtures.mjs
node scripts/cp9-contract-smoke.mjs --dry-run
node scripts/cp9-load-smoke.mjs --dry-run
node --test tests/acceptance/cp9-fixture-contract.test.mjs
```
