-- CP15 Meta WhatsApp Cloud schema proposal.
-- MASTER INTEGRATION REQUIRED: fold this into the next canonical numbered migration after review.
-- It deliberately reuses external_accounts, raw_webhook_events, normalized_integration_events,
-- audit_events, outbox_events, integration_attempts and integration_dead_letters.

create table meta_whatsapp_registrations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  activation_state text not null check (
    activation_state in (
      'absent', 'registered', 'configured', 'sandbox_verified',
      'production_verified', 'degraded', 'disabled'
    )
  ),
  callback_key_digest text check (callback_key_digest is null or callback_key_digest ~ '^[a-f0-9]{64}$'),
  callback_registration_ref text,
  app_id_digest text,
  business_account_id_digest text,
  phone_number_id_digest text,
  graph_api_version text check (graph_api_version is null or graph_api_version ~ '^v[0-9]{1,3}\.[0-9]{1,2}$'),
  sandbox_verified_at timestamptz,
  production_verified_at timestamptz,
  last_health_reason_code text not null,
  credential_ref text,
  enabled boolean not null default false,
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, external_account_id),
  constraint meta_whatsapp_registrations_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_registrations_account_fk
    foreign key (tenant_id, external_account_id) references external_accounts(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_registration_truth_check check (
    (activation_state = 'disabled' and not enabled)
    or (
      activation_state = 'absent'
      and not enabled
      and callback_key_digest is null
      and callback_registration_ref is null
      and sandbox_verified_at is null
      and production_verified_at is null
    )
    or (
      activation_state = 'registered'
      and not enabled
      and callback_key_digest is not null
      and callback_registration_ref is not null
      and sandbox_verified_at is null
      and production_verified_at is null
    )
    or (
      activation_state in ('configured', 'degraded')
      and not enabled
      and callback_key_digest is not null
      and callback_registration_ref is not null
      and credential_ref is not null
      and graph_api_version is not null
    )
    or (
      activation_state = 'sandbox_verified'
      and callback_key_digest is not null
      and callback_registration_ref is not null
      and credential_ref is not null
      and sandbox_verified_at is not null
      and production_verified_at is null
      and enabled
    )
    or (
      activation_state = 'production_verified'
      and callback_key_digest is not null
      and callback_registration_ref is not null
      and credential_ref is not null
      and sandbox_verified_at is not null
      and production_verified_at is not null
      and enabled
    )
  )
);

create unique index meta_whatsapp_registrations_callback_key_unique
  on meta_whatsapp_registrations(callback_key_digest)
  where callback_key_digest is not null;

-- The existing raw_payload column contains only this restricted ciphertext pointer for Meta events;
-- raw bytes and parsed provider JSON never become diagnostic/audit metadata.
alter table raw_webhook_events
  add constraint raw_webhook_events_meta_pointer_only check (
    provider_key <> 'meta_whatsapp_cloud'
    or (
      jsonb_typeof(raw_payload) = 'object'
      and raw_payload ?& array['ciphertext_ref', 'digest', 'byte_length', 'retention_class']
      and raw_payload - array['ciphertext_ref', 'digest', 'byte_length', 'retention_class'] = '{}'::jsonb
      and raw_payload ->> 'digest' = raw_payload_digest
      and raw_payload ->> 'retention_class' = 'provider_webhook_restricted'
    )
  );

