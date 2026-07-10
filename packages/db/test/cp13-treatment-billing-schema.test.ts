import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";
import { BILLING_OPERATIONS } from "../src/modules/billing/index.ts";
import { DENTAL_TREATMENT_OPERATIONS } from "../src/modules/dental-treatment/index.ts";
import { DURABLE_INTEGRITY_OPERATIONS } from "../src/modules/durable-integrity/index.ts";

const migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0017_cp13_durable_integrity.sql"),
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

test("CP13 canonical provider seam is account-scoped, replay-safe, and reconciliation-explicit", () => {
  assert.match(migration, /create table payment_provider_request_intents/u);
  assert.match(migration, /external_account_id uuid not null/u);
  assert.match(migration, /request_digest char\(64\) not null/u);
  assert.match(migration, /request_type text not null/u);
  assert.match(migration, /amount_minor bigint not null/u);
  assert.match(migration, /provider_safe_request jsonb not null/u);
  assert.match(migration, /lease_expires_at timestamptz/u);
  assert.match(
    migration,
    /raw_body_sha256 char\(64\)[\s\S]*signature_sha256 char\(64\)[\s\S]*normalized_event_sha256 char\(64\)/u
  );
  assert.match(migration, /create table payment_reconciliation_items/u);
  assert.match(
    migration,
    /captured_amount_minor = applied_amount_minor \+ unallocated_amount_minor/u
  );
  assert.match(migration, /alter table raw_webhook_events force row level security/u);
  assert.match(migration, /alter table payment_provider_request_intents force row level security/u);
  assert.match(migration, /alter table payment_reconciliation_items force row level security/u);
  for (const operation of [
    "findActivePaymentProviderAccount",
    "appendPaymentProviderIntegrationOutboxEvent",
    "claimPaymentRequestIntent",
    "finalizePaymentRequestIntent",
    "claimVerifiedPaymentProviderEvent",
    "createPaymentReconciliation",
    "completePaymentProviderEvent"
  ]) {
    assert.ok(DURABLE_INTEGRITY_OPERATIONS.includes(operation as never), operation);
  }
  assert.doesNotMatch(migration, /provider_account_key|provider_secret|api_key|signature_header/iu);
});
