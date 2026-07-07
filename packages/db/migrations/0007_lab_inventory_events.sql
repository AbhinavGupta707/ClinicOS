-- Checkpoint 6: lab cases, inventory checks, stock ledger, procurement suggestions, incidents, and CAPA.
-- Applies after the CP6 task/SOP migration and the CP5 billing migration on PostgreSQL 16+.

insert into permissions (key, display_name, category, description, phi_involved)
values
  ('incident.manage', 'Manage incidents', 'quality', 'Create operational event diary entries and review incident evidence.', true),
  ('corrective_action.manage', 'Manage corrective actions', 'quality', 'Create, assign, and complete corrective/preventive actions.', true),
  ('lab.manage', 'Manage lab', 'operations', 'Create and update patient-linked lab cases, slips, and reconciliation evidence.', true),
  ('inventory.manage', 'Manage inventory', 'operations', 'Manage inventory items, checks, stock ledger evidence, and procurement suggestions.', false)
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
    ('owner_admin', 'incident.manage'),
    ('owner_admin', 'corrective_action.manage'),
    ('doctor', 'incident.manage'),
    ('doctor', 'corrective_action.manage'),
    ('assistant', 'incident.manage'),
    ('assistant', 'corrective_action.manage'),
    ('receptionist', 'inventory.manage'),
    ('receptionist', 'incident.manage'),
    ('receptionist', 'corrective_action.manage'),
    ('platform_admin', 'incident.manage'),
    ('platform_admin', 'corrective_action.manage')
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
      'instruction_print_requested',
      'instruction_send_requested',
      'treatment_plan_created',
      'treatment_plan_accepted',
      'procedure_completed',
      'invoice_created',
      'payment_recorded',
      'receipt_generated',
      'payment_requested',
      'payment_succeeded',
      'payment_manually_recorded',
      'payment_reconciliation_required',
      'lab_case_created',
      'lab_case_sent',
      'lab_case_returned',
      'lab_case_completed',
      'incident_created',
      'corrective_action_created',
      'corrective_action_completed'
    )
  );

create table if not exists lab_vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  display_name text not null check (length(trim(display_name)) > 0),
  phone text,
  email citext,
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  tax_registration_number text,
  payment_terms_days integer check (payment_terms_days is null or payment_terms_days between 0 and 365),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, display_name),
  constraint lab_vendors_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create trigger lab_vendors_set_updated_at
before update on lab_vendors
for each row execute function clinic_os.set_updated_at();

create table if not exists lab_cases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  vendor_id uuid not null,
  patient_id uuid not null,
  encounter_id uuid,
  treatment_plan_id uuid,
  treatment_plan_estimate_item_id uuid,
  procedure_performed_id uuid,
  title text not null check (length(trim(title)) > 0),
  status text not null default 'draft' check (
    status in (
      'draft',
      'ready_for_pickup',
      'sent_to_lab',
      'received_by_lab',
      'due',
      'returned',
      'fitted',
      'completed',
      'cancelled',
      'rework_required'
    )
  ),
  priority text not null default 'routine' check (priority in ('routine', 'urgent')),
  due_at timestamptz not null,
  clinical_notes text,
  internal_notes text,
  slip_number text not null check (length(trim(slip_number)) > 0),
  slip_version integer not null default 1 check (slip_version > 0),
  slip_generated_at timestamptz not null default now(),
  slip_generated_by_user_id uuid not null references users(id) on delete restrict,
  slip_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(slip_metadata) = 'object'),
  expected_cost_minor bigint check (expected_cost_minor is null or expected_cost_minor >= 0),
  currency text not null default 'INR' check (currency in ('INR')),
  sent_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, slip_number),
  constraint lab_cases_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint lab_cases_vendor_fk
    foreign key (tenant_id, vendor_id) references lab_vendors(tenant_id, id) on delete restrict,
  constraint lab_cases_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint lab_cases_encounter_fk
    foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete set null,
  constraint lab_cases_treatment_plan_fk
    foreign key (tenant_id, treatment_plan_id) references treatment_plans(tenant_id, id) on delete set null,
  constraint lab_cases_estimate_item_fk
    foreign key (tenant_id, treatment_plan_estimate_item_id) references treatment_plan_estimate_items(tenant_id, id) on delete set null,
  constraint lab_cases_procedure_fk
    foreign key (tenant_id, procedure_performed_id) references procedure_performed_records(tenant_id, id) on delete set null,
  constraint lab_cases_completion_consistent check (
    (status = 'completed' and completed_at is not null)
    or status <> 'completed'
  ),
  constraint lab_cases_cancellation_consistent check (
    (status = 'cancelled' and cancelled_at is not null and cancellation_reason is not null)
    or status <> 'cancelled'
  )
);

