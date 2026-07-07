-- Checkpoint 9: security/privacy operations foundation.
-- Applies after 0009_mobile_capture_ai_scribe.sql on PostgreSQL 16+.

insert into permissions (key, display_name, category, description, phi_involved)
values
  ('audit.review', 'Review audit events', 'security', 'Review, classify, and document audit events without mutating the original audit log.', false),
  ('privacy.request', 'Request privacy actions', 'privacy', 'Create patient privacy, export, correction, and deletion requests for clinic review.', true),
  ('retention.manage', 'Manage retention jobs', 'privacy', 'Review deletion requests and run conservative retention jobs with auditable evidence.', true),
  ('patient.export', 'Export patient record', 'privacy', 'Export scoped patient records with safety manifest and redacted audit evidence.', true),
  ('break_glass.request', 'Request break-glass access', 'security', 'Request time-bound emergency PHI access with reason, scope, and expiry.', true),
  ('break_glass.approve', 'Review break-glass access', 'security', 'Approve, deny, or revoke time-bound emergency PHI access with audit evidence.', true)
on conflict (key) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  description = excluded.description,
  phi_involved = excluded.phi_involved;

insert into role_permissions (role_id, permission_key)
select roles.id, grants.permission_key
from roles
join (
  values
    ('owner_admin', 'audit.review'),
    ('owner_admin', 'privacy.request'),
    ('owner_admin', 'retention.manage'),
    ('owner_admin', 'patient.export'),
    ('owner_admin', 'break_glass.request'),
    ('owner_admin', 'break_glass.approve'),
    ('auditor', 'audit.review'),
    ('platform_admin', 'audit.review'),
    ('platform_admin', 'privacy.request'),
    ('platform_admin', 'retention.manage'),
    ('platform_admin', 'patient.export'),
    ('platform_admin', 'break_glass.request'),
    ('platform_admin', 'break_glass.approve')
) grants(role_slug, permission_key) on roles.slug = grants.role_slug
on conflict do nothing;

create or replace function clinic_os.prevent_cp9_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% rows are immutable', tg_table_name;
  end if;

  raise exception '% rows cannot be deleted', tg_table_name;
end;
$$;

drop trigger if exists audit_events_immutable on audit_events;
create trigger audit_events_immutable
before update or delete on audit_events
for each row execute function clinic_os.prevent_cp9_evidence_mutation();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'audit_events_tenant_id_unique'
      and conrelid = 'audit_events'::regclass
  ) then
    alter table audit_events add constraint audit_events_tenant_id_unique unique (tenant_id, id);
  end if;
end;
$$;

create table if not exists audit_event_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  audit_event_id uuid not null,
  review_status text not null check (review_status in ('reviewed', 'escalated', 'dismissed')),
  disposition text not null check (length(trim(disposition)) > 0),
  notes text,
  reviewed_by_user_id uuid not null references users(id) on delete restrict,
  reviewed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint audit_event_reviews_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint audit_event_reviews_audit_event_fk
    foreign key (tenant_id, audit_event_id) references audit_events(tenant_id, id) on delete restrict
);

create index if not exists audit_event_reviews_event_idx
  on audit_event_reviews(tenant_id, clinic_id, audit_event_id, reviewed_at desc);

drop trigger if exists audit_event_reviews_immutable on audit_event_reviews;
create trigger audit_event_reviews_immutable
before update or delete on audit_event_reviews
for each row execute function clinic_os.prevent_cp9_evidence_mutation();

create table if not exists data_exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  status text not null default 'requested' check (status in ('requested', 'completed', 'failed', 'cancelled')),
  format text not null default 'json' check (format = 'json'),
  sections text[] not null check (
    cardinality(sections) > 0
    and sections <@ array[
      'demographics',
      'consents',
      'timeline',
      'intake',
      'encounters',
      'clinical_notes',
      'prescriptions',
      'instructions',
      'dental_chart',
      'media',
      'billing',
      'ai_evidence',
      'privacy_audit'
    ]::text[]
  ),
  requested_by_user_id uuid not null references users(id) on delete restrict,
  completed_by_user_id uuid references users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  export_payload jsonb check (export_payload is null or jsonb_typeof(export_payload) = 'object'),
  payload_digest text check (payload_digest is null or payload_digest ~ '^[a-f0-9]{64}$'),
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint data_exports_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint data_exports_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint data_exports_completed_payload_check check (
    status <> 'completed'
    or (completed_by_user_id is not null and completed_at is not null and export_payload is not null and payload_digest is not null)
  ),
  constraint data_exports_failed_reason_check check (
    status <> 'failed' or failure_reason is not null
  ),
  constraint data_exports_no_private_storage_payload check (
    export_payload is null
    or export_payload::text !~* '(objectKey|storageProvider|storageRegion|storagePath|storageKey|bucket|rawProviderPayload|privatePayload)'
  )
);

