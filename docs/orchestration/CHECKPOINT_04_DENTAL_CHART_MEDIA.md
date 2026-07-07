# Checkpoint 04 - Dental Charting, Media, And Imaging Coexistence

## Goal

Doctor and assistant users can chart tooth-level dental findings, maintain dental chart history, attach photos/X-rays/documents to patient, encounter, tooth, and finding context, and view media through audited, permissioned signed-access flows.

## Base

- Branch: `main`
- Base commit before launch packet: `c7b222c`
- Launch date: 2026-07-07

## Scope

- Dental odontogram and tooth/surface finding model.
- Dental finding create/update flows with provenance, author, review state, history, timeline, audit, and outbox evidence.
- Dental chart snapshots/history for patient and encounter context.
- Media asset metadata, tags, attachment links, object-key privacy, signed access, upload completion, quarantine/scanning state, and PHI audit.
- X-ray/imaging coexistence by manual upload, external software reference/link, metadata import, and DICOM metadata preservation when fixtures are available.
- Web workflow for odontogram, tooth detail, media gallery, comparison view, and safe unavailable/deferred states.

## Non-Goals

- Treatment plans, estimates, checkout, payment, and printable instructions belong to Checkpoint 5.
- AI-generated dental chart patches belong to Checkpoint 8.
- Full PACS/DICOMweb adapter replacement is not required in CP4; coexistence comes first.
- Mobile chairside capture belongs to Checkpoint 8, though CP4 must expose backend/mobile-ready contracts.

## Lanes

| Lane              | Pending Worktree ID                                | Thread ID                              | Worktree                                             | Ownership |
| ----------------- | -------------------------------------------------- | -------------------------------------- | ---------------------------------------------------- | --------- |
| Media Backend     | `local:026917af-501e-4550-adf0-518da69f4bc1`      | `019f3a34-a5d9-78c1-a12c-25ce24bc9426` | `/Users/abhinavgupta/.codex/worktrees/7725/ClinicOS` | Media metadata, upload-url/complete-upload, signed URL mediation, storage abstraction/simulator, audit, permission tests, object-key privacy |
| Dental Domain     | `local:cc0a9c3a-6ecb-46b9-88bf-b49bfaff9dad`      | `019f3a34-d36e-7680-b3cd-1ad47240f656` | `/Users/abhinavgupta/.codex/worktrees/d4aa/ClinicOS` | Tooth numbering, dental findings, chart snapshots/history, treatment references, events, DB migration, domain/repository/API contracts |
| Dental/Media UX   | `local:1e9a0c2e-a7e4-46eb-825b-04e504f9d8b3`      | `019f3a35-0fd0-73e3-a35b-5c33f236a270` | `/Users/abhinavgupta/.codex/worktrees/16fc/ClinicOS` | Odontogram, tooth detail panel, finding editor/history, media gallery/comparison, role-aware clinical surface, browser smoke |
| Imaging/QA        | `local:823af464-3b7b-4088-ae6c-881114572251`      | `019f3a35-4418-7e93-91f6-7beffa65ac55` | `/Users/abhinavgupta/.codex/worktrees/9cf9/ClinicOS` | X-ray coexistence fixtures, DICOM/external-link metadata fixtures, acceptance tests, E2E smoke plan, QA docs |

## Shared-File Policy

| Surface                         | Owner For CP4              | Rule |
| ------------------------------- | -------------------------- | ---- |
| `package-lock.json`             | Master integration         | Workers must not commit lockfile changes; request dependency changes in handoff. |
| Root `package.json`             | Master integration         | Workers request root scripts unless explicitly assigned. |
| DB migrations                   | Dental Domain              | Media Backend may request fields, but do not create competing CP4 migrations. |
| API contracts/generated clients | Dental Domain first        | Media Backend and UX consume documented contracts; do not invent durable route shapes independently. |
| `apps/api/**`                   | Dental Domain/Media Backend by endpoint | Coordinate route/schema changes; avoid duplicate parser helpers and route names. |
| `packages/security/**`          | Media Backend with master review | Audit actions and redaction must cover media and dental finding PHI. |
| `apps/web/**`                   | Dental/Media UX            | QA may add tests only; do not rewrite CP3 clinical workflow behavior unless CP4 requires extension. |
| Fixtures/test data              | Imaging/QA                 | Product runtime must not depend on fixtures outside explicit local/test fixture modes. |
| Docs/orchestration              | Master integration         | Workers provide handoff evidence; master records checkpoint evidence. |

## Required Verification

- Doctor/assistant can add and update findings by tooth number/surface with provenance and history.
- Dental chart history/snapshots are visible and linked to patient timeline.
- Media upload completion creates metadata without exposing raw bucket paths or object keys.
- Signed media access is short-lived, permissioned, tenant/clinic scoped, and audited.
- Media can attach to patient, encounter, tooth, and finding context.
- Accountant cannot view clinical media or dental findings by default.
- Wrong-tenant access is denied for dental chart and media.
- X-ray coexistence supports upload/import/link metadata without forcing replacement of external X-ray software.
- Browser smoke covers encounter -> dental finding -> media attach/view -> timeline at desktop and 390px mobile.

