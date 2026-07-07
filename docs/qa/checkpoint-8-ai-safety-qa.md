# Checkpoint 8 AI Safety/QA Evidence

Date: 2026-07-07

## Scope

This lane owns CP8 safety fixtures, validation, contract dry-run evidence, and browser/mobile smoke expectations. It does not implement product backend, web, or mobile routes.

## Evidence Added

- Synthetic fixture corpus: `fixtures/synthetic/cp8/ai_safety_qa_flow.json`.
- Fixture validator: `node scripts/validate-cp8-fixtures.mjs`.
- Contract smoke dry-run: `node scripts/cp8-contract-smoke.mjs --dry-run`.
- Acceptance tests: `node --test tests/acceptance/cp8-fixture-contract.test.mjs`.
- Gated Playwright smoke checklist/spec: `tests/e2e/checkpoint-8-ai-safety-flow.spec.ts`.

## Safety Coverage

- Golden AI outputs include source anchors, warnings, simulator provenance, retention policy, and explicit `applied: false`.
- Unsupported diagnosis output is expected to fail with `unsupported_claim`.
- Wrong-tooth dental chart patch is expected to fail with `wrong_tooth`; the source segment says tooth 16 while the unsafe output says tooth 26.
- No consent and revoked consent attempts both expect HTTP 409 and block AI/audio processing because the actor may be allowed while patient consent state blocks the workflow.
- Rejected output is retained for evaluation when policy allows and remains `rejected_not_applied`.
- Doctor can approve a clinical note draft for review; assistant cannot sign or apply a clinical note. Assistant chart patch review remains review-only and still requires clinical sign-off.

## Dry-Run Contract Posture

The CP8 smoke plan names the canonical `ai-scribe` backend route family but marks every request `liveImplemented: false` because the deterministic synthetic IDs are not seeded into arbitrary live API runtimes. Live backend behavior is verified by API operations tests; this dry-run contract keeps fixture evidence separate from runtime smoke claims.

The acceptance test fails if autonomous apply-style routes enter the CP8 plan, including `/v1/ai/apply`, `/apply-chart-patch`, `/apply-clinical-note`, or similar fake application shortcuts.

## Browser/Mobile Smoke Checklist

Status: Review UX routes are available after CP8 integration; Expo mobile capture consent behavior is verified by the mobile app tests and mobile web-export/simulator evidence, not by a fake web `/surface/mobile-capture` route.

Required CP8 selectors:

- `cp8-ai-review-workspace`
- `cp8-fixture-alert`
- `cp8-review-readiness`
- `cp8-source-anchors`
- `cp8-warning-list`
- `cp8-reject-draft`
- `cp8-selected-status`
- `cp8-dental-chart-draft`
- `cp8-action-proposal-draft`

Required mobile invariant:

- 390px by 844px viewport.
- No horizontal overflow.
- Review readiness and draft state visible before controls.
- Mobile capture audio controls stay disabled for no active consent or revoked consent in the Expo mobile app workflow.
- Source anchors and warnings visible before any review decision.
- No UI text claims AI has signed, applied, or autonomously updated clinical records.

Run after UI routes are available:

```sh
CLINICOS_CP8_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/checkpoint-8-ai-safety-flow.spec.ts
```

## Deferred Whole Workflows

- Live AI/STT provider smoke remains deferred until approved provider keys, no-training/no-retention posture, and data-residency approvals are available.
- Live mobile app distribution and simulator-device capture remain deferred beyond the local Expo shell/export evidence owned by the Mobile Capture lane.
- Product application of AI outputs remains a reviewed backend/UI workflow, not a QA fixture shortcut.
