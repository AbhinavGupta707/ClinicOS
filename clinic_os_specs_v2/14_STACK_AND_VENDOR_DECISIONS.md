# 14 - Stack and Vendor Decisions

**Date:** 2026-07-06  
**Status:** Recommended defaults for production build planning

## 1. Decision summary

ClinicOS should use these defaults:

| Area | Decision |
|---|---|
| Workflow runtime | Temporal for durable workflows; Redis/BullMQ only for short background jobs. |
| Auth / identity | Self-hosted Keycloak in India region, backed by PostgreSQL, with OIDC/OAuth2, MFA, SSO-ready design, and app-level RBAC/ABAC. |
| Database / tenant isolation | PostgreSQL with app authorization plus Row Level Security for tenant-owned PHI tables where feasible. |
| Cloud / region | AWS India. Primary: Asia Pacific (Mumbai). DR/warm standby: Asia Pacific (Hyderabad). |
| App hosting | Managed containers with Terraform. ECS/Fargate is acceptable first; EKS only when operational complexity is justified. |
| Object storage | S3 in India region with KMS encryption, short-lived signed URLs, malware scanning, and object-level audit. |
| WhatsApp | Direct Meta Cloud API as default long-term provider; keep BSP adapters such as Gupshup/WATI/Interakt as pluggable fallbacks. |
| Payments | Razorpay first, using invoice-specific dynamic UPI QR Codes for in-clinic payments and Payment Links for remote/WhatsApp payments. |
| ABDM | Direct ABDM/NHA integration as first-party capability. Do not depend on Eka as a production connector. |
| FHIR | Internal operational model plus validated FHIR R4 projections. Do not use FHIR as the internal database. |
| Mobile capture | Build an Expo/React Native capture app from the start for camera, audio, offline upload queue, and chairside workflows. Keep web/PWA as a fallback surface, not the primary capture surface. |
| AI/scribe | Backend-mediated provider gateway. Mobile/tablet/web can capture audio, but STT, extraction, consent, retention, audit, and review are controlled server-side. |

## 2. Workflow runtime

Use Temporal for core clinic workflows because ClinicOS has long-running, stateful processes with timers, retries, human approvals, and recovery requirements:

- Appointment confirmation and reschedule loops.
- Recalls and post-op follow-ups.
- Payment reminder and reconciliation flows.
- Lab case lifecycle.
- Migration review and commit.
- AI draft review and sign-off.
- ABDM consent/data exchange.
- Agent action proposal approval.

Use Redis/BullMQ only for short jobs:

- Thumbnail generation.
- OCR fanout.
- Webhook normalization bursts.
- Non-critical notification fanout.
- Cache invalidation.

Rationale: a queue says “run this job.” A durable workflow says “remember this business process until it is truly done.” ClinicOS needs the latter.

## 3. Auth and data residency

Use self-hosted Keycloak.

Why:

- Keeps identity data and session control inside our India-region infrastructure.
- Supports OIDC/OAuth2/SAML, MFA, identity brokering, user federation, sessions, admin controls, and future enterprise SSO.
- Avoids making a PHI-sensitive clinic product dependent on a global auth SaaS before legal/data-residency posture is fully settled.

Implementation posture:

- Keycloak handles authentication, MFA, sessions, SSO, and identity lifecycle.
- ClinicOS handles product authorization: tenant membership, clinic membership, role permissions, ABAC, break-glass access, clinical sign-off rights, export rights, and audit.
- PostgreSQL RLS should reinforce tenant isolation for PHI tables where feasible.

## 4. Cloud and region

Use AWS India:

- Primary region: Asia Pacific (Mumbai).
- Disaster recovery / warm standby: Asia Pacific (Hyderabad).

Why:

- AWS has two India regions, and AWS states the Hyderabad region has three Availability Zones and complements Mumbai.
- Mumbai is older and generally the safer primary for service maturity.
- Hyderabad gives India-region geographic resilience.
- AWS has mature primitives for VPC, RDS/Aurora PostgreSQL, S3, KMS, WAF, Secrets Manager, CloudTrail, GuardDuty/Security Hub, ECS/Fargate, and backup/DR.

Production baseline:

- Terraform for all infrastructure.
- Private subnets for database/cache/workflow internals.
- RDS/Aurora PostgreSQL Multi-AZ.
- Encrypted backups with restore drills.
- S3 with KMS, lifecycle, object lock where appropriate, malware scanning, and signed URL mediation.
- Central logs with PHI redaction.
- OpenTelemetry instrumentation.
- Provider health dashboards.
- On-call and incident runbooks from first production clinic.

## 5. WhatsApp route

Use direct Meta Cloud API as the default long-term integration, while keeping BSPs as adapters.

Why direct first:

- Better product control.
- Less dependency on a middle vendor.
- Cleaner provider-neutral architecture.
- Easier to own message state, templates, webhooks, consent policy, audit, and deliverability logic.

Why keep BSP adapters:

- Some clinics may already use WATI, Gupshup, Interakt, or another BSP.
- BSPs can help with onboarding, template operations, support, and local commercial realities.
- The adapter interface should allow clinic-by-clinic provider selection without changing product logic.

Product requirements:

- Template lifecycle tracking.
- Message category/policy awareness.
- Opt-in/opt-out enforcement.
- Inbound threading and patient matching.
- Delivery/read/failure status.
- Rate limits and retries.
- Human takeover.
- Provider capability health checks.

## 6. Payments

Use Razorpay first.

Default in-clinic flow:

