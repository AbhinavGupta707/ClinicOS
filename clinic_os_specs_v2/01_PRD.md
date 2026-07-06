# 01 - Product Requirements Document

**Product name:** ClinicOS India  
**Date:** 2026-07-06  
**Primary wedge:** Dental clinics in India  
**Product type:** AI-native clinic operating system  
**Version:** PRD v0.2 for production implementation planning

## 1. Executive summary

ClinicOS India is an AI-native operating system for Indian private clinics, starting with dental. It is designed around the actual daily clinic loop: assistant opens WhatsApp and missed calls, confirms appointments, checks the schedule, handles new/old patient intake, supports doctor charting and note capture, creates treatment plans, sends prescriptions/instructions, handles invoicing/payment, tracks lab work, performs recall follow-up, manages inventory, and logs operational events.

The product should feel like a **clinic autopilot** with human approval, not a passive database. The system drafts, routes, reminds, reconciles, and surfaces exceptions. The doctor remains responsible for clinical sign-off.

## 2. First-principles problem statement

A private clinic is not primarily a form-filling environment. It is a repeated operational workflow with many small handoffs:

1. Patient contacts clinic through WhatsApp, call, Google, Practo, referral, or walk-in.
2. Assistant/reception confirms the appointment and prepares the day.
3. Patient arrives; staff determines whether they are new or returning.
4. New patient provides history and consent; returning patient requires record retrieval.
5. Doctor consults, examines, speaks findings, reviews images, and decides treatment.
6. Assistant records charting and intra-visit details.
7. Clinic converts consultation into treatment plan, bill, prescription, instructions, follow-up, lab case, inventory consumption, and recall.
8. Owner needs to know where revenue, time, follow-ups, lab work, materials, and quality control are leaking.

Most clinics already have fragments: WhatsApp, paper cards, photos on phones, X-ray software, Practo/Eka/Ray/other PMS, Excel, payment QR, lab slips, inventory diaries. The opportunity is to connect these into one operating loop.

## 3. Product thesis

The winning product is a **shared clinic core plus specialty operating layers**:

- Shared core: patients, appointments, queue, forms, consents, records, notes, prescriptions, billing, payments, communication, recalls, tasks, analytics, integrations, compliance.
- Dental layer: odontogram, tooth/surface findings, periodontal charting, X-ray/photo workspace, phased treatment plan, estimates, lab cases, consumables, six-month recalls.
- Future specialty layers: dermatology/aesthetics, ENT, orthopaedics/MSK, ophthalmology, general OPD.

## 4. Goals

### Product goals

- Reduce assistant coordination load.
- Reduce doctor documentation burden.
- Ensure no appointment request, missed call, recall, lab case, payment due, or inventory item falls through the cracks.
- Turn patient conversations and findings into structured, reviewable clinical records.
- Improve treatment-plan conversion and recall completion.
- Provide owner-grade visibility into clinic operations and revenue leakage.
- Prepare the product for ABDM/FHIR interoperability without making it a day-one adoption blocker.

### Business goals

- The first production slice must be valuable enough for a single-chair/small multi-chair dental clinic without needing a marketplace.
- ROI must be demonstrable through recovered missed calls, reduced no-shows, faster documentation, higher recall conversion, better treatment-plan follow-up, faster dues collection, and lower inventory/lab leakage.
- Product should support migration/coexistence with existing tools to reduce switching friction.

## 5. Non-goals for v1

- Do not build a Practo-style patient marketplace in v1.
- Do not build autonomous diagnosis or autonomous prescribing.
- Do not claim AI diagnostic accuracy for dental X-rays in the first production release.
- Do not attempt full hospital HIS complexity: IPD, insurance claims, OT, blood bank, large lab/pharmacy, NABH-grade enterprise workflows.
- Do not build every specialty at launch.
- Do not assume Practo or existing PMS systems expose reliable public APIs.

## 6. Personas

### Doctor-owner

