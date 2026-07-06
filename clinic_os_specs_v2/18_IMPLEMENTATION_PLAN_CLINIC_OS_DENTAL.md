# 18 - Implementation Plan: Clinic OS and Dental Product

**Date:** 2026-07-06  
**Status:** Execution plan  
**Primary owner:** Product/full-stack clinic workflow agent  
**Companion docs:** `01_PRD.md`, `03_DOMAIN_MODEL_AND_FHIR_MAPPING.md`, `08_USER_STORIES_AND_ACCEPTANCE_CRITERIA.md`, `09_API_CONTRACTS_AND_EVENTS.md`, `15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md`

## 1. Mission

Build the production-grade ClinicOS dental operating workflow: the system a dental clinic can use every day for assistant coordination, doctor encounters, checkout, recalls, lab work, inventory, event management, and owner visibility.

This plan is not a UI-only plan. It covers product behavior, domain modules, state transitions, API needs, permissions, events, and acceptance criteria.

## 2. Required Reading

Before implementation, read:

1. `../AGENTS.md`
2. `16_DOCUMENTATION_STRUCTURE_AND_IMPLEMENTATION_INDEX.md`
3. `20_ORCHESTRATION_CHECKPOINT_PLAN.md`
4. `18_IMPLEMENTATION_PLAN_CLINIC_OS_DENTAL.md`
5. `01_PRD.md`
6. `15_PILOT_FIELD_NOTE_DENTAL_WORKFLOW.md`
7. `08_USER_STORIES_AND_ACCEPTANCE_CRITERIA.md`
8. `03_DOMAIN_MODEL_AND_FHIR_MAPPING.md`
9. `09_API_CONTRACTS_AND_EVENTS.md`

## 3. Product North Star

The clinic should feel that ClinicOS runs the real day:

```text
assistant opens clinic day
  -> messages/missed calls/follow-ups are visible
  -> appointments and queue are prepared
  -> new/returning patients are routed
  -> doctor has context before patient enters
  -> charting, media, diagnosis, treatment plan, and notes are captured
  -> checkout creates invoice/payment/prescription/instructions
  -> recall/lab/inventory/SOP/event tasks continue automatically
  -> owner sees leakage and revenue by source
```

## 4. Product Principles

- Build for the assistant, doctor, receptionist, and owner together.
- Treat WhatsApp as the front channel, but make ClinicOS the structured operating layer.
- Keep the doctor responsible for clinical sign-off.
- Make returning-patient context instant.
- Make new-patient intake flexible enough for digital forms and assistant-entered paper history cards.
- Make dental charting structured, fast, and clinically reviewable.
- Tie billing to treatment performed.
- Tie recalls, instructions, lab, and inventory to clinical events.
- Make every important state transition visible in the patient timeline.

## 5. Roles and Permissions

Implement role-aware UX and API checks.

| Role | Product capabilities |
|---|---|
| Owner | Clinic setup, users/roles, pricebook, dashboards, exports, audit review, configuration. |
| Doctor | Patient context, encounter, dental chart, diagnosis, treatment plan, prescriptions, clinical sign-off, media review. |
| Assistant | Morning dashboard, inbox triage, patient creation, appointment confirmations, intake, chart co-entry, media capture/upload, lab, inventory, SOP tasks. |
| Receptionist | Appointments, queue/check-in, demographics, billing, payments, receipts, non-clinical communications. |
| Accountant | Billing/payment exports and reconciliation, without default clinical access. |
| Platform admin | Operational support only with audited break-glass controls. |

Acceptance:

- UI navigation hides inaccessible areas.
- API denies unauthorized actions.
- Sensitive views create audit events.
- Doctor-only clinical sign-off cannot be performed by assistant/receptionist.

## 6. Product Surface Map

Build these web surfaces:

- Assistant morning dashboard.
- Lead/booking inbox view.
- Appointment calendar and queue board.
- Patient profile and timeline.
- New-patient intake/history entry.
- Returning-patient prep summary.
- Doctor encounter workspace.
- Dental chart/odontogram workspace.
- Media gallery and comparison view.
- Treatment plan and estimate builder.
- Checkout workspace.
- Prescription and instruction workspace.
- Recall and follow-up workbench.
- Lab case board.
- Inventory and SOP workbench.
- Event-management diary.
- Owner control room.
- Settings and templates.

