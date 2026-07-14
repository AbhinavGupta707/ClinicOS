import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LATEST_DATABASE_SCHEMA_VERSION } from "../src/schema.ts";

const migration = readFileSync(
  new URL("../migrations/0022_cp16_ai_fhir_durability.sql", import.meta.url),
  "utf8"
);

test("CP16 schema adds provider-neutral exchange consent and least-privilege permissions", () => {
  assert.equal(LATEST_DATABASE_SCHEMA_VERSION, "022");
  assert.match(migration, /'clinical_data_exchange'/u);
  assert.match(migration, /'interoperability\.fhir_r4\.export'/u);
  assert.match(migration, /'interoperability\.fhir_r4\.import'/u);
  assert.match(migration, /'interoperability\.fhir_r4\.reconcile'/u);
  assert.doesNotMatch(migration, /\('assistant', 'interoperability\./u);
  assert.doesNotMatch(migration, /\('receptionist', 'interoperability\./u);
});

test("CP16 AI persistence is attributable, encrypted, idempotent and forced-RLS", () => {
  for (const table of ["cp16_ai_invocations", "cp16_ai_usage_reservations"]) {
    assert.match(migration, new RegExp(`create table ${table}`, "u"));
    assert.match(migration, new RegExp(`alter table ${table} force row level security`, "u"));
  }
  assert.match(migration, /actor_user_id uuid not null references users/u);
  assert.match(migration, /unique \(tenant_id, clinic_id, provider_call_idempotency_digest\)/u);
  assert.match(migration, /result_ciphertext bytea/u);
  assert.match(migration, /result_encryption_algorithm = 'AES-256-GCM'/u);
  assert.match(migration, /provider_succeeded_persistence_uncertain/u);
  assert.match(migration, /application_policy_snapshot_digest/u);
  assert.doesNotMatch(migration, /api_key\s+text/u);
  assert.doesNotMatch(migration, /source_text\s+text/u);
});

test("CP16 FHIR persistence quarantines imports and never grants destructive runtime access", () => {
  for (const table of [
    "cp16_fhir_exports",
    "cp16_fhir_import_reconciliations",
    "cp16_fhir_exchange_failures"
  ]) {
    assert.match(migration, new RegExp(`create table ${table}`, "u"));
    assert.match(migration, new RegExp(`alter table ${table} force row level security`, "u"));
  }
  assert.match(migration, /'pending_review', 'quarantined', 'accepted_pending_apply'/u);
  assert.match(migration, /expected_patient_version bigint not null/u);
  assert.match(migration, /row_version bigint not null default 1/u);
  assert.match(migration, /bundle_ciphertext bytea/u);
  assert.match(migration, /minimized_ciphertext bytea/u);
  assert.match(migration, /num_nonnulls\(patient_id, reconciliation_id\) = 1/u);
  assert.match(migration, /revoke delete, truncate on table/u);
  assert.match(migration, /revoke update on table cp16_fhir_exchange_failures/u);
  assert.doesNotMatch(migration, /merge_patient|create_patient|relink_patient/u);
});
