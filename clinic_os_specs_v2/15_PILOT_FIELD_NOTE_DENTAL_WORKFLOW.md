# 15 - Pilot Field Note: Dental Clinic Daily Workflow

**Date captured:** 2026-07-06  
**Source:** Founder-provided conversation with a dental doctor  
**Source file:** `/Users/abhinavgupta/.codex/attachments/f6430538-4acb-4d08-8569-7439091bd112/pasted-text.txt`  
**Purpose:** Convert real clinic workflow evidence into product, architecture, and pilot planning implications.

This note should be treated as field evidence, not a complete market study. It describes one dental clinic workflow in detail and validates many of the core ClinicOS assumptions.

## 1. Observed Workflow

### Morning start

- Around 9:00, the clinic phone is checked for WhatsApp appointment messages and missed calls.
- The assistant keeps the clinic phone throughout the day.
- Around 10:00, the assistant reaches the clinic, opens the computer, and checks the day's scheduled appointments.
- Existing practice software sends reminders, but the assistant still sends personal WhatsApp confirmation messages to each patient.
- Patients reply on WhatsApp confirming the appointment.
- The assistant checks follow-up messages and runs six-month preventive recall outreach manually, even though the software also sends automated follow-ups.

### Patient arrival

- The clinic distinguishes between returning patients and new patients.
- Returning patients are sent in without filling a fresh history card.
- New patients fill a history card; the assistant then enters details into the patient profile.
- Before seeing a returning patient, the doctor reviews prior records, visit history, and X-rays.
- The doctor asks whether the visit is a six-month follow-up or problem-driven visit.
- Even on follow-up, the doctor usually performs a full re-examination.

### Clinical encounter

- The doctor performs tooth-by-tooth charting and speaks findings such as tooth number plus condition.
- The assistant records the charting during the examination.
- Medical history changes are checked and updated.
- X-rays are taken if required.
- A treatment plan is created based on current findings.
- For new patients, the doctor captures medical history, dental history, brushing habits, snacking/rinsing/mouthwash habits, charting, photographs, and X-rays.
- Intraoral photographs are currently kept on the phone; the doctor explicitly wants them attached to the patient profile.
- X-rays live in separate X-ray software and can be viewed alongside the patient profile, so direct replacement of the X-ray system is not immediately required.

### Post-visit documentation

After the patient leaves, the doctor writes:

- Medical history.
- Dental history.
- Examination findings and observations.
- Investigations performed, including photographs, X-rays, and tests.
- Diagnosis.
- Treatment plan.
- Treatment carried out.

### Billing, payment, prescription, and instructions

- The patient goes to reception after the encounter.
- An invoice is generated for the treatment carried out.
- The patient pays using UPI or another preferred method.
- Prescriptions are written by the doctor, printed, and given to the patient.
- Post-op and product instructions are sometimes printed and sometimes sent over WhatsApp.
- Examples include interdental brush recommendations, Amazon purchase links, fluoride varnish instructions, dietary restrictions, and lifestyle guidance.

### Inventory, lab, and operations

- At the beginning of each month, the assistant performs a physical inventory check.
- Instruments are checked against the inventory list to ensure none are lost.
- Materials are checked drawer by drawer in a defined sequence.
- The assistant prepares a procurement list and calls the vendor.
- If treatment requires an impression or lab work, the assistant calls the lab person.
- A lab card is filled for the patient and sent with the work; a copy is retained by the clinic.
- At month end, the clinic reconciles lab work sent out against the lab invoice.
- The clinic keeps an event-management diary for mistakes or misses, such as lights left on, wrong impression taken, missed appointment, or other process errors.
- Events include learnings and preventive actions.
- The clinic tracks recurring operational protocols, such as charging curing lights every 10 days and checking electrical switches weekly.

## 2. Current System Reality

This clinic appears to use a mix of:

- Practice software for schedule, reminders, and patient profile.
- Clinic phone/WhatsApp for confirmations, follow-ups, instructions, and coordination.
- Separate X-ray software.
- Phone camera for intraoral photos.
- Paper or semi-paper history cards.
- UPI for payments.
- Printed prescriptions and printed/WhatsApp instructions.
- Lab cards and month-end manual lab reconciliation.
- Inventory checklist/diary.
- Event-management diary.
- Recurring protocol checklist outside the main software.

This confirms the ClinicOS strategy: do not begin as a rip-and-replace of every tool. Begin by becoming the structured operating layer around the daily loop, then progressively become the source of truth.

