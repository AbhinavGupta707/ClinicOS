# Whole-clinic migration and daily workflow delivery plan

Date: 2026-09-26. Status: owner authorized implementation and reduced the initial
patient-file test target to 5,000 patients. The broader workflow sequence below
remains a plan; it is not a claim that all features exist.

Current delivery: the supervised 5,000-patient file workflow has synthetic acceptance,
and the owner then authorized the front-desk booking/arrival slice. Closing the
import page pauses new upload/commit groups; reopening recovers durable
receipts and outcomes. Unattended worker processing, contactless patient creation,
and broader historical-field mappings remain separate scoped work. This is a
reduced operational scope with explicit limits, not a background-job completion
claim. See [the 5,000-patient QA report](../qa/PATIENT_FILE_5000_ACCEPTANCE_2026-09-26.md) for actual evidence.

The front-desk follow-up now provides named booking, reschedule/cancel, manual
arrival and reception queue controls on the existing backend. See
[its acceptance report](../qa/FRONT_DESK_WORKFLOW_ACCEPTANCE_2026-09-26.md).
The subsequent [daily-workflow UI pass](../qa/DAILY_WORKFLOW_UI_ACCEPTANCE_2026-09-26.md)
adds clinic setup, existing-staff access, patient editing/shared-contact review,
week planning, consultation, treatment, checkout and native operating forms.
Seventeen real API/PostgreSQL browser scenarios pass, including the import
regression. Real identity provisioning, source-history migration, provider
activation and clinic acceptance remain open; this does not close the entire
cutover plan.

The authoritative programme remains `MVP_EXECUTION_PLAN.md`. This plan details
its ingestion and daily-use milestones, then the minimum workflow changes needed
for a safe clinic cutover. It does not close MVP1/MVP2 or production release gates.
Automated attendance detection, email integration and new AI features remain
deferred. Ordinary software validation and regression tests continue.

## 1. Outcome and current baseline

The customer outcome is: select an authorized practice export once, review a
clear reconciliation, resume if interrupted, approve the migration, and use the
records in an ordinary clinic day. Customers should not split files, supply SQL,
paste internal UUIDs, buy AI API keys, or send patient records to a developer.

Current verified working tree: `/Volumes/Spectra/Projects/ClinicOS`, branch
`codex/import-operator-recovery`, starting commit `f6744e6f`; the patient-trial
and earlier profiling changes remain uncommitted. Do not replace or discard them.
The dated baseline report records 435 focused tests and five synthetic real-stack
browser scenarios. Those tests establish a bounded trial, not clinic-wide capacity
or live staff acceptance. Those are historical baseline results; the linked follow-up report records the implementation and fresh verification.

Source documents:

- `../qa/PRACTO_BASELINE_AND_PATIENT_TRIAL_2026-09-26.md`: observed Ray settings,
  ClinicOS gaps, completed implementation and exact verification limitations.
- `PRACTO_EXPORT_MAPPING_2026-09-26.md`: confirmed headers, unverified source
  semantics, missing appointment identity/duration, and privacy policy.
- `../../clinic_os_specs_v2/01_PRD.md`, `02_SYSTEM_ARCHITECTURE.md`,
  `03_DOMAIN_MODEL_AND_FHIR_MAPPING.md`, `08_USER_STORIES_AND_ACCEPTANCE_CRITERIA.md`
  and `15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md`: canonical product direction.

### Baseline constraints before the whole-file extension

At the start of this work, the safe transaction/request bound had also become a customer file limit. The new file workflow retains bounded processing and removes that customer-facing 100-row limit. Simply changing 100 to a large number would not solve the design.

| Existing constraint | Consequence | Required extension |
| --- | --- | --- |
| `0027_operator_import_runs.sql` permits one batch per run/entity and keeps run metadata immutable | A run cannot represent a whole file split into batches | Immutable file/snapshot metadata plus an indexed chunk ledger under the existing run |
| Adapter/UI limit 256,000 bytes and 100 rows; API has 100 rows, 900k-character CSV contract and 1MB HTTP body | Raising one limit leaves other layers failing, or creates huge requests | Stream preparation and submit bounded chunks; retain server limits per request |
| Run response schema permits at most three batch details | Unlimited chunk details cannot be added compatibly to that response | Summary, file/chunk status and bounded review reads |
| `summarizeImportRun` counts only staged rows and assumes three entity steps | A missing tail of a file can be invisible; patient-only scope is not first-class | Explicit planned entities, sealed file manifest and whole-file accounting |
| Duplicate IDs are detected within one staged batch | Same ID in different uncommitted chunks is not a whole-file review conflict | Snapshot-wide indexed duplicate validation before commit |
| Detail/list paths load rows/conflicts, and commit/rollback return full batch data | Large runs can exhaust memory and produce oversized responses | Aggregate reads, bounded pages and durable job status |

