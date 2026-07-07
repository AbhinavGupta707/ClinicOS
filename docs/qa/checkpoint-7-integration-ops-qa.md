# Checkpoint 7 Integration Ops QA

This fixture and smoke path is local/test-only. It makes provider availability, failed-event replay, and migration safety visible without claiming live provider success.

## Fixture Files

- `fixtures/synthetic/cp7/integration_ops_migration_flow.json`
- `apps/web/lib/cp7-integration-ops.ts`
- `tests/e2e/checkpoint-7-integration-ops-flow.spec.ts`

## Validation

```sh
node scripts/validate-cp7-fixtures.mjs
node scripts/cp7-contract-smoke.mjs --dry-run
```

The dry-run pins this route-family assumption for the integration branch:

- `GET /v1/provider-health`
- `GET /v1/dead-letter-events?status=unreviewed`
- `POST /v1/dead-letter-events/{deadLetterEventId}/replay`
- `GET /v1/migration-batches?status=needs_review`
- `GET /v1/migration-batches/{migrationBatchId}`
- `POST /v1/migration-batches/{migrationBatchId}/rows/{rowId}/resolve`
- `POST /v1/migration-batches/{migrationBatchId}/commit`

If the backend lanes merge different route names, reconcile the web helper and dry-run script in the checkpoint integration branch before claiming CP7 completion.

## Browser Smoke

Start the web app with explicit CP7 fixture flags and an owner role:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner \
NEXT_PUBLIC_CLINIC_OS_USE_CP7_INTEGRATION_OPS_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=development \
npm --workspace @clinic-os/web run dev -- --hostname 127.0.0.1 --port 3000
```

Run:

```sh
CLINICOS_CP7_E2E_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 \
npx playwright test tests/e2e/checkpoint-7-integration-ops-flow.spec.ts
```

Expected screenshots:

- `/private/tmp/clinicos-cp7-integration-ops-desktop.png`
- `/private/tmp/clinicos-cp7-integration-ops-mobile-390.png`

## Honest States Covered

- WhatsApp Cloud: `configured/degraded`, because sandbox credentials may exist but deployed verified callbacks and live-send evidence are not claimed.
- Telephony: `unavailable`, with manual missed-call recovery called out as the safe fallback.
- Google Business Profile: `manual/source only`, with no live Google API dependency.
- Razorpay: `webhook URL missing`, preserving CP5 payment truth until signed webhook callback registration exists.
- Dead-letter replay: fixture replay records review evidence only; it does not advance provider-confirmed patient message state.
- Migration review: duplicate conflict resolution is required before commit, rejected rows stay out, and verified ClinicOS records are not overwritten silently.

## Live API Note

Fixture UI smoke does not prove the backend routes. The web helper route shapes are unit-tested in `apps/web/tests/cp7-integration-ops.test.ts`; full live smoke should be rerun after Messaging, Telephony/Source, and Migration/Data lanes merge their backend contracts.