create index if not exists lab_cases_status_due_idx
  on lab_cases(tenant_id, clinic_id, status, due_at);
create index if not exists lab_cases_patient_idx
  on lab_cases(tenant_id, clinic_id, patient_id, due_at desc);
create index if not exists lab_cases_vendor_idx
  on lab_cases(tenant_id, clinic_id, vendor_id, due_at desc);

create trigger lab_cases_set_updated_at
before update on lab_cases
for each row execute function clinic_os.set_updated_at();

create table if not exists lab_case_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  lab_case_id uuid not null,
  item_type text not null check (length(trim(item_type)) > 0),
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
  material text,
  shade text,
  quantity integer not null default 1 check (quantity > 0 and quantity <= 99),
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint lab_case_items_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint lab_case_items_case_fk
    foreign key (tenant_id, lab_case_id) references lab_cases(tenant_id, id) on delete cascade
);

create index if not exists lab_case_items_case_idx
  on lab_case_items(tenant_id, clinic_id, lab_case_id);

create table if not exists lab_case_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  lab_case_id uuid not null,
  patient_id uuid not null,
  from_status text,
  to_status text not null check (
    to_status in (
      'draft',
      'ready_for_pickup',
      'sent_to_lab',
      'received_by_lab',
      'due',
      'returned',
      'fitted',
      'completed',
      'cancelled',
      'rework_required'
    )
  ),
  reason text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  changed_by_user_id uuid not null references users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint lab_case_status_history_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint lab_case_status_history_case_fk
    foreign key (tenant_id, lab_case_id) references lab_cases(tenant_id, id) on delete cascade,
  constraint lab_case_status_history_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict
);

create index if not exists lab_case_status_history_case_idx
  on lab_case_status_history(tenant_id, clinic_id, lab_case_id, changed_at desc);

create or replace function clinic_os.prevent_cp6_evidence_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception '% rows are immutable', tg_table_name;
  end if;

  raise exception '% rows cannot be deleted', tg_table_name;
end;
$$;

drop trigger if exists lab_case_status_history_immutable on lab_case_status_history;
create trigger lab_case_status_history_immutable
before update or delete on lab_case_status_history
for each row execute function clinic_os.prevent_cp6_evidence_mutation();

create table if not exists lab_reconciliations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  vendor_id uuid not null,
  period_start date not null,
  period_end date not null,
  status text not null default 'draft' check (
    status in ('draft', 'submitted', 'matched', 'variance_review', 'approved', 'cancelled')
  ),
  invoice_reference text,
  invoice_amount_minor bigint check (invoice_amount_minor is null or invoice_amount_minor >= 0),
  expected_amount_minor bigint not null default 0 check (expected_amount_minor >= 0),
  variance_amount_minor bigint not null default 0,
  currency text not null default 'INR' check (currency in ('INR')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_by_user_id uuid not null references users(id) on delete restrict,
  approved_by_user_id uuid references users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint lab_reconciliations_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint lab_reconciliations_vendor_fk
    foreign key (tenant_id, vendor_id) references lab_vendors(tenant_id, id) on delete restrict,
  constraint lab_reconciliations_period_check check (period_end >= period_start),
  constraint lab_reconciliations_variance_check check (
    variance_amount_minor = coalesce(invoice_amount_minor, expected_amount_minor) - expected_amount_minor
  ),
  constraint lab_reconciliations_approval_check check (
    (status = 'approved' and approved_by_user_id is not null and approved_at is not null)
    or status <> 'approved'
  )
);

create index if not exists lab_reconciliations_vendor_period_idx
  on lab_reconciliations(tenant_id, clinic_id, vendor_id, period_start, period_end);

create trigger lab_reconciliations_set_updated_at
before update on lab_reconciliations
for each row execute function clinic_os.set_updated_at();

