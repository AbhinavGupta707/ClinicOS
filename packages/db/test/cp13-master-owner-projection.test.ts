import assert from "node:assert/strict";
import test from "node:test";
import type { UUID } from "@clinic-os/domain";
import {
  PostgresClinicOperationsRepository,
  type SqlConnectionFactory,
  type SqlQueryResult
} from "../src/index.ts";
import type { RepositoryScope } from "../src/repositories.ts";

const SCOPE = Object.freeze({
  tenantId: "10000000-0000-4000-8000-000000000001",
  clinicId: "10000000-0000-4000-8000-000000000101",
  actorUserId: "10000000-0000-4000-8000-000000001001"
}) satisfies Readonly<RepositoryScope>;
const IDS = Object.freeze({
  recall: "13000000-0000-4000-8000-000000000001" as UUID,
  rule: "13000000-0000-4000-8000-000000000002" as UUID,
  patient: "13000000-0000-4000-8000-000000000003" as UUID,
  sopRun: "13000000-0000-4000-8000-000000000004" as UUID,
  sopTemplate: "13000000-0000-4000-8000-000000000005" as UUID,
  sopSchedule: "13000000-0000-4000-8000-000000000006" as UUID,
  labCase: "13000000-0000-4000-8000-000000000007" as UUID,
  labVendor: "13000000-0000-4000-8000-000000000008" as UUID,
  inventoryLine: "13000000-0000-4000-8000-000000000009" as UUID,
  inventoryRun: "13000000-0000-4000-8000-000000000010" as UUID,
  inventoryTemplateLine: "13000000-0000-4000-8000-000000000011" as UUID,
  inventoryItem: "13000000-0000-4000-8000-000000000012" as UUID,
  procurementSuggestion: "13000000-0000-4000-8000-000000000013" as UUID,
  procurementTask: "13000000-0000-4000-8000-000000000014" as UUID,
  incident: "13000000-0000-4000-8000-000000000015" as UUID,
  correctiveAction: "13000000-0000-4000-8000-000000000016" as UUID
});
const NOW = "2026-07-10T12:00:00.000Z";

test("CP13 durable owner projection sources every CP6 operational family without PHI", async () => {
  const repository = new PostgresClinicOperationsRepository(new OwnerProjectionClient());
  const projection = await repository.loadOwnerDashboardProjectionData(SCOPE, {
    startAt: "2026-07-01T00:00:00.000Z",
    endAt: "2026-07-31T23:59:59.999Z"
  });

  assert.deepEqual(projection.recalls, [
    {
      id: IDS.recall,
      patientId: IDS.patient,
      source: null,
      status: "cancelled",
      dueAt: NOW,
      completedAt: null,
      bookedAppointmentId: null
    }
  ]);
  assert.deepEqual(projection.sopRuns, [
    {
      id: IDS.sopRun,
      templateKey: "opening-safety-check",
      status: "missed",
      scheduledFor: NOW,
      completedAt: null
    }
  ]);
  assert.equal(projection.labCases[0]?.reconciliationStatus, "matched");
  assert.equal(projection.labCases[0]?.invoiceAmountMinor, 45000);
  assert.deepEqual(projection.inventoryExceptions, [
    {
      id: IDS.inventoryLine,
      itemKey: "GLOVES-M",
      severity: "medium",
      status: "procurement_requested",
      detectedAt: NOW,
      resolvedAt: null,
      procurementTaskId: IDS.procurementTask
    }
  ]);
  assert.equal(projection.incidents[0]?.status, "closed");
  assert.equal(projection.correctiveActions[0]?.status, "assigned");

  const coreSource = projection.dataSources.find(
    (source) => source.key === "owner-dashboard-core-domain-tables"
  );
  const cp6Source = projection.dataSources.find(
    (source) => source.key === "cp6-continuity-operations-tables"
  );
  assert.equal(coreSource?.status, "ready");
  assert.equal(coreSource?.recordCount, 1);
  assert.ok(coreSource?.provenance.includes("recalls"));
  assert.equal(cp6Source?.status, "ready");
  assert.equal(cp6Source?.recordCount, 5);

  const serialized = JSON.stringify(projection);
  for (const forbidden of [
    "Synthetic patient name",
    "+919999999999",
    "Clinical secret",
    "Incident free text"
  ]) {
    assert.ok(!serialized.includes(forbidden), `projection leaked ${forbidden}`);
  }
});

class OwnerProjectionClient implements SqlConnectionFactory {
  readonly inTransaction = true;

