-- Checkpoint 6: continuity tasks, recalls/follow-ups, and SOP templates/schedules/runs.
-- Applies after 0005_treatment_checkout_billing.sql on PostgreSQL 16+.

insert into permissions (key, display_name, category, description, phi_involved)
values
  ('task.manage', 'Manage tasks', 'operations', 'Create, assign, progress, complete, and audit operational tasks.', true),
  ('recall.manage', 'Manage recalls', 'clinical', 'Configure recall rules and record recall contact/booking actions.', true),
  ('sop.manage', 'Manage SOP runs', 'operations', 'Create SOP templates, schedules, and complete recurring clinic protocol runs.', false)
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
    ('owner_admin', 'task.manage'),
    ('owner_admin', 'recall.manage'),
    ('owner_admin', 'sop.manage'),
    ('doctor', 'task.manage'),
    ('doctor', 'recall.manage'),
    ('doctor', 'sop.manage'),
    ('assistant', 'task.manage'),
    ('assistant', 'recall.manage'),
    ('assistant', 'sop.manage'),
    ('receptionist', 'task.manage'),
    ('receptionist', 'recall.manage'),
    ('receptionist', 'sop.manage'),
    ('platform_admin', 'task.manage'),
    ('platform_admin', 'recall.manage'),
    ('platform_admin', 'sop.manage')
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
      'task_status_changed',
      'task_completed',
      'recall_due',
      'recall_action_recorded',
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
      'receipt_generated'
    )
  );

alter table tasks drop constraint if exists tasks_task_type_check;
alter table tasks
  add constraint tasks_task_type_check check (
    task_type in (
      'confirmation',
      'missed_call',
      'whatsapp_request',
      'follow_up',
      'post_op_follow_up',
      'recall',
      'payment_due',
      'payment_follow_up',
      'lab_case',
      'sop',
      'inventory_check',
      'procurement',
      'incident',
      'corrective_action',
      'manual'
    )
  );

alter table tasks drop constraint if exists tasks_status_check;
alter table tasks
  add constraint tasks_status_check check (status in ('open', 'in_progress', 'done', 'cancelled'));

alter table tasks
  add column if not exists invoice_id uuid,
  add column if not exists encounter_id uuid,
  add column if not exists treatment_plan_id uuid,
  add column if not exists procedure_performed_id uuid,
  add column if not exists source_workflow text not null default 'manual',
  add column if not exists source_record_type text,
  add column if not exists source_record_id uuid,
  add column if not exists description text,
  add column if not exists priority text not null default 'normal',
  add column if not exists assigned_by_user_id uuid references users(id) on delete set null,
  add column if not exists completed_by_user_id uuid references users(id) on delete set null,
  add column if not exists completed_at timestamptz,
  add column if not exists completion_evidence jsonb not null default '{}'::jsonb,
  add column if not exists cancelled_reason text,
  add column if not exists idempotency_key text,
  add column if not exists status_changed_at timestamptz not null default now();

alter table tasks
  add constraint tasks_source_workflow_check check (
    source_workflow in (
      'manual',
      'appointment_confirmation',
      'recall_generation',
      'post_op_follow_up',
      'payment_follow_up',
      'sop_run',
      'lab_case',
      'inventory_check',
      'incident_capa',
      'system'
    )
  );

alter table tasks
  add constraint tasks_priority_check check (priority in ('low', 'normal', 'high', 'urgent'));

alter table tasks
  add constraint tasks_completion_evidence_object_check check (jsonb_typeof(completion_evidence) = 'object');

alter table tasks
  add constraint tasks_completion_consistent_check check (
    (status = 'done' and completed_by_user_id is not null and completed_at is not null and completion_evidence <> '{}'::jsonb)
    or (status <> 'done' and completed_at is null)
  );

alter table tasks
  add constraint tasks_cancelled_reason_check check (
    (status = 'cancelled' and cancelled_reason is not null and length(trim(cancelled_reason)) > 0)
    or status <> 'cancelled'
  );

alter table tasks
  add constraint tasks_tenant_id_unique unique (tenant_id, id);

alter table tasks drop constraint if exists tasks_invoice_fk;
alter table tasks
  add constraint tasks_invoice_fk
  foreign key (tenant_id, invoice_id) references invoices(tenant_id, id) on delete set null;

