# ClinicOS Agent Memory

Last updated: 2026-07-06

This file captures durable execution memory for future Codex sessions. Treat `clinic_os_specs_v2/` as the product source of truth and this file as operational memory about how to work in this repository.

## Current Orchestration State

- Branch: `main`.
- Checkpoint 1 code is complete through `be619cd`.
- Post-CP1 documentation and orchestration memory are recorded in `docs/orchestration/CHECKPOINT_LOG.md` and this file.
- Checkpoint 2 must start from the latest clean `main` after a fresh preflight.
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