Needs: clinical context, fast charting, good notes, treatment-plan conversion, trusted records, owner analytics, fewer operational leaks.  
Fear: software slows them down, AI creates medico-legal risk, staff cannot use it, migration pain.

### Dental assistant / receptionist

Needs: clear task list, WhatsApp inbox, appointments, recalls, patient forms, lab cases, inventory checks, daily/weekly/monthly protocol reminders.  
Fear: too many screens, complicated workflows, duplicate work.

### Patient

Needs: easy booking, reminders, understandable instructions, digital prescription, payment convenience, privacy, continuity of records.  
Fear: spam, confusing portals, data misuse, extra app downloads.

### Clinic manager / multi-branch owner

Needs: utilization, no-shows, revenue, conversion, dues, recall performance, inventory/lab reconciliation, staff accountability.

## 7. User experience overview

### 7.1 Assistant morning dashboard

At 9-10 AM, the assistant opens ClinicOS and sees:

- Today's appointments by status: confirmed, unconfirmed, reschedule requested, cancelled, no-show risk.
- WhatsApp inbox: new appointment requests, patient replies, documents received, lab/vendor messages.
- Missed calls and callback tasks.
- Follow-ups due: six-month recall, post-op day 1/day 7, abandoned treatment plans, pending payment reminders.
- Lab cases due or pending pickup.
- Inventory tasks: low stock, expiry, monthly instrument count, material reorder list.
- SOP tasks: curing light charge, switch check, sterilisation log, event diary review.
- Doctor prep summary: patient type, reason for visit, previous history, images/X-rays available.

### 7.2 Doctor encounter workspace

When a patient enters, the doctor sees:

- Patient timeline: prior visits, chief complaints, dental chart history, X-rays, photos, prescriptions, bills, medical history changes.
- Today's context: reason for visit, follow-up status, prior treatment plan stage, pending lab/payment.
- Live AI scribe panel: transcript chunks, draft note, source anchors.
- Dental chart: odontogram, tooth findings, procedures, perio chart if required.
- Media panel: intraoral photos, X-rays, PDFs, old records.
- Treatment plan builder: phases, prices, patient explanation, consent required.
- Prescription/instruction templates.
- Final sign-off checklist: note, chart, diagnosis, treatment, billing handoff, recall, instructions.

### 7.3 Checkout workspace

Reception/assistant sees:

- Doctor-approved procedures and billable items.
- Invoice draft and payment options.
- UPI/payment link status.
- Prescription/instructions ready to print or send by WhatsApp.
- Next appointment/recall suggestions.
- Pending lab/vendor tasks.

### 7.4 Owner control room

Owner sees:

- New leads by source: WhatsApp, Google, Practo, referral, walk-in, Instagram.
- Missed calls recovered or lost.
- Appointment confirmation/no-show rate.
- New vs returning patients.
- Treatment plans created, accepted, pending, abandoned.
- Revenue, dues, payment aging.
- Recall due/completed/revenue generated.
- Chair utilization, provider utilization, wait times.
- Inventory consumption, stockouts, expiry losses.
- Lab case turnaround, pending reconciliation.
- Events/near misses and corrective actions.

## 8. Functional modules and priority

