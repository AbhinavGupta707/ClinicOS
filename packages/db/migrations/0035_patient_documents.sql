create table patient_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  clinic_id uuid not null,
  patient_id uuid not null,
  kind text not null check(kind in ('prescription','estimate','invoice','receipt','instruction','lab_slip')),
  source_id uuid not null,
  source_digest char(64) not null check(source_digest ~ '^[0-9a-f]{64}$'),
  revision integer not null check(revision > 0),
  renderer_version integer not null check(renderer_version = 1),
  snapshot jsonb not null check(jsonb_typeof(snapshot)='object' and octet_length(snapshot::text)<=600000),
  html_digest char(64) not null check(html_digest ~ '^[0-9a-f]{64}$'),
  generated_at timestamptz not null,
  generated_by_user_id uuid not null references users(id),
  generated_by_display_name text not null,
  previous_document_id uuid,
  unique(tenant_id,clinic_id,id),
  unique(tenant_id,clinic_id,patient_id,kind,source_id,revision),
  foreign key(tenant_id,clinic_id,patient_id) references patients(tenant_id,clinic_id,id) on delete restrict,
  foreign key(tenant_id,clinic_id,previous_document_id) references patient_documents(tenant_id,clinic_id,id) on delete restrict
);
create trigger patient_documents_immutable before update or delete on patient_documents
  for each row execute function clinic_os.reject_import_run_mutation();
alter table patient_documents enable row level security;
alter table patient_documents force row level security;
create policy patient_documents_scope on patient_documents
  using(tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id())
  with check(tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id());
