-- Checkpoint 16: durable AI invocation/usage evidence and consent-gated FHIR exchange.
--
-- Clinical payloads are application-encrypted before they reach these tables. PostgreSQL stores
-- ciphertext, an opaque approved key reference and bounded non-PHI provenance only. The runtime
-- must fail closed when the payload-protection adapter is unavailable.

alter table consents drop constraint if exists consents_purpose_check;
alter table consents add constraint consents_purpose_check check (
  purpose in (
    'treatment_registration',
    'privacy_notice',
    'whatsapp_communication',
    'marketing_recall',
    'ai_audio_capture',
    'raw_audio_retention',
    'photo_capture',
    'photo_sharing',
    'abdm_abha',
    'procedure_treatment',
    'clinical_data_exchange'
  )
);

insert into permissions (key, display_name, category, description, phi_involved)
values
  (
    'interoperability.fhir_r4.export',
    'Export FHIR R4 clinical summaries',
    'clinical',
    'Export a consent-gated, patient-scoped FHIR R4 clinical summary document.',
    true
  ),
  (
    'interoperability.fhir_r4.import',
    'Import FHIR R4 clinical summaries',
    'clinical',
    'Stage a consent-gated FHIR R4 clinical summary for exact-patient reconciliation.',
    true
  ),
  (
    'interoperability.fhir_r4.reconcile',
    'Reconcile FHIR R4 clinical summaries',
    'clinical',
    'Review and conditionally apply a minimized FHIR R4 clinical summary import.',
    true
  )
on conflict (key) do update set
  display_name = excluded.display_name,
  category = excluded.category,
  description = excluded.description,
  phi_involved = excluded.phi_involved;

insert into role_permissions (role_id, permission_key)
select roles.id, grants.permission_key
from roles
join (
  values
    ('owner_admin', 'interoperability.fhir_r4.export'),
    ('owner_admin', 'interoperability.fhir_r4.import'),
    ('owner_admin', 'interoperability.fhir_r4.reconcile'),
    ('doctor', 'interoperability.fhir_r4.export'),
    ('doctor', 'interoperability.fhir_r4.import'),
    ('doctor', 'interoperability.fhir_r4.reconcile')
) grants(role_slug, permission_key) on roles.slug = grants.role_slug
on conflict do nothing;

