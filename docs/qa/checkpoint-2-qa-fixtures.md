# Checkpoint 2 QA Fixtures And Smoke Contracts

This QA pack belongs to the Checkpoint 2 lead, patient, appointment, confirmation, check-in, queue, and morning dashboard slice.

It is local/test-only. Product runtime must not depend on these fixtures outside explicit local/test fixture modes.

## Fixture

Canonical scenario:

```text
fixtures/synthetic/cp2/lead_patient_appointment_flow.json
```

The scenario covers:

- WhatsApp lead matched to an existing returning patient.
- Google lead with no duplicate match, creating a new patient.
- Source attribution from lead to patient and appointment.
- Appointment booking, manual confirmation, receptionist check-in, queue entry, and dashboard refresh expectations.
- Assistant/receptionist allow cases.
- Accountant, doctor-without-schedule-write, cross-tenant, and wrong-tenant denial cases.
- PHI-sensitive audit expectations and patient timeline entries for patient/appointment mutations.

## Local Validation

These checks require only Node:

```sh
node scripts/validate-cp2-fixtures.mjs
node --test tests/acceptance/*.test.mjs
node scripts/cp2-contract-smoke.mjs --dry-run
```

## API Smoke After Integration

After Backend/Data and Contracts/Events lanes expose the CP2 endpoints, run:

```sh
node scripts/cp2-contract-smoke.mjs --base-url http://127.0.0.1:4100
```

Required bearer-token env for live API smoke:

```text
CLINICOS_CP2_OWNER_TOKEN=...
CLINICOS_CP2_ASSISTANT_TOKEN=...
CLINICOS_CP2_RECEPTIONIST_TOKEN=...
CLINICOS_CP2_ACCOUNTANT_TOKEN=...
CLINICOS_CP2_DOCTOR_TOKEN=...
CLINICOS_CP2_WRONG_TENANT_ASSISTANT_TOKEN=...
```

For an explicitly local-only auth adapter, the smoke also supports:

```sh
CLINICOS_CP2_AUTH_MODE=fixture-headers node scripts/cp2-contract-smoke.mjs --base-url http://127.0.0.1:4100
```

Only use `fixture-headers` for local/test builds that intentionally register a fixture auth adapter. Do not enable it in production.

Optional audit probe:

```text
CLINICOS_CP2_AUDIT_API_PATH=/v1/audit/events?correlationId=cp2
```

If no audit read API is merged in CP2, verify the audit rows through the backend lane's repository/DB tests and record that evidence in the orchestration checkpoint log.

## Web E2E After Integration

After Frontend Workflow lane lands and the web app is running:

```sh
CLINICOS_CP2_E2E_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 \
CLINICOS_CP2_ASSISTANT_STORAGE_STATE=/path/to/assistant-storage-state.json \
npx playwright test tests/e2e/checkpoint-2-assistant-flow.spec.ts
```

For web role denial smoke, also set:

```text
CLINICOS_CP2_ACCOUNTANT_STORAGE_STATE=/path/to/accountant-storage-state.json
```

The E2E spec expects stable CP2 `data-testid` selectors. If the frontend lane chooses different selectors, update only the test selector map/spec during integration; do not weaken the workflow assertions.

## Requested Root Scripts

The QA lane did not edit root `package.json`. Suggested scripts for the master integration patch:

```json
{
  "cp2:fixtures:validate": "node scripts/validate-cp2-fixtures.mjs",
  "cp2:acceptance": "node --test tests/acceptance/*.test.mjs",
  "cp2:smoke:api:dry-run": "node scripts/cp2-contract-smoke.mjs --dry-run",
  "cp2:smoke:api": "node scripts/cp2-contract-smoke.mjs",
  "cp2:e2e": "playwright test tests/e2e/checkpoint-2-assistant-flow.spec.ts"
}
```

## Current Gaps Before Integration

- The worktree initially had no `node_modules`, so repo-local Playwright was declared in `package.json` but not installed in this lane until dependencies are installed by master/integration.
- Live API smoke cannot run until CP2 backend endpoints exist.
- Live web E2E cannot run until CP2 frontend routes and test selectors exist.
- Audit verification is contractually specified in the fixture; live audit probing depends on an audit read endpoint or backend DB/repository evidence.
