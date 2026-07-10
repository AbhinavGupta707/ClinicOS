# Auth Package

Auth/session parsing, tenant/clinic context, RBAC/ABAC helpers, and test fixtures.

## Checkpoint 1 Scope

- Converts already-verified Keycloak/OIDC access-token claims into a ClinicOS principal.
- Validates issuer, audience/client, expiry, and not-before claims.
- Resolves tenant/clinic role scope into effective permissions.
- Exposes `/me` response shaping for API adapters.

`principalFromVerifiedKeycloakClaims` expects signature verification to have happened in the HTTP framework OIDC middleware or gateway. The function name is deliberately explicit so product code does not accidentally treat unsigned JWT parsing as authentication.

Authorization is tenant-first, then clinic-scoped, then permission-scoped. A role assignment in one clinic does not grant the same permission in another clinic unless the role assignment is tenant-wide.

## Checkpoint 12 Security Pipeline Contract

- `buildAccessContext` filters identity snapshots to the verified user and tenant before calculating roles or permissions. Foreign-user, foreign-tenant, and clinic-role-without-active-assignment records cannot grant authority.
- inactive tenants, users, memberships, and clinic assignments fail closed;
- `deriveVerifiedRequestScope` derives actor and tenant from the verified identity snapshot and treats a requested clinic only as a selector over active, verified clinics;
- request-supplied tenant, actor, roles, permissions, clinical signer, pricing, or payment state are never authority inputs;
- `RequestScopeResolutionError` and `AuthorizationError` keep scope-resolution failure distinct from missing-capability failure for stable `403` mapping.

The API framework consumer must verify the token signature and claims before calling these helpers, load current membership state from the authoritative identity repository, derive the request scope, and then authorize the route policy. UI visibility and decoded-but-unverified JWT claims are not security boundaries.

## Checkpoint 14 Identity and Session Contracts

- `OAuthTransactionManager` builds Authorization Code + PKCE S256 requests and requires an atomic, consume-once state store. Callback state, nonce, verifier, return target, issuer, audience, and authorized party are server-bound; URL fragments, token parameters, `offline_access`, and cross-origin return targets are rejected.
- `WebSessionManager` stores access, refresh, and ID tokens only in an AES-256-GCM encrypted server record. The browser receives an opaque `HttpOnly`, `SameSite=Lax`, production `Secure __Host-` cookie and a session-bound synchronizer CSRF token. Session-family revocation, periodic/fixation rotation, authority-revision checks, refresh compare-and-swap, and replay response are store-atomic contracts.
- `MobileTokenManager` is a separate native contract. Refresh material is accepted only through an OS secure-storage vault that is device-only and backup-excluded; refresh reuse or identity drift purges the vault. Logout purges locally before requiring upstream refresh-token revocation and reports an honest unconfirmed state if the provider is unavailable.
- `principalFromProductionKeycloakClaims` applies bounded lifetime, issuer, audience, `azp`, session, token-ID, and MFA checks after framework signature verification. JML and break-glass helpers require ordered, idempotent, audited controls and do not replace current ClinicOS tenant/clinic authorization.

Production composition must provide distributed transaction/session stores, KMS-backed key rings, a current-authority resolver, an official OIDC token client, and a distributed revocation feed. Missing bindings are startup/readiness failures. Browser code must never receive or persist access or refresh tokens.
