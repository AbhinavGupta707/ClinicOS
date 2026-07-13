# Checkpoint 5 QA Fixtures And Smoke Contracts

This QA pack belongs to the Checkpoint 5 treatment checkout, payments, receipt, prescription, and instruction slice.

It is local/test-only. Product runtime must not depend on these fixtures outside explicit local/test fixture modes.

## Fixture

Canonical scenario:

```text
fixtures/synthetic/cp5/treatment_checkout_payments_flow.json
```

The scenario covers:

- Pricebook read, phased treatment plan creation/update/acceptance, and completed procedure billing.
- Invoice creation from a performed procedure, Razorpay payment-link/QR request evidence, and receipt generation.
- Bad-signature webhook rejection that cannot create a transaction or mark an invoice paid.
- Verified partial provider payment that keeps invoice state `partially_paid`.
- Webhook replay that is accepted idempotently without creating a duplicate payment transaction.
- Manual balance payment with actor, method, reference, reason, audit, and timeline evidence.
- Prescription draft and doctor-only sign-off regression.
- Instruction print request evidence and WhatsApp send-request/outbox evidence without fake delivery.
- Accountant billing visibility without default clinical-output access.
- Wrong-tenant denials for treatment plan, invoice, payment request, receipt, and instruction routes.

## Local Validation

```sh
node scripts/validate-cp5-fixtures.mjs
node scripts/cp5-contract-smoke.mjs --dry-run
node --test tests/acceptance/cp5-fixture-contract.test.mjs
```

Targeted root E2E spec is skipped unless explicitly enabled:

```sh
CLINICOS_CP5_E2E_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 \
npm exec playwright -- test tests/e2e/checkpoint-5-checkout-flow.spec.ts
```

## API Smoke After Integration

After Billing Domain, Payment Provider, Checkout UX, and Clinical Output QA outputs are integrated, run:

```sh
node scripts/cp5-contract-smoke.mjs --base-url http://127.0.0.1:4100
```

Required bearer-token env for live API smoke:

```text
CLINICOS_CP5_OWNER_TOKEN=...
CLINICOS_CP5_DOCTOR_TOKEN=...
CLINICOS_CP5_ASSISTANT_TOKEN=...
CLINICOS_CP5_RECEPTIONIST_TOKEN=...
CLINICOS_CP5_ACCOUNTANT_TOKEN=...
CLINICOS_CP5_WRONG_TENANT_ASSISTANT_TOKEN=...
```

For an explicitly local-only auth adapter, the smoke also supports:

```sh
CLINICOS_CP5_AUTH_MODE=fixture-headers node scripts/cp5-contract-smoke.mjs --base-url http://127.0.0.1:4100
```

Only use `fixture-headers` for local/test builds that intentionally register a fixture auth adapter. Do not enable it in production.

Optional audit probe:

```text
CLINICOS_CP5_AUDIT_API_PATH=/v1/audit/events?correlationId=cp5
```

If no audit read API is merged in CP5, verify audit rows through backend/security repository or DB tests and record that evidence in the orchestration checkpoint log.

## Endpoint Assumptions

The smoke plan assumes these CP5 endpoint contracts:

```text
GET /v1/pricebook/procedures
POST /v1/patients/{patientId}/treatment-plans
PATCH /v1/treatment-plans/{treatmentPlanId}
POST /v1/treatment-plans/{treatmentPlanId}/accept
POST /v1/encounters/{encounterId}/procedures
POST /v1/invoices
GET /v1/invoices/{invoiceId}
POST /v1/invoices/{invoiceId}/payment-requests
POST /v1/provider-callbacks/razorpay/cp5_registration_key_01
POST /v1/invoices/{invoiceId}/manual-payments
POST /v1/invoices/{invoiceId}/receipts
POST /v1/encounters/{encounterId}/prescriptions
POST /v1/prescriptions/{prescriptionId}/sign
POST /v1/patients/{patientId}/instructions
GET /v1/patients/{patientId}/timeline
```

The first twelve route families match the CP5 launch packet. The prescription routes are inherited from CP3 and re-checked for doctor-only sign-off. `GET /v1/patients/{patientId}/timeline` is used as post-flow evidence that treatment, invoice, payment, receipt, prescription, print request, and send request events are visible in patient history.