```text
Doctor/assistant completes billable work
  -> invoice is created in ClinicOS
  -> ClinicOS creates a dynamic Razorpay UPI QR Code tied to that invoice
  -> patient scans using PhonePe / Google Pay / Paytm / BHIM / other UPI app
  -> Razorpay webhook arrives
  -> ClinicOS verifies signature and provider state
  -> invoice is marked paid/partially paid
  -> receipt is generated and sent/printed
```

Use dynamic invoice-specific QR, not a generic static clinic QR, because dynamic QR gives reconciliation. Static QR is acceptable only as a manual fallback and should create an unreconciled payment task until staff links it to an invoice.

Remote flow:

```text
invoice/payment request
  -> Razorpay Payment Link
  -> WhatsApp/SMS/email to patient
  -> webhook/API verification
  -> invoice/payment state update
```

Required payment states:

- draft
- payment_requested
- qr_created
- link_created
- sent
- partially_paid
- paid
- expired
- cancelled
- failed
- refunded
- manually_recorded
- reconciliation_required

Cashfree/PhonePe can be later adapters if pricing, settlement, UPI reliability, or clinic preference demands it.

## 7. ABDM

Do not use Eka as a production dependency.

Eka is useful as a reference for how ABDM concepts are packaged for developers, but ClinicOS should build first-party ABDM capability because Eka is strategically adjacent/competitive.

Recommended path:

1. Build the internal FHIR-ready clinical model and validated FHIR R4 projections.
2. Store ABHA/HPR/HFR fields only with consent and verification.
3. Implement care-context model and consent/data-exchange logs.
4. Enter ABDM sandbox/certification path directly.
5. Launch HIP capability first: link ClinicOS-generated records to patient ABHA and serve records with consent.
6. Add HIU later: request outside records with patient consent.

ABDM should not block the first production clinic workflow.

## 8. Capture app

Build an Expo/React Native mobile capture app from the start.

Plain-language difference:

- PWA: a website that can behave a bit like an app. Faster to deploy, but mobile camera/audio/offline behavior is less dependable.
- Expo/React Native: a real iOS/Android app built with TypeScript/React patterns. Better for camera, microphone, file handling, offline queues, secure storage, notifications, and device permissions.

ClinicOS needs reliable chairside capture:

- Intraoral photos.
- X-rays/documents.
- Audio capture for scribe.
- Consent capture.
- Offline upload queue.
- Secure local cache.
- Push/task notifications.
- Companion mode where doctor uses desktop/tablet while assistant captures media/audio on mobile.

Recommended surface model:

- Web app: owner/admin/assistant/doctor dashboards, scheduling, billing, analytics, review.
- Mobile capture app: camera, audio, patient intake at chairside, media upload, quick tasks, doctor/assistant companion workflow.
- Patient web links: intake forms, consent, payment, instructions, no patient app required initially.

## 9. Scribe and transcription

Audio can be captured from:

- Doctor/assistant mobile app.
- Clinic tablet.
- Desktop browser microphone where convenient.

But processing should be backend-mediated:

```text
consent recorded
  -> capture session starts
  -> encrypted stream/chunks go to backend
  -> STT/transcription provider runs behind AI gateway
  -> transcript segments stored with retention policy
  -> structured clinical drafts generated
  -> doctor reviews/signs
  -> raw audio deleted per policy
```

Do not let the mobile app directly own clinical AI state. The app is a capture surface; the backend owns consent, retention, audit, model routing, structured output validation, and sign-off.

## 10. Inspiration mapping

Use reference companies as inspiration, not dependencies:

- Plena: operating layer across existing practice systems; automate admin work end-to-end.
- EliseAI: omnichannel operational AI for calls/messages/scheduling/intake, with ROI and conversion focus.
- Eka: ABDM/health-record interoperability packaging and Indian healthcare workflow reference.
- Practo/Ray: incumbent PMS capability benchmark and acquisition-channel coexistence problem.

ClinicOS should learn from these patterns but own the source of truth, workflow engine, data model, and clinical safety model.

## 11. Pilot reality check

This does not mean “build a pilot hack.” It means collect operational facts so the first production slice fits real clinics.

First field evidence is captured in `15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md`. That conversation validates the need for assistant-led WhatsApp triage, personal appointment confirmations, six-month recall, new/returning patient routing, chairside charting, phone-based photo capture, X-ray software coexistence, invoice/UPI reconciliation, prescription/instruction templates, lab cards, monthly inventory, event management, and recurring protocol checklists.

Needed information from each target clinic:

- Current tools: Practo/Ray/Eka/Excel/paper/other PMS.
- WhatsApp setup: personal number, WhatsApp Business app, BSP, shared inbox, templates, opt-ins.
- Call setup: normal phone, virtual number, Exotel/Knowlarity, missed-call process.
- Payments: static UPI QR, Razorpay/Cashfree/PhonePe, cash/card, payment links, partial payments, refunds.
- Records: paper cards, PDFs, X-ray software, phone photos, cloud folders, export formats.
- Appointment sources: Practo, Google, Instagram, referrals, walk-ins, phone, WhatsApp, recall.
- Migration access: can they export patients, appointments, invoices, notes, prescriptions, media?
- Devices: receptionist desktop, doctor laptop/tablet, assistant phone, clinic-owned Android/iOS devices.
- Clinic workflow: chairs, providers, assistant roles, billing handoff, lab workflow, inventory workflow.
- AI comfort: audio recording consent, languages used, noisy environment, who reviews drafts.

These facts decide configuration, not product quality.
