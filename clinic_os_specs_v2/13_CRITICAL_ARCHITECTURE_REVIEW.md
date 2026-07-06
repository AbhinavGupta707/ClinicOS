# 13 - Critical Architecture, Infrastructure, and Integration Review

**Date:** 2026-07-06  
**Status:** Review pass accepted as guidance for next implementation plan

## 1. Executive verdict

The v0.2 direction is substantially correct:

- Build a dental-first clinic operating system, not a marketplace clone.
- Build replacement-grade Ray-like clinic management functionality.
- Sell/deploy initially as an overlay across WhatsApp, calls, Google, Practo, payments, imaging, and existing records.
- Use a modular monolith with explicit domains, integration adapters, event/outbox, workflow/action proposals, audit, consent, and FHIR-ready clinical projections.
- Keep AI human-in-the-loop and draft-only for clinical output.

The main correction is not strategic; it is implementation posture. The build pack must be read as a **blue-sky production system built in vertical slices**, not as a bootstrap release. Any feature that is shipped must be production-grade for its intended scope. Test doubles are allowed for development and automated tests, but product behavior cannot rely on fake integrations, incomplete workflows, weak audit, or partial safety controls.

## 2. Research basis

Primary or near-primary sources reviewed:

- OpenAI API docs for Structured Outputs, tools/agents, Realtime, and speech-to-text.
- WhatsApp Business Platform product/docs entry points.
- Razorpay Payment Links and webhook/signature documentation.
- Google Business Profile API documentation.
- Practo Ray and Practo Prime public product documentation.
- ABDM/Eka ABDM Connect documentation.
- HL7 FHIR R4 overview, security, and AuditEvent docs.
- DICOM PS3.18 DICOMweb standard.
- Next.js, NestJS, PostgreSQL RLS, BullMQ, Temporal, AWS Well-Architected, OpenTelemetry, and OWASP ASVS documentation.

## 3. Highest-priority corrections

### 3.1 Production-grade vertical slices

Replace skeleton-release thinking with “first production vertical slice.”

Required rule:

```text
Defer whole features if needed. Do not ship half-features.
```

Examples:

- If payment links are in scope, implement idempotency, signature verification, webhook reconciliation, failure states, audit, and receipts.
- If WhatsApp is in scope, implement opt-in/out, templates, delivery status, inbound threading, provider failure handling, human takeover, and consent policy.
- If dental charting is in scope, implement edit history, source/provenance, review state, permissions, and timeline integration.
- If AI scribe is in scope, implement consent, retention, structured schemas, source anchors, evaluation, review UI, and sign-off before exposing it as product.

### 3.2 Durable workflows should move earlier

The current system has inherently long-running, stateful workflows:

- Patient recalls.
- Appointment confirmations.
- Payment reminders and reconciliation.
- Lab case lifecycle.
- Migration review and commit.
- Action proposal approval.
- AI transcription/review/sign-off.
- ABDM consent/data exchange.

BullMQ is suitable for fast Redis-backed background jobs, but the product's core workflow model is closer to durable execution. Use Temporal as the default for production workflow orchestration from the first deployable release, or formally document why a transactional outbox plus custom workflow runner meets the same durability, retry, visibility, versioning, and human-wait requirements.

Redis queues may still be used for short jobs, fanout, thumbnail generation, and non-critical async work.

### 3.3 Tenant isolation needs database enforcement

The specs already require `tenant_id` on primary tables and app-level guards. For health data, this should be strengthened:

- Enable PostgreSQL Row Level Security for tenant-owned PHI tables where feasible.
- Use app guards plus RLS, not either/or.
- Add tenant-isolation tests that attempt cross-tenant reads, writes, exports, signed URLs, webhooks, background jobs, and analytics queries.
- Ensure object storage paths and signed URL issuance are tenant-checked through the API.

### 3.4 Provider capability discovery is a product requirement

For every integration, implementation should diagnose in this layer order:

1. Is the integration/provider account registered?
2. Is the capability available for this provider and clinic account?
3. Is the official activation/certification flow complete?
4. Are credentials/scopes/webhooks healthy?
5. Only then debug permissions, runtime, payloads, retries, and UI behavior.

This is especially important for WhatsApp templates, Practo import/sync, Google Business Profile OAuth, Razorpay webhooks, ABDM milestones, DICOMweb/PACS, and telephony.

## 4. Layer-by-layer review

### 4.1 Product architecture

Correct:

- Dental-first is the right wedge because dental has structured workflow objects: teeth, surfaces, treatment phases, lab cases, images, consumables, estimates, and recalls.
- The overlay-to-replacement strategy is correct. Practo Prime/Profile should be treated as acquisition, while Ray-like operational workflows should be replaceable.
- Assistant-first workflow is essential. If the assistant dashboard does not reduce daily work, the doctor and owner value will not compound.

Recommended adjustment:

- Define the first production slice as:

```text
external lead/source -> lead inbox -> patient match -> appointment/queue -> encounter -> dental chart -> treatment plan -> invoice/payment state -> instructions -> recall/task -> source-attributed owner view
```

That slice can be narrow, but it must be complete.

### 4.2 Application architecture

Correct:

- Modular monolith first is appropriate. NestJS supports module-based, testable, loosely coupled server architecture, and Next.js is a reasonable choice for dense operational UI.
- REST/OpenAPI is appropriate for integrations, audits, and coding-agent implementation.
- Transactional outbox is the right consistency boundary for side effects.

Recommended adjustment:

- Add a BFF/API policy: Next.js may own UI composition, but PHI mutations, permissions, audit, integration side effects, and workflow commands must go through backend domain APIs.
- Add clear module contracts: domain services, command handlers, events, repositories, authorization policies, and audit hooks.
- Add API versioning and schema compatibility tests from the beginning.

### 4.3 Workflow and events

Correct:

- The event taxonomy is strong and should remain central.
- Action proposals and approval decisions are the right abstraction for safe automation.

Recommended adjustment:

- Treat workflow definitions/runs as production objects, not configuration sugar.
- Add workflow versioning, replay/migration strategy, idempotency keys, SLA timers, cancellation, dead-letter queues, operator recovery UI, and workflow audit.
- Tie every action proposal to a workflow run, triggering event, source evidence, approval policy, and tool execution result.

### 4.4 Data model and FHIR

Correct:

- Do not use FHIR as the internal database. Use an operational domain model and map clinically relevant resources to FHIR.
- FHIR R4 remains a pragmatic target for healthcare exchange even though newer FHIR versions exist.
- Lead attribution, migration batches, workflow runs, and action proposals are internal operational objects and should not be forced into FHIR.

Recommended adjustment:

- Add FHIR validation fixtures and profile tests before claiming FHIR readiness.
- Add clear mapping for dental observations and procedures, including tooth/surface extensions.
- Store generated FHIR snapshots with source domain version, mapping version, and validation result.

### 4.5 WhatsApp and communication

Correct:

- WhatsApp-first is correct for Indian clinic operations.
- Provider abstraction is required; business logic should not depend on one BSP.
- Do not scrape WhatsApp Web.

Recommended adjustment:

- Implement a provider capability matrix for direct Meta Cloud API and at least one BSP.
- Model template lifecycle: draft, submitted, approved, rejected, paused/disabled, versioned.
- Enforce opt-in/opt-out, message category, service-window rules, media handling, delivery/read receipts, failure reasons, retries, rate limits, and human takeover.
- Separate patient communication consent from marketing/recall consent.

### 4.6 Payments

Correct:

- Razorpay Payment Links are a reasonable initial payment primitive.
- Payment state must come from verified server-side events, not frontend redirects.

Recommended adjustment:

- Add payment reconciliation as a scheduled production workflow.
- Model partial payments, expired links, cancelled links, refunds, manual payments, duplicate webhooks, and disputed/mismatched provider state.
- Require signed callback/webhook verification before state changes.

### 4.7 Google and acquisition attribution

Correct:

- Google should start as an acquisition and reputation channel, not a core dependency.
- Source/UTM attribution and review request workflows are appropriate early.

Recommended adjustment:

- Add Google OAuth/account connection state if API access is used.
- Track review request sent/opened/clicked where lawful and available.
- Treat API features such as reviews, posts, location data, notifications, and insights as capability-gated.

### 4.8 Practo/Ray

Correct:

- Replace Ray-like operational workflows, but coexist with Prime/Profile/marketplace acquisition.
- Do not assume Practo public write APIs.
- Manual/import-first is the correct integration posture until official access is verified.

Recommended adjustment:

- Add Practo capability verification to Phase 0.
- Add import templates for patients, appointments, invoices, prescriptions, notes, and documents where exports are available.
- Keep Practo-originated records source-attributed and operationally owned by ClinicOS after conversion.

### 4.9 ABDM/FHIR

Correct:

- ABDM should not block the first clinic workflow.
- The likely first role is HIP, with HIU later.
- ABHA, HPR, HFR, care-context linking, consent, and encrypted FHIR exchange are real product surfaces, not just metadata fields.

