-- CP13 durable integrity, media receipts, atomic check-in, and provider recovery seams.
--
-- Flyway runs this migration transactionally. PostgreSQL does not permit CREATE INDEX
-- CONCURRENTLY in that transaction, so the supporting indexes below are ordinary index builds.
-- Production rollout must budget the resulting table locks or use an approved expand/validate
-- maintenance sequence; this migration never silently rewrites or deletes legacy clinical data.

-- Add only nullable evidence columns before preflight. No constraint is installed until legacy
-- rows that cannot be proved safe have caused an actionable abort.
alter table raw_webhook_events
  add column if not exists event_kind text,
  add column if not exists raw_body_sha256 char(64),
  add column if not exists signature_sha256 char(64),
  add column if not exists normalized_event_sha256 char(64),
  add column if not exists normalized_event jsonb,
  add column if not exists evidence_state text not null default 'unverified',
  add column if not exists mismatch_reason text,
  add column if not exists lease_owner text,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists result_digest char(64),
  add column if not exists result_projection jsonb;

do $$
declare
  invalid_relationship text;
begin
  if exists (select 1 from media_uploads) or exists (select 1 from media_assets) then
    raise exception using
      message = 'CP13 durable-integrity preflight: existing clinical media rows may retain client original filenames',
      detail = 'Run an approved, audited media-filename privacy migration and verify provider/object provenance before applying migration 0017.',
      hint = 'Do not rename, delete, or rewrite clinical media rows implicitly.';
  end if;

  if exists (select 1 from raw_webhook_events where verification_status = 'verified') then
    raise exception using
      message = 'CP13 durable-integrity preflight: verified legacy webhook rows lack complete signature/raw-body/normalized fingerprints',
      detail = 'Reconcile each verified provider event against the registered provider account and retain audited fingerprint evidence before applying migration 0017.',
      hint = 'Do not synthesize missing provider evidence from parsed payloads.';
  end if;

  if exists (
    select 1
    from raw_webhook_events
    where external_account_id is not null and provider_event_id is not null
    group by tenant_id, external_account_id, provider_event_id
    having count(*) > 1
  ) then
    raise exception using
      message = 'CP13 durable-integrity preflight: duplicate account-scoped provider event identifiers exist',
      detail = 'Reconcile duplicates against signed raw-body evidence and the authoritative provider account before applying migration 0017.',
      hint = 'The migration will not choose or delete a provider event row implicitly.';
  end if;

  if exists (
    select 1
    from patient_instruction_requests instruction
    left join outbox_events event
      on event.tenant_id = instruction.tenant_id
     and event.clinic_id = instruction.clinic_id
     and event.id = instruction.outbox_event_id
    where instruction.outbox_event_id is not null and event.id is null
  ) then
    raise exception using
      message = 'CP13 durable-integrity preflight: patient instruction references an unbound outbox event identifier',
      detail = 'Clear only proven synthetic/unbound identifiers through an approved evidence migration, or bind the actual durable outbox row before applying migration 0017.',
      hint = 'The migration will not invent an outbox event or silently remove the false linkage.';
  end if;

  select relationship into invalid_relationship
  from (
    select 'appointments.patient' as relationship
    from appointments child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'queue_entries.patient'
    from queue_entries child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'encounters.patient'
    from encounters child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'clinical_note_versions.patient'
    from clinical_note_versions child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'prescriptions.patient'
    from prescriptions child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'dental_findings.patient'
    from dental_findings child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'treatment_plans.patient'
    from treatment_plans child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'procedure_performed_records.patient'
    from procedure_performed_records child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'invoices.patient'
    from invoices child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'invoice_items.patient'
    from invoice_items child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'payment_requests.patient'
    from payment_requests child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'payment_transactions.patient'
    from payment_transactions child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'receipts.patient'
    from receipts child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'patient_instruction_requests.patient'
    from patient_instruction_requests child join patients parent on parent.tenant_id = child.tenant_id and parent.id = child.patient_id
    where parent.clinic_id <> child.clinic_id
  ) invalid
  limit 1;
  if invalid_relationship is not null then
    raise exception 'CP13 durable-integrity preflight: cross-clinic patient relationship in %', invalid_relationship
      using hint = 'Reconcile the named relationship with clinic-approved source evidence; migration 0017 will not rewrite clinical or financial ownership.';
  end if;

  select relationship into invalid_relationship
  from (
    select 'encounters.appointment_patient' as relationship
    from encounters child join appointments parent on parent.tenant_id = child.tenant_id and parent.id = child.appointment_id
    where child.appointment_id is not null
      and (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'clinical_note_versions.encounter_patient'
    from clinical_note_versions child join encounters parent on parent.tenant_id = child.tenant_id and parent.id = child.encounter_id
    where (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'prescriptions.encounter_patient'
    from prescriptions child join encounters parent on parent.tenant_id = child.tenant_id and parent.id = child.encounter_id
    where (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'dental_findings.encounter_patient'
    from dental_findings child join encounters parent on parent.tenant_id = child.tenant_id and parent.id = child.encounter_id
    where child.encounter_id is not null
      and (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'treatment_plans.encounter_patient'
    from treatment_plans child join encounters parent on parent.tenant_id = child.tenant_id and parent.id = child.encounter_id
    where child.encounter_id is not null
      and (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'procedure_performed_records.encounter_patient'
    from procedure_performed_records child join encounters parent on parent.tenant_id = child.tenant_id and parent.id = child.encounter_id
    where (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'procedure_performed_records.plan_patient'
    from procedure_performed_records child join treatment_plans parent on parent.tenant_id = child.tenant_id and parent.id = child.treatment_plan_id
    where (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'invoices.plan_patient'
    from invoices child join treatment_plans parent on parent.tenant_id = child.tenant_id and parent.id = child.treatment_plan_id
    where child.treatment_plan_id is not null
      and (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'payment_requests.invoice_patient'
    from payment_requests child join invoices parent on parent.tenant_id = child.tenant_id and parent.id = child.invoice_id
    where (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'payment_transactions.invoice_patient'
    from payment_transactions child join invoices parent on parent.tenant_id = child.tenant_id and parent.id = child.invoice_id
    where (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'receipts.invoice_patient'
    from receipts child join invoices parent on parent.tenant_id = child.tenant_id and parent.id = child.invoice_id
    where (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'treatment_plan_estimate_items.finding_patient'
    from treatment_plan_estimate_items item
    join treatment_plans plan on plan.tenant_id = item.tenant_id and plan.id = item.treatment_plan_id
    join dental_findings finding on finding.tenant_id = item.tenant_id and finding.id = item.dental_finding_id
    where item.dental_finding_id is not null
      and (finding.clinic_id, finding.patient_id) is distinct from (item.clinic_id, plan.patient_id)
  ) invalid
  limit 1;
  if invalid_relationship is not null then
    raise exception 'CP13 durable-integrity preflight: composite relationship mismatch in %', invalid_relationship
      using hint = 'Reconcile the named clinical/financial association before applying migration 0017; no row is deleted or relinked automatically.';
  end if;

  select relationship into invalid_relationship
  from (
    select 'queue_entries.appointment_scope' as relationship
    from queue_entries child join appointments parent on parent.tenant_id = child.tenant_id and parent.id = child.appointment_id
    where (parent.clinic_id, parent.patient_id, parent.provider_user_id)
      is distinct from (child.clinic_id, child.patient_id, child.provider_user_id)
    union all
    select 'treatment_plan_phases.plan_scope'
    from treatment_plan_phases child join treatment_plans parent on parent.tenant_id = child.tenant_id and parent.id = child.treatment_plan_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'treatment_plan_estimate_items.phase_scope'
    from treatment_plan_estimate_items child join treatment_plan_phases parent
      on parent.tenant_id = child.tenant_id and parent.id = child.phase_id
    where (parent.clinic_id, parent.treatment_plan_id) is distinct from (child.clinic_id, child.treatment_plan_id)
    union all
    select 'treatment_plan_estimate_items.pricebook_scope'
    from treatment_plan_estimate_items child join pricebook_procedures parent
      on parent.tenant_id = child.tenant_id and parent.id = child.pricebook_procedure_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'procedure_performed_records.estimate_item_plan_scope'
    from procedure_performed_records child join treatment_plan_estimate_items parent
      on parent.tenant_id = child.tenant_id and parent.id = child.treatment_plan_estimate_item_id
    where (parent.clinic_id, parent.treatment_plan_id) is distinct from (child.clinic_id, child.treatment_plan_id)
    union all
    select 'procedure_performed_records.pricebook_scope'
    from procedure_performed_records child join pricebook_procedures parent
      on parent.tenant_id = child.tenant_id and parent.id = child.pricebook_procedure_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'procedure_performed_records.finding_patient'
    from procedure_performed_records child join dental_findings parent
      on parent.tenant_id = child.tenant_id and parent.id = child.dental_finding_id
    where child.dental_finding_id is not null
      and (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'procedure_performed_records.invoice_patient'
    from procedure_performed_records child join invoices parent
      on parent.tenant_id = child.tenant_id and parent.id = child.invoice_id
    where child.invoice_id is not null
      and (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'invoice_items.invoice_patient'
    from invoice_items child join invoices parent on parent.tenant_id = child.tenant_id and parent.id = child.invoice_id
    where (parent.clinic_id, parent.patient_id) is distinct from (child.clinic_id, child.patient_id)
    union all
    select 'invoice_items.procedure_invoice_patient'
    from invoice_items child join procedure_performed_records parent
      on parent.tenant_id = child.tenant_id and parent.id = child.procedure_performed_id
    where (parent.clinic_id, parent.patient_id, parent.invoice_id)
      is distinct from (child.clinic_id, child.patient_id, child.invoice_id)
    union all
    select 'invoice_items.estimate_item_scope'
    from invoice_items child join treatment_plan_estimate_items parent
      on parent.tenant_id = child.tenant_id and parent.id = child.treatment_plan_estimate_item_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'invoice_items.pricebook_scope'
    from invoice_items child join pricebook_procedures parent
      on parent.tenant_id = child.tenant_id and parent.id = child.pricebook_procedure_id
    where parent.clinic_id <> child.clinic_id
    union all
    select 'payment_transactions.request_invoice_patient'
    from payment_transactions child join payment_requests parent
      on parent.tenant_id = child.tenant_id and parent.id = child.payment_request_id
    where child.payment_request_id is not null
      and (parent.clinic_id, parent.invoice_id, parent.patient_id)
        is distinct from (child.clinic_id, child.invoice_id, child.patient_id)
    union all
    select 'payment_transactions.receipt_invoice_patient'
    from payment_transactions child join receipts parent
      on parent.tenant_id = child.tenant_id and parent.id = child.receipt_id
    where child.receipt_id is not null
      and (parent.clinic_id, parent.invoice_id, parent.patient_id)
        is distinct from (child.clinic_id, child.invoice_id, child.patient_id)
    union all
    select 'attribution_touches.invoice_scope'
    from attribution_touches child join invoices parent
      on parent.tenant_id = child.tenant_id and parent.id = child.invoice_id
    where child.invoice_id is not null and parent.clinic_id <> child.clinic_id
    union all
    select 'raw_webhook_events.external_account_scope'
    from raw_webhook_events child join external_accounts parent
      on parent.tenant_id = child.tenant_id and parent.id = child.external_account_id
    join external_systems system
      on system.tenant_id = parent.tenant_id and system.id = parent.external_system_id
    where child.external_account_id is not null
      and (
        child.clinic_id is null
        or parent.clinic_id is distinct from child.clinic_id
        or system.provider_key <> child.provider_key
      )
  ) invalid
  limit 1;
  if invalid_relationship is not null then
    raise exception 'CP13 durable-integrity preflight: scoped relationship mismatch in %', invalid_relationship
      using hint = 'Reconcile the named clinic/patient relationship before applying migration 0017; the migration never guesses the authoritative link.';
  end if;
end $$;

-- Supporting referenced identities. These include existing primary identifiers, so the unique
-- builds cannot collapse distinct records; they provide clinic/patient-aware FK targets.
create unique index if not exists patients_cp13_scope_id_uidx on patients (tenant_id, clinic_id, id);
create unique index if not exists appointments_cp13_scope_patient_uidx on appointments (tenant_id, clinic_id, id, patient_id);
create unique index if not exists appointments_cp13_scope_patient_provider_uidx on appointments (tenant_id, clinic_id, id, patient_id, provider_user_id);
create unique index if not exists encounters_cp13_scope_patient_uidx on encounters (tenant_id, clinic_id, id, patient_id);
create unique index if not exists dental_findings_cp13_scope_id_uidx on dental_findings (tenant_id, clinic_id, id);
create unique index if not exists dental_findings_cp13_scope_patient_uidx on dental_findings (tenant_id, clinic_id, id, patient_id);
create unique index if not exists media_uploads_cp13_scope_patient_uidx on media_uploads (tenant_id, clinic_id, id, patient_id);
create unique index if not exists media_assets_cp13_scope_patient_uidx on media_assets (tenant_id, clinic_id, id, patient_id);
create unique index if not exists pricebook_procedures_cp13_scope_id_uidx on pricebook_procedures (tenant_id, clinic_id, id);
create unique index if not exists treatment_plans_cp13_scope_id_uidx on treatment_plans (tenant_id, clinic_id, id);
create unique index if not exists treatment_plans_cp13_scope_patient_uidx on treatment_plans (tenant_id, clinic_id, id, patient_id);
create unique index if not exists treatment_plan_phases_cp13_scope_plan_id_uidx on treatment_plan_phases (tenant_id, clinic_id, treatment_plan_id, id);
create unique index if not exists treatment_plan_estimate_items_cp13_scope_id_uidx on treatment_plan_estimate_items (tenant_id, clinic_id, id);
create unique index if not exists treatment_plan_estimate_items_cp13_scope_plan_id_uidx on treatment_plan_estimate_items (tenant_id, clinic_id, treatment_plan_id, id);
create unique index if not exists procedure_performed_cp13_scope_patient_invoice_uidx on procedure_performed_records (tenant_id, clinic_id, id, patient_id, invoice_id);
create unique index if not exists invoices_cp13_scope_id_uidx on invoices (tenant_id, clinic_id, id);
create unique index if not exists invoices_cp13_scope_patient_uidx on invoices (tenant_id, clinic_id, id, patient_id);
create unique index if not exists payment_requests_cp13_scope_invoice_patient_uidx on payment_requests (tenant_id, clinic_id, id, invoice_id, patient_id);
create unique index if not exists receipts_cp13_scope_invoice_patient_uidx on receipts (tenant_id, clinic_id, id, invoice_id, patient_id);
create unique index if not exists outbox_events_cp13_scope_id_uidx on outbox_events (tenant_id, clinic_id, id);
create unique index if not exists raw_webhook_events_cp13_scope_id_uidx on raw_webhook_events (tenant_id, clinic_id, id);
create unique index if not exists external_accounts_cp13_scope_id_uidx on external_accounts (tenant_id, clinic_id, id);

-- Client filenames are no longer retained. The adapter persists only a server-derived opaque
-- media label; provider paths/versions are represented only by fingerprints in receipt evidence.
alter table media_uploads drop constraint if exists media_uploads_original_filename_check;
alter table media_uploads
  add constraint media_uploads_server_filename_check check (
    original_filename ~ '^clinical-media-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif|tif|tiff|dcm|dicom|pdf|wav|webm|m4a|mp4|mp3|mpeg)$'
  );
alter table media_assets drop constraint if exists media_assets_original_filename_check;
alter table media_assets
  add constraint media_assets_server_filename_check check (
    original_filename ~ '^clinical-media-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic|heif|tif|tiff|dcm|dicom|pdf|wav|webm|m4a|mp4|mp3|mpeg)$'
  );

create table clinical_media_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  upload_id uuid not null,
  patient_id uuid not null,
  provider_key text not null check (provider_key in ('local_simulator', 's3')),
  receipt_fingerprint char(64) not null check (receipt_fingerprint ~ '^[0-9a-f]{64}$'),
  mismatch_receipt_fingerprint char(64) check (mismatch_receipt_fingerprint ~ '^[0-9a-f]{64}$'),
  provider_artifact_fingerprint char(64) not null check (provider_artifact_fingerprint ~ '^[0-9a-f]{64}$'),
  content_length bigint not null check (content_length > 0),
  mime_type text not null check (length(trim(mime_type)) > 0),
  sha256_digest char(64) not null check (sha256_digest ~ '^[0-9a-f]{64}$'),
  state text not null check (state in ('matched', 'mismatch', 'consumed')),
  mismatch_reason text,
  stored_at timestamptz not null,
  received_at timestamptz not null,
  last_verified_at timestamptz not null,
  consumed_at timestamptz,
  recorded_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, upload_id),
  constraint clinical_media_receipts_upload_fk
    foreign key (tenant_id, clinic_id, upload_id, patient_id)
    references media_uploads(tenant_id, clinic_id, id, patient_id) on delete restrict,
  constraint clinical_media_receipts_state_consistency_check check (
    (state = 'matched' and mismatch_reason is null and mismatch_receipt_fingerprint is null and consumed_at is null)
    or (state = 'mismatch' and length(trim(mismatch_reason)) > 0 and consumed_at is null)
    or (state = 'consumed' and mismatch_reason is null and mismatch_receipt_fingerprint is null and consumed_at is not null)
  )
);
create index clinical_media_receipts_state_idx
  on clinical_media_receipts (tenant_id, clinic_id, state, last_verified_at);
create trigger clinical_media_receipts_set_updated_at
before update on clinical_media_receipts
for each row execute function clinic_os.set_updated_at();

-- Canonical raw webhook evidence remains raw_webhook_events; no parallel raw ledger is created.
-- Parsed payload retention is optional, while exact raw-body/signature/normalized fingerprints are
-- mandatory for newly verified events.
alter table raw_webhook_events enable row level security;
alter table raw_webhook_events force row level security;
alter table raw_webhook_events alter column raw_payload drop not null;
alter table raw_webhook_events drop constraint if exists raw_webhook_events_processing_status_check;
alter table raw_webhook_events
  add constraint raw_webhook_events_processing_status_check check (
    processing_status in (
      'received', 'processing', 'verified', 'normalization_failed', 'normalized', 'applied',
      'ignored', 'reconciliation_required', 'failed', 'dead_lettered', 'replayed'
    )
  ),
  add constraint raw_webhook_events_evidence_state_check check (
    evidence_state in ('unverified', 'verified', 'mismatch', 'reconciliation_required', 'applied')
  ),
  add constraint raw_webhook_events_fingerprint_check check (
    (verification_status <> 'verified')
    or (
      raw_body_sha256 ~ '^[0-9a-f]{64}$'
      and signature_sha256 ~ '^[0-9a-f]{64}$'
      and normalized_event_sha256 ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(normalized_event) = 'object'
      and octet_length(normalized_event::text) <= 32768
      and clinic_id is not null
      and external_account_id is not null
      and provider_event_id is not null
    )
  ),
  add constraint raw_webhook_events_lease_check check (
    (processing_status = 'processing' and lease_owner is not null and lease_expires_at is not null and attempt_count > 0)
    or processing_status <> 'processing'
  ),
  add constraint raw_webhook_events_result_check check (
    (result_digest is null and result_projection is null)
    or (
      result_digest ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(result_projection) = 'object'
      and octet_length(result_projection::text) <= 32768
    )
  ),
  add constraint raw_webhook_events_mismatch_check check (
    (evidence_state = 'mismatch' and length(trim(mismatch_reason)) > 0)
    or (evidence_state <> 'mismatch' and mismatch_reason is null)
  );
create unique index raw_webhook_events_cp13_account_event_uidx
  on raw_webhook_events (tenant_id, external_account_id, provider_event_id)
  where external_account_id is not null and provider_event_id is not null;
alter table raw_webhook_events
  drop constraint if exists raw_webhook_events_account_fk,
  add constraint raw_webhook_events_cp13_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict not valid;

create table payment_provider_request_intents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  provider_key text not null check (provider_key in ('razorpay', 'simulator')),
  required_capability text not null check (length(trim(required_capability)) > 0),
  invoice_id uuid not null,
  patient_id uuid not null,
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  request_digest char(64) not null check (request_digest ~ '^[0-9a-f]{64}$'),
  request_type text not null check (request_type in ('payment_link', 'invoice_qr')),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  provider_safe_request jsonb not null check (
    jsonb_typeof(provider_safe_request) = 'object'
    and octet_length(provider_safe_request::text) <= 32768
    and provider_safe_request ?& array['description', 'expiresAt', 'customer', 'metadata']
    and provider_safe_request - array['description', 'expiresAt', 'customer', 'metadata'] = '{}'::jsonb
    and jsonb_typeof(provider_safe_request -> 'description') in ('string', 'null')
    and jsonb_typeof(provider_safe_request -> 'expiresAt') in ('string', 'null')
    and jsonb_typeof(provider_safe_request -> 'customer') in ('object', 'null')
    and jsonb_typeof(provider_safe_request -> 'metadata') = 'object'
  ),
  status text not null default 'claimed' check (
    status in ('claimed', 'completed', 'failed', 'reconciliation_required')
  ),
  lease_owner text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 1 check (attempt_count > 0),
  payment_request_id uuid,
  provider_artifact_fingerprint char(64) check (provider_artifact_fingerprint ~ '^[0-9a-f]{64}$'),
  result_digest char(64) check (result_digest ~ '^[0-9a-f]{64}$'),
  result_projection jsonb check (
    result_projection is null
    or (
      jsonb_typeof(result_projection) = 'object'
      and octet_length(result_projection::text) <= 32768
    )
  ),
  mismatch_reason text,
  requested_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, external_account_id, idempotency_key),
  constraint payment_provider_request_intents_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint payment_provider_request_intents_invoice_fk
    foreign key (tenant_id, clinic_id, invoice_id, patient_id)
    references invoices(tenant_id, clinic_id, id, patient_id) on delete restrict,
  constraint payment_provider_request_intents_payment_request_fk
    foreign key (tenant_id, clinic_id, payment_request_id, invoice_id, patient_id)
    references payment_requests(tenant_id, clinic_id, id, invoice_id, patient_id) on delete restrict,
  constraint payment_provider_request_intents_state_check check (
    (status = 'claimed' and lease_owner is not null and lease_expires_at is not null and processed_at is null and mismatch_reason is null)
    or (
      status <> 'claimed'
      and lease_owner is null
      and lease_expires_at is null
      and processed_at is not null
      and (
        (mismatch_reason is not null and status = 'reconciliation_required')
        or (mismatch_reason is null and result_digest is not null and result_projection is not null)
      )
    )
  )
);
create index payment_provider_request_intents_recovery_idx
  on payment_provider_request_intents (tenant_id, clinic_id, status, lease_expires_at);
create trigger payment_provider_request_intents_set_updated_at
before update on payment_provider_request_intents
for each row execute function clinic_os.set_updated_at();

create table payment_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  raw_webhook_event_id uuid not null,
  invoice_id uuid,
  patient_id uuid,
  reason text not null check (
    reason in (
      'overpayment', 'missing_invoice_reference', 'currency_mismatch',
      'invalid_provider_amount', 'scope_mismatch', 'manual_review_required'
    )
  ),
  captured_amount_minor bigint not null check (captured_amount_minor >= 0),
  applied_amount_minor bigint not null check (applied_amount_minor >= 0),
  unallocated_amount_minor bigint not null check (unallocated_amount_minor >= 0),
  currency text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  evidence jsonb not null check (
    jsonb_typeof(evidence) = 'object' and octet_length(evidence::text) <= 32768
  ),
  resolution_reason text,
  resolved_by_user_id uuid references users(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, raw_webhook_event_id),
  constraint payment_reconciliation_items_event_fk
    foreign key (tenant_id, clinic_id, raw_webhook_event_id)
    references raw_webhook_events(tenant_id, clinic_id, id) on delete restrict,
  constraint payment_reconciliation_items_invoice_fk
    foreign key (tenant_id, clinic_id, invoice_id, patient_id)
    references invoices(tenant_id, clinic_id, id, patient_id) on delete restrict,
  constraint payment_reconciliation_items_patient_fk
    foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict,
  constraint payment_reconciliation_items_amount_check check (
    captured_amount_minor = applied_amount_minor + unallocated_amount_minor
  ),
  constraint payment_reconciliation_items_resolution_check check (
    (status = 'open' and resolved_by_user_id is null and resolved_at is null and resolution_reason is null)
    or (status <> 'open' and resolved_by_user_id is not null and resolved_at is not null and length(trim(resolution_reason)) > 0)
  )
);
create index payment_reconciliation_items_open_idx
  on payment_reconciliation_items (tenant_id, clinic_id, status, created_at);
create trigger payment_reconciliation_items_set_updated_at
before update on payment_reconciliation_items
for each row execute function clinic_os.set_updated_at();

-- Strong clinic/patient-aware FKs replace weaker tenant-only links. Restrict deletion wherever
-- clinical media or financial provenance would otherwise be detached.
alter table appointments
  drop constraint if exists appointments_patient_fk,
  add constraint appointments_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid;
alter table queue_entries
  drop constraint if exists queue_entries_patient_fk,
  drop constraint if exists queue_entries_appointment_fk,
  add constraint queue_entries_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint queue_entries_cp13_appointment_fk foreign key (tenant_id, clinic_id, appointment_id, patient_id, provider_user_id)
    references appointments(tenant_id, clinic_id, id, patient_id, provider_user_id) on delete restrict not valid;
alter table encounters
  drop constraint if exists encounters_patient_fk,
  drop constraint if exists encounters_appointment_fk,
  add constraint encounters_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint encounters_cp13_appointment_patient_fk foreign key (tenant_id, clinic_id, appointment_id, patient_id)
    references appointments(tenant_id, clinic_id, id, patient_id) on delete restrict not valid;
alter table clinical_note_versions
  drop constraint if exists clinical_note_versions_patient_fk,
  drop constraint if exists clinical_note_versions_encounter_fk,
  add constraint clinical_note_versions_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint clinical_note_versions_cp13_encounter_patient_fk foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters(tenant_id, clinic_id, id, patient_id) on delete restrict not valid;
alter table prescriptions
  drop constraint if exists prescriptions_patient_fk,
  drop constraint if exists prescriptions_encounter_fk,
  add constraint prescriptions_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint prescriptions_cp13_encounter_patient_fk foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters(tenant_id, clinic_id, id, patient_id) on delete restrict not valid;
alter table dental_findings
  drop constraint if exists dental_findings_patient_fk,
  drop constraint if exists dental_findings_encounter_fk,
  add constraint dental_findings_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint dental_findings_cp13_encounter_patient_fk foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters(tenant_id, clinic_id, id, patient_id) on delete restrict not valid;
alter table media_uploads
  drop constraint if exists media_uploads_patient_fk,
  drop constraint if exists media_uploads_encounter_fk,
  drop constraint if exists media_uploads_dental_finding_fk,
  drop constraint if exists media_uploads_asset_fk,
  add constraint media_uploads_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint media_uploads_cp13_encounter_patient_fk foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters(tenant_id, clinic_id, id, patient_id) on delete restrict not valid,
  add constraint media_uploads_cp13_finding_patient_fk foreign key (tenant_id, clinic_id, dental_finding_id, patient_id)
    references dental_findings(tenant_id, clinic_id, id, patient_id) on delete restrict not valid,
  add constraint media_uploads_cp13_asset_patient_fk foreign key (tenant_id, clinic_id, media_asset_id, patient_id)
    references media_assets(tenant_id, clinic_id, id, patient_id) on delete restrict not valid;
alter table media_assets
  drop constraint if exists media_assets_patient_fk,
  drop constraint if exists media_assets_encounter_fk,
  drop constraint if exists media_assets_dental_finding_fk,
  add constraint media_assets_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint media_assets_cp13_encounter_patient_fk foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters(tenant_id, clinic_id, id, patient_id) on delete restrict not valid,
  add constraint media_assets_cp13_finding_patient_fk foreign key (tenant_id, clinic_id, dental_finding_id, patient_id)
    references dental_findings(tenant_id, clinic_id, id, patient_id) on delete restrict not valid;
alter table treatment_plans
  drop constraint if exists treatment_plans_patient_fk,
  drop constraint if exists treatment_plans_encounter_fk,
  add constraint treatment_plans_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint treatment_plans_cp13_encounter_patient_fk foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters(tenant_id, clinic_id, id, patient_id) on delete restrict not valid;
alter table treatment_plan_phases
  drop constraint if exists treatment_plan_phases_plan_fk,
  add constraint treatment_plan_phases_cp13_plan_fk foreign key (tenant_id, clinic_id, treatment_plan_id)
    references treatment_plans(tenant_id, clinic_id, id) on delete cascade not valid;
alter table treatment_plan_estimate_items
  drop constraint if exists treatment_plan_estimate_items_phase_plan_fk,
  drop constraint if exists treatment_plan_estimate_items_procedure_fk,
  drop constraint if exists treatment_plan_estimate_items_dental_finding_fk,
  add constraint treatment_plan_estimate_items_cp13_phase_plan_fk foreign key (tenant_id, clinic_id, treatment_plan_id, phase_id)
    references treatment_plan_phases(tenant_id, clinic_id, treatment_plan_id, id) on delete cascade not valid,
  add constraint treatment_plan_estimate_items_cp13_procedure_fk foreign key (tenant_id, clinic_id, pricebook_procedure_id)
    references pricebook_procedures(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint treatment_plan_estimate_items_cp13_finding_fk foreign key (tenant_id, clinic_id, dental_finding_id)
    references dental_findings(tenant_id, clinic_id, id) on delete restrict not valid;
alter table procedure_performed_records
  drop constraint if exists procedure_performed_records_patient_fk,
  drop constraint if exists procedure_performed_records_encounter_fk,
  drop constraint if exists procedure_performed_records_plan_fk,
  drop constraint if exists procedure_performed_records_item_fk,
  drop constraint if exists procedure_performed_records_procedure_fk,
  drop constraint if exists procedure_performed_records_dental_finding_fk,
  drop constraint if exists procedure_performed_records_invoice_fk,
  add constraint procedure_performed_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint procedure_performed_cp13_encounter_patient_fk foreign key (tenant_id, clinic_id, encounter_id, patient_id)
    references encounters(tenant_id, clinic_id, id, patient_id) on delete restrict not valid,
  add constraint procedure_performed_cp13_plan_patient_fk foreign key (tenant_id, clinic_id, treatment_plan_id, patient_id)
    references treatment_plans(tenant_id, clinic_id, id, patient_id) on delete restrict not valid,
  add constraint procedure_performed_cp13_item_plan_fk foreign key (tenant_id, clinic_id, treatment_plan_id, treatment_plan_estimate_item_id)
    references treatment_plan_estimate_items(tenant_id, clinic_id, treatment_plan_id, id) on delete restrict not valid,
  add constraint procedure_performed_cp13_procedure_fk foreign key (tenant_id, clinic_id, pricebook_procedure_id)
    references pricebook_procedures(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint procedure_performed_cp13_finding_patient_fk foreign key (tenant_id, clinic_id, dental_finding_id, patient_id)
    references dental_findings(tenant_id, clinic_id, id, patient_id) on delete restrict not valid,
  add constraint procedure_performed_cp13_invoice_patient_fk foreign key (tenant_id, clinic_id, invoice_id, patient_id)
    references invoices(tenant_id, clinic_id, id, patient_id) on delete restrict not valid;
alter table invoices
  drop constraint if exists invoices_patient_fk,
  drop constraint if exists invoices_plan_fk,
  add constraint invoices_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint invoices_cp13_plan_patient_fk foreign key (tenant_id, clinic_id, treatment_plan_id, patient_id)
    references treatment_plans(tenant_id, clinic_id, id, patient_id) on delete restrict not valid;
alter table invoice_items
  drop constraint if exists invoice_items_patient_fk,
  drop constraint if exists invoice_items_invoice_fk,
  drop constraint if exists invoice_items_procedure_performed_fk,
  drop constraint if exists invoice_items_estimate_item_fk,
  drop constraint if exists invoice_items_pricebook_procedure_fk,
  add constraint invoice_items_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint invoice_items_cp13_invoice_patient_fk foreign key (tenant_id, clinic_id, invoice_id, patient_id)
    references invoices(tenant_id, clinic_id, id, patient_id) on delete cascade not valid,
  add constraint invoice_items_cp13_procedure_invoice_patient_fk foreign key (tenant_id, clinic_id, procedure_performed_id, patient_id, invoice_id)
    references procedure_performed_records(tenant_id, clinic_id, id, patient_id, invoice_id) on delete restrict not valid,
  add constraint invoice_items_cp13_estimate_item_fk foreign key (tenant_id, clinic_id, treatment_plan_estimate_item_id)
    references treatment_plan_estimate_items(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint invoice_items_cp13_pricebook_fk foreign key (tenant_id, clinic_id, pricebook_procedure_id)
    references pricebook_procedures(tenant_id, clinic_id, id) on delete restrict not valid;
alter table payment_requests
  drop constraint if exists payment_requests_invoice_fk,
  drop constraint if exists payment_requests_patient_fk,
  add constraint payment_requests_cp13_invoice_patient_fk foreign key (tenant_id, clinic_id, invoice_id, patient_id)
    references invoices(tenant_id, clinic_id, id, patient_id) on delete restrict not valid;
alter table payment_transactions
  drop constraint if exists payment_transactions_invoice_fk,
  drop constraint if exists payment_transactions_patient_fk,
  drop constraint if exists payment_transactions_request_fk,
  drop constraint if exists payment_transactions_receipt_fk,
  add constraint payment_transactions_cp13_invoice_patient_fk foreign key (tenant_id, clinic_id, invoice_id, patient_id)
    references invoices(tenant_id, clinic_id, id, patient_id) on delete restrict not valid,
  add constraint payment_transactions_cp13_request_invoice_patient_fk foreign key (tenant_id, clinic_id, payment_request_id, invoice_id, patient_id)
    references payment_requests(tenant_id, clinic_id, id, invoice_id, patient_id) on delete restrict not valid,
  add constraint payment_transactions_cp13_receipt_invoice_patient_fk foreign key (tenant_id, clinic_id, receipt_id, invoice_id, patient_id)
    references receipts(tenant_id, clinic_id, id, invoice_id, patient_id) on delete restrict not valid;
alter table receipts
  drop constraint if exists receipts_invoice_fk,
  drop constraint if exists receipts_patient_fk,
  add constraint receipts_cp13_invoice_patient_fk foreign key (tenant_id, clinic_id, invoice_id, patient_id)
    references invoices(tenant_id, clinic_id, id, patient_id) on delete restrict not valid;
alter table patient_instruction_requests
  drop constraint if exists patient_instruction_requests_patient_fk,
  drop constraint if exists patient_instruction_requests_channel_status_check,
  add constraint patient_instruction_requests_cp13_patient_fk foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint patient_instruction_requests_outbox_fk foreign key (tenant_id, clinic_id, outbox_event_id)
    references outbox_events(tenant_id, clinic_id, id) on delete restrict not valid,
  add constraint patient_instruction_requests_channel_status_check check (
    (channel = 'print' and status = 'ready_for_print' and print_job_id is not null and outbox_event_id is null)
    or (channel = 'whatsapp' and status = 'send_requested' and print_job_id is null)
  );
alter table attribution_touches
  drop constraint if exists attribution_touches_invoice_fk,
  add constraint attribution_touches_cp13_invoice_fk foreign key (tenant_id, clinic_id, invoice_id)
    references invoices(tenant_id, clinic_id, id) on delete restrict not valid;

create or replace function clinic_os.enforce_treatment_estimate_finding_patient()
returns trigger
language plpgsql
as $$
begin
  if new.dental_finding_id is not null and not exists (
    select 1
    from treatment_plans plan
    join dental_findings finding
      on finding.tenant_id = plan.tenant_id
     and finding.clinic_id = plan.clinic_id
     and finding.patient_id = plan.patient_id
    where plan.tenant_id = new.tenant_id
      and plan.clinic_id = new.clinic_id
      and plan.id = new.treatment_plan_id
      and finding.id = new.dental_finding_id
  ) then
    raise exception 'treatment estimate dental finding must belong to the plan patient and clinic';
  end if;
  return new;
end;
$$;
drop trigger if exists treatment_estimate_finding_patient_integrity on treatment_plan_estimate_items;
create constraint trigger treatment_estimate_finding_patient_integrity
after insert or update
on treatment_plan_estimate_items
deferrable initially immediate
for each row execute function clinic_os.enforce_treatment_estimate_finding_patient();

-- Validation is explicit so every historical row is checked before migration commit.
alter table appointments validate constraint appointments_cp13_patient_fk;
alter table queue_entries validate constraint queue_entries_cp13_patient_fk;
alter table queue_entries validate constraint queue_entries_cp13_appointment_fk;
alter table encounters validate constraint encounters_cp13_patient_fk;
alter table encounters validate constraint encounters_cp13_appointment_patient_fk;
alter table clinical_note_versions validate constraint clinical_note_versions_cp13_patient_fk;
alter table clinical_note_versions validate constraint clinical_note_versions_cp13_encounter_patient_fk;
alter table prescriptions validate constraint prescriptions_cp13_patient_fk;
alter table prescriptions validate constraint prescriptions_cp13_encounter_patient_fk;
alter table dental_findings validate constraint dental_findings_cp13_patient_fk;
alter table dental_findings validate constraint dental_findings_cp13_encounter_patient_fk;
alter table media_uploads validate constraint media_uploads_cp13_patient_fk;
alter table media_uploads validate constraint media_uploads_cp13_encounter_patient_fk;
alter table media_uploads validate constraint media_uploads_cp13_finding_patient_fk;
alter table media_uploads validate constraint media_uploads_cp13_asset_patient_fk;
alter table media_assets validate constraint media_assets_cp13_patient_fk;
alter table media_assets validate constraint media_assets_cp13_encounter_patient_fk;
alter table media_assets validate constraint media_assets_cp13_finding_patient_fk;
alter table treatment_plans validate constraint treatment_plans_cp13_patient_fk;
alter table treatment_plans validate constraint treatment_plans_cp13_encounter_patient_fk;
alter table treatment_plan_phases validate constraint treatment_plan_phases_cp13_plan_fk;
alter table treatment_plan_estimate_items validate constraint treatment_plan_estimate_items_cp13_phase_plan_fk;
alter table treatment_plan_estimate_items validate constraint treatment_plan_estimate_items_cp13_procedure_fk;
alter table treatment_plan_estimate_items validate constraint treatment_plan_estimate_items_cp13_finding_fk;
alter table procedure_performed_records validate constraint procedure_performed_cp13_patient_fk;
alter table procedure_performed_records validate constraint procedure_performed_cp13_encounter_patient_fk;
alter table procedure_performed_records validate constraint procedure_performed_cp13_plan_patient_fk;
alter table procedure_performed_records validate constraint procedure_performed_cp13_item_plan_fk;
alter table procedure_performed_records validate constraint procedure_performed_cp13_procedure_fk;
alter table procedure_performed_records validate constraint procedure_performed_cp13_finding_patient_fk;
alter table procedure_performed_records validate constraint procedure_performed_cp13_invoice_patient_fk;
alter table invoices validate constraint invoices_cp13_patient_fk;
alter table invoices validate constraint invoices_cp13_plan_patient_fk;
alter table invoice_items validate constraint invoice_items_cp13_patient_fk;
alter table invoice_items validate constraint invoice_items_cp13_invoice_patient_fk;
alter table invoice_items validate constraint invoice_items_cp13_procedure_invoice_patient_fk;
alter table invoice_items validate constraint invoice_items_cp13_estimate_item_fk;
alter table invoice_items validate constraint invoice_items_cp13_pricebook_fk;
alter table payment_requests validate constraint payment_requests_cp13_invoice_patient_fk;
alter table payment_transactions validate constraint payment_transactions_cp13_invoice_patient_fk;
alter table payment_transactions validate constraint payment_transactions_cp13_request_invoice_patient_fk;
alter table payment_transactions validate constraint payment_transactions_cp13_receipt_invoice_patient_fk;
alter table receipts validate constraint receipts_cp13_invoice_patient_fk;
alter table patient_instruction_requests validate constraint patient_instruction_requests_cp13_patient_fk;
alter table patient_instruction_requests validate constraint patient_instruction_requests_outbox_fk;
alter table attribution_touches validate constraint attribution_touches_cp13_invoice_fk;
alter table raw_webhook_events validate constraint raw_webhook_events_cp13_account_fk;

alter table clinical_media_receipts enable row level security;
alter table clinical_media_receipts force row level security;
create policy clinical_media_receipts_tenant_clinic_isolation on clinical_media_receipts
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table payment_provider_request_intents enable row level security;
alter table payment_provider_request_intents force row level security;
create policy payment_provider_request_intents_tenant_clinic_isolation on payment_provider_request_intents
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table payment_reconciliation_items enable row level security;
alter table payment_reconciliation_items force row level security;
create policy payment_reconciliation_items_tenant_clinic_isolation on payment_reconciliation_items
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

comment on table clinical_media_receipts is
  'Provider-derived clinical media receipt evidence. Provider artifact references are fingerprinted and never retained as paths or secrets.';
comment on table payment_provider_request_intents is
  'Account-scoped exact-request claims/finalization for crash-safe provider payment request recovery.';
comment on table payment_reconciliation_items is
  'Durable unsafe/unallocated provider payment evidence; never an invented settlement.';