create table if not exists lab_reconciliation_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  reconciliation_id uuid not null,
  lab_case_id uuid not null,
  patient_id uuid not null,
  status text not null check (
    status in ('matched', 'amount_variance', 'missing_invoice', 'unbilled_case', 'excluded')
  ),
  expected_amount_minor bigint not null check (expected_amount_minor >= 0),
  invoice_amount_minor bigint check (invoice_amount_minor is null or invoice_amount_minor >= 0),
  variance_amount_minor bigint not null,
  notes text,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, reconciliation_id, lab_case_id),
  constraint lab_reconciliation_entries_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint lab_reconciliation_entries_reconciliation_fk
    foreign key (tenant_id, reconciliation_id) references lab_reconciliations(tenant_id, id) on delete cascade,
  constraint lab_reconciliation_entries_case_fk
    foreign key (tenant_id, lab_case_id) references lab_cases(tenant_id, id) on delete restrict,
  constraint lab_reconciliation_entries_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint lab_reconciliation_entries_variance_check check (
    variance_amount_minor = coalesce(invoice_amount_minor, expected_amount_minor) - expected_amount_minor
  )
);

create table if not exists inventory_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  code text not null check (length(trim(code)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  kind text not null check (kind in ('material', 'instrument', 'equipment')),
  active boolean not null default true,
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, code),
  constraint inventory_categories_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create trigger inventory_categories_set_updated_at
before update on inventory_categories
for each row execute function clinic_os.set_updated_at();

create table if not exists inventory_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  category_id uuid not null,
  sku text not null check (length(trim(sku)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  unit_of_measure text not null check (length(trim(unit_of_measure)) > 0),
  storage_location text not null check (length(trim(storage_location)) > 0),
  track_quantity boolean not null default true,
  minimum_quantity numeric(12, 2) not null default 0 check (minimum_quantity >= 0),
  reorder_quantity numeric(12, 2) not null default 0 check (reorder_quantity >= 0),
  current_quantity numeric(12, 2) not null default 0 check (current_quantity >= 0),
  status text not null default 'active' check (status in ('active', 'inactive', 'retired')),
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, sku),
  constraint inventory_items_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint inventory_items_category_fk
    foreign key (tenant_id, category_id) references inventory_categories(tenant_id, id) on delete restrict
);

create index if not exists inventory_items_low_stock_idx
  on inventory_items(tenant_id, clinic_id, status, current_quantity, minimum_quantity)
  where track_quantity;

create trigger inventory_items_set_updated_at
before update on inventory_items
for each row execute function clinic_os.set_updated_at();

create table if not exists stock_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  item_id uuid not null,
  movement_type text not null check (
    movement_type in (
      'opening_balance',
      'manual_adjustment',
      'consumption',
      'check_variance',
      'procurement_received',
      'write_off'
    )
  ),
  quantity_delta numeric(12, 2) not null,
  quantity_after numeric(12, 2) not null check (quantity_after >= 0),
  unit_cost_minor bigint check (unit_cost_minor is null or unit_cost_minor >= 0),
  currency text check (currency is null or currency in ('INR')),
  source_table text,
  source_id uuid,
  reason text not null check (length(trim(reason)) > 0),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  recorded_by_user_id uuid not null references users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint stock_ledger_entries_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint stock_ledger_entries_item_fk
    foreign key (tenant_id, item_id) references inventory_items(tenant_id, id) on delete restrict
);

create index if not exists stock_ledger_entries_item_idx
  on stock_ledger_entries(tenant_id, clinic_id, item_id, recorded_at desc);

drop trigger if exists stock_ledger_entries_immutable on stock_ledger_entries;
create trigger stock_ledger_entries_immutable
before update or delete on stock_ledger_entries
for each row execute function clinic_os.prevent_cp6_evidence_mutation();

create table if not exists inventory_check_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  code text not null check (length(trim(code)) > 0),
  display_name text not null check (length(trim(display_name)) > 0),
  cadence text not null check (cadence in ('daily', 'weekly', 'monthly', 'ad_hoc')),
  active boolean not null default true,
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, code),
  constraint inventory_check_templates_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create trigger inventory_check_templates_set_updated_at
before update on inventory_check_templates
for each row execute function clinic_os.set_updated_at();