create table cp16_ai_invocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid not null,
  actor_user_id uuid not null references users(id) on delete restrict,
  provider_key text not null check (provider_key = 'fireworks'),
  task text not null check (
    task in (
      'clinical_structured_draft', 'clinical_safety_review', 'bounded_extraction',
      'long_context_summary', 'retrieval_embedding', 'retrieval_rerank',
      'speech_quality', 'speech_low_latency'
    )
  ),
  status text not null check (
    status in (
      'claimed', 'completed', 'failed', 'provider_succeeded_persistence_uncertain'
    )
  ),
  disposition text check (disposition in ('review_only_ready', 'blocked')),
  workflow_idempotency_digest char(64) not null
    check (workflow_idempotency_digest ~ '^[0-9a-f]{64}$'),
  provider_call_idempotency_digest char(64) not null
    check (provider_call_idempotency_digest ~ '^[0-9a-f]{64}$'),
  request_fingerprint char(64) not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  correlation_digest char(64) not null check (correlation_digest ~ '^[0-9a-f]{64}$'),
  application_policy_snapshot_digest char(64)
    check (
      application_policy_snapshot_digest is null
      or application_policy_snapshot_digest ~ '^[0-9a-f]{64}$'
    ),
  application_policy_reason_code text check (
    application_policy_reason_code is null
    or application_policy_reason_code ~ '^[a-z0-9_]{1,64}$'
  ),
  result_kind text check (result_kind in ('structured', 'transcription', 'embedding', 'rerank')),
  result_ciphertext bytea,
  result_encryption_key_ref text check (
    result_encryption_key_ref is null
    or length(result_encryption_key_ref) between 20 and 2048
  ),
  result_encryption_algorithm text check (
    result_encryption_algorithm is null or result_encryption_algorithm = 'AES-256-GCM'
  ),
  result_plaintext_digest char(64) check (
    result_plaintext_digest is null or result_plaintext_digest ~ '^[0-9a-f]{64}$'
  ),
  provenance jsonb check (provenance is null or jsonb_typeof(provenance) = 'object'),
  error_code text check (error_code is null or error_code ~ '^[a-z0-9_]{1,64}$'),
  uncertain_reason text check (
    uncertain_reason is null
    or uncertain_reason in (
      'usage_settlement_outcome_unknown', 'atomic_result_commit_outcome_unknown'
    )
  ),
  lease_expires_at timestamptz,
  retention_expires_at timestamptz,
  payload_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, clinic_id, id),
  unique (tenant_id, clinic_id, provider_call_idempotency_digest),
  constraint cp16_ai_invocations_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint cp16_ai_invocations_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint cp16_ai_invocations_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete restrict,
  constraint cp16_ai_invocations_result_shape_check check (
    (
      status = 'claimed'
      and disposition is null and result_kind is null and result_ciphertext is null
      and result_encryption_key_ref is null and result_encryption_algorithm is null
      and result_plaintext_digest is null and provenance is null and error_code is null
      and uncertain_reason is null and completed_at is null and payload_deleted_at is null
      and lease_expires_at is not null
    )
    or (
      status = 'completed'
      and disposition is not null and result_kind is not null
      and (
        (
          payload_deleted_at is null and result_ciphertext is not null
          and octet_length(result_ciphertext) between 1 and 8388608
          and result_encryption_key_ref is not null
          and result_encryption_algorithm = 'AES-256-GCM'
          and result_plaintext_digest is not null
        )
        or (
          payload_deleted_at is not null and result_ciphertext is null
          and result_encryption_key_ref is null and result_encryption_algorithm is null
          and result_plaintext_digest is not null
        )
      )
      and provenance is not null and error_code is null and uncertain_reason is null
      and completed_at is not null and lease_expires_at is null
    )
    or (
      status = 'failed'
      and disposition is null and result_kind is null and result_ciphertext is null
      and result_encryption_key_ref is null and result_encryption_algorithm is null
      and result_plaintext_digest is null and provenance is null and error_code is not null
      and uncertain_reason is null and completed_at is not null and lease_expires_at is null
      and payload_deleted_at is null
    )
    or (
      status = 'provider_succeeded_persistence_uncertain'
      and disposition is null and result_kind is null and result_ciphertext is null
      and result_encryption_key_ref is null and result_encryption_algorithm is null
      and result_plaintext_digest is null and provenance is not null and error_code is null
      and uncertain_reason is not null and completed_at is not null and lease_expires_at is null
      and payload_deleted_at is null
    )
  )
);

create index cp16_ai_invocations_patient_idx
  on cp16_ai_invocations (tenant_id, clinic_id, patient_id, encounter_id, created_at desc);
create index cp16_ai_invocations_reconciliation_idx
  on cp16_ai_invocations (tenant_id, clinic_id, status, updated_at)
  where status = 'provider_succeeded_persistence_uncertain';
create trigger cp16_ai_invocations_set_updated_at
before update on cp16_ai_invocations
for each row execute function clinic_os.set_updated_at();

create table cp16_ai_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  provider_key text not null check (provider_key = 'fireworks'),
  task text not null check (
    task in (
      'clinical_structured_draft', 'clinical_safety_review', 'bounded_extraction',
      'long_context_summary', 'retrieval_embedding', 'retrieval_rerank',
      'speech_quality', 'speech_low_latency'
    )
  ),
  idempotency_digest char(64) not null check (idempotency_digest ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('reserved', 'settled', 'cancelled', 'uncertain')),
  estimated_input_tokens integer not null check (estimated_input_tokens >= 0),
  maximum_output_tokens integer not null check (maximum_output_tokens >= 0),
  estimated_audio_bytes integer not null check (estimated_audio_bytes >= 0),
  estimated_audio_duration_ms integer not null check (estimated_audio_duration_ms >= 0),
  actual_input_tokens integer check (actual_input_tokens is null or actual_input_tokens >= 0),
  actual_output_tokens integer check (actual_output_tokens is null or actual_output_tokens >= 0),
  actual_audio_bytes integer check (actual_audio_bytes is null or actual_audio_bytes >= 0),
  actual_audio_duration_ms integer check (
    actual_audio_duration_ms is null or actual_audio_duration_ms >= 0
  ),
  reserved_at timestamptz not null,
  settled_at timestamptz,
  unique (tenant_id, clinic_id, id),
  unique (tenant_id, clinic_id, idempotency_digest),
  constraint cp16_ai_usage_reservations_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint cp16_ai_usage_reservations_state_check check (
    (
      status = 'reserved' and settled_at is null
      and actual_input_tokens is null and actual_output_tokens is null
      and actual_audio_bytes is null and actual_audio_duration_ms is null
    )
    or (
      status in ('settled', 'uncertain') and settled_at is not null
      and actual_input_tokens is not null and actual_output_tokens is not null
      and actual_audio_bytes is not null and actual_audio_duration_ms is not null
    )
    or (
      status = 'cancelled' and settled_at is not null
      and actual_input_tokens is null and actual_output_tokens is null
      and actual_audio_bytes is null and actual_audio_duration_ms is null
    )
  )
);

