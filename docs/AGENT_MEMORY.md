# ClinicOS Agent Memory

Last updated: 2026-07-10

This file captures durable execution memory for future Codex sessions. Treat `clinic_os_specs_v2/` as the product source of truth and this file as operational memory about how to work in this repository.

## Current Orchestration State

- **Current release truth:** the independent post-CP10 audit is **NO-GO** for pilot, production PHI and live production providers. CP10 remains historical E1/E2 local/fixture evidence only. Read plans 23/24, the remediation register and the production evidence standard before new implementation.
- **Current execution decision:** CP11 was completed in one master session. The user explicitly changed CP12-CP18 to a `gpt-5.6-sol` `xhigh` master plus an adaptive number of visible project-scoped worktree workers. There is no lane quota: every worker must pass the path/input/test/environment independence gate. Use `docs/orchestration/POST_CP11_WORKTREE_ORCHESTRATION_PROGRAM.md` and the active checkpoint packet.
- **Mandatory workflow skill:** the master explicitly invokes `orchestrate-worktrees`, reads its complete `SKILL.md` and referenced runbook, and keeps using it for the entire CP12-CP18 control loop. Do not rely on prompt-trigger inference alone.
- **Monitoring decision:** the future master creates and verifies a thread-attached heartbeat at the requested 90-second cadence. If the app rejects that interval, use an active roughly 90-second status-read loop plus the shortest supported sub-hour heartbeat and record the limitation.
- **Current checkpoint state:** CP11 E3 is committed on `main` at `a6109bb`; final report and evidence are `docs/orchestration/CHECKPOINT_11_FINAL_REPORT.md` and `docs/qa/checkpoint-11-evidence.md`. Any material CP11 code/schema change invalidates its evidence and requires rerun.
- **Next checkpoint:** CP12 provisionally starts with three independent contract-generation, repository-seam and security/parity-foundation workers. The API framework consumes those interfaces in a later worktree or the master after interface freeze. Launch packet: `docs/orchestration/CHECKPOINT_12_MODULAR_API_GENERATED_CONTRACTS.md`. Resolve the project through `list_projects`, launch only from clean verified `main`, integrate on `codex/integration/checkpoint-12`, and do not start CP13 until CP12 is promoted.
- **Credential preflight:** `.secrets/orchestration.env` is ignored, mode `0600`, selects `AWS_PROFILE=clinicos-human`, and keeps Meta/Razorpay providers on `simulator`. AWS STS verified account `222634407676`; GitHub CLI verified keyring authentication with `repo`/`workflow` scopes on 2026-07-10.
- **Reasoning policy:** master is `gpt-5.6-sol` `xhigh`; planned workers remain `high`/`xhigh`. `medium` is allowed only for a substantial, spec-frozen mechanical transformation with exact expected output, deterministic verification and no design/security/safety/provider/evidence/release judgment. No planned implementation lane is pre-downgraded.
- **Credential boundary:** workers never copy/read/source the secret handoff and never run live AWS/provider/dashboard operations. The master owns authenticated external state and live verification. Never fall back to the older `clinicos` AWS profile.
- **Historical worktrees:** 12 CP8-CP10-era worktrees were checked on 2026-07-10. Every tree was clean, every head was an ancestor of `main`, and none had a unique commit. They are historical and excluded from CP12; do not reuse or delete them without a fresh status check. New CP12 workers start from the newly recorded clean `main` launch commit.
- Remaining blockers include validation-only Terraform, console-only telemetry, no production media
  adapter, incomplete provider registration/routes, unavailable native capture/in-memory mobile
  cache, no live restore/security/clinic evidence, and higher-tier portions of
  PRR-001/003/010/025-027.

## CP11 Durable Foundation Memory

- Canonical database state is migration `014`, 96 tenant-owned tables with forced RLS, and three
  non-super/non-bypass roles: `clinic_os_migrator`, `clinic_os_runtime` and `clinic_os_worker`.
- The API uses `clinic_os_runtime` with transaction-local tenant/clinic/user context. The worker must
  use `WORKER_DATABASE_URL`/`clinic_os_worker`; that role can process only outbox events, attempts and
  dead letters and is denied product-table reads.
- API domain, audit, timeline and outbox writes share `PostgresClinicUnitOfWork`. Do not reintroduce
  nested/independent transactions for a routed mutation.
- Worker durability was a real integration trap: unit tests passed while its expected outbox schema
  did not exist. Keep `worker:test:persistence` and the two-cycle worker health/restart smoke in any
  migration or worker closeout.
- Worker startup/runtime errors must close the health listener and database resources; requested
  SIGINT/SIGTERM shutdown exits cleanly and must not be logged as a crash.
