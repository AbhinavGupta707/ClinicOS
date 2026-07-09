# Checkpoint 12 — Modular API and Generated Contracts

**Status:** Launch-ready after final clean-base verification
**Evidence target:** E3 durable local
**Workers:** provisionally three initial foundation worktrees; optional API-framework worker only after interface freeze
**Primary findings:** PRR-012, PRR-017 application layer, PRR-028; CP13 lane-safety prerequisite

## 1. Outcome

Replace the concentrated handwritten API boundary incrementally with a NestJS modular-monolith boundary, runtime schemas, generated OpenAPI/clients, uniform auth/tenant/validation/error/idempotency controls, and module-safe repository seams. Preserve every verified CP11 database, RLS, atomic unit-of-work, clock and readiness invariant. This is a strangler migration, not a rewrite.

## 2. Launch Preconditions

- `main` contains CP11 result commit `a6109bb` plus the orchestration planning commit.
- Working tree is clean except user-owned research.
- CP11 `check`, typecheck, zero-skip tests, build, `db:verify` and `git diff --check` pass.
- Master creates `codex/integration/checkpoint-12` and records the exact launch commit.
- GitHub CLI authentication is valid; the ignored secret handoff is mode `0600`, uses `clinicos-human`, and keeps Meta/Razorpay selectors on `simulator`.
- Historical worktrees are classified and excluded from CP12; workers never read/source/copy the secret handoff or execute live AWS/provider operations.
- Master owns root dependency/lockfile reconciliation, aggregate route/bootstrap composition, shared export barrels and final generated artifacts.

## 3. Lanes

### Lane A — Runtime Contracts, OpenAPI and Client Generation (`gpt-5.6-sol`, `xhigh`)

**Owns:** `packages/api-contracts/**`, a new namespaced generated-client package if required, `scripts/cp12-openapi*`, and contract-specific tests/docs under `docs/api/`.

**Goal:** inventory the current native routes without changing them; make runtime request/response schemas authoritative; reject unknown writable fields; generate OpenAPI and TypeScript clients deterministically; define stable errors, pagination, idempotency and concurrency metadata; add a drift gate.

**Forbidden:** apps, database, root manifests/lockfile, canonical migrations, memory/log/release docs, aggregate generated output path reserved to master.

**Verification:** schema negative corpus, deterministic generation, checked-in output diff test, compile generated client, route-operation inventory coverage.

### Lane B — Repository Module Seams (`gpt-5.6-sol`, `xhigh`)

**Owns:** new `packages/db/src/modules/**`, CP12-specific repository tests, and module-boundary documentation under `packages/db/`.

**Goal:** decompose the giant repository through behavior-preserving domain repository adapters suitable for CP13 parallel namespaces. Preserve CP11 transaction-local RLS, unit-of-work atomicity, runtime/worker roles and schema version. No schema change is expected.

**Forbidden:** canonical migrations, `packages/db/src/postgres.ts` and shared export barrels if frozen by master, root/app manifests, apps, memory/log/release docs.

**Verification:** repository parity against existing implementation, cross-tenant/pooled-context tests, atomic rollback/idempotency, architecture dependency tests.

### Lane C — Security Pipeline and Parity Foundation (`gpt-5.6-sol`, `xhigh`)

**Owns:** `packages/auth/**`, `packages/security/**`, `tests/acceptance/cp12/**`, `docs/qa/checkpoint-12*`, and `docs/security/checkpoint-12*`.

**Goal:** inventory the existing route controls and define reusable deny-by-default policy, request-context, runtime-validation and abuse-test contracts; build auth/tenant, body-budget, mass-assignment and legacy-parity tests without modifying API product code.

**Forbidden:** apps, database, root manifests/lockfile, canonical specs, memory/log/release decisions.

**Verification:** auth/tenant negative matrix, unknown-field/mass-assignment corpus, body/pagination/rate budget tests, current-route control inventory and legacy response/error parity plan.

### Optional second wave — API Framework and Modularization (`gpt-5.6-sol`, `xhigh`)

**Launch condition:** Lanes A-C are reviewed and merged, and the master has frozen their generated-contract, repository and security interfaces. The modular API work is required for CP12; the master launches this worker only if its remaining `apps/api/**` scope passes the adaptive lane gate, otherwise the master implements it directly.

**Owns:** `apps/api/**` only, including its app manifest, except master-owned aggregate files explicitly frozen in the launch prompt.

**Goal:** add production NestJS bootstrap/module structure; consume the frozen contracts, repositories and security pipeline; migrate identity, health and highest-risk mutation/webhook boundaries behind parity tests; extract domain controllers/services from `server.ts`/`operations.ts`; preserve the native router only as a tested strangler adapter until route parity.

**Forbidden:** root manifests/lockfile, packages, migrations, web, memory/log/release docs. If aggregate `apps/api/src/index.ts`, final route composition or shared generated output is frozen by the master, request the integration patch in handoff.

**Verification:** API typecheck/test/build; health and CP11 runtime smoke compatibility; no production endpoint bypass in the migrated route set; startup/shutdown and invalid dependency behavior.

## 4. Conflict Matrix

| Surface                                                                                                    | Owner                                                 |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `packages/api-contracts/**` and namespaced generated client                                                | Lane A                                                |
| `packages/db/src/modules/**`                                                                               | Lane B                                                |
| `packages/auth/**`, `packages/security/**`, CP12 acceptance/security evidence                              | Lane C                                                |
| `apps/api/**`                                                                                              | Optional second wave or master after interface freeze |
| Root manifests/lockfile, `.github`, env, migrations, shared barrels, aggregate OpenAPI, memory/log/release | Master only                                           |

Any overlap discovered before launch requires a prompt/path redesign. Do not accept “likely mergeable” overlap.

## 5. Merge and Integration

Review all active lanes while they run. Merge order:

1. Lane A contracts/generation.
2. Lane B repository seams.
3. Lane C security/parity foundation.
4. Master freezes and records the integrated contract/repository/security interfaces.
5. Launch and merge the optional API-framework worker only if its remaining scope still passes the adaptive lane gate; otherwise the master implements it.
6. Master dependency/lockfile reconciliation and cross-lane wiring.

The master migrates or adapts remaining routes, connects generated schemas/clients and security pipeline, assembles export/route registries, resolves any Nest/native transition, and removes only legacy paths proven redundant by parity.

## 6. Exit Gate

- all active public routes are inventoried and pass uniform auth/tenant/runtime-schema/error/body-budget controls;
- every route is migrated or behind an explicit time-bounded parity-tested strangler adapter;
- OpenAPI and client are generated from runtime truth with zero drift;
- invalid/unknown/mass-assignment inputs fail safely;
- CP11 durable smoke, RLS, clock, readiness and unit-of-work evidence remain green;
- CP13 has namespaced API, repository, contract and web feature seams with master-owned aggregate wiring;
- full zero-skip tests, build, security gates and browser smoke pass;
- CP12 evidence, threat delta, remediation register, memory/log and final report are complete;
- integration branch is promoted to `main` before CP13 launch.
