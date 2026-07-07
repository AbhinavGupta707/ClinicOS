import test from "node:test";
import assert from "node:assert/strict";
import {
  assertBreakGlassRequestPolicy,
  assertRetentionRunPolicy,
  breakGlassAccessIsActive,
  normalizePatientRecordExportSections,
  type BreakGlassAccessRecord
} from "../src/index.ts";

test("CP9 patient export section normalization defaults to configured safe sections", () => {
  const sections = normalizePatientRecordExportSections(undefined);

  assert.ok(sections.includes("demographics"));
  assert.ok(sections.includes("privacy_audit"));
  assert.ok(sections.includes("media"));
  assert.deepEqual(
    normalizePatientRecordExportSections(["media", "demographics", "media"]),
    ["demographics", "media"]
  );
  assert.throws(() => normalizePatientRecordExportSections(["raw_storage_paths"]), /Unknown/);
});

test("CP9 break-glass policy requires reason scope and bounded expiry", () => {
  const now = new Date("2026-07-07T09:00:00.000Z");
  assert.doesNotThrow(() =>
    assertBreakGlassRequestPolicy(
      {
        reason: "Emergency chairside continuity review",
        accessCategories: ["patient_record"],
        expiresAt: "2026-07-07T10:00:00.000Z"
      },
      now
    )
  );

  assert.throws(
    () =>
      assertBreakGlassRequestPolicy(
        {
          reason: "urgent",
          accessCategories: ["patient_record"],
          expiresAt: "2026-07-07T10:00:00.000Z"
        },
        now
      ),
    /reason/
  );
  assert.throws(
    () =>
      assertBreakGlassRequestPolicy(
        {
          reason: "Emergency chairside continuity review",
          accessCategories: [],
          expiresAt: "2026-07-07T10:00:00.000Z"
        },
        now
      ),
    /scope/
  );
  assert.throws(
    () =>
      assertBreakGlassRequestPolicy(
        {
          reason: "Emergency chairside continuity review",
          accessCategories: ["patient_record"],
          expiresAt: "2026-07-07T20:00:00.000Z"
        },
        now
      ),
    /8 hours/
  );
});

test("CP9 break-glass active check never treats expired or revoked grants as active", () => {
  const access = {
    status: "approved",
    expiresAt: "2026-07-07T10:00:00.000Z",
    revokedAt: null
  } satisfies Pick<BreakGlassAccessRecord, "status" | "expiresAt" | "revokedAt">;

  assert.equal(breakGlassAccessIsActive(access, new Date("2026-07-07T09:30:00.000Z")), true);
  assert.equal(breakGlassAccessIsActive(access, new Date("2026-07-07T10:00:01.000Z")), false);
  assert.equal(
    breakGlassAccessIsActive(
      { ...access, revokedAt: "2026-07-07T09:45:00.000Z" },
      new Date("2026-07-07T09:50:00.000Z")
    ),
    false
  );
});

test("CP9 retention policy rejects unsafe job modes and negative windows", () => {
  assert.doesNotThrow(() => assertRetentionRunPolicy({ mode: "dry_run", transcriptDeleteAfterDays: 1 }));
  assert.doesNotThrow(() => assertRetentionRunPolicy({ mode: "execute", transcriptDeleteAfterDays: 0 }));
  assert.throws(() => assertRetentionRunPolicy({ mode: "execute", transcriptDeleteAfterDays: -1 }), /non-negative/);
});