| Module | Priority | Description |
|---|---:|---|
| Tenant/clinic setup | P0 | Organization, clinics, users, roles, working hours, appointment types, pricebook, templates. |
| Patient registry | P0 | Demographics, identifiers, ABHA fields, contacts, duplicate management, timeline. |
| Appointments/queue | P0 | Appointment booking, confirmations, walk-ins, chairs/rooms, queue status. |
| WhatsApp inbox | P0 | Inbound/outbound messages, appointment confirmations, recalls, document sharing. |
| Intake/forms/consent | P0 | New patient forms, medical/dental history, treatment consent, AI/audio/photo consent. |
| Clinical encounter | P0 | Notes, diagnosis, observations, treatment performed, prescriptions, sign-off. |
| Dental charting | P0 | Odontogram, tooth/surface findings, procedure history, basic perio. |
| Media/documents | P0 | Intraoral photos, X-rays, PDFs, tagging, timeline attachment. |
| Billing/payments | P0 | Invoices, dues, Razorpay/UPI links, receipts, payment status. |
| Recall/follow-up | P0 | Six-month recall, post-op reminders, treatment plan follow-up. |
| AI scribe | P1 | Transcription, structured draft note, dental chart patch, treatment-plan draft. |
| Lab case management | P1 | Lab case, pickup, due date, slip, reconciliation. |
| Inventory | P1 | Materials, instruments, stock ledger, reorder, expiry, checklists. |
| Quality/events/SOP | P1 | Incident/event diary, learnings, corrective actions, recurring protocol tasks. |
| Owner analytics | P1 | KPI dashboards, leakage analysis, source attribution. |
| Google/Practo growth | P1/P2 | Google review requests/profile link, Practo source tracking/coexistence. |
| ABDM/FHIR | P1/P2 | FHIR mapping day one; ABDM integration after pilot/sandbox readiness. |
| Multi-specialty packs | P2 | Dermatology/aesthetics, ENT, ortho, ophthalmology. |

## 9. First production slice scope

The first production slice means the first saleable, production-grade vertical slice. It does not mean throwaway implementation, partial workflow behavior, fake integrations, weak auditability, or reduced clinical/compliance safety.

### Must-have first production slice

- Multi-tenant clinic account.
- Staff roles: owner/admin, doctor, assistant, receptionist.
- Patient registry and timeline.
- Appointment calendar and queue.
- WhatsApp-compatible messaging abstraction; manual send + provider adapter.
- Digital intake form and consent capture.
- Dental chart production vertical slice: odontogram, tooth-level findings, edit history, source/provenance, and review states.
- Encounter notes and prescription templates.
- Photo/PDF/X-ray upload and patient attachment.
- Treatment plan and estimate.
- Invoice, payment status, payment link adapter.
- Follow-up/recall tasks and reminders.
- Basic owner dashboard.
- Audit log for clinical and PHI access events.

### Strong production additions

- AI scribe in consented pilot mode.
- Voice-to-dental-chart extraction.
- Lab case tracking.
- Inventory checklist and reorder list.
- Missed-call integration.
- Google review request automation.

## 10. Key workflows

### 10.1 Appointment request from WhatsApp

1. Patient sends message: “Do you have an appointment tomorrow?”
2. Webhook stores inbound message.
3. Classification service marks it as appointment intent.
4. Assistant sees suggested slots.
5. Assistant confirms slot or AI drafts reply.
6. Appointment is created.
7. Confirmation template is sent with date/time, location, pre-visit form if new.
8. Task/event is logged.

### 10.2 Returning patient six-month recall

1. Recall engine finds patient due for preventive visit.
2. System checks last treatment, doctor-specific template, opt-in status.
3. Recall message is drafted.
4. Assistant approves or bulk campaign is approved by owner.
5. Patient replies; appointment is booked.
6. Doctor receives pre-visit context.
7. After visit, next recall is scheduled.

### 10.3 Dental encounter

1. Doctor opens patient chart.
2. AI scribe starts only after consent.
3. Doctor reviews prior history and X-rays.
4. Doctor speaks findings: “46 distal caries, 47 cervical abrasion...”
5. AI creates a `DentalChartPatch` draft.
6. Assistant verifies/edits on chart.
7. Doctor adds diagnosis/treatment plan.
8. System drafts estimate, consent, billing items, recall, and instructions.
9. Doctor signs clinical note and prescription.
10. Checkout receives billing handoff.

### 10.4 Lab workflow