create index cp16_ai_usage_reservations_status_idx
  on cp16_ai_usage_reservations (tenant_id, clinic_id, status, reserved_at);

create table cp16_fhir_exports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid not null,
  actor_user_id uuid not null references users(id) on delete restrict,
  status text not null check (status in ('in_progress', 'completed', 'failed')),
  idempotency_key_digest char(64) not null check (idempotency_key_digest ~ '^[0-9a-f]{64}$'),
  request_digest char(64) not null check (request_digest ~ '^[0-9a-f]{64}$'),
  bundle_digest char(64) check (bundle_digest is null or bundle_digest ~ '^[0-9a-f]{64}$'),
  bundle_ciphertext bytea,
  bundle_encryption_key_ref text check (
    bundle_encryption_key_ref is null or length(bundle_encryption_key_ref) between 20 and 2048
  ),
  bundle_encryption_algorithm text check (
    bundle_encryption_algorithm is null or bundle_encryption_algorithm = 'AES-256-GCM'
  ),
  payload_plaintext_digest char(64) check (
    payload_plaintext_digest is null or payload_plaintext_digest ~ '^[0-9a-f]{64}$'
  ),
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, clinic_id, id),
  unique (tenant_id, clinic_id, actor_user_id, idempotency_key_digest),
  constraint cp16_fhir_exports_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint cp16_fhir_exports_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint cp16_fhir_exports_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete restrict,
  constraint cp16_fhir_exports_state_check check (
    (
      status = 'in_progress' and bundle_digest is null and bundle_ciphertext is null
      and bundle_encryption_key_ref is null and bundle_encryption_algorithm is null
      and payload_plaintext_digest is null
      and completed_at is null and lease_expires_at is not null
    )
    or (
      status = 'completed' and bundle_digest is not null
      and bundle_ciphertext is not null and octet_length(bundle_ciphertext) between 1 and 8388608
      and bundle_encryption_key_ref is not null
      and bundle_encryption_algorithm = 'AES-256-GCM'
      and payload_plaintext_digest is not null
      and completed_at is not null and lease_expires_at is null
    )
    or (
      status = 'failed' and bundle_digest is null and bundle_ciphertext is null
      and bundle_encryption_key_ref is null and bundle_encryption_algorithm is null
      and payload_plaintext_digest is null
      and completed_at is not null and lease_expires_at is null
    )
  )
);

create index cp16_fhir_exports_patient_idx
  on cp16_fhir_exports (tenant_id, clinic_id, patient_id, encounter_id, created_at desc);
create trigger cp16_fhir_exports_set_updated_at
before update on cp16_fhir_exports
for each row execute function clinic_os.set_updated_at();

