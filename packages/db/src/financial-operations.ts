import { randomUUID } from "node:crypto";
import {
  financialPosition,
  safeMinor,
  validateFinancialCommand,
  type FinancialCommandInput,
  type UUID
} from "@clinic-os/domain";
import type { SqlQueryClient } from "./postgres.ts";
import type { RepositoryScope } from "./repositories.ts";
export class FinancialConflict extends Error {}
type Row = Record<string, unknown>;
const scopeArgs = (s: Pick<RepositoryScope, "tenantId" | "clinicId">) => [s.tenantId, s.clinicId];
const number = (v: unknown) => safeMinor(v ?? 0);
function json(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([k, v]) => [
      k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
      v instanceof Date ? v.toISOString() : /(?:_minor|_version)$/.test(k) ? number(v) : v
    ])
  );
}
async function invoiceRow(
  c: SqlQueryClient,
  s: Pick<RepositoryScope, "tenantId" | "clinicId">,
  id: string
) {
  const r = await c.query<Row>(
    "select * from invoices where tenant_id=$1 and clinic_id=$2 and id=$3 for update",
    [...scopeArgs(s), id]
  );
  if (!r.rows[0]) throw new FinancialConflict("Invoice not found in this clinic.");
  return r.rows[0];
}
/** One calculation serves ordinary manual payments, provider callbacks and adjustments. */
export async function refreshInvoiceFinancialState(
  c: SqlQueryClient,
  s: Pick<RepositoryScope, "tenantId" | "clinicId">,
  id: string
) {
  const i = await invoiceRow(c, s, id);
  const p = (
    await c.query<Row>(
      `select
 coalesce(sum(amount_minor) filter(where method <> 'refund' and ((status in ('succeeded','refunded') and verification_status='verified') or (status='manually_recorded' and verification_status='not_required_manual'))),0) as captured,
 coalesce(sum(coalesce((metadata->>'invoice_refund_amount_minor')::bigint,amount_minor)) filter(where method='refund' and status='refunded' and verification_status='verified'),0) as refunded,
 coalesce(bool_or(status='reconciliation_required' or reconciliation_status='requires_review'),false) as issue
 from payment_transactions where tenant_id=$1 and clinic_id=$2 and invoice_id=$3`,
      [...scopeArgs(s), id]
    )
  ).rows[0];
  const a = (
    await c.query<Row>(
      `select coalesce(sum(amount_minor) filter(where kind='invoice_credit'),0) as credited,
 coalesce(sum(amount_minor) filter(where kind in ('payment_reversal','allocation_reversed')),0) as reversed,
 coalesce(sum(amount_minor) filter(where kind='payment_refund'),0) as refunded
 from financial_entries where tenant_id=$1 and clinic_id=$2 and invoice_id=$3`,
      [...scopeArgs(s), id]
    )
  ).rows[0];
  const paid = number(p.captured) - number(a.reversed),
    refunded = number(p.refunded) + number(a.refunded),
    credit = number(a.credited);
  const position = financialPosition({
    totalMinor: number(i.total_minor),
    creditMinor: credit,
    paidMinor: paid,
    refundedMinor: refunded
  });
  const hasRequest = (
    await c.query<{ present: boolean }>(
      `select exists(select 1 from payment_requests where tenant_id=$1 and clinic_id=$2 and invoice_id=$3 and status in ('requested','provider_created','sent')) as present`,
      [...scopeArgs(s), id]
    )
  ).rows[0].present;
  const status =
    i.status !== "issued"
      ? "cancelled"
      : p.issue
        ? "reconciliation_required"
        : refunded > 0 && position.netPaidMinor === 0
          ? "refunded"
          : position.refundableMinor > 0
            ? "overpaid"
            : position.balanceMinor === 0
              ? "paid"
              : position.netPaidMinor > 0
                ? "partially_paid"
                : hasRequest
                  ? "payment_requested"
                  : "unpaid";
  await c.query(
    `update invoices set credited_minor=$4,paid_minor=$5,refunded_minor=$6,balance_minor=$7,payment_status=$8,
 financial_version=financial_version+1 where tenant_id=$1 and clinic_id=$2 and id=$3
 and (credited_minor,paid_minor,refunded_minor,balance_minor,payment_status) is distinct from ($4::bigint,$5::bigint,$6::bigint,$7::bigint,$8::text)`,
    [...scopeArgs(s), id, credit, paid, refunded, position.balanceMinor, status]
  );
  return { ...position, creditMinor: credit, paidMinor: paid, refundedMinor: refunded };
}
async function remainingAdvance(c: SqlQueryClient, s: RepositoryScope, id: string) {
  const r = (
    await c.query<Row>(
      `select a.amount_minor - coalesce((select sum(case when e.kind='allocation_reversed' then -e.amount_minor else e.amount_minor end) from financial_entries e where e.tenant_id=a.tenant_id and e.clinic_id=a.clinic_id and (e.target_entry_id=a.id or (e.kind='allocation_reversed' and e.target_entry_id in(select id from financial_entries where tenant_id=a.tenant_id and clinic_id=a.clinic_id and target_entry_id=a.id and kind='advance_allocated')))),0) as available
 from financial_entries a where a.tenant_id=$1 and a.clinic_id=$2 and a.id=$3 and a.kind='advance_received'`,
      [...scopeArgs(s), id]
    )
  ).rows[0];
  if (!r) throw new FinancialConflict("Advance not found.");
  return number(r.available);
}
export async function executeFinancialCommand(
  c: SqlQueryClient,
  s: RepositoryScope,
  input: FinancialCommandInput,
  now: Date
): Promise<Row> {
  validateFinancialCommand(input);
  const patient = input.patientId ?? null;
  if (patient) {
    const p = await c.query(
      "select id from patients where tenant_id=$1 and clinic_id=$2 and id=$3 for update",
      [...scopeArgs(s), patient]
    );
    if (!p.rows.length) throw new FinancialConflict("Patient not found in this clinic.");
  }
  let invoice: Row | undefined;
  if (input.invoiceId) {
    invoice = await invoiceRow(c, s, input.invoiceId);
    if (invoice.patient_id !== patient || invoice.status !== "issued")
      throw new FinancialConflict("Choose an issued invoice for this patient.");
    if (number(invoice.financial_version) !== input.expectedVersion)
      throw new FinancialConflict(
        "Invoice changed. Refresh and review its current financial state."
      );
  }
  let amount = input.amountMinor ?? 0,
    tax = 0,
    method = input.method ?? "other",
    paymentId = input.paymentTransactionId ?? null;
  let target: Row | undefined;
  if (input.targetEntryId) {
    target = (
      await c.query<Row>(
        "select * from financial_entries where tenant_id=$1 and clinic_id=$2 and id=$3 for update",
        [...scopeArgs(s), input.targetEntryId]
      )
    ).rows[0];
    if (!target || target.patient_id !== patient)
      throw new FinancialConflict("Original financial entry does not belong to this account.");
  }
  if (input.kind === "invoice_credit") {
    const item = (
      await c.query<Row>(
        `select * from invoice_items where tenant_id=$1 and clinic_id=$2 and invoice_id=$3 and id=$4`,
        [...scopeArgs(s), input.invoiceId, input.invoiceItemId]
      )
    ).rows[0];
    if (!item) throw new FinancialConflict("Choose an original invoice line.");
    amount = number(item.total_minor);
    tax = number(item.tax_minor);
    method = "credit";
    if (amount === 0) throw new FinancialConflict("A zero-value line has no charge to credit.");
  } else if (input.kind === "advance_allocated") {
    if (
      target?.kind !== "advance_received" ||
      amount > (await remainingAdvance(c, s, String(target.id))) ||
      amount > number(invoice!.balance_minor)
    )
      throw new FinancialConflict("Allocation exceeds available advance or invoice balance.");
    method = "allocation";
    paymentId = randomUUID();
    await c.query(
      `insert into payment_transactions(id,tenant_id,clinic_id,patient_id,invoice_id,provider,amount_minor,currency,method,status,verification_status,reconciliation_status,idempotency_key,received_at,recorded_by_user_id,metadata)
 values($1,$2,$3,$4,$5,'manual',$6,'INR','advance_allocation','manually_recorded','not_required_manual','matched',$7,$8,$9,$10::jsonb)`,
      [
        paymentId,
        ...scopeArgs(s),
        patient,
        input.invoiceId,
        amount,
        `advance:${paymentId}`,
        now,
        s.actorUserId,
        JSON.stringify({
          advanceEntryId: target.id,
          reference: input.reference,
          reason: input.reason
        })
      ]
    );
  } else if (input.kind === "advance_returned") {
    if (
      target?.kind !== "advance_received" ||
      amount > (await remainingAdvance(c, s, String(target.id)))
    )
      throw new FinancialConflict("Return exceeds the unallocated advance.");
    // The money may be returned through a different method than the original receipt.
  } else if (input.kind === "allocation_reversed") {
    if (target?.kind !== "advance_allocated" || target.invoice_id !== input.invoiceId)
      throw new FinancialConflict("Choose an allocation on this invoice.");
    const used = (
      await c.query<Row>(
        `select coalesce(sum(amount_minor),0) as n from financial_entries where tenant_id=$1 and clinic_id=$2 and target_entry_id=$3 and kind='allocation_reversed'`,
        [...scopeArgs(s), target.id]
      )
    ).rows[0];
    if (amount + number(used.n) > number(target.amount_minor))
      throw new FinancialConflict("Allocation reversal exceeds the original amount.");
    method = "allocation";
    paymentId = String(target.payment_transaction_id);
  } else if (["payment_reversal", "payment_refund"].includes(input.kind)) {
    const payment = (
      await c.query<Row>(
        "select * from payment_transactions where tenant_id=$1 and clinic_id=$2 and id=$3 and invoice_id=$4 for update",
        [...scopeArgs(s), paymentId, input.invoiceId]
      )
    ).rows[0];
    if (
      !payment ||
      payment.provider !== "manual" ||
      payment.status !== "manually_recorded" ||
      payment.verification_status !== "not_required_manual" ||
      payment.method === "advance_allocation"
    )
      throw new FinancialConflict(
        "Only evidenced direct manual payments can be corrected here. Provider payments require provider reconciliation; advances use allocation reversal."
      );
    const used = (
      await c.query<Row>(
        `select coalesce(sum(amount_minor),0) as n from financial_entries where tenant_id=$1 and clinic_id=$2 and payment_transaction_id=$3 and kind in ('payment_reversal','payment_refund')`,
        [...scopeArgs(s), paymentId]
      )
    ).rows[0];
    if (amount + number(used.n) > number(payment.amount_minor))
      throw new FinancialConflict("Adjustment exceeds the remaining original payment.");
    if (
      input.kind === "payment_refund" &&
      amount >
        Math.max(
          number(invoice!.paid_minor) -
            number(invoice!.refunded_minor) -
            (number(invoice!.total_minor) - number(invoice!.credited_minor)),
          0
        )
    )
      throw new FinancialConflict(
        "Credit the relevant invoice charge before recording money returned. No refundable balance is available."
      );
    if (input.kind === "payment_reversal") method = String(payment.method);
  } else if (input.kind === "expense_reversal") {
    if (target?.kind !== "expense") throw new FinancialConflict("Choose an original expense.");
    if (
      (
        await c.query(
          "select id from financial_entries where tenant_id=$1 and clinic_id=$2 and target_entry_id=$3 and kind='expense_reversal'",
          [...scopeArgs(s), target.id]
        )
      ).rows.length
    )
      throw new FinancialConflict("Expense already reversed.");
    amount = number(target.amount_minor);
    method = String(target.method);
  }
  const saved = (
    await c.query<Row>(
      `insert into financial_entries(tenant_id,clinic_id,patient_id,invoice_id,payment_transaction_id,target_entry_id,invoice_item_id,kind,amount_minor,tax_minor,method,reason,reference,occurred_at,created_by_user_id)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
      [
        ...scopeArgs(s),
        patient,
        input.invoiceId ?? null,
        paymentId,
        input.targetEntryId ?? null,
        input.invoiceItemId ?? null,
        input.kind,
        amount,
        tax,
        method,
        input.reason.trim(),
        input.reference.trim(),
        now,
        s.actorUserId
      ]
    )
  ).rows[0];
  if (invoice) await refreshInvoiceFinancialState(c, s, String(invoice.id));
  return json(saved);
}
export async function getFinancialAccount(
  c: SqlQueryClient,
  s: RepositoryScope,
  patientId: string,
  cursor?: string,
  advanceCursor?: string
): Promise<Row> {
  const patient = (
    await c.query<Row>(
      "select id,full_name from patients where tenant_id=$1 and clinic_id=$2 and id=$3",
      [...scopeArgs(s), patientId]
    )
  ).rows[0];
  if (!patient) throw new FinancialConflict("Patient not found.");
  const entries = (
    await c.query<Row>(
      "select * from financial_entries where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and ($4::uuid is null or (occurred_at,id)<(select occurred_at,id from financial_entries where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and id=$4)) order by occurred_at desc,id desc limit 101",
      [...scopeArgs(s), patientId, cursor ?? null]
    )
  ).rows;
  const totals = (
    await c.query<Row>(
      `select coalesce(sum(total_minor-credited_minor),0) as net_charges_minor,coalesce(sum(balance_minor),0) as due_minor,coalesce(sum(greatest(paid_minor-refunded_minor-(total_minor-credited_minor),0)),0) as refundable_minor from invoices where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and status='issued'`,
      [...scopeArgs(s), patientId]
    )
  ).rows[0];
  const advances = (
    await c.query<Row>(
      `select id,reference,amount_minor from financial_entries where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and kind='advance_received' and ($4::uuid is null or (occurred_at,id)<(select occurred_at,id from financial_entries where tenant_id=$1 and clinic_id=$2 and patient_id=$3 and id=$4)) order by occurred_at desc,id desc limit 101`,
      [...scopeArgs(s), patientId, advanceCursor ?? null]
    )
  ).rows;
  const available = [];
  for (const advance of advances.slice(0, 100))
    available.push({
      ...json(advance),
      availableMinor: await remainingAdvance(c, s, String(advance.id))
    });
  return {
    patient: json(patient),
    totals: json(totals),
    entries: entries.slice(0, 100).map(json),
    nextCursor: entries.length > 100 ? entries[99].id : null,
    advances: available,
    nextAdvanceCursor: advances.length > 100 ? advances[99].id : null
  };
}
export async function getFinancialDay(
  c: SqlQueryClient,
  s: RepositoryScope,
  date: string,
  entryCursor?: string,
  dueCursor?: string
): Promise<Row> {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date
  )
    throw new RangeError("Choose a valid clinic date.");
  const range = (
    await c.query<Row>(
      `select timezone,($3::date::timestamp at time zone timezone) as start_at,(($3::date+1)::timestamp at time zone timezone) as end_at from clinics where tenant_id=$1 and id=$2`,
      [...scopeArgs(s), date]
    )
  ).rows[0];
  if (!range) throw new FinancialConflict("Clinic not found.");
  const args = [...scopeArgs(s), range.start_at, range.end_at];
  const entries = (
    await c.query<Row>(
      "select * from financial_entries where tenant_id=$1 and clinic_id=$2 and occurred_at >= $3 and occurred_at < $4 and ($5::uuid is null or (occurred_at,id)<(select occurred_at,id from financial_entries where tenant_id=$1 and clinic_id=$2 and id=$5)) order by occurred_at desc,id desc limit 101",
      [...args, entryCursor ?? null]
    )
  ).rows;
  const movements = (
    await c.query<Row>(
      `select method,kind,sum(amount_minor) as amount_minor,count(*)::int as count from (
 select method,case when method='refund' then 'provider_refund' else 'payment_received' end as kind,case when method<>'refund' then coalesce((metadata->>'captured_amount_minor')::bigint,amount_minor) else amount_minor end as amount_minor from payment_transactions where tenant_id=$1 and clinic_id=$2 and received_at >= $3 and received_at < $4 and method<>'advance_allocation' and ((status in ('succeeded','refunded') and verification_status='verified') or (status='manually_recorded' and verification_status='not_required_manual'))
 union all select method,kind,amount_minor from financial_entries where tenant_id=$1 and clinic_id=$2 and occurred_at >= $3 and occurred_at < $4
 ) m group by method,kind order by kind,method`,
      args
    )
  ).rows;
  const totals = (
    await c.query<Row>(
      `select coalesce(sum(total_minor),0) as invoiced_minor from invoices where tenant_id=$1 and clinic_id=$2 and issued_at >= $3 and issued_at < $4`,
      args
    )
  ).rows[0];
  const dues = (
    await c.query<Row>(
      `select i.id,i.patient_id,p.full_name,i.invoice_number,i.balance_minor,i.due_at from invoices i join patients p on p.tenant_id=i.tenant_id and p.clinic_id=i.clinic_id and p.id=i.patient_id where i.tenant_id=$1 and i.clinic_id=$2 and i.status='issued' and i.balance_minor>0 and ($3::uuid is null or i.id>$3) order by i.id limit 101`,
      [...scopeArgs(s), dueCursor ?? null]
    )
  ).rows;
  return {
    date,
    timezone: range.timezone,
    totals: json(totals),
    movements: movements.map(json),
    entries: entries.slice(0, 100).map(json),
    nextEntryCursor: entries.length > 100 ? entries[99].id : null,
    dues: dues.slice(0, 100).map(json),
    nextDueCursor: dues.length > 100 ? dues[99].id : null
  };
}
