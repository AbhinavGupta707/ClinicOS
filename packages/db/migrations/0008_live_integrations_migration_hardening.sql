-- Checkpoint 7: live integration event persistence and audited migration/import hardening.
-- Applies after 0007_lab_inventory_events.sql on PostgreSQL 16+.

insert into permissions (key, display_name, category, description, phi_involved)
values
  ('migration.manage', 'Manage migrations', 'integration', 'Upload, review, resolve, commit, and roll back clinic-approved imports.', true)
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
    ('owner_admin', 'migration.manage'),
    ('doctor', 'migration.manage'),
    ('assistant', 'migration.manage'),
    ('receptionist', 'migration.manage'),
    ('platform_admin', 'migration.manage')
) grants(role_slug, permission_key) on roles.slug = grants.role_slug
on conflict do nothing;

create table if not exists migration_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  import_type text not null check (
    import_type in ('patients', 'appointments', 'invoices', 'payments', 'clinical_notes', 'media_inventory')
  ),
  source_system text not null default 'manual_csv' check (length(trim(source_system)) > 0),
  source_file_name text,
  source_checksum text,
  state text not null default 'uploaded' check (
    state in (
      'uploaded',
      'parsed',
      'validated',
      'needs_review',
      'ready_to_commit',
      'committed',
      'partially_committed',
      'failed',
      'rolled_back'
    )
  ),
  uploaded_by_user_id uuid not null references users(id) on delete restrict,
  committed_by_user_id uuid references users(id) on delete set null,
  rolled_back_by_user_id uuid references users(id) on delete set null,
  row_count integer not null default 0 check (row_count >= 0),
  valid_row_count integer not null default 0 check (valid_row_count >= 0),
  invalid_row_count integer not null default 0 check (invalid_row_count >= 0),
  conflict_row_count integer not null default 0 check (conflict_row_count >= 0),
  ready_row_count integer not null default 0 check (ready_row_count >= 0),
  committed_row_count integer not null default 0 check (committed_row_count >= 0),
  rolled_back_row_count integer not null default 0 check (rolled_back_row_count >= 0),
  failed_row_count integer not null default 0 check (failed_row_count >= 0),
  committed_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint migration_batches_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint migration_batches_counts_check check (
    row_count >= valid_row_count
    and row_count >= invalid_row_count
    and row_count >= conflict_row_count
    and row_count >= ready_row_count
    and row_count >= committed_row_count
    and row_count >= rolled_back_row_count
    and row_count >= failed_row_count
  )
);

create index if not exists migration_batches_state_idx
  on migration_batches(tenant_id, clinic_id, state, created_at desc);

create trigger migration_batches_set_updated_at
before update on migration_batches
for each row execute function clinic_os.set_updated_at();

create table if not exists migration_rows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  batch_id uuid not null,
  row_number integer not null check (row_number > 0),
  import_type text not null check (
    import_type in ('patients', 'appointments', 'invoices', 'payments', 'clinical_notes', 'media_inventory')
  ),
  external_record_id text,
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) = 'object'),
  raw_payload_digest text not null check (length(trim(raw_payload_digest)) > 0),
  normalized_record jsonb check (normalized_record is null or jsonb_typeof(normalized_record) = 'object'),
  validation_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(validation_errors) = 'array'),
  status text not null check (
    status in ('invalid', 'needs_review', 'ready_to_commit', 'committed', 'skipped', 'rolled_back', 'failed')
  ),
  match_status text not null default 'none' check (
    match_status in ('none', 'duplicate_candidate', 'conflict', 'resolved', 'skipped')
  ),
  resolution_action text check (resolution_action in ('create_new', 'link_existing', 'skip')),
  resolution_target_record_type text,
  resolution_target_record_id uuid,
  resolution_note text,
  committed_record_type text,
  committed_record_id uuid,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, batch_id, row_number),
  unique (tenant_id, id),
  constraint migration_rows_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint migration_rows_batch_fk
    foreign key (tenant_id, batch_id) references migration_batches(tenant_id, id) on delete cascade,
  constraint migration_rows_resolution_target_check check (
    (resolution_action = 'link_existing' and resolution_target_record_type is not null and resolution_target_record_id is not null)
    or (coalesce(resolution_action, '') <> 'link_existing')
  )
);

