-- Checkpoint 2: patient/contact registry, source-attributed leads, appointments, queue, tasks, dashboard data, and outbox.
-- Applies after 0001_identity_auth_audit_phi.sql on PostgreSQL 16+.

create extension if not exists btree_gist;

alter table patients drop constraint if exists patients_source_check;
alter table patients
  add constraint patients_source_check check (
    source in (
      'manual',
      'whatsapp',
      'phone',
      'call',
      'walkin',
      'practo',
      'google',
      'website',
      'instagram',
      'referral',
      'recall_campaign',
      'imported',
      'external_system'
    )
  );

create table if not exists patient_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  contact_type text not null check (contact_type in ('phone', 'whatsapp', 'email', 'guardian_phone', 'other')),
  value text not null,
  normalized_value text not null,
  is_primary boolean not null default false,
  consent_to_contact boolean not null default true,
  source text not null check (
    source in (
      'manual',
      'whatsapp',
      'phone',
      'call',
      'walkin',
      'practo',
      'google',
      'website',
      'instagram',
      'referral',
      'recall_campaign',
      'imported',
      'external_system'
    )
  ),
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint patient_contacts_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint patient_contacts_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete cascade
);

create unique index if not exists patient_contacts_primary_contact_unique_idx
  on patient_contacts(tenant_id, clinic_id, patient_id, contact_type)
  where is_primary;
create index if not exists patient_contacts_normalized_lookup_idx
  on patient_contacts(tenant_id, clinic_id, contact_type, normalized_value);

create table if not exists patient_merge_candidates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  candidate_patient_id uuid not null,
  score numeric(5, 2) not null check (score >= 0 and score <= 100),
  reasons jsonb not null default '[]',
  status text not null default 'open' check (status in ('open', 'dismissed', 'merged')),
  created_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint patient_merge_candidates_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint patient_merge_candidates_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete cascade,
  constraint patient_merge_candidates_candidate_fk
    foreign key (tenant_id, candidate_patient_id) references patients(tenant_id, id) on delete cascade,
  constraint patient_merge_candidates_not_self check (patient_id <> candidate_patient_id)
);

create unique index if not exists patient_merge_candidates_open_pair_unique_idx
  on patient_merge_candidates(tenant_id, least(patient_id, candidate_patient_id), greatest(patient_id, candidate_patient_id))
  where status = 'open';

create table if not exists patient_timeline_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  item_type text not null check (
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
      'task_created'
    )
  ),
  source_table text not null,
  source_id uuid not null,
  occurred_at timestamptz not null,
  title text not null,
  summary text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint patient_timeline_items_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint patient_timeline_items_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete cascade
);

create index if not exists patient_timeline_items_patient_occurred_idx
  on patient_timeline_items(tenant_id, clinic_id, patient_id, occurred_at desc);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid,
  primary_contact text not null,
  normalized_primary_contact text not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'matched', 'booked', 'lost', 'duplicate', 'spam')),
  intent text not null default 'unknown' check (
    intent in ('appointment_request', 'pricing_query', 'followup', 'emergency', 'lab_vendor', 'unknown')
  ),
  source text not null check (
    source in ('manual', 'whatsapp', 'phone', 'call', 'walkin', 'practo', 'google', 'website', 'instagram', 'referral', 'recall_campaign')
  ),
  source_detail jsonb not null default '{}',
  first_seen_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  created_by_user_id uuid references users(id) on delete set null,
  updated_by_user_id uuid references users(id) on delete set null,
  unique (tenant_id, id),
  constraint leads_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint leads_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete set null
);

create index if not exists leads_inbox_idx on leads(tenant_id, clinic_id, status, last_activity_at desc);
create index if not exists leads_source_idx on leads(tenant_id, clinic_id, source, status);
create index if not exists leads_normalized_contact_idx on leads(tenant_id, clinic_id, normalized_primary_contact);

create table if not exists appointment_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  code text not null,
  display_name text not null,
  default_duration_minutes integer not null check (default_duration_minutes > 0 and default_duration_minutes <= 1440),
  color text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, clinic_id, code),
  unique (tenant_id, id),
  constraint appointment_types_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create trigger appointment_types_set_updated_at
before update on appointment_types
for each row execute function clinic_os.set_updated_at();

create table if not exists chairs_or_rooms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  code text not null,
  display_name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, clinic_id, code),
  unique (tenant_id, id),
  constraint chairs_or_rooms_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create trigger chairs_or_rooms_set_updated_at
before update on chairs_or_rooms
for each row execute function clinic_os.set_updated_at();

