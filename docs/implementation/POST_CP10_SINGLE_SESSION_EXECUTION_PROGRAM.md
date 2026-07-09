# Post-CP10 Single-Session Execution Program

**Date:** 2026-07-09
**Status:** Active execution runbook
**Default:** One persistent master session; sequential checkpoints CP11–CP18

## 1. Operating Decision

Post-CP10 remediation will be executed in one master Codex task by default. The task may span context compactions and multiple user continuations, but architectural ownership, diff review and release truth remain centralized. There are no default worker lanes, hidden agents, or worktree merges.

This choice reduces duplicated context and integration overhead. It does not authorize a giant unverified batch. Checkpoints remain strict transaction boundaries for scope, evidence and user review.

## 2. Required Reading at Resume

Before any implementation or after a compacted/handover context, read:

1. `AGENTS.md`.
2. `clinic_os_specs_v2/23_PRODUCTION_READINESS_REMEDIATION_PLAN.md`.
3. `docs/security/PRODUCTION_SECURITY_AND_READINESS_REMEDIATION_REGISTER.md`.
4. `clinic_os_specs_v2/24_PRODUCTION_SECURITY_THREAT_MODEL_AND_CONTROLS.md`.
5. `docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md`.
6. This runbook and the active checkpoint packet.
7. `docs/AGENT_MEMORY.md` and `docs/orchestration/CHECKPOINT_LOG.md` for historical state.

Earlier CP reports are historical evidence, not current readiness authority.

## 3. Checkpoint Control Loop

### A. Orient

- inspect branch, revision, status and user-owned/untracked work;
- reproduce the relevant failing evidence before changing code;
- confirm registration/discovery/installation before debugging permissions or runtime for a missing capability;
- restate exact findings, files, forbidden shortcuts and evidence tier;
- identify user/external authority that may be needed later, without blocking safe local work.

### B. Design

- trace the dependency layer from schema/config → repository → application/domain → API → client/UI → evidence;
- choose the canonical production contract; defer an obsolete workflow whole instead of adding a compatibility stub;
- define migration/backward compatibility/rollback, threat cases, telemetry and runbook before implementation;
- record a focused ADR only for a material decision not already settled by canonical specs.

### C. Implement

- change one coherent dependency slice at a time;
- preserve existing user edits and unrelated work;
- use production provider contracts; local/test doubles stay behind the same interfaces and are rejected in production-like config;
- keep shared manifests and lockfile reconciliation intentional;
- avoid broad mechanical rewrites unless they are the explicit checkpoint deliverable.

### D. Verify Narrowly

- compile/typecheck the changed packages with real TypeScript checks;
- run affected unit, integration, authorization, tenant and failure tests;
- apply migrations to a clean database when schema/repository behavior changes;
- verify generated contracts/clients when a public boundary changes;
- run browser/device/provider checks when a user or external surface changes.

### E. Verify the Checkpoint

- execute the packet’s E-level evidence;
- run `git diff --check` and the complete repository gates;
- inspect skipped tests, fallback mode, clock, IDs, database, logs and environment so a false green cannot pass;
- inspect the diff for PHI/secret leakage, overbroad auth, migration hazards and generated-file drift;
- update the finding register, evidence records, threat model delta, runbooks, changelog, memory and checkpoint log.

### F. Close or Stop

- close only the findings actually evidenced;
- record residual risk and disabled/deferred workflows;
- do not call the checkpoint complete when a hard gate fails;
- do not start the next checkpoint while the current one is incomplete;
- request user authority only when the next required step changes external state or needs a material product decision.

## 4. Execution Order and Dependencies

| Order | Checkpoint | Primary result                                                    | May start only after                                            |
| ----- | ---------- | ----------------------------------------------------------------- | --------------------------------------------------------------- |
| 1     | CP11       | Trustworthy tests, migrations, durable local stack and live smoke | Current audit recorded                                          |
| 2     | CP12       | Modular validated API and generated contracts                     | CP11 E3 gate                                                    |
| 3     | CP13       | Complete durable clinic-day workflows                             | CP12 boundary foundation                                        |
| 4     | CP14       | Deployed cloud/security/media/observability/recovery              | CP13 canonical state contracts stable                           |
| 5     | CP15       | Official messaging/payment/telephony sandbox flows                | CP14 E4 public edge/telemetry/secrets                           |
| 6     | CP16       | Native mobile and selected AI/interoperability                    | CP14 E4 security/storage; provider/legal approvals where needed |
| 7     | CP17       | Controlled first-clinic launch                                    | CP11–16 in-scope E5 gates                                       |
| 8     | CP18       | Repeatable multi-clinic production                                | Observed CP17 operations                                        |

CP15 and CP16 could be reordered if external approvals dictate it, but neither can bypass CP14. Their code may be prepared earlier only if it remains unregistered and cannot be mistaken for activated behavior.

## 5. Source and File Ownership in a Single Session

There are no parallel ownership conflicts, but the session still treats high-risk files as integration points:

- root `package.json` / `package-lock.json`;
- database migrations and migration history;
- environment schema/templates and secret names;
- permission/capability registry and audit taxonomy;
- generated OpenAPI/clients;
- API bootstrap/global middleware;
- Terraform state/backend/environment configuration;
- Docker/local stack and runbooks;
- release checklist, finding register and evidence matrix.

Before editing one of these, identify every consumer with `rg`. Reconcile it once per coherent change and run its full downstream checks.

## 6. Commit and Branch Policy

- Do not commit, branch, push, apply cloud infrastructure, register providers or send external traffic unless the active user request authorizes it.
- When commits are authorized, prefer one or a small number of dependency-ordered checkpoint commits with meaningful messages; never mix unrelated user-owned files.
- Keep `main` at the last verified state if a checkpoint branch is explicitly requested. Without a branch request, preserve the current branch and clearly report uncommitted checkpoint state.
- Never use destructive reset/checkout to clean the user’s worktree.

## 7. Verification Command Baseline

The exact commands evolve in CP11, but the checkpoint closeout must cover:

```sh
git diff --check
npm run check
npm run typecheck
npm run lint
npm run test
npm run build
npm run security:secrets
```

Post-CP11 adds a clean database bootstrap/integration gate. CP12 adds generated OpenAPI/client drift and route parity. CP14 adds Terraform/security/image/SBOM, deployed smoke, alert, load/fault and restore evidence. A dependency audit runs only through an approved disclosure path; a blocked external audit cannot be mislabeled pass.

## 8. Stop Conditions

Stop and report rather than guess when:

- a required product decision would change clinical/legal behavior;
- production apply, provider registration, data import, external message/payment or real PHI needs new authority;
- an existing user change overlaps materially and cannot be preserved;
- canonical specs conflict on a safety-critical contract;
- migration could destroy/irreversibly transform data without approved backup and procedure;
- a production provider lacks an official authorized integration path;
- a hard gate repeatedly fails for a reason outside the authorized system boundary.

Normal implementation uncertainty, hard code or long tests are not stop conditions.

## 9. Execution State Record

At the end of every meaningful session segment, append to the checkpoint log:

- current checkpoint and revision;
- completed finding IDs;
- files/migrations/contracts changed;
- tests/evidence run and tier;
- open failures and their exact cause;
- external input/authority needed;
- next smallest safe action.

That record is the durable resume point. Do not rely on chat memory alone.