1. Doctor marks impression/lab work required.
2. Lab case is created with patient, tooth/procedure, due date, shade/material, attachments.
3. Printable/WhatsApp lab slip is generated.
4. Pickup task is assigned.
5. Lab status updates: sent -> received by lab -> due -> returned -> fitted/completed.
6. Month-end lab reconciliation lists all cases and expected payments.

### 10.5 Inventory workflow

1. Procedure completion emits inventory consumption suggestion.
2. Assistant confirms material consumption or system applies configured defaults.
3. Stock ledger updates.
4. Low-stock or expiry event creates reorder task.
5. Monthly instrument count checklist must be completed.
6. Missing instrument/material is logged as inventory incident if needed.

## 11. Success metrics

### Operational

- Appointment confirmation rate.
- No-show rate.
- Missed call recovery rate.
- Average time from consult end to note completion.
- Percentage of visits with complete signed note.
- Percentage of patient photos/X-rays correctly attached.
- Recall due-to-booked conversion.
- Pending lab cases overdue.
- Inventory stockout count.

### Financial

- Treatment plan acceptance rate.
- Abandoned treatment recovery revenue.
- Recall-generated revenue.
- Dues aging and collection rate.
- Revenue per chair/day.
- Revenue by lead source.

### AI quality

- AI note acceptance rate.
- Edit distance between AI draft and signed note.
- Dental chart extraction precision/recall on validation set.
- Unsupported/hallucinated clinical assertion rate.
- Percentage of AI actions needing correction.

## 12. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Clinic adoption friction | Start as overlay, not rip-and-replace. Keep WhatsApp and existing channels. |
| AI medico-legal risk | Human review/sign-off, source anchors, no autonomous prescription/diagnosis. |
| Practo API not available | Treat Practo as source/channel; use CSV/manual import and source tracking. |
| WhatsApp template/pricing changes | Abstract provider layer; use approved BSP/direct API based on clinic. |
| ABDM complexity | FHIR-ready model day one; integrate ABDM after sandbox/certification path. |
| Data privacy breach | Tenant isolation, RBAC, audit, encryption, consent, incident response. |
| Overbuilding too broad | Dental-first production slice; specialty pack architecture but no all-specialty v1. |
| Poor data migration | Offer assisted onboarding, CSV importers, duplicate resolution, shadow mode. |

## 13. Open questions for customer validation

1. How much are dental clinics currently paying for Ray/Eka/other PMS, WhatsApp tools, accounting, and reminders?
2. Would assistants use a dashboard if WhatsApp remains the front channel?
3. What percentage of clinics use formal X-ray software APIs vs file folders/manual exports?
4. What prescription formats and digital signatures are acceptable to doctors in target states?
5. Which recall/treatment-plan workflows create the highest ROI in dental?
6. Are dentists willing to record consultations if consent is captured and audio is deleted quickly?
7. What migration pain is most likely to block switching: appointments, old notes, photos, X-rays, billing, or staff training?


## 14. v0.2 revision: replacement-grade product deployed as overlay

This revision changes the product requirement from “coexist with existing systems” to a more precise strategy:

> Build replacement-grade clinic-management functionality from the beginning, but deploy it initially as an automation overlay so clinics can adopt without operational shock.

### 14.1 Replace vs coexist matrix

| Area | v0.2 product stance | Rationale |
|---|---|---|
| Practo Ray-like PMS | Replace from the first production release for new activity | This is software workflow, not network effects. We should be better at dental-specific operations. |
| Practo Prime/Profile | Coexist initially | These are acquisition/visibility channels. They have marketplace/network effects. |
| Google Business Profile | Coexist and amplify | Use review automation, direct booking link, local search attribution. |
| WhatsApp number | Coexist as front channel, replace chaos behind it | Patients should continue using WhatsApp; ClinicOS becomes the structured backend. |
| X-ray/imaging software | Coexist/integrate first | Many systems lack APIs; attach/link images before attempting replacement. |
| Accounting software | Coexist/export | Tally/Zoho remain finance systems; ClinicOS owns clinic invoice/payment state. |
| Paper diaries/Excel | Replace quickly | These are high-friction, low-defensibility workflows. |

