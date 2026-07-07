# Web App

Owner: platform and clinic product workstreams.

Checkpoint 1 installs the production Next.js shell, auth session boundary, role-aware navigation, and honest unavailable states for later clinic workflow slices.

Reserved root command: `npm run dev:web`.

## Local development

```sh
npm run dev --workspace apps/web
```

By default the shell calls `GET /v1/me` on the same origin. Set `NEXT_PUBLIC_CLINIC_OS_API_BASE_URL` when the API runs elsewhere.

For local UI verification before the API lane has merged, use the synthetic non-PHI identity fixture:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant \
npm run dev --workspace apps/web
```

Supported `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE` values are `owner`, `doctor`, `assistant`, `receptionist`, `accountant`, and `platform_admin`.

The fixture is intentionally limited to user, tenant, clinic, role, and permission context. It does not include synthetic patients, queues, clinical records, payments, or analytics.

Checkpoint 2 adds a separate local-only workflow fixture for browser smoke before the backend/API
lane is merged:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP2_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant \
npm run dev --workspace apps/web
```

The CP2 fixture uses explicitly synthetic, non-PHI leads, patients, appointments, and queue rows. In
live mode the workflow calls the CP2 API boundary:

- `GET /v1/appointments?date=`
- `GET /v1/queue?date=`
- `GET /v1/leads?status=`
- `GET /v1/patients?query=&phone=&source=`
- `POST /v1/leads`
- `POST /v1/patients`
- `POST /v1/leads/{id}/match-patient`
- `POST /v1/leads/{id}/convert-to-appointment`
- `POST /v1/appointments/{appointmentId}/confirm`
- `POST /v1/appointments/{appointmentId}/check-in`

Checkpoint 3 adds a local-only clinical workflow fixture for doctor/assistant browser smoke before
the CP3 backend lane is merged:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP3_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=doctor \
npm run dev --workspace apps/web
```

The CP3 fixture uses explicitly synthetic, non-PHI patient profile, timeline, intake, consent,
encounter, clinical note, and prescription records behind `apps/web/lib/cp3-workflow.ts`. In live
mode the workflow is available through `/surface/clinical` and the canonical `/surface/encounter`
route, and currently checks the CP3 API boundary at:

- `GET /v1/clinical-workflows/cp3?date=`
- `POST /v1/patients/{patientId}/form-responses`
- `POST /v1/patients/{patientId}/consents`
- `POST /v1/patients/{patientId}/consents/{consentId}/revoke`
- `GET /v1/patients/{patientId}/prep-summary`
- `POST /v1/encounters/{encounterId}/start`
- `PATCH /v1/encounters/{encounterId}`
- `POST /v1/encounters/{encounterId}/sign-note`
- `POST /v1/encounters/{encounterId}/amend-note`
- `POST /v1/encounters/{encounterId}/prescriptions`
- `POST /v1/prescriptions/{prescriptionId}/sign`

Checkpoint 4 adds a local-only dental chart and media fixture for doctor/assistant browser smoke
before the CP4 dental/media backend lanes are merged:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP4_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=doctor \
npm run dev --workspace apps/web
```

The CP4 fixture uses explicitly synthetic, non-PHI dental findings, chart snapshots, and media
metadata behind `apps/web/lib/cp4-workflow.ts`. It does not expose object storage keys. In live
mode the workflow is available through `/surface/dental-media`, `/surface/dental`, and
`/surface/odontogram`, and currently assumes the CP4 API boundary at:

- `GET /v1/clinical-workflows/cp4?date=`
- `POST /v1/patients/{patientId}/dental-findings`
- `PATCH /v1/dental-findings/{findingId}`
- `POST /v1/dental-chart-snapshots`
- `GET /v1/patients/{patientId}/media`
- `POST /v1/media/upload-urls`
- `PUT /v1/media/uploads/{uploadId}/content`
- `POST /v1/media/uploads/{uploadId}/complete`
- `POST /v1/media/assets/{mediaAssetId}/signed-url`

Live external-imaging reference/link routes are deferred as a whole imaging-adapter workflow. CP4
live media attachment binds patient, encounter, tooth, and finding context through the upload
reservation and completion contract above.

