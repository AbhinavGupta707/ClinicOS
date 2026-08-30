# MVP1/MVP2 Source-Independent Slice Evidence

Status: patient, practitioner-link, and appointment paths verified in real
Postgres through migration 0023; manual canonical-CSV operations UI verified
through the real local web/API/Postgres stack at desktop and mobile widths;
Practo adapter and recurring sync are not complete

Date: 2026-08-30

## What this slice proves

- A patient external reference is linked to one canonical ClinicOS patient.
- Exact cross-batch replay reconciles to that patient and creates no duplicate.
- Simultaneous commits for the same external reference serialize on a
  deterministic transaction lock; the real Postgres probe uses three pool
  connections, observes a waiting advisory-lock contender, and proves that one
  commit creates while the other reconciles.
- A changed replay is blocked for review and does not silently overwrite the
  ClinicOS patient. This includes source-only evidence changes and legacy links
  whose canonical digest is missing.
- Every duplicate external reference in one batch is blocked; there is no
  row-order winner.
- External practitioners are link-only. An import may map a source practitioner
  to an eligible existing ClinicOS doctor, but it cannot create a user,
  membership, clinic assignment, role, or schedule.
- Practitioner eligibility is rechecked during staging and commit. A stale
  mapping cannot silently assign an appointment to an inactive or ineligible
  doctor.
- Appointments require existing patient and practitioner external-reference
  links plus exact active ClinicOS appointment-type and optional chair codes.
- Appointment import accepts strict RFC3339, calendar-valid, offset-aware
  instants and canonical source/status values only. It rejects date rollover,
  non-canonical syntax, impossible leap days, 24:00, and leap-second input. It
  does not infer source, silently map codes, infer deletions from absence, or
  admit transient checked-in/in-consult states.
- Active appointment overlaps block every affected in-batch row. Postgres also
  preflights existing records and retains exclusion constraints as the final
  concurrent-write guard.
- Exact appointment replay reconciles without duplication. Changed evidence is
  reviewed rather than silently updating or cancelling an existing appointment.
- Imported appointment creation does not fabricate ordinary booking history or
  timeline events for historical source data.
- Rollback removes untouched created appointments before patients, unlinks
  practitioner mappings without deleting users, and blocks appointment deletion
  after the appointment changes or gains downstream dependencies.
- Commit, row resolution, and rollback serialize on the migration-batch row.
  Commit and rollback also acquire the same deterministically ordered
  external-reference advisory locks using one non-locale comparator, so a
  concurrent replay cannot validate a mapping while rollback removes it and
  unusual source identifiers cannot invert lock order.
  Appointment and patient rollback lock the target row, require the original
  row version, and inventory downstream clinical, billing, integration, privacy,
  and AI dependencies before deleting anything.
- Migration requests require exactly one non-null CSV or row-array source and
  are capped at 100 rows. Public conflict projections are explicitly truncated
  and counted rather than growing quadratically without a response bound.
- When an operator explicitly reaffirms changed evidence against the same
  canonical mapping, the stored digest is advanced with previous-digest, actor,
  batch, row, and time evidence. Source-only changes and missing legacy digests
  then replay cleanly; unresolved differences in canonical patient fields still
  require review. This canonical evidence mutation is explicitly
  non-automatically-reversible: rollback stays partially committed and reports
  the mapping as blocked. An original mapping is also protected while a later
  committed reconciliation depends on it.
- Evidence reaffirmation is persisted as an explicit migration-row fact rather
  than inferred from `link_existing`; an explicitly linked exact replay remains
  safely rollbackable because it changed no canonical evidence.
- Normalized-record evidence uses canonical key-sorted digests, avoiding false
  replay conflicts when Postgres JSONB returns keys in a different order.
- Migration count SQL is unambiguous and counts rows once even when a row has
  multiple conflicts.
- The morning dashboard returns a joined clinic-day projection containing
  patient, practitioner, appointment type, chair, queue, and freshness data.
- The web Today loader uses that projection and does not download the full
  patient registry.
