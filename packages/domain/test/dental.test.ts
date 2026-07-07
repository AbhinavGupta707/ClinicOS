import test from "node:test";
import assert from "node:assert/strict";
import {
  assertDentalFindingUpdateReason,
  assertValidDentalFinding,
  buildDentalChartSnapshotState,
  normalizeDentalSurface,
  normalizeDentalToothNumber,
  type DentalFindingRecord
} from "../src/index.ts";

const baseFinding = {
  id: "10000000-0000-4000-8000-000000020001",
  tenantId: "10000000-0000-4000-8000-000000000001",
  clinicId: "10000000-0000-4000-8000-000000000101",
  patientId: "10000000-0000-4000-8000-000000002001",
  encounterId: "10000000-0000-4000-8000-000000010001",
  numberingSystem: "fdi",
  findingType: "caries",
  severity: "moderate",
  status: "active",
  reviewStatus: "needs_review",
  source: "manual",
  confidence: null,
  notes: null,
  provenance: { kind: "manual_entry" },
  treatmentReference: {},
  createdByUserId: "10000000-0000-4000-8000-000000001003",
  updatedByUserId: null,
  reviewedByUserId: null,
  reviewedAt: null
} satisfies Omit<DentalFindingRecord, "toothNumber" | "surface" | "createdAt" | "updatedAt">;

test("FDI tooth validation accepts permanent and primary teeth and rejects ambiguous notation", () => {
  assert.equal(normalizeDentalToothNumber("46"), "46");
  assert.equal(normalizeDentalToothNumber("  55 "), "55");
  assert.throws(() => normalizeDentalToothNumber("6"), /two-digit FDI/);
  assert.throws(() => normalizeDentalToothNumber("19"), /Invalid FDI/);
  assert.throws(() => normalizeDentalToothNumber("UR6"), /two-digit FDI/);
});

test("dental finding invariants validate surfaces and missing-tooth scope", () => {
  assert.equal(normalizeDentalSurface(" Distal "), "distal");
  assert.doesNotThrow(() =>
    assertValidDentalFinding({
      toothNumber: "46",
      surface: "occlusal",
      findingType: "caries",
      confidence: 0.72
    })
  );
  assert.throws(
    () => assertValidDentalFinding({ toothNumber: "46", surface: "mesial", findingType: "missing" }),
    /Missing-tooth/
  );
  assert.throws(
    () => assertValidDentalFinding({ toothNumber: "46", findingType: "caries", confidence: 1.5 }),
    /between 0 and 1/
  );
});

test("dental finding updates require a reason and chart snapshots are deterministic", () => {
  assert.throws(() => assertDentalFindingUpdateReason(" "), /changeReason/);
  const state = buildDentalChartSnapshotState(
    [
      finding("10000000-0000-4000-8000-000000020002", "11", null, "2026-07-07T10:01:00.000Z"),
      finding("10000000-0000-4000-8000-000000020001", "46", "occlusal", "2026-07-07T10:00:00.000Z")
    ],
    "2026-07-07T10:05:00.000Z"
  );

  assert.equal(state.numberingSystem, "fdi");
  assert.equal(state.findingCount, 2);
  assert.deepEqual(
    state.findings.map((item) => item.toothNumber),
    ["11", "46"]
  );
});

function finding(
  id: DentalFindingRecord["id"],
  toothNumber: DentalFindingRecord["toothNumber"],
  surface: DentalFindingRecord["surface"],
  createdAt: string
): DentalFindingRecord {
  return {
    ...baseFinding,
    id,
    toothNumber,
    surface,
    createdAt,
    updatedAt: createdAt
  };
}
