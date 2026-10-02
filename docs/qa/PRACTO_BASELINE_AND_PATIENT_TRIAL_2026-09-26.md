# Practo baseline and ClinicOS patient trial

Date: 2026-09-26. Pilot: Healthy Roots, Sector 50, Gurgaon.
Checkout: `/Volumes/Spectra/Projects/ClinicOS`, branch
`codex/import-operator-recovery`, starting commit `f6744e6f`.

## Decision

The next useful milestone is a supervised, synthetic patient import and lookup
trial alongside Ray. ClinicOS is **not yet a complete replacement for Ray**.
Backend modules and passing source tests do not establish a usable clinic service.
Automated arrival/engagement/check-out detection is deferred at the owner's request.
The existing manual queue contracts were not removed or changed.

The active programme remains `docs/orchestration/MVP_EXECUTION_PLAN.md`.
The long-term scope remains the individual files in `clinic_os_specs_v2/`, in
particular `01_PRD.md`, `02_SYSTEM_ARCHITECTURE.md` and
`15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md`. The field note calls for coexistence
before progressive replacement. This work does not close MVP1/MVP2 or the
production-release gates.

## What was inspected in Ray

The owner-authorized Chrome session was used for read-only navigation. Individual
patient records, report rows, clinic export contents and credentials were not
opened. No settings were saved, messages sent, services activated or new exports
requested. The existing tab was left on Import / Export settings.

Observed navigation/settings included Calendar, Patients, Communications, Ray AI
agent, Reports, Integrations, Inventory, Expenses and Activities; practice/staff,
calendar, treatments, taxes/payment modes, contacts, EMR, drugs, medical history,
printing, storage, patient numbering and import/export settings. Marketplace
links included Profiles, Prime, Feedback, Reach, Consult and Healthfeed.
Visibility proves discoverability, not activation or successful use.

Specific observations that affect cutover:

- Appointment confirmation, cancellation, appointment reminder and six-month
  follow-up SMS were checked/enabled. Payment SMS was not checked. Actual delivery
  was not tested. Removing Ray without a clinic-approved replacement would remove
  an enabled service; changing to WhatsApp would be a separate product decision.
- EMR configuration offers complaints, observations, diagnoses, investigations,
  notes, file labels and vital signs.
- EMR print settings offer prescription, treatment plan, case sheet, medical leave
  and vital-sign outputs. No print was requested.
- Billing settings expose tax catalog, accepted payment modes and cancelled
  invoice/payment configuration. Report categories include daily summary, income,
  payments, appointments, patients, amount due, expenses, inventory, EMR and retail.
- Consent Forms points to Practo Tab activation/support. It is an advertised
  capability, not evidence that this clinic currently uses digital consent.
- The two exported CSV schemas cover demographics and appointment observations.
  They do not establish migration of clinical notes, prescriptions, dental charts,
  images, invoices, balances, payments, reminders, inventory or staff accounts.

This is a workflow inventory, not an exhaustive acceptance test of every Ray
screen. Patient-specific clinical and financial actions were deliberately not
exercised in a real clinic account.

## Current functional comparison

