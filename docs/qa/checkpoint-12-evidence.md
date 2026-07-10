# Checkpoint 12 Integrated Evidence

## Evidence metadata

```yaml
evidence_id: CP12-INTEGRATED-CANDIDATE-20260710-002
checkpoint: CP12
launch_revision: 1166baa7a816b614d896cf267066f31f40eac142
candidate_branch: codex/integration/checkpoint-12
candidate_revision_before_evidence_commit: 1b571ed
tier: E1-deterministic-plus-E3-clean-durable-local
environment: local-codex-synthetic-only
data: deterministic-synthetic-no-real-phi
operator: ClinicOS master orchestrator
overall_release_decision: NO-GO
checkpoint_promotion: BLOCKED_EXTERNAL_AUTHORITY_DEPENDENCY_AUDIT
```

The evidence commit cannot self-reference. The master must record the evidence and promotion commits
in the checkpoint log after the remaining audit passes.

## Integrated result

The CP12 candidate replaces the concentrated unaudited HTTP boundary with a NestJS application
boundary and a strict contract/security pipeline for all 128 active operations. It preserves the
legacy operation dispatcher as a time-bounded domain adapter after the uniform boundary, not as a
security bypass.

The candidate also adds:

- authoritative runtime request/response contracts, deterministic OpenAPI and a generated typed
  client;
- exact route/policy/permission coverage and strict request, body, query, pagination, response,
  error and correlation controls;
- Redis-backed atomic application abuse budgets with dependency-independent bounded health probes;
- a forced-RLS Postgres idempotency table for 80 mutations and transaction-bound replay/conflict
  completion;
- conditional row-version/ETag semantics for 12 resource families, including indirect linked-task
  version advancement;
- transaction-leased namespaced repository modules for CP13 parallel vertical slices.

This is not a pilot, production PHI, provider, cloud or overall readiness claim.

## Worker and integration evidence

| Evidence ID               | Revision / procedure                                                                      | Result                                                                                                                                                                      | Limitations                                   |
| ------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| CP12-E1-CONTRACT-001      | Contract producer `53eb160`; master merge `4252938`; follow-up `352ed5c`, merge `35ad667` | PASS: 27/27 runtime-contract tests, 7/7 generated-client tests, exact 128-operation OpenAPI/inventory drift gates                                                           | Deterministic local contracts                 |
| CP12-E1-DB-MODULE-002     | Repository seam producer `5a779b8`; merge `869cb43`                                       | PASS: 140 legacy operations have exactly one namespaced owner; transaction-leased module and evidence ports compile and pass parity/architecture tests                      | Structural and repository-local evidence      |
| CP12-E1-SECURITY-003      | Security producer `52ee744`; merge `779f830`                                              | PASS: auth 10/10, security 25/25, acceptance 10/10, 37-site clock guard                                                                                                     | Historical lane record is separately labelled |
| CP12-E3-REQUEST-GUARD-004 | Migration `75e75f9`; DB adapter `bfc74e8`; merge `182a5e1`                                | PASS: forced-RLS scoped idempotency, lease/replay/conflict, bounded stored response and conditional version adapter; real-DB guard suite 10/10                              | Local Postgres                                |
| CP12-E1-VERSION-005       | Domain/DB projection `19faf7a`, overflow correction `18a7b7b`, merge `fd62e50`            | PASS: domain 54/54, DB 67/67, focused real-DB row projection 5/5                                                                                                            | Local Postgres                                |
| CP12-E1-API-006           | API producer `fd65630`; merge `d01b0a3`; master corrections through `1b571ed`             | PASS: API 74/74, zero skips; strict Nest/strangler pipeline, Redis fail-closed/recovery adapter, Postgres coordinator, lifecycle/error/ETag/adversarial cases               | Local API boundary                            |
| CP12-E1-INVENTORY-007     | Master acceptance reconciliation `4b33165`                                                | PASS: 10/10; real Nest decorators, strangler registration, runtime contract and 128 generated routes agree                                                                  | Static/in-process evidence                    |
| CP12-E1-TRANSPORT-007A    | `8e05f7f`                                                                                 | PASS: unsupported unparsed chunked bodies return `400 BAD_REQUEST` before dispatch; real socket and in-process regressions pass                                             | Local socket                                  |
| CP12-E3-READINESS-007B    | `023226d`, `6169bbd`                                                                      | PASS: readiness requires Postgres, Redis budgets and the transaction coordinator; real Redis stop/start denies traffic, keeps liveness bounded and recovers after readiness | Local services                                |
| CP12-E3-RUNTIME-007C      | `1b571ed`                                                                                 | PASS: durable runtime smoke uses strict CP12 idempotency, semantic validation and ETag contracts                                                                            | Synthetic local data                          |

