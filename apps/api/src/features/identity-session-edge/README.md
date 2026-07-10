# CP14 API identity/session edge wiring

This namespace is additive and intentionally is not registered in the shared API bootstrap by this lane.

The master integration must instantiate `IdentitySessionEdgeGuard` with the exact Keycloak issuer, `clinic-os-api` audience, accepted `clinic-os-web-bff` and mobile client IDs, a maximum five-minute access-token lifetime, the production `__Host-` session-cookie name, and a distributed durable revocation store. Startup readiness must call `guard.readiness()` and fail when the store is unavailable.

After the framework verifies JWT signature, algorithm, `kid`, and JWKS trust, and before any route handler, call `guard.verify()` with current CP12 `AccessContext`, clinics, selected clinic, raw claims, request cookie header, and an injected time. The result preserves the CP12/13 tenant/clinic/membership scope; route policies and capability checks still run afterward. Do not accept the web session cookie at the API: the same-origin BFF exchanges it for an internal bearer request.

Master-owned route registration must map identity/JML/break-glass operations to `IDENTITY_SESSION_EDGE_RESOURCE_POLICIES`, enforce the distributed budgets, and attach `IDENTITY_SESSION_EDGE_RESPONSE_HEADERS`. Revocation ingestion must cover logout, refresh replay, administrator action, membership/role revision, JML, and break-glass expiry using `jti`, Keycloak session ID, subject, and issue time. Emit only classified, PHI/secret-safe audit metadata.
