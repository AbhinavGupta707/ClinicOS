# 07 - Implementation Roadmap

**Date:** 2026-07-06

## 1. Build strategy

Do not try to build the full blue-sky system in one push. Build the smallest workflow-complete dental OS that runs the clinic day end to end, but build every shipped feature to production-grade quality for its intended scope.

The right MVP is not “all modules partially.” It is one coherent loop:

```text
appointment -> intake -> encounter -> dental chart -> treatment plan -> invoice/payment -> instructions -> recall/task -> analytics
```

Production-grade scope rule:

- A feature can be deferred, but a shipped feature cannot be fake, partial, or make-shift.
- Test doubles and simulators are allowed for development and automated tests only; they must use the same provider contracts as production integrations.
- Reduce scope by shipping fewer complete vertical slices, not by weakening security, audit, consent, tenant isolation, workflow durability, integration correctness, or UX completeness.

## 2. Suggested phases

### Phase 0 - Discovery and technical spike

Duration: 2-4 weeks.

Goals:

- Validate 10-15 dental clinic workflows.
- Confirm current software stack: Practo/Ray/Eka/other, WhatsApp, X-ray software, accounting, payments.
- Obtain sample forms, prescriptions, invoices, treatment plans, recall messages, lab slips, inventory lists.
- Test WhatsApp/BSP, Razorpay, Exotel, and X-ray/photo upload feasibility.
- Define dental chart UX with real dentist feedback.
- Decide MVP cloud, auth, and stack.

Deliverables:

- Final MVP scope.
- Wireframes.
- Data migration template.
- Integration provider selection.
- Legal/privacy review plan.
- Pilot clinic LOIs.

### Phase 1 - Foundation platform

Duration: 6-8 weeks.

Build:

- Monorepo setup.
- Auth, tenants, clinics, roles.
- Patient registry.
- Appointment calendar.
- Queue.
- Production task foundation.
- Audit log foundation with immutable append-only semantics at the application level.
- Object storage upload.
- Production UI shell with responsive layouts, empty/error/loading states, and role-aware navigation.
- Seed/demo data.

Exit criteria:

- Staff can create patients, appointments, check-ins, and upload documents/photos.
- Owner/admin can manage users/roles.
- Audit log records key views/changes.

### Phase 2 - Dental workflow MVP

Duration: 8-10 weeks.

Build:

- Dental chart/odontogram.
- Encounter workflow.
- Clinical note templates.
- Prescription templates.
- Treatment plan and estimate.
- Invoice and payment status.
- Post-op instruction templates.
- Recall tasks.
- Lab case vertical slice.
- Inventory checklist vertical slice.
- Owner dashboard vertical slice.

Exit criteria:

- A real dental visit can be documented from check-in to checkout.
- Clinic can generate treatment plan, invoice, instructions, and recall without leaving the system.

### Phase 3 - Communications and payments hardening

Duration: 6-8 weeks.

Build:

- WhatsApp/BSP inbound and outbound integration.
- Message templates and delivery status.
- Conversation inbox.
- Payment link creation and webhook reconciliation.
- SMS fallback.
- Missed-call integration optional.
- Google review link workflow.

Exit criteria:

- Assistant can run appointment confirmations, recalls, payment links, and instructions through one inbox.
- Payment state is reconciled from verified webhooks.

### Phase 4 - AI pilot

Duration: 8-10 weeks.

Build:

- AI/audio consent flow.
- Audio capture/transcription.
- Clinical note draft.
- Dental chart patch draft.
- Treatment plan/task suggestions.
- Review UI.
- AI audit/provenance.
- Evaluation harness.

Exit criteria:

- AI drafts are useful in controlled pilot.
- Doctor can sign/edit quickly.
- No clinical output is finalized without approval.
- Raw audio retention policy works.

### Phase 5 - ABDM/FHIR readiness

Duration: 8-12 weeks; can overlap after core is stable.

Build:

- FHIR resource projections.
- Patient/encounter/document export as FHIR bundles.
- ABDM sandbox integration path.
- ABHA linking if chosen.
- Care context mapping.
- Consent/data exchange logs.

Exit criteria:

- System can produce standards-aligned patient/encounter/prescription/document records.
- ABDM integration path validated with sandbox/connector.

### Phase 6 - Scale and specialty expansion

Build after pilot success:

- Dermatology/aesthetics pack.
- ENT pack.
- Ortho/MSK pack.
- Multi-branch controls.
- Advanced analytics.
- Accounting integrations.
- Vendor/lab portal.

## 3. Pilot rollout plan

### Pilot clinic criteria

- 1-3 chair dental clinic.
- Willing assistant and doctor-owner.
- Uses WhatsApp heavily.
- Has regular six-month recalls or treatment plan follow-ups.
- Has photos/X-rays/lab cases/inventory workflows.
- Willing to run software in shadow mode first.

### Rollout steps

1. Configure tenant and clinic.
2. Import initial patient list and next 2-4 weeks of appointments.
3. Configure appointment types, pricebook, templates, recall rules.
4. Connect WhatsApp/payment provider in limited mode.
5. Train assistant and doctor.
6. Run shadow mode for 1-2 weeks.
7. Switch appointment/encounter/billing workflows gradually.
8. Start AI scribe only after clinical workflow is trusted.

## 4. Engineering milestones

