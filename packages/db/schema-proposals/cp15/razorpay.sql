-- CP15 Razorpay schema proposal.
--
-- This is intentionally not a canonical migration. The checkpoint master must reconcile it into
-- the next numbered migration, run the migration preflight against restored CP13/CP14 data, and
-- grant only the exact runtime/worker operations used by the final adapter.
--
-- Reuse: external_accounts, raw_webhook_events, payment_provider_request_intents,
-- payment_reconciliation_items, payment_requests, payment_transactions, audit_events and
-- outbox_events remain authoritative. No parallel webhook/audit/outbox/payment ledger is created.

alter table raw_webhook_events
  add column if not exists verified_secret_version text,
  add column if not exists verified_with_previous_secret boolean not null default false,
  add column if not exists raw_body_length integer;

alter table raw_webhook_events
  drop constraint if exists raw_webhook_events_cp15_rotation_evidence_check,
  add constraint raw_webhook_events_cp15_rotation_evidence_check check (
    verification_status <> 'verified'
    or (
      length(trim(verified_secret_version)) > 0
      and raw_body_length between 1 and 262144
    )
  );

create table razorpay_account_bindings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  razorpay_account_id text not null check (
    razorpay_account_id ~ '^acc_[A-Za-z0-9]{4,64}$'
  ),
  provider_mode text not null check (provider_mode in ('test', 'live')),
  activation_state text not null check (
    activation_state in (
      'absent', 'registered', 'configured', 'sandbox_verified',
      'production_verified', 'degraded', 'disabled'
    )
  ),
  webhook_registration_ref text,
  webhook_callback_origin text,
  current_webhook_secret_ref text,
  current_webhook_secret_version text,
  previous_webhook_secret_ref text,
  previous_webhook_secret_version text,
  previous_secret_accept_until timestamptz,
  last_provider_probe_at timestamptz,
  last_verified_webhook_at timestamptz,
  last_reconciled_at timestamptz,
  last_failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, external_account_id),
  unique (razorpay_account_id, provider_mode),
  constraint razorpay_account_bindings_external_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_account_bindings_registration_check check (
    (activation_state in ('absent', 'disabled'))
    or (
      webhook_registration_ref is not null
      and webhook_callback_origin is not null
      and webhook_callback_origin ~ '^https://'
    )
  ),
  constraint razorpay_account_bindings_secret_refs_check check (
    (activation_state in ('absent', 'registered', 'disabled'))
    or (
      current_webhook_secret_ref is not null
      and current_webhook_secret_version is not null
    )
  ),
  constraint razorpay_account_bindings_previous_secret_check check (
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
  )
);

create trigger razorpay_account_bindings_set_updated_at
before update on razorpay_account_bindings
for each row execute function clinic_os.set_updated_at();

-- Required composite targets for account/clinic-scoped financial provenance. The canonical
-- migration should retain these even if it selects different index names.
create unique index if not exists payment_transactions_cp15_scope_id_uidx
  on payment_transactions (tenant_id, clinic_id, id);
create unique index if not exists payment_requests_cp15_scope_id_uidx
  on payment_requests (tenant_id, clinic_id, id);
create unique index if not exists payment_reconciliation_items_cp15_scope_id_uidx
  on payment_reconciliation_items (tenant_id, clinic_id, id);

-- One provider event can be unique while still describing the same financial effect as a second
-- product webhook (for example payment.captured and payment_link.paid). This ledger provides the
-- second, business-level idempotency boundary and points back to existing authoritative records.
create table razorpay_business_effects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  raw_webhook_event_id uuid not null,
  business_key text not null check (
    length(trim(business_key)) between 1 and 256
  ),
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
  )
);

create unique index razorpay_business_effects_payment_capture_uidx
  on razorpay_business_effects (tenant_id, clinic_id, external_account_id, provider_payment_id)
  where effect_kind = 'payment_capture' and provider_payment_id is not null;

create unique index razorpay_business_effects_refund_uidx
  on razorpay_business_effects (tenant_id, clinic_id, external_account_id, provider_refund_id)
  where effect_kind = 'refund' and provider_refund_id is not null;

-- Official API reads detect drift but never settle an invoice directly. A signed webhook or a
-- separately authorized, audited operator resolution is required to create financial truth.
create table razorpay_reconciliation_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  external_account_id uuid not null,
  provider_payment_id text not null check (length(trim(provider_payment_id)) > 0),
  invoice_id uuid,
  payment_reconciliation_item_id uuid,
  reason text not null check (
    reason in (
      'missing_local_capture', 'amount_mismatch', 'currency_mismatch',
      'refund_mismatch', 'provider_not_captured', 'provider_outage',
      'creation_outcome_unknown'
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
  unique (tenant_id, clinic_id, external_account_id, provider_payment_id, reason),
  constraint razorpay_reconciliation_jobs_account_fk
    foreign key (tenant_id, clinic_id, external_account_id)
    references external_accounts(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_reconciliation_jobs_invoice_fk
    foreign key (tenant_id, clinic_id, invoice_id)
    references invoices(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_reconciliation_jobs_item_fk
    foreign key (tenant_id, clinic_id, payment_reconciliation_item_id)
    references payment_reconciliation_items(tenant_id, clinic_id, id) on delete restrict,
  constraint razorpay_reconciliation_jobs_lease_check check (
    (status = 'leased' and lease_owner is not null and lease_expires_at is not null)
    or (status <> 'leased' and lease_owner is null and lease_expires_at is null)
  ),
  constraint razorpay_reconciliation_jobs_retry_check check (
    (status = 'retry_scheduled' and next_attempt_at is not null)
    or (status <> 'retry_scheduled' and next_attempt_at is null)
  )
);

create index razorpay_reconciliation_jobs_due_idx
  on razorpay_reconciliation_jobs (tenant_id, clinic_id, status, next_attempt_at, created_at);

create trigger razorpay_reconciliation_jobs_set_updated_at
before update on razorpay_reconciliation_jobs
for each row execute function clinic_os.set_updated_at();

-- The canonical migration must widen payment_reconciliation_items.reason to the complete CP15
-- enum before the service is registered. Existing values are preserved; no row is rewritten.
alter table payment_reconciliation_items
  drop constraint if exists payment_reconciliation_items_reason_check,
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

alter table razorpay_account_bindings enable row level security;
alter table razorpay_account_bindings force row level security;
create policy razorpay_account_bindings_tenant_clinic_isolation on razorpay_account_bindings
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table razorpay_business_effects enable row level security;
alter table razorpay_business_effects force row level security;
create policy razorpay_business_effects_tenant_clinic_isolation on razorpay_business_effects
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table razorpay_reconciliation_jobs enable row level security;
alter table razorpay_reconciliation_jobs force row level security;
create policy razorpay_reconciliation_jobs_tenant_clinic_isolation on razorpay_reconciliation_jobs
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

comment on table razorpay_account_bindings is
  'Secret-reference-only Razorpay registration, account, activation and rotation truth. Secret values are forbidden.';
comment on table razorpay_business_effects is
  'Account-scoped business idempotency across duplicate/out-of-order Razorpay product webhooks.';
comment on table razorpay_reconciliation_jobs is
  'Bounded official-API drift checks. Snapshot evidence cannot directly mark an invoice paid.';
