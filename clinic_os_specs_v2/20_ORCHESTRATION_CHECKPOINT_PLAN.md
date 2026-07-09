# 20 - Orchestration Checkpoint Plan

> **Historical CP0-CP10 plan.** CP11 was executed in one master session. The user explicitly restored worktree orchestration for CP12-CP18; use `23_PRODUCTION_READINESS_REMEDIATION_PLAN.md` and `../docs/orchestration/POST_CP11_WORKTREE_ORCHESTRATION_PROGRAM.md`. The historical lane/merge record below remains valuable integration context.

**Date:** 2026-07-06  
**Status:** Historical CP0-CP10 orchestration plan
**Purpose:** Make the implementation plans directly executable through the `orchestrate-worktrees` workflow.

## 1. Executive Decision

Use sequential checkpoints with two to four isolated worktree lanes per checkpoint.

Do not launch the whole product at once. Each checkpoint must produce a verified product increment, merge back into the integration branch, pass its verification gate, update docs/memory, and only then unlock the next checkpoint.

This plan is tailored for the `orchestrate-worktrees` skill:

- The master session owns integration judgment.
- Worker sessions own isolated implementation lanes.
- Lanes should avoid overlapping migrations, shared schema files, root config, and API contracts unless the checkpoint explicitly coordinates ownership.
- Merge dependency-producing lanes before dependency-consuming lanes.
- Patch cross-lane gaps in the integration worktree after review.

## 2. Current Preflight Reality

The current `/Users/abhinavgupta/Desktop/ClinicOS` folder is documentation-only and is not yet a Git repository.

Before real worktree orchestration can start, Checkpoint 0 must establish a Git-backed implementation baseline.

Checkpoint 0 should be done by the master session directly or as a single setup lane. Do not spawn multiple implementation worktrees until:

- A Git repository exists.
- The docs are committed.
- The monorepo scaffold exists or the intended starter project is committed.
- The base commit is recorded.
- `git worktree list --porcelain` works.

## 3. Target Completion Definition

The checkpoint sequence below targets a complete dental-first ClinicOS production application, not the future all-specialty blue-sky expansion.

Complete means:

- Platform, tenancy, auth, audit, events, workflow runtime, and observability exist.
- Assistant, doctor, receptionist, and owner web workflows run end to end.
- WhatsApp/messaging and Razorpay payment flows are provider-ready.
- Mobile capture works for chairside photos/media and later audio.
- AI draft/review flow is consent-gated and safe.
- Recalls, lab, inventory, SOPs, event diary, and source-attributed analytics exist.
- FHIR/ABDM readiness exists without blocking the clinic loop.
- Pilot-prod readiness checks, runbooks, and verification gates are in place.

Future specialty packs, marketplace behavior, full hospital HIS, and broad enterprise expansion are out of scope for this checkpoint sequence.

## 4. Number Of Checkpoints

Use **10 build checkpoints plus Checkpoint 0 preflight**.

That is 11 total stages:

0. Git and orchestration preflight.
1. Production platform foundation.
2. Lead, patient, appointment, and assistant day-start.
3. Intake, consent, encounter, and clinical notes.
4. Dental charting, media, and imaging coexistence.
5. Treatment plan, checkout, payments, prescriptions, and instructions.
6. Continuity operations: recalls, tasks, lab, inventory, SOP, event diary, owner dashboard.
7. Live integrations and migration hardening.
8. Mobile capture and AI scribe/action proposals.
9. Interoperability, security, privacy, and operations hardening.
10. Release-candidate integration and pilot rollout readiness.

This count is intentionally not smaller. ClinicOS touches PHI, payments, clinical notes, media, messaging, and long-running workflows. Compressing these into fewer checkpoints would make review and merge risk too high.

## 5. Global Orchestration Rules

For every checkpoint:

1. Start from the latest integrated branch.
2. Record base commit, lane names, thread/worktree IDs, worktree paths, and expected outputs.
3. Give each lane explicit file ownership and forbidden/shared files.
4. Require a handoff with files changed, tests run, risks, env/migration notes, and integration instructions.
5. Review each lane diff before merge.
6. Merge in dependency order.
7. Run checkpoint verification after all merges.
8. Patch integration gaps in the master worktree.
9. Update checkpoint log/docs.
10. Only then start the next checkpoint.

### 5.1 Post-Checkpoint-1 Integration Optimizations

Checkpoint 1 showed that worker execution was not the bottleneck; the long portion was master merge and integration. For Checkpoint 2 and later, use the optimized integration protocol in `docs/orchestration/MERGE_INTEGRATION_RUNBOOK.md`.

Additional mandatory rules:

1. Launch worker lanes as visible project-scoped Codex worktree threads when the Codex app supports thread tools.
2. Build a changed-file/shared-file conflict map from all lane handoffs before merging non-trivial checkpoints.
3. Use a checkpoint integration branch or equivalent worktree before promoting to `main`.
4. Keep `main` as the last verified checkpoint until integration gates pass.
5. Name a single owner for shared files such as root `package.json`, `package-lock.json`, app package manifests, migrations, generated API contracts, Docker/local stack files, and app READMEs.
6. Do not let multiple lanes independently commit `package-lock.json`; prefer one integration-owned lockfile reconciliation after package manifests stabilize.
7. Require workers to check install/tooling/browser/local-service readiness early and report blockers immediately.
8. Run narrow merge checks after each lane, then one full checkpoint suite after all merges and integration patches.
9. Keep browser/mobile smoke for implemented UI workflows, but test temporary UI for responsive and safety invariants rather than final visual polish.

## 6. Expected Orchestration Artifacts

During execution, create:

```text
docs/orchestration/
  CHECKPOINT_LOG.md
  CHECKPOINT_00_PREFLIGHT.md
  CHECKPOINT_01_PLATFORM_FOUNDATION.md
  ...
  CHECKPOINT_10_RELEASE_CANDIDATE.md
```

Each checkpoint log should include:

- Goal.
- Base commit.
- Lanes and thread/worktree IDs.
- Files/areas owned by each lane.
- Merge order.
- Verification commands.
- Test results.
- Manual smoke gaps.
- Risks/deferred items.
- Final commit or merge summary.

## 7. Verification Model

### Lane-Level Checks

Each worker runs the checks relevant to its lane:

- Typecheck/lint for edited packages.
- Unit tests for changed domain logic.
- API tests for changed endpoints.
- Migration validation for schema changes.
- Component tests for changed UI.
- Contract tests for provider adapters.
- AI schema/evaluation tests for AI output lanes.
- Mobile build/typecheck checks for Expo work.

### Merge-Level Checks

After each lane merge:

- `git diff --check`
- Targeted tests for merged area.
- API/schema drift scan if contracts changed.
- Migration apply/rollback check where applicable.

### Checkpoint-Level Checks

After all lanes in a checkpoint are merged:

- Full typecheck.
- Full lint.
- Full unit/integration tests available at that point.
- Build web/API/worker/mobile where applicable.
- Migration validation.
- E2E smoke for the checkpoint user workflow.
- Security/tenant isolation tests for PHI paths.
- Provider no-key/unavailable-state checks where applicable.
- Audit/logging/PHI redaction checks where applicable.
- Docs and runbook consistency check.

### User-Perspective Checks

Code checks are necessary but not sufficient. Every checkpoint that produces UI, mobile behavior, provider behavior, or a clinic workflow must include a user-perspective verification pass.

Use the strongest available check for the checkpoint:

- **Browser automation:** run the local web app and use Playwright or the Codex browser to execute the checkpoint workflow as the relevant role.
- **Visual inspection:** capture screenshots for major screens and inspect layout, empty states, loading states, error states, responsive behavior, and role-specific visibility.
- **Mobile/app checks:** for Expo/mobile work, run Expo web and, when simulator tooling is available, run iOS/Android simulator checks for capture, upload queue, permissions, and offline/error states.
- **Provider simulation checks:** run contract-equivalent provider simulations for WhatsApp, Razorpay, telephony, AI, imaging, and ABDM when live credentials are unavailable.
- **Live sandbox checks:** when sandbox credentials are available, execute real sandbox calls and webhooks, then verify UI state, timeline, audit, and reconciliation.
- **Computer-use checks:** when a workflow depends on OS/browser behavior that cannot be inspected through ordinary tests, use browser/computer tooling to verify it from the user's perspective.

