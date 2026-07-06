# 04 - Integrations Specification

**Date:** 2026-07-06

## 1. Integration design principles

- Integrations are adapters; core domain logic must not depend on vendor-specific payloads.
- Every webhook is stored raw before normalization.
- Every inbound event must be idempotent.
- Every outbound API call must have retry, timeout, and dead-letter handling.
- PHI must not be sent to external providers unless necessary, consented/contracted, and configured.
- Integration credentials must be encrypted and tenant-scoped.
- Use feature flags per tenant because different clinics will adopt integrations at different speeds.

## 2. Integration gateway data model

- `integration_providers`: provider metadata, type, capability.
- `integration_accounts`: tenant/clinic-specific credentials and status.
- `webhook_endpoints`: configured provider endpoints.
- `raw_webhook_events`: raw payload, headers, received time, verification status.
- `normalized_events`: provider-neutral event records.
- `external_references`: maps internal records to provider IDs.
- `integration_jobs`: outbound sync jobs.
- `integration_job_attempts`: retries, errors, response metadata.

## 3. WhatsApp Business / BSP

### Use cases

- Appointment requests.
- Appointment confirmations.
- Reminder messages.
- New patient intake form links.
- Prescription and post-op instruction sharing.
- Six-month recall campaigns.
- Payment links.
- Lab/vendor messages if clinic chooses.
- Human handoff from AI/front desk automation.

### First production approach

Use a provider abstraction with one BSP implementation first, such as Gupshup, Interakt, WATI, or direct Meta Cloud API. The business logic should call `CommunicationProvider.sendMessage(...)`, not provider-specific SDKs directly.

### Inbound flow

```text
WhatsApp/BSP webhook -> raw_webhook_events -> verify signature -> normalize to message.received -> conversation thread -> AI classifier/task suggestion -> assistant inbox
```

### Outbound flow

```text
workflow event -> message draft -> approval policy -> provider send -> delivery status webhook -> message_delivery_attempt update
```

### Required features

- Template message support.
- Free-form service conversation support where allowed by provider rules.
- Media upload/download.
- Delivery/read status handling.
- Opt-in/opt-out tracking.
- Message source attribution.
- Human takeover.
- Rate limits and campaign throttling.

### Approval policy

| Message type | Approval |
|---|---|
| Appointment confirmation | Assistant or auto after configured rule. |
| Pre-visit form link | Auto if patient booked and opted in. |
| Prescription | Doctor signed first. |
| Clinical instructions | Doctor/clinic-approved template; assistant can send after encounter. |
| Recall campaign | Owner/assistant approval depending volume. |
| Payment reminder | Assistant approval or configured auto rule. |

## 4. SMS fallback

Use SMS only as fallback or for OTP/critical reminders. Keep SMS provider behind same messaging abstraction.

Use cases:

- Patient not on WhatsApp.
- Failed WhatsApp delivery.
- OTP/e-signature flow.
- Critical reminder fallback.

## 5. Telephony / Exotel-like integration

### Use cases

- Virtual clinic number.
- Missed-call recovery.
- IVR routing.
- Call logs.
- Optional call recording with explicit notice/consent.
- Appointment conversion attribution.

### Flow

```text
Incoming call -> Exotel webhook/status callback -> call_log -> patient/lead match -> task or appointment workflow
```

### Required normalized events

- `call.incoming`
- `call.missed`
- `call.answered`
- `call.completed`
- `call.recording.available`
- `call.status.updated`

### Required fields

- Caller number.
- Called clinic number.
- Start/end time.
- Duration.
- Status.
- Recording URL if enabled.
- Provider call ID.
- Matched patient/lead ID.

## 6. Razorpay / payment gateway

### Use cases

- Generate payment link for invoice.
- UPI payment link.
- Partial payment where allowed.
- Payment reminders.
- Payment status reconciliation.
- Refund tracking.

### Flow

```text
invoice.created -> create payment link -> send via WhatsApp/SMS -> payment webhook/callback -> verify signature -> mark payment succeeded -> receipt -> analytics
```

### Requirements

- Store provider payment link ID.
- Verify callback signature before marking paid.
- Idempotent webhook processing.
- Reconcile daily with provider API.
- Handle partial payments, expiry, cancelled links.
- Do not rely only on client redirect/callback.

### Payment state machine

```text
draft -> link_created -> sent -> partially_paid -> paid -> refunded/voided
```

## 7. Google Business Profile

### Use cases