Recommended adjustment:

- Treat ABDM readiness as a conformance program with milestones, sandbox/connector credentials, care-context design, consent logs, FHIR validation, and operational support.
- Do not expose ABHA linking in product until verification, consent, and recovery flows are production-grade.

### 4.10 Imaging and DICOM

Correct:

- Manual upload/folder ingest first is realistic for dental clinics.
- DICOMweb/PACS should be capability-gated.

Recommended adjustment:

- Make upload/folder ingest production-grade: DICOM/JPEG/PNG/PDF validation, metadata extraction, malware scanning, duplicate detection, thumbnailing, tooth/encounter tagging, signed URL access, and audit.
- Add DICOMweb adapter contracts for QIDO-RS, WADO-RS, and STOW-RS when a clinic exposes a compatible system.

### 4.11 Telephony

Correct:

- Missed-call recovery is high-value and belongs in the lead inbox.

Recommended adjustment:

- Verify Exotel/Knowlarity/Twilio India capabilities during discovery before selecting one provider.
- Model call status, recording consent, callback tasks, source attribution, failure states, and provider health.

### 4.12 AI

Correct:

- AI as draft/proposal, not direct mutation, is exactly right.
- Structured Outputs and typed schemas are appropriate for clinical extraction.
- Realtime should be used only when live transcript deltas are needed; file/bounded transcription is better for post-visit or uploaded audio.

Recommended adjustment:

- Add an AI gateway with provider registry, model/version routing, tenant AI disablement, retention policy, no-training/no-retention vendor controls, cost limits, and audit.
- Add golden transcript evaluation before pilot usage.
- Add language/accent/noise test cases for mixed Hindi/English dental conversations.
- Record prompt/schema/model version and source anchors for every clinical draft.

### 4.13 Security, privacy, and compliance

Correct:

- The security posture is strong: consent, audit, RBAC/ABAC, encryption, audit logs, retention, breach response, and vendor risk are treated as product requirements.

Recommended adjustment:

- Use OWASP ASVS as the security acceptance baseline.
- Add privileged MFA, device/session management, break-glass review, PHI log redaction tests, object malware scanning, backup restore drills, and incident response drills as release gates.
- Re-verify DPDP Rules 2025, state clinical establishment rules, e-prescription expectations, and cross-border AI/cloud processing with Indian legal counsel before production launch.

### 4.14 Infrastructure and operations

Correct:

- Managed Postgres, encrypted object storage, Redis/cache, containerized API/workers, secrets manager, WAF, and OpenTelemetry are appropriate.

Recommended adjustment:

- Define the first production environment as production, not “pilot-prod lite.”
- Require infrastructure-as-code, India-region preference, encrypted backups, restore tests, deployment rollback, database migration runbooks, queue/workflow dashboards, provider health dashboards, and incident/on-call process.
- Add SLOs for clinic-hours availability, webhook ingestion, queue latency, payment reconciliation, signed URL generation, and AI job latency.

### 4.15 Mobile/PWA capture

PWA-first may be acceptable for early workflow, but photo/X-ray capture and unstable clinic internet make offline upload reliability critical.

Recommended adjustment:

- Add a decision gate: if PWA cannot reliably support camera capture, offline queueing, background retry, file handling, and device permission UX on target Android/iOS devices, move capture to Expo/React Native earlier.

## 5. Spec changes made in this review pass

- Added root `AGENTS.md` with production-grade, blue-sky implementation instructions.
- Added production-grade vertical-slice principle to `README.md`.
- Updated architecture guidance to prefer Temporal/durable workflows for long-running clinic operations.
- Reframed roadmap scope reduction as deferring whole capabilities rather than cutting quality.
- Replaced fake/partial product language in the implementation prompt and backlog with contract-tested simulators and production adapter boundaries.
- Clarified the first release as a first production vertical slice in the PRD.

## 6. Remaining open decisions

1. Which auth provider or self-hosted identity stack will satisfy data residency, MFA, audit, role management, and future SSO requirements?
2. Which WhatsApp route is first: direct Meta Cloud API, Gupshup, WATI, Interakt, or another BSP?
3. Which workflow runtime is accepted for first production: Temporal, or a custom durable runner over Postgres/outbox with a written equivalence argument?
4. Which cloud/provider and India region are preferred for production?
5. Which pilot clinics can provide real exports from Practo/Ray/Eka and real WhatsApp/call/payment workflows?
6. What legal position will be taken on audio retention, cross-border AI processing, DPDP Rules 2025, and state-specific clinical requirements?
