# CP12 Runtime Contracts, Native OpenAPI and Generated Client

**Scope:** Lane A contract foundation only

**Evidence tier:** E1 deterministic/static

**Runtime activation claim:** none; master/API integration is required

**Active native inventory:** 128 registered operations

## Outcome

ClinicOS now has one data-driven runtime contract registry for every route registered by
`apps/api/src/server.ts`: identity/health plus all active CP2–CP10 route families. The registry is
the source for runtime validation, OpenAPI 3.1, a checked-in TypeScript client, and a diffable route
inventory. Static route discovery fails if the native router gains or loses an operation without a
matching contract.

This is the contract side of the CP12 strangler. It does not modify or silently wrap the native
router. The registry records whether the existing route is currently `route-parity`, `partial`, or
`body-parser-only`, plus the wiring required before CP12 can claim runtime enforcement.

## Boundary rules

- Path and query objects are strict. Collection queries use a maximum `limit` of 100.
- JSON bodies are strict at every operation boundary. Unknown writable fields fail rather than
  being stripped or reaching application code.
- Tenant, clinic and request actor come from verified server context, never a body.
- Free-form evidence/provenance maps are bounded and recursively reject tenant/actor, signature,
  price-authority, private-storage, raw-provider-payload and provider-secret names.
- Clinical note and prescription signing operations are bodyless. The verified doctor identity is
  the signature authority.
- Treatment-plan items select a server catalog procedure and clinical quantity. Client unit price,
  discount, tax and total fields are absent. Invoice line items remain derived from completed
  procedure evidence.
- Media completion cannot assert scan status, quarantine state, storage object version, bucket or
  object key. Those are storage/scanner authority.
- Authenticated mutations require `Idempotency-Key`. Mutable `PATCH` operations also require
  `If-Match` metadata.
- Canonical mutable resource representations require `id` and positive safe-integer `rowVersion`.
  Reduced suggestions, summaries, histories and snapshots remain projections rather than false
  concurrency sources.
- Strong resource ETags use canonical `"rv-<rowVersion>"` syntax. Singleton GETs and mutations with
  one unambiguous version source require an ETag; collections carry versions per item and no
  collection ETag.
- PHI-bearing responses are `no-store`. Response validation recursively blocks private storage,
  raw provider payload and secret field names from generic public records.
- Razorpay uses provider-standard `application/json` transport while preserving the exact bounded
  raw bytes for signature verification before parsing.

## Stable error shape

Every operation shares:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request failed runtime validation.",
    "details": {},
    "request_id": "request-correlation-id"
  }
}
```

The current stable code set is `UNAUTHENTICATED`, `PERMISSION_DENIED`, `NOT_FOUND`,
`VALIDATION_ERROR`, `CONFLICT`, `AI_PROVIDER_UNAVAILABLE`, `DEPENDENCY_UNAVAILABLE`, and
`CONFIGURATION_ERROR`. Error details are public bounded JSON and pass the same private-field guard.

## Generated artifacts

- `packages/api-contracts/generated/native-openapi.json`
- `packages/api-contracts/generated/native-route-inventory.json`
- `packages/api-client-generated/src/index.ts`

The OpenAPI file is deliberately namespaced as the **native strangler** contract. It is not the
master-reserved aggregate API artifact assembled after Nest/native integration. It contains
ClinicOS extensions for checkpoint origin, PHI/cache posture, idempotency, concurrency,
pagination, native enforcement state and exact master wiring.

Generation and comparison use only checked-in source and installed repository dependencies; they
make no network calls:

```sh
node scripts/cp12-openapi-generate.mjs
node scripts/cp12-openapi-check.mjs
node scripts/cp12-openapi-route-inventory.mjs
```

## Master/API integration contract

The master or later API-framework lane must:

1. Reconcile the root lockfile once so the new `@clinic-os/api-client-generated` workspace is
   registered. This lane intentionally did not edit the root lockfile.
2. Invoke `parseNativeOperationRequest` after authentication/clinic resolution but before every
   native/Nest handler. The verified tenant/clinic/actor context must remain outside client input.
3. Normalize path, query and lower-case headers exactly once, enforce the declared body content
   type and byte ceiling, and map schema issues to the stable API error envelope.
4. Persist idempotency by actor, clinic, operation, key and canonical request digest in the same
   atomic unit of work as the domain mutation/audit/outbox effect. Same-key/different-digest is a
   conflict; same digest replays the original status/body.
5. Emit resource ETags and enforce `If-Match` atomically for registry operations marked
   `if-match`. Select/shape every mapped `row_version` as public `rowVersion`; do not implement this
   as a pre-read followed by an unguarded write. See `docs/api/VERSIONED_RESPONSE_METADATA.md`.
6. Apply the declared collection limit in repository queries. Existing native handlers that ignore
   `limit` must be tightened rather than relying on response truncation.
7. Validate success responses before they leave the controller. A private-field response failure
   must be logged only with redacted diagnostic context and fail closed.
8. Keep CP11 startup/readiness, runtime-ID smoke, transaction-scoped RLS, role separation, injected
   clock, unit-of-work and fixture-detection behavior unchanged.
9. Regenerate and compare the namespaced artifacts, then assemble any final aggregate OpenAPI/client
   only after the integrated route/security pipeline is frozen.
10. Emit and validate the generated response-header contract: request ID everywhere, required
    `false|true` replay truth on successful header-idempotent mutations, singleton ETags, and bounded
    delta-second retry guidance on `429`.
11. Remove the fixture Razorpay content-type rewrite. Preserve raw request bytes without changing
    the production JSON media type.

## Intentional legacy tightening

The native generic object parser currently tolerates aliases or unknown fields in several
handlers. The registry selects the canonical shape rather than documenting that weakness. Master
integration must update in-repository consumers in one reviewed change before making schema
enforcement active. Important changes include:

- `Idempotency-Key` replaces body-local idempotency aliases.
- `If-Match` is required for mutable `PATCH` operations and accepts only canonical strong
  `"rv-<rowVersion>"` values.
- list `limit` is bounded at 100.
- treatment-plan client price/tax/discount fields are removed.
- media scan/quarantine/storage metadata is removed from public completion input.
- signature operations accept no client signer/timestamp/signature fields.

Do not add weak compatibility endpoints. If an older fixture-only route represents a different
workflow, keep that workflow deferred whole.
