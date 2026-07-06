# 03 - Domain Model and FHIR Mapping

**Date:** 2026-07-06

## 1. Data model philosophy

Build a canonical clinic data model optimized for day-to-day workflow, and map to FHIR R4 for interoperability. Do not force every internal operation into pure FHIR tables. The product needs fast operational queries, specialty-specific workflow objects, and human-friendly UI state. FHIR should be a standards-aligned exchange layer and a design constraint.

## 2. Core identifiers

| Identifier | Scope | Notes |
|---|---|---|
| `tenant_id` | Organization/customer | Required on all tenant-owned data. |
| `clinic_id` | Branch/location | A tenant may have multiple clinics. |
| `user_id` | Staff/user account | Doctor, assistant, receptionist, owner. |
| `patient_id` | Internal patient | Stable internal ID. |
| `abha_address` / `abha_number` | ABDM patient identity | Optional in the first production release; store only with consent and verification. |
| `hpr_id` | Provider identity | Doctor/provider registry reference where used. |
| `hfr_id` | Facility identity | Facility registry reference where used. |
| `external_source_id` | Integration-specific | Practo/Razorpay/WhatsApp/Google/etc. |

## 3. Core relational entities

### Tenancy and access

- `organizations`
- `clinics`
- `users`
- `roles`
- `permissions`
- `user_clinic_memberships`
- `auth_sessions`
- `mfa_factors`
- `api_keys`
- `integration_accounts`

### Patient registry

- `patients`
- `patient_contacts`
- `patient_identifiers`
- `patient_addresses`
- `patient_merge_candidates`
- `patient_consents`
- `patient_privacy_preferences`
- `patient_timeline_items`

### Scheduling and queue

- `appointment_types`
- `provider_schedules`
- `chairs_or_rooms`
- `appointments`
- `appointment_status_history`
- `queue_entries`
- `waitlist_entries`
- `no_show_risk_scores`

### Communication

- `communication_channels`
- `conversation_threads`
- `messages`
- `message_templates`
- `message_template_approvals`
- `message_delivery_attempts`
- `call_logs`
- `campaigns`
- `opt_in_records`
- `unsubscribes`

### Forms and consent

- `form_templates`
- `form_questions`
- `form_responses`
- `consent_templates`
- `signed_consents`
- `consent_revocations`

### Clinical encounter

- `encounters`
- `clinical_notes`
- `note_sections`
- `medical_history_items`
- `allergies`
- `conditions`
- `observations`
- `diagnoses`
- `procedures`
- `prescriptions`
- `prescription_items`
- `care_plans`
- `service_requests`
- `clinical_signatures`
- `clinical_amendments`

### Dental specialty

- `dental_charts`
- `dental_teeth`
- `dental_surfaces`
- `dental_findings`
- `dental_procedures`
- `perio_charts`
- `perio_measurements`
- `treatment_plans`
- `treatment_plan_items`
- `treatment_plan_versions`
- `estimate_items`
- `lab_cases`
- `lab_case_status_history`
- `dental_material_usage_defaults`

### Media and documents

- `media_assets`
- `media_asset_versions`
- `media_tags`
- `document_assets`
- `document_ocr_results`
- `dicom_studies`
- `imaging_links`
- `generated_documents`

### Billing and payments

- `pricebook_items`
- `invoices`
- `invoice_items`
- `payments`
- `payment_links`
- `refunds`
- `dues_followups`
- `accounting_exports`

### Inventory and vendors

- `inventory_items`
- `inventory_batches`
- `stock_movements`
- `instrument_register`
- `instrument_count_sessions`
- `vendors`
- `purchase_orders`
- `purchase_order_items`
- `vendor_invoices`

### Tasks, workflows, quality

- `tasks`
- `task_status_history`
- `workflow_rules`
- `workflow_runs`
- `recalls`
- `recall_attempts`
- `sop_templates`
- `sop_checklist_runs`
- `incidents`
- `incident_corrective_actions`

### AI

- `ai_jobs`
- `ai_job_inputs`
- `ai_outputs`
- `ai_output_reviews`
- `transcripts`
- `transcript_segments`
- `ai_prompt_versions`
- `ai_eval_results`

### Audit and compliance

- `audit_events`
- `access_logs`
- `data_exports`
- `retention_policies`
- `deletion_requests`
- `breach_incidents`

## 4. Patient timeline model

The patient timeline is a materialized view or query abstraction that aggregates:

- Appointments.
- Encounters.
- Clinical notes.
- Diagnoses/procedures.
- Prescriptions.
- Dental chart changes.
- Media/documents.
- Invoices/payments.
- Lab cases.
- Recalls/follow-ups.
- Communication milestones.

Use a `patient_timeline_items` projection for fast loading, backed by source domain tables.

## 5. Dental chart model

### Tooth numbering

Support FDI notation by default because it is common internationally and in Indian dental usage:

- Permanent teeth: 11-18, 21-28, 31-38, 41-48.
- Primary teeth: 51-55, 61-65, 71-75, 81-85.
- System must allow clinic setting for notation if needed.

### Dental finding fields

| Field | Example |
|---|---|
| `tooth_number` | `46` |
| `surface` | `distal`, `occlusal`, `buccal`, `lingual`, `mesial`, `cervical` |
| `finding_type` | `caries`, `cervical_erosion`, `restoration`, `crown`, `missing`, `mobility` |
| `severity` | mild/moderate/severe/custom |
| `status` | active, watch, treated, historical |
| `source` | manual, AI draft, imported, historical |
| `confidence` | numeric for AI drafts |
| `encounter_id` | visit link |
| `created_by` | user or AI job |
| `approved_by` | doctor/assistant where applicable |

### Treatment plan item fields

- Tooth/tooth range.
- Procedure code/name.
- Phase/stage.
- Estimated price.
- Priority.
- Consent required.
- Expected visits.
- Lab required.
- Inventory defaults.
- Status: proposed, accepted, scheduled, in-progress, completed, declined, deferred.

## 6. FHIR R4 mapping

| ClinicOS domain | FHIR R4 resource | Notes |
|---|---|---|
| Patient | `Patient` | Include identifiers, telecom, address, birth date, gender. |
| Doctor/user | `Practitioner`, `PractitionerRole` | Map HPR if available. |
| Clinic/tenant | `Organization`, `Location`, `HealthcareService` | Map HFR if available. |
| Appointment slots | `Schedule`, `Slot` | Provider/chair availability. |
| Appointment | `Appointment` | Patient, provider, status, reason. |
| Queue/walk-in | `Appointment` + extension or internal `queue_entry` | FHIR does not cover all queue nuances. |
| Encounter | `Encounter` | Visit context, participants, period, reason. |
| Intake form | `Questionnaire`, `QuestionnaireResponse` | Digital forms/history. |
| Consent | `Consent` | AI/audio/photo/treatment/data-sharing consent. |
| Medical history/allergy | `AllergyIntolerance`, `Condition` | Use structured codes where available. |
| Dental finding | `Observation` with dental extensions | Tooth/surface metadata likely needs extension. |
| Procedure | `Procedure` | Dental procedure performed. |
| Treatment plan | `CarePlan` | Use activities linked to procedures/service requests. |
| Prescription | `MedicationRequest` | Doctor-signed prescriptions. |
| Investigation/order | `ServiceRequest` | X-ray/lab request. |
| X-ray/report | `ImagingStudy`, `DiagnosticReport` | Imaging metadata and reports. |
| Photo/media | `Media` + `DocumentReference` | Intraoral photo, consented before/after images. |
| Uploaded document | `DocumentReference` | PDFs, old records, reports. |
| Invoice | `Invoice`, `ChargeItem` | Billing line items. |
| Payment notice | `PaymentNotice` | Payment event; internal payments remain richer. |
| Audit | `AuditEvent`, `Provenance` | Access/change trail and source of clinical data. |
| Task | `Task` | Follow-ups, lab case actions, staff tasks. |
| Communication | `Communication` | Patient messages, instructions, reminders. |
| Inventory request | `SupplyRequest`, `DeviceRequest` | Later-stage mapping for consumables/equipment. |

## 7. FHIR boundary design

### Internal write path

Users and integrations write to domain APIs, not directly to FHIR resources.

```text
UI/API command -> domain validation -> relational tables -> outbox -> FHIR projection/adapter
```

### External exchange path

```text
external FHIR/ABDM request -> FHIR adapter -> authorization/consent check -> domain query -> FHIR resource/bundle response
```

## 8. Audit and provenance model

Every important clinical and privacy action must create an audit event:

- User login/logout.
- Patient record viewed.
- Clinical note created/edited/signed/amended.
- Prescription signed/downloaded/shared.
- Media viewed/downloaded/shared.
- Consent created/revoked.
- Data export requested/completed.
- AI job run against patient data.
- Integration webhook changed patient/appointment/payment state.
- Admin changed role/permissions/security settings.

Audit event fields:

- `tenant_id`, `clinic_id`.
- `actor_type`: user, system, integration, ai.
- `actor_id`.
- `action`.
- `resource_type`, `resource_id`.
- `patient_id` if applicable.
- `timestamp`.
- `ip_address`, `user_agent`.
- `before_hash`, `after_hash` or metadata for sensitive changes.
- `reason_code` where available.

## 9. Data retention defaults

These are product defaults, not legal advice:

| Data | Suggested default |
|---|---|
| Clinical notes/prescriptions/invoices | Retain per clinic/legal policy; do not delete casually. |
| Raw audio | Delete after note sign-off or within short configurable window unless explicit retention consent. |
| Transcript | Retain as part of clinical provenance if clinic opts in; otherwise retain minimal source anchors. |
| WhatsApp messages | Retain operationally with privacy notice; allow export/deletion where legally appropriate. |
| Media/photos/X-rays | Retain as clinical record with consent and access controls. |
| Audit logs | Retain long enough for security/legal accountability; protect as sensitive. |
| AI prompts/outputs | Retain version and output for audit/evaluation; avoid storing unnecessary raw PHI in prompt logs. |

## 10. Data migration model

Importers should normalize data into staging tables first:

- `import_batches`
- `import_rows`
- `import_errors`
- `staged_patients`
- `staged_appointments`
- `staged_documents`
- `staged_invoices`

Workflow:

1. Upload CSV/export/images.
2. Parse and map columns.
3. Detect duplicates.
4. Show preview to clinic/admin.
5. Import into canonical tables.
6. Keep source provenance and rollback metadata.

## 11. Minimal schema outline

```sql
-- Illustrative only; final schema should be generated through migrations.
CREATE TABLE patients (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  clinic_id uuid,
  full_name text NOT NULL,
  phone text,
  email text,
  date_of_birth date,
  gender text,
  abha_address text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE encounters (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  clinic_id uuid NOT NULL,
  patient_id uuid NOT NULL REFERENCES patients(id),
  appointment_id uuid,
  provider_user_id uuid NOT NULL,
  status text NOT NULL,
  started_at timestamptz,
  ended_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE dental_findings (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  patient_id uuid NOT NULL REFERENCES patients(id),
  encounter_id uuid REFERENCES encounters(id),
  tooth_number text NOT NULL,
  surface text,
  finding_type text NOT NULL,
  severity text,
  status text NOT NULL DEFAULT 'active',
  source text NOT NULL DEFAULT 'manual',
  confidence numeric,
  approved_by uuid,
  created_at timestamptz NOT NULL
);
```


## 12. v0.2 domain additions: overlay, attribution, migration, and agent actions

The Plena/Practo revision requires several non-clinical domains to become first-class. These are necessary for overlay deployment, Practo coexistence, migration, source attribution, and safe AI automation.

### 12.1 External system and account model

```sql
external_systems (
  id uuid primary key,
  provider_key text not null, -- practo, google_business, whatsapp_meta, gupshup, razorpay, exotel, tally, imaging_vendor
  display_name text not null,
  category text not null, -- acquisition, messaging, payment, telephony, accounting, imaging, abd_m, pms
  capability_json jsonb not null default '{}',
  status text not null default 'configured',
  created_at timestamptz not null default now()
);

external_accounts (
  id uuid primary key,
  clinic_id uuid not null references clinics(id),
  external_system_id uuid not null references external_systems(id),
  external_account_ref text,
  auth_type text not null, -- oauth, api_key, webhook_only, manual, csv_import
  encrypted_credentials_ref text,
  source_of_truth_policy jsonb not null default '{}',
  status text not null default 'active',
  created_at timestamptz not null default now()
);
```

### 12.2 External entity links

These tables allow ClinicOS records to be linked to Practo, Google, WhatsApp, payment providers, telephony providers, imaging systems, and imported historical data.

```sql
external_entity_links (
  id uuid primary key,
  clinic_id uuid not null references clinics(id),
  entity_type text not null, -- patient, appointment, encounter, invoice, payment, document, lead, message
  entity_id uuid not null,
  external_system_id uuid not null references external_systems(id),
  external_ref text not null,
  external_url text,
  sync_status text not null default 'linked',
  last_synced_at timestamptz,
  metadata jsonb not null default '{}',
  unique (clinic_id, external_system_id, external_ref, entity_type)
);
```

