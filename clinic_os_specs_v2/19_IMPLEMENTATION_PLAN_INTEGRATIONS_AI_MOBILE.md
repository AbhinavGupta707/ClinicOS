# 19 - Implementation Plan: Integrations, AI, Mobile, and Interoperability

**Date:** 2026-07-06  
**Status:** Execution plan  
**Primary owner:** Integrations/mobile/AI agent  
**Companion docs:** `04_INTEGRATIONS_SPEC.md`, `05_AI_AGENTS_AND_CLINICAL_SAFETY.md`, `06_SECURITY_PRIVACY_COMPLIANCE_INDIA.md`, `09_API_CONTRACTS_AND_EVENTS.md`, `14_STACK_AND_VENDOR_DECISIONS.md`, `15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md`

## 1. Mission

Build ClinicOS boundary systems in a production-grade way:

- WhatsApp and messaging.
- Razorpay/UPI payments.
- Telephony and missed calls.
- Google/Practo/source attribution and migration.
- Expo mobile capture app.
- AI scribe and action proposal system.
- Imaging/X-ray coexistence.
- FHIR/ABDM readiness.
- Accounting/export foundations.

This plan exists because external boundaries are where fragile software usually enters. ClinicOS must not depend on scraping, manual hacks, fake providers, or unverified callbacks.

## 2. Required Reading

Before implementation, read:

1. `../AGENTS.md`
2. `16_DOCUMENTATION_STRUCTURE_AND_IMPLEMENTATION_INDEX.md`
3. `20_ORCHESTRATION_CHECKPOINT_PLAN.md`
4. `19_IMPLEMENTATION_PLAN_INTEGRATIONS_AI_MOBILE.md`
5. `04_INTEGRATIONS_SPEC.md`
6. `05_AI_AGENTS_AND_CLINICAL_SAFETY.md`
7. `06_SECURITY_PRIVACY_COMPLIANCE_INDIA.md`
8. `09_API_CONTRACTS_AND_EVENTS.md`
9. `14_STACK_AND_VENDOR_DECISIONS.md`
10. `15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md`

## 3. Boundary Principles

- Use official APIs, authorized exports/imports, signed webhooks, or explicit clinic-approved manual workflows.
- Do not scrape WhatsApp Web, Practo dashboards, payment dashboards, or X-ray software UIs as a product dependency.
- Store raw webhook payloads before normalization, but trust them only after verification.
- Every provider event needs idempotency.
- Every provider has a capability profile.
- Every provider failure produces observable state and, where needed, an assistant/admin task.
- Production startup must fail if a simulator provider is configured for real tenant operations.
- AI cannot directly mutate clinical records, send clinical messages, sign prescriptions, or mark bills paid.

## 4. Shared Integration Architecture

Implement all providers through a common integration gateway:

```text
provider webhook/API/export
  -> raw provider event
  -> signature/auth verification
  -> idempotency check
  -> normalization
  -> domain command
  -> outbox event
  -> workflow/action/task
```

Core tables:

- `external_systems`
- `external_accounts`
- `external_provider_capabilities`
- `external_entity_links`
- `raw_webhook_events`
- `normalized_integration_events`
- `integration_credentials`
- `integration_health_checks`
- `integration_attempts`
- `integration_dead_letters`

Provider account fields:

- `tenant_id`
- `clinic_id`
- `provider`
- `account_type`
- `status`
- `capabilities`
- `credential_ref`
- `last_health_check_at`
- `last_success_at`
- `last_failure_at`
- `configuration`

Acceptance:

- Adding a provider does not change core business logic.
- Provider-specific payloads do not leak into clinic domains.
- Health and capability status are visible.
- Failed provider events can be replayed or dead-lettered.

## 5. WhatsApp and Messaging

### 5.1 Decision

Default long-term route: direct Meta WhatsApp Cloud API.  
Fallback/onboarding route: BSP adapters such as Gupshup, WATI, or Interakt where a clinic already uses them or where onboarding support demands it.

### 5.2 Product Scope

Messaging must support:

- Inbound appointment requests.
- Patient replies.
- Appointment confirmations.
- Six-month recall outreach.
- Post-op and product instructions.
- Payment links.
- Document/photo receipt.
- Human takeover.
- Delivery/read/failure status where provider supports it.
- Opt-in/opt-out enforcement.
- Template lifecycle tracking.

### 5.3 Domain Objects

- `conversation_threads`
- `messages`
- `message_templates`
- `message_template_versions`
- `message_delivery_attempts`
- `message_status_events`
- `communication_preferences`
- `opt_in_records`
- `opt_out_records`