create table if not exists inventory_check_template_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  template_id uuid not null,
  item_id uuid not null,
  sequence integer not null check (sequence > 0),
  drawer_location text not null check (length(trim(drawer_location)) > 0),
  expected_quantity numeric(12, 2) check (expected_quantity is null or expected_quantity >= 0),
  required boolean not null default true,
  instructions text,
  unique (tenant_id, id),
  unique (tenant_id, template_id, sequence),
  constraint inventory_check_template_lines_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint inventory_check_template_lines_template_fk
    foreign key (tenant_id, template_id) references inventory_check_templates(tenant_id, id) on delete cascade,
  constraint inventory_check_template_lines_item_fk
    foreign key (tenant_id, item_id) references inventory_items(tenant_id, id) on delete restrict
);

create table if not exists inventory_check_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  template_id uuid not null,
  status text not null default 'in_progress' check (status in ('draft', 'in_progress', 'completed', 'cancelled')),
  started_by_user_id uuid not null references users(id) on delete restrict,
  completed_by_user_id uuid references users(id) on delete restrict,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint inventory_check_runs_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint inventory_check_runs_template_fk
    foreign key (tenant_id, template_id) references inventory_check_templates(tenant_id, id) on delete restrict,
  constraint inventory_check_runs_completion_check check (
    (status = 'completed' and completed_by_user_id is not null and completed_at is not null)
    or status <> 'completed'
  )
);

create index if not exists inventory_check_runs_status_idx
  on inventory_check_runs(tenant_id, clinic_id, status, started_at desc);

create trigger inventory_check_runs_set_updated_at
before update on inventory_check_runs
for each row execute function clinic_os.set_updated_at();

create table if not exists inventory_check_run_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  check_run_id uuid not null,
  template_line_id uuid not null,
  item_id uuid not null,
  sequence integer not null check (sequence > 0),
  drawer_location text not null check (length(trim(drawer_location)) > 0),
  expected_quantity numeric(12, 2) not null check (expected_quantity >= 0),
  counted_quantity numeric(12, 2) check (counted_quantity is null or counted_quantity >= 0),
  variance_quantity numeric(12, 2),
  exception_type text check (
    exception_type is null or exception_type in ('variance', 'low_stock', 'missing_item', 'damaged', 'expired')
  ),
  exception_notes text,
  counted_by_user_id uuid references users(id) on delete restrict,
  counted_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, check_run_id, template_line_id),
  constraint inventory_check_run_lines_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint inventory_check_run_lines_run_fk
    foreign key (tenant_id, check_run_id) references inventory_check_runs(tenant_id, id) on delete cascade,
  constraint inventory_check_run_lines_template_line_fk
    foreign key (tenant_id, template_line_id) references inventory_check_template_lines(tenant_id, id) on delete restrict,
  constraint inventory_check_run_lines_item_fk
    foreign key (tenant_id, item_id) references inventory_items(tenant_id, id) on delete restrict,
  constraint inventory_check_run_lines_count_consistent check (
    (counted_quantity is null and variance_quantity is null and counted_by_user_id is null and counted_at is null)
    or (counted_quantity is not null and variance_quantity is not null and counted_by_user_id is not null and counted_at is not null)
  )
);

create index if not exists inventory_check_run_lines_exception_idx
  on inventory_check_run_lines(tenant_id, clinic_id, exception_type)
  where exception_type is not null;

create table if not exists procurement_suggestions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  item_id uuid not null,
  source_check_run_id uuid,
  source_check_run_line_id uuid,
  status text not null default 'suggested' check (status in ('suggested', 'converted_to_task', 'dismissed')),
  suggested_quantity numeric(12, 2) not null check (suggested_quantity > 0),
  reason text not null check (length(trim(reason)) > 0),
  task_id uuid,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  created_by_user_id uuid not null references users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint procurement_suggestions_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint procurement_suggestions_item_fk
    foreign key (tenant_id, item_id) references inventory_items(tenant_id, id) on delete restrict,
  constraint procurement_suggestions_run_fk
    foreign key (tenant_id, source_check_run_id) references inventory_check_runs(tenant_id, id) on delete set null,
  constraint procurement_suggestions_line_fk
    foreign key (tenant_id, source_check_run_line_id) references inventory_check_run_lines(tenant_id, id) on delete set null,
  constraint procurement_suggestions_task_fk
    foreign key (tenant_id, task_id) references tasks(tenant_id, id) on delete set null,
  constraint procurement_suggestions_task_state_check check (
    (status = 'converted_to_task' and task_id is not null)
    or (status <> 'converted_to_task' and task_id is null)
  )
);

