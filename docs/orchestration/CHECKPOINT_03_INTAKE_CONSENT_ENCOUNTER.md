# Checkpoint 03 - Intake, Consent, Encounter, And Clinical Notes

## Goal

Clinic staff can route new and returning patients into a clinical visit, capture digital or assistant-entered intake, record and revoke consent, start an encounter, draft/sign/amend clinical notes, and create prescriptions with doctor sign-off.

## Base

- Branch: `main`
- Base commit before launch packet: `6ba1fa5f8c0a5b8a058c33ca831494034d76c9e4`
- Worker launch commit: `6fe2cbc`
- Launch date: 2026-07-07

## Scope

- Digital intake and assistant-entered paper-card flow.
- Consent create/revoke with typed purposes, provenance, and enforcement hooks.
- Patient profile/timeline continuation from CP2.
- Returning patient prep summary.
- Encounter start/draft/sign/amend lifecycle.
- Clinical note versioning with signed-note immutability.
- Prescription builder and doctor-only sign flow.

## Non-Goals

- Dental odontogram, tooth-level findings, and media upload belong to Checkpoint 4.
- Treatment plans, checkout, invoices, payments, prescriptions printing, and patient instructions beyond doctor-signed prescription records belong to Checkpoint 5.
- AI/audio capture is not implemented in CP3, but consent revocation must expose enforcement state so later AI/audio checkpoints can block safely.

## Lanes

| Lane                | Pending Worktree ID                                | Thread ID                              | Worktree                                             | Ownership                                                                                                                       |
| ------------------- | -------------------------------------------------- | -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Clinical Backend    | `local:ab246795-f811-4fb8-8059-6e7dec97cf1d`      | `019f39f6-8c8d-7ed3-89d7-a0569652c1bb` | `/Users/abhinavgupta/.codex/worktrees/81eb/ClinicOS` | Intake forms, consent records, encounter lifecycle, clinical-note versions, prescriptions, migrations/seeds, API implementation |
| Security/Compliance | `local:8d887afa-acf7-410d-aa45-870a9962847b`      | `019f39f6-c6ef-7691-af95-ef4be605d978` | `/Users/abhinavgupta/.codex/worktrees/4436/ClinicOS` | Consent enforcement, PHI audit coverage, signed-note immutability tests, doctor-only sign-off, tenant/role denials              |
| Doctor/Assistant UX | `local:9c49eb47-37a9-4d2c-8ea0-0a029a53fb13`      | `019f39f7-0632-7800-9d41-f55b44f38dd0` | `/Users/abhinavgupta/.codex/worktrees/75ee/ClinicOS` | Patient profile/timeline, intake entry, returning-patient prep, encounter workspace, clinical note and prescription surfaces    |
| QA/Fixtures         | `local:bc55a12e-149c-4828-a5e2-707857009fb9`      | `019f39f7-54bd-72e1-a812-dd0fda503d06` | `/Users/abhinavgupta/.codex/worktrees/08d3/ClinicOS` | CP3 synthetic fixture, acceptance/E2E tests, live smoke plan, docs/QA runbook evidence                                          |

## Shared-File Policy

| Surface                         | Owner For CP3                        | Rule                                                                                             |
| ------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| `package-lock.json`             | Master integration                   | Workers must not commit lockfile changes; request dependency changes in handoff.                 |
| Root `package.json`             | Master integration                   | Workers request root scripts unless explicitly assigned.                                         |
| App/package manifests           | Owning lane                          | App/package lanes may edit local manifests only.                                                 |
| DB migrations                   | Clinical Backend                     | Security/QA may request additions, but do not create competing CP3 migrations.                   |
| API contracts/generated clients | Clinical Backend first, QA validates | UX may consume documented contracts; do not invent durable API shapes without backend ownership. |
| `apps/api/**`                   | Clinical Backend                     | Security may add focused tests or audit helpers; coordinate route/schema changes.                |
| `apps/web/**`                   | Doctor/Assistant UX                  | QA may add tests only under `tests/e2e` or app test folders.                                     |
| Fixtures/test data              | QA/Fixtures                          | Product runtime must not depend on fixtures outside explicit local/test fixture modes.           |
| Docs/orchestration              | Master integration                   | Workers provide handoff evidence; master records checkpoint evidence.                            |

## Required Verification

- New patient flow: intake -> consent -> encounter -> draft note -> doctor sign -> patient timeline.
- Returning patient flow: prep summary -> encounter -> note draft/sign.
- Assistant may draft but cannot sign clinical notes or prescriptions.
- Doctor can sign clinical note and prescription.
- Signed note cannot be overwritten; amendments create linked versions.
- Consent revocation blocks future AI/audio capture readiness flags and is visible to later checkpoints.
- Tenant isolation and role-denial tests for intake, consent, encounter, note, and prescription actions.
- Browser smoke for the implemented CP3 workflow at desktop and 390px mobile with no horizontal overflow.

