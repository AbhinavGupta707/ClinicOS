# 00 - Source Register and Evidence Notes

**Date compiled:** 2026-07-06

This file lists the main sources used to shape the product and technical architecture. It is intentionally explicit so future research or implementation agents can verify assumptions instead of treating this as unsupported brainstorming.

## Founder-provided field evidence

### Dental doctor daily workflow conversation
Source file: `/Users/abhinavgupta/.codex/attachments/f6430538-4acb-4d08-8569-7439091bd112/pasted-text.txt`  
Canonical summary: `15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md`

Key evidence:
- Assistant begins the day by checking clinic phone WhatsApp messages and missed calls.
- Existing practice software sends reminders, but the assistant still sends personal WhatsApp confirmations and recall messages.
- Returning patients need fast record/X-ray prep; new patients still use a history-card flow.
- Doctor performs tooth-by-tooth charting while the assistant records findings.
- Intraoral photos currently remain on the phone; attaching them to the patient profile is a clear pain point.
- X-rays live in separate X-ray software, so coexistence/import matters more than immediate replacement.
- Post-visit notes, diagnosis, treatment plan, treatment performed, invoice, UPI payment, prescription, and instructions are separate handoffs today.
- Lab cards, month-end lab reconciliation, monthly inventory, event-management diary, and recurring protocol checks are real operational workflows.

Implementation relevance:
- Confirms ClinicOS must be a daily clinic operating loop, not a scribe-only or appointment-only product.
- Confirms WhatsApp, recall, mobile capture, X-ray coexistence, payment reconciliation, lab workflow, inventory, event management, and SOP tasks as high-priority product surfaces.
- Confirms the production slice should improve the full assistant/doctor/reception handoff while coexisting with existing software.

## Uploaded baseline research reports

### `deep-research-report2.md`
Key evidence:
- The right product mental model is **clinic operating system, not appointment app**.
- India is moving toward ABDM-style federated, consent-based, standards-driven records.
- A safe AI pattern is **ambient capture -> structured draft -> clinician review/sign-off**, not fully autonomous prescribing.
- Indian private clinics often operate as **front desk/assistant + doctor**, not hospital departments.
- Strong first wedge: dental, because workflow objects are structured and monetisable.
- The moat is owning the consultation-to-follow-up loop in an ABDM-native, multilingual, assistant-friendly workflow.

### `deep-research-report 1.md`
Key evidence:
- Build a **shared operational core plus specialty workflow layers**.
- Ambient documentation alone is not the business; it must connect to front-desk work, recall, patient messaging, dues, record retrieval, inventory, and owner analytics.
- Checkout and post-visit continuity are underestimated but high-value workflow stages.
- Dental must be chart-first/procedure-first, not merely note-first.
- Regulatory variability and DPDP/data governance require product-level privacy and configurability.

## Regulatory and interoperability sources

### ABDM / ABHA / HPR / HFR / consent architecture
- Official ABDM home: `https://abdm.gov.in/`
- Eka ABDM Connect documentation: `https://developer.eka.care/api-reference/user-app/abdm-connect/overview`

Implementation relevance:
- ABDM is the national digital health infrastructure direction for India.
- Important building blocks: ABHA for patient identity, HPR for provider registry, HFR for facility registry, consent manager, HIP/HIU roles.
- A clinic HMS/PMS is most likely a HIP first; later it may act as HIU or connect through a health locker/PHR app.
- Product should be FHIR-ready, but day-one pilots can optionally use ABDM integration through a third-party connector or sandbox.

### HL7 FHIR R4
- FHIR overview: `https://www.hl7.org/fhir/R4/overview.html`
- FHIR resource index: `https://www.hl7.org/fhir/R4/resourcelist.html`
- FHIR security: `https://www.hl7.org/fhir/R4/security.html`
- FHIR AuditEvent: `https://www.hl7.org/fhir/R4/auditevent.html`

Implementation relevance:
- FHIR is a standard for healthcare information exchange based on resources.
- Useful mappings: Patient, Practitioner, Organization, Location, Appointment, Schedule, Slot, Encounter, Observation, Condition, Procedure, MedicationRequest, CarePlan, ServiceRequest, DocumentReference, Media, ImagingStudy, DiagnosticReport, Consent, AuditEvent, Invoice, PaymentNotice, ChargeItem.
- FHIR itself does not provide complete security; implementation must provide TLS, authentication, authorization, audit, provenance, privacy controls, and jurisdiction-specific compliance.

### DICOM / DICOMweb
- DICOM PS3.18 2026c Web Services: `https://dicom.nema.org/medical/dicom/current/output/html/part18.html`

Implementation relevance:
- DICOMweb Studies Service supports store, retrieve, update, and search for DICOM studies/series/instances.
- WADO-RS = retrieve, STOW-RS = store, QIDO-RS = search.
- First production dental clinics may not expose DICOMweb APIs; support manual upload/folder sync first, DICOMweb/PACS later.

## Communications and workflow integrations

### WhatsApp Business Platform
- Official product page: `https://business.whatsapp.com/products/business-platform`

Implementation relevance:
- Supports enterprise APIs, two-way conversations, media, interactive messages, appointment reminders, automation, routing, and backend CRM integrations.
- WhatsApp is the operational centre of many Indian clinics; build it as a first-class inbox/task/workflow surface, not just outbound reminders.

### Gupshup / BSP option
- Gupshup product page: `https://www.gupshup.io/`

Implementation relevance:
- BSPs can accelerate WhatsApp rollout, message templates, campaign management, human handoff, and multi-channel messaging.
- Direct Meta Cloud API may be cheaper/control-oriented later, but BSPs are pragmatic for pilots.

