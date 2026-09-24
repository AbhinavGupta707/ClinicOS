# PR #2 review and merge — 22 September 2026

[PR #2](https://github.com/AbhinavGupta707/ClinicOS/pull/2) was critically reviewed
at `282918fa3a6580c736ab21856ff6b08f51b75dcb`, then merged into
`mac-latest-20260829` at `0eef0f89cce0e952736aa7d3d9424cf5ccd47906`.
The fetched merge tree exactly matches the reviewed head. `main` was unchanged.

Parent and independent read-only review covered the AES-GCM encryption/AAD,
lookup-key binding, absolute expiry, atomic create/consume semantics, key
rotation, uncertain responses, caller contracts, real-Redis test safeguards,
CI integration and documentation. No material defect required a repair.
The parent reran all 51 auth tests; all passed without skips.

All 19 reported checks passed on the exact head before merge. The
[quality run](https://github.com/AbhinavGupta707/ClinicOS/actions/runs/35745555478)
passed 1,023 workspace tests, the real Redis test, migration/repository/worker
and readiness gates, builds, and four real API/Postgres browser cases.
The [security run](https://github.com/AbhinavGupta707/ClinicOS/actions/runs/35745555456)
passed CodeQL, SCA/IaC/secrets/SBOM/license checks and all six ARM64 image gates.
The previously classified baseline remained 13 moderate dependency advisories
and 19 CodeQL alert IDs; green CI does not mean no residual findings exist.

The merged adapter stores pending PKCE logins safely across application
processes. It does not enable complete staff login. Managed Redis TLS/ACL,
clock monitoring, failover/restore invalidation, membership authority and
security-audit composition remain required before production identity use.

The next scoped change binds existing database/API identity lookup to issuer
plus subject, separates bootstrap reads from tenant-authorized writes and
rejects ambiguous active tenant membership. Its operating contract is in the
[identity bootstrap runbook](../../infra/runbooks/issuer-bound-identity-bootstrap.md).
Authority revisions, audit dispatch and complete BFF login follow separately.

All local work stayed on Spectra with existing dependencies. Heavy database,
container and browser verification used disposable GitHub runners. No local
Docker service, database, provider, Desktop file or unrelated research asset
was changed by this merge pass.
