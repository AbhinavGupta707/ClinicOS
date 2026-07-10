# Orchestration Checkpoint Log

This file records historical CP0-CP10 worktrees, the single-session CP11 foundation, and the master-orchestrated CP12-CP18 program.

## Baseline

- Repository path: `/Users/abhinavgupta/Desktop/ClinicOS`
- Remote target: `https://github.com/AbhinavGupta707/ClinicOS`
- Default branch: `main`
- Historical checkpoint plan: `clinic_os_specs_v2/20_ORCHESTRATION_CHECKPOINT_PLAN.md`
- Current checkpoint plan: `clinic_os_specs_v2/23_PRODUCTION_READINESS_REMEDIATION_PLAN.md`
- Current release decision: **NO-GO**
- CP11 result commit: `a6109bb`
- Credential-preflight ancestor: `858ec4c`; actual CP12 launch base is the clean `main` HEAD recorded immediately before worker creation
- Current orchestration program: `docs/orchestration/POST_CP11_WORKTREE_ORCHESTRATION_PROGRAM.md`
- CP12 launch base: exact clean `main` HEAD must be recorded after this planning change is committed

## Credential And Input Preflight - Updated 2026-07-10

- `.secrets/orchestration.env`: present, ignored by Git, and mode `0600`.
- Non-secret provider selections: `WHATSAPP_PROVIDER=simulator`, `PAYMENT_PROVIDER=simulator`, `TELEPHONY_PROVIDER=simulator`, `LLM_PROVIDER=simulator`, `TRANSCRIPTION_PROVIDER=simulator`.
- Synthetic input paths are configured for patients, appointments, pricebook, templates, X-ray sample directory, and synthetic-only pilot data.
- Local workspace check: `npm run check` passed.
- Node/npm: Node `v22.22.2`, npm `10.9.7`.
- Browser/mobile tooling: Playwright CLI `1.61.1` and Expo CLI `57.0.4` resolve with approved npm network access; Xcode `26.4` is installed.
- GitHub CLI: escalated `gh auth status -h github.com` verified `AbhinavGupta707` through the keyring on 2026-07-10 with `repo` and `workflow` scopes.
- AWS: `aws sts get-caller-identity --profile clinicos-human` verified account `222634407676` on 2026-07-10. Never fall back to the older `clinicos` profile. Backend bucket/lock-table identifiers remain only in the ignored secret handoff.
- Terraform CLI remains absent; CP14 must install/activate and version-pin it before Terraform evidence.
- Meta sandbox and Razorpay test credentials are stored locally, while both non-secret provider selectors remain `simulator`. Dashboard registration and official sandbox execution wait for CP15's deployed signed HTTPS callbacks and explicit authority.
- Worker credential boundary: existing and future workers never copy/read/source the secret handoff and never own live AWS/provider/dashboard operations; the master performs authorized external verification after integration.
- Historical worktrees: 12 CP8-CP10-era worktrees were checked on 2026-07-10; all were clean, all heads were ancestors of `main`, and none had a unique commit. They are excluded from CP12. Recheck before any reuse or deletion.
- Synthetic fixture paths for patients, appointments, pricebook, templates and X-ray/media samples were rechecked and exist.

## Checkpoints

| Checkpoint                                        | Status           |                    Base commit | Result commit | Notes                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ---------------- | -----------------------------: | ------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0 - Git and orchestration preflight               | Complete         |                repository root |   `main` HEAD | Local Git repo initialized on `main`, monorepo scaffold created, docs baseline committed, GitHub remote configured and pushed.                                                                                                                                                 |
| 1 - Production platform foundation                | Complete         |                      `447206a` |     `be619cd` | Data/Auth, Runtime/Workflow, Repo/DevEx, and Web Shell lanes merged. Master integration added responsive web hardening, bootable API/mobile shells, full CI evidence, and a verified local Docker stack. Pause before CP2 for project-scoped worktree sidebar visibility test. |
| 2 - Lead/patient/appointment/day-start            | Complete         |                      `5fe65da` |     `58bf864` | Visible project-scoped worker lanes merged into `codex/integration/checkpoint-2`. Master integration fixed lead-created patient matching, timeline projection evidence, live smoke actor headers, route aliasing, web selectors, and CP2 browser fixture alignment.            |
| 3 - Intake/consent/encounter/notes                | Complete         |                      `6fe2cbc` |     `eb68abd` | Visible project-scoped worker lanes merged into `codex/integration/checkpoint-3`. Master integration aligned live CP3 routes, consent enforcement, prep summary, QA fixtures, web selectors, browser smoke, and security/audit coverage.                                       |
| 4 - Dental charting/media/imaging                 | Complete         |                      `c7b222c` |     `248496a` | CP4 visible project-scoped lanes merged into `codex/integration/checkpoint-4` and promoted to `main`. Master integration reconciled dental/media schema, live dental APIs, media security, browser smoke alignment, and full repository gates.                                 |
| 5 - Treatment/checkout/payments                   | Complete         |                      `d3d341f` |     `d679a78` | CP5 visible project-scoped lanes merged into `codex/integration/checkpoint-5`, promoted to `main`, and followed by closeout docs commit `6f9fe1c`.                                                                                                                             |
| 6 - Continuity/operations/owner dashboard         | Complete         |                      `6f9fe1c` |     `08ddab9` | CP6 visible project-scoped lanes merged into `codex/integration/checkpoint-6`, verified, documented, promoted to `main`, and post-promotion format gate repaired.                                                                                                              |
| 7 - Live integrations/migration hardening         | Complete         |                      `e7139c4` |     `92fb2b9` | CP7 visible project-scoped lanes merged into `codex/integration/checkpoint-7`, master integration reconciled live provider health/dead-letter/migration contracts, and verified branch was promoted to `main`.                                                                 |
| 8 - Mobile capture and AI scribe/action proposals | Complete         |                      `983cca5` |     `8ac2dae` | CP8 visible project-scoped lanes merged into `codex/integration/checkpoint-8` and promoted to `main`. Master integration reconciled AI safety route contracts, consent blocking semantics, review-role browser gates, and fixture/live evidence boundaries.                    |
| 9 - Interoperability/security/ops hardening       | Complete         |                      `0dc9f91` |     `131300b` | CP9 visible project-scoped lanes merged into `codex/integration/checkpoint-9` and promoted to `main`; master integration reconciled Security route contracts, FHIR projection-only evidence, restore/load fixtures, and CP9 registered-unavailable browser smoke.              |
| 10 - Local/fixture release-candidate evidence     | Historical E1/E2 |                      `a2d6501` |     `226a7b0` | CP10 implementation was merged and remains regression evidence. The 2026-07-09 audit supersedes all pilot/production-readiness inference; current decision is NO-GO.                                                                                                           |
| 11 - Verification and durable data foundation     | E3 complete      |                      `1332d3c` |     `a6109bb` | Clean migration 014 database, 96 forced-RLS tenant tables, deterministic clock/type gates, atomic API/audit/outbox, least-privilege durable worker, truthful dependency readiness, two-pass runtime-ID smoke and rendered/Playwright evidence. Production remains NO-GO.       |
| 12 - Modular API and generated contracts          | Planned          | clean planning-complete `main` |       Pending | Three provisional foundation worktrees under one `gpt-5.6-sol` `xhigh` master; API modularization follows only after their interfaces freeze.                                                                                                                                  |

## Checkpoint 1 Closeout - 2026-07-06

- Final code commit: `be619cd`.
- Full CI: `npm run ci` passed. High-severity audit gate passed with moderate advisories remaining.
- Local stack: `npm run local:up` passed from clean Docker volumes; `npm run local:ps` showed Postgres/Redis healthy and Keycloak/Temporal/Temporal UI running.
- User checks:
  - Web desktop shell: `/private/tmp/clinicos-desktop-cdp-shell.png`.
  - Web mobile shell: `/private/tmp/clinicos-mobile-cdp-390.png`.
  - Web mobile unavailable Lead inbox: `/private/tmp/clinicos-mobile-cdp-lead-inbox-390.png`.
  - Mobile app shell web export: `/private/tmp/clinicos-mobile-app-cdp-390.png`.
- API smoke: local fixture `/health/ready` and `/v1/me` passed on `127.0.0.1:4100`.
- Before Checkpoint 2: run a project-scoped Codex worktree thread visibility test using `target.type = "project"` and `environment.type = "worktree"`; do not launch CP2 lanes until that is recorded.

## Project-Scoped Worktree Visibility Test - 2026-07-06

- Launch shape: `create_thread` with `target.type = "project"`, `projectId = "/Users/abhinavgupta/Desktop/ClinicOS"`, and `environment.type = "worktree"`.
- Pending worktree id: `local:baf9fdfd-a4a6-47d5-b90d-ab78e679c233`.
- Resolved thread id: `019f399c-96bc-7e50-90a4-c5b2fc83497f`.
- Resolved worktree path: `/Users/abhinavgupta/.codex/worktrees/d332/ClinicOS`.
- Thread title: `Verify CP2 worktree visibility`.
- Thread report: detached `HEAD`, clean status, running inside a Codex-managed worktree path.
- UI evidence: `/var/folders/dp/vpvxrph17r3fqqj5bk3cjbb80000gn/T/codex-shot-2026-07-06_23-47-42.png` shows the unpinned test thread under the `ClinicOS` project in the Codex sidebar.
- Result: use this exact project-scoped worktree launch path for Checkpoint 2+ worker lanes. Pinning is not required for project-sidebar visibility, but may still be used only if the user wants prominence.

## Checkpoint 1 Postmortem - 2026-07-06

- Retrospective: `docs/orchestration/CHECKPOINT_01_POSTMORTEM.md`.
- Durable project memory: `docs/AGENT_MEMORY.md`.
- Merge/integration runbook: `docs/orchestration/MERGE_INTEGRATION_RUNBOOK.md`.
- Main cause of the long integration pass: late acceptance gates and tooling readiness gaps, not non-isolated worker sessions.
- CP2 launch rule: project-scoped visible worktree threads, explicit shared-file ownership, early browser/tooling blocker checks, and lane-owned boot/smoke gates before merge.

## Checkpoint 2 Launch - 2026-07-07

- Launch packet: `docs/orchestration/CHECKPOINT_02_LEAD_PATIENT_APPOINTMENT.md`.
- Browser preflight: committed repo-local `@playwright/test` in `5fe65da` and confirmed cached Chromium.
- Integration branch rule: CP2 lane commits merge first into `codex/integration/checkpoint-2`; promote to `main` only after full code and user-perspective gates pass.
- Visible project-scoped worktree lanes launched:
  - Backend/Data: `019f39b0-7027-7ed3-a1c5-b492d6da4ff9`, `/Users/abhinavgupta/.codex/worktrees/d38e/ClinicOS`.
  - Contracts/Events: `019f39b0-703a-71b3-b15b-60cd2e4fb85c`, `/Users/abhinavgupta/.codex/worktrees/df37/ClinicOS`.
  - Frontend Workflow: `019f39b0-7027-7ed3-a1c5-b4a8bc5db4b6`, `/Users/abhinavgupta/.codex/worktrees/3ed5/ClinicOS`.
  - QA/Fixtures: `019f39b0-7036-75c3-8a75-85b0d8b93861`, `/Users/abhinavgupta/.codex/worktrees/14f1/ClinicOS`.

