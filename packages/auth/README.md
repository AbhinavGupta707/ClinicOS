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
- `RedisOAuthTransactionStore` implements that store using Redis 6.2+ atomic `SET NX PXAT` and `GETDEL`, with an injected clock, a maximum ten-minute lifetime, HMAC-derived keys and AES-256-GCM encrypted verifier/nonce/return-target records. Ciphertext is bound to its lookup key. Multiple web processes share one consume-once transaction; a lost response fails closed and is never retried. This adapter does not register login routes or complete the web identity lifecycle.
- `WebSessionManager` stores access, refresh, and ID tokens only in an AES-256-GCM encrypted server record. The browser receives an opaque `HttpOnly`, `SameSite=Lax`, production `Secure __Host-` cookie and a session-bound synchronizer CSRF token. Every create, decrypt, and refreshed identity is pinned to one canonical configured Keycloak realm issuer. Monotonic activity is stored separately from token `recordVersion`, so ordinary concurrent requests cannot contend with refresh or rotation. External refresh uses a durable single-flight lease with a pre-provider `dispatched` phase; an expired dispatched lease or lost completion revokes the family because provider rotation may already have happened.
- `MobileTokenManager` is a separate native contract. Refresh material is accepted only through an OS secure-storage vault that is device-only and backup-excluded; refresh reuse or identity drift purges the vault. Logout purges locally before requiring upstream refresh-token revocation and reports an honest unconfirmed state if the provider is unavailable.
- `principalFromProductionKeycloakClaims` applies bounded lifetime, issuer, audience, `azp`, session, token-ID, and MFA checks after framework signature verification. JML and break-glass helpers require ordered, idempotent, audited controls and do not replace current ClinicOS tenant/clinic authorization.

Session creation, rotation, revocation, refresh replay and uncertain refresh recovery carry typed required audit intents into the same atomic store transaction. MFA denial uses a required durable outbox, and JML completion is committed through a coordinator that atomically owns its security state and outbox evidence. Diagnostic logs do not satisfy these contracts.

`MfaAssurancePolicy` is required at API, BFF/session and break-glass boundaries. The default production policy must require an explicit primary-plus-secondary AMR combination. Generic `mfa`, a lone weak factor and AAL-like text are not evidence. Exact ACR values or a single phishing-resistant AMR are accepted only when the policy pins reviewed realm evidence; the realm template alone is not that evidence.

The official OIDC adapter must throw `WebSessionRefreshProviderError` only after classifying a result as confirmed rejection, confirmed replay or transport uncertainty. Untyped errors, timeouts, malformed success responses, identity drift and lost durable completion are uncertain after dispatch: the family is atomically revoked with `auth.refresh.recovery_uncertain`, and the old refresh token is never retried. Only confirmed reuse emits `auth.refresh.replay_detected`; only a confirmed provider rejection such as validated `invalid_grant` uses `refresh_rejected`.

Production composition must provide distributed transaction/session stores, bounded refresh-lease wait/pub-sub, KMS-backed key rings, a current-authority resolver, an official OIDC token client, a durable security-audit outbox and a distributed revocation feed. Missing bindings are startup/readiness failures. Browser code must never receive or persist access or refresh tokens.

### OAuth Redis adapter operations

Supply a non-cluster writable Redis primary, a dedicated key-HMAC secret, a versioned AES-256 key ring, and the runtime's injected clock. Production Redis must use TLS/ACL authentication and the security-state durability/eviction policy in the [identity runbook](../../infra/runbooks/cp14-identity-runtime-adapters.md). Use separate secrets for transaction encryption, transaction lookup, session encryption and OAuth state HMAC. During encryption-key rotation retain old decrypt keys for the full ten-minute transaction window; removing one early invalidates its in-flight logins. Each application instance must share the same key namespace and key material. Do not log records, state, verifiers, callback URLs or provider errors.

Readiness checks `INFO cluster`, primary writability and `GETDEL` permission using a unique one-second probe. Required Redis command grants are `INFO`, `SET` and `GETDEL` within the configured namespace; readiness writes only its expiring probe. Operations have a bounded deadline and never auto-retry. Timeout does not cancel a command already dispatched: callers must treat it as uncertain and start a new login rather than restoring/reusing old evidence. Expiry is absolute, so a delayed create cannot extend a transaction. After a Redis restore or uncertain failover, invalidate pending login state before reopening identity readiness; this adapter alone is not evidence of failover durability.

Unit/fault coverage runs with `npm run test --workspace @clinic-os/auth`. CI separately runs the real-Redis command below against its disposable synthetic service; it fails when opt-ins or Redis are absent, rather than reporting fixture success. It neither starts a service nor flushes a database, and cleans up only keys it allocated.

```sh
CLINICOS_OAUTH_REDIS_TEST_ENABLED=true \
PILOT_SYNTHETIC_DATA_ONLY=true \
CLINICOS_OAUTH_REDIS_TEST_URL=redis://127.0.0.1:6379 \
node --test packages/auth/test/redis-oauth.integration.mts
```

Application and Redis clocks must remain synchronized. `PXAT` uses Redis time; consume independently checks the injected application time, so skew can expire a login early or retain unusable ciphertext longer. Clock-skew monitoring belongs in runtime readiness. Wrong-type Redis values fail closed and are not overwritten/deleted by consume; investigate the storage fault rather than retrying that login state.

Command semantics: [Redis SET](https://redis.io/docs/latest/commands/set/) and [Redis GETDEL](https://redis.io/docs/latest/commands/getdel/). Browser OIDC, MFA, authority changes, session audit dispatch and managed-service recovery still require their own end-to-end evidence.
