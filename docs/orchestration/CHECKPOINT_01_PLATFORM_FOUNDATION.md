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

Launched. Awaiting lane handoffs.
