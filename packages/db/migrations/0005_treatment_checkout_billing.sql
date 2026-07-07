-- Checkpoint 5: pricebook, treatment plans, completed procedures, invoices, payments, and receipts.
-- Applies after 0004_dental_charting_findings_snapshots.sql on PostgreSQL 16+.

insert into permissions (key, display_name, category, description, phi_involved)
values
  ('billing.read', 'Read billing', 'billing', 'Read invoices, dues, payment requests, payment state, and receipts.', false),
  ('billing.write', 'Write billing', 'billing', 'Create invoices, payment requests, payment records, and receipts.', false),
  ('billing.export', 'Export billing', 'billing', 'Export billing and payment reports.', false)
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
    ('owner_admin', 'billing.read'),
    ('owner_admin', 'billing.write'),
    ('owner_admin', 'billing.export'),
    ('doctor', 'billing.read'),
    ('assistant', 'billing.read'),
    ('receptionist', 'billing.read'),
    ('receptionist', 'billing.write'),
    ('accountant', 'billing.read'),
    ('accountant', 'billing.write'),
    ('accountant', 'billing.export'),
    ('platform_admin', 'billing.read'),
    ('platform_admin', 'billing.write'),
    ('platform_admin', 'billing.export')
) grants(role_slug, permission_key) on roles.slug = grants.role_slug
on conflict do nothing;

alter table patient_timeline_items drop constraint if exists patient_timeline_items_item_type_check;
alter table patient_timeline_items
  add constraint patient_timeline_items_item_type_check check (
    item_type in (
      'patient_created',
      'attribution_touch_created',
      'lead_created',
      'lead_matched',
      'appointment_created',
      'appointment_confirmed',
      'patient_checked_in',
      'queue_entry_created',
      'appointment_no_show',
      'task_created',
      'form_response_submitted',
      'consent_created',
      'consent_revoked',
      'encounter_created',
      'encounter_started',
      'encounter_completed',
      'clinical_note_draft_created',
      'clinical_note_signed',
      'clinical_note_amended',
      'dental_finding_created',
      'dental_finding_updated',
      'dental_chart_snapshot_created',
      'media_uploaded',
      'prescription_draft_created',
      'prescription_signed',
      'treatment_plan_created',
      'treatment_plan_accepted',
      'procedure_completed',
      'invoice_created',
      'payment_recorded',
      'receipt_generated'
    )
  );

create table if not exists pricebook_procedures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  code text not null check (length(trim(code)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  category text not null check (length(trim(category)) > 0),
  description text,
  default_unit_price_minor bigint not null check (default_unit_price_minor >= 0),
  currency text not null default 'INR' check (currency in ('INR')),
  tax_rate_basis_points integer not null default 0 check (tax_rate_basis_points between 0 and 10000),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by_user_id uuid references users(id) on delete set null,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, code),
  constraint pricebook_procedures_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create index if not exists pricebook_procedures_active_idx
  on pricebook_procedures(tenant_id, clinic_id, category, display_name)
  where status = 'active';

create trigger pricebook_procedures_set_updated_at
before update on pricebook_procedures
for each row execute function clinic_os.set_updated_at();

create table if not exists treatment_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid,
  title text not null check (length(trim(title)) > 0),
  status text not null default 'draft' check (
    status in ('draft', 'presented', 'accepted', 'declined', 'deferred', 'cancelled')
  ),
  currency text not null default 'INR' check (currency in ('INR')),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0 and discount_minor <= subtotal_minor),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null default 0 check (total_minor >= 0),
  clinical_summary text,
  presented_at timestamptz,
  accepted_at timestamptz,
  accepted_by_user_id uuid references users(id) on delete restrict,
  accepted_by_name text,
  acceptance_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(acceptance_evidence) = 'object'),
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint treatment_plans_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint treatment_plans_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint treatment_plans_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete set null,
  constraint treatment_plans_total_consistent check (total_minor = subtotal_minor - discount_minor + tax_minor),
  constraint treatment_plans_acceptance_consistent check (
    (status = 'accepted' and accepted_at is not null and accepted_by_user_id is not null)
    or (status <> 'accepted' and accepted_at is null and accepted_by_user_id is null)
  )
);

create index if not exists treatment_plans_patient_idx
  on treatment_plans(tenant_id, clinic_id, patient_id, status, created_at desc);

create trigger treatment_plans_set_updated_at
before update on treatment_plans
for each row execute function clinic_os.set_updated_at();

