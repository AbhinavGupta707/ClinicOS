# Historical patient context — local acceptance

2026-10-02; branch `codex/migration-history-context`, based on PR #8 merge
`af0530266c2382c8932b9e3473b3b6e1cedfc9d1`. The delivery plan is
`docs/orchestration/MIGRATION_CONTEXT_AND_DOCUMENT_DELIVERY_PLAN_2026-10-02.md`.
This records local evidence; the PR's exact-head checks and merge are the remote
acceptance record. This is synthetic engineering acceptance, not clinic approval
or production readiness.

## Delivered behavior

The explicit `practo_ray_patients_context_v2` profile extends the existing
5,000-patient, 25-MiB patient-file workflow. V1 remains demographics-only.
V2 retains 12 supported source fields (including medical history, patient notes,
address and alternate contact text) as unverified historical evidence. National
ID, Age and Anniversary Date remain excluded. Missing primary phone is recorded
without inventing one; malformed supplied numbers fail validation. No alternate
contact is substituted and no messaging consent is inferred.

Original bounded nonblank text is preserved. Context has immutable patient,
source, import-row and version provenance. Exact replay reuses the latest equal
context; changed evidence and A→B→A create new unreviewed versions. Source
record dates remain unknown. A doctor with clinical signing authority can record
an audited review of the exact current source version, without creating current
clinical facts. Reads require patient, PHI and clinical-note authority. Generic
migration responses exclude historical source text.

**Retention boundary:** context-bearing imports cannot be removed or unlinked by
generic migration rollback, even before clinical review. The operator sees this
before commit. V1 guarded rollback remains supported. Real source corrections
must be reviewed; this is not an erase-and-reimport workflow.

## Verification

Evidence: `.audit-spectra-retirement-20260920/migration-context-20261002/`.
The successful native run is `native-yeyykz4k`; its `checks.json`, browser results
and `cleanup.json` retain individual outcomes.

- Workspace check, typecheck, lint, **1,213 tests (zero failures/skips)**, builds,
  generated contracts, route inventory and secret scan passed. The final doctor
  role restriction additionally passed the focused route-policy checks and the
  real browser permission negative; web typecheck was rerun.
- All **34 migrations** applied and validated on fresh, isolated native PostgreSQL.
- Independent durable reconciliation: **5,000 v2 patients**, **1,667 missing
  primary phones**, **5,002 immutable source versions** after change/reversion,
  and **5,000 corresponding import audits/outbox events**. Original Unicode and
  whitespace survived; replay, stale review, wrong scope/patient/cursor,
  immutability, rollback retention and atomic review rollback passed.
- Delayed transaction regression: an older transaction writing last correctly
  becomes the latest review by locked revision, not transaction-start time.
- Existing financial, appointment, history, media and patient-file repository
  probes passed, including their concurrency/isolation checks.
- **23 real API/PostgreSQL browser cases passed**: 12 import/front-desk cases
  (including 5,000-patient pause/resume/replay), then 11 daily-workflow cases.
  The new mobile case covers explicit v2 upload, exclusion of national ID,
  no-phone patient, preserved historical text, safe script-like text, clinician
  review, exact idempotent retry, changed-body rejection, wrong-patient rejection,
  receptionist-read denial, owner-only review denial and no horizontal overflow.
- Read-only dependency audit passed the repository's gate: raw advisory counts
  are 0 critical, 4 high and 13 moderate. The high chain is the previously
  reviewed exact node-forge upstream backport, verified locally; this is not a
  claim that npm reports zero high findings. No dependency versions changed.
- Browser Use was attempted, but the IAB backend was unavailable. Repeatable
  Playwright supplied the browser evidence; no IAB validation is claimed.

Independent bounded review found two issues and both were corrected: preserve
explicit international phone syntax instead of using the legacy comparison key
as the contact value; order source records and reviews with monotonic positions
and revisions rather than transaction-start timestamps. The reviewer rechecked
both fixes. Earlier failing runs are retained: stale route-count assertions,
browser bundling through a server-only barrel, and synthetic phone overlap
between independent fixtures were corrected; they are not passing evidence.

## Remaining boundaries

No real export, live patient/payment data, production provider, or cloud deployment
was used. All test data, builds, logs and caches were on Spectra. Owned native
PostgreSQL/Redis/API/web processes were stopped; Docker and Desktop were untouched.
The actual clinic's export encoding/date/phone policy and representative source
coverage still require clinic validation before real migration. This profile
is not a transfer of Ray's full clinical file, bills, attachments or appointments.
Appointments and clinical files retain their separate reviewed workflows.

Document generation follows after the exact-head PR gates and merge. Staff
rehearsal remains deferred by the owner.