### 14.2 New product object: external demand and attribution

ClinicOS must treat external demand as a first-class input. Every patient/booking/lead should carry one or more attribution touches:

- Practo.
- Google Business Profile.
- WhatsApp direct.
- Phone/missed call.
- Website/direct booking link.
- Instagram/Facebook.
- Referral.
- Walk-in.
- Recall campaign.
- Abandoned treatment follow-up.

Owner dashboards must report not only revenue, but **revenue by source, conversion by source, no-show by source, treatment acceptance by source, and repeat/recalled revenue by source**.

### 14.3 New module: lead and booking inbox

Add a P0 lead/booking inbox before the appointment calendar.

Responsibilities:

- Capture inbound WhatsApp appointment requests.
- Capture missed calls and call outcomes.
- Capture Practo-originated bookings manually/imported/parsed where allowed.
- Capture Google/direct booking links with UTM/source parameters.
- Match leads to existing patients or create new patient shells.
- Convert leads into appointments.
- Track SLA: responded, booked, lost, pending, duplicate, spam.
- Attribute resulting revenue to the original source.

### 14.4 New module: migration and source-of-truth control

Clinics may run ClinicOS alongside Practo/Ray/Eka/Excel for a transition period. The product must support per-domain source-of-truth policy:

| Domain | Possible source of truth during migration |
|---|---|
| Appointment calendar | ClinicOS, imported external calendar, dual-run |
| Patient demographics | ClinicOS after dedupe/import |
| Historical clinical notes | Read-only imported archive until verified |
| New encounters | ClinicOS only |
| Billing | ClinicOS for clinic operations; accounting export later |
| Acquisition channel | External source remains upstream; ClinicOS tracks source and conversion |

### 14.5 New module: workflow primitives

To support Plena-style customization without rewriting the product per clinic, the workflow engine should expose reusable primitives:

- Trigger: event, schedule, webhook, manual action, patient reply.
- Condition: clinic, doctor, appointment type, patient segment, treatment status, consent, source.
- Action: create task, draft message, send approved message, create appointment, generate payment link, draft note, attach document, create lab case.
- Approval: none, assistant approval, doctor approval, owner approval.
- SLA/escalation: due time, overdue task, notify owner.
- Evidence: source event, transcript anchor, document, user action.

### 14.6 Revised first production slice scope

The first production slice must include the operational loop **plus** source attribution:

```text
lead/source capture -> appointment -> intake -> encounter -> dental chart -> treatment plan -> invoice/payment -> instructions -> recall/lab/inventory/tasks -> source-attributed owner dashboard
```

The first production slice should be replacement-grade for:

- Scheduling.
- Queue.
- Patient record.
- Encounter notes.
- Dental charting.
- Prescriptions/instructions.
- Billing/payments.
- Recalls/follow-ups.
- Lab tracking vertical slice.
- Inventory checklist vertical slice.
- Owner dashboard vertical slice.

The first production slice should be coexistence/integration-grade for:

- Practo Prime/Profile/marketplace.
- Google Business Profile.
- Imaging software.
- Accounting.
- ABDM.

### 14.7 New risks

| Risk | Mitigation |
|---|---|
| Clinic expects Practo marketplace replacement | Be explicit: we replace internal operations first; we track and optimize external acquisition. |
| Practo API unavailable | Design adapter interface but support export/import/manual entry/email/calendar parsing only when allowed. |
| Overlay creates duplicate work | Run shadow mode briefly; then move source-of-truth domain by domain to ClinicOS. |
| Too much customization slows product | Use workflow primitives and config templates, not one-off code per clinic. |
| Agents act too freely | Every agent action becomes an `ActionProposal`; sensitive actions require configured approval. |

### 14.8 New product tagline

> Keep the channels that bring patients. Replace the manual work that loses them.
