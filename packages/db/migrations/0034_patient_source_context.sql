-- Preserve v1 manifests. Context-bearing files may split groups at byte boundaries.
alter table patient_import_files drop constraint patient_import_files_profile_check;
alter table patient_import_files add constraint patient_import_files_profile_check
  check (profile in ('practo_ray_patients_v1', 'practo_ray_patients_context_v2'));
alter table patient_import_files drop constraint patient_import_files_manifest_check;
alter table patient_import_files add constraint patient_import_files_manifest_check
  check (jsonb_typeof(manifest) = 'array' and jsonb_array_length(manifest) between 1 and 1024);
alter table patient_import_chunks drop constraint patient_import_chunks_ordinal_check;
alter table patient_import_chunks add constraint patient_import_chunks_ordinal_check check (ordinal between 0 and 1023);

alter table migration_rows add constraint migration_rows_context_identity unique (tenant_id,clinic_id,batch_id,id);

create table patient_source_contexts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  clinic_id uuid not null,
  patient_id uuid not null,
  source_system text not null check (length(source_system) between 1 and 100),
  external_reference text not null check (length(external_reference) between 1 and 512),
  source_format text not null check (source_format = 'practo_ray_patients_context_v2'),
  version integer not null check (version > 0),
  fields jsonb not null check (jsonb_typeof(fields) = 'object' and octet_length(fields::text) <= 65536),
  contact_unavailable boolean not null,
  content_digest char(64) not null check (content_digest ~ '^[0-9a-f]{64}$'),
  import_batch_id uuid not null,
  import_row_id uuid not null,
  position bigint generated always as identity unique,
  imported_at timestamptz not null default clock_timestamp(),
  imported_by_user_id uuid not null references users(id),
  unique (tenant_id, clinic_id, id),
  unique (tenant_id, clinic_id, source_system, external_reference, version),
  foreign key (tenant_id, clinic_id, patient_id) references patients(tenant_id, clinic_id, id) on delete restrict,
  foreign key (tenant_id, clinic_id, import_batch_id) references migration_batches(tenant_id, clinic_id, id) on delete restrict,
  foreign key (tenant_id,clinic_id,import_batch_id,import_row_id) references migration_rows(tenant_id,clinic_id,batch_id,id) on delete restrict
);
create index patient_source_contexts_patient_page on patient_source_contexts(tenant_id,clinic_id,patient_id,position desc);
create table patient_source_context_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  clinic_id uuid not null,
  context_id uuid not null,
  decision text not null check (decision in ('reviewed','needs_clarification')),
  note text not null check (length(trim(note)) between 5 and 2000),
  reviewed_by_user_id uuid not null references users(id),
  revision integer not null check (revision > 0),
  reviewed_at timestamptz not null default clock_timestamp(),
  unique (tenant_id,clinic_id,context_id,revision),
  foreign key (tenant_id,clinic_id,context_id) references patient_source_contexts(tenant_id,clinic_id,id) on delete restrict
);
create index patient_source_context_reviews_latest on patient_source_context_reviews(tenant_id,clinic_id,context_id,revision desc);
create trigger patient_source_context_immutable before update or delete on patient_source_contexts
  for each row execute function clinic_os.reject_import_run_mutation();
create trigger patient_source_context_review_immutable before update or delete on patient_source_context_reviews
  for each row execute function clinic_os.reject_import_run_mutation();
alter table patient_source_contexts enable row level security;
alter table patient_source_contexts force row level security;
create policy patient_source_context_scope on patient_source_contexts
  using (tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id())
  with check (tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id());
alter table patient_source_context_reviews enable row level security;
alter table patient_source_context_reviews force row level security;
create policy patient_source_context_review_scope on patient_source_context_reviews
  using (tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id())
  with check (tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id());
