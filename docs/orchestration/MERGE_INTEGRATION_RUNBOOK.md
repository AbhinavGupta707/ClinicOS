# Merge And Integration Runbook

Date: 2026-07-09

This runbook optimizes the master orchestration pass after isolated worker lanes finish. For CP12-CP18 it supplements the `orchestrate-worktrees` skill, `docs/orchestration/POST_CP11_WORKTREE_ORCHESTRATION_PROGRAM.md`, and the active checkpoint packet. Plan 20 remains historical CP0-CP10 context.

## CP12-CP18 Control Addendum

- Master runs on `gpt-5.6-sol` `xhigh`; visible worktree workers use the packet’s explicit `gpt-5.6-sol` `high`/`xhigh` setting.
- Create and verify the requested 90-second thread heartbeat at orchestration start. If rejected, record it and use the documented active-loop/fallback cadence.
- Build a path-level conflict matrix before thread creation. Two workers must not own the same implementation file.
- Use project ID `/Users/abhinavgupta/Desktop/ClinicOS` resolved through `list_projects`; never use hidden/projectless/raw worktrees.
- Workers commit lane changes but never merge or change release truth. The master reviews actual worktree commits/diffs.
- `main` remains the last verified checkpoint; all lane integration happens on `codex/integration/checkpoint-N`.

## CP1 Lesson

Checkpoint 1 proved that isolated worker lanes can produce useful production-grade slices. The slow part was not worker execution. The slow part was the master merge and integration loop.

The CP1 integration loop was correct and conservative, but not fully optimized:

- It merged valid lane work, resolved normal shared-file conflicts, and ran real verification.
- It discovered several acceptance gates late: API boot, mobile boot, real local-stack startup, and true mobile viewport evidence.
- It repeated some setup/check work because shared dependency and lockfile policy was not explicit before lane launch.
- It relied on ambient browser tooling in workers instead of making browser evidence a declared lane capability.

The goal for CP2 and later is not to weaken integration. The goal is to move predictable work earlier, reduce duplicate checks, and keep `main` cleaner until a checkpoint is verified.

## Optimized Flow

### 1. Pre-Merge Intake

When a lane reports complete, do not merge immediately unless its dependency order clearly requires it and its shared-file surface is known.

For every completed lane, collect:

- Thread ID and worktree path.
- Branch and commit hash.
- `git status --short`.
- `git diff --stat <base>...HEAD`.
- Changed file list.
- Dependency changes.
- Migration/env/provider changes.
- Browser/app/user-smoke evidence or explicit blocker.
- Handoff risks and integration instructions.

Build a conflict map before the first merge:

- Which lanes touched root `package.json`, `package-lock.json`, app package manifests, app READMEs, migrations, API contracts, generated files, env templates, Docker files, or CI.
- Which lane is the primary owner for each shared file.
- Which conflicts are expected and which indicate a lane boundary violation.

### 2. Use A Checkpoint Integration Branch

For non-trivial checkpoints, integrate on a branch such as:

```sh
git switch -c codex/integration/checkpoint-N
```

or an equivalent Codex-managed integration worktree. Keep `main` as the latest verified checkpoint until the integration branch passes.

Merge lane commits in dependency order:

1. Schema/migrations/domain contracts.
2. Backend/API/provider/runtime contracts.
3. Shared packages and generated types.
4. Frontend/mobile consumers.
5. QA/docs/runbooks.

Only merge the integration branch back to `main` after final checkpoint gates pass.

### 3. Shared-File Ownership Rules

Set these rules in every checkpoint launch packet.

| Surface                         | Default Owner               | Rule                                                                                               |
| ------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| `package-lock.json`             | Integration or Repo/DevEx   | Workers should not commit it unless they explicitly own dependency graph integration for the lane. |
| Root `package.json`             | Repo/DevEx or Integration   | Feature lanes request root script changes in handoff unless explicitly assigned.                   |
| App `package.json`              | App owner                   | App lanes may add app-local dependencies/scripts; Repo/DevEx should avoid overwriting real ones.   |
| App READMEs                     | App owner, Docs after merge | Feature lanes document runtime contracts; docs/integration can normalize after merge.              |
| Migrations                      | One data/schema owner       | Do not split one migration series across parallel lanes.                                           |
| API contracts/generated clients | Contract owner              | Consumers may mirror types temporarily only with documented assumptions.                           |
| Docker/local stack              | Repo/DevEx                  | Must run `local:up` when stack bootability is an exit gate, not only `docker compose config`.      |
| Browser/app smoke tooling       | Lane owning UI or QA lane   | Must be proven available early or reported as a blocker.                                           |

