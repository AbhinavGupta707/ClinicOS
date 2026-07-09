# ClinicOS India: AI-Native Private Clinic Operating System Build Pack v0.2

**Date:** 2026-07-06  
**Primary wedge:** Dental clinics in India  
**Product stance:** replacement-grade clinic OS, deployed initially as an automation overlay  
**Intended reader:** product/engineering team, Claude Code, Codex, or another implementation agent

## What changed in v0.2

This version incorporates the Practo/Plena architecture revision:

- Build **Ray-like clinic-management functionality as a replacement from day one**: scheduling, queue, records, notes, dental charting, prescriptions, billing, reminders, recalls, lab, inventory, and analytics.
- Do **not** try to replace Practo Prime/Profile/marketplace demand on day one. Treat Practo, Google, website, WhatsApp, calls, Instagram, and referrals as **external acquisition sources**.
- Deploy initially as an **automation overlay** across existing tools so clinics do not need a risky rip-and-replace migration.
- Architect the system in three layers: **Automation Overlay -> Replacement-Grade Clinic OS -> Specialty Operating Layers**.
- Make integration adapters, source attribution, migration batches, workflow primitives, action proposals, approval rules, and agent tools first-class product/engineering objects.

## What this build pack is

This is a handoff-quality product and technical specification for building an AI-native clinic operating system for Indian private clinics. It is designed to be concrete enough for an AI coding agent to turn into an implementation plan and begin execution.

The product is not an appointment app, not a Practo marketplace clone, and not a standalone AI scribe. The target is a **clinic operating loop**:

```text
External demand -> lead/booking inbox -> appointment/queue -> intake -> consultation -> structured record -> treatment plan -> billing/payment -> follow-up/recall -> lab/inventory/quality tasks -> owner analytics
```

## Recommended reading order

For implementation agents:

1. `../AGENTS.md` - root non-negotiable build instructions.
2. `23_PRODUCTION_READINESS_REMEDIATION_PLAN.md` - current post-CP10 production implementation sequence and target architecture.
3. `24_PRODUCTION_SECURITY_THREAT_MODEL_AND_CONTROLS.md` - current threat model and mandatory controls.
4. `../docs/security/PRODUCTION_SECURITY_AND_READINESS_REMEDIATION_REGISTER.md` - audited findings and closure evidence.
5. `../docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md` - evidence tiers and release claim rules.
6. `../docs/implementation/POST_CP10_SINGLE_SESSION_EXECUTION_PROGRAM.md` - current execution protocol.
7. `16_DOCUMENTATION_STRUCTURE_AND_IMPLEMENTATION_INDEX.md` - active documentation map and implementation workstream index.
8. `01_PRD.md` - product vision, personas, workflows, replacement/coexistence strategy.
9. `14_STACK_AND_VENDOR_DECISIONS.md` - current defaults for workflow runtime, auth, cloud region, WhatsApp, payments, ABDM, mobile capture, and AI/scribe architecture.
10. `15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md` - real dental clinic workflow evidence and pilot archetype.
11. `02_SYSTEM_ARCHITECTURE.md` - three-layer architecture, tech stack, integration and event-driven design.
12. `03_DOMAIN_MODEL_AND_FHIR_MAPPING.md` - canonical entities, source attribution, workflow primitives, FHIR R4 mapping.
13. `06_SECURITY_PRIVACY_COMPLIANCE_INDIA.md` - DPDP, consent, audit, integration/legal guardrails.
14. `17_IMPLEMENTATION_PLAN_PLATFORM_INFRA.md` - platform and infrastructure execution plan.
15. `18_IMPLEMENTATION_PLAN_CLINIC_OS_DENTAL.md` - clinic workflow and dental product execution plan.
16. `19_IMPLEMENTATION_PLAN_INTEGRATIONS_AI_MOBILE.md` - integrations, mobile capture, AI, and interoperability execution plan.
17. `08_USER_STORIES_AND_ACCEPTANCE_CRITERIA.md` - implementation-ready user stories and acceptance criteria.
18. `09_API_CONTRACTS_AND_EVENTS.md` - API, event, and agent action contracts.
19. `04_INTEGRATIONS_SPEC.md` - integration reference details.
20. `05_AI_AGENTS_AND_CLINICAL_SAFETY.md` - AI safety reference details.
21. `13_CRITICAL_ARCHITECTURE_REVIEW.md` - research-backed review record and rationale.
22. `00_SOURCE_REGISTER.md` - research sources and evidence notes.
23. `21_EXECUTION_INPUTS_AND_CREDENTIALS.md` - credentials, sandbox accounts, clinic inputs, and access needed for autonomous verification.
24. `22_CREDENTIAL_SETUP_GUIDE.md` - concrete provider setup steps and env fields for autonomous credential preflight.

`20_ORCHESTRATION_CHECKPOINT_PLAN.md` and CP1-CP10 reports remain historical implementation records. Post-CP10 execution no longer defaults to worktree orchestration; plan 23 and the single-session program are authoritative.

Historical roadmap/backlog/ADR material lives in `archive/` and is not current implementation guidance.

## Core architecture decision

Build a **modular monolith first**, but with explicit domain modules, adapter interfaces, an outbox/event bus, and an agent action framework. This gives the speed of a monolith while preserving the ability to split services later.

## Core product decision

Start with **dental** because dental has structured, monetisable workflow objects: teeth, surfaces, findings, X-rays, intraoral photos, procedures, treatment phases, lab work, consumables, recalls, and estimates.

## Non-negotiable principles

- Build replacement-grade clinic-management functionality from the beginning.
- Build production-grade vertical slices only. A feature may be deferred, but any feature that is built must be fully functional, saleable, secure, observable, tested, documented, and integration-correct for its intended scope.
- Scope is reduced by shipping fewer complete workflows, not by using mock, placeholder, partial, or make-shift product behavior.
- Deploy as an overlay first to reduce adoption friction.
- Human-in-the-loop for clinical output: AI drafts; doctor signs.
- WhatsApp-first operations for India, with SMS and calls as fallback.
- FHIR-ready data model and ABDM-ready interoperability, without making ABDM a day-one adoption blocker.
- Tenant isolation, audit logs, consent, privacy, and action provenance from day one.
- Do not build a marketplace in v1. Use Practo/Google as acquisition sources while owning conversion, retention, records, and operations.
- Build the assistant workflow, not just the doctor workflow.

## Pilot success definition

Within 4-8 weeks, a pilot clinic should feel that ClinicOS has replaced scattered WhatsApp lists, paper cards, lab diaries, recall diaries, inventory diaries, and end-of-day note writing for a meaningful portion of daily operations, while still allowing Practo/Google/phone/WhatsApp to bring patients into the top of funnel.
