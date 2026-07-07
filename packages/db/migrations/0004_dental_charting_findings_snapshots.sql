-- Checkpoint 4: dental chart aggregate, tooth-level findings, history, and immutable snapshots.
-- Applies after 0003_intake_consent_encounter_clinical.sql on PostgreSQL 16+.

insert into permissions (key, display_name, category, description, phi_involved)
values
  ('dental.chart.read', 'Read dental chart', 'clinical', 'Read dental chart findings and history.', true),
  ('dental.chart.write', 'Write dental chart', 'clinical', 'Create and update dental findings.', true),
  ('dental.chart.snapshot', 'Snapshot dental chart', 'clinical', 'Create immutable dental chart snapshots.', true)
on conflict (key) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  description = excluded.description,
  phi_involved = excluded.phi_involved;

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
      'dental_finding_created',
      'dental_finding_updated',
      'dental_chart_snapshot_created',
      'prescription_draft_created',
      'prescription_signed'
    )
  );

create table if not exists dental_charts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  numbering_system text not null default 'fdi' check (numbering_system in ('fdi')),
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, patient_id),
  constraint dental_charts_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint dental_charts_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict
);

create trigger dental_charts_set_updated_at
before update on dental_charts
for each row execute function clinic_os.set_updated_at();

create table if not exists dental_findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid,
  tooth_number text not null check (
    tooth_number in (
      '11', '12', '13', '14', '15', '16', '17', '18',
      '21', '22', '23', '24', '25', '26', '27', '28',
      '31', '32', '33', '34', '35', '36', '37', '38',
      '41', '42', '43', '44', '45', '46', '47', '48',
      '51', '52', '53', '54', '55',
      '61', '62', '63', '64', '65',
      '71', '72', '73', '74', '75',
      '81', '82', '83', '84', '85'
    )
  ),
  numbering_system text not null default 'fdi' check (numbering_system in ('fdi')),
  surface text check (
    surface is null or surface in ('distal', 'occlusal', 'buccal', 'lingual', 'mesial', 'cervical')
  ),
  finding_type text not null check (
    finding_type in (
      'caries',
      'cervical_erosion',
      'restoration',
      'crown',
      'missing',
      'mobility',
      'rct',
      'periodontal_note',
      'watch_item'
    )
  ),
  severity text,
  status text not null default 'active' check (
    status in ('active', 'watch', 'treated', 'historical', 'entered_in_error')
  ),
  review_status text not null default 'needs_review' check (review_status in ('needs_review', 'reviewed')),
  source text not null default 'manual' check (source in ('manual', 'ai_draft', 'imported', 'historical')),
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  notes text,
  provenance jsonb not null default '{}',
  treatment_reference jsonb not null default '{}',
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  reviewed_by_user_id uuid references users(id) on delete restrict,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint dental_findings_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint dental_findings_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint dental_findings_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete set null,
  constraint dental_findings_missing_surface_check check (finding_type <> 'missing' or surface is null),
  constraint dental_findings_review_consistent check (
    (review_status = 'needs_review' and reviewed_by_user_id is null and reviewed_at is null)
    or (review_status = 'reviewed' and reviewed_by_user_id is not null and reviewed_at is not null)
  )
);

create index if not exists dental_findings_patient_tooth_idx
  on dental_findings(tenant_id, clinic_id, patient_id, tooth_number, surface);
create index if not exists dental_findings_encounter_idx
  on dental_findings(tenant_id, clinic_id, encounter_id)
  where encounter_id is not null;

create trigger dental_findings_set_updated_at
before update on dental_findings
for each row execute function clinic_os.set_updated_at();

create table if not exists dental_finding_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  finding_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid,
  change_type text not null check (change_type in ('created', 'updated')),
  changed_by_user_id uuid not null references users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  reason text,
  before_state jsonb,
  after_state jsonb not null,
  provenance jsonb not null default '{}',
  constraint dental_finding_history_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint dental_finding_history_finding_fk
    foreign key (tenant_id, finding_id) references dental_findings(tenant_id, id) on delete restrict,
  constraint dental_finding_history_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint dental_finding_history_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete set null,
  constraint dental_finding_history_update_reason check (change_type = 'created' or reason is not null)
);

create index if not exists dental_finding_history_lookup_idx
  on dental_finding_history(tenant_id, clinic_id, finding_id, changed_at desc);

create table if not exists dental_chart_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid,
  snapshot_version integer not null check (snapshot_version > 0),
  chart_state jsonb not null,
  reason text,
  provenance jsonb not null default '{}',
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, patient_id, snapshot_version),
  constraint dental_chart_snapshots_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint dental_chart_snapshots_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint dental_chart_snapshots_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete set null,
  constraint dental_chart_snapshots_state_object check (jsonb_typeof(chart_state) = 'object')
);

create index if not exists dental_chart_snapshots_patient_idx
  on dental_chart_snapshots(tenant_id, clinic_id, patient_id, snapshot_version desc);

create or replace function clinic_os.prevent_dental_history_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'dental finding history rows are immutable';
  end if;

  raise exception 'dental finding history rows are immutable';
end;
$$;

drop trigger if exists dental_finding_history_immutable on dental_finding_history;
create trigger dental_finding_history_immutable
before update or delete on dental_finding_history
for each row execute function clinic_os.prevent_dental_history_mutation();

create or replace function clinic_os.prevent_dental_chart_snapshot_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'dental chart snapshots are immutable';
  end if;

  raise exception 'dental chart snapshots are immutable';
end;
$$;

drop trigger if exists dental_chart_snapshots_immutable on dental_chart_snapshots;
create trigger dental_chart_snapshots_immutable
before update or delete on dental_chart_snapshots
for each row execute function clinic_os.prevent_dental_chart_snapshot_mutation();

alter table dental_charts enable row level security;
alter table dental_charts force row level security;
drop policy if exists dental_charts_tenant_clinic_isolation on dental_charts;
create policy dental_charts_tenant_clinic_isolation on dental_charts
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table dental_findings enable row level security;
alter table dental_findings force row level security;
drop policy if exists dental_findings_tenant_clinic_isolation on dental_findings;
create policy dental_findings_tenant_clinic_isolation on dental_findings
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table dental_finding_history enable row level security;
alter table dental_finding_history force row level security;
drop policy if exists dental_finding_history_tenant_clinic_isolation on dental_finding_history;
create policy dental_finding_history_tenant_clinic_isolation on dental_finding_history
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table dental_chart_snapshots enable row level security;
alter table dental_chart_snapshots force row level security;
drop policy if exists dental_chart_snapshots_tenant_clinic_isolation on dental_chart_snapshots;
create policy dental_chart_snapshots_tenant_clinic_isolation on dental_chart_snapshots
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

comment on table dental_charts is 'Per-patient dental chart aggregate root and tooth-numbering configuration.';
comment on table dental_findings is 'Tooth-level dental findings with FDI notation, surface specificity, provenance, review state, and treatment references.';
comment on table dental_finding_history is 'Immutable audit history for dental finding creation and updates.';
comment on table dental_chart_snapshots is 'Immutable historical dental chart snapshots for encounter and patient timeline evidence.';
