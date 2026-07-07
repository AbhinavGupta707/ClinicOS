# Checkpoint 9 Performance/QA Evidence

Date: 2026-07-07

## Scope

This lane owns CP9 quality and performance evidence: deterministic fixtures, dry-run route contracts, tenant-isolation regression expectations, local clinic-hours load smoke thresholds, and browser smoke for CP9 web surfaces where present.

It does not implement Security/Privacy, FHIR/ABDM, Infrastructure/Ops, or production CP9 web workflows.

## Evidence Added

- Synthetic fixture corpus: `fixtures/synthetic/cp9/performance_qa_flow.json`.
- Fixture validator: `node scripts/validate-cp9-fixtures.mjs`.
- CP9 contract smoke dry-run: `node scripts/cp9-contract-smoke.mjs --dry-run`.
- Clinic-hours load smoke dry-run: `node scripts/cp9-load-smoke.mjs --dry-run`.
- Acceptance tests: `node --test tests/acceptance/cp9-fixture-contract.test.mjs`.
- Gated browser smoke: `tests/e2e/checkpoint-9-performance-qa-flow.spec.ts`.

## Fixture/Live Boundary

The CP9 fixture names candidate route families for patient export, audit review, FHIR export, break-glass, and retention, but marks all CP9 compliance/FHIR/security requests as `liveImplemented: false`.

That is deliberate. Security/Privacy and FHIR/ABDM own the live route contracts. Master integration should flip live flags or update route names only after those lanes publish canonical routes and payloads.

The load smoke has live-readable local endpoints from earlier checkpoints:

- `GET /health/ready`
- `GET /v1/me`
- `GET /v1/appointments?date=2026-07-07`
- `GET /v1/queue?date=2026-07-07`
- `GET /v1/tasks?status=open`
- `GET /v1/provider-health`
- `GET /v1/owner-dashboard?from=...&to=...`

CP9 audit/FHIR endpoints are explicitly deferred from the load plan until route owners activate them.

## Tenant Isolation

The suite covers cross-tenant denial expectations for:

- patient export
- audit review
- FHIR bundle export
- break-glass approval
- retention runs

The acceptance test also exercises current domain authorization for the CP9-relevant permission keys: `patient.export`, `audit.read`, `privacy.request`, `retention.manage`, `break_glass.request`, and `break_glass.approve`.

## Local Load Thresholds

The local smoke thresholds are intentionally small and honest for a developer laptop:

- concurrency: `6`
- total requests: `48`
- p95 latency: `<= 750 ms`
- p99 latency: `<= 1500 ms`
- error rate: `0`
- HTTP 429 rate: `0`
- max response body: `<= 1 MiB`

Live load execution requires an explicit base URL:

```sh
node scripts/cp9-load-smoke.mjs --base-url http://127.0.0.1:4100 --auth-mode local-dev-subject
```

## Browser Smoke Posture

No active CP9 product web workflow exists in this lane. The current web shell has registered-unavailable CP9 surfaces:

- `/surface/compliance`
- `/surface/platform-support`

The gated Playwright spec verifies that those surfaces show unavailable state, required API boundaries, no fake product data, disabled activation controls, and no horizontal overflow at 390px.

Run after starting the web app with the dev identity fixture:

```sh
CLINICOS_CP9_E2E_ENABLED=true \
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 \
npx playwright test tests/e2e/checkpoint-9-performance-qa-flow.spec.ts
```

Run the platform-support case separately with `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=platform_admin`.

## Master Reconciliation Notes

- Confirm Security/Privacy canonical routes for audit events, export requests, break-glass review, and retention runs before enabling live CP9 contract smoke.
- Confirm FHIR/ABDM canonical route names before enabling FHIR live smoke or load probes.
- Do not treat CP9 registered-unavailable web shells as implemented compliance workflows.
- Keep synthetic-only data for load, export, restore, screenshots, and fixture artifacts.