For every user-perspective check, record:

- role used,
- workflow performed,
- environment URL,
- screenshots or written observations,
- issues found and fixed,
- remaining manual-smoke gaps.

Do not sign off a UI checkpoint on code tests alone.

### Manual Smoke

When UI exists, the master session should smoke the real workflow locally or in staging:

- Log in as the relevant role.
- Perform the checkpoint workflow.
- Confirm empty/loading/error states are honest.
- Confirm permissions deny inappropriate actions.
- Confirm audit/timeline/events are created.

If a manual smoke cannot run, record why and what evidence was used instead.

## 7.1 Autonomous Sequential Execution Mode

When the user says to launch the full orchestration, the master session should run autonomously checkpoint by checkpoint:

```text
launch checkpoint N
  -> spawn lanes
  -> monitor
  -> review completed lanes
  -> merge in dependency order
  -> run code checks
  -> run user-perspective checks
  -> patch integration gaps
  -> update checkpoint log
  -> if gates pass, launch checkpoint N+1
```

Do not ask the user between checkpoints unless:

- credentials/access are required and not available,
- a product/legal/security decision is genuinely unresolved,
- verification fails and the required fix is larger than an integration patch,
- external provider behavior blocks progress,
- the user explicitly asks to pause.

If a live provider credential is unavailable but a contract-tested simulator is acceptable for the checkpoint, proceed with simulator verification and log the live-sandbox gap.

See `21_EXECUTION_INPUTS_AND_CREDENTIALS.md` for what the user may need to provide before or during orchestration.

### Full-Chain Launch Contract

When the user launches the full chain, use this contract:

```text
Start from current clean `main`
  -> run credential/input preflight
  -> launch Checkpoint 1
  -> continue through Checkpoint 10 autonomously
  -> stop only for true blockers
```

Credential/input preflight means:

- Check whether `.secrets/orchestration.env` exists.
- Check whether provider credentials needed for later live checks are present.
- Check whether local/browser/mobile tooling needed for user-perspective checks is available.
- Record which checks will run live and which will run against contract simulators.

The absence of a live provider credential should not block earlier checkpoints. It should block only a checkpoint whose stated exit criteria require live provider verification and no simulator/substitute evidence is acceptable.

The master session should maintain a visible checkpoint log and include, for every checkpoint:

- lanes launched,
- merge order,
- code checks,
- browser/app/user checks,
- provider simulation/live checks,
- screenshots or evidence location where applicable,
- remaining gaps,
- next checkpoint launch decision.

## 8. Checkpoint 0 - Git And Orchestration Preflight

### Outcome

The project is ready for real worktree orchestration.

### Lanes

No parallel lanes by default. This is a master/setup checkpoint.

### Build

- Initialize or confirm Git repository.
- Commit current documentation baseline.
- Decide implementation repo path and branch name.
- Create monorepo scaffold if not already present.
- Add baseline package manager and root scripts.
- Add `docs/orchestration/CHECKPOINT_LOG.md`.
- Record base commit.

### Verification

- `git status --short`
- `git branch --show-current`
- `git log --oneline -3`
- `git worktree list --porcelain`
- Root package manager install/check command if scaffold exists.

### Exit Criteria

- Worktrees can be created.
- Documentation baseline is committed.
- Checkpoint 1 can spawn isolated lanes.

## 9. Checkpoint 1 - Production Platform Foundation

### Outcome

The deployable skeleton exists: web/API/worker/mobile apps, local dependencies, auth/tenancy base, CI, database migrations, audit, outbox, and Temporal foundation.

### Suggested Lanes