create table if not exists provider_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  provider_user_id uuid not null references users(id) on delete restrict,
  day_of_week integer not null check (day_of_week between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  effective_from date not null,
  effective_until date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (starts_at < ends_at),
  check (effective_until is null or effective_until >= effective_from),
  constraint provider_schedules_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create index if not exists provider_schedules_lookup_idx
  on provider_schedules(tenant_id, clinic_id, provider_user_id, day_of_week, active);

create trigger provider_schedules_set_updated_at
before update on provider_schedules
for each row execute function clinic_os.set_updated_at();

create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  lead_id uuid,
  provider_user_id uuid not null references users(id) on delete restrict,
  appointment_type_id uuid not null,
  chair_id uuid,
  status text not null default 'booked' check (
    status in ('requested', 'booked', 'confirmed', 'checked_in', 'in_consult', 'completed', 'cancelled', 'no_show')
  ),
  start_at timestamptz not null,
  end_at timestamptz not null,
  source text not null check (
    source in ('manual', 'whatsapp', 'phone', 'call', 'walkin', 'practo', 'google', 'website', 'instagram', 'referral', 'recall_campaign')
  ),
  reason text,
  notes text,
  created_by_user_id uuid references users(id) on delete set null,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_at < end_at),
  unique (tenant_id, id),
  constraint appointments_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint appointments_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint appointments_lead_fk
    foreign key (tenant_id, lead_id) references leads(tenant_id, id) on delete set null,
  constraint appointments_type_fk
    foreign key (tenant_id, appointment_type_id) references appointment_types(tenant_id, id) on delete restrict,
  constraint appointments_chair_fk
    foreign key (tenant_id, chair_id) references chairs_or_rooms(tenant_id, id) on delete restrict
);

create index if not exists appointments_day_idx on appointments(tenant_id, clinic_id, start_at, status);
create index if not exists appointments_patient_idx on appointments(tenant_id, clinic_id, patient_id, start_at desc);
create index if not exists appointments_provider_idx on appointments(tenant_id, clinic_id, provider_user_id, start_at);

alter table appointments
  add constraint appointments_provider_no_overlap exclude using gist (
    tenant_id with =,
    clinic_id with =,
    provider_user_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status in ('requested', 'booked', 'confirmed', 'checked_in', 'in_consult'));

alter table appointments
  add constraint appointments_chair_no_overlap exclude using gist (
    tenant_id with =,
    clinic_id with =,
    chair_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (chair_id is not null and status in ('requested', 'booked', 'confirmed', 'checked_in', 'in_consult'));

create trigger appointments_set_updated_at
before update on appointments
for each row execute function clinic_os.set_updated_at();

create table if not exists appointment_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  appointment_id uuid not null,
  from_status text check (
    from_status in ('requested', 'booked', 'confirmed', 'checked_in', 'in_consult', 'completed', 'cancelled', 'no_show')
  ),
  to_status text not null check (
    to_status in ('requested', 'booked', 'confirmed', 'checked_in', 'in_consult', 'completed', 'cancelled', 'no_show')
  ),
  changed_by_user_id uuid references users(id) on delete set null,
  changed_at timestamptz not null default now(),
  reason text,
  constraint appointment_status_history_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint appointment_status_history_appointment_fk
    foreign key (tenant_id, appointment_id) references appointments(tenant_id, id) on delete cascade
);

create index if not exists appointment_status_history_lookup_idx
  on appointment_status_history(tenant_id, clinic_id, appointment_id, changed_at desc);

create table if not exists queue_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  appointment_id uuid not null,
  patient_id uuid not null,
  provider_user_id uuid not null references users(id) on delete restrict,
  status text not null default 'waiting' check (status in ('waiting', 'called', 'in_consult', 'completed', 'cancelled')),
  position integer not null check (position > 0),
  checked_in_at timestamptz not null default now(),
  called_at timestamptz,
  completed_at timestamptz,
  created_by_user_id uuid references users(id) on delete set null,
  updated_by_user_id uuid references users(id) on delete set null,
  unique (tenant_id, clinic_id, appointment_id),
  constraint queue_entries_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint queue_entries_appointment_fk
    foreign key (tenant_id, appointment_id) references appointments(tenant_id, id) on delete cascade,
  constraint queue_entries_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict
);

create index if not exists queue_entries_board_idx
  on queue_entries(tenant_id, clinic_id, checked_in_at, status, position);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid,
  lead_id uuid,
  appointment_id uuid,
  task_type text not null check (
    task_type in ('confirmation', 'missed_call', 'whatsapp_request', 'follow_up', 'recall', 'payment_due', 'lab_case', 'sop')
  ),
  title text not null,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  due_at timestamptz,
  assigned_to_user_id uuid references users(id) on delete set null,
  created_by_user_id uuid references users(id) on delete set null,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tasks_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint tasks_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete set null,
  constraint tasks_lead_fk
    foreign key (tenant_id, lead_id) references leads(tenant_id, id) on delete set null,
  constraint tasks_appointment_fk
    foreign key (tenant_id, appointment_id) references appointments(tenant_id, id) on delete set null
);

create index if not exists tasks_dashboard_idx on tasks(tenant_id, clinic_id, status, due_at);

create trigger tasks_set_updated_at
before update on tasks
for each row execute function clinic_os.set_updated_at();

