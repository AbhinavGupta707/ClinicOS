# CP12 Integrated Route Control Inventory And Legacy Parity Result

**Launch base:** `1166baa7a816b614d896cf267066f31f40eac142`

**Candidate branch:** `codex/integration/checkpoint-12`

**Evidence tier:** E1 deterministic plus E3 clean-durable-local evidence; promotion remains gated by dependency-audit output from an approved external execution environment

**Release effect:** none until the complete CP12 exit gate passes and the candidate is promoted to `main`

## Runtime source of truth

`packages/api-contracts/src/native-http-contracts.ts` is the authoritative 128-operation runtime
contract. `apps/api/src/framework/route-registry.ts` derives an exact deny-by-default security policy
for every operation. `apps/api/src/framework/pipeline.ts` applies those contracts before dispatching
the request to a dedicated Nest controller or the time-bounded legacy operation adapter.

The machine-readable acceptance view in
`tests/acceptance/cp12/current-route-control-inventory.mjs` is derived from the runtime contracts and
policy registry. `scripts/cp12-openapi-route-inventory.mjs` inventories both the explicit Nest
controllers and the strangler dispatch boundary; it does not depend on fake source markers.

`tests/acceptance/cp12/route-inventory.test.mjs` proves that:

- the runtime contract, generated inventory and registered application boundary contain the same
  128 unique method/path registrations;
- all 123 authenticated clinic-operation handlers remain grounded in the native operation
  dispatcher while consuming the uniform CP12 boundary first;
- the three public health probes, `/v1/me`, and the Razorpay raw-body webhook are explicit narrow
  route classes rather than accidental bypasses;
- every active operation has a route policy, strict request/response contract, body/query/rate
  posture and central error policy, with no route-level control gap in the integrated inventory.

Any route, operation, policy or generated artifact drift fails the route inventory or OpenAPI drift
gate.

## Integrated inventory

| Dimension                       |            Count | CP12 candidate posture                                                                                    |
| ------------------------------- | ---------------: | --------------------------------------------------------------------------------------------------------- |
| Total active operations         |              128 | Exact runtime-contract, policy, Nest/strangler and generated-inventory coverage                           |
| Public health                   |                3 | Explicit unauthenticated exception with bounded process-local probe budget; no dependency-coupled limiter |
| Authenticated identity          |                1 | Verified token, current active tenant/user/membership and strict response contract                        |
| Verified provider webhook       |                1 | Bounded raw bytes, signature before parse, header allowlist, durable replay/idempotency transaction       |
| Authenticated clinic operations |              123 | Verified actor/tenant/clinic, all-permission and required-role checks before dispatch                     |
| GET / POST / PATCH / PUT        | 47 / 68 / 12 / 1 | All registered under the same boundary                                                                    |
| Body-bearing operations         |               74 | Per-contract maximum bytes; oversize maps to `413`; strict JSON/binary/raw schema handling                |
| Query-bearing operations        |               29 | Unknown/duplicate/cardinality/key/value/total-byte budgets plus strict schemas                            |
| Bounded-pagination operations   |               25 | Contracted default/maximum limits and cursor bounds                                                       |
| Idempotent mutations            |               80 | Required idempotency key and canonical SHA-256 request digest; durable replay/conflict state              |
| `If-Match` mutations            |               12 | Canonical strong `"rv-N"` ETag and transaction-bound conditional row-version advance                      |

## Uniform boundary order

Every active operation now consumes this order:

1. exact method/path matching against the frozen runtime contract and registered policy;
2. bounded request-ID validation/generation and safe correlation context;
3. ambiguous security-header rejection plus query and streaming/body-size enforcement;
4. pre-authentication IP budget for non-health traffic;
5. dependency traffic admission for `/v1/*`;
6. verified identity or the explicit health/provider-webhook exception;
7. current active membership, server-derived tenant/clinic authority, all permissions and required
   clinic roles;
8. strict path/query/header/body parsing with unknown and prototype-mutating fields rejected;
9. atomic authenticated rate and expensive-operation budgets;
10. transaction-bound idempotency claim and optimistic version advancement for mutations;
11. legacy domain dispatch inside the existing Postgres unit of work, preserving RLS, audit and
    outbox atomicity;
12. runtime response-body/header validation and central redacted serialization with `no-store` and
    a validated request ID.

The compatibility controller is a routing adapter only. It cannot bypass the policy, request
contract, budgets, mutation coordinator, response contract or exception serializer.

## Durable mutation semantics

Migration `0015_api_request_idempotency.sql` adds a forced-RLS idempotency table scoped by tenant,
clinic, actor, operation and idempotency key. It stores the canonical request digest, bounded
processing lease, original allowlisted response status/headers/body, completion and expiry state.

`PostgresClinicUnitOfWork` leases a transaction-bound request-guard port. The
`PostgresAtomicMutationCoordinator` claims/replays the key, conditionally advances applicable
resource versions, runs the domain/audit/outbox effect, validates the response and completes replay
state inside one transaction. Same-key/different-digest and active-lease conflicts return a stable
`409`. A failed effect or response contract rolls back all changes and cannot be replayed as success.

The 12 versioned resource families use a positive safe-integer `row_version`. Strong ETags are
derived only from the response row version. Conditional mutations use
`UPDATE ... WHERE row_version = expected RETURNING row_version`; indirect linked-task mutation from
`recordRecallAction` advances exactly once inside the repository transaction and rolls back on
overflow or failure.

Redis is used only for atomic abuse budgets. It is intentionally not used for mutation replay or
concurrency because it cannot provide the required atomicity with domain, audit and outbox writes.

## Preserved and intentional parity

Valid business behavior, side effects, response fields and existing success status semantics are
preserved. The following boundary changes are intentional hardening transitions and are asserted by
the parity harness:

| Case                           | Previous behavior        | CP12 behavior                         |
| ------------------------------ | ------------------------ | ------------------------------------- |
| Malformed transport JSON       | `400 VALIDATION_ERROR`   | `400 BAD_REQUEST`                     |
| Invalid path/query/body schema | `400 VALIDATION_ERROR`   | `422 VALIDATION_ERROR`                |
| Oversized body                 | `400 VALIDATION_ERROR`   | `413 PAYLOAD_TOO_LARGE`               |
| Rate/cost exhaustion           | Unimplemented            | `429 RATE_LIMITED` with `Retry-After` |
| Unexpected exception           | Raw message could escape | Generic redacted `500 INTERNAL_ERROR` |

`401`, `403`, `404` and domain/idempotency `409` meanings remain stable. Successful responses must
pass their runtime body and header schemas before commit/replay completion.

## Remaining promotion evidence

The integrated candidate is not a release or production-readiness claim. The zero-skip
socket-enabled suite, focused real Postgres/Redis request-guard/readiness matrix, repeated runtime
and worker restarts, repeatable Playwright and in-app browser smoke have passed. The sole remaining
CP12 gate is the dependency audit. The user explicitly authorized the registry transmission, but the
managed execution policy still rejected agent-originated disclosure and prohibited workarounds. An
authorized operator or approved CI environment must provide the exact command output and exit
status. Edge/WAF noisy-neighbor load evidence remains a CP14 closure requirement for the broader
PRR-017 finding.
