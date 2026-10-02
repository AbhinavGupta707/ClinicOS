# Returning-patient chart review — 2026-10-02

Scope: local implementation and synthetic acceptance. Not clinic cutover or production approval.

## Project history and why this task

The full available chat history, project instructions, canonical specifications and dated
acceptance records were reviewed before choosing this slice. The product remains a
clinic operating platform that can migrate authorized incumbent data and support the
whole clinic day. The active programme is integration-first: prove one clinic, a
trustworthy migration, and useful daily operation before expanding providers or scale.
Healthy Roots in Gurgaon is the intended pilot. Girgaon in older material is historical.

The work has progressed through these stages:

| Stage | What exists and what that evidence means |
| --- | --- |
| Mac/Spectra relocation | Source/build portability was established; Desktop retirement is a separate question and was not worked on here. |
| Windows integration PR and Mac repair passes | Canonical patient/practitioner/appointment ingestion, human review, identity links, replay/rollback controls, Today/search, and the implemented UI direction. |
| Identity and import recovery | Durable staff identity, cookie/BFF session controls, audit delivery, source contracts and operator retry/recovery. Earlier reports that describe all identity as missing are outdated. Historical real-OIDC evidence is distinct from this task's synthetic-token tests. |
| Practo export work | Verified headers and date/status examples informed the authorized-file adapter. The patient file workflow was previously rehearsed with 5,000 synthetic patients. Appointment evidence requires explicit review because the export does not establish duration, arrival or completion truth. |
| Daily workflow UI | Registration, scheduling/queue, intake/consent, consultation, signed/amended notes, prescriptions, treatment, checkout/manual payment evidence, tasks/recalls, lab and clinic operations are connected to existing backend records. |
| Financial operations and appointment review | Deposits, allocations, credits, refunds, corrections, reconciliation, and reviewed create/link/hold appointment decisions were implemented and tested in the preceding slice. These changes remain in the same uncommitted working tree. |
| This slice | Turn stored clinical history into a usable returning-patient review, with permission-filtered paging, source record opening and saved dental comparison. |

This avoids rebuilding functionality already present. A doctor previously saw a short
list of event titles and a dental snapshot count, with no practical route through
older history or comparison. The API also fetched the entire timeline before slicing.
That was a concrete continuity gap in specifications 01, 02, 08 and pilot field note 15.

PR/remote merge state was not re-queried in this task. Historical PR outcomes are not
assertions about today's GitHub checks. The local checkout stayed on
`codex/import-operator-recovery`, HEAD `f6744e6ffafd6b1b7d16912f5a0b1510d18a2524`.

## Delivered workflow

Open Patients → choose the patient → Patient profile / Returning preparation.

1. Review the latest saved intake, recorded consent state and data-coverage statement.
   Missing information remains unknown. A read timestamp is not a source-sync claim.
2. Filter the patient's authorized history; move to older/newer pages and refresh.
   Queries return at most 100 events (the screen requests 20). Stable timestamp/ID
   ordering preserves equal-time events. Invalid, foreign or differently filtered
   cursors fail rather than silently restarting or exposing another record.
3. Open a supported event's actual source: encounter, exact note version,
   prescription, dental finding history, saved chart snapshot or invoice summary.
   Read-only source viewing never signs, changes or completes a record. Other event
   types remain evidence with an explicit instruction to use their own workflow.
4. Select two saved dental snapshots and compare their displayed clinical fields:
   tooth, surface, finding type, severity, status, review status, source, confidence
   and notes. Added/changed/absent findings are recorded differences; absence is
   never presented as proof of treatment or resolution. This is not image analysis
   or a comparison of every provenance/treatment-link metadata field.
5. Loading, failed reads, retained stale data and empty results are distinguished.
   Changing patient/clinic/user clears prior detail and comparison state. The
   controls and comparison work at a 390-pixel mobile viewport.

The canonical timeline route is extended; two snapshot read routes are registered
through repository ports, API ownership, Nest, policy, contracts and generated client.
There is no separate history datastore. Migration 0032 adds read indexes only.

Safety/correctness details:

- Permissions filter event types before database pagination; future unknown types
  fail closed. Grouped categories require the permissions of their contained
  workflows. Reception's current lack of PHI permission is preserved.
- Raw event metadata is excluded except a validated encounter association. Detail
  targets use an internal allowlist, exact identifiers and patient checks.
- Missing linked notes/prescriptions are never replaced with the newest version.
  Historical signer names come from the recorded source projection, including staff
  who are no longer active.
- Snapshot access records the exact immutable snapshot ID in the audit event;
  failed audit writes prevent returning the source data.
- Preparation reads bounded timeline/intake results and a latest-per-purpose
  consent projection. It no longer reads all consent history twice or displays a
  separate active list that disagrees with enforcement. Full ordered consent
  history and the bounded projection are checked for equivalent decisions.

## Verification

Evidence root: `.audit-spectra-retirement-20260920/returning-patient-20261002/`.
Final run paths and completion results are recorded below.