alter table tasks drop constraint if exists tasks_encounter_fk;
alter table tasks
  add constraint tasks_encounter_fk
  foreign key (tenant_id, encounter_id) references encounters(tenant_id, id) on delete set null;

alter table tasks drop constraint if exists tasks_treatment_plan_fk;
alter table tasks
  add constraint tasks_treatment_plan_fk
  foreign key (tenant_id, treatment_plan_id) references treatment_plans(tenant_id, id) on delete set null;

alter table tasks drop constraint if exists tasks_procedure_performed_fk;
alter table tasks
  add constraint tasks_procedure_performed_fk
  foreign key (tenant_id, procedure_performed_id) references procedure_performed_records(tenant_id, id) on delete set null;

create index if not exists tasks_patient_due_idx
  on tasks(tenant_id, clinic_id, patient_id, status, due_at)
  where patient_id is not null;
create index if not exists tasks_assignee_due_idx
  on tasks(tenant_id, clinic_id, assigned_to_user_id, status, due_at)
  where assigned_to_user_id is not null;
create index if not exists tasks_source_workflow_idx
  on tasks(tenant_id, clinic_id, source_workflow, status, due_at);
create unique index if not exists tasks_idempotency_unique_idx
  on tasks(tenant_id, clinic_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists recall_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  code text not null check (length(trim(code)) > 0),
  title text not null check (length(trim(title)) > 0),
  status text not null default 'active' check (status in ('active', 'paused', 'retired')),
  anchor text not null default 'procedure_completed' check (anchor in ('procedure_completed', 'checkout_completed')),
  offset_days integer not null check (offset_days between 1 and 3650),
  procedure_category text,
  pricebook_procedure_id uuid,
  default_task_title text not null check (length(trim(default_task_title)) > 0),
  default_task_priority text not null default 'normal' check (default_task_priority in ('low', 'normal', 'high', 'urgent')),
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, code),
  constraint recall_rules_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint recall_rules_pricebook_procedure_fk
    foreign key (tenant_id, pricebook_procedure_id) references pricebook_procedures(tenant_id, id) on delete set null,
  constraint recall_rules_specificity_check check (
    procedure_category is null or length(trim(procedure_category)) > 0
  )
);

create index if not exists recall_rules_active_idx
  on recall_rules(tenant_id, clinic_id, status, anchor, offset_days);

create trigger recall_rules_set_updated_at
before update on recall_rules
for each row execute function clinic_os.set_updated_at();

create table if not exists recalls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  recall_rule_id uuid not null,
  patient_id uuid not null,
  source_procedure_performed_id uuid,
  source_invoice_id uuid,
  task_id uuid,
  appointment_id uuid,
  status text not null default 'due' check (
    status in ('due', 'contact_requested', 'contacted', 'booked', 'completed', 'cancelled', 'skipped')
  ),
  due_at timestamptz not null,
  last_action_at timestamptz,
  action_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(action_evidence) = 'object'),
  created_by_user_id uuid references users(id) on delete set null,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint recalls_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint recalls_rule_fk
    foreign key (tenant_id, recall_rule_id) references recall_rules(tenant_id, id) on delete restrict,
  constraint recalls_patient_fk
    foreign key (tenant_id, patient_id) references patients(tenant_id, id) on delete restrict,
  constraint recalls_procedure_fk
    foreign key (tenant_id, source_procedure_performed_id) references procedure_performed_records(tenant_id, id) on delete set null,
  constraint recalls_invoice_fk
    foreign key (tenant_id, source_invoice_id) references invoices(tenant_id, id) on delete set null,
  constraint recalls_task_fk
    foreign key (tenant_id, task_id) references tasks(tenant_id, id) on delete set null,
  constraint recalls_appointment_fk
    foreign key (tenant_id, appointment_id) references appointments(tenant_id, id) on delete set null
);

create unique index if not exists recalls_generated_procedure_unique_idx
  on recalls(tenant_id, clinic_id, recall_rule_id, source_procedure_performed_id)
  where source_procedure_performed_id is not null;
create index if not exists recalls_due_idx
  on recalls(tenant_id, clinic_id, status, due_at);
