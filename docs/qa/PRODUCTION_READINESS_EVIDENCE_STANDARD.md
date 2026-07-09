# ClinicOS Production Readiness Evidence Standard

**Date:** 2026-07-09
**Status:** Mandatory for all post-CP10 implementation and release claims

## 1. Why This Exists

ClinicOS previously combined fixture, dry-run, package, browser and external-gap evidence in checkpoint summaries. Those checks remain useful, but they answer different questions. This standard prevents a deterministic mock from being described as durable, a configured credential from being described as activated, or a synthetic restore plan from being described as recoverability.

## 2. Evidence Tiers

| Tier | Name                                | What it proves                                                                                                                                        | What it does not prove                                                 |
| ---- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| E0   | Static intent                       | Spec, ADR, schema, interface, config rule or infrastructure plan exists and can be reviewed.                                                          | Runtime behavior, deployability, connectivity or safety.               |
| E1   | Isolated automated                  | Unit, property, contract, static/security or component test passes with controlled dependencies.                                                      | Durable integration or user operation.                                 |
| E2   | Deterministic fixture/simulator     | UI and workflow semantics work against typed local/test doubles; failure/unavailable states can be exercised.                                         | Real DB, RLS, provider, device, cloud, backup or production readiness. |
| E3   | Clean durable local integration     | Clean migrated Postgres, real repositories, local Keycloak/Temporal/Redis as required, process restart and runtime-ID flows work with synthetic data. | Deployed cloud, official provider or production operations.            |
| E4   | Deployed staging / official sandbox | Production-equivalent cloud deployment and official provider/device sandbox behavior work with synthetic/test data.                                   | Production traffic, real-clinic usability or sustained operations.     |
| E5   | Pilot-production synthetic          | Exact pilot-prod revision/config passes security, load, fault, alert, backup/restore, physical-device and provider preflight using synthetic data.    | Authorization for PHI or proof of clinic workflow success.             |
| E6   | Controlled real-clinic validation   | Approved limited real data/users complete observed workflows with support, monitoring, consent, rollback and signed review.                           | Repeatable multi-clinic general availability.                          |
| E7   | General production operations       | Multiple-clinic or time-bounded operational evidence proves onboarding, scale, SLOs, support, recovery, security cadence and change management.       | Future conditions; controls still require ongoing verification.        |

Higher-tier evidence incorporates, rather than replaces, relevant lower-tier tests.

## 3. Minimum Claim Levels

| Claim                               | Minimum evidence                                                    |
| ----------------------------------- | ------------------------------------------------------------------- |
| “Contract/interface defined”        | E0 + review                                                         |
| “Unit tested”                       | E1                                                                  |
| “Fixture workflow implemented”      | E2, explicitly labeled fixture                                      |
| “Product workflow implemented”      | E3 with no silent fixture fallback                                  |
| “Deployable / staging-ready”        | E4                                                                  |
| “Provider integration implemented”  | E4 official sandbox, including signed callback/retry/reconciliation |
| “Native mobile capture implemented” | E4 on physical iOS and Android devices                              |
| “Recoverable”                       | E4 restore from a real environment backup; E5 before pilot          |
| “Pilot-prod technically ready”      | E5 and all in-scope P1/P2 hard gates closed                         |
| “Pilot approved”                    | E6 authorization and signed cross-functional go-live                |
| “Production-ready / GA”             | E7 plus current E5/E6 security and recovery evidence                |

The word “pass” must always identify the tier and environment when ambiguity is possible.

## 4. Evidence Record Schema

Every material gate record includes:

- unique evidence ID;
- finding/checkpoint/control IDs covered;
- repository revision and dirty/clean status;
- artifact/image/Terraform digest where relevant;
- environment/account/region and deployment revision;
- evidence tier;
- UTC timestamp and clinic-local timezone/date where relevant;
- exact command, test case or manual procedure;
- sanitized inputs/data classification;
- expected and actual result, including skip count;
- logs/screenshots/report location with PHI redacted;
- operator and reviewer;
- expiry/freshness window;
- known limitations and linked follow-up.

Example:

```yaml
evidence_id: CP11-E3-DB-BOOTSTRAP-001
checkpoint: CP11
findings: [PRR-001, PRR-027]
revision: <git-sha>
tier: E3
environment: local-clean-postgres
data: synthetic-only
executed_at_utc: <timestamp>
command: npm run db:bootstrap:verify
result: pass
skips: 0
artifacts:
  - <sanitized report path>
reviewer: <name-or-approved-identity>
valid_until: superseded-by-schema-or-runner-change
```

## 5. Reproducibility Rules

