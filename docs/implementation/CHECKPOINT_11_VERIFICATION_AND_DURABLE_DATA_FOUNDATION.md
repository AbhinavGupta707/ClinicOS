# Checkpoint 11 — Verification Integrity and Durable Data Foundation

**Status:** E3 technical closeout recorded 2026-07-09; release remains NO-GO
**Execution:** Single master session
**Evidence target:** E3 clean durable local integration
**Production traffic:** Forbidden
**Evidence:** `docs/qa/checkpoint-11-evidence.md`

## 1. Objective

Make ClinicOS claims reproducible against a clean, migrated PostgreSQL database and real local dependencies. CP11 removes false-green evidence and establishes the only trustworthy base for API modularization, durable clinic workflows, cloud deployment and provider activation.

## 2. Findings Owned

- E3 closure: PRR-002, PRR-011, PRR-029;
- E3 local controls complete with higher-tier evidence still open: PRR-001, PRR-003, PRR-010,
  PRR-025;
- foundation/partial closure: PRR-027 (durable outbox/workflow integration), PRR-028 (validation inventory), PRR-026 (capability state inventory).

Do not close PRR-027/028/026 unless every criterion in the main register is actually satisfied; CP11 may leave them explicitly open for CP12/13.

## 3. Non-Goals

- no AWS resource apply;
- no live provider, payment, message, call, AI, ABDM or PHI traffic;
- no native camera/audio implementation;
- no big-bang NestJS/API rewrite;
- no compatibility endpoint created only to satisfy stale fixtures;
- no destructive rewrite/squash of existing numbered migrations;
- no claim of pilot or production readiness.

## 4. Preconditions and Baseline Capture

1. Read the canonical remediation, threat and evidence docs.
2. Record `git status --short`, branch and revision. Preserve `research/` and `scripts/research/` unless the user explicitly scopes them in.
3. Record tool versions: Node, npm, Docker, PostgreSQL client and selected migration tool.
4. Reproduce and capture:
   - full test failures;
   - CP10 live smoke `clinic_mismatch`;
   - local `public` table count;
   - current `/health/ready` result with a dependency down;
   - workspace scripts that use syntax-only checks.
5. Confirm local-only synthetic configuration. Abort if any environment points at a production system or contains real PHI.

## 5. Implementation Work Packages

### WP11.1 — Deterministic time and clinic calendar

**Design:**

- Add a minimal `Clock` interface, e.g. `now(): Date`, plus system and fixed implementations in a shared application-safe package.
- Inject it into operations that create timestamps, calculate retention eligibility, clinic-day queue windows, sequence/slip prefixes, expiry/retry and signed clinical events.
- Keep database authoritative timestamps where consistency/security requires them; explicitly reconcile database time with injected application time in tests/design.
- Centralize clinic-local date conversion using the configured IANA timezone. Do not slice UTC ISO strings to infer the clinic date.

**Tests:**

- convert hardcoded current-date tests to fixed clocks;
- run the full suite with at least `2026-07-07T23:59` and `2026-07-09T00:01` clinic-local scenarios;
- test UTC/Asia-Kolkata date boundaries, leap day and relevant DST behavior for non-India configured tenants;
- verify retention cannot select records created after `asOf` and sequence prefixes follow clinic-local policy;
- add a guard/review inventory for unowned `new Date()` use in application/domain logic.

**Acceptance:** `npm run test` passes on any host date/timezone and repeated runs do not require fixture edits.

### WP11.2 — Real TypeScript compilation everywhere

**Design:**

- inventory workspace `typecheck`, `lint`, `test`, `build` scripts;
- replace `node --check` for `.ts` product code with `tsc --noEmit -p <project>`;
- use project references or explicit package tsconfigs so dependencies compile in deterministic order;
- enable strict production-safe options consistently; document any time-bounded exception;
- ensure tests/generated/dist files are included/excluded intentionally.

**Tests:**

- temporarily inject or use a fixture that violates a cross-package type and prove the gate fails, without leaving the violation in source;
- verify every `apps/*` and `packages/*` TypeScript workspace is included;
- build from a clean checkout without relying on stale ignored `dist` output.

**Acceptance:** no production TypeScript workspace reports type safety through syntax-only checking.

### WP11.3 — Versioned PostgreSQL migration lifecycle