create table cp16_fhir_import_reconciliations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  source_encounter_id uuid not null,
  encounter_id uuid,
  actor_user_id uuid not null references users(id) on delete restrict,
  status text not null check (
    status in (
      'in_progress', 'pending_review', 'quarantined', 'accepted_pending_apply',
      'applied', 'rejected', 'failed'
    )
  ),
  idempotency_key_digest char(64) not null check (idempotency_key_digest ~ '^[0-9a-f]{64}$'),
  request_digest char(64) not null check (request_digest ~ '^[0-9a-f]{64}$'),
  bundle_digest char(64) not null check (bundle_digest ~ '^[0-9a-f]{64}$'),
  minimized_ciphertext bytea,
  payload_encryption_key_ref text check (
    payload_encryption_key_ref is null or length(payload_encryption_key_ref) between 20 and 2048
  ),
  payload_encryption_algorithm text check (
    payload_encryption_algorithm is null or payload_encryption_algorithm = 'AES-256-GCM'
  ),
  minimized_plaintext_digest char(64) check (
    minimized_plaintext_digest is null or minimized_plaintext_digest ~ '^[0-9a-f]{64}$'
  ),
  expected_patient_version bigint not null check (expected_patient_version > 0),
  expected_encounter_version bigint not null check (expected_encounter_version > 0),
  candidate_count integer check (candidate_count is null or candidate_count >= 0),
  quarantine_reason text check (
    quarantine_reason is null
    or quarantine_reason in (
      'ambiguous_exact_match', 'missing_exact_match', 'patient_version_conflict',
      'target_patient_mismatch', 'ambiguous_exact_encounter_match',
      'encounter_version_conflict', 'missing_exact_encounter_match',
      'target_encounter_mismatch'
    )
  ),
  review_reason text check (review_reason is null or length(trim(review_reason)) between 1 and 2000),
  reviewed_by_user_id uuid references users(id) on delete restrict,
  reviewed_at timestamptz,
  row_version bigint not null default 1 check (row_version > 0),
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, clinic_id, id),
  unique (tenant_id, clinic_id, actor_user_id, idempotency_key_digest),
  constraint cp16_fhir_imports_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint cp16_fhir_imports_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint cp16_fhir_imports_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete restrict,
  constraint cp16_fhir_imports_state_check check (
    (
      status = 'in_progress' and minimized_ciphertext is null
      and payload_encryption_key_ref is null and payload_encryption_algorithm is null
      and minimized_plaintext_digest is null
      and candidate_count is null and quarantine_reason is null
      and review_reason is null and reviewed_by_user_id is null and reviewed_at is null
      and lease_expires_at is not null
    )
    or (
      status in ('pending_review', 'quarantined')
      and minimized_ciphertext is not null and octet_length(minimized_ciphertext) between 1 and 2097152
      and payload_encryption_key_ref is not null
      and payload_encryption_algorithm = 'AES-256-GCM'
      and minimized_plaintext_digest is not null
      and candidate_count is not null
      and (
        (status = 'pending_review' and quarantine_reason is null and encounter_id is not null)
        or (status = 'quarantined' and quarantine_reason is not null)
      )
      and review_reason is null and reviewed_by_user_id is null and reviewed_at is null
      and lease_expires_at is null
    )
    or (
      status in ('accepted_pending_apply', 'applied', 'rejected')
      and minimized_ciphertext is not null
      and payload_encryption_key_ref is not null
      and payload_encryption_algorithm = 'AES-256-GCM'
      and minimized_plaintext_digest is not null
      and candidate_count is not null and review_reason is not null
      and reviewed_by_user_id is not null and reviewed_at is not null
      and (status = 'rejected' or encounter_id is not null)
      and lease_expires_at is null
    )
    or (
      status = 'failed' and minimized_ciphertext is null
      and payload_encryption_key_ref is null and payload_encryption_algorithm is null
      and minimized_plaintext_digest is null
      and review_reason is null and reviewed_by_user_id is null and reviewed_at is null
      and lease_expires_at is null
    )
  )
);

create index cp16_fhir_imports_review_idx
  on cp16_fhir_import_reconciliations
    (tenant_id, clinic_id, status, created_at)
  where status in ('pending_review', 'quarantined', 'accepted_pending_apply');
create trigger cp16_fhir_imports_set_updated_at
before update on cp16_fhir_import_reconciliations
for each row execute function clinic_os.set_updated_at();

create table cp16_fhir_applied_summaries (
  reconciliation_id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid not null,
  bundle_digest char(64) not null check (bundle_digest ~ '^[0-9a-f]{64}$'),
  composition_id text not null check (length(trim(composition_id)) between 1 and 64),
  composition_status text not null check (composition_status in ('amended', 'final')),
  composition_date timestamptz not null,
  source_medication_request_count integer not null
    check (source_medication_request_count between 0 and 128),
  applied_by_user_id uuid not null references users(id) on delete restrict,
  applied_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, clinic_id, reconciliation_id),
  constraint cp16_fhir_applied_summaries_reconciliation_fk
    foreign key (tenant_id, clinic_id, reconciliation_id)
    references cp16_fhir_import_reconciliations(tenant_id, clinic_id, id) on delete restrict,
  constraint cp16_fhir_applied_summaries_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint cp16_fhir_applied_summaries_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint cp16_fhir_applied_summaries_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete restrict
);

