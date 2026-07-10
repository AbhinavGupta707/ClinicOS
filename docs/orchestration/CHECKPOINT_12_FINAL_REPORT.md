# Checkpoint 12 Integration Candidate Report — External Audit Authorization Pending

**Checkpoint:** CP12 — Modular API and Generated Contracts

**Launch base:** `1166baa7a816b614d896cf267066f31f40eac142`

**Integration branch:** `codex/integration/checkpoint-12`

**Candidate before report commit:** `1b571ed`

**Checkpoint status:** implementation, review, durable-local verification and browser verification
complete; promotion is blocked solely by explicit authorization for the external npm dependency
inventory audit

**Overall pilot/production decision:** **NO-GO**

## Outcome

The candidate establishes a real NestJS modular boundary and a uniform runtime contract/security
pipeline for all 128 active API operations. It keeps the existing operation module behind a
parity-tested strangler adapter while removing its ability to bypass route registration, current
identity/tenant/clinic authorization, strict schemas, request/resource budgets, mutation replay,
optimistic concurrency, response contracts or central error serialization.

Runtime contracts generate deterministic OpenAPI and a compiling TypeScript client. Repository
operations have namespaced, transaction-leased module seams for CP13. Eighty mutations use durable
transaction-bound idempotency. Twelve versioned resource families use strong ETags and conditional
row-version advancement. Repeated clean local bootstrap applies 15 migrations and proves 97/97
forced-RLS tenant tables with least-privilege runtime/worker roles.

## Integration record

| Wave                                                         | Accepted result                                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Runtime contracts / OpenAPI / generated client               | `53eb160`, merged `4252938`; version metadata `352ed5c`, merged `35ad667` |
| Repository module seams                                      | `5a779b8`, merged `869cb43`                                               |
| Security pipeline / parity foundation                        | `52ee744`, merged `779f830`                                               |
| Master dependency/interface freeze                           | `e399209`                                                                 |
| Durable idempotency/concurrency schema and adapter           | `75e75f9`, `bfc74e8`, merged `182a5e1`                                    |
| Canonical row-version projection                             | `19faf7a`, `18a7b7b`, merged `fd62e50`                                    |
| Nest API boundary                                            | `fd65630`, merged `d01b0a3`                                               |
| Master route/lint/acceptance reconciliation                  | `df80764`, `d9bfcfd`, `f3f3e1a`, `4b33165`                                |
| Final transport/readiness/recovery/runtime-smoke corrections | `8e05f7f`, `023226d`, `6169bbd`, `1b571ed`                                |

All worker changes were reviewed from actual worktree commits, verified in owned scope and merged in
dependency order. Workers did not merge, push, alter release truth or use master credentials.

## Exit-gate status

| Gate                                                             | Status                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 128-route inventory and uniform boundary controls                | Pass                                                                                                             |
| Strict runtime request/response schemas and generated drift gate | Pass: exact 128-operation OpenAPI, client and inventory                                                          |
| Durable idempotency and optimistic concurrency                   | Pass: request guards 10/10; row-version projection 5/5                                                           |
| CP11 clock ownership                                             | Pass: 37 owned sites                                                                                             |
| Check/typecheck/lint/build                                       | Pass                                                                                                             |
| Full socket-enabled workspace tests                              | Pass with zero skips; API 74/74                                                                                  |
| Clean Postgres bootstrap/RLS/role isolation                      | Pass repeatedly: 15 migrations, 97/97 forced RLS                                                                 |
| DB migration/repository/worker/readiness fault matrix            | Pass                                                                                                             |
| Runtime-ID API smoke and restart                                 | Pass three times, including after API restart                                                                    |
| Worker clean restart cycles                                      | Pass twice with empty canonical outbox and clean shutdown                                                        |
| Local API performance comparison                                 | Pass; no material regression in the measured route set                                                           |
| Browser Use and repeatable Playwright                            | Pass for assistant and owner roles at desktop and 390px                                                          |
| Secret scan                                                      | Pass                                                                                                             |
| Dependency audit                                                 | **Blocked:** explicit permission is required to transmit the dependency inventory to the configured npm registry |
| Evidence/threat delta/report                                     | Current candidate record complete; audit outcome must be appended before promotion                               |
| Promotion to `main`                                              | Not allowed until the dependency audit passes                                                                    |
| CP13 launch                                                      | Not allowed until CP12 promotion and post-promotion verification                                                 |

## Review findings resolved before candidate acceptance

- Recursive writable JSON and date/date-time schema acceptance were hardened.
- Three CP11 clock-ownership regressions were removed before the security producer merged.
- Strict identity response validation was reconciled with the existing bounded Keycloak provenance
  object.
- OpenAPI idempotency and `If-Match` metadata were backed by real transaction-bound Postgres
  adapters and schema rather than header-only compliance.
- All direct and indirect versioned writes were audited; linked recall-task advancement is now
  exact-once and overflow-safe.
- Response error/header validation, nested ETags, health liveness budgets and application teardown
  were strengthened in API review.
- Unparsed chunked bodies are rejected before dispatch, preventing unsupported content types from
  bypassing route byte accounting.
- Redis outage handling now fails fast with a bounded command queue and recovers once the client is
  ready; repeated real stop/start fault injection proved both denial and recovery.
- The durable CP11 runtime smoke was aligned with the strict CP12 contracts rather than weakening
  validation to preserve stale test inputs.
- Acceptance inventory derives current truth from the runtime contract and policy registry instead
  of a historical foundation snapshot.

## Honest limitations

CP12 provides E1 deterministic and E3 clean-durable-local evidence. It does not prove deployed
edge/WAF controls, noisy-neighbor isolation, production identity/session policy, official providers,
cloud, alerts, restore, physical devices, real clinic data or production PHI operation. Those remain
in CP14-CP18 and the production readiness register.

The first worker restart attempt followed runtime-smoke-created outbox rows and truthfully
dead-lettered an event for which CP13 has not yet implemented a workflow handler. That run was not
used as CP12 restart evidence. The master restored the canonical clean database and proved two clean
worker start/stop cycles with zero pending, retry, due or dead-letter work.

The in-app browser and Playwright checks use explicitly labelled synthetic fixtures. They prove
rendering, role denial, unavailable-state honesty, responsive controls and browser/API contract
alignment; they do not prove durable provider completion or a deployed production surface.

## Required external-authority action

The repository's `npm run security:audit` command sends the package-lock dependency inventory to the
configured npm registry. That disclosure was not covered by implicit execution authority and the
attempt was correctly rejected. Once the user explicitly authorizes that transmission, the master
must run the audit, record the exact result, rerun the final repository checks after evidence edits,
and only then promote CP12 to `main` and begin CP13.
