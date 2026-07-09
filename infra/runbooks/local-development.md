# Local Development Runbook

This runbook covers the CP11 durable local dependency and application surface. Local evidence is
synthetic-only E3 and never proves staging, provider, physical-device, restore, or production
readiness.

## Prerequisites

- Node.js `22.22.2`
- npm `10.9.7`
- Docker with Compose v2

## Install

```sh
npm ci
```

## Clean durable bootstrap

```sh
npm run db:bootstrap
npm run local:ps
```

`db:bootstrap` recreates only the guarded local `clinic_os` database, applies all canonical
checksum-tracked migrations, installs least-privilege grants, seeds two explicit synthetic tenants,
and verifies forced RLS and cross-tenant denial. It is destructive to local ClinicOS database data.
Use `npm run local:up` when retaining an already-migrated local database; that command starts
services, provisions roles, migrates, and reapplies grants without seeding.

Services:

| Service             | URL / address                                                                 | Local credential        |
| ------------------- | ----------------------------------------------------------------------------- | ----------------------- |
| Postgres API        | `postgresql://clinic_os_runtime:clinic_os_runtime@localhost:5432/clinic_os`   | local runtime only      |
| Postgres worker     | `postgresql://clinic_os_worker:clinic_os_worker@localhost:5432/clinic_os`     | outbox tables only      |
| Postgres migrations | `postgresql://clinic_os_migrator:clinic_os_migrator@localhost:5432/clinic_os` | Flyway only             |
| Redis               | `redis://localhost:6379`                                                      | none                    |
| Temporal            | `localhost:7233`                                                              | none                    |
| Temporal UI         | `http://localhost:8088`                                                       | none                    |
| Keycloak            | `http://localhost:8080`                                                       | admin `admin` / `admin` |

The Keycloak realm is `clinic-os-local`. Synthetic local users use the password `local-only-password`:

| Username             | Realm role   |
| -------------------- | ------------ |
| `owner.local`        | owner        |
| `doctor.local`       | doctor       |
| `assistant.local`    | assistant    |
| `receptionist.local` | receptionist |

## Environment

Copy the template for app runtime work:

```sh
cp .env.example .env.local
```

Keep `simulator` providers only for local/dev contract tests. For `staging`, `pilot-prod`, and `prod`, the typed config package requires official providers or `unconfigured` unavailable states.

## Verify database state

```sh
npm run db:migrate:info
npm run db:migrate:validate
npm run db:migrate
npm run db:verify
npm run db:test:migrations
npm run db:test:repositories
npm run worker:test:persistence
npm run api:test:readiness
```

The no-op migrate must say the schema is current. The verifier reports the migration count,
tenant-table/forced-RLS inventory, non-privileged database roles, synthetic tenant count, worker
product-table denial, and cross-tenant isolation.

See `infra/runbooks/database-migrations.md` before adding or recovering a migration.

## App Commands

```sh
npm run dev:web
npm run dev:api
npm run dev:worker
npm run dev:mobile
```

The API must use `DATABASE_URL` with the runtime role. The worker must use
`WORKER_DATABASE_URL` (preferred) or `DATABASE_URL` with the dedicated worker role. Local auth and
repository fixtures require their explicit local-only flags; durable E3 commands set
`CLINIC_OS_API_USE_FIXTURE_REPOSITORY=false` and fail if fixture fallback occurs.

## Stop Or Reset

```sh
npm run local:down
```

To rebuild only the local ClinicOS database from canonical migrations and synthetic seeds:

```sh
npm run db:bootstrap
```

To remove all local service volumes after confirming no useful synthetic state is needed:

```sh
docker compose down --volumes --remove-orphans
```

Do not place real patient data, production PHI, or live provider secrets in local Docker volumes or `.env.local`.