### 4. Check Cadence

Avoid running the full suite after every lane unless the lane changes a global contract.

After each merge:

- Run `git diff --check`.
- Run a narrow check for the merged area.
- Run compile/test checks needed to prove the merge resolution is sane.

After all lanes and integration patches:

- Run one full checkpoint suite, normally `npm run ci` when available.
- Run local service boot checks required by the checkpoint.
- Run browser/mobile/provider user-perspective checks.
- Run docs/runbook consistency checks.

Dependency install policy:

- If multiple lanes changed package manifests, do one lockfile reconciliation after those lane commits are on the integration branch.
- Run `npm install` once to refresh `package-lock.json`, then commit the reconciled lockfile on the integration branch.
- Use `npm ci` only after the lockfile is stable and committed, or as a final reproducibility check.

### 5. Browser And Mobile Evidence

Workers that own UI must verify tooling in the first minutes:

- Codex browser or Chrome control available, or
- repo-declared Playwright available, or
- a dedicated QA lane/master check is assigned.

Do not let a worker finish with a surprise "browser unavailable" caveat unless it reported that blocker early.

For rough placeholder UI, test functional invariants rather than visual polish:

- No horizontal overflow at core mobile widths.
- Key controls and navigation are reachable.
- Loading, empty, error, auth-unavailable, and feature-unavailable states are honest.
- No fake PHI or fake workflow completion is presented as product behavior.

Final visual design polish is deferred until the real design pass, but responsive shell invariants are still mandatory because later UI will inherit routing, state, and layout constraints.

### 6. When To Patch In Master

Patch directly in the integration branch when:

- The issue is cross-lane contract drift.
- The fix is small and easier than reopening a lane.
- A final QA check found copy, env docs, or test coverage gaps.
- The bug is in merge resolution, dependency ordering, or local run configuration.

Reopen or relaunch a lane when:

- The lane did not implement its stated workflow.
- The fix requires significant product decisions or architecture changes.
- The lane used mock/placeholder product behavior.
- Verification failed in a way that the lane owner can isolate better than the master.

### 7. Contract Drift Checks

Before final checkpoint gates, compare deterministic fixture smoke scripts with live API routes and web data loaders. A fixture dry-run can still pass while describing an older route family or payload shape.

For every user-facing workflow, record which evidence proves each layer:

- deterministic fixture validation
- live local API route behavior
- browser or app behavior
- role-denial and tenant-denial behavior

If fixture and live route shapes have drifted, resolve the canonical contract before claiming completion. If the older route family represents a separate product workflow, defer that whole workflow explicitly instead of adding a partial compatibility endpoint.

### 8. Main Merge Criteria

Before merging the integration branch to `main`, all must be true:

- Lane commits and merge resolutions are reviewed.
- Shared-file conflicts are explained in the checkpoint log.
- Lockfile is reconciled.
- Full code checks pass; unavailable external evidence is recorded as an open hard gate, not an accepted implementation gap.
- User-perspective checks pass for implemented workflows.
- Local/live/simulator provider checks match checkpoint requirements.
- Docs and memory are updated.
- Remaining gaps are external or explicitly deferred whole workflows, not weakened implemented behavior.

### 9. CP2+ Launch Checklist

Before launching Checkpoint 2 lanes:

- Use project-scoped visible Codex threads with `target.type = "project"` and `environment.type = "worktree"`.
- Record `pendingWorktreeId`, resolved thread ID, worktree path, lane ownership, and base commit.
- Create a shared-file ownership table in the checkpoint doc.
- Confirm worker browser/app tooling path or assign a QA lane.
- Tell workers to report tooling/install/local-service blockers in the first 5 minutes.
- Tell workers not to commit `package-lock.json` unless they own dependency integration.
- Plan a checkpoint integration branch before merging to `main`.
