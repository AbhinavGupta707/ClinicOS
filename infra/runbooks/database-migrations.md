# Database Migration Operations

This runbook owns the ClinicOS schema lifecycle introduced at CP11. The numbered SQL files under
`packages/db/migrations/` are the canonical schema source. Flyway records their checksums in
`public.flyway_schema_history`; applied files are immutable.

## Roles and boundaries

| Role                 | Purpose                                                            | Prohibited                                                                             |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `clinic_os_migrator` | Own schema objects and execute Flyway                              | Superuser, bypass RLS, application traffic                                             |
| `clinic_os_runtime`  | API product DML under transaction-local tenant/clinic/user context | Schema creation, migration writes, audit mutation, worker attempt/dead-letter mutation |
| `clinic_os_worker`   | Claim/update outbox rows and persist attempts/dead letters         | Product/clinical table reads, schema creation, bypass RLS                              |

Local passwords are development-only. Staging and production credentials must come from the
approved secret manager and deployment identity; never place them in Git or command output.

## Local clean bootstrap

```sh
npm run db:bootstrap
```

The command starts required services, performs a guarded local-only database recreation, migrates
through the complete checksum-tracked chain, applies least-privilege grants, inserts explicit
synthetic seeds, and verifies the schema/RLS/role inventory. It refuses a non-local host and
requires `CLINIC_OS_ENV=local|test`, `PILOT_SYNTHETIC_DATA_ONLY=true`, and the explicit destructive
reset flag supplied by the root script.

Never adapt `db:reset:local` for staging or production. Production migration is a one-shot task
using only the migrator identity; application traffic remains disabled until validation and
startup/readiness pass.

## Non-destructive lifecycle

```sh
npm run local:services
npm run db:provision:local
npm run db:migrate:info
npm run db:migrate:validate
npm run db:migrate
npm run db:grant-runtime
npm run db:seed:local
npm run db:verify
```

`db:seed:local` is synthetic-only and is never part of a production deployment. A second
`db:migrate` must report the schema is current with no migration required.

## Adding a migration

1. Choose the next contiguous four-digit version. Never renumber or edit an applied migration.
2. Make the change forward-compatible with the currently deployed application or coordinate a
   traffic-disabled deployment boundary.
3. Preserve tenant attribution, composite tenant/clinic foreign keys, forced RLS, least privilege,
   audit/provenance, and safe backfill behavior.
4. Update `LATEST_DATABASE_SCHEMA_VERSION` and static schema assertions.
5. Run the clean bootstrap twice, Flyway validation/no-op migrate, migration failure tests,
   repository/RLS tests, worker persistence tests, and API readiness fault/recovery.
6. For destructive or long-running changes, include a reviewed expand/backfill/contract sequence,
   lock/statement timeouts, capacity estimate, and abort criteria.

## Failure handling

- **Checksum mismatch:** stop. Restore the applied file byte-for-byte. Add a new forward-fix
  migration; never run Flyway repair merely to silence drift.
- **Concurrent runner:** Flyway locking must serialize the runners. Do not disable the lock or use
  out-of-order execution.
- **Failed transactional migration:** confirm the failed version did not leave partial objects,
  correct the unapplied file, and rerun in an isolated database. If any part committed, add a
  forward fix after incident review.
- **Runtime schema mismatch:** `/health/startup` and `/health/ready` remain non-200. Do not route
  traffic until `db:migrate:validate` and the expected version pass.
- **Worker persistence mismatch:** keep the worker stopped. Validate migration 014, the dedicated
  worker credential, RLS policies, and `npm run worker:test:persistence`; do not fall back to the API
  runtime or migrator credential.
- **Production failure:** stop rollout, preserve logs and database evidence, follow the incident and
  restore runbooks, and use a reviewed forward fix or restore-to-new-database procedure. No ad-hoc
  down migration is authorized.

## Required evidence

Record revision/dirty status, environment, Flyway image digest, database version, exact commands,
timestamps, checksums, schema/RLS/role inventory, result/skips, sanitized logs, reviewer, and
limitations. Local clean bootstrap is E3 only; staging migration, deployment reconciliation, and
restore-to-new-database evidence remain required at E4/E5.
