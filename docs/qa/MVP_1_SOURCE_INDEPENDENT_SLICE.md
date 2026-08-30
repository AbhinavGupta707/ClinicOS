# MVP1/MVP2 Source-Independent Slice Evidence

Status: implemented and locally verified; Practo adapter and recurring sync are
not complete

Date: 2026-08-30

## What this slice proves

- A patient external reference is linked to one canonical ClinicOS patient.
- Exact cross-batch replay reconciles to that patient and creates no duplicate.
- Simultaneous commits for the same external reference serialize on a
  deterministic transaction lock; the real Postgres probe uses three pool
  connections, observes a waiting advisory-lock contender, and proves that one
  commit creates while the other reconciles.
- A changed replay is blocked for review and does not silently overwrite the
  ClinicOS patient.
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
- Checked-in, in-consult, and completed appointments are not labelled confirmed
  without confirmation evidence.
- Provider health says Practo Ray is not configured and does not imply API
  access, background sync, scraping, or writeback.

## Executable evidence

| Boundary | Evidence |
| --- | --- |
| Domain | Patient import field-difference tests |
| API/fixture | Exact replay, changed replay, duplicate external reference, joined Today identity |
| Repository/Postgres | Cross-batch replay, simultaneous-commit serialization, reconciled rollback, and clinic-day SQL projection |
| Contract | Generated OpenAPI/client drift check covers the joined dashboard shape and `create_new` resolution action |
| Web | Joined Today normalization, bounded/truncated state, no inferred confirmation, on-demand patient and lead duplicate search, honest Practo status |

The repository consistency check, workspace typecheck, lint, complete test
suite, production build, generated OpenAPI/client drift check, route inventory,
secret scan, and real Postgres repository suite pass for this checkpoint.

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
