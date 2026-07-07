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
POST /v1/patients/{patientId}/intake-responses
POST /v1/patients/{patientId}/consents
POST /v1/encounters
POST /v1/encounters/{encounterId}/clinical-notes/drafts
POST /v1/clinical-notes/{noteId}/sign
POST /v1/encounters/{encounterId}/prescriptions
POST /v1/prescriptions/{prescriptionId}/sign
POST /v1/clinical-notes/{noteId}/amendments
POST /v1/consents/{consentId}/revoke
GET /v1/patients/{patientId}/ai-audio-readiness?encounterId={encounterId}
GET /v1/patients/{patientId}/prep-summary?appointmentId={appointmentId}
GET /v1/patients/{patientId}/timeline
GET /v1/clinical-notes/{noteId}/versions
GET /v1/encounters/{encounterId}
POST /v1/encounters/{encounterId}/audio-captures
PUT /v1/clinical-notes/{noteId}/versions/{versionId}
```

If backend lanes choose different durable paths or response envelopes, update `scripts/cp3-contract-smoke.mjs`, `tests/acceptance/cp3-fixture-contract.test.mjs`, and this document during integration. Do not weaken the underlying assertions.

## Web E2E After Integration

After Doctor/Assistant UX lands and the web app is running:

```sh
CLINICOS_CP3_E2E_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 \
CLINICOS_CP3_ASSISTANT_STORAGE_STATE=/path/to/assistant-storage-state.json \
CLINICOS_CP3_DOCTOR_STORAGE_STATE=/path/to/doctor-storage-state.json \
./node_modules/.bin/playwright test tests/e2e/checkpoint-3-clinical-flow.spec.ts
```

For web role denial smoke, also set:

```text
CLINICOS_CP3_ACCOUNTANT_STORAGE_STATE=/path/to/accountant-storage-state.json
```

The E2E spec expects the CP3 route and stable selectors declared in the fixture:

```text
/surface/clinical?scenario=cp3-intake-consent-encounter
cp3-clinical-workspace
cp3-patient-profile-newPatient
cp3-new-patient-intake-form
cp3-submit-new-patient-intake
cp3-intake-status-newPatient
cp3-consent-treatment-toggle
cp3-consent-ai-audio-toggle
cp3-save-new-patient-consents
cp3-start-encounter-newPatient
cp3-note-draft-editor
cp3-save-note-draft-newPatientEncounter
cp3-sign-note-newPatientEncounter
cp3-note-status-newPatientEncounter
cp3-create-prescription-newPatientEncounter
cp3-sign-prescription-newPatientPrescription
cp3-amend-note-newPatientNote
cp3-amendment-reason-newPatientNote
cp3-submit-amendment-newPatientNote
cp3-note-version-timeline-newPatientNote
cp3-revoke-ai-audio-consent-newPatient
cp3-ai-audio-readiness-newPatient
cp3-doctor-prep-returningPatient
cp3-submit-returning-paper-card-intake
cp3-start-encounter-returningPatient
cp3-note-sign-denied
cp3-prescription-sign-denied
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

## Current Gaps Before Integration

- Live API smoke cannot run until CP3 backend endpoints exist.
- Live web E2E cannot run until CP3 frontend route and selectors exist.
- The smoke script sends deterministic fixture IDs. If backend endpoints generate runtime IDs in local mode, integration should add the same runtime-ID adaptation pattern used by the CP2 smoke script.
- Audit verification is contractually specified in the fixture; live audit probing depends on an audit read endpoint or backend/security DB evidence.
