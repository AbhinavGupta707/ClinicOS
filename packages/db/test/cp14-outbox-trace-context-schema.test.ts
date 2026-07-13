import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { LATEST_DATABASE_SCHEMA_VERSION } from "../src/schema.ts";

const migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0019_cp14_outbox_trace_context.sql"),
  "utf8"
);

test("CP14 outbox correlation is the current canonical schema version", () => {
  assert.equal(LATEST_DATABASE_SCHEMA_VERSION, "020");
  assert.match(migration, /create table outbox_trace_contexts \(/u);
  assert.match(migration, /traceparent char\(55\)/u);
  assert.doesNotMatch(migration, /alter table outbox_events\s+add column/u);
});

test("CP14 captures trace context atomically without changing clinical payloads", () => {
  assert.match(migration, /after insert on outbox_events/u);
  assert.match(migration, /current_setting\('app\.traceparent', true\)/u);
  assert.match(migration, /security definer/u);
  assert.match(migration, /outbox_trace_contexts_immutable/u);
  assert.doesNotMatch(migration, /new\.payload|payload\s*,\s*traceparent/u);
});

test("CP14 trace context remains tenant-isolated and worker read-only", () => {
  assert.match(migration, /alter table outbox_trace_contexts force row level security/u);
  assert.match(migration, /outbox_trace_contexts_tenant_clinic_isolation/u);
  assert.match(migration, /outbox_trace_contexts_worker_read/u);
  assert.match(migration, /grant select on table outbox_trace_contexts to clinic_os_worker/u);
  assert.match(migration, /revoke all on table outbox_trace_contexts from clinic_os_runtime/u);
});