| Milestone | Core acceptance |
|---|---|
| M0 repo created | Apps, packages, lint/test/CI, envs. |
| M1 auth/tenant | Users can login; role-based clinic access. |
| M2 patient/schedule | Patient registry, appointment, queue. |
| M3 encounter | Encounter notes, forms, media upload. |
| M4 dental | Odontogram, dental findings, treatment plan. |
| M5 billing | Pricebook, invoice, payment status. |
| M6 comms | WhatsApp abstraction, templates, inbox. |
| M7 recall/tasks | Recall rules, task automation, SOP tasks. |
| M8 AI | Consent, transcript, note/chart drafts, review UI. |
| M9 analytics | Owner dashboard and source attribution. |
| M10 hardening | Security, audit, backups, monitoring, pilot readiness. |

## 5. Team requirements

Minimum high-quality team:

- Product lead with clinic workflow ownership.
- Tech lead/full-stack architect.
- Backend engineer.
- Frontend engineer.
- AI engineer.
- DevOps/platform engineer part-time.
- Product designer.
- QA/automation engineer.
- Clinical workflow advisor/dentist.
- Legal/privacy advisor.

## 6. Design validation milestones

Before heavy implementation:

- Validate assistant morning dashboard with 5 assistants.
- Validate dental chart UI with 5 dentists.
- Validate treatment plan/estimate UX with 5 clinics.
- Validate recall/lab/inventory flows with at least 3 real workflows.
- Validate willingness to record audio with patient consent.

## 7. Build-vs-buy decisions

| Capability | MVP recommendation |
|---|---|
| Auth | Use mature auth provider/self-hosted Keycloak; do not invent. |
| WhatsApp | Use BSP/direct API adapter; do not scrape WhatsApp Web. |
| Payments | Use Razorpay/Cashfree/PhonePe adapter; do not build payment processing. |
| Telephony | Use Exotel/Knowlarity/Twilio-like provider. |
| AI STT/LLM | Use external AI APIs first; evaluate data residency/vendor terms. |
| FHIR server | Build validated FHIR R4 projections and conformance fixtures first; add a full FHIR server only when exchange use cases require server semantics. |
| DICOM/PACS | Support production-grade upload/folder ingest with DICOM metadata parsing first; add DICOMweb/PACS adapters when a clinic exposes those capabilities. |
| Accounting | Build production export/reconciliation first; add Zoho/Tally API connectors when credentials and accounting workflow justify it. |
| OCR | Use external OCR/document AI first; validate accuracy. |

## 8. Scope aggressively if needed

If schedule is constrained, keep only:

- Patients.
- Appointments/queue.
- Dental chart.
- Encounter note.
- Treatment plan.
- Invoice/payment status.
- WhatsApp reminders.
- Recall tasks.
- Media upload.
- Production audit for the shipped flows.

Defer entire capabilities temporarily:

- AI scribe.
- ABDM live integration.
- Inventory automation.
- Lab reconciliation.
- Deep analytics.
- Multi-specialty.

The MVP must still run an end-to-end dental visit. Deferred capabilities should be absent or clearly disabled, not partially present in a way that creates user trust, safety, billing, or compliance risk.


## 8. v0.2 revised sequencing: overlay first, replacement-grade core underneath

The build sequence changes. Communications/source attribution cannot wait until late if the product is supposed to start as an automation overlay. The MVP should still be workflow-complete, but the foundation must include the external lead/booking layer earlier.

### Revised phases

#### Phase 0 - Field discovery and adapter feasibility

Add to existing discovery:

- Map how each clinic currently receives Practo bookings, Google bookings, WhatsApp messages, calls, referrals, and walk-ins.
- Check whether clinics can export Practo/Ray/Eka/other PMS data.
- Collect sample appointment notifications, exports, Google links, WhatsApp templates, and call logs.
- Determine source-of-truth transition plan per clinic.

#### Phase 1 - Core platform + overlay foundation

Build earlier than before:

- External systems/accounts.
- Lead/booking inbox.
- Source attribution.
- Basic WhatsApp/manual communication abstraction.
- Import/migration batches.
- Workflow definitions/runs.
- Action proposals/approval UI.
- Patient, appointment, queue, task foundations.

Exit criteria:

- A Practo/Google/WhatsApp/phone-originated booking can be captured manually or via adapter, source-attributed, converted to appointment, and carried into clinic workflow.

#### Phase 2 - Replacement-grade clinic operations

Build:

- Patient registry.
- Appointment/queue as source of truth.
- Intake/consent.
- Encounter notes.
- Prescriptions/instructions.
- Billing/payment status.
- Recall/tasks.
- Basic owner dashboard.

Exit criteria:

- A clinic can stop using Ray-like workflows for new appointments/visits if desired.

#### Phase 3 - Dental operating layer

Build:

- Odontogram.
- Tooth/surface findings.
- Perio basics.
- Media timeline.
- Treatment plans and estimates.
- Lab cases.
- Inventory checklist/material rules.

Exit criteria:

- Product is not just a generic PMS; it handles a full dental visit and follow-up loop.

#### Phase 4 - Communications/payments hardening

Build:

- Official WhatsApp/BSP integration.
- Message templates/delivery statuses.
- Payment links/webhooks/reconciliation.
- Telephony/missed call integration.
- Google review workflow.

#### Phase 5 - AI pilot

Build:

- Scribe.
- Dental chart extraction.
- Treatment-plan/task suggestions.
- Lead triage/scheduling assistant.
- Recall/payment/lab/inventory agents.
- Agent harness with action proposals and approval policies.

#### Phase 6 - ABDM/FHIR and data exchange

Build:

- FHIR projections.
- ABHA linking/care-context flow where feasible.
- Consent/data exchange logs.

### Practical implementation note

Although the overlay layer is built early, the product code should not become a consultancy-like collection of one-off automations. Every workflow must be expressed through reusable primitives: trigger, condition, action, approval, SLA, evidence.