1. **Repo and DevEx Lane**
   - Owns root package scripts, workspace config, lint/type/test setup, CI, local docs.
   - Avoids domain migrations except placeholder seed hooks.
2. **Data/Auth Lane**
   - Owns tenancy/auth schema, Keycloak integration, tenant resolver, permission primitives, RLS proof of concept.
   - Coordinates migration file ownership with master.
3. **Runtime/Workflow Lane**
   - Owns worker app, outbox tables/processor, Temporal local wiring, sample durable workflow.
4. **Web Shell Lane**
   - Owns Next.js shell, login/session flow, role-aware navigation skeleton, empty state shell.

### Build

- Monorepo structure from `17_IMPLEMENTATION_PLAN_PLATFORM_INFRA.md`.
- Local Postgres, Redis, Temporal, Keycloak.
- Seed tenant/clinic/users.
- API `/me`.
- Audit helper.
- Outbox event processing.
- OpenAPI generation.
- Initial observability/logging setup.

### Verification

- All apps boot locally.
- Seed users authenticate.
- Tenant/role tests pass.
- Outbox sample event processes.
- Temporal sample workflow survives restart or test replay.
- CI runs typecheck/lint/tests.

### Merge Order

Data/Auth -> Runtime/Workflow -> Repo/DevEx -> Web Shell -> master integration patch.

## 10. Checkpoint 2 - Lead, Patient, Appointment, And Assistant Day-Start

### Outcome

Assistant can capture a source-attributed lead, match/create patient, book appointment, confirm/check in, and use the morning dashboard.

### Suggested Lanes

1. **Backend/Data Lane**
   - Patients, contacts, leads, attribution, appointments, queue, dashboard queries.
2. **Frontend Workflow Lane**
   - Morning dashboard, lead inbox, quick patient create, appointment calendar/queue.
3. **Contracts/Events Lane**
   - API schemas, OpenAPI updates, domain events, audit events.
4. **QA/Fixtures Lane**
   - Seed data, E2E smoke, role/tenant tests.

### Build

- Patient CRUD and duplicate suggestions.
- Lead inbox.
- Source attribution.
- Appointment types, booking, confirmation, check-in, no-show.
- Queue board.
- Assistant day-start dashboard.

### Verification

- E2E: lead -> patient match/create -> appointment -> confirmation -> check-in.
- Tenant isolation tests.
- Assistant permissions tests.
- Dashboard query tests.
- Timeline/audit event checks where patient PHI is viewed/changed.

### Merge Order

Backend/Data -> Contracts/Events -> Frontend Workflow -> QA/Fixtures -> integration patch.

## 11. Checkpoint 3 - Intake, Consent, Encounter, And Clinical Notes

### Outcome

Clinic can route new/returning patients, capture intake/consent, start encounter, draft/sign/amend clinical notes, and create prescriptions with doctor sign-off.

### Suggested Lanes

1. **Clinical Backend Lane**
   - Intake forms, consent, encounter lifecycle, clinical note versions, prescriptions.
2. **Doctor/Assistant UX Lane**
   - Patient profile, timeline, intake entry, returning patient prep, encounter workspace.
3. **Security/Compliance Lane**
   - Consent enforcement, audit events, signed-note immutability, role tests.
4. **QA Lane**
   - E2E and acceptance tests for new and returning patient paths.

### Build

- Digital intake and assistant-entered paper-card flow.
- Consent create/revoke.
- Patient timeline projection.
- Returning patient prep summary.
- Encounter start/draft/sign/amend.
- Prescription builder and sign flow.

### Verification

- E2E: new patient intake -> consent -> encounter -> signed note.
- E2E: returning patient prep -> encounter.
- Doctor-only sign-off test.
- Signed note cannot be overwritten.
- Consent revocation blocks future AI/audio capture.

### Merge Order

Clinical Backend -> Security/Compliance -> Doctor/Assistant UX -> QA -> integration patch.

## 12. Checkpoint 4 - Dental Charting, Media, And Imaging Coexistence