create index if not exists migration_rows_batch_status_idx
  on migration_rows(tenant_id, clinic_id, batch_id, status, row_number);
create index if not exists migration_rows_match_status_idx
  on migration_rows(tenant_id, clinic_id, batch_id, match_status, row_number);

create trigger migration_rows_set_updated_at
before update on migration_rows
for each row execute function clinic_os.set_updated_at();

create table if not exists migration_conflicts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  batch_id uuid not null,
  row_id uuid not null,
  conflict_type text not null check (
    conflict_type in ('duplicate_patient', 'verified_record_overlap', 'invalid_reference', 'field_conflict')
  ),
  severity text not null default 'review' check (severity in ('review', 'blocking')),
  target_record_type text,
  target_record_id uuid,
  field_name text,
  summary text not null check (length(trim(summary)) > 0),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  status text not null default 'open' check (status in ('open', 'resolved', 'ignored')),
  resolution_action text check (resolution_action in ('create_new', 'link_existing', 'skip')),
  resolved_by_user_id uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint migration_conflicts_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint migration_conflicts_batch_fk
    foreign key (tenant_id, batch_id) references migration_batches(tenant_id, id) on delete cascade,
  constraint migration_conflicts_row_fk
    foreign key (tenant_id, row_id) references migration_rows(tenant_id, id) on delete cascade
);

create index if not exists migration_conflicts_open_idx
  on migration_conflicts(tenant_id, clinic_id, batch_id, status, severity);

create trigger migration_conflicts_set_updated_at
before update on migration_conflicts
for each row execute function clinic_os.set_updated_at();

create table if not exists migration_commits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  batch_id uuid not null,
  action text not null check (action in ('commit', 'rollback')),
  status text not null check (status in ('succeeded', 'partially_succeeded', 'failed')),
  idempotency_key text,
  requested_by_user_id uuid not null references users(id) on delete restrict,
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  error_summary jsonb check (error_summary is null or jsonb_typeof(error_summary) = 'object'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (tenant_id, id),
  constraint migration_commits_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint migration_commits_batch_fk
    foreign key (tenant_id, batch_id) references migration_batches(tenant_id, id) on delete restrict
);

create unique index if not exists migration_commits_idempotency_unique_idx
  on migration_commits(tenant_id, clinic_id, batch_id, action, idempotency_key)
  where idempotency_key is not null;

create table if not exists imported_record_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  batch_id uuid not null,
  row_id uuid not null,
  import_type text not null check (
    import_type in ('patients', 'appointments', 'invoices', 'payments', 'clinical_notes', 'media_inventory')
  ),
  source_system text not null check (length(trim(source_system)) > 0),
  external_record_id text,
  target_record_type text not null check (length(trim(target_record_type)) > 0),
  target_record_id uuid not null,
  link_type text not null check (link_type in ('created_from_import', 'linked_existing')),
  verification_status text not null default 'imported_unverified' check (
    verification_status in ('imported_unverified', 'reviewed_verified', 'rolled_back')
  ),
  verified_by_user_id uuid references users(id) on delete set null,
  verified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint imported_record_links_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint imported_record_links_batch_fk
    foreign key (tenant_id, batch_id) references migration_batches(tenant_id, id) on delete restrict,
  constraint imported_record_links_row_fk
    foreign key (tenant_id, row_id) references migration_rows(tenant_id, id) on delete restrict,
  constraint imported_record_links_verified_check check (
    (verification_status = 'reviewed_verified' and verified_by_user_id is not null and verified_at is not null)
    or verification_status <> 'reviewed_verified'
  )
);

create unique index if not exists imported_record_links_external_unique_idx
  on imported_record_links(tenant_id, clinic_id, source_system, external_record_id, target_record_type)
  where external_record_id is not null and verification_status <> 'rolled_back';
