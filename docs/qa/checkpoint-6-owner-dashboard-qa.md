# Checkpoint 6 Owner Dashboard And QA Harness

This QA pack belongs to the Checkpoint 6 continuity operations and owner-dashboard slice.

## Implemented Route

- `GET /v1/owner-dashboard?from=&to=`

Authorization:

- `analytics.read` is required.
- Owner/admin and accountant analytics roles are allowed.
- Assistant roles are denied for owner analytics.
- The response is aggregate-only and excludes patient names, phone numbers, medical history, clinical summaries, and free-text clinical detail.

## Metric Sources

The projection is computed by `buildOwnerDashboardProjection` in `packages/domain/src/dashboard.ts`.

Live Postgres source rows:

- `patients`, `leads`, `appointments`, `encounters`, and `attribution_touches` for new-patient, no-show, and source attribution.
- `treatment_plans`, `procedure_performed_records`, `invoices`, and `payment_transactions` for treatment/payment leakage and source-attributed revenue.
- `tasks` for current task and recall-task aggregation.

Local/test CP6 fixture source rows:

- `fixtures/synthetic/cp6/continuity_owner_dashboard_flow.json`.
- Explicit local fixture projection rows are wired through `LocalFixtureClinicOperationsRepository.loadOwnerDashboardProjectionData`.
- The fixture is marked local/dev/test/CI only and is denied for production use.

Schema dependencies for integration:

- Workflow/Task Backend: durable recall rules, recall actions, SOP runs, and richer task completion records.
- Lab/Inventory/Event: durable lab cases, lab reconciliations, inventory exceptions, incidents, and corrective actions.
- Operations UX: consume `GET /v1/owner-dashboard` for owner surfaces and preserve aggregate-only accountant-safe rendering.

## Verification Commands

```sh
npm --workspace @clinic-os/domain test
npm --workspace @clinic-os/db run typecheck
npm --workspace @clinic-os/api run typecheck
npm --workspace @clinic-os/api test
node scripts/validate-cp6-fixtures.mjs
node scripts/cp6-contract-smoke.mjs --dry-run
node --test tests/acceptance/cp6-fixture-contract.test.mjs
```

The CP6 dry-run lists all canonical CP6 route families. Live smoke currently executes the route family implemented by this lane, `owner-dashboard`, and its live role-denial checks.