### Outcome

Doctor/assistant can chart tooth-level findings, attach photos/X-rays/documents to the patient/encounter/tooth, and view media securely.

### Suggested Lanes

1. **Dental Domain Lane**
   - Tooth numbering, dental findings, chart snapshots/history, treatment references.
2. **Media Backend Lane**
   - Upload URL, complete upload, metadata, signed URL, object storage, media audit.
3. **Dental/Media UX Lane**
   - Odontogram, tooth detail, media gallery, comparison view.
4. **Imaging/QA Lane**
   - X-ray coexistence import/upload path, DICOM metadata fixtures if available, tests.

### Build

- Odontogram.
- Dental findings CRUD.
- Dental chart history.
- Media upload and tags.
- Attach media to tooth/encounter/patient.
- X-ray coexistence by upload/import/link.

### Verification

- E2E: encounter -> dental finding -> media upload -> signed URL view -> timeline.
- Media access audit test.
- Tenant/role media permission tests.
- Object keys are private and raw bucket paths are not exposed.

### Merge Order

Media Backend -> Dental Domain -> Dental/Media UX -> Imaging/QA -> integration patch.

## 13. Checkpoint 5 - Treatment Plan, Checkout, Payments, Prescriptions, And Instructions

### Outcome

Clinic can convert treatment into plan/estimate, create invoice, request/reconcile payment, generate receipt, and print/send prescription/instructions.

### Suggested Lanes

1. **Billing Domain Lane**
   - Pricebook, treatment plans, estimates, procedures performed, invoice/payment states.
2. **Payment Provider Lane**
   - Razorpay provider interface, dynamic QR/payment link sandbox path, webhook verification/idempotency.
3. **Checkout UX Lane**
   - Treatment plan builder, checkout, invoice/payment state, receipt, instruction template picker.
4. **Clinical Output QA Lane**
   - Prescription sign-off tests, instruction template tests, payment reconciliation tests.

### Build

- Treatment plans and phased estimates.
- Procedure performed records.
- Invoice generation.
- Dynamic invoice-specific payment QR/link request.
- Verified payment webhook update.
- Receipt generation.
- Prescription/instruction print/send workflow.

### Verification

- E2E: treatment plan -> invoice -> payment request -> verified payment -> receipt.
- Webhook replay does not duplicate payment.
- Unverified payment cannot mark invoice paid.
- Doctor-only prescription signing.
- Checkout creates timeline/audit events.

### Merge Order

Billing Domain -> Payment Provider -> Checkout UX -> Clinical Output QA -> integration patch.

## 14. Checkpoint 6 - Continuity Operations And Owner Dashboard

### Outcome

Clinic can run six-month recall, post-op follow-up, task/SOP work, lab cases, inventory checks, event diary, and owner analytics.

### Suggested Lanes

1. **Workflow/Task Backend Lane**
   - Tasks, recalls, SOP schedules, Temporal workflows, post-op follow-up.
2. **Lab/Inventory/Event Lane**
   - Lab cases, lab reconciliation, inventory checklists, event/CAPA diary.
3. **Operations UX Lane**
   - Recall queue, task workbench, lab board, inventory runner, event diary.
4. **Analytics/QA Lane**
   - Owner dashboard projections, source-attributed metrics, E2E checks.

### Build

- Recall rules and due generation.
- Post-op instruction workflows.
- Lab case card/slip/status/reconciliation.
- Monthly drawer-by-drawer inventory.
- Recurring SOP tasks.
- Event management diary and corrective actions.
- Owner dashboard with revenue/source/recall/lab/inventory/task metrics.

### Verification

- E2E: completed procedure -> recall/post-op task -> assistant action.
- E2E: lab case -> due/returned/completed -> reconciliation.
- E2E: monthly inventory -> procurement task.
- Owner dashboard uses real seeded data.
- Temporal workflow tests for timers/retries.

### Merge Order

Workflow/Task Backend -> Lab/Inventory/Event -> Analytics/QA -> Operations UX -> integration patch.

