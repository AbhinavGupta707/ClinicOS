# Generated API Client

This package is generated from `@clinic-os/api-contracts` by
`node scripts/cp12-openapi-generate.mjs`. It is checked in so consumers compile without network
access and so contract drift is reviewable.

Do not edit `src/index.ts` manually. Run `node scripts/cp12-openapi-check.mjs` to verify the checked-in
OpenAPI document, route inventory, and client all match runtime contract truth.

The client requires an access-token provider for authenticated operations. Mutations expose the
contract-required `idempotency-key`; mutable `PATCH` operations also require `if-match`. Server-side
enforcement is an integration obligation until the CP12 API strangler consumes these contracts.

Body-returning methods remain compatible. Additive `<operation>WithMetadata` companions expose the
response status, request ID, strong ETag, idempotency replay truth, and bounded retry delay. Mutable
resource response types expose a required numeric `rowVersion`; callers format `If-Match` as the
strong quoted value `"rv-<rowVersion>"`.

The Razorpay method accepts raw `Uint8Array` bytes but sends the provider's real
`application/json` media type. Raw preservation is a signature-verification parser mode, not an
octet-stream transport contract.