create table if not exists treatment_plan_phases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  treatment_plan_id uuid not null,
  phase_index integer not null check (phase_index > 0),
  title text not null check (length(trim(title)) > 0),
  description text,
  estimated_start_after_days integer check (estimated_start_after_days is null or estimated_start_after_days >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, treatment_plan_id, id),
  unique (tenant_id, clinic_id, treatment_plan_id, phase_index),
  constraint treatment_plan_phases_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint treatment_plan_phases_plan_fk
    foreign key (tenant_id, treatment_plan_id) references treatment_plans(tenant_id, id) on delete cascade
);

create trigger treatment_plan_phases_set_updated_at
before update on treatment_plan_phases
for each row execute function clinic_os.set_updated_at();

create table if not exists treatment_plan_estimate_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  treatment_plan_id uuid not null,
  phase_id uuid not null,
  pricebook_procedure_id uuid not null,
  dental_finding_id uuid,
  tooth_number text check (
    tooth_number is null or tooth_number in (
      '11', '12', '13', '14', '15', '16', '17', '18',
      '21', '22', '23', '24', '25', '26', '27', '28',
      '31', '32', '33', '34', '35', '36', '37', '38',
      '41', '42', '43', '44', '45', '46', '47', '48',
      '51', '52', '53', '54', '55',
      '61', '62', '63', '64', '65',
      '71', '72', '73', '74', '75',
      '81', '82', '83', '84', '85'
    )
  ),
  quantity integer not null default 1 check (quantity > 0 and quantity <= 999),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_rate_basis_points integer not null default 0 check (tax_rate_basis_points between 0 and 10000),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  estimated_visits integer not null default 1 check (estimated_visits > 0 and estimated_visits <= 99),
  priority text,
  notes text,
  status text not null default 'planned' check (status in ('planned', 'accepted', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint treatment_plan_estimate_items_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint treatment_plan_estimate_items_phase_plan_fk
    foreign key (tenant_id, treatment_plan_id, phase_id)
    references treatment_plan_phases(tenant_id, treatment_plan_id, id) on delete cascade,
  constraint treatment_plan_estimate_items_procedure_fk
    foreign key (tenant_id, pricebook_procedure_id) references pricebook_procedures(tenant_id, id) on delete restrict,
  constraint treatment_plan_estimate_items_dental_finding_fk
    foreign key (tenant_id, dental_finding_id) references dental_findings(tenant_id, id) on delete set null,
  constraint treatment_plan_estimate_items_total_consistent check (
    total_minor = (quantity * unit_price_minor) - discount_minor + tax_minor
  )
);

create index if not exists treatment_plan_estimate_items_plan_idx
  on treatment_plan_estimate_items(tenant_id, clinic_id, treatment_plan_id, phase_id);
create index if not exists treatment_plan_estimate_items_finding_idx
  on treatment_plan_estimate_items(tenant_id, clinic_id, dental_finding_id)
  where dental_finding_id is not null;

create trigger treatment_plan_estimate_items_set_updated_at
before update on treatment_plan_estimate_items
for each row execute function clinic_os.set_updated_at();

create table if not exists procedure_performed_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid not null,
  treatment_plan_id uuid not null,
  treatment_plan_estimate_item_id uuid not null,
  pricebook_procedure_id uuid not null,
  dental_finding_id uuid,
  invoice_id uuid,
  tooth_number text check (
    tooth_number is null or tooth_number in (
      '11', '12', '13', '14', '15', '16', '17', '18',
      '21', '22', '23', '24', '25', '26', '27', '28',
      '31', '32', '33', '34', '35', '36', '37', '38',
      '41', '42', '43', '44', '45', '46', '47', '48',
      '51', '52', '53', '54', '55',
      '61', '62', '63', '64', '65',
      '71', '72', '73', '74', '75',
      '81', '82', '83', '84', '85'
    )
  ),
  quantity integer not null default 1 check (quantity > 0 and quantity <= 999),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_rate_basis_points integer not null default 0 check (tax_rate_basis_points between 0 and 10000),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null check (total_minor >= 0),
  status text not null default 'completed' check (status in ('completed', 'entered_in_error')),
  performed_by_user_id uuid not null references users(id) on delete restrict,
  performed_at timestamptz not null default now(),
  notes text,
  outcome text,
  provenance jsonb not null default '{}'::jsonb check (jsonb_typeof(provenance) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint procedure_performed_records_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint procedure_performed_records_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint procedure_performed_records_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete restrict,
  constraint procedure_performed_records_plan_fk
    foreign key (tenant_id, treatment_plan_id) references treatment_plans(tenant_id, id) on delete restrict,
  constraint procedure_performed_records_item_fk
    foreign key (tenant_id, treatment_plan_estimate_item_id)
    references treatment_plan_estimate_items(tenant_id, id) on delete restrict,
  constraint procedure_performed_records_procedure_fk
    foreign key (tenant_id, pricebook_procedure_id) references pricebook_procedures(tenant_id, id) on delete restrict,
  constraint procedure_performed_records_dental_finding_fk
    foreign key (tenant_id, dental_finding_id) references dental_findings(tenant_id, id) on delete set null,
  constraint procedure_performed_records_total_consistent check (
    total_minor = (quantity * unit_price_minor) - discount_minor + tax_minor
  )
);

create unique index if not exists procedure_performed_records_completed_item_unique_idx
  on procedure_performed_records(tenant_id, clinic_id, treatment_plan_estimate_item_id)
  where status = 'completed';
create index if not exists procedure_performed_records_patient_idx
  on procedure_performed_records(tenant_id, clinic_id, patient_id, performed_at desc);
create index if not exists procedure_performed_records_invoice_pending_idx
  on procedure_performed_records(tenant_id, clinic_id, treatment_plan_id, invoice_id)
  where status = 'completed';

create trigger procedure_performed_records_set_updated_at
before update on procedure_performed_records
for each row execute function clinic_os.set_updated_at();

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid not null,
  invoice_number text not null,
  status text not null default 'issued' check (status in ('issued', 'void', 'cancelled')),
  payment_status text not null default 'unpaid' check (
    payment_status in (
      'unpaid',
      'payment_requested',
      'partially_paid',
      'paid',
      'overpaid',
      'reconciliation_required',
      'refunded',
      'cancelled'
    )
  ),
  currency text not null default 'INR' check (currency in ('INR')),
  subtotal_minor bigint not null default 0 check (subtotal_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0 and discount_minor <= subtotal_minor),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null check (total_minor > 0),
  paid_minor bigint not null default 0 check (paid_minor >= 0),
  refunded_minor bigint not null default 0 check (refunded_minor >= 0),
  balance_minor bigint not null check (balance_minor >= 0),
  treatment_plan_id uuid,
  issued_at timestamptz not null default now(),
  due_at timestamptz,
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, invoice_number),
  constraint invoices_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint invoices_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint invoices_plan_fk
    foreign key (tenant_id, treatment_plan_id) references treatment_plans(tenant_id, id) on delete set null,
  constraint invoices_total_consistent check (total_minor = subtotal_minor - discount_minor + tax_minor),
  constraint invoices_balance_consistent check (balance_minor = greatest(total_minor - paid_minor + refunded_minor, 0))
);

