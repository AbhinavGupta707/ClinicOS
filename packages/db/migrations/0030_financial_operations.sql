-- Financial evidence is append-only. Original invoices, payments and receipts survive corrections.
alter table invoices add column credited_minor bigint not null default 0 check(credited_minor >= 0 and credited_minor <= total_minor);
alter table invoices add column financial_version bigint not null default 1 check(financial_version > 0);
alter table invoices drop constraint invoices_balance_consistent;
alter table invoices add constraint invoices_balance_consistent check(balance_minor = greatest(total_minor - credited_minor - paid_minor + refunded_minor, 0));
create table financial_entries (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, clinic_id uuid not null,
 patient_id uuid, invoice_id uuid, payment_transaction_id uuid, target_entry_id uuid, invoice_item_id uuid,
 kind text not null check(kind in ('invoice_credit','payment_reversal','payment_refund','advance_received','advance_allocated','advance_returned','allocation_reversed','expense','expense_reversal')),
 amount_minor bigint not null check(amount_minor > 0 and amount_minor <= 9007199254740991),
 tax_minor bigint not null default 0 check(tax_minor >= 0 and tax_minor <= amount_minor),
 method text not null check(method in ('cash','upi','card','bank_transfer','cheque','other','allocation','credit')),
 reason text not null check(length(trim(reason)) between 1 and 1000),
 reference text not null check(length(trim(reference)) between 1 and 160),
 occurred_at timestamptz not null, created_at timestamptz not null default now(),
 created_by_user_id uuid not null references users(id) on delete restrict,
 unique(tenant_id,clinic_id,id), unique(tenant_id,clinic_id,kind,reference),
 foreign key(tenant_id,clinic_id) references clinics(tenant_id,id) on delete restrict,
 foreign key(tenant_id,clinic_id,patient_id) references patients(tenant_id,clinic_id,id) on delete restrict,
 foreign key(tenant_id,clinic_id,invoice_id) references invoices(tenant_id,clinic_id,id) on delete restrict,
 foreign key(tenant_id,clinic_id,payment_transaction_id) references payment_transactions(tenant_id,clinic_id,id) on delete restrict,
 foreign key(tenant_id,clinic_id,target_entry_id) references financial_entries(tenant_id,clinic_id,id) on delete restrict,
 foreign key(tenant_id,invoice_item_id) references invoice_items(tenant_id,id) on delete restrict,
 check((kind in ('expense','expense_reversal')) = (patient_id is null)),
 check((kind in ('invoice_credit','payment_reversal','payment_refund','advance_allocated','allocation_reversed')) = (invoice_id is not null)),
 check((kind = 'invoice_credit') = (invoice_item_id is not null))
);
create unique index financial_credit_line_once on financial_entries(tenant_id,clinic_id,invoice_item_id) where kind='invoice_credit';
create index financial_patient_history on financial_entries(tenant_id,clinic_id,patient_id,occurred_at desc,id desc);
create index financial_day on financial_entries(tenant_id,clinic_id,occurred_at,id);
create index financial_target on financial_entries(tenant_id,clinic_id,target_entry_id);
create index financial_invoice on financial_entries(tenant_id,clinic_id,invoice_id);
create index financial_payment on financial_entries(tenant_id,clinic_id,payment_transaction_id);
create trigger financial_entries_immutable before update or delete on financial_entries for each row execute function clinic_os.reject_import_run_mutation();
alter table financial_entries enable row level security;
alter table financial_entries force row level security;
create policy financial_entries_scope on financial_entries using(tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id()) with check(tenant_id=clinic_os.current_tenant_id() and clinic_id=clinic_os.current_clinic_id());

-- Reconcile historical provider refunds before account/report reads use the new projection.
-- Owner bypass is limited to this transactional migration and restored before commit.
alter table invoices no force row level security;
alter table payment_transactions no force row level security;
alter table payment_requests no force row level security;
with refund_history as (
 select r.id, r.amount_minor,
   coalesce((c.metadata->>'unallocated_amount_minor')::bigint,0) as excess,
   sum(r.amount_minor) over(partition by c.id order by r.received_at,r.id rows unbounded preceding) as cumulative
 from payment_transactions r join payment_transactions c
 on c.tenant_id=r.tenant_id and c.clinic_id=r.clinic_id and c.invoice_id=r.invoice_id
 and c.provider='razorpay' and c.method<>'refund' and c.verification_status='verified'
 and c.provider_payment_id=r.metadata->>'provider_payment_id'
 where r.provider='razorpay' and r.method='refund' and r.status='refunded' and r.verification_status='verified'
), allocations as (
 select id,amount_minor,greatest(cumulative-excess,0)-greatest(cumulative-amount_minor-excess,0) as applied from refund_history
)
update payment_transactions p set metadata=p.metadata || jsonb_build_object('invoice_refund_amount_minor',a.applied,'unallocated_refund_amount_minor',a.amount_minor-a.applied)
from allocations a where p.id=a.id;
with amounts as (
 select i.id,i.total_minor,i.status,
 coalesce(sum(p.amount_minor) filter(where p.method<>'refund' and ((p.status in ('succeeded','refunded') and p.verification_status='verified') or (p.status='manually_recorded' and p.verification_status='not_required_manual'))),0) as paid,
 coalesce(sum(coalesce((p.metadata->>'invoice_refund_amount_minor')::bigint,p.amount_minor)) filter(where p.method='refund' and p.status='refunded' and p.verification_status='verified'),0) as refunded,
 coalesce(bool_or(p.status='reconciliation_required' or p.reconciliation_status='requires_review'),false) as issue,
 exists(select 1 from payment_requests q where q.tenant_id=i.tenant_id and q.clinic_id=i.clinic_id and q.invoice_id=i.id and q.status in ('requested','provider_created','sent')) as requested
 from invoices i left join payment_transactions p on p.tenant_id=i.tenant_id and p.clinic_id=i.clinic_id and p.invoice_id=i.id
 group by i.id
)
update invoices i set paid_minor=a.paid,refunded_minor=a.refunded,balance_minor=greatest(a.total_minor-a.paid+a.refunded,0),financial_version=i.financial_version+1,
 payment_status=case when a.status<>'issued' then 'cancelled' when a.issue then 'reconciliation_required' when a.refunded>0 and a.paid=a.refunded then 'refunded' when a.paid-a.refunded>a.total_minor then 'overpaid' when a.paid-a.refunded=a.total_minor then 'paid' when a.paid-a.refunded>0 then 'partially_paid' when a.requested then 'payment_requested' else 'unpaid' end
 from amounts a where a.id=i.id;
alter table invoices force row level security;
alter table payment_transactions force row level security;
alter table payment_requests force row level security;
