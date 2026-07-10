# CP14 web BFF wiring

`Cp14BffRuntime` is a framework-neutral, server-only contract. This lane does not register Next.js routes or alter the web manifest/bootstrap.

The master integration must register server handlers for `/auth/login`, `/auth/callback`, `/auth/session`, `/auth/logout`, and allowlisted `/bff/v1/*` routes. Instantiate the runtime only on the server with:

- `OAuthTransactionManager` backed by a distributed atomic consume-once store;
- `WebSessionManager` backed by a distributed atomic encrypted-session store and KMS/Secrets Manager key material, with the exact canonical issuer and reviewed MFA policy pinned in its configuration;
- an identity validator that delegates to `principalFromProductionKeycloakClaims` using the runtime-supplied issuer, MFA policy, audience, client allowlist, and injected time;
- a current CP12 membership/authority-revision resolver;
- an official confidential-client OIDC adapter for code exchange, refresh rotation, and revocation that maps only proven provider results to typed confirmed rejection/replay errors and treats network/timeout/malformed outcomes as uncertainty;
- a master-owned ALB adapter that verifies the peer and overwrite/normalization contract, creates `VerifiedTrustedProxyBoundary`, strips raw forwarded host/protocol headers, and then invokes `TrustedEdgePolicy`; and
- a fixed-origin API transport with response-byte and timeout enforcement.

The configured issuer must be one canonical bounded `/realms/<slug>` URL. Authorization, token and revocation endpoints must match the exact standard Keycloak paths below that issuer; callback and API-base URLs are canonical and query-free. The BFF also verifies that every safe session's MFA policy ID and evaluated result match its configured policy.

The handlers must translate request data without logging URLs, cookies, codes, state, tokens, or bodies; serialize only the runtime response; and map errors to generic no-store responses. The BFF validates the exact reflected upstream response-header allowlist (`content-type`, `etag`, `retry-after`, `x-request-id`) for schema, bounds, ambiguity and control characters. Apply a per-response nonce CSP at the Next/edge layer. Never expose the token client, session store, secret, token set, or bearer header to Client Components. The browser may receive only the opaque `HttpOnly` cookie and safe session/CSRF view.

If the adapter imports `@clinic-os/auth` or `@clinic-os/security`, the master must add those web workspace dependencies and the required Next transpilation/package-export configuration coherently. This lane adds no dependency and changes no manifest.