## Merge Order

1. Clinical Backend
2. Security/Compliance
3. Doctor/Assistant UX
4. QA/Fixtures
5. Master integration patch on `codex/integration/checkpoint-3`
6. Verified promotion to `main`

## Exit Criteria

- CP3 workflows are complete for their intended scope without mock product behavior.
- Signed clinical artifacts are immutable with explicit amendment paths.
- Consent records are auditable, revocable, and usable as enforcement inputs.
- Prescription signing is doctor-only.
- Timeline, audit, and outbox evidence exist for PHI-changing actions.
- Full code checks, live local API smoke, and browser/user checks are recorded before merge.

## Integration Closeout

- Integration branch: `codex/integration/checkpoint-3`.
- Verified code commit: `eb68abd`.
- Merge order:
  - Clinical Backend: worker `393e738`, integration merge `f1e6fa2`.
  - Security/Compliance: worker `c8146ee`, integration merge `4adc0d7`.
  - Doctor/Assistant UX: worker `62dd85d`, integration merge `f4af47e`.
  - QA/Fixtures: worker `4c2453a`, integration merge `60414f9`.
  - Master integration patch: `eb68abd`.
- Master integration aligned the CP3 live boundary around canonical routes:
  - `POST /v1/patients/{patientId}/form-responses`
  - `POST /v1/patients/{patientId}/consents`
  - `GET /v1/patients/{patientId}/consents`
  - `POST /v1/patients/{patientId}/consents/{consentId}/revoke`
  - `GET /v1/patients/{patientId}/prep-summary`
  - `POST /v1/encounters`
  - `POST /v1/encounters/{encounterId}/start`
  - `PATCH /v1/encounters/{encounterId}`
  - `POST /v1/encounters/{encounterId}/sign-note`
  - `POST /v1/encounters/{encounterId}/amend-note`
  - `POST /v1/encounters/{encounterId}/prescriptions`
  - `POST /v1/prescriptions/{prescriptionId}/sign`

## Verification Evidence

- Fixture and contract checks:
  - `node scripts/validate-cp3-fixtures.mjs`
  - `node --test tests/acceptance/*.test.mjs`
  - `node scripts/cp3-contract-smoke.mjs --dry-run`
- Focused package checks:
  - `npm --workspace @clinic-os/auth test`
  - `npm --workspace @clinic-os/domain test`
  - `npm --workspace @clinic-os/db test`
  - `npm --workspace @clinic-os/api-contracts test`
  - `npm --workspace @clinic-os/security test`
  - `npm --workspace @clinic-os/web test`
  - `npm --workspace @clinic-os/web run typecheck`
  - `npm --workspace @clinic-os/web run lint`
- Live local API smoke:
  - `npm --workspace @clinic-os/api test` passed outside the sandbox with no skips.
  - Covered intake, consent create/revoke, consent enforcement, encounter start, note draft/sign/amend, prescription draft/sign, doctor-only signing, signed-note overwrite denial, audit evidence, and outbox evidence.
- Root checks:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test`
  - `npm run build`
  - `npm run security:secrets`
  - `npm run security:audit` high-severity gate
  - `git diff --check`
- Browser/user checks:
  - Doctor workflow and mobile overflow: `CLINICOS_CP3_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test apps/web/tests/checkpoint-3-clinical-workflow.spec.ts`.
  - Accountant denial: `CLINICOS_CP3_ROLE_DENIAL_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3001 npx playwright test apps/web/tests/checkpoint-3-clinical-workflow.spec.ts --grep "clinical role denial"`.
  - Mirrored root workflow/mobile: `CLINICOS_CP3_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/checkpoint-3-clinical-flow.spec.ts --grep "clinical workflow smoke"`.
  - Mirrored root denial: `CLINICOS_CP3_ROLE_DENIAL_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3001 npx playwright test tests/e2e/checkpoint-3-clinical-flow.spec.ts --grep "clinical role denial"`.
- Screenshots:
  - Desktop: `/private/tmp/clinicos-cp3-web-doctor-desktop.png`.
  - Mobile 390px: `/private/tmp/clinicos-cp3-web-mobile-390.png`.

## Accepted Gaps

- The CP3 audit read API is not implemented; audit append/classification and PHI redaction are verified by backend/security tests.
- AI/audio capture is deferred. CP3 implements and verifies consent enforcement state so later audio/AI workflows can block correctly.
- `npm audit --audit-level=high` passes. Moderate advisories remain in transitive Next/PostCSS, Temporal/protobufjs, and Expo/xcode/uuid paths and should be revisited in a dependency hardening pass.
- The CP3 fixture contract smoke live mode expects a deterministic fixture-loaded environment. The local API fixture intentionally generates runtime IDs, so local runtime-ID evidence comes from `apps/api/test/cp3-clinical.test.ts`.
