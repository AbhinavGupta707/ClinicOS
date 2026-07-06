# Checkpoint 01 - Production Platform Foundation

## Goal

Build the deployable ClinicOS skeleton: web/API/worker/mobile app foundation, local development dependencies, auth/tenancy base, CI, database migrations, audit, outbox, and Temporal foundation.

## Base

- Branch: `main`
- Base commit: `447206a18e951ec7e55b2ccccf22d694c5c75b11`
- Launch date: 2026-07-06

## Credential/Input Preflight

- `.secrets/orchestration.env` exists and remains uncommitted under `.secrets/`.
- Provider selections are simulator-backed for WhatsApp, payments, telephony, LLM, and transcription.
- Synthetic fixture paths are configured.
- Local `npm run check` passed.
- Playwright and Expo CLIs are available with npm network access; Xcode is installed.
- GitHub CLI auth is currently invalid; GitHub push/Actions checks are deferred until reauthentication.
- AWS auth is currently unavailable; infra apply/live AWS checks are deferred until credentials are available.

## Lanes

| Lane | Thread ID | Worktree | Ownership |
|---|---|---|---|
| Data/Auth | `019f3963-7282-7921-94ba-a6e6bc4739ad` | `/Users/abhinavgupta/.codex/worktrees/cd95/ClinicOS` | `packages/db`, `packages/domain`, `packages/auth`, `packages/security`, `apps/api` |
| Runtime/Workflow | `019f3963-7347-7212-b548-4c218a37e4ae` | `/Users/abhinavgupta/.codex/worktrees/f914/ClinicOS` | `apps/worker`, `packages/workflow`, `packages/observability`, narrow runtime contracts |
| Repo/DevEx | `019f3963-74b4-7dd3-92a4-638484ae51fc` | `/Users/abhinavgupta/.codex/worktrees/d6f6/ClinicOS` | root scripts/config, CI, local stack, `packages/config`, infra runbooks |
| Web Shell | `019f3963-74d6-7f61-bf80-7aa882e1ddaa` | `/Users/abhinavgupta/.codex/worktrees/df8c/ClinicOS` | `apps/web`, `packages/ui` |

Codex app visibility note: these lanes use Codex-managed worktrees under `$CODEX_HOME/worktrees`, so they may not render as children under the saved `ClinicOS` project in the sidebar. Search for `CP1 Lane` in Codex or open the thread IDs directly. The documented app path for long-lived sidebar-visible worktrees is a permanent worktree created from the project menu, which appears as its own project. Until an app/tool-supported project-child worktree flow is available, orchestration lanes should be pinned immediately after launch so they remain visible in the sidebar while preserving managed-worktree isolation.

## Merge Order

1. Data/Auth
2. Runtime/Workflow
3. Repo/DevEx
4. Web Shell
5. Master integration patch

## Verification Plan

- Lane-specific typecheck/lint/test/build checks before merge.
- `git diff --check` after each merge.
- Full workspace check/typecheck/lint/test/build after all merges where scripts exist.
- Local web/API/worker boot checks.
- Browser smoke for the web shell and `/me` unavailable/authenticated-state behavior.
- Provider checks use simulators for this checkpoint.

## Current Status

Data/Auth merged into `main` at `a7fb7dc` after master-side verification.

### Data/Auth Evidence

- Lane commit: `0da382d Build checkpoint 1 data auth foundation`.
- Merge commit: `a7fb7dc merge: checkpoint 1 data auth lane`.
- Lane scope remained inside `apps/api`, `packages/auth`, `packages/db`, `packages/domain`, and `packages/security`.
- Master checks after merge:
  - `git diff --check HEAD~1..HEAD` passed.
  - `npm install --no-package-lock` restored root workspace links and reported 0 vulnerabilities.
  - `npm run check` passed.
  - `npm run test --workspace apps/api --if-present` passed.
  - `npm run test --workspace packages/auth --if-present` passed.
  - `npm run test --workspace packages/domain --if-present` passed.
  - `npm run test --workspace packages/db --if-present` passed.
  - `npm run test --workspace packages/security --if-present` passed.
  - `npm run typecheck --workspace apps/api --if-present` passed.
  - `npm run typecheck --workspace packages/auth --if-present` passed.
  - `npm run typecheck --workspace packages/domain --if-present` passed.
- Lane-reported user/runtime evidence: temporary PostgreSQL 16 migration and seed applied cleanly; non-superuser RLS smoke showed tenant A saw 1 patient, tenant B saw 1 patient, and mismatched tenant/clinic context saw 0.

Runtime/Workflow merged into `main` at `539ca41` after master-side verification.

### Runtime/Workflow Evidence

- Lane commit: `6b1b687 Build checkpoint 1 runtime workflow foundation`.
- Merge commit: `539ca41 merge: checkpoint 1 runtime workflow lane`.
- Lane scope remained inside `apps/worker`, `packages/workflow`, `packages/observability`, and `packages/integrations`.
- Master checks before and after merge:
  - `git diff --check 447206a..6b1b687` passed in the lane.
  - `npm run typecheck --workspace packages/workflow --if-present` passed.
  - `npm run typecheck --workspace apps/worker --if-present` passed.
  - `npm run typecheck --workspace packages/observability --if-present` passed.
  - `npm run typecheck --workspace packages/integrations --if-present` passed.
  - `npm run test --workspace packages/workflow --if-present` passed after allowing build output in the managed worktree: 3 tests.
  - `npm run test --workspace apps/worker --if-present` passed after allowing build output in the managed worktree: 5 tests.
  - `npm install --no-package-lock` on `main` installed runtime dependencies without lockfile churn and reported 9 moderate advisories.
  - `npm run check` passed on `main`.
  - `git diff --check HEAD~1..HEAD` passed after merge.
  - `npm run build --workspace packages/observability --if-present`, `npm run build --workspace packages/integrations --if-present`, and `npm run build --workspace packages/workflow --if-present` passed before worker compile, because worker consumes generated local package declarations.
  - `npm run typecheck --workspace apps/worker --if-present` passed after local package builds.
  - `npm run test --workspace apps/worker --if-present` passed after local package builds: 5 tests.
- User/runtime evidence gap: Temporal server and Postgres-backed worker were not booted yet because the Repo/DevEx local stack lane has not merged. This remains a post-Repo/DevEx integration check.

Awaiting Repo/DevEx merge verification.