- `/health/live`, `/health/startup` and `/health/ready` have separate meanings. Durable readiness
  probes schema version 014 and, under real auth, Keycloak JWKS. Fixture mode is reported as E2 and
  never counts as durable readiness.
- CP11 live smoke discovers tenant/clinic/user/resource IDs through `/v1/me` and runtime reads. It
  runs twice, rejects fixture repository fallback, checks validation/role/cross-tenant denials, and
  reconciles audit/outbox evidence.
- Critical API/Postgres time uses injected `Clock` and clinic IANA timezone. Remaining current-time
  boundaries are explicit in `scripts/check-clock-usage.mjs` and must not grow without ownership.
- All 14 production TypeScript workspaces use `tsc`; the negative branded-ID fixture proves the gate
  is semantic rather than syntax-only.
- Browser fixture smoke is E2 only. In-app Browser and Playwright caught a real `@clinic-os/ui`
  module-resolution problem, but neither upgrades fixture UI to durable/provider/device evidence.
- Tool discovery state at CP11 closeout: Terraform CLI absent; Docker Scout installed but requires
  Docker ID activation; Trivy/Syft absent. npm CycloneDX SBOM, high-severity audit and secret scan
  pass. Keep IaC/container/provenance gates open.
- `research/` and `scripts/research/` are user-owned. `.prettierignore` excludes them; never modify or
  stage them.

- Branch: `main` includes CP10 via merge commit `226a7b0`; post-promotion `git diff --check` and `npm run check` passed.
- Checkpoint 1 code is complete through `be619cd`.
- Checkpoint 2 integration is complete on `codex/integration/checkpoint-2`; verified code commit is `58bf864` and closeout evidence is in `docs: record checkpoint 2 verification`.
- CP2 documentation and evidence are recorded in `docs/orchestration/CHECKPOINT_02_LEAD_PATIENT_APPOINTMENT.md` and `docs/orchestration/CHECKPOINT_LOG.md`.
- Checkpoint 3 integration is verified on `codex/integration/checkpoint-3`; verified code commit is `eb68abd` and closeout evidence is in `docs/orchestration/CHECKPOINT_03_INTAKE_CONSENT_ENCOUNTER.md` plus `docs/orchestration/CHECKPOINT_LOG.md`.
- Checkpoint 3 used four visible project-scoped worktree lanes:
  - Clinical Backend: `019f39f6-8c8d-7ed3-89d7-a0569652c1bb`, `/Users/abhinavgupta/.codex/worktrees/81eb/ClinicOS`.
  - Security/Compliance: `019f39f6-c6ef-7691-af95-ef4be605d978`, `/Users/abhinavgupta/.codex/worktrees/4436/ClinicOS`.
  - Doctor/Assistant UX: `019f39f7-0632-7800-9d41-f55b44f38dd0`, `/Users/abhinavgupta/.codex/worktrees/75ee/ClinicOS`.
  - QA/Fixtures: `019f39f7-54bd-72e1-a812-dd0fda503d06`, `/Users/abhinavgupta/.codex/worktrees/08d3/ClinicOS`.
- Checkpoint 4 integration is verified on `codex/integration/checkpoint-4`, promoted to `main` via `248496a`, and detailed evidence is in `docs/orchestration/CHECKPOINT_04_DENTAL_CHART_MEDIA.md`.
- Checkpoint 4 used four visible project-scoped lanes:
  - Media Backend: `019f3a34-a5d9-78c1-a12c-25ce24bc9426`, `/Users/abhinavgupta/.codex/worktrees/7725/ClinicOS`.
  - Dental Domain: `019f3a34-d36e-7680-b3cd-1ad47240f656`, `/Users/abhinavgupta/.codex/worktrees/d4aa/ClinicOS`.
  - Dental/Media UX: `019f3a35-0fd0-73e3-a35b-5c33f236a270`, `/Users/abhinavgupta/.codex/worktrees/16fc/ClinicOS`.
  - Imaging/QA: `019f3a35-4418-7e93-91f6-7beffa65ac55`, `/Users/abhinavgupta/.codex/worktrees/9cf9/ClinicOS`.
- CP1 worker lanes were real Codex-managed worktrees under `.codex/worktrees`.
- A project-scoped worktree thread test succeeded: `target.type = "project"`, `projectId = "/Users/abhinavgupta/Desktop/ClinicOS"`, and `environment.type = "worktree"` made the worker visible under the `ClinicOS` project in the Codex sidebar.
- Checkpoint 5 is verified and promoted to `main` via merge commit `d679a78` plus closeout docs commit `6f9fe1c`.
- Checkpoint 5 used four fresh visible project-scoped lanes:
  - Billing Domain: `019f3bcc-2145-7dc0-9518-dc8477e86b51`, `/Users/abhinavgupta/.codex/worktrees/a598/ClinicOS`.
  - Payment Provider: `019f3bcc-213b-7191-8424-2856a60a85a0`, `/Users/abhinavgupta/.codex/worktrees/fae5/ClinicOS`.
  - Checkout UX: `019f3bcc-213b-7191-8424-284dd78c7323`, `/Users/abhinavgupta/.codex/worktrees/82db/ClinicOS`.
  - Clinical Output QA: `019f3bcc-216e-79b3-bd9d-db6d77e928a5`, `/Users/abhinavgupta/.codex/worktrees/1f2d/ClinicOS`.
