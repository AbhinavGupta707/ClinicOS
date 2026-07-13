-- Checkpoint 15: durable, tenant-attributed scheduling for provider reconciliation.
-- The global worker can discover only due tenant/clinic identifiers here; provider evidence,
-- callback material and job rows remain behind their forced-RLS scoped tables.

create table provider_reconciliation_scope_queue (
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  due_at timestamptz not null,
  lease_owner text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, clinic_id),
  constraint provider_reconciliation_scope_queue_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint provider_reconciliation_scope_queue_lease_check check (
    (lease_owner is null and lease_expires_at is null)
    or (
      lease_owner is not null
      and lease_owner ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,94}$'
      and lease_expires_at is not null
    )
  )
);

create index provider_reconciliation_scope_queue_due_idx
  on provider_reconciliation_scope_queue (due_at, tenant_id, clinic_id);

alter table provider_reconciliation_scope_queue enable row level security;
alter table provider_reconciliation_scope_queue force row level security;

create policy provider_reconciliation_scope_queue_tenant_clinic
  on provider_reconciliation_scope_queue
  using (
    tenant_id = clinic_os.current_tenant_id()
    and clinic_id = clinic_os.current_clinic_id()
  )
  with check (
    tenant_id = clinic_os.current_tenant_id()
    and clinic_id = clinic_os.current_clinic_id()
  );

create policy provider_reconciliation_scope_queue_worker
  on provider_reconciliation_scope_queue
  for all
  using (current_user = 'clinic_os_worker')
  with check (current_user = 'clinic_os_worker');

create or replace function clinic_os.schedule_provider_reconciliation_scope()
returns trigger
language plpgsql
set search_path = pg_catalog, public, clinic_os
as $$
declare
  scheduled_at timestamptz;
begin
  if tg_table_name = 'meta_whatsapp_reconciliation_jobs' then
    scheduled_at := case
      when new.status in ('pending', 'provider_unavailable')
        then coalesce(new.next_attempt_at, new.created_at)
      when new.status = 'leased' then new.lease_expires_at
      else null
    end;
  elsif tg_table_name = 'razorpay_reconciliation_jobs' then
    scheduled_at := case
      when new.status = 'pending' then new.created_at
      when new.status = 'retry_scheduled' then new.next_attempt_at
      when new.status = 'leased' then new.lease_expires_at
      else null
    end;
  else
    raise exception 'Unsupported provider reconciliation queue source';
  end if;

  if scheduled_at is not null then
    insert into provider_reconciliation_scope_queue (
      tenant_id, clinic_id, due_at
    ) values (
      new.tenant_id, new.clinic_id, scheduled_at
    )
    on conflict (tenant_id, clinic_id) do update
      set due_at = least(provider_reconciliation_scope_queue.due_at, excluded.due_at),
          updated_at = now();
  end if;
  return new;
end
$$;

revoke all on function clinic_os.schedule_provider_reconciliation_scope() from public;

create trigger meta_whatsapp_reconciliation_schedule_scope
after insert or update of status, attempt_count, next_attempt_at, lease_expires_at
on meta_whatsapp_reconciliation_jobs
for each row execute function clinic_os.schedule_provider_reconciliation_scope();

create trigger razorpay_reconciliation_schedule_scope
after insert or update of status, attempt_count, next_attempt_at, lease_expires_at
on razorpay_reconciliation_jobs
for each row execute function clinic_os.schedule_provider_reconciliation_scope();

-- Queue active jobs created before this migration. The migrator policies exist only for this
-- transactional backfill and are removed before application roles receive queue privileges.
create policy cp15_reconciliation_backfill_meta_migrator
  on meta_whatsapp_reconciliation_jobs for select
  using (current_user = 'clinic_os_migrator');
create policy cp15_reconciliation_backfill_razorpay_migrator
  on razorpay_reconciliation_jobs for select
  using (current_user = 'clinic_os_migrator');
create policy cp15_reconciliation_backfill_queue_migrator
  on provider_reconciliation_scope_queue for insert
  with check (current_user = 'clinic_os_migrator');

insert into provider_reconciliation_scope_queue (tenant_id, clinic_id, due_at)
select candidate.tenant_id, candidate.clinic_id, min(candidate.due_at)
  from (
    select tenant_id, clinic_id,
           case
             when status in ('pending', 'provider_unavailable')
               then coalesce(next_attempt_at, created_at)
             when status = 'leased' then lease_expires_at
           end as due_at
      from meta_whatsapp_reconciliation_jobs
     where status in ('pending', 'provider_unavailable', 'leased')
    union all
    select tenant_id, clinic_id,
           case
             when status = 'pending' then created_at
             when status = 'retry_scheduled' then next_attempt_at
             when status = 'leased' then lease_expires_at
           end as due_at
      from razorpay_reconciliation_jobs
     where status in ('pending', 'retry_scheduled', 'leased')
  ) candidate
 where candidate.due_at is not null
 group by candidate.tenant_id, candidate.clinic_id
on conflict (tenant_id, clinic_id) do update
  set due_at = least(provider_reconciliation_scope_queue.due_at, excluded.due_at),
      updated_at = now();

drop policy cp15_reconciliation_backfill_meta_migrator
  on meta_whatsapp_reconciliation_jobs;
drop policy cp15_reconciliation_backfill_razorpay_migrator
  on razorpay_reconciliation_jobs;
drop policy cp15_reconciliation_backfill_queue_migrator
  on provider_reconciliation_scope_queue;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'clinic_os_runtime') then
    grant select, insert, update, delete on provider_reconciliation_scope_queue
      to clinic_os_runtime;
  end if;
  if exists (select 1 from pg_roles where rolname = 'clinic_os_worker') then
    grant select, insert, update, delete on provider_reconciliation_scope_queue
      to clinic_os_worker;
  end if;
end
$$;

comment on table provider_reconciliation_scope_queue is
  'Forced-RLS scheduler containing only tenant/clinic scope and lease metadata. Provider payloads, external identifiers and secrets are prohibited.';