Relevant seams: `apps/api/src/operations.ts` import handlers;
`packages/db/src/postgres.ts` import run, staging, commit and rollback repositories;
`packages/domain/src/migration.ts`; `packages/api-contracts/src/native-http-contracts.ts`;
`apps/web/lib/import-runs.ts`, `cp7-integration-ops.ts`, `practo-patient-import.ts`;
the import workspace/panel and existing migration tests.

The current commit engine already locks external identities and rechecks links.
An exact concurrent replay can reconcile; changed evidence can become a failed
row. Preserve these safeguards. They do not replace whole-file preflight.

## 2. First delivery milestone: one large patient file, one recoverable run

### Customer workflow

1. Select the clinic and its saved source, then choose the original patient CSV.
2. Review the supported fields and exclusions. ClinicOS scans locally and shows
   file size, record count and format problems without requiring upload to chat.
3. Confirm staging. The browser sends only the approved mapped fields in small
   chunks. Progress distinguishes local preparation, received chunks and validation.
4. Review totals and exceptions. Search/filter issues and review matching candidates
   without scrolling through thousands of patient rows. Safe rows can be approved
   together; ambiguous matches need explicit decisions.
5. Confirm the reviewed import plan. Processing commits bounded batches and records each outcome. Closing the browser
   pauses new groups; reopening recovers completed work. Before upload completion,
   reopening requires reselecting the same file to send the remaining chunks.
   Unattended processing is a later extension.
6. See a final reconciliation and find imported patients. Reopening the run shows
   persisted progress. A retry recovers work rather than creating another patient.

### Capacity target

The owner-approved implemented envelope is **5,000 patient records and 25 MiB per CSV**. The QA report distinguishes measured synthetic evidence from pilot approval. Test 1, 100, 101, 1,000 and 5,000 rows; exceed the envelope in negative tests. If the
clinic's real file is larger, increase the tested envelope before that trial.
Never imply unlimited capacity or ask the clinic to silently discard overflow.

The initial manifest uses fixed 100-row groups and a final remainder, each at most 256,000 UTF-8 bytes. Oversized mapped groups are rejected; automatic variable-size splitting is deferred. Tune only with evidence. Parsing must be bounded by bytes, cell
size and columns, not just rows. Reject unsupported formats with a clear reason.
Archive upload is a later convenience; a complete CSV upload must work first.

### Persistent data and contract changes

- Make import profile/version, intended entity scope and selected field policy
  explicit immutable run/file metadata. Patient-only completion should be a real
  supported scope, not a special case inferred from a row or filename.
- Add file/snapshot records and chunk membership to the existing migration model.
  Proposed metadata: file ID, entity type, adapter version, mapping policy version,
  declared row count, chunk ordinal, record range, digest, received/validated count,
  final manifest and lifecycle state. Final names/schema are implementation decisions.
- Use a stable clinic/source identity independently of the editable display name.
  Existing `sourceSystem` strings are external-link namespaces: preserve them during
  migration and never automatically combine differently named historical sources.
- Preserve legacy run and canonical CSV behavior through an explicit compatibility
  path. Add versioned new endpoints rather than returning thousands of details from
  the old three-batch contract. Regenerate clients, inventory and contracts together.
- Keep tenant/clinic foreign keys, forced RLS and permissions on every new table,
  cursor, job, receipt and source reference. New upload IDs must not enable access
  to another clinic's file or status.

### Browser preparation and resumable transfer

- Replace whole-file `.text()`/`.arrayBuffer()` preparation with streaming decoding
  and CSV parsing. The first version streams on the browser main thread and yields between bounded reads; a dedicated worker remains a performance extension. Correctly handle UTF-8 boundaries, BOM, CRLF,
  quoted newlines/commas, escaped quotes and identifiers with leading zeros.