- Checkpoint 6 is verified and promoted to `main` via merge commit `af93fde`; evidence docs commit is `d9bb50b` and final post-promotion check fix is `08ddab9`.
- Checkpoint 6 used four visible project-scoped lanes:
  - Workflow/Task Backend: `019f3c1d-1708-7893-bfd7-1329dff99220`, `/Users/abhinavgupta/.codex/worktrees/dbc7/ClinicOS`.
  - Lab/Inventory/Event: `019f3c1d-6d96-7310-ba40-bed750544a62`, `/Users/abhinavgupta/.codex/worktrees/0166/ClinicOS`.
  - Operations UX: `019f3c1d-b7c5-7a32-8ee4-a1669e58aa73`, `/Users/abhinavgupta/.codex/worktrees/9f26/ClinicOS`.
  - Analytics/QA: `019f3c1e-1658-7aa2-ab3a-ca5135838beb`, `/Users/abhinavgupta/.codex/worktrees/4ff2/ClinicOS`.
- Checkpoint 7 launch packet is `docs/orchestration/CHECKPOINT_07_LIVE_INTEGRATIONS_MIGRATION_HARDENING.md`. CP7 visible project-scoped worktree lanes:
  - Messaging Provider: `019f3c69-e395-7f43-85e0-9513a2546ad6`, `/Users/abhinavgupta/.codex/worktrees/aa0f/ClinicOS`.
  - Telephony/Source: `019f3c6a-2d9c-7c01-bbad-d95e05fdcf9c`, `/Users/abhinavgupta/.codex/worktrees/046c/ClinicOS`.
  - Migration/Data: `019f3c6a-655d-7223-8cf2-8cde3cf10b80`, `/Users/abhinavgupta/.codex/worktrees/9644/ClinicOS`.
  - Integration Ops/QA: `019f3c6a-9b72-7642-ab14-ce002f1d9511`, `/Users/abhinavgupta/.codex/worktrees/386a/ClinicOS`.
- Checkpoint 7 is verified and promoted to `main` via merge commit `92fb2b9`; master integration patch commit is `c193b81`. CP7 reconciled live provider-health, integration-dead-letter replay, migration-batch collection, and row-based migration resolution contracts.
- Checkpoint 8 launch packet is `docs/orchestration/CHECKPOINT_08_MOBILE_CAPTURE_AI_SCRIBE.md`; CP8 visible project-scoped worktree lanes:
  - Mobile Capture: `019f3cb7-ee10-7c83-a5c1-1407c64a7158`, `/Users/abhinavgupta/.codex/worktrees/834a/ClinicOS`.
  - AI Backend: `019f3cb8-2e5c-7dd1-8865-02823428698c`, `/Users/abhinavgupta/.codex/worktrees/0b3b/ClinicOS`.
  - Review UX: `019f3cb8-6e4e-73d3-9754-9cbd5aa583d9`, `/Users/abhinavgupta/.codex/worktrees/fc5f/ClinicOS`.
  - AI Safety/QA: `019f3cb8-a9ea-79b2-9edd-d44513a60668`, `/Users/abhinavgupta/.codex/worktrees/25b2/ClinicOS`.
  - Superseded duplicate Mobile Capture thread `019f3cab-83a6-7d42-8813-7829e961a04f` from base `f562a8e` was archived and must not be integrated.
- Checkpoint 8 is verified and promoted to `main` via merge commit `8ac2dae`; verified integration patch commit is `f967144`.
- Checkpoint 9 launch packet is `docs/orchestration/CHECKPOINT_09_INTEROPERABILITY_SECURITY_OPS.md`. CP9 visible project-scoped worktree lanes:
  - Security/Privacy: `019f3cec-36fc-7390-a841-bf11cb1a669c`, `/Users/abhinavgupta/.codex/worktrees/6d89/ClinicOS`.
  - FHIR/ABDM: `019f3cec-83b6-7383-81f5-e14f267d2392`, `/Users/abhinavgupta/.codex/worktrees/1238/ClinicOS`.
  - Infrastructure/Ops: `019f3cec-d3a3-7a71-ba13-ab7ceaf09f69`, `/Users/abhinavgupta/.codex/worktrees/7e8c/ClinicOS`.
  - Performance/QA: `019f3ced-1911-78e1-9301-ce5df9e8e934`, `/Users/abhinavgupta/.codex/worktrees/1091/ClinicOS`.
