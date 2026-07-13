-- CP15 official provider callback registrations, durable Meta WhatsApp state, and
-- Razorpay business-effect/reconciliation truth.
--
-- Provider secret values never enter PostgreSQL. Only opaque secret-manager references and
-- bounded provider identifiers are stored. Public callback lookup is a single exact SHA-256
-- digest lookup through a tightly granted SECURITY DEFINER function; all tables remain forced-RLS.

create unique index if not exists audit_events_cp15_scope_id_uidx
  on audit_events (tenant_id, clinic_id, id);
create unique index if not exists normalized_integration_events_cp15_scope_id_uidx
  on normalized_integration_events (tenant_id, clinic_id, id);
create unique index if not exists payment_transactions_cp15_scope_id_uidx
  on payment_transactions (tenant_id, clinic_id, id);
create unique index if not exists payment_requests_cp15_scope_id_uidx
  on payment_requests (tenant_id, clinic_id, id);
create unique index if not exists payment_reconciliation_items_cp15_scope_id_uidx
  on payment_reconciliation_items (tenant_id, clinic_id, id);

alter table consents
  add column if not exists revoked_by_actor_type text,
  add column if not exists revoked_by_actor_id text;
alter table consents drop constraint if exists consents_revocation_consistent;
alter table consents add constraint consents_revocation_consistent check (
  (
    status = 'active'
    and revoked_at is null
    and revoked_by_user_id is null
    and revoked_by_actor_type is null
    and revoked_by_actor_id is null
  )
  or (
    status = 'revoked'
    and revoked_at is not null
    and (
      (
        revoked_by_user_id is not null
        and revoked_by_actor_type is null
        and revoked_by_actor_id is null
      )
      or (
        revoked_by_user_id is null
        and revoked_by_actor_type = 'integration'
        and length(trim(revoked_by_actor_id)) > 0
      )
    )
  )
);

alter table raw_webhook_events
  add column if not exists verified_secret_version text,
  add column if not exists verified_with_previous_secret boolean not null default false,
  add column if not exists raw_body_length integer;

alter table raw_webhook_events
  add constraint raw_webhook_events_cp15_rotation_evidence_check check (
    verification_status <> 'verified'
    or (
      verified_secret_version is null
      and raw_body_length is null
      and not verified_with_previous_secret
    )
    or (
      length(trim(verified_secret_version)) > 0
      and raw_body_length between 1 and 1048576
    )
  ),
  add constraint raw_webhook_events_cp15_meta_pointer_check check (
    provider_key <> 'meta_whatsapp_cloud'
    or verification_status <> 'verified'
    or (
      jsonb_typeof(raw_payload) = 'object'
      and raw_payload ?& array['ciphertext_ref', 'digest', 'byte_length', 'retention_class']
      and raw_payload - array['ciphertext_ref', 'digest', 'byte_length', 'retention_class'] = '{}'::jsonb
      and raw_payload ->> 'digest' = raw_body_sha256
      and raw_payload ->> 'retention_class' = 'provider_webhook_restricted'
      and length(trim(verified_secret_version)) > 0
      and raw_body_length between 1 and 1048576
    )
  );