| Workflow | ClinicOS evidence and present gap | Before replacing the clinic's current workflow |
| --- | --- | --- |
| Patient migration/search | Canonical import/review/commit/replay/guarded rollback, saved runs, search and profile handoff exist. This change adds a bounded Ray demographics preparation path. | Verify a representative deidentified source file, phone/ID/DOB/gender semantics and counts. Whole-export chunking and recovery remain unbuilt. |
| Calendar and appointments | Durable scheduling/status/queue contracts and a joined Today view exist. The current CP13 UI is a day list; New appointment does not open a complete booking editor. | Booking/rescheduling/cancellation UI, schedule configuration, conflict checks and staff acceptance. Raw Ray booking import still lacks verified ID, duration/end and visit-type mapping. |
| Clinical records/dental | Encounter, dental, plans and prescribing backend paths have historical synthetic smoke evidence. Current CP13 screens emphasize reading records and media. | Usable authoring/sign-off, consent, history retrieval and clinic-approved print/share outputs. Historical source data must be retained through an agreed supported route. |
| Billing/payments | Invoice/manual-payment/receipt contracts exist. Current UI reads billing data and requests payment links; a request is not a confirmed payment. | Complete invoice, manual payment, receipt, correction and dues workflows; tax/payment configuration and reconciliation. No real payment tests in this pass. |
| Communications/recall | Provider/workflow contracts and read views exist. Live delivery and operator actions are not established by this inventory. | Preserve the clinic's existing confirmation, cancellation, reminder and follow-up service. Official provider setup, consent/template policy, delivery/retry/handoff testing. Email remains deferred. |
| Images/files | Upload/access UI exists, with activation-dependent storage/scanner assurance still open. | Authorized historical file migration/coexistence, safe storage/access and restoration evidence. CSV does not carry these files. |
| Reports, inventory, expenses | Owner metrics and inventory APIs exist; current operations UI is largely read-only. No complete expense workflow was found. | Identify the clinic's required reports and implement usable stock/expense workflows with reconciliation where required. |
| Staff/settings | Roles, clinic isolation and previous synthetic staff-sign-in acceptance exist. Staff administration is not a working current UI workflow. | Clinic onboarding, eligible doctors, user/role setup, working hours/types/pricebook and identity acceptance in the chosen environment. Importing a doctor must not create staff access. |

Code anchors for this assessment: `apps/web/features/cp13/Cp13Workspace.tsx`,
the `front-office`, `clinical-dental`, `treatment-billing` and
`continuity-operations` feature folders, `apps/web/components/clinic-shell.tsx`,
`apps/web/lib/navigation.ts`, the generated API route inventory, and
`docs/qa/checkpoint-13-evidence.md`. Historical backend evidence is not a fresh
clinic sign-off. Ray's patient marketplace/marketing network is outside the
ClinicOS PRD's v1 goal; preserving referrals may require coexistence, not copying
every menu into ClinicOS.

## Implemented patient trial

In Import clinic data, start a named run and choose **Practo Ray patients.csv —
demographics trial**. Select/paste a synthetic file with the owner's 21 reported
headers. Preparation runs on the operator's device, before any staging request.

- At most 100 patient records and 256,000 UTF-8 bytes. Excess files are rejected
  whole, not truncated. This does not solve whole-clinic migration or imply that
  operators should manually split a real export without a completeness plan.
- Only Patient Number, Patient Name, Mobile Number, Email Address, Date of Birth
  and Gender are mapped. Fixed `source_type=imported` and
  `source_format=practo_ray_patients_v1` are provenance, not acquisition-channel
  claims. The source filename sent to staging is fixed, not the local filename.
- The UI lists excluded columns that contained values, without copying those
  values into the upload. The operator acknowledges the limited scope before
  validation. Notes, medical history, national IDs, addresses and alternate
  contacts are not silently retained in raw staging.
- Exact headers, widths, quoting, encoding, blank records and bounds are checked.
  Patient identifiers retain leading zeros and literal apostrophes; missing,
  padded or multiline identifiers fail rather than being rewritten. Blank DOB
  is allowed; a supplied DOB must be a real YYYY-MM-DD date. Other representations
  need a verified extension. Recognized gender labels are normalized; unknown
  values block preparation instead of being discarded.
- No fallback phone, Age-derived birthday, staff account, duration, attendance,
  appointment identity or source-system connection is invented. Canonical server
  validation and duplicate/identity review remain authoritative.
- Validation stages a review; only explicit commit creates records. Saved progress
  is recoverable. A fixed allowlisted format label is returned through the existing
  row read contract, so the patient-only scope survives reload. Raw payload values
  remain private. This label is display provenance, not an authorization signal.
- Practitioner/appointment progression is not offered for a saved Practo patient
  trial. Canonical CSV runs retain their existing three-step workflow.

## Verification

All input is synthetic. The focused regression suites passed: 175 web tests
(including 33 preparation/scope/rehearsal cases), 102 domain tests, 122 database
unit tests, 18 migration API tests with loopback enabled, and 18 offline profiler
tests. These are 435 tests; this is not a claim that the entire monorepo suite was
rerun. Web typecheck/lint, shared/API builds, generated-contract drift (139 routes),
workspace/clock checks, targeted formatting and Git whitespace checks passed.