- Checkpoint 9 is verified on `codex/integration/checkpoint-9` at `ea13a97` and promoted to `main` via `131300b`. Security/Privacy, FHIR/ABDM, Infrastructure/Ops, and Performance/QA lanes were merged in dependency order. Full gates passed: `npm run check`, `npm run security:secrets`, `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`. Post-promotion checks passed: `git diff --check` and `npm run check`. CP9 browser smoke passed for owner compliance desktop/mobile and platform-support unavailable shells.
- Checkpoint 10 launch packet is `docs/orchestration/CHECKPOINT_10_RELEASE_CANDIDATE_PILOT_READINESS.md`. CP10 visible project-scoped worktree lanes:
  - Pilot Configuration: `019f3d25-61be-7d92-a99a-a558e578a53d`, `/Users/abhinavgupta/.codex/worktrees/b1c9/ClinicOS`.
  - UX Polish: `019f3d25-c537-7e43-abed-c56a4938202d`, `/Users/abhinavgupta/.codex/worktrees/9bcb/ClinicOS`.
  - End-To-End QA: `019f3d26-17d5-71a2-ac81-1e94de547afb`, `/Users/abhinavgupta/.codex/worktrees/5cd7/ClinicOS`.
  - Operations/Docs: `019f3d26-4626-7bd1-9043-a968ec6e128b`, `/Users/abhinavgupta/.codex/worktrees/6dce/ClinicOS`.
- Checkpoint 10 is complete on `main` via merge commit `226a7b0` after verifying `codex/integration/checkpoint-10`. CP10 merged Pilot Configuration (`c158969` plus `f6f2716`), UX Polish (`4740a10`), End-To-End QA (`23c628e`), and Operations/Docs (`fc3511f`). Master closeout added missing ABDM web fixture/readiness evidence, reran full gates, and recorded release-candidate evidence in `docs/orchestration/CHECKPOINT_10_FINAL_REPORT.md`.
- The initial CP5 launch attempt created visible project-scoped worktrees at `f495c02`, but all worker turns failed before implementation with Codex account usage-limit errors. Treat those `CP5 FAILED - ...` threads as historical only.

## Non-Negotiable Product Posture

- ClinicOS is replacement-grade clinic software, not an MVP.
- Reduce scope only by deferring whole workflows.
- Do not weaken implemented workflows with placeholders, fake product behavior, insecure shortcuts, unaudited PHI paths, or brittle unofficial integrations.
- Test doubles, fixtures, and simulators are allowed only for local development and automated tests behind typed provider contracts.

## Worktree Launch Memory

For visible isolated worker lanes, use project-scoped Codex threads:

```ts
create_thread({
  prompt: "<lane prompt>",
  target: {
    type: "project",
    projectId: "/Users/abhinavgupta/Desktop/ClinicOS",
    environment: {
      type: "worktree"
    }
  }
});
```

Do not use hidden subagents when the user needs sidebar visibility. Do not rely on raw `git worktree add` for worker sessions that should appear in the Codex UI.

Record:

- Pending worktree ID.
- Resolved thread ID.
- Worktree path.
- Base commit.
- Lane ownership.
- Expected verification and user-smoke evidence.

## Merge And Integration Memory

CP1's slowest part was master merge/integration, not worker execution. The integration loop was correct but too reactive.

For CP2 and later:

- Build a conflict map from lane handoffs before merging.
- Use a checkpoint integration branch or equivalent worktree before merging to `main`.
- Merge in dependency order.
- Run narrow checks after each merge and one full checkpoint suite after all merges and patches.
- Reconcile `package-lock.json` once after package manifests stabilize.
- Keep `main` as the last verified checkpoint until integration gates pass.

Follow `docs/orchestration/MERGE_INTEGRATION_RUNBOOK.md`.

## CP2 Integration Lessons

- Live local smoke must use the same actor header spelling as the API fixture adapter. Prefer sending `X-Clinic-OS-Dev-Subject`; the server also accepts the legacy `X-ClinicOS-Dev-Subject` spelling for local/test robustness.
- Live smoke fixtures must carry runtime IDs from API responses. Do not fall back to deterministic fixture UUIDs when the local fixture repository creates runtime UUIDs.
- If a live-local smoke creates new patients, use per-run unique contact/name data so repeat smoke attempts do not poison the no-match branch.
- Timeline APIs should expose public categories and dotted event types, while storage projections may use internal enum names. Keep audit/outbox event evidence separate from patient timeline projection evidence.
- For browser E2E, keep route registration, canonical fixture keys, and `data-testid` selectors aligned with the QA fixture. Diagnose missing UI by registration/route first, then runtime.
- Client-side role visibility should match backend permissions. Hiding controls is not a substitute for API authorization, but browser smoke should not show patient-create controls for accountant profiles.