**Default decision:** use a version-pinned Flyway runtime against existing `packages/db/migrations/*.sql`. If implementation selects another mature runner, record an ADR demonstrating equivalent checksum history, advisory locking, failure semantics and deployment support.

**Required commands:**

- `db:migrate` — apply pending migrations;
- `db:migrate:info` — show sanitized version/checksum state;
- `db:migrate:validate` — reject drift/missing checksums;
- `db:bootstrap` — local/test clean create + migrate + synthetic seed;
- `db:reset:local` — destructive local-only reset with explicit environment guard;
- `db:verify` — schema/RLS/roles/seed assertions;

Names may vary slightly, but the capabilities and documentation may not.

**Controls:**

- migration owner and runtime application role are separate;
- runtime role cannot create/alter/drop schema or bypass audit protections;
- migration history table is protected from runtime writes;
- concurrent runner obtains a lock; a second attempt waits/fails safely;
- failed migration stops startup/deploy and leaves diagnosable history;
- released migrations are immutable; corrections use a new migration;
- seeds are synthetic, idempotent and never run automatically in production;
- production one-shot task runs before incompatible application activation;
- expansion/contraction strategy and forward-fix/rollback are documented.

**Migration review:**

- run all ten existing migrations on a blank database;
- inventory tables, constraints, indexes, triggers/extensions and RLS policies;
- verify tenant-owned tables have RLS and expected indexes/foreign keys;
- verify required extensions are declared by migration, not developer state;
- detect any SQL that assumes an object created outside migrations;
- retain existing migration filenames/checksums unless a never-released checksum baseline decision is explicitly recorded before production.

**Acceptance:** two consecutive clean bootstraps and a no-op re-run pass; drift and concurrent runner tests fail safely; zero tables is impossible after successful local bootstrap.

### WP11.4 — Durable repositories, RLS and transaction evidence

**Design/tests:**

- run repository tests against real Postgres, not only in-memory implementations;
- create synthetic tenant A and B, every supported role and minimum workflow data;
- verify app authorization plus direct RLS denial under the runtime role;
- ensure pooled connections cannot leak transaction-scoped tenant context;
- verify domain write + audit + outbox atomicity on success and forced rollback;
- verify constraints for duplicate/idempotent operations and cross-tenant foreign keys;
- compare in-memory provider/repository contract suites with Postgres implementations and remove semantic drift;
- fail startup/test if an E3 command silently selects fixture repositories.

**Acceptance:** an automated schema/RLS inventory and cross-tenant suite covers every tenant-owned table and critical repository method.

### WP11.5 — Local dependency lifecycle and truthful readiness

**Design:**

- local startup becomes: services → dependency health → migrations → synthetic seed (explicit local command) → API/worker;
- add startup/readiness/liveness separation;
- liveness proves process/event loop only;
- startup proves initialization completed;
- readiness probes required synchronous dependencies with bounded timeouts and no PHI/secrets;
- detailed dependency/capability health is authenticated/authorized and distinguishes required, optional, degraded and disabled;
- optional provider unavailability does not lie about the core service, but a dependency required by an enabled route removes relevant readiness or capability.

**Minimum local probes:** PostgreSQL connectivity and migrated schema; Keycloak issuer/JWKS or explicit local auth fixture mode; Temporal and Redis only if the enabled runtime needs them; media/provider capability registration state without external secret disclosure.

**Tests:** stop each required dependency independently and verify status/HTTP code/removal/recovery; test timeout and stale cached health; verify production-like config refuses fixture headers, simulators and local credentials.

**Acceptance:** `/health/ready` cannot return success for an unusable enabled application.

### WP11.6 — Runtime-ID live smoke and contract reconciliation

**Design:**

- split `--dry-run`/fixture validation from `--base-url` live execution;
- live smoke authenticates, calls `/v1/me`, derives tenant/clinic/actor context and carries runtime-created identifiers;
- use unique per-run synthetic names/contact values and a run ID;
- do not hardcode appointment date; derive it from the injected clinic clock or create/read the same date;
- exercise canonical routes only; delete/defer stale fixture route descriptions rather than adding shims;
- record zero skips and redact identifiers/contact data from normal logs where unnecessary.

**Minimum live chain:** identity → lead/patient/appointment/queue → consent/encounter → selected clinical/dental/billing/operations reads/writes feasible at CP11 → audit/outbox evidence → owner readiness with runtime clinic ID → cross-tenant denial.