Backend may return generated IDs rather than fixture IDs. If so, the master integration smoke should add a runtime ID map after each creation response before executing downstream requests. Do not hard-code production-generated IDs into product code.

## Payment Integrity Requirements

The fixture and acceptance tests require:

- Bad or missing Razorpay signatures cannot mark paid and cannot create a payment transaction.
- Provider payment replay cannot duplicate transactions or increase paid amount.
- Partial provider payment keeps invoice state `partially_paid` with accurate outstanding balance.
- Manual payment requires actor, amount, method, reference, reason, audit evidence, and timeline evidence.
- Receipt total must equal the successful provider and manual transactions.

## Instruction Send Requirements

Instruction send is represented as request/outbox/provider evidence:

```text
instruction.generated
instruction.send_requested
outbox.message_queued
```

The CP5 fixture must not claim WhatsApp `sent`, `delivered`, or `read` status unless a configured provider confirms it. The current fixture has `providerConfirmationReceived=false` and patient-visible status `requested`.

## Web E2E After Integration

For local synthetic browser smoke, start the web app with the CP5 workflow fixture and a checkout-capable role:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP5_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=receptionist \
npm --workspace @clinic-os/web run dev -- --hostname 127.0.0.1 --port 3000
```

Then run:

```sh
CLINICOS_CP5_E2E_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 \
npm exec playwright -- test tests/e2e/checkpoint-5-checkout-flow.spec.ts
```

For accountant role smoke, start a separate fixture server with the accountant role:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP5_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=accountant \
npm --workspace @clinic-os/web run dev -- --hostname 127.0.0.1 --port 3001

CLINICOS_CP5_ROLE_DENIAL_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3001 \
npm exec playwright -- test tests/e2e/checkpoint-5-checkout-flow.spec.ts --grep "checkout role denial"
```

The integrated E2E spec expects the CP5 route and stable selectors below:

```text
/surface/checkout?scenario=cp5-treatment-checkout
cp5-checkout-workspace
cp5-fixture-alert
cp5-patient-context
cp5-pricebook-list
cp5-treatment-plan-builder
cp5-plan-phase-card
cp5-add-estimate-item
cp5-estimate-preview
cp5-accept-plan
cp5-procedure-picker
cp5-record-procedure
cp5-create-invoice
cp5-invoice-summary
cp5-create-payment-request
cp5-payment-request-evidence
cp5-payment-status
cp5-bad-webhook-guard
cp5-partial-payment-badge
cp5-replay-guard
cp5-manual-payment-form
cp5-record-manual-payment
cp5-generate-receipt
cp5-receipt-panel
cp5-prescription-builder
cp5-prescription-sign-denied
cp5-sign-prescription
cp5-instruction-picker
cp5-request-instruction-print
cp5-request-instruction-send
cp5-outbox-evidence
cp5-provider-delivery-status
cp5-patient-timeline
cp5-accountant-billing-summary
cp5-clinical-output-access-denied
```

If the frontend lane chooses different selectors, update only the fixture selector contract/spec during integration; keep the workflow and safety assertions intact.

## Live Provider Gaps

This lane provides deterministic local/test simulator evidence only:

- No live Razorpay sandbox call is made by the fixture validator or dry-run smoke.
- Razorpay webhook dashboard registration remains deferred until a deployed HTTPS callback exists.
- No WhatsApp send is claimed. The fixture stops at send-request/outbox evidence with provider confirmation absent.
- Live provider activation belongs to Payment Provider or later integration hardening lanes.

## Requested Root Scripts

The QA lane did not edit root `package.json`. Suggested scripts for the master integration patch:

```json
{
  "cp5:fixtures:validate": "node scripts/validate-cp5-fixtures.mjs",
  "cp5:acceptance": "node --test tests/acceptance/cp5-fixture-contract.test.mjs",
  "cp5:smoke:api:dry-run": "node scripts/cp5-contract-smoke.mjs --dry-run",
  "cp5:smoke:api": "node scripts/cp5-contract-smoke.mjs",
  "cp5:e2e": "playwright test tests/e2e/checkpoint-5-checkout-flow.spec.ts"
}
```