## Complete master verification

| Evidence ID            | Command                                           | Result                                                                                                                                                                           | Skips / limitations                    |
| ---------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| CP12-E1-REPO-008       | `npm run check`                                   | PASS: 15 TypeScript workspaces, 15 contiguous migrations, 37 owned clock sites, negative type gate, env and format checks                                                        | Repository-only                        |
| CP12-E1-TYPE-009       | `npm run typecheck`                               | PASS: all 15 workspaces, including generated client and Next route type generation                                                                                               | None reported                          |
| CP12-E1-LINT-010       | `npm run lint`                                    | PASS: all workspaces; API lint includes all Nest source/test files                                                                                                               | None reported                          |
| CP12-E1-BUILD-011      | `npm run build`                                   | PASS: API/worker/shared packages, generated contracts/client, Next production build and Expo web export                                                                          | Local build                            |
| CP12-E1-ACCEPTANCE-012 | `node --test tests/acceptance/cp12/*.test.mjs`    | PASS: 10/10, zero skipped                                                                                                                                                        | In-process/local                       |
| CP12-E1-GENERATED-013  | `check:generated`; `check:inventory`              | PASS: zero drift and exact 128-operation inventory                                                                                                                               | Generated artifacts checked in         |
| CP12-E1-SECRETS-014    | `npm run security:secrets`                        | PASS: tracked and untracked release scope; user research excluded                                                                                                                | Not SCA/SAST/DAST                      |
| CP12-E1-DIFF-015       | `git diff --check` at the complete code candidate | PASS                                                                                                                                                                             | Evidence edits require one final rerun |
| CP12-E1-FULL-016       | `npm run test` with socket authority              | PASS with zero skips: API 74/74, web 61/61, mobile 6/6, worker 5/5, contracts 27/27, client 7/7, DB 67/67, domain 54/54, security 25/25, auth 10/10 and remaining packages green | Local/synthetic                        |

## E3 clean durable database evidence

The first `npm run db:verify` observed extra patients created by earlier integration tests and failed
its canonical-seed cardinality assertion. This was stale local volume state, not cross-tenant
visibility. The master discarded it as evidence and used the guarded synthetic-only clean bootstrap.

Three clean bootstrap/restore points were then used during integration and final runtime/worker
verification. Each qualifying canonical bootstrap proved:

| Property                            | Result                                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Ordered checksum-tracked migrations | 15/15                                                                                                      |
| Tenant-owned tables                 | 97                                                                                                         |
| Forced-RLS tenant tables            | 97/97                                                                                                      |
| Synthetic tenants                   | 2                                                                                                          |
| Roles                               | `clinic_os_migrator`, `clinic_os_runtime`, `clinic_os_worker`; no superuser/createdb/createrole/bypass-RLS |
| Runtime no-context product rows     | 0                                                                                                          |
| Worker product-table access         | Denied                                                                                                     |
| Runtime cross-tenant isolation      | Pass                                                                                                       |

Migration validation passed, a repeated migrate was a no-op, and migration info reported `v015` and
all predecessors successful. Postgres, Redis, Temporal and Keycloak were restarted before the final
verification; database verification and API readiness remained green afterward.

Focused durable suites also passed:

- migration concurrency, checksum drift detection and failed-migration rollback;
- identity bootstrap, pooled reset, tenant isolation, atomic domain/audit/outbox commit and rollback,
  idempotency and cross-tenant foreign-key protection;
- request guards 10/10 and row-version projection 5/5;
- worker persistence 5/5;
- real Postgres, Redis and Keycloak readiness loss and recovery.

## Runtime, restart and performance evidence

The CP11 durable runtime-ID smoke, updated only to use the strict CP12 public contract, passed twice
consecutively and again after API process restart. It created runtime IDs and exercised lead,
patient, appointment, queue, consent, encounter, signed note, role denial, replay, audit/outbox,
owner-blocked readiness and cross-tenant denial paths.

The clean worker restart proof ran twice against the restored canonical database. Both starts were
healthy, registered the current handler, reached Temporal and reported zero pending, retry, due and
dead-letter repository work before clean `SIGINT` shutdown. A prior diagnostic run against
runtime-smoke-created outbox rows truthfully dead-lettered an unhandled CP13-scope event and was not
used as CP12 restart evidence.

