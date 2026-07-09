# 16 - Documentation Structure and Implementation Index

**Date:** 2026-07-09
**Status:** Canonical planning index
**Purpose:** Keep the project documentation lean, remove duplicated planning paths, and give implementation agents a clear execution map.

> **Current authority (2026-07-09):** CP11 is complete at E3. Plan 23, plan 24, the remediation register, evidence standard, and `docs/orchestration/POST_CP11_WORKTREE_ORCHESTRATION_PROGRAM.md` govern CP12-CP18. The user explicitly selected one `gpt-5.6-sol` `xhigh` master plus two to four visible isolated worktree workers per checkpoint.

## 1. Executive Decision

The original build-pack structure used one implementation index plus three focused implementation plans and a CP0-CP10 worktree plan:

1. `16_DOCUMENTATION_STRUCTURE_AND_IMPLEMENTATION_INDEX.md` - this document; explains doc structure, archived material, workstream boundaries, and execution sequence.
2. `20_ORCHESTRATION_CHECKPOINT_PLAN.md` - sequential worktree checkpoint plan, lane shape, verification gates, and execution prompts.
3. `17_IMPLEMENTATION_PLAN_PLATFORM_INFRA.md` - platform, infrastructure, tenancy, security, data, workflow runtime, CI/CD, observability.
4. `18_IMPLEMENTATION_PLAN_CLINIC_OS_DENTAL.md` - web product, clinic workflow, dental operating layer, billing, tasks, lab, inventory, analytics.
5. `19_IMPLEMENTATION_PLAN_INTEGRATIONS_AI_MOBILE.md` - WhatsApp, payments, telephony, Practo/Google, migration, mobile capture, AI/scribe, FHIR/ABDM, imaging.

Post-CP10 remediation adds two canonical plans without duplicating the domain reference material:

6. `23_PRODUCTION_READINESS_REMEDIATION_PLAN.md` - current target architecture and CP11-CP18 implementation sequence.
7. `24_PRODUCTION_SECURITY_THREAT_MODEL_AND_CONTROLS.md` - security architecture and control baseline.

Plan 20 is retained as the historical CP0-CP10 record. CP11’s historical single-session runbook is retained for traceability. New execution uses the worktree program and CP12-CP18 packets under `docs/orchestration/`.

This is better than one massive implementation plan because ClinicOS has three different execution surfaces:

- A platform surface: infra, auth, tenancy, database, workflows, security, observability.
- A clinic product surface: assistant, doctor, receptionist, owner workflows.
- A boundary surface: external integrations, mobile capture, AI, interoperability.

The focused plans remain domain references; plans 23/24 provide the current remediation and security control plane without copying those requirements.

## 2. Active Canonical Docs

These files are active and should be treated as current context.

