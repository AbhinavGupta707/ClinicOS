# Migration assurance and recovery — acceptance

2026-10-02. Branch `codex/migration-assurance-recovery`, based on
`7638f99755ec067e57eae9861e0be787e666b7ca`. Delivery plan:
`../orchestration/MIGRATION_ASSURANCE_AND_RECOVERY_PLAN_2026-10-02.md`.
This is engineering evidence from synthetic data, not clinic cutover approval.

## Operator workflow

Open Import clinic data, select a saved run and expand **Migration assurance**.
Optionally choose another complete patient file with the same source/profile.
Appointment files are discovered and selected separately; matching source names
do not establish that the files belong to one export. Refresh the report after
changes, review its actions and optionally download its aggregate JSON summary.

The report independently counts stored rows, checks manifest receipts and saved
batch counters, and checks active patient links in one scoped SQL snapshot. It
distinguishes committed rows, distinct linked patients and patients actually
created by this run. Replay does not become new-patient creation. Partial uploads,
invalid/skipped/failed/rolled-back rows, conflicts and missing links stay visible.

Patient-file comparison reports added, unchanged, changed and absent source
identifiers. It never updates or deletes patients, cancels appointments, or
establishes source freshness. Invalid/incomplete/ambiguous comparisons suppress
their difference counts. Explicit appointment review outcomes remain separate:
history/exclusion are not bookings, and missing duration is not invented.

Context coverage distinguishes v1 demographics from v2 retained source text.
Versions added by this run and the latest retained versions for its committed
patient identities are separate counts. Latest versions can include later source
evidence; exact-version clinician review warnings remain visible on replay.
Imported text is not a current diagnosis, consent or accepted clinical record.

The read requires migration authority and scoped database access; optional
appointment evidence additionally requires patient-read authority. Access is
audited without source text. The report/download contains counts and evidence IDs,
not names, contact values, raw CSV, source patient IDs or clinical text. Failed
refreshes and selection changes clear prior results. The panel starts collapsed
to keep upload and review controls prominent; mobile and desktop are exercised.

## Local checks

Evidence root:
`.audit-spectra-retirement-20260920/migration-assurance-20261002/`.
Existing dependencies only. Builds, test data, temporary files and logs remain on
Spectra. No Docker lifecycle changes, Desktop writes, live patient/payment data,
provider activation or deployment.

- `final-checks/results.json`: workspace check, typecheck, lint, **1,225 workspace
  tests with zero failures/skips**, builds, release-scope secret scan and existing
  dependency-patch verification passed.
- Generated OpenAPI/client drift and route inventory checks passed: **181 native
  operations**, with **190 repository methods** covered by the module inventory.
- Nine focused domain/restore guard cases passed (four domain cases also belong
  to the workspace total). They cover incomplete/unresolved evidence, replay,
  noncomparable files, context/appointment review, isolated restore ownership,
  changed data/schema/sequences/documents, SQL literal preservation and a rejected
  retry replacing stale success with explicit failure.
- `native-gv8ptwyu`: **all 28 stages passed**. Fresh 35-migration setup and
  validation, 233 API tests without skips, financial/appointment, history, media,
  source-context, patient-file, document and new assurance repository probes
  passed. Context tests include 5,000 v2 patients and unchanged replay retaining
  the latest version's review warning. Negative probes catch changed receipts,
  missing/extra receipt membership, valid/committed-counter corruption, lost
  patient links and wrong source/clinic/tenant. Historical appointment review
  changes its report outcome without creating a booking.
- In that same run, **24 real API/PostgreSQL browser cases passed**: 12 import/
  front-desk and 12 daily/clinical/financial/document cases. The 5,000-patient
  exercise paused/reloaded/resumed upload and commit, replayed the full file
  without new patients, compared 5,000 unchanged identifiers, downloaded the
  aggregate report and recovered from an intentionally failed report read.
  The expandable report, mobile overflow check and desktop/mobile screenshots
  passed; rendered output was inspected. Clinic API success responses were not
  mocked; authentication used the synthetic local hook described below. Existing
  real-identity/API-restart tests were not run locally.
- The real dump/restore matched **139 tables / 72,642 rows**, the populated
  context sequence and **10 archived document renderings**. Backup size:
  9,888,636 bytes; SHA-256
  `83f74a98695af43a58392361f73ce91e9379b8fe1d51f2ab93159e71c2eeadd0`.
  Canonical schema digest:
  `2520e7da2029a1441949bb43827e027e530bb70385f0e148e5de6ad50579a72d`.
  Restored runtime/RLS checks and Flyway validation passed. The measured local
  restore/comparison phase was 9,333 ms; this is not a production recovery SLA.
  All three owned PostgreSQL/Redis service processes exited successfully.