| Check | Evidence / scope |
| --- | --- |
| Workspace tests and targeted final reruns | 1,200 distinct tests: the workspace run passed 1,182 and skipped 17 socket tests under the sandbox; all 226 API tests then passed outside that restriction, resolving those skips; the final web suite passed 230, including one additional exact-source regression. Counts exclude repeated test runs. |
| Native PostgreSQL 16 | Fresh disposable database, provision, all 32 migrations, Flyway validation, runtime grants, synthetic seed and database verification. No existing database used. |
| History repository probe | 137 same-time events across seven pages; no omissions/duplicates; foreign/missing/filter cursor rejection; clinic isolation and empty permission set. |
| Snapshot repository probe | 25 metadata-only snapshots across two pages; exact source reads and patient/tenant isolation. |
| Consent repository probe | 132 grant/revocation records reduced exactly; a later revocation of an old grant overrides an earlier effective grant; no other-patient consent leakage. Fixtures roll back. |
| Real API/browser/database | Nine daily-workflow scenarios: prior setup/front desk/clinical/checkout/operations/finance/appointment review plus the returning-patient scenario. New scenario includes two visits, 22 saved snapshots, old signed-note opening, history and selector pagination, comparison, mobile layout, API failure, switching to an empty-history patient, cross-patient 404 and reception 403. Successful workflow requests use the actual API/database; only the deliberate outage is intercepted. |
| Other regression | Existing financial/appointment repository probe and migration/framework API tests rerun inside the native harness. Independent SQL reconciliation confirms the prior clinic-day financial and operational results. |
| Static/build gates | Workspace check, typecheck, lint, builds, generated-client/OpenAPI drift, 174-route inventory, secret scan and diff whitespace check; see final status below. |

Initial failures were corrected, not ignored: new fixture role names/permissions,
route-count expectations, test typing, a test transaction's RLS scope reset, and a
React effect-cleanup lint warning. Independent review also corrected historical
signer display, grouped queue permissions, exact snapshot audit identity, and the
unbounded duplicate consent read.

The in-app Browser bootstrap found no available IAB backend. Repeatable Playwright
against the actual local API/PostgreSQL was used, and the mobile screenshot was
visually inspected. This is synthetic identity acceptance, not a new real-Keycloak,
physical-device or staff usability sign-off.

Not rerun here: the previous separate 5,000-patient import/front-desk browser suite,
provider/live-payment/WhatsApp/AI flows, deployed cloud, dependency/network CVE
scans, image CI, chosen-Keycloak-image acceptance, independent backup/restore,
or a real clinic export. Dependencies and lockfile were not changed.

## Preservation and boundaries

Before implementation, the prior 142-file source evidence was verified and archived
as `pre-slice-source.tar.gz`, `pre-slice-manifest.json`, and `pre-slice.patch` under the
Spectra audit root. Final hashes and a delta against that archive identify this
slice separately from the prior uncommitted work. Unrelated research, comparison
images, the vision document and Desktop were not edited.

Only installed dependencies and owned, temporary native PostgreSQL/Redis/API/web
processes were used. Test data, browser output and heavy build artifacts are on
Spectra. No Docker services were started/reset/recreated, no providers were
contacted, and no patient exports were read. No commit, push, merge or deployment.

## Decision and next milestone

**GO for a synthetic returning-patient walkthrough. NO-GO for replacing Practo in
live care on the strength of these tests alone.**

The useful next milestone is a staff rehearsal of migration → appointment → visit →
checkout → return visit, followed by a supervised clinic sample and reconciliation.
It does not require another speculative feature expansion.

Still required for real use:

- A reproducible human staff-login rehearsal/configuration and acceptance with the
  chosen deployment identity image; historical CI identity evidence is not proof
  of that local/deployed configuration.
- Clinic-approved export handling and representative reconciliation, including
  duplicates and the source fields that cannot be inferred. Two real source
  cycles and human discrepancy review remain programme exit evidence.
- Explicit decisions for old notes/images/bills that the current demographic and
  appointment exports do not supply. The new chart does not reconstruct missing
  historical clinical data.
- Staff validation of the actual clinic's working day, access roles, consent and
  clinical/financial records, then appropriate staging, backup/restore, security
  and operational evidence before live cutover.
- Official provider activation for features that need it (e.g. private media,
  WhatsApp or AI), sequenced by pilot need. The new history workflow needs no AI
  API key and performs no live provider action.

## Final gate record

All implemented-scope gates passed. No outstanding failing check for this slice.

- Final native run: `native-4rydawvd/checks.json` — every stage exit 0.
- Final browser run: `native-4rydawvd/browser/run-Toi0M7` — 9 passed, 0 failed/skipped;
  desktop/mobile screenshots and SQL reconciliation retained there.
- `cleanup.json` records PostgreSQL and Redis exit 0; both owned PIDs were checked
  absent after the run. The runner also records owned API/web shutdown.
- `tests-final.log`, `api-http-final.log`, `web-tests-final.log` substantiate 1,200
  distinct passing unit/API tests; the API rerun has zero skipped tests.
- `typecheck-final.log` passed workspace typecheck; final web changes also passed
  `web-typecheck-final.log`. All non-web lint gates passed in `lint-final.log`;
  its web cleanup warning was corrected and `web-lint-final.log` passed.
- `check.log`, `build-final.log`, `secrets-final.log` passed. Generated contract and
  inventory commands confirmed 174 registered routes with no drift. `git diff
  --check` passed.
- `final-source-manifest.json`, `slice-files.json`, `slice-from-pre-task.patch` and
  `final-gates.json` bind this handoff to the local source and distinguish this
  slice from prior work. These local artifacts are not an independent backup.

The source remains uncommitted; no remote CI/merge-ready claim is made.
