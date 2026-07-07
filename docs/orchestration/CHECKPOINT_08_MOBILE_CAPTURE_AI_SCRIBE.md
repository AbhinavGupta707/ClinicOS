# Checkpoint 8 - Mobile Capture And AI Scribe / Action Proposals

- Launch date: 2026-07-07
- Launch base before this packet: `983cca5`
- Worker launch base: `ac7211d`
- Source plan: `clinic_os_specs_v2/20_ORCHESTRATION_CHECKPOINT_PLAN.md` section 16
- Integration branch: `codex/integration/checkpoint-8`

## Outcome

Expo mobile capture and backend-mediated AI draft workflows work safely with consent, provenance, retention, review, and evaluation. AI may draft clinical artifacts and action proposals, but it must never apply clinical changes, prescriptions, dental chart findings, billing actions, or patient communications without explicit authorized human review.

## Credential And Input Preflight

`.secrets/orchestration.env` is present and ignored by Git. Values must not be printed.

Checkpoint 8 can proceed with deterministic AI fixtures and provider simulators. Live AI/STT calls require an approved provider key, data-retention position, and data-residency approval. Until those are present, product surfaces must show simulator/fixture or unavailable states honestly.

## Lane Ownership

| Lane | Ownership | Forbidden/shared policy | Required verification |
| --- | --- | --- | --- |
| Mobile Capture | Expo Router mobile capture architecture, session/auth shell, patient/queue/encounter selection, photo capture flow, audio consent gate, upload queue, secure local cache abstractions, mobile tests/docs | May edit `apps/mobile/**` and mobile README/tests. May propose `apps/mobile/package.json` dependencies only if required for real Expo camera/audio/cache behavior. Do not edit root lockfile; master reconciles lockfile after package manifests stabilize. Do not edit API/database/web except handoff notes. | `npm --workspace @clinic-os/mobile run typecheck`, `npm --workspace @clinic-os/mobile test`, Expo web export or simulator smoke where available, proof that audio controls are disabled without consent |
| AI Backend | Domain models, migration, repository/API operations for AI sessions/jobs/transcript segments/outputs/review decisions/action proposals, AI provider gateway/simulator, retention controls, audit/outbox events | Own the only CP8 database migration. May edit `packages/domain/**`, `packages/db/**`, `apps/api/**`, `packages/integrations/**`, security audit classifications. Do not edit mobile/web UI except contract notes. No live AI calls unless explicitly feature-flagged and credentials/preflight allow. | Domain/db/api/integrations/security tests, no-key/provider-simulator tests, consent/retention tests, raw audio/transcript privacy checks |
| Review UX | Web review surfaces for clinical note drafts, dental chart patch drafts, action proposal inbox, approval/rejection/edit flows, route/navigation metadata, web tests | May edit `apps/web/**`, CP8 fixtures, and web docs. Do not invent backend routes; consume AI Backend contracts or mark whole review workflow unavailable. No fake clinical application state after approval button unless backend route applies it with authorization/audit. | `npm --workspace @clinic-os/web run typecheck`, `npm --workspace @clinic-os/web test`, `npm --workspace @clinic-os/web run lint`, browser smoke for doctor/assistant review and mobile-width safety |
| AI Safety/QA | Evaluation fixture corpus, schema validation, unsupported-claim checks, prompt/safety runbook, E2E/root smoke specs, CP8 contract smoke and docs | May edit `fixtures/synthetic/cp8/**`, `scripts/*cp8*`, `tests/e2e/**`, `docs/qa/**`, safety docs/tests. Coordinate route names with AI Backend and Review UX. Do not weaken clinical safety to make fixtures pass. | Fixture validator, contract dry-run, safety tests for hallucination/unsupported claim/wrong tooth/no consent, browser smoke checklist |

## Visible Worktree Lanes

| Lane | Pending Worktree ID | Thread ID | Worktree |
| --- | --- | --- | --- |
| Mobile Capture | `local:bad96d1e-eaf1-41f4-8d8f-4ab52f7ba245` | `019f3cb7-ee10-7c83-a5c1-1407c64a7158` | `/Users/abhinavgupta/.codex/worktrees/834a/ClinicOS` |
| AI Backend | `local:ce740f13-db5a-412f-8a51-f26cbd27897a` | `019f3cb8-2e5c-7dd1-8865-02823428698c` | `/Users/abhinavgupta/.codex/worktrees/0b3b/ClinicOS` |
| Review UX | `local:989b9a6e-5e81-4271-a46d-380130d35c50` | `019f3cb8-6e4e-73d3-9754-9cbd5aa583d9` | `/Users/abhinavgupta/.codex/worktrees/fc5f/ClinicOS` |
| AI Safety/QA | `local:e4023aec-09ec-4659-8001-fa11db2751a4` | `019f3cb8-a9ea-79b2-9edd-d44513a60668` | `/Users/abhinavgupta/.codex/worktrees/25b2/ClinicOS` |

An older duplicate Mobile Capture thread from base `f562a8e` (`019f3cab-83a6-7d42-8813-7829e961a04f`, `/Users/abhinavgupta/.codex/worktrees/155b/ClinicOS`) was marked superseded and archived. Do not integrate it.

## Shared-File Policy