### 5.4 Provider Interface

Define a typed provider contract:

```text
sendTemplateMessage(input)
sendFreeformMessage(input)
sendMediaMessage(input)
parseInboundWebhook(raw)
parseStatusWebhook(raw)
verifyWebhook(raw)
getCapabilities(account)
healthCheck(account)
```

### 5.5 Required States

Message states:

- `draft`
- `queued`
- `sent_to_provider`
- `delivered`
- `read`
- `failed`
- `cancelled`
- `requires_human_review`

Template states:

- `draft`
- `submitted`
- `approved`
- `rejected`
- `paused`
- `disabled`
- `superseded`

### 5.6 Acceptance

- Assistant can view inbound WhatsApp-style messages in ClinicOS.
- Patient matching suggests existing patients by phone.
- Assistant can send approved confirmation/recall/instruction templates.
- Provider delivery failures create visible tasks.
- Opt-out prevents non-essential messaging.
- Raw payloads are stored and verified.
- Simulator is available for tests only and cannot be used in production tenant config.

## 6. Payments: Razorpay QR, Payment Links, and Reconciliation

### 6.1 Decision

Use Razorpay first:

- In-clinic: dynamic invoice-specific UPI QR.
- Remote: Payment Links over WhatsApp/SMS/email.

Static clinic QR is manual fallback only and must create reconciliation work.

### 6.2 Product Flows

In-clinic QR:

```text
invoice created
  -> create Razorpay dynamic QR for invoice
  -> display/print QR
  -> patient scans with UPI app
  -> Razorpay webhook received
  -> verify signature and provider state
  -> mark invoice paid/partially paid
  -> generate receipt
```

Remote payment:

```text
invoice/payment request
  -> create Razorpay Payment Link
  -> send via WhatsApp/SMS/email
  -> webhook/API verification
  -> update payment state
  -> receipt and timeline
```

### 6.3 Domain Objects

- `payment_providers`
- `payment_requests`
- `payment_qr_codes`
- `payment_links`
- `payment_transactions`
- `payment_reconciliation_items`
- `refunds`
- `receipts`

### 6.4 Payment States

Use the states from `14_STACK_AND_VENDOR_DECISIONS.md` and `18_IMPLEMENTATION_PLAN_CLINIC_OS_DENTAL.md`:

- `draft`
- `payment_requested`
- `qr_created`
- `link_created`
- `sent`
- `partially_paid`
- `paid`
- `expired`
- `cancelled`
- `failed`
- `refunded`
- `manually_recorded`
- `reconciliation_required`

### 6.5 Provider Interface

```text
createInvoiceQr(input)
closeQr(input)
createPaymentLink(input)
cancelPaymentLink(input)
fetchPayment(input)
verifyWebhook(raw)
parseWebhook(raw)
healthCheck(account)
```

### 6.6 Acceptance

- Payment cannot be marked provider-paid from unverified webhook.
- Idempotent webhook replay does not duplicate payment.
- Partial payments are represented.
- Manual payment requires actor/reason/audit.
- Refund state can be represented even if refund execution is deferred.
- Reconciliation-required state creates staff task.
- Payment timeline is visible on invoice and patient profile.

## 7. Telephony and Missed Calls

### 7.1 Scope

Telephony is initially about lead capture and missed-call recovery, not a full call-center product.

Support:

- Missed call event.
- Incoming call metadata.
- Call recording link where legally/contractually allowed.
- Callback task.
- Source attribution.
- Patient matching by phone.

### 7.2 Providers

Likely adapters:

- Exotel.
- Knowlarity.
- Twilio-like provider if needed.
- Manual missed-call entry if provider not connected.

### 7.3 Acceptance

- Missed call creates lead/task.
- Assistant can mark callback outcome.
- Converted appointment retains phone source attribution.
- Recording links are permissioned and audited if used.
- Provider capability gates whether live integration features appear.

## 8. Google, Practo, and Acquisition Source Attribution

### 8.1 Strategy

ClinicOS should coexist with external demand channels:

- Practo/Profile/Prime.
- Google Business Profile.
- Instagram/website.
- WhatsApp.
- Phone.
- Referral.
- Walk-in.
- Recall campaign.

ClinicOS should not depend on Practo API availability.

### 8.2 Source Attribution Model

Every lead/appointment should capture:

- `source_type`
- `source_detail`
- `external_system_id`
- `external_reference`
- `campaign`
- `utm_source`
- `utm_medium`
- `utm_campaign`
- `captured_by`
- `confidence`

Attribution must flow:

```text
lead -> appointment -> encounter -> treatment plan -> invoice -> payment -> analytics
```

