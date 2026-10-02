# Patient document generation acceptance — 2026-10-02

Scope: the second owner-authorized slice in
`docs/orchestration/MIGRATION_CONTEXT_AND_DOCUMENT_DELIVERY_PLAN_2026-10-02.md`.
PR #8 merged as `af0530266c2382c8932b9e3473b3b6e1cedfc9d1`; migration/context
PR #9 merged as `429609125e7b0e561143e31b15144d06a5f62ad6`. Both had 21 successful
checks and no open PR CodeQL alerts. The document branch starts from PR #9's
reviewed head; its tree equals the merged Mac baseline.

## Implemented behavior

- Six saved-source document kinds: signed prescription, treatment estimate,
  invoice, receipt, saved print instruction and lab slip. Preview, explicit
  reviewed issuance, immutable saved-copy history, printable HTML download and
  native Print / Save as PDF. No server PDF/archive or delivery claim.
- Versioned scriptless renderer with pinned golden HTML hash, bounded content,
  escaped text, exact integer INR amounts, Unicode wrapping, repeated table
  headers, A4 page numbers and compact provenance.
- Migration 0035 stores structured snapshots/metadata and exact HTML hashes.
  Patient/clinic/source display identity is frozen. Changed current sources do
  not rewrite originals. New sources get revisions; exact current-source replay
  reuses a saved copy. Update/delete are prohibited and FORCE RLS applies.
- Three typed API operations (180 total native routes), four repository methods
  (189 total). Source-specific authority precedes data access. The narrow
  document route permission does not grant reception/accounting full PHI access.
  Detailed estimates retain clinical/dental authority. Financial/instruction
  output omits birthdate; lab slips omit internal notes and agreed lab costs.
- Source locks, expected-preview digest and per-source issuance serialization
  prevent stale or duplicate copies. Issuance, audit, outbox and idempotency share
  the existing transaction. Audit/event payloads contain metadata, not content.
- UI retains exact retry requests, invalidates copies after parent source changes,
  checks downloaded HTML integrity, requires acknowledgement of changed originals,
  and disables routine export of cancelled/void/unsupported current sources while
  allowing historical inspection.

## Local evidence

All evidence under the Spectra-only ignored directory
`.audit-spectra-retirement-20260920/document-generation-20261002/`.
Existing dependencies only; no npm install/ci, Docker changes, provider operation,
deployment or live patient/payment data. Owned native test services are stopped
in each run's `finally` cleanup; cleanup records retained.

- `final-gates.json`: workspace checks, typecheck, lint, workspace tests, builds,
  generated contracts, inventory and secret scan passed. 1,220 workspace test
  cases: 1,203 passed initially, 17 HTTP cases skipped because the sandbox could
  not bind sockets. All 232 API tests were then rerun with socket access and
  passed with zero skips; together these runs cover all 1,220 workspace cases.
- `native-k80hh_kx`: 35 migrations/validation, financial/appointment, patient
  history/media and source-context probes passed. Source-context reconciliation:
  5,000 patients, 1,667 missing primary contacts, 5,002 immutable versions and
  replay/isolation/atomicity checks passed. Twelve import/front-desk browser cases
  and twelve daily/document browser cases passed. This run precedes the final
  print-layout compaction. Its separate document verifier failed on a test-only
  UUID/text SQL parameter cast; it is not counted as a wholly passing run.
- `native-mqr1gdhv`: all 35 migration/validation and repository checks passed;
  232 API tests passed without skips, all 12 daily/document browser cases passed,
  and the durable document verifier passed: eight copies/six kinds, 24-revision
  history pagination, exact reprints, stale-source rejection, immutable records,
  scope isolation, retries and forced late audit/outbox rollback (including the
  idempotency claim). A final print-only spacing correction follows this run.
- `native-ccz52uag`: final production renderer; every check passed, including
  232 API tests (zero skips), all 12 daily/document browser cases, all durable
  source-context/history/media/financial probes and the document verifier. Both
  owned PostgreSQL/Redis processes exited successfully. The full web build and
  real API contract were exercised, not an in-memory product simulation.
- `pdf-review-final/pagination.json`: all six ordinary examples fit one A4 page;
  long Hindi/English instructions span three and the 90-row table four. All 13
  final pages visually inspected with Poppler: readable Unicode, complete final
  content, repeated table headers, no clipping or orphaned footer. The renderer's
  fixed golden hash protects exact archived HTML. Mobile preview has no horizontal
  overflow; final control/download probe is recorded separately below.
- `native-pcjk14vx`: focused final daily/document run passed all 12 browser
  cases and the durable document verifier. At 390px, an archived copy opened and
  its download control scrolled into view and completed an actual HTML download;
  viewport screenshot confirms controls remain above bottom navigation. Owned
  services stopped successfully.
- Codex in-app browser discovery was unavailable; repeatable Playwright supplied
  browser evidence. No in-app-browser or physical-printer verification is claimed.
- Dependency gate passed: raw advisories 0 critical, 4 high, 13 moderate. The four
  high entries trace to the existing node-forge advisory with its exact upstream
  PR #1152 backport verified. No new dependencies; do not describe this as zero
  raw high advisories.

## Review and corrections

Independent bounded read-only reviews covered source identity/locking,
permissions, immutable history, transaction wiring and UI recovery. Review found
and corrected cached document eligibility after parent mutations. Real reception
acceptance found overly broad PHI gating; permissions now follow each source's
existing boundary, retaining clinical protection for detailed estimates. A
scriptless-frame print observer was moved to the parent realm; actual browser
`beforeprint` is observed without enabling document scripts. Schema version
expectations and the document-verifier SQL cast were corrected. The original
verbose print layout was compacted after visual inspection.

## Limits and next external validation

This is synthetic engineering acceptance, not clinic authorization or production
release approval. Verify the clinic's actual stationery/legal/tax details,
clinician registration details and prescription requirements, physical printer
output, and staff interpretation before patient-facing use. The existing model
has no clinician registration field; no registration/signature artwork is
invented. Generated copies identify signed staff records and clearly disclose
this limitation. Authentication evidence uses isolated synthetic identities,
not a new live OIDC/provider trial. No messaging, automated handover or bank
settlement is established. An exported file cannot be revoked or refreshed offline.

Remote CI and merge are the final gate. The PR must target mac-latest-20260829,
pass all checks and have no open PR CodeQL alerts before the exact reviewed head
is merged. The live PR status/merge commit is authoritative for that promotion;
local acceptance alone does not grant merge or production-release readiness.