- AI Backend owns the CP8 migration sequence and backend route registration.
- Mobile Capture may own `apps/mobile/package.json`; master owns root `package-lock.json` reconciliation.
- No lane should edit `.secrets/**`, print secrets, or add live provider keys to docs/tests.
- Route contracts must be canonical before Review UX and Safety/QA claim live behavior.
- Fixture browser smoke is not live API evidence. Add unit/API tests for live helper route shapes.

## Expected Product Behaviors

- Mobile photo capture can upload to the existing media pipeline and produce patient timeline evidence.
- Mobile audio capture is disabled when the patient lacks active audio/AI documentation consent.
- AI sessions keep transcript/source anchors, provider mode, retention policy, and provenance.
- AI clinical note drafts and dental chart patches are review-only until an authorized doctor/assistant approves the specific change.
- Rejected AI output remains retained for evaluation according to retention policy but is not applied.
- Action proposals are explicit proposals with approval/rejection state, not hidden automation.
- Raw audio retention is configurable and conservative; raw audio/transcript/AI output must not leak through general logs or public payloads.

## Accepted Non-Goals

- No live AI/STT provider smoke without approved credentials, no-training/no-retention posture, and data-residency approval.
- No diagnostic image AI, autonomous diagnosis, autonomous prescription, or autonomous treatment plan application.
- No patient mobile app distribution, TestFlight, or Play Store release in CP8 unless explicitly scoped by credentials/account availability.
- No final visual polish pass for temporary UI beyond safety, reachability, responsiveness, and honest states.

## Merge Order

AI Backend -> Mobile Capture -> Review UX -> AI Safety/QA -> master integration patch.

## Integration Closeout - 2026-07-07

- Integration branch: `codex/integration/checkpoint-8`.
- Verified integration patch commit: `f967144`.
- Lane commits integrated:
  - AI Backend: `4b00076`.
  - Mobile Capture: `ea8a6a2`.
  - Review UX: `f2a192e`.
  - AI Safety/QA: `b38b6b8`.
- Master integration reconciled the CP8 safety dry-run to the canonical `ai-scribe` route family, changed missing/revoked consent expectations to HTTP `409` workflow-state blocking, removed a fake web mobile-capture route assumption, and made the role-specific Playwright smokes explicitly depend on `NEXT_PUBLIC_CLINIC_OS_DEV_ROLE`.
- Implemented API surface:
  - `GET|POST /v1/encounters/{encounterId}/ai-scribe/sessions`.
  - `GET /v1/ai-scribe/sessions/{sessionId}`.
  - `POST /v1/ai-scribe/sessions/{sessionId}/transcript-segments`.
  - `POST /v1/ai-scribe/sessions/{sessionId}/source-anchors`.
  - `POST /v1/ai-scribe/sessions/{sessionId}/generate-drafts`.
  - `POST /v1/ai-scribe/sessions/{sessionId}/review-decisions`.
  - `POST /v1/ai-scribe/sessions/{sessionId}/retention-delete`.
- CP8 outputs are review-only. Review decisions are persisted for audit/evaluation but do not sign notes, write chart findings, create prescriptions, perform billing actions, or send patient communications.
- Transcript read payloads redact raw transcript text and expose digests/provenance instead of raw audio/transcript content.
- The AI gateway runs in deterministic simulator mode unless live AI/STT activation is explicitly approved with provider key, data-residency, and retention posture.

## Verification Evidence

- Targeted CP8 checks passed: `node scripts/validate-cp8-fixtures.mjs`, `node --test tests/acceptance/cp8-fixture-contract.test.mjs`, `node scripts/cp8-contract-smoke.mjs --dry-run`, `npm --workspace @clinic-os/mobile run typecheck`, `npm --workspace @clinic-os/mobile test`, `npm --workspace @clinic-os/web run typecheck`, `npm --workspace @clinic-os/web test`, `npm --workspace @clinic-os/web run lint`, `npm --workspace @clinic-os/api test`, and `node --test tests/acceptance/*.test.mjs`.
- Full repository gates passed: `git diff --check`, `npm run check`, `npm run security:secrets`, `npm run typecheck`, `npm run lint`, `npm run test`, and `npm run build`.
- Browser/app smoke passed:
  - Doctor review and 390px mobile review against the CP8 fixture.
  - Assistant review boundary against the CP8 fixture.
  - Root AI safety review flow against the CP8 fixture.
  - Mobile lane Expo web export smoke at 390px.
- Evidence screenshots:
  - `/private/tmp/clinicos-cp8-ai-review-doctor-desktop.png`.
  - `/private/tmp/clinicos-cp8-ai-review-assistant-desktop.png`.
  - `/private/tmp/clinicos-cp8-ai-review-mobile-390.png`.
  - `/private/tmp/clinicos-cp8-mobile-capture-web-390.png`.

## Accepted Gaps

- Live AI/STT provider activation is deferred until explicit approval exists for provider credentials, no-training/no-retention posture, and data residency.
- Web non-fixture aggregate review queue mode requires a real configured review queue endpoint and per-item review-decision hrefs. Without those, the product shows an honest unavailable state.
- Clinical application of AI output is deferred as whole workflows. CP8 does not autonomously mutate signed notes, dental charts, prescriptions, billing, or patient communications.
- Physical-device camera/audio smoke and app-store distribution are deferred. CP8 verifies the mobile contract through Expo shell/export, unit tests, and consent-disabled behavior.
- `npm run security:audit` was not rerun because prior escalation was policy-rejected; npm audit discloses dependency inventory to an external registry. `npm run security:secrets` passed.
