import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(
  new URL("../../db/schema-proposals/cp15/meta-whatsapp.sql", import.meta.url),
  "utf8"
);

test("CP15 Meta schema reuses canonical raw event, audit, and outbox seams atomically", () => {
  assert.match(schema, /references raw_webhook_events\(tenant_id, id\)/u);
  assert.match(schema, /audit_event_id uuid not null unique references audit_events\(id\)/u);
  assert.match(schema, /outbox_event_id uuid not null unique references outbox_events\(id\)/u);
  assert.match(schema, /raw_webhook_events_meta_pointer_only/u);
  assert.match(schema, /provider_webhook_restricted/u);
});

test("CP15 Meta schema enforces provider event uniqueness and monotonic state", () => {
  assert.match(schema, /unique \(tenant_id, external_account_id, unique_event_key\)/u);
  assert.match(schema, /enforce_meta_whatsapp_monotonic_state/u);
  assert.match(schema, /Meta terminal message state cannot transition/u);
  assert.match(schema, /Meta delivered message state cannot regress or fail/u);
  assert.match(schema, /signed delivered timestamp is immutable/u);
});

test("CP15 Meta schema prevents ambiguous sends from automatic retry or invented delivery", () => {
  assert.match(
    schema,
    /dispatch_outcome = 'dispatch_ambiguous' and not automatic_retry_allowed and reconciliation_required/u
  );
  assert.match(schema, /Synchronous API acceptance never populates signed sent\/delivered\/read timestamps/u);
  assert.match(schema, /reason in \('dispatch_ambiguous', 'unknown_status', 'conflicting_terminal_status', 'webhook_gap', 'unsupported_change'\)/u);
});

test("CP15 Meta schema tenant-isolates every additive table and treats opt-in as review", () => {
  for (const table of [
    "meta_whatsapp_registrations",
    "meta_whatsapp_webhook_commits",
    "meta_whatsapp_event_receipts",
    "meta_whatsapp_outbound_messages",
    "meta_whatsapp_service_windows",
    "meta_whatsapp_consent_commands",
    "meta_whatsapp_template_snapshots",
    "meta_whatsapp_reconciliation_jobs"
  ]) {
    assert.match(schema, new RegExp(`alter table ${table} force row level security`, "u"));
  }
  assert.match(schema, /command = 'opt_in_request' and outcome = 'manual_review_required'/u);
  assert.match(schema, /foreign key \(tenant_id, consent_evidence_id\) references consents\(tenant_id, id\)/u);
});
