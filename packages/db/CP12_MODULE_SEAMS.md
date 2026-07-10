# CP12 Repository Module Seams

## Status and scope

These seams provide behavior-preserving, domain-namespaced application ports over the existing
`ClinicOperationsRepository`. They are a CP13 parallel-slice foundation, not a second persistence
implementation. Canonical SQL, forced RLS, the runtime/worker role split, and database schema
version `014` are unchanged.

The production adapter creates all ports inside the existing `PostgresClinicUnitOfWork`. It does
not issue `BEGIN`, `COMMIT`, `ROLLBACK`, SQL, or RLS statements itself. The CP11 Postgres repository
continues to own those behaviors.

## Invariants

1. The authenticated application composition root supplies one trusted scope resolver. Command
   DTOs and repository method calls cannot supply or override tenant, clinic, or actor authority.
2. The resolver runs before transaction acquisition and returns the server-derived
   `RepositoryScope`. The result is validated, copied, frozen, and never exposed to the callback.
3. Every domain adapter removes the legacy `scope` parameter and delegates the remaining arguments
   and result unchanged to the existing repository object supplied by `PostgresClinicUnitOfWork`.
4. Domain state, patient timeline, request-attributed audit, and outbox evidence use the same
   transaction-owned repository and audit sink. Errors are not caught, translated, or retried by
   the seam, so the existing rollback and error semantics remain authoritative.
5. Request audit attribution is derived after the caller input is spread: tenant, clinic,
   `actorType: "user"`, and actor ID cannot be overridden by a runtime object.
6. Outbox events retain the existing `(tenant_id, idempotency_key)` conflict behavior. The seam
   neither generates nor rewrites idempotency keys.
7. Domain modules import only the legacy type contract and the shared scope-binding primitive. They
   do not import sibling domains, Postgres, RLS, schema, migrations, or SQL.
8. A transaction lease rejects use of a captured port after callback completion and waits for any
   operation started inside the callback before allowing the underlying unit of work to commit.

## Domain ownership

| Module                 | Repository behavior                                                        |
| ---------------------- | -------------------------------------------------------------------------- |
| Patient administration | patients, duplicate candidates, timeline reads, leads, attribution         |
| Scheduling             | appointment reference data, conflicts, appointments, queue                 |
| Clinical care          | intake, consent, encounters, clinical notes, prescriptions, instructions   |
| Clinical media         | upload reservations and patient media metadata                             |
| Dental treatment       | charting, findings, snapshots, treatment plans, performed procedures       |
| Billing                | pricebook, invoices, payment requests/transactions, receipts               |
| Continuity             | tasks, recalls, SOP templates/schedules/runs                               |
| Clinic operations      | labs, inventory, incidents, corrective actions, dashboards                 |
| Privacy and security   | audit review, export, deletion, retention, break-glass                     |
| Data integrations      | migration batches/rows and integration dead-letter replay requests         |
| AI scribe              | sessions, transcript/source provenance, jobs, drafts, review and retention |
| Transaction evidence   | request-attributed audit and idempotent outbox append                      |

`operation-registry.ts` assigns all 140 legacy operations to exactly one owner. The CP12
architecture test compares that registry to the source interface, rejects duplicates, and rejects
cross-domain or persistence-detail imports.

## Application composition

After the master exports the CP12 namespace from the package root, an API composition root can bind
its verified security context once:

```ts
const repositories = createPostgresClinicModuleUnitOfWork({
  client: pool,
  clock,
  resolveScope: (access: VerifiedClinicAccessContext) => ({
    tenantId: access.tenantId,
    clinicId: access.clinicId,
    actorUserId: access.userId
  })
});

await repositories.run(accessContext, async ({ repositories, evidence }) => {
  const patient = await repositories.patientAdministration.createPatient(command);
  await evidence.appendAuditEvent(auditFor(patient));
  await evidence.appendOutboxEvent(eventFor(patient));
});
```

The resolver must consume only a centrally verified request context. Never resolve scope from body,
path, query, provider payload, or other caller-controlled authority fields.

## Master integration patch

This lane intentionally does not edit the shared package export barrel. After reviewing and merging
the lane commit, the CP12 master must add this exact line to `packages/db/src/index.ts`:

```ts
export * from "./modules/index.ts";
```

Then rerun the DB typecheck/tests and the API compile against the integrated security context. No
manifest, lockfile, migration, environment, role grant, or schema-version change is required.

## Verification

- `npm --workspace @clinic-os/db run typecheck`
- `node --test packages/db/test/cp12-*.test.ts`
- `npm --workspace @clinic-os/db test`
- `npm run db:test:repositories` remains the E3 durable PostgreSQL parity gate owned by CP11/master
- `git diff --check`

The package tests are deterministic sanitized contract tests. They exercise the real CP11 Postgres
unit-of-work/repository classes through a recording SQL client and prove one transaction, local RLS
context, pooled reset, atomic rollback, audit attribution, outbox idempotency SQL, null parity, and
exact error propagation. They do not claim E3 database evidence; the master reruns the durable gate
after integration.