## Merge Order

1. Media Backend
2. Dental Domain
3. Dental/Media UX
4. Imaging/QA
5. Master integration patch on `codex/integration/checkpoint-4`
6. Verified promotion to `main`

## Integration Result

- Integration branch: `codex/integration/checkpoint-4`.
- Verified code commit: `2fd04a5`.
- Merge status: Media Backend, Dental/Media UX, Imaging/QA, and the recovered Dental Domain commit are merged into the CP4 integration branch.
- Master integration folded media schema into the numbered CP4 migration, reconciled dental/media repository contracts, added live dental API operations/routes, aligned audit classifications, and fixed mobile tab smoke sequencing.

## Implemented Surfaces

- Dental domain model for FDI tooth numbers, finding categories, finding status, review state, source metadata, severity, surfaces, confidence, encounter context, and snapshot payloads.
- Postgres schema and local fixture repository support for dental findings, dental finding history, dental chart snapshots, media assets, media upload lifecycle, signed media access, audit, timeline, RLS, and object-key privacy.
- API routes:
  - `GET /v1/patients/:patientId/dental-chart`
  - `POST /v1/patients/:patientId/dental-findings`
  - `POST /v1/patients/:patientId/dental-chart/snapshots`
  - `POST /v1/encounters/:encounterId/dental-findings`
  - `PATCH /v1/dental-findings/:findingId`
  - `GET /v1/dental-findings/:findingId/history`
  - Media routes from the Media Backend lane: `POST /v1/media/upload-urls`, `PUT /v1/media/uploads/:uploadId/content`, `POST /v1/media/uploads/:uploadId/complete`, `GET /v1/patients/:patientId/media`, and `POST /v1/media/assets/:mediaAssetId/signed-url`.
- Web CP4 workflow for doctor/assistant dental chart, tooth detail, finding history, media gallery, media comparison, and accountant role denial.

## Verification Evidence

- Conflict/syntax checks passed:
  - `rg -n "<<<<<<<|=======|>>>>>>>" ...`
  - `node --check apps/api/src/local-fixture.ts`
  - `node --check packages/db/src/postgres.ts`
  - `git diff --cached --check`
- Package checks passed:
  - `npm --workspace @clinic-os/domain test`
  - `npm --workspace @clinic-os/db run typecheck`
  - `npm --workspace @clinic-os/api run typecheck`
  - `npm --workspace @clinic-os/api test`
  - `npm --workspace @clinic-os/security test`
  - `npm --workspace @clinic-os/security run typecheck`
  - `npm --workspace @clinic-os/web test`
  - `npm --workspace @clinic-os/web run lint`
- CP4 and acceptance checks passed:
  - `node scripts/validate-cp4-fixtures.mjs`
  - `node scripts/cp4-contract-smoke.mjs --dry-run`
  - `node --test tests/acceptance/*.test.mjs`
- Live local API smoke passed on `127.0.0.1:4100` with dev auth fixture, local media simulator, Postgres, Redis, Temporal, and Keycloak env values. The smoke covered ready health, encounter create, encounter dental finding create, finding update, chart snapshot, patient dental chart read, object-key privacy, accountant denial, and wrong-tenant denial.
- Browser smoke passed:
  - Doctor/assistant desktop and 390px mobile CP4 flow: `CLINICOS_CP4_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/checkpoint-4-dental-media-flow.spec.ts --grep-invert "role denial"`
  - Accountant role denial: `CLINICOS_CP4_ROLE_DENIAL_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3001 npx playwright test tests/e2e/checkpoint-4-dental-media-flow.spec.ts --grep "role denial"`
- Browser evidence:
  - Desktop doctor/assistant workflow: `/private/tmp/clinicos-cp4-web-doctor-desktop.png`.
  - Mobile 390px workflow: `/private/tmp/clinicos-cp4-web-mobile-390.png`.
- Full repository gates passed:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test`
  - `npm run security:secrets`
  - `npm run check`
  - `npm run build`
  - `npm run security:audit` high-severity gate. Existing moderate upstream advisories remain in Next/PostCSS, Temporal/protobufjs, and Expo/xcode/uuid dependency paths.

## Post-Closeout Re-Verification - 2026-07-07

- Critical audit found that CP4 backend media routes were durable, but the web live helper and navigation metadata still named an older media route family: `/v1/media/complete-upload`, `/v1/media/{mediaId}/links`, and `/v1/media/{mediaId}/signed-access`.
- Master integration patched the web live helper to use the actual durable route sequence: upload reservation, mediated upload content, completion by upload id, and signed URL by media asset id.
- A focused web regression test now mocks `fetch` and asserts the exact live media route sequence and request body shape, including patient/encounter/tooth/finding context on upload reservation and the deferred live external-link behavior.
- Targeted re-checks passed:
  - `npm --workspace @clinic-os/web test -- cp4-workflow.test.ts`
  - `npm --workspace @clinic-os/web run typecheck`
  - `npm --workspace @clinic-os/web run lint`
  - `npm --workspace @clinic-os/web test`
  - `git diff --check`
- Full re-checks passed after the patch:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test`
  - `npm run security:secrets`
  - `npm run build`
  - `npm run check`
  - `node scripts/validate-cp4-fixtures.mjs`
  - `node scripts/cp4-contract-smoke.mjs --dry-run`
  - `node --test tests/acceptance/cp4-fixture-contract.test.mjs`