Do not make a marketing landing page. The first screen after login should be a useful operating surface.

## 7. Domain Modules Owned By This Plan

Work with platform/integration agents on shared tables, but this plan owns product behavior for:

- Patients.
- Contacts and identifiers.
- Patient timeline.
- Appointments.
- Queue.
- Intake forms.
- Consent records.
- Encounters.
- Clinical notes.
- Prescriptions.
- Dental chart.
- Dental findings.
- Treatment plans.
- Estimates.
- Procedure performed records.
- Pricebook.
- Invoices.
- Instructions.
- Recalls.
- Tasks.
- Lab cases.
- Inventory items/checklists.
- SOP templates/runs.
- Event/incident diary.
- Owner analytics projections.

## 8. Slice 1: Assistant Day Start and Lead To Appointment

### 8.1 User Story

As an assistant, I can start the clinic day and see:

- Today's appointments.
- Unconfirmed appointments.
- WhatsApp/phone/manual leads.
- Missed-call tasks.
- Follow-ups due.
- Six-month recall candidates.
- Pending payments.
- Pending lab cases.
- SOP tasks due today.

### 8.2 Build

Backend:

- `patients`
- `patient_contacts`
- `appointments`
- `appointment_types`
- `provider_schedules`
- `queue_entries`
- `leads`
- `attribution_touches`
- `tasks`
- `recall_candidates` or recall query projection
- dashboard query/read model

Frontend:

- Morning dashboard.
- Quick patient create.
- Lead-to-patient match.
- Lead-to-appointment booking.
- Confirmation status controls.
- Queue/check-in controls.

Events:

- `lead.created`
- `lead.matched_to_patient`
- `patient.created`
- `appointment.created`
- `appointment.confirmation_requested`
- `appointment.confirmed`
- `patient.checked_in`
- `queue.entry_created`

Acceptance:

- Assistant can create a patient from phone/WhatsApp/manual source.
- Assistant can book an appointment with source attribution.
- Assistant can confirm appointment manually.
- Today's dashboard updates after appointment/check-in changes.
- Returning and new patients are visibly distinguished.
- All lead/appointment actions are tenant scoped and audited where sensitive.

## 9. Slice 2: Patient Profile, Timeline, Intake, and Consent

### 9.1 User Story

As clinic staff, I can open a patient profile and understand the patient's history, upcoming appointments, media, notes, invoices, recalls, lab cases, and tasks.

As an assistant, I can capture new patient intake digitally or enter data from a paper history card.

### 9.2 Build

Backend:

- Patient profile aggregate.
- Duplicate detection by phone/name/email.
- Form templates.
- Form responses.
- Consent records.
- Patient timeline projection.
- Patient merge flow with review.

Frontend:

- Patient profile.
- Timeline tabs/filters.
- Intake form fill.
- Assistant paper-card entry mode.
- Consent capture/revoke.
- Duplicate warning UI.

Consent types:

- Treatment consent.
- Photo/X-ray storage consent.
- WhatsApp communication consent.
- AI/audio capture consent.
- ABDM/ABHA consent later.

Events:

- `patient.updated`
- `patient.duplicate_detected`
- `form_response.submitted`
- `consent.created`
- `consent.revoked`
- `patient.timeline_item.created`

Acceptance:

- New-patient intake can be completed before encounter.
- Returning patient profile loads previous visits and media.
- Consent is required before AI/audio capture is enabled.
- Consent revocation stops future applicable processing.
- Timeline displays records in chronological order.
- Patient export path is compatible with compliance plan.

## 10. Slice 3: Encounter and Doctor Prep

### 10.1 User Story

As a doctor, before a patient enters, I can see:

- Visit reason.
- New or returning status.
- Prior visits and procedures.
- Prior X-rays/photos.
- Medical history changes.
- Open treatment plans.
- Pending dues.
- Pending lab cases.
- Recall context.

During the visit, I can start an encounter, record observations, diagnosis, investigations, treatment plan, treatment performed, prescriptions, and sign the clinical note.