1. Evidence starts from a recorded revision. Pre-existing untracked/user-owned files are disclosed and never deleted to obtain green.
2. Clean-database tests must create the database/schema from canonical migrations; a developer’s old volume is not evidence.
3. Runtime smoke discovers or creates IDs. Deterministic fixture IDs are never assumed in a live repository.
4. Tests use injected clocks. A passing suite tied to today’s date is invalid.
5. Zero skips is required unless each skip is named, justified and outside the claim. A skipped hard-gate scenario fails the gate.
6. Commands must fail non-zero on failed assertions, missing prerequisites or unusable output.
7. Fixture fallback must be impossible or explicitly detected in E3+.
8. Evidence containing real PHI is stored only in an approved restricted system; repository docs contain sanitized metadata, never PHI.
9. Manual screenshots supplement, not replace, automated authorization/data assertions.
10. Provider credentials and configuration presence prove only `configured`; provider-side registered/signed traffic is required for `sandbox_verified` or `production_verified`.

## 6. Required Evidence by Control Area

### Data and migrations

- clean bootstrap and ordered checksum history;
- migration re-run/drift/lock failure behavior;
- schema constraints and RLS inventory;
- migration/runtime role separation;
- transaction rollback and concurrency;
- restore followed by application reconciliation.

### Authentication and tenancy

- login, expiry, refresh/rotation, logout/revocation, MFA and role change;
- every role’s allowed/denied critical operations;
- every tenant-owned route’s cross-tenant denial;
- RLS denial independent of application checks;
- privileged/break-glass approval and review.

### Clinical and financial workflows

- happy path and invalid state transitions;
- wrong-role, wrong-patient/tenant and stale-version behavior;
- duplicate/retry/concurrent actions;
- signed/amended provenance;
- audit/outbox/timeline/read-model reconciliation;
- restart/recovery at transition boundaries.

### Providers

- provider-side registration and official sandbox account;
- signature/challenge and raw-body handling;
- success, invalid signature, duplicate, out-of-order, delayed and retry events;
- provider outage, rate limit and credential rotation;
- reconciliation with provider truth and DLQ replay.

### Infrastructure and operations

- reviewed Terraform plan and applied inventory;
- network/IAM/KMS/public-access policy tests;
- signed artifact and deployment provenance;
- telemetry propagation and redaction;
- alert delivered to a real escalation target;
- load, noisy-neighbor and dependency-fault tests;
- backup restore/failover within approved RPO/RTO.

### Browser and mobile

- all in-scope roles and primary workflows;
- 390px/mobile and supported desktop viewport without horizontal overflow;
- keyboard/focus/accessibility checks for critical actions;
- loading, empty, validation, unavailable, offline and error states;
- physical device permission, secure storage, process death/reboot, background and poor-network tests;
- no secrets/PHI in browser storage, URLs, console, crash reports or screenshots.

### Security and privacy

- secret/SCA/SAST/IaC/container/SBOM/provenance gates;
- deployed CSP/headers/CORS/CSRF/cache behavior;
- audit tamper attempt and immutable export verification;
- retention/export/deletion/legal-hold lifecycle;
- independent penetration test before real-clinic launch;
- security/privacy/clinical approval of residual risk.

## 7. Freshness and Invalidation

Evidence is invalidated when its relevant code, schema, dependency, provider configuration, infrastructure, security policy, environment or procedure changes. At minimum:

| Evidence                                        | Maximum freshness without relevant change                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Unit/contract/CI                                | Every revision                                                                  |
| Staging smoke/security headers/provider sandbox | Every release candidate                                                         |
| Dependency/container/IaC scans                  | Every release candidate and scheduled weekly/monthly policy                     |
| Access review                                   | Monthly for privileged production access                                        |
| Backup success                                  | Continuous monitoring; restore drill quarterly and before pilot                 |
| Failover/game day                               | Quarterly or material architecture change                                       |
| Penetration test                                | Before pilot/GA and after material boundary change; otherwise at least annually |
| Clinic training/config sign-off                 | Exact go-live revision/config and staff roster                                  |

A historical checkpoint report is never silently edited into current evidence. Add a superseding record and link both.

## 8. Release Decision Rules

- **NO-GO:** any in-scope P0/P1 open; failing required gate; wrong evidence tier; unavailable restore; incomplete tenant/security boundary; missing required human authority.
- **CONDITIONAL TECHNICAL PASS:** all technical gates for the exact environment pass but one or more external human/provider production activations remain disabled. No PHI/traffic until authorization.
- **GO:** all exact-revision/environment technical gates pass, external activations are verified, and named engineering, security/privacy, clinical safety, operations and clinic approvers sign.

An optional workflow can be removed from a release only if its route, navigation, worker, provider registration and configuration are absent/disabled and the remaining product has a complete safe workflow. A hidden button alone is not scope removal.

## 9. CP10 Interpretation

CP10 evidence remains E1/E2 evidence for its package, fixture, browser and contract scope. It is valuable regression coverage. The 2026-07-09 audit invalidated any broader inference of E3+ readiness because the durable schema was unapplied, the current test suite and live smoke failed, and production infrastructure/providers/device/recovery were not implemented. Current release truth is the remediation register and this standard.