create index if not exists data_exports_patient_idx
  on data_exports(tenant_id, clinic_id, patient_id, requested_at desc);

create trigger data_exports_set_updated_at
before update on data_exports
for each row execute function clinic_os.set_updated_at();

create table if not exists deletion_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  request_type text not null check (
    request_type in ('patient_requested_deletion', 'transient_payload_redaction', 'correction_request')
  ),
  status text not null default 'requested' check (
    status in ('requested', 'approved_pending_retention_job', 'rejected', 'completed', 'cancelled')
  ),
  reason text not null check (length(trim(reason)) >= 12),
  requested_by_user_id uuid not null references users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  reviewed_by_user_id uuid references users(id) on delete restrict,
  reviewed_at timestamptz,
  review_reason text,
  scope jsonb not null check (
    jsonb_typeof(scope) = 'object'
    and scope->>'protectedClinicalRecords' = 'not_deleted'
    and scope->>'protectedAuditRecords' = 'not_deleted'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint deletion_requests_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint deletion_requests_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint deletion_requests_review_state_check check (
    status = 'requested'
    or (reviewed_by_user_id is not null and reviewed_at is not null and review_reason is not null)
  )
);

create index if not exists deletion_requests_patient_idx
  on deletion_requests(tenant_id, clinic_id, patient_id, requested_at desc);

create trigger deletion_requests_set_updated_at
before update on deletion_requests
for each row execute function clinic_os.set_updated_at();

create table if not exists retention_job_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  mode text not null check (mode in ('dry_run', 'execute')),
  status text not null check (status in ('completed', 'failed')),
  policy_code text not null check (length(trim(policy_code)) > 0),
  as_of timestamptz not null,
  deletion_request_id uuid,
  started_by_user_id uuid not null references users(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint retention_job_runs_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint retention_job_runs_deletion_request_fk
    foreign key (tenant_id, deletion_request_id) references deletion_requests(tenant_id, id) on delete restrict
);

create index if not exists retention_job_runs_policy_idx
  on retention_job_runs(tenant_id, clinic_id, policy_code, started_at desc);

create table if not exists retention_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  run_id uuid not null,
  patient_id uuid,
  action_kind text not null check (
    action_kind in (
      'ai_transcript_delete',
      'ai_raw_audio_reference_delete',
      'data_export_payload_redact',
      'protected_clinical_record_skipped',
      'protected_audit_record_skipped'
    )
  ),
  status text not null check (status in ('planned', 'completed', 'skipped', 'blocked')),
  target_type text not null check (length(trim(target_type)) > 0),
  target_id text not null check (length(trim(target_id)) > 0),
  protected_record boolean not null default false,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint retention_actions_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint retention_actions_run_fk
    foreign key (tenant_id, run_id) references retention_job_runs(tenant_id, id) on delete cascade,
  constraint retention_actions_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint retention_actions_protected_skipped_check check (
    protected_record = false or status in ('skipped', 'blocked')
  )
);

create index if not exists retention_actions_run_idx
  on retention_actions(tenant_id, clinic_id, run_id, created_at);

drop trigger if exists retention_actions_immutable on retention_actions;
create trigger retention_actions_immutable
before update or delete on retention_actions
for each row execute function clinic_os.prevent_cp9_evidence_mutation();

alter table break_glass_accesses
  add column if not exists access_categories text[] not null default array['patient_record']::text[],
  add column if not exists access_scope jsonb not null default '{}'::jsonb,
  add column if not exists reviewed_by_user_id uuid references users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_reason text,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

