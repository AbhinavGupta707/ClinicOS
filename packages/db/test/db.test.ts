import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildSetLocalRlsStatements } from "../src/index.ts";

const migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0001_identity_auth_audit_phi.sql"),
  "utf8"
);
const checkpoint2Migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0002_lead_patient_appointment_day_start.sql"),
  "utf8"
);
const checkpoint1Seed = readFileSync(
  resolve(import.meta.dirname, "../seeds/checkpoint1_identity_auth.sql"),
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

test("checkpoint 2 migration includes lead patient appointment and dashboard tables", () => {
  for (const table of [
    "patient_contacts",
    "patient_merge_candidates",
    "patient_timeline_items",
    "leads",
    "attribution_touches",
    "appointment_types",
    "provider_schedules",
    "chairs_or_rooms",
    "appointments",
    "appointment_status_history",
    "queue_entries",
    "tasks",
    "outbox_events"
  ]) {
    assert.match(checkpoint2Migration, new RegExp(`create table if not exists ${table}`, "i"));
  }
});

test("checkpoint 2 migration enforces RLS and tenant-clinic scope on operational tables", () => {
  for (const table of [
    "patient_contacts",
    "leads",
    "appointments",
    "queue_entries",
    "tasks",
    "attribution_touches",
    "outbox_events"
  ]) {
    assert.match(checkpoint2Migration, new RegExp(`alter table ${table} enable row level security`, "i"));
    assert.match(checkpoint2Migration, new RegExp(`${table}_tenant_clinic_isolation`, "i"));
  }

  assert.match(checkpoint2Migration, /foreign key \(tenant_id, clinic_id\) references clinics\(tenant_id, id\)/i);
  assert.match(checkpoint2Migration, /foreign key \(tenant_id, patient_id\) references patients\(tenant_id, id\)/i);
});

test("checkpoint 2 migration protects appointment provider and chair conflicts at the database layer", () => {
  assert.match(checkpoint2Migration, /create extension if not exists btree_gist/i);
  assert.match(checkpoint2Migration, /appointments_provider_no_overlap exclude using gist/i);
  assert.match(checkpoint2Migration, /appointments_chair_no_overlap exclude using gist/i);
  assert.match(checkpoint2Migration, /status in \('requested', 'booked', 'confirmed', 'checked_in', 'in_consult'\)/i);
});

test("identity seed keeps prescription draft and sign permissions separated for CP3 roles", () => {
  assert.match(checkpoint1Seed, /\('prescription\.write', 'Write prescriptions'/i);
  assert.match(checkpoint1Seed, /\('assistant', 'prescription\.write'\)/i);
  assert.doesNotMatch(checkpoint1Seed, /\('assistant', 'prescription\.sign'\)/i);
  assert.match(checkpoint1Seed, /\('doctor', 'prescription\.write'\)/i);
  assert.match(checkpoint1Seed, /\('doctor', 'prescription\.sign'\)/i);
  assert.doesNotMatch(checkpoint1Seed, /\('accountant', 'prescription\.write'\)/i);
  assert.doesNotMatch(checkpoint1Seed, /\('auditor', 'prescription\.write'\)/i);
});
