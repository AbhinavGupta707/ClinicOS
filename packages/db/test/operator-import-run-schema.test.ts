import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../migrations/0027_operator_import_runs.sql", import.meta.url), "utf8"
);

test("operator import run schema scopes immutable run identity and one step per type", () => {
  assert.match(migration, /primary key \(tenant_id, clinic_id, id\)/u);
  assert.match(migration, /migration_batches_run_fk[\s\S]*foreign key \(tenant_id, clinic_id, import_run_id\)/u);
  assert.match(migration, /migration_batches_one_step_per_run_idx[\s\S]*\(tenant_id, clinic_id, import_run_id, import_type\)/u);
  assert.match(migration, /import_step_digest ~ '\^\[0-9a-f\]\{64\}\$'/u);
  assert.match(migration, /alter table import_runs force row level security/u);
  assert.match(migration, /clinic_os\.current_tenant_id\(\).*clinic_os\.current_clinic_id\(\)/u);
});
