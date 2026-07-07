# ClinicOS Agent Memory

Last updated: 2026-07-07

This file captures durable execution memory for future Codex sessions. Treat `clinic_os_specs_v2/` as the product source of truth and this file as operational memory about how to work in this repository.

## Current Orchestration State

- Branch: `main` after Checkpoint 5 promotion commit `6f9fe1c`; Checkpoint 6 launch is in progress from this verified base.
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
- Checkpoint 6 lanes are planned as Workflow/Task Backend, Lab/Inventory/Event, Operations UX, and Analytics/QA. Launch them as visible project-scoped worktree threads from the current `main`.
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

## CP5 Integration Lessons

- Before declaring a checkout workflow live, reconcile browser helper request bodies with backend parsers. CP5 needed explicit mapping from web `amountCents`, treatment phase `name`, and selected estimate-item UI state to backend `amountMinor`, phase `title`, and `treatmentPlanEstimateItemId`.
- Do not advertise aggregate workflow read routes that are not implemented. CP5 keeps `GET /v1/clinical-workflows/cp5` deferred as a whole read-model workflow and returns `CP5_READ_MODEL_DEFERRED` in non-fixture web mode instead of calling a stale route.
- Instruction print/send request is a real CP5 workflow. It must persist `patient_instruction_requests`, emit audit/outbox/timeline evidence, and keep `providerConfirmationReceived`, `providerDeliveryConfirmedAt`, `deliveredAt`, and `readAt` empty until a real provider confirms delivery.
- Prefer narrow workflow permissions over broad PHI permissions when a role needs a specific clinical-output action. CP5 receptionists can create instruction request evidence through `patient_instruction.write` without gaining general `patient.phi.read`.
- Browser negative assertions should avoid accidental word matches. The CP5 "no delivered/read" smoke must match whole words so it does not fail on legitimate states like "print ready."
- `npm run security:audit` may be blocked by policy because npm audit discloses dependency inventory to the external registry audit service. Record the rejection exactly and keep `npm run security:secrets` plus code/test/build/browser evidence; do not try to bypass the policy.

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
