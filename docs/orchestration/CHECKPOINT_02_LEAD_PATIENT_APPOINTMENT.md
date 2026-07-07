# Checkpoint 02 - Lead, Patient, Appointment, And Assistant Day-Start

## Goal

Assistant can capture a source-attributed lead, match or create a patient, book an appointment, confirm/check in the patient, and use the morning dashboard as the working start-of-day surface.

## Base

- Branch: `main`
- Base commit before launch packet: `5fe65da413846fb7174ff19dfcb845dbdd95ee95`
- Launch date: 2026-07-07

## Preflight

- `.secrets/orchestration.env` exists and remains uncommitted.
- Node `v22.22.2`; npm `10.9.7`.
- Project id for visible worker threads: `/Users/abhinavgupta/Desktop/ClinicOS`.
- Local stack status with Docker socket access: Postgres and Redis healthy; Temporal, Temporal UI, and Keycloak running.
- Browser tooling is repo-local: `@playwright/test` installed at `1.61.1`; Chromium cache exists at `/Users/abhinavgupta/Library/Caches/ms-playwright/chromium-1228`.
- `npm run check` passed.
- Baseline CI gates passed through check/typecheck/lint/test/build. The sandboxed `npm run ci` failed only at `npm audit` network lookup; `npm run security:audit` passed with registry access and only moderate advisories remain; `npm run security:secrets` passed.

## Lanes

| Lane              | Pending Worktree ID                          | Thread ID                              | Worktree                                             | Ownership                                                                                                                                   |
| ----------------- | -------------------------------------------- | -------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend/Data      | `local:923958e0-3e5d-4bdc-89f1-03004dbea3ea` | `019f39b0-7027-7ed3-a1c5-b492d6da4ff9` | `/Users/abhinavgupta/.codex/worktrees/d38e/ClinicOS` | Patient/contact/lead/attribution/appointment/queue/task/dashboard domain and API implementation; DB migration/seed additions for CP2 tables |
| Contracts/Events  | `local:685974ea-a52b-4d01-8ce4-6acd884501c0` | `019f39b0-703a-71b3-b15b-60cd2e4fb85c` | `/Users/abhinavgupta/.codex/worktrees/df37/ClinicOS` | Shared API contract package, event names/envelopes, audit classification coverage, contract tests, OpenAPI notes                            |
| Frontend Workflow | `local:9b3667fa-1851-4324-bf21-c6e1c72efb43` | `019f39b0-7027-7ed3-a1c5-b4a8bc5db4b6` | `/Users/abhinavgupta/.codex/worktrees/3ed5/ClinicOS` | Web assistant dashboard, lead inbox, patient quick-create/match, appointment calendar/queue workflow, browser evidence                      |
| QA/Fixtures       | `local:f565963b-3c44-4ba2-a974-3a22dce7249b` | `019f39b0-7036-75c3-8a75-85b0d8b93861` | `/Users/abhinavgupta/.codex/worktrees/14f1/ClinicOS` | Synthetic CP2 fixture set, E2E/acceptance tests, role/tenant checks, smoke scripts/runbook evidence                                         |

## Shared-File Policy

| Surface                         | Owner For CP2          | Rule                                                                                    |
| ------------------------------- | ---------------------- | --------------------------------------------------------------------------------------- |
| `package-lock.json`             | Master integration     | Workers must not commit lockfile changes; list dependency requests in handoff.          |
| Root `package.json`             | Master integration     | Workers request root scripts in handoff unless explicitly necessary for lane tests.     |
| App/package `package.json`      | Owning lane            | App/package lanes may edit local manifests but must not touch unrelated manifests.      |
| DB migrations                   | Backend/Data           | Contracts/QA may request schema changes but must not create competing migrations.       |
| API contract/generated clients  | Contracts/Events       | Backend and Frontend consume or mirror only with documented assumptions.                |
| `apps/api/**`                   | Backend/Data primarily | Contracts may add generated/spec artifacts only if coordinated in handoff.              |
| `apps/web/**` and `packages/ui` | Frontend Workflow      | QA may add tests only under clearly separated test/e2e paths.                           |
| Fixtures/test data              | QA/Fixtures            | Product code must not depend on fixture data outside explicit local/test fixture modes. |
| Docs/orchestration              | Master integration     | Workers do not edit orchestration docs; handoff supplies evidence for master to record. |

## Merge Order

1. Backend/Data
2. Contracts/Events
3. Frontend Workflow
4. QA/Fixtures
5. Master integration patch on `codex/integration/checkpoint-2`
6. Verified promotion to `main`

## Integration Result

- Integration branch: `codex/integration/checkpoint-2`.
- Verified code commit: `58bf864`.
- Lane merge commits:
  - Backend/Data: `9d5a353` merged `bed1192`.
  - Contracts/Events: `ac14dab` merged `a2eadf6`.
  - Frontend Workflow: `6618581` merged `2fa6b1c`.
  - QA/Fixtures: `5a5c419` merged `a945d3c`.
