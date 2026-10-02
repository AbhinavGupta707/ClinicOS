# Returning-patient chart and history review

Status: implemented and verified locally on 2026-10-02. Synthetic scope; no clinic cutover approval.

Acceptance: `../qa/RETURNING_PATIENT_CHART_ACCEPTANCE_2026-10-02.md`.

## History and decision

The programme progressed from Spectra relocation and PR repair, through durable
identity, source-independent ingestion, operator recovery, a bounded 5,000-patient
Practo demographics workflow, daily clinic forms, financial operations and reviewed
appointment evidence. The prior 142-file evidence manifest still matches the
working tree at the start of this task. Older documents describing missing login
or read-only daily forms are historical, not the current implementation.

The authoritative direction is the integration-first MVP, with the replacement-grade
dental clinic loop in specifications 01, 02, 08 and the pilot field note 15. The
doctor must be able to review prior visits, records and dental changes before the
next consultation. Current profile/prep screens stop at 50 event titles and a
snapshot count, although source records already exist. Timeline reads fetch all
rows before slicing. This is a concrete P0 continuity gap that can be completed
without activating providers or reading clinic data.

Selected task: a complete, bounded **returning-patient history review** using the
existing records. Preserve clinical authoring, financial controls and import work.
Separate follow-up needs remain: a reproducible human OIDC rehearsal lifecycle,
chosen-image identity acceptance, authorized source samples, provider activation,
staff validation and real deployment/restore evidence. More feature code cannot
substitute for those gates.

## Implementation contract

1. Extend the existing timeline route with real database pagination, stable
   timestamp/ID ordering, category filters and an explicit continuation cursor.
   Apply actor permissions before pagination; foreign-patient/clinic or invalid
   cursors fail closed. Keep old array response aliases for current consumers.
2. Bound preparation reads. Show observed source coverage and missing history
   honestly. A demographics import or an empty list must not become a negative
   clinical finding or a claim that Ray's old record was migrated.
3. Replace the current profile/prep summary with a readable history workspace:
   patient/context, latest intake and consent, category selection, older events,
   explicit refresh/load/error states and separately authorized source details.
   No raw metadata dump, arbitrary URL navigation or automatic clinical action.
4. Expose existing dental finding history and immutable chart snapshots for
   deliberate review/comparison. Label additions, changes and no-longer-present
   findings as recorded differences, not diagnoses or inferred treatment.
5. Keep patient/clinic/user state isolated. Ignore stale requests, clear old
   details on scope changes, preserve loading/failure distinctions, render dates
   in the clinic timezone, and support narrow screens and keyboard controls.

## Verification and evidence

- Unit/domain tests: classification/permission policy, comparison semantics,
  malformed cursors and display/source targeting.
- API/real PostgreSQL: more than one page, equal timestamps, category filtering,
  foreign cursors, role isolation, immutable history, audited read paths and
  rejected cross-patient source access.
- Real browser/API/database: returning patient with multiple visits and older
  records, source note and dental history review, pagination/filters, failed-read
  recovery, role denial and mobile controls. Use synthetic data only.
- Relevant regression, contracts, typecheck, lint and builds. Preserve all prior
  uncommitted work, bind final evidence to source hashes, stop owned processes.

All data/logs/builds use Spectra and installed dependencies. Desktop, existing
Docker services, production and private clinic exports remain untouched. No
automatic commit, merge, push, cloud activation or provider call is in this scope.
