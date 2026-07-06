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

| Lane             | Thread ID                              | Worktree                                             | Ownership                                                                              |
| ---------------- | -------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Data/Auth        | `019f3963-7282-7921-94ba-a6e6bc4739ad` | `/Users/abhinavgupta/.codex/worktrees/cd95/ClinicOS` | `packages/db`, `packages/domain`, `packages/auth`, `packages/security`, `apps/api`     |
| Runtime/Workflow | `019f3963-7347-7212-b548-4c218a37e4ae` | `/Users/abhinavgupta/.codex/worktrees/f914/ClinicOS` | `apps/worker`, `packages/workflow`, `packages/observability`, narrow runtime contracts |
| Repo/DevEx       | `019f3963-74b4-7dd3-92a4-638484ae51fc` | `/Users/abhinavgupta/.codex/worktrees/d6f6/ClinicOS` | root scripts/config, CI, local stack, `packages/config`, infra runbooks                |
| Web Shell        | `019f3963-74d6-7f61-bf80-7aa882e1ddaa` | `/Users/abhinavgupta/.codex/worktrees/df8c/ClinicOS` | `apps/web`, `packages/ui`                                                              |

Codex app visibility note: CP1 lanes were kept pinned for operator visibility after the user reported that unpinned worker sessions were not visible under the saved `ClinicOS` project. Before Checkpoint 2, run a dedicated project-scoped worktree-thread launch test using `target.type = "project"` and `environment.type = "worktree"` and record whether the thread appears under the project without pinning. Do not launch CP2 lanes until that sidebar behavior is verified or a pinned fallback is explicitly documented.

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

Checkpoint 1 is complete on `main` through `be619cd` after master integration fixes for web mobile responsiveness, API/mobile boot surfaces, and local Docker stack startup.

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

Repo/DevEx merged into `main` at `bb9b522` after conflict resolution and merged-tree verification.

### Repo/DevEx Evidence

- Lane commit: `21cd064 chore: add checkpoint 1 devex foundation`.
- Merge commit: `bb9b522 merge: checkpoint 1 repo devex lane`.
- Merge conflicts were limited to overlap in `apps/api/README.md`, `apps/api/package.json`, `apps/worker/README.md`, and `apps/worker/package.json`.
- Conflict policy:
  - Preserved the Data/Auth `/v1/me` contract, package tests, and syntax checks.
  - Kept API `dev` unavailable until a production NestJS server is implemented.
  - Preserved the Runtime/Workflow worker runtime, worker `dev`, typecheck, test, and build scripts.
  - Added root dependency-order-aware scripts so worker gates build local shared package declarations before compiling app workspaces.
  - Updated CI to call root `typecheck`, `lint`, `test`, and `build` scripts instead of raw workspace invocations.
- Master checks after conflict resolution:
  - `npm install` passed and refreshed `package-lock.json` for the combined Data/Auth, Runtime/Workflow, and Repo/DevEx graph.
  - `npm run check` passed.
  - `npm run typecheck` passed.
  - `npm run lint` passed.
  - `npm run test` passed.
  - `npm run build` passed.
  - `npm run security:secrets` passed.
  - `npm run security:audit` passed at the configured high threshold with 9 moderate Temporal/protobuf advisories.
  - `docker compose config` passed.
  - `git diff --check` passed.
- User/runtime evidence gap was closed by the master integration pass.

Web Shell merged into `main` at `663fd0b`; the master integration pass added responsive hardening at `ca55b12`.

### Web Shell Evidence

- Lane commit: `35602f5 feat(web): add checkpoint 1 clinic shell`.
- Merge commit: `663fd0b merge: checkpoint 1 web shell lane`.
- Responsive fix commit: `ca55b12 fix(web): prevent mobile shell overflow`.
- Merge conflicts were limited to `apps/web/README.md` and `apps/web/package.json`; resolution preserved the real Next.js scripts and DevEx root command documentation.
- Focused web checks passed:
  - `npm --workspace @clinic-os/web run typecheck`
  - `npm --workspace @clinic-os/web run lint`
  - `npm --workspace @clinic-os/web run test`
  - `npm --workspace @clinic-os/web run build`
- Browser evidence with local synthetic assistant fixture:
  - `GET /` and `GET /surface/lead-inbox` returned 200 from the local Next.js dev server.
  - Desktop shell CDP screenshot: `/private/tmp/clinicos-desktop-cdp-shell.png`; metrics `vw=1350`, `scrollWidth=1350`.
  - Mobile shell CDP screenshot: `/private/tmp/clinicos-mobile-cdp-390.png`; metrics `vw=390`, `scrollWidth=390`.
  - Mobile unavailable Lead inbox CDP screenshot: `/private/tmp/clinicos-mobile-cdp-lead-inbox-390.png`; metrics `vw=390`, `scrollWidth=390`.

### Master Integration Evidence

- API/mobile boot commit: `d015ad5 feat(platform): complete checkpoint 1 app boot surfaces`.
  - API now boots a Node HTTP process with `GET /health/live`, `GET /health/ready`, and `GET /v1/me`.
  - API verifies Keycloak RS256 bearer tokens through the realm JWKS endpoint; `CLINIC_OS_API_USE_DEV_AUTH_FIXTURE=true` is local/dev-only for synthetic boot checks.
  - Local API smoke passed on `127.0.0.1:4100`: `/health/ready` returned `ready`, and `/v1/me` returned the synthetic assistant tenant/clinic/permission context.
  - Mobile now boots as an Expo Router app shell with active session context and explicit unavailable capture workflows; no patient media, recordings, offline queues, or clinical data are stored in CP1.
  - Mobile web export passed and rendered at a true 390px viewport: `/private/tmp/clinicos-mobile-app-cdp-390.png`; metrics `vw=390`, `scrollWidth=390`.
- Local stack boot commit: `be619cd fix(devex): boot local temporal and keycloak stack`.
  - `npm run local:up` started Postgres, Redis, Temporal, Temporal UI, and Keycloak from clean Docker volumes.
  - `npm run local:ps` showed Postgres and Redis healthy, Temporal up on `7233`, Temporal UI up on `8088`, and Keycloak up on `8080`.
  - Keycloak OIDC discovery succeeded at `http://127.0.0.1:8080/realms/clinic-os-local/.well-known/openid-configuration`.
  - Temporal UI served HTML from `http://127.0.0.1:8088/`.
- Full verification:
  - `npm run ci` passed end-to-end after API/mobile integration. The high-severity audit gate passed; remaining advisories were moderate for Next/PostCSS, Temporal/protobuf, and Expo/xcode/uuid.
  - `npm run check` passed after Docker/Keycloak fixes.
  - `docker compose config` passed after Docker/Keycloak fixes.
  - `git diff --check` passed.

### Remaining External Gaps

- GitHub CLI auth remains invalid, so remote push/Actions evidence is deferred until reauthentication.
- AWS auth remains unavailable, so live cloud apply checks are deferred.
- Live WhatsApp, payments, telephony, AI transcription/LLM, Google Business Profile, and ABDM credentials are absent; later checkpoints must continue using simulator contracts unless live credentials are added.
