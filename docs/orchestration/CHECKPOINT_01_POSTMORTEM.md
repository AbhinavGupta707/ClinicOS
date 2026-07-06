# Checkpoint 01 Postmortem

Date: 2026-07-06

## Question

Why did the Checkpoint 1 integration pass take so long, was it caused by worker-lane mistakes, and what should change before Checkpoint 2?

## Evidence Reviewed

- `orchestrate-worktrees` runbook requirements for lane ownership, monitoring, merge order, and master integration.
- CP1 worker thread handoffs for Data/Auth, Runtime/Workflow, Repo/DevEx, and Web Shell.
- Merge commits `a7fb7dc`, `539ca41`, `bb9b522`, and `663fd0b`.
- Master integration commits `ca55b12`, `d015ad5`, and `be619cd`.
- Checkpoint evidence in `docs/orchestration/CHECKPOINT_01_PLATFORM_FOUNDATION.md` and `docs/orchestration/CHECKPOINT_LOG.md`.

## Findings

The long integration pass was not primarily caused by workers editing non-isolated checkouts. The CP1 lanes were Codex-managed worktrees under `.codex/worktrees`, and the final project-scoped launch test proved the correct user-visible worktree pattern for CP2. The merge conflicts were normal Git conflicts from overlapping shared package surfaces, not evidence that workers were touching the same physical files in one checkout.

The worker output was mostly sound. Data/Auth, Runtime/Workflow, Repo/DevEx, and Web Shell each committed lane-scoped work and ran meaningful checks. The main issues were orchestration-design issues: a few acceptance gates were too late, some shared files had weak ownership rules, and browser/app tooling expectations were not made repo-local before workers launched.

## What Took Extra Time

1. Repo/DevEx overlap with prior app lanes.
   Merge `bb9b522` had conflicts in `apps/api/README.md`, `apps/api/package.json`, `apps/worker/README.md`, and `apps/worker/package.json`. This happened because Data/Auth and Runtime/Workflow correctly needed app scripts and docs, while Repo/DevEx also replaced app placeholders with root-command and local-stack conventions.

2. Web Shell overlap with DevEx.
   Merge `663fd0b` had conflicts in `apps/web/README.md` and `apps/web/package.json`, plus lockfile reconciliation. This was expected once the web lane added real Next.js dependencies after Repo/DevEx had established the root package-manager and CI graph.

3. Late bootability criteria.
   Master commit `d015ad5` added the bootable API HTTP process, local `/v1/me` fixture mode, and the Expo Router mobile shell. These were valid CP1 outcomes, but they were not assigned as explicit lane gates at launch time, so they became master integration work.

4. Late local-stack runtime validation.
   Repo/DevEx validated `docker compose config`, but it did not start the local stack. Master commit `be619cd` then had to fix Temporal and Keycloak startup details after actually booting Postgres, Redis, Temporal, Temporal UI, and Keycloak.

5. User-perspective browser evidence found a real responsive issue.
   Commit `ca55b12` fixed mobile shell overflow discovered during true viewport checks. This was useful evidence, but it should have been part of the web lane's required tooling contract.

## What Was Expected

Some master integration was unavoidable for CP1. The checkpoint deliberately established the foundation of the whole platform: database tenancy and RLS, auth contracts, worker runtime, Temporal contracts, root CI, local Docker services, web shell, API boot, and mobile boot. A master pass is the right place to reconcile contracts between these lanes.

The expected part was:

- Lockfile reconciliation after multiple lanes added dependencies.
- Dependency-order fixes for shared package builds.
- Contract alignment between `/v1/me`, web auth state, API boot, and local fixture mode.
- A final end-to-end `npm run ci`, local stack boot, and browser/app smoke.

## What Was Avoidable

The avoidable part was not worker laziness. It was weak launch protocol:

- The lane prompts did not require every worker to prove their own user-facing surface with a known browser/app tool.
- Browser tooling was treated as an ambient capability instead of a declared repo dependency or assigned Codex tool.
- The local Docker stack was syntax-validated before merge, but real startup was left to master.
- Shared files such as app `package.json`, app READMEs, and `package-lock.json` did not have a checkpoint-level conflict protocol.
- The correct project-scoped Codex worktree launch shape was not verified before CP1 lanes were created.

## Browser And Playwright Caveat

The Web Shell lane reported: "IAB was unavailable and Playwright is not installed." This was not intentional product scope reduction. It was a tooling readiness gap.

In that worker context, the in-app browser backend was not exposed to the thread, and the repository did not declare Playwright as a dev dependency. The master thread later had Playwright/CDP-style browser evidence available, but workers should not have to rely on a tool that is only ambient in the orchestrator.

For CP2 and later, any lane that must produce browser evidence needs one of these explicit paths:

- The thread is launched with a prompt that verifies the Codex browser tool is available in the first minutes and reports a blocker immediately if it is not.
- The repo declares the required browser testing dependency, such as `@playwright/test`, and preflight installs browser binaries where needed.
- The master assigns browser smoke to a dedicated QA lane after feature lanes merge into a throwaway integration branch, with no claim that the feature lane itself completed browser smoke.

## Mobile/UI Testing Policy

We should keep mobile and browser smoke, but stop treating the temporary CP1 UI as a final visual design target.

Required for rough UI:

- No horizontal overflow at core mobile widths, especially 390px.
- Primary controls and navigation remain reachable.
- Loading, error, auth-unavailable, and feature-unavailable states are honest.
- No fake PHI or fake workflow completion appears as product behavior.
- Shell structure is compatible with later design replacement.

Not required until the real design pass:

- Final visual polish.
- Brand-level beauty.
- Perfect spacing and aesthetic tuning outside usability or layout breakage.
- Broad device-matrix testing for workflows that are not implemented yet.

This still matters because the future design will inherit the same routing, auth boundary, unavailable-state model, responsive shell constraints, and mobile-safe interaction principles.

## CP2 Operating Changes

1. Launch visible project-scoped worktree threads only.
   Use `target.type = "project"`, `projectId = "/Users/abhinavgupta/Desktop/ClinicOS"`, and `environment.type = "worktree"`. Record `pendingWorktreeId`, resolved thread ID, and worktree path.

2. Run a lane-readiness preflight before launching workers.
   Confirm `npm ci` or `npm install`, required CLIs, browser tool path, Docker availability, ports, and `.secrets/orchestration.env` inputs. Record failures before workers start.

3. Add a shared-file protocol to every checkpoint launch packet.
   Root `package.json`, `package-lock.json`, app `package.json`, app READMEs, generated files, migrations, and API contracts need explicit owners. If two lanes need the same file, name the primary owner and define how the second lane requests changes.

4. Require early blocker reporting.
   Workers must test critical tooling in the first 5 minutes: install state, browser/app tooling, local service access, and branch/worktree status. If unavailable, they must report immediately rather than finishing with a surprise caveat.

5. Add a dedicated integration/QA lane or master throwaway integration branch for each checkpoint.
   Before merging to `main`, combine completed lane commits in an integration worktree, run dependency install and full checks, then browser/app smoke. Merge to `main` only after that pass is clean or the failure is explicitly accepted.

6. Convert acceptance gates into lane-owned commands.
   If a checkpoint says API boots, API lane must boot it. If web needs browser evidence, web lane must produce it or explicitly block early. If local stack support is in scope, DevEx must run `local:up`, not only `docker compose config`, unless image/network access is blocked.

7. Keep master integration, but narrow it.
   Master should reconcile cross-lane contracts, run final evidence, and patch small integration gaps. Master should not routinely discover that a checkpoint-critical app has no bootable runtime.

## Bottom Line

CP1 did not fail as an orchestration pattern. It proved the pattern, but exposed missing readiness gates. For CP2, the biggest improvement is to make worker visibility, browser/app tooling, local stack bootability, and shared-file ownership explicit before the lanes start.
