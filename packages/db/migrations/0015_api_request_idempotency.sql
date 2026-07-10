-- Checkpoint 12: durable, transaction-coupled API idempotency records.
-- Request authority is derived by the API and RLS context; no client-supplied tenant/actor fields
-- are accepted by the runtime contract.

create table if not exists api_idempotency_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  actor_user_id uuid not null references users(id) on delete restrict,
  operation_id text not null check (
    length(operation_id) between 1 and 160
    and operation_id ~ '^[A-Za-z][A-Za-z0-9._-]*$'
  ),
  idempotency_key text not null check (length(idempotency_key) between 8 and 200),
  request_digest char(64) not null check (request_digest ~ '^[0-9a-f]{64}$'),
  state text not null default 'processing' check (
    state in ('processing', 'completed', 'expired')
  ),
  lease_owner text check (lease_owner is null or length(lease_owner) between 1 and 200),
  lease_expires_at timestamptz,
  response_status integer check (response_status between 200 and 599),
  response_headers jsonb not null default '{}'::jsonb check (
    jsonb_typeof(response_headers) = 'object'
    and octet_length(response_headers::text) <= 16384
  ),
  response_body jsonb check (
    response_body is null or octet_length(response_body::text) <= 2097152
  ),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz,
  expired_at timestamptz,
  constraint api_idempotency_records_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint api_idempotency_records_actor_membership_fk
    foreign key (tenant_id, actor_user_id) references memberships(tenant_id, user_id) on delete restrict,
  constraint api_idempotency_records_identity_unique
    unique (tenant_id, clinic_id, actor_user_id, operation_id, idempotency_key),
  constraint api_idempotency_records_state_shape_check check (
    (
      state = 'processing'
      and lease_owner is not null
      and lease_expires_at is not null
      and lease_expires_at > created_at
      and response_status is null
      and response_headers = '{}'::jsonb
      and response_body is null
      and completed_at is null
      and expires_at is null
      and expired_at is null
    )
    or
    (
      state = 'completed'
      and lease_owner is null
      and lease_expires_at is null
      and response_status is not null
      and completed_at is not null
      and expires_at > completed_at
      and expired_at is null
    )
    or
    (
      state = 'expired'
      and lease_owner is null
      and lease_expires_at is null
      and response_status is null
      and response_headers = '{}'::jsonb
      and response_body is null
      and completed_at is not null
      and expires_at > completed_at
      and expired_at is not null
      and expired_at >= expires_at
    )
  )
);

alter table patients add column if not exists row_version bigint not null default 1
  check (row_version > 0);
alter table leads add column if not exists row_version bigint not null default 1
  check (row_version > 0);
alter table appointments add column if not exists row_version bigint not null default 1
  check (row_version > 0);
alter table queue_entries add column if not exists row_version bigint not null default 1
  check (row_version > 0);
alter table encounters add column if not exists row_version bigint not null default 1
  check (row_version > 0);
alter table dental_findings add column if not exists row_version bigint not null default 1
  check (row_version > 0);
alter table treatment_plans add column if not exists row_version bigint not null default 1
  check (row_version > 0);
alter table tasks add column if not exists row_version bigint not null default 1
  check (row_version > 0);
alter table sop_runs add column if not exists row_version bigint not null default 1
  check (row_version > 0);
alter table lab_cases add column if not exists row_version bigint not null default 1
  check (row_version > 0);
alter table inventory_check_runs add column if not exists row_version bigint not null default 1
  check (row_version > 0);
alter table corrective_actions add column if not exists row_version bigint not null default 1
  check (row_version > 0);

create index if not exists api_idempotency_records_expiry_idx
  on api_idempotency_records(expires_at)
  where state = 'completed';

alter table api_idempotency_records enable row level security;
alter table api_idempotency_records force row level security;

drop policy if exists api_idempotency_records_request_scope on api_idempotency_records;
create policy api_idempotency_records_request_scope on api_idempotency_records
  using (
    tenant_id = clinic_os.current_tenant_id()
    and clinic_id = clinic_os.current_clinic_id()
    and actor_user_id = clinic_os.current_user_id()
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and clinic_id = clinic_os.current_clinic_id()
    and actor_user_id = clinic_os.current_user_id()
  );

create or replace function clinic_os.protect_api_idempotency_record()
returns trigger
language plpgsql
as $$
begin
  if row(
    new.tenant_id,
    new.clinic_id,
    new.actor_user_id,
    new.operation_id,
    new.idempotency_key,
    new.request_digest,
    new.created_at
  ) is distinct from row(
    old.tenant_id,
    old.clinic_id,
    old.actor_user_id,
    old.operation_id,
    old.idempotency_key,
    old.request_digest,
    old.created_at
  ) then
    raise exception 'API idempotency request identity is immutable';
  end if;

  if old.state = 'processing' and new.state not in ('processing', 'completed') then
    raise exception 'API idempotency records may only renew a lease or complete processing';
  end if;

  if old.state = 'completed' and new.state <> 'expired' then
    raise exception 'Completed API idempotency responses are immutable';
  end if;

  if old.state = 'expired' then
    raise exception 'Expired API idempotency tombstones are immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists api_idempotency_records_protect on api_idempotency_records;
create trigger api_idempotency_records_protect
before update on api_idempotency_records
for each row execute function clinic_os.protect_api_idempotency_record();

do
$$
begin
  if exists (select 1 from pg_roles where rolname = 'clinic_os_runtime') then
    grant select, insert, update on table api_idempotency_records to clinic_os_runtime;
    revoke delete, truncate on table api_idempotency_records from clinic_os_runtime;
  end if;

  if exists (select 1 from pg_roles where rolname = 'clinic_os_worker') then
    revoke all on table api_idempotency_records from clinic_os_worker;
  end if;
end
$$;

comment on table api_idempotency_records is
  'RLS-scoped API mutation replay records. The request digest and sanitized response are committed atomically with the domain mutation; expired rows retain only an immutable key tombstone.';
comment on column api_idempotency_records.response_headers is
  'Allowlisted replay headers only. Authentication, cookies, infrastructure headers and secrets must never be stored.';
comment on column api_idempotency_records.response_body is
  'Bounded public API response JSON. General logs and error telemetry must never copy this field.';
comment on column api_idempotency_records.lease_owner is
  'Opaque request lease owner used only to recover an unexpectedly committed processing claim.';
comment on column patients.row_version is 'Atomic If-Match source for updatePatient.';
comment on column leads.row_version is 'Atomic If-Match source for updateLeadStatus.';
comment on column appointments.row_version is 'Atomic If-Match source for updateAppointment.';
comment on column queue_entries.row_version is 'Atomic If-Match source for updateQueueEntry.';
comment on column encounters.row_version is 'Atomic If-Match source for saveEncounterClinicalNoteDraft.';
comment on column dental_findings.row_version is 'Atomic If-Match source for updateDentalFinding.';
comment on column treatment_plans.row_version is 'Atomic If-Match source for updateTreatmentPlan.';
comment on column tasks.row_version is 'Atomic If-Match source for updateTask.';
comment on column sop_runs.row_version is 'Atomic If-Match source for updateSopRun.';
comment on column lab_cases.row_version is 'Atomic If-Match source for updateLabCase.';
comment on column inventory_check_runs.row_version is
  'Atomic If-Match source for updateInventoryCheckRun.';
comment on column corrective_actions.row_version is
  'Atomic If-Match source for updateCorrectiveAction.';