The 25-iteration local API comparison recorded:

| Route              |      p50 |      p95 |   Maximum |
| ------------------ | -------: | -------: | --------: |
| `health_ready`     |  2.79 ms |  5.35 ms | 138.98 ms |
| `runtime_identity` | 11.25 ms | 17.28 ms |  32.10 ms |
| `patient_list`     | 14.08 ms | 17.81 ms |  18.49 ms |

These values are local comparison evidence, not a production SLO or capacity claim.

## Browser and responsive evidence

Repeatable Playwright used the exact integrated checkout and explicit synthetic fixtures:

- assistant role: 3/3 passed, including workflow honesty, 390px no-overflow/control reachability and
  owner-readiness denial;
- owner role: 3/3 targeted tests passed with zero skips, including aggregate/compliance honesty,
  blocked external readiness gates and the 390px breakpoint.

The in-app browser independently inspected both roles. At the explicit 390x844 viewport its effective
content width was 375px and `scrollWidth` remained 375px. The assistant's “Record completed
procedure” and owner's “Refresh pilot readiness” controls were visible. The fixture label, missing
provider keys, signed-webhook unavailability, blocked cloud/provider gates and synthetic-only safety
posture were present. Browser warning/error logs were empty.

Fixture browser evidence proves UI safety/responsiveness and honest unavailable states. Durable API
behavior is separately covered by the live helper/runtime smoke above.

## Parity and safety assertions

- All 128 active operations have exactly one runtime contract and policy.
- All 123 authenticated clinic operations enforce verified active tenant/membership/clinic scope,
  every required permission and any required doctor role before dispatch.
- Three health routes and the Razorpay webhook are explicit narrow exceptions with their own
  budgets and request rules.
- Strict schemas reject unknown writable and prototype-mutating fields.
- Unsupported-content-type chunked bodies cannot bypass byte accounting by reaching dispatch
  without a bounded raw buffer.
- Malformed transport JSON maps to `400`; semantic validation to `422`; oversize to `413`; budget
  exhaustion to `429` with `Retry-After`; unexpected failures use generic redacted `500` responses.
- The Razorpay signature is checked over bounded raw bytes before parsing; only required headers are
  forwarded.
- Mutation replay state, row-version advance, domain write, audit, outbox, response validation and
  completion share one Postgres transaction.
- Non-fixture startup fails closed without both Redis abuse budgets and the durable Postgres mutation
  coordinator.
- Redis outage handling fails fast without an unbounded offline queue and recovers only after the
  client is ready.
- Response headers are allowlisted, CR/LF-free and runtime validated; ETags derive from the actual
  nested response row version.
- Local fixture implementations remain typed test doubles and cannot satisfy non-fixture durability
  checks.

## Remaining promotion gate

`npm run security:audit` is the only incomplete CP12 exit gate. Running it transmits the repository's
dependency inventory to the configured npm registry. The user explicitly authorized that disclosure
after being informed of its contents and destination. The managed execution policy still rejected
the command as unacceptable external disclosure and prohibited retries, indirect execution and
workarounds. No alternative command or cached result is substituted for the required audit.

An authorized operator or approved CI environment must run the exact command and provide its complete
output and exit status. The master must review and append that evidence, run the final
format/diff/repository checks over the evidence edits, commit the evidence, promote CP12 to `main`,
run post-promotion verification and only then start CP13.

## Artifacts

- `packages/api-contracts/generated/native-openapi.json`
- `packages/api-contracts/generated/native-route-inventory.json`
- `packages/api-client-generated/src/index.ts`
- `docs/api/CP12_RUNTIME_CONTRACTS.md`
- `docs/api/OPENAPI_CLIENT_RUNBOOK.md`
- `docs/api/VERSIONED_RESPONSE_METADATA.md`
- `packages/db/CP12_MODULE_SEAMS.md`
- `docs/security/checkpoint-12-route-control-inventory.md`
- `docs/security/checkpoint-12-security-foundation-delta.md`
- `docs/orchestration/CHECKPOINT_12_FINAL_REPORT.md`

## Decision

The implementation and all authorized local gates are complete, but this is not yet a promoted
checkpoint. `main` remains at the verified CP11 launch base. CP13 must not start until the external
dependency audit passes, the candidate is promoted to `main`, and post-promotion checks are green.