### 12.3 Lead source and attribution model

```sql
leads (
  id uuid primary key,
  clinic_id uuid not null references clinics(id),
  patient_id uuid references patients(id),
  primary_contact text,
  status text not null, -- new, contacted, booked, lost, duplicate, spam
  intent text, -- appointment_request, pricing_query, followup, emergency, lab_vendor, unknown
  source text not null, -- practo, google, whatsapp, phone, website, instagram, referral, walkin, recall_campaign
  source_detail jsonb not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);

attribution_touches (
  id uuid primary key,
  clinic_id uuid not null references clinics(id),
  patient_id uuid references patients(id),
  lead_id uuid references leads(id),
  appointment_id uuid references appointments(id),
  invoice_id uuid references invoices(id),
  source text not null,
  medium text,
  campaign text,
  external_ref text,
  touch_type text not null, -- first_touch, booking_touch, revenue_touch, recall_touch
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}'
);
```

### 12.4 Migration model

```sql
migration_batches (
  id uuid primary key,
  clinic_id uuid not null references clinics(id),
  source_system text not null,
  import_type text not null, -- patients, appointments, notes, invoices, media, mixed
  status text not null, -- uploaded, parsing, review_required, imported, failed, rolled_back
  uploaded_by uuid references users(id),
  source_file_ref text,
  summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

migration_rows (
  id uuid primary key,
  batch_id uuid not null references migration_batches(id),
  row_number int not null,
  raw_payload jsonb not null,
  normalized_payload jsonb,
  match_status text not null, -- unmatched, matched, duplicate, conflict, imported, rejected
  target_entity_type text,
  target_entity_id uuid,
  errors jsonb not null default '[]',
  created_at timestamptz not null default now()
);
```

### 12.5 Workflow primitives

```sql
workflow_definitions (
  id uuid primary key,
  clinic_id uuid references clinics(id),
  name text not null,
  trigger_type text not null, -- event, schedule, webhook, manual
  trigger_config jsonb not null,
  condition_config jsonb not null default '{}',
  action_config jsonb not null,
  approval_policy jsonb not null default '{}',
  enabled boolean not null default true,
  version int not null default 1
);

workflow_runs (
  id uuid primary key,
  workflow_definition_id uuid references workflow_definitions(id),
  clinic_id uuid not null references clinics(id),
  triggering_event_id uuid,
  status text not null, -- pending, running, waiting_approval, completed, failed, cancelled
  context jsonb not null default '{}',
  started_at timestamptz not null default now(),
  completed_at timestamptz
);
```

### 12.6 Action proposals and approvals

```sql
action_proposals (
  id uuid primary key,
  clinic_id uuid not null references clinics(id),
  proposed_by_type text not null, -- ai_agent, workflow, user
  proposed_by_ref text,
  action_type text not null, -- send_message, create_appointment, update_chart, create_invoice, create_payment_link, create_lab_case
  target_entity_type text,
  target_entity_id uuid,
  payload jsonb not null,
  risk_level text not null, -- low, medium, high, clinical
  status text not null, -- proposed, approved, rejected, executed, failed, expired
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now()
);

approval_decisions (
  id uuid primary key,
  action_proposal_id uuid not null references action_proposals(id),
  approver_user_id uuid not null references users(id),
  decision text not null, -- approved, rejected, edited_then_approved
  edited_payload jsonb,
  reason text,
  decided_at timestamptz not null default now()
);
```

### 12.7 FHIR mapping implication

Most v0.2 objects are not FHIR-native because they describe operational workflow and acquisition attribution. Map only clinically relevant outputs to FHIR:

| ClinicOS object | FHIR posture |
|---|---|
| Patient | Patient |
| Appointment | Appointment |
| Encounter | Encounter |
| Clinical note/document | DocumentReference / Composition |
| Dental finding | Observation / Condition / Procedure extension/profile |
| Prescription | MedicationRequest |
| Consent | Consent |
| Media/X-ray | Media / ImagingStudy / DocumentReference |
| Audit event | AuditEvent |
| Invoice/payment | Invoice / PaymentNotice where useful |
| Lead/source attribution | Internal only, no FHIR mapping unless needed for audit/provenance |
| Workflow run/action proposal | Internal only; may create AuditEvent for sensitive actions |
