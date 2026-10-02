#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool, Client } from "pg";
import { CHECKPOINT1_SEED_IDS, PostgresClinicOperationsRepository } from "@clinic-os/db";
import {
  buildMigrationAssuranceReport,
  canonicalAppointmentObservations,
  parsePatientMigrationCsv,
  validatePatientImportRow
} from "@clinic-os/domain";
import { readMigrationAssurance } from "../packages/db/src/migration-assurance.ts";

assert.equal(process.argv.length, 2);
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
assert.equal(process.env.CLINICOS_MVP_TEST_DATABASE_DISPOSABLE, "true");
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.pathname, "/clinic_os");
assert.equal(url.username, "clinic_os_runtime");
assert.equal(url.search, "");
const pool = new Pool({ connectionString: url.href, max: 3 });
const scope = {
  tenantId: CHECKPOINT1_SEED_IDS.tenantId,
  clinicId: CHECKPOINT1_SEED_IDS.clinicId,
  actorUserId: CHECKPOINT1_SEED_IDS.users.owner
};
const repo = new PostgresClinicOperationsRepository(pool);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const source = `assurance_${randomUUID()}`;
const header =
  "external_reference,full_name,phone,email,date_of_birth,gender,source_type,source_format";
const csv = (lines) => [header, ...lines].join("\n");
const line = (id, name = id) =>
  `${source}-${id},Synthetic Assurance ${source} Person ${name},+1555999000${id},,,unknown,imported,practo_ray_patients_v1`;
async function file(text, seal = true, sourceSystem = source) {
  const runId = randomUUID();
  const rows = parsePatientMigrationCsv(text).map((draft) => {
    const r = validatePatientImportRow(draft);
    assert.equal(r.validationErrors.length, 0);
    return {
      rowNumber: r.rowNumber,
      importType: "patients",
      externalRecordId: r.externalReference,
      rawPayload: r.rawPayload,
      rawPayloadDigest: hash(JSON.stringify(r.rawPayload)),
      normalizedRecord: r.normalizedRecord,
      validationErrors: [],
      status: "ready_to_commit",
      matchStatus: "none",
      conflicts: []
    };
  });
  await repo.createImportRun(scope, { id: runId, sourceSystem });
  await repo.createPatientFile(scope, runId, {
    profile: "practo_ray_patients_v1",
    rowCount: rows.length,
    chunks: [{ ordinal: 0, rowCount: rows.length, digest: hash(text) }]
  });
  const staged = await repo.stagePatientFileChunk(scope, runId, 0, hash(text), {
    importType: "patients",
    sourceSystem,
    state: "ready_to_commit",
    sourceFileName: "synthetic.csv",
    sourceChecksum: hash(text),
    rows
  });
  if (seal) await repo.sealPatientFile(scope, runId);
  return { id: runId, batchId: staged.detail.batch.id };
}
const read = async (id, previous = null, appointment = null) =>
  buildMigrationAssuranceReport(
    await repo.findMigrationAssurance(scope, id, previous, appointment),
    "2026-10-02T12:00:00.000Z"
  );