create index if not exists procurement_suggestions_open_idx
  on procurement_suggestions(tenant_id, clinic_id, status, created_at desc)
  where status = 'suggested';

create trigger procurement_suggestions_set_updated_at
before update on procurement_suggestions
for each row execute function clinic_os.set_updated_at();

create table if not exists incidents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  patient_id uuid,
  appointment_id uuid,
  lab_case_id uuid,
  inventory_item_id uuid,
  category text not null check (
    category in (
      'clinical',
      'operational',
      'lab',
      'inventory',
      'billing',
      'safety',
      'patient_experience',
      'security_privacy',
      'other'
    )
  ),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (
    status in ('open', 'under_review', 'capa_assigned', 'resolved', 'closed', 'cancelled')
  ),
  occurred_at timestamptz not null,
  location text,
  summary text not null check (length(trim(summary)) > 0),
  description text not null check (length(trim(description)) > 0),
  impact text,
  learning text,
  immediate_action text,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  reported_by_user_id uuid not null references users(id) on delete restrict,
  owner_user_id uuid references users(id) on delete set null,
  resolved_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint incidents_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint incidents_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete set null,
  constraint incidents_appointment_fk
    foreign key (tenant_id, appointment_id) references appointments(tenant_id, id) on delete set null,
  constraint incidents_lab_case_fk
    foreign key (tenant_id, lab_case_id) references lab_cases(tenant_id, id) on delete set null,
  constraint incidents_inventory_item_fk
    foreign key (tenant_id, inventory_item_id) references inventory_items(tenant_id, id) on delete set null
);

create index if not exists incidents_status_idx
  on incidents(tenant_id, clinic_id, status, occurred_at desc);
create index if not exists incidents_patient_idx
  on incidents(tenant_id, clinic_id, patient_id, occurred_at desc)
  where patient_id is not null;

create trigger incidents_set_updated_at
before update on incidents
for each row execute function clinic_os.set_updated_at();

create table if not exists corrective_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  incident_id uuid,
  action_type text not null check (action_type in ('corrective', 'preventive')),
  title text not null check (length(trim(title)) > 0),
  description text not null check (length(trim(description)) > 0),
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  owner_user_id uuid not null references users(id) on delete restrict,
  due_at timestamptz not null,
  completed_at timestamptz,
  completed_by_user_id uuid references users(id) on delete restrict,
  completion_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(completion_evidence) = 'object'),
  verification_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(verification_evidence) = 'object'),
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint corrective_actions_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint corrective_actions_incident_fk
    foreign key (tenant_id, incident_id) references incidents(tenant_id, id) on delete set null,
  constraint corrective_actions_completion_check check (
    (status = 'completed' and completed_at is not null and completed_by_user_id is not null)
    or (status <> 'completed' and completed_at is null and completed_by_user_id is null)
  )
);

create index if not exists corrective_actions_status_due_idx
  on corrective_actions(tenant_id, clinic_id, status, due_at);

create trigger corrective_actions_set_updated_at
before update on corrective_actions
for each row execute function clinic_os.set_updated_at();

