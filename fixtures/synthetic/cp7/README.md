# Checkpoint 7 Synthetic Fixtures

These fixtures are local/test-only. They model provider health, dead-letter replay review, and migration review safety without secrets, PHI, dashboard scraping, or fake provider completion.

Run the validator:

```sh
node scripts/validate-cp7-fixtures.mjs
```

Run the dry-run route contract:

```sh
node scripts/cp7-contract-smoke.mjs --dry-run
```

Browser smoke uses the explicit web fixture flags documented in `docs/qa/checkpoint-7-integration-ops-qa.md`.
