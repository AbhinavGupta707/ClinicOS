# Checkpoint 4 Synthetic QA Fixtures

This directory contains deterministic local/test-only data for the Checkpoint 4 dental charting, media, and imaging coexistence workflow.

The fixtures are not product seed data and must not be loaded into production. They use fixed UUIDs, `.example.test` email addresses, reserved synthetic phone numbers, metadata-only imaging records, and no real radiographs or DICOM binaries.

## Files

- `dental_chart_media_imaging_flow.json` - canonical CP4 QA scenario, including tenants, clinic actors, encounter context, tooth-level findings, chart history, media upload/import/link metadata, DICOM metadata fixture, signed-access expectations, role/tenant denial contracts, timeline expectations, and browser selector contract.

## Validation

Run the fixture contract validator:

```sh
node scripts/validate-cp4-fixtures.mjs
```

Run the plain Node acceptance tests:

```sh
node --test tests/acceptance/*.test.mjs
```

## Integration Use

After the CP4 backend, dental domain, media backend, and UX lanes are merged, the master integration branch should run:

```sh
node scripts/cp4-contract-smoke.mjs --dry-run
node scripts/cp4-contract-smoke.mjs --base-url http://127.0.0.1:4100
CLINICOS_CP4_E2E_ENABLED=true npm exec playwright -- test tests/e2e/checkpoint-4-dental-media-flow.spec.ts
```

The live API smoke requires doctor, assistant, owner, accountant, and wrong-tenant assistant credentials via environment variables documented in `docs/qa/checkpoint-4-qa-fixtures.md`.