  async query<TResult = Record<string, unknown>>(rawSql: string): Promise<SqlQueryResult<TResult>> {
    const sql = rawSql.replace(/\s+/gu, " ").trim().toLowerCase();
    if (/set_config\('/u.test(sql)) return { rows: [] };
    if (/ from recalls /u.test(` ${sql} `)) return rows<TResult>(recallRow());
    if (/ from sop_runs /u.test(` ${sql} `)) return rows<TResult>(sopRunRow());
    if (/ from lab_cases /u.test(` ${sql} `)) return rows<TResult>(labCaseRow());
    if (/ from inventory_check_run_lines /u.test(` ${sql} `)) {
      return rows<TResult>(inventoryExceptionRow());
    }
    if (/ from incidents /u.test(` ${sql} `)) return rows<TResult>(incidentRow());
    if (/ from corrective_actions /u.test(` ${sql} `)) {
      return rows<TResult>(correctiveActionRow());
    }
    if (
      / from (patients|leads|appointments|encounters|attribution_touches|treatment_plans|procedure_performed_records|invoices|payment_transactions|tasks) /u.test(
        ` ${sql} `
      )
    ) {
      return { rows: [] };
    }
    throw new Error(`Unexpected CP13 owner-projection SQL: ${sql}`);
  }
}

function rows<TResult>(...records: Record<string, unknown>[]): SqlQueryResult<TResult> {
  return { rows: records as TResult[] };
}

function base() {
  return {
    tenant_id: SCOPE.tenantId,
    clinic_id: SCOPE.clinicId,
    created_at: NOW,
    updated_at: NOW
  };
}

function recallRow() {
  return {
    ...base(),
    id: IDS.recall,
    recall_rule_id: IDS.rule,
    patient_id: IDS.patient,
    source_procedure_performed_id: null,
    source_invoice_id: null,
    task_id: null,
    appointment_id: null,
    status: "skipped",
    due_at: NOW,
    last_action_at: null,
    action_evidence: {},
    created_by_user_id: SCOPE.actorUserId,
    updated_by_user_id: SCOPE.actorUserId
  };
}

function sopRunRow() {
  return {
    ...base(),
    id: IDS.sopRun,
    row_version: 1,
    template_id: IDS.sopTemplate,
    template_key: "opening-safety-check",
    schedule_id: IDS.sopSchedule,
    task_id: null,
    due_at: NOW,
    status: "overdue",
    assigned_to_user_id: null,
    started_by_user_id: null,
    started_at: null,
    completed_by_user_id: null,
    completed_at: null,
    completion_evidence: {},
    generated_from_key: "cp13-owner-projection"
  };
}

function labCaseRow() {
  return {
    ...base(),
    id: IDS.labCase,
    row_version: 1,
    vendor_id: IDS.labVendor,
    patient_id: IDS.patient,
    encounter_id: null,
    treatment_plan_id: null,
    treatment_plan_estimate_item_id: null,
    procedure_performed_id: null,
    title: "Synthetic patient name must not project",
    status: "completed",
    priority: "routine",
    due_at: NOW,
    clinical_notes: "Clinical secret",
    internal_notes: "+919999999999",
    slip_number: "LAB-CP13",
    slip_version: 1,
    slip_generated_at: NOW,
    slip_generated_by_user_id: SCOPE.actorUserId,
    slip_metadata: {},
    expected_cost_minor: 45000,
    currency: "INR",
    sent_at: NOW,
    received_at: NOW,
    completed_at: NOW,
    cancelled_at: null,
    cancellation_reason: null,
    created_by_user_id: SCOPE.actorUserId,
    updated_by_user_id: SCOPE.actorUserId,
    reconciliation_record_status: "approved",
    reconciliation_entry_status: "matched",
    reconciliation_invoice_amount_minor: 45000,
    reconciliation_variance_amount_minor: 0
  };
}

function inventoryExceptionRow() {
  return {
    id: IDS.inventoryLine,
    tenant_id: SCOPE.tenantId,
    clinic_id: SCOPE.clinicId,
    check_run_id: IDS.inventoryRun,
    template_line_id: IDS.inventoryTemplateLine,
    item_id: IDS.inventoryItem,
    sequence: 1,
    drawer_location: "Drawer A",
    expected_quantity: 20,
    counted_quantity: 2,
    variance_quantity: -18,
    exception_type: "low_stock",
    exception_notes: "Synthetic inventory note",
    counted_by_user_id: SCOPE.actorUserId,
    counted_at: NOW,
    item_key: "GLOVES-M",
    procurement_suggestion_id: IDS.procurementSuggestion,
    procurement_status: "converted_to_task",
    procurement_task_id: IDS.procurementTask,
    procurement_updated_at: NOW
  };
}

function incidentRow() {
  return {
    ...base(),
    id: IDS.incident,
    patient_id: IDS.patient,
    appointment_id: null,
    lab_case_id: IDS.labCase,
    inventory_item_id: null,
    category: "lab_delay",
    severity: "high",
    status: "resolved",
    occurred_at: NOW,
    location: "Clinic",
    summary: "Incident free text",
    description: "Incident free text",
    impact: null,
    learning: null,
    immediate_action: null,
    evidence: {},
    reported_by_user_id: SCOPE.actorUserId,
    owner_user_id: SCOPE.actorUserId,
    resolved_at: NOW,
    closed_at: null
  };
}

function correctiveActionRow() {
  return {
    ...base(),
    id: IDS.correctiveAction,
    row_version: 1,
    incident_id: IDS.incident,
    action_type: "corrective",
    title: "Synthetic corrective action",
    description: "Synthetic corrective action description",
    status: "open",
    owner_user_id: SCOPE.actorUserId,
    due_at: NOW,
    completed_at: null,
    completed_by_user_id: null,
    completion_evidence: {},
    verification_evidence: {},
    created_by_user_id: SCOPE.actorUserId,
    updated_by_user_id: SCOPE.actorUserId
  };
}