| File | Role | Use When |
|---|---|---|
| `../AGENTS.md` | Root agent instructions | Always read first before implementation. |
| `README.md` | Product pack overview | Starting orientation and reading order. |
| `01_PRD.md` | Product requirements | Understanding what ClinicOS is and why it exists. |
| `02_SYSTEM_ARCHITECTURE.md` | Technical architecture | Backend/frontend/data/workflow architecture. |
| `03_DOMAIN_MODEL_AND_FHIR_MAPPING.md` | Domain model | Designing database, APIs, FHIR projections, and clinical objects. |
| `04_INTEGRATIONS_SPEC.md` | Integration requirements | WhatsApp, payments, telephony, Practo, Google, ABDM, imaging, accounting. |
| `05_AI_AGENTS_AND_CLINICAL_SAFETY.md` | AI safety model | AI/scribe, action proposals, review, provenance, clinical guardrails. |
| `06_SECURITY_PRIVACY_COMPLIANCE_INDIA.md` | Security and compliance | Tenant isolation, DPDP posture, audit, consent, PHI controls. |
| `08_USER_STORIES_AND_ACCEPTANCE_CRITERIA.md` | Acceptance criteria | Product QA and user-facing behavior checks. |
| `09_API_CONTRACTS_AND_EVENTS.md` | API and event taxonomy | REST/OpenAPI/event contracts and webhook processing. |
| `13_CRITICAL_ARCHITECTURE_REVIEW.md` | Review record | Why the production-grade posture and corrections exist. |
| `14_STACK_AND_VENDOR_DECISIONS.md` | Current stack/vendor defaults | Temporal, Keycloak, AWS India, Razorpay, WhatsApp, ABDM, mobile capture. |
| `15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md` | Field evidence | Real dental clinic workflow and pilot archetype. |
| `16_DOCUMENTATION_STRUCTURE_AND_IMPLEMENTATION_INDEX.md` | Current execution index | Implementation sequencing and doc hygiene. |
| `20_ORCHESTRATION_CHECKPOINT_PLAN.md` | Historical CP0-CP10 plan | Prior worktree sequence and handoff record; not the default for CP11 onward. |
| `17_IMPLEMENTATION_PLAN_PLATFORM_INFRA.md` | Platform execution plan | Platform/infrastructure workstream. |
| `18_IMPLEMENTATION_PLAN_CLINIC_OS_DENTAL.md` | Clinic product execution plan | Core clinic/dental workstream. |
| `19_IMPLEMENTATION_PLAN_INTEGRATIONS_AI_MOBILE.md` | Boundary execution plan | Integrations/mobile/AI/interoperability workstream. |
| `21_EXECUTION_INPUTS_AND_CREDENTIALS.md` | Inputs checklist | Credentials, sandbox accounts, clinic details, and live verification requirements. |
| `22_CREDENTIAL_SETUP_GUIDE.md` | Credential activation guide | Official registration and configuration steps; presence alone is not activation evidence. |
| `23_PRODUCTION_READINESS_REMEDIATION_PLAN.md` | Current post-CP10 execution plan | Target production architecture, CP11-CP18 sequence, and definition of done. |
| `24_PRODUCTION_SECURITY_THREAT_MODEL_AND_CONTROLS.md` | Current security baseline | Threat model, invariants, control matrix, and hard security gate. |
| `../docs/security/PRODUCTION_SECURITY_AND_READINESS_REMEDIATION_REGISTER.md` | Independent audit register | Findings, severity, remediation, dependencies, and closure evidence. |
| `../docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md` | Evidence standard | E0-E7 tiers, claim rules, freshness, and go/no-go criteria. |
| `../docs/implementation/POST_CP10_SINGLE_SESSION_EXECUTION_PROGRAM.md` | Historical CP11 runbook | Explains the completed single-session CP11 execution only. |
| `../docs/implementation/CHECKPOINT_11_VERIFICATION_AND_DURABLE_DATA_FOUNDATION.md` | Completed checkpoint packet | CP11 requirements and E3 closeout context. |
| `../docs/orchestration/POST_CP11_WORKTREE_ORCHESTRATION_PROGRAM.md` | Current execution runbook | Master heartbeat, model policy, conflict-safe workers, merge and verification loop. |
| `../docs/orchestration/CP12_TO_CP18_AUTONOMOUS_KICKOFF.md` | Master launcher | Copy/paste prompt for the autonomous `gpt-5.6-sol` `xhigh` orchestrator. |
| `../docs/orchestration/CHECKPOINT_12_MODULAR_API_GENERATED_CONTRACTS.md` | Active checkpoint packet | CP12 four-lane modular API/contract execution. |
| `../docs/orchestration/CHECKPOINT_13_DURABLE_CLINIC_DAY.md` | Future packet | CP13 four vertical durable workflow lanes. |
| `../docs/orchestration/CHECKPOINT_14_CLOUD_SECURITY_OPERATIONS.md` | Future packet | CP14 cloud/security/media/telemetry/recovery lanes. |
| `../docs/orchestration/CHECKPOINT_15_OFFICIAL_PROVIDER_INTEGRATIONS.md` | Future packet | CP15 Meta/Razorpay/telephony/provider-ops lanes. |
| `../docs/orchestration/CHECKPOINT_16_NATIVE_AI_INTEROPERABILITY.md` | Future packet | CP16 mobile/AI/FHIR-ABDM/safety-QA lanes. |
| `../docs/orchestration/CHECKPOINT_17_CONTROLLED_PILOT_LAUNCH.md` | Future packet | CP17 E5/E6 release assurance lanes. |
| `../docs/orchestration/CHECKPOINT_18_MULTI_CLINIC_GA.md` | Future packet | CP18 E7 multi-clinic production lanes. |
| `00_SOURCE_REGISTER.md` | Source register | Evidence, references, and research traceability. |
| `CHANGELOG.md` | Change history | What changed across planning passes. |
| `COMBINED_BUILD_PACK.md` | Pointer only | Explains why the old combined pack is archived. |

