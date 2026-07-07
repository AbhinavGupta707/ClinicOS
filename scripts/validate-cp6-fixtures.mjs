#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildOwnerDashboardProjection } from "@clinic-os/domain";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const CP6_SCENARIO_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp6",
  "continuity_owner_dashboard_flow.json"
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_EMAIL_PATTERN = /^[^@\s]+@example\.test$/;
const TEST_PHONE_PATTERN = /^\+91996000\d{4}$/;
const REQUIRED_STEP_KEYS = [
  "record-checkout-procedure",
  "create-post-op-follow-up-task",
  "create-six-month-recall-rule",
  "read-due-recalls",
  "complete-recall-action",
  "complete-post-op-task",
  "create-lab-case",
  "mark-lab-case-sent",
  "mark-lab-case-returned",
  "complete-lab-case",
  "create-lab-reconciliation",
  "start-inventory-check-run",
  "complete-inventory-check-low-stock",
  "read-inventory-exceptions",
  "create-incident",
  "assign-corrective-action",
  "complete-corrective-action",
  "read-owner-dashboard"
];
const REQUIRED_ROUTE_FAMILIES = [
  "checkout-procedure",
  "tasks",
  "recalls",
  "lab-cases",
  "lab-reconciliations",
  "inventory",
  "incidents",
  "corrective-actions",
  "owner-dashboard"
];

export async function loadCp6Scenario(scenarioPath = CP6_SCENARIO_PATH) {
  const raw = await readFile(scenarioPath, "utf8");
  return JSON.parse(raw);
}

export function validateCp6Scenario(scenario) {
  assert.equal(scenario.schemaVersion, "clinic-os.cp6.qa-fixture.v1");
  assertLocalSyntheticOnly(scenario);
  assert.equal(scenario.clock.businessDate, "2026-07-07");
  assert.equal(scenario.clock.timezone, "Asia/Kolkata");
  assertIsoWithOffset(scenario.clock.fixedNow, "clock.fixedNow");
  assertIsoTimestamp(scenario.clock.ownerDashboardFrom, "clock.ownerDashboardFrom");
  assertIsoTimestamp(scenario.clock.ownerDashboardTo, "clock.ownerDashboardTo");

  const knownTenantIds = new Set();
  const knownClinicIds = new Set();
  const knownActorKeys = new Set();
  const knownPatientIds = new Set();

  for (const tenant of scenario.tenants) {
    assertUuid(tenant.id, `tenant ${tenant.key}.id`);
    knownTenantIds.add(tenant.id);
  }

  for (const clinic of scenario.clinics) {
    assertUuid(clinic.id, `clinic ${clinic.key}.id`);
    assertKnownReference(knownTenantIds, clinic.tenantId, `clinic ${clinic.key}.tenantId`);
    knownClinicIds.add(clinic.id);
  }

  for (const actor of scenario.actors) {
    assertUuid(actor.id, `actor ${actor.key}.id`);
    assertKnownReference(knownTenantIds, actor.tenantId, `actor ${actor.key}.tenantId`);
    assertKnownReference(knownClinicIds, actor.clinicId, `actor ${actor.key}.clinicId`);
    assert.match(actor.email, TEST_EMAIL_PATTERN, `actor ${actor.key}.email`);
    knownActorKeys.add(actor.key);
  }

  for (const patient of scenario.patients) {
    assertUuid(patient.id, `patient ${patient.key}.id`);
    assertKnownReference(knownTenantIds, patient.tenantId, `patient ${patient.key}.tenantId`);
    assertKnownReference(knownClinicIds, patient.clinicId, `patient ${patient.key}.clinicId`);
    assert.match(patient.email, TEST_EMAIL_PATTERN, `patient ${patient.key}.email`);
    assert.match(patient.phone, TEST_PHONE_PATTERN, `patient ${patient.key}.phone`);
    knownPatientIds.add(patient.id);
  }

  const steps = new Set(scenario.flow.steps.map((step) => step.key));
  for (const stepKey of REQUIRED_STEP_KEYS) {
    assert.ok(steps.has(stepKey), `${stepKey} missing from CP6 flow`);
  }

  const routeFamilies = new Set(scenario.flow.steps.map((step) => step.routeFamily));
  for (const family of REQUIRED_ROUTE_FAMILIES) {
    assert.ok(routeFamilies.has(family), `${family} route family missing from CP6 flow`);
  }

  for (const step of scenario.flow.steps) {
    assertKnownKey(knownActorKeys, step.actorKey, `step ${step.key}.actorKey`);
    assert.ok(["GET", "POST", "PATCH"].includes(step.method), `Unsupported method ${step.method}`);
    assert.equal(typeof step.path, "string", `step ${step.key}.path must be string`);
    assert.ok(step.path.startsWith("/v1/"), `step ${step.key}.path must be a /v1 route`);
    assert.ok([200, 201, 202, 403].includes(Number(step.expectedStatus)));
  }

  const expectations = new Map(scenario.roleTenantExpectations.map((item) => [item.key, item]));
  for (const [key, expectedReason] of [
    ["assistant-cannot-read-owner-dashboard", "missing_permission"],
    ["wrong-tenant-owner-cannot-read-primary-dashboard", "tenant_mismatch"],
    ["assistant-cannot-create-lab-reconciliation", "missing_permission"]
  ]) {
    const expectation = expectations.get(key);
    assert.ok(expectation, `${key} missing`);
    assert.equal(expectation.expected, "deny");
    assert.equal(expectation.expectedReason, expectedReason);
  }
  assert.equal(expectations.get("owner-can-read-dashboard")?.expected, "allow");
  assert.equal(
    expectations.get("accountant-can-read-aggregate-dashboard-without-phi")?.expected,
    "allow"
  );

  const dashboard = buildOwnerDashboardProjection({
    from: scenario.clock.ownerDashboardFrom,
    to: scenario.clock.ownerDashboardTo,
    generatedAt: scenario.clock.fixedNow,
    data: scenario.ownerDashboard.projectionData
  });
  assertOwnerDashboardSummary(dashboard, scenario.ownerDashboard.expectedSummary);

  return true;
}

