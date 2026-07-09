# Checkpoint 18 — Multi-Clinic General Production Readiness

**Status:** Planned; requires observed CP17 operations
**Evidence target:** E7 repeatable production operations
**Workers:** four worktrees after CP17 observation gate

## 1. Outcome

Convert the controlled first-clinic deployment into a repeatable, supportable multi-clinic production service. E7 is operational evidence across time/tenants, not another synthetic test suite.

## 2. Observation Gate

Before launch, the master must record:

- approved CP17 production revision/environment and observation window;
- actual incidents, fallbacks, support load, SLO/error-budget behavior and provider/device performance;
- clinic feedback and workflow/reconciliation defects;
- backup/restore/access/vulnerability cadence evidence;
- authority and inputs for at least the next onboarding/multi-tenant validation scope.

If this evidence does not exist, CP18 remains blocked. A heartbeat may monitor authorized sources, but cannot create elapsed operational evidence.

## 3. Lanes

### Lane A — Tenant Onboarding, Migration and Lifecycle (`gpt-5.6-sol`, `xhigh`)

**Owns:** namespaced onboarding/offboarding/configuration/migration automation and tests.

**Goal:** repeatable clinic provisioning, validated policy/roles/templates/pricebook/consents, migration ambiguity/reconciliation/rollback, offboarding/export/retention and no manual first-clinic exceptions.

### Lane B — Scale, SRE and Cost (`gpt-5.6-sol`, `xhigh`)

**Owns:** namespaced capacity/autoscaling/noisy-neighbor/cost/SLO/incident/DR improvements and tests.

**Goal:** multi-clinic load/isolation, capacity headroom, cost budgets, error-budget release policy, queue/provider saturation handling, recurring restore/failover and on-call operations.

### Lane C — Security, Governance and Customer Operations (`gpt-5.6-sol`, `xhigh`)

**Owns:** GA security/privacy/access/vulnerability/release/support governance, customer-facing security/privacy/status material and final threat-model work.

**Goal:** recurring vulnerability/access/key/audit/backup reviews, independent penetration retest, SLA/support/escalation, incident communications and expiring exception governance.

### Lane D — Multi-Clinic E2E and Release QA (`gpt-5.6-sol`, `high`)

**Owns:** multi-tenant/noisy-neighbor/onboarding/upgrade/rollback/browser/device/provider acceptance and release evidence.

**Goal:** independently prove two or more clinic configurations, tenant denial, upgrade/migration, provider/device variation, SLOs, support and rollback without fixture or first-clinic assumptions.

## 4. Master Integration

The master translates observed CP17 findings into owned changes before launch, prevents validation lanes from concurrently editing shared product files, integrates in dependency order, reruns invalidated E7 evidence and updates all operational cadences. Root release/governance files remain master-owned.

## 5. Exit Gate

- repeatable onboarding/offboarding/migration and configuration validation pass for multiple clinic profiles;
- cross-tenant/noisy-neighbor/capacity/cost/SLO evidence meets approved objectives;
- provider/device/support/recovery variation is demonstrated across the observation window;
- security/access/vulnerability/backup/restore/incident/release cadences operate, not merely exist in docs;
- independent penetration retest and residual-risk approvals complete;
- customer support/status/privacy/security materials match the deployed system;
- multi-clinic E7 evidence, final threat model, remediation closure and GA sign-off complete;
- final integration promoted to `main`, post-promotion checks pass, and orchestration heartbeat is disabled.
