import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const continuityMigration = readFileSync(
  new URL("../migrations/0006_continuity_tasks_recalls_sops.sql", import.meta.url),
  "utf8"
);
const clinicDayMigration = readFileSync(
  new URL("../migrations/0002_lead_patient_appointment_day_start.sql", import.meta.url),
  "utf8"
);
const operationsMigration = readFileSync(
  new URL("../migrations/0007_lab_inventory_events.sql", import.meta.url),
  "utf8"
);
const postgresAdapter = readFileSync(new URL("../src/postgres.ts", import.meta.url), "utf8");

test("CP13 continuity schema keeps due generation restart-safe and tenant scoped", () => {
  assert.match(continuityMigration, /idempotency_key\s+text/i);
  assert.match(
    continuityMigration,
    /create unique index[^;]+on tasks\(tenant_id, clinic_id, idempotency_key\)[^;]+where idempotency_key is not null/is
  );
  assert.match(continuityMigration, /generated_from_key\s+text\s+not\s+null/i);
  assert.match(continuityMigration, /unique\s*\(tenant_id,\s*clinic_id,\s*generated_from_key\)/i);
  for (const table of ["tasks", "recalls", "sop_runs", "sop_run_items"]) {
    const source = table === "tasks" ? clinicDayMigration : continuityMigration;
    assert.match(source, new RegExp(`alter table ${table} enable row level security`, "i"));
    assert.match(source, new RegExp(`alter table ${table} force row level security`, "i"));
  }
});

test("CP13 operations schema preserves append-only stock and lab status evidence", () => {
  assert.match(operationsMigration, /prevent_cp6_evidence_mutation/i);
  assert.match(operationsMigration, /stock_ledger_entries.*append-only/is);
  assert.match(operationsMigration, /lab_case_status_history.*append-only/is);
  assert.match(operationsMigration, /lab_reconciliations.*does not execute accounting payment/is);
  assert.match(operationsMigration, /procurement_suggestions.*does not execute purchase orders/is);
});

test("CP13 operations tables force tenant and clinic RLS", () => {
  for (const table of [
    "lab_vendors",
    "lab_cases",
    "lab_reconciliations",
    "inventory_categories",
    "inventory_items",
    "stock_ledger_entries",
    "inventory_check_runs",
    "procurement_suggestions",
    "incidents",
    "corrective_actions"
  ]) {
    assert.match(
      operationsMigration,
      new RegExp(`alter table ${table} enable row level security`, "i")
    );
    assert.match(
      operationsMigration,
      new RegExp(`alter table ${table} force row level security`, "i")
    );
  }
});

test("CP13 Postgres adapters use conflict-safe generation and reconciliation writes", () => {
  const continuityGeneration = methodSource("generateDueContinuityTasks", "createSopTemplate");
  const sopGeneration = methodSource("#generateSopRunOccurrence", "#loadSopRunDetail");
  const reconciliation = methodSource("createLabReconciliation", "listInventoryCategories");
  assert.match(continuityGeneration, /on conflict.*do nothing/is);
  assert.match(sopGeneration, /on conflict.*do nothing/is);
  assert.match(reconciliation, /lab_reconciliation_entries/i);
  assert.match(reconciliation, /variance_amount_minor/i);
});

function methodSource(start: string, end: string): string {
  const from = postgresAdapter.indexOf(`async ${start}(`);
  const to = postgresAdapter.indexOf(`async ${end}(`, from + 1);
  assert.notEqual(from, -1, `${start} adapter missing`);
  assert.notEqual(to, -1, `${end} adapter boundary missing`);
  return postgresAdapter.slice(from, to);
}