alter table lab_vendors enable row level security;
alter table lab_vendors force row level security;
drop policy if exists lab_vendors_tenant_clinic_isolation on lab_vendors;
create policy lab_vendors_tenant_clinic_isolation on lab_vendors
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table lab_cases enable row level security;
alter table lab_cases force row level security;
drop policy if exists lab_cases_tenant_clinic_isolation on lab_cases;
create policy lab_cases_tenant_clinic_isolation on lab_cases
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table lab_case_items enable row level security;
alter table lab_case_items force row level security;
drop policy if exists lab_case_items_tenant_clinic_isolation on lab_case_items;
create policy lab_case_items_tenant_clinic_isolation on lab_case_items
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table lab_case_status_history enable row level security;
alter table lab_case_status_history force row level security;
drop policy if exists lab_case_status_history_tenant_clinic_isolation on lab_case_status_history;
create policy lab_case_status_history_tenant_clinic_isolation on lab_case_status_history
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table lab_reconciliations enable row level security;
alter table lab_reconciliations force row level security;
drop policy if exists lab_reconciliations_tenant_clinic_isolation on lab_reconciliations;
create policy lab_reconciliations_tenant_clinic_isolation on lab_reconciliations
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table lab_reconciliation_entries enable row level security;
alter table lab_reconciliation_entries force row level security;
drop policy if exists lab_reconciliation_entries_tenant_clinic_isolation on lab_reconciliation_entries;
create policy lab_reconciliation_entries_tenant_clinic_isolation on lab_reconciliation_entries
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table inventory_categories enable row level security;
alter table inventory_categories force row level security;
drop policy if exists inventory_categories_tenant_clinic_isolation on inventory_categories;
create policy inventory_categories_tenant_clinic_isolation on inventory_categories
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table inventory_items enable row level security;
alter table inventory_items force row level security;
drop policy if exists inventory_items_tenant_clinic_isolation on inventory_items;
create policy inventory_items_tenant_clinic_isolation on inventory_items
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table stock_ledger_entries enable row level security;
alter table stock_ledger_entries force row level security;
drop policy if exists stock_ledger_entries_tenant_clinic_isolation on stock_ledger_entries;
create policy stock_ledger_entries_tenant_clinic_isolation on stock_ledger_entries
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table inventory_check_templates enable row level security;
alter table inventory_check_templates force row level security;
drop policy if exists inventory_check_templates_tenant_clinic_isolation on inventory_check_templates;
create policy inventory_check_templates_tenant_clinic_isolation on inventory_check_templates
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table inventory_check_template_lines enable row level security;
alter table inventory_check_template_lines force row level security;
drop policy if exists inventory_check_template_lines_tenant_clinic_isolation on inventory_check_template_lines;
create policy inventory_check_template_lines_tenant_clinic_isolation on inventory_check_template_lines
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table inventory_check_runs enable row level security;
alter table inventory_check_runs force row level security;
drop policy if exists inventory_check_runs_tenant_clinic_isolation on inventory_check_runs;
create policy inventory_check_runs_tenant_clinic_isolation on inventory_check_runs
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table inventory_check_run_lines enable row level security;
alter table inventory_check_run_lines force row level security;
drop policy if exists inventory_check_run_lines_tenant_clinic_isolation on inventory_check_run_lines;
create policy inventory_check_run_lines_tenant_clinic_isolation on inventory_check_run_lines
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table procurement_suggestions enable row level security;
alter table procurement_suggestions force row level security;
drop policy if exists procurement_suggestions_tenant_clinic_isolation on procurement_suggestions;
create policy procurement_suggestions_tenant_clinic_isolation on procurement_suggestions
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table incidents enable row level security;
alter table incidents force row level security;
drop policy if exists incidents_tenant_clinic_isolation on incidents;
create policy incidents_tenant_clinic_isolation on incidents
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table corrective_actions enable row level security;
alter table corrective_actions force row level security;
drop policy if exists corrective_actions_tenant_clinic_isolation on corrective_actions;
create policy corrective_actions_tenant_clinic_isolation on corrective_actions
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

comment on table lab_vendors is 'Clinic-approved manual lab vendor directory. No unofficial scraping or hidden integration dependency.';
comment on table lab_cases is 'Patient-linked lab case card with slip metadata, due dates, and auditable lifecycle state.';
comment on table lab_reconciliations is 'Month-end lab invoice reconciliation evidence; does not execute accounting payment.';
comment on table inventory_items is 'Clinic inventory master with current quantity updated only through stock ledger evidence.';
comment on table stock_ledger_entries is 'Append-only stock movement evidence for inventory balances; updates and deletes are blocked by trigger.';
comment on table inventory_check_runs is 'Drawer-by-drawer inventory check run with counted quantities and variance evidence.';
comment on table procurement_suggestions is 'Procurement/task suggestion evidence only. It does not execute purchase orders or vendor procurement.';
comment on table incidents is 'Operational event diary for clinical, lab, inventory, billing, safety, and patient-experience incidents.';
comment on table corrective_actions is 'Corrective/preventive action tracker with due dates and completion evidence.';
