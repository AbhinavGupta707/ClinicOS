import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ROLE_PERMISSION_GRANTS,
  isClinicalPermission,
  permissionsForRoles,
  roleGrantsPermission
} from "../src/index.ts";

test("accountant role cannot read clinical PHI by default", () => {
  assert.equal(roleGrantsPermission("accountant", "billing.read"), true);
  assert.equal(roleGrantsPermission("accountant", "clinical.note.read"), false);
  assert.equal(roleGrantsPermission("accountant", "dental.chart.read"), false);
  assert.equal(roleGrantsPermission("accountant", "media.read"), false);
  assert.equal(roleGrantsPermission("accountant", "patient.phi.read"), false);
  assert.equal(roleGrantsPermission("accountant", "task.manage"), false);
  assert.equal(roleGrantsPermission("accountant", "recall.manage"), false);
  assert.equal(roleGrantsPermission("accountant", "sop.manage"), false);
});

test("doctor can sign clinical records and assistant cannot", () => {
  assert.equal(roleGrantsPermission("assistant", "clinical.note.write"), true);
  assert.equal(roleGrantsPermission("assistant", "dental.chart.write"), true);
  assert.equal(roleGrantsPermission("doctor", "dental.chart.snapshot"), true);
  assert.equal(roleGrantsPermission("assistant", "prescription.write"), true);
  assert.equal(roleGrantsPermission("doctor", "clinical.note.sign"), true);
  assert.equal(roleGrantsPermission("doctor", "prescription.sign"), true);
  assert.equal(roleGrantsPermission("assistant", "clinical.note.sign"), false);
  assert.equal(roleGrantsPermission("assistant", "prescription.sign"), false);
});

test("accountant and auditor cannot mutate CP3 clinical or PHI records", () => {
  for (const role of ["accountant", "auditor"] as const) {
    assert.equal(roleGrantsPermission(role, "patient.write"), false);
    assert.equal(roleGrantsPermission(role, "intake.write"), false);
    assert.equal(roleGrantsPermission(role, "clinical.note.write"), false);
    assert.equal(roleGrantsPermission(role, "dental.chart.write"), false);
    assert.equal(roleGrantsPermission(role, "prescription.write"), false);
    assert.equal(roleGrantsPermission(role, "clinical.note.sign"), false);
    assert.equal(roleGrantsPermission(role, "prescription.sign"), false);
  }
});

test("role expansion deduplicates permissions", () => {
  const permissions = permissionsForRoles(["assistant", "receptionist"]);
  assert.equal(permissions.includes("schedule.write"), true);
  assert.equal(permissions.includes("task.manage"), true);
  assert.equal(permissions.includes("recall.manage"), true);
  assert.equal(permissions.includes("sop.manage"), true);
  assert.equal(new Set(permissions).size, permissions.length);
});

test("clinical permission classifier covers PHI-sensitive permissions", () => {
  assert.equal(isClinicalPermission("patient.phi.read"), true);
  assert.equal(isClinicalPermission("dental.chart.read"), true);
  assert.equal(isClinicalPermission("prescription.write"), true);
  assert.equal(isClinicalPermission("task.manage"), true);
  assert.equal(isClinicalPermission("recall.manage"), true);
  assert.equal(isClinicalPermission("billing.export"), false);
  assert.ok(DEFAULT_ROLE_PERMISSION_GRANTS.owner_admin.length > DEFAULT_ROLE_PERMISSION_GRANTS.assistant.length);
});
