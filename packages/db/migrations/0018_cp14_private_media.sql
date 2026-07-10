-- Checkpoint 14: durable, tenant-isolated private-media lifecycle persistence.
-- The application supplies the transaction; this migration never creates a parallel outbox.

do
$$
begin
  if exists (
    select 1
    from media_uploads
    where storage_provider = 's3'
      and (
        storage_region is null
        or expected_sha256_digest is null
        or expected_sha256_digest !~ '^[0-9a-f]{64}$'
        or length(trim(object_key)) = 0
      )
  ) then
    raise exception using
      message = 'CP14 private-media migration blocked by an incomplete S3 reservation',
      hint = 'Reconcile the affected reservation from clinic-approved upload evidence before applying migration 0018; do not infer a region, digest, or object key.';
  end if;
end
$$;

alter table media_uploads
  add constraint media_uploads_s3_private_binding_check check (
    storage_provider <> 's3'
    or (
      storage_region is not null
      and expected_sha256_digest ~ '^[0-9a-f]{64}$'
      and length(trim(object_key)) > 0
    )
  ) not valid;

alter table media_uploads
  validate constraint media_uploads_s3_private_binding_check;

alter table media_uploads
  add constraint media_uploads_private_binding_uq unique (
    tenant_id, clinic_id, id, object_key, storage_provider, storage_region,
    media_type, mime_type, expected_file_size_bytes, expected_sha256_digest, expires_at
  );

create table private_media_records (
  tenant_id uuid not null,
  clinic_id uuid not null,
  media_id uuid not null,
  upload_id uuid not null,
  revision bigint not null check (revision > 0),
  bucket text not null check (length(bucket) between 3 and 255),
  object_key text not null check (length(object_key) between 1 and 1024),
  storage_provider text not null default 's3' check (storage_provider = 's3'),
  region text not null check (region ~ '^[a-z]{2}(-gov)?-[a-z]+-[0-9]$'),
  kind text not null check (kind in (
    'intraoral_photo', 'xray', 'document', 'audio_chunk', 'generated_document'
  )),
  declared_mime_type text not null check (length(declared_mime_type) between 3 and 192),
  detected_mime_type text check (detected_mime_type is null or length(detected_mime_type) between 3 and 192),
  expected_bytes bigint not null check (expected_bytes > 0),
  expected_sha256_hex text not null check (expected_sha256_hex ~ '^[0-9a-f]{64}$'),
  authority_binding text not null check (length(authority_binding) between 32 and 256),
  state text not null check (state in (
    'reserved', 'upload_verified', 'scan_in_progress', 'available', 'quarantined',
    'scan_failed', 'delete_in_progress', 'deleted', 'restore_in_progress',
    'purge_in_progress', 'purged'
  )),
  expires_at timestamptz not null,
  object_version_id text,
  object_identity_sha256 text check (
    object_identity_sha256 is null or object_identity_sha256 ~ '^[0-9a-f]{64}$'
  ),
  scan_attempts integer not null default 0 check (scan_attempts between 0 and 10),
  last_evidence_id text,
  last_evidence_digest_sha256 text check (
    last_evidence_digest_sha256 is null or last_evidence_digest_sha256 ~ '^[0-9a-f]{64}$'
  ),
  last_scanned_at timestamptz,
  inspection_lease_id text,
  inspection_lease_expires_at timestamptz,
  pending_operation_id text,
  delete_marker_version_id text,
  deleted_at timestamptz,
  recoverable_until timestamptz,
  legal_hold boolean not null default false,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (tenant_id, clinic_id, media_id, upload_id),
  constraint private_media_records_media_upload_identity_check check (media_id = upload_id),
  constraint private_media_records_upload_fk foreign key (
    tenant_id, clinic_id, upload_id, object_key, storage_provider, region,
    kind, declared_mime_type, expected_bytes, expected_sha256_hex, expires_at
  ) references media_uploads (
    tenant_id, clinic_id, id, object_key, storage_provider, storage_region,
    media_type, mime_type, expected_file_size_bytes, expected_sha256_digest, expires_at
  ) on delete restrict,
  constraint private_media_records_scan_lease_check check (
    (state = 'scan_in_progress'
      and inspection_lease_id is not null
      and inspection_lease_expires_at is not null
      and pending_operation_id is not null)
    or state <> 'scan_in_progress'
  ),
  constraint private_media_records_deleted_check check (
    (state = 'deleted'
      and delete_marker_version_id is not null
      and deleted_at is not null
      and recoverable_until is not null)
    or state <> 'deleted'
  ),
  constraint private_media_records_lifecycle_intent_check check (
    state not in ('delete_in_progress', 'restore_in_progress', 'purge_in_progress')
    or pending_operation_id is not null
  )
);

