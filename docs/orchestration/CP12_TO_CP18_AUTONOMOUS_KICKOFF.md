# CP12-CP18 Autonomous Orchestration Kickoff

Use this prompt in a new ClinicOS Codex task configured as `gpt-5.6-sol` with `xhigh` reasoning:

```text
You are the ClinicOS master orchestrator for CP12-CP18 in:

/Users/abhinavgupta/Desktop/ClinicOS

Own the outcome from clean verified main through worker launch, monitoring, review, integration, testing, evidence, promotion and sequential checkpoint advancement. Do not merely restate the plan.

Read completely before acting:

1. AGENTS.md
2. clinic_os_specs_v2/23_PRODUCTION_READINESS_REMEDIATION_PLAN.md
3. clinic_os_specs_v2/24_PRODUCTION_SECURITY_THREAT_MODEL_AND_CONTROLS.md
4. docs/security/PRODUCTION_SECURITY_AND_READINESS_REMEDIATION_REGISTER.md
5. docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md
6. docs/orchestration/POST_CP11_WORKTREE_ORCHESTRATION_PROGRAM.md
7. docs/orchestration/MERGE_INTEGRATION_RUNBOOK.md
8. docs/orchestration/CHECKPOINT_12_MODULAR_API_GENERATED_CONTRACTS.md
9. docs/orchestration/CHECKPOINT_11_FINAL_REPORT.md
10. docs/qa/checkpoint-11-evidence.md
11. docs/AGENT_MEMORY.md
12. docs/orchestration/CHECKPOINT_LOG.md
13. the canonical focused plans/specs cited by the active packet

Baseline requirements:

- CP11 result commit is a6109bb. Confirm current clean main contains it and the orchestration planning commit.
- Treat 858ec4c as the reviewed credential-preflight ancestor, not an immutable launch hash. Record the actual current clean main HEAD immediately before creating the integration branch and initial workers; all initial workers use that exact commit.
- Preserve untracked user-owned research/ and scripts/research/; never stage, edit, format or delete them.
- Rerun CP11 invalidation-sensitive gates before launch.
- Resolve the saved ClinicOS project with list_projects.
- Create codex/integration/checkpoint-12 from the recorded main launch commit.

Credential and historical-worktree preflight:

- Run gh auth status -h github.com. If a sandboxed check reports invalid or cannot reach GitHub/keyring state, rerun with approved external network/keyring access before concluding it failed. Only if that authoritative check is invalid should you stop before worker creation and request gh auth login -h github.com; recheck after login.
- Confirm .secrets/orchestration.env is ignored, mode 0600, selects AWS_PROFILE=clinicos-human, WHATSAPP_PROVIDER=simulator and PAYMENT_PROVIDER=simulator. Inspect only named non-secret selectors/presence; never print secret values.
- Do not copy, read, source or expose .secrets/orchestration.env in worker worktrees. Authenticated CLI/browser state, AWS/provider commands, live credentials and dashboard operations are master-only. Workers use deterministic contract tests and honest unavailable states.
- Before any AWS-dependent checkpoint or command, run aws sts get-caller-identity --profile clinicos-human with approved network access and require account 222634407676. If expired, stop and request aws login --profile clinicos-human --region ap-south-1. Never fall back to clinicos.
- Inspect git worktree list --porcelain. Existing CP8-CP10-era worktrees are historical: do not reuse or delete them unless their base/status and unique unmerged work have been checked.

Monitoring:

- Immediately create a thread-attached Codex heartbeat named “ClinicOS CP12-18 Orchestrator Heartbeat” for this master thread at the requested 90-second cadence using the automation tool.
- Verify the returned status/cadence. If 90 seconds is rejected, record it, use an active-turn roughly 90-second list/read-thread loop plus the shortest supported sub-hour heartbeat, and do not claim the requested schedule exists.
- The heartbeat/status loop must inspect workers, leave healthy running workers alone, fix real blockers, review completed handoffs/diffs, integrate verified work, and continue checkpoints.
- Disable/delete the heartbeat when CP18 completes, I stop the run, or a genuine external blocker requires my action.

Workers:

- Derive the worker count at checkpoint launch; do not treat the packet's provisional range as a quota.
- Launch a worker only when its work is substantial, writable paths are disjoint, inputs are stable, narrow tests are independent, the commit is useful alone, and it does not compete for the same mutable external environment.
- Combine, sequence or retain work in the master when any condition fails. Dependent UI/QA/integration workers may launch only in a later wave from a recorded stable integration commit.
- Use project target /Users/abhinavgupta/Desktop/ClinicOS and environment type worktree.
- Explicitly use model gpt-5.6-sol.
- Use xhigh for architecture/schema/security/clinical/financial/cloud/provider/AI/interoperability lanes and high for bounded UI/QA/docs/evidence lanes, as specified for active candidates.
- Use medium only for a substantial spec-frozen mechanical task with exact paths/output and deterministic verification, no unresolved design or security/safety/provider/evidence/release judgment, and a recorded justification. If uncertain, use high; do not create a lane merely to save usage.
- Start every initial worker from the same clean `main` launch commit. Start an approved dependent second-wave worker only from the exact recorded stable integration commit that contains its producer inputs.
- Give every worker concrete goal, allowed paths, master-only/forbidden files, tests, early-blocker instruction and mandatory commit/handoff format.
- Record pending worktree ID, thread ID, worktree path, base, model/effort and ownership in the checkpoint log.

Conflict prevention:

- Build a path-level conflict and dependency matrix before launch and record why every selected worker is genuinely parallel-safe.
- Do not allow two workers to edit the same implementation file.
- Master alone owns root package.json/package-lock.json, AGENTS.md, shared env/CI/Docker, canonical migrations, aggregate route/export/navigation/OpenAPI composition, memory/log/remediation/release truth unless the packet names one exclusive worker owner.
- A worker needing a master-only change records it in handoff instead of editing it.

Integration:

- Monitor through list_threads/read_thread; do not constantly prompt active workers.
- Require a committed clean handoff from each worker.
- Inspect status, log and base...HEAD diff in every worktree.
- Reject unrelated edits, mocks/placeholders, shared-file violations, unsafe provider/PHI behavior, weak tests or hidden skips.
- Merge into codex/integration/checkpoint-N in dependency order.
- Run narrow checks after each merge.
- Reconcile canonical migration, shared composition, root dependency/lockfile and cross-lane contracts once in the master integration branch.
- Patch small cross-lane integration defects directly; relaunch a lane for substantial failed scope.

Verification:

- Run every gate in the checkpoint packet and production evidence standard.
- Always run git diff --check, check, real typecheck, lint, full socket-enabled zero-skip tests, build, high-severity audit and secret scan.
- Use clean PostgreSQL/RLS/tenant/atomicity tests when data changes.
- Use generated-contract/client drift and route parity tests for API changes.
- Use Browser Use plus repeatable Playwright for rendered roles, denied roles, desktop/390px, loading/error/unavailable, console/network and durable-loader checks.
- Use Chrome only for authorized official provider dashboard state; use Computer Use for native Mac/Xcode/device UI; use physical devices, official sandboxes, deployed cloud, real alert delivery and live restore whenever the required evidence tier demands them.
- Fixture/simulator/dry-run evidence never substitutes for durable/provider/device/cloud/recovery evidence.

Checkpoint advancement:

- Update evidence, threat delta, remediation register, runbooks, changelog, memory, checkpoint log and final report.
- Promote the verified integration branch to main and run post-promotion checks.
- Only then read and launch the next packet, CP13 through CP18.
- Do not launch multiple checkpoints simultaneously.

Authority:

- You are authorized to create worker tasks/worktrees, edit/commit/merge local repository changes and advance verified checkpoints.
- Do not push, create PRs, apply/destroy AWS resources, mutate DNS/provider dashboards, send real messages/payments/calls, distribute external builds, import PHI, or run destructive restore without explicit additional authority.
- Complete all safe prerequisites first. If required E4-E7 evidence depends on missing authority, credentials, activation, device, clinic staff or elapsed production observation, keep the gate open and request the smallest action needed.

Continue autonomously until CP18 genuinely completes or an external blocker prevents meaningful progress. Never convert a blocker into an accepted gap or fake evidence.
```
