# CP12 Current Route Control Inventory And Legacy Parity Plan

**Scope:** native API router at base `1166baa7a816b614d896cf267066f31f40eac142`

**Evidence tier:** E0 static inventory plus E1 inventory/contract tests

**Release effect:** none; ClinicOS remains NO-GO and no route is represented as CP12-pipeline compliant

## Source of truth

The complete, machine-readable route-by-route inventory is
`tests/acceptance/cp12/current-route-control-inventory.mjs`. It records method, path template,
handler, current access class, required permissions, query fields, body handling, current byte-limit
status, unknown-field posture, pagination posture, rate posture, request-ID posture, error posture and
explicit gaps for every route.

`tests/acceptance/cp12/route-inventory.test.mjs` proves that:

- the inventory contains 128 unique method/path registrations;
- its 123 authenticated clinic-operation handlers exactly match the native router's registered
  handler sequence;
- `/health/live`, `/health/ready`, `/health/startup`, `/v1/me` and the Razorpay webhook are present;
- every current route remains marked non-compliant until the later API consumer registers and uses
  the CP12 pipeline.

This inventory must change in the same revision as any route registration. A new route without an
inventory entry fails the CP12 acceptance test.

## Inventory summary

| Dimension                                          | Count | Current posture                                                                               |
| -------------------------------------------------- | ----: | --------------------------------------------------------------------------------------------- |
| Total routes                                       |   128 | 0 marked CP12-pipeline compliant                                                              |
| Public health                                      |     3 | Deliberate auth exception; no route policy or application rate budget                         |
| Authenticated identity (`/v1/me`)                  |     1 | Token and identity lookup; no explicit active-membership gate, route policy or rate budget    |
| Verified provider webhook                          |     1 | Raw-body provider signature inside handler; no pre-verification rate budget                   |
| Authenticated clinic operations                    |   123 | Central identity/clinic resolution plus handler authorization; no registered uniform pipeline |
| GET                                                |    47 | No global query cardinality/byte or rate budget                                               |
| PATCH                                              |    12 | Handwritten parsing; unknown fields ignored                                                   |
| POST                                               |    68 | Handwritten parsing or webhook raw body; unknown fields ignored on JSON routes                |
| PUT                                                |     1 | Raw media upload with a current 100 MiB limit                                                 |
| Routes reading a body                              |    81 | Oversize currently returns `400`, not `413`                                                   |
| Routes with declared query fields in the inventory |    21 | No global unknown-query/cardinality/byte contract                                             |
| Routes with a `limit` field                        |     6 | Handler-specific validation only; no uniform cursor/limit policy                              |

## Controls that exist today

These controls are real and must be preserved during modularization:

- `/v1/*` traffic is rejected while required startup/readiness dependencies are unavailable.
- Non-webhook operations verify a Keycloak token (or the environment-gated local identity fixture),
  load the identity snapshot, derive the tenant from that snapshot and select a clinic only from the
  verified clinic list.
- Operations use permission checks, including doctor-role checks for clinical note and prescription
  signing.
- The payment webhook reads bounded raw bytes and verifies the provider signature before parsing
  provider business events.
- UUIDs and many domain values receive handwritten runtime checks.
- Postgres operations may share the CP11 unit of work and transaction-scoped RLS context.
- JSON bodies are limited to 1 MiB; the media byte route is limited to 100 MiB; the Razorpay raw
  body is limited to 1 MiB.

## Gaps and inconsistent controls

No current route uses an explicit registered `RouteSecurityPolicy`. The later framework consumer
must not infer compliance from individual checks.

1. All routes accept an arbitrary `x-request-id` string without syntax, length, multiplicity or
   provenance validation.
2. No route has an application rate budget. Health and the public webhook also lack an explicit
   pre-authentication IP budget.
3. No route has a runtime response schema or uniform PHI `no-store` response policy.
4. Native JSON parsing returns `400 VALIDATION_ERROR` for both malformed JSON and semantic schema
   failures. Oversized bodies also return `400`.
5. Handwritten object parsers select known properties but do not reject unknown properties. This
   hides mass-assignment attempts instead of failing them.
6. String, array, nested object and record complexity is not bounded uniformly. Several `record`
   fields accept arbitrary nested data.
