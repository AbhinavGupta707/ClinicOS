# CHANGELOG

## 2026-07-10 — CP13 durable clinic-day E3 candidate

Changed:

- Integrated exact front-office, clinical/dental, treatment/billing and continuity/operations
  feature maps behind the generated contract and transaction-bound PostgreSQL module boundary.
- Added canonical migration 0017 durability controls, signed bounded due-generation cursors,
  provider-event/payment-intent recovery, least-privilege worker activities and deterministic
  Temporal workflows.
- Mounted role-scoped generated-client web workspaces with transient record selection, fail-closed
  token registration, clinic-timezone operations, honest payment/media states and desktop/390px
  coverage.
- Added clean-origin two-pass runtime smoke, crash/restart/replay recovery, post-smoke RLS
  verification and final CP13 evidence/threat/final-report artifacts.

Release truth:

- CP13 passes at E3 durable-local scope and is ready for controlled promotion to `main`.
- ClinicOS remains **NO-GO** for pilot/production; CP14-CP18 cloud/session/provider/media/device/
  recovery/clinic evidence remains mandatory, and CP14 has not started.

## 2026-07-10 — Orchestrator credential-boundary preflight

Changed:

- Hardened the credential handoff for orchestration: master-only ignored secrets at mode `0600`, `clinicos-human` AWS verification, simulator provider selectors until authorized CP15 activation, explicit GitHub reauthentication gate, and historical-worktree classification before CP12 launch.
- Verified the AWS account, stored provider-credential presence, Terraform backend identifiers, synthetic fixture paths, and 12 clean historical worktrees without exposing secrets or reusing old lanes.

Resolved launch gate:

- GitHub CLI authentication now passes with `repo` and `workflow` scopes. Terraform and later external authorities remain checkpoint-specific gates rather than CP12 implementation blockers.
- Added a strict `medium`-reasoning exception for substantial spec-frozen mechanical tasks only; no currently planned implementation lane was downgraded.
- Made `orchestrate-worktrees` an explicit mandatory master-start action in AGENTS, the canonical program and the autonomous kickoff instead of relying on implicit skill triggering.

## 2026-07-09 — CP12-CP18 worktree orchestration transition

Changed:

- Promoted the fully verified CP11 durable-local foundation to `main` at `a6109bb`.
- Restored explicit master-orchestrated worktrees for CP12-CP18 at the user's direction.
- Set the master to `gpt-5.6-sol` `xhigh`; worker lanes use `gpt-5.6-sol` `high` or `xhigh` according to boundary risk.
- Added a canonical orchestration program covering visible project worktrees, a verified 90-second heartbeat request/fallback, quiet monitoring, path-level conflict prevention, worker handoffs, integration branches, merge review, testing and sequential promotion.
- Added launch packets with non-overlapping lane ownership for CP12 modular API/contracts, CP13 durable clinic day, CP14 cloud/security operations, CP15 official providers, CP16 mobile/AI/interoperability, CP17 controlled pilot and CP18 multi-clinic GA.
- Replaced fixed four-worker checkpoint assumptions with an adaptive lane gate. CP12 now starts with three workers; later checkpoints provisionally use three-to-four or two-to-three only when paths, inputs, tests and external environments are genuinely independent. Dependent QA/UI work stays with the master or launches as a later optional wave.
- Reclassified the prior single-session runbook as CP11 history only and updated AGENTS, indexes, memory and checkpoint state.

Unchanged:

- Release remains **NO-GO** until the required E4-E7 cloud, provider, device, recovery, clinic and production evidence exists.
- External state changes and real PHI still require explicit authority; orchestration cannot manufacture evidence.

## 2026-07-09 — CP11 durable local verification foundation

Changed:

- Added deterministic injected clocks and clinic-local calendar behavior at critical API and
  PostgreSQL boundaries, with midnight, leap-day and DST regression coverage.
- Replaced syntax-only TypeScript claims with real `tsc` coverage for all 14 production workspaces
  and a negative cross-package type fixture.
- Added pinned Flyway lifecycle migrations 0011-0014, guarded clean bootstrap, checksum/drift/lock
  tests, 96 forced-RLS tenant tables and separate migrator, API runtime and outbox worker roles.