create index if not exists invoices_patient_idx
  on invoices(tenant_id, clinic_id, patient_id, issued_at desc);
create index if not exists invoices_payment_status_idx
  on invoices(tenant_id, clinic_id, payment_status, due_at);

create trigger invoices_set_updated_at
before update on invoices
for each row execute function clinic_os.set_updated_at();

alter table procedure_performed_records drop constraint if exists procedure_performed_records_invoice_fk;
alter table procedure_performed_records
  add constraint procedure_performed_records_invoice_fk
  foreign key (tenant_id, invoice_id) references invoices(tenant_id, id) on delete set null;

alter table attribution_touches drop constraint if exists attribution_touches_invoice_fk;
alter table attribution_touches
  add constraint attribution_touches_invoice_fk
  foreign key (tenant_id, invoice_id) references invoices(tenant_id, id) on delete set null;

create table if not exists invoice_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  invoice_id uuid not null,
  patient_id uuid not null,
  procedure_performed_id uuid not null,
  treatment_plan_estimate_item_id uuid not null,
  pricebook_procedure_id uuid not null,
  description text not null check (length(trim(description)) > 0),
  quantity integer not null check (quantity > 0 and quantity <= 999),
  unit_price_minor bigint not null check (unit_price_minor >= 0),
  discount_minor bigint not null default 0 check (discount_minor >= 0),
  tax_rate_basis_points integer not null default 0 check (tax_rate_basis_points between 0 and 10000),
  tax_minor bigint not null default 0 check (tax_minor >= 0),
  total_minor bigint not null check (total_minor > 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, procedure_performed_id),
  constraint invoice_items_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint invoice_items_invoice_fk
    foreign key (tenant_id, invoice_id) references invoices(tenant_id, id) on delete cascade,
  constraint invoice_items_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint invoice_items_procedure_performed_fk
    foreign key (tenant_id, procedure_performed_id) references procedure_performed_records(tenant_id, id) on delete restrict,
  constraint invoice_items_estimate_item_fk
    foreign key (tenant_id, treatment_plan_estimate_item_id)
    references treatment_plan_estimate_items(tenant_id, id) on delete restrict,
  constraint invoice_items_pricebook_procedure_fk
    foreign key (tenant_id, pricebook_procedure_id) references pricebook_procedures(tenant_id, id) on delete restrict,
  constraint invoice_items_total_consistent check (
    total_minor = (quantity * unit_price_minor) - discount_minor + tax_minor
  )
);