- Freeze the mapping policy for the snapshot. Apply field minimization before
  sending chunks. Do not persist original PHI in browser storage or worker logs.
- The server computes each received chunk's digest. The same chunk ID and digest
  returns the prior receipt; a different digest is a conflict, not an overwrite.
  Chunk ordinal is transport identity, never the patient's external identity.
- Finalization verifies all expected ordinals/ranges, hashes and counts without
  gaps/overlaps before committing is possible. Late chunks cannot mutate a sealed
  snapshot. Invalid headers, incomplete quoting or an incomplete upload never
  produce a misleading ready-to-commit state.
- Resume reconciles server receipts with a reselected file and the same profile.
  An altered mapped file or mapping version requires a new snapshot. Hashes are
  private import metadata, not public telemetry or a substitute for patient IDs.
- Explicitly distinguish completeness of the **selected file** from completeness
  of the **Practo export/clinic database**. Manifest verification proves the former;
  source export scope and expected totals still require clinic/source evidence.

### Whole-file review and identity

- Detect duplicate source patient IDs across the complete snapshot before commit.
  Repeated source IDs reject the entire local file; the server also rejects them across chunks. Different IDs sharing an exact normalized name or phone become explicit review conflicts when the complete file is sealed. Shared contacts never trigger automatic merging. Do not silently deduplicate and lose a source row.
- Check existing external links and indexed candidate matches. A shared family
  phone/name does not establish that two patients are the same person.
- Current candidate queries return a limited set of matches. Show truncation and
  offer paginated search; never turn a truncated candidate list into automatic
  identity certainty. Bound dense-match workloads and test indexes/query plans.
- Preserve separate source evidence, current ClinicOS values and review decisions.
  Changed values require a reviewed update policy, with no silent overwrite of
  clinician-verified or operator-corrected records.
- Before commit, assign every parsed row one exclusive disposition, for example:
  create, link/reconcile unchanged, review required, invalid, or explicitly excluded.
  Received total must equal the sum of those dispositions. Commit execution state
  (pending/in progress/succeeded/failed/compensated) is a separate dimension so
  counts do not double-count replays or confuse a decision with a successful write.
- Rows without a reliable ID remain unresolved until a documented migration-ledger
  policy exists. Never invent a durable patient key from name/phone/row position.

### Missing contact details and field fidelity

The current patient create/import path requires phone, although stored patient
records permit a nullable phone. At clinic scale this can exclude historical
patients or children. The default design should support explicitly contactless
historical patients with a valid source identity, subject to review of every
downstream assumption; phone-dependent messaging must remain unavailable until
a valid contact/guardian relation exists. Never fabricate a phone or merge a family.

Preserve and map supported alternate contacts/guardian relationships through the
canonical model rather than guessing which number is primary. Validate actual DOB
formats and gender vocabulary with non-identifying source evidence. Do not derive
an exact birthday from Age. Keep exclusions visible. A demographics import must
not claim to preserve medical history, allergies, notes or financial balances.
Those need separately reviewed historical-record mappings before replacement.

### Durable processing and recovery

The unattended worker design below is deferred beyond the initial supervised
5,000-patient workflow. Existing per-batch transactions, locks and persisted
receipts provide its pause/resume behavior; there is no background-job promise.

- Extend the existing worker/Temporal/outbox infrastructure after the manifest and
  repository contract are frozen. Do not add a second queue or shadow patient store.
  Workflow messages/history carry scoped IDs and versions, not raw patient rows.
- Use short transactions, idempotent activities and checkpointed progress. An
  accepted job is not successful import. Commit-time identity/version checks remain
  authoritative even if preflight passed earlier.
- Serialize competing commit jobs for the same clinic/source as the initial policy;
  retain external-reference locks for other writers. Do not assume arrival order of
  uploads proves chronological order of source snapshots. Stale/changed evidence
  still needs review; missing rows do not imply deletion or cancellation.
- Bound worker leases, retries and backoff; fence stale workers. Pause/cancel means
  no further batches start after the safe boundary; already committed records remain
  visible. Report uncertain in-flight work until a durable outcome is known.
