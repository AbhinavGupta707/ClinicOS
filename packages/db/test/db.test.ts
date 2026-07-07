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
const checkpoint3Migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0003_intake_consent_encounter_clinical.sql"),
  "utf8"
);
const checkpoint5Migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0005_treatment_checkout_billing.sql"),
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

test("checkpoint 3 migration includes intake consent encounter note and prescription tables", () => {
  for (const table of [
    "form_templates",
    "form_responses",
    "consents",
    "encounters",
    "encounter_status_history",
    "clinical_note_versions",
    "prescriptions"
  ]) {
    assert.match(checkpoint3Migration, new RegExp(`create table if not exists ${table}`, "i"));
  }

  assert.match(checkpoint3Migration, /form_response_submitted/i);
  assert.match(checkpoint3Migration, /consent_revoked/i);
  assert.match(checkpoint3Migration, /clinical_note_signed/i);
});

test("checkpoint 3 migration enforces RLS and signed clinical artifact immutability", () => {
  for (const table of [
    "form_templates",
    "form_responses",
    "consents",
    "encounters",
    "clinical_note_versions",
    "prescriptions"
  ]) {
    assert.match(checkpoint3Migration, new RegExp(`alter table ${table} enable row level security`, "i"));
    assert.match(checkpoint3Migration, new RegExp(`${table}_tenant_clinic_isolation`, "i"));
  }

  assert.match(checkpoint3Migration, /prevent_signed_clinical_note_mutation/i);
  assert.match(checkpoint3Migration, /signed clinical note versions are immutable/i);
  assert.match(checkpoint3Migration, /prevent_signed_prescription_mutation/i);
  assert.match(checkpoint3Migration, /signed prescriptions are immutable/i);
  assert.match(checkpoint3Migration, /consents_active_purpose_unique_idx/i);
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

test("checkpoint 5 migration includes billing catalog plan invoice payment and receipt tables", () => {
  for (const table of [
    "pricebook_procedures",
    "treatment_plans",
    "treatment_plan_phases",
    "treatment_plan_estimate_items",
    "procedure_performed_records",
    "invoices",
    "invoice_items",
    "payment_requests",
    "payment_transactions",
    "receipts",
    "patient_instruction_requests"
  ]) {
    assert.match(checkpoint5Migration, new RegExp(`create table if not exists ${table}`, "i"));
  }

  for (const itemType of [
    "treatment_plan_created",
    "treatment_plan_accepted",
    "procedure_completed",
    "invoice_created",
    "payment_recorded",
    "receipt_generated",
    "instruction_print_requested",
    "instruction_send_requested"
  ]) {
    assert.match(checkpoint5Migration, new RegExp(`'${itemType}'`, "i"));
  }
});

test("checkpoint 5 migration enforces RLS and tenant-clinic scope on billing tables", () => {
  for (const table of [
    "pricebook_procedures",
    "treatment_plans",
    "treatment_plan_phases",
    "treatment_plan_estimate_items",
    "procedure_performed_records",
    "invoices",
    "invoice_items",
    "payment_requests",
    "payment_transactions",
    "receipts",
    "patient_instruction_requests"
  ]) {
    assert.match(checkpoint5Migration, new RegExp(`alter table ${table} enable row level security`, "i"));
    assert.match(checkpoint5Migration, new RegExp(`alter table ${table} force row level security`, "i"));
    assert.match(checkpoint5Migration, new RegExp(`${table}_tenant_clinic_isolation`, "i"));
  }

  assert.match(checkpoint5Migration, /foreign key \(tenant_id, clinic_id\) references clinics\(tenant_id, id\)/i);
});

test("checkpoint 5 migration derives invoices from completed procedure evidence", () => {
  assert.match(checkpoint5Migration, /create table if not exists procedure_performed_records/i);
  assert.match(checkpoint5Migration, /procedure_performed_records_completed_item_unique_idx/i);
  assert.match(checkpoint5Migration, /status = 'completed'/i);
  assert.match(checkpoint5Migration, /create table if not exists invoice_items/i);
  assert.match(checkpoint5Migration, /unique \(tenant_id, procedure_performed_id\)/i);
  assert.match(checkpoint5Migration, /foreign key \(tenant_id, procedure_performed_id\) references procedure_performed_records/i);
  assert.match(checkpoint5Migration, /invoice lines derived from performed procedure records/i);
});

test("checkpoint 5 migration requires verified payment evidence before receipts", () => {
  assert.match(checkpoint5Migration, /payment_transactions_verified_success_check/i);
  assert.match(
    checkpoint5Migration,
    /status = 'succeeded' and verification_status = 'verified'/i
  );
  assert.match(
    checkpoint5Migration,
    /status = 'manually_recorded' and verification_status = 'not_required_manual'/i
  );
  assert.match(checkpoint5Migration, /payment_transactions_idempotency_unique_idx/i);
  assert.match(checkpoint5Migration, /foreign key \(tenant_id, receipt_id\) references receipts/i);
});

test("checkpoint 5 migration records patient instructions without fake delivery confirmation", () => {
  assert.match(checkpoint5Migration, /create table if not exists patient_instruction_requests/i);
  assert.match(checkpoint5Migration, /patient_instruction_requests_no_fake_delivery_check/i);
  assert.match(checkpoint5Migration, /provider_confirmation_received = false/i);
  assert.match(checkpoint5Migration, /delivered_at is null/i);
  assert.match(checkpoint5Migration, /read_at is null/i);
  assert.match(checkpoint5Migration, /\('patient_instruction\.write', 'Write patient instructions'/i);
  assert.match(checkpoint5Migration, /\('receptionist', 'patient_instruction\.write'\)/i);
  assert.doesNotMatch(checkpoint5Migration, /\('accountant', 'patient_instruction\.write'\)/i);
});

test("checkpoint 5 grants accountants billing access without clinical chart permissions", () => {
  assert.match(checkpoint5Migration, /\('accountant', 'billing\.read'\)/i);
  assert.match(checkpoint5Migration, /\('accountant', 'billing\.write'\)/i);
  assert.match(checkpoint5Migration, /\('accountant', 'billing\.export'\)/i);
  assert.doesNotMatch(checkpoint1Seed, /\('accountant', 'dental\.chart\.write'\)/i);
  assert.doesNotMatch(checkpoint1Seed, /\('accountant', 'clinical\.note\.write'\)/i);
});
