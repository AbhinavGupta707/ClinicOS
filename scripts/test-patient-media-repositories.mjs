#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { CHECKPOINT1_SEED_IDS, PostgresClinicOperationsRepository } from "@clinic-os/db";
assert.equal(process.env.CLINICOS_MVP_TEST_DATABASE_DISPOSABLE, "true");
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true");
assert.match(process.env.CLINICOS_MVP_DATABASE_TOKEN ?? "", /^[a-f0-9]{32}$/);
const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.username, "clinic_os_runtime");
assert.equal(url.pathname, "/clinic_os");
const pool = new Pool({ connectionString: url.href, max: 1 });
const scope = {
  tenantId: CHECKPOINT1_SEED_IDS.tenantId,
  clinicId: CHECKPOINT1_SEED_IDS.clinicId,
  actorUserId: CHECKPOINT1_SEED_IDS.users.owner
};
const c = await pool.connect();
const checks = [];
try {
  const marker = await c.query(
    "select shobj_description(oid,'pg_database') as comment from pg_database where datname=current_database()"
  );
  assert.equal(
    marker.rows[0].comment,
    `ClinicOS disposable MVP acceptance ${process.env.CLINICOS_MVP_DATABASE_TOKEN}`
  );
  await c.query("begin");
  await c.query(
    "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
    [scope.tenantId, scope.clinicId, scope.actorUserId]
  );
  const patient = randomUUID(),
    foreign = randomUUID();
  for (const id of [patient, foreign])
    await c.query(
      "insert into patients(id,tenant_id,clinic_id,full_name) values($1,$2,$3,'Synthetic file probe')",
      [id, scope.tenantId, scope.clinicId]
    );
  const ids = [];
  const insert = async (id, pid, type = "document", status = "scan_pending") =>
    c.query(
      `insert into media_assets(id,tenant_id,clinic_id,patient_id,media_type,original_filename,mime_type,file_size_bytes,object_key,storage_provider,status,scan_status,created_by_user_id,uploaded_by_user_id,uploaded_at,provenance)
     values($1,$2,$3,$4,$5,$9,$10,10,$1::uuid::text,'local_simulator',$6,'pending',$7,$7,'2026-01-01T10:00:00Z',$8)`,
      [
        id,
        scope.tenantId,
        scope.clinicId,
        pid,
        type,
        status,
        scope.actorUserId,
        JSON.stringify({
          clinicalFile: { source: "Synthetic historic clinic", recordDate: "2015-11-20" }
        }),
        `clinical-media-${id}.${type === "xray" ? "png" : "pdf"}`,
        type === "xray" ? "image/png" : "application/pdf"
      ]
    );
  for (let i = 0; i < 137; i++) {
    const id = randomUUID();
    ids.push(id);
    await insert(id, patient);
  }
  const foreignCursor = randomUUID(),
    filteredCursor = randomUUID(),
    deletedCursor = randomUUID();
  await insert(foreignCursor, foreign);
  await insert(filteredCursor, patient, "xray");
  await insert(deletedCursor, patient, "document", "deleted");
  const repository = new PostgresClinicOperationsRepository({
    query: c.query.bind(c),
    inTransaction: true
  });
  let cursor;
  const found = [];
  do {
    const page = await repository.listPatientMediaAssets(scope, patient, {
      limit: 50,
      cursor,
      mediaType: "document"
    });
    assert.ok(page.records.length <= 50);
    found.push(...page.records.map((r) => r.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(found, [...ids].sort().reverse());
  checks.push("137 equal-time files across three stable pages without omission or duplication");
  for (const cursor of [foreignCursor, filteredCursor, deletedCursor, randomUUID()])
    await assert.rejects(
      () => repository.listPatientMediaAssets(scope, patient, { cursor, mediaType: "document" }),
      RangeError
    );
  assert.deepEqual(
    (await repository.listPatientMediaAssets(scope, patient, { mediaType: "xray" })).records.map(
      (r) => r.id
    ),
    [filteredCursor]
  );
  const exact = await repository.getPatientMediaAsset(scope, patient, ids[0]);
  assert.equal(exact.id, ids[0]);
  assert.deepEqual(exact.provenance.clinicalFile, {
    source: "Synthetic historic clinic",
    recordDate: "2015-11-20"
  });
  for (const [s, pid, id] of [
    [scope, foreign, ids[0]],
    [scope, patient, deletedCursor],
    [{ ...scope, tenantId: randomUUID() }, patient, ids[0]],
    [{ ...scope, clinicId: randomUUID() }, patient, ids[0]]
  ])
    assert.equal(await repository.getPatientMediaAsset(s, pid, id), null);
  for (const changed of [
    { ...scope, tenantId: randomUUID() },
    { ...scope, clinicId: randomUUID() }
  ])
    assert.equal((await repository.listPatientMediaAssets(changed, patient)).records.length, 0);
  checks.push(
    "patient, tenant, clinic, type, deleted and missing-anchor isolation; exact historical metadata retained"
  );
  console.log(
    JSON.stringify({ status: "passed", checks, fixtures: "transaction rolled back" }, null, 2)
  );
} finally {
  await c.query("rollback");
  c.release();
  await pool.end();
}
