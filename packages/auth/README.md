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
