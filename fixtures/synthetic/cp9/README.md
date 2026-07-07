# CP9 Performance QA Fixtures

This directory contains deterministic, synthetic-only fixtures for Checkpoint 9 performance, tenant-isolation, and browser QA evidence.

- `performance_qa_flow.json` is local/test-only and must not contain real PHI, production secrets, real ABHA identifiers, live provider payloads, or production export artifacts.
- CP9 compliance, FHIR, retention, and break-glass route contracts are fixture dry-run evidence until the Security/Privacy and FHIR/ABDM lanes publish canonical live routes.
- The load smoke uses only local synthetic data and read-oriented clinic-hours endpoints unless explicitly configured with a live base URL.
- Browser smoke must verify registered CP9 surfaces honestly show unavailable state until a lane activates a real CP9 product workflow.

Run:

```sh
node scripts/validate-cp9-fixtures.mjs
node scripts/cp9-contract-smoke.mjs --dry-run
node scripts/cp9-load-smoke.mjs --dry-run
node --test tests/acceptance/cp9-fixture-contract.test.mjs
```
