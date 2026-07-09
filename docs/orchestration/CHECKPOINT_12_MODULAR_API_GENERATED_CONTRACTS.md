# Checkpoint 12 — Modular API and Generated Contracts

**Status:** Launch-ready after orchestration planning commit
**Evidence target:** E3 durable local
**Workers:** four project-scoped worktrees
**Primary findings:** PRR-012, PRR-017 application layer, PRR-028; CP13 lane-safety prerequisite

## 1. Outcome

Replace the concentrated handwritten API boundary incrementally with a NestJS modular-monolith boundary, runtime schemas, generated OpenAPI/clients, uniform auth/tenant/validation/error/idempotency controls, and module-safe repository seams. Preserve every verified CP11 database, RLS, atomic unit-of-work, clock and readiness invariant. This is a strangler migration, not a rewrite.

## 2. Launch Preconditions

- `main` contains CP11 result commit `a6109bb` plus the orchestration planning commit.
- Working tree is clean except user-owned research.
- CP11 `check`, typecheck, zero-skip tests, build, `db:verify` and `git diff --check` pass.
- Master creates `codex/integration/checkpoint-12` and records the exact launch commit.
- Master owns root dependency/lockfile reconciliation, aggregate route/bootstrap composition, shared export barrels and final generated artifacts.

## 3. Lanes

### Lane A — API Framework and Modularization (`gpt-5.6-sol`, `xhigh`)

**Owns:** `apps/api/**` only, including its app manifest, except master-owned aggregate files explicitly frozen in the launch prompt.

**Goal:** add production NestJS bootstrap/module structure; migrate identity, health and highest-risk mutation/webhook boundaries behind parity tests; extract domain controllers/services from `server.ts`/`operations.ts`; centralize exception/request context; preserve the current native router only as a tested strangler adapter until route parity.

**Forbidden:** root manifests/lockfile, packages, migrations, web, memory/log/release docs. If aggregate `apps/api/src/index.ts`, final route composition or shared generated output is frozen by the master, request the integration patch in handoff.

**Verification:** API typecheck/test/build; health and CP11 runtime smoke compatibility; no production endpoint bypass in the migrated route set; startup/shutdown and invalid dependency behavior.

### Lane B — Runtime Contracts, OpenAPI and Client Generation (`gpt-5.6-sol`, `xhigh`)

**Owns:** `packages/api-contracts/**`, a new namespaced generated-client package if required, `scripts/cp12-openapi*`, and contract-specific tests/docs under `docs/api/`.

**Goal:** make runtime request/response schemas authoritative; reject unknown writable fields; generate OpenAPI and TypeScript clients deterministically; define stable errors, pagination, idempotency and concurrency metadata; add a drift gate.

**Forbidden:** apps, database, root manifests/lockfile, canonical migrations, memory/log/release docs, aggregate generated output path reserved to master.

**Verification:** schema negative corpus, deterministic generation, checked-in output diff test, compile generated client, route-operation inventory coverage.

### Lane C — Repository Module Seams (`gpt-5.6-sol`, `xhigh`)

**Owns:** new `packages/db/src/modules/**`, CP12-specific repository tests, and module-boundary documentation under `packages/db/`.

**Goal:** decompose the giant repository through behavior-preserving domain repository adapters suitable for CP13 parallel namespaces. Preserve CP11 transaction-local RLS, unit-of-work atomicity, runtime/worker roles and schema version. No schema change is expected.

**Forbidden:** canonical migrations, `packages/db/src/postgres.ts` and shared export barrels if frozen by master, root/app manifests, apps, memory/log/release docs.

**Verification:** repository parity against existing implementation, cross-tenant/pooled-context tests, atomic rollback/idempotency, architecture dependency tests.

### Lane D — Security Pipeline and Parity QA (`gpt-5.6-sol`, `xhigh`)

**Owns:** `packages/auth/**`, `packages/security/**`, `tests/acceptance/cp12/**`, `docs/qa/checkpoint-12*`, and `docs/security/checkpoint-12*`.

**Goal:** define reusable deny-by-default policy/runtime-validation/abuse test contracts; enumerate every active route and required auth/tenant/schema/idempotency/body-budget control; build parity and fuzz/negative tests without modifying API product code.

**Forbidden:** apps, database, root manifests/lockfile, canonical specs, memory/log/release decisions.

**Verification:** auth/tenant negative matrix, unknown-field/mass-assignment corpus, body/pagination/rate budget tests, legacy-versus-new response/error parity plan.

## 4. Conflict Matrix

| Surface                                                                                                    | Owner                                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `apps/api/**`                                                                                              | Lane A, with master owning frozen aggregate integration files |
| `packages/api-contracts/**` and namespaced generated client                                                | Lane B                                                        |
| `packages/db/src/modules/**`                                                                               | Lane C                                                        |
| `packages/auth/**`, `packages/security/**`, CP12 acceptance/security evidence                              | Lane D                                                        |
| Root manifests/lockfile, `.github`, env, migrations, shared barrels, aggregate OpenAPI, memory/log/release | Master only                                                   |

Any overlap discovered before launch requires a prompt/path redesign. Do not accept “likely mergeable” overlap.

## 5. Merge and Integration

Review all lanes while they run. Merge order:

1. Lane B contracts/generation.
2. Lane C repository seams.
3. Lane D security/parity contracts.
4. Lane A API framework/modules.
5. Master dependency/lockfile reconciliation and cross-lane wiring.

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