- Sync clinic location data and appointment URL.
- Track Google-originated calls/bookings if available.
- Request and manage reviews.
- Surface review tasks after successful visits.
- Manage posts/updates later.

### First production approach

Do not overbuild Google API on day one. Start with:

- Store Google profile link.
- Generate post-visit review request link.
- Track source as Google when patient uses booking link/UTM.
- Later integrate Business Profile API for reviews/location insights.

## 8. Practo integration/coexistence

### Strategic stance

Practo can remain an acquisition source. ClinicOS should replace Ray-like internal workflows over time, not force clinics to abandon Practo Prime/Profile immediately.

### First production approach

- Import exported patients/appointments if clinic can export.
- Track lead source = Practo.
- Allow manual appointment entry from Practo bookings.
- Provide migration tooling for Ray-like data if exports available.
- Do not assume public write API.

### Later options

- Browser-assisted import/export tools if legally acceptable.
- Email parsing for appointment notifications.
- Calendar sync if Practo exposes calendar feeds or clinic uses Google Calendar.
- Marketplace-source ROI dashboard.

## 9. ABDM / ABHA / FHIR

### Implementation posture

- Build FHIR-ready canonical model from day one.
- Add ABDM integration as P1/P2 after core workflow works in pilot.
- Decide whether to integrate directly with NHA sandbox or through a third-party connector.

### ABDM roles

- **HIP**: Health Information Provider. A clinic PMS/HMS can expose care contexts and records with consent.
- **HIU**: Health Information User. A clinic can request records from other providers with consent.
- **PHR/health locker**: patient-facing record management.

### Milestones to plan for

- M1: ABHA creation/linking.
- M2: Care context linking and data sharing.
- M3: Consent-based data fetching.
- M4: HPR/HFR registration.

### First production data model

- `abdm_links`
- `care_contexts`
- `abdm_consents`
- `fhir_resources`
- `abdm_exchange_logs`

### Safety

Do not make ABDM mandatory in v1 clinic flow. It can add friction. Make it a progressive readiness layer.

## 10. Imaging, X-rays, DICOM, and photos

### Reality of the dental first production slice

Many clinics will not have clean DICOMweb/PACS APIs. X-rays may exist in vendor software and intraoral photos may be on phones. The first production slice should support:

- Direct upload of JPEG/PNG/PDF/DICOM.
- Mobile capture directly into patient profile, with web upload as fallback.
- Desktop folder watcher for exported X-rays where feasible.
- Patient/tooth/encounter tagging.
- Side-by-side comparison.
- Consent and audit for photo access/sharing.

### Later DICOM/DICOMweb

Support:

- QIDO-RS for searching studies.
- WADO-RS for retrieving objects/rendered images.
- STOW-RS for storing studies.
- DICOM metadata mapping to `ImagingStudy` and internal media records.

### Do not in the first production release

- Do not claim AI diagnosis on X-rays.
- Do not require clinics to replace their imaging software.
- Do not store images without patient/clinic consent policy and access controls.

## 11. Accounting integration

### First production release

- Export invoices/payments to CSV/Excel suitable for Tally/Zoho/accountant.
- Configurable tax/GST fields.
- Daily/monthly collections report.

### Later

- Zoho Books API.
- Tally connector/import utility.
- GST-compliant invoice templates if required by clinic/accountant.

## 12. Lab/vendor integration

Most dental labs will operate by WhatsApp, phone, email, or pickup. Build a workflow first, API later.

### First production release

- Digital lab case card.
- Printable lab slip.
- WhatsApp/shareable lab case details.
- Pickup/due tasks.
- Status tracking.
- Month-end reconciliation.

### Later

- Lab portal.
- Vendor invoice upload/OCR.
- Vendor pricebook.
- Automated pickup scheduling.

## 13. Drug database / prescription support

### First production release

- Clinic-defined medication templates.
- Dosage/frequency/duration fields.
- Allergy warning if patient allergy matches medication name/class where configured.
- Doctor sign-off.

### Later

- Licensed Indian drug database.
- Interaction checks.
- Generic-name suggestions.
- Formulary/preferences.

## 14. Email/document ingestion

Use cases:

- Patient sends old reports by email.
- Lab sends PDF invoice.
- Referral letter arrives.

First production release:

- Secure upload link.
- Clinic inbox email alias later.
- OCR/document parser as AI-assisted draft metadata, not final record.

## 15. Integration priority matrix