- Appointment arrays are capped at 500 and report explicit truncation instead
  of failing response validation. Leads, tasks, and queue entries use the same
  500-record response bound; a real Postgres regression proves that 51 active
  leads and 51 active tasks are not silently cut back to the former 50 limit.
- Patient lookup is an explicit on-demand search.
- Lead capture preserves authoritative duplicate suggestions; persisted leads
  run an exact-phone registry check, and patient creation stays disabled until
  review succeeds or the operator explicitly confirms no candidate matches.
- Manual Practo/source lead capture can retain an optional external booking or
  reference identifier for later reconciliation.
- Checked-in, in-consult, and completed appointments are not labelled confirmed
  without confirmation evidence.
- Provider health says Practo Ray is not configured and does not imply API
  access, background sync, scraping, or writeback.

## Executable evidence

| Boundary | Evidence |
| --- | --- |
| Domain | Patient, practitioner, and appointment parsing, strict RFC3339/calendar validation, canonical status/source, and replay-difference tests |
| API/fixture | Practitioner review/mapping, appointment dependency resolution, exact replay, changed/missing-evidence review and backfill, no row-order overlap winner, and dependency/reaffirmation-blocked rollback |
| Repository/Postgres | Patient replay, simultaneous-commit serialization, clinic-day SQL projection, practitioner→patient→appointment commit/rollback, resolution guards, and the cross-batch replay-commit/original-rollback race all pass against migration 0023 |
| Schema | Migration 0023 adds practitioner import types, null-safe normalized-record checks, link-only practitioner constraints, normalized/link target-type consistency checks, and explicit evidence-reaffirmation state |
| Contract | Generated OpenAPI/client drift check exposes only patient, practitioner, and appointment batch types |
| Web | Joined Today, bounded/truncated state, on-demand search, honest Practo status, optional source booking/reference capture, and a manual canonical-CSV stage/review/commit/best-effort-rollback workflow proven without request interception at 1280px and 390px |

Migration 0023 is applied locally. Flyway validation, database verification,
migration lifecycle tests, and the complete repository/Postgres suite pass
across all 23 migrations. Repository consistency, typecheck, lint, every
workspace test, production builds, environment checks, and the secret scan pass.
Playwright also proves synthetic patient staging, durable commit, imported-link
creation, patient search visibility, explicit safe rollback, rolled-back link
state, patient removal, console health, and mobile horizontal-overflow behavior
against the real local API/Postgres stack without network interception.

The real-stack spec is a guarded local acceptance recipe, not a default-suite
claim. It was explicitly run with the API and web processes connected to local
Postgres:

```sh
CLINICOS_MVP_IMPORT_E2E_ENABLED=true \
CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 \
npx playwright test tests/e2e/mvp-manual-import-real-stack.spec.ts \
  --reporter=line --workers=1
```

The dependency audit is not green: the current lockfile reports 12 high and 10
moderate advisories, including transitive Next/Expo build dependencies. No
automatic `--force` upgrade was applied because npm proposes breaking Next and
Expo major-version changes. This is recorded for a separate, controlled
dependency-upgrade checkpoint rather than misrepresented as fixed.

## Truth boundary

This does **not** prove a live Practo connection. No Practo credentials, private
endpoints, export columns, webhook semantics, cursor, or writeback are present.
The remaining source-specific work is to map a clinic-authorized Ray export or a
documented API payload into these existing boundaries.

This also does **not** complete MVP2 repeatability. A durable sync run, cursor or
watermark, lease, retry/recovery workflow, missing-record semantics, and visible
last-success status remain required after the source contract is known.

## Next executable checkpoint

1. Map a clinic-authorized deidentified Ray export or documented API payload to
   the now-frozen generic contracts; do not change the core ingestion semantics
   to fit guessed vendor fields.
2. Confirm the clinic's first-trial operator, Ray edition/export path, timezone,
   representative volumes, and update/cancellation semantics.
3. Run the same manual browser recipe with the representative deidentified
   source sample before designing recurring sync.
