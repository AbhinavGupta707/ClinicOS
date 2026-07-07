# CP6 Continuity Operations Fixture

This directory contains deterministic, synthetic-only fixture evidence for Checkpoint 6 continuity operations and owner-dashboard analytics.

- `continuity_owner_dashboard_flow.json` is local/dev/test/CI only.
- It must never be loaded as production runtime data.
- The owner-dashboard expected metrics are recomputed by `scripts/validate-cp6-fixtures.mjs` from source rows.