create index if not exists recalls_patient_idx
  on recalls(tenant_id, clinic_id, patient_id, due_at desc);

create trigger recalls_set_updated_at
before update on recalls
for each row execute function clinic_os.set_updated_at();

create table if not exists sop_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  code text not null check (length(trim(code)) > 0),
  title text not null check (length(trim(title)) > 0),
  description text,
  status text not null default 'active' check (status in ('active', 'retired')),
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, code),
  constraint sop_templates_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict
);

create trigger sop_templates_set_updated_at
before update on sop_templates
for each row execute function clinic_os.set_updated_at();

create table if not exists sop_template_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  template_id uuid not null,
  item_index integer not null check (item_index > 0),
  title text not null check (length(trim(title)) > 0),
  instructions text,
  evidence_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, template_id, item_index),
  constraint sop_template_items_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint sop_template_items_template_fk
    foreign key (tenant_id, template_id) references sop_templates(tenant_id, id) on delete cascade
);

create trigger sop_template_items_set_updated_at
before update on sop_template_items
for each row execute function clinic_os.set_updated_at();

create table if not exists sop_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  template_id uuid not null,
  title text not null check (length(trim(title)) > 0),
  status text not null default 'active' check (status in ('active', 'paused', 'retired')),
  recurrence_type text not null check (recurrence_type in ('daily', 'weekly', 'monthly', 'interval_days')),
  interval_days integer check (interval_days is null or interval_days between 1 and 365),
  day_of_week integer check (day_of_week is null or day_of_week between 0 and 6),
  day_of_month integer check (day_of_month is null or day_of_month between 1 and 31),
  due_time time not null,
  timezone text not null default 'Asia/Kolkata' check (length(trim(timezone)) > 0),
  starts_on date not null,
  ends_on date,
  assigned_to_user_id uuid references users(id) on delete set null,
  default_task_priority text not null default 'normal' check (default_task_priority in ('low', 'normal', 'high', 'urgent')),
  created_by_user_id uuid not null references users(id) on delete restrict,
  updated_by_user_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  constraint sop_schedules_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint sop_schedules_template_fk
    foreign key (tenant_id, template_id) references sop_templates(tenant_id, id) on delete restrict,
  constraint sop_schedules_recurrence_shape_check check (
    (recurrence_type = 'daily' and interval_days is null and day_of_week is null and day_of_month is null)
    or (recurrence_type = 'weekly' and interval_days is null and day_of_week is not null and day_of_month is null)
    or (recurrence_type = 'monthly' and interval_days is null and day_of_week is null and day_of_month is not null)
    or (recurrence_type = 'interval_days' and interval_days is not null and day_of_week is null and day_of_month is null)
  ),
  constraint sop_schedules_date_window_check check (ends_on is null or ends_on >= starts_on)
);

create index if not exists sop_schedules_active_idx
  on sop_schedules(tenant_id, clinic_id, status, starts_on, ends_on);

create trigger sop_schedules_set_updated_at
before update on sop_schedules
for each row execute function clinic_os.set_updated_at();

create table if not exists sop_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  template_id uuid not null,
  schedule_id uuid not null,
  task_id uuid,
  due_at timestamptz not null,
  status text not null default 'due' check (status in ('due', 'in_progress', 'completed', 'cancelled', 'overdue')),
  assigned_to_user_id uuid references users(id) on delete set null,
  started_by_user_id uuid references users(id) on delete set null,
  started_at timestamptz,
  completed_by_user_id uuid references users(id) on delete set null,
  completed_at timestamptz,
  completion_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(completion_evidence) = 'object'),
  generated_from_key text not null check (length(trim(generated_from_key)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, schedule_id, due_at),
  unique (tenant_id, clinic_id, generated_from_key),
  constraint sop_runs_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint sop_runs_template_fk
    foreign key (tenant_id, template_id) references sop_templates(tenant_id, id) on delete restrict,
  constraint sop_runs_schedule_fk
    foreign key (tenant_id, schedule_id) references sop_schedules(tenant_id, id) on delete restrict,
  constraint sop_runs_task_fk
    foreign key (tenant_id, task_id) references tasks(tenant_id, id) on delete set null,
  constraint sop_runs_completion_consistent_check check (
    (status = 'completed' and completed_by_user_id is not null and completed_at is not null and completion_evidence <> '{}'::jsonb)
    or (status <> 'completed' and completed_at is null)
  )
);