export function summarizeCp6Scenario(scenario) {
  const data = scenario.ownerDashboard.projectionData;
  return {
    tenants: scenario.tenants.length,
    clinics: scenario.clinics.length,
    actors: scenario.actors.length,
    patients: scenario.patients.length,
    flowSteps: scenario.flow.steps.length,
    roleTenantExpectations: scenario.roleTenantExpectations.length,
    ownerDashboardPatients: data.patients.length,
    ownerDashboardAppointments: data.appointments.length,
    ownerDashboardInvoices: data.invoices.length,
    ownerDashboardRecalls: data.recalls.length,
    ownerDashboardTasks: data.tasks.length,
    ownerDashboardLabCases: data.labCases.length,
    ownerDashboardInventoryExceptions: data.inventoryExceptions.length,
    ownerDashboardIncidents: data.incidents.length,
    ownerDashboardCorrectiveActions: data.correctiveActions.length
  };
}

function assertOwnerDashboardSummary(dashboard, expected) {
  assert.equal(dashboard.appointments.scheduled, expected.appointmentsScheduled);
  assert.equal(dashboard.appointments.completed, expected.appointmentsCompleted);
  assert.equal(dashboard.appointments.noShow, expected.appointmentNoShows);
  assert.equal(dashboard.revenue.invoicedMinor, expected.revenueInvoicedMinor);
  assert.equal(dashboard.revenue.collectedMinor, expected.revenueCollectedMinor);
  assert.equal(dashboard.revenue.outstandingMinor, expected.revenueOutstandingMinor);
  assert.deepEqual(
    dashboard.revenue.bySource.map((source) => source.source),
    expected.revenueSources
  );
  assert.equal(dashboard.recalls.due, expected.recallDue);
  assert.equal(dashboard.recalls.completed, expected.recallCompleted);
  assert.equal(dashboard.recalls.overdue, expected.recallOverdue);
  assert.equal(dashboard.tasks.open, expected.openTasks);
  assert.equal(dashboard.tasks.overdue, expected.overdueTasks);
  assert.equal(dashboard.tasks.completed, expected.completedTasks);
  assert.equal(dashboard.sops.due, expected.sopDue);
  assert.equal(dashboard.sops.completed, expected.sopCompleted);
  assert.equal(dashboard.labs.overdueCases, expected.labOverdueCases);
  assert.equal(dashboard.labs.pendingReconciliation, expected.labPendingReconciliation);
  assert.equal(dashboard.inventory.openExceptions, expected.inventoryOpenExceptions);
  assert.equal(dashboard.inventory.procurementRequests, expected.inventoryProcurementRequests);
  assert.equal(dashboard.treatmentAndPayments.presentedPlanCount, expected.presentedPlanCount);
  assert.equal(dashboard.treatmentAndPayments.acceptedPlanCount, expected.acceptedPlanCount);
  assert.equal(
    dashboard.treatmentAndPayments.completedButUninvoicedMinor,
    expected.completedButUninvoicedMinor
  );
  assert.equal(dashboard.treatmentAndPayments.overdueInvoiceMinor, expected.overdueInvoiceMinor);
  assert.equal(dashboard.incidents.opened, expected.incidentsOpened);
  assert.equal(dashboard.incidents.open, expected.openIncidents);
  assert.equal(dashboard.incidents.correctiveActionsCompleted, expected.correctiveActionsCompleted);
  assert.equal(dashboard.incidents.correctiveActionsOverdue, expected.correctiveActionsOverdue);
}

