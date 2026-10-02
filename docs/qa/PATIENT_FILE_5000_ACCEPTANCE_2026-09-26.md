# Supervised patient-file import: 5,000-patient acceptance

Date: 2026-09-26. Healthy Roots pilot: Sector 50, Gurgaon.
Checkout/root: `/Volumes/Spectra/Projects/ClinicOS`.
Branch: `codex/import-operator-recovery`.
Starting commit: `f6744e6ffafd6b1b7d16912f5a0b1510d18a2524`.
Implementation and earlier patient-trial work remain uncommitted. This report
supersedes the 100-row file-capacity limitation in the earlier patient-trial
report; it does not rewrite that historical evidence.

## Scope and decision

The owner approved a 5,000-patient testing target and asked why existing backend
functionality had not already produced a complete alternative to Practo. This
change extends the existing migration model into one supervised, recoverable
patient-file workflow. It does not create another patient store, queue or product.

**Final result: PASS for the bounded synthetic patient-file slice.** A synthetic pass permits a
supervised synthetic rehearsal. It is not authorization for real patient data,
Practo retirement, a live clinic cutover, or a production release.

## What changed

- One Practo-format patient CSV, up to 5,000 records and 25 MiB; 5,001 records
  reject the whole file. No manual splitting and no silent truncation.
- Streaming UTF-8/CSV validation and a second bounded preparation pass. The
  browser holds the selected local file, bounded rows and identity/hash metadata;
  it does not persist PHI in browser storage. The main-thread parser yields between
  reads; a dedicated Web Worker is not implemented or claimed.
- Only Patient Number, name, primary mobile, email, DOB and gender are uploaded,
  plus two fixed provenance labels. Original filename and excluded field values
  are not sent. Original medical history, notes, national ID, address and other
  source columns remain outside this mapping and visibly excluded.
- Immutable per-file manifest and per-group receipts under existing import runs,
  with a fixed maximum 100 patients / 256,000 UTF-8 bytes per group. At most 50
  groups. An oversized group fails explicitly rather than changing the contract.
- Server-computed hashes, exact expected counts and a complete-file seal. Generic
  batch endpoints cannot bypass incomplete-file commit protection. Repeated IDs
  are rejected both locally and across stored groups.
- Whole-file identity review for exact normalized name or phone matches across
  different patient IDs, including different groups and non-Latin names. These
  are candidates, not automatic merges. Shared family numbers can be explicitly
  approved as separate people; duplicate rows can be skipped. Review evidence
  contains bounded source CSV row-number references, not copied patient details.
- Explicit whole-file commit approval and sequential existing batch commits.
  Closing the page pauses future work. Reselect the same file to resume an
  incomplete upload; sealed files recover commit progress without the original
  file. Each group is atomic; the complete file is not one transaction.
- Rate-limit responses show a waiting state and honor the server's Retry-After
  before bounded retries. Authorization failures and uncertain write outcomes
  are not blindly retried. Existing server abuse limits remain unchanged.
- File summaries expose received, ready, review, invalid, skipped, committed,
  reconciled, failed and rolled-back counts. Only a selected group of up to 100
  rows is loaded for detailed review. Existing dependency-aware rollback remains
  per group and best-effort; it is not universal whole-file undo.
- Migration 0028 adds scoped foreign keys, forced tenant/clinic RLS and immutable
  metadata. API permissions remain `migration.manage`. Four routes and generated
  clients/contracts were reconciled together (143 active routes total).
- Prepare, receipt and seal transition audit records are emitted once for the
  new transition, not again for an exact retry. Existing commit-time external-ID
  locks, reconciliation and rollback safeguards are retained.
- Blank optional DOB/email normalize to null. This fixes a real PostgreSQL date
  failure uncovered by the scale acceptance test, not just a fixture mismatch.

## Verification record

Final native run: `.audit-spectra-retirement-20260920/patient-file-5000/native-4tq28vhn/`.
All checks in its `checks.json` exited zero. Evidence remains solely on Spectra.

