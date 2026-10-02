create unique index appointments_scope_id_financial_review on appointments(tenant_id,clinic_id,id);
-- Source observations are evidence, not vendor booking identifiers.
create table appointment_imports (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,clinic_id uuid not null,
 source_system text not null check(length(trim(source_system)) between 1 and 100),
 digest text not null check(digest ~ '^[0-9a-f]{64}$'),row_count integer not null check(row_count between 1 and 5000),
 sealed_at timestamptz,created_at timestamptz not null default now(),created_by_user_id uuid not null references users(id),
 unique(tenant_id,clinic_id,id),unique(tenant_id,clinic_id,source_system,digest),
 foreign key(tenant_id,clinic_id) references clinics(tenant_id,id)
);
create table appointment_source_observations (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,clinic_id uuid not null,import_id uuid not null,
 ordinal integer not null check(ordinal between 0 and 4999),source_data jsonb not null check(jsonb_typeof(source_data)='object'),
 decision text not null default 'pending' check(decision in ('pending','history','exclude','link','create')),
 reason text,appointment_id uuid,reviewed_at timestamptz,reviewed_by_user_id uuid references users(id),
 unique(tenant_id,clinic_id,import_id,ordinal),
 foreign key(tenant_id,clinic_id,import_id) references appointment_imports(tenant_id,clinic_id,id),
 foreign key(tenant_id,clinic_id,appointment_id) references appointments(tenant_id,clinic_id,id),
 check((decision='pending')=(reviewed_at is null)),
 check((decision in ('link','create'))=(appointment_id is not null)),
 check(decision='pending' or (length(trim(reason)) between 1 and 1000 and reviewed_by_user_id is not null))
);
create index appointment_observation_review on appointment_source_observations(tenant_id,clinic_id,import_id,decision,ordinal);
create function clinic_os.guard_appointment_observation() returns trigger language plpgsql as $$
begin
 if TG_OP='DELETE' then raise exception 'Source observations cannot be deleted';end if;
 if (to_jsonb(new)-array['decision','reason','appointment_id','reviewed_at','reviewed_by_user_id']) is distinct from (to_jsonb(old)-array['decision','reason','appointment_id','reviewed_at','reviewed_by_user_id']) or old.decision<>'pending' then raise exception 'Source evidence and completed decisions are immutable';end if;
 return new;
end;$$;
create trigger appointment_observation_immutable before update or delete on appointment_source_observations for each row execute function clinic_os.guard_appointment_observation();
create trigger appointment_import_immutable before update or delete on appointment_imports for each row execute function clinic_os.guard_patient_import_file();
alter table appointment_imports enable row level security;
alter table appointment_imports force row level security;
create policy appointment_import_scope on appointment_imports using(tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id()) with check(tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id());
alter table appointment_source_observations enable row level security;
alter table appointment_source_observations force row level security;
create policy appointment_observation_scope on appointment_source_observations using(tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id()) with check(tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id());
