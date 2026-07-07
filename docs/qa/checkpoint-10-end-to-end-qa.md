# Checkpoint 10 End-To-End QA Evidence

Date: 2026-07-07

## Scope

This lane owns CP10 release-candidate regression evidence for implemented ClinicOS workflows only. It does not add product routes, migrations, live provider activation, or new UI behavior.

## Evidence Added

- Synthetic release-candidate fixture: `fixtures/synthetic/cp10/clinic_day_regression_flow.json`.
- Fixture validator: `node scripts/validate-cp10-fixtures.mjs`.
- Contract smoke dry-run/live-readiness planner: `node scripts/cp10-contract-smoke.mjs --dry-run`.
- Acceptance tests: `node --test tests/acceptance/cp10-fixture-contract.test.mjs`.
- Gated browser smoke: `tests/e2e/checkpoint-10-clinic-day-flow.spec.ts`.

## Clinic-Day Coverage

The CP10 harness covers the implemented dental-first chain:

```text
lead -> patient -> appointment -> intake -> encounter -> dental/media
  -> treatment/checkout/payment/instructions
  -> continuity/lab/inventory/events
  -> owner dashboard
```

It references prior checkpoint fixtures and smokes for source evidence, but the CP10 validator rejects stale live-route assumptions such as legacy CP4 media asset paths and external imaging-link routes.

## Fixture/Live Boundary

- Deterministic fixture and dry-run evidence is local/test-only.
- `liveImplemented: true` means the route family is implemented in the current product surface; it does not mean CP10 has a fully seeded live runtime containing the deterministic CP10 IDs.
- `scripts/cp10-contract-smoke.mjs` live mode intentionally executes only conservative read/readiness probes unless integration supplies a seeded base URL.
- Deferred workflows remain explicitly not passed: external imaging links, live FHIR API exchange, live provider activation, AWS apply, ABDM live exchange, and physical-device checks.

## Role And Tenant Matrix

The acceptance suite verifies current domain grants for:

- owner
- doctor
- assistant
- receptionist
- accountant
- auditor
- platform support

The auditor row is API/domain permission evidence only because the current web app does not expose a separate auditor browser persona. Tenant-isolation assertions deny wrong-tenant access for patient, clinical note, media, invoice, and owner-dashboard route families even when the wrong-tenant actor has owner-level grants in their own tenant.

## Provider And Migration Posture

Provider checks distinguish simulator/contract evidence from live readiness for WhatsApp, Razorpay, telephony, AI, ABDM, and AWS. The fixture forbids claiming live delivery, settlement, AI clinical application, ABDM exchange, or cloud apply evidence.

Migration evidence references CP7 row-based import review routes and CP9 restore dry-run evidence. Conflict-based legacy resolution routes are intentionally rejected.

## Browser Smoke

Run after starting the web app with the dev identity fixture and all checkpoint workflow fixture flags:

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
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3110 \
npx playwright test tests/e2e/checkpoint-10-clinic-day-flow.spec.ts
```

Run owner and platform-support cases separately with `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner` and `platform_admin`.

The smoke checks implemented fixture surfaces, 390px no-horizontal-overflow, provider unavailable/no-fake-completion text, owner aggregate dashboard posture, and registered-unavailable compliance/platform shells.
