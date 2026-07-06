# 08 - User Stories and Acceptance Criteria

**Date:** 2026-07-06

## Epic 1 - Tenant, clinic, users, permissions

### Story 1.1 - Create clinic account
As an owner, I can create an organization and clinic profile so that the system is configured for my practice.

Acceptance criteria:
- Owner can set clinic name, address, phone, email, working hours, timezone, logo.
- Owner can add doctor/assistant/receptionist users.
- Each user has a role and clinic access.
- Audit event is recorded for user creation and role changes.

### Story 1.2 - Role-based access
As an owner, I can restrict staff access so that assistants and receptionists only see what they need.

Acceptance criteria:
- Receptionist cannot sign prescriptions.
- Assistant cannot finalize diagnosis or prescription.
- Accountant cannot view clinical notes/media by default.
- Unauthorized API calls return 403.
- Tenant isolation tests pass.

## Epic 2 - Patient registry

### Story 2.1 - Create patient
As an assistant, I can create a patient quickly from phone/WhatsApp so that appointments and records are linked.

Acceptance criteria:
- Required fields: name and phone, or configured minimum.
- Duplicate suggestions appear if phone/name matches existing patient.
- Patient timeline is created.
- Source is recorded: WhatsApp/call/walk-in/Practo/Google/referral/manual.

### Story 2.2 - Patient timeline
As a doctor, I can open a patient timeline so that I understand prior visits before the patient enters.

Acceptance criteria:
- Timeline shows visits, notes, prescriptions, images, dental findings, invoices, recalls, lab cases.
- Timeline loads within acceptable latency for typical patient history.
- Sensitive media access is audited.

## Epic 3 - Appointments and queue

### Story 3.1 - Book appointment
As an assistant, I can book an appointment with provider, type, duration, and chair/room.

Acceptance criteria:
- Conflict detection prevents double booking unless override permission.
- Appointment status: requested, booked, confirmed, checked_in, in_consult, completed, cancelled, no_show.
- Confirmation task/message is created.

### Story 3.2 - Morning dashboard
As an assistant, I can see today's appointments and pending confirmations.

Acceptance criteria:
- Dashboard lists confirmed/unconfirmed/reschedule/cancelled/no-show risk.
- One-click confirm message draft exists.
- Missed calls and WhatsApp appointment requests appear as tasks.

### Story 3.3 - Check-in and queue
As a receptionist, I can check in a patient and place them in queue.

Acceptance criteria:
- Queue updates in real time.
- Doctor sees patient waiting.
- New/returning patient status is visible.

## Epic 4 - Communication inbox

### Story 4.1 - Inbound WhatsApp message
As an assistant, I can see inbound WhatsApp messages in the clinic inbox.

Acceptance criteria:
- Raw webhook is stored.
- Message is normalized and attached to patient if matched.
- Unmatched messages create lead candidates.
- Delivery/read status is displayed where available.

### Story 4.2 - Send approved template
As an assistant, I can send appointment confirmation and recall messages.

Acceptance criteria:
- Message uses approved template.
- Opt-in status is checked.
- Send status and errors are visible.
- Message is attached to patient timeline.

## Epic 5 - Forms and consent

### Story 5.1 - New patient intake
As a new patient, I can fill medical/dental history before consultation.

Acceptance criteria:
- Form link can be sent by WhatsApp/SMS.
- Response is linked to patient.
- Doctor can review before encounter.
- Changes to medical history are highlighted.

### Story 5.2 - AI/audio consent
As staff, I can record patient consent before AI scribe starts.

Acceptance criteria:
- AI capture button disabled until consent is recorded.
- Consent text version is stored.
- Revocation stops future AI capture.
- Audit event is created.

## Epic 6 - Encounter and notes

### Story 6.1 - Start encounter
As a doctor, I can start an encounter from appointment or patient profile.

Acceptance criteria:
- Encounter status changes to in_progress.
- Prior patient summary is visible.
- Note template can be selected.

### Story 6.2 - Sign clinical note
As a doctor, I can review and sign the clinical note.