## 15. Checkpoint 7 - Live Integrations And Migration Hardening

### Outcome

The first provider integrations are pilot-ready, with real provider configuration, capability checks, health status, migration tooling, and honest unavailable states.

### Suggested Lanes

1. **Messaging Provider Lane**
   - WhatsApp Cloud API or chosen BSP adapter, templates, delivery status, inbound normalization.
2. **Telephony/Source Lane**
   - Missed calls, Google/Practo/manual source flows, provider capability gating.
3. **Migration Lane**
   - CSV imports, migration batches/rows/conflicts, imported/unverified records.
4. **Integration Ops/QA Lane**
   - Provider health dashboard, dead-letter/replay, runbooks, sandbox tests.

### Build

- Live/sandbox WhatsApp provider path.
- Message template lifecycle.
- Delivery/read/failure statuses.
- Missed-call lead capture where provider available.
- Practo/Google/manual source import flows.
- Migration review and commit workflow.
- Provider health and capability UI.

### Verification

- Provider no-key states are visible and honest.
- Sandbox WhatsApp send/receive or contract equivalent passes.
- Imported records do not overwrite verified data silently.
- Dead-letter/replay flow works for failed provider events.
- Source attribution survives import/manual/provider flows.

### Merge Order

Messaging Provider -> Telephony/Source -> Migration -> Integration Ops/QA -> integration patch.

## 16. Checkpoint 8 - Mobile Capture And AI Scribe / Action Proposals

### Outcome

Expo mobile capture and backend-mediated AI drafts work safely with consent, provenance, retention, review, and evaluation.

### Suggested Lanes

1. **Mobile Capture Lane**
   - Expo auth/session, patient/queue selection, photo capture, upload queue, secure cache.
2. **AI Backend Lane**
   - AI sessions/jobs/outputs, STT/provider gateway, structured schemas, retention controls.
3. **Review UX Lane**
   - Clinical note draft review, dental chart patch review, action proposal inbox.
4. **AI Safety/QA Lane**
   - Evaluation harness, consent tests, provenance tests, hallucination/unsupported claim checks.

### Build

- Mobile patient/encounter selection.
- Photo capture into patient timeline.
- Audio capture session gated by consent.
- Transcript segments.
- Clinical note draft.
- Dental chart patch draft.
- Action proposals and approval decisions.
- AI evaluation fixtures.

### Verification

- Mobile photo upload E2E.
- Audio capture disabled without consent.
- AI output cannot apply clinical changes without review.
- Rejected AI output is retained for evaluation but not applied.
- Raw audio retention/deletion policy test.
- Doctor/assistant approval boundaries pass.

### Merge Order

AI Backend -> Mobile Capture -> Review UX -> AI Safety/QA -> integration patch.

## 17. Checkpoint 9 - Interoperability, Security, Privacy, And Operations Hardening

### Outcome

The system has production-grade compliance/operations posture and interoperability readiness.

### Suggested Lanes

1. **FHIR/ABDM Lane**
   - FHIR R4 projections, sample bundles, ABHA/care-context/consent logs behind feature flags.
2. **Security/Privacy Lane**
   - Audit viewer, PHI redaction, retention jobs, export/handover, break-glass review.
3. **Infrastructure/Ops Lane**
   - Terraform pilot-prod profile, backups/restore drills, alerts, runbooks, DR notes.
4. **Performance/QA Lane**
   - Load smoke, clinic-hours concurrency checks, E2E regression suite.

### Build

- FHIR bundle export for patient/encounter/document.
- ABDM sandbox readiness model.
- Patient record export.
- Audit review.
- Retention/deletion jobs.
- Backup/restore runbook.
- Alerting and provider health monitoring.
- Security tests.

### Verification

- FHIR sample validates against selected fixtures/profiles where applicable.
- Patient export includes configured records and audit trail.
- PHI redaction tests pass.
- Restore drill with synthetic data passes.
- Tenant isolation regression suite passes.
- Performance smoke meets stated threshold.

### Merge Order