- Lockfile reconciliation: `07d32c0`.
- Master integration fixes:
  - `cd120bc` closed source-lead patient creation and live smoke harness gaps.
  - `58bf864` aligned CP2 timeline projection, local-dev actor headers, route registration, web fixture selectors, duplicate suggestion de-duping, and browser workflow role visibility.

## Integration Fixes

- `createPatient` now accepts a source `leadId`, validates the source lead, matches it to the created patient, records attribution touch linkage, audits `lead.matched_to_patient`, and emits a matching outbox event before lead conversion.
- Patient timeline projection now includes attribution-touch and queue-entry timeline entries, maps storage projection types to public API categories, and returns dotted event types for timeline evidence.
- Local dev fixture auth now accepts the ClinicOS dev-subject header spelling used by the smoke harness, preventing silent fallback to the assistant actor during role-denial checks.
- The CP2 live smoke now adapts only local/test seed data, carries runtime IDs from API responses, uses unique per-run new-patient data, aligns queue/dashboard service dates, and verifies accountant/doctor/wrong-tenant denials.
- The web workflow now registers `/surface/day-start` as a canonical alias for `today`, uses canonical CP2 scenario IDs/names, exposes stable QA selectors, de-dupes duplicate suggestions, clears stale selected-patient state when changing leads, and hides patient-create controls from roles without patient-write access.

## Verification Plan

- Lane-level checks before merge: focused typecheck/lint/test/build for changed packages.
- Merge-level checks after each lane: `git diff --check` and targeted tests for touched surfaces.
- Checkpoint-level checks:
  - Full `npm run check`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
  - High-severity `npm run security:audit` with registry access and `npm run security:secrets`.
  - Migration apply/seed smoke against local Postgres where feasible.
  - API smoke for patient, lead, appointment, confirmation, check-in, queue, and dashboard.
  - Browser smoke for assistant flow: lead -> patient match/create -> appointment -> confirm -> check-in -> dashboard update.
  - Tenant isolation and assistant/receptionist permission checks.
  - Audit/timeline evidence for PHI-changing patient/appointment actions.

## Exit Criteria

- Assistant workflow is implemented end to end without placeholder product behavior.
- Source attribution follows lead -> patient/appointment and is queryable.
- Duplicate suggestions work for patient creation/matching.
- Appointment conflict detection exists with explicit override handling or a documented complete deferral of override workflow.
- Queue/check-in updates are visible in API and UI.
- Morning dashboard reflects current appointments, unconfirmed appointments, lead tasks, and queue state.
- Tests and browser evidence are recorded in this document and `CHECKPOINT_LOG.md`.

## Verification Evidence

- Local stack: `npm run local:ps` showed Postgres and Redis healthy, with Temporal, Temporal UI, and Keycloak running.
- Full code gates passed:
  - `npm run check`
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test`
  - `npm run build`
- Fixture and acceptance gates passed:
  - `node scripts/validate-cp2-fixtures.mjs`
  - `node --test tests/acceptance/*.test.mjs`
  - `node scripts/cp2-contract-smoke.mjs --dry-run`
- Security gates passed:
  - `npm run security:secrets`
  - `npm run security:audit` with high-severity gate; remaining advisories are moderate in upstream Next/PostCSS, Temporal/protobufjs, and Expo/xcode/uuid paths.
  - `git diff --check`
- Live API smoke passed against `http://127.0.0.1:4100` with `CLINIC_OS_API_USE_DEV_AUTH_FIXTURE=true`:
  - capture WhatsApp returning lead
  - match returning patient
  - capture Google lead
  - create patient from lead
  - convert lead to appointment
  - confirm appointment
  - check in patient
  - read queue and morning dashboard
  - read patient timeline with patient, attribution, appointment, check-in, and queue event evidence
  - deny accountant patient create, doctor appointment create, cross-tenant patient create, and wrong-tenant schedule read
- Browser/user checks passed:
  - `CLINICOS_CP2_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/checkpoint-2-assistant-flow.spec.ts`
  - Desktop evidence: `/private/tmp/clinicos-cp2-web-desktop.png`
  - Mobile 390px evidence: `/private/tmp/clinicos-cp2-web-mobile-390.png`

## Accepted Gaps

- The audit read API is not a CP2 shipped workflow, so the live smoke logs `skip audit API probe; set CLINICOS_CP2_AUDIT_API_PATH after audit read endpoint is merged.` CP2 audit behavior is covered by repository/unit/security tests and outbox/audit append checks.
- Playwright accountant browser smoke remains skipped until role-specific storage state files are supplied. API-level accountant denial passed in the live smoke, and the web client now hides patient-create controls when the profile lacks patient-write roles.
- Live external provider checks remain simulator-backed for CP2. Real WhatsApp/Razorpay/webhook registration belongs to later integration/deployment checkpoints after deployed HTTPS callbacks exist.
