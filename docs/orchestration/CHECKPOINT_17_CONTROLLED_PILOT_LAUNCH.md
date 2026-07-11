# Checkpoint 17 — Pilot-Production Validation and Controlled Launch

**Status:** Blocked until deferred CP14 E4/E5 infrastructure and downstream provider/device evidence exist
**Evidence target:** E5 synthetic pilot-production, then authorized E6 real-clinic validation
**Workers:** provisionally two to three initial evidence worktrees; shared-environment execution remains serialized
**Primary findings:** PRR-030 and final in-scope P1/P2 confirmation

## 1. Outcome

Prove that the exact signed release, deployed environment, providers, devices, people and clinic procedures can operate a controlled clinic day safely. CP17 is not a documentation exercise. No real PHI or clinical reliance begins before explicit authorization and the complete E5 gate.

## 2. Lanes

### Lane A — Release, Platform and Recovery Validation (`gpt-5.6-sol`, `xhigh`)

**Owns:** CP17 deployment/recovery validation scripts and evidence paths; no broad product changes.

**Goal:** exact artifact/config/Terraform/migration inventory, CI provenance, synthetic canaries, alert delivery, capacity, backup freshness, timed restore, failover/failback and rollback rehearsal.

### Lane B — Security and Privacy Assurance (`gpt-5.6-sol`, `xhigh`)

**Owns:** CP17 security/privacy test and remediation namespace, penetration-test evidence/closure records and threat delta.

**Goal:** independent penetration test intake/closure, authenticated DAST, access review, secret/key rotation, lifecycle/export/deletion/legal hold, audit integrity and residual-risk review.

### Lane C — Clinical Safety, Training and Clinic Operations (`gpt-5.6-sol`, `xhigh`)

**Owns:** CP17 clinic configuration/UAT/training/support/downtime artifacts and tests.

**Goal:** facility/timezone/hours/roles/pricebook/templates/consents, migration plan/reconciliation, clinical hazard/UAT, staff training, downtime/manual backfill, support/on-call and stop-authority exercise.

### Optional second wave — End-to-End QA, Providers and Devices (`gpt-5.6-sol`, `high`)

**Launch condition:** the exact release/environment is stable and Lanes A-C have frozen their evidence procedures and stop conditions. Otherwise the master owns this work.

**Owns:** CP17 end-to-end/load/browser/device/provider regression harness and sanitized evidence.

**Goal:** all in-scope roles, wrong-role/tenant, desktop/390px, physical devices, official provider production preflight, degraded/offline/error paths, console/network, cross-system reconciliation and observed synthetic clinic day.

## 3. Defect Routing

Validation lanes should not all patch shared product files. They file exact defects with evidence. The master assigns a single follow-up worktree or patches a small cross-lane integration issue. Load, DAST, restore, failover, provider and clinic-day tests against the same environment are scheduled serially even when their artifact preparation ran in parallel. Any material fix invalidates affected E5 evidence and triggers rerun before sign-off.

## 4. E6 Authority and Launch

After E5 passes, require named clinic, engineering, security/privacy, clinical safety and operations authorization for the exact revision/environment/data scope. Begin with the smallest approved cohort, monitoring room and immediate rollback authority. Observe and reconcile the first real workflow before expansion.

## 5. Exit Gate

- all in-scope P0/P1 and boundary-bypassing P2 findings closed at required tier;
- exact artifact/config/migration/infra/provider/device state recorded;
- penetration, load/fault, alert, restore/failover, security/privacy and clinic UAT pass;
- staff access/training/downtime/support and migration reconciliation signed;
- approved E6 observed clinic workflow completes without unsafe divergence;
- every hard gate in `docs/release/pilot-go-live-checklist.md` is signed for one revision/environment;
- stop/rollback criteria and monitoring operate;
- CP17 evidence/final report complete and integration promoted.

If clinic or real-data authority is absent, finish E5 and stop as blocked. Do not launch CP18 based only on synthetic evidence because CP18 requires observed production learning.
