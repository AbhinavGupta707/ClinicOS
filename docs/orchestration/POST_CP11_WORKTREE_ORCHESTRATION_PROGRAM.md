# Post-CP11 Worktree Orchestration Program

**Date:** 2026-07-09
**Status:** Canonical CP12-CP18 execution runbook
**Master:** one project-scoped Codex master task on `gpt-5.6-sol` with `xhigh` reasoning
**Workers:** two to four visible project-scoped worktree tasks per checkpoint
**Project ID:** `/Users/abhinavgupta/Desktop/ClinicOS`

## 1. Operating Decision

CP11 was completed in one master session and promoted on `main` at commit `a6109bb`. CP12-CP18 now use master-orchestrated, sidebar-visible Codex worktrees. The master owns the outcome: lane design, launch, status monitoring, blocker resolution, diff review, merge order, integration fixes, complete verification, evidence, promotion, and the decision to start the next checkpoint.

Workers are implementation lanes, not independent release authorities. A worker saying “complete” is only a handoff. The master must review the actual commit/diff and reproduce the relevant checks before merge.

## 2. Non-Negotiable Sequence

```text
verified main
  -> checkpoint launch packet committed
  -> integration branch created
  -> 2-4 isolated workers launched from the same main commit
  -> workers monitored without interference
  -> handoffs and diffs reviewed
  -> lane commits merged in dependency order
  -> shared files reconciled once by master
  -> full integration, browser/device/provider/security checks
  -> evidence and release truth updated
  -> integration branch promoted to main
  -> post-promotion smoke
  -> next checkpoint only then
```

Do not launch lanes from a dirty working tree. Do not launch two checkpoints concurrently. Do not let a later checkpoint hide a failing earlier exit gate.

## 3. Master Preflight

At the beginning of the orchestration task and before each checkpoint:

1. Read `AGENTS.md`, plans 23/24, the remediation register, evidence standard, this program, the active checkpoint packet, memory, checkpoint log, and merge runbook.
2. Inspect `git status --short`, current branch, recent commits and `git worktree list --porcelain`.
3. Confirm `main` is clean except explicitly user-owned untracked paths. `research/` and `scripts/research/` remain excluded unless the user changes scope.
4. Rerun the previous checkpoint’s invalidation-sensitive gates.
5. Resolve the saved ClinicOS project with `list_projects`; use the returned project ID, not a guessed projectless target.
6. Create `codex/integration/checkpoint-N` from the verified `main` launch commit and record both.
7. Confirm external authorities, installed tools and official activation state. Diagnose absent/unregistered tools or providers before permissions/runtime.
8. Create and verify the monitoring heartbeat described below.

If the previous checkpoint exists only as uncommitted changes, stop lane launch. Review, test and commit/promote it first so every worktree starts from the same immutable state.

## 4. Worktree Creation Contract

Every worker is created with the Codex app thread tool using:

- target type `project`;
- project ID `/Users/abhinavgupta/Desktop/ClinicOS`, freshly confirmed by `list_projects`;
- environment type `worktree`;
- starting branch `main` after the checkpoint launch packet is committed;
- explicit model `gpt-5.6-sol` because the user selected it;
- reasoning effort from the checkpoint packet (`high` or `xhigh`).

Do not use hidden subagents, projectless tasks, raw `git worktree add`, or a same-directory fork. Immediately record pending worktree ID, resolved thread ID, worktree path, branch/base commit, model/effort, lane ownership and launch time in `CHECKPOINT_LOG.md`.

Workers must commit their lane changes before handoff. They must not push or merge. A clean handoff includes the commit hash, `git status`, changed paths, commands/results/skips, contract/schema/env changes, residual risks and exact integration instructions.

## 5. Model and Reasoning Policy

The current Codex host describes `gpt-5.6-sol` as its latest frontier agentic coding model and supports `high`, `xhigh`, `max`, and `ultra` reasoning. The user selected `xhigh` for the master. The program deliberately uses only `high` and `xhigh` for workers:

| Work type                                                                                                                          | Worker effort | Reason                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------- |
| Architecture, schema/RLS, auth/security, clinical/financial invariants, cloud/DR, provider signatures, AI safety, interoperability | `xhigh`       | Errors cross trust, tenant, safety, money, recovery or public-contract boundaries. |
| Bounded UI implementation, contract fixtures, browser/device QA, documentation, runbooks, evidence packaging                       | `high`        | Work is substantial but has a narrower decision surface and objective checks.      |
| Mixed lane with any high-risk boundary                                                                                             | `xhigh`       | Use the highest risk inside the lane.                                              |

