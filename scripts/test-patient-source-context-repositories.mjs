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
assert.equal(process.argv.length, 2);
const hash = (value) => createHash("sha256").update(value).digest("hex");
const header =
  "external_reference,full_name,phone,email,date_of_birth,gender,source_type,source_format,source_context";

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
    "select shobj_description(oid, 'pg_database') as marker from pg_database where datname=current_database()"
  );
  assert.equal(
    marker.rows[0]?.marker,
    `ClinicOS disposable MVP acceptance ${process.env.CLINICOS_MVP_DATABASE_TOKEN}`
  );
  const runId = randomUUID(),
    source = `source_context_${runId}`;
  const cell = (value) => '"' + String(value).replaceAll('"', '""') + '"';
  const contextFor = (index) => ({
    "Medical History": `  Synthetic unverified history ${index}\nनमस्ते  `,
    "Patient Notes": index % 2 ? "Original source narrative" : "",
    "Secondary Mobile": "Historical alternate, not permission"
  });
  const line = (index, fields = contextFor(index)) =>
    [
      `${runId}-${index}`,
      `Context Synthetic ${runId} ${index}`,
      index % 3 ? `+1555${String(index).padStart(7, "0")}` : "",
      "",
      "",
      "unknown",
      "imported",
      "practo_ray_patients_context_v2",
      JSON.stringify(fields)
    ]
      .map(cell)
      .join(",");
  const chunks = Array.from({ length: 50 }, (_, ordinal) =>
    [header, ...Array.from({ length: 100 }, (_, i) => line(ordinal * 100 + i))].join("\n")
  );
  await repository.createImportRun(scope, { id: runId, sourceSystem: source });
  await repository.createPatientFile(scope, runId, {
    profile: "practo_ray_patients_context_v2",
    rowCount: 5000,
    chunks: chunks.map((csv, ordinal) => ({ ordinal, rowCount: 100, digest: hash(csv) }))
  });
  for (const [ordinal, csv] of chunks.entries()) {
    const input = inputFor(source, csv);
    for (const row of input.rows) row.rowNumber += ordinal * 100;
    await repository.stagePatientFileChunk(scope, runId, ordinal, hash(csv), input);
  }
  await repository.sealPatientFile(scope, runId);
  const staged = await repository.findPatientFile(scope, runId);
  for (const chunk of staged.chunks) await repository.commitMigrationBatch(scope, chunk.batchId);
  const counts = await scoped(
    async (c) =>
      (
        await c.query(
          `select count(*)::int as n,count(distinct patient_id)::int as patients,count(*) filter(where contact_unavailable)::int as missing from patient_source_contexts where source_system=$1`,
          [source]
        )
      ).rows[0]
  );
  assert.deepEqual(counts, { n: 5000, patients: 5000, missing: 1667 });
  const original = await scoped(
    async (c) =>
      (
        await c.query(
          "select * from patient_source_contexts where source_system=$1 and external_reference=$2",
          [source, `${runId}-0`]
        )
      ).rows[0]
  );
  assert.equal(original.fields["Medical History"], contextFor(0)["Medical History"]);
  const patient = await repository.findPatientById(scope, original.patient_id);
  assert.equal(patient.phone, null);
  const noContacts = await scoped(
    async (c) =>
      (
        await c.query("select count(*)::int as n from patient_contacts where patient_id=$1", [
          patient.id
        ])
      ).rows[0].n
  );
  assert.equal(noContacts, 0);
  assert.equal((await repository.listPatientSourceContexts(foreign, patient.id)).records.length, 0);
  assert.equal(
    await repository.reviewPatientSourceContext(foreign, patient.id, original.id, {
      decision: "reviewed",
      note: "No foreign access"
    }),
    null
  );
  const page = await repository.listPatientSourceContexts(scope, patient.id);
  assert.equal(page.records[0].review, null);
  await repository.reviewPatientSourceContext(scope, patient.id, original.id, {
    decision: "reviewed",
    note: "Verified against synthetic source only"
  });
  const stageSingle = async (fields) => {
    const id = randomUUID(),
      csv = [header, line(0, fields)].join("\n");
    await repository.createImportRun(scope, { id, sourceSystem: source });
    await repository.createPatientFile(scope, id, {
      profile: "practo_ray_patients_context_v2",
      rowCount: 1,
      chunks: [{ ordinal: 0, rowCount: 1, digest: hash(csv) }]
    });
    const staged = await repository.stagePatientFileChunk(
      scope,
      id,
      0,
      hash(csv),
      inputFor(source, csv)
    );
    await repository.sealPatientFile(scope, id);
    return { ...staged.detail, runId: id };
  };
  const replay = await stageSingle(contextFor(0));
  await repository.commitMigrationBatch(scope, replay.batch.id);
  assert.equal((await repository.listPatientSourceContexts(scope, patient.id)).records.length, 1);
  for (const fields of [{ "Medical History": "Changed clinical source" }, contextFor(0)]) {
    const changed = await stageSingle(fields);
    await repository.resolveMigrationRow(scope, changed.batch.id, changed.rows[0].id, {
      action: "link_existing",
      targetRecordId: patient.id
    });
    await repository.commitMigrationBatch(scope, changed.batch.id);
  }
  const versions = await repository.listPatientSourceContexts(scope, patient.id);
  assert.equal(versions.records.length, 3);
  assert.equal(versions.records[0].version, 3);
  assert.equal(versions.records[0].review, null);
  const replayAssurance = await repository.findMigrationAssurance(scope, replay.runId, null, null);
  assert.equal(replayAssurance.context.versionsAdded, 0);
  assert.equal(replayAssurance.context.retainedVersions, 1);
  assert.equal(replayAssurance.context.unreviewed, 1);
  assert.equal(replayAssurance.context.missingRows, 0);
  const wholeAssurance = await repository.findMigrationAssurance(scope, runId, null, null);
  assert.equal(wholeAssurance.context.versionsAdded, 5000);
  assert.equal(wholeAssurance.context.retainedVersions, 5000);
  assert.equal(wholeAssurance.context.unreviewed, 5000);

  await assert.rejects(
    () =>
      repository.reviewPatientSourceContext(scope, patient.id, original.id, {
        decision: "reviewed",
        note: "Stale source must reject"
      }),
    /Newer source/
  );
  await assert.rejects(
    () => repository.listPatientSourceContexts(scope, randomUUID(), original.id),
    /does not belong/
  );
  await assert.rejects(
    () =>
      scoped((c) =>
        c.query("update patient_source_contexts set fields='{}' where id=$1", [original.id])
      ),
    /immutable/
  );
  await assert.rejects(
    () =>
      scoped((c) =>
        c.query("delete from patient_source_context_reviews where context_id=$1", [original.id])
      ),
    /immutable/
  );
  // Begin an older transaction before another review, then append last. Latest
  // means serialized revision order, not transaction-start wall-clock order.
  const older = await pool.connect();
  try {
    await older.query("begin");
    await older.query(
      "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
      [scope.tenantId, scope.clinicId, scope.actorUserId]
    );
    await repository.reviewPatientSourceContext(scope, patient.id, versions.records[0].id, {
      decision: "reviewed",
      note: "Earlier committed review"
    });
    const bound = new PostgresClinicOperationsRepository({
      inTransaction: true,
      query: older.query.bind(older)
    });
    const late = await bound.reviewPatientSourceContext(scope, patient.id, versions.records[0].id, {
      decision: "needs_clarification",
      note: "Later serialized review from older transaction"
    });
    assert.equal(late.review.decision, "needs_clarification");
    await older.query("commit");
    assert.equal(
      (await repository.listPatientSourceContexts(scope, patient.id)).records[0].review.decision,
      "needs_clarification"
    );
  } catch (error) {
    await older.query("rollback");
    throw error;
  } finally {
    older.release();
  }
  const rollback = await repository.rollbackMigrationBatch(scope, staged.chunks[0].batchId);
  assert.equal(rollback.blockedLinks.length, 100);
  // Failed transaction must not leave a review; transaction-bound ports are used by the API.
  const before = await scoped(
    async (c) =>
      (
        await c.query(
          "select count(*)::int as n from patient_source_context_reviews where context_id=$1",
          [versions.records[0].id]
        )
      ).rows[0].n
  );
  await assert.rejects(
    () =>
      scoped(async (c) => {
        const bound = new PostgresClinicOperationsRepository({
          inTransaction: true,
          query: c.query.bind(c)
        });
        await bound.reviewPatientSourceContext(scope, patient.id, versions.records[0].id, {
          decision: "reviewed",
          note: "Synthetic atomic rollback"
        });
        throw new Error("synthetic audit failure");
      }),
    /synthetic audit failure/
  );
  const after = await scoped(
    async (c) =>
      (
        await c.query(
          "select count(*)::int as n from patient_source_context_reviews where context_id=$1",
          [versions.records[0].id]
        )
      ).rows[0].n
  );
  assert.equal(after, before);
  const audit = await scoped(
    async (c) =>
      (
        await c.query(
          "select count(*)::int as n from audit_events where action='patient.source_context.imported' and metadata->>'batchId' in (select batch_id::text from patient_import_chunks where run_id=$1)",
          [runId]
        )
      ).rows[0].n
  );
  assert.equal(audit, 5000);
  const outbox = await scoped(
    async (c) =>
      (
        await c.query(
          "select count(*)::int as n from outbox_events where event_type='patient.source_context.imported' and payload->>'batchId' in (select batch_id::text from patient_import_chunks where run_id=$1)",
          [runId]
        )
      ).rows[0].n
  );
  assert.equal(outbox, 5000);
  console.log(
    JSON.stringify({
      patients: 5000,
      missingPrimaryContacts: 1667,
      sourceVersions: 5002,
      originalText: "preserved",
      replay: "no duplicate",
      changedAndRevertedSource: "new unreviewed versions",
      isolation: "passed",
      immutability: "passed",
      rollback: "retained evidence",
      audit,
      outbox,
      transactionRollback: "passed"
    })
  );
} finally {
  await pool.end();
}
