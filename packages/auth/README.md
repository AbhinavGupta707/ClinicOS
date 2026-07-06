# Auth Package

Auth/session parsing, tenant/clinic context, RBAC/ABAC helpers, and test fixtures.

## Checkpoint 1 Scope

- Converts already-verified Keycloak/OIDC access-token claims into a ClinicOS principal.
- Validates issuer, audience/client, expiry, and not-before claims.
- Resolves tenant/clinic role scope into effective permissions.
- Exposes `/me` response shaping for API adapters.

`principalFromVerifiedKeycloakClaims` expects signature verification to have happened in the HTTP framework OIDC middleware or gateway. The function name is deliberately explicit so product code does not accidentally treat unsigned JWT parsing as authentication.

Authorization is tenant-first, then clinic-scoped, then permission-scoped. A role assignment in one clinic does not grant the same permission in another clinic unless the role assignment is tenant-wide.
