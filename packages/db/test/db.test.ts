import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSetLocalRlsStatements } from "../src/index.ts";

const migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0001_identity_auth_audit_phi.sql"),
  "utf8"
);

test("migration enables RLS for first PHI and audit tables", () => {
  assert.match(migration, /alter table patients enable row level security/i);
  assert.match(migration, /alter table patients force row level security/i);
  assert.match(migration, /create policy patients_tenant_clinic_isolation/i);
  assert.match(migration, /alter table audit_events enable row level security/i);
});

test("migration includes core identity and authorization tables", () => {
  for (const table of [
    "tenants",
    "clinics",
    "users",
    "user_identities",
    "memberships",
    "roles",
    "permissions",
    "role_permissions",
    "user_role_assignments",
    "clinic_user_assignments",
    "break_glass_accesses",
    "audit_events",
    "patients"
  ]) {
    assert.match(migration, new RegExp(`create table if not exists ${table}`, "i"));
  }
});

test("migration enforces tenant-clinic consistency with composite foreign keys", () => {
  assert.match(migration, /foreign key \(tenant_id, clinic_id\) references clinics\(tenant_id, id\)/i);
  assert.match(migration, /foreign key \(tenant_id, role_id\) references roles\(tenant_id, id\)/i);
  assert.match(migration, /foreign key \(tenant_id, patient_id\)\s+references patients\(tenant_id, id\)/i);
  assert.match(migration, /user_role_assignments_tenant_wide_unique_idx/i);
});

test("RLS context statements use transaction-local settings", () => {
  const statements = buildSetLocalRlsStatements({
    tenantId: "10000000-0000-4000-8000-000000000001",
    clinicId: "10000000-0000-4000-8000-000000000101",
    userId: "10000000-0000-4000-8000-000000001003"
  });

  assert.equal(statements.length, 3);
  assert.ok(statements.every((statement) => statement.sql.includes("set_config")));
  assert.ok(statements.every((statement) => statement.sql.includes("true")));
});
