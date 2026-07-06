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
