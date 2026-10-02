-- One immutable, bounded patient-file manifest over existing migration batches.
-- Raw vendor files are never stored. Chunk batches retain the canonical review,
-- identity, commit and compensation machinery.
alter table migration_batches add constraint migration_batches_scoped_identity
  unique (tenant_id, clinic_id, id);

create table patient_import_files (
  tenant_id uuid not null,
  clinic_id uuid not null,
  run_id uuid not null,
  profile text not null check (profile = 'practo_ray_patients_v1'),
  row_count integer not null check (row_count between 1 and 5000),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'array'
    and jsonb_array_length(manifest) between 1 and 50),
  sealed_at timestamptz,
  primary key (tenant_id, clinic_id, run_id),
  foreign key (tenant_id, clinic_id, run_id)
    references import_runs(tenant_id, clinic_id, id) on delete restrict
);

create table patient_import_chunks (
  tenant_id uuid not null,
  clinic_id uuid not null,
  run_id uuid not null,
  ordinal integer not null check (ordinal between 0 and 49),
  batch_id uuid not null,
  digest char(64) not null check (digest ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count between 1 and 100),
  primary key (tenant_id, clinic_id, run_id, ordinal),
  unique (tenant_id, clinic_id, batch_id),
  foreign key (tenant_id, clinic_id, run_id)
    references patient_import_files(tenant_id, clinic_id, run_id) on delete restrict,
  foreign key (tenant_id, clinic_id, batch_id)
    references migration_batches(tenant_id, clinic_id, id) on delete restrict
);

create function clinic_os.guard_patient_import_file() returns trigger
language plpgsql as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'Patient import manifest is immutable';
  end if;
  if (to_jsonb(new) - 'sealed_at') is distinct from (to_jsonb(old) - 'sealed_at')
     or (old.sealed_at is not null and new.sealed_at is distinct from old.sealed_at) then
    raise exception 'Patient import manifest is immutable';
  end if;
  return new;
end;
$$;
create trigger patient_import_file_immutable before update or delete on patient_import_files
  for each row execute function clinic_os.guard_patient_import_file();
create trigger patient_import_chunk_immutable before update or delete on patient_import_chunks
  for each row execute function clinic_os.reject_import_run_mutation();

alter table patient_import_files enable row level security;
alter table patient_import_files force row level security;
create policy patient_import_files_scope on patient_import_files
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
alter table patient_import_chunks enable row level security;
alter table patient_import_chunks force row level security;
create policy patient_import_chunks_scope on patient_import_chunks
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