## Checkpoint 2 Closeout - 2026-07-07

- Detailed evidence: `docs/orchestration/CHECKPOINT_02_LEAD_PATIENT_APPOINTMENT.md`.
- Integration branch: `codex/integration/checkpoint-2`.
- Verified code commit: `58bf864`.
- Closeout docs commit: `docs: record checkpoint 2 verification`.
- Merge order:
  - Backend/Data: `9d5a353` merged `bed1192`.
  - Contracts/Events: `ac14dab` merged `a2eadf6`.
  - Frontend Workflow: `6618581` merged `2fa6b1c`.
  - QA/Fixtures: `5a5c419` merged `a945d3c`.
  - Lockfile reconciliation: `07d32c0`.
  - Master integration fixes: `cd120bc`, `58bf864`.
- Full checks passed: `npm run check`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
- CP2 checks passed: `node scripts/validate-cp2-fixtures.mjs`, `node --test tests/acceptance/*.test.mjs`, `node scripts/cp2-contract-smoke.mjs --dry-run`.
- Security checks passed: `npm run security:secrets`, `npm run security:audit` high-severity gate, and `git diff --check`. Moderate advisories remain in upstream Next/PostCSS, Temporal/protobufjs, and Expo/xcode/uuid paths.
- Live API smoke passed on `127.0.0.1:4100` with local dev fixture auth for lead capture, patient match/create, appointment conversion, confirmation, check-in, queue/dashboard reads, patient timeline evidence, accountant/doctor denials, and cross-tenant isolation denials.
- Browser smoke passed: `CLINICOS_CP2_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/checkpoint-2-assistant-flow.spec.ts`.
- Browser evidence:
  - Desktop: `/private/tmp/clinicos-cp2-web-desktop.png`.
  - Mobile 390px: `/private/tmp/clinicos-cp2-web-mobile-390.png`.
- Accepted gaps:
  - Live audit API probe is skipped until an audit read endpoint is merged; audit append and classification are covered by backend/security tests.
  - Browser accountant role smoke needs role-specific storage state files; API accountant denial passed and the web client now hides patient-create controls for profiles without patient-write roles.

## Checkpoint 3 Launch - 2026-07-07

- Launch packet: `docs/orchestration/CHECKPOINT_03_INTAKE_CONSENT_ENCOUNTER.md`.
- Base commit before launch packet: `6ba1fa5f8c0a5b8a058c33ca831494034d76c9e4`.
- Worker launch commit: `6fe2cbc`.
- Integration branch rule: CP3 lane commits merge first into `codex/integration/checkpoint-3`; promote to `main` only after full code, live local, and browser/user gates pass.
- Visible project-scoped lanes:
  - Clinical Backend: pending `local:ab246795-f811-4fb8-8059-6e7dec97cf1d`, thread `019f39f6-8c8d-7ed3-89d7-a0569652c1bb`, worktree `/Users/abhinavgupta/.codex/worktrees/81eb/ClinicOS`.
  - Security/Compliance: pending `local:8d887afa-acf7-410d-aa45-870a9962847b`, thread `019f39f6-c6ef-7691-af95-ef4be605d978`, worktree `/Users/abhinavgupta/.codex/worktrees/4436/ClinicOS`.
  - Doctor/Assistant UX: pending `local:9c49eb47-37a9-4d2c-8ea0-0a029a53fb13`, thread `019f39f7-0632-7800-9d41-f55b44f38dd0`, worktree `/Users/abhinavgupta/.codex/worktrees/75ee/ClinicOS`.
  - QA/Fixtures: pending `local:bc55a12e-149c-4828-a5e2-707857009fb9`, thread `019f39f7-54bd-72e1-a812-dd0fda503d06`, worktree `/Users/abhinavgupta/.codex/worktrees/08d3/ClinicOS`.

## Checkpoint 3 Closeout - 2026-07-07

- Detailed evidence: `docs/orchestration/CHECKPOINT_03_INTAKE_CONSENT_ENCOUNTER.md`.
- Integration branch: `codex/integration/checkpoint-3`.
- Verified code commit: `eb68abd`.
- Merge order:
  - Clinical Backend: `393e738` merged `f1e6fa2`.
  - Security/Compliance: `c8146ee` merged `4adc0d7`.
  - Doctor/Assistant UX: `62dd85d` merged `f4af47e`.
  - QA/Fixtures: `4c2453a` merged `60414f9`.
  - Master integration fixes: `eb68abd`.