### 10.2 Build

Backend:

- Encounter lifecycle.
- Clinical note draft/sign/amend model.
- Medical history snapshot.
- Diagnosis and observations fields.
- Investigation references.
- Prescription records and signing.
- Doctor sign-off workflow.

Frontend:

- Doctor prep summary.
- Encounter workspace.
- Note sections: history, examination, investigations, diagnosis, treatment plan, treatment performed.
- Sign note action.
- Amend signed note with reason.
- Prescription builder.

States:

- `scheduled`
- `checked_in`
- `encounter_started`
- `drafting`
- `ready_for_sign`
- `signed`
- `amended`
- `closed`

Events:

- `encounter.started`
- `clinical_note.drafted`
- `clinical_note.signed`
- `clinical_note.amended`
- `prescription.created`
- `prescription.signed`

Acceptance:

- Encounter can be started from queue or patient profile.
- Signed notes cannot be silently edited.
- Amendments require reason and preserve prior version.
- Doctor-only actions are enforced.
- Patient timeline reflects encounter and signed note.
- Sensitive views/actions are audited.

## 11. Slice 4: Dental Chart and Media

### 11.1 User Story

As a doctor or assistant, I can chart tooth-by-tooth findings quickly while preserving clinical structure.

As clinic staff, I can attach intraoral photos, X-rays, PDFs, and documents to the patient, encounter, tooth, or treatment plan.

### 11.2 Build

Backend:

- Tooth numbering configuration.
- Dental chart aggregate.
- Dental findings.
- Finding status/history.
- Procedure history.
- Perio basics if included in first slice.
- Media metadata.
- Media tags and references.

Frontend:

- Odontogram.
- Tooth detail drawer/panel.
- Finding add/edit form.
- Procedure history view.
- Media upload/gallery.
- Side-by-side comparison view.
- Attach media to tooth/encounter/finding.

Finding examples:

- Caries.
- Cervical erosion.
- Restoration.
- Missing tooth.
- RCT.
- Crown.
- Mobility.
- Periodontal note.
- Watch item.

Media tags:

- Intraoral photo.
- X-ray.
- Document.
- Consent form.
- Prescription.
- Lab file.
- Before/after.

Events:

- `dental_finding.created`
- `dental_finding.updated`
- `dental_chart.snapshot_created`
- `media.created`
- `media.linked`
- `media.viewed`

Acceptance:

- Doctor/assistant can add findings by tooth number.
- Dental chart history is visible.
- Media can be uploaded and attached to patient/encounter/tooth.
- Media access uses signed URLs and is audited.
- X-ray software coexistence is supported through upload/import/link, not forced replacement.

## 12. Slice 5: Treatment Plan, Estimate, and Checkout

### 12.1 User Story

As a doctor, I can create a phased treatment plan and estimate.

As reception/assistant, I can generate invoice from treatment performed, request payment, record payment, print/send receipt, and trigger instructions/recall.

### 12.2 Build

Backend:

- Pricebook.
- Procedure catalog.
- Treatment plans.
- Treatment phases.
- Estimate items.
- Treatment acceptance status.
- Procedure performed records.
- Invoices.
- Invoice items.
- Payment state.
- Receipts.

Frontend:

- Treatment plan builder.
- Estimate preview.
- Patient acceptance status.
- Checkout workspace.
- Invoice creation from procedures.
- Payment state display.
- Receipt print/send.

Payment states:

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

Events:

- `treatment_plan.created`
- `treatment_plan.accepted`
- `procedure.completed`
- `invoice.created`
- `payment.requested`
- `payment.succeeded`
- `receipt.generated`

Acceptance:

- Invoice can be generated from completed procedures.
- Manual payment recording is available with audit.
- Payment provider integration can attach verified provider states.
- Payment status cannot be marked paid from unverified provider data.
- Checkout can create recall/instruction tasks.
- Patient timeline shows treatment plan, invoice, payment, and receipt.

## 13. Slice 6: Prescriptions and Instructions

### 13.1 User Story

As a doctor, I can create and sign prescriptions.

As clinic staff, I can print or send approved post-op/product/lifestyle instructions over WhatsApp or another configured channel.