create index if not exists sop_runs_due_idx
  on sop_runs(tenant_id, clinic_id, status, due_at);

create trigger sop_runs_set_updated_at
before update on sop_runs
for each row execute function clinic_os.set_updated_at();

create table if not exists sop_run_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete restrict,
  clinic_id uuid not null,
  sop_run_id uuid not null,
  template_item_id uuid,
  item_index integer not null check (item_index > 0),
  title text not null check (length(trim(title)) > 0),
  instructions text,
  evidence_required boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'done', 'skipped')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  completed_by_user_id uuid references users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, clinic_id, sop_run_id, item_index),
  constraint sop_run_items_clinic_tenant_fk
    foreign key (tenant_id, clinic_id) references clinics(tenant_id, id) on delete restrict,
  constraint sop_run_items_run_fk
    foreign key (tenant_id, sop_run_id) references sop_runs(tenant_id, id) on delete cascade,
  constraint sop_run_items_template_item_fk
    foreign key (tenant_id, template_item_id) references sop_template_items(tenant_id, id) on delete set null,
  constraint sop_run_items_completion_consistent_check check (
    (status = 'done' and completed_by_user_id is not null and completed_at is not null)
    or (status <> 'done' and completed_at is null)
  ),
  constraint sop_run_items_required_evidence_check check (
    status <> 'done' or evidence_required = false or evidence <> '{}'::jsonb
  )
);

create index if not exists sop_run_items_run_idx
  on sop_run_items(tenant_id, clinic_id, sop_run_id, item_index);

create trigger sop_run_items_set_updated_at
before update on sop_run_items
for each row execute function clinic_os.set_updated_at();

alter table recall_rules enable row level security;
alter table recall_rules force row level security;
drop policy if exists recall_rules_tenant_clinic_isolation on recall_rules;
create policy recall_rules_tenant_clinic_isolation on recall_rules
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table recalls enable row level security;
alter table recalls force row level security;
drop policy if exists recalls_tenant_clinic_isolation on recalls;
create policy recalls_tenant_clinic_isolation on recalls
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table sop_templates enable row level security;
alter table sop_templates force row level security;
drop policy if exists sop_templates_tenant_clinic_isolation on sop_templates;
create policy sop_templates_tenant_clinic_isolation on sop_templates
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table sop_template_items enable row level security;
alter table sop_template_items force row level security;
drop policy if exists sop_template_items_tenant_clinic_isolation on sop_template_items;
create policy sop_template_items_tenant_clinic_isolation on sop_template_items
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table sop_schedules enable row level security;
alter table sop_schedules force row level security;
drop policy if exists sop_schedules_tenant_clinic_isolation on sop_schedules;
create policy sop_schedules_tenant_clinic_isolation on sop_schedules
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table sop_runs enable row level security;
alter table sop_runs force row level security;
drop policy if exists sop_runs_tenant_clinic_isolation on sop_runs;
create policy sop_runs_tenant_clinic_isolation on sop_runs
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

alter table sop_run_items enable row level security;
alter table sop_run_items force row level security;
drop policy if exists sop_run_items_tenant_clinic_isolation on sop_run_items;
create policy sop_run_items_tenant_clinic_isolation on sop_run_items
  using (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id())
  with check (tenant_id = clinic_os.current_tenant_id() and clinic_id = clinic_os.current_clinic_id());

comment on table tasks is 'Canonical continuity task workbench with assignment, priority, source workflow, durable links, completion evidence, and retry-safe idempotency keys.';
comment on table recall_rules is 'Clinic-configurable recall rules, including six-month procedure/checkout recalls.';
comment on table recalls is 'Generated recall instances linked to source procedure/checkout evidence and task workbench items.';
comment on table sop_templates is 'Clinic SOP checklist templates.';
comment on table sop_template_items is 'Sequenced checklist items for SOP templates.';
comment on table sop_schedules is 'Recurring SOP schedule definitions with deterministic due generation.';
comment on table sop_runs is 'Idempotently generated SOP runs with due/overdue/completion state and task linkage.';
comment on table sop_run_items is 'Per-run SOP checklist item completion evidence.';