Checkpoint 5 adds a local-only checkout workflow fixture for treatment planning, invoice/payment,
receipt, prescription, and instruction browser smoke before the billing/payment API lanes are
merged:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP5_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant \
npm run dev --workspace apps/web
```

The CP5 fixture uses explicitly synthetic, non-PHI checkout data behind
`apps/web/lib/cp5-workflow.ts`. Payment requests in fixture mode never mark an invoice paid.
Manual payment recording is available only with actor, amount, method, reference, and audit reason,
and the UI shows provider no-key/hosted-webhook-not-configured states honestly. Accountant role
smoke should use `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=accountant`; that view shows billing/account labels
without default clinical PHI, prescriptions, or instruction content.

In live mode the workflow is available through `/surface/checkout`, `/surface/accounting`, and the
aliases `/surface/billing` and `/surface/payments`. The temporary checkout UI intentionally uses
the local synthetic fixture as its read model until a production aggregate CP5 read endpoint is
implemented as a complete workflow. In non-fixture live mode the loader returns
`CP5_READ_MODEL_DEFERRED` rather than calling a stale or partial aggregate route.

The web action helpers and tests pin the implemented granular CP5 route family:

- `GET /v1/pricebook/procedures`
- `POST /v1/patients/{patientId}/treatment-plans`
- `PATCH /v1/treatment-plans/{treatmentPlanId}`
- `POST /v1/treatment-plans/{treatmentPlanId}/accept`
- `POST /v1/encounters/{encounterId}/procedures`
- `POST /v1/invoices`
- `GET /v1/invoices/{invoiceId}`
- `POST /v1/invoices/{invoiceId}/payment-requests`
- `POST /v1/invoices/{invoiceId}/manual-payments`
- `POST /v1/invoices/{invoiceId}/receipts`
- `POST /v1/encounters/{encounterId}/prescriptions`
- `POST /v1/prescriptions/{prescriptionId}/sign`
- `POST /v1/patients/{patientId}/instructions`

Checkpoint 6 adds a local-only continuity operations fixture for recalls, task assignment,
SOP checklist runs, lab case progress, inventory checks, incident/CAPA, and owner operations
status:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP6_OPERATIONS_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant \
npm run dev --workspace apps/web
```

The CP6 fixture uses explicitly synthetic, non-PHI operations data behind
`apps/web/lib/cp6-operations.ts`. Recall actions are manual-completion records and never show
fake WhatsApp sent/delivered states. Inventory low stock creates a manual procurement task and
never marks a vendor purchase as executed. Lab reconciliation records expected payable amounts but
does not mark lab invoices paid. Owner source-attributed revenue remains deferred to the
Analytics/QA-owned owner dashboard read model.

In live mode the workflow is available through `/surface/tasks`, `/surface/recalls`,
`/surface/continuity`, `/surface/lab`, `/surface/operations`, and `/surface/owner-control`. The
web read/action helpers and tests pin the CP6 route intent:

- `GET /v1/tasks?status=&dueDate=`
- `POST /v1/tasks`
- `PATCH /v1/tasks/{taskId}`
- `GET /v1/recalls?status=&dueBefore=`
- `POST /v1/recalls/{recallId}/actions`
- `GET /v1/sop-runs?date=`
- `PATCH /v1/sop-runs/{sopRunId}`
- `POST /v1/lab-cases`
- `PATCH /v1/lab-cases/{labCaseId}`
- `GET /v1/lab-cases?status=&dueBefore=`
- `POST /v1/lab-reconciliations`
- `POST /v1/inventory/check-runs`
- `PATCH /v1/inventory/check-runs/{checkRunId}`
- `GET /v1/inventory/exceptions`
- `POST /v1/incidents`
- `POST /v1/corrective-actions`
- `PATCH /v1/corrective-actions/{correctiveActionId}`
- `GET /v1/owner-dashboard?from=&to=`

`404` from any CP6 route is classified as `CP6_ENDPOINT_NOT_REGISTERED` so registration/activation
is diagnosed before permissions or runtime behavior. Accountant navigation remains limited to
billing/accounting surfaces; owner-control is owner-only.

## `/me` contract expectation

Until `packages/api-contracts` owns generated types, the web shell keeps a local mirror in `apps/web/lib/me.ts`. The expected shape is:

```json
{
  "user": { "id": "user_...", "displayName": "Name", "email": "name@example.test" },
  "tenant": { "id": "tenant_...", "name": "Clinic group" },
  "clinic": { "id": "clinic_...", "name": "Clinic name", "timezone": "Asia/Kolkata" },
  "roles": ["assistant"],
  "permissions": ["shell.read"],
  "featureFlags": {}
}
```

`401` and `403` are treated as authentication/activation states. `404` is treated as `/v1/me` not registered, so registration and API startup should be checked before debugging role permissions.
