-- CP13: bounded, resumable continuity and SOP due generation.
-- The generated-invoice key closes the checkout-anchor idempotency gap; the remaining
-- indexes keep keyset pages bounded without weakening tenant/clinic RLS.

create unique index if not exists recalls_generated_invoice_unique_idx
  on recalls(tenant_id, clinic_id, recall_rule_id, source_invoice_id)
  where source_invoice_id is not null;

alter table recall_rules
  add constraint recall_rules_checkout_anchor_filter_check check (
    anchor = 'procedure_completed'
    or (procedure_category is null and pricebook_procedure_id is null)
  );

create index if not exists procedure_performed_generation_page_idx
  on procedure_performed_records(tenant_id, clinic_id, id)
  include (patient_id, encounter_id, treatment_plan_id, pricebook_procedure_id, performed_at, created_at)
  where status = 'completed';

create index if not exists invoice_generation_page_idx
  on invoices(tenant_id, clinic_id, id)
  include (patient_id, treatment_plan_id, issued_at, due_at, balance_minor, payment_status, created_at)
  where status = 'issued';

create index if not exists sop_schedule_generation_page_idx
  on sop_schedules(tenant_id, clinic_id, id)
  include (template_id, recurrence_type, starts_on, ends_on, created_at)
  where status = 'active';

create index if not exists sop_run_schedule_due_idx
  on sop_runs(tenant_id, clinic_id, schedule_id, due_at desc);

comment on index recalls_generated_invoice_unique_idx is
  'Makes checkout-anchored recall generation retry/concurrency safe per rule and invoice.';