- Browser re-smoke passed after the patch:
  - Doctor/assistant desktop and 390px mobile: `CLINICOS_CP4_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/checkpoint-4-dental-media-flow.spec.ts --grep-invert "role denial"`
  - Accountant role denial: `CLINICOS_CP4_ROLE_DENIAL_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3001 npx playwright test tests/e2e/checkpoint-4-dental-media-flow.spec.ts --grep "role denial"`
  - Refreshed screenshots: `/private/tmp/clinicos-cp4-web-doctor-desktop.png` and `/private/tmp/clinicos-cp4-web-mobile-390.png`.
- `npm run security:audit` could not be rerun in this pass: sandboxed execution could not resolve `registry.npmjs.org`, and escalation was policy-rejected because npm audit discloses dependency inventory to an external service. The last recorded CP4 closeout high-severity audit remains the available evidence for this gate.

## Current-Tree Verification - 2026-07-07

- Critical current-tree audit found a remaining verification-artifact weakness: the web/API product route family was durable, but `scripts/cp4-contract-smoke.mjs` and its acceptance assertion still allowed the dry-run plan to describe stale media routes from the earlier fixture story.
- The CP4 smoke plan now builds a live API plan around the implemented durable route sequence: `POST /v1/media/upload-urls`, `PUT /v1/media/uploads/{uploadId}/content`, `POST /v1/media/uploads/{uploadId}/complete`, `GET /v1/patients/{patientId}/media`, and `POST /v1/media/assets/{mediaAssetId}/signed-url`.
- The smoke script captures runtime `uploadId`, `uploadUrl`, and `mediaAssetId` from responses, uploads raw synthetic content with the required upload header, and keeps DICOM/external-link fixture evidence explicitly fixture-only/deferred instead of listing it as live CP4 API behavior.
- Acceptance coverage now fails if stale live-smoke route fragments such as `/complete-upload`, `/links`, `/signed-access`, `/external-media-links`, or `/imaging/dicom-metadata` re-enter the live smoke plan.
- Re-checks passed: `node scripts/validate-cp4-fixtures.mjs`, `node scripts/cp4-contract-smoke.mjs --dry-run`, `node --test tests/acceptance/cp4-fixture-contract.test.mjs`, `npm --workspace @clinic-os/web test -- cp4-workflow.test.ts`, `git diff --check`, `npm run check`, `npm run security:secrets`, `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.

## Accepted Gaps And Deferred Whole Workflows

- CP4 implements durable upload reservation, local simulator content upload, upload completion, patient media listing, and mediated signed-URL routes. CP4 fixture data still preserves DICOM metadata and external reference/link coexistence evidence, but live external imaging-link routes are not claimed as complete product behavior in CP4. That workflow should be owned by a later integration or a dedicated imaging adapter checkpoint rather than patched in as a weak partial flow.
- The dental finding API stores one tooth/surface finding row per create/update operation. Multi-tooth charting is still possible by creating separate findings; bulk multi-tooth chart patching should be a later explicit workflow, not hidden inside a single partial endpoint.
- Visual design remains temporary. CP4 browser verification focused on safety and responsive workflow invariants: no mobile horizontal overflow, reachable chart/media controls, honest role denial, and no fake clinical completion.

## CP4 Integration Lessons

- Fixture contract scripts and live route contracts must stay aligned before lanes are merged. A dry-run fixture plan can pass while still describing an older durable route shape, so the smoke builder must separate fixture-only/deferred evidence from the live API plan.
- Web live helper tests must assert exact API route shapes whenever fixture browser smoke is used. Fixture-mode UI smoke proves user interaction and responsiveness, but it does not prove live API contract compatibility by itself.
- UI smoke servers must include the checkpoint fixture flag when the workflow is fixture-backed. For CP4 that flag is `NEXT_PUBLIC_CLINIC_OS_USE_CP4_WORKFLOW_FIXTURE=true`.
- Browser/mobile testing remains necessary even for rough UI because it validates route registration, role-conditioned rendering, reachable controls, and mobile overflow invariants that the final design will inherit.
- Media and dental schema changes should stay in one numbered checkpoint migration. Parallel lane schema proposals are useful as design artifacts, but the integration branch owns the canonical migration.
- Object keys, bucket names, and raw storage paths must never appear in patient-facing API payloads; use mediated signed access and audit every clinical-media access path.

## Exit Criteria

- CP4 workflows are complete for their intended scope without mock product behavior.
- Dental chart and media access are tenant/role scoped, auditable, and timeline-visible.
- Object storage paths remain private; user-visible access flows use mediated signed access only.
- Imaging coexistence is explicit and honest: upload/import/link, not forced PACS replacement.
- Full code checks, live local API smoke, and browser/user checks are recorded before merge.
