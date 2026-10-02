"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { PublicJsonObject, ClinicOsApiClient } from "@clinic-os/api-client-generated";
import type { MeProfile } from "@/lib/me";
import { fieldText, record, valueList } from "../shared/workflow-values";
import { formatInrMinor, parseInrMinor } from "./billing-workflow";
import { clinicLocalDate } from "../runtime-helpers";
import { printClinicalDocument } from "../clinical-dental/clinical-workflow";
type Kind =
  | "invoice_credit"
  | "payment_reversal"
  | "payment_refund"
  | "advance_received"
  | "advance_allocated"
  | "advance_returned"
  | "allocation_reversed"
  | "expense"
  | "expense_reversal";
const names: Record<Kind, string> = {
  invoice_credit: "Credit an invoice line",
  payment_reversal: "Correct a mistaken payment",
  payment_refund: "Record money returned",
  advance_received: "Receive an advance",
  advance_allocated: "Apply an advance to an invoice",
  advance_returned: "Return an unused advance",
  allocation_reversed: "Return an allocation to advance credit",
  expense: "Record an expense",
  expense_reversal: "Reverse an expense"
};
export function FinancialOperationsPanel(props: {
  client: ClinicOsApiClient;
  profile: MeProfile;
  patientId: string | null;
  locked: boolean;
  mutate: <T>(
    run: (key: string) => Promise<T>,
    after?: () => Promise<void> | void
  ) => Promise<boolean>;
  onSaved: () => void;
}) {
  const readEpoch = useRef(0),
    dayEpoch = useRef(0);
  const [account, setAccount] = useState<PublicJsonObject | null>(null),
    [invoices, setInvoices] = useState<PublicJsonObject[]>([]),
    [invoiceCursor, setInvoiceCursor] = useState<string | null>(null),
    [invoice, setInvoice] = useState<PublicJsonObject | null>(null),
    [invoiceId, setInvoiceId] = useState("");
  const [day, setDay] = useState<PublicJsonObject | null>(null),
    [date, setDate] = useState(() => clinicLocalDate(new Date(), props.profile.clinic.timezone!));
  const [kind, setKind] = useState<Kind>("advance_received"),
    [target, setTarget] = useState(""),
    [amount, setAmount] = useState(""),
    [method, setMethod] = useState("cash"),
    [reason, setReason] = useState(""),
    [reference, setReference] = useState(""),
    [approved, setApproved] = useState(false),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const manages = props.profile.roles.some((r) => r === "owner" || r === "accountant"),
    reports =
      props.profile.permissions.includes("analytics.read") &&
      props.profile.permissions.includes("billing.read"),
    writes = props.profile.permissions.includes("billing.write");
  useEffect(() => {
    ++readEpoch.current;
    let live = true;
    setLoading(true);
    setAccount(null);
    setInvoices([]);
    setInvoice(null);
    setError("");
    const read = async () => {
      if (props.patientId) {
        const [a, i] = await Promise.all([
          props.client.getFinancialAccount({ path: { patientId: props.patientId } }),
          props.client.listPatientInvoices({
            path: { patientId: props.patientId },
            query: { limit: 50 }
          })
        ]);
        if (live) {
          setAccount(a.account);
          setInvoices([...i.invoices]);
          setInvoiceCursor(i.nextCursor);
        }
      }
    };
    void read()
      .catch(() => {
        if (live) setError("Financial account unavailable. No balance has been assumed.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [props.client, props.patientId]);
  useEffect(() => {
    let live = true;
    setInvoice(null);
    setTarget("");
    setApproved(false);
    if (invoiceId)
      void props.client
        .getInvoice({ path: { invoiceId } })
        .then((r) => {
          if (live) setInvoice(r.invoice);
        })
        .catch(() => {
          if (live) setError("Invoice unavailable. Refresh before recording a change.");
        });
    return () => {
      live = false;
    };
  }, [props.client, invoiceId]);
  useEffect(() => {
    ++dayEpoch.current;
    let live = true;
    setDay(null);
    if (reports)
      void props.client
        .getFinancialDay({ query: { date } })
        .then((r) => {
          if (live) setDay(r.day);
        })
        .catch(() => {
          if (live) setError("Daily reconciliation unavailable.");
        });
    return () => {
      live = false;
    };
  }, [props.client, date, reports]);
  const isExpense = kind === "expense" || kind === "expense_reversal",
    needsInvoice = [
      "invoice_credit",
      "payment_reversal",
      "payment_refund",
      "advance_allocated",
      "allocation_reversed"
    ].includes(kind);
  const targets =
    kind === "invoice_credit"
      ? valueList(invoice?.items).map(record)
      : kind === "payment_refund" || kind === "payment_reversal"
        ? valueList(invoice?.payments)
            .map(record)
            .filter(
              (p) =>
                p.provider === "manual" &&
                p.status === "manually_recorded" &&
                p.method !== "advance_allocation"
            )
        : kind === "advance_allocated" || kind === "advance_returned"
          ? valueList(account?.advances).map(record)
          : kind === "allocation_reversed"
            ? valueList(account?.entries)
                .map(record)
                .filter((e) => e.kind === "advance_allocated" && e.invoiceId === invoiceId)
            : kind === "expense_reversal"
              ? valueList(day?.entries)
                  .map(record)
                  .filter((e) => e.kind === "expense")
              : [];
  const needsTarget = [
    "invoice_credit",
    "payment_reversal",
    "payment_refund",
    "advance_allocated",
    "advance_returned",
    "allocation_reversed",
    "expense_reversal"
  ].includes(kind);
  const noAmount = kind === "invoice_credit" || kind === "expense_reversal";
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      if (!approved) throw new Error("Review and confirm the financial evidence.");
      if (needsInvoice && (!invoice || invoice.id !== invoiceId))
        throw new Error("Load and review the invoice first.");
      if (!isExpense && !props.patientId) throw new Error("Choose a patient.");
      if (needsTarget && !targets.some((t) => t.id === target))
        throw new Error("Choose the original evidence.");
      const body = {
        kind,
        reason,
        reference,
        ...(!isExpense ? { patientId: props.patientId! } : {}),
        ...(needsInvoice ? { invoiceId, expectedVersion: Number(invoice!.financialVersion) } : {}),
        ...(!noAmount ? { amountMinor: parseInrMinor(amount) } : {}),
        ...(["expense", "advance_received", "payment_refund", "advance_returned"].includes(kind)
          ? { method: method as "cash" | "upi" | "card" | "bank_transfer" | "cheque" | "other" }
          : {}),
        ...(kind === "invoice_credit" ? { invoiceItemId: target } : {}),
        ...(["payment_reversal", "payment_refund"].includes(kind)
          ? { paymentTransactionId: target }
          : {}),
        ...([
          "advance_allocated",
          "advance_returned",
          "allocation_reversed",
          "expense_reversal"
        ].includes(kind)
          ? { targetEntryId: target }
          : {})
      };
      await props.mutate(
        (key) =>
          props.client.executeFinancialCommand({ body, headers: { "idempotency-key": key } }),
        props.onSaved
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Financial action failed.");
    }
  }
  async function moreEntries() {
    const epoch = readEpoch.current;
    if (!props.patientId || !account?.nextCursor) return;
    try {
      const r = await props.client.getFinancialAccount({
        path: { patientId: props.patientId },
        query: { cursor: String(account.nextCursor) }
      });
      if (epoch !== readEpoch.current) return;
      setAccount({
        ...r.account,
        advances: account.advances ?? [],
        nextAdvanceCursor: account.nextAdvanceCursor ?? null,
        entries: [...valueList(account.entries), ...valueList(r.account.entries)]
      });
    } catch {
      setError("Could not load further financial evidence.");
    }
  }
  async function moreAdvances() {
    const epoch = readEpoch.current;
    if (!props.patientId || !account?.nextAdvanceCursor) return;
    try {
      const r = await props.client.getFinancialAccount({
        path: { patientId: props.patientId },
        query: { advanceCursor: String(account.nextAdvanceCursor) }
      });
      if (epoch !== readEpoch.current) return;
      setAccount({
        ...account,
        advances: [...valueList(account.advances), ...valueList(r.account.advances)],
        nextAdvanceCursor: r.account.nextAdvanceCursor ?? null
      });
    } catch {
      setError("Could not load further advances.");
    }
  }
  async function moreDay(kind: "entries" | "dues") {
    const epoch = dayEpoch.current;
    if (!day) return;
    try {
      const page = await props.client.getFinancialDay({
        query: {
          date,
          ...(kind === "entries"
            ? { entryCursor: String(day.nextEntryCursor) }
            : { dueCursor: String(day.nextDueCursor) })
        }
      });
      if (epoch !== dayEpoch.current) return;
      setDay({
        ...day,
        [kind]: [...valueList(day[kind]), ...valueList(page.day[kind])],
        [kind === "entries" ? "nextEntryCursor" : "nextDueCursor"]:
          page.day[kind === "entries" ? "nextEntryCursor" : "nextDueCursor"] ?? null
      });
    } catch {
      setError("Could not load more reconciliation evidence.");
    }
  }
  return (
    <section aria-label="Financial operations" data-testid="financial-operations">
      <h2>Financial operations</h2>
      <p>
        Original bills and receipts stay unchanged. Credits reduce charges; refunds record money
        returned. Manual records do not confirm a bank or provider transfer.
      </p>
      {loading && props.patientId ? <p role="status">Loading financial account…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {account ? (
        <>
          <h3>{fieldText(record(account.patient), "fullName")} — account</h3>
          <p>
            Outstanding: <strong>{formatInrMinor(record(account.totals).dueMinor)}</strong> ·
            Refundable invoice credit: {formatInrMinor(record(account.totals).refundableMinor)}
          </p>
          <ul>
            {valueList(account.advances)
              .map(record)
              .map((a) => (
                <li key={String(a.id)}>
                  Advance {String(a.reference)}: {formatInrMinor(a.availableMinor)} available
                </li>
              ))}
          </ul>
          {account.nextAdvanceCursor ? (
            <button disabled={props.locked} onClick={() => void moreAdvances()}>
              More advances
            </button>
          ) : null}
        </>
      ) : null}
      {writes ? (
        <form onSubmit={(e) => void submit(e)}>
          <fieldset disabled={props.locked}>
            <legend>Record reviewed financial evidence</legend>
            <label>
              Financial action
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as Kind);
                  setTarget("");
                  setApproved(false);
                  setAmount("");
                }}
              >
                {Object.entries(names)
                  .filter(([k]) => manages || ["advance_received", "advance_allocated"].includes(k))
                  .map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
              </select>
            </label>
            {needsInvoice ? (
              <>
                <label>
                  Invoice to adjust
                  <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
                    <option value="">Choose an invoice</option>
                    {invoices.map((i) => (
                      <option key={String(i.id)} value={String(i.id)}>
                        {String(i.invoiceNumber)} — {formatInrMinor(i.balanceMinor)} due
                      </option>
                    ))}
                  </select>
                </label>
                {invoiceCursor && props.patientId ? (
                  <button
                    type="button"
                    onClick={() =>
                      void props.client
                        .listPatientInvoices({
                          path: { patientId: props.patientId! },
                          query: { cursor: invoiceCursor, limit: 50 }
                        })
                        .then((r) => {
                          setInvoices((x) => [...x, ...r.invoices]);
                          setInvoiceCursor(r.nextCursor);
                        })
                        .catch(() => setError("Could not load more invoices."))
                    }
                  >
                    More invoices
                  </button>
                ) : null}
                {invoice ? (
                  <p>
                    Original charge {formatInrMinor(invoice.totalMinor)} · Credited{" "}
                    {formatInrMinor(invoice.creditedMinor)} · Collected{" "}
                    {formatInrMinor(invoice.paidMinor)} · Refunded{" "}
                    {formatInrMinor(invoice.refundedMinor)} · Due{" "}
                    {formatInrMinor(invoice.balanceMinor)}
                  </p>
                ) : null}
              </>
            ) : null}
            {needsTarget ? (
              <label>
                Original financial evidence
                <select
                  value={target}
                  onChange={(e) => {
                    setTarget(e.target.value);
                    setApproved(false);
                  }}
                >
                  <option value="">Choose evidence</option>
                  {targets.map((t) => (
                    <option key={String(t.id)} value={String(t.id)}>
                      {String(t.reference ?? t.description ?? t.method ?? t.kind)} ·{" "}
                      {formatInrMinor(t.availableMinor ?? t.totalMinor ?? t.amountMinor)} ·{" "}
                      {String(t.createdAt ?? t.receivedAt ?? "")}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {!noAmount ? (
              <label>
                Financial amount in INR
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setApproved(false);
                  }}
                  required
                />
              </label>
            ) : (
              <p>
                The original saved amount is used. Invoice credits cover a complete selected line,
                including its original tax; arbitrary tax changes are not supported.
              </p>
            )}
            {["expense", "advance_received", "payment_refund", "advance_returned"].includes(
              kind
            ) ? (
              <label>
                Financial payment method
                <select
                  value={method}
                  onChange={(e) => {
                    setMethod(e.target.value);
                    setApproved(false);
                  }}
                >
                  {["cash", "upi", "card", "bank_transfer", "cheque", "other"].map((m) => (
                    <option key={m} value={m}>
                      {m.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <label>
              Financial reference
              <input
                value={reference}
                maxLength={160}
                onChange={(e) => {
                  setReference(e.target.value);
                  setApproved(false);
                }}
                required
              />
            </label>
            <label>
              Financial reason
              <textarea
                value={reason}
                maxLength={1000}
                onChange={(e) => {
                  setReason(e.target.value);
                  setApproved(false);
                }}
                required
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={approved}
                onChange={(e) => setApproved(e.target.checked)}
              />
              I reviewed the account, original evidence and actual money movement.
            </label>
            <button
              disabled={!approved || (!isExpense && !account) || (needsInvoice && !invoice)}
              type="submit"
            >
              Save financial evidence
            </button>
          </fieldset>
        </form>
      ) : (
        <p>Financial recording is unavailable for this role.</p>
      )}
      {account ? (
        <>
          <h3>Adjustment and advance history</h3>
          <Evidence rows={valueList(account.entries).map(record)} />
          {account.nextCursor ? (
            <button disabled={props.locked} onClick={() => void moreEntries()}>
              More financial history
            </button>
          ) : null}
        </>
      ) : null}
      {reports ? (
        <>
          <h3>Daily reconciliation</h3>
          <label>
            Financial clinic date
            <input
              type="date"
              value={date}
              disabled={props.locked}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          {day ? (
            <>
              <p>
                Clinic timezone: {String(day.timezone)}. Original invoiced charges:{" "}
                {formatInrMinor(record(day.totals).invoicedMinor)}. Movements are recorded on the
                action date; corrections remain visible separately.
              </p>
              <ul>
                {valueList(day.movements)
                  .map(record)
                  .map((m, i) => (
                    <li key={i}>
                      {String(m.kind).replaceAll("_", " ")} · {String(m.method)}:{" "}
                      {formatInrMinor(m.amountMinor)} ({String(m.count)} records)
                    </li>
                  ))}
              </ul>
              <h4>Current outstanding invoices</h4>
              <ul>
                {valueList(day.dues)
                  .map(record)
                  .map((d) => (
                    <li key={String(d.id)}>
                      {String(d.fullName)} · {String(d.invoiceNumber)} ·{" "}
                      {formatInrMinor(d.balanceMinor)} due
                    </li>
                  ))}
              </ul>
              {day.nextDueCursor ? (
                <button disabled={props.locked} onClick={() => void moreDay("dues")}>
                  More outstanding invoices
                </button>
              ) : null}
              <h4>Day adjustment evidence</h4>
              <Evidence rows={valueList(day.entries).map(record)} />
              {day.nextEntryCursor ? (
                <button disabled={props.locked} onClick={() => void moreDay("entries")}>
                  More day adjustments
                </button>
              ) : null}
            </>
          ) : (
            <p>Loading daily reconciliation…</p>
          )}
        </>
      ) : null}
    </section>
  );
}
function Evidence({ rows }: { rows: PublicJsonObject[] }) {
  return rows.length ? (
    <ul>
      {rows.map((e) => (
        <li key={String(e.id)}>
          <strong>{String(e.kind).replaceAll("_", " ")}</strong> · {formatInrMinor(e.amountMinor)} ·{" "}
          {String(e.reference)} · {String(e.occurredAt)} · {String(e.reason)}{" "}
          <button
            type="button"
            onClick={() =>
              printClinicalDocument("Financial evidence", [
                `Evidence ${String(e.id)}`,
                `Patient account ${String(e.patientId ?? "clinic expense")}`,
                `Invoice ${String(e.invoiceId ?? "not applicable")}`,
                String(e.reference),
                String(e.kind).replaceAll("_", " "),
                formatInrMinor(e.amountMinor),
                String(e.method),
                String(e.reason),
                String(e.occurredAt),
                "Manual evidence — does not verify provider settlement."
              ])
            }
          >
            Print evidence
          </button>
        </li>
      ))}
    </ul>
  ) : (
    <p>No adjustment or advance evidence in this page.</p>
  );
}
