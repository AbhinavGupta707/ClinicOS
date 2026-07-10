import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { BILLING_OPERATIONS } from "../src/modules/billing/index.ts";
import { DENTAL_TREATMENT_OPERATIONS } from "../src/modules/dental-treatment/index.ts";

const proposal = readFileSync(
  resolve(import.meta.dirname, "../schema-proposals/cp13/treatment-billing.sql"),
  "utf8"
);

test("CP13 treatment billing uses the frozen transaction-bound repository operations", () => {
  for (const operation of [
    "listPricebookProcedures",
    "findInvoiceById",
    "createInvoice",
    "createPaymentRequest",
    "recordPaymentTransaction",
    "createReceipt"
  ]) {
    assert.ok(BILLING_OPERATIONS.includes(operation as never), operation);
  }
  for (const operation of [
    "createTreatmentPlan",
    "updateTreatmentPlan",
    "acceptTreatmentPlan",
    "createProcedurePerformed",
    "listCompletedProceduresForInvoice"
  ]) {
    assert.ok(DENTAL_TREATMENT_OPERATIONS.includes(operation as never), operation);
  }
});

test("CP13 provider proposal is tenant-scoped, replay-safe, leased, and reconciliation-explicit", () => {
  assert.match(proposal, /create table if not exists payment_provider_events/u);
  assert.match(proposal, /unique \(tenant_id, provider_account_key, provider_event_id\)/u);
  assert.match(proposal, /lease_expires_at timestamptz not null/u);
  assert.match(
    proposal,
    /verification_status text not null check \(verification_status = 'verified'\)/u
  );
  assert.match(proposal, /create table if not exists payment_reconciliation_items/u);
  assert.match(
    proposal,
    /captured_amount_minor = applied_amount_minor \+ unallocated_amount_minor/u
  );
  assert.match(proposal, /alter table payment_provider_events force row level security/u);
  assert.match(proposal, /alter table payment_reconciliation_items force row level security/u);
  assert.doesNotMatch(proposal, /provider_secret|api_key|signature_header/iu);
});