### Exotel telephony
- Developer docs: `https://developer.exotel.com/api/voice/`

Implementation relevance:
- Useful for virtual numbers, call automation, IVR, missed call tracking, call metadata, status callbacks, and dynamic call routing.
- Build call/missed-call events into the same lead/task engine as WhatsApp.

## Payments and revenue

### Razorpay Payment Links
- API docs: `https://razorpay.com/docs/api/payments/payment-links/`

Implementation relevance:
- Supports create/update/cancel/fetch/resend payment links, UPI links, callbacks, and signature verification.
- Use idempotent payment webhook processing and signature verification before marking invoices paid.

## Growth/acquisition

### Google Business Profile APIs
- Official overview: `https://developers.google.com/my-business`

Implementation relevance:
- Google Search/Maps presence, locations, reviews, posts, questions, calls/booking insights.
- Use Google as a growth surface, but avoid becoming a marketplace in v1.

### Practo / Practo Ray / Prime
- Ray page: `https://www.practo.com/providers/clinics/ray`
- Prime page: `https://www.practo.com/providers/prime`

Implementation relevance:
- Ray-like clinic management functions overlap with our long-term product.
- Prime/Profile are acquisition/visibility channels. Do not force replacement immediately.
- Public API availability is uncertain; plan for CSV/manual imports, lead-source tracking, and coexistence.

## AI integration sources

### OpenAI APIs
- Structured Outputs: `https://platform.openai.com/docs/guides/structured-outputs`
- Realtime API: `https://platform.openai.com/docs/guides/realtime`
- Speech-to-text: `https://platform.openai.com/docs/guides/speech-to-text`
- Function/tool calling: `https://platform.openai.com/docs/guides/function-calling`

Implementation relevance:
- Use structured outputs for schema-bound clinical drafts and action drafts.
- Use realtime or speech-to-text models for ambient consultation transcription and diarization.
- Use tool/function calling only through a permissions layer; AI cannot directly send clinical messages, prescriptions, or bills without approval rules.

## Indian privacy and clinical regulation sources

### DPDP / privacy
- Reuters report on strengthened privacy rules: `https://www.reuters.com/world/india/india-strengthens-privacy-law-with-new-data-collection-rules-2025-11-14/`
- Recent press coverage on enforcement timelines and penalties should be re-verified before production decisions.

Implementation relevance:
- Build data minimization, purpose limitation, privacy notices, opt-out/withdrawal, breach procedures, retention, vendor controls, and cross-border processing controls into the product.
- Health data is sensitive in practice even if the DPDP structure uses broad “personal data” terminology.

### Clinical establishment / patient rights / records
- Times of India coverage of Kerala Clinical Establishment Act order, Jan 2026.
- Other state-specific rules vary; legal review is required before production launch in each state.

Implementation relevance:
- Product should support state-specific configuration for displayed services/prices, itemized billing, emergency policies, patient rights, grievance officer details, confidentiality, and record export/handover.

## Evidence caveats

- Product pages reveal what vendors market, not necessarily what clinics use daily.
- ABDM technical details require official sandbox/certification work before implementation commitments.
- WhatsApp, payment, and telephony APIs change; re-check provider docs during implementation.
- Practo integration is uncertain; do not design the first production release around guaranteed Practo APIs.
- DPDP and state health regulations are current as of this research pass but require legal counsel and periodic review.
- Specialty assumptions beyond dental and dermatology need field validation with real clinics.


## v0.2 strategic sources added

### Plena Health / YC Launch
- Company page: `https://www.ycombinator.com/companies/plena-health`
- Launch post: `https://www.ycombinator.com/launches/QdQ-plena-health-the-ai-operating-system-for-specialty-medical-practices`

Implementation relevance:
- Plena positions itself as an AI operating system for specialty practices that automates administrative workflows across systems already used by a practice.
- Public materials emphasize referrals, fax intake, scheduling, procedure compliance, records, collections, EHR integrations, agent harnesses, workflow primitives, and avoiding rip-and-replace.
- The relevant lesson for India is not to blindly copy US reimbursement workflows; it is to build an automation overlay that takes over staff labor across disconnected systems before becoming the full source of truth.
- Limit: Plena's public materials are marketing/launch materials, not detailed internal architecture docs. Treat architectural inferences as product strategy, not verified implementation facts.

### Practo revised interpretation
- Ray page: `https://www.practo.com/providers/clinics/ray`
- Prime page: `https://www.practo.com/providers/prime`

Implementation relevance:
- Ray overlaps directly with ClinicOS software functionality and should be replaced by our schedule, queue, patient records, note, prescription, billing, reminder, payment, record-sharing, and analytics modules.
- Prime/Profile/marketplace are acquisition/distribution assets and should be treated as external channels rather than day-one replacement targets.
- Public API availability remains unverified; build adapter interfaces but do not depend on Practo API access.

### WhatsApp Business Platform official source
- Product page: `https://business.whatsapp.com/products/business-platform`

Implementation relevance:
- Supports enterprise messaging APIs, two-way conversations, appointment reminders, interactive flows, rich media, automation, smart routing, and backend integrations.
- This validates WhatsApp as the primary operational channel for Indian clinics.

### Razorpay Payment Links official source
- Payment links documentation: `https://razorpay.com/docs/payments/payment-links/`

Implementation relevance:
- Payment links can be created from dashboard or APIs, sent via SMS/email/social channels, support expiry, partial payment, reminders, and webhooks.
- Payment state must be updated from verified webhook/server-side reconciliation, not just frontend redirects.