create index if not exists invoice_items_invoice_idx
  on invoice_items(tenant_id, clinic_id, invoice_id);

create table if not exists payment_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  invoice_id uuid not null,
  patient_id uuid not null,
  provider text not null check (provider in ('manual', 'razorpay', 'simulator')),
  request_type text not null check (request_type in ('payment_link', 'dynamic_qr')),
  status text not null default 'requested' check (
    status in ('requested', 'provider_created', 'sent', 'expired', 'cancelled', 'failed')
  ),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'INR' check (currency in ('INR')),
  provider_reference_id text,
  provider_url text,
  provider_qr_payload text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint payment_requests_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint payment_requests_invoice_fk
    foreign key (tenant_id, invoice_id) references invoices(tenant_id, id) on delete restrict,
  constraint payment_requests_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict
);

create unique index if not exists payment_requests_provider_reference_unique_idx
  on payment_requests(tenant_id, clinic_id, provider, provider_reference_id)
  where provider_reference_id is not null;
create index if not exists payment_requests_invoice_idx
  on payment_requests(tenant_id, clinic_id, invoice_id, created_at desc);

create trigger payment_requests_set_updated_at
before update on payment_requests
for each row execute function clinic_os.set_updated_at();

create table if not exists payment_transactions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  invoice_id uuid not null,
  patient_id uuid not null,
  payment_request_id uuid,
  provider text not null check (provider in ('manual', 'razorpay', 'simulator')),
  provider_payment_id text,
  provider_order_id text,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'INR' check (currency in ('INR')),
  method text not null check (length(trim(method)) > 0),
  status text not null check (
    status in ('pending', 'succeeded', 'failed', 'refunded', 'manually_recorded', 'reconciliation_required')
  ),
  verification_status text not null check (
    verification_status in (
      'not_required_manual',
      'verified',
      'signature_failed',
      'provider_unavailable',
      'requires_review'
    )
  ),
  reconciliation_status text not null default 'matched' check (
    reconciliation_status in ('matched', 'requires_review')
  ),
  idempotency_key text,
  received_at timestamptz not null,
  recorded_by_user_id uuid references users(id) on delete set null,
  receipt_id uuid,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint payment_transactions_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint payment_transactions_invoice_fk
    foreign key (tenant_id, invoice_id) references invoices(tenant_id, id) on delete restrict,
  constraint payment_transactions_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint payment_transactions_request_fk
    foreign key (tenant_id, payment_request_id) references payment_requests(tenant_id, id) on delete set null,
  constraint payment_transactions_verified_success_check check (
    (status = 'succeeded' and verification_status = 'verified')
    or (status = 'manually_recorded' and verification_status = 'not_required_manual')
    or status not in ('succeeded', 'manually_recorded')
  )
);

create unique index if not exists payment_transactions_idempotency_unique_idx
  on payment_transactions(tenant_id, clinic_id, provider, idempotency_key)
  where idempotency_key is not null;
create unique index if not exists payment_transactions_provider_payment_unique_idx
  on payment_transactions(tenant_id, clinic_id, provider, provider_payment_id)
  where provider_payment_id is not null;
create index if not exists payment_transactions_invoice_idx
  on payment_transactions(tenant_id, clinic_id, invoice_id, received_at desc);

create trigger payment_transactions_set_updated_at
before update on payment_transactions
for each row execute function clinic_os.set_updated_at();

