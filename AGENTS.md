# ClinicOS Agent Instructions

## Production-Grade Scope

- Build for the blue-sky production system, not a throwaway MVP, demo, or bootstrap.
- A feature may be sequenced later, but any feature that is built must be fully functional, production-grade, distribution-ready, saleable, observable, secure, tested, and documented for its intended scope.
- Do not use mock, stub, placeholder, or partial implementations in product code. Test doubles, simulators, and fixtures are allowed only for local development and automated tests, and they must sit behind the same typed provider contracts as production integrations.
- Scope should be reduced by shipping fewer complete vertical slices, not by weakening quality, safety, permissions, auditability, integration correctness, or user experience.
- For missing, unavailable, or unlisted features, diagnose in layer order: registration/discovery/install state and official activation flows first; permissions/runtime only after the feature is actually present.
- External integrations must use official APIs, partner integrations, signed webhooks, authorized exports/imports, or explicit clinic-approved manual workflows. Do not build unauthorized scraping or brittle browser automation as a dependency.

## Source Of Truth

- Treat the individual Markdown files in `clinic_os_specs_v2/` as canonical.
- `COMBINED_BUILD_PACK.md` is a packaging artifact and may lag behind individual spec edits.

## Orchestration And Integration

- Post-CP10 remediation defaults to one persistent master Codex session executing CP11-CP18 sequentially. Read `clinic_os_specs_v2/23_PRODUCTION_READINESS_REMEDIATION_PLAN.md`, `clinic_os_specs_v2/24_PRODUCTION_SECURITY_THREAT_MODEL_AND_CONTROLS.md`, `docs/security/PRODUCTION_SECURITY_AND_READINESS_REMEDIATION_REGISTER.md`, `docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md`, `docs/implementation/POST_CP10_SINGLE_SESSION_EXECUTION_PROGRAM.md`, `docs/AGENT_MEMORY.md`, and `docs/orchestration/CHECKPOINT_LOG.md` before checkpoint work.
- Do not launch worktree lanes, worker sessions, or hidden subagents unless the user explicitly opts back into parallel execution. A checkpoint remains a strict scope/evidence boundary even when the same master session executes every checkpoint.
- The master session owns architecture, implementation, diff review, verification, evidence, and the release decision. Do not begin a later checkpoint while the active checkpoint exit gate fails.
- Treat `package-lock.json`, root/app manifests, migrations, API contracts, generated files, environment schemas, Terraform/local stack files, and release evidence as high-risk integration points. Inspect all consumers and reconcile each coherently.
- If the user later explicitly chooses worktree orchestration, use visible project-scoped Codex worktree threads: `target.type = "project"` with `projectId = "/Users/abhinavgupta/Desktop/ClinicOS"` and `environment.type = "worktree"`. Do not use hidden subagents or raw `git worktree add` for sidebar-visible worker work. Then follow `docs/orchestration/MERGE_INTEGRATION_RUNBOOK.md`, define ownership/forbidden paths first, keep one integration owner for `package-lock.json`, and verify in dependency order before promotion.
- Browser/mobile smoke is mandatory for implemented UI workflows, but temporary UI should be tested for safety and responsiveness rather than final visual polish. Required invariants include no mobile horizontal overflow, reachable primary controls, honest loading/error/unavailable states, and no fake PHI or fake workflow completion presented as product behavior.
- When a browser workflow is smoke-tested in fixture mode, also verify the live API helper contract with a focused test or live smoke. Fixture UI smoke does not prove that web clients call the durable route family correctly.
- Before declaring a checkpoint complete, reconcile deterministic fixture scripts, live API route contracts, and browser/app data loaders. If they describe different workflows, choose the canonical production contract and defer any older or separate workflow whole rather than adding a weak compatibility stub.