Real-stack acceptance covers five browser scenarios: canonical patient commit and
rollback; named-doctor mapping and a canonical appointment in Today; patient
search/profile handoff; mobile controls; and the new Practo patient trial. The
Practo case proves 101-row rejection with no staging request, upload/acknowledgement
reset, payload minimization, commit, reload, persisted scope, exact replay without
another batch/patient, search and guarded rollback. It checks 390-pixel width and
records desktop/mobile screenshots. Browser responses are not intercepted.

A separate read-only query under the seeded tenant/clinic scope verifies actual
Postgres raw staging contains exactly the six patient fields plus two fixed
provenance fields and none of the synthetic excluded values. Raw staging remains
absent from the public API response. All 27 existing migrations apply and validate
in a fresh synthetic database; seed verification passes.

The native test harness creates fresh localhost Postgres/Redis using installed
dependencies, applies existing migrations and seed data, builds web output and
uses the real API/database without business-response interception. Data, temporary
files and logs are under
`.audit-spectra-retirement-20260920/practo-patient-trial/` on Spectra.
Its synthetic bearer identity does not prove real staff OIDC or deployment readiness.

Final passing native run: `practo-patient-trial/native-j1w1a9r1/` under that audit
directory. `checks.json` records every step at exit 0; `cleanup.json` records owned
Postgres/Redis exiting successfully; the browser run's `result.json` confirms
API/web cleanup. The complete trial passed on the uncommitted working tree.

During review, two implementation defects were corrected: blank physical records
could be skipped, and the initial scope marker lookup incorrectly expected raw
payloads in the public read response. Tests also needed a disambiguated alert
selector and the mandatory rollback idempotency header; the staging probe initially
used the wrong table schema. Failed evidence is retained and is not counted as a
pass. Screenshot review corrected introductory copy and stale post-replay wording.

Not run: real clinic files/import, live Ray writes, provider delivery/payment/AI,
full real staff identity acceptance, remote CI/security-image gates, or a full
clinical/billing clinic trial. No dependency install was needed. Docker was only
inspected; the old stopped ClinicOS Postgres has a read-only Desktop init-script
bind and named Postgres storage. It was not used or restarted. The approved native
test harness owns fresh data on Spectra and stops its own processes afterward.

## Trial and minimum remaining steps

1. Rehearse the now-verified synthetic workflow. The owner walks through
   upload, review, commit, reload, patient search, duplicate/replay handling and
   honest error states. No clinic export is needed for this rehearsal.
   The ready-made file is `tests/fixtures/practo/patients-synthetic.csv`; follow
   `tests/fixtures/practo/README.md` in a disposable ClinicOS environment. Never
   import that invented file into Ray or a real clinic database.
2. The clinic privately runs the aggregate profiler, or supplies equivalent
   non-identifying findings. Verify patient ID stability and actual optional-field
   formats. Verify appointment timezone against one private source record.
3. Resolve stable booking identity, scheduled duration/end and type/doctor mapping
   through official exports/support, or approve a documented initial migration
   policy. Repeated snapshots must not fabricate identity or silently overwrite.
4. Implement whole-file durable chunking/completeness and booking preparation;
   prove replay, changes, cancellations, failures and recovery across two synthetic
   snapshots. These are the remaining source integration milestone, not AI work.
5. Prove one usable daily loop with clinic staff: find patient, book/reschedule,
   review Today, record the agreed minimal visit and checkout. Implement the missing
   operator forms against existing contracts. Keep Ray authoritative while gaps remain.
6. Before any real data trial, agree which records/fields may be used, where they
   are stored, staff access, retention, rollback limits, backup/restore and expected
   reconciliation counts. Real source inspection or import needs explicit approval.
7. Before cutover, complete the required clinical/billing/files/staff workflows and
   preserve enabled messaging. Obtain staff sign-off using realistic scenarios;
   do not retire Ray based solely on passing tests or a demographics import.

No AI API keys are required for the current trial. Scribing and automated attendance
are later, separately defined slices. No provider was configured or contacted by
test code, and no production deployment, commit, push or merge was performed here.