create index private_media_records_state_idx
  on private_media_records (tenant_id, clinic_id, state, updated_at);
create index private_media_records_scan_lease_idx
  on private_media_records (tenant_id, clinic_id, inspection_lease_expires_at)
  where state = 'scan_in_progress';
create index private_media_records_recovery_idx
  on private_media_records (tenant_id, clinic_id, recoverable_until)
  where state = 'deleted' and legal_hold = false;

create table private_media_scan_evidence (
  evidence_id text not null,
  tenant_id uuid not null,
  clinic_id uuid not null,
  media_id uuid not null,
  upload_id uuid not null,
  evidence_digest_sha256 text not null check (evidence_digest_sha256 ~ '^[0-9a-f]{64}$'),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  recorded_at timestamptz not null,
  primary key (tenant_id, clinic_id, evidence_id),
  constraint private_media_scan_evidence_record_fk foreign key (
    tenant_id, clinic_id, media_id, upload_id
  ) references private_media_records (
    tenant_id, clinic_id, media_id, upload_id
  ) on delete restrict,
  unique (tenant_id, clinic_id, media_id, upload_id, evidence_id)
);

alter table private_media_records
  add constraint private_media_records_last_evidence_fk foreign key (
    tenant_id, clinic_id, media_id, upload_id, last_evidence_id
  ) references private_media_scan_evidence (
    tenant_id, clinic_id, media_id, upload_id, evidence_id
  ) on delete restrict;

create index private_media_scan_evidence_scope_idx
  on private_media_scan_evidence (tenant_id, clinic_id, media_id, upload_id, recorded_at);

create table private_media_operations (
  operation_id text primary key,
  operation_kind text not null check (operation_kind in (
    'reserve', 'transition', 'scan_success', 'scan_conflict', 'audit'
  )),
  tenant_id uuid not null,
  clinic_id uuid not null,
  media_id uuid not null,
  upload_id uuid not null,
  semantic_fingerprint_sha256 text not null check (semantic_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  write_fingerprint_sha256 text not null check (write_fingerprint_sha256 ~ '^[0-9a-f]{64}$'),
  expected_revision bigint,
  target_revision bigint,
  audit_event_id text not null unique,
  audit_event_uuid uuid not null unique references audit_events(id) on delete restrict,
  intent_id text not null unique,
  outbox_event_uuid uuid not null unique references outbox_events(id) on delete restrict,
  created_at timestamptz not null,
  constraint private_media_operations_record_fk foreign key (
    tenant_id, clinic_id, media_id, upload_id
  ) references private_media_records (
    tenant_id, clinic_id, media_id, upload_id
  ) on delete restrict,
  constraint private_media_operations_revision_pair_check check (
    (expected_revision is null and target_revision is null)
    or target_revision = expected_revision + 1
    or (expected_revision is null and target_revision = 1)
  )
);

create index private_media_operations_scope_idx
  on private_media_operations (tenant_id, clinic_id, media_id, upload_id, created_at);

create or replace function clinic_os.prevent_private_media_history_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'private media operation/evidence history is immutable';
end;
$$;

create trigger private_media_operations_immutable
before update or delete on private_media_operations
for each row execute function clinic_os.prevent_private_media_history_mutation();
create trigger private_media_scan_evidence_immutable
before update or delete on private_media_scan_evidence
for each row execute function clinic_os.prevent_private_media_history_mutation();

alter table private_media_records enable row level security;
alter table private_media_records force row level security;
create policy private_media_records_scope on private_media_records
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table private_media_scan_evidence enable row level security;
alter table private_media_scan_evidence force row level security;
create policy private_media_scan_evidence_scope on private_media_scan_evidence
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table private_media_operations enable row level security;
alter table private_media_operations force row level security;
create policy private_media_operations_scope on private_media_operations
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

do
$$
begin
  if exists (select 1 from pg_roles where rolname = 'clinic_os_runtime') then
    grant select, insert, update on table private_media_records to clinic_os_runtime;
    revoke delete, truncate on table private_media_records from clinic_os_runtime;
    grant select, insert on table private_media_scan_evidence, private_media_operations to clinic_os_runtime;
    revoke update, delete, truncate on table private_media_scan_evidence, private_media_operations from clinic_os_runtime;
  end if;
  if exists (select 1 from pg_roles where rolname = 'clinic_os_worker') then
    revoke all on table private_media_records, private_media_scan_evidence, private_media_operations from clinic_os_worker;
  end if;
end
$$;

comment on table private_media_records is
  'Canonical transaction-bound state for versioned, quarantined private clinical media.';
comment on table private_media_scan_evidence is
  'Immutable tenant-scoped signed malware-scanner evidence for private clinical media.';
comment on table private_media_operations is
  'Immutable idempotency, audit, and canonical-outbox linkage for private-media operations.';
