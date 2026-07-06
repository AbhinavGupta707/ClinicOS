# API App

Owner: platform/backend workstream.

Checkpoint 1 exposes a bootable Node HTTP API surface for production session context and health checks. Later checkpoints can replace the transport with NestJS/OpenAPI without changing the typed `/v1/me` contract.

Runtime commands:

```sh
npm run dev --workspace @clinic-os/api
npm run typecheck --workspace @clinic-os/api
npm run test --workspace @clinic-os/api
npm run build --workspace @clinic-os/api
```

## Checkpoint 1 Data/Auth Contract

This lane adds a framework-neutral `/v1/me` handler in `src/me.ts` so the later NestJS route can be a thin adapter:

1. OIDC middleware verifies the Keycloak access token signature.
2. The route passes verified claims to `getMe`.
3. `getMe` validates issuer/audience/expiry, resolves ClinicOS identity and role assignments, records an `auth.session.resolved` audit event, and returns user/tenant/clinic/permission context.

The identity repository is an interface from `@clinic-os/db`; production code must back it with PostgreSQL and the Checkpoint 1 RLS context. Tests use an in-memory repository double only inside `test/`.

## HTTP Runtime

- `GET /health/live` proves the API process is serving.
- `GET /health/ready` proves the identity repository and auth mode are configured.
- `GET /v1/me` resolves authenticated tenant, clinic, role, permission, and audit context.

By default `/v1/me` verifies Keycloak RS256 bearer tokens against the realm JWKS endpoint. For local synthetic boot checks only, set `CLINIC_OS_API_USE_DEV_AUTH_FIXTURE=true`; this accepts `x-clinic-os-dev-subject` values such as `seed-assistant` and is blocked for production-like environments.
