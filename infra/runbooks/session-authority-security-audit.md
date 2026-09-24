# Current session authority and global security-audit delivery

This slice builds on PR #3's exact issuer/subject lookup. It supplies the production
`CurrentSessionAuthorityResolver`, the global PostgreSQL audit sink, Redis audit
delivery and the optional worker background runtime. It does not activate login
routes, start local services or complete production identity approval.

## Authority and revocation

Migration 0025 gives users and tenants database-generated authority generations.
Every insert/update rotates the generation; callers cannot restore an old value.
Identity, membership and clinic/role assignment changes rotate both affected users
on an owner change. Clinic, role and role-permission changes rotate affected
tenants. Deletes also invalidate. Changes and generations commit or roll back
together. Generation tokens prevent revoke/regrant and add/remove membership
cycles from recreating an old session revision. Cosmetic user/tenant edits also
invalidate sessions conservatively.

The repository reads identity and both generations in one statement and rejects
multiple active memberships. Database role grants must match the fixed domain
permission map; unknown roles or drift fail closed for both API and web authority.
Custom editable role grants are not supported by this scope. The resolver includes
the application permission map in the revision so code changes also invalidate
sessions, and consults the repository on every use without a cache. Supply a fresh
pool-backed repository, not a long-lived caller transaction. Dependency failures
throw; they are not treated as an inactive membership.

Current lookup still requires an explicit clinic-assignment row. A tenant-wide
role is usable only within the clinics returned by that verified snapshot; this
slice does not expand clinic discovery. Active tenant, user, single membership,
active clinic and a usable known role are required.

The existing `WebSessionManager` revokes a session family when the revision changes.
This is web-session invalidation. Direct bearer-token issued-at cutoffs, JML
coordination and Keycloak session revocation still require their existing separate
revocation adapters to be composed; this migration does not claim to revoke every
unexpired bearer token by itself. In-flight requests can finish with the authority
already read; subsequent resolver calls see committed changes.

## Durable global audit

`RedisWebSessionStore.requiredAuditOutbox()` supplies standalone pre-membership
denial persistence. Session changes continue using the existing atomic session
state plus audit write. Validation rejects unknown actions, schemas and fields,
including token/secret extras, and copies/freezes canonical values. Redis commands
have finite deadlines; uncertain writes are not blindly retried by the adapter.
Pending audit fields have no expiry and the reaper excludes them.

`PostgresSecurityAuditSink` owns a short READ COMMITTED transaction with statement,
lock, connection-acquisition and client-operation deadlines. Supply a dedicated
worker-role pool with connection/query timeouts and a bounded maximum connection
count. It appends to `identity_security_audit_events`, keyed by a domain-separated
SHA-256 of the producer key. The raw producer key is excluded from the canonical
payload. The record carries the action, opaque subject, optional verified scope,
source-adapter version and receipt/occurrence times. No fabricated clinic is needed
for pre-membership events. Existing clinical `audit_events` RLS is unchanged.

The sink compares both payload digest and canonical JSON on replay. A matching
record commits before Redis acknowledgement. A conflicting payload never overwrites
evidence. PostgreSQL grants only SELECT/INSERT to the worker; the generic runtime
role has no access. Forced RLS permits only the exact deduplication-key lookup,
not unscoped global enumeration. Update/delete/truncate are denied by both grants
and an immutable-evidence trigger. Security exports need a separately reviewed
read role; neither worker nor runtime can export the whole global partition.

Acknowledgement compares the exact scanned Redis value before deleting. A stale
worker cannot erase a replacement; an already missing record is safe concurrent
acknowledgement. Database commit before a crash, lost commit replies, lost ack
replies and multiple dispatchers are safe to replay. Conflicts remain pending,
remove readiness and do not prevent unrelated records from being delivered.

`SecurityAuditDispatcher.runOnce()` limits deliveries per tick and retains a page
remainder because Redis HSCAN COUNT is only a hint. Readiness requires a complete
clean sweep, fresh sweep progress, and both dependencies. `SecurityAuditRuntime`
retries without an exhaustion/dead-letter path, uses capped backoff, supports
abort and reports finite success/denied/error counters using the existing
`clinic_os.outbox.events` metric with workflow `identity`. It logs no payload,
identity, Redis receipt or key. Optional `identitySecurityAudit` registration in
`createWorkerRuntime` starts it and includes its named readiness check.

No runtime is instantiated by environment discovery in this change. The complete
BFF composition must pass the shared Redis namespace/key configuration, worker
pool, resolver and background runtime together and require audit readiness before
admitting sign-in. That composition also owns session reaping and alert routing.
Process-crash recovery does not imply zero loss after catastrophic Redis restore;
managed durability, noeviction, backup/restore reconciliation, backlog age/count
alerts and immutable global-audit export/retention remain production evidence gates.

## Rollout and verification

Apply 0025 and the matching application build together, then apply the reviewed
worker/runtime grants (`scripts/db-local-lifecycle.mjs` is the local synthetic
provisioning recipe, not a production deployment command). Readiness requires
schema version 025. Drain old application instances; invalidate existing web
sessions when introducing the new resolver. No identity mapping is rewritten.

Offline tests exercise validation, authority selection, bounded delivery, outage,
post-commit replay, conflicting evidence, stale ack, timeout, worker recovery and
sanitized diagnostics. The guarded CI-only `security-audit.integration.mts` uses
real Redis and PostgreSQL with the worker role, tests concurrent replay, global
scope, denied mutation and runtime-role exclusion, and leaves immutable evidence
only in the disposable CI database. `test-session-authority.mjs` extends the
existing loopback repository gate with rollback-only mutation/ABA and drift tests.

References: [PostgreSQL trigger transactions](https://www.postgresql.org/docs/16/trigger-definition.html),
[PostgreSQL policy commands](https://www.postgresql.org/docs/16/sql-createpolicy.html),
[Redis scan guarantees](https://redis.io/docs/latest/commands/scan/).