## 3. Archived Docs

The following files were moved to `archive/` because they are superseded or duplicative. They are retained for traceability only.

| Archived file | Reason |
|---|---|
| `archive/07_IMPLEMENTATION_ROADMAP_2026-07-06_ARCHIVED.md` | Superseded by the focused implementation plan set. |
| `archive/11_INITIAL_BACKLOG_2026-07-06_ARCHIVED.md` | Superseded by the focused implementation plan set. |
| `archive/12_V0_2_ARCHITECTURE_DECISION_RECORD_ARCHIVED.md` | Decisions are now integrated into active PRD, architecture, and stack/vendor docs. |
| `archive/COMBINED_BUILD_PACK_2026-07-06_ARCHIVED.md` | Duplicated the active source files and could make agents read stale bundled content. |

## 4. Cleanup Findings

The review found four duplication patterns:

1. **Roadmap and backlog duplication.** `07_IMPLEMENTATION_ROADMAP.md`, `10_AGENT_HANDOFF_PROMPT.md`, and `11_INITIAL_BACKLOG.md` all described similar implementation order. The new plan set replaces the roadmap/backlog and turns the handoff prompt into a lean launcher.
2. **Historical ADR duplication.** `12_V0_2_ARCHITECTURE_DECISION_RECORD.md` was valuable when the Practo/Plena strategy changed, but its decisions are now integrated into the PRD, architecture, stack decisions, and field note.
3. **Combined pack duplication.** The combined pack duplicated every active doc and could become stale. It is archived and replaced by a pointer.
4. **Mobile capture inconsistency.** The architecture doc still implied PWA-first capture. This was corrected to Expo/React Native from the start, matching `14_STACK_AND_VENDOR_DECISIONS.md`.

No high-value product evidence was deleted.

## 5. Agent Reading Paths

### For Any Implementation Agent

Read in this order:

1. `../AGENTS.md`
2. `README.md`
3. `23_PRODUCTION_READINESS_REMEDIATION_PLAN.md`
4. `24_PRODUCTION_SECURITY_THREAT_MODEL_AND_CONTROLS.md`
5. `../docs/security/PRODUCTION_SECURITY_AND_READINESS_REMEDIATION_REGISTER.md`
6. `../docs/qa/PRODUCTION_READINESS_EVIDENCE_STANDARD.md`
7. `../docs/orchestration/POST_CP11_WORKTREE_ORCHESTRATION_PROGRAM.md`
8. The active checkpoint packet, beginning with CP12
9. The relevant focused implementation plan: `17`, `18`, or `19`
10. The reference docs cited by that plan

### Platform Agent

Read:

- `17_IMPLEMENTATION_PLAN_PLATFORM_INFRA.md`
- `02_SYSTEM_ARCHITECTURE.md`
- `03_DOMAIN_MODEL_AND_FHIR_MAPPING.md`
- `06_SECURITY_PRIVACY_COMPLIANCE_INDIA.md`
- `09_API_CONTRACTS_AND_EVENTS.md`
- `14_STACK_AND_VENDOR_DECISIONS.md`

### Clinic Product Agent

Read:

- `18_IMPLEMENTATION_PLAN_CLINIC_OS_DENTAL.md`
- `01_PRD.md`
- `15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md`
- `08_USER_STORIES_AND_ACCEPTANCE_CRITERIA.md`
- `03_DOMAIN_MODEL_AND_FHIR_MAPPING.md`
- `09_API_CONTRACTS_AND_EVENTS.md`

### Integrations, AI, and Mobile Agent

Read:

- `19_IMPLEMENTATION_PLAN_INTEGRATIONS_AI_MOBILE.md`
- `04_INTEGRATIONS_SPEC.md`
- `05_AI_AGENTS_AND_CLINICAL_SAFETY.md`
- `06_SECURITY_PRIVACY_COMPLIANCE_INDIA.md`
- `09_API_CONTRACTS_AND_EVENTS.md`
- `14_STACK_AND_VENDOR_DECISIONS.md`
- `15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md`

## 6. Global Product Target

ClinicOS is a production-grade, dental-first clinic operating system for India. It begins as an overlay across existing channels and tools, but it is built like the future source of truth.

The core loop is:

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

## 7. Global Engineering Defaults

Use these defaults unless a later explicit decision overrides them:

| Area | Default |
|---|---|
| Language | TypeScript for app/backend/workers; Python only for isolated AI/media processing if strongly justified. |
| Web | Next.js + React + TypeScript. |
| Mobile capture | Expo/React Native from the start. |
| API | NestJS + REST + OpenAPI. |
| Database | PostgreSQL. |
| ORM/query layer | Prisma or Drizzle, with explicit SQL where required for RLS/search/reporting. |
| Workflow runtime | Temporal for durable workflows. |
| Short jobs/cache | Redis, with BullMQ only for short non-durable jobs if needed. |
| Auth | Self-hosted Keycloak in India-region infrastructure. |
| Infrastructure | AWS India, primary Mumbai, DR/warm standby Hyderabad. |
| Containers | Managed containers via Terraform; ECS/Fargate acceptable first. |
| Object storage | S3 with KMS, signed URLs, malware scanning, audit. |
| Messaging | Direct Meta WhatsApp Cloud API as default, BSP adapters as fallbacks. |
| Payments | Razorpay dynamic invoice-specific UPI QR and Payment Links first. |
| AI | Backend-mediated AI gateway, structured outputs, human sign-off. |
| Interoperability | Internal operational model plus FHIR R4 projections; direct ABDM/NHA path later. |

## 8. Non-Negotiables

- Build production-grade vertical slices, not throwaway MVPs.
- A feature can be deferred, but anything built must be complete for its intended scope.
- No mock, stub, placeholder, fake, or partial product behavior.
- Test doubles and simulators are allowed only for tests and local development, behind the same typed provider contracts as production integrations.
- No autonomous clinical finalization. AI drafts; humans approve and sign.
- No unauthorized scraping or brittle browser automation as an integration dependency.
- Tenant isolation, audit logging, consent, PHI protection, idempotency, and provider provenance exist from the first production slice.
- Source attribution follows the patient journey from lead to revenue.
- Existing tools can coexist, but ClinicOS owns new operational truth where it is introduced.

## 9. Implementation Workstream Boundaries

### Workstream A: Platform and Infrastructure

Owns:

- Monorepo and app boundaries.
- Local/dev/staging/pilot-prod/prod environments.
- Terraform and AWS baseline.
- PostgreSQL, RLS, migrations, seed data.
- Keycloak integration and authorization primitives.
- Temporal, outbox, workers, retries, dead letters.
- Audit, observability, logging, backups, security testing.
- API conventions and shared SDK generation.

Does not own:

- Detailed clinic UI workflows.
- External provider business semantics beyond interfaces.
- AI prompt behavior beyond shared gateway/contracts.

### Workstream B: Clinic OS and Dental Product

Owns:

- Assistant, doctor, receptionist, owner web workflows.
- Patient registry, appointments, queue, intake, consent.
- Encounters, notes, prescriptions, dental charting.
- Treatment plans, estimates, billing surface.
- Recalls, tasks, SOPs, lab, inventory, event diary.
- Owner dashboards and acceptance criteria.

Does not own:

- Raw provider webhook verification details.
- Mobile native plumbing.
- AI model routing and external provider contracts.

### Workstream C: Integrations, AI, Mobile, and Interoperability

Owns:

- WhatsApp/direct/BSP adapters.
- Razorpay dynamic QR, Payment Links, webhooks, reconciliation adapter.
- Telephony/missed call adapters.
- Google/Practo/source capture/migration adapters.
- Expo mobile capture app.
- AI/scribe/STT/extraction/action proposal implementation.
- FHIR, ABDM, imaging/DICOM coexistence.

Does not own:

- Core tenancy/security primitives.
- Final clinic UX acceptance without Workstream B alignment.

## 10. Recommended Execution Sequence

Do not run these as fully independent tracks from day one. Platform foundations must land first, then vertical slices can proceed in parallel.

### Slice 0: Production Foundation

Owner: Workstream A  
Output: deployable skeleton with auth, tenancy, database, CI, observability, and local dev.

Must include:

- Monorepo.
- Web/API/worker/mobile app skeletons.
- PostgreSQL migrations.
- Keycloak local/dev integration.
- Tenant/clinic/user/role schema.
- Audit event table.
- Outbox event table.
- Temporal local/dev wiring.
- OpenAPI generation.
- CI checks.
- Seed tenant and clinic.

### Slice 1: Lead to Appointment

Owners: Workstreams A, B, C  
Output: assistant can capture a WhatsApp/phone/Practo/Google/manual lead, match/create patient, and book appointment with source attribution.