Acceptance criteria:
- Signed note is locked from silent edits.
- Amendments require reason and create version history.
- Signed note appears on patient timeline.
- Prescription and invoice handoff remain linked to encounter.

## Epic 7 - Dental charting

### Story 7.1 - Add dental finding
As a doctor/assistant, I can add tooth-level findings to the odontogram.

Acceptance criteria:
- Supports FDI tooth numbers.
- Supports surface/finding/severity/status.
- Findings are linked to encounter.
- Historical and active findings are distinguishable.

### Story 7.2 - Dental chart patch review
As a doctor/assistant, I can review AI-suggested dental chart changes.

Acceptance criteria:
- AI suggestions show confidence and source segment.
- User can accept/edit/reject each finding.
- Accepted items become chart entries with source = AI approved.
- Rejected items are retained for evaluation but not clinical chart.

## Epic 8 - Media and documents

### Story 8.1 - Upload intraoral photo/X-ray
As an assistant, I can upload or capture a patient photo/X-ray and tag it.

Acceptance criteria:
- File is stored privately.
- Metadata includes patient, encounter, tooth/body area where applicable.
- Thumbnail generated.
- Access audited.

### Story 8.2 - Compare images
As a doctor, I can compare current and previous images.

Acceptance criteria:
- Side-by-side view available.
- Images can be filtered by tooth/date/type.
- Full-resolution access is permission controlled.

## Epic 9 - Treatment plans and estimates

### Story 9.1 - Create treatment plan
As a doctor, I can create a phased treatment plan linked to dental findings.

Acceptance criteria:
- Plan contains phases, procedures, teeth, price, visits, priority.
- Estimate can be shown/printed/shared.
- Patient acceptance/decline/defer status is tracked.

### Story 9.2 - Follow up abandoned plan
As an assistant, I can follow up patients with pending treatment plans.

Acceptance criteria:
- Pending plan task is created after configured time.
- Message template references approved patient-friendly explanation.
- Conversion is tracked in analytics.

## Epic 10 - Billing and payments

### Story 10.1 - Generate invoice
As a receptionist, I can generate an invoice from approved procedures.

Acceptance criteria:
- Invoice items map to pricebook.
- Discounts require permission if configured.
- Payment due is visible.
- Invoice appears on timeline.

### Story 10.2 - Payment link
As a receptionist, I can send a payment link.

Acceptance criteria:
- Payment link is created through provider API.
- Provider callback signature is verified before marking paid.
- Payment status updates invoice.
- Receipt can be sent/printed.

## Epic 11 - Recall and follow-up

### Story 11.1 - Six-month recall
As an assistant, I can see patients due for preventive recall.

Acceptance criteria:
- Recall rule can be configured by procedure/clinic.
- Due patients appear in task list.
- Recall messages are tracked by attempt/outcome.
- Appointment booked from recall is source-attributed.

### Story 11.2 - Post-op instruction
As a doctor, I can send procedure-specific instructions after treatment.

Acceptance criteria:
- Uses approved template.
- Doctor/assistant can edit where allowed.
- Sent instructions appear on timeline.

## Epic 12 - Lab cases

### Story 12.1 - Create lab case
As an assistant, I can create a lab case from an impression/treatment plan.

Acceptance criteria:
- Lab case includes patient, procedure, tooth, shade/material, due date, lab, notes.
- Printable/shareable lab slip exists.
- Status tracking works.
- Month-end reconciliation report includes case.

## Epic 13 - Inventory and SOP

### Story 13.1 - Monthly inventory check
As an assistant, I can complete a drawer-by-drawer inventory checklist.

Acceptance criteria:
- Checklist template is configurable.
- Missing/low/expired items create tasks.
- Reorder list is generated.
- Completion is audited.

### Story 13.2 - Recurring protocol task
As an assistant, I receive recurring tasks like curing light charging or switch checks.

Acceptance criteria:
- SOP schedule supports daily/weekly/10-day/monthly intervals.
- Missed SOPs are visible to owner.
- Completion requires timestamp and user.

## Epic 14 - Quality/event diary

