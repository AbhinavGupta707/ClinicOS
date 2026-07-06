# CHANGELOG

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
