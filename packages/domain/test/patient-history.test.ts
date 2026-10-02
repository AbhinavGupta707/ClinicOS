import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  PATIENT_HISTORY_CATEGORIES,
  allowedPatientHistoryCategories,
  patientHistoryCategory,
  patientHistoryItemTypes,
  historyPageLimit,
  assertHistoryCursor
} from "../src/patient-history.ts";
import { permissionsForRoles } from "../src/permissions.ts";

test("history classifies every known event exactly once and fails closed for future types", () => {
  const source = readFileSync(new URL("../src/patient.ts", import.meta.url), "utf8")
    .split("export type PatientTimelineItemType =")[1]!
    .split(";")[0]!;
  const expected = [...source.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const actual = patientHistoryItemTypes(PATIENT_HISTORY_CATEGORIES);
  assert.deepEqual([...actual].sort(), [...new Set(expected)].sort());
  assert.equal(new Set(actual).size, actual.length);
  assert.equal(patientHistoryCategory("future_unknown"), null);
});
test("reception has no PHI permission and cannot obtain patient history", () => {
  const allowed = allowedPatientHistoryCategories(permissionsForRoles(["receptionist"]));
  assert.deepEqual(allowed, []);
  assert.ok(!allowed.includes("visits"));
  assert.ok(!allowed.includes("dental"));
  assert.ok(!patientHistoryItemTypes(allowed).includes("clinical_note_signed"));
  assert.deepEqual(allowedPatientHistoryCategories(["clinical.note.read"]), []);
});
test("doctor sees clinical history and unknown privileges never grant categories", () => {
  const allowed = allowedPatientHistoryCategories(permissionsForRoles(["doctor"]));
  assert.ok(allowed.includes("visits"));
  assert.ok(allowed.includes("dental"));
  assert.deepEqual(allowedPatientHistoryCategories(["*"]), []);
});
test("history page limits and cursors are bounded without silent coercion", () => {
  assert.equal(historyPageLimit(undefined), 50);
  assert.equal(historyPageLimit(100), 100);
  for (const value of [0, -1, 101, NaN, Infinity, 1.5])
    assert.throws(() => historyPageLimit(value), RangeError);
  assertHistoryCursor("10000000-0000-4000-8000-000000000001");
  for (const value of ["", "1", "x".repeat(10000)])
    assert.throws(() => assertHistoryCursor(value), RangeError);
});

test("schedule permission alone cannot expose queue events", () => {
  assert.ok(
    !allowedPatientHistoryCategories([
      "patient.read",
      "patient.phi.read",
      "schedule.read"
    ]).includes("appointments")
  );
});