create index if not exists imported_record_links_target_idx
  on imported_record_links(tenant_id, clinic_id, target_record_type, target_record_id, verification_status);

create trigger imported_record_links_set_updated_at
before update on imported_record_links
for each row execute function clinic_os.set_updated_at();

create table if not exists external_systems (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  provider_key text not null check (length(trim(provider_key)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  status text not null default 'not_configured' check (status in ('available', 'degraded', 'unavailable', 'not_configured')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider_key)
);

create trigger external_systems_set_updated_at
before update on external_systems
for each row execute function clinic_os.set_updated_at();

create table if not exists external_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid,
  external_system_id uuid not null,
  account_type text not null check (length(trim(account_type)) > 0),
  status text not null default 'not_configured' check (status in ('available', 'degraded', 'unavailable', 'not_configured')),
  capability_keys text[] not null default '{}',
  credential_ref text,
  last_health_check_at timestamptz,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint external_accounts_system_fk
    foreign key (tenant_id, external_system_id) references external_systems(tenant_id, id) on delete restrict,
  constraint external_accounts_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create index if not exists external_accounts_status_idx
  on external_accounts(tenant_id, clinic_id, status);

create trigger external_accounts_set_updated_at
before update on external_accounts
for each row execute function clinic_os.set_updated_at();

create table if not exists external_provider_capabilities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid,
  external_account_id uuid not null,
  capability_key text not null check (length(trim(capability_key)) > 0),
  status text not null default 'not_configured' check (status in ('available', 'degraded', 'unavailable', 'not_configured')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  checked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, external_account_id, capability_key),
  constraint external_provider_capabilities_account_fk
    foreign key (tenant_id, external_account_id) references external_accounts(tenant_id, id) on delete cascade,
  constraint external_provider_capabilities_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create trigger external_provider_capabilities_set_updated_at
before update on external_provider_capabilities
for each row execute function clinic_os.set_updated_at();

create table if not exists external_entity_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid,
  external_account_id uuid,
  provider_key text not null check (length(trim(provider_key)) > 0),
  external_entity_type text not null check (length(trim(external_entity_type)) > 0),
  external_entity_id text not null check (length(trim(external_entity_id)) > 0),
  internal_record_type text not null check (length(trim(internal_record_type)) > 0),
  internal_record_id uuid not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider_key, external_entity_type, external_entity_id, internal_record_type),
  constraint external_entity_links_account_fk
    foreign key (tenant_id, external_account_id) references external_accounts(tenant_id, id) on delete set null,
  constraint external_entity_links_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create table if not exists raw_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid,
  provider_key text not null check (length(trim(provider_key)) > 0),
  external_account_id uuid,
  event_type text not null check (length(trim(event_type)) > 0),
  provider_event_id text,
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'verified', 'failed')),
  processing_status text not null default 'received' check (
    processing_status in ('received', 'verified', 'normalization_failed', 'normalized', 'applied', 'dead_lettered', 'replayed')
  ),
  raw_payload jsonb not null check (jsonb_typeof(raw_payload) in ('object', 'array')),
  raw_payload_digest text not null check (length(trim(raw_payload_digest)) > 0),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint raw_webhook_events_account_fk
    foreign key (tenant_id, external_account_id) references external_accounts(tenant_id, id) on delete set null,
  constraint raw_webhook_events_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create unique index if not exists raw_webhook_events_idempotency_unique_idx
  on raw_webhook_events(tenant_id, provider_key, idempotency_key);
create index if not exists raw_webhook_events_processing_idx
  on raw_webhook_events(tenant_id, clinic_id, provider_key, processing_status, received_at desc);

create trigger raw_webhook_events_set_updated_at
before update on raw_webhook_events
for each row execute function clinic_os.set_updated_at();