## CP3 Integration Lessons

- Canonical API routes must be normalized before merging web/QA lanes. CP3 settled on patient-scoped `form-responses`, patient-scoped consent revoke, encounter-scoped `PATCH` note drafts, encounter-scoped note sign/amend, encounter-scoped prescription draft, and prescription-scoped sign.
- Keep deterministic fixture contracts separate from local runtime-ID smoke. CP3 fixture IDs intentionally differ from the local API fixture, while the local API test proves runtime-generated IDs are carried through the workflow.
- For web workflows, keep the app-owned Playwright spec and root mirrored E2E spec aligned with actual `data-testid` selectors. Stale selector proposals are a merge-time smell, not an accepted gap.
- Browser role-denial smoke should use a separate fixture server/profile when the local dev identity fixture is selected by build-time environment variables.
- AI/audio capture remains deferred after CP3. Do not add fake capture routes; consume the consent-enforcement state in the later checkpoint that owns AI/audio.

## CP4 Integration Lessons

- Keep deterministic fixture contract plans and live API route contracts synchronized before merge. CP4 caught a dry-run script that still described older external imaging-link route shapes while the durable media API used upload, complete, list, and signed-access routes.
- If a browser workflow is smoke-tested in fixture mode, add a separate unit or integration test for live API helper route shapes. CP4 fixture smoke passed while the web live helper still called stale media routes; the corrected live route sequence is upload reservation, upload content, upload completion by upload id, and signed URL by media asset id.
- Keep external imaging reference/link support deferred as a whole workflow until a real adapter/API is owned. Do not quietly add a partial `/links`-style client route to make fixture coexistence evidence look live.
- When a web workflow relies on checkpoint fixtures, start the web server with the matching fixture flag. CP4 required `NEXT_PUBLIC_CLINIC_OS_USE_CP4_WORKFLOW_FIXTURE=true` in addition to the dev identity fixture.
- Media and dental schema changes should land in one canonical numbered migration during integration. Lane-local schema proposal docs are useful, but the integration branch owns the migration actually applied by the app.
- Browser/mobile smoke remains useful for temporary UI because it proves route registration, role-conditioned controls, responsive reachability, and no horizontal overflow. Do not spend time on final visual polish before the design pass unless usability or safety is broken.
- Never expose bucket names, object keys, raw storage paths, or PHI-bearing private media references in patient-facing API payloads. Use mediated signed access and audit media view/write operations.
- If multi-tooth chart editing is not explicitly in scope, preserve a complete one-finding-per-row workflow and defer bulk chart patching as a whole workflow rather than hiding partial bulk behavior inside a weak endpoint.
- Current-tree CP4 audit found the product route family was durable, but the contract smoke plan still listed stale/deferred media routes. Keep fixture-only coexistence evidence separate from live API smoke plans. Live CP4 media smoke must use dynamic upload/media IDs through `POST /v1/media/upload-urls`, `PUT /v1/media/uploads/{uploadId}/content`, `POST /v1/media/uploads/{uploadId}/complete`, `GET /v1/patients/{patientId}/media`, and `POST /v1/media/assets/{mediaAssetId}/signed-url`.

## CP5 Integration Lessons

- Before declaring a checkout workflow live, reconcile browser helper request bodies with backend parsers. CP5 needed explicit mapping from web `amountCents`, treatment phase `name`, and selected estimate-item UI state to backend `amountMinor`, phase `title`, and `treatmentPlanEstimateItemId`.
- Do not advertise aggregate workflow read routes that are not implemented. CP5 keeps `GET /v1/clinical-workflows/cp5` deferred as a whole read-model workflow and returns `CP5_READ_MODEL_DEFERRED` in non-fixture web mode instead of calling a stale route.
- Instruction print/send request is a real CP5 workflow. It must persist `patient_instruction_requests`, emit audit/outbox/timeline evidence, and keep `providerConfirmationReceived`, `providerDeliveryConfirmedAt`, `deliveredAt`, and `readAt` empty until a real provider confirms delivery.
- Prefer narrow workflow permissions over broad PHI permissions when a role needs a specific clinical-output action. CP5 receptionists can create instruction request evidence through `patient_instruction.write` without gaining general `patient.phi.read`.
- Browser negative assertions should avoid accidental word matches. The CP5 "no delivered/read" smoke must match whole words so it does not fail on legitimate states like "print ready."
- `npm run security:audit` may be blocked by policy because npm audit discloses dependency inventory to the external registry audit service. Record the rejection exactly and keep `npm run security:secrets` plus code/test/build/browser evidence; do not try to bypass the policy.

## CP6 Integration Lessons

