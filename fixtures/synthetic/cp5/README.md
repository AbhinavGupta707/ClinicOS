# Checkpoint 5 Synthetic QA Fixtures

This directory contains deterministic local/test-only data for the Checkpoint 5 treatment checkout, payment, receipt, prescription, and instruction workflow.

The fixtures are not product seed data and must not be loaded into production. They use fixed UUIDs, `.example.test` email addresses, reserved synthetic phone numbers, provider simulator references, and no real PHI or payment credentials.

## Files

- `treatment_checkout_payments_flow.json` - canonical CP5 QA scenario, including treatment plan and estimate state, completed procedure billing, invoice and payment request contracts, verified/rejected/replayed payment webhook cases, manual payment audit evidence, receipt generation, prescription sign-off regression, instruction print/send requests, role/tenant denial contracts, timeline expectations, and browser selector contract.

## Validation

Run the fixture contract validator:

```sh
node scripts/validate-cp5-fixtures.mjs
```

Run the plain Node acceptance tests:

```sh
node --test tests/acceptance/cp5-fixture-contract.test.mjs
```

## Integration Use

After the CP5 billing, payment provider, checkout UX, and QA lane outputs are merged, the master integration branch should run:

```sh
node scripts/cp5-contract-smoke.mjs --dry-run
node scripts/cp5-contract-smoke.mjs --base-url http://127.0.0.1:4100
CLINICOS_CP5_E2E_ENABLED=true npm exec playwright -- test tests/e2e/checkpoint-5-checkout-flow.spec.ts
```

The live API smoke requires doctor, assistant, receptionist, accountant, owner, wrong-tenant assistant, and provider-simulator credentials or local fixture headers as documented in `docs/qa/checkpoint-5-qa-fixtures.md`.
