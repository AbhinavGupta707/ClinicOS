alter table outbox_events no force row level security;

alter table outbox_events
  add column if not exists status text not null default 'pending',
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists locked_by text,
  add column if not exists locked_until timestamptz,
  add column if not exists processed_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update outbox_events
set
  status = case when published_at is null then 'pending' else 'processed' end,
  processed_at = coalesce(processed_at, published_at),
  correlation_id = coalesce(correlation_id, id::text),
  idempotency_key = coalesce(idempotency_key, 'outbox:' || id::text),
  updated_at = coalesce(updated_at, created_at);

alter table outbox_events
  alter column correlation_id set not null,
  alter column idempotency_key set not null,
  add constraint outbox_events_status_check
    check (status in ('pending', 'processing', 'processed', 'retry_scheduled', 'dead_lettered', 'cancelled')),
  add constraint outbox_events_attempt_count_check check (attempt_count >= 0),
  add constraint outbox_events_lock_check check (
    (locked_by is null and locked_until is null)
    or (locked_by is not null and locked_until is not null)
  );

create index if not exists outbox_events_processing_idx
  on outbox_events(status, next_attempt_at, occurred_at)
  where status in ('pending', 'retry_scheduled');

drop policy if exists outbox_events_worker_processing on outbox_events;
create policy outbox_events_worker_processing on outbox_events
  for all
  using (current_user = 'clinic_os_worker')
  with check (current_user = 'clinic_os_worker');

alter table outbox_events force row level security;

create table if not exists outbox_attempts (
  attempt_id uuid primary key,
  event_id uuid not null references outbox_events(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  attempt_number integer not null check (attempt_number > 0),
  worker_id text not null check (length(trim(worker_id)) > 0),
  status text not null check (
    status in ('started', 'succeeded', 'retry_scheduled', 'failed_permanent', 'failed_exhausted')
  ),
  started_at timestamptz not null,
  finished_at timestamptz,
  error_code text,
  error_message text,
  next_attempt_at timestamptz,
  unique (event_id, attempt_number),
  constraint outbox_attempts_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create index if not exists outbox_attempts_event_idx
  on outbox_attempts(event_id, attempt_number);

alter table outbox_attempts enable row level security;
alter table outbox_attempts force row level security;
drop policy if exists outbox_attempts_tenant_clinic_isolation on outbox_attempts;
create policy outbox_attempts_tenant_clinic_isolation on outbox_attempts
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
drop policy if exists outbox_attempts_worker_processing on outbox_attempts;
create policy outbox_attempts_worker_processing on outbox_attempts
  for all
  using (current_user = 'clinic_os_worker')
  with check (current_user = 'clinic_os_worker');

create table if not exists dead_letter_events (
  dead_letter_id uuid primary key,
  event_id uuid not null unique references outbox_events(id) on delete restrict,
  event_type text not null,
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  correlation_id text not null,
  idempotency_key text not null,
  failed_attempt_id uuid not null references outbox_attempts(attempt_id) on delete restrict,
  failed_at timestamptz not null,
  failure_code text not null check (length(trim(failure_code)) > 0),
  failure_message text not null check (length(trim(failure_message)) > 0),
  review_status text not null default 'unreviewed' check (
    review_status in ('unreviewed', 'reviewing', 'replayed', 'ignored')
  ),
  event jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dead_letter_events_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create index if not exists dead_letter_events_review_idx
  on dead_letter_events(tenant_id, clinic_id, review_status, failed_at desc);

alter table dead_letter_events enable row level security;
alter table dead_letter_events force row level security;
drop policy if exists dead_letter_events_tenant_clinic_isolation on dead_letter_events;
create policy dead_letter_events_tenant_clinic_isolation on dead_letter_events
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
drop policy if exists dead_letter_events_worker_processing on dead_letter_events;
create policy dead_letter_events_worker_processing on dead_letter_events
  for all
  using (current_user = 'clinic_os_worker')
  with check (current_user = 'clinic_os_worker');

do
$$
begin
  if exists (select 1 from pg_roles where rolname = 'clinic_os_worker') then
    grant usage on schema public to clinic_os_worker;
    grant select, update on table outbox_events to clinic_os_worker;
    grant select, insert, update on table outbox_attempts to clinic_os_worker;
    grant select, insert, update on table dead_letter_events to clinic_os_worker;
  end if;
end
$$;

comment on table outbox_attempts is
  'Durable, tenant-attributed outbox delivery attempts. Worker access is limited to the outbox processing tables.';
comment on table dead_letter_events is
  'Reviewable durable outbox failures. Rows preserve the sanitized event envelope and never imply provider success.';