- Revalidate authorization when starting/resuming privileged work and define what
  happens if access is revoked during a job. UI session expiry must not erase progress
  or bypass permission checks on resume.
- Whole-file commit is a series of bounded transactions, not one atomic transaction.
  Clearly expose partial outcomes. Do not present incomplete migration as a successful
  cutover or automatically send reminders for imported records.
- Preserve dependency-aware compensation. Edited/used/audited records can block
  removal. A backup is disaster recovery evidence, not an instant safe undo of an
  import after unrelated clinic work has continued.

### Read paths and performance

- Compute file/run summaries using indexed database aggregates or transactional
  counters, verified against source rows. Avoid loading the entire run in Node or
  rendering it in React. Paginate rows, candidates, conflicts and audit history.
- Show review filters, progress, remaining work, durable failure reason, safe retry,
  and a reconciliation report. Detailed exports require authorization and protection
  against spreadsheet formula execution; aggregate reports need no patient values.
- Measure import throughput, memory, database lock waits and ordinary clinic latency
  on a documented machine with existing patients and dense duplicate cases. Propose
  p95 search/Today reads under two seconds for three concurrent operators during the
  5,000-row test; validate or revise this budget before promising performance.
- Browser/server memory should follow the configured working chunk/window, not the
  full file or all matching patients. Stop increasing the envelope if this fails.
- Logs and metrics contain counts, opaque operation IDs and error codes; no patient
  values. Staging retention and abandoned-upload cleanup need an explicit policy,
  access checks and an audit trail, not indefinite retention by accident.

### Exit tests for large patient migration

| Test group | Required proof |
| --- | --- |
| Volume | 1/100/101/1k/5k full files accepted within the measured envelope; over-limit files rejected without silent truncation |
| Parsing | Unicode boundaries, multiline fields, malformed tail, wide/huge cells, unknown headers, invalid UTF-8, quoted IDs and missing IDs |
| Identity | Same ID across distant chunks, changed evidence, shared family numbers, duplicate names, missing phone, existing verified patients and limited candidate pages |
| Recovery | Close/reopen browser, reauthenticate, lost receipt, retry finalization, server/worker restart, crash immediately before/after a commit, revoked access |
| Concurrency | Duplicate submissions, simultaneous same-source snapshots, stale lease, staff editing a candidate during review and concurrent rollback |
| Accounting | No omitted range, double-count or extra patient; an exact replay creates zero new patients; independent database totals match the UI |
| Privacy | Excluded fields absent from requests, staging, logs and workflow history; RLS/permission negatives; abandoned staging retention rules |
| Product | Real API/Postgres desktop/mobile trial, responsive controls, search usable during import, honest incomplete/error states and no source writeback |

No large-export completion claim until these pass. Mock-only/browser-intercepted
tests cannot substitute for the durable tests.

## 3. Complete the clinic's daily work in a defined sequence

“At least as good as the current system” means preserving every workflow the clinic
relies on, with an explicit supported path for its historical records. A visible
Ray menu is not proof of usage, and an existing ClinicOS endpoint is not proof of
usable functionality. Use a clinic acceptance matrix with: current task, current
source/tool, staff role, required behavior, ClinicOS path, retained history, evidence
and sign-off. No critical row may simply be labelled deferred at cutover.

