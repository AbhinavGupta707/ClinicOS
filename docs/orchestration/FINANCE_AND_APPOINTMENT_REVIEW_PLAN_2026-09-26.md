# Financial operations and reviewed source appointments

Status: implemented and synthetically verified; no live clinic approval.

Owner authorization: complete financial operations and one additional high-value
slice. Selected second slice: reviewed Practo appointment observations. Both
extend the integration-first MVP and the existing modular monolith.

## Baseline and boundaries

Spectra checkout, `codex/import-operator-recovery`, base `f6744e6f`. Prior import
and daily UI work is uncommitted and must survive. A source archive, patch and
SHA-256 manifest are saved in the ignored Spectra-only
`.audit-spectra-retirement-20260920/finance-and-appointments-20260926/` folder.
This local preservation is not an independent disaster recovery backup.

Use existing dependencies and the already authorized disposable synthetic
Postgres/Redis harness. Desktop, existing Docker services, real clinic exports,
providers and production remain untouched. No push, merge or deployment.

## A. Financial operations

Customer outcome: explain every patient balance and daily money movement after
deposits, staged treatment, partial payments, corrections and refunds.

1. Preserve issued invoice and payment evidence. Add append-only adjustment and
   advance records; corrections reference their original evidence and require a
   reason, a unique reference and an authorized actor.
2. Keep charge reduction distinct from money returned. A credit reduces a charge;
   a refund records money returned; a payment reversal corrects erroneous payment
   evidence. Never delete payments or rewrite original receipts as if nothing
   happened. Refunding an invoice requires refundable credit, not an invented
   reduction in treatment charges.
3. Record manual advance receipts, allocate available funds to eligible invoices,
   reverse allocations and return unallocated funds. Allocation is not new cash
   collection. A source advance cannot be spent/refunded twice.
4. Account reads show invoices, original payments, adjustments, available advances,
   outstanding debt and refundable balances. Reads are paginated and scoped.
5. Clinic financial reporting distinguishes gross invoices, credit adjustments,
   collections, refunds, expenses and amounts owed. Clinic-date boundaries use
   the saved IANA timezone. Provide traceable detail, not unsupported profit claims.
6. Record evidenced manual expenses with auditable reversals. This is clinic
   operational accounting, not a general ledger, tax filing or Tally replacement.
7. No live refund/payment API is called by this slice. Existing provider callbacks
   remain authoritative for provider settlement; manual adjustment controls must
   reject provider-managed payments when doing so would invent settlement truth.

Engineering: integrate new typed domain rules, migration/RLS, scoped repository
port, native API contracts, permission registry, generated clients and operator
UI. Retain transaction-bound idempotency, serialized account updates and
optimistic review preconditions. Amounts are integer paise; reject unsafe numbers,
over-allocation, stale review, cross-patient/clinic references and duplicate
business evidence. Audit and outbox changes commit with financial changes.

## B. Reviewed Practo appointment observations

Customer outcome: bring authorized source appointment evidence into a review
workspace and explicitly promote verified bookings into the real schedule.

The reported CSV lacks a stable booking ID, planned duration/end and visit type.
These are unresolved source facts. This feature is an operator-reviewed manual
handoff, not automated recurring sync or a verified vendor appointment adapter.

1. Parse the reported eight-column schema locally, preserving date/status values
   after explicit supported quoting normalization. Exclude free-text Notes and
   attendance values from transfer. Display this minimization before staging.
2. Store bounded, immutable source observations and durable review decisions.
   File/row identity identifies evidence only, never a vendor booking. Exact
   upload retries reuse saved evidence. A different snapshot requires fresh
   review; missing rows never cancel appointments.
3. Offer named patient/doctor/type selection and explicit planned start/end in the
   clinic timezone. Resolve patient source references where verified; no automatic
   family-phone matching or staff creation.
4. Explicit actions: retain as historical evidence, exclude with reason, link an
   existing booking, or create a reviewed upcoming booking. No automatic update,
   cancellation or clinical attendance inference from source status.
5. Make uncertainty and progress visible. Persist the resulting appointment link
   with the review atomically; repeats do not create another booking. Respect
   existing schedule conflict/configuration guards and normal booking permissions.

## Delivery and acceptance

Implement sequentially in the shared checkout: domain and database first; then
contracts/API; then operator UI; then combined real-stack verification. Parent
owns shared/high-risk files. Read-only mapping and independent review may run
in parallel; no competing source writers.

Required verification:

- Financial rule tests for exact arithmetic, credits, partial refunds, reversals,
  advances, allocation recovery and invalid/cross-record references.
- Real Postgres proof of atomic audit/outbox, RLS, duplicate requests/references,
  simultaneous allocation/refund, rollback on failure and independent totals.
- Source parsing tests for quoted dates/statuses, malformed/oversized files,
  excluded fields and timezone handling; source identity remains explicitly weak.
- API and browser scenarios for named selection, permission failures, mobile
  overflow, retries, saved review and schedule visibility. No intercepted business
  responses. Existing import and daily workflow regression remains green.
- Generated contract drift, relevant tests, typecheck, lint and builds; final
  evidence is tied to the actual modified source, not earlier test counts.

Completion does not establish financial policy approval, real source semantics,
live provider operation, staff acceptance or readiness to replace Ray. Document
the implemented envelope and any remaining limits precisely.

## Delivered implementation

- Migration 0030 adds immutable scoped financial evidence, credit/version
  projections and historical provider-refund reconciliation; 0031 adds immutable
  appointment manifests/observations and permanent human review decisions.
- Nine financial actions are exposed through three typed routes and a patient
  account/day-reconciliation UI. Actual refund/advance-return methods are explicit.
  Full original line credits, manual expenses and corrections are bounded here;
  automatic transfers, a general ledger and arbitrary tax edits are deferred.
- Six appointment-review routes support manifest creation/discovery, bounded
  staging, completeness verification and atomic review/booking. A file supports
  up to 5,000 observations; each observation requires a deliberate decision.
- Both slices extend existing permissions, transaction-bound repositories,
  idempotency, audit, outbox and native generated contracts. They do not introduce
  another datastore or provider integration.
- Independent read-only review plus real PostgreSQL/browser acceptance drove
  repairs for refund accounting, pagination, role gates, safe booking creation,
  source audit identity and responsive controls.

See [the acceptance report](../qa/FINANCE_AND_APPOINTMENT_ACCEPTANCE_2026-09-26.md)
for exact evidence and limits. The next gate is supervised staff rehearsal and a
small authorized source sample, not another unbounded feature expansion.
