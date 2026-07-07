# Checkpoint 10 Synthetic Fixtures

These fixtures are deterministic, synthetic, and local/test-only. They support CP10
release-candidate pilot-readiness and end-to-end QA evidence without real PHI,
live provider activation, cloud mutation, GitHub push, ABDM calls, or
physical-device flows.

They are not seed data for a real clinic.

## Fixtures

- `pilot_readiness_configuration.json` describes a synthetic local pilot clinic
  that is ready for configuration review while still blocked or deferred for
  external go-live evidence such as signed provider webhooks, AWS apply, live
  restore, remote CI, ABDM, and device smoke.
- `clinic_day_regression_flow.json` indexes the implemented dental-first clinic
  day from lead capture through owner dashboard. It records role-matrix,
  tenant-isolation, provider no-credential/unavailable, migration dry-run, and
  browser smoke expectations.

The clinic-day fixture references earlier checkpoint fixtures and smokes for
implementation evidence instead of inventing new product routes.

## Run

```sh
node scripts/validate-cp10-fixtures.mjs
node scripts/cp10-contract-smoke.mjs --dry-run
node --test tests/acceptance/cp10-fixture-contract.test.mjs
```

Browser smoke is gated because it requires a running web app with checkpoint
fixture flags enabled:

```sh
CLINICOS_CP10_E2E_ENABLED=true \
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP2_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP3_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP4_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP5_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP6_OPERATIONS_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP7_INTEGRATION_OPS_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP8_REVIEW_FIXTURE=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3110 \
npx playwright test tests/e2e/checkpoint-10-clinic-day-flow.spec.ts
```

Run role-specific cases with `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant`,
`owner`, and `platform_admin`.