create table provider_callback_registrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  provider_key text not null check (provider_key in ('meta_whatsapp_cloud', 'razorpay')),
  callback_key_digest char(64) not null unique check (callback_key_digest ~ '^[0-9a-f]{64}$'),
  activation_state text not null check (
    activation_state in (
      'absent', 'registered', 'configured', 'sandbox_verified',
      'production_verified', 'degraded', 'disabled'
    )
  ),
  provider_mode text not null check (provider_mode in ('test', 'live')),
  provider_account_id text not null check (provider_account_id ~ '^[A-Za-z0-9_-]{4,128}$'),
  provider_endpoint_id text check (
    provider_endpoint_id is null or provider_endpoint_id ~ '^[A-Za-z0-9_-]{4,128}$'
  ),
  api_version text check (api_version is null or api_version ~ '^v[0-9]{1,3}\.[0-9]{1,2}$'),
  api_credential_ref text,
  webhook_secret_ref text,
  webhook_secret_version text check (
    webhook_secret_version is null or webhook_secret_version ~ '^[A-Za-z0-9._-]{1,64}$'
  ),
  previous_webhook_secret_ref text,
  previous_webhook_secret_version text check (
    previous_webhook_secret_version is null
      or previous_webhook_secret_version ~ '^[A-Za-z0-9._-]{1,64}$'
  ),
  previous_secret_accept_until timestamptz,
  verification_token_ref text,
  callback_origin text check (
    callback_origin is null
      or (
        length(callback_origin) between 12 and 512
        and callback_origin ~ '^https://[A-Za-z0-9.-]+(:[0-9]{1,5})?$'
      )
  ),
  sandbox_verified_at timestamptz,
  production_verified_at timestamptz,
  last_health_check_at timestamptz,
  last_verified_callback_at timestamptz,
  last_reconciled_at timestamptz,
  last_failure_code text check (
    last_failure_code is null or last_failure_code ~ '^[a-z][a-z0-9_.-]{0,127}$'
  ),
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, external_account_id, provider_key),
  constraint provider_callback_registrations_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint provider_callback_registrations_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint provider_callback_registrations_secret_refs_check check (
    (api_credential_ref is null or api_credential_ref ~ '^arn:(aws|aws-cn|aws-us-gov):secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$')
    and (webhook_secret_ref is null or webhook_secret_ref ~ '^arn:(aws|aws-cn|aws-us-gov):secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$')
    and (previous_webhook_secret_ref is null or previous_webhook_secret_ref ~ '^arn:(aws|aws-cn|aws-us-gov):secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$')
    and (verification_token_ref is null or verification_token_ref ~ '^arn:(aws|aws-cn|aws-us-gov):secretsmanager:[a-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]{1,512}$')
  ),
  constraint provider_callback_registrations_provider_shape_check check (
    (
      provider_key = 'meta_whatsapp_cloud'
      and provider_endpoint_id is not null
      and api_version is not null
      and verification_token_ref is not null
    )
    or (
      provider_key = 'razorpay'
      and provider_endpoint_id is null
      and api_version is null
      and verification_token_ref is null
    )
  ),
  constraint provider_callback_registrations_secret_rotation_check check (
    (
      previous_webhook_secret_ref is null
      and previous_webhook_secret_version is null
      and previous_secret_accept_until is null
    )
    or (
      previous_webhook_secret_ref is not null
      and previous_webhook_secret_version is not null
      and previous_secret_accept_until is not null
    )
  ),
  constraint provider_callback_registrations_activation_truth_check check (
    (
      activation_state in ('absent', 'disabled')
      and sandbox_verified_at is null
      and production_verified_at is null
    )
    or (
      activation_state = 'registered'
      and callback_origin is not null
      and sandbox_verified_at is null
      and production_verified_at is null
    )
    or (
      activation_state in ('configured', 'degraded')
      and callback_origin is not null
      and webhook_secret_ref is not null
      and webhook_secret_version is not null
      and api_credential_ref is not null
    )
    or (
      activation_state = 'sandbox_verified'
      and callback_origin is not null
      and webhook_secret_ref is not null
      and webhook_secret_version is not null
      and api_credential_ref is not null
      and sandbox_verified_at is not null
      and production_verified_at is null
    )
    or (
      activation_state = 'production_verified'
      and callback_origin is not null
      and webhook_secret_ref is not null
      and webhook_secret_version is not null
      and api_credential_ref is not null
      and sandbox_verified_at is not null
      and production_verified_at is not null
    )
  )
);

create trigger provider_callback_registrations_set_updated_at
before update on provider_callback_registrations
for each row execute function clinic_os.set_updated_at();

