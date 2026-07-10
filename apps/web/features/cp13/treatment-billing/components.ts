import { createElement as h } from "react";
import type { TreatmentBillingPublicRecord, TreatmentBillingWorkspaceState } from "./loaders";

export interface TreatmentBillingWorkspaceProps {
  readonly state: TreatmentBillingWorkspaceState;
  readonly instructionRequest?: TreatmentBillingPublicRecord | null;
}

export function TreatmentBillingWorkspace({
  state,
  instructionRequest = null
}: TreatmentBillingWorkspaceProps) {
  if (state.status !== "ready") {
    return h(
      "section",
      {
        "aria-live": "polite",
        "data-state": state.status,
        "data-testid": "cp13-treatment-billing-state"
      },
      h("h2", null, "Treatment and billing"),
      h("p", null, state.message),
      state.requestId ? h("p", null, `Support reference: ${state.requestId}`) : null
    );
  }

  return h(
    "section",
    { "data-state": "ready", "data-testid": "cp13-treatment-billing-workspace" },
    h(
      "header",
      null,
      h("p", null, "Clinic source of truth"),
      h("h2", null, "Treatment and billing"),
      h(
        "p",
        null,
        "Estimates use server pricebook amounts. Invoices are created only from completed procedure evidence, and provider payment remains unconfirmed until a signed event is reconciled."
      )
    ),
    h(PricebookSummary, { procedures: state.procedures }),
    state.invoice
      ? h(InvoiceSummary, { invoice: state.invoice })
      : h(
          "p",
          { "data-testid": "cp13-no-invoice" },
          "No invoice selected. Invoice creation remains gated by accepted-plan and completed-procedure evidence."
        ),
    instructionRequest ? h(InstructionRequestSummary, { instruction: instructionRequest }) : null,
    h("p", null, `Loaded from the live generated client at ${state.loadedAt}.`)
  );
}

export function PricebookSummary({
  procedures
}: {
  readonly procedures: readonly TreatmentBillingPublicRecord[];
}) {
  return h(
    "section",
    { "aria-labelledby": "cp13-pricebook-heading" },
    h("h3", { id: "cp13-pricebook-heading" }, "Active pricebook"),
    procedures.length === 0
      ? h("p", null, "No active procedures are configured for this clinic.")
      : h(
          "ul",
          null,
          ...procedures.map((procedure, index) => {
            const id = stringField(procedure, "id") ?? `procedure-${index}`;
            const name = stringField(procedure, "displayName") ?? "Unnamed procedure";
            const amount = numberField(procedure, "defaultUnitPriceMinor");
            const currency = stringField(procedure, "currency") ?? "INR";
            return h(
              "li",
              { key: id },
              h("span", null, name),
              " ",
              h(
                "strong",
                null,
                amount === null ? "Price unavailable" : formatMinor(amount, currency)
              )
            );
          })
        )
  );
}

export function InvoiceSummary({ invoice }: { readonly invoice: TreatmentBillingPublicRecord }) {
  const invoiceNumber = stringField(invoice, "invoiceNumber") ?? "Invoice";
  const paymentStatus = stringField(invoice, "paymentStatus") ?? "unavailable";
  const currency = stringField(invoice, "currency") ?? "INR";
  const totalMinor = numberField(invoice, "totalMinor");
  const paidMinor = numberField(invoice, "paidMinor");
  const balanceMinor = numberField(invoice, "balanceMinor");

  return h(
    "section",
    { "aria-labelledby": "cp13-invoice-heading", "data-testid": "cp13-invoice-summary" },
    h("h3", { id: "cp13-invoice-heading" }, invoiceNumber),
    h(
      "dl",
      null,
      definition("Total", formatOptionalMinor(totalMinor, currency)),
      definition("Paid from verified or manual evidence", formatOptionalMinor(paidMinor, currency)),
      definition("Balance", formatOptionalMinor(balanceMinor, currency)),
      definition("Payment state", humanize(paymentStatus))
    ),
    paymentStatus === "reconciliation_required" || paymentStatus === "overpaid"
      ? h(
          "p",
          { role: "status" },
          "Payment evidence requires accountant reconciliation. No excess amount has been silently applied as settlement."
        )
      : null
  );
}

export function InstructionRequestSummary({
  instruction
}: {
  readonly instruction: TreatmentBillingPublicRecord;
}) {
  const channel = stringField(instruction, "channel") ?? "unknown";
  const status = stringField(instruction, "status") ?? "unavailable";
  const message =
    channel === "whatsapp" && status === "send_requested"
      ? "WhatsApp send requested. Provider delivery and patient read are not confirmed."
      : status === "ready_for_print"
        ? "Instruction is ready for clinic printing. Printing is not patient delivery evidence."
        : "Instruction state is unavailable; no delivery claim is shown.";
  return h(
    "section",
    {
      "aria-labelledby": "cp13-instruction-heading",
      "data-testid": "cp13-instruction-request"
    },
    h("h3", { id: "cp13-instruction-heading" }, "Patient instructions"),
    h("p", null, message)
  );
}

function definition(term: string, detail: string) {
  return h("div", { key: term }, h("dt", null, term), h("dd", null, detail));
}

function stringField(value: TreatmentBillingPublicRecord, key: string): string | null {
  const field = value[key];
  return typeof field === "string" ? field : null;
}

function numberField(value: TreatmentBillingPublicRecord, key: string): number | null {
  const field = value[key];
  return typeof field === "number" && Number.isSafeInteger(field) ? field : null;
}

function formatOptionalMinor(value: number | null, currency: string): string {
  return value === null ? "Unavailable" : formatMinor(value, currency);
}

function formatMinor(value: number, currency: string): string {
  if (!Number.isSafeInteger(value)) return "Unavailable";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2
  }).format(value / 100);
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}
