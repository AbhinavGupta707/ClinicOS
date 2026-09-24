# Issuer-bound identity bootstrap

`IdentityRepository.findAccessByKeycloakIdentity` requires the **verified issuer
and subject** together. Both API entry paths pass this pair after signature,
issuer and audience checks. Caller-supplied headers, emails and display names
must never substitute for it. This repository performs exact matching; it does
not validate JWT signatures or select the trusted issuer itself.

Migration `0024_issuer_bound_identity_bootstrap.sql` replaces the old subject-only
bootstrap permissions. The five existing tenancy control tables retain forced
RLS and tenant/clinic-scoped write policies. Separate `FOR SELECT` policies permit
bootstrap reads only for an exact Keycloak issuer/subject pair. A subject alone
or an unregistered issuer grants no bootstrap access. No superuser, RLS bypass,
security-definer function or extra runtime privilege is introduced.

This separation matters because a permissive `USING` expression on an `ALL`
policy also controls deletion; an insert/update `WITH CHECK` clause alone does
not make bootstrap access read-only. See the official PostgreSQL
[policy semantics](https://www.postgresql.org/docs/16/sql-createpolicy.html).

The lookup clears ambient tenant/clinic/user settings, sets transaction-local
identity settings, reads one statement-consistent snapshot, then clears the
identity settings before returning, including when using a caller-owned
transaction. Query failures require transaction rollback. Pooled connections
must never retain request identity. When the user has more than one active
tenant membership, the current single-tenant API returns no access; it does not
choose a tenant by row order. A future explicit tenant-selection contract is
required before supporting that case.

## Applying the change

Use the normal reviewed migration process. The application and migration must
be rolled out together: old application instances do not supply an issuer and
will fail closed after 0024. Drain those instances before reopening traffic.
Do not weaken the policy or add subject-only fallback to accommodate old code.
Existing identity records are preserved without rewriting their issuer values.
If a stored issuer differs from the approved runtime issuer, reconcile its
provenance through an authorized identity administration process; do not alias
issuers or mass-update records merely to make sign-in succeed.

No local services or databases are changed by editing or building these files.
Applying migrations or changing a running service requires the owner's approval.
Current verification runs database changes on disposable synthetic CI services.

## Verification

- Offline DB tests cover invalid identity rejection before SQL, exact parameter
  binding, transaction completion/rollback/release and clearing bootstrap scope.
- API tests cover verified issuer propagation and rejection of a matching subject
  registered in a different realm. The fixture repository uses the same contract.
- The existing `db:test:repositories` gate calls `test-identity-bootstrap.mjs`
  using the non-superuser, non-BYPASSRLS runtime role. It proves same-subject
  separation across two issuers, missing/wrong issuer denial on all five control
  tables, rejected bootstrap inserts/updates/deletes, preserved tenant-scoped
  writes, multiple-tenant denial and clean transaction settings. Its temporary
  aliases and membership probes are always rolled back.
- The normal migration lifecycle gate checks locking, checksum drift and failed
  migration rollback; real API/Postgres browser acceptance exercises import,
  Today and patient handoff against the migrated schema.

This is the identity lookup foundation. It does not supply a stable membership
authority revision, global pre-membership audit sink/dispatcher, web BFF routes,
complete browser login or live-clinic approval. Global identity administration
privileges and provider activation remain separate boundaries.