create table if not exists normalized_integration_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid,
  raw_event_id uuid not null,
  event_type text not null check (length(trim(event_type)) > 0),
  aggregate_type text,
  aggregate_id uuid,
  patient_id uuid,
  normalized_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(normalized_payload) = 'object'),
  status text not null default 'normalized' check (
    status in ('received', 'verified', 'normalization_failed', 'normalized', 'applied', 'dead_lettered', 'replayed')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint normalized_integration_events_raw_event_fk
    foreign key (tenant_id, raw_event_id) references raw_webhook_events(tenant_id, id) on delete restrict,
  constraint normalized_integration_events_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete set null,
  constraint normalized_integration_events_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create index if not exists normalized_integration_events_status_idx
  on normalized_integration_events(tenant_id, clinic_id, status, created_at desc);

create trigger normalized_integration_events_set_updated_at
before update on normalized_integration_events
for each row execute function clinic_os.set_updated_at();

create table if not exists integration_health_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid,
  external_account_id uuid,
  provider_key text not null check (length(trim(provider_key)) > 0),
  status text not null check (status in ('available', 'degraded', 'unavailable', 'not_configured')),
  checked_at timestamptz not null default now(),
  latency_ms integer check (latency_ms is null or latency_ms >= 0),
  summary text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  unique (tenant_id, id),
  constraint integration_health_checks_account_fk
    foreign key (tenant_id, external_account_id) references external_accounts(tenant_id, id) on delete set null,
  constraint integration_health_checks_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create index if not exists integration_health_checks_provider_idx
  on integration_health_checks(tenant_id, clinic_id, provider_key, checked_at desc);

create table if not exists integration_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid,
  provider_key text not null check (length(trim(provider_key)) > 0),
  operation text not null check (length(trim(operation)) > 0),
  idempotency_key text,
  status text not null check (status in ('started', 'succeeded', 'failed', 'retrying', 'dead_lettered')),
  attempt_number integer not null default 1 check (attempt_number > 0),
  request_ref jsonb not null default '{}'::jsonb check (jsonb_typeof(request_ref) = 'object'),
  response_ref jsonb not null default '{}'::jsonb check (jsonb_typeof(response_ref) = 'object'),
  error_summary text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (tenant_id, id),
  constraint integration_attempts_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create index if not exists integration_attempts_status_idx
  on integration_attempts(tenant_id, clinic_id, provider_key, status, started_at desc);

create table if not exists integration_dead_letters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid,
  raw_event_id uuid,
  normalized_event_id uuid,
  provider_key text not null check (length(trim(provider_key)) > 0),
  failure_stage text not null check (failure_stage in ('verification', 'normalization', 'domain_command', 'outbox', 'workflow')),
  failure_code text not null check (length(trim(failure_code)) > 0),
  failure_summary text not null check (length(trim(failure_summary)) > 0),
  retry_count integer not null default 0 check (retry_count >= 0),
  next_retry_at timestamptz,
  status text not null default 'open' check (status in ('open', 'retry_scheduled', 'replayed', 'resolved', 'discarded')),
  last_error_digest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint integration_dead_letters_raw_event_fk
    foreign key (tenant_id, raw_event_id) references raw_webhook_events(tenant_id, id) on delete set null,
  constraint integration_dead_letters_normalized_event_fk
    foreign key (tenant_id, normalized_event_id) references normalized_integration_events(tenant_id, id) on delete set null,
  constraint integration_dead_letters_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create index if not exists integration_dead_letters_status_idx
  on integration_dead_letters(tenant_id, clinic_id, provider_key, status, created_at desc);

create trigger integration_dead_letters_set_updated_at
before update on integration_dead_letters
for each row execute function clinic_os.set_updated_at();

alter table migration_batches enable row level security;
alter table migration_batches force row level security;
drop policy if exists migration_batches_tenant_clinic_isolation on migration_batches;
create policy migration_batches_tenant_clinic_isolation on migration_batches
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table migration_rows enable row level security;
alter table migration_rows force row level security;
drop policy if exists migration_rows_tenant_clinic_isolation on migration_rows;
create policy migration_rows_tenant_clinic_isolation on migration_rows
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table migration_conflicts enable row level security;
alter table migration_conflicts force row level security;
drop policy if exists migration_conflicts_tenant_clinic_isolation on migration_conflicts;
create policy migration_conflicts_tenant_clinic_isolation on migration_conflicts
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table migration_commits enable row level security;
alter table migration_commits force row level security;
drop policy if exists migration_commits_tenant_clinic_isolation on migration_commits;
create policy migration_commits_tenant_clinic_isolation on migration_commits
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table imported_record_links enable row level security;
alter table imported_record_links force row level security;
drop policy if exists imported_record_links_tenant_clinic_isolation on imported_record_links;
create policy imported_record_links_tenant_clinic_isolation on imported_record_links
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table external_systems enable row level security;
alter table external_systems force row level security;
drop policy if exists external_systems_tenant_isolation on external_systems;
create policy external_systems_tenant_isolation on external_systems
  using (tenant_id = clinic_os.current_tenant_id())
  with check (tenant_id = clinic_os.current_tenant_id());

alter table external_accounts enable row level security;
alter table external_accounts force row level security;
drop policy if exists external_accounts_tenant_clinic_isolation on external_accounts;
create policy external_accounts_tenant_clinic_isolation on external_accounts
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  );

