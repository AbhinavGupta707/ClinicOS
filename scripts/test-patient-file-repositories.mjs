#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { CHECKPOINT1_SEED_IDS, PostgresClinicOperationsRepository } from "@clinic-os/db";
import { parsePatientMigrationCsv, validatePatientImportRow } from "@clinic-os/domain";

// No default database, provisioning, resets or remote targets. The provisioner
// must mark its own disposable database before this synthetic-only probe runs.
assert.equal(process.env.CLINICOS_MVP_TEST_DATABASE_DISPOSABLE, "true");
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "clinic_os_runtime");
assert.equal(url.pathname, "/clinic_os");
const pool = new Pool({ connectionString: url.href, max: 4 });
const scope = {
  tenantId: CHECKPOINT1_SEED_IDS.tenantId,
  clinicId: CHECKPOINT1_SEED_IDS.clinicId,
  actorUserId: CHECKPOINT1_SEED_IDS.users.owner
};
const foreign = {
  tenantId: "20000000-0000-4000-8000-000000000001",
  clinicId: "20000000-0000-4000-8000-000000000101",
  actorUserId: "20000000-0000-4000-8000-000000001001"
};
const repository = new PostgresClinicOperationsRepository(pool);
assert.ok(
  process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === "--contracts-only")
);
const contractsOnly = process.argv[2] === "--contracts-only";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const header =
  "external_reference,full_name,phone,email,date_of_birth,gender,source_type,source_format";

async function scoped(operation) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      "select set_config('app.tenant_id', $1, true), set_config('app.clinic_id', $2, true), set_config('app.user_id', $3, true)",
      [scope.tenantId, scope.clinicId, scope.actorUserId]
    );
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function inputFor(sourceSystem, csv) {
  return {
    importType: "patients",
    sourceSystem,
    state: "ready_to_commit",
    sourceFileName: "practo-patients-demographics.csv",
    sourceChecksum: hash(csv),
    rows: parsePatientMigrationCsv(csv).map((draft) => {
      const row = validatePatientImportRow(draft);
      assert.equal(row.validationErrors.length, 0);
      return {
        rowNumber: row.rowNumber,
        importType: "patients",
        externalRecordId: row.externalReference,
        rawPayload: row.rawPayload,
        rawPayloadDigest: hash(JSON.stringify(row.rawPayload)),
        normalizedRecord: row.normalizedRecord,
        validationErrors: [],
        status: "ready_to_commit",
        matchStatus: "none",
        conflicts: []
      };
    })
  };
}

