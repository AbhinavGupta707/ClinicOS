# CP12 Integrated Security Pipeline — Threat And Control Delta

**Launch base:** `1166baa7a816b614d896cf267066f31f40eac142`

**Candidate:** `codex/integration/checkpoint-12`

**Evidence:** E1 deterministic plus E3 clean-durable-local candidate evidence; dependency-audit output from an approved external execution environment pending

**Overall release decision:** unchanged **NO-GO**

## Integrated controls

| Threat/control                    | CP12 candidate control                                                                                                                                                                                                     | Evidence posture                                                                          | Remaining scope                                        |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| T01 cross-tenant/IDOR             | Verified identity derives actor/tenant/clinic; active membership and clinic assignment required; all domain effects remain transaction-scoped under forced RLS                                                             | Exact 128-route registry, auth negative matrix, repeated clean 97/97 forced-RLS bootstrap | Deployed E4 evidence remains later work                |
| T02 role escalation               | Central all-permission enforcement plus distinct required clinic-role checks for doctor signing; client authority fields ignored                                                                                           | Registry assertions and API/auth negative tests                                           | Production revocation/session evidence is CP14         |
| T06 injection/mass assignment/DoS | Strict runtime path/query/header/body schemas, unknown/prototype-key rejection, byte/cardinality/pagination bounds, `413`/`422` taxonomy                                                                                   | Contract/security/API/acceptance tests                                                    | Deployed edge and DAST evidence remain later work      |
| T21 denial/cost exhaustion        | HMAC-derived opaque buckets, Redis Lua atomic consumption, pre-auth IP plus tenant/actor rate and expensive-operation policies, stable `429`/`Retry-After`; health probes use a bounded dependency-independent local store | Deterministic plus repeated real Redis stop/start denial/recovery tests                   | Noisy-neighbor/load/alert and WAF evidence remain CP14 |
| T24 false readiness/bypass        | Exact 128-operation contract/policy coverage; Nest controllers and the legacy adapter both enter one pipeline; non-fixture runtime fails closed without durable mutation coordination                                      | Drift/inventory/startup tests; real Postgres/Redis/Keycloak fault matrix                  | Deployed admission evidence remains later work         |
| Mutation replay/concurrency       | 80 idempotent mutations use transaction-bound Postgres replay; 12 resources use conditional row-version advancement and strong ETags                                                                                       | Migration/DB/API/domain tests, request guards 10/10 and row projection 5/5                | Deployed multi-instance evidence remains later work    |
| API error disclosure              | Runtime response schemas, bounded allowlisted response headers, CR/LF rejection, generic unknown errors, PHI/secret redaction and `no-store`                                                                               | Security/API response and error tests                                                     | Deployed headers/observability are later checkpoints   |
| Correlation provenance            | Bounded request IDs, ambiguous-header rejection, safe provenance and no raw URL/query/body/header diagnostic capture                                                                                                       | Request-context and API adversarial tests                                                 | Ingress trace trust remains CP14                       |

## Security invariants now wired

- No client tenant, clinic, actor, role, permission, signer, price, payment-state or row-version field
  creates authority.
- Missing route policy, request schema, response schema, application permission or production
  persistence dependency is a startup/configuration failure.
- Provider webhooks are narrow raw-body exceptions with signature-before-parse and durable replay
  protection.
- All authenticated clinic operations enforce current membership, verified clinic scope, every
  required permission and any required clinic role before legacy operation dispatch.
- Unknown writable fields, prototype-mutation keys, ambiguous security headers and unbounded
  request complexity fail closed.
- A mutation success is replayable only after domain, audit, outbox, response validation and replay
  completion commit atomically.
- Redis performs atomic rate/cost decisions but cannot substitute for transaction-bound Postgres
  mutation coordination.
- Unexpected exceptions and unsafe effect headers cannot expose messages, secrets, PHI, stack or SQL
  details.

## Review corrections made during integration

Master review found and corrected issues before accepting the candidate:

- recursive writable JSON and date/date-time validation were tightened in the contract producer;
- three new wall-clock call sites were replaced by caller-injected instants, preserving the CP11
  37-site clock inventory;
- `/v1/me` retained its bounded `keycloak` provenance object under strict response validation;
- durable idempotency and conditional row-version persistence were added rather than inferring
  compliance from OpenAPI headers;
- the indirect task update in `recordRecallAction` now advances `tasks.row_version` exactly once and
  rejects safe-integer overflow transactionally;
- response error/header validation, nested ETag derivation, health probe budgets and exact-once
  teardown were strengthened during API handoff review;
- unparsed chunked bodies are rejected before dispatch, closing a route-byte-budget gap for
  unsupported content types;
- the route scanner now inventories real Nest decorators plus the strangler boundary.

## Honest limitations

CP12 does not close the overall production-readiness decision. The current candidate has complete
deterministic, clean-durable-local, fault-injection, restart and browser verification. Promotion
remains blocked only because the managed execution policy rejected the dependency audit even after
the user explicitly authorized transmission to the configured npm registry. An authorized operator
or approved CI environment must provide the audit output and exit status; no workaround is allowed.

PRR-012 and PRR-028 are implemented in the candidate but must remain unclosed until promotion.
PRR-017's CP12 application-layer controls are implemented, while deployed WAF, noisy-neighbor load,
alert validation and broader concurrency/provider budgets remain owned by CP14. Production identity,
CSRF/CORS/host policy, official provider activation, cloud, restore, alert and physical-device
evidence remain in their checkpoint owners.
