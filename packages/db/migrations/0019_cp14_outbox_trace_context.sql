-- Checkpoint 14: durable W3C trace correlation for canonical outbox events.
-- Trace metadata is deliberately stored outside clinical event payloads.

create table outbox_trace_contexts (
  event_id uuid primary key references outbox_events(id) on delete restrict,
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  traceparent char(55) not null check (
    traceparent ~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$'
  ),
  recorded_at timestamptz not null default now(),
  constraint outbox_trace_contexts_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create index outbox_trace_contexts_scope_idx
  on outbox_trace_contexts (tenant_id, clinic_id, recorded_at);

alter table outbox_trace_contexts enable row level security;
alter table outbox_trace_contexts force row level security;

create policy outbox_trace_contexts_tenant_clinic_isolation on outbox_trace_contexts
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (
    tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id()
  );

create policy outbox_trace_contexts_worker_read on outbox_trace_contexts
  for select
  using (current_user = 'clinic_os_worker');

create or replace function clinic_os.capture_outbox_trace_context()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  active_traceparent text;
begin
  active_traceparent := current_setting('app.traceparent', true);
  if active_traceparent is null
    or active_traceparent !~ '^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$'
  then
    return new;
  end if;

  insert into public.outbox_trace_contexts (
    event_id, tenant_id, clinic_id, traceparent, recorded_at
  ) values (
    new.id, new.tenant_id, new.clinic_id, active_traceparent, now()
  );
  return new;
end;
$$;

create trigger outbox_events_capture_trace_context
after insert on outbox_events
for each row execute function clinic_os.capture_outbox_trace_context();

create or replace function clinic_os.prevent_outbox_trace_context_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'outbox trace context is immutable';
end;
$$;

create trigger outbox_trace_contexts_immutable
before update or delete on outbox_trace_contexts
for each row execute function clinic_os.prevent_outbox_trace_context_mutation();

do
$$
begin
  if exists (select 1 from pg_roles where rolname = 'clinic_os_runtime') then
    revoke all on table outbox_trace_contexts from clinic_os_runtime;
  end if;
  if exists (select 1 from pg_roles where rolname = 'clinic_os_worker') then
    grant select on table outbox_trace_contexts to clinic_os_worker;
    revoke insert, update, delete, truncate on table outbox_trace_contexts from clinic_os_worker;
  end if;
end
$$;

comment on table outbox_trace_contexts is
  'Immutable tenant-scoped W3C trace correlation stored separately from canonical outbox payloads.';