update break_glass_accesses
set
  access_scope = jsonb_build_object(
    'patientId', patient_id,
    'resourceTypes', access_categories,
    'clinicalJustification', reason
  )
where access_scope = '{}'::jsonb
  and patient_id is not null;

alter table break_glass_accesses drop constraint if exists break_glass_accesses_patient_scope_check;
alter table break_glass_accesses
  add constraint break_glass_accesses_patient_scope_check
  check (clinic_id is not null and patient_id is not null) not valid;

alter table break_glass_accesses drop constraint if exists break_glass_accesses_reason_length_check;
alter table break_glass_accesses
  add constraint break_glass_accesses_reason_length_check
  check (length(trim(reason)) >= 12) not valid;

alter table break_glass_accesses drop constraint if exists break_glass_accesses_access_categories_check;
alter table break_glass_accesses
  add constraint break_glass_accesses_access_categories_check
  check (
    cardinality(access_categories) > 0
    and access_categories <@ array[
      'patient_record',
      'clinical_notes',
      'dental_chart',
      'media',
      'billing',
      'ai_evidence'
    ]::text[]
  ) not valid;

alter table break_glass_accesses drop constraint if exists break_glass_accesses_access_scope_check;
alter table break_glass_accesses
  add constraint break_glass_accesses_access_scope_check
  check (jsonb_typeof(access_scope) = 'object') not valid;

alter table break_glass_accesses drop constraint if exists break_glass_accesses_expiry_window_check;
alter table break_glass_accesses
  add constraint break_glass_accesses_expiry_window_check
  check (expires_at > requested_at and expires_at <= requested_at + interval '8 hours') not valid;

alter table break_glass_accesses drop constraint if exists break_glass_accesses_review_state_check;
alter table break_glass_accesses
  add constraint break_glass_accesses_review_state_check
  check (
    status in ('requested', 'expired')
    or (reviewed_by_user_id is not null and reviewed_at is not null and review_reason is not null)
  ) not valid;

drop trigger if exists break_glass_accesses_set_updated_at on break_glass_accesses;
create trigger break_glass_accesses_set_updated_at
before update on break_glass_accesses
for each row execute function clinic_os.set_updated_at();

alter table audit_event_reviews enable row level security;
alter table audit_event_reviews force row level security;
drop policy if exists audit_event_reviews_tenant_clinic_isolation on audit_event_reviews;
create policy audit_event_reviews_tenant_clinic_isolation on audit_event_reviews
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table data_exports enable row level security;
alter table data_exports force row level security;
drop policy if exists data_exports_tenant_clinic_isolation on data_exports;
create policy data_exports_tenant_clinic_isolation on data_exports
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table deletion_requests enable row level security;
alter table deletion_requests force row level security;
drop policy if exists deletion_requests_tenant_clinic_isolation on deletion_requests;
create policy deletion_requests_tenant_clinic_isolation on deletion_requests
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table retention_job_runs enable row level security;
alter table retention_job_runs force row level security;
drop policy if exists retention_job_runs_tenant_clinic_isolation on retention_job_runs;
create policy retention_job_runs_tenant_clinic_isolation on retention_job_runs
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table retention_actions enable row level security;
alter table retention_actions force row level security;
drop policy if exists retention_actions_tenant_clinic_isolation on retention_actions;
create policy retention_actions_tenant_clinic_isolation on retention_actions
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table break_glass_accesses enable row level security;
alter table break_glass_accesses force row level security;
drop policy if exists break_glass_accesses_tenant_clinic_isolation on break_glass_accesses;
create policy break_glass_accesses_tenant_clinic_isolation on break_glass_accesses
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

comment on table audit_event_reviews is 'Append-only CP9 review evidence for immutable audit_events.';
comment on table data_exports is 'Scoped patient record export evidence with manifest, digest, and payload safety checks.';
comment on table deletion_requests is 'Clinic-scoped privacy/deletion requests. Protected clinical and audit records are never deleted by request scope.';
comment on table retention_job_runs is 'Audited CP9 retention run ledger. Jobs are conservative and scoped by explicit policy.';
comment on table retention_actions is 'Append-only action evidence for retention jobs, including protected-record skips.';
comment on table break_glass_accesses is 'Time-bound break-glass access requests with explicit patient scope, reason, expiry, and owner/admin review.';
