# Checkpoint 8 - Mobile Capture And AI Scribe / Action Proposals

- Launch date: 2026-07-07
- Launch base before this packet: `983cca5`
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
