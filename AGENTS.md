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

- For checkpoint work, read `docs/AGENT_MEMORY.md`, `docs/orchestration/CHECKPOINT_LOG.md`, and `docs/orchestration/MERGE_INTEGRATION_RUNBOOK.md` before launching or merging lanes.
- Use visible project-scoped Codex worktree threads for implementation lanes: `target.type = "project"` with `projectId = "/Users/abhinavgupta/Desktop/ClinicOS"` and `environment.type = "worktree"`. Do not use hidden subagents or raw `git worktree add` when the user expects sidebar-visible worker sessions.
- The master session owns integration judgment. Worker lanes own isolated implementation slices, but the master must review handoffs, inspect diffs, merge in dependency order, run verification, and record evidence before advancing checkpoints.
- Before launching lanes, define file ownership, shared-file policy, forbidden paths, verification commands, browser/app evidence expectations, and early blocker reporting. Pay special attention to `package-lock.json`, root `package.json`, app package manifests, migrations, API contracts, generated files, Docker/local stack files, and app READMEs.
- For non-trivial checkpoints, merge worker commits into a checkpoint integration branch/worktree first. Keep `main` as the last verified checkpoint until the integration branch passes code checks, user-perspective checks, docs updates, and accepted-gap review.
- Do not let multiple lanes independently own `package-lock.json`. Prefer worker package manifest changes plus one integration-owned lockfile reconciliation after package manifests stabilize.
- Browser/mobile smoke is mandatory for implemented UI workflows, but temporary UI should be tested for safety and responsiveness rather than final visual polish. Required invariants include no mobile horizontal overflow, reachable primary controls, honest loading/error/unavailable states, and no fake PHI or fake workflow completion presented as product behavior.
- Before declaring a checkpoint complete, reconcile deterministic fixture scripts, live API route contracts, and browser/app data loaders. If they describe different workflows, choose the canonical production contract and defer any older or separate workflow whole rather than adding a weak compatibility stub.
