# Migration context and document delivery

Owner-authorized sequence, 2026-10-02. This is the execution source of truth for
the two slices below, subordinate to `MVP_EXECUTION_PLAN.md`, the individual
canonical specifications (01, 02, 03, 08 and 15), and repository instructions.
Staff rehearsal is deferred at the owner's request. Synthetic acceptance is not
permission to use real patient data or a production-release decision.

## Baseline and sequence

1. PR #8 was rechecked at `76d6d439a6e0fa56ea07442c29f1bf12ad36f947`:
   all 21 checks succeeded, no open PR CodeQL alerts, no diff-whitespace errors.
   It merged into `mac-latest-20260829` as
   `af0530266c2382c8932b9e3473b3b6e1cedfc9d1`; the merge tree is unchanged.
2. Implement migration completeness and historical patient context on
   `codex/migration-history-context`. Review and verify the complete vertical
   slice, publish its scoped PR, resolve CI findings and merge the exact tested
   head into the Mac development baseline.
3. Implement document generation on a separate branch from that verified base.
   Repeat review, local acceptance and exact-head CI before merge.

CI overlap: document implementation may be prepared from the reviewed, locally
verified PR #9 head while its remote checks run. PR #9 remains frozen; merge A
first, reconcile B with that merge tree, and never promote B on failed A evidence.

The parent owns schema, clinical/financial meaning, permissions, generated
contracts, integration, review and merges. Bounded agents may map or review
read-only. One shared-checkout source writer. Preserve the unrelated vision
document and research directories. Do not promote to `main` by assumption.

## Slice A — migration completeness and historical context

Outcome: an operator knows what was transferred, can import a patient with no
phone without inventing contact details, and an authorized clinician can review
explicitly historical source context without confusing it with current signed
clinical truth.

Extend the existing bounded file/chunk/import-run contracts and canonical patient
identity links. Preserve saved v1 demographics imports. Introduce a versioned,
explicitly selected profile for additional authorized source fields; do not
silently widen the old profile. Keep the 5,000-patient/25-MiB file limits and
bounded requests. Validate source fields before submission; never guess dates,
patient identity, guardian relationships, clinical meaning or consent.

Required behavior:

- Field coverage identifies mapped demographics, retained unverified source
  context/alternate contacts and excluded fields. National IDs and unsupported
  fields remain excluded; a complete run is not a claim of complete Ray parity.
- Missing primary phone is allowed by the new policy with explicit provenance;
  invalid supplied numbers still require correction/review. Shared contacts do
  not merge patients and imported contacts do not enable messaging.
- Historical medical history, notes and other explicitly supported context are
  source evidence with patient/source/import identity and immutable versions.
  Preserve original bounded text; unknown dates stay unknown. Do not manufacture
  diagnoses, allergies, signed notes or patient consent.
- Changed source evidence remains reviewable and does not silently overwrite
  current patient or clinical data. Exact replay does not duplicate evidence.
  Identity resolution and historical-context attachment commit atomically with
  audit/outbox. Historical context is append-only clinical evidence: generic import
  rollback cannot delete or unlink a context-bearing import, even before review.
  The operator must see and approve this retention boundary before commit.
- Authorized patient-history reads are bounded, tenant/clinic/patient isolated
  and audited. Clinical review targets the exact immutable source version;
  reviewed old evidence cannot label a changed version reviewed. Raw clinical
  source text must not leak through ordinary migration summaries or logs.
- UI resets patient/identity scope, rejects stale results, supports retry without
  duplicate writes, and distinguishes unavailable/loading/empty/reviewed states.

Acceptance: v1 regression; v2 golden/malformed/size/encoding cases; absent/invalid
contacts; family contacts and duplicate IDs across chunks; exact replay and
changed evidence; RLS and permission negatives; atomic failure and stale review;
guarded rollback; 5,000 mixed synthetic patients with independent reconciliation;
real API/Postgres browser coverage at desktop/mobile; full workspace/build,
generated-route and security gates. No real export is needed for engineering
acceptance. Clinic field policy and representative source validation remain
external requirements before real import.

## Slice B — patient and clinic document generation

Outcome: staff can generate, review, print and download consistent documents from
the exact saved authorized records, including prescriptions, treatment estimates,
invoices, receipts, patient instructions and lab slips.

Build one typed document composition/rendering boundary rather than six unrelated
print implementations. Preserve signed clinical and immutable financial source
records. Freeze source identity/version and displayed issuance context so later
profile/configuration edits do not silently rewrite a previously issued output.
Document status must distinguish draft estimates from signed/issued records.
Never equate a generated file with delivery, patient acceptance, a digital
signature or a provider-cleared clinical upload.

Required behavior: clinic identity and applicable clinician details; clear dates,
document numbers, source versions and correction relationships; faithful line
items/amounts/instructions; safe untrusted text; Unicode/long-content pagination;
role/patient boundaries; audit and retry/idempotency; explicit unavailable states;
preview/print/download and exact reprint. Keep email, WhatsApp sending, cloud
activation and signature-artwork inference outside this slice. Select the
renderer after inspecting installed dependencies and the existing media/output
contracts; record any necessary dependency choice and verification here.

Acceptance: source-specific authority/status tests, stale-source and retry tests,
exact money totals, cross-patient/RLS negatives, snapshot/reprint persistence,
Unicode/multipage output inspection, real API/Postgres browser flows, mobile
controls and existing daily/import regression; complete local and remote gates.

## Execution and evidence

Only synthetic fixtures and owner-approved isolated native localhost test
services. All databases, caches, builds and logs on Spectra. Stop owned test
processes after use. Desktop and existing Docker/databases remain untouched.
No deployment, live provider operation or real patient/payment data.

For each slice retain commands, final source SHA, passing/failing checks and
limitations in a dated QA report and clearly named Spectra audit folder. Do not
count fixtures as provider proof or prior-head runs as final-head acceptance.

Progress:

- [x] PR #8 reviewed and merged; verified baseline branch created.
- [x] Slice A domain/schema/contracts and source policy.
- [x] Slice A operator/patient UI and synthetic acceptance.
- [x] Slice A independent review, final CI and merge. PR #9 head
  `a5fbf156db1ff9b7333493609c6e9dd8944abdae`: all 21 checks passed and no open
  PR CodeQL alerts. Merge `429609125e7b0e561143e31b15144d06a5f62ad6` has the same tree.
- [x] Slice B document architecture and renderer decision: see
  `PATIENT_DOCUMENT_ARCHITECTURE_2026-10-02.md` (printable HTML, native Print/Save
  as PDF, no server browser or archived PDF-byte claim).
- [x] Slice B implementation and synthetic/output acceptance. See
  `docs/qa/PATIENT_DOCUMENT_ACCEPTANCE_2026-10-02.md` and the architecture decision.
- [x] Slice B independent bounded backend/authority and UI/recovery reviews;
  findings corrected and exercised by native acceptance.
- [ ] Slice B exact-head remote CI and merge; the PR status is the final source
  of truth for promotion to `mac-latest-20260829`.