alter table external_provider_capabilities enable row level security;
alter table external_provider_capabilities force row level security;
drop policy if exists external_provider_capabilities_tenant_clinic_isolation on external_provider_capabilities;
create policy external_provider_capabilities_tenant_clinic_isolation on external_provider_capabilities
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  );

alter table external_entity_links enable row level security;
alter table external_entity_links force row level security;
drop policy if exists external_entity_links_tenant_clinic_isolation on external_entity_links;
create policy external_entity_links_tenant_clinic_isolation on external_entity_links
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  );

alter table raw_webhook_events enable row level security;
alter table raw_webhook_events force row level security;
drop policy if exists raw_webhook_events_tenant_clinic_isolation on raw_webhook_events;
create policy raw_webhook_events_tenant_clinic_isolation on raw_webhook_events
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  );

alter table normalized_integration_events enable row level security;
alter table normalized_integration_events force row level security;
drop policy if exists normalized_integration_events_tenant_clinic_isolation on normalized_integration_events;
create policy normalized_integration_events_tenant_clinic_isolation on normalized_integration_events
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  );

alter table integration_health_checks enable row level security;
alter table integration_health_checks force row level security;
drop policy if exists integration_health_checks_tenant_clinic_isolation on integration_health_checks;
create policy integration_health_checks_tenant_clinic_isolation on integration_health_checks
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  );

alter table integration_attempts enable row level security;
alter table integration_attempts force row level security;
drop policy if exists integration_attempts_tenant_clinic_isolation on integration_attempts;
create policy integration_attempts_tenant_clinic_isolation on integration_attempts
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  );

alter table integration_dead_letters enable row level security;
alter table integration_dead_letters force row level security;
drop policy if exists integration_dead_letters_tenant_clinic_isolation on integration_dead_letters;
create policy integration_dead_letters_tenant_clinic_isolation on integration_dead_letters
  using (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and (clinic_id is null or clinic_id = clinic_os.current_clinic_id())
  );

comment on table migration_batches is 'Clinic-approved migration/import batches. Rows may be invalid without blocking review of valid rows.';
comment on table migration_rows is 'Per-source-row import validation state. raw_payload is retained for restricted audit/debug use and never returned by public APIs.';
comment on table migration_conflicts is 'Explicit duplicate/conflict review queue for imports. Verified ClinicOS records are never silently overwritten.';
comment on table migration_commits is 'Idempotent commit and rollback attempts for migration batches with auditable summary evidence.';
comment on table imported_record_links is 'Links imported external records to ClinicOS records and marks imported records as imported_unverified until reviewed.';
comment on table raw_webhook_events is 'Restricted raw provider event store. Raw payloads may contain PHI or provider secrets and must not be exposed in public API responses.';
comment on table normalized_integration_events is 'Provider-neutral event records derived only after verification/idempotency checks.';
comment on table integration_dead_letters is 'Failed provider event replay/dead-letter queue with retry state and redacted error digests.';