- CP6 lane boundaries were directionally right, but shared contracts still converged in the master pass. For future checkpoints, explicitly name one owner for migrations, route registration, permissions, audit classes, fixture IDs, and dashboard read-model shapes before launch.
- Keep migrations split by true workflow ownership when parallel lanes produce separate durable areas. CP6 preserves `0006_continuity_tasks_recalls_sops.sql` and `0007_lab_inventory_events.sql` instead of folding unrelated operations workflows into one migration.
- Do not let analytics lanes create parallel domain model shapes for records already owned elsewhere. CP6 owner-dashboard task projections import canonical continuity task types from `packages/domain/src/continuity.ts`.
- Browser CP fixture smoke must start with every required fixture flag. CP6 needs both `NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true` and `NEXT_PUBLIC_CLINIC_OS_USE_CP6_OPERATIONS_FIXTURE=true`; missing fixture setup means no valid user-smoke evidence.
- Keep local contract dry-runs and live-base smokes distinct. CP6 `node scripts/cp6-contract-smoke.mjs --dry-run` validates the route contract without a running API; full live smoke requires `--base-url` or `CLINICOS_CP6_API_BASE_URL`.
- Temporary operations UI still deserves mobile/browser smoke for route registration, role safety, reachable controls, honest unavailable states, and no horizontal overflow. Do not spend time on final visual polish before the design pass unless those safety/usability invariants fail.

## CP7 Integration Lessons

- Fixture browser smoke can pass while live helper contracts are stale. CP7 Ops/QA originally used `conflicts/{conflictId}/resolve`, while the backend canonical contract is row-centered: `rows/{rowId}/resolve`. Master integration must scan fixture docs, web helpers, navigation metadata, and API routes together before closeout.
- Keep deterministic fixture IDs out of live-smoke assumptions unless they are actually seeded into the API runtime. CP7 keeps fixture dry-run route plans separate from API operations tests for provider health, dead-letter replay requests, and migration collection reads.
- Provider health dashboards must not treat local simulators as provider readiness. Surface simulator/dev state as local-only, unavailable, or not configured for CP7 ops while still allowing simulator-backed contract tests elsewhere.
- Dead-letter replay is a request/evidence workflow until a handler confirms processing. Do not mark WhatsApp delivery/read, missed-call capture, payment, or patient state as completed from the replay button alone.
- For migration imports, resolve rows, not abstract conflicts. The row is the durable commit/skip/link unit and carries the conflict evidence needed to preserve no-overwrite behavior.

## CP8 Integration Lessons

- In deterministic contract smokes, `liveImplemented: false` means the fixture step is not directly executable against an arbitrary live runtime with deterministic fixture IDs; it does not mean the product route is absent. Cross-check API tests and route registration before treating a dry-run fixture marker as a missing feature.
- Keep CP8 route families canonical across backend, safety fixtures, and browser specs. The implemented route family is `ai-scribe`, for example `POST /v1/encounters/{encounterId}/ai-scribe/sessions` and `POST /v1/ai-scribe/sessions/{sessionId}/review-decisions`.
- Missing or revoked AI/audio consent is a workflow-state block (`409 AI_AUDIO_CONSENT_REQUIRED`), not a generic authorization denial. Preserve the distinction between role permission failures and patient-consent state.
- Shared packages with ignored `dist` output may leave stale compiled code for narrow package tests. Run `npm run build:shared` before package-level API/integrations tests when shared package contracts changed.
- Dev identity fixture roles are process-wide for web browser smokes. Run separate web server processes for doctor and assistant smokes with `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=doctor` or `assistant`, or gate role-specific assertions in the Playwright spec.
- Do not invent fake web routes for Expo mobile workflows. Mobile capture evidence belongs to the mobile lane through Expo/mobile tests and screenshots; the web CP8 surface owns review UX only.
- If the Codex in-app browser is unavailable in a worker lane, record that blocker and use explicit Playwright fallback evidence. Do not claim in-app browser evidence when only Playwright ran.
- AI review approvals in CP8 are review-only evidence. Do not let future lanes interpret CP8 approval buttons as chart, note, prescription, billing, or messaging application unless a later checkpoint owns that whole authorized workflow.

## CP9 Integration Lessons