- Full checks passed: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`.
- CP3 checks passed: `node scripts/validate-cp3-fixtures.mjs`, `node --test tests/acceptance/*.test.mjs`, `node scripts/cp3-contract-smoke.mjs --dry-run`.
- Security checks passed: `npm run security:secrets`, `npm run security:audit` high-severity gate, and `git diff --check`. Moderate advisories remain in upstream Next/PostCSS, Temporal/protobufjs, and Expo/xcode/uuid paths.
- Live local API smoke passed through `npm --workspace @clinic-os/api test` outside the sandbox with zero skips. It covered CP3 local HTTP intake, consent create/revoke, encounter start, note draft/sign/amend, prescription draft/sign, doctor-only signing, signed-note immutability, audit events, outbox events, and CP2 API boot smokes.
- Browser smoke passed:
  - `CLINICOS_CP3_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test apps/web/tests/checkpoint-3-clinical-workflow.spec.ts`.
  - `CLINICOS_CP3_ROLE_DENIAL_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3001 npx playwright test apps/web/tests/checkpoint-3-clinical-workflow.spec.ts --grep "clinical role denial"`.
  - Mirrored root spec: `tests/e2e/checkpoint-3-clinical-flow.spec.ts` workflow/mobile and role-denial greps both passed.
- Browser evidence:
  - Desktop doctor workflow: `/private/tmp/clinicos-cp3-web-doctor-desktop.png`.
  - Mobile 390px workflow: `/private/tmp/clinicos-cp3-web-mobile-390.png`.
- Accepted gaps:
  - Audit read API probe remains deferred; backend/security tests verify audit append/classification and PHI redaction.
  - AI/audio capture route remains deferred to a later checkpoint; CP3 verifies the consent-enforcement state later audio/AI workflows must consume.
  - `scripts/cp3-contract-smoke.mjs` live mode is for a deterministic CP3 fixture-loaded environment. The local fixture API intentionally generates runtime IDs, so local runtime evidence comes from API tests.

## Checkpoint 4 Launch - 2026-07-07

- Launch packet: `docs/orchestration/CHECKPOINT_04_DENTAL_CHART_MEDIA.md`.
- Base commit before launch packet: `c7b222c`.
- Integration branch rule: CP4 lane commits merge first into `codex/integration/checkpoint-4`; promote to `main` only after full code, live local, browser/user, and media security gates pass.
- Visible project-scoped lanes:
  - Media Backend: pending `local:026917af-501e-4550-adf0-518da69f4bc1`, thread `019f3a34-a5d9-78c1-a12c-25ce24bc9426`, worktree `/Users/abhinavgupta/.codex/worktrees/7725/ClinicOS`.
  - Dental Domain: pending `local:cc0a9c3a-6ecb-46b9-88bf-b49bfaff9dad`, thread `019f3a34-d36e-7680-b3cd-1ad47240f656`, worktree `/Users/abhinavgupta/.codex/worktrees/d4aa/ClinicOS`.
  - Dental/Media UX: pending `local:1e9a0c2e-a7e4-46eb-825b-04e504f9d8b3`, thread `019f3a35-0fd0-73e3-a35b-5c33f236a270`, worktree `/Users/abhinavgupta/.codex/worktrees/16fc/ClinicOS`.
  - Imaging/QA: pending `local:823af464-3b7b-4088-ae6c-881114572251`, thread `019f3a35-4418-7e93-91f6-7beffa65ac55`, worktree `/Users/abhinavgupta/.codex/worktrees/9cf9/ClinicOS`.

## Checkpoint 4 Closeout - 2026-07-07

- Detailed evidence: `docs/orchestration/CHECKPOINT_04_DENTAL_CHART_MEDIA.md`.
- Integration branch: `codex/integration/checkpoint-4`.
- Verified code commit: `2fd04a5`.
- Main promotion commit: `248496a`.
- Merge order:
  - Media Backend merged first.
  - Dental/Media UX merged second.
  - Imaging/QA merged third.
  - Dental Domain recovered commit `aa4bf5e` merged fourth with master conflict resolution.
  - Master integration patches added live dental API routes, CP4 dental tests, audit classifications, media schema folding, and browser smoke alignment.
- Full checks passed: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run check`, `npm run build`.
- CP4 checks passed: `node scripts/validate-cp4-fixtures.mjs`, `node scripts/cp4-contract-smoke.mjs --dry-run`, `node --test tests/acceptance/*.test.mjs`.
- Security checks passed: `npm run security:secrets`, `npm run security:audit` high-severity gate, and `git diff --cached --check`. Existing moderate upstream advisories remain in Next/PostCSS, Temporal/protobufjs, and Expo/xcode/uuid dependency paths.
- Live API smoke passed on `127.0.0.1:4100` for health, encounter create, dental finding create/update/history/chart snapshot/chart read, object-key privacy, accountant denial, and wrong-tenant denial.
- Browser smoke passed for desktop, 390px mobile, and accountant role denial. Evidence screenshots:
  - `/private/tmp/clinicos-cp4-web-doctor-desktop.png`
  - `/private/tmp/clinicos-cp4-web-mobile-390.png`
- Accepted gaps:
  - External imaging-link route family remains a deferred whole workflow; CP4 durable media routes cover upload, completion, listing, and mediated signed access.
  - Bulk multi-tooth chart patching is deferred; CP4 supports complete one-finding-per-row create/update/history/snapshot behavior.
  - Temporary UI was checked for safety and responsive invariants rather than final visual polish.

## Checkpoint 4 Re-Verification - 2026-07-07

- Critical audit before resuming CP5 found one real CP4 integration gap: the backend durable media routes were correct, but the web live helper and navigation metadata still named older media routes (`/v1/media/complete-upload`, `/v1/media/{mediaId}/links`, `/v1/media/{mediaId}/signed-access`).
- Patched web live media attachment/viewing to use the durable CP4 route sequence: `POST /v1/media/upload-urls`, `PUT /v1/media/uploads/{uploadId}/content`, `POST /v1/media/uploads/{uploadId}/complete`, and `POST /v1/media/assets/{mediaAssetId}/signed-url`.
- Live external imaging links remain deferred as a whole workflow. CP4 fixture evidence continues to preserve DICOM/external-reference coexistence, but the live web client now fails honestly for external-link attachment instead of inventing a partial route.
- Regression coverage added in `apps/web/tests/cp4-workflow.test.ts` for the exact live route sequence and deferred external-link behavior.
- Re-checks passed: `npm --workspace @clinic-os/web test -- cp4-workflow.test.ts`, `npm --workspace @clinic-os/web run typecheck`, `npm --workspace @clinic-os/web run lint`, `npm --workspace @clinic-os/web test`, and `git diff --check`.
- Full gates passed after the patch: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run security:secrets`, `npm run build`, `npm run check`, `node scripts/validate-cp4-fixtures.mjs`, `node scripts/cp4-contract-smoke.mjs --dry-run`, and `node --test tests/acceptance/cp4-fixture-contract.test.mjs`.
- Browser re-smoke passed after the patch for doctor/assistant desktop, doctor/assistant 390px mobile, and accountant role denial. Refreshed screenshots: `/private/tmp/clinicos-cp4-web-doctor-desktop.png` and `/private/tmp/clinicos-cp4-web-mobile-390.png`.
- `npm run security:audit` was not rerun: sandbox DNS failed for `registry.npmjs.org`, and escalation was policy-rejected because the audit sends dependency inventory to an external service. The prior CP4 high-severity audit evidence remains recorded in the closeout above.

## Checkpoint 4 Current-Tree Verification - 2026-07-07

- A later critical audit found one verification-artifact gap, not a new product-route implementation gap: `scripts/cp4-contract-smoke.mjs` and `tests/acceptance/cp4-fixture-contract.test.mjs` still let the CP4 dry-run plan describe legacy media routes (`/media/upload-url`, `/complete-upload`, `/links`, `/signed-access`) that are not the canonical live CP4 API.
- Patched the CP4 smoke plan to exercise the actual durable media route family with dynamic upload/media IDs and raw content upload: `POST /v1/media/upload-urls`, `PUT /v1/media/uploads/{uploadId}/content`, `POST /v1/media/uploads/{uploadId}/complete`, `GET /v1/patients/{patientId}/media`, and `POST /v1/media/assets/{mediaAssetId}/signed-url`.
- The smoke plan now explicitly separates four fixture-only deferred imaging/link evidence steps from live API smoke rather than treating deferred routes as implemented product behavior.
- Re-checks passed: `node scripts/validate-cp4-fixtures.mjs`, `node scripts/cp4-contract-smoke.mjs --dry-run`, `node --test tests/acceptance/cp4-fixture-contract.test.mjs`, `npm --workspace @clinic-os/web test -- cp4-workflow.test.ts`, `git diff --check`, `npm run check`, `npm run security:secrets`, `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
- `npm run security:audit` was still not rerun because it discloses dependency inventory to the external npm registry audit service and prior escalation was rejected. Use the recorded CP4 high-severity audit evidence unless the user explicitly approves rerunning that external audit.

## Checkpoint 5 Launch - 2026-07-07

- Launch packet: `docs/orchestration/CHECKPOINT_05_TREATMENT_CHECKOUT_PAYMENTS.md`.
- Base commit before launch packet: `1e6e3cb`.
- Credential/input preflight: `.secrets/orchestration.env` is present; payment provider variables and Razorpay key/secret/webhook secret names are present; `RAZORPAY_WEBHOOK_URL` is empty, so live hosted webhook registration is deferred until deployment owns an HTTPS callback.
- Integration branch rule: CP5 lane commits merge first into `codex/integration/checkpoint-5`; promote to `main` only after full code, live local, browser/user, payment security, and docs gates pass.
- Visible project-scoped lanes planned:
  - Billing Domain.
  - Payment Provider.
  - Checkout UX.
  - Clinical Output QA.

## Checkpoint 5 Launch Blocker - 2026-07-07

- CP5 launch commit: `f495c02`.
- Attempted documented launch shape: `target.type = "project"`, `projectId = "/Users/abhinavgupta/Desktop/ClinicOS"`, `environment.type = "worktree"`.
- Created worktrees/threads:
  - Billing Domain: pending `local:a52e7c05-cc94-4402-a5e9-81813fbb6cc9`, thread `019f3a78-1296-7181-b6c0-4bd718b77880`, worktree `/Users/abhinavgupta/.codex/worktrees/5b11/ClinicOS`.
  - Payment Provider: pending `local:f5ea13e2-dc84-4670-aec6-76a01eda862b`, thread `019f3a78-5814-7f13-8e82-b621dbf0d218`, worktree `/Users/abhinavgupta/.codex/worktrees/fd39/ClinicOS`.
  - Checkout UX: pending `local:0c746ebb-eb92-40f9-8b06-fcadda99fabc`, thread `019f3a78-9489-7f91-ad96-338c8933028b`, worktree `/Users/abhinavgupta/.codex/worktrees/8a54/ClinicOS`.
  - Clinical Output QA: pending `local:6770c7ad-26d3-4dda-8cd8-49e768801e7f`, thread `019f3a78-cf86-7c61-8bf1-7738310bcc3e`, worktree `/Users/abhinavgupta/.codex/worktrees/7b0f/ClinicOS`.
  - Replacement Billing retry: pending `local:e080d56d-7c8e-4aed-9ff5-2dff7516bc39`, thread `019f3a79-c12d-7363-aa9e-2451f4f90864`, worktree `/Users/abhinavgupta/.codex/worktrees/5122/ClinicOS`.
- Git/worktree layer is healthy: the replacement Billing worktree is detached at `f495c02` and contains the full checkout.
- Background worker execution failed: `read_thread` showed only user/delegation turns and status `systemError`; no assistant implementation turn started.
- Local Codex log evidence for the replacement Billing thread: `Turn error: You've hit your usage limit. Upgrade to Plus to continue using Codex (https://chatgpt.com/explore/plus), or try again at Aug 6th, 2026 3:33 AM.`
- A medium-reasoning retry produced the same usage-limit error.
- Result: CP5 is blocked before implementation. Resume by clearing the account/model usage limit, then relaunch project-scoped worktree lanes from `main` or send a fresh follow-up to the replacement lanes if Codex supports resuming system-error threads.

## Checkpoint 5 Relaunch - 2026-07-07

- Relaunch base: `d3d341f` (`fix(web): align cp4 media live routes`), after CP4 re-verification.
- Launch shape: `target.type = "project"`, `projectId = "/Users/abhinavgupta/Desktop/ClinicOS"`, `environment.type = "worktree"`, starting from branch `main`.
- Fresh visible project-scoped lanes:
  - Billing Domain: pending `local:57f1e52c-12d3-4712-bb03-c460eae56e42`, thread `019f3bcc-2145-7dc0-9518-dc8477e86b51`, worktree `/Users/abhinavgupta/.codex/worktrees/a598/ClinicOS`.
  - Payment Provider: pending `local:42818d80-8709-4a09-9e19-107c519db2e3`, thread `019f3bcc-213b-7191-8424-2856a60a85a0`, worktree `/Users/abhinavgupta/.codex/worktrees/fae5/ClinicOS`.
  - Checkout UX: pending `local:e7a4b597-aa4a-4a50-9543-9c1da12ff7d1`, thread `019f3bcc-213b-7191-8424-284dd78c7323`, worktree `/Users/abhinavgupta/.codex/worktrees/82db/ClinicOS`.
  - Clinical Output QA: pending `local:8997eec3-d82f-4348-b27d-b4349d72ab19`, thread `019f3bcc-216e-79b3-bd9d-db6d77e928a5`, worktree `/Users/abhinavgupta/.codex/worktrees/1f2d/ClinicOS`.
- All four fresh lanes resolved as active in `list_threads`; the old `CP5 FAILED - ...` threads remain historical and must not be integrated.

## Checkpoint 5 Integration Verification - 2026-07-07

- Integration branch: `codex/integration/checkpoint-5`.
- Verified integration patch commit: `353e2bc`.
- Main promotion merge commit: `d679a78`.
- Merge order:
  - Billing Domain commit `86e8669` merged first.
  - Payment Provider commit `6ed5350` merged second with master conflict resolution into the canonical billing repository/payment provider contract.
  - Checkout UX commit `2dca52f` merged third.
  - Clinical Output QA commit `6d88749` merged fourth with root E2E selector/body assertions reconciled to the implemented checkout surface.
- Master integration patch added the missing durable patient-instruction workflow: domain types, permission, migration table/RLS/no-fake-delivery constraint, local and Postgres repository methods, API operation, route registration, audit/outbox/timeline evidence, and API tests.
- Master integration patch also corrected CP5 web live helper contract drift: treatment plan phase/body mapping, procedure evidence item id, payment `amountMinor`/`requestType`, manual payment evidence, receipt request shape, and explicit `CP5_READ_MODEL_DEFERRED` for the deferred aggregate read model.
- Targeted checks passed: `npm --workspace @clinic-os/domain test`, `npm --workspace @clinic-os/security test`, `npm --workspace @clinic-os/db run typecheck`, `npm --workspace @clinic-os/api run typecheck`, `npm --workspace @clinic-os/api test`, `npm --workspace @clinic-os/web run typecheck`, `npm --workspace @clinic-os/web test`, `npm --workspace @clinic-os/db test`, `node scripts/validate-cp5-fixtures.mjs`, `node scripts/cp5-contract-smoke.mjs --dry-run`, and `node --test tests/acceptance/cp5-fixture-contract.test.mjs`.
- Full gates passed before promotion: `git diff --check`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run check`, `npm run security:secrets`, and `node --test tests/acceptance/*.test.mjs`.
- Browser smoke passed against the CP5 fixture:
  - Assistant checkout workflow and 390px mobile no-overflow smoke: `CLINICOS_CP5_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test apps/web/tests/checkpoint-5-checkout-workflow.spec.ts tests/e2e/checkpoint-5-checkout-flow.spec.ts`.
  - Accountant-safe billing view: `CLINICOS_CP5_ACCOUNTANT_SMOKE_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3001 npx playwright test apps/web/tests/checkpoint-5-checkout-workflow.spec.ts tests/e2e/checkpoint-5-checkout-flow.spec.ts --grep "accountant"`.
  - Screenshots refreshed: `/private/tmp/clinicos-cp5-web-checkout-desktop.png` and `/private/tmp/clinicos-cp5-web-checkout-mobile-390.png`.
- `npm run security:audit` did not pass because sandbox DNS failed for `registry.npmjs.org`; escalation was policy-rejected because npm audit discloses dependency inventory to an external registry audit service. Do not rerun through an alternate path without explicit user approval for that disclosure.
- Accepted gaps:
  - Live hosted Razorpay webhook callback registration remains deferred until deployment owns a reachable HTTPS callback; provider verification/idempotent replay is covered by simulator/contract tests.
  - Production aggregate CP5 checkout read model is deferred as a whole workflow. The temporary web checkout surface uses explicit local fixture mode, while granular CP5 API routes are implemented and tested.

## Checkpoint 6 Launch - 2026-07-07

- Launch packet: `docs/orchestration/CHECKPOINT_06_CONTINUITY_OPERATIONS_OWNER_DASHBOARD.md`.
- Base commit before launch packet: `6f9fe1c` (`docs: record checkpoint 5 promotion`).
- Worker launch commit: `7fefa31` (`docs: clarify checkpoint 6 migration ownership`).
- Credential/input preflight: `.secrets/orchestration.env` is present; WhatsApp provider variables are present locally but must not be printed or committed; `.env.example` declares `TEMPORAL_ADDRESS`.
- Integration branch rule: CP6 lane commits merge first into `codex/integration/checkpoint-6`; promote to `main` only after full code, deterministic workflow, browser/user, docs, and accepted-gap gates pass.
- Visible project-scoped lanes launched:
  - Workflow/Task Backend: pending `local:6c3ba047-cd82-491b-9566-1486b4c36082`, thread `019f3c1d-1708-7893-bfd7-1329dff99220`, worktree `/Users/abhinavgupta/.codex/worktrees/dbc7/ClinicOS`.
  - Lab/Inventory/Event: pending `local:cc373996-d87c-472b-9ca1-8fb8846722aa`, thread `019f3c1d-6d96-7310-ba40-bed750544a62`, worktree `/Users/abhinavgupta/.codex/worktrees/0166/ClinicOS`.
  - Operations UX: pending `local:e2d1fbe3-7bbc-4af4-b3fa-a0e27c1b9d52`, thread `019f3c1d-b7c5-7a32-8ee4-a1669e58aa73`, worktree `/Users/abhinavgupta/.codex/worktrees/9f26/ClinicOS`.
  - Analytics/QA: pending `local:a6a0b27a-81a2-4527-9041-9a1e721cc2aa`, thread `019f3c1e-1658-7aa2-ab3a-ca5135838beb`, worktree `/Users/abhinavgupta/.codex/worktrees/4ff2/ClinicOS`.

## Checkpoint 6 Integration Verification - 2026-07-07

- Integration branch: `codex/integration/checkpoint-6`.
- Verified integration merge head before evidence docs: `c1485b5`.
- Evidence docs commit: `d9bb50b`.
- Main promotion merge commit: `af93fde`.
- Final CP6 post-promotion code/check fix: `08ddab9` (`fix(cp6): format contract smoke script`).
- Merge order:
  - Workflow/Task Backend commit `bdfb4d8` merged first.
  - Lab/Inventory/Event commit `eea10e4` merged second with master conflict resolution across permissions, events, audit classes, API routes, repositories, and fixture data.
  - Analytics/QA commit `db2d33f` merged third with owner-dashboard task projections reconciled to the canonical continuity task model.
  - Operations UX commit `beeeea0` merged fourth after backend and dashboard contracts were stable.
- Master conflict decisions:
  - Preserved two separate CP6 migrations: `0006_continuity_tasks_recalls_sops.sql` for continuity/tasks/SOPs and `0007_lab_inventory_events.sql` for lab, inventory, and quality-event workflows.
  - Kept domain task types canonical in `packages/domain/src/continuity.ts`; owner-dashboard analytics imports those types instead of carrying a parallel task shape.
  - Unioned CP6 route, permission, audit, outbox, and local fixture contracts rather than choosing one lane's partial view.
  - Browser fixture smoke requires both the dev identity fixture and CP6 operations fixture flags; missing flags are treated as a setup error, not product evidence.
- Targeted checks passed during integration: `npm --workspace @clinic-os/domain test`, `npm --workspace @clinic-os/security test`, `npm --workspace @clinic-os/db run typecheck`, `npm --workspace @clinic-os/api run typecheck`, `npm --workspace @clinic-os/db test`, `npm --workspace @clinic-os/api test`, `npm --workspace @clinic-os/web test`, `npm --workspace @clinic-os/web run typecheck`, `npm --workspace @clinic-os/web run lint`, and `npm --workspace @clinic-os/web run build`.
- Contract and fixture checks passed: `node scripts/validate-cp6-fixtures.mjs`, `node --test tests/acceptance/cp6-fixture-contract.test.mjs`, and `node scripts/cp6-contract-smoke.mjs --dry-run`.
- Full repository gates passed before promotion: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run security:secrets`, and `git diff --check`.
- Post-promotion guard: `npm run check` initially found a Prettier-only formatting issue in `scripts/cp6-contract-smoke.mjs`; commit `08ddab9` applied the mechanical format fix, then `npm run check` and `git diff --check` passed on `main`.
- Browser/user smoke passed against the CP6 fixture using `CLINICOS_CP6_E2E_ENABLED=true`, `CLINICOS_CP6_OWNER_SMOKE_ENABLED=true`, `NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true`, `NEXT_PUBLIC_CLINIC_OS_USE_CP6_OPERATIONS_FIXTURE=true`, and `CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000`: `npx playwright test tests/e2e/checkpoint-6-operations-flow.spec.ts`.
- Browser evidence screenshots:
  - `/private/tmp/clinicos-cp6-operations-desktop.png`.
  - `/private/tmp/clinicos-cp6-operations-mobile-390.png`.
  - `/private/tmp/clinicos-cp6-owner-control.png`.
- Accepted gaps:
  - Full live CP6 contract smoke without `--dry-run` requires a running API base URL supplied by `--base-url` or `CLINICOS_CP6_API_BASE_URL`; the dry-run contract passed and the live-base smoke is deferred until a local/live API target is explicitly running for that check.
  - `npm run security:audit` was not rerun because prior escalation for npm audit was policy-rejected; npm audit sends dependency inventory to the external registry audit service. Local tracked-file secret scan passed.
  - The current operations UI remains temporary. Browser/mobile testing is still mandatory for route registration, role gates, reachable controls, honest unavailable states, and no 390px overflow, but final visual polish is deferred to the later design pass.

## Checkpoint 7 Launch - 2026-07-07

- Launch packet: `docs/orchestration/CHECKPOINT_07_LIVE_INTEGRATIONS_MIGRATION_HARDENING.md`.
- Base commit before launch packet: `e7139c4`.
- Credential/input preflight: `.secrets/orchestration.env` is present; WhatsApp/Meta sandbox variables are present; Razorpay sandbox variables are present but `RAZORPAY_WEBHOOK_URL` is empty; Exotel-style telephony variables and Google Business Profile variables are missing/empty.
- Integration branch rule: CP7 lane commits merge first into `codex/integration/checkpoint-7`; promote to `main` only after code checks, provider no-key/sandbox checks, migration conflict tests, browser/user evidence, docs, and accepted-gap review pass.
- Visible project-scoped lanes launched:
  - Messaging Provider: pending `local:3dace615-d0fc-404d-b5cf-55a4f8160e05`, thread `019f3c69-e395-7f43-85e0-9513a2546ad6`, worktree `/Users/abhinavgupta/.codex/worktrees/aa0f/ClinicOS`.
  - Telephony/Source: pending `local:480585d3-3208-4e03-9377-ff468927e57b`, thread `019f3c6a-2d9c-7c01-bbad-d95e05fdcf9c`, worktree `/Users/abhinavgupta/.codex/worktrees/046c/ClinicOS`.
  - Migration/Data: pending `local:e2e401d4-7304-4cbf-9b5d-fb87c28b44f1`, thread `019f3c6a-655d-7223-8cf2-8cde3cf10b80`, worktree `/Users/abhinavgupta/.codex/worktrees/9644/ClinicOS`.
  - Integration Ops/QA: pending `local:6c4aa04d-328a-415f-ad92-21d4bf54c75a`, thread `019f3c6a-9b72-7642-ab14-ce002f1d9511`, worktree `/Users/abhinavgupta/.codex/worktrees/386a/ClinicOS`.

## Checkpoint 7 Integration Verification - 2026-07-07

- Integration branch: `codex/integration/checkpoint-7`.
- Main promotion merge commit: `92fb2b9`.
- Master integration patch commit: `c193b81`.
- Merge order:
  - Messaging Provider commit `9ce137a` merged first.
  - Telephony/Source commit `945c248` merged second.
  - Migration/Data commit `9aa5a29` merged third with master conflict resolution in domain exports/package metadata so source-attribution and migration/provider-event modules were both preserved.
  - Integration Ops/QA commit `f839d03` merged fourth.
- Master integration patch added live CP7 route registration and repository support for:
  - `GET /v1/provider-health`.
  - `GET /v1/dead-letter-events?status=unreviewed`.
  - `POST /v1/dead-letter-events/{deadLetterEventId}/replay`.
  - `GET /v1/migration-batches?status=needs_review`.
  - Existing canonical row resolution: `POST /v1/migration-batches/{migrationBatchId}/rows/{rowId}/resolve`.
- Master integration patch corrected the stale Ops/QA fixture/web route assumption from conflict-centered resolution to row-centered migration resolution. The web live helper now normalizes backend migration batch/detail payloads instead of relying on fixture-shaped migration cards.
- Dead-letter replay records an audited replay request and outbox event, but does not mark provider delivery/read state or patient workflow state as complete without handler evidence.
- Provider-health surfaces use real provider adapter health checks where configured, keep local simulators visibly local/unconfigured for the CP7 ops dashboard, and retain Google/manual import as explicit manual/unavailable states.
- Targeted checks passed: `npm --workspace @clinic-os/domain run typecheck`, `npm --workspace @clinic-os/db run typecheck`, `npm --workspace @clinic-os/api run typecheck`, `npm --workspace @clinic-os/web test -- cp7-integration-ops`, `node scripts/validate-cp7-fixtures.mjs`, `node scripts/cp7-contract-smoke.mjs --dry-run`, `npm --workspace @clinic-os/api test -- cp7-migration.test.ts`, `npm --workspace @clinic-os/db test`, `npm --workspace @clinic-os/web run typecheck`, `npm --workspace @clinic-os/web run lint`, `npm --workspace @clinic-os/api run lint`, `npm --workspace @clinic-os/db run lint`, `npm --workspace @clinic-os/web run build`, and `npm run build:shared`.
- Full repository gates passed before promotion: `npm run typecheck`, `npm run test`, `npm run lint`, `npm run security:secrets`, and `git diff --check`.
- Browser/user smoke passed against the CP7 fixture:
  - `CLINICOS_CP7_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/checkpoint-7-integration-ops-flow.spec.ts`.
  - Desktop provider/dead-letter/migration workflow passed.
  - 390px mobile reachability/no-horizontal-overflow smoke passed.
- Accepted gaps:
  - Hosted Meta/Razorpay/telephony callbacks remain deferred until deployment owns verified HTTPS callback registration.
  - Google Business Profile live API remains deferred as a whole workflow; CP7 preserves manual source attribution without a live Google dependency.
  - Fixture browser smoke proves UI safety/responsiveness and route assumptions; live route implementation is covered by API operations tests because deterministic CP7 fixture IDs are not seeded into every API runtime.

## Checkpoint 8 Launch - 2026-07-07

- Launch packet: `docs/orchestration/CHECKPOINT_08_MOBILE_CAPTURE_AI_SCRIBE.md`.
- Base commit before launch packet: `983cca5`.
- Worker launch base after CP4 current-tree verification: `ac7211d`.
- Credential/input preflight: `.secrets/orchestration.env` is present; live AI/STT provider keys and data-residency/retention approvals must not be assumed. CP8 proceeds with deterministic fixtures and provider simulators unless explicit live-provider approval exists.
- Integration branch rule: CP8 lane commits merge first into `codex/integration/checkpoint-8`; promote to `main` only after code checks, AI safety checks, mobile/browser user checks, docs, and accepted-gap review pass.
- Visible project-scoped lanes launched from `main`:
  - Mobile Capture: pending `local:bad96d1e-eaf1-41f4-8d8f-4ab52f7ba245`, thread `019f3cb7-ee10-7c83-a5c1-1407c64a7158`, worktree `/Users/abhinavgupta/.codex/worktrees/834a/ClinicOS`.
  - AI Backend: pending `local:ce740f13-db5a-412f-8a51-f26cbd27897a`, thread `019f3cb8-2e5c-7dd1-8865-02823428698c`, worktree `/Users/abhinavgupta/.codex/worktrees/0b3b/ClinicOS`.
  - Review UX: pending `local:989b9a6e-5e81-4271-a46d-380130d35c50`, thread `019f3cb8-6e4e-73d3-9754-9cbd5aa583d9`, worktree `/Users/abhinavgupta/.codex/worktrees/fc5f/ClinicOS`.
  - AI Safety/QA: pending `local:e4023aec-09ec-4659-8001-fa11db2751a4`, thread `019f3cb8-a9ea-79b2-9edd-d44513a60668`, worktree `/Users/abhinavgupta/.codex/worktrees/25b2/ClinicOS`.
- Superseded duplicate Mobile Capture thread `019f3cab-83a6-7d42-8813-7829e961a04f` from earlier base `f562a8e` was marked superseded and archived; do not integrate it.

## Checkpoint 8 Integration Verification - 2026-07-07

- Integration branch: `codex/integration/checkpoint-8`.
- Verified integration patch commit: `f967144`.
- Main promotion merge commit: `8ac2dae`.
- Merge order:
  - AI Backend commit `4b00076` merged first with migration, domain, repository, API, security, and simulator AI provider contracts.
  - Mobile Capture commit `ea8a6a2` merged second with Expo capture shell, durable CP4 media upload queue contract, secure cache abstractions, and audio-consent disabled state.
  - Review UX commit `f2a192e` merged third with the web AI review surface, role-aware review decisions, and honest unavailable state for non-fixture aggregate queue mode.
  - AI Safety/QA commit `b38b6b8` merged fourth with deterministic CP8 safety fixtures, validator, dry-run smoke, E2E specs, and QA notes.
- Master integration patch `f967144` reconciled the CP8 safety dry-run from stale `/v1/ai/...` route assumptions to the canonical `ai-scribe` route family, aligned missing/revoked consent to HTTP `409` workflow-state blocking, removed fake web mobile-capture route assumptions, and gated role-specific Playwright assertions by `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE`.
- Targeted CP8 checks passed on the integration branch: `node scripts/validate-cp8-fixtures.mjs`, `node --test tests/acceptance/cp8-fixture-contract.test.mjs`, `node scripts/cp8-contract-smoke.mjs --dry-run`, `npm --workspace @clinic-os/mobile run typecheck`, `npm --workspace @clinic-os/mobile test`, `npm --workspace @clinic-os/web run typecheck`, `npm --workspace @clinic-os/web test`, `npm --workspace @clinic-os/web run lint`, `npm --workspace @clinic-os/api test`, and `node --test tests/acceptance/*.test.mjs`.
- Full repository gates passed before promotion: `git diff --check`, `npm run check`, `npm run security:secrets`, `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
- Browser/mobile user smoke passed:
  - Doctor review and 390px mobile review: `CLINICOS_CP8_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3002 NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=doctor npx playwright test apps/web/tests/checkpoint-8-ai-review-workflow.spec.ts --grep "doctor reviews|mobile AI review"`.
  - Root AI safety review flow: `CLINICOS_CP8_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3002 NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=doctor npx playwright test tests/e2e/checkpoint-8-ai-safety-flow.spec.ts`.
  - Assistant review boundary: `CLINICOS_CP8_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3002 NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant npx playwright test apps/web/tests/checkpoint-8-ai-review-workflow.spec.ts --grep "assistant sees"`.
  - Mobile lane Expo web smoke at 390px passed in the worker lane.
- Browser evidence screenshots:
  - `/private/tmp/clinicos-cp8-ai-review-doctor-desktop.png`.
  - `/private/tmp/clinicos-cp8-ai-review-assistant-desktop.png`.
  - `/private/tmp/clinicos-cp8-ai-review-mobile-390.png`.
  - `/private/tmp/clinicos-cp8-mobile-capture-web-390.png`.
- Accepted gaps:
  - Live AI/STT provider activation remains deferred until an approved provider key, no-training/no-retention posture, data-residency approval, and explicit activation exist.
  - The web aggregate review queue route is not configured by default. Non-fixture web mode shows an honest unavailable state unless `NEXT_PUBLIC_CLINIC_OS_CP8_REVIEW_QUEUE_PATH` and per-item `reviewDecisionHref` are supplied by a real backend/integration owner.
  - Clinical application of AI outputs remains deferred as whole workflows. CP8 records review-only decisions and retains evaluation/audit evidence; it does not sign notes, mutate chart findings, prescribe, bill, or message patients from AI output.
  - Expo/mobile app distribution and physical-device camera/audio smoke remain deferred; local Expo shell/export and mobile tests verify the capture contract and consent disabled behavior.
  - `npm run security:audit` was not rerun because prior escalation was policy-rejected: npm audit discloses dependency inventory to the external registry audit service. The tracked-file secret scan passed.

## Checkpoint 9 Launch - 2026-07-07

- Launch packet: `docs/orchestration/CHECKPOINT_09_INTEROPERABILITY_SECURITY_OPS.md`.
- Base commit before launch packet: `0dc9f91`.
- Credential/input preflight: `.secrets/orchestration.env` is present; AWS local profile/region/DR/backend variable names are present; ABDM variable names are present but empty; pilot export path variables and synthetic-only flag are present. Do not print secret values.
- Integration branch rule: CP9 lane commits merge first into `codex/integration/checkpoint-9`; promote to `main` only after code checks, FHIR/export/privacy/security checks, restore/performance/tenant-isolation evidence, browser/user evidence for implemented UI, docs, and accepted-gap review pass.
- Visible project-scoped lanes planned:
  - Security/Privacy: pending `local:8e4b76f0-2035-4afa-8a47-d65138239c7a`, thread `019f3cec-36fc-7390-a841-bf11cb1a669c`, worktree `/Users/abhinavgupta/.codex/worktrees/6d89/ClinicOS`.
  - FHIR/ABDM: pending `local:980187fa-bbd5-4364-86b2-511e38068b73`, thread `019f3cec-83b6-7383-81f5-e14f267d2392`, worktree `/Users/abhinavgupta/.codex/worktrees/1238/ClinicOS`.
  - Infrastructure/Ops: pending `local:7bab86b2-b4af-4585-91bd-187a2939d141`, thread `019f3cec-d3a3-7a71-ba13-ab7ceaf09f69`, worktree `/Users/abhinavgupta/.codex/worktrees/7e8c/ClinicOS`.
  - Performance/QA: pending `local:2aea50c5-e05d-4e0b-a16d-5f5ec6852393`, thread `019f3ced-1911-78e1-9301-ce5df9e8e934`, worktree `/Users/abhinavgupta/.codex/worktrees/1091/ClinicOS`.
- All four CP9 worker worktrees resolved at base commit `6697df4`.

## Checkpoint 9 Integration Verification - 2026-07-07

- Integration branch: `codex/integration/checkpoint-9`.
- Verified integration head: `ea13a97`.
- Main promotion merge commit: `131300b`.
- Merge order:
  - Security/Privacy commit `5689952` merged first as `b24fccd`.
  - FHIR/ABDM commit `23ccc4b` merged second as `efdcf9e`.
  - Infrastructure/Ops commit `cf21cd0` merged third as `b69775f`.
  - Performance/QA commit `38a9afa` merged fourth as `fca9509`.
  - Master integration patch `ea13a97` reconciled CP9 QA live/dry-run route assumptions, formatted smoke scripts, and tightened browser smoke locators.
- Product scope landed:
  - Patient record export, deletion request, retention run, audit review, and break-glass request/review API foundations with tenant scope, permissions, audit/outbox evidence, and PHI/storage redaction.
  - CP9 migration `0010_security_privacy_ops.sql` for audit reviews, data exports, deletion requests, retention runs/actions, and break-glass hardening with RLS and safety constraints.
  - FHIR R4-shaped projection package and ABDM readiness model. ABDM remains no-live-calls with empty credentials producing `not_configured`/`unavailable` and `liveExchangeAllowed: false`.
  - Config/observability hardening, provider-health alert catalog, Terraform pilot-prod validation-only profile, and synthetic restore-drill runbooks/scripts.
  - CP9 fixture, contract, tenant-isolation, load, and browser-smoke harnesses aligned to canonical merged routes.
- Targeted checks passed: `npm --workspace @clinic-os/domain test`, `npm --workspace @clinic-os/security test`, `npm --workspace @clinic-os/db test`, `npm --workspace @clinic-os/api test`, `npm --workspace @clinic-os/api run typecheck`, `npm --workspace @clinic-os/fhir test`, `npm --workspace @clinic-os/fhir run lint`, `npm --workspace @clinic-os/fhir run build`, `npm --workspace @clinic-os/config test`, `npm --workspace @clinic-os/observability test`, `node scripts/cp9-restore-drill.test.mjs`, and `node scripts/check-cp9-terraform-profile.mjs`.
- CP9 evidence checks passed: `node scripts/validate-cp9-fixtures.mjs`, `node scripts/cp9-contract-smoke.mjs --dry-run`, `node scripts/cp9-load-smoke.mjs --dry-run`, `node --test tests/acceptance/cp9-fixture-contract.test.mjs tests/acceptance/cp9-fhir-fixture-contract.test.mjs`, and `node scripts/cp9-restore-drill.mjs --dry-run --evidence-out /tmp/clinicos-cp9-restore-drill-integration.json`.
- Full repository gates passed: `git diff --check`, `npm run check`, `npm run security:secrets`, `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
- Post-promotion checks on `main` passed: `git diff --check` and `npm run check`.
- Browser/user smoke passed:
  - Owner compliance unavailable shell and 390px mobile no-overflow: `CLINICOS_CP9_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3109 NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner npx playwright test tests/e2e/checkpoint-9-performance-qa-flow.spec.ts`.
  - Platform-support unavailable shell: `CLINICOS_CP9_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3109 NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=platform_admin npx playwright test tests/e2e/checkpoint-9-performance-qa-flow.spec.ts`.
  - Screenshots written by the owner smoke: `/private/tmp/clinicos-cp9-compliance-unavailable-desktop.png` and `/private/tmp/clinicos-cp9-compliance-unavailable-mobile-390.png`.
- Accepted gaps:
  - `npm run security:audit` was not rerun because prior escalation was policy-rejected: npm audit discloses dependency inventory to the external registry audit service.
  - ABDM live sandbox/production exchange remains deferred until credentials, approvals, and compliance activation exist.
  - Terraform apply, cloud resource creation, and live restore/failover drills remain deferred pending explicit approval and a production runbook execution window.
  - FHIR is implemented as a package-level projection and fixture validation foundation; no live FHIR API route is claimed in CP9.
  - CP9 compliance/platform web surfaces remain registered-unavailable shells. They honestly show required API boundaries and do not render fake export, audit, FHIR, break-glass, or tenant-diagnostic product data.

## Checkpoint 10 Launch - 2026-07-07

- Launch packet: `docs/orchestration/CHECKPOINT_10_RELEASE_CANDIDATE_PILOT_READINESS.md`.
- Base commit before launch packet: `a2d6501`.
- Worker launch commit: `e41af66`.
- Integration branch rule: CP10 lane commits merge first into `codex/integration/checkpoint-10`; promote to `main` only after full code checks, end-to-end regression evidence, browser/user evidence, release docs, and accepted-gap review pass.
- Credential/input posture: `.secrets/orchestration.env` is present locally; CP10 can proceed with local/synthetic/simulator evidence. Live provider, ABDM, AWS apply, GitHub push, and physical-device checks remain explicit external verification gaps unless separately approved and configured.
- Visible project-scoped lanes launched from `main` at `e41af66`:
  - Pilot Configuration: pending `local:794b8505-4f39-4563-ac0f-83f146f1519a`, thread `019f3d25-61be-7d92-a99a-a558e578a53d`, worktree `/Users/abhinavgupta/.codex/worktrees/b1c9/ClinicOS`.
  - UX Polish: pending `local:1120e0db-a119-47b2-81e0-e399c07f7c3d`, thread `019f3d25-c537-7e43-abed-c56a4938202d`, worktree `/Users/abhinavgupta/.codex/worktrees/9bcb/ClinicOS`.
  - End-To-End QA: pending `local:32d83d19-e3eb-486f-acd1-c269f237a7f6`, thread `019f3d26-17d5-71a2-ac81-1e94de547afb`, worktree `/Users/abhinavgupta/.codex/worktrees/5cd7/ClinicOS`.
  - Operations/Docs: pending `local:e2eb88a3-5c16-4f6f-b546-7422f4ada13a`, thread `019f3d26-4626-7bd1-9043-a968ec6e128b`, worktree `/Users/abhinavgupta/.codex/worktrees/6dce/ClinicOS`.

## Checkpoint 10 Integration Verification - 2026-07-07

- Integration branch: `codex/integration/checkpoint-10`.
- Verified integration head before master closeout patch: `fc3511f`.
- Verified integration closeout commit: `b7c638f`.
- Main promotion merge commit: `226a7b0`.
- Merge order:
  - Pilot Configuration commit `148bad5` merged first as `c158969`.
  - Master correction `f6f2716` kept pilot readiness approval conservative by not treating AI data-residency notes as approval.
  - UX Polish commit `ecc6e1d` merged second as `4740a10`.
  - End-To-End QA commit `e0be686` merged third as `23c628e`, with the CP10 fixture README and browser/contract expectations reconciled to include the pilot-readiness surface.
  - Operations/Docs commit `266f7d7` merged fourth as `fc3511f`.
- Master closeout patch:
  - Added missing ABDM live-verification gap to the web CP10 pilot fixture and unit test after owner browser smoke found the mismatch.
  - Replaced the CP10 final report skeleton and evidence matrix with actual verification evidence.
  - Updated the CP10 orchestration packet with lane merge status and closeout evidence.
- Full repository gates passed after the final ABDM fixture patch: `git diff --check`, `npm run check`, `npm run security:secrets`, `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
- Post-promotion checks on `main` passed: `git diff --check` and `npm run check`.
- CP10 evidence gates passed: `node scripts/validate-cp10-fixtures.mjs`, `node scripts/cp10-contract-smoke.mjs --dry-run`, `node --test tests/acceptance/cp10-fixture-contract.test.mjs`, and `node --test tests/acceptance/*.test.mjs`.
- Outside-sandbox API route smoke passed with zero skips: `npm --workspace @clinic-os/api test -- cp10-pilot-readiness.test.ts`, including owner-only `GET /v1/pilot-readiness`.
- Browser/user smoke passed:
  - Assistant clinic-day desktop and 390px mobile no-overflow: `CLINICOS_CP10_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3110 NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=assistant npx playwright test tests/e2e/checkpoint-10-clinic-day-flow.spec.ts --grep assistant`.
  - Owner dashboard/readiness/compliance plus settings desktop/mobile: `CLINICOS_CP10_E2E_ENABLED=true CLINICOS_CP10_UX_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3111 NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=owner npx playwright test tests/e2e/checkpoint-10-clinic-day-flow.spec.ts tests/e2e/checkpoint-10-ux-polish-flow.spec.ts --grep "owner|settings|390px"`.
  - Platform-support unavailable shell: `CLINICOS_CP10_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3112 NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=platform_admin npx playwright test tests/e2e/checkpoint-10-clinic-day-flow.spec.ts --grep "platform-support"`.
  - Accountant clinical-route role boundary: `CLINICOS_CP10_UX_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3113 NEXT_PUBLIC_CLINIC_OS_DEV_ROLE=accountant npx playwright test tests/e2e/checkpoint-10-ux-polish-flow.spec.ts --grep "accountant"`.
- Browser evidence screenshots:
  - `/private/tmp/clinicos-cp10-assistant-clinic-day-desktop.png`.
  - `/private/tmp/clinicos-cp10-assistant-mobile-390.png`.
  - `/private/tmp/clinicos-cp10-owner-dashboard-compliance.png`.
  - `/private/tmp/clinicos-cp10-settings-unavailable-desktop.png`.
  - `/private/tmp/clinicos-cp10-settings-unavailable-mobile-390.png`.
  - `/private/tmp/clinicos-cp10-accountant-role-boundary.png`.
- Release package evidence:
  - `docs/release/checkpoint-10-release-notes.md`.
  - `docs/release/pilot-go-live-checklist.md`.
  - `docs/training/pilot-training-flow.md`.
  - `infra/runbooks/pilot-support-admin.md`.
  - `docs/release/known-risks-deferred-work.md`.
  - `docs/qa/checkpoint-10-evidence-matrix.md`.
  - `docs/orchestration/CHECKPOINT_10_FINAL_REPORT.md`.
- Accepted gaps:
  - Live WhatsApp, Razorpay, telephony, AI/STT, ABDM, AWS apply/live restore, GitHub push/remote CI, and physical-device verification remain external gates.
  - Real clinic data use and pilot go-live are not approved by CP10.
  - Final visual design replacement is deferred; CP10 validates safety, reachability, honest states, and responsive no-overflow behavior.
  - `npm run security:audit` was not run because prior policy review rejected npm audit escalation as external dependency-inventory disclosure.

## Independent Production Readiness Audit And Reset - 2026-07-09

- Current decision: **NO-GO** for pilot, production PHI, production provider traffic, or clinical reliance.
- CP10 is preserved as historical E1/E2 local/fixture evidence. It did not prove a migrated durable database, deployed cloud, official provider callbacks, native physical-device capture, production media, distributed observability, live recovery, or clinic acceptance.
- Reproduced blockers included:
  - local Postgres `public` schema contained zero tables because no migration lifecycle was wired;
  - `npm run test` contained clock/date-dependent failures;
  - CP10 live smoke failed `403 clinic_mismatch` after mixing deterministic fixture IDs with runtime identity;
  - `/health/ready` returned configured/ready without dependency probes;
  - pilot-prod Terraform deliberately declared no providers/resources;
  - mobile photo/audio were registered unavailable and capture cache was memory-only;
  - production media storage, WhatsApp inbound route, telephony callback, telemetry exporters/alerts, live restore and physical-device evidence were absent.
- Canonical remediation artifacts:
  - `clinic_os_specs_v2/23_PRODUCTION_READINESS_REMEDIATION_PLAN.md`;
  - `clinic_os_specs_v2/24_PRODUCTION_SECURITY_THREAT_MODEL_AND_CONTROLS.md`;
  - `docs/security/PRODUCTION_SECURITY_AND_READINESS_REMEDIATION_REGISTER.md`;
  - `docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md`;
  - `docs/implementation/POST_CP10_SINGLE_SESSION_EXECUTION_PROGRAM.md`;
  - `docs/implementation/CHECKPOINT_11_VERIFICATION_AND_DURABLE_DATA_FOUNDATION.md`.
- Historical decision at that time: one persistent master session for CP11. This was later superseded for CP12-CP18 by the explicit worktree transition recorded below.
- Next safe action: execute CP11 and do not begin CP12 until the E3 exit gate is fully green.

## Checkpoint 11 E3 Closeout - 2026-07-09

- Execution model: one persistent master session; no subagents, workers or worktrees.
- Base revision: `1332d3c4391874e40ba35b76192a9472b3d541bf` on `main`. The result is intentionally
  uncommitted because the user prohibited commit/push. Existing remediation docs and user-owned
  `research/` plus `scripts/research/` were preserved.
- Durable data:
  - Flyway `12.10.0` is pinned by tag/digest; canonical migrations 0001-0014 validate and repeat as a
    no-op.
  - Clean bootstrap reports 14 migrations, 96 tenant-owned tables, 96 forced-RLS tables, two
    synthetic tenants and migrator/runtime/worker roles without superuser or bypass-RLS.
  - Migration concurrency, checksum drift rejection and failed-migration rollback pass.
- Runtime durability:
  - API mutations commit/rollback domain, audit, timeline and outbox evidence atomically.
  - Dedicated `clinic_os_worker` is denied product-table reads; durable claim, lease, retry, second
    attempt, completion and reviewable dead-letter tests pass against PostgreSQL.
  - A real restart smoke found and fixed the previously missing worker schema contract plus leaked
    health listener on startup failure. Two clean worker start/readiness/SIGINT cycles pass with
    Postgres and Temporal healthy.
- Verification integrity:
  - Critical API/Postgres time is injected and clinic-local; current-time inventory is gated.
  - All 14 production TypeScript workspaces use `tsc`; negative cross-package typing fails as
    expected.
  - Postgres and real-auth Keycloak dependency loss keep liveness up, remove readiness/traffic, and
    recover.
  - Runtime-ID live smoke passes twice with zero fixture repository fallback, validation/role/
    tenant denial, duplicate idempotency and audit/outbox reconciliation.
- User perspective:
  - In-app Browser assistant workflow, denied owner surface, owner blocked readiness and 390px views
    passed without overflow or console errors/warnings.
  - Repeatable Playwright owner desktop/mobile and assistant denial cases pass. UI evidence remains
    E2 fixture evidence and is not promoted to provider/device/durable-loader proof.
- Repository gates: `check`, real `typecheck`, `lint`, full zero-skip tests, build, high-severity npm
  audit, secret scan, CycloneDX SBOM and `git diff --check` pass at closeout.
- Tool activation blockers remain open: Terraform CLI absent; Docker Scout installed but Docker ID
  not activated; Trivy/Syft absent. No container/IaC scan is claimed.
- Final report: `docs/orchestration/CHECKPOINT_11_FINAL_REPORT.md`; evidence:
  `docs/qa/checkpoint-11-evidence.md`; migration runbook:
  `infra/runbooks/database-migrations.md`; threat delta:
  `docs/security/checkpoint-11-threat-model-delta.md`.
- Decision: CP11 E3 durable-local boundary complete; overall pilot/production decision remains
  **NO-GO**. CP12 is next.

## CP11 Promotion And CP12-CP18 Orchestration Transition - 2026-07-09

- CP11 implementation/evidence was independently rechecked before promotion: `npm run check`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run security:secrets`, `npm run db:verify`, `git diff --check`, and the full socket-enabled `npm run test` passed with zero skips.
- CP11 result commit on `main`: `a6109bb` (`feat(cp11): establish durable data and verification foundation`). User-owned `research/` and `scripts/research/` remained untracked and untouched.
- User explicitly changed CP12-CP18 from a single-session implementation model to one master orchestrator plus adaptive visible isolated project worktrees. Worker count is derived per checkpoint; it is never padded to a fixed number.
- Master policy: `gpt-5.6-sol` at `xhigh`; worker policy: `gpt-5.6-sol` at `xhigh` for architecture/schema/security/clinical/cloud/provider/AI/interoperability and `high` for bounded UI/QA/docs/evidence.
- Monitoring policy: create and verify a thread-attached 90-second heartbeat at orchestration start. If rejected, use an active roughly 90-second thread-read loop plus the shortest supported sub-hour heartbeat; do not fake schedule evidence.
- Canonical program: `docs/orchestration/POST_CP11_WORKTREE_ORCHESTRATION_PROGRAM.md`.
- Active packet: `docs/orchestration/CHECKPOINT_12_MODULAR_API_GENERATED_CONTRACTS.md`.
- CP12 launch is not part of this planning session. The future master must record the clean planning-complete `main` HEAD, create `codex/integration/checkpoint-12`, resolve the ClinicOS project through `list_projects`, create/verify the heartbeat, run the adaptive lane gate, and only then launch the three independently justified initial worktrees.

## Checkpoint 12 Launch - 2026-07-10

- Master task: `gpt-5.6-sol` at `xhigh`, executing the complete `orchestrate-worktrees` skill and referenced runbook.
- Exact launch base: clean verified `main` commit `1166baa7a816b614d896cf267066f31f40eac142`; the only working-tree entries were preserved user-owned untracked `research/` and `scripts/research/`.
- Integration branch: `codex/integration/checkpoint-12`, created directly from the recorded launch base before worker creation.
- Saved project: `/Users/abhinavgupta/Desktop/ClinicOS`, resolved through `list_projects`; all workers use project-scoped Codex worktree threads.
- Heartbeat: `clinicos-cp12-18-orchestrator-heartbeat`, thread-attached to the master task, verified `ACTIVE` with `FREQ=SECONDLY;INTERVAL=90`.
- GitHub preflight: the sandboxed CLI check could not access authoritative keyring state; the approved external check verified `AbhinavGupta707` with `repo` and `workflow` scopes.
- Secret boundary: `.secrets/orchestration.env` is ignored, mode `0600`, selects `AWS_PROFILE=clinicos-human`, `WHATSAPP_PROVIDER=simulator`, and `PAYMENT_PROVIDER=simulator`. Workers must not read, source, copy, or receive this file or run live AWS/provider/dashboard operations.
- Historical worktrees: all 12 existing CP8-CP10-era worktrees were freshly rechecked as clean ancestors of `main` with zero unique commits. They remain historical and excluded from CP12.
- CP11 invalidation-sensitive preflight passed from `1166baa`: `npm run check`, `npm run typecheck`, `npm run lint`, full socket-enabled zero-skip `npm run test`, `npm run build`, `npm run db:verify`, and `git diff --check`. Database verification reported 14 migrations, 96/96 forced-RLS tenant tables, role separation, zero no-context rows, worker product-table denial, and cross-tenant isolation.
- Adaptive worker decision: three initial workers are justified. Each owns a substantial namespace, consumes only stable CP11 contracts, has independent narrow tests, produces a useful standalone commit, and does not mutate a shared external environment. The API framework is a dependent consumer and is not launched until these producer interfaces are reviewed, merged, and frozen.

### CP12 Initial Conflict And Dependency Matrix

| Lane                                            | Model / effort                         | Writable ownership                                                                                                               | Stable inputs and independent verification                                                                                                                    | Parallel-safety decision                                                                                              |
| ----------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Runtime Contracts / OpenAPI / Client Generation | `gpt-5.6-sol` / `xhigh`                | `packages/api-contracts/**`, new namespaced generated-client package if needed, `scripts/cp12-openapi*`, `docs/api/**`           | Existing native route inventory and CP11 public behavior; package contract tests, deterministic generation, client compile and inventory coverage             | Launch: no overlap with database/auth/security/app paths                                                              |
| Repository Module Seams                         | `gpt-5.6-sol` / `xhigh`                | new `packages/db/src/modules/**`, CP12-namespaced DB tests/docs only                                                             | Existing `postgres.ts`/repository behavior and CP11 RLS/unit-of-work invariants; repository parity, tenant/context, rollback/idempotency and dependency tests | Launch: additive namespaced paths; canonical migrations, `postgres.ts`, shared barrels and manifests remain forbidden |
| Security Pipeline / Parity Foundation           | `gpt-5.6-sol` / `xhigh`                | `packages/auth/**`, `packages/security/**`, `tests/acceptance/cp12/**`, `docs/qa/checkpoint-12*`, `docs/security/checkpoint-12*` | Current route/security inventory and CP11 auth/tenant behavior; auth/tenant matrix, mass-assignment/body/pagination/rate-budget corpus and parity plan        | Launch: disjoint from contracts, DB modules and API app implementation                                                |
| API Framework / Modularization                  | `gpt-5.6-sol` / `xhigh` when justified | `apps/api/**` only in a later wave                                                                                               | Requires frozen outputs from all three producer lanes                                                                                                         | Sequenced: not parallel-safe at initial launch                                                                        |

- Master-only surfaces for this launch: root manifests/lockfile, `AGENTS.md`, `.github/**`, shared env/CI/Docker files, canonical migrations, `packages/db/src/postgres.ts`, shared export barrels, aggregate OpenAPI/client output, API bootstrap/route composition, memory/checkpoint/remediation/release truth, and all user research.
- Initial worker thread IDs, pending worktree IDs, resolved paths, commits and handoffs are recorded below as they become available.

### CP12 Initial Worker Launch Records

- Runtime Contracts / OpenAPI / Client Generation:
  - pending worktree ID: `client-new-thread:47ab951a-8398-4a23-a0a3-1a32f3832139`;
  - thread ID: `019f4953-a946-7cd2-8cb9-135a45812f9f`;
  - worktree: `/Users/abhinavgupta/.codex/worktrees/3178/ClinicOS`;
  - verified base: detached `1166baa7a816b614d896cf267066f31f40eac142`, initially clean;
  - model/effort: `gpt-5.6-sol` / `xhigh`;
  - ownership: `packages/api-contracts/**`, optional `packages/api-client-generated/**`, `scripts/cp12-openapi*`, `docs/api/**`.
- Repository Module Seams:
  - pending worktree ID: `client-new-thread:7abaf225-d365-4f59-89a8-f74c615c9b55`;
  - thread ID: `019f4953-a947-7251-b025-8daa0d5c502a`;
  - worktree: `/Users/abhinavgupta/.codex/worktrees/e6f6/ClinicOS`;
  - verified base: detached `1166baa7a816b614d896cf267066f31f40eac142`, initially clean;
  - model/effort: `gpt-5.6-sol` / `xhigh`;
  - ownership: new `packages/db/src/modules/**`, `packages/db/test/cp12-*.test.ts`, and CP12-namespaced module-seam documentation under `packages/db/`.
- Security Pipeline / Legacy Parity Foundation:
  - pending worktree ID: `client-new-thread:5ae5a8c7-5d40-4480-945f-9eac634383a3`;
  - thread ID: `019f4953-a949-77a0-9aad-accef6517096`;
  - worktree: `/Users/abhinavgupta/.codex/worktrees/2556/ClinicOS`;
  - verified base: detached `1166baa7a816b614d896cf267066f31f40eac142`, initially clean;
  - model/effort: `gpt-5.6-sol` / `xhigh`;
  - ownership: `packages/auth/**`, `packages/security/**`, `tests/acceptance/cp12/**`, `docs/qa/checkpoint-12*`, `docs/security/checkpoint-12*`.
- All three resolved as active project-scoped worktree threads at launch. Each prompt requires early blocker reporting, forbidden-path discipline, deterministic narrow checks, a committed clean handoff, and no merge/push/release claim.

### CP12 Producer Review, Integration, And Dependent Wave

- Runtime Contracts / OpenAPI / Client Generation handed off `53eb160e0d3b49605b60871e09500fb5fab69e8a` after master review found and the worker corrected recursive unsafe JSON-key acceptance plus permissive date/date-time validation. Master reproduced 21/21 contract tests, 3/3 generated-client tests, exact 128-route generation/inventory checks, typechecks, the clock guard and `git diff --check`. It merged first as `4252938`.
- Repository Module Seams handed off `5a779b85ef52680606881db9c9db4f77d084a095`. Master verified 12 domain/evidence ports, exact one-owner coverage for all 140 legacy repository operations, transaction-leased authority-bound adapters, clean path ownership, DB typecheck, 48/48 package tests including 9/9 focused CP12 tests, lint and `git diff --check`. It merged second as `869cb43`.
- Security Pipeline / Legacy Parity Foundation handed off `52ee744f971f7e584d4648bc9552a6096bf40165` after master review found three CP11 clock-ownership regressions and the worker corrected them by requiring injected valid instants. Master reproduced auth 10/10, security 25/25, CP12 acceptance 10/10, typechecks, the exact 37-callsite clock guard and `git diff --check`. It merged third as `779f830`.
- Master integration commit `e399209cacc5ea8035ed502d9d6c30432cc8906a` exports the reviewed DB module seams, registers the generated-client workspace in the lockfile, and freezes the API lane's direct internal, NestJS `11.1.28`, Redis `6.1.0`, reflection and RxJS dependencies. `npm ci --ignore-scripts --dry-run`, focused typechecks, generated drift/inventory checks, secret scan, clock guard and `git diff --check` passed. The live npm audit remains a promotion-time authority gate because policy rejected external disclosure of the private dependency inventory without separate approval; no audit pass is claimed.
- Dependent API Framework / Modularization worker:
  - pending worktree ID: `client-new-thread:b13d5ea9-d028-4d9c-b623-73ee6721bb51`;
  - thread ID: `019f4985-d2f6-71d2-a8f2-288bfc5ec6dd`;
  - worktree: `/Users/abhinavgupta/.codex/worktrees/a707/ClinicOS`;
  - verified base: detached `e399209cacc5ea8035ed502d9d6c30432cc8906a`, initially clean;
  - model/effort: `gpt-5.6-sol` / `xhigh`;
  - exclusive ownership: `apps/api/src/**` and `apps/api/test/**`; manifests, lockfile, packages, migrations, generated contracts and release/evidence truth remain master-only;
  - mandate: real Nest modular-monolith bootstrap, uniform 128-operation contract/security strangler pipeline, atomic Redis abuse budgets, raw-body Razorpay verification, native health/readiness and identity routes, adversarial parity tests, committed clean handoff and no release claim.
- API framework review identified a genuine remaining persistence dependency rather than treating OpenAPI metadata as runtime compliance: 80 contract-marked mutations require durable request replay/conflict semantics, and 12 PATCH operations require atomic `If-Match` version advancement. Master commit `75e75f960dcaac41dc1e6412aa8bed55f2d703dd` freezes migration 0015 with forced-RLS actor/clinic/operation/key idempotency state, bounded replay fields, processing leases, expired tombstones and `row_version` columns on the 12 resources. A clean local bootstrap applied all 15 migrations; `db:verify` reported 97/97 forced-RLS tenant tables, three least-privilege roles, zero no-context rows, worker denial and passing cross-tenant isolation.
- Durable API Request-Guards DB Adapter worker:
  - pending worktree ID: `client-new-thread:4361920b-7baf-4f89-9ffc-cbc03294f440`;
  - thread ID: `019f498f-86a4-70d2-8d46-bd5f691573d8`;
  - worktree: `/Users/abhinavgupta/.codex/worktrees/3b15/ClinicOS`;
  - verified base: detached `75e75f960dcaac41dc1e6412aa8bed55f2d703dd`, initially clean;
  - model/effort: `gpt-5.6-sol` / `xhigh`;
  - ownership: focused `packages/db` request-guard/Postgres unit-of-work adapter and tests only; migration 0015 is frozen and apps/manifests/docs remain forbidden;
  - adaptive-lane decision: launch is justified because the work is substantial, path-disjoint from the active `apps/api` worker, independently testable against a frozen schema, and must be transaction-coupled to the CP11 unit of work rather than implemented in Redis or an API-local parallel transaction.

### CP12 Dependent-Wave Integration Candidate - 2026-07-10

- Request-guard adapter `bfc74e8` merged as `182a5e1`. It supplies a transaction-bound scoped
  Postgres idempotency/concurrency port inside `PostgresClinicUnitOfWork`; fixture-only typed doubles
  remain isolated from non-fixture durability claims.
- Contract follow-ups `448f1c7`, `66c3691` and `352ed5c` preserved the bounded `/v1/me` Keycloak
  provenance object, aligned the boundary error taxonomy, added canonical `rowVersion` response
  sources and strong `"rv-N"` response metadata. Version-contract work merged as `35ad667`.
- Master configuration commit `a7688af` requires a minimum 32-byte abuse-budget secret in
  production-like environments while retaining a local-only synthetic fallback.
- Domain/DB projection commits `19faf7a` and `18a7b7b` add strict positive safe-integer row versions
  to the 12 resource families and exact-once overflow-safe linked-task advancement for
  `recordRecallAction`; merged as `fd62e50`.
- Master route scanner `df80764` inventories real Nest decorators plus the strangler registration.
- API worker `fd65630` handed off a NestJS boundary, exact 128-operation policy/contract pipeline,
  Redis atomic budgets, durable Postgres mutation coordinator, strict request/response/error
  handling, raw Razorpay verification, health-safe local probe budgets and exact-once teardown.
  Master reproduced 72/72 API tests with zero skips and merged it as `d01b0a3`.
- Master integration commits `d9bfcfd`, `f3f3e1a` and `4b33165` expanded API lint to every Nest
  source/test file, formatted integration-owned checks and reconciled the acceptance inventory with
  the actual runtime/policy/Nest state. CP12 acceptance is 10/10; OpenAPI/client/inventory drift is
  exact for 128 operations.
- Final master transport review found that a chunked body using an unsupported content type could
  avoid a populated raw buffer. The pipeline now treats `transfer-encoding` as a security header and
  rejects an unparsed chunked body before route dispatch. Commit `8e05f7f` adds both in-process and
  real-socket regressions; the complete API package now passes 74/74 with zero skips.
- Readiness reconciliation `023226d` requires the Postgres coordinator and Redis abuse-budget store,
  and exercises real Redis stop/start denial, bounded liveness and recovery. Repetition exposed an
  offline-queue recovery defect; `6169bbd` disables the unbounded queue, caps commands, fails fast
  while reconnecting and admits traffic only after the client is ready.
- Durable smoke reconciliation `1b571ed` updates the CP11 runtime-ID harness to supply CP12's strict
  idempotency, semantic validation and ETag preconditions without weakening the public contracts.
- Complete candidate checks pass: `npm run check`, `npm run typecheck`, `npm run lint`,
  socket-enabled `npm run test` with zero skips, `npm run build`, CP12 acceptance, generated
  drift/inventory, secret scan and `git diff --check`.
- A stale local volume made the first `db:verify` fail its exact canonical-patient count. The master
  discarded that state as evidence. Repeated clean bootstrap/restore points passed with 15
  migrations, 97/97 forced-RLS tenant tables, three least-privilege roles, runtime no-context rows
  zero, worker product access denied and cross-tenant isolation pass. Migration concurrency,
  checksum drift, rollback, repositories, request guards 10/10, row projection 5/5, worker
  persistence 5/5 and real Postgres/Redis/Keycloak loss/recovery all pass.
- Durable runtime smoke passed twice consecutively and once after API restart. Two clean worker
  restart cycles passed against the canonical database. A 25-iteration local API comparison recorded
  `health_ready` p95 5.35 ms, `runtime_identity` p95 17.28 ms and `patient_list` p95 17.81 ms.
- Browser evidence passes: assistant Playwright 3/3; targeted owner Playwright 3/3; in-app browser
  inspection for both roles; 390px no horizontal overflow, reachable primary controls, truthful
  fixture/provider/cloud unavailable states and no browser warnings/errors.
- Promotion was temporarily blocked by an external-execution requirement. `npm run security:audit` transmits
  the dependency inventory to the configured npm registry. The user explicitly authorized the
  disclosure after being informed of the contents and destination, but the managed execution policy
  still rejected it and prohibited retry, indirect execution or workaround. An authorized operator
  or approved CI environment must run the exact command and provide its complete output and exit
  status. At that point `main` remained at `1166baa` and CP13 had not started.
- The authorized operator supplied the complete `npm run security:audit` transcript. The configured
  `--audit-level=high` gate passes with zero high/critical advisories. Twenty-one moderate advisories
  remain in the Next/PostCSS, Temporal/protobufjs and Expo/xcode/uuid transitive paths. No automatic
  or force fix was run; the moderate findings remain visible under PRR-018 for CP14/CP17.
- With the audit evidence accepted, every CP12 exit gate passes. Promotion is authorized after the
  final repository rerun; CP13 remains stopped until the controlled merge and post-promotion checks
  are green.
- CP12 was promoted to `main` by controlled no-fast-forward merge
  `2f6b4cd67a64e4c9b19bb4ee34a9c8f7e5c2bbc8`. Post-promotion `npm run check`, exact
  integration/main tree equivalence, `git diff --check` and durable `npm run db:verify` all pass.
  The database reports 15 migrations, 97/97 forced-RLS tenant tables, the three least-privilege
  roles, two synthetic tenants, zero no-context runtime rows, denied worker product access and
  cross-tenant isolation pass. CP12 is complete; CP13 is authorized to begin.
- Candidate evidence: `docs/qa/checkpoint-12-evidence.md`; integrated threat/control truth:
  `docs/security/checkpoint-12-route-control-inventory.md` and
  `docs/security/checkpoint-12-security-foundation-delta.md`; candidate report:
  `docs/orchestration/CHECKPOINT_12_FINAL_REPORT.md`.

## Checkpoint 13 — Durable Clinic-Day Vertical Slices

### CP13 Launch And Seam Freeze — 2026-07-10

- CP13 launch base is verified `main` revision
  `c3802b73e135246d56d12efc9ab399ecd6f47fde`, containing the CP12 promotion merge and final
  post-promotion record. The root integration branch is `codex/integration/checkpoint-13`; the only
  pre-existing working-tree entries remain user-owned untracked `research/` and `scripts/research/`.
- The seam audit confirmed CP12's 140-operation repository ownership and transaction-leased ports,
  but found that the API transaction callback still exposed only the legacy repository/audit sink.
  The master extracted `runWithClinicModuleTransactionContext` so CP13 handlers can bind verified
  scope, namespaced repositories, request guards and audit/outbox evidence inside the already-open
  Postgres mutation transaction. No nested transaction or caller-supplied authority is allowed.
- Master-frozen API contracts assign all 94 CP2-CP6 clinic-day operations exactly once: front
  office/intake 26, clinical/dental 22, treatment/billing 12 and continuity/operations 34. The 93
  authenticated clinic operations accept only the parsed CP12 request, verified clinic context,
  bounded request metadata, injected clock and transaction-bound module context. The Razorpay
  webhook remains a separate raw-signature/provider-event contract owned by the treatment lane and
  composed by the master. Workers do not parse raw authority or bypass CP12
  policy/idempotency/concurrency/response enforcement.
- Initial adaptive launch decision: four lanes are justified because each writes only a new
  namespaced feature tree plus lane-specific tests/proposals, consumes the frozen master contract,
  and can commit useful independently testable work without touching shared composition files.

| Lane                                 | Model / effort          | Writable ownership                                                                                                                                                                                                                                           | Stable inputs and verification                                                                                                                                  | Parallel-safety decision               |
| ------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Front Office and Intake              | `gpt-5.6-sol` / `high`  | new `apps/api/src/features/front-office/**`, `apps/web/features/cp13/front-office/**`, `packages/domain/src/cp13/front-office/**`, lane-named API/web/domain/DB tests, `packages/db/schema-proposals/cp13/front-office.sql`, lane evidence                   | frozen 26-operation list, CP12 contracts/client and patient-administration/scheduling/clinical-care ports; success/role/tenant/state/retry/audit-outbox tests   | Launch: additive namespaced paths only |
| Clinical and Dental                  | `gpt-5.6-sol` / `xhigh` | new `apps/api/src/features/clinical-dental/**`, `apps/web/features/cp13/clinical-dental/**`, `packages/domain/src/cp13/clinical-dental/**`, lane-named tests, `packages/db/schema-proposals/cp13/clinical-dental.sql`, lane evidence                         | frozen 22-operation list, clinical-care/dental-treatment/clinical-media ports and existing provider interfaces; consent/signature/tenant/media disclosure tests | Launch: additive namespaced paths only |
| Treatment, Billing and Instructions  | `gpt-5.6-sol` / `xhigh` | new `apps/api/src/features/treatment-billing/**`, `apps/web/features/cp13/treatment-billing/**`, `packages/domain/src/cp13/treatment-billing/**`, lane-named tests, `packages/db/schema-proposals/cp13/treatment-billing.sql`, lane evidence                 | frozen 12-operation list, dental-treatment/billing/clinical-care ports and provider verification interfaces; money/idempotency/overpayment/role tests           | Launch: additive namespaced paths only |
| Continuity, Operations and Analytics | `gpt-5.6-sol` / `high`  | new `apps/api/src/features/continuity-operations/**`, `apps/web/features/cp13/continuity-operations/**`, `packages/domain/src/cp13/continuity-operations/**`, lane-named tests, `packages/db/schema-proposals/cp13/continuity-operations.sql`, lane evidence | frozen 34-operation list, continuity/clinic-operations ports; due/retry/reconciliation/freshness/PHI-safe analytics tests                                       | Launch: additive namespaced paths only |

- Master-only and forbidden worker paths: canonical migrations, all manifests/lockfiles, shared
  exports, `packages/api-contracts/**`, generated clients/artifacts, `apps/api/src/framework/**`,
  `apps/api/src/server.ts`, `apps/api/src/operations.ts`, `apps/api/src/features/contracts.ts`,
  `apps/api/src/features/cp13-operation-ownership.ts`, existing web components/loaders/navigation,
  worker/workflow composition, root configuration, checkpoint/release/security truth and all user
  research. Workers must propose shared changes in handoff rather than editing these paths.