| Check | Result |
| --- | --- |
| Focused Node domain/security/DB/contracts/API/profiler suites | 347 cases: 337 passed in the sandbox; 10 HTTP/socket cases skipped there and then passed in the native run's 39/39 API cases. No remaining skip in this selected coverage. |
| Web tests | 189/189 passed, including parser bounds, privacy, 5,000/5,001 rows and retry behavior. Together with the Node coverage: 536 distinct focused cases. |
| Real-stack browser | 6/6 passed, zero retries/flaky cases, 305.7 seconds including normal rate-limit waits; API and PostgreSQL are real, authentication is synthetic. |
| Independent SQL reconciliation | Two 5,000-row snapshots; 100 groups; 10,000 committed staging rows; exactly 5,000 linked patients and 5,000 source identity links. Replay created zero additional patients. |
| Native repository checks | Concurrent manifest/receipt/commit; immutable metadata and seal; incomplete commit rejection; tenant/clinic/no-context RLS; duplicate source ID rejection; same-file exact-name/shared-phone/Unicode review and explicit resolution all passed. |
| Privacy | Network assertions and independent staging inspection confirm excluded source values are absent. Only six mapped fields and fixed provenance labels were retained. |
| Build/schema/contracts | All 28 migrations applied and validated in a fresh owned synthetic database. Shared/API/web builds, workspace typecheck/check, web lint, generated OpenAPI/client drift (143 routes), formatting, whitespace and release-scope secret scan passed. |
| Mobile/desktop | Real screenshots reviewed. The final mobile test waits for closed navigation and checks the group selector's actual viewport bounds, reachable commit control and no horizontal overflow. |
| Cleanup | `result.json` confirms owned API/web stopped; `cleanup.json` confirms owned PostgreSQL/Redis exited zero. No test app was left running. |

The three parallel patient-search probes during commit returned in 18, 19 and
18 ms on this Mac. This is a tiny local sample, not a p95/SLA, three full staff
sessions, memory benchmark or production performance claim. The final code,
contract, fixture and workflow bytes are bound by `final-source-sha256.json`
(45 changed files; includes earlier uncommitted patient-trial work).

Not run: real export/PHI handling, clinic staff acceptance, real OIDC sign-in,
live provider delivery/payments, deployed-cloud tests, security image scans,
physical-device acceptance, disaster recovery, memory/long-duration stress,
100,000-row tests, or the entire monorepo test suite. An existing nonfatal `pg`
concurrent-client-query deprecation warning appeared; no database/test assertion
failed. This run does not certify future pg@9 compatibility.

Tests deliberately use synthetic patients, the real API, migrated PostgreSQL,
Redis and a built Next.js app. Local synthetic authentication is used; this is
not a fresh Keycloak/provider activation test. In-app Browser Use was attempted
but reported no available IAB backend. Repeatable Playwright exercises the real
local application instead. Desktop/mobile screenshots are reviewed separately.

Earlier failed attempts are retained rather than represented as passes:

1. `native-4qfq_nzx`: a numeric route parameter was incompatible with the generated
   client. The public ordinal contract now uses a bounded numeric string.
2. `native-ltll89x2`: an empty DOB reached Postgres as an empty string. No patients
   in that scale file were committed before the failure; nullable normalization
   and regression coverage were added.
3. `native-t6_7f93h`: the import stopped on the existing expensive-operation rate
   budget. Saved partial progress was preserved. The final workflow handles the
   documented Retry-After instead of weakening the budget.
4. `native-2t78whl8`: all six browser scenarios passed, including 5,000 committed
   patients and a 5,000-row replay; staging minimization passed. A bad relative
   import in the scratch verification harness prevented the additional repository
   probe from running. The harness path was corrected. A separate mobile control
   check also caught a clipped selector; width constraints and a viewport-aware
   regression assertion were added before final acceptance.
5. `native-g2g0x24q`: the independent repository contracts passed first. Their
   inserted synthetic patients then correctly triggered one likely-duplicate
   warning in the later scale dataset, invalidating its all-new-patients setup.
   The final harness preserves fixture isolation by running the repository probes
   after browser acceptance; no duplicate protection was weakened.

