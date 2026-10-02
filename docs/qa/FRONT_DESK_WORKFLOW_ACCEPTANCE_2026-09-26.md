# Front-desk booking and arrival workflow

Date: 2026-09-26. Checkout: `/Volumes/Spectra/Projects/ClinicOS`.
Branch: `codex/import-operator-recovery`.
Starting commit: `f6744e6ffafd6b1b7d16912f5a0b1510d18a2524`.
The new front-desk work and the earlier patient-file work remain uncommitted.
No merge, push, deployment, provider activation or real-data import occurred.

## Delivered scope

A configured clinic can now use named controls in Today or Appointments to:

1. Search for an existing patient, or register a patient with a name and phone.
2. Choose an eligible doctor, active visit type, optional chair, clinic-local
   appointment time and duration, then explicitly review and book.
3. Reschedule an unarrived appointment with a reason while retaining its identity,
   patient and source. A changed booking returns to booked and needs reconfirmation.
4. Record a patient's confirmation, cancel with a reason, or record a no-show
   after the booked visit has ended and only if the patient has not arrived.
5. Check a patient in manually, call them from the reception queue, or return
   them to waiting. Cancelling an arrived appointment cancels its active queue
   entry in the same database transaction.
6. Refresh/reload and see the durable clinic day; other staff changes cannot
   silently overwrite the record reviewed by this operator.

The previous backend, generated client, permissions, RLS, audit, outbox,
transaction/idempotency coordinator and scheduling conflict constraints are reused.
Rescheduling extends the existing versioned appointment PATCH route. There is no
second scheduling store, new authentication provider, or new provider integration.

## Correctness and recovery

- Doctor eligibility, clinic hours, provider availability, active configuration,
  provider/chair overlaps and clinic timezone are checked server-side. Concurrent
  booking conflicts receive a safe 409 instead of SQL error details.
- Updates require the reviewed row version. Exact request replays retain their
  operation key; a stale edit requires refresh and explicit review.
- Native registration serializes duplicate lookup through insertion within the
  existing clinic transaction, preventing simultaneous desks from independently
  passing the same duplicate check. Potential matches fail closed. This is not
  a new patient merge or shared-family-contact override interface.
- Rescheduling preserves the appointment ID, source links, patient and notes;
  status history and audit capture the change and reason.
- Distinct front-office outbox facts now use the existing scoped event key helper.
  The previous request-only key silently dropped secondary events, including
  confirmation requests. The durable runner now independently reconciles those
  events rather than relying on visible UI success. This change does not backfill
  historical events or claim any message was delivered.
- Cancellation invalidates the queue row version atomically. A concurrent queue
  update either precedes cancellation or fails against the changed state/version;
  a cancelled appointment cannot be called. The appointment cancellation audit
  and event explicitly record the induced queue cancellation consequence.
- Receptionists can operate the schedule without gaining clinical-record access.
  Patient clinical-detail links remain hidden when the role lacks that permission.
- Unknown write outcomes keep the exact action and key in memory and lock the
  editor. Recovery survives navigation within the same tenant/clinic/user; changing
  identity discards the previous actor's command. No patient payload is put in
  browser storage or URLs. Recovery does not invent a successful no-op if the
  original request finishes during navigation.
- This in-memory desk-command recovery does **not** survive a full browser close
  or reload. A pending request triggers the browser leave warning. If the operator
  leaves anyway, reconcile the schedule or patient search before creating another
  record. The separate patient-file importer has its own durable receipt recovery.
- Loading, unavailable configuration, permission errors, duplicate warnings,
  disconnected API and unknown results are explicit. The visible schedule refreshes
  every 30 seconds when no editor is open. This is not a push/live-sync guarantee.

## Verification

**PASS for a supervised synthetic booking-through-arrival rehearsal.** This is
not a real-data pilot or a production release decision.

Evidence root: `.audit-spectra-retirement-20260920/front-desk-20260926/`.
The final combined run is `native-4do89ylm/browser/run-Lfh5dL/`.
The receptionist-role run is `native-bfpjrfx6/`; its six scenarios passed before
the final registration serialization/audit metadata additions. The final combined
run exercised those additions, including simultaneous duplicate registrations.

