-- Checkpoint 3: intake, consent, encounters, clinical note versions, and prescriptions.
-- Applies after 0002_lead_patient_appointment_day_start.sql on PostgreSQL 16+.

alter table patient_timeline_items drop constraint if exists patient_timeline_items_item_type_check;
alter table patient_timeline_items
  add constraint patient_timeline_items_item_type_check check (
    item_type in (
      'patient_created',
      'attribution_touch_created',
      'lead_created',
      'lead_matched',
      'appointment_created',
      'appointment_confirmed',
      'patient_checked_in',
      'queue_entry_created',
      'appointment_no_show',
      'task_created',
      'form_response_submitted',
      'consent_created',
      'consent_revoked',
      'encounter_created',
      'encounter_started',
      'encounter_completed',
      'clinical_note_draft_created',
      'clinical_note_signed',
      'clinical_note_amended',
      'prescription_draft_created',
      'prescription_signed'
    )
  );

create table if not exists form_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  code text not null,
  display_name text not null,
  form_type text not null check (form_type in ('patient_intake', 'medical_history', 'consent_capture')),
  version integer not null check (version > 0),
  schema jsonb not null default '{}',
  active boolean not null default true,
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, clinic_id, code, version),
  unique (tenant_id, id),
  constraint form_templates_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create trigger form_templates_set_updated_at
before update on form_templates
for each row execute function clinic_os.set_updated_at();

create table if not exists form_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  template_id uuid not null,
  template_version integer not null check (template_version > 0),
  source text not null check (source in ('digital', 'assistant_paper_card')),
  responses jsonb not null default '{}',
  medical_history_snapshot jsonb not null default '{}',
  provenance jsonb not null default '{}',
  submitted_by_user_id uuid not null references users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint form_responses_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint form_responses_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint form_responses_template_fk
    foreign key (tenant_id, template_id) references form_templates(tenant_id, id) on delete restrict
);

create index if not exists form_responses_patient_idx
  on form_responses(tenant_id, clinic_id, patient_id, submitted_at desc);

create table if not exists consents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  purpose text not null check (
    purpose in (
      'treatment_registration',
      'privacy_notice',
      'whatsapp_communication',
      'marketing_recall',
      'ai_audio_capture',
      'raw_audio_retention',
      'photo_capture',
      'photo_sharing',
      'abdm_abha',
      'procedure_treatment'
    )
  ),
  status text not null default 'active' check (status in ('active', 'revoked')),
  template_code text not null,
  template_version integer not null check (template_version > 0),
  capture_method text not null check (
    capture_method in ('digital_patient', 'assistant_paper_card', 'clinic_staff', 'imported_record')
  ),
  granted_by_name text,
  relationship_to_patient text,
  evidence jsonb not null default '{}',
  provenance jsonb not null default '{}',
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  revoked_by_user_id uuid references users(id) on delete restrict,
  revoked_at timestamptz,
  revocation_reason text,
  unique (tenant_id, id),
  constraint consents_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint consents_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint consents_revocation_consistent check (
    (status = 'active' and revoked_at is null and revoked_by_user_id is null)
    or (status = 'revoked' and revoked_at is not null and revoked_by_user_id is not null)
  )
);

create unique index if not exists consents_active_purpose_unique_idx
  on consents(tenant_id, clinic_id, patient_id, purpose)
  where status = 'active';
create index if not exists consents_patient_idx
  on consents(tenant_id, clinic_id, patient_id, purpose, created_at desc);

create table if not exists encounters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  appointment_id uuid,
  provider_user_id uuid not null references users(id) on delete restrict,
  status text not null default 'scheduled' check (
    status in ('scheduled', 'drafting', 'ready_for_sign', 'signed', 'amended', 'closed', 'cancelled')
  ),
  reason text,
  medical_history_snapshot jsonb not null default '{}',
  started_at timestamptz,
  closed_at timestamptz,
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint encounters_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint encounters_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint encounters_appointment_fk
    foreign key (tenant_id, appointment_id) references appointments(tenant_id, id) on delete set null
);

create index if not exists encounters_patient_idx
  on encounters(tenant_id, clinic_id, patient_id, created_at desc);
create index if not exists encounters_appointment_idx
  on encounters(tenant_id, clinic_id, appointment_id)
  where appointment_id is not null;

create trigger encounters_set_updated_at
before update on encounters
for each row execute function clinic_os.set_updated_at();

create table if not exists encounter_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  encounter_id uuid not null,
  from_status text check (
    from_status in ('scheduled', 'drafting', 'ready_for_sign', 'signed', 'amended', 'closed', 'cancelled')
  ),
  to_status text not null check (
    to_status in ('scheduled', 'drafting', 'ready_for_sign', 'signed', 'amended', 'closed', 'cancelled')
  ),
  changed_by_user_id uuid references users(id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text,
  constraint encounter_status_history_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint encounter_status_history_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete cascade
);

create index if not exists encounter_status_history_lookup_idx
  on encounter_status_history(tenant_id, clinic_id, encounter_id, changed_at desc);