create or replace function clinic_os.resolve_provider_callback_registration(
  requested_provider_key text,
  requested_callback_key_digest char(64)
)
returns table (
  registration_id uuid,
  tenant_id uuid,
  clinic_id uuid,
  external_account_id uuid,
  provider_key text,
  activation_state text,
  provider_mode text,
  provider_account_id text,
  provider_endpoint_id text,
  api_version text,
  api_credential_ref text,
  webhook_secret_ref text,
  webhook_secret_version text,
  previous_webhook_secret_ref text,
  previous_webhook_secret_version text,
  previous_secret_accept_until timestamptz,
  verification_token_ref text
)
language sql
security definer
stable
set search_path = pg_catalog, public, clinic_os
as $$
  select
    registration.id,
    registration.tenant_id,
    registration.clinic_id,
    registration.external_account_id,
    registration.provider_key,
    registration.activation_state,
    registration.provider_mode,
    registration.provider_account_id,
    registration.provider_endpoint_id,
    registration.api_version,
    registration.api_credential_ref,
    registration.webhook_secret_ref,
    registration.webhook_secret_version,
    registration.previous_webhook_secret_ref,
    registration.previous_webhook_secret_version,
    registration.previous_secret_accept_until,
    registration.verification_token_ref
  from public.provider_callback_registrations registration
  where registration.provider_key = requested_provider_key
    and registration.callback_key_digest = requested_callback_key_digest
  limit 1
$$;

revoke all on function clinic_os.resolve_provider_callback_registration(text, char(64)) from public;