- Made API operations, audit, timeline and outbox writes atomic and proved commit/rollback,
  idempotency, pooled-context reset and cross-tenant denial against PostgreSQL.
- Aligned the worker with the canonical outbox schema, durable attempt/retry/dead-letter state,
  least-privilege RLS and clean startup/shutdown/restart behavior.
- Split liveness/startup/readiness and added bounded Postgres schema and Keycloak JWKS fault/recovery
  probes with traffic removal.
- Replaced the CP10 live path with runtime-ID discovery and a two-pass durable CP11 chain that
  detects fixture repository fallback.
- Added repeatable owner/mobile and denied-role Playwright checks, rendered in-app Browser evidence,
  a local performance baseline, migration/worker runbooks, threat delta and E3 evidence record.
- Kept user-owned `research/` and `scripts/research/` outside release formatting without modifying
  them.

Release truth:

- CP11 is an E3 durable-local foundation only. ClinicOS remains **NO-GO** for pilot/production;
  deployed cloud, provider, physical-device, restore/failover, security operations and real-clinic
  evidence remain open.

## 2026-07-09 — Independent production-readiness reset

Changed:

- Reclassified CP10 as valuable E1/E2 local/fixture evidence, not pilot or production readiness.
- Set the current pilot/production decision to **NO-GO** pending durable database, deployable cloud, security, provider, device, recovery and clinic evidence.
- Added plans 23 and 24 for the production architecture, CP11-CP18 sequence, threat model, controls and hard release gates.
- Added the independent 30-finding remediation register and E0-E7 production evidence standard.
- Added a single persistent master-session execution runbook and launch-ready CP11 durable-data/evidence packet.
- Made worktree orchestration historical/optional for post-CP10 work following the user's explicit execution preference.
- Superseded synthetic restore and configured-credential claims as production evidence; live restore, official callback, physical-device and deployed control evidence are required.

Unchanged:

- Production-grade vertical slices, tenant isolation, consent, audit, official integrations and human clinical sign-off remain non-negotiable.
- Existing CP1-CP10 reports remain preserved as historical evidence and regression context.

## v0.2 - Practo/Plena architecture revision

Changed:

- Reframed product as **automation overlay + replacement-grade clinic OS + specialty operating layer**.
- Clarified Practo strategy: replace Ray-like workflows; coexist with Prime/Profile/marketplace.
- Added lead/booking inbox and source attribution as P0.
- Added migration/source-of-truth policy as P0.
- Added workflow primitives, action proposals, approval decisions, and agent harness.
- Updated roadmap so overlay foundation is built earlier.
- Updated integration spec so Practo API is capability-driven and not assumed.
- Added v0.2 architecture decision record.
- Added critical architecture review and blue-sky production-grade implementation guidance.
- Added stack and vendor decision defaults for workflow runtime, cloud region, WhatsApp, payments, ABDM, mobile capture, and AI/scribe architecture.
- Added pilot field note from a dental doctor workflow conversation, covering WhatsApp/missed calls, appointment confirmations, six-month recall, new/returning patient flow, charting, phone photos, X-ray software coexistence, UPI billing, prescriptions/instructions, lab work, inventory, event management, and recurring protocols.
- Archived superseded roadmap, initial backlog, v0.2 ADR, and duplicated combined build pack.
- Added lean implementation index and three focused production execution plans: platform/infrastructure, clinic OS/dental product, and integrations/AI/mobile/interoperability.
- Added worktree orchestration checkpoint plan with 10 build checkpoints plus Git preflight, lane guidance, merge order, and verification gates.
- Added user-perspective verification requirements for browser/app/provider simulation checks, autonomous sequential execution rules, and a credentials/input checklist for end-to-end testing.
- Replaced the old agent handoff prompt with a concise launcher that points agents to the active implementation plans.
- Tightened roadmap/backlog/handoff language so the first release means a production-grade vertical slice, not a fake/partial implementation.
- Moved durable workflow execution earlier as a production recommendation for long-running clinic workflows.

Unchanged:

- Dental remains the first wedge.
- Modular monolith remains the recommended initial architecture.
- Human-in-the-loop clinical safety remains non-negotiable.
- ABDM/FHIR readiness remains important but not a day-one adoption blocker.
