import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertLocalRestoreGuards,
  buildRestoreDrillEvidence,
  parseCsv
} from "./cp9-restore-drill.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const baseEnv = {
  AWS_REGION: "ap-south-1",
  AWS_DR_REGION: "ap-south-2",
  BACKUP_RESTORE_DRILL_MODE: "dry_run",
  BACKUP_RESTORE_ALLOW_DESTRUCTIVE: "false",
  BACKUP_RESTORE_RPO_MINUTES: "60",
  BACKUP_RESTORE_RTO_MINUTES: "240",
  PILOT_SYNTHETIC_DATA_ONLY: "true",
  PILOT_PATIENT_EXPORT_PATH: "fixtures/synthetic/patients.csv",
  PILOT_APPOINTMENT_EXPORT_PATH: "fixtures/synthetic/appointments.csv",
  PILOT_PRICEBOOK_PATH: "fixtures/synthetic/pricebook.csv",
  PILOT_TEMPLATES_DIR: "fixtures/synthetic/templates",
  PILOT_XRAY_SAMPLE_DIR: "fixtures/synthetic/media"
};

test("CP9 restore dry-run builds synthetic evidence without destructive execution", () => {
  const evidence = buildRestoreDrillEvidence({
    cwd: repoRoot,
    env: baseEnv,
    generatedAt: new Date("2026-07-07T00:00:00.000Z")
  });

  assert.equal(evidence.status, "passed");
  assert.equal(evidence.syntheticDataOnly, true);
  assert.equal(evidence.destructiveOperationsExecuted, false);
  assert.equal(evidence.primaryRegion, "ap-south-1");
  assert.equal(evidence.drRegion, "ap-south-2");
  assert.deepEqual(
    evidence.dataSources.map((source) => [source.name, source.rowCount]),
    [
      ["patients", 3],
      ["appointments", 3],
      ["pricebook", 6]
    ]
  );
});

test("local restore smoke guard requires localhost restore-drill target and explicit opt-in", () => {
  assert.throws(
    () =>
      assertLocalRestoreGuards({
        ...baseEnv,
        BACKUP_RESTORE_DRILL_MODE: "local_execute",
        BACKUP_RESTORE_ALLOW_DESTRUCTIVE: "false",
        BACKUP_RESTORE_TARGET_DATABASE_URL:
          "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os_restore_drill"
      }),
    /BACKUP_RESTORE_ALLOW_DESTRUCTIVE=true/
  );

  assert.throws(
    () =>
      assertLocalRestoreGuards({
        ...baseEnv,
        BACKUP_RESTORE_DRILL_MODE: "local_execute",
        BACKUP_RESTORE_ALLOW_DESTRUCTIVE: "true",
        BACKUP_RESTORE_TARGET_DATABASE_URL:
          "postgresql://clinic_os:clinic_os@db.example.test:5432/clinic_os_restore_drill"
      }),
    /target must be localhost/
  );

  assert.doesNotThrow(() =>
    assertLocalRestoreGuards({
      ...baseEnv,
      BACKUP_RESTORE_DRILL_MODE: "local_execute",
      BACKUP_RESTORE_ALLOW_DESTRUCTIVE: "true",
      BACKUP_RESTORE_TARGET_DATABASE_URL:
        "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os_restore_drill"
    })
  );
});

test("CSV parser supports quoted values", () => {
  const parsed = parseCsv('id,name,notes\n1,"Aarav, Synthetic","quote ""kept"""');

  assert.deepEqual(parsed.headers, ["id", "name", "notes"]);
  assert.deepEqual(parsed.rows, [{ id: "1", name: "Aarav, Synthetic", notes: 'quote "kept"' }]);
});
