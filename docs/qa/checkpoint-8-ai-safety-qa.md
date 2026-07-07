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
- No consent and revoked consent attempts both expect HTTP 403 and block AI/audio processing.
- Rejected output is retained for evaluation when policy allows and remains `rejected_not_applied`.
- Doctor can approve a clinical note draft for review; assistant cannot sign or apply a clinical note. Assistant chart patch review remains review-only and still requires clinical sign-off.

## Dry-Run Contract Posture

The CP8 smoke plan names the intended route families but marks every request `liveImplemented: false` in this lane. This keeps fixture evidence separate from live API claims until AI Backend, Mobile Capture, and Review UX merge canonical route implementations.

The acceptance test fails if autonomous apply-style routes enter the CP8 plan, including `/v1/ai/apply`, `/apply-chart-patch`, `/apply-clinical-note`, or similar fake application shortcuts.

## Browser/Mobile Smoke Checklist

Status: pending Review UX and Mobile Capture lane routes.

Required CP8 selectors:

- `cp8-ai-review-workspace`
- `cp8-fixture-alert`
- `cp8-consent-status`
- `cp8-capture-disabled`
- `cp8-source-anchors`
- `cp8-ai-warnings`
- `cp8-reject-output`
- `cp8-review-decision-status`
- `cp8-mobile-capture-workspace`

Required mobile invariant:

- 390px by 844px viewport.
- No horizontal overflow.
- Consent status visible before capture controls.
- Audio capture disabled for no active consent or revoked consent.
- Source anchors and warnings visible before any review decision.
- No UI text claims AI has signed, applied, or autonomously updated clinical records.

Run after UI routes are available:

```sh
CLINICOS_CP8_E2E_ENABLED=true CLINICOS_WEB_BASE_URL=http://127.0.0.1:3000 npx playwright test tests/e2e/checkpoint-8-ai-safety-flow.spec.ts
```

## Deferred Whole Workflows

- Live AI/STT provider smoke remains deferred until approved provider keys, no-training/no-retention posture, and data-residency approvals are available.
- Browser/mobile smoke is documented but not claimed as passed in this lane because the Review UX and Mobile Capture product routes are owned by separate CP8 lanes.
- Product application of AI outputs remains a reviewed backend/UI workflow, not a QA fixture shortcut.