create table meta_whatsapp_webhook_commits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  raw_event_id uuid not null,
  raw_body_digest text not null check (raw_body_digest ~ '^[a-f0-9]{64}$'),
  raw_body_ciphertext_ref text not null check (length(raw_body_ciphertext_ref) between 1 and 2048),
  raw_body_byte_length integer not null check (raw_body_byte_length between 1 and 1048576),
  audit_event_id uuid not null unique references audit_events(id) on delete restrict,
  outbox_event_id uuid not null unique references outbox_events(id) on delete restrict,
  correlation_id text not null check (length(correlation_id) between 1 and 256),
  received_at timestamptz not null,
  committed_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, external_account_id, raw_body_digest),
  constraint meta_whatsapp_webhook_commits_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_webhook_commits_account_fk
    foreign key (tenant_id, external_account_id) references external_accounts(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_webhook_commits_raw_event_fk
    foreign key (tenant_id, raw_event_id) references raw_webhook_events(tenant_id, id) on delete restrict
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
  unique (tenant_id, external_account_id, unique_event_key),
  unique (tenant_id, normalized_event_id),
  constraint meta_whatsapp_event_receipts_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_event_receipts_account_fk
    foreign key (tenant_id, external_account_id) references external_accounts(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_event_receipts_commit_fk
    foreign key (tenant_id, webhook_commit_id) references meta_whatsapp_webhook_commits(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_event_receipts_normalized_fk
    foreign key (tenant_id, normalized_event_id) references normalized_integration_events(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_event_receipts_outcome_check check (
    (application_outcome = 'pending' and applied_at is null)
    or (application_outcome <> 'pending' and applied_at is not null)
  )
);

create table meta_whatsapp_outbound_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  message_request_id uuid not null,
  patient_id uuid,
  recipient_endpoint_hmac text not null check (recipient_endpoint_hmac ~ '^[a-f0-9]{64}$'),
  purpose text not null check (
    purpose in ('care_instruction', 'appointment', 'payment', 'recall', 'marketing', 'human_reply')
  ),
  template_name text not null check (template_name ~ '^[a-z0-9_]{1,512}$'),
  template_language text not null check (template_language ~ '^[a-z]{2,3}(_[A-Z]{2})?$'),
  template_snapshot_id uuid,
  consent_evidence_id uuid not null,
  consent_template_version integer not null check (consent_template_version > 0),
  provider_message_id text check (provider_message_id is null or length(provider_message_id) between 7 and 512),
  state text not null check (
    state in ('send_requested', 'accepted_by_provider', 'sent', 'delivered', 'read', 'failed')
  ),
  dispatch_outcome text not null check (
    dispatch_outcome in ('pending', 'not_dispatched', 'accepted_by_provider', 'dispatch_ambiguous', 'rejected')
  ),
  automatic_retry_allowed boolean not null default false,
  reconciliation_required boolean not null default false,
  accepted_by_provider_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz,
  failure_category text,
  audit_event_id uuid not null unique references audit_events(id) on delete restrict,
  outbox_event_id uuid not null unique references outbox_events(id) on delete restrict,
  row_version bigint not null default 1 check (row_version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, message_request_id),
  constraint meta_whatsapp_outbound_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_outbound_account_fk
    foreign key (tenant_id, external_account_id) references external_accounts(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_outbound_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete set null,
  constraint meta_whatsapp_outbound_consent_fk
    foreign key (tenant_id, consent_evidence_id) references consents(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_outbound_retry_truth_check check (
    (dispatch_outcome = 'not_dispatched' and automatic_retry_allowed and not reconciliation_required)
    or (dispatch_outcome = 'dispatch_ambiguous' and not automatic_retry_allowed and reconciliation_required)
    or (dispatch_outcome not in ('not_dispatched', 'dispatch_ambiguous') and not automatic_retry_allowed)
  ),
  constraint meta_whatsapp_outbound_acceptance_truth_check check (
    (provider_message_id is not null and dispatch_outcome = 'accepted_by_provider' and accepted_by_provider_at is not null)
    or (provider_message_id is null and dispatch_outcome <> 'accepted_by_provider')
  ),
  constraint meta_whatsapp_outbound_state_truth_check check (
    (dispatch_outcome in ('pending', 'not_dispatched', 'dispatch_ambiguous', 'rejected') and state = 'send_requested')
    or (dispatch_outcome = 'accepted_by_provider' and state in ('accepted_by_provider', 'sent', 'delivered', 'read', 'failed'))
  )
);

create unique index meta_whatsapp_outbound_provider_message_unique
  on meta_whatsapp_outbound_messages(tenant_id, external_account_id, provider_message_id)
  where provider_message_id is not null;

create table meta_whatsapp_service_windows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  recipient_endpoint_hmac text not null check (recipient_endpoint_hmac ~ '^[a-f0-9]{64}$'),
  opened_by_event_receipt_id uuid not null,
  opened_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, external_account_id, recipient_endpoint_hmac, opened_by_event_receipt_id),
  constraint meta_whatsapp_service_windows_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_service_windows_account_fk
    foreign key (tenant_id, external_account_id) references external_accounts(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_service_windows_receipt_fk
    foreign key (tenant_id, opened_by_event_receipt_id) references meta_whatsapp_event_receipts(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_service_windows_24h_check check (
    expires_at = opened_at + interval '24 hours'
  )
);

create table meta_whatsapp_consent_commands (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid,
  event_receipt_id uuid not null,
  recipient_endpoint_hmac text not null check (recipient_endpoint_hmac ~ '^[a-f0-9]{64}$'),
  command text not null check (command in ('opt_out', 'opt_in_request')),
  outcome text not null check (
    outcome in ('consent_revoked', 'already_revoked', 'no_active_consent', 'manual_review_required')
  ),
  affected_consent_id uuid,
  audit_event_id uuid not null unique references audit_events(id) on delete restrict,
  outbox_event_id uuid not null unique references outbox_events(id) on delete restrict,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, event_receipt_id),
  constraint meta_whatsapp_consent_commands_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_consent_commands_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete set null,
  constraint meta_whatsapp_consent_commands_receipt_fk
    foreign key (tenant_id, event_receipt_id) references meta_whatsapp_event_receipts(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_consent_commands_consent_fk
    foreign key (tenant_id, affected_consent_id) references consents(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_consent_commands_truth_check check (
    (command = 'opt_in_request' and outcome = 'manual_review_required' and affected_consent_id is null)
    or (
      command = 'opt_out'
      and (
        (outcome in ('consent_revoked', 'already_revoked') and affected_consent_id is not null)
        or (outcome = 'no_active_consent' and affected_consent_id is null)
      )
    )
  )
);

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
  unique (tenant_id, external_account_id, provider_template_id, language_code),
  constraint meta_whatsapp_template_snapshots_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_template_snapshots_account_fk
    foreign key (tenant_id, external_account_id) references external_accounts(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_template_snapshots_receipt_fk
    foreign key (tenant_id, last_event_receipt_id) references meta_whatsapp_event_receipts(tenant_id, id) on delete restrict
);

alter table meta_whatsapp_outbound_messages
  add constraint meta_whatsapp_outbound_template_snapshot_fk
  foreign key (tenant_id, template_snapshot_id) references meta_whatsapp_template_snapshots(tenant_id, id) on delete restrict;

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
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz,
  locked_by text,
  locked_until timestamptz,
  last_safe_error_code text,
  audit_event_id uuid not null unique references audit_events(id) on delete restrict,
  outbox_event_id uuid not null unique references outbox_events(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint meta_whatsapp_reconciliation_clinic_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_reconciliation_account_fk
    foreign key (tenant_id, external_account_id) references external_accounts(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_reconciliation_outbound_fk
    foreign key (tenant_id, outbound_message_id) references meta_whatsapp_outbound_messages(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_reconciliation_receipt_fk
    foreign key (tenant_id, event_receipt_id) references meta_whatsapp_event_receipts(tenant_id, id) on delete restrict,
  constraint meta_whatsapp_reconciliation_subject_check check (
    (outbound_message_id is not null)::integer + (event_receipt_id is not null)::integer = 1
  ),
  constraint meta_whatsapp_reconciliation_lease_check check (
    (locked_by is null and locked_until is null)
    or (locked_by is not null and locked_until is not null and status = 'leased')
  )
);

create unique index meta_whatsapp_reconciliation_active_unique
  on meta_whatsapp_reconciliation_jobs(
    tenant_id,
    external_account_id,
    coalesce(outbound_message_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(event_receipt_id, '00000000-0000-0000-0000-000000000000'::uuid),
    reason
  )
  where status in ('pending', 'leased', 'provider_unavailable');

create function clinic_os.enforce_meta_whatsapp_monotonic_state()
returns trigger
language plpgsql
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

create index meta_whatsapp_event_receipts_pending_idx
  on meta_whatsapp_event_receipts(tenant_id, clinic_id, created_at)
  where application_outcome = 'pending';
create index meta_whatsapp_reconciliation_due_idx
  on meta_whatsapp_reconciliation_jobs(status, next_attempt_at, created_at)
  where status in ('pending', 'provider_unavailable');
create index meta_whatsapp_service_windows_lookup_idx
  on meta_whatsapp_service_windows(tenant_id, clinic_id, external_account_id, recipient_endpoint_hmac, expires_at desc);

alter table meta_whatsapp_registrations enable row level security;
alter table meta_whatsapp_registrations force row level security;
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

create policy meta_whatsapp_registrations_tenant_clinic on meta_whatsapp_registrations
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy meta_whatsapp_webhook_commits_tenant_clinic on meta_whatsapp_webhook_commits
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy meta_whatsapp_event_receipts_tenant_clinic on meta_whatsapp_event_receipts
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy meta_whatsapp_outbound_messages_tenant_clinic on meta_whatsapp_outbound_messages
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy meta_whatsapp_service_windows_tenant_clinic on meta_whatsapp_service_windows
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy meta_whatsapp_consent_commands_tenant_clinic on meta_whatsapp_consent_commands
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy meta_whatsapp_template_snapshots_tenant_clinic on meta_whatsapp_template_snapshots
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());
create policy meta_whatsapp_reconciliation_jobs_tenant_clinic on meta_whatsapp_reconciliation_jobs
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

create policy meta_whatsapp_event_receipts_worker on meta_whatsapp_event_receipts
  for all using (current_user = 'clinic_os_worker') with check (current_user = 'clinic_os_worker');
create policy meta_whatsapp_outbound_messages_worker on meta_whatsapp_outbound_messages
  for all using (current_user = 'clinic_os_worker') with check (current_user = 'clinic_os_worker');
create policy meta_whatsapp_service_windows_worker on meta_whatsapp_service_windows
  for all using (current_user = 'clinic_os_worker') with check (current_user = 'clinic_os_worker');
create policy meta_whatsapp_consent_commands_worker on meta_whatsapp_consent_commands
  for all using (current_user = 'clinic_os_worker') with check (current_user = 'clinic_os_worker');
create policy meta_whatsapp_template_snapshots_worker on meta_whatsapp_template_snapshots
  for all using (current_user = 'clinic_os_worker') with check (current_user = 'clinic_os_worker');
create policy meta_whatsapp_reconciliation_jobs_worker on meta_whatsapp_reconciliation_jobs
  for all using (current_user = 'clinic_os_worker') with check (current_user = 'clinic_os_worker');

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'clinic_os_runtime') then
    grant select, insert, update on
      meta_whatsapp_webhook_commits,
      meta_whatsapp_event_receipts,
      meta_whatsapp_outbound_messages,
      meta_whatsapp_reconciliation_jobs
    to clinic_os_runtime;
    grant select on meta_whatsapp_registrations, meta_whatsapp_service_windows, meta_whatsapp_consent_commands, meta_whatsapp_template_snapshots
    to clinic_os_runtime;
  end if;
  if exists (select 1 from pg_roles where rolname = 'clinic_os_worker') then
    grant select, insert, update on
      meta_whatsapp_event_receipts,
      meta_whatsapp_outbound_messages,
      meta_whatsapp_service_windows,
      meta_whatsapp_consent_commands,
      meta_whatsapp_template_snapshots,
      meta_whatsapp_reconciliation_jobs
    to clinic_os_worker;
  end if;
end
$$;

comment on table meta_whatsapp_webhook_commits is
  'Atomic link from a verified bounded raw Meta webhook to restricted ciphertext, canonical audit and durable outbox evidence.';
comment on table meta_whatsapp_event_receipts is
  'Provider-event uniqueness and application outcomes. Duplicate/stale/reconciliation outcomes never imply message delivery.';
comment on table meta_whatsapp_outbound_messages is
  'Outbound message truth. Synchronous API acceptance never populates signed sent/delivered/read timestamps.';
comment on table meta_whatsapp_reconciliation_jobs is
  'Durable recovery queue for ambiguous dispatches, webhook gaps, unknown statuses and unsupported signed changes.';