### 13.2 Build

Backend:

- Prescription templates.
- Medication catalog fields.
- Signed prescription records.
- Instruction templates.
- Instruction delivery requests.
- Product recommendation fields.

Frontend:

- Prescription builder.
- Sign/print prescription.
- Instruction template picker.
- Print instruction.
- Send instruction request to communication provider.

Instruction examples:

- Fluoride varnish post-op.
- Interdental brush recommendation.
- Dietary restriction.
- Post-extraction care.
- Scaling follow-up.
- RCT post-op.
- Crown/bridge care.

Events:

- `prescription.signed`
- `instruction.generated`
- `instruction.sent`
- `recall.created`

Acceptance:

- Prescriptions require doctor sign-off.
- Instructions can be printed or sent.
- Sent instructions are attached to timeline.
- WhatsApp send uses provider abstraction and records delivery status when available.

## 14. Slice 7: Recalls, Follow-Ups, Tasks, and SOPs

### 14.1 User Story

As an assistant, I can see due recalls, post-op follow-ups, payment follow-ups, lab follow-ups, and recurring clinic protocol tasks.

### 14.2 Build

Backend:

- Task model.
- Task assignment.
- Recall rules.
- Recall due generation via Temporal.
- Post-op follow-up templates.
- SOP templates.
- SOP recurring schedules.
- SOP run/completion records.

Frontend:

- Task workbench.
- Recall queue.
- Follow-up status.
- SOP checklist view.
- Recurring protocol calendar.

Recurring protocol examples:

- Charge curing light every 10 days.
- Check switches weekly.
- Monthly drawer-by-drawer inventory.
- Follow up patient after procedure.
- Review unpaid invoices.

Events:

- `task.created`
- `task.completed`
- `recall.due`
- `recall.sent`
- `sop_run.created`
- `sop_run.completed`

Acceptance:

- Six-month recall rule can be configured by procedure/clinic.
- Recall task can create appointment when patient replies.
- SOP tasks recur on schedule.
- Overdue tasks are visible.
- All task state changes are auditable.

## 15. Slice 8: Lab Cases

### 15.1 User Story

As an assistant, I can create a lab case when an impression/lab work is required, generate a lab slip/card, track status, and reconcile month-end lab invoices.

### 15.2 Build

Backend:

- Lab vendors.
- Lab cases.
- Lab case items.
- Lab slip generation.
- Lab status history.
- Lab invoice reconciliation model.

Frontend:

- Lab case create from treatment plan/encounter.
- Printable/shareable lab slip.
- Lab board by status/due date.
- Month-end reconciliation view.

Statuses:

- `draft`
- `ready_for_pickup`
- `sent_to_lab`
- `received_by_lab`
- `due`
- `returned`
- `fitted`
- `completed`
- `cancelled`
- `rework_required`

Events:

- `lab_case.created`
- `lab_case.sent`
- `lab_case.returned`
- `lab_case.completed`
- `lab_reconciliation.created`

Acceptance:

- Lab case includes patient, procedure, tooth, shade/material, due date, lab, notes.
- Lab slip can be printed or shared.
- Due/overdue cases appear in assistant dashboard.
- Month-end reconciliation lists sent/completed cases and expected lab payments.

## 16. Slice 9: Inventory, Instruments, and Event Management

### 16.1 User Story

As an assistant, I can run drawer-by-drawer inventory checks and record material/instrument issues.

As a clinic owner, I can record operational mistakes/events, learnings, and corrective actions.

### 16.2 Build

Backend:

- Inventory items.
- Inventory categories: material, instrument, equipment.
- Stock ledger.
- Inventory check templates.
- Inventory check runs.
- Reorder suggestions.
- Incident/event records.
- Corrective/preventive action records.

Frontend:

- Inventory list.
- Monthly checklist runner.
- Drawer-by-drawer check UI.
- Procurement list.
- Event-management diary.
- Corrective action tracker.

Event examples:

- Missed appointment.
- Wrong impression taken.
- Light/switch left on.
- Missing instrument.
- Stockout.
- Lab delay.
- Payment not collected.

Events:

- `inventory_check.created`
- `inventory_check.completed`
- `inventory.low_stock_detected`
- `incident.created`
- `corrective_action.created`
- `corrective_action.completed`

Acceptance:

- Inventory checks can be completed in a defined sequence.
- Missing item/material shortage creates a task or procurement item.
- Event diary records category, description, impact, learning, corrective action.
- Corrective actions can be assigned and tracked.

## 17. Slice 10: Owner Control Room and Analytics

### 17.1 User Story

As an owner, I can see where time, revenue, patients, recalls, treatment plans, lab work, inventory, and source channels are leaking.

### 17.2 Build

Backend:

- Analytics read models/materialized queries.
- Source-attributed revenue projection.
- Recall performance projection.
- Treatment plan status projection.
- No-show projection.
- Lab/inventory/task exceptions.

Frontend:

- Owner dashboard.
- Revenue by source.
- No-show by source.
- Recall conversion.
- Treatment plan acceptance.
- Dues and payment aging.
- Lab cases overdue.
- Inventory/action exceptions.
- Staff task load.

Metrics:

- Appointments scheduled/completed/no-show.
- New patients by source.
- Revenue by source.
- Payment collected/outstanding.
- Treatment plan acceptance.
- Recall due/contacted/booked/completed.
- Average documentation completion time.
- Lab cases overdue.
- Inventory stockouts.
- Event/CAPA counts.

Acceptance:

- Dashboard uses real domain data, not static cards.
- Source attribution flows from lead to appointment to invoice/revenue.
- Owner can filter by date, provider, source, and clinic where applicable.
- Metrics exclude data the user is not allowed to see.

## 18. UI Quality Bar

Follow these UI standards:

- Build operational screens, not marketing pages.
- Keep dashboards dense but readable.
- Use role-specific navigation.
- Use tables/lists for operational queues.
- Use clear state labels and filters.
- Use compact modals/drawers for quick actions.
- Use empty, loading, error, and offline states.
- Never use decorative cards inside cards.
- Do not explain features with in-app marketing copy.
- Use icons for common actions where helpful.
- Ensure text fits on mobile and desktop.

Critical responsive surfaces:

- Assistant dashboard.
- Queue board.
- Patient profile.
- Encounter workspace.
- Dental chart.
- Checkout.
- Task/SOP workbench.

## 19. Product Acceptance Test Set

Build E2E tests for:

1. Create patient from WhatsApp/manual lead.
2. Book appointment and confirm it.
3. Check in patient and start encounter.
4. Complete new patient intake.
5. Add dental finding and upload media.
6. Create treatment plan and invoice.
7. Record/manual or provider-confirmed payment.
8. Generate prescription/instruction.
9. Create six-month recall.
10. Create lab case and mark returned.
11. Complete monthly inventory check.
12. Log event and corrective action.
13. View owner dashboard.

Security tests:

- Assistant cannot sign clinical note.
- Accountant cannot view clinical media by default.
- Tenant A cannot view tenant B patient.
- Signed note cannot be overwritten.

## 20. Dependency Notes

Depends on Workstream A for:

- Auth/session.
- Tenant and clinic guards.
- Database migrations.
- Audit helper.
- Outbox/events.
- Object storage.
- Temporal workflow primitives.
- OpenAPI conventions.

Depends on Workstream C for:

- WhatsApp send/delivery provider.
- Payment QR/link provider.
- Mobile capture upload.
- AI draft generation.
- Imaging import/coexistence.

Build product flows against provider interfaces before live providers are enabled.

## 21. Done Criteria For Clinic Product Release

The clinic product slice is release-ready when:

- A real clinic day can run from morning dashboard to checkout and follow-up.
- Returning patient context is fast enough for chairside use.
- New-patient intake supports digital and assistant-entry paths.
- Dental charting works for tooth-level findings.
- Media is attached to patient/encounter/tooth.
- Treatment plan, invoice, payment state, prescription, instruction, and recall connect in one workflow.
- Lab, inventory, event, and SOP workflows are usable enough to replace diaries for new operations.
- Owner dashboard uses live operational data.
- Role permissions and audit logs are verified.
- E2E tests cover the main clinic loop.