7. Query keys, duplicate values, encoded byte length and value count are not bounded centrally.
   Pagination is present only on selected handlers and is not cursor-uniform.
8. Unexpected `Error.message` values become client-visible `500 CONFIGURATION_ERROR` messages.
   Error details are not passed through central PHI/secret redaction.
9. `/v1/me` verifies and resolves an identity but does not itself call authorization, so an inactive
   tenant/user/membership snapshot is not rejected at that boundary.
10. The webhook forwards the complete request-header record to the provider contract. Later wiring
    should pass only the signature and explicitly required provider headers.

The public health and provider-webhook routes intentionally bypass user authentication. They are
still control gaps until registered as narrow policy exceptions with byte/query/rate/error rules.

## Required pipeline order

The later API framework consumer must apply this order for every registered route:

1. match a stable method/path template and require an exact route-policy entry at startup;
2. create a validated request ID and safe correlation context without raw URL/query/body/header
   metadata;
3. apply pre-authentication query/body and IP budgets as bytes arrive;
4. verify user identity or the narrow public-health/provider-webhook exception;
5. load current identity/membership state and derive actor, tenant and clinic server-side;
6. enforce all route permissions and resource tenant/clinic relationships;
7. validate path, query and body with strict runtime schemas that reject unknown fields;
8. consume authenticated tenant/actor and expensive-operation budgets atomically;
9. invoke the domain operation under the existing CP11 transaction/RLS unit of work;
10. validate the response and serialize a redacted, `no-store`, request-ID-bearing result.

Provider webhooks preserve raw bounded bytes through signature verification and replay checks before
JSON parsing or tenant-scoped effects.

## Legacy response and error parity plan

Parity means preserving valid business behavior, side effects, response fields and status semantics.
It does not mean preserving unsafe or ambiguous boundary behavior.

| Case                            | Native behavior                         | CP12 canonical behavior                | Parity rule                                  |
| ------------------------------- | --------------------------------------- | -------------------------------------- | -------------------------------------------- |
| Successful reads/writes         | Existing `200`/`201`/`202` bodies       | Same status and runtime-validated body | Exact semantic parity required               |
| Missing route/resource          | `404 NOT_FOUND`                         | `404 NOT_FOUND`                        | Preserve; redact unsafe details              |
| State/idempotency conflict      | `409 CONFLICT`                          | `409 CONFLICT`                         | Preserve business distinction                |
| Missing/invalid identity        | `401 UNAUTHENTICATED`                   | `401 UNAUTHENTICATED`                  | Preserve; stable public message              |
| Role/tenant/clinic denial       | `403 PERMISSION_DENIED`                 | `403 PERMISSION_DENIED`                | Preserve and expand negative matrix          |
| Malformed JSON/transport syntax | `400 VALIDATION_ERROR`                  | `400 BAD_REQUEST`                      | Deliberate code normalization                |
| Invalid path/query/body schema  | `400 VALIDATION_ERROR`                  | `422 VALIDATION_ERROR`                 | Deliberate semantic split                    |
| Oversized body                  | `400 VALIDATION_ERROR`                  | `413 PAYLOAD_TOO_LARGE`                | Required hardening change                    |
| Rate/cost exhaustion            | Not implemented                         | `429 RATE_LIMITED` plus `Retry-After`  | Required new behavior                        |
| Dependency unavailable          | `503` with potentially detailed message | `503 DEPENDENCY_UNAVAILABLE`           | Preserve availability meaning; redact detail |
| Unexpected exception            | Raw `Error.message` exposed             | Generic `500 INTERNAL_ERROR`           | Required disclosure fix                      |

For each migrated or adapted route, tests must run the native and modular handler against sanitized
deterministic inputs and compare success status/body plus `401`/`403`/`404`/`409` behavior. The
intentional `400`→`413`/`422`, new `429`, and generic `500` transitions are asserted against this
table rather than treated as regressions.

## Time-bounded strangler rule

At CP12 exit, each active route must either run in the modular framework or pass through an adapter
that consumes the same registered policy, request context, schemas, budgets and error serializer.
The current native-router-only state is not a valid adapter. No route in this inventory may be
marked compliant merely because its domain handler performs a permission check.