| Integration | First production release | P1 | P2 |
|---|---:|---:|---:|
| WhatsApp/BSP | Yes | Hardening | Multi-provider |
| SMS | Basic fallback | OTP | Advanced campaigns |
| Razorpay/payment links | Yes | Reconciliation | Refund automation |
| Exotel/calls | Optional first production addition | Yes | IVR optimization |
| Google reviews/profile | Basic links | API | Insights automation |
| Practo | Source tracking/import | Migration utilities | Deeper sync if available |
| ABDM | Data model ready | Sandbox/HIP | HIU/PHR flows |
| Imaging upload | Yes | Folder watcher | DICOMweb/PACS |
| Accounting export | Yes | Zoho/Tally connectors | Tax automation |
| Lab/vendor | Workflow | Vendor portal | API/OCR reconciliation |
| Drug database | Templates | Licensed DB | Interaction checks |


## 15. v0.2 Practo and acquisition-channel integration strategy

### 15.1 Strategic stance

ClinicOS should replace Practo Ray-like software functionality but coexist with Practo Prime/Profile as an acquisition channel if it is bringing patients.

The implementation should therefore separate:

- **Operational replacement:** scheduling, queue, records, clinical notes, dental charting, prescriptions, billing, reminders, payments, record sharing, recalls, analytics.
- **Acquisition coexistence:** Practo Prime/Profile/marketplace, Google Business Profile, website, WhatsApp, calls, referrals.

### 15.2 Practo integration capability levels

Do not assume a reliable public Practo API. Implement a `PractoAdapter` interface, but make it capability-driven.

| Level | Capability | Implementation |
|---|---|---|
| L4 | Official read/write API | Use only if verified partner/API access exists. |
| L3 | Official exports/imports | CSV/XLS import of patients, appointments, history, invoices where available. |
| L2 | Notification/calendar parsing | Parse appointment notifications/email/calendar only if terms and clinic permissions allow it. |
| L1 | Manual-assisted | Assistant enters Practo-originated bookings; system tracks source. |
| L0 | No reliable path | Practo remains an external channel; no automation. |

### 15.3 Practo-originated booking flow

```text
Patient discovers clinic on Practo Prime/Profile
  -> booking/call/notification occurs in Practo
  -> ClinicOS captures via API/export/manual entry/notification parsing if allowed
  -> lead source = Practo
  -> ClinicOS creates/matches patient
  -> ClinicOS appointment becomes operational source of truth
  -> WhatsApp confirmation from ClinicOS
  -> clinic visit runs inside ClinicOS
  -> invoice/payment/recall handled by ClinicOS
  -> owner dashboard reports Practo-sourced revenue and ROI
```

### 15.4 Data migration from Practo/Ray or other PMS

Support import templates for:

- Patients.
- Appointments.
- Basic notes.
- Prescriptions.
- Invoices/payment history.
- Attachments/documents if exportable.

Every import must create a `MigrationBatch`, preserve raw rows, show conflicts/duplicates, and require review before merging into production records.

### 15.5 Source attribution requirements

Every lead/appointment must track:

- First source.
- Booking source.
- Campaign/referral where known.
- Original external reference.
- Revenue attached to source.
- No-show/cancellation attached to source.
- Recall/treatment-plan follow-up source.

### 15.6 Google as dependency-reduction channel

ClinicOS should reduce marketplace dependency by improving direct channels:

- Direct booking link with UTM/source tracking.
- Google review request after successful visits.
- Google profile link storage and later API integration.
- Missed-call recovery.
- Recall campaigns.
- Referral campaigns.
- Abandoned treatment recovery.

### 15.7 Compliance guardrail

Do not build unauthorized scraping or brittle browser automation as a core integration. Any integration that reads/writes external systems must be based on official APIs, user-authorized exports, allowed notifications, manual clinic entry, or explicit partner permissions.

## 16. v0.2 integration abstraction requirements

Each adapter must expose:

- Capabilities.
- Health status.
- Authentication status.
- Webhook verification if applicable.
- Idempotency keys.
- Rate-limit metadata.
- Raw event retention.
- Normalized event output.
- Error/dead-letter handling.
- Reconciliation jobs.

Normalized events should flow into the same event bus, regardless of provider:

```text
external.lead.received
external.appointment.received
external.message.received
external.call.missed
external.payment.succeeded
external.document.received
external.review.received
external.import.completed
```

This is what enables the product to start as an overlay and later become the clinic's system of record.
