import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMigrationAssuranceReport,
  type MigrationAssuranceFacts
} from "../src/migration-assurance.ts";

const facts = (): MigrationAssuranceFacts => ({
  runId: "10000000-0000-4000-8000-000000000001",
  profile: "practo_ray_patients_v1",
  expected: 5000,
  sealed: true,
  rows: {
    invalid: 0,
    needsReview: 0,
    ready: 0,
    committed: 5000,
    skipped: 0,
    rolledBack: 0,
    failed: 0
  },
  manifestProblems: 0,
  counterMismatches: 0,
  openConflicts: 0,
  patients: { committedRows: 5000, distinctPatients: 5000, createdPatients: 0, missingLinks: 0 },
  context: {
    versionsAdded: 0,
    retainedVersions: 0,
    missingRows: 0,
    reviewed: 0,
    needsClarification: 0,
    unreviewed: 0
  },
  comparison: null,
  appointments: null
});
const now = "2026-10-02T12:00:00.000Z";
test("reconciled replay is not new patients, vendor freshness or clinic approval", () => {
  const report = buildMigrationAssuranceReport(facts(), now);
  assert.equal(report.state, "accounted_for");
  assert.equal(report.patients.createdPatients, 0);
  assert.equal(report.sourceFreshness, "unknown");
  assert.equal(report.clinicApproval, "not_assessed");
  assert.equal(report.comparison, null);
  assert.equal(report.appointments, null);
});
test("every excluded/unresolved row and integrity discrepancy stays actionable", () => {
  const f = facts();
  f.rows = {
    committed: 4994,
    ready: 1,
    invalid: 1,
    needsReview: 1,
    skipped: 1,
    rolledBack: 1,
    failed: 1
  };
  f.counterMismatches = 1;
  const report = buildMigrationAssuranceReport(f, now);
  assert.equal(report.received, 5000);
  assert.equal(report.state, "action_required");
  assert.deepEqual(report.issues, [
    "integrity_mismatch",
    "review_required",
    "ready_rows",
    "excluded_rows"
  ]);
  f.rows.committed--;
  assert.equal(buildMigrationAssuranceReport(f, now).state, "incomplete");
});
test("comparison eligibility clears misleading counts and absence never means deletion", () => {
  const f = facts();
  f.comparison = {
    runId: f.runId,
    eligibility: "incomplete",
    added: 1,
    changed: 1,
    absent: 2,
    unchanged: 4997
  };
  const report = buildMigrationAssuranceReport(f, now);
  assert.deepEqual(report.comparison, {
    ...f.comparison,
    added: 0,
    changed: 0,
    absent: 0,
    unchanged: 0
  });
  assert.ok(report.issues.includes("comparison_unavailable"));
  f.comparison.eligibility = "comparable";
  assert.ok(buildMigrationAssuranceReport(f, now).issues.includes("changed_source"));
});
test("context review and separate appointment review cannot be mistaken for successful bookings", () => {
  const f = facts();
  f.profile = "practo_ray_patients_context_v2";
  f.context = {
    versionsAdded: 3,
    retainedVersions: 3,
    missingRows: 0,
    reviewed: 1,
    needsClarification: 1,
    unreviewed: 1
  };
  f.appointments = {
    importId: f.runId,
    expected: 4,
    sealed: false,
    pending: 1,
    history: 1,
    excluded: 1,
    linked: 0,
    created: 0,
    missingLinks: 0
  };
  assert.deepEqual(buildMigrationAssuranceReport(f, now).issues, [
    "context_review",
    "appointment_upload",
    "appointment_review"
  ]);
});