Must include:

- External systems/accounts.
- Lead inbox.
- Patient match/create.
- Appointment and queue.
- Morning dashboard.
- Source attribution.
- Provider capability model.
- Audit and events.

### Slice 2: Arrival to Encounter

Owners: Workstreams A, B  
Output: clinic can route new/returning patient, capture intake/consent, start encounter, and prepare doctor context.

Must include:

- Digital intake and assistant-entered history-card flow.
- Consent records.
- Returning patient prep summary.
- Encounter lifecycle.
- Patient timeline projection.
- Permissioned clinical access.

### Slice 3: Dental Chart to Checkout

Owners: Workstreams A, B, C  
Output: doctor/assistant can chart findings, attach media, create treatment plan, invoice, collect/reconcile payment, and send/print instructions.

Must include:

- Odontogram and dental findings.
- Media upload/capture metadata.
- Treatment plan and estimate.
- Procedure performed.
- Invoice and dynamic payment request.
- Prescription/instruction templates.
- Doctor sign-off.
- Receipt and timeline entry.

### Slice 4: Continuity and Operations

Owners: Workstreams A, B, C  
Output: clinic can run recall, post-op, lab, inventory, SOP, event diary, and owner analytics.

Must include:

- Six-month recall rules.
- Post-op instruction workflow.
- Lab case card and reconciliation.
- Monthly inventory checklist.
- Recurring protocol tasks.
- Event/CAPA-style learning log.
- Owner dashboard with source attribution.

### Slice 5: Production Integrations Hardening

Owners: Workstreams A, C  
Output: provider integrations are production-ready for pilot clinics.

Must include:

- WhatsApp Cloud API or BSP adapter.
- Razorpay QR/Payment Link adapter.
- Verified webhooks.
- Idempotency.
- Retry/dead-letter/admin review.
- Provider health dashboard.
- Integration credential encryption.

### Slice 6: AI and Mobile Capture

Owners: Workstreams A, B, C  
Output: mobile/tablet capture and AI drafts operate with consent, provenance, retention, review, and evaluation.

Must include:

- Expo capture app.
- Secure upload queue.
- Audio consent and capture session.
- STT/transcript storage.
- Structured clinical note draft.
- Dental chart patch draft.
- Action proposal review.
- AI evaluation harness.
- Raw audio retention/delete policy.

### Slice 7: Interoperability and Expansion

Owners: all workstreams  
Output: FHIR/ABDM/imaging/accounting readiness after the core loop is trusted.

Must include:

- FHIR R4 projections.
- Patient/encounter/document export.
- ABDM sandbox path.
- DICOM/folder import improvements.
- Accounting export/reconciliation.
- Specialty-pack extension boundaries.

## 11. Definition Of Ready For Any Slice

Before coding a slice:

- Product workflow is described.
- Domain entities and permissions are known.
- API endpoints/events are sketched.
- Provider dependencies are identified.
- Audit events and PHI risk are identified.
- Acceptance criteria exist.
- Test strategy is clear.
- Rollback/data migration plan exists for persistent changes.

## 12. Definition Of Done For Any Slice

A slice is done only when:

- It works end to end for the intended clinic role.
- It has tenant/clinic authorization.
- It records audit events for sensitive actions.
- It emits domain events/outbox entries where side effects exist.
- It has unit and integration tests for critical paths.
- It has E2E coverage for the user workflow where practical.
- It handles empty/error/loading states in UI.
- It handles idempotency and retry semantics for side effects.
- It has basic observability: logs, traces, metrics, and alerts where relevant.
- It has migration/seed data reviewed.
- It has documentation updated.

## 13. What Not To Build Yet

Do not build these until the production clinic loop is stable:

- Marketplace or demand aggregation.
- Autonomous diagnosis.
- Autonomous prescription finalization.
- Full hospital HIS/IPD/insurance workflows.
- Multi-specialty product breadth before dental is deep.
- Deep Practo write-back unless official/authorized integration exists.
- Eka-dependent ABDM production flow.
- Full custom FHIR server unless exchange use cases require server semantics.

## 14. Documentation Maintenance Rule

When implementation changes project direction:

1. Update the focused implementation plan.
2. Update the canonical reference doc if the underlying decision changed.
3. Update `CHANGELOG.md`.
4. Do not update archived files.
5. Regenerate a combined pack only if a human explicitly needs one.