async function rolledBackProbe(operation) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
      Object.values(scope)
    );
    await operation(c);
  } finally {
    await c.query("rollback");
    c.release();
  }
}
try {
  const marker = (
    await pool.query(
      "select shobj_description(oid,'pg_database') marker from pg_database where datname=current_database()"
    )
  ).rows[0].marker;
  assert.equal(
    marker,
    `ClinicOS disposable MVP acceptance ${process.env.CLINICOS_MVP_DATABASE_TOKEN}`
  );
  const first = await file(csv([line(1), line(2)]));
  assert.equal((await read(first.id)).rows.ready, 2);
  await repo.commitMigrationBatch(scope, first.batchId);
  const report = await read(first.id);
  assert.equal(report.state, "accounted_for");
  assert.deepEqual(report.patients, {
    committedRows: 2,
    distinctPatients: 2,
    createdPatients: 2,
    missingLinks: 0
  });
  assert.equal(JSON.stringify(report).includes("Synthetic"), false);
  const replay = await file(csv([line(1), line(2)]));
  await repo.commitMigrationBatch(scope, replay.batchId);
  const replayReport = await read(replay.id, first.id);
  assert.equal(replayReport.patients.createdPatients, 0);
  assert.deepEqual(replayReport.comparison, {
    runId: first.id,
    eligibility: "comparable",
    added: 0,
    changed: 0,
    unchanged: 2,
    absent: 0
  });
  const changed = await file(csv([line(1, "Changed"), line(3)]));
  assert.deepEqual((await read(changed.id, first.id)).comparison, {
    runId: first.id,
    eligibility: "comparable",
    added: 1,
    changed: 1,
    unchanged: 0,
    absent: 1
  });
  assert.equal(
    (await repo.findMigrationBatchById(scope, first.batchId)).batch.committedRowCount,
    2
  );
  const partial = await file(csv([line(4)]), false);
  assert.equal((await read(partial.id, first.id)).state, "incomplete");
  assert.equal((await read(partial.id, first.id)).comparison.eligibility, "incomplete");
  const other = await file(csv([line(5)]), true, source + "_other");
  await assert.rejects(() => read(first.id, other.id), /unavailable/);
  await assert.rejects(() => read(first.id, first.id), /unavailable/);
  assert.equal(
    await repo.findMigrationAssurance(
      { ...scope, clinicId: "20000000-0000-4000-8000-000000000101" },
      first.id,
      null,
      null
    ),
    null
  );
  assert.equal(
    await repo.findMigrationAssurance(
      { ...scope, tenantId: "20000000-0000-4000-8000-000000000001" },
      first.id,
      null,
      null
    ),
    null
  );
  await rolledBackProbe(async (c) => {
    await c.query("update migration_batches set committed_row_count=0 where id=$1", [
      first.batchId
    ]);
    const f = await readMigrationAssurance(c, scope, first.id, null, null);
    assert.equal(f.rows.committed, 2);
    assert.equal(f.counterMismatches, 1);
  });
  await rolledBackProbe(async (c) => {
    await c.query(
      "update imported_record_links set verification_status='rolled_back' where batch_id=$1",
      [first.batchId]
    );
    const f = await readMigrationAssurance(c, scope, replay.id, null, null);
    assert.equal(f.patients.missingLinks, 2);
  });
  await rolledBackProbe(async (c) => {
    await c.query("update migration_batches set valid_row_count=1 where id=$1", [first.batchId]);
    assert.equal(
      (await readMigrationAssurance(c, scope, first.id, null, null)).counterMismatches,
      1
    );
  });
  // Test-only corruption of immutable receipts is confined to rolled-back
  // transactions on this proven disposable cluster, after app writers stop.
  const adminUrl = new URL(url);
  adminUrl.username = "clinic_os";
  adminUrl.password = "clinic_os";
  const admin = new Client({ connectionString: adminUrl.href });
  await admin.connect();
  try {
    for (const [column, value] of [
      ["digest", "f".repeat(64)],
      ["ordinal", 1]
    ]) {
      await admin.query("begin");
      try {
        await admin.query("set local session_replication_role=replica");
        if (column === "digest")
          await admin.query("update patient_import_chunks set digest=$1 where run_id=$2", [
            value,
            first.id
          ]);
        else
          await admin.query("update patient_import_chunks set ordinal=$1 where run_id=$2", [
            value,
            first.id
          ]);
        const f = await readMigrationAssurance(admin, scope, replay.id, first.id, null);
        assert.equal(f.comparison.eligibility, "integrity_mismatch");
        const original = await readMigrationAssurance(admin, scope, first.id, null, null);
        assert.ok(original.manifestProblems > 0);
      } finally {
        await admin.query("rollback");
      }
    }
  } finally {
    await admin.end();
  }
  // Selected appointment files remain distinct evidence, with no implied booking.
  const observations = [
    {
      patientNumber: source + "-1",
      patientName: "Synthetic omitted",
      doctorName: "Synthetic doctor",
      date: "2026-10-03 10:00:00",
      status: "Scheduled"
    }
  ];
  // Use the domain-validated source shape documented by the canonical contract.
  const ap = await repo.createAppointmentImport(scope, {
    sourceSystem: source,
    digest: hash(canonicalAppointmentObservations(observations)),
    rowCount: 1
  });
  const a = await read(first.id, null, ap.id);
  assert.equal(a.appointments.expected, 1);
  assert.equal(a.appointments.sealed, false);
  assert.ok(a.issues.includes("appointment_upload"));
  await repo.stageAppointmentObservations(scope, ap.id, { offset: 0, rows: observations });
  await repo.sealAppointmentImport(scope, ap.id, new Date("2026-10-02T12:00:00Z"));
  const stagedAppointment = await read(first.id, null, ap.id);
  assert.equal(stagedAppointment.appointments.pending, 1);
  assert.ok(stagedAppointment.issues.includes("appointment_review"));
  const appointmentDetail = await repo.getAppointmentImport(scope, ap.id, 0);
  await repo.decideAppointmentObservation(scope, ap.id, appointmentDetail.rows[0].id, {
    decision: "history",
    reason: "Synthetic historical source observation only"
  });
  const historicalAppointment = await read(first.id, null, ap.id);
  assert.equal(historicalAppointment.appointments.pending, 0);
  assert.equal(historicalAppointment.appointments.history, 1);
  assert.equal(historicalAppointment.appointments.created, 0);
  assert.equal(historicalAppointment.appointments.linked, 0);
  assert.ok(!historicalAppointment.issues.includes("appointment_review"));
  await assert.rejects(() => read(other.id, null, ap.id), /unavailable/);
  console.log(
    JSON.stringify({
      status: "passed",
      checks: [
        "actual rows and links",
        "duplicate-free replay",
        "changed and absent evidence",
        "incomplete selection",
        "wrong source/scope",
        "counter corruption",
        "lost active link",
        "separate appointment manifest"
      ],
      runId: first.id,
      replayId: replay.id
    })
  );
} finally {
  await pool.end();
}