| Milestone | Build/reuse | Concrete acceptance |
| --- | --- | --- |
| A. Whole patient file | The ingestion architecture above; patient contact completeness and ordinary search/profile | A large source-shaped synthetic export imports/reconciles correctly and resumes after failures; actual source formats are verified before real use |
| B. Front desk and setup | Existing identity/roles plus clinic onboarding, staff administration, working hours, doctors/chairs/types; patient create/edit/duplicate review; booking, reschedule/cancel, day/week views and basic manual queue | Receptionist finds/creates a patient, books/reschedules/cancels with conflict checks; doctor/receptionist see the same durable schedule; a second clinic cannot access it; no pasted UUIDs |
| C. Appointment source migration | Supported source mapping, doctor resolution, historical observation handling and reviewed upcoming bookings | Two synthetic snapshots exercise create/change/cancel/replay without duplicate or invented bookings; source limitations are visibly reconciled |
| D. Clinical encounter and historical context | Existing encounter/dental/media domains; usable intake/consent, medical history/allergies, dental findings, notes, treatment plans, prescriptions, clinician review/signing and print outputs | An authorized clinician retrieves history, records an encounter, signs the correct revision and prints an approved output; assistants cannot sign; historical imported notes are labelled source records, not newly signed findings |
| E. Checkout and financial continuity | Existing invoice/manual-payment/receipt contracts; forms for procedures/estimates/invoices, partial/manual payments, dues, correction/void/refund as supported; reconciliation | A completed procedure produces the right invoice and receipt; retries do not duplicate payments; balances match reviewed source evidence; manual payment evidence is distinguished from verified provider settlement |
| F. Communications and follow-up | Existing provider/workflow boundaries; operator inbox/actions, reminders, cancellation notices, recall tasks, templates, opt-out, retries and human handoff | Existing confirmation/cancellation/reminder/recall service is preserved; only configured official providers send; outage/retry cannot double-send; operator can see failed delivery |
| G. Files and operating workflows | Historical image/document access, clinic-owned capture, lab cards/status/reconciliation, inventory movements/counts/expiry, expenses, recurring tasks and required reports | Staff can retrieve needed prior records and perform the clinic's required lab/stock/expense/report work; amounts/counts reconcile; permissions and corrections are auditable |
| H. Controlled pilot and cutover | Chosen deployment identity, backups/isolated restore, logging/alerts, support/runbook, training and final reconciliation | Staff perform a representative day and repeat the import/reconciliation cycle; critical discrepancies resolved; backup restore proved; fallback and source-of-truth switch explicitly approved |

Files/history cannot wait for milestone G if they are needed for the milestone D
clinical trial. Plan the data migration/coexistence path during A and make the
required records available before D. Similarly, configuration/identity setup is
part of B, not a late cosmetic settings page. Existing shared contracts should be
extended; no replacement authentication provider is needed merely to build UI.

### The appointment decision that code alone cannot settle

The reported appointment file has no stable booking ID, planned duration/end or
visit type. These are facts missing from the export, not evidence Ray lacks them.

Preferred path: obtain them through a supported source export/integration or vendor
confirmation. If unavailable, design an explicitly reviewed migration ledger:
source observations get durable ledger identities; operators resolve collisions
and changed/rescheduled observations; upcoming operational bookings require reviewed
time/type/doctor data. Historical observations can remain history without invented
end times. Do not treat row number or a hash of patient/doctor/time as a stable
vendor booking ID. Do not infer duration from attendance timestamps or old Scheduled
rows as completed visits. The clinic must approve the semantics of any fallback.

B can progress while this decision is open because ClinicOS can create its own
correctly identified appointments. C cannot be called complete by using a guessed
source mapping. Full scheduled sync requires a separate official source capability;
manual exports remain honestly operator-triggered snapshots.

### What stays later

AI transcription/scribing, AI proposals, automated attendance detection, broader
provider coverage and advanced analytics should follow a stable, measured daily
loop. Email remains deferred. Future scribing uses consent, source-linked drafts
and clinician sign-off against the same encounter model. It must not become a
prerequisite for basic patient migration, booking, notes or billing.

The PRD excludes building a Practo-style patient marketplace in v1. If the clinic
relies on Practo referrals/Prime, preserve that official channel during coexistence;
claiming to reproduce the marketplace is neither necessary nor presently supported.

## 4. Delivery structure and stopping criteria

First review/preserve the current uncommitted trial and profiling work and establish
an accurately tested baseline. PR/merge decisions use current checks, not historical
green results. The owner subsequently authorized the 5,000-patient implementation and isolated
synthetic testing. No production changes, real-data imports or release claims are authorized by this plan.

The first implementation package is **A: complete large-file patient migration**:

1. Freeze snapshot/chunk/source identity, accounting and compatibility contracts.
2. Implement schema/RLS and bounded receipt/finalization/summary/review APIs.
3. Implement snapshot-wide validation, candidate queries and contactless/history policy.
4. Implement resumable commit/compensation using the existing worker infrastructure.
5. Implement streaming preparation and operator review/progress/recovery UI.
6. Run fault/scale/security/durable browser acceptance and publish the measured envelope.

