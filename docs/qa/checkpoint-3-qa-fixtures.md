# Checkpoint 3 QA Fixtures And Smoke Contracts

This QA pack belongs to the Checkpoint 3 intake, consent, encounter, clinical note, amendment, prescription, and consent-enforcement slice.

It is local/test-only. Product runtime must not depend on these fixtures outside explicit local/test fixture modes.

## Fixture

Canonical scenario:

```text
fixtures/synthetic/cp3/intake_consent_encounter_flow.json
```

The scenario covers:

- New patient digital intake, treatment consent, AI/audio consent, encounter start, assistant note draft, doctor note signing, doctor prescription signing, signed-note amendment, AI/audio consent revocation, and readiness denial.
- Returning patient assistant-entered paper-card intake, doctor prep summary, and encounter start.
- Assistant draft permission with assistant sign denial for notes and prescriptions.
- Doctor-only clinical note and prescription signing.
- Signed-note immutability with a linked amendment version and preserved signed hash.
- Consent revocation blocking future audio capture, transcription, and AI draft readiness.
- Accountant, assistant, immutable-artifact, consent, and cross-tenant denial contracts.
- PHI-sensitive audit expectations and patient timeline entries for clinical mutations and sensitive views.

## Fixture Schema

The top-level fixture shape is:

```text
schemaVersion
fixtureUse
sourceReferences
clock
tenants
clinics
actors
patients
appointments
intakeTemplates
intakeResponses
consentPolicies
consentRecords
encounters
clinicalNotes
prescriptions
flow
roleTenantExpectations
responseAssertions
e2eSelectorContract
```

Guardrails enforced by `scripts/validate-cp3-fixtures.mjs`:

- `fixtureUse.localOnly`, `syntheticOnly`, and `productionUseDenied` must be true.
- Allowed environments are only `local`, `development`, `test`, and `ci`.
- Emails must use `.example.test`.
- Patient phones must use the reserved CP3 fixture range `+91993000####`.
- IDs must be deterministic v4-style UUIDs.
- Sensitive flow steps must declare audit entries with PHI field names.
- Required CP3 events and timeline entries must be present.
- Role/tenant denial, immutable signed-note denial, and consent-revoked denial contracts must be present.

## Local Validation

These checks require only Node after dependencies are installed:

```sh
node scripts/validate-cp3-fixtures.mjs
node --test tests/acceptance/*.test.mjs
node scripts/cp3-contract-smoke.mjs --dry-run
```

## API Smoke After Integration

After Clinical Backend and Security/Compliance lanes expose the CP3 endpoints, run:

```sh
node scripts/cp3-contract-smoke.mjs --base-url http://127.0.0.1:4100
```

Required bearer-token env for live API smoke:

```text
CLINICOS_CP3_OWNER_TOKEN=...
CLINICOS_CP3_DOCTOR_TOKEN=...
CLINICOS_CP3_ASSISTANT_TOKEN=...
CLINICOS_CP3_RECEPTIONIST_TOKEN=...
CLINICOS_CP3_ACCOUNTANT_TOKEN=...
CLINICOS_CP3_WRONG_TENANT_ASSISTANT_TOKEN=...
```

For an explicitly local-only auth adapter, the smoke also supports:

```sh
CLINICOS_CP3_AUTH_MODE=fixture-headers node scripts/cp3-contract-smoke.mjs --base-url http://127.0.0.1:4100
```

Only use `fixture-headers` for local/test builds that intentionally register a fixture auth adapter. Do not enable it in production.

Optional audit probe:

```text
CLINICOS_CP3_AUDIT_API_PATH=/v1/audit/events?correlationId=cp3
```

If no audit read API is merged in CP3, verify audit rows through backend/security repository or DB tests and record that evidence in the orchestration checkpoint log.

## Endpoint Assumptions

The smoke plan currently assumes these CP3 endpoint contracts:

```text
POST /v1/patients/{patientId}/form-responses
POST /v1/patients/{patientId}/consents
POST /v1/encounters
POST /v1/encounters/{encounterId}/start
PATCH /v1/encounters/{encounterId}
POST /v1/encounters/{encounterId}/sign-note
POST /v1/encounters/{encounterId}/prescriptions
POST /v1/prescriptions/{prescriptionId}/sign
POST /v1/encounters/{encounterId}/amend-note
POST /v1/patients/{patientId}/consents/{consentId}/revoke
GET /v1/patients/{patientId}/consents
GET /v1/patients/{patientId}/prep-summary?appointmentId={appointmentId}
GET /v1/patients/{patientId}/timeline
GET /v1/encounters/{encounterId}
```

Backend may return generated IDs rather than fixture IDs. If so, the master integration smoke should add a runtime ID map after each creation response before executing downstream requests. Do not hard-code production-generated IDs into product code.

The fixture also documents the future `POST /v1/encounters/{encounterId}/audio-captures` consent-revoked denial, but that route is not a CP3 live-smoke requirement because AI/audio capture is explicitly deferred. CP3 verifies the guard input through consent enforcement state instead.

## Web E2E After Integration

For local synthetic browser smoke, start the web app with the CP3 workflow fixture and doctor role:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP3_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=doctor \
npm --workspace @clinic-os/web run dev -- --hostname 127.0.0.1 --port 3000
```

Then run either the app-owned spec or the mirrored root E2E spec:

```sh
CLINICOS_CP3_E2E_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 \
npx playwright test apps/web/tests/checkpoint-3-clinical-workflow.spec.ts

CLINICOS_CP3_E2E_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 \
npx playwright test tests/e2e/checkpoint-3-clinical-flow.spec.ts
```

For role denial smoke, start a separate fixture server with the accountant role:

```sh
NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_USE_CP3_WORKFLOW_FIXTURE=true \
NEXT_PUBLIC_CLINIC_OS_ENV=local \
NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=accountant \
npm --workspace @clinic-os/web run dev -- --hostname 127.0.0.1 --port 3001

CLINICOS_CP3_ROLE_DENIAL_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3001 \
npx playwright test apps/web/tests/checkpoint-3-clinical-workflow.spec.ts --grep "clinical role denial"
```

The integrated E2E specs expect the CP3 route and stable selectors below:

```text
/surface/clinical?scenario=cp3-intake-consent-encounter
cp3-clinical-workspace
cp3-workflow
cp3-fixture-alert
cp3-patient-selector
cp3-new-patient-intake-form
cp3-submit-intake
cp3-capture-consent-ai_audio_capture
cp3-consent-ai_audio_capture-status
cp3-revoke-consent-ai_audio_capture
cp3-ai-audio-readiness-blocked
cp3-start-encounter-newPatientEncounter
cp3-save-note-draft
cp3-sign-note-newPatientEncounter
cp3-note-signed-immutable
cp3-amend-note
cp3-timeline
cp3-save-prescription-draft
cp3-sign-prescription-newPatientEncounter
cp3-sign-prescription
cp3-clinical-access-denied
```

If the frontend lane chooses different selectors, update only the fixture selector contract/spec during integration; keep the workflow assertions intact.

## Requested Root Scripts

The QA lane did not edit root `package.json`. Suggested scripts for the master integration patch:

```json
{
  "cp3:fixtures:validate": "node scripts/validate-cp3-fixtures.mjs",
  "cp3:acceptance": "node --test tests/acceptance/*.test.mjs",
  "cp3:smoke:api:dry-run": "node scripts/cp3-contract-smoke.mjs --dry-run",
  "cp3:smoke:api": "node scripts/cp3-contract-smoke.mjs",
  "cp3:e2e": "playwright test tests/e2e/checkpoint-3-clinical-flow.spec.ts"
}
```

## Current Verification Notes

- The local API HTTP workflow is verified by `npm --workspace @clinic-os/api test`; run it outside the sandbox when socket binding is blocked.
- `scripts/cp3-contract-smoke.mjs --dry-run` remains the deterministic fixture-environment contract printer. The local fixture API intentionally generates runtime IDs, so the local API test is the authoritative runtime-ID smoke.
- Audit verification is covered by backend operation tests and security package tests until an audit read endpoint is added.
- AI/audio capture is deferred as a future workflow; CP3 verifies the consent-enforcement state that future capture workflows must consume.