create table if not exists clinical_note_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  encounter_id uuid not null,
  patient_id uuid not null,
  version_number integer not null check (version_number > 0),
  status text not null default 'draft' check (status in ('draft', 'signed', 'amended')),
  content jsonb not null default '{}',
  amendment_reason text,
  amended_from_version_id uuid,
  signed_by_user_id uuid references users(id) on delete restrict,
  signed_at timestamptz,
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, encounter_id, version_number),
  constraint clinical_note_versions_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint clinical_note_versions_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete restrict,
  constraint clinical_note_versions_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint clinical_note_versions_amended_from_fk
    foreign key (tenant_id, amended_from_version_id) references clinical_note_versions(tenant_id, id) on delete restrict,
  constraint clinical_note_versions_signature_consistent check (
    (status = 'draft' and signed_by_user_id is null and signed_at is null)
    or (status in ('signed', 'amended') and signed_by_user_id is not null and signed_at is not null)
  ),
  constraint clinical_note_versions_amendment_reason check (
    (status <> 'amended' and amendment_reason is null and amended_from_version_id is null)
    or (status = 'amended' and amendment_reason is not null and amended_from_version_id is not null)
  )
);

create index if not exists clinical_note_versions_encounter_idx
  on clinical_note_versions(tenant_id, clinic_id, encounter_id, version_number desc);
create index if not exists clinical_note_versions_patient_signed_idx
  on clinical_note_versions(tenant_id, clinic_id, patient_id, signed_at desc)
  where status in ('signed', 'amended');

create or replace function clinic_os.prevent_signed_clinical_note_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('signed', 'amended') then
    raise exception 'signed clinical note versions are immutable';
  end if;

  if tg_op = 'DELETE' and old.status in ('signed', 'amended') then
    raise exception 'signed clinical note versions cannot be deleted';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists clinical_note_versions_signed_immutable on clinical_note_versions;
create trigger clinical_note_versions_signed_immutable
before update or delete on clinical_note_versions
for each row execute function clinic_os.prevent_signed_clinical_note_mutation();

create table if not exists prescriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  encounter_id uuid not null,
  patient_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'signed')),
  medications jsonb not null,
  notes text,
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  signed_by_user_id uuid references users(id) on delete restrict,
  signed_at timestamptz,
  unique (tenant_id, id),
  constraint prescriptions_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint prescriptions_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete restrict,
  constraint prescriptions_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint prescriptions_signature_consistent check (
    (status = 'draft' and signed_by_user_id is null and signed_at is null)
    or (status = 'signed' and signed_by_user_id is not null and signed_at is not null)
  ),
  constraint prescriptions_medications_array check (jsonb_typeof(medications) = 'array')
);

create index if not exists prescriptions_encounter_idx
  on prescriptions(tenant_id, clinic_id, encounter_id, created_at desc);
create index if not exists prescriptions_patient_idx
  on prescriptions(tenant_id, clinic_id, patient_id, created_at desc);

create or replace function clinic_os.prevent_signed_prescription_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'signed' then
    raise exception 'signed prescriptions are immutable';
  end if;

  if tg_op = 'DELETE' and old.status = 'signed' then
    raise exception 'signed prescriptions cannot be deleted';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists prescriptions_signed_immutable on prescriptions;
create trigger prescriptions_signed_immutable
before update or delete on prescriptions
for each row execute function clinic_os.prevent_signed_prescription_mutation();

alter table form_templates enable row level security;
alter table form_templates force row level security;
drop policy if exists form_templates_tenant_clinic_isolation on form_templates;
create policy form_templates_tenant_clinic_isolation on form_templates
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table form_responses enable row level security;
alter table form_responses force row level security;
drop policy if exists form_responses_tenant_clinic_isolation on form_responses;
create policy form_responses_tenant_clinic_isolation on form_responses
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table consents enable row level security;
alter table consents force row level security;
drop policy if exists consents_tenant_clinic_isolation on consents;
create policy consents_tenant_clinic_isolation on consents
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table encounters enable row level security;
alter table encounters force row level security;
drop policy if exists encounters_tenant_clinic_isolation on encounters;
create policy encounters_tenant_clinic_isolation on encounters
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table encounter_status_history enable row level security;
alter table encounter_status_history force row level security;
drop policy if exists encounter_status_history_tenant_clinic_isolation on encounter_status_history;
create policy encounter_status_history_tenant_clinic_isolation on encounter_status_history
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table clinical_note_versions enable row level security;
alter table clinical_note_versions force row level security;
drop policy if exists clinical_note_versions_tenant_clinic_isolation on clinical_note_versions;
create policy clinical_note_versions_tenant_clinic_isolation on clinical_note_versions
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table prescriptions enable row level security;
alter table prescriptions force row level security;
drop policy if exists prescriptions_tenant_clinic_isolation on prescriptions;
create policy prescriptions_tenant_clinic_isolation on prescriptions
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

comment on table form_responses is 'Patient intake responses from digital forms or assistant-entered paper history cards.';
comment on table consents is 'Purpose-specific patient consent ledger with revocation state for future enforcement gates such as AI/audio capture.';
comment on table encounters is 'Clinical encounter lifecycle root for patient visits and doctor prep.';
comment on table clinical_note_versions is 'Versioned clinical notes. Signed and amended versions are immutable by trigger; amendments create linked versions.';
comment on table prescriptions is 'Prescription drafts and doctor-signed immutable prescription records.';
