-- Immutable, clinic-scoped operator import sessions over existing migration batches.
create table import_runs (
  id uuid not null,
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  source_system text not null check (length(trim(source_system)) > 0),
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (tenant_id, clinic_id, id),
  constraint import_runs_clinic_fk foreign key (tenant_id, clinic_id)
    references clinics(tenant_id, id) on delete restrict,
  constraint import_runs_creator_membership_fk foreign key (tenant_id, created_by_user_id)
    references memberships(tenant_id, user_id) on delete restrict
);

create index import_runs_recent_idx on import_runs(tenant_id, clinic_id, created_at desc, id desc);

create function clinic_os.reject_import_run_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'Import runs are immutable';
end;
$$;
create trigger import_runs_immutable
before update or delete on import_runs
for each row execute function clinic_os.reject_import_run_mutation();

alter table migration_batches add column import_run_id uuid;
alter table migration_batches add column import_step_digest char(64);
alter table migration_batches add constraint migration_batches_run_fk
  foreign key (tenant_id, clinic_id, import_run_id)
  references import_runs(tenant_id, clinic_id, id) on delete restrict;
alter table migration_batches add constraint migration_batches_run_step_shape_check check (
  (import_run_id is null and import_step_digest is null)
  or (import_run_id is not null and import_step_digest is not null
      and import_step_digest ~ '^[0-9a-f]{64}$'
      and import_type in ('patients', 'practitioners', 'appointments'))
);
create unique index migration_batches_one_step_per_run_idx
  on migration_batches(tenant_id, clinic_id, import_run_id, import_type)
  where import_run_id is not null;

alter table import_runs enable row level security;
alter table import_runs force row level security;
create policy import_runs_tenant_clinic_isolation on import_runs
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