create table if not exists receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  invoice_id uuid not null,
  patient_id uuid not null,
  receipt_number text not null,
  status text not null default 'generated' check (status in ('generated', 'void')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'INR' check (currency in ('INR')),
  payment_allocations jsonb not null check (jsonb_typeof(payment_allocations) = 'array'),
  generated_by_user_id uuid not null references users(id) on delete restrict,
  generated_at timestamptz not null default now(),
  voided_by_user_id uuid references users(id) on delete restrict,
  voided_at timestamptz,
  void_reason text,
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, receipt_number),
  constraint receipts_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint receipts_invoice_fk
    foreign key (tenant_id, invoice_id) references invoices(tenant_id, id) on delete restrict,
  constraint receipts_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint receipts_void_consistent check (
    (status = 'generated' and voided_by_user_id is null and voided_at is null and void_reason is null)
    or (status = 'void' and voided_by_user_id is not null and voided_at is not null and void_reason is not null)
  )
);

create index if not exists receipts_invoice_idx
  on receipts(tenant_id, clinic_id, invoice_id, generated_at desc);

alter table payment_transactions drop constraint if exists payment_transactions_receipt_fk;
alter table payment_transactions
  add constraint payment_transactions_receipt_fk
  foreign key (tenant_id, receipt_id) references receipts(tenant_id, id) on delete set null;

alter table pricebook_procedures enable row level security;
alter table pricebook_procedures force row level security;
drop policy if exists pricebook_procedures_tenant_clinic_isolation on pricebook_procedures;
create policy pricebook_procedures_tenant_clinic_isolation on pricebook_procedures
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table treatment_plans enable row level security;
alter table treatment_plans force row level security;
drop policy if exists treatment_plans_tenant_clinic_isolation on treatment_plans;
create policy treatment_plans_tenant_clinic_isolation on treatment_plans
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table treatment_plan_phases enable row level security;
alter table treatment_plan_phases force row level security;
drop policy if exists treatment_plan_phases_tenant_clinic_isolation on treatment_plan_phases;
create policy treatment_plan_phases_tenant_clinic_isolation on treatment_plan_phases
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table treatment_plan_estimate_items enable row level security;
alter table treatment_plan_estimate_items force row level security;
drop policy if exists treatment_plan_estimate_items_tenant_clinic_isolation on treatment_plan_estimate_items;
create policy treatment_plan_estimate_items_tenant_clinic_isolation on treatment_plan_estimate_items
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table procedure_performed_records enable row level security;
alter table procedure_performed_records force row level security;
drop policy if exists procedure_performed_records_tenant_clinic_isolation on procedure_performed_records;
create policy procedure_performed_records_tenant_clinic_isolation on procedure_performed_records
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table invoices enable row level security;
alter table invoices force row level security;
drop policy if exists invoices_tenant_clinic_isolation on invoices;
create policy invoices_tenant_clinic_isolation on invoices
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table invoice_items enable row level security;
alter table invoice_items force row level security;
drop policy if exists invoice_items_tenant_clinic_isolation on invoice_items;
create policy invoice_items_tenant_clinic_isolation on invoice_items
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table payment_requests enable row level security;
alter table payment_requests force row level security;
drop policy if exists payment_requests_tenant_clinic_isolation on payment_requests;
create policy payment_requests_tenant_clinic_isolation on payment_requests
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table payment_transactions enable row level security;
alter table payment_transactions force row level security;
drop policy if exists payment_transactions_tenant_clinic_isolation on payment_transactions;
create policy payment_transactions_tenant_clinic_isolation on payment_transactions
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table receipts enable row level security;
alter table receipts force row level security;
drop policy if exists receipts_tenant_clinic_isolation on receipts;
create policy receipts_tenant_clinic_isolation on receipts
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

comment on table pricebook_procedures is 'Clinic-scoped dental procedure catalog with INR minor-unit pricing and tax defaults.';
comment on table treatment_plans is 'Patient treatment plan aggregate with acceptance state and estimate totals.';
comment on table treatment_plan_phases is 'Sequenced phases for treatment plans.';
comment on table treatment_plan_estimate_items is 'Procedure estimate rows derived from the pricebook and optional dental findings.';
comment on table procedure_performed_records is 'Completed procedure evidence linked to an accepted treatment plan item before invoicing.';
comment on table invoices is 'Issued billing documents generated from completed procedure evidence.';
comment on table invoice_items is 'Invoice lines derived from performed procedure records, not arbitrary request-body line items.';
comment on table payment_requests is 'Provider/manual payment request contract records owned by the payment provider lane.';
comment on table payment_transactions is 'Verified provider or audited manual payment evidence for invoice reconciliation.';
comment on table receipts is 'Receipts generated from settled unreceipted payment transactions.';