create index cp16_fhir_applied_summaries_encounter_idx
  on cp16_fhir_applied_summaries
    (tenant_id, clinic_id, patient_id, encounter_id, applied_at desc);

create table cp16_fhir_exchange_failures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid,
  scope_kind text not null check (scope_kind in ('patient', 'unscoped')),
  unscoped_subject text check (
    unscoped_subject is null or unscoped_subject in ('patient_request', 'reconciliation_request')
  ),
  action text not null check (
    action in ('clinical_summary_export', 'clinical_summary_import', 'clinical_summary_review')
  ),
  request_id_digest char(64) not null check (request_id_digest ~ '^[0-9a-f]{64}$'),
  failure_code text not null check (failure_code ~ '^[A-Z0-9_]{1,96}$'),
  retryable boolean not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint cp16_fhir_failures_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint cp16_fhir_failures_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint cp16_fhir_failures_scope_check check (
    (scope_kind = 'patient' and patient_id is not null and unscoped_subject is null)
    or (scope_kind = 'unscoped' and patient_id is null and unscoped_subject is not null)
  )
);

create index cp16_fhir_failures_scope_idx
  on cp16_fhir_exchange_failures (tenant_id, clinic_id, occurred_at desc);

alter table cp16_ai_invocations enable row level security;
alter table cp16_ai_invocations force row level security;
alter table cp16_ai_usage_reservations enable row level security;
alter table cp16_ai_usage_reservations force row level security;
alter table cp16_fhir_exports enable row level security;
alter table cp16_fhir_exports force row level security;
alter table cp16_fhir_import_reconciliations enable row level security;
alter table cp16_fhir_import_reconciliations force row level security;
alter table cp16_fhir_applied_summaries enable row level security;
alter table cp16_fhir_applied_summaries force row level security;
alter table cp16_fhir_exchange_failures enable row level security;
alter table cp16_fhir_exchange_failures force row level security;

create policy cp16_ai_invocations_tenant_clinic on cp16_ai_invocations
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy cp16_ai_usage_tenant_clinic on cp16_ai_usage_reservations
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy cp16_fhir_exports_tenant_clinic on cp16_fhir_exports
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy cp16_fhir_imports_tenant_clinic on cp16_fhir_import_reconciliations
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy cp16_fhir_applied_summaries_tenant_clinic on cp16_fhir_applied_summaries
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy cp16_fhir_failures_tenant_clinic on cp16_fhir_exchange_failures
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'clinic_os_runtime') then
    grant select, insert, update on table
      cp16_ai_invocations,
      cp16_ai_usage_reservations,
      cp16_fhir_exports,
      cp16_fhir_import_reconciliations
      to clinic_os_runtime;
    grant select, insert on table
      cp16_fhir_applied_summaries,
      cp16_fhir_exchange_failures
      to clinic_os_runtime;
    revoke delete, truncate on table
      cp16_ai_invocations,
      cp16_ai_usage_reservations,
      cp16_fhir_exports,
      cp16_fhir_import_reconciliations,
      cp16_fhir_applied_summaries,
      cp16_fhir_exchange_failures
      from clinic_os_runtime;
    revoke update on table cp16_fhir_applied_summaries, cp16_fhir_exchange_failures
      from clinic_os_runtime;
  end if;
end
$$;

comment on table cp16_ai_invocations is
  'Forced-RLS, attributable Fireworks invocation state with application-encrypted result payload and bounded provenance.';
comment on table cp16_ai_usage_reservations is
  'Forced-RLS durable AI budget reservations; ambiguous settlement is explicit and never authorizes a blind provider retry.';
comment on table cp16_fhir_exports is
  'Forced-RLS idempotent FHIR R4 document exports with application-encrypted replay payloads.';
comment on table cp16_fhir_import_reconciliations is
  'Forced-RLS exact-patient FHIR import review state. The untrusted source encounter UUID is separate from the nullable exact-matched local encounter FK. Only the minimized allowlist is encrypted and retained; the raw import is never persisted. Application is conditional and cannot merge, create or relink a patient.';
comment on table cp16_fhir_applied_summaries is
  'Immutable reviewed FHIR clinical-summary evidence linked to an existing patient and encounter; it does not execute prescriptions or overwrite signed records.';
comment on table cp16_fhir_exchange_failures is
  'Append-only, tenant/clinic-scoped interoperability failure evidence without raw payloads or request identifiers.';
