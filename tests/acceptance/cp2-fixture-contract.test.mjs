import assert from "node:assert/strict";
import test from "node:test";
import { buildCp2SmokePlan } from "../../scripts/cp2-contract-smoke.mjs";
import {
  loadCp2Scenario,
  summarizeCp2Scenario,
  validateCp2Scenario
} from "../../scripts/validate-cp2-fixtures.mjs";

test("CP2 synthetic scenario is deterministic and local-test only", async () => {
  const scenario = await loadCp2Scenario();

  assert.equal(validateCp2Scenario(scenario), true);
  assert.deepEqual(summarizeCp2Scenario(scenario), {
    tenants: 2,
    clinics: 2,
    actors: 6,
    patients: 2,
    leads: 3,
    appointments: 2,
    flowSteps: 10,
    roleTenantExpectations: 6
  });
});

test("CP2 scenario covers match-existing and create-new patient paths", async () => {
  const scenario = await loadCp2Scenario();
  const steps = new Set(scenario.flow.steps.map((step) => step.key));

  assert.ok(steps.has("match-whatsapp-returning-lead"));
  assert.ok(steps.has("create-patient-from-lead"));
  assert.ok(steps.has("convert-lead-to-appointment"));
  assert.ok(steps.has("confirm-appointment"));
  assert.ok(steps.has("check-in-patient"));
  assert.ok(steps.has("read-queue-after-check-in"));
  assert.ok(steps.has("read-dashboard-after-check-in"));

  const returningLead = scenario.leads.find((lead) => lead.key === "whatsappReturningLead");
  assert.deepEqual(returningLead.expectedPatientMatch.duplicateSuggestions, [
    "20000000-0000-4000-8000-000000002001"
  ]);

  const newLead = scenario.leads.find((lead) => lead.key === "googleNewPatientLead");
  assert.deepEqual(newLead.expectedPatientMatch.duplicateSuggestions, []);
  assert.equal(newLead.expectedPatientMatch.patientClassification, "new");
});

test("CP2 scenario requires PHI audit and patient timeline evidence for mutations", async () => {
  const scenario = await loadCp2Scenario();
  const mutationSteps = [
    "create-patient-from-lead",
    "convert-lead-to-appointment",
    "confirm-appointment",
    "check-in-patient"
  ];

  for (const stepKey of mutationSteps) {
    const step = scenario.flow.steps.find((candidate) => candidate.key === stepKey);
    assert.ok(step, `${stepKey} missing`);
    assert.ok(step.expectedAudit.length > 0, `${stepKey} must declare audit evidence`);
    assert.ok(step.timelineExpectations.length > 0, `${stepKey} must declare timeline evidence`);

    for (const event of step.expectedAudit) {
      assert.ok(
        event.phiFields.length > 0,
        `${stepKey} audit expectation must name PHI-sensitive field(s)`
      );
    }
  }
});

test("CP2 scenario includes role denial and wrong-tenant denial contracts", async () => {
  const scenario = await loadCp2Scenario();

  assert.ok(
    scenario.roleTenantExpectations.some(
      (expectation) =>
        expectation.key === "accountant-cannot-create-patient" &&
        expectation.expectedReason === "missing_permission"
    )
  );
  assert.ok(
    scenario.roleTenantExpectations.some(
      (expectation) =>
        expectation.key === "doctor-cannot-book-without-schedule-write" &&
        expectation.expectedReason === "missing_permission"
    )
  );
  assert.ok(
    scenario.roleTenantExpectations.some(
      (expectation) =>
        expectation.key === "assistant-cannot-cross-tenant-write" &&
        expectation.expectedReason === "tenant_mismatch"
    )
  );
});

test("CP2 smoke plan can be built from documented contracts", async () => {
  const scenario = await loadCp2Scenario();
  const plan = buildCp2SmokePlan(scenario);

  assert.equal(plan.flowRequests.length, 10);
  assert.equal(plan.negativeRequests.length, 4);
  assert.equal(plan.postFlowVerification.length, 1);
  assert.deepEqual(
    plan.flowRequests.map((request) => `${request.method} ${request.path}`),
    [
      "POST /leads",
      "POST /leads/20000000-0000-4000-8000-000000003001/match-patient",
      "POST /leads",
      "POST /leads/20000000-0000-4000-8000-000000003002/match-patient",
      "POST /v1/patients",
      "POST /leads/20000000-0000-4000-8000-000000003002/convert-to-appointment",
      "POST /v1/appointments/20000000-0000-4000-8000-000000005001/confirm",
      "POST /v1/appointments/20000000-0000-4000-8000-000000005001/check-in",
      "GET /v1/queue?date=2026-07-07",
      "GET /v1/dashboard/morning?date=2026-07-07"
    ]
  );
});