Security/Privacy -> FHIR/ABDM -> Infrastructure/Ops -> Performance/QA -> integration patch.

## 18. Checkpoint 10 - Release Candidate And Pilot Rollout Readiness

### Outcome

The integrated dental-first application is ready for pilot-prod use with a selected clinic.

### Suggested Lanes

1. **End-To-End QA Lane**
   - Full user-flow regression, role matrix, E2E suite, bug triage.
2. **Pilot Configuration Lane**
   - Clinic onboarding wizard/config, templates, pricebook, recall rules, provider credentials guide.
3. **UX Polish Lane**
   - Empty/error/loading/offline states, responsive polish, copy/safety wording review.
4. **Operations/Docs Lane**
   - Runbooks, training flow, support/admin tooling, release notes, checkpoint final report.

### Build

- Pilot onboarding checklist.
- Template configuration.
- Provider sandbox/live credential checklist.
- Training/demo data.
- Support/admin tools.
- Final docs.
- Known risk/deferred item register.

### Verification

- Full E2E clinic day:
  - lead -> patient -> appointment -> intake -> encounter -> dental chart/media -> treatment plan -> invoice/payment -> prescription/instruction -> recall/lab/inventory/event -> owner dashboard.
- Role and tenant permission regression.
- Provider unavailable/no-key states.
- Production build.
- Migration dry run.
- Backup/restore evidence.
- Manual smoke by owner/doctor/assistant/receptionist roles.

### Merge Order

Pilot Configuration -> UX Polish -> End-To-End QA -> Operations/Docs -> final integration patch.

## 19. Checkpoint Prompt Template

Use this template when launching each worktree lane:

```text
You are the Checkpoint <N> <lane name> implementation lane for ClinicOS.

Read first:
- AGENTS.md
- clinic_os_specs_v2/16_DOCUMENTATION_STRUCTURE_AND_IMPLEMENTATION_INDEX.md
- clinic_os_specs_v2/20_ORCHESTRATION_CHECKPOINT_PLAN.md
- <relevant implementation plan>
- <relevant reference docs>

Base state:
- Branch: <branch>
- Base commit: <commit>

Goal:
<specific checkpoint/lane outcome>

Ownership:
- You may edit: <paths/areas>
- Coordinate/avoid: <shared paths such as migrations, API schemas, root configs>
- Do not edit: <forbidden paths>

Implementation requirements:
- Build production-grade behavior for the lane scope.
- Preserve tenant isolation, audit, consent, provider boundaries, and idempotency.
- Do not ship fake/partial provider behavior as product behavior.
- Use test fixtures/simulators only behind production-equivalent provider contracts.

Verification:
- Run: <lane-specific commands>
- If a command cannot run, explain why and run the closest safe check.

Handoff:
Report files changed, summary, commands run, passing/failing checks, risks, migration/env notes, contract changes, and integration instructions.
```

## 20. How To Decide Lane Count

Use one lane when:

- The checkpoint is mostly setup or tightly coupled.
- Shared files would cause constant conflicts.
- A single person can finish faster than orchestration overhead.

Use two lanes when:

- Backend and frontend are separable but contracts are simple.
- One lane can own schema/API while another owns UI.

Use three lanes when:

- Backend, frontend, and QA/docs are meaningfully separable.
- Provider or workflow runtime work is isolated.

Use four lanes only when:

- There are truly separate product surfaces.
- API/schema ownership is explicit.
- The checkpoint has enough tests/docs work to justify a QA/docs lane.

Do not exceed four lanes for a checkpoint unless the user explicitly approves a larger orchestration batch.

## 21. When To Stop Or Ask

Stop before executing a checkpoint if:

- Git/worktree baseline is missing.
- Required credentials or provider sandbox accounts are needed for the checkpoint and no simulator/contract path is acceptable.
- The target checkpoint has unresolved product decisions that would cause rework.
- Checkpoint verification fails and the fix is larger than a small integration patch.

Otherwise, the master session should continue through review, merge, verification, docs, and next-checkpoint preparation.
