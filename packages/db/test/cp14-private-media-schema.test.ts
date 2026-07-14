import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { LATEST_DATABASE_SCHEMA_VERSION } from "../src/schema.ts";

const migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0018_cp14_private_media.sql"),
  "utf8"
);
const localLifecycle = readFileSync(
  resolve(import.meta.dirname, "../../../scripts/db-local-lifecycle.mjs"),
  "utf8"
);

test("CP14 private-media migration remains present in the current canonical schema", () => {
  assert.equal(LATEST_DATABASE_SCHEMA_VERSION, "022");
  assert.match(migration, /migration blocked by an incomplete S3 reservation/u);
  assert.match(migration, /media_uploads_s3_private_binding_check/u);
  assert.match(migration, /media_uploads_private_binding_uq/u);
});

test("CP14 private-media state, evidence, and operations use forced tenant RLS", () => {
  for (const table of [
    "private_media_records",
    "private_media_scan_evidence",
    "private_media_operations"
  ]) {
    assert.match(migration, new RegExp(`create table ${table} \\(`, "u"));
    assert.match(migration, new RegExp(`alter table ${table} force row level security`, "u"));
    assert.match(migration, new RegExp(`create policy ${table}_scope on ${table}`, "u"));
  }
  assert.match(
    migration,
    /primary key \(tenant_id, clinic_id, evidence_id\)/u,
    "evidence identifiers must not be globally conflicting across tenants"
  );
});

test("CP14 media effects reuse canonical audit and outbox history atomically", () => {
  assert.match(migration, /audit_event_uuid uuid not null unique references audit_events\(id\)/u);
  assert.match(migration, /outbox_event_uuid uuid not null unique references outbox_events\(id\)/u);
  assert.doesNotMatch(migration, /create table private_media_(?:audit|outbox|reconciliation)/u);
  assert.match(migration, /private_media_operations_immutable/u);
  assert.match(migration, /private_media_scan_evidence_immutable/u);
});

test("CP14 runtime and generic worker privileges preserve append-only media history", () => {
  assert.match(
    migration,
    /revoke update, delete, truncate on table private_media_scan_evidence, private_media_operations from clinic_os_runtime/u
  );
  assert.match(
    localLifecycle,
    /revoke update, delete, truncate on table private_media_scan_evidence, private_media_operations from clinic_os_runtime/u
  );
  assert.match(
    localLifecycle,
    /revoke all on table private_media_records, private_media_scan_evidence, private_media_operations from clinic_os_worker/u
  );
});