**Acceptance:** CP10/CP11 live smoke passes twice after process restart against the Postgres repository with zero `clinic_mismatch`, zero fixture-ID assumptions and zero silent fallback.

### WP11.7 — Reproducible repository gates

**Design:**

- scope Prettier/checks to tracked product inputs or add an explicit ignore policy so optional user research does not contaminate release checks;
- verify from a clean clone/export and from the current dirty worktree without deleting user files;
- ensure every script exits non-zero on failure and does not swallow skips/errors;
- make environment preflight report only presence/state, never secret values;
- add the E3 database integration gate to CI where service containers are available;
- retain dependency audit as a required security gate through an approved path; if network/policy blocks it, report blocked, never pass.

**Acceptance:** the same revision produces the same gate result independent of unrelated untracked research files.

### WP11.8 — Correct documentation and evidence truth

- mark CP10 reports/matrix as historical E1/E2 evidence superseded for readiness;
- update local runbook with migrations, seed, dependency status and safe reset;
- add migration operations and failure/recovery runbook;
- record CP11 evidence using the standard schema;
- update the remediation register with closed/partial/open status and links;
- update changelog, agent memory and checkpoint log;
- keep pilot checklist NO-GO until later E5/E6 gates.

## 6. Security Test Matrix

| Case                                                          | Expected result                                       |
| ------------------------------------------------------------- | ----------------------------------------------------- |
| No tenant context under runtime DB role                       | Tenant rows inaccessible; request fails closed.       |
| Tenant A identity with Tenant B clinic/resource ID            | API denial and RLS denial; no existence/PHI leak.     |
| Reused pooled connection after Tenant A transaction           | Tenant B request sees only Tenant B.                  |
| Fixture header in production-like environment                 | Startup or request rejected.                          |
| Local media/provider simulator in production-like environment | Startup/capability rejected, never marked ready.      |
| DB down/schema unmigrated                                     | Readiness non-200; no traffic accepted.               |
| Duplicate idempotent write/outbox relay                       | One business effect; attributable duplicate handling. |
| Forced failure after domain write before audit/outbox commit  | Entire transaction rolls back.                        |
| Malformed/oversized CP11-smoked input                         | Stable bounded validation error; no stack/SQL/secret. |
| Date rollover/timezone boundary                               | Correct clinic date and retention result.             |

## 7. Verification Sequence

Run narrow package gates throughout. Closeout must include, using the final command names introduced by CP11:

```sh
git diff --check
npm run check
npm run typecheck
npm run lint
npm run test
npm run build
npm run security:secrets
npm run db:bootstrap
npm run db:verify
npm run db:migrate:validate
node scripts/cp10-contract-smoke.mjs --dry-run
node scripts/cp10-contract-smoke.mjs --base-url <local-api> --auth-mode <approved-local-mode>
```

Also execute:

- clean database bootstrap twice;
- API and worker restart/recovery;
- required dependency fault matrix;
- cross-tenant/RLS suite;
- full browser smoke for assistant, doctor, owner, receptionist/accountant boundaries and 390px critical paths where the durable loaders are implemented;
- dependency audit through the authorized path or explicit blocked evidence.

Exact secrets, tokens and PHI must not appear in output or evidence files.

## 8. Exit Gate

CP11 is complete only when:

1. all current repository gates pass at the recorded revision;
2. all production TypeScript is typechecked by TypeScript;
3. a blank Postgres becomes the complete expected schema through canonical migrations;
4. schema/RLS/role/transaction assertions pass;
5. local startup documents and executes migration before app traffic;
6. readiness fails and recovers truthfully with dependencies;
7. live smoke uses runtime IDs and real repositories, passes twice with zero skips;
8. date/timezone tests are deterministic;
9. current release truth remains NO-GO and CP10 is accurately classified E1/E2;
10. evidence, runbooks and finding status are reviewed.

## 9. Handoff to CP12

The CP11 closeout must provide:

- final migration and local lifecycle commands;
- schema/RLS inventory artifact;
- canonical route inventory and fixture/live classification;
- application seams suitable for incremental NestJS migration;
- list of runtime validation/auth/idempotency gaps by route;
- performance baseline for representative API operations;
- remaining PRR-026/027/028 work;
- no unresolved failure hidden as an accepted gap.
