# ClinicOS Agent Memory

Last updated: 2026-07-07

This file captures durable execution memory for future Codex sessions. Treat `clinic_os_specs_v2/` as the product source of truth and this file as operational memory about how to work in this repository.

## Current Orchestration State

- Branch: `main` after verified Checkpoint 3 promotion. Checkpoint 4 launch packet is active from base `c7b222c`.
- Checkpoint 1 code is complete through `be619cd`.
- Checkpoint 2 integration is complete on `codex/integration/checkpoint-2`; verified code commit is `58bf864` and closeout evidence is in `docs: record checkpoint 2 verification`.
- CP2 documentation and evidence are recorded in `docs/orchestration/CHECKPOINT_02_LEAD_PATIENT_APPOINTMENT.md` and `docs/orchestration/CHECKPOINT_LOG.md`.
- Checkpoint 3 integration is verified on `codex/integration/checkpoint-3`; verified code commit is `eb68abd` and closeout evidence is in `docs/orchestration/CHECKPOINT_03_INTAKE_CONSENT_ENCOUNTER.md` plus `docs/orchestration/CHECKPOINT_LOG.md`.
- Checkpoint 3 used four visible project-scoped worktree lanes:
  - Clinical Backend: `019f39f6-8c8d-7ed3-89d7-a0569652c1bb`, `/Users/abhinavgupta/.codex/worktrees/81eb/ClinicOS`.
  - Security/Compliance: `019f39f6-c6ef-7691-af95-ef4be605d978`, `/Users/abhinavgupta/.codex/worktrees/4436/ClinicOS`.
  - Doctor/Assistant UX: `019f39f7-0632-7800-9d41-f55b44f38dd0`, `/Users/abhinavgupta/.codex/worktrees/75ee/ClinicOS`.
  - QA/Fixtures: `019f39f7-54bd-72e1-a812-dd0fda503d06`, `/Users/abhinavgupta/.codex/worktrees/08d3/ClinicOS`.
- Checkpoint 4 is active with visible project-scoped lanes:
  - Media Backend: `019f3a34-a5d9-78c1-a12c-25ce24bc9426`, `/Users/abhinavgupta/.codex/worktrees/7725/ClinicOS`.
  - Dental Domain: `019f3a34-d36e-7680-b3cd-1ad47240f656`, `/Users/abhinavgupta/.codex/worktrees/d4aa/ClinicOS`.
  - Dental/Media UX: `019f3a35-0fd0-73e3-a35b-5c33f236a270`, `/Users/abhinavgupta/.codex/worktrees/16fc/ClinicOS`.
  - Imaging/QA: `019f3a35-4418-7e93-91f6-7beffa65ac55`, `/Users/abhinavgupta/.codex/worktrees/9cf9/ClinicOS`.
- CP1 worker lanes were real Codex-managed worktrees under `.codex/worktrees`.
- A project-scoped worktree thread test succeeded: `target.type = "project"`, `projectId = "/Users/abhinavgupta/Desktop/ClinicOS"`, and `environment.type = "worktree"` made the worker visible under the `ClinicOS` project in the Codex sidebar.

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