### Story 14.1 - Log event
As a staff member, I can log an event/near miss/mistake.

Acceptance criteria:
- Event category, description, impact, learning, corrective action captured.
- Owner can review and close.
- Recurring issues appear in analytics.

## Epic 15 - AI scribe

### Story 15.1 - Generate note draft
As a doctor, I can generate a note draft from consultation audio.

Acceptance criteria:
- Consent required.
- Transcript generated with timestamps.
- Structured note draft created.
- Doctor can accept/edit/reject.
- Final note requires sign-off.

### Story 15.2 - AI safety warnings
As a doctor, I can see AI uncertainty and warnings.

Acceptance criteria:
- Low-confidence fields are highlighted.
- Unsupported assertions are flagged.
- Medication/allergy concerns are shown before prescription sign-off.

## Epic 16 - Analytics

### Story 16.1 - Owner dashboard
As an owner, I can see clinic KPIs.

Acceptance criteria:
- Shows appointments, no-shows, revenue, dues, recalls, treatment plans, lead source, lab cases.
- Filters by date/provider/source.
- Data matches operational records.

## Epic 17 - Data export and compliance

### Story 17.1 - Export patient record
As an authorized user, I can export a patient record.

Acceptance criteria:
- Export includes configured clinical records, prescriptions, invoices, media list.
- Export is audited.
- Role/consent checks enforced.

### Story 17.2 - Audit review
As an owner/compliance user, I can review audit events.

Acceptance criteria:
- Filter by patient, user, action, date.
- Sensitive events are visible.
- Audit logs cannot be edited by normal users.


## 11. v0.2 additional user stories: Practo/source overlay and replacement migration

### 11.1 Capture a Practo-originated booking

**As an assistant**, I want to record or import a Practo-originated booking into ClinicOS so that the clinic can run the visit inside ClinicOS while still knowing Practo was the source.

Acceptance criteria:

- User can choose source = Practo when creating a lead/appointment.
- System stores external reference if available.
- Patient is matched or created.
- Appointment appears in ClinicOS queue/calendar.
- Owner dashboard attributes resulting revenue/no-show to Practo.

### 11.2 Run Ray replacement mode for new operations

**As a clinic owner**, I want ClinicOS to become the source of truth for all new appointments and visits while older records remain imported/read-only until verified.

Acceptance criteria:

- Clinic can configure source-of-truth policy by domain.
- New appointments/encounters/invoices default to ClinicOS primary.
- Historical imported records are marked imported/unverified.
- Staff can search historical imported data without mixing it into signed new records accidentally.

### 11.3 Review migration conflicts

**As an admin**, I want to review duplicate/conflicting imported patient rows before merging them.

Acceptance criteria:

- Migration batch shows total rows, matched rows, conflicts, errors.
- User can merge, reject, or create new patient.
- Raw imported row remains preserved.
- Audit log records the merge/reject decision.

### 11.4 Lead inbox source attribution

**As a clinic owner**, I want every lead and booked appointment to carry source attribution so that I can know which channels actually generate revenue.

Acceptance criteria:

- Lead source can be WhatsApp, phone, Practo, Google, website, Instagram, referral, walk-in, recall campaign.
- Source follows the patient into appointment and invoice.
- Dashboard reports revenue, booking conversion, and no-shows by source.

### 11.5 Agent action proposal approval

**As an assistant**, I want AI to draft messages and tasks but not send sensitive items without approval.

Acceptance criteria:

- AI-generated message appears as an action proposal.
- Assistant can approve, edit then approve, or reject.
- Approved action executes through the relevant adapter.
- Proposal, edit, approval, and execution are audit logged.

### 11.6 Clinic-specific workflow primitive

**As a clinic admin**, I want to configure a rule such as “after fluoride varnish, send post-op instructions and schedule six-month recall” without custom code.

Acceptance criteria:

- Admin can select trigger: procedure completed.
- Admin can select condition: procedure = fluoride varnish.
- Admin can select actions: send instruction template, create recall.
- Admin can select approval policy.
- Workflow run is visible in patient timeline.