A final wording-only correction labels the older per-group reconciliation total
as historical, because later rollbacks do not rewrite commit summaries. It points
operators to the new current-row/link assessment. This follows the full native
run; web typecheck, lint and all 237 web tests passed after that correction. No
import, report or restore behavior changed after the passing native run.

Codex in-app browser discovery returned no backend. Repository Playwright tests
exercise actual API/PostgreSQL contracts instead; no IAB, physical device or
printer validation is claimed. Native tests use a synthetic identity hook, not
real Keycloak sign-in. Existing staff-identity/restart acceptance remains a
separate CI job and was not rerun locally in this slice.

The first online npm check was blocked pending specific authorization for sending
dependency metadata. After the owner's instruction to proceed with PR/CI review,
the disclosed advisory check ran and passed the repository gate: 0 critical,
4 high and 13 moderate raw advisories. All high findings trace to the existing
node-forge advisory GHSA-86w9-cpqp-85rv, with the exact upstream PR #1152 backport
verified locally. There are no unmitigated high/critical gate blockers; this is
not a claim of zero raw high advisories. No dependency versions changed.

## Restore method and limits

`scripts/test-migration-assurance-native.py --run-approved-synthetic-services`
is an explicitly opted-in macOS rehearsal using existing PostgreSQL 16, Redis,
Flyway and Node. With no opt-in it prints a plan. It creates uniquely owned
loopback services, marks the disposable source, runs migrations and workflows,
then creates a separate fresh cluster and provisions roles before restoring.
Both clusters' identity, ports, data directories, PIDs and ownership markers are
checked. Other database clients or a nonempty target prevent the restore.

The restore tool takes a repeatable-read snapshot while holding table write locks,
streams ordered per-table row hashes, records sequence state and re-renders saved
documents. It takes a custom PostgreSQL dump and restores transactionally into the
empty target. Complete schema dumps include constraints, RLS, functions, owners
and privileges. PostgreSQL normalizes some expressions on restore, so an
independent source-schema-only copy is parsed into a newly created reference
database on the owned target cluster and its dump is compared with the restored
schema. Only paired outer randomized psql protection markers are removed. SQL
content, including function bodies and comment-looking literal text, is preserved.
No existing database is overwritten or reset.

The source and target row hashes/counts, schema, sequence states and document
renderings must agree. Runtime permissions/RLS and migration validation run again
against the restored database. Owned services stop in `finally`; dump, aggregate
evidence and cleanup records remain on Spectra. This proves a local database
restore only. It excludes private object bytes, Keycloak and external providers,
is not an independent backup, and establishes no production RPO/RTO.

## Review corrections and failed evidence

Bounded read-only review found and corrected omitted valid-row counter checking,
incomplete receipt validation for selected/comparison files, context-review
warnings disappearing on replay, hidden stale appointment selection on rediscovery,
overbroad schema normalization and stale restore result status after preflight
failure. The parent reviewed integrated permissions, contracts and restore safety.

Earlier runs remain available and are not counted as complete passing evidence:

- `native-1g7zjzai`: new route required updating the route inventory assertion.
- `native-9z1gp55e`: repository-only acceptance passed before later corrections.
- `native-8yhhn6cn`: broad synthetic names from the new probe caused legitimate
  duplicate-review conflicts in the later 5,000-patient browser fixture. Probe
  names are now unique and its execution follows the browser exercises. Product
  duplicate safeguards were retained.
- `native-l78acnfv`: all repository checks and **24 browser cases** passed;
  restored rows/sequences/documents matched, but textual schema equality failed
  because PostgreSQL normalized equivalent CHECK expressions. The independent
  schema parsing/comparison above replaces that invalid textual assumption.

## Remaining acceptance boundaries

This slice does not approve retiring Practo or claim that its CSV exports contain
the entire patient file, financial history, charts, images or messaging consent.
Before a real migration, validate representative authorized export files and field
policy locally with the clinic, reconcile explicit exclusions and appointment
decisions, and have clinicians review the relevant historical context.

An independent backup must use a separately controlled encrypted destination and
include the required database, private objects, identity/configuration and key
recovery material. Retrieve it into a separate isolated environment, restore the
full required services, verify hashes/permissions and rehearse a clinic-day read
and write without contacting live providers. A second directory on Spectra is
not that independent backup. Staff/printer and real-source approval remain open;
staff rehearsal remains deferred by the owner.

No GitHub checks, image scans, merge or production readiness are implied by this
local acceptance record. CI now includes the new restore guard tests and durable
assurance probe alongside existing real import/browser and identity workflows.