- Reconcile deterministic QA route contracts against merged API routes before closeout. CP9 Performance/QA initially described `/export-requests`, `/retention/runs`, and `/break-glass/requests`; the canonical merged Security routes are `/v1/patients/{patientId}/record-exports`, `/v1/privacy/deletion-requests`, `/v1/privacy/retention-runs`, and `/v1/break-glass/access-requests`.
- Distinguish live implemented APIs from projection-package evidence. CP9 FHIR is implemented as `@clinic-os/fhir` with local fixture validation; it must not be marked as a live FHIR API route until a later checkpoint owns that route.
- Registered-unavailable web shells still need browser smoke. CP9 compliance/platform-support shells were tested for honest unavailable state, canonical API-boundary text, no fake completion claims, and 390px no-horizontal-overflow.
- When the web app is smoke-tested without a running API server, start it with `NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true`; otherwise the shell correctly reports `/v1/me` as unregistered and the surface smoke is invalid.
- Role-specific CP9 browser smoke requires separate server processes or environment runs for `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner` and `platform_admin`.
- Terraform/restore evidence must stay non-mutating by default. CP9 uses a validation-only Terraform profile and synthetic restore dry-run evidence; do not treat these as cloud readiness or live restore proof.
- ABDM readiness is not ABDM activation. Empty credentials should remain `not_configured`/`unavailable`, log summaries must not expose credential values, and `liveExchangeAllowed` remains false even for sandbox-ready posture until compliance activation exists.
- `npm run security:audit` remains an external dependency-inventory disclosure and should not be rerun after policy rejection without explicit user approval. Keep `npm run security:secrets`, code review, and local tests as the default security gates.

## CP10 Integration Lessons

- Release-candidate readiness must keep web fixture evidence, domain/API readiness builders, deterministic CP10 fixtures, and release docs aligned. CP10 owner browser smoke caught that the domain/API model and docs treated ABDM as an external live gate while the web fixture omitted it.
- For CP10 and later role-specific web smoke, start separate web server processes per `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE`. The role is process-scoped, so assistant, owner, platform_admin, and accountant checks need separate server runs or carefully gated specs.
- Browser smoke should assert the presence of external-go-live gaps, not only absence of fake success. CP10 now checks that owner readiness shows ABDM and other blocked/deferred gates rather than quietly omitting them.
- Technical release-candidate acceptance is not pilot go-live approval. Keep real clinic data, live providers, ABDM, AWS apply/live restore, GitHub push/remote CI, and physical devices as external gates until explicit evidence and sign-off exist.
- Operations/Docs lanes should provide report structure and release artifacts, but the master closeout must replace pending/draft language with actual lane commits, commands, screenshots, accepted gaps, and go/no-go decisions.

## Shared-File Mistakes To Avoid

- Do not let multiple lanes independently own `package-lock.json`.
- Do not let Repo/DevEx overwrite real app scripts after app lanes have implemented them.
- Do not split one migration sequence across parallel lanes.
- Do not let frontend/mobile invent durable API contracts without a named contract owner.
- Do not defer checkpoint-critical bootability to master unless the lane prompt explicitly makes it a master-owned integration gate.
- Do not claim browser/mobile smoke passed when tooling was unavailable; report the blocker early.

## Browser And Mobile Memory

Browser/app tooling must be explicit for UI lanes:

- Verify Codex browser/Chrome/Playwright access in the first minutes of the worker thread.
- If unavailable, report immediately so the master can assign a QA lane or install repo-local tooling.
- Do not rely on ambient tools that are present only in the master session.

For temporary UI, test user-safety and responsive invariants:

- No horizontal overflow at 390px mobile width.
- Navigation and primary controls remain reachable.
- Loading, empty, error, auth-unavailable, and feature-unavailable states are honest.
- No fake PHI or fake clinical/payment workflow completion appears as real product behavior.

Do not spend integration time on final visual polish before the real design pass unless layout/usability is broken.

## Monitoring Memory

Monitor active worker threads quietly. Check status often enough to know running, blocked, or complete state, but avoid constant steering. A 90-120 second review cadence is reasonable during active orchestration, with immediate intervention only for true blockers, unsafe scope drift, or completed handoffs ready for review.

This is a master control loop, not a hidden automation unless an explicit Codex automation is configured.

## Documentation Memory

Update these during orchestration:

- `docs/orchestration/CHECKPOINT_LOG.md` for checkpoint state.
- `docs/orchestration/CHECKPOINT_N_*.md` for detailed checkpoint evidence.
- `docs/orchestration/MERGE_INTEGRATION_RUNBOOK.md` when merge process changes.
- This `docs/AGENT_MEMORY.md` when durable operating lessons change.
- `AGENTS.md` only for durable repo-wide rules that every future agent should obey.

## CP12 Integration Memory

- HTTP idempotency metadata is not compliance. A replayable mutation must claim and complete its
  key inside the same Postgres transaction as domain, audit and outbox effects. Redis remains an
  abuse-budget store and cannot substitute for that atomicity.
- `If-Match` metadata needs a durable positive safe-integer version source, a conditional
  `UPDATE ... WHERE row_version = expected RETURNING`, and an ETag derived from the actual response
  row version. Audit indirect linked-row updates as well as direct PATCH handlers.
- A strangler adapter is acceptable only after every request enters the same registered policy,
  strict request contract, budgets, mutation coordinator, response contract and central error
  serializer. A catch-all controller by itself is not a modular/security boundary.