Keep shared migrations, contracts, generated clients, environment definitions and
release evidence under one integration owner. Read-only review can run in parallel.
Isolate UI/backend implementation lanes only after their interfaces are frozen;
do not split coupled schema/API/worker changes into conflicting branches merely
to create more PRs. Each mergeable change must preserve a functional mainline and
state exactly which user capability it unlocks. A is the immediate priority, not
an invitation to build every table row in parallel.

After A, deliver B and C, then the complete D/E patient visit and the required F/G
workflows. Use one owner plus a receptionist/doctor acceptance session at each
workflow milestone. Discover historical-data and provider dependencies early while
implementation follows the dependency order. A feature count or test count is not
an exit gate; the scripted clinic action and durable evidence are.

Stop adding scope when the agreed pilot loop works. Run the experiment and measure
retrieval/booking effort, unresolved migration discrepancies, staff task completion,
and reconciliation errors before selecting the next blue-sky feature. Do not invent
clinical time-savings/no-show claims from synthetic data or unreliable timestamps.

## 5. What the owner needs to provide, and when

| Activity | Can engineering do it independently? | Owner/clinic input |
| --- | --- | --- |
| Existing two-patient technical rehearsal | Yes; already exercised by real-stack synthetic tests | Nothing; optional UI feedback only |
| Large-file implementation and 1k–5k synthetic scale/failure tests | Yes, within the approved test environment | No patient files or AI/provider keys. Aggregate volume helps choose the release envelope but is not a coding blocker |
| Verify this Ray export's actual format | Partly | Owner-run aggregate-only local profile, or equivalent non-identifying counts/format facts. A clinic staff member verifies ambiguous field semantics; raw patient rows need not be sent to the assistant |
| Judge everyday usability | No, engineering cannot stand in for the receptionist/doctor | Short supervised session with invented patients: find, book, correct a mistake, record a visit, bill and follow up. Identify indispensable current tasks and required outputs |
| Appointment mapping fallback | No | Confirm export timezone and approve doctor/type/duration/identity policy if the official source lacks required fields |
| Real-data pilot | No | Explicit authorization for selected fields/records, storage environment, roles, retention and handling; clinic-approved expected totals and discrepancy owner |
| Official reminders/payments/media and real sign-in | Implementation/tests can proceed with the existing contracts | Clinic-owned provider/admin setup and controlled credentials in secure configuration; no keys in chat. SMS replacement cannot be assumed from an interest in WhatsApp |
| Cutover | No | Clinic sign-off, agreed source of truth, historical access, final reconciliation, restore evidence and operating fallback |

The model does **not** need the original ZIP or patient CSV in chat. An eventual
customer uploads directly into their authorized ClinicOS environment; engineering
validates the product using synthetic fixtures and minimized diagnostics. Early
clinic evidence validates the adapter and decisions, not a permanent developer-
assisted migration service.

For the initial aggregate profile, the existing offline utility emits no patient
values. Review its business counts before sharing them. We need approximate patient
volume/file size, missing/duplicate ID and phone counts, and actual optional-field
formats—not identities. Patient-number stability across exports requires source
evidence or clinic confirmation beyond a single file's counts.

Existing constraints remain: Desktop is read-only; no real exports opened by the
agent; no existing Docker/database reset or restart; no provider calls or real-data
imports without scoped authorization. The prior approved disposable Postgres/Redis
workflow is sufficient for current parser/API/database tests. Additional worker or
identity services need a concrete isolated test setup and any required approval.

## 6. Definition of readiness

- **Technical rehearsal:** synthetic workflow and recovery tests pass. Can proceed
  without owner data; not an operational clinic sign-off.
- **Shadow pilot:** approved clinic data and staff acceptance for the selected slice,
  with Ray retaining agreed operational responsibility and no duplicate outbound
  messages. Whole export limitations and discrepancies are explicit.
- **Daily service cutover:** every clinic-critical workflow and required historical
  record has a verified path, final reconciliation and restoration evidence exist,
  and clinic staff approve the switch. Until then, do not claim full Ray replacement.

Current recommendation: rehearse the implemented A and booking-through-arrival
portion of B with synthetic data and clinic staff. Complete the remaining setup
and patient-maintenance paths, resolve C source semantics, then build the D/E
consultation and checkout handoff. Do not substitute synthetic success for source
validation or staff acceptance.