Do not silently downgrade model or reasoning to save usage. Do not use `max` or `ultra` without a later explicit user decision. A worker follow-up preserves its current model/effort unless the master explicitly changes it.

### Capability provenance

This policy was verified on the current Codex host on 2026-07-09:

- `create_thread` exposes project/worktree creation, explicit `gpt-5.6-sol`, and `high`/`xhigh` reasoning;
- `list_projects` returns ClinicOS project ID `/Users/abhinavgupta/Desktop/ClinicOS`;
- `automation_update` exposes thread heartbeat automations;
- thread list/read/send tools expose background status and follow-up control.

The public Codex site documents long-running goals and automation use cases, but the public search result did not establish the private-looking `gpt-5.6-sol` label or a 90-second minimum schedule. Current-host callable capability therefore governs launch, and the master must validate tool responses at runtime. Do not infer pricing or usage savings from the model label.

## 6. Ninety-Second Monitoring and Heartbeat

At orchestration start, the master must call the Codex automation tool to create a thread-attached heartbeat named `ClinicOS CP12-18 Orchestrator Heartbeat`, targeted at the master thread, active at the requested 90-second cadence. The automation prompt must tell the master to:

1. read the active checkpoint and recorded worker IDs;
2. inspect worker status through thread tools;
3. leave running workers alone unless a material blocker needs intervention;
4. inspect completed handoffs and worktree diffs;
5. solve cross-lane or environment blockers in the integration branch;
6. merge reviewed commits in the recorded order;
7. run narrow and full checks;
8. update evidence and promote only after the exit gate;
9. launch the next checkpoint only from updated verified `main`;
10. disable/delete the heartbeat when CP18 completes, the user stops the run, or a genuine external blocker requires user action.

The automation must be created with the product tool, not by writing an automation file or raw directive. Verify its returned cadence/status. If the app rejects 90 seconds, record the limitation and use both:

- an active-turn monitor loop that waits about 90 seconds between status reads; and
- the shortest supported thread heartbeat below one hour.

Never claim a 90-second automation exists if creation or schedule validation failed. The heartbeat does not authorize cloud apply, provider dashboard mutation, real messages/payments, PHI import, or destructive recovery.

## 7. Quiet Monitor Loop

On each active monitor cycle:

- use `list_threads`/`read_thread` rather than sending “status?” messages;
- classify each lane as `starting`, `running`, `blocked`, `complete-handoff`, or `failed`;
- do not poll more frequently than approximately 90 seconds when nothing changes;
- do not redirect a running worker for speculative improvements;
- if blocked, determine whether the master can fix shared environment/contract state without conflicting with the worker;
- if a worker failed before useful implementation, relaunch only that lane from the recorded base with a corrected prompt;
- if complete, review immediately while other workers continue.

The master may send a follow-up only for a concrete missing requirement, failed check or unsafe implementation. Frequent prompts waste context and reduce independence.

## 8. Conflict-Avoidance Contract

### Master-only shared surfaces

Unless a checkpoint packet explicitly assigns one worker as sole owner, workers must not edit:

- `AGENTS.md`;
- root `package.json` or `package-lock.json`;
- `.github/**`;
- `.env.example` or shared environment schemas;
- `docker-compose.yml`;
- canonical migration numbers/files;
- root API bootstrap/route registry/export barrels shared by lanes;
- generated aggregate OpenAPI/client output assembled from multiple modules;
- `docs/AGENT_MEMORY.md`, `docs/orchestration/CHECKPOINT_LOG.md`, release decision/checklist, or remediation status;
- another lane’s namespaced directory.

If a worker needs a master-only change, it records the exact requested patch in its handoff. It must not edit the file “just to make tests pass.”

### Lane-safe structure

- Workers add or modify only the namespaced paths listed in the checkpoint packet.
- One worker owns each app/package manifest that must change; the master reconciles the root lockfile once after all manifest-owning commits merge.
- Canonical migrations have one owner: normally the master after reviewing lane schema proposals under a checkpoint-specific proposal directory.
- Consumers do not invent duplicate domain/contract types; they import the canonical owner after integration.
- Route registration, export barrels and navigation composition are master integration work unless a single lane owns the whole file.
- Workers run narrow tests in isolation. A worker is not required to make another parallel lane’s not-yet-merged API compile.

Before launch, the master builds a path-level conflict matrix. If two lanes need the same implementation file, redesign or sequence those lanes rather than accepting predictable conflicts.

## 9. Review and Merge

For each completed lane, inspect in its worktree:

```text
git status --short
git log --oneline -5
git diff --stat <base>...HEAD
git diff <base>...HEAD -- <owned paths>
```

