#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { buildConsentEnforcementState } from "@clinic-os/domain";
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
      "insert into patients(id,tenant_id,clinic_id,full_name) values($1,$2,$3,'Synthetic history probe')",
      [id, scope.tenantId, scope.clinicId]
    );
  const ids = [];
  for (let i = 0; i < 137; i++) {
    const id = randomUUID();
    ids.push(id);
    await c.query(
      "insert into patient_timeline_items(id,tenant_id,clinic_id,patient_id,item_type,source_table,source_id,occurred_at,title) values($1,$2,$3,$4,'encounter_created','encounters',$5,'2026-01-01T10:00:00Z','Synthetic equal-time event')",
      [id, scope.tenantId, scope.clinicId, patient, randomUUID()]
    );
  }
  const foreignCursor = randomUUID(),
    filteredCursor = randomUUID();
  for (const [id, pid, type] of [
    [foreignCursor, foreign, "encounter_created"],
    [filteredCursor, patient, "invoice_created"]
  ])
    await c.query(
      "insert into patient_timeline_items(id,tenant_id,clinic_id,patient_id,item_type,source_table,source_id,occurred_at,title) values($1,$2,$3,$4,$5,'test',$6,now(),'Synthetic filtered event')",
      [id, scope.tenantId, scope.clinicId, pid, type, randomUUID()]
    );
  const repository = new PostgresClinicOperationsRepository({
    query: c.query.bind(c),
    inTransaction: true
  });
  const all = [];
  let cursor;
  do {
    const page = await repository.listPatientTimeline(scope, patient, {
      limit: 20,
      cursor,
      itemTypes: ["encounter_created"]
    });
    assert.ok(page.records.length <= 20);
    all.push(...page.records.map((r) => r.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.deepEqual(all, [...ids].sort().reverse());
  checks.push("137 equal-time events across seven stable pages without omission/duplication");
  for (const cursor of [foreignCursor, filteredCursor, randomUUID()])
    await assert.rejects(
      () =>
        repository.listPatientTimeline(scope, patient, {
          cursor,
          itemTypes: ["encounter_created"]
        }),
      RangeError
    );
  assert.equal(
    (await repository.listPatientTimeline(scope, patient, { itemTypes: [] })).records.length,
    0
  );
  assert.equal(
    (
      await repository.listPatientTimeline({ ...scope, clinicId: randomUUID() }, patient, {
        itemTypes: ["encounter_created"]
      })
    ).records.length,
    0
  );
  checks.push(
    "foreign patient, filter and missing cursor rejection; clinic isolation and empty permission set"
  );
  await c.query(
    "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
    [scope.tenantId, scope.clinicId, scope.actorUserId]
  );
  const snapshots = [];
  for (let version = 1; version <= 25; version++) {
    const id = randomUUID();
    snapshots.push(id);
    await c.query(
      "insert into dental_chart_snapshots(id,tenant_id,clinic_id,patient_id,snapshot_version,chart_state,created_by_user_id) values($1,$2,$3,$4,$5,$6,$7)",
      [
        id,
        scope.tenantId,
        scope.clinicId,
        patient,
        version,
        JSON.stringify({
          numberingSystem: "fdi",
          generatedAt: "2026-01-01T10:00:00Z",
          findingCount: 0,
          findings: []
        }),
        scope.actorUserId
      ]
    );
  }
  const first = await repository.listPatientDentalSnapshots(scope, patient, { limit: 20 });
  const second = await repository.listPatientDentalSnapshots(scope, patient, {
    limit: 20,
    cursor: first.nextCursor
  });
  assert.deepEqual(
    [...first.records, ...second.records].map((s) => s.id),
    snapshots.reverse()
  );
  assert.equal(second.nextCursor, null);
  assert.ok(!("chartState" in first.records[0]));
  assert.equal(
    (await repository.getPatientDentalSnapshot(scope, patient, snapshots[0])).chartState
      .findingCount,
    0
  );
  assert.equal(await repository.getPatientDentalSnapshot(scope, foreign, snapshots[0]), null);
  assert.equal(
    await repository.getPatientDentalSnapshot(
      { ...scope, tenantId: randomUUID() },
      patient,
      snapshots[0]
    ),
    null
  );
  await assert.rejects(
    () => repository.listPatientDentalSnapshots(scope, foreign, { cursor: snapshots[0] }),
    RangeError
  );
  checks.push(
    "25 metadata-only snapshots across two pages; exact read and patient/tenant isolation"
  );
  // The summary must reduce the entire history by effective grant/revocation
  // time before bounding rows. An older grant revoked later wins correctly.
  await c.query(
    "select set_config('app.tenant_id',$1,true),set_config('app.clinic_id',$2,true),set_config('app.user_id',$3,true)",
    [scope.tenantId, scope.clinicId, scope.actorUserId]
  );
  for (let i = 0; i < 130; i++) {
    await c.query(
      `insert into consents(tenant_id,clinic_id,patient_id,purpose,status,template_code,template_version,capture_method,created_by_user_id,created_at,revoked_by_user_id,revoked_at,revocation_reason)
      values($1,$2,$3,'photo_capture','revoked','synthetic',1,'clinic_staff',$4,'2025-01-01'::timestamptz+$5*interval '1 minute',$4,'2025-01-01'::timestamptz+($5+1)*interval '1 minute','Synthetic historical revocation')`,
      [scope.tenantId, scope.clinicId, patient, scope.actorUserId, i]
    );
  }
  await c.query(
    `insert into consents(tenant_id,clinic_id,patient_id,purpose,status,template_code,template_version,capture_method,created_by_user_id,created_at)
    values($1,$2,$3,'photo_capture','active','synthetic',1,'clinic_staff',$4,'2026-01-01')`,
    [scope.tenantId, scope.clinicId, patient, scope.actorUserId]
  );
  const full = await repository.listPatientConsents(scope, patient);
  const bounded = await repository.getConsentEnforcementState(scope, patient);
  assert.equal(full.length, 131);
  assert.deepEqual(
    { ...bounded, evaluatedAt: "" },
    { ...buildConsentEnforcementState(patient, full), evaluatedAt: "" }
  );
  assert.equal(bounded.photoCaptureAllowed, true);
  await c.query(
    `insert into consents(tenant_id,clinic_id,patient_id,purpose,status,template_code,template_version,capture_method,created_by_user_id,created_at,revoked_by_user_id,revoked_at,revocation_reason)
    values($1,$2,$3,'photo_capture','revoked','synthetic',1,'clinic_staff',$4,'2024-01-01',$4,'2026-02-01','Synthetic later revocation of old grant')`,
    [scope.tenantId, scope.clinicId, patient, scope.actorUserId]
  );
  const revoked = await repository.getConsentEnforcementState(scope, patient);
  assert.equal(revoked.photoCaptureAllowed, false);
  assert.deepEqual(
    { ...revoked, evaluatedAt: "" },
    {
      ...buildConsentEnforcementState(
        patient,
        await repository.listPatientConsents(scope, patient)
      ),
      evaluatedAt: ""
    }
  );
  assert.deepEqual(
    (await repository.getConsentEnforcementState(scope, foreign)).activePurposes,
    []
  );
  checks.push(
    "132 consent records reduced exactly; later revocation overrides older grants without loading all evidence into preparation"
  );
  console.log(
    JSON.stringify({ status: "passed", checks, fixtures: "transaction rolled back" }, null, 2)
  );
} finally {
  await c.query("rollback");
  c.release();
  await pool.end();
}
