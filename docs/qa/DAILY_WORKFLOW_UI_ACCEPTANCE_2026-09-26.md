# Daily workflow UI acceptance — 2026-09-26

Status: the defined frontend scope and final local regression passed, including the calendar-date correction. Ready for a synthetic staff walkthrough; no clinic cutover or production approval.

## Scope and source

Owner request: complete the identified frontend gaps using the existing durable backend before a walkthrough. The implementation follows `docs/orchestration/DAILY_WORKFLOW_UI_IMPLEMENTATION_PLAN_2026-09-26.md` and the integration-first MVP. Work is on Spectra, branch `codex/import-operator-recovery`, base HEAD `f6744e6ffafd6b1b7d16912f5a0b1510d18a2524`, with prior import/front-desk work preserved. This report describes an uncommitted working tree, not a verified remote commit or release.

Registration was the first problem: active CP13 screens shadowed older interactive forms and often showed only summaries. The replacements call generated native contracts and scoped repositories. No second workflow datastore or legacy compatibility stub was introduced.

## Operator workflows now connected

| Area | Implemented operator path |
| --- | --- |
| Patients | Search by name/phone, registration, demographic editing, explicit no-contact reason, duplicate/shared-family-phone review with a protected preview endpoint; clinical and billing access remain separate. |
| Front desk | Existing booking, rescheduling, queue and check-in workflow retained; seven-day clinic-timezone view, doctor filtering, named resource choices and mobile navigation. |
| Enquiries | Record a lead, review its status, explicitly match a named patient, convert to an appointment; paged history. |
| Intake and consent | Publish clinic-approved structured intake templates, capture typed responses and review saved history, record actual consent evidence and revocation. Imported absence is never interpreted as a clinical fact. |
| Consultation | Discover/create visits, assigned-doctor start, draft/sign/amend notes, signed prescriptions, dental findings and snapshots, finish the linked visit/appointment/queue, printable saved clinical records. Historical signer names are resolved from the tenant staff records, independently of current active-doctor selection; missing names remain explicit. |
| Treatment and checkout | Priced plans/phases/items, explicit evidence of acceptance, performed procedures, invoice completed work, evidenced manual partial payments, receipts and approved print instructions. Signed/accepted evidence is preserved. |
| Tasks and recalls | Create/assign/progress tasks, record manual recall actions and rules, explicitly generate due work with bounded continuation. No provider delivery is inferred. |
| SOPs | Checklist templates, recurring schedules, due-run generation, per-item evidence and guarded run completion. |
| Laboratory | Vendors, patient-linked cases, expected cost, observed status progression and invoice reconciliation. Reconciliation is not payment. |
| Clinic operations | Inventory categories/items/ledger/counts/exceptions, incident reporting and corrective actions with evidence; owner dashboard reads existing durable summaries. |
| Setup | Practice/timezone, visit types, chairs, doctor schedules, INR pricebook, versioned intake templates and access for already registered staff. Concurrent changes are rejected; role revocation updates authority and protects the last owner and open doctor work. |

Directory access is bounded and pageable (including leads, tasks, recalls, SOPs, labs, inventory, incidents, corrective actions and pricebook). Mutation refresh retains the loaded treatment-plan pages. Retired catalog selections are shown explicitly and require an intentional approved replacement. Staff directories retain an explicit 500-person bound. Patient searches are intentionally bounded; operators refine a search rather than download the entire registry.

## Safety and contract repairs discovered during integration

- Native route registration and staff-server proxy families include the new setup, access, discovery and billing paths.
- Per-record versions, clinic/tenant scoping and existing authorization apply to writes. Named selection does not confer permission.
- Uncertain commands retain the original request and idempotency key in memory. The UI disables patient switching, blocks ordinary in-app navigation during an unresolved command, identifies the original patient for recovery, and warns before page unload. No clinical payload is persisted in browser storage by this mechanism.
- Patient/clinic changes reset clinical and billing forms; asynchronous search results cannot cross a changed query or scope.
- Duplicate candidates are returned through an authorized read contract, not PHI-bearing error details.
- Start/finish consultation validates the assigned doctor and records linked appointment/queue changes atomically with separate audit/outbox evidence.
- Clinical signatures and plan acceptance use version preconditions; procedure recording validates active visit, assigned doctor and current consent.
- Real-stack testing found and corrected empty optional note fields, the instruction-history table name, SOP UUID parameter typing, and the nested lab-list response schema. Unit success alone did not reveal these defects.
- Setup/access audit evidence records the saved configuration/access plus expected version. Manual payment and lab amounts are validated as integer paise; unknown lab cost cannot become a matched zero-cost claim.
- Closed mobile navigation is hidden from interaction; viewport resizing cannot leave it covering checkout controls.
- Owner metrics convert stored paise to rupees and basis points to percentages. Lab invoice inputs accept rupees with exact two-decimal conversion; missing agreed costs remain unknown and block matching/approval instead of becoming zero.
- Final screenshot review found a pre-existing PostgreSQL DATE conversion defect: converting the driver's local-midnight Date through UTC shifted birthdays, schedule boundaries and lab periods on positive-offset hosts. These calendar values now preserve the driver's local calendar fields (or unchanged DATE strings). Four subprocess tests use the installed PostgreSQL parser under UTC, London, India and Los Angeles. Browser acceptance additionally verifies a summer birthday survives registration/editing, a schedule starting today generates exactly one run, that run persists as completed, and the owner dashboard reports one completed and zero overdue SOP runs.

## Executed synthetic acceptance

Final combined run: `.audit-spectra-retirement-20260920/daily-workflow-20260926/native-fdhzqmi0/`. The 12 import/front-desk scenarios passed in `browser/run-LKYYLz/`; the five daily scenarios then passed on that same populated database in `browser/run-94AVU0/`. No browser scenario was skipped or retried into a pass.