No dependencies were installed. No Docker service/container/volume was started,
reset or removed. Only owned synthetic PG/Redis/API/web/browser processes were
used; their data, caches, logs and artifacts are on Spectra. Desktop and live
Practo/patient/payment/provider data were untouched.

## Why there are still gaps despite substantial development

The project already contains substantial domain, database, API, permissions,
audit, provider-contract and test work. Previous synthetic API smoke can exercise
appointment, encounter, treatment, billing and follow-up components. That is real
engineering, but it is not the same as a receptionist or doctor completing the
whole job through a supported UI with their existing records and activated services.

| Area | Existing implementation | Work still needed for the clinic |
| --- | --- | --- |
| Patient migration | Canonical staging/review/commit, external IDs, replay, guarded rollback, run recovery, search/profile; now a 5,000-patient file workflow | Representative source-format validation; contactless/alternate-contact policy; historical clinical/financial field preservation; staff rehearsal |
| Appointments/front desk | Scheduling/status/queue APIs, practitioner mapping, canonical appointment import and joined Today | Verified raw Ray appointment mapping, identity and duration/type policy; usable booking/reschedule/cancel and clinic schedule setup |
| Consultation/dental | Encounters, signed-note/version rules, prescriptions, dental findings, consent and treatment-plan backend | Complete staff authoring/review/sign/print handoff; approved historical-record access and clinic acceptance |
| Checkout | Invoice, manual-payment, receipt and provider-payment contracts | Complete operator creation/correction/dues/reconciliation UI; official provider activation if online payments are used |
| Recall/communications | Tasks, recall/workflow and Meta provider contracts, limited overview UI | Usable operator actions and official consent/template/delivery verification; preserve the clinic's existing enabled reminders before replacing them |
| Files/operations/settings | Media access/upload and stock/lab/owner APIs; identity/roles/clinic isolation | Activated storage/scanning/restore evidence, practical stock/lab/expense/report flows, staff administration and clinic configuration |
| AI/interoperability | Review-first AI, source/audit contracts and FHIR-related code | Provider activation, clinical review trials and external interoperability evidence; not needed for this patient-file trial |

The delivery imbalance was breadth of backend/platform work ahead of completion
and acceptance of the everyday staff journey. Navigation entries, route counts,
passing component tests and illustrative designs overstate readiness if reported
as finished clinic workflows. Future status must distinguish implemented backend,
usable UI, synthetic end-to-end proof and actual clinic acceptance.

Some investments support the blue-sky direction: source reconciliation, review
and audit trails, clinic isolation, human approval of AI output and durable
integration processing. This is not evidence that Practo lacks comparable features,
or that every coded integration is live. The canonical field note explicitly
supports coexistence followed by progressive replacement.

## Remaining scope and next milestone

1. Rehearse this patient-file workflow with synthetic data. No clinic file, AI key,
   email integration or further user input is needed for that exercise.
2. Establish a privacy-preserving source-format check: aggregate row count, formats,
   missing/invalid field counts, and clinic-controlled verification of results.
   Real records need a separately agreed handling environment and authorization;
   the clinic should not have to send its patient file to a developer/chat.
3. Complete the verified appointment-import and front-desk vertical slice on the
   existing backend: book/reschedule/cancel, named clinician/type/chair choices,
   scheduling conflict feedback, Today and patient handoff. Missing Ray duration,
   stable appointment identity and visit-type evidence must not be invented from
   check-in/out timestamps. No automatic attendance detection is in scope.
4. Finish consultation, treatment and checkout as one staff-tested journey, then
   required reminders/history/reporting. Do not rebuild modules that already exist.
5. Treat live identity, source fidelity, staff acceptance and production operating
   evidence as explicit gates. This file test does not close MVP1/MVP2 or the
   broader CP14–CP18 production programme.

The larger plan still includes contactless patients, fuller history mappings,
source administration, exception search/filtering, staging-retention policy,
unattended worker execution and broader performance/restore evidence. Those are
not silently treated as complete by this bounded supervised release. No 100,000-row
capacity claim is made; a real export above 5,000 requires a separately tested scope.
