# Checkpoint 3 Synthetic QA Fixtures

This directory contains deterministic local/test-only data for the Checkpoint 3 intake, consent, encounter, clinical note, amendment, prescription, and consent-enforcement workflow.

These fixtures are not product seed data and must not be loaded into production. They use fixed UUIDs, `.example.test` email addresses, synthetic names, and reserved phone numbers so tests can make stable assertions without PHI.

## Files

- `intake_consent_encounter_flow.json` - canonical CP3 QA scenario, including tenants, clinic, role actors, patients, appointments, intake responses, consent records, encounter state, clinical note versions, prescription state, role/tenant denials, audit/timeline requirements, and browser selector contract.

## Validation

Run the fixture contract validator:

```sh
node scripts/validate-cp3-fixtures.mjs
```

Run the plain Node acceptance tests:

```sh
node --test tests/acceptance/*.test.mjs
```

## Integration Use

After backend, security, and frontend CP3 lanes are merged, the master integration branch should run:

```sh
node scripts/cp3-contract-smoke.mjs --dry-run
node scripts/cp3-contract-smoke.mjs --base-url http://127.0.0.1:4100
CLINICOS_CP3_E2E_ENABLED=true ./node_modules/.bin/playwright test tests/e2e/checkpoint-3-clinical-flow.spec.ts
```

The live API smoke requires doctor, assistant, owner, accountant, receptionist, and wrong-tenant assistant credentials via environment variables documented in `docs/qa/checkpoint-3-qa-fixtures.md`.