## 3. Product Implications

1. The assistant day-start dashboard is P0, not a nice-to-have.
2. WhatsApp is the operational front door. It must support inbound messages, missed-call tasks, confirmations, recall messages, instructions, and human takeover.
3. Reminder automation must preserve the assistant's personal-touch workflow. The product should draft and track messages, not make the clinic feel robotic.
4. Six-month preventive recall is a core revenue and continuity workflow.
5. Returning-patient prep summary is P0: prior visits, X-rays/photos, treatment history, open treatment plans, recalls, and pending dues/lab work.
6. New-patient intake must support both digital forms and assistant-entered paper-card data during migration.
7. Dental charting must support doctor-spoken findings and assistant co-entry.
8. Mobile capture is required from the start because important photos currently live on phones.
9. X-ray software should be integrated by coexistence first: link, upload, folder import, or export ingest before attempting deep PACS/DICOM integration.
10. Post-visit note generation matters as much as live scribing. The product should assemble drafts from charting, media, investigations, diagnosis, plan, and treatment performed.
11. Billing must be tied to procedures actually carried out, then reconciled through UPI/payment provider events.
12. Instructions should be a template library that can be printed or sent by WhatsApp, including product recommendations and care instructions.
13. Lab case workflow and month-end lab reconciliation are core dental operations.
14. Inventory must model both instruments and consumable materials.
15. Event management and recurring protocol checklists are a lightweight clinic quality-management system and should be treated as product surface area.

## 4. Architecture Implications

- Temporal is justified because the workflow has durable timers and human checkpoints: appointment confirmations, six-month recalls, lab cases, inventory checks, recurring protocols, post-op instructions, and event corrective actions.
- The mobile app is justified because chairside media capture and eventual audio capture cannot depend on desktop workflows.
- The WhatsApp adapter must handle real conversational state, not just one-way notifications.
- The payment system should use dynamic invoice-specific QR/payment links so UPI payments reconcile to invoices.
- The media subsystem must support patient-linked photos, X-rays, consent, provenance, access control, and later DICOM/FHIR mapping.
- The task/workflow model must support assistant-owned recurring operational work, not only doctor clinical tasks.

## 5. Backlog Confirmations

This field note confirms the priority of:

- Lead/WhatsApp inbox.
- Missed-call task capture.
- Appointment confirmation workflow.
- Six-month recall workflow.
- Returning-patient prep view.
- Digital intake/history-card entry.
- Dental charting with assistant co-entry.
- Photo capture into patient profile.
- X-ray coexistence/import.
- Encounter note drafting and doctor sign-off.
- Invoice, UPI QR/payment link, receipt, and reconciliation.
- Prescription and instruction templates.
- Lab case cards and lab reconciliation.
- Monthly drawer-by-drawer inventory.
- Event management/CAPA-style learning log.
- Recurring SOP/protocol checklist.

## 6. Open Questions For This Clinic

- What exact practice software is being used?
- Can the clinic export patients, appointments, clinical notes, invoices, prescriptions, and reminders from that software?
- Is the clinic WhatsApp number a personal WhatsApp, WhatsApp Business app, or Business Platform/BSP number?
- Are current reminders sent by the practice software via SMS, WhatsApp, email, or app notification?
- What is the current UPI setup: static QR, Razorpay, PhonePe Business, bank QR, or another provider?
- What X-ray software is used, and can it export images or patient references cleanly?
- Are intraoral photos stored on a clinic-owned phone or personal staff phones?
- What consent language is currently used for photos, X-rays, WhatsApp communication, and possible audio recording?
- What format are history cards, lab cards, inventory lists, and event-management diaries currently in?
- How often are missed appointments, wrong impressions, unpaid dues, delayed labs, or inventory stockouts happening?

## 7. Decision

Use this clinic workflow as a reference pilot archetype:

```text
WhatsApp/missed calls
  -> assistant day-start dashboard
  -> appointment confirmation
  -> new/returning patient routing
  -> intake/history update
  -> doctor prep summary
  -> charting + photos/X-rays
  -> diagnosis + treatment plan
  -> treatment performed
  -> invoice + UPI payment
  -> prescription/instructions
  -> recall/lab/inventory/event/SOP tasks
```

The first production slice should make this daily loop measurably easier without requiring the clinic to abandon Practo, existing practice software, X-ray software, or WhatsApp on day one.
