import assert from "node:assert/strict";
import test from "node:test";
import { buildCp6SmokePlan } from "../../scripts/cp6-contract-smoke.mjs";
import {
  loadCp6Scenario,
  summarizeCp6Scenario,
  validateCp6Scenario
} from "../../scripts/validate-cp6-fixtures.mjs";

test("CP6 synthetic scenario is deterministic and local-test only", async () => {
  const scenario = await loadCp6Scenario();

  assert.equal(validateCp6Scenario(scenario), true);
  assert.deepEqual(summarizeCp6Scenario(scenario), {
    tenants: 2,
    clinics: 2,
    actors: 4,
    patients: 3,
    flowSteps: 18,
    roleTenantExpectations: 5,
    ownerDashboardPatients: 3,
    ownerDashboardAppointments: 3,
    ownerDashboardInvoices: 2,
    ownerDashboardRecalls: 3,
    ownerDashboardTasks: 4,
    ownerDashboardLabCases: 3,
    ownerDashboardInventoryExceptions: 3,
    ownerDashboardIncidents: 2,
    ownerDashboardCorrectiveActions: 2
  });
});

test("CP6 scenario covers continuity workflows required by checkpoint acceptance", async () => {
  const scenario = await loadCp6Scenario();
  const steps = new Set(scenario.flow.steps.map((step) => step.key));

  for (const required of [
    "record-checkout-procedure",
    "create-post-op-follow-up-task",
    "create-six-month-recall-rule",
    "complete-recall-action",
    "complete-post-op-task",
    "create-lab-case",
    "mark-lab-case-sent",
    "mark-lab-case-returned",
    "complete-lab-case",
    "create-lab-reconciliation",
    "start-inventory-check-run",
    "complete-inventory-check-low-stock",
    "create-incident",
    "assign-corrective-action",
    "complete-corrective-action",
    "read-owner-dashboard"
  ]) {
    assert.ok(steps.has(required), `${required} missing`);
  }

  assert.equal(
    scenario.flow.name,
    "checkout continuity -> recalls/tasks -> lab reconciliation -> inventory procurement -> incident CAPA -> owner dashboard"
  );
});

test("CP6 owner dashboard expectation is source-backed and aggregate-only", async () => {
  const scenario = await loadCp6Scenario();
  const expected = scenario.ownerDashboard.expectedSummary;

  assert.equal(expected.revenueInvoicedMinor, 1500000);
  assert.equal(expected.revenueCollectedMinor, 900000);
  assert.equal(expected.revenueOutstandingMinor, 600000);
  assert.deepEqual(expected.revenueSources, ["google", "practo", "referral"]);
  assert.equal(expected.recallDue, 3);
  assert.equal(expected.recallCompleted, 1);
  assert.equal(expected.openTasks, 3);
  assert.equal(expected.labPendingReconciliation, 1);
  assert.equal(expected.inventoryProcurementRequests, 1);
  assert.equal(expected.correctiveActionsOverdue, 1);

  const serializedDashboardRows = JSON.stringify(scenario.ownerDashboard.projectionData);
  assert.equal(serializedDashboardRows.includes("CP6 Google Synthetic"), false);
  assert.equal(serializedDashboardRows.includes("+919960000001"), false);
});

test("CP6 scenario includes role, tenant, and accountant-safe dashboard expectations", async () => {
  const scenario = await loadCp6Scenario();

  for (const [key, expected, reason] of [
    ["owner-can-read-dashboard", "allow", undefined],
    ["accountant-can-read-aggregate-dashboard-without-phi", "allow", undefined],
    ["assistant-cannot-read-owner-dashboard", "deny", "missing_permission"],
    ["wrong-tenant-owner-cannot-read-primary-dashboard", "deny", "tenant_mismatch"],
    ["assistant-cannot-create-lab-reconciliation", "deny", "missing_permission"]
  ]) {
    const expectation = scenario.roleTenantExpectations.find((candidate) => candidate.key === key);
    assert.ok(expectation, `${key} missing`);
    assert.equal(expectation.expected, expected);
    if (reason) assert.equal(expectation.expectedReason, reason);
  }

  const accountant = scenario.roleTenantExpectations.find(
    (candidate) => candidate.key === "accountant-can-read-aggregate-dashboard-without-phi"
  );
  assert.deepEqual(accountant.mustNotInclude, [
    "CP6 Google Synthetic",
    "+919960000001",
    "clinicalSummary",
    "medicalHistory"
  ]);
});

test("CP6 smoke plan lists all route families and live owner-dashboard checks", async () => {
  const scenario = await loadCp6Scenario();
  const plan = buildCp6SmokePlan(scenario);
  const routeFamilies = new Set(plan.flowRequests.map((request) => request.routeFamily));

  for (const family of [
    "checkout-procedure",
    "tasks",
    "recalls",
    "lab-cases",
    "lab-reconciliations",
    "inventory",
    "incidents",
    "corrective-actions",
    "owner-dashboard"
  ]) {
    assert.ok(routeFamilies.has(family), `${family} missing from smoke plan`);
  }

  assert.equal(plan.flowRequests.length, 18);
  assert.equal(plan.negativeRequests.length, 3);
  assert.equal(plan.postFlowVerification.length, 1);
  assert.deepEqual(
    plan.flowRequests.filter((request) => request.liveImplemented).map((request) => request.key),
    ["read-owner-dashboard"]
  );
  assert.deepEqual(
    plan.negativeRequests.filter((request) => request.liveSmoke).map((request) => request.key),
    ["assistant-cannot-read-owner-dashboard"]
  );
});
