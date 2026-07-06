# 10 - Agent Handoff Prompt for Claude Code / Codex

Copy this prompt into a coding agent when starting implementation.

---

You are implementing **ClinicOS India**, an AI-native operating system for Indian private clinics, starting with dental.

Before writing code, read:

1. `AGENTS.md`
2. `clinic_os_specs_v2/README.md`
3. `clinic_os_specs_v2/16_DOCUMENTATION_STRUCTURE_AND_IMPLEMENTATION_INDEX.md`
4. `clinic_os_specs_v2/20_ORCHESTRATION_CHECKPOINT_PLAN.md`
5. The implementation plan for your assigned workstream:
   - `17_IMPLEMENTATION_PLAN_PLATFORM_INFRA.md`
   - `18_IMPLEMENTATION_PLAN_CLINIC_OS_DENTAL.md`
   - `19_IMPLEMENTATION_PLAN_INTEGRATIONS_AI_MOBILE.md`
6. Any companion docs cited by that implementation plan.

## Mission

Build ClinicOS as a production-grade, dental-first clinic operating system for India.

The product is not an appointment app, not a marketplace clone, and not a standalone scribe. The target operating loop is:

```text
external demand
  -> lead/booking inbox
  -> patient match
  -> appointment/queue
  -> intake/consent
  -> encounter
  -> dental chart/media
  -> treatment plan
  -> invoice/payment
  -> prescription/instructions
  -> recall/lab/inventory/event/SOP tasks
  -> source-attributed owner analytics
```

## Non-Negotiables

- Build blue-sky production-grade vertical slices.
- A feature may be deferred, but any feature that is implemented must be complete, secure, observable, tested, documented, integration-correct, and saleable for its intended scope.
- Do not ship mock, stub, placeholder, fake, or partial product behavior.
- Test doubles and provider simulators are allowed only for local development and automated tests, behind the same typed contracts as production integrations.
- Do not build autonomous diagnosis or prescription finalization.
- AI output is draft/proposal only until the correct human approves it.
- Every tenant-owned table needs tenant isolation strategy.
- Sensitive access creates audit logs.
- External side effects require idempotency, retry/dead-letter handling, and provenance.
- Payment success is trusted only after verified provider webhook/provider-state checks.
- WhatsApp, payments, telephony, AI, imaging, and ABDM must sit behind provider/adaptor boundaries.
- Practo is an acquisition/import source, not a guaranteed API dependency.
- Do not build unauthorized scraping or brittle browser automation.

## Stack Defaults

- Web: Next.js + React + TypeScript.
- API: NestJS + REST + OpenAPI.
- Mobile capture: Expo/React Native.
- Database: PostgreSQL.
- Workflow runtime: Temporal.
- Short jobs/cache: Redis; BullMQ only for short non-durable jobs if needed.
- Auth: self-hosted Keycloak.
- Cloud: AWS India, Mumbai primary, Hyderabad DR/warm standby.
- Messaging: direct Meta WhatsApp Cloud API by default, BSP adapters as fallbacks.
- Payments: Razorpay dynamic invoice-specific UPI QR and Payment Links first.
- AI: backend-mediated provider gateway with consent, retention, provenance, review, and evaluation.
- Interoperability: internal operational model plus FHIR R4 projections; direct ABDM/NHA path later.

## First Work

Do not invent a new roadmap. Start from the focused plans:

- Orchestrated checkpoint execution is governed by `20_ORCHESTRATION_CHECKPOINT_PLAN.md`.
- Platform/infrastructure work begins with `17_IMPLEMENTATION_PLAN_PLATFORM_INFRA.md`.
- Clinic product work begins with `18_IMPLEMENTATION_PLAN_CLINIC_OS_DENTAL.md`.
- Integrations/mobile/AI work begins with `19_IMPLEMENTATION_PLAN_INTEGRATIONS_AI_MOBILE.md`.

Use `16_DOCUMENTATION_STRUCTURE_AND_IMPLEMENTATION_INDEX.md` to understand cross-workstream sequencing and definitions of ready/done.

---
