import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LATEST_DATABASE_SCHEMA_VERSION } from "../src/schema.ts";

const migration = readFileSync(
  new URL("../migrations/0020_cp15_official_provider_integrations.sql", import.meta.url),
  "utf8"
);

test("CP15 schema registers only secret references behind a forced-RLS callback resolver", () => {
  assert.equal(LATEST_DATABASE_SCHEMA_VERSION, "020");
  assert.match(migration, /create table provider_callback_registrations/u);
  assert.match(migration, /callback_key_digest char\(64\) not null unique/u);
  assert.match(migration, /security definer/u);
  assert.match(migration, /revoke all on function clinic_os\.resolve_provider_callback_registration/u);
  assert.match(migration, /provider_callback_registrations force row level security/u);
  assert.match(migration, /provider_callback_registrations_secret_refs_check/u);
  assert.match(migration, /arn:\(aws\|aws-cn\|aws-us-gov\):secretsmanager/u);
  assert.match(migration, /last_failure_code is null or last_failure_code ~ '\^\[a-z\]/u);
  assert.doesNotMatch(migration, /webhook_secret\s+text/u);
  assert.doesNotMatch(migration, /access_token\s+text/u);
});

test("CP15 durable provider tables preserve signed truth and reconciliation", () => {
  for (const table of [
    "meta_whatsapp_webhook_commits",
    "meta_whatsapp_event_receipts",
    "meta_whatsapp_outbound_messages",
    "meta_whatsapp_reconciliation_jobs",
    "razorpay_business_effects",
    "razorpay_reconciliation_jobs"
  ]) {
    assert.match(migration, new RegExp(`create table ${table}`, "u"));
    assert.match(migration, new RegExp(`alter table ${table} force row level security`, "u"));
  }
  assert.match(migration, /enforce_meta_whatsapp_monotonic_state/u);
  assert.match(migration, /verified_with_previous_secret/u);
  assert.match(migration, /verified_secret_version is null[\s\S]*raw_body_length is null/u);
  assert.match(migration, /safe_applied_amount_minor/u);
  assert.match(migration, /unallocated_amount_minor/u);
  assert.match(migration, /provider_request_reference text/u);
  assert.match(migration, /PAYMENT_PROVIDER_CREATION_OUTCOME_UNKNOWN|creation_outcome_unknown/u);
  assert.match(migration, /razorpay_reconciliation_jobs_subject_check/u);
});