create table if not exists attribution_touches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid,
  lead_id uuid,
  appointment_id uuid,
  invoice_id uuid,
  source text not null check (
    source in ('manual', 'whatsapp', 'phone', 'call', 'walkin', 'practo', 'google', 'website', 'instagram', 'referral', 'recall_campaign')
  ),
  medium text,
  campaign text,
  external_ref text,
  touch_type text not null check (touch_type in ('first_touch', 'booking_touch', 'revenue_touch', 'recall_touch')),
  occurred_at timestamptz not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint attribution_touches_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint attribution_touches_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete set null,
  constraint attribution_touches_lead_fk
    foreign key (tenant_id, lead_id) references leads(tenant_id, id) on delete set null,
  constraint attribution_touches_appointment_fk
    foreign key (tenant_id, appointment_id) references appointments(tenant_id, id) on delete set null
);

create index if not exists attribution_touches_patient_idx
  on attribution_touches(tenant_id, clinic_id, patient_id, occurred_at desc);
create index if not exists attribution_touches_source_idx
  on attribution_touches(tenant_id, clinic_id, source, touch_type, occurred_at desc);

create table if not exists outbox_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  event_type text not null,
  schema_version text not null default '1.0',
  actor_type text not null check (actor_type in ('user', 'system', 'integration', 'ai')),
  actor_id text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  patient_id uuid,
  idempotency_key text,
  correlation_id text,
  payload jsonb not null default '{}',
  occurred_at timestamptz not null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  constraint outbox_events_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint outbox_events_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete set null
);

create index if not exists outbox_events_unpublished_idx
  on outbox_events(tenant_id, clinic_id, created_at)
  where published_at is null;
create unique index if not exists outbox_events_idempotency_unique_idx
  on outbox_events(tenant_id, idempotency_key)
  where idempotency_key is not null;

alter table patient_contacts enable row level security;
alter table patient_contacts force row level security;
drop policy if exists patient_contacts_tenant_clinic_isolation on patient_contacts;
create policy patient_contacts_tenant_clinic_isolation on patient_contacts
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table patient_merge_candidates enable row level security;
alter table patient_merge_candidates force row level security;
drop policy if exists patient_merge_candidates_tenant_clinic_isolation on patient_merge_candidates;
create policy patient_merge_candidates_tenant_clinic_isolation on patient_merge_candidates
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table patient_timeline_items enable row level security;
alter table patient_timeline_items force row level security;
drop policy if exists patient_timeline_items_tenant_clinic_isolation on patient_timeline_items;
create policy patient_timeline_items_tenant_clinic_isolation on patient_timeline_items
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table leads enable row level security;
alter table leads force row level security;
drop policy if exists leads_tenant_clinic_isolation on leads;
create policy leads_tenant_clinic_isolation on leads
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table appointment_types enable row level security;
alter table appointment_types force row level security;
drop policy if exists appointment_types_tenant_clinic_isolation on appointment_types;
create policy appointment_types_tenant_clinic_isolation on appointment_types
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table chairs_or_rooms enable row level security;
alter table chairs_or_rooms force row level security;
drop policy if exists chairs_or_rooms_tenant_clinic_isolation on chairs_or_rooms;
create policy chairs_or_rooms_tenant_clinic_isolation on chairs_or_rooms
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table provider_schedules enable row level security;
alter table provider_schedules force row level security;
drop policy if exists provider_schedules_tenant_clinic_isolation on provider_schedules;
create policy provider_schedules_tenant_clinic_isolation on provider_schedules
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table appointments enable row level security;
alter table appointments force row level security;
drop policy if exists appointments_tenant_clinic_isolation on appointments;
create policy appointments_tenant_clinic_isolation on appointments
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table appointment_status_history enable row level security;
alter table appointment_status_history force row level security;
drop policy if exists appointment_status_history_tenant_clinic_isolation on appointment_status_history;
create policy appointment_status_history_tenant_clinic_isolation on appointment_status_history
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table queue_entries enable row level security;
alter table queue_entries force row level security;
drop policy if exists queue_entries_tenant_clinic_isolation on queue_entries;
create policy queue_entries_tenant_clinic_isolation on queue_entries
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table tasks enable row level security;
alter table tasks force row level security;
drop policy if exists tasks_tenant_clinic_isolation on tasks;
create policy tasks_tenant_clinic_isolation on tasks
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table attribution_touches enable row level security;
alter table attribution_touches force row level security;
drop policy if exists attribution_touches_tenant_clinic_isolation on attribution_touches;
create policy attribution_touches_tenant_clinic_isolation on attribution_touches
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table outbox_events enable row level security;
alter table outbox_events force row level security;
drop policy if exists outbox_events_tenant_clinic_isolation on outbox_events;
create policy outbox_events_tenant_clinic_isolation on outbox_events
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

comment on table leads is 'Source-attributed lead inbox. Stores only operational acquisition data needed for clinic workflow.';
comment on table attribution_touches is 'First/booking/revenue/recall attribution touchpoints carried across leads, patients, and appointments.';
comment on table appointments is 'Tenant/clinic-scoped appointment book with DB-enforced provider and chair conflict protection.';
comment on table outbox_events is 'Transactional domain event outbox for auditably publishing PHI and workflow state changes.';
