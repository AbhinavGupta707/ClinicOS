# Checkpoint 2 Synthetic QA Fixtures

This directory contains deterministic local/test-only data for the Checkpoint 2 lead, patient, appointment, confirmation, check-in, queue, and morning dashboard workflow.

These fixtures are not product seed data and must not be loaded into production. They use fixed UUIDs, `.example.test` email addresses, synthetic names, and reserved phone numbers so tests can make stable assertions without PHI.

## Files

- `lead_patient_appointment_flow.json` - canonical CP2 QA scenario, including tenants, clinic, role actors, leads, patients, appointments, dashboard snapshots, permission expectations, and audit/timeline requirements.

## Validation

Run the fixture contract validator:

```sh
node scripts/validate-cp2-fixtures.mjs
```

Run the plain Node acceptance tests:

```sh
node --test tests/acceptance/*.test.mjs
```

## Integration Use

After backend and frontend CP2 lanes are merged, the master integration branch should run:

```sh
node scripts/cp2-contract-smoke.mjs --dry-run
node scripts/cp2-contract-smoke.mjs --base-url http://127.0.0.1:4100
CLINICOS_CP2_E2E_ENABLED=true npx playwright test tests/e2e/checkpoint-2-assistant-flow.spec.ts
```

The live API smoke requires assistant, receptionist, accountant, and wrong-tenant assistant credentials via environment variables documented in `docs/qa/checkpoint-2-qa-fixtures.md`.
