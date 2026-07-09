# CHANGELOG

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