- Route inventory must inspect real framework registrations. For the CP12 Nest boundary, scan the
  explicit controller decorators and the catch-all adapter, then compare them with the authoritative
  runtime operation registry and generated inventory.
- Clean-database evidence must recreate the canonical synthetic database. A stale local volume with
  test-created rows is diagnostic state, not evidence, even if RLS itself is functioning.
- Never reuse a listener from a deleted or historical worktree for browser evidence. Verify the
  process belongs to the exact integrated revision and role/fixture configuration, or mark browser
  evidence unavailable.
- A Redis client that is merely open is not necessarily ready. Production budget stores must bound
  or disable the offline command queue, fail fast while reconnecting, and prove both denial and
  recovery with repeated real stop/start fault injection.
- Dependency audits can disclose the repository's dependency inventory to an external registry.
  Treat that transmission as an explicit-authority gate. If managed policy still rejects the
  command after informed user authorization, do not retry or route around it; require exact output
  and exit status from an authorized operator or approved CI environment. Never substitute cached
  or local-only output while claiming the required external audit passed.

## CP13 Integration Memory

- A due-generation workflow progress count must represent processed candidate outcomes, not the
  number of durable entities emitted. One procedure candidate may atomically create both a recall
  and its linked task while still counting as one created outcome.
- One transaction-bound node-postgres client cannot execute concurrent queries. Serialize bound
  repository-port operations even if feature code uses `Promise.all`; trace deprecations during E3
  so overlap is found before pg 9 turns it into a hard failure.
- Durable runtime smokes must be repeatable on the same state. Run-scope every unique fixture field,
  accept cursor pages that legitimately skip existing rows, use canonical consent purposes and
  contract limits, and never assume the database still contains only seed rows after a smoke.
- Payment/provider recovery progress and web payment intent are not settlement. Provider evidence
  must be signed and digest-bound; overpayment is capped and reconciled; pending intent UI must say
  that it is not payment confirmation.
- Patient-supplied media stays pending/quarantined until an official inspection provider supplies
  durable evidence. Public media DTOs must strip object keys, paths, provider versions and other
  storage authority.
- A web access-token seam may be registration-only and fail closed for CP13. Never source tokens or
  patient/encounter/invoice selection from URLs, public environment values, local storage or session
  storage. CP14 owns the production BFF/session lifecycle.
- When the in-app Browser backend is unavailable, record the exact failure and run the explicitly
  enabled Playwright suite against the exact integrated production build. An unflagged all-skipped
  invocation is diagnostic output, not browser evidence.
- Post-smoke RLS verification should assert that every visible row belongs to the scoped tenant and
  canonical seed rows remain present. It must not assume the row count remains equal to the initial
  seed count.

## CP14 Integration Memory

- Mock Terraform runtime shape is not startup evidence. Reconcile every ECS port, production-like
  environment flag, required URL and secret JSON key against the actual API/worker parsers before a
  runtime plan.
- Scan the final pruned runtime image, not only the lockfile or build stage. A pinned Node base can
  still contain vulnerable OS libraries and npm-bundled tooling even when the application production
  dependency tree is clean. Pin patched OS packages and remove unused package managers.
- Workspace-filtered production installs materially reduce image size and attack surface. Do not
  copy the monorepo-wide `node_modules` or nested workspace development dependencies into API or
  worker images.
- A clean CI runner lacks generated shared-package outputs that may exist locally. Build shared
  outputs before acceptance fixtures that import workspace package exports.
- Self-hosted Temporal definitions are not deployable because ECS services and a schema task exist.
  Freeze and test the exact schema tool, dynamic configuration, authentication/mTLS, numeric UID and
  service startup contract before permitting the runtime phase.
- Temporal's upstream production template defaults service binds and cluster metadata to loopback.
  Multi-task ECS requires a validated routable task address from official ECS metadata, explicit
  membership ports, non-loopback frontend metadata, and repeatable config/start evidence.
- Temporal frontend TLS uses separate `TEMPORAL_TLS_FRONTEND_CERT_DATA`/key inputs from internode
  server TLS. Supplying only the internode certificate leaves the external worker boundary empty.
- Workload OAuth and JWKS traffic belongs on the canonical Keycloak authentication hostname. Never
  grant application workloads access to the operator-only admin hostname just to fetch tokens or
  signing keys.
- `verify-full`/`verify-server` is incomplete without the RDS CA trust chain. Pin the official AWS
  RDS bundle digest in platform images and assert the exact CA path in both migration and runtime
  configuration; live RDS handshake evidence is still required.
- Platform images need more than a version and vulnerability scan. CI should exercise fail-closed
  bootstrap/schema commands, real config rendering/start paths, clean realm import/readiness and
  exact service-account claims.