| Check | Result |
| --- | --- |
| CP13 API, API contracts and database test suites | 209/209 passed; zero skips (`contracts-db-tests-final.log`) |
| All web unit tests | 201/201 passed in 28 files (`web-tests-final.log`) |
| Native API migration/framework tests | 39/39 passed; zero skips, including socket cases (`native-4do89ylm/api-migration-tests.log`) |
| Receptionist browser rehearsal | 6/6 passed in 5.3 seconds; clinical-record access denied and clinical-detail link absent |
| Final combined real-stack browser | 12/12 passed, no skips, retries or flaky tests; 310.4 seconds including normal import rate-limit waits |
| Independent database reconciliation | Exactly 5 front-desk patients, 5 appointments, 2 reschedule audits, 7 confirmation requests and 1 queue entry; ordinary runtime RLS role, read-only SQL |
| 5,000-patient import regression | Complete 50-group file, pause/reload/upload and commit recovery, all 5,000 committed, then all 5,000 reconciled on replay; excluded-field and search assertions passed |
| Database/build | All 28 migrations applied and validated in fresh synthetic PostgreSQL; seed/role verification, shared/API builds and production Next.js build passed |
| Static/workspace | Root typecheck, root check, web lint, all three generated contract/client drift comparisons, whitespace and release-scope secret scan passed |
| Rendered desktop/mobile | Final screenshots inspected; 390px layout has no horizontal overflow and form controls fit the viewport |
| Cleanup | Both runs record API/web stopped and owned PostgreSQL/Redis exited zero. Owned process IDs were checked after completion; no test service left running |

The front-desk SQL reconciliation is now in `scripts/test-mvp-real-stack.mjs`,
so CI cannot pass on visible success while secondary events disappear. The runner
requires its existing explicit synthetic/disposable/loopback/provenance guards.
Use `--front-desk` for the receptionist-only six scenarios; the default runs all
12 as the synthetic owner, which has migration permissions. It never provisions
or resets a database itself.

`final-source-sha256.json` binds the changed release-scope files to this evidence;
it includes earlier uncommitted import work and excludes unrelated research and
the unrelated vision document. Historical failed attempts remain in the scratch
folder: generated schedule typing, fixture names/selectors and assertions were
corrected, and the independent SQL check exposed the lost outbox facts. Those
attempts are not represented as passes. The existing nonfatal `pg` concurrent-client
query deprecation warning remains; this is not pg@9 compatibility certification.
The entire monorepo test suite and online dependency/image scans were not run.

The real-stack runner uses the actual API, PostgreSQL, Redis and a production
Next.js build with synthetic fixture authentication. No API responses are mocked
or intercepted. The receptionist run checks denied clinical access; the combined
owner run can also perform migration operations. These are not real OIDC tests.

The six front-desk scenarios cover registration/booking/rescheduling/confirmation/
manual arrival/queue, cancellation and queue concurrency, stale versions and exact
replay, simultaneous overlapping bookings, cross-clinic denial, premature and
elapsed no-show handling, offline recovery, duplicate registration and 390px
mobile viewport bounds. The default guarded runner also retains all six import
scenarios, including the complete 5,000-patient file and exact replay.

In-app Browser Use was attempted but no IAB backend was available. Repeatable
Playwright and direct inspection of its rendered desktop/mobile screenshots are
used; interactive IAB or physical-device acceptance is not claimed.

## Scope that remains open

This completes the bounded booking-through-arrival slice for an already configured
clinic. It does not close all of milestone B or imply a full Practo replacement:

- Real staff sign-in and clinic-owned role/configuration provisioning need a
  controlled pilot setup and rehearsal. These tests use existing synthetic seed
  doctors, chairs, types and working hours.
- Admin setup/staff management, working-hours editors, week-calendar planning,
  general patient demographic editing and explicit duplicate/family-contact
  resolution still need their own supported operator paths.
- Raw Practo appointment migration still lacks verified identity/duration/type
  semantics. No booking duration is inferred from check-in/out timestamps.
- Consultation authoring/signing, treatment and checkout/payment/receipt workflows
  remain separate delivery slices on the existing backend.
- Automated attendance, AI additions and email remain deferred. Official reminders,
  delivery, clinical media/history and source-system coexistence need their own
  activation and clinic acceptance. A confirmation event is not delivered WhatsApp.
- No live patient records, payment data, production providers, cloud release,
  image-security scans, physical-device tests or backup/restore trial were used
  or performed by this change. Previous production gates remain open.

## Next supervised exercise

Use a configured synthetic clinic and a receptionist role. Register an invented
patient, book, move the time, confirm, check in, call/return to waiting and cancel.
Use a second session to attempt a conflicting booking and stale change. Review
how errors and recovery are explained. Repeat a patient-file import/replay, then
find an imported patient and book them through the same front-desk flow.

Engineering can perform this without a clinic export or AI keys. A receptionist
must judge whether the wording, required details and action sequence fit actual
clinic work. Keep Practo as the agreed operational source until the remaining
source/history, identity, consultation/checkout and clinic acceptance gates pass.

Desktop remains read-only. Existing Docker services, containers and volumes were
not changed. Only previously approved owned synthetic localhost processes were
used; data, caches, temporary files and logs remain on Spectra. No dependencies
were installed. Cleanup evidence is recorded with each run.