Five serial browser scenarios use the actual Nest API, generated client and PostgreSQL after 29 migrations. Test identity is explicitly synthetic and database-backed; a localhost test gateway selects fixed fixture actors. There is no product role-switch endpoint and no live identity/provider evidence. Browser requests are not replaced with mocked clinic responses.

The scenarios cover setup and a stale configuration conflict; staff suspension/reactivation; registration/edit/shared-contact review/lead matching/week navigation; intake/consent/consultation/Rx/treatment/sign/close/amend/dental/instruction printing; invoice/partial cash evidence/receipt printing; task/recall-rule/due-generation/SOP/inventory/incident/CAPA/lab/reconciliation actions; bounded directory cursor reads including pricebook; receptionist setup denial and accountant clinical-read denial. Mobile overflow and menu visibility are asserted after the relevant forms load. Due generation does not create a premature recall for today's procedure.

Independent read-only SQL reconciliation confirms one closed synthetic visit, one completed linked appointment and queue entry, one signed prescription, a ₹1,000 invoice with ₹400 received and ₹600 outstanding, and two appointment plus two queue state events. The database evidence is in `browser/run-94AVU0/daily-database-reconciliation.json`. Screenshots are retained beside it. Traces from failed intermediate attempts are retained separately as diagnostic history and are not counted as passing evidence.

The Codex in-app browser backend was unavailable in this session. Installed Playwright Chromium supplied repeatable desktop/mobile browser evidence; selected screenshots were visually reviewed. This is not physical-device evidence.

### Final source and contract checks

| Check | Result |
| --- | --- |
| Web tests | 220 passed across 32 files |
| API tests, with localhost HTTP enabled | 222 passed; none skipped |
| Database unit/schema tests | 129 passed |
| Domain tests | 105 passed |
| Native API contracts | 33 passed |
| Generated client | 7 passed |
| Security package | 33 passed |
| Worker package | 60 passed |
| Workspace check | Passed, including 12 typecheck/runner-safety tests, environment validation and configured formatting checks |
| Workspace typecheck and lint | Passed; web tests/lint/TypeScript rerun after final display corrections |
| Generated artifacts and route inventory | Passed, 163 registered routes |
| Clock ownership | Passed, 38 explicitly owned call sites |
| Release-scope secret scan | Passed; user-owned research remains excluded by the existing scanner |

The eight focused package suites total **809 passing tests**. This is not a claim that every monorepo suite, remote CI job or external service integration ran. Shared/API builds and acceptance web builds passed. No dependencies were installed and no live dependency-advisory or container-image scan was performed.

The import/front-desk regression initially passed 11 of 12 scenarios, including the 5,000-patient import and replay. Its only failure expected the literal word “duplicate” instead of the new explicit possible-match review instruction. The corrected test retains the independent assertion that only one patient exists. After the calendar-date correction, the final fresh run passed all 12, followed by all five daily workflows on the same database. The strengthened checks explicitly confirm the summer birthday, one correctly dated SOP run, persisted completion and matching owner-dashboard totals.

`patient-file-repository-final.log` records independent verification of 5,000 canonical patients and links across two snapshots, 100 chunks and 10,000 committed staging rows, with zero duplicate patients on replay. Its concurrency, incomplete-commit, cross-chunk duplicate, scope-isolation, immutable-manifest and whole-file identity-review probes also passed. The probe ran on the owned disposable database after the import browser run; it did not access an existing clinic database.

The quality workflow now includes the five daily browser scenarios after the existing import/repository steps. This CI change is local and has not been pushed or executed by GitHub. Browser checks explicitly wait for loaded operations forms before measuring mobile layout; loading-screen screenshots alone are not treated as workflow evidence.

### Evidence identity and cleanup

The audit folder contains `final-source-manifest.json`, with SHA-256 hashes for 792 source/configuration files, including preserved prior work. Manifest SHA-256: `b49ebdbde30777e38ce38629a3a198fa29bef3128fc7dd9413c0b28e43abc7bb`. It excludes dependencies, generated build directories, research assets, prose reports and Next's regenerated `next-env.d.ts`. The final source hashes were rechecked after acceptance. This binds the local evidence to the working tree; it is not a remote commit attestation.

The final run's `checks.json` records successful migration/validation/seed/build/API/browser steps. Its `cleanup.json` records both owned PostgreSQL and Redis exiting with code 0. Each browser run's `result.json` confirms API/web cleanup. The evidence and disposable data remain on Spectra; nothing was deleted to hide failed attempts.

## Boundaries and next milestone

The implemented frontend scope is the existing supported daily-workflow contracts. This is not a claim of complete Practo feature parity or blue-sky completion. Full expense/refund/reporting suites, live provider activation, AI, source writeback and production operations remain separately scoped work; no fake controls claim they are complete.

Practo patient-file migration is retained. Raw Ray appointments still need verified source identity/mapping and explicit appointment type/planned duration decisions; check-in/out timestamps are not treated as planned duration. Clinic-approved data handling, real staff identity provisioning/login, consent/template policy, clinic configuration and a supervised clinic acceptance rehearsal remain necessary before live use. WhatsApp/payment provider activation, deployed restore/operational evidence and broader release gates have not been supplied by this local test.

No Docker services, existing databases, production providers, Desktop files or comparison images were modified. No installation, deployment, commit, push or merge was performed for this task. Only owned disposable synthetic PostgreSQL/Redis/API/web/browser processes were started, using the owner's prior approval; their data/logs stay on Spectra and cleanup records confirm their shutdown.
