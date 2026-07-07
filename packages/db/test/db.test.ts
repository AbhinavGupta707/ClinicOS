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
const checkpoint6ContinuityMigration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0006_continuity_tasks_recalls_sops.sql"),
  "utf8"
);
const checkpoint6OperationsMigration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0007_lab_inventory_events.sql"),
  "utf8"
);
const checkpoint7Migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0008_live_integrations_migration_hardening.sql"),
  "utf8"
);
const checkpoint8Migration = readFileSync(
  resolve(import.meta.dirname, "../migrations/0009_mobile_capture_ai_scribe.sql"),
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

test("checkpoint 6 migration includes continuity task recall and SOP tables", () => {
  for (const table of [
    "recall_rules",
    "recalls",
    "sop_templates",
    "sop_template_items",
    "sop_schedules",
    "sop_runs",
    "sop_run_items"
  ]) {
    assert.match(checkpoint6ContinuityMigration, new RegExp(`create table if not exists ${table}`, "i"));
  }

  for (const column of [
    "source_workflow",
    "source_record_type",
    "completion_evidence",
    "idempotency_key",
    "procedure_performed_id"
  ]) {
    assert.match(checkpoint6ContinuityMigration, new RegExp(`add column if not exists ${column}`, "i"));
  }
});

test("checkpoint 6 migration enforces idempotent due generation and completion evidence", () => {
  assert.match(checkpoint6ContinuityMigration, /tasks_idempotency_unique_idx/i);
  assert.match(checkpoint6ContinuityMigration, /recalls_generated_procedure_unique_idx/i);
  assert.match(checkpoint6ContinuityMigration, /unique \(tenant_id, clinic_id, schedule_id, due_at\)/i);
  assert.match(checkpoint6ContinuityMigration, /unique \(tenant_id, clinic_id, generated_from_key\)/i);
  assert.match(checkpoint6ContinuityMigration, /tasks_completion_consistent_check/i);
  assert.match(checkpoint6ContinuityMigration, /sop_run_items_required_evidence_check/i);
  assert.doesNotMatch(checkpoint6ContinuityMigration, /provider_delivery_confirmed_at/i);
});

test("checkpoint 6 migration enforces RLS and tenant-clinic scope on continuity tables", () => {
  for (const table of [
    "recall_rules",
    "recalls",
    "sop_templates",
    "sop_template_items",
    "sop_schedules",
    "sop_runs",
    "sop_run_items"
  ]) {
    assert.match(checkpoint6ContinuityMigration, new RegExp(`alter table ${table} enable row level security`, "i"));
    assert.match(checkpoint6ContinuityMigration, new RegExp(`alter table ${table} force row level security`, "i"));
    assert.match(checkpoint6ContinuityMigration, new RegExp(`${table}_tenant_clinic_isolation`, "i"));
  }

  assert.match(checkpoint6ContinuityMigration, /foreign key \(tenant_id, clinic_id\) references clinics\(tenant_id, id\)/i);
  assert.match(checkpoint6ContinuityMigration, /foreign key \(tenant_id, patient_id\) references patients\(tenant_id, id\)/i);
});

test("checkpoint 6 grants operational continuity permissions without accountant PHI task access", () => {
  assert.match(checkpoint6ContinuityMigration, /\('assistant', 'recall\.manage'\)/i);
  assert.match(checkpoint6ContinuityMigration, /\('receptionist', 'task\.manage'\)/i);
  assert.match(checkpoint6ContinuityMigration, /\('receptionist', 'sop\.manage'\)/i);
  assert.match(checkpoint6ContinuityMigration, /\('task\.manage', 'Manage tasks'/i);
  assert.doesNotMatch(checkpoint6ContinuityMigration, /\('accountant', 'task\.manage'\)/i);
  assert.doesNotMatch(checkpoint6ContinuityMigration, /\('accountant', 'recall\.manage'\)/i);
  assert.doesNotMatch(checkpoint6ContinuityMigration, /\('accountant', 'sop\.manage'\)/i);
});

test("checkpoint 6 migration includes lab inventory incident and CAPA operational tables", () => {
  for (const table of [
    "lab_vendors",
    "lab_cases",
    "lab_case_items",
    "lab_case_status_history",
    "lab_reconciliations",
    "lab_reconciliation_entries",
    "inventory_categories",
    "inventory_items",
    "stock_ledger_entries",
    "inventory_check_templates",
    "inventory_check_template_lines",
    "inventory_check_runs",
    "inventory_check_run_lines",
    "procurement_suggestions",
    "incidents",
    "corrective_actions"
  ]) {
    assert.match(checkpoint6OperationsMigration, new RegExp(`create table if not exists ${table}`, "i"));
  }

  for (const itemType of [
    "lab_case_created",
    "lab_case_sent",
    "lab_case_returned",
    "lab_case_completed",
    "incident_created",
    "corrective_action_created",
    "corrective_action_completed"
  ]) {
    assert.match(checkpoint6OperationsMigration, new RegExp(`'${itemType}'`, "i"));
  }
});

test("checkpoint 6 migration enforces RLS and tenant-clinic scope on operations tables", () => {
  for (const table of [
    "lab_vendors",
    "lab_cases",
    "lab_case_items",
    "lab_case_status_history",
    "lab_reconciliations",
    "lab_reconciliation_entries",
    "inventory_categories",
    "inventory_items",
    "stock_ledger_entries",
    "inventory_check_templates",
    "inventory_check_template_lines",
    "inventory_check_runs",
    "inventory_check_run_lines",
    "procurement_suggestions",
    "incidents",
    "corrective_actions"
  ]) {
    assert.match(checkpoint6OperationsMigration, new RegExp(`alter table ${table} enable row level security`, "i"));
    assert.match(checkpoint6OperationsMigration, new RegExp(`alter table ${table} force row level security`, "i"));
    assert.match(checkpoint6OperationsMigration, new RegExp(`${table}_tenant_clinic_isolation`, "i"));
  }

  assert.match(checkpoint6OperationsMigration, /foreign key \(tenant_id, clinic_id\) references clinics\(tenant_id, id\)/i);
  assert.match(checkpoint6OperationsMigration, /foreign key \(tenant_id, patient_id\) references patients\(tenant_id, id\)/i);
});

test("checkpoint 6 migration keeps procurement as evidenced suggestions, not purchase execution", () => {
  assert.match(checkpoint6OperationsMigration, /create table if not exists procurement_suggestions/i);
  assert.match(checkpoint6OperationsMigration, /suggested_quantity numeric\(12, 2\) not null/i);
  assert.match(checkpoint6OperationsMigration, /task_id uuid/i);
  assert.match(checkpoint6OperationsMigration, /suggestion evidence only/i);
  assert.match(checkpoint6OperationsMigration, /does not execute purchase orders or vendor procurement/i);
  assert.doesNotMatch(checkpoint6OperationsMigration, /create table if not exists purchase_orders/i);
});

test("checkpoint 6 migration makes status and stock evidence append-only", () => {
  assert.match(checkpoint6OperationsMigration, /prevent_cp6_evidence_mutation/i);
  assert.match(checkpoint6OperationsMigration, /lab_case_status_history_immutable/i);
  assert.match(checkpoint6OperationsMigration, /stock_ledger_entries_immutable/i);
  assert.match(checkpoint6OperationsMigration, /before update or delete on lab_case_status_history/i);
  assert.match(checkpoint6OperationsMigration, /before update or delete on stock_ledger_entries/i);
});

test("checkpoint 6 grants operational roles without broadening accountant access", () => {
  for (const permission of [
    "incident.manage",
    "corrective_action.manage",
    "lab.manage",
    "inventory.manage"
  ]) {
    assert.match(checkpoint6OperationsMigration, new RegExp(`\\('${permission}'`, "i"));
  }

  assert.match(checkpoint6OperationsMigration, /\('receptionist', 'inventory\.manage'\)/i);
  assert.match(checkpoint6OperationsMigration, /\('assistant', 'incident\.manage'\)/i);
  assert.match(checkpoint6OperationsMigration, /\('doctor', 'corrective_action\.manage'\)/i);
  assert.doesNotMatch(checkpoint6OperationsMigration, /\('accountant', 'lab\.manage'\)/i);
  assert.doesNotMatch(checkpoint6OperationsMigration, /\('accountant', 'inventory\.manage'\)/i);
  assert.doesNotMatch(checkpoint6OperationsMigration, /\('accountant', 'incident\.manage'\)/i);
  assert.doesNotMatch(checkpoint6OperationsMigration, /\('accountant', 'corrective_action\.manage'\)/i);
});

test("checkpoint 7 migration includes migration review and imported record tables", () => {
  for (const table of [
    "migration_batches",
    "migration_rows",
    "migration_conflicts",
    "migration_commits",
    "imported_record_links"
  ]) {
    assert.match(checkpoint7Migration, new RegExp(`create table if not exists ${table}`, "i"));
  }

  for (const state of [
    "needs_review",
    "ready_to_commit",
    "partially_committed",
    "rolled_back",
    "imported_unverified"
  ]) {
    assert.match(checkpoint7Migration, new RegExp(`'${state}'`, "i"));
  }
});

test("checkpoint 7 migration separates bad rows, duplicate conflicts, idempotent commits, and no-overwrite links", () => {
  assert.match(checkpoint7Migration, /validation_errors jsonb not null default '\[\]'::jsonb/i);
  assert.match(checkpoint7Migration, /conflict_type in \('duplicate_patient'/i);
  assert.match(checkpoint7Migration, /migration_commits_idempotency_unique_idx/i);
  assert.match(checkpoint7Migration, /imported_record_links_external_unique_idx/i);
  assert.match(checkpoint7Migration, /Verified ClinicOS records are never silently overwritten/i);
  assert.match(checkpoint7Migration, /imported_unverified until reviewed/i);
});

test("checkpoint 7 migration includes provider event dead-letter persistence primitives", () => {
  for (const table of [
    "external_systems",
    "external_accounts",
    "external_provider_capabilities",
    "external_entity_links",
    "raw_webhook_events",
    "normalized_integration_events",
    "integration_health_checks",
    "integration_attempts",
    "integration_dead_letters"
  ]) {
    assert.match(checkpoint7Migration, new RegExp(`create table if not exists ${table}`, "i"));
  }

  assert.match(checkpoint7Migration, /raw_webhook_events_idempotency_unique_idx/i);
  assert.match(checkpoint7Migration, /raw payloads may contain PHI or provider secrets/i);
  assert.match(checkpoint7Migration, /must not be exposed in public API responses/i);
});

test("checkpoint 7 migration enforces RLS and tenant-clinic scope on migration and integration tables", () => {
  for (const table of [
    "migration_batches",
    "migration_rows",
    "migration_conflicts",
    "migration_commits",
    "imported_record_links",
    "raw_webhook_events",
    "normalized_integration_events",
    "integration_dead_letters"
  ]) {
    assert.match(checkpoint7Migration, new RegExp(`alter table ${table} enable row level security`, "i"));
    assert.match(checkpoint7Migration, new RegExp(`alter table ${table} force row level security`, "i"));
  }

  assert.match(checkpoint7Migration, /foreign key \(tenant_id, clinic_id\) references clinics\(tenant_id, id\)/i);
  assert.match(checkpoint7Migration, /migration_batches_tenant_clinic_isolation/i);
  assert.match(checkpoint7Migration, /raw_webhook_events_tenant_clinic_isolation/i);
});

test("checkpoint 7 grants migration management without accountant import access", () => {
  assert.match(checkpoint7Migration, /\('migration\.manage', 'Manage migrations'/i);
  assert.match(checkpoint7Migration, /\('owner_admin', 'migration\.manage'\)/i);
  assert.match(checkpoint7Migration, /\('assistant', 'migration\.manage'\)/i);
  assert.match(checkpoint7Migration, /\('receptionist', 'migration\.manage'\)/i);
  assert.doesNotMatch(checkpoint7Migration, /\('accountant', 'migration\.manage'\)/i);
  assert.doesNotMatch(checkpoint7Migration, /\('auditor', 'migration\.manage'\)/i);
});

test("checkpoint 8 migration includes consent-gated AI scribe persistence", () => {
  for (const table of [
    "ai_sessions",
    "ai_transcript_segments",
    "ai_source_anchors",
    "ai_jobs",
    "ai_draft_outputs",
    "ai_action_proposals",
    "ai_review_decisions"
  ]) {
    assert.match(checkpoint8Migration, new RegExp(`create table if not exists ${table}`, "i"));
  }

  assert.match(checkpoint8Migration, /provider_mode in \('simulator', 'unconfigured', 'live_disabled'\)/i);
  assert.match(checkpoint8Migration, /providerTrainingAllowed/i);
  assert.match(checkpoint8Migration, /providerRawPayloadStorage/i);
  assert.match(checkpoint8Migration, /text_quote_digest/i);
  assert.match(checkpoint8Migration, /unsupported_source_anchor_ids/i);
});

test("checkpoint 8 migration enforces RLS, review-only approvals, and AI timeline evidence", () => {
  for (const table of [
    "ai_sessions",
    "ai_transcript_segments",
    "ai_source_anchors",
    "ai_jobs",
    "ai_draft_outputs",
    "ai_action_proposals",
    "ai_review_decisions"
  ]) {
    assert.match(checkpoint8Migration, new RegExp(`alter table ${table} enable row level security`, "i"));
    assert.match(checkpoint8Migration, new RegExp(`alter table ${table} force row level security`, "i"));
    assert.match(checkpoint8Migration, new RegExp(`${table}_tenant_clinic_isolation`, "i"));
  }

  assert.match(checkpoint8Migration, /applied_workflow text not null default 'review_only'/i);
  assert.match(checkpoint8Migration, /applied_record_id uuid check \(applied_record_id is null\)/i);
  assert.match(checkpoint8Migration, /'ai_session_started'/i);
  assert.match(checkpoint8Migration, /'ai_draft_generated'/i);
  assert.match(checkpoint8Migration, /'ai_review_decision_recorded'/i);
  assert.match(checkpoint8Migration, /'ai_retention_deleted'/i);
});

test("checkpoint 8 grants AI scribe permissions only to clinical/admin roles", () => {
  for (const permission of ["ai.scribe.read", "ai.scribe.write", "ai.scribe.review"]) {
    assert.match(checkpoint8Migration, new RegExp(`\\('${permission}'`, "i"));
    assert.match(checkpoint8Migration, new RegExp(`\\('doctor', '${permission}'\\)`, "i"));
    assert.match(checkpoint8Migration, new RegExp(`\\('assistant', '${permission}'\\)`, "i"));
    assert.doesNotMatch(checkpoint8Migration, new RegExp(`\\('accountant', '${permission}'\\)`, "i"));
    assert.doesNotMatch(checkpoint8Migration, new RegExp(`\\('auditor', '${permission}'\\)`, "i"));
  }
});
