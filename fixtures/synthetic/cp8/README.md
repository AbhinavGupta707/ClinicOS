# CP8 AI Safety QA Fixtures

This directory contains deterministic, synthetic-only fixtures for Checkpoint 8 AI safety and QA.

- `ai_safety_qa_flow.json` is local/test-only and must not contain real PHI, production secrets, or live provider payloads.
- Golden outputs must include source anchors and warnings.
- Unsafe outputs are intentionally invalid and must remain rejected, retained for evaluation when policy allows, and not applied.
- Fixture/browser evidence is not live API evidence. The CP8 smoke script keeps route dry-run plans separate from live execution until backend and UI lanes merge canonical routes.

Run:

```sh
node scripts/validate-cp8-fixtures.mjs
node scripts/cp8-contract-smoke.mjs --dry-run
node --test tests/acceptance/cp8-fixture-contract.test.mjs
```