Reject or reopen a lane when it has unrelated edits, mock product behavior, missing tenant/auth/audit controls, stale routes, unsafe provider claims, weak tests, hidden skips, shared-file violations, or no commit.

Merge dependency-producing commits first. After every merge run `git diff --check` and the narrow affected checks. After all lane merges, the master owns:

- contract and root export/route/navigation composition;
- schema proposal reconciliation into the single canonical migration, if required;
- root dependency/lockfile reconciliation;
- cross-lane authorization, tenant, audit, idempotency and error semantics;
- fixture/live/client contract reconciliation;
- integration fixes and regression tests;
- final documentation and evidence.

Do not merge a worker branch directly into `main`. Integrate and verify on `codex/integration/checkpoint-N`, then promote with an explicit non-fast-forward merge after the complete gate passes.

## 10. Testing and Evidence

Each checkpoint packet declares its additional tests. Every checkpoint closeout includes:

- `git diff --check`, workspace check, real typecheck, lint, full zero-skip test run with required socket access, build, high-severity dependency audit and release-scope secret scan;
- clean migration validation/bootstrap and RLS/tenant tests when data code changes;
- contract-generation drift, route parity and client tests when API boundaries change;
- browser rendering through Browser Use and repeatable Playwright for all changed UI, roles, denied roles, desktop/390px, loading/error/unavailable and console/network checks;
- Chrome only when an official provider dashboard or existing authenticated Chrome state is required and authorized;
- Computer Use for native macOS/Xcode/simulator/device UI that CLI/API/browser tools cannot verify;
- physical devices, official provider sandboxes, deployed cloud, real alert delivery and live restore when the evidence tier requires them;
- sanitized evidence with revision, environment, tier, command/procedure, skips, artifacts, result and limitations;
- threat-model delta, remediation status, runbooks, memory, log and release decision.

Fixture UI smoke never proves the durable loader. Simulator evidence never proves provider/device/cloud/recovery readiness.

## 11. External-Authority Gates

The master may implement and test local foundations autonomously. It must request explicit authority before:

- applying or destroying AWS resources, changing DNS/domains, or running destructive restore/failover;
- registering/changing Meta, Razorpay, telephony, AI/STT or ABDM production/sandbox callbacks where external state changes;
- sending real messages, calls or payments;
- using real clinic exports or PHI;
- publishing signed mobile builds to external distribution;
- pushing or opening a pull request unless the kickoff authorizes it.

If a checkpoint’s required E4-E7 evidence depends on missing authority, credentials, provider approval, installed/activated tooling, a physical device, clinic personnel or elapsed production observation, the master must not mark it complete or launch the next checkpoint. Finish every safe prerequisite, record the exact blocker and ask for the smallest action required.

CP18 cannot honestly complete immediately after CP17: E7 requires observed multi-clinic or time-bounded production operations. The automation may monitor that external state only through an authorized integration; it cannot manufacture operational evidence.

## 12. Checkpoint Map

| Checkpoint | Worker count | Packet                                             | Required higher-tier dependency             |
| ---------- | -----------: | -------------------------------------------------- | ------------------------------------------- |
| CP12       |            4 | `CHECKPOINT_12_MODULAR_API_GENERATED_CONTRACTS.md` | CP11 commit and clean launch base           |
| CP13       |            4 | `CHECKPOINT_13_DURABLE_CLINIC_DAY.md`              | CP12 modular/lane-safe boundaries           |
| CP14       |            4 | `CHECKPOINT_14_CLOUD_SECURITY_OPERATIONS.md`       | AWS/tooling authority for E4/E5             |
| CP15       |            4 | `CHECKPOINT_15_OFFICIAL_PROVIDER_INTEGRATIONS.md`  | Deployed HTTPS edge and provider accounts   |
| CP16       |            4 | `CHECKPOINT_16_NATIVE_AI_INTEROPERABILITY.md`      | Devices and approved AI/ABDM/provider paths |
| CP17       |            4 | `CHECKPOINT_17_CONTROLLED_PILOT_LAUNCH.md`         | Exact E5 environment and clinic approvals   |
| CP18       |            4 | `CHECKPOINT_18_MULTI_CLINIC_GA.md`                 | Observed CP17 production evidence           |

## 13. Completion Contract

The autonomous orchestration run is complete only when CP18 E7 evidence is real, all in-scope hard findings are closed, the exact revision/environment is signed, and the heartbeat is disabled. If external reality prevents that outcome, the correct terminal state is a precise blocked handoff—not a weakened scope, fake success, or endless unchanged polling.
