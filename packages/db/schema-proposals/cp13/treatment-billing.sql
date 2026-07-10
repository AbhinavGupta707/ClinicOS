-- CP13 Lane C exact schema proposal. This file is not a canonical migration.
--
-- Proven gap: payment_transactions can persist signed settlement only after an invoice is resolved.
-- The frozen billing port cannot atomically claim every verified provider event or persist a
-- missing-invoice/scope/currency/overpayment reconciliation item. The canonical CP13 migration
-- should reconcile this proposal with the existing raw_webhook_events integration ledger.

create table if not exists payment_provider_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  provider_account_key text not null check (length(trim(provider_account_key)) > 0),
  provider_key text not null check (provider_key in ('razorpay')),
  provider_event_id text not null check (length(trim(provider_event_id)) > 0),
  idempotency_key text not null check (length(trim(idempotency_key)) > 0),
  event_name text not null check (length(trim(event_name)) > 0),
  event_kind text not null check (
    event_kind in ('payment_succeeded', 'payment_failed', 'payment_authorized', 'payment_ignored')
  ),
  raw_body_sha256 char(64) not null check (raw_body_sha256 ~ '^[0-9a-f]{64}$'),
  signature_sha256 char(64) not null check (signature_sha256 ~ '^[0-9a-f]{64}$'),
  verification_status text not null check (verification_status = 'verified'),
  processing_status text not null default 'processing' check (
    processing_status in ('processing', 'applied', 'ignored', 'reconciliation_required', 'failed')
  ),
  claimed_by text not null check (length(trim(claimed_by)) > 0),
  lease_expires_at timestamptz not null,
  attempt_count integer not null default 1 check (attempt_count > 0),
  normalized_event jsonb not null check (jsonb_typeof(normalized_event) = 'object'),
  result_projection jsonb check (
    result_projection is null or jsonb_typeof(result_projection) = 'object'
  ),
  received_at timestamptz not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, provider_account_key, provider_event_id),
  unique (tenant_id, provider_key, idempotency_key),
  constraint payment_provider_events_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint payment_provider_events_completed_state_check check (
    (processing_status = 'processing' and processed_at is null and result_projection is null)
    or (processing_status <> 'processing' and processed_at is not null and result_projection is not null)
  )
);

create index if not exists payment_provider_events_processing_idx
  on payment_provider_events(tenant_id, clinic_id, processing_status, lease_expires_at);

create table if not exists payment_reconciliation_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  payment_provider_event_id uuid not null,
  invoice_id uuid,
  patient_id uuid,
  reason text not null check (
    reason in (
      'overpayment',
      'missing_invoice_reference',
      'currency_mismatch',
      'invalid_provider_amount',
      'scope_mismatch',
      'manual_review_required'
    )
  ),
  captured_amount_minor bigint not null check (captured_amount_minor >= 0),
  applied_amount_minor bigint not null default 0 check (applied_amount_minor >= 0),
  unallocated_amount_minor bigint not null check (unallocated_amount_minor >= 0),
  currency text,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  evidence jsonb not null check (jsonb_typeof(evidence) = 'object'),
  resolution_reason text,
  resolved_by_user_id uuid references users(id) on delete restrict,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, payment_provider_event_id),
  constraint payment_reconciliation_items_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint payment_reconciliation_items_event_fk
    foreign key (tenant_id, payment_provider_event_id)
    references payment_provider_events(tenant_id, id) on delete restrict,
  constraint payment_reconciliation_items_invoice_fk
    foreign key (tenant_id, invoice_id) references invoices(tenant_id, id) on delete restrict,
  constraint payment_reconciliation_items_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint payment_reconciliation_items_amount_check check (
    captured_amount_minor = applied_amount_minor + unallocated_amount_minor
  ),
  constraint payment_reconciliation_items_resolution_check check (
    (status = 'open' and resolved_by_user_id is null and resolved_at is null and resolution_reason is null)
    or (status <> 'open' and resolved_by_user_id is not null and resolved_at is not null
      and length(trim(resolution_reason)) > 0)
  )
);

alter table payment_provider_events enable row level security;
alter table payment_provider_events force row level security;
create policy payment_provider_events_tenant_clinic_isolation on payment_provider_events
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table payment_reconciliation_items enable row level security;
alter table payment_reconciliation_items force row level security;
create policy payment_reconciliation_items_tenant_clinic_isolation on payment_reconciliation_items
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

comment on table payment_provider_events is
  'Verified, restart-safe provider-event claim ledger resolved from registered callback account authority.';
comment on table payment_reconciliation_items is
  'Durable unallocated or unsafe provider payment evidence; never an invented settlement record.';