### 8.3 Practo/Ray Coexistence

Support, in priority order:

1. Manual source-tagged entry.
2. CSV/XLS imports where clinic can export.
3. Email/calendar/notification parsing only if terms and clinic permissions allow.
4. Official API/partner integration if available.

Do not build unauthorized dashboard scraping.

### 8.4 Acceptance

- A Practo-originated booking can be recorded manually with source.
- Imported records are marked imported/unverified until reviewed.
- Revenue by source works from real invoice/payment data.
- External reference can be stored without making external system the source of truth for new ClinicOS operations.

## 9. Migration and Import

### 9.1 Scope

Migration must let clinics start without risky rip-and-replace.

Support:

- Patient import.
- Appointment import.
- Invoice/payment history import where available.
- Clinical notes/media inventory import metadata where available.
- Read-only imported records.
- Duplicate detection and review.

### 9.2 Domain Objects

- `migration_batches`
- `migration_rows`
- `migration_conflicts`
- `migration_commits`
- `imported_record_links`

### 9.3 Migration States

- `uploaded`
- `parsed`
- `validated`
- `needs_review`
- `ready_to_commit`
- `committed`
- `partially_committed`
- `failed`
- `rolled_back`

### 9.4 Acceptance

- CSV import validates required fields.
- Bad rows do not block good rows from review.
- Duplicate patient candidates are shown.
- Imported historical records are clearly marked.
- No import silently overwrites verified ClinicOS records.
- Migration actions are audited.

## 10. Expo Mobile Capture App

### 10.1 Decision

Build Expo/React Native from the start. Web/PWA can exist as fallback, but mobile capture is primary for chairside capture.

### 10.2 Product Scope

Mobile app should support:

- Login/session.
- Clinic selection.
- Today's patients/queue.
- Patient search.
- Intraoral photo capture.
- X-ray/document photo capture.
- Audio capture for consented scribe sessions.
- Upload queue.
- Secure local cache.
- Consent capture/check.
- Task quick actions.
- Companion mode: assistant captures media/audio while doctor uses web/tablet.

### 10.3 Mobile Architecture

Use:

- Expo Router.
- SecureStore or equivalent for sensitive local tokens.
- Local encrypted cache where feasible.
- FileSystem/media APIs for upload queue.
- Background/resumable upload where supported.
- Push notifications later for tasks/recalls if useful.

Do not:

- Store raw audio longer than needed.
- Let mobile own clinical AI state.
- Let mobile bypass backend authorization.
- Upload media without patient/clinic context.

### 10.4 Capture Flow

```text
select patient/encounter
  -> verify permission and consent where needed
  -> capture photo/audio/document
  -> store local pending item
  -> request signed upload URL
  -> upload encrypted/private object
  -> complete upload
  -> backend creates media metadata
  -> timeline/event/audit updated
```

### 10.5 Acceptance

- Assistant can capture photo and attach to patient.
- Upload resumes or clearly fails with retry.
- Offline pending queue is visible.
- Patient mismatch risk is reduced through visible patient banner.
- Media access and upload completion are audited.
- Audio capture is disabled unless consent exists.

## 11. AI Scribe, Extraction, and Agent Actions

### 11.1 AI Safety Model

AI produces drafts and proposals only.

Allowed:

- Transcript.
- Clinical note draft.
- Dental chart patch draft.
- Treatment plan suggestion.
- Instruction draft from approved templates.
- Recall/payment/lab/inventory task proposal.
- Scheduling reply draft.

Not allowed:

- Autonomous diagnosis finalization.
- Autonomous prescription signing.
- Autonomous clinical note signing.
- Autonomous paid state.
- Autonomous sending of clinical instructions unless policy and approval allow it.

### 11.2 AI Architecture

```text
consent
  -> capture session
  -> audio chunks/upload
  -> STT
  -> transcript segments
  -> structured extraction
  -> schema validation
  -> safety checks
  -> draft/proposal
  -> human review
  -> approved domain mutation
```

### 11.3 Domain Objects

- `ai_sessions`
- `audio_capture_sessions`
- `transcript_segments`
- `ai_jobs`
- `ai_outputs`
- `ai_output_reviews`
- `ai_evaluation_cases`
- `ai_model_versions`
- `action_proposals`
- `approval_decisions`

### 11.4 Required Schemas

Version schemas for:

- `ClinicalNoteDraft`
- `DentalChartPatch`
- `TreatmentPlanDraft`
- `PrescriptionDraft`
- `InstructionDraft`
- `TaskProposal`
- `MessageReplyDraft`

Each output must include:

- Model/provider/version.
- Prompt/schema version.
- Source references.
- Confidence/uncertainty where applicable.
- Unsupported claim warnings.
- Review status.

### 11.5 Review Rules

Doctor approval required:

- Clinical note.
- Diagnosis.
- Dental chart patch.
- Prescription.
- Treatment plan.

Assistant approval may be sufficient:

- Appointment reply draft.
- Recall message draft from approved template.
- Payment reminder draft.
- Lab follow-up task.
- Inventory reorder suggestion.

Tenant-configured automation may later allow:

- Low-risk operational messages from approved templates.
- Internal task creation.

### 11.6 Evaluation Harness

Build before production AI rollout:

- Golden transcripts.
- Expected structured outputs.
- Hallucination/unsupported assertion checks.
- Missing critical field checks.
- Dental chart precision/recall checks.
- Latency and cost tracking.
- Human correction capture.

Acceptance:

- AI cannot run without consent where required.
- AI outputs are never silently applied to clinical records.
- Review UI shows source transcript/media references.
- Rejected AI output is retained for evaluation but not applied.
- Raw audio retention/deletion policy is enforced.

## 12. Imaging and X-Ray Coexistence

### 12.1 Strategy

Most dental clinics will not expose DICOMweb/PACS initially. Build coexistence first:

- Manual upload.
- Mobile photo capture.
- File/folder import where allowed.
- Metadata tagging.
- External software reference/link.
- DICOM metadata parsing when files are available.

Add DICOMweb/PACS adapters only when a clinic exposes those capabilities.

### 12.2 Domain Objects

- `media_assets`
- `imaging_studies`
- `imaging_series`
- `imaging_instances`
- `external_media_links`
- `media_annotations`

### 12.3 Acceptance

- X-ray/media can be attached to patient/encounter/tooth.
- Existing X-ray software is not forcibly replaced.
- Imported media has provenance.
- DICOM files, if uploaded, preserve useful metadata.
- Media access is permissioned and audited.

## 13. FHIR and ABDM

### 13.1 Decision

Use internal operational tables for ClinicOS. Generate validated FHIR R4 projections for interoperability.

Do not depend on Eka as a production ABDM connector. Eka may remain a reference for developer experience and Indian healthcare workflow packaging.

### 13.2 FHIR Projection Scope

Map:

- Patient.
- Practitioner.
- Organization.
- Location.
- Appointment.
- Encounter.
- Observation.
- Condition.
- Procedure.
- MedicationRequest.
- CarePlan.
- ServiceRequest.
- DocumentReference.
- Media.
- ImagingStudy.
- DiagnosticReport.
- Consent.
- AuditEvent.
- Invoice/ChargeItem/PaymentNotice where useful.

### 13.3 ABDM Path

Sequence:

1. Internal FHIR-ready model.
2. ABHA/HPR/HFR fields stored only with consent and verification.
3. Care-context model.
4. Consent/data exchange logs.
5. ABDM sandbox path.
6. HIP capability first.
7. HIU capability later.

### 13.4 Acceptance

- FHIR bundle generation works for a patient encounter.
- Generated FHIR validates against chosen profiles/fixtures where applicable.
- ABHA fields are not mandatory for clinic workflow.
- ABDM integration is feature-gated.
- Consent logs are auditable.

## 14. Accounting and Exports

### 14.1 Scope

Accounting systems can remain external. ClinicOS owns clinic invoice/payment operational state and provides:

- CSV/XLS export.
- GST/tax fields where required.
- Settlement/reconciliation report.
- Later Zoho/Tally connector if justified.

### 14.2 Acceptance

- Invoice/payment exports are accurate.
- Accountant role can access financial exports without default clinical record access.
- Export actions are audited.

## 15. Provider Capability Matrix

Every provider account must declare capabilities such as:

- `inbound_messages`
- `outbound_templates`
- `delivery_status`
- `read_status`
- `media_messages`
- `payment_qr`
- `payment_links`
- `partial_payments`
- `refunds`
- `missed_calls`
- `call_recordings`
- `csv_export`
- `fhir_exchange`
- `dicomweb`

UI should hide or disable actions not supported by the active provider configuration.

Acceptance:

- Missing capability is diagnosed at provider/account level first.
- The system does not show a feature as available when provider setup cannot support it.
- Capability changes are audited.

## 16. Cross-Workstream Dependencies

Depends on Workstream A for:

- Auth/tenant/clinic guards.
- Credential encryption.
- Object storage.
- Outbox and Temporal.
- Audit helper.
- Observability.
- Provider health dashboards.

Depends on Workstream B for:

- Patient/appointment/invoice/domain APIs.
- Review UI placement.
- Patient timeline integration.
- Assistant/doctor workflow acceptance.
- Instruction, recall, lab, and inventory templates.

Provides to Workstream B:

- Messaging send/receive capabilities.
- Payment request/reconciliation capabilities.
- Mobile media/audio capture.
- AI drafts/action proposals.
- Source attribution import/adapter data.

## 17. Milestones

### C0.1 Integration Gateway Foundation

Deliver:

- External system/account/capability tables.
- Credential reference model.
- Raw webhook storage.
- Provider contract interfaces.
- Health check framework.
- Dead-letter framework.

Done when:

- A provider simulator can send a contract-tested event locally.
- Production config cannot select simulator provider.

### C0.2 Messaging Foundation

Deliver:

- Conversation/message/template models.
- Inbound webhook normalization.
- Outbound template send contract.
- Assistant inbox integration.

Done when:

- Assistant can receive/send provider-simulated messages through ClinicOS.

### C0.3 Payment Foundation

Deliver:

- Payment provider interface.
- Razorpay adapter skeleton.
- Dynamic QR/payment link domain.
- Webhook verification/idempotency.
- Payment reconciliation task creation.

Done when:

- Verified payment event updates invoice exactly once.

### C0.4 Mobile Capture Foundation

Deliver:

- Expo app skeleton.
- Auth/session.
- Patient/queue selection.
- Photo capture.
- Upload queue.
- Complete-upload integration.

Done when:

- Mobile photo appears in patient timeline after upload.

### C0.5 AI Foundation

Deliver:

- AI gateway/provider interface.
- AI session/job/output tables.
- Clinical note draft schema.
- Dental chart patch schema.
- Review API.
- Evaluation harness skeleton.

Done when:

- Deterministic test fixture produces a draft and review flow without applying clinical changes automatically.

### C0.6 Live Provider Hardening

Deliver:

- WhatsApp direct or BSP production adapter.
- Razorpay live/sandbox adapter.
- Provider health dashboard.
- Retry/dead-letter admin workflow.
- Provider runbooks.

Done when:

- Staging tests pass against sandbox providers.
- Pilot-prod credentials are separated and secured.

### C0.7 Interoperability Foundation

Deliver:

- FHIR projection package.
- Patient/encounter/document bundle export.
- ABDM data model fields with consent.
- Imaging metadata import path.

Done when:

- FHIR export validates for a sample encounter.

## 18. Acceptance Checklist

- [ ] All provider integrations use typed contracts.
- [ ] Raw webhooks are stored before normalization.
- [ ] Verification happens before trust.
- [ ] Idempotency prevents duplicates.
- [ ] Provider health and capabilities are visible.
- [ ] Simulator providers are blocked in production config.
- [ ] WhatsApp workflow supports human takeover.
- [ ] Razorpay payment state is reconciled from verified webhook/provider state.
- [ ] Mobile capture works for photos and upload queue.
- [ ] Audio capture is consent-gated.
- [ ] AI outputs require review and preserve provenance.
- [ ] FHIR export exists before ABDM production dependency.
- [ ] No competitor/adjacent product is required as a core dependency.

## 19. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| WhatsApp provider policy/pricing changes | Provider abstraction, capability checks, BSP fallback, template tracking. |
| Payment webhook duplication or spoofing | Signature verification, idempotency keys, provider-state fetch, reconciliation. |
| Clinics use personal WhatsApp | Support manual source capture and migration path; do not scrape WhatsApp Web. |
| Practo API unavailable | Manual/source-tagged entry, authorized exports, no hard dependency. |
| AI hallucination | Structured schemas, source references, safety checks, human review, evaluation harness. |
| Mobile patient mismatch | Persistent patient banner, scan/confirm flow, recent-patient guardrails. |
| Audio privacy concern | Explicit consent, retention controls, raw audio deletion, audit. |
| X-ray software lacks API | Upload/import/link coexistence first. |
| ABDM delays core product | Build FHIR-ready model and feature-gate ABDM after clinic loop works. |

## 20. Done Criteria For Boundary Release

The integration/AI/mobile workstream is release-ready when:

- Assistant communication and payment workflows can run through real or sandbox providers in staging.
- Provider failures create visible operational states instead of silent failures.
- Mobile capture can reliably attach media to the correct patient.
- AI drafts are gated by consent, review, provenance, and evaluation.
- Source attribution survives from external channel to invoice/revenue.
- FHIR/ABDM readiness exists without blocking the daily clinic loop.
- All external side effects are observable, auditable, idempotent, and recoverable.