create table meta_whatsapp_webhook_commits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  raw_event_id uuid not null,
  raw_body_digest char(64) not null check (raw_body_digest ~ '^[0-9a-f]{64}$'),
  raw_body_ciphertext_ref text not null check (length(raw_body_ciphertext_ref) between 1 and 2048),
  raw_body_byte_length integer not null check (raw_body_byte_length between 1 and 1048576),
  audit_event_id uuid not null,
  outbox_event_id uuid not null,
  correlation_id text not null check (length(correlation_id) between 1 and 256),
  received_at timestamptz not null,
  committed_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, id),
  unique (tenant_id, clinic_id, external_account_id, raw_body_digest),
  unique (tenant_id, clinic_id, audit_event_id),
  unique (tenant_id, clinic_id, outbox_event_id),
  constraint meta_whatsapp_webhook_commits_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_webhook_commits_raw_event_fk
    foreign key (tenant_id, clinic_id, raw_event_id)
    references raw_webhook_events(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_webhook_commits_audit_fk
    foreign key (tenant_id, clinic_id, audit_event_id)
    references audit_events(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_webhook_commits_outbox_fk
    foreign key (tenant_id, clinic_id, outbox_event_id)
    references outbox_events(tenant_id, clinic_id, id) on delete restrict
);

create table meta_whatsapp_event_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  webhook_commit_id uuid not null,
  normalized_event_id uuid not null,
  unique_event_key text not null check (length(unique_event_key) between 1 and 640),
  event_kind text not null check (
    event_kind in ('inbound_message', 'message_status', 'template_lifecycle', 'unsupported_change')
  ),
  provider_occurred_at timestamptz not null,
  application_outcome text not null default 'pending' check (
    application_outcome in (
      'pending', 'applied', 'duplicate', 'ignored_stale',
      'reconciliation_scheduled', 'dead_lettered'
    )
  ),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, id),
  unique (tenant_id, clinic_id, external_account_id, unique_event_key),
  unique (tenant_id, clinic_id, normalized_event_id),
  constraint meta_whatsapp_event_receipts_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_event_receipts_commit_fk
    foreign key (tenant_id, clinic_id, webhook_commit_id)
    references meta_whatsapp_webhook_commits(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_event_receipts_normalized_fk
    foreign key (tenant_id, clinic_id, normalized_event_id)
    references normalized_integration_events(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_event_receipts_outcome_check check (
    (application_outcome = 'pending' and applied_at is null)
    or (application_outcome <> 'pending' and applied_at is not null)
  )
);

create index meta_whatsapp_event_receipts_pending_idx
  on meta_whatsapp_event_receipts (tenant_id, clinic_id, created_at)
  where application_outcome = 'pending';

create table meta_whatsapp_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  message_request_id uuid not null,
  patient_id uuid,
  recipient_endpoint_hmac char(64) not null check (recipient_endpoint_hmac ~ '^[0-9a-f]{64}$'),
  purpose text not null check (
    purpose in ('care_instruction', 'appointment', 'payment', 'recall', 'marketing', 'human_reply')
  ),
  template_name text not null check (template_name ~ '^[a-z0-9_]{1,512}$'),
  template_language text not null check (template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  consent_evidence_id uuid not null,
  consent_template_version integer not null check (consent_template_version > 0),
  provider_message_id text,
  state text not null check (
    state in ('send_requested', 'accepted_by_provider', 'sent', 'delivered', 'read', 'failed')
  ),
  dispatch_outcome text not null check (
    dispatch_outcome in ('pending', 'not_dispatched', 'accepted_by_provider', 'dispatch_ambiguous', 'rejected')
  ),
  dispatch_attempt_count integer not null default 1 check (dispatch_attempt_count between 1 and 3),
  dispatch_lease_owner text,
  dispatch_lease_expires_at timestamptz,
  automatic_retry_allowed boolean not null default false,
  reconciliation_required boolean not null default false,
  accepted_by_provider_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  failure_category text,
  audit_event_id uuid not null,
  outbox_event_id uuid not null,
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, id),
  unique (tenant_id, clinic_id, message_request_id),
  unique (tenant_id, clinic_id, audit_event_id),
  unique (tenant_id, clinic_id, outbox_event_id),
  constraint meta_whatsapp_outbound_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_outbound_patient_fk
    foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete set null,
  constraint meta_whatsapp_outbound_consent_fk
    foreign key (tenant_id, consent_evidence_id) references consents(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_outbound_audit_fk
    foreign key (tenant_id, clinic_id, audit_event_id)
    references audit_events(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_outbound_outbox_fk
    foreign key (tenant_id, clinic_id, outbox_event_id)
    references outbox_events(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_outbound_retry_truth_check check (
    (dispatch_outcome = 'not_dispatched' and automatic_retry_allowed and not reconciliation_required)
    or (dispatch_outcome = 'dispatch_ambiguous' and not automatic_retry_allowed and reconciliation_required)
    or (dispatch_outcome not in ('not_dispatched', 'dispatch_ambiguous') and not automatic_retry_allowed)
  ),
  constraint meta_whatsapp_outbound_lease_truth_check check (
    (
      dispatch_outcome = 'pending'
      and dispatch_lease_owner is not null
      and dispatch_lease_expires_at is not null
    )
    or (
      dispatch_outcome <> 'pending'
      and dispatch_lease_owner is null
      and dispatch_lease_expires_at is null
    )
  ),
  constraint meta_whatsapp_outbound_acceptance_truth_check check (
    (provider_message_id is not null and dispatch_outcome = 'accepted_by_provider' and accepted_by_provider_at is not null)
    or (provider_message_id is null and dispatch_outcome <> 'accepted_by_provider')
  )
);

create unique index meta_whatsapp_outbound_provider_message_uidx
  on meta_whatsapp_outbound_messages (tenant_id, clinic_id, external_account_id, provider_message_id)
  where provider_message_id is not null;

create or replace function clinic_os.enforce_meta_whatsapp_monotonic_state()
returns trigger
language plpgsql
set search_path = pg_catalog, public, clinic_os
as $$
begin
  if old.provider_message_id is not null and new.provider_message_id is distinct from old.provider_message_id then
    raise exception 'Meta provider message id is immutable';
  end if;
  if old.state in ('read', 'failed') and new.state <> old.state then
    raise exception 'Meta terminal message state cannot transition';
  end if;
  if old.state = 'delivered' and new.state in ('send_requested', 'accepted_by_provider', 'sent', 'failed') then
    raise exception 'Meta delivered message state cannot regress or fail';
  end if;
  if old.state = 'sent' and new.state in ('send_requested', 'accepted_by_provider') then
    raise exception 'Meta sent message state cannot regress';
  end if;
  if old.state = 'accepted_by_provider' and new.state = 'send_requested' then
    raise exception 'Meta accepted message state cannot regress';
  end if;
  if old.sent_at is not null and new.sent_at is distinct from old.sent_at then
    raise exception 'Meta signed sent timestamp is immutable';
  end if;
  if old.delivered_at is not null and new.delivered_at is distinct from old.delivered_at then
    raise exception 'Meta signed delivered timestamp is immutable';
  end if;
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    raise exception 'Meta signed read timestamp is immutable';
  end if;
  if old.failed_at is not null and new.failed_at is distinct from old.failed_at then
    raise exception 'Meta signed failed timestamp is immutable';
  end if;
  new.row_version := old.row_version + 1;
  new.updated_at := now();
  return new;
end
$$;

create trigger meta_whatsapp_outbound_monotonic
before update on meta_whatsapp_outbound_messages
for each row execute function clinic_os.enforce_meta_whatsapp_monotonic_state();

create table meta_whatsapp_service_windows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  recipient_endpoint_hmac char(64) not null check (recipient_endpoint_hmac ~ '^[0-9a-f]{64}$'),
  opened_by_event_receipt_id uuid not null,
  opened_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, external_account_id, recipient_endpoint_hmac, opened_by_event_receipt_id),
  constraint meta_whatsapp_service_windows_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_service_windows_receipt_fk
    foreign key (tenant_id, clinic_id, opened_by_event_receipt_id)
    references meta_whatsapp_event_receipts(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_service_windows_24h_check check (expires_at = opened_at + interval '24 hours')
);

create index meta_whatsapp_service_windows_lookup_idx
  on meta_whatsapp_service_windows
    (tenant_id, clinic_id, external_account_id, recipient_endpoint_hmac, expires_at desc);

create table meta_whatsapp_template_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  provider_template_id text not null check (provider_template_id ~ '^[1-9][0-9]{1,31}$'),
  template_name text not null check (template_name ~ '^[a-z0-9_]{1,512}$'),
  language_code text not null check (language_code ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  lifecycle_state text not null check (
    lifecycle_state in ('pending', 'approved', 'rejected', 'paused', 'disabled', 'deleted', 'unknown')
  ),
  last_event_receipt_id uuid not null,
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, external_account_id, provider_template_id, language_code),
  constraint meta_whatsapp_template_snapshots_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_template_snapshots_receipt_fk
    foreign key (tenant_id, clinic_id, last_event_receipt_id)
    references meta_whatsapp_event_receipts(tenant_id, clinic_id, id) on delete restrict
);

create table meta_whatsapp_consent_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid,
  event_receipt_id uuid not null,
  recipient_endpoint_hmac char(64) not null check (recipient_endpoint_hmac ~ '^[0-9a-f]{64}$'),
  command text not null check (command in ('opt_out', 'opt_in_request')),
  outcome text not null check (
    outcome in ('consent_revoked', 'already_revoked', 'no_active_consent', 'manual_review_required')
  ),
  affected_consent_id uuid,
  audit_event_id uuid not null,
  outbox_event_id uuid not null,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, event_receipt_id),
  constraint meta_whatsapp_consent_commands_patient_fk
    foreign key (tenant_id, clinic_id, patient_id)
    references patients(tenant_id, clinic_id, id) on delete set null,
  constraint meta_whatsapp_consent_commands_receipt_fk
    foreign key (tenant_id, clinic_id, event_receipt_id)
    references meta_whatsapp_event_receipts(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_consent_commands_consent_fk
    foreign key (tenant_id, affected_consent_id) references consents(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_consent_commands_audit_fk
    foreign key (tenant_id, clinic_id, audit_event_id)
    references audit_events(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_consent_commands_outbox_fk
    foreign key (tenant_id, clinic_id, outbox_event_id)
    references outbox_events(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_consent_commands_truth_check check (
    (outcome = 'manual_review_required' and affected_consent_id is null)
    or (
      command = 'opt_out'
      and (
        (outcome in ('consent_revoked', 'already_revoked') and affected_consent_id is not null)
        or (outcome = 'no_active_consent' and affected_consent_id is null)
      )
    )
  )
);

create table meta_whatsapp_reconciliation_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  outbound_message_id uuid,
  event_receipt_id uuid,
  reason text not null check (
    reason in ('dispatch_ambiguous', 'unknown_status', 'conflicting_terminal_status', 'webhook_gap', 'unsupported_change')
  ),
  status text not null default 'pending' check (
    status in ('pending', 'leased', 'matched', 'difference', 'provider_unavailable', 'unsupported', 'dead_lettered')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  next_attempt_at timestamptz,
  lease_owner text,
  lease_expires_at timestamptz,
  last_safe_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint meta_whatsapp_reconciliation_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_reconciliation_outbound_fk
    foreign key (tenant_id, clinic_id, outbound_message_id)
    references meta_whatsapp_outbound_messages(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_reconciliation_receipt_fk
    foreign key (tenant_id, clinic_id, event_receipt_id)
    references meta_whatsapp_event_receipts(tenant_id, clinic_id, id) on delete restrict,
  constraint meta_whatsapp_reconciliation_subject_check check (
    (outbound_message_id is not null)::integer + (event_receipt_id is not null)::integer = 1
  ),
  constraint meta_whatsapp_reconciliation_lease_check check (
    (status = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_owner is null and lease_expires_at is null)
  )
);

create unique index meta_whatsapp_reconciliation_active_outbound_uidx
  on meta_whatsapp_reconciliation_jobs (tenant_id, clinic_id, outbound_message_id)
  where outbound_message_id is not null
    and status in ('pending', 'leased', 'provider_unavailable');

create index meta_whatsapp_reconciliation_due_idx
  on meta_whatsapp_reconciliation_jobs (status, next_attempt_at, created_at)
  where status in ('pending', 'provider_unavailable');
create unique index meta_whatsapp_reconciliation_active_uidx
  on meta_whatsapp_reconciliation_jobs (
    tenant_id,
    clinic_id,
    external_account_id,
    coalesce(outbound_message_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(event_receipt_id, '00000000-0000-0000-0000-000000000000'::uuid),
    reason
  )
  where status in ('pending', 'leased', 'provider_unavailable');

create table razorpay_business_effects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  raw_webhook_event_id uuid not null,
  business_key text not null check (length(trim(business_key)) between 1 and 256),
  effect_kind text not null check (
    effect_kind in (
      'payment_capture', 'payment_failure', 'refund', 'dispute_review',
      'payment_request_state', 'reconciliation'
    )
  ),
  provider_payment_id text,
  provider_refund_id text,
  provider_dispute_id text,
  payment_transaction_id uuid,
  payment_request_id uuid,
  payment_reconciliation_item_id uuid,
  amount_minor bigint not null default 0 check (amount_minor >= 0),
  safe_applied_amount_minor bigint not null default 0 check (safe_applied_amount_minor >= 0),
  unallocated_amount_minor bigint not null default 0 check (unallocated_amount_minor >= 0),
  cumulative_refunded_amount_minor bigint not null default 0 check (cumulative_refunded_amount_minor >= 0),
  event_rank integer not null check (event_rank between 0 and 100),
  result_digest char(64) not null check (result_digest ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, external_account_id, business_key),
  constraint razorpay_business_effects_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_business_effects_event_fk
    foreign key (tenant_id, clinic_id, raw_webhook_event_id)
    references raw_webhook_events(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_business_effects_transaction_fk
    foreign key (tenant_id, clinic_id, payment_transaction_id)
    references payment_transactions(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_business_effects_request_fk
    foreign key (tenant_id, clinic_id, payment_request_id)
    references payment_requests(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_business_effects_reconciliation_fk
    foreign key (tenant_id, clinic_id, payment_reconciliation_item_id)
    references payment_reconciliation_items(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_business_effects_reference_check check (
    num_nonnulls(payment_transaction_id, payment_request_id, payment_reconciliation_item_id) = 1
  ),
  constraint razorpay_business_effects_amount_check check (
    amount_minor = safe_applied_amount_minor + unallocated_amount_minor
  )
);

create unique index razorpay_business_effects_payment_capture_uidx
  on razorpay_business_effects (tenant_id, clinic_id, external_account_id, provider_payment_id)
  where effect_kind = 'payment_capture' and provider_payment_id is not null;
create unique index razorpay_business_effects_refund_uidx
  on razorpay_business_effects (tenant_id, clinic_id, external_account_id, provider_refund_id)
  where effect_kind = 'refund' and provider_refund_id is not null;

create table razorpay_reconciliation_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  provider_payment_id text check (
    provider_payment_id is null or length(trim(provider_payment_id)) between 1 and 256
  ),
  provider_request_reference text check (
    provider_request_reference is null or length(trim(provider_request_reference)) between 1 and 256
  ),
  invoice_id uuid,
  payment_reconciliation_item_id uuid,
  reason text not null check (
    reason in (
      'missing_local_capture', 'amount_mismatch', 'currency_mismatch',
      'refund_mismatch', 'provider_not_captured', 'provider_outage', 'creation_outcome_unknown'
    )
  ),
  status text not null check (
    status in ('pending', 'leased', 'retry_scheduled', 'matched', 'variance', 'dead_lettered')
  ),
  attempt_count integer not null default 0 check (attempt_count between 0 and 8),
  lease_owner text,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  provider_snapshot_digest char(64) check (provider_snapshot_digest ~ '^[0-9a-f]{64}$'),
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint razorpay_reconciliation_jobs_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_reconciliation_jobs_invoice_fk
    foreign key (tenant_id, clinic_id, invoice_id)
    references invoices(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_reconciliation_jobs_item_fk
    foreign key (tenant_id, clinic_id, payment_reconciliation_item_id)
    references payment_reconciliation_items(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_reconciliation_jobs_subject_check check (
    (provider_payment_id is not null)::integer
      + (provider_request_reference is not null)::integer = 1
    and (
      (
        reason = 'creation_outcome_unknown'
        and provider_request_reference is not null
        and invoice_id is not null
      )
      or (
        reason <> 'creation_outcome_unknown'
        and provider_payment_id is not null
      )
    )
  ),
  constraint razorpay_reconciliation_jobs_lease_check check (
    (status = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_owner is null and lease_expires_at is null)
  ),
  constraint razorpay_reconciliation_jobs_retry_check check (
    (status = 'retry_scheduled' and next_attempt_at is not null)
    or (status <> 'retry_scheduled' and next_attempt_at is null)
  )
);

create unique index razorpay_reconciliation_jobs_subject_uidx
  on razorpay_reconciliation_jobs (
    tenant_id,
    clinic_id,
    external_account_id,
    coalesce(provider_payment_id, ''),
    coalesce(provider_request_reference, ''),
    reason
  );
create index razorpay_reconciliation_jobs_due_idx
  on razorpay_reconciliation_jobs (tenant_id, clinic_id, status, next_attempt_at, created_at);
create trigger razorpay_reconciliation_jobs_set_updated_at
before update on razorpay_reconciliation_jobs
for each row execute function clinic_os.set_updated_at();

alter table payment_requests drop constraint if exists payment_requests_status_check;
alter table payment_requests add constraint payment_requests_status_check check (
  status in (
    'requested', 'provider_created', 'sent', 'partially_paid', 'paid',
    'closed', 'expired', 'cancelled', 'failed'
  )
);

alter table payment_reconciliation_items
  drop constraint if exists payment_reconciliation_items_reason_check;
alter table payment_reconciliation_items
  add constraint payment_reconciliation_items_reason_check check (
    reason in (
      'overpayment', 'missing_invoice_reference', 'currency_mismatch',
      'invalid_provider_amount', 'scope_mismatch', 'manual_review_required',
      'account_scope_mismatch', 'missing_payment_request', 'invoice_mismatch',
      'patient_mismatch', 'amount_mismatch', 'invalid_amount',
      'invoice_not_issuable', 'refund_without_payment', 'refund_exceeds_captured',
      'dispute_requires_review', 'out_of_order_conflict', 'unsupported_event'
    )
  );

alter table provider_callback_registrations enable row level security;
alter table provider_callback_registrations force row level security;
create policy provider_callback_registrations_tenant_clinic_isolation
  on provider_callback_registrations
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table meta_whatsapp_webhook_commits enable row level security;
alter table meta_whatsapp_webhook_commits force row level security;
alter table meta_whatsapp_event_receipts enable row level security;
alter table meta_whatsapp_event_receipts force row level security;
alter table meta_whatsapp_outbound_messages enable row level security;
alter table meta_whatsapp_outbound_messages force row level security;
alter table meta_whatsapp_service_windows enable row level security;
alter table meta_whatsapp_service_windows force row level security;
alter table meta_whatsapp_consent_commands enable row level security;
alter table meta_whatsapp_consent_commands force row level security;
alter table meta_whatsapp_template_snapshots enable row level security;
alter table meta_whatsapp_template_snapshots force row level security;
alter table meta_whatsapp_reconciliation_jobs enable row level security;
alter table meta_whatsapp_reconciliation_jobs force row level security;
alter table razorpay_business_effects enable row level security;
alter table razorpay_business_effects force row level security;
alter table razorpay_reconciliation_jobs enable row level security;
alter table razorpay_reconciliation_jobs force row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'meta_whatsapp_webhook_commits',
    'meta_whatsapp_event_receipts',
    'meta_whatsapp_outbound_messages',
    'meta_whatsapp_service_windows',
    'meta_whatsapp_consent_commands',
    'meta_whatsapp_template_snapshots',
    'meta_whatsapp_reconciliation_jobs',
    'razorpay_business_effects',
    'razorpay_reconciliation_jobs'
  ]
  loop
    execute format(
      'create policy %I on %I using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id()) with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())',
      table_name || '_tenant_clinic_isolation',
      table_name
    );
  end loop;
end
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'clinic_os_runtime') then
    grant execute on function clinic_os.resolve_provider_callback_registration(text, char(64))
      to clinic_os_runtime;
    grant select, insert, update on
      provider_callback_registrations,
      meta_whatsapp_webhook_commits,
      meta_whatsapp_event_receipts,
      meta_whatsapp_outbound_messages,
      meta_whatsapp_service_windows,
      meta_whatsapp_consent_commands,
      meta_whatsapp_template_snapshots,
      meta_whatsapp_reconciliation_jobs,
      razorpay_business_effects,
      razorpay_reconciliation_jobs
      to clinic_os_runtime;
  end if;
  if exists (select 1 from pg_roles where rolname = 'clinic_os_worker') then
    grant select, insert, update on
      provider_callback_registrations,
      meta_whatsapp_event_receipts,
      meta_whatsapp_outbound_messages,
      meta_whatsapp_service_windows,
      meta_whatsapp_consent_commands,
      meta_whatsapp_template_snapshots,
      meta_whatsapp_reconciliation_jobs,
      razorpay_business_effects,
      razorpay_reconciliation_jobs
      to clinic_os_worker;
  end if;
end
$$;

comment on table provider_callback_registrations is
  'Forced-RLS callback activation truth. Contains opaque public-key digests and secret-manager references only, never credential values.';
comment on table meta_whatsapp_webhook_commits is
  'Atomic link from a verified bounded raw Meta webhook to restricted ciphertext, audit and durable outbox evidence.';
comment on table razorpay_business_effects is
  'Account-scoped business idempotency across duplicate and out-of-order signed Razorpay events.';
