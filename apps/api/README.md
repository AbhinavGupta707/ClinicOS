# API App

Owner: platform/backend workstream.

Checkpoint 1 will install and wire the production NestJS REST API, OpenAPI generation, auth guards, tenant resolver, and health endpoints.

Reserved root command: `npm run dev:api`.

## Checkpoint 1 Data/Auth Contract

This lane adds a framework-neutral `/v1/me` handler in `src/me.ts` so the later NestJS route can be a thin adapter:

1. OIDC middleware verifies the Keycloak access token signature.
2. The route passes verified claims to `getMe`.
3. `getMe` validates issuer/audience/expiry, resolves ClinicOS identity and role assignments, records an `auth.session.resolved` audit event, and returns user/tenant/clinic/permission context.

The identity repository is an interface from `@clinic-os/db`; production code must back it with PostgreSQL and the Checkpoint 1 RLS context. Tests use an in-memory repository double only inside `test/`.