try {
  const marker = await pool.query(
    "select shobj_description(oid, 'pg_database') as marker from pg_database where datname = current_database()"
  );
  assert.equal(
    marker.rows[0]?.marker,
    `ClinicOS disposable MVP acceptance ${process.env.CLINICOS_MVP_DATABASE_TOKEN}`
  );
  const runId = randomUUID(),
    source = `file_repository_${runId}`;
  await repository.createImportRun(scope, { id: runId, sourceSystem: source });
  const lines = Array.from(
    { length: 100 },
    (_, index) =>
      `${runId}-${index},Synthetic Repository Patient ${index},+918${String(index).padStart(9, "0")},,,unknown,imported,practo_ray_patients_v1`
  );
  const csv = [header, ...lines].join("\n"),
    duplicate = [header, lines[0]].join("\n");
  const manifest = {
    profile: "practo_ray_patients_v1",
    rowCount: 101,
    chunks: [
      { ordinal: 0, rowCount: 100, digest: hash(csv) },
      { ordinal: 1, rowCount: 1, digest: hash(duplicate) }
    ]
  };
  const creates = await Promise.all([
    repository.createPatientFile(scope, runId, manifest),
    repository.createPatientFile(scope, runId, manifest)
  ]);
  assert.deepEqual(creates[0].file, creates[1].file);
  assert.equal(creates.filter((result) => result.created).length, 1);
  assert.equal(await repository.findPatientFile(foreign, runId), null);
  assert.equal(
    await repository.findPatientFile({ ...scope, clinicId: foreign.clinicId }, runId),
    null
  );
  await assert.rejects(() => repository.createPatientFile(foreign, runId, manifest), /not found/);
  const stages = await Promise.all(
    [0, 1].map(() =>
      repository.stagePatientFileChunk(scope, runId, 0, hash(csv), inputFor(source, csv))
    )
  );
  assert.equal(stages[0].detail.batch.id, stages[1].detail.batch.id);
  const batchId = stages[0].detail.batch.id;
  await assert.rejects(() => repository.commitMigrationBatch(scope, batchId), /Finish uploading/);
  await assert.rejects(() => repository.sealPatientFile(scope, runId), /complete file/);
  await assert.rejects(
    () => repository.stagePatientFileChunk(scope, runId, 0, "f".repeat(64), inputFor(source, csv)),
    /manifest/
  );
  await assert.rejects(
    () =>
      repository.stagePatientFileChunk(
        scope,
        runId,
        1,
        hash(duplicate),
        inputFor(source, duplicate)
      ),
    /another part/
  );
  await assert.rejects(
    () => repository.stagePatientFileChunk(foreign, runId, 0, hash(csv), inputFor(source, csv)),
    /not found/
  );
  await assert.rejects(
    () =>
      repository.stageImportRunBatch(scope, {
        ...inputFor(source, csv),
        importRunId: runId,
        importStepDigest: hash(csv)
      }),
    /patient-file/
  );
  assert.equal((await repository.findPatientFile(scope, runId)).received, 100);
  await assert.rejects(
    () =>
      scoped((client) =>
        client.query("update patient_import_files set row_count = 200 where run_id = $1", [runId])
      ),
    /immutable/
  );
  await assert.rejects(
    () =>
      scoped((client) =>
        client.query("delete from patient_import_chunks where run_id = $1", [runId])
      ),
    /immutable/
  );
  assert.equal((await pool.query("select * from patient_import_files")).rows.length, 0);
  assert.equal((await pool.query("select * from patient_import_chunks")).rows.length, 0);

  const completeId = randomUUID();
  await repository.createImportRun(scope, { id: completeId, sourceSystem: source });
  const single = [
    header,
    `${completeId},Synthetic Atomic File,+918765401239,,,unknown,imported,practo_ray_patients_v1`
  ].join("\n");
  const one = {
    profile: "practo_ray_patients_v1",
    rowCount: 1,
    chunks: [{ ordinal: 0, rowCount: 1, digest: hash(single) }]
  };
  await repository.createPatientFile(scope, completeId, one);
  const staged = await repository.stagePatientFileChunk(
    scope,
    completeId,
    0,
    hash(single),
    inputFor(source, single)
  );
  await repository.sealPatientFile(scope, completeId);
  await repository.sealPatientFile(scope, completeId);
  const commits = await Promise.all(
    [0, 1].map((index) =>
      repository.commitMigrationBatch(scope, staged.detail.batch.id, {
        idempotencyKey: `${completeId}-${index}`
      })
    )
  );
  assert.equal(commits[0].commit.id, commits[1].commit.id);
  assert.equal(commits[0].batch.committedRowCount, 1);
  assert.equal(
    (
      await repository.stagePatientFileChunk(
        scope,
        completeId,
        0,
        hash(single),
        inputFor(source, single)
      )
    ).detail.batch.id,
    staged.detail.batch.id
  );
  await assert.rejects(
    () =>
      scoped((client) =>
        client.query("update patient_import_files set sealed_at = null where run_id = $1", [
          completeId
        ])
      ),
    /immutable/
  );

  const familyId = randomUUID(),
    familySource = `family_${familyId}`;
  await repository.createImportRun(scope, { id: familyId, sourceSystem: familySource });
  const familyLines = Array.from(
    { length: 101 },
    (_, index) =>
      `${familyId}-${index},Synthetic Family ${index},+915${String(index).padStart(9, "0")},,,unknown,imported,practo_ray_patients_v1`
  );
  familyLines[100] = familyLines[100].replace(
    `+915${String(100).padStart(9, "0")}`,
    `+915${String(0).padStart(9, "0")}`
  );
  familyLines[2] = familyLines[2].replace("Synthetic Family 2", "Synthetic Family 1");
  familyLines[3] = familyLines[3].replace("Synthetic Family 3", "राम");
  familyLines[4] = familyLines[4].replace("Synthetic Family 4", "राम");
  const familyCsvs = [
    [header, ...familyLines.slice(0, 100)].join("\n"),
    [header, familyLines[100]].join("\n")
  ];
  await repository.createPatientFile(scope, familyId, {
    profile: "practo_ray_patients_v1",
    rowCount: 101,
    chunks: familyCsvs.map((csv, ordinal) => ({
      ordinal,
      rowCount: ordinal ? 1 : 100,
      digest: hash(csv)
    }))
  });
  const familyBatches = [];
  for (const [ordinal, csv] of familyCsvs.entries()) {
    const input = inputFor(familySource, csv);
    for (const row of input.rows) row.rowNumber += ordinal * 100;
    familyBatches.push(
      (await repository.stagePatientFileChunk(scope, familyId, ordinal, hash(csv), input)).detail
    );
  }
  assert.equal(
    await repository.resolveMigrationRow(
      scope,
      familyBatches[0].batch.id,
      familyBatches[0].rows[0].id,
      { action: "create_new", note: "Not yet sealed" }
    ),
    null
  );
  const family = (await repository.sealPatientFile(scope, familyId)).file;
  assert.equal(
    family.chunks.reduce((sum, chunk) => sum + chunk.needsReview, 0),
    6
  );
  await repository.sealPatientFile(scope, familyId);
  await assert.rejects(
    () => repository.commitMigrationBatch(scope, familyBatches[0].batch.id),
    /resolve all/
  );
  let reviewed = 0;
  for (const batch of familyBatches) {
    const detail = await repository.findMigrationBatchById(scope, batch.batch.id);
    for (const row of detail.rows.filter((row) => row.status === "needs_review")) {
      assert.equal(row.conflicts.length, 1);
      await repository.resolveMigrationRow(scope, batch.batch.id, row.id, {
        action: "create_new",
        note: "Synthetic review confirms separate family members."
      });
      reviewed++;
    }
  }
  assert.equal(reviewed, 6);
  for (const batch of familyBatches) await repository.commitMigrationBatch(scope, batch.batch.id);
  assert.equal(
    (await repository.findPatientFile(scope, familyId)).chunks.reduce(
      (sum, chunk) => sum + chunk.committed,
      0
    ),
    101
  );

  if (!contractsOnly) {
    // Independent DB reconciliation of the preceding 5,000-row browser/replay test.
    const scale = await scoped((client) =>
      client.query(`select r.source_system,
      count(distinct r.id)::int as files, count(distinct c.batch_id)::int as chunks,
      count(m.id)::int as staged_rows, count(*) filter (where m.status = 'committed')::int as committed_rows
    from import_runs r join patient_import_chunks c on (c.tenant_id, c.clinic_id, c.run_id) = (r.tenant_id, r.clinic_id, r.id)
    join migration_rows m on (m.tenant_id, m.clinic_id, m.batch_id) = (c.tenant_id, c.clinic_id, c.batch_id)
    where r.source_system like 'large_patient_file_%' group by r.source_system`)
    );
    assert.equal(scale.rows.length, 1);
    assert.deepEqual(
      { ...scale.rows[0], source_system: undefined },
      { source_system: undefined, files: 2, chunks: 100, staged_rows: 10000, committed_rows: 10000 }
    );
    const patients = await scoped((client) =>
      client.query(
        `select count(distinct l.target_record_id)::int as patients,
      count(*)::int as links from imported_record_links l join patients p
      on (p.tenant_id, p.clinic_id, p.id) = (l.tenant_id, l.clinic_id, l.target_record_id)
      where l.source_system = $1 and l.target_record_type = 'patient' and l.verification_status <> 'rolled_back'`,
        [scale.rows[0].source_system]
      )
    );
    assert.deepEqual(patients.rows[0], { patients: 5000, links: 5000 });
    console.log(
      JSON.stringify({
        passed: true,
        patients: 5000,
        snapshots: 2,
        stagedRows: 10000,
        duplicatePatientsOnReplay: 0,
        concurrentReceipts: true,
        concurrentCommit: true,
        incompleteCommitBlocked: true,
        crossChunkDuplicateBlocked: true,
        scopeIsolation: true,
        immutableManifest: true,
        wholeFileIdentityReview: true
      })
    );
  } else
    console.log(
      JSON.stringify({
        passed: true,
        scope: "repository contracts only; scale reconciliation not run"
      })
    );
} finally {
  await pool.end();
}