function assertLocalSyntheticOnly(scenario) {
  assert.equal(scenario.fixtureUse.localOnly, true, "fixture must be local-only");
  assert.equal(scenario.fixtureUse.syntheticOnly, true, "fixture must be synthetic-only");
  assert.equal(scenario.fixtureUse.productionUseDenied, true, "fixture must deny production use");
  assert.deepEqual(scenario.fixtureUse.allowedEnvironments, ["local", "development", "test", "ci"]);

  const serialized = JSON.stringify(scenario);
  const emails = serialized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const email of emails) {
    assert.match(email, TEST_EMAIL_PATTERN, `${email} must use .example.test`);
  }

  const forbiddenPatterns = [
    /@gmail\.com/i,
    /@yahoo\./i,
    /@hotmail\./i,
    /sk_live/i,
    /rzp_live/i,
    /razorpay_live/i,
    /whatsapp_access_token/i,
    /aadhaar/i,
    /pan[_-]?card/i,
    /abha[_-]?(address|number)/i,
    /upi:\/\/pay/i
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(serialized), false, `fixture contains forbidden pattern ${pattern}`);
  }
}

function assertUuid(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string UUID`);
  assert.match(value, UUID_PATTERN, `${label} must be a deterministic v4-style UUID`);
}

function assertKnownReference(ids, value, label) {
  assertUuid(value, label);
  assert.ok(ids.has(value), `${label} references unknown id ${value}`);
}

function assertKnownKey(keys, value, label) {
  assert.equal(typeof value, "string", `${label} must be a string key`);
  assert.ok(keys.has(value), `${label} references unknown key ${value}`);
}

function assertIsoWithOffset(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
}

function assertIsoTimestamp(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(!Number.isNaN(Date.parse(value)), `${label} must parse as an ISO timestamp`);
}

async function main() {
  const scenario = await loadCp6Scenario();
  validateCp6Scenario(scenario);
  console.log(JSON.stringify(summarizeCp6Scenario(scenario), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
