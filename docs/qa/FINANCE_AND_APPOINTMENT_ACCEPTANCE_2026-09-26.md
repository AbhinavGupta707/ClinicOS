# Financial operations and reviewed appointment handoff

Status: implemented and accepted in the bounded synthetic local environment.
No live clinic approval or production release claim.

## Scope and source state

Work was performed in `/Volumes/Spectra/Projects/ClinicOS`, branch
`codex/import-operator-recovery`, over `f6744e6ffafd6b1b7d16912f5a0b1510d18a2524`.
The earlier patient-file, front-desk and daily UI changes were already uncommitted.
They were preserved in a local source archive and hash manifest before this slice.
No commit, push, merge, deployment or real clinic import was performed.

Implementation follows
[the detailed plan](../orchestration/FINANCE_AND_APPOINTMENT_REVIEW_PLAN_2026-09-26.md)
and the integration-first MVP programme.

## Financial workflow delivered

Open **Checkout → choose patient → Accounts and reconciliation**.

- Record an advance, allocate part of it to an invoice, reverse an allocation,
  and return unused advance funds. Allocation settles an invoice without counting
  the same money as a new collection.
- Credit a complete original invoice line, including its original tax. Partial
  arbitrary line/tax edits are outside this scope.
- Record partial manual money returns against refundable invoice credit, or
  correct mistaken direct manual payment evidence. The actual return method is
  recorded independently of the original payment method. These are different actions;
  changing a charge is not the same as returning cash.
- Preserve original invoices, payment records and receipts. Print separately
  identified adjustment/advance evidence. An allocation cannot generate a second
  cash receipt; an adjusted unreceipted payment cannot generate a misleading
  original receipt.
- View paginated account history, advances, current dues and clinic-day financial
  movements. Reports distinguish original invoices, credit adjustments, payments,
  allocations, returns and expenses; they do not claim profit or bank settlement.
- Record basic manual expenses and evidenced reversals. This is not a general
  ledger, statutory tax filing, payroll or an accounting-system connector.

Every mutation requires a reason, reference and permission. Corrections, returns
and expenses require the owner or accountant role. Existing billing staff may
receive and allocate advances. Database locks, invoice review versions, business
reference uniqueness and API idempotency prevent duplicate or stale writes.
Evidence, audit and outbox writes share one transaction. Records are clinic scoped
and append-only.

Provider-managed payments cannot be manually rewritten through these controls.
The existing Razorpay settlement path now distinguishes a refund of unallocated
excess capture from a refund of money applied to an invoice. Migration 0030 repairs
historical refund projections; it preserves original payment and receipt records.
No provider money transfer was initiated in this task.

## Appointment workflow delivered

Open **Import clinic data → Review Practo appointment evidence**.

1. Select the reported eight-column `appointments.csv` and a consistent source
   name. The local parser bounds the file to 25 MiB and 5,000 observations.
2. Review the disclosure. Only patient number/name, doctor name, source date and
   status are transferred. Notes and attendance timestamps are excluded.
3. Save the complete file. Manifest hashes and bounded 100-row groups support
   exact retries; incomplete or changed evidence cannot be reviewed as complete.
4. Review each observation: retain history, exclude with reason, link an existing
   booking, or create an upcoming booking after explicitly selecting the patient,
   eligible doctor, visit type and verified planned start/end in the clinic timezone.
5. A created booking uses the real schedule and its conflict checks. Its permanent
   source decision and booking commit together. Repeating a decided row cannot
   create another booking. Creating a reviewed booking does not request a patient
   confirmation message.

This is an approved manual handoff. It does not infer stable vendor appointment
IDs, duration, source timezone or attendance from the export. Historical and
cancelled observations remain evidence unless an operator explicitly links an
existing booking. Missing rows never cancel appointments. Different snapshots
require fresh review. There is no recurring Ray sync, source-system writeback,
automated check-in, or import of source clinical notes.

The existing-booking picker searches up to 100 appointments on a selected clinic
day. It does not claim unlimited schedule discovery. Review decisions preserve
provenance; correcting an actual booking uses the normal scheduling workflow.

## Verification

Evidence root, on Spectra only:
`.audit-spectra-retirement-20260920/finance-and-appointments-20260926/`.

- Full workspace test suite: **1,184 passed** (908 Node tests and 276 Vitest tests),
  zero failed or skipped.
- Workspace check, lint, typecheck, generated-contract drift and release-scope
  secret scan: passed.
- Fresh migration and validation through 0031, runtime grants, synthetic seed,
  database verification and API build: passed.
- Real PostgreSQL probes: advance limits and reversal, stale invoice reviews,
  duplicate references, wrong-patient targets, forced RLS, immutable evidence,
  Asia/Kolkata day boundary, financial history/advance pagination beyond 100,
  excess/full provider refund projections, historical refund backfill, and
  101-row source completeness/replay/permanent review: passed. Probe transactions
  rolled back their own fixtures.
- Eight daily-workflow browser scenarios: passed against the real API and
  PostgreSQL, without intercepting business responses. These include the new
  financial and appointment workflows plus the existing daily workflows.
- Import/front-desk regression: **12 browser scenarios passed**, including the
  5,000-patient file, full replay without duplicate patients, and mobile controls.
  The eight daily scenarios also passed on that same database. A newly added
  independent audit SQL assertion then failed due to a text/UUID comparison in
  the verifier; the cast was corrected and the complete daily harness, repository
  probes and independent SQL passed again on a fresh database. There are **20
  distinct browser scenarios**, not 28; reruns are not counted as extra coverage.
- Final production web output and the full offline workspace build passed.

Independent SQL in the eight-scenario run verified: original invoice 100,000
paise; credited 100,000; net recorded payments after reversal 50,000; returned
10,000; due zero; nine patient financial entries, nine matching audit records and
nine outbox events; three saved appointment decisions; zero imported confirmation
requests. The original 40,000-paise receipt remained unchanged. Expenses have their
own non-patient evidence. The source manifest's creation audit references its
actual saved manifest ID.

Reproducible local evidence within the root above:

| Evidence | File/directory |
| --- | --- |
| Final workspace tests | `all-tests-verified.log` |
| Final check, lint, typecheck, build, contract drift, secret scan | `final-checks.json` and `*-verified.log` |
| Twelve import/front-desk cases, 5,000-patient replay and SQL | `native-j7zaltut/browser/run-BkIXrP/` |
| Final fresh migrations, repository probes and cleanup | `native-a9bwelyr/checks.json`, `financial-appointment-repositories.log`, `cleanup.json` |
| Final eight daily browser cases and independent SQL | `native-a9bwelyr/browser/run-77TMGz/` |
| Final source identity and difference from the preserved starting tree | `final-source-manifest.json`, `slice-change-inventory.json` |

The working tree remains uncommitted. These results apply to the saved source
hashes, not a published PR head. The inventory distinguishes this slice from
pre-existing work and excludes unrelated research and the current-vision document.

During review/testing, defects in provider excess refunds, historical projections,
query-offset parsing, appointment discovery, upload completion, nested search
forms and mobile control sizing were corrected. Route inventory and ambiguous
browser selectors were reconciled with the actual new surfaces. Earlier failed
runs remain in the evidence folder; they are not presented as passing evidence.

Independent read-only reviews found no remaining concrete issue in the reviewed
financial fixes. This is bounded review, not a claim that every possible defect
has been ruled out.

## Limits and next milestone

All tests used disposable synthetic data and synthetic identity. Existing Docker
services, real databases, Desktop and live providers were untouched. Native test
Postgres/Redis processes were owned by the harness and stopped in cleanup.
The in-app browser backend was unavailable; repeatable Playwright and saved mobile
screenshots were used. Real OIDC/clinic identity, provider money movement, cloud
operations, live CI and staff acceptance were not rerun or established here.

The next milestone is a supervised staff rehearsal: verify a patient's advance,
staged treatment, partial payment, credit/refund correction and day reconciliation;
then review a small authorized appointment sample with verified timezone, patient
identity, clinician mapping and planned times. Synthetic acceptance is sufficient
to rehearse this scope, not to retire Practo or declare full product parity.
