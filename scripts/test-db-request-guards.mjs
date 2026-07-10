#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { CHECKPOINT1_SEED_IDS, createPostgresClinicModuleUnitOfWork } from "@clinic-os/db";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://clinic_os_runtime:clinic_os_runtime@127.0.0.1:5432/clinic_os";
assertLocalRuntimeUrl(databaseUrl);

const scope = Object.freeze({
  tenantId: CHECKPOINT1_SEED_IDS.tenantId,
  clinicId: CHECKPOINT1_SEED_IDS.clinicId,
  actorUserId: CHECKPOINT1_SEED_IDS.users.owner
});
const otherTenantScope = Object.freeze({
  tenantId: "20000000-0000-4000-8000-000000000001",
  clinicId: "20000000-0000-4000-8000-000000000101",
  actorUserId: "20000000-0000-4000-8000-000000001001"
});
const fixedClock = { now: () => new Date("2026-07-10T12:00:00.000Z") };
const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const unitOfWork = createPostgresClinicModuleUnitOfWork({
  client: pool,
  clock: fixedClock,
  resolveScope: (context) => context.scope
});

try {
  const token = randomUUID();
  const idempotencyKey = `cp12-real-concurrent-${token}`;
  const correlationId = `cp12-real-${token}`;
  const auditId = randomUUID();
  const requestDigest = sha256({ operation: "createPatient", token });
  const claimed = deferred();
  const releaseWinner = deferred();

  const winner = unitOfWork.run({ scope }, async ({ repositories, evidence, requestGuards }) => {
    const claim = await requestGuards.idempotency.claim({
      operationId: "createPatient",
      idempotencyKey,
      requestDigest,
      now: "2026-07-10T12:00:00.000Z",
      leaseOwner: `winner-${token}`,
      leaseExpiresAt: "2026-07-10T12:01:00.000Z"
    });
    assert.equal(claim.outcome, "claimed");
    if (claim.outcome !== "claimed") throw new Error("winner claim expected");
    claimed.resolve();
    await releaseWinner.promise;

    const patient = await repositories.patientAdministration.createPatient({
      fullName: `CP12 Request Guard Synthetic ${token}`,
      phone: phoneForToken(token),
      gender: "unknown",
      source: "manual",
      sourceDetail: { evidence: "cp12_real_request_guard" }
    });
    const currentVersion = await requestGuards.optimisticConcurrency.readCurrentVersion({
      operationId: "updatePatient",
      resourceId: patient.id
    });
    assert.deepEqual(currentVersion, { outcome: "found", rowVersion: 1 });
    const advanced = await requestGuards.optimisticConcurrency.advanceVersion({
      operationId: "updatePatient",
      resourceId: patient.id,
      expectedVersion: 1
    });
    assert.deepEqual(advanced, { outcome: "advanced", rowVersion: 2 });

    await evidence.appendAuditEvent({
      id: auditId,
      action: "patient.created",
      category: "clinical",
      riskLevel: "medium",
      phiInvolved: true,
      resourceType: "patient",
      resourceId: patient.id,
      patientId: patient.id,
      metadata: { evidence: "cp12_real_request_guard" },
      ipAddress: null,
      userAgent: "cp12-request-guard-test",
      correlationId,
      occurredAt: "2026-07-10T12:00:05.000Z"
    });
    await evidence.appendOutboxEvent({
      eventType: "patient.created",
      aggregateType: "patient",
      aggregateId: patient.id,
      patientId: patient.id,
      idempotencyKey: correlationId,
      correlationId,
      payload: { patientId: patient.id, evidence: "cp12_real_request_guard" },
      occurredAt: "2026-07-10T12:00:05.000Z"
    });
    const completion = await requestGuards.idempotency.complete({
      claim: claim.claim,
      completedAt: "2026-07-10T12:00:06.000Z",
      expiresAt: "2026-07-10T13:00:06.000Z",
      response: {
        status: 201,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
          etag: '"2"',
          location: `/v1/patients/${patient.id}`
        },
        body: { patientId: patient.id, rowVersion: 2 }
      }
    });
    assert.deepEqual(completion, { outcome: "completed" });
    return patient.id;
  });

  await claimed.promise;
  const contender = unitOfWork.run({ scope }, ({ requestGuards }) =>
    requestGuards.idempotency.claim({
      operationId: "createPatient",
      idempotencyKey,
      requestDigest,
      now: "2026-07-10T12:00:01.000Z",
      leaseOwner: `contender-${token}`,
      leaseExpiresAt: "2026-07-10T12:01:01.000Z"
    })
  );
  await new Promise((resolve) => setImmediate(resolve));
  releaseWinner.resolve();

  const [patientId, contenderResult] = await Promise.all([winner, contender]);
  assert.equal(contenderResult.outcome, "replay");
  if (contenderResult.outcome !== "replay") throw new Error("contender replay expected");
  assert.deepEqual(contenderResult.response, {
    status: 201,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json",
      etag: '"2"',
      location: `/v1/patients/${patientId}`
    },
    body: { patientId, rowVersion: 2 }
  });

  const digestConflict = await unitOfWork.run({ scope }, ({ requestGuards }) =>
    requestGuards.idempotency.claim({
      operationId: "createPatient",
      idempotencyKey,
      requestDigest: sha256({ operation: "createPatient", token, changed: true }),
      now: "2026-07-10T12:00:02.000Z",
      leaseOwner: `digest-conflict-${token}`,
      leaseExpiresAt: "2026-07-10T12:01:02.000Z"
    })
  );
  assert.deepEqual(digestConflict, { outcome: "digest_conflict" });

  const durableEvidence = await withScope(pool, scope, (client) =>
    client.query(
      `select
         (select count(*)::integer from patients where id = $1) as domain_writes,
         (select row_version::integer from patients where id = $1) as row_version,
         (select count(*)::integer from audit_events where id = $2) as audit_writes,
         (select count(*)::integer from outbox_events where idempotency_key = $3) as outbox_writes,
         (select count(*)::integer from api_idempotency_records
            where operation_id = 'createPatient' and idempotency_key = $4 and state = 'completed')
           as completed_idempotency_records`,
      [patientId, auditId, correlationId, idempotencyKey]
    )
  );
  assert.deepEqual(durableEvidence.rows[0], {
    domain_writes: 1,
    row_version: 2,
    audit_writes: 1,
    outbox_writes: 1,
    completed_idempotency_records: 1
  });

  const crossTenantVersion = await unitOfWork.run(
    { scope: otherTenantScope },
    ({ requestGuards }) =>
      requestGuards.optimisticConcurrency.readCurrentVersion({
        operationId: "updatePatient",
        resourceId: patientId
      })
  );
  assert.deepEqual(crossTenantVersion, { outcome: "not_found" });

  const rollbackKey = `cp12-real-rollback-${randomUUID()}`;
  const rollbackDigest = sha256({ operation: "updatePatient", rollbackKey });
  await assert.rejects(
    unitOfWork.run({ scope }, async ({ requestGuards }) => {
      const claim = await requestGuards.idempotency.claim({
        operationId: "updatePatient",
        idempotencyKey: rollbackKey,
        requestDigest: rollbackDigest,
        now: "2026-07-10T12:10:00.000Z",
        leaseOwner: `rollback-${token}`,
        leaseExpiresAt: "2026-07-10T12:11:00.000Z"
      });
      assert.equal(claim.outcome, "claimed");
      const advanced = await requestGuards.optimisticConcurrency.advanceVersion({
        operationId: "updatePatient",
        resourceId: patientId,
        expectedVersion: 2
      });
      assert.deepEqual(advanced, { outcome: "advanced", rowVersion: 3 });
      throw new Error("CP12_REAL_REQUEST_GUARD_ROLLBACK");
    }),
    /CP12_REAL_REQUEST_GUARD_ROLLBACK/u
  );
  const rollbackEvidence = await withScope(pool, scope, (client) =>
    client.query(
      `select
         (select row_version::integer from patients where id = $1) as row_version,
         (select count(*)::integer from api_idempotency_records
            where operation_id = 'updatePatient' and idempotency_key = $2) as claims`,
      [patientId, rollbackKey]
    )
  );
  assert.deepEqual(rollbackEvidence.rows[0], { row_version: 2, claims: 0 });

  const expiryKey = `cp12-real-expiry-${randomUUID()}`;
  const expiryDigest = sha256({ operation: "updatePatient", expiryKey });
  await unitOfWork.run({ scope }, async ({ requestGuards }) => {
    const claim = await requestGuards.idempotency.claim({
      operationId: "updatePatient",
      idempotencyKey: expiryKey,
      requestDigest: expiryDigest,
      now: "2026-07-10T12:20:00.000Z",
      leaseOwner: `expiry-${token}`,
      leaseExpiresAt: "2026-07-10T12:21:00.000Z"
    });
    if (claim.outcome !== "claimed") throw new Error("expiry claim expected");
    const completion = await requestGuards.idempotency.complete({
      claim: claim.claim,
      completedAt: "2026-07-10T12:20:01.000Z",
      expiresAt: "2026-07-10T12:20:02.000Z",
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { synthetic: "scrub-me" }
      }
    });
    assert.equal(completion.outcome, "completed");
  });
  const expired = await unitOfWork.run({ scope }, ({ requestGuards }) =>
    requestGuards.idempotency.claim({
      operationId: "updatePatient",
      idempotencyKey: expiryKey,
      requestDigest: expiryDigest,
      now: "2026-07-10T12:20:03.000Z",
      leaseOwner: `expiry-retry-${token}`,
      leaseExpiresAt: "2026-07-10T12:21:03.000Z"
    })
  );
  assert.deepEqual(expired, { outcome: "expired" });
  const tombstone = await withScope(pool, scope, (client) =>
    client.query(
      `select state, response_status, response_headers, response_body, lease_owner, lease_expires_at
       from api_idempotency_records
       where operation_id = 'updatePatient' and idempotency_key = $1`,
      [expiryKey]
    )
  );
  assert.deepEqual(tombstone.rows[0], {
    state: "expired",
    response_status: null,
    response_headers: {},
    response_body: null,
    lease_owner: null,
    lease_expires_at: null
  });

  const staleKey = `cp12-real-stale-${randomUUID()}`;
  const staleDigest = sha256({ operation: "updatePatient", staleKey });
  await unitOfWork.run({ scope }, ({ requestGuards }) =>
    requestGuards.idempotency.claim({
      operationId: "updatePatient",
      idempotencyKey: staleKey,
      requestDigest: staleDigest,
      now: "2026-07-10T12:30:00.000Z",
      leaseOwner: `stale-owner-${token}`,
      leaseExpiresAt: "2026-07-10T12:31:00.000Z"
    })
  );
  const activeLease = await unitOfWork.run({ scope }, ({ requestGuards }) =>
    requestGuards.idempotency.claim({
      operationId: "updatePatient",
      idempotencyKey: staleKey,
      requestDigest: staleDigest,
      now: "2026-07-10T12:30:30.000Z",
      leaseOwner: `active-contender-${token}`,
      leaseExpiresAt: "2026-07-10T12:31:30.000Z"
    })
  );
  assert.deepEqual(activeLease, { outcome: "in_progress" });
  await unitOfWork.run({ scope }, async ({ requestGuards }) => {
    const reclaimed = await requestGuards.idempotency.claim({
      operationId: "updatePatient",
      idempotencyKey: staleKey,
      requestDigest: staleDigest,
      now: "2026-07-10T12:31:01.000Z",
      leaseOwner: `recovery-owner-${token}`,
      leaseExpiresAt: "2026-07-10T12:32:01.000Z"
    });
    assert.equal(reclaimed.outcome, "claimed");
    if (reclaimed.outcome !== "claimed") throw new Error("stale reclaim expected");
    assert.equal(reclaimed.reclaimed, true);
    const completion = await requestGuards.idempotency.complete({
      claim: reclaimed.claim,
      completedAt: "2026-07-10T12:31:02.000Z",
      expiresAt: "2026-07-10T13:31:02.000Z",
      response: { status: 204, headers: { "cache-control": "no-store" }, body: null }
    });
    assert.equal(completion.outcome, "completed");
  });

  const noContext = await pool.query(
    `select
       nullif(current_setting('app.tenant_id', true), '') as tenant_id,
       (select count(*)::integer from api_idempotency_records) as idempotency_records,
       (select count(*)::integer from patients where id = $1) as patients`,
    [patientId]
  );
  assert.deepEqual(noContext.rows[0], {
    tenant_id: null,
    idempotency_records: 0,
    patients: 0
  });

  console.log(
    JSON.stringify(
      {
        concurrentClaimSingleEffect: "pass",
        exactCompletedReplay: "pass",
        digestConflict: "pass",
        domainAuditOutboxCompletionAtomicity: "pass",
        optimisticConcurrency: "pass",
        optimisticRollback: "pass",
        crossTenantNondisclosure: "pass",
        expiredResponseScrub: "pass",
        activeAndStaleLeaseHandling: "pass",
        pooledRlsReset: "pass"
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}

async function withScope(targetPool, repositoryScope, callback) {
  const client = await targetPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [repositoryScope.tenantId]);
    await client.query("select set_config('app.clinic_id', $1, true)", [repositoryScope.clinicId]);
    await client.query("select set_config('app.user_id', $1, true)", [repositoryScope.actorUserId]);
    return await callback(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function phoneForToken(token) {
  const digits = token.replace(/\D/gu, "").padEnd(10, "0").slice(0, 10);
  return `+91${digits}`;
}

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: () => resolvePromise() };
}

function assertLocalRuntimeUrl(connectionString) {
  const parsed = new URL(connectionString);
  if (
    !new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(parsed.hostname) ||
    parsed.pathname !== "/clinic_os" ||
    parsed.username !== "clinic_os_runtime"
  ) {
    throw new Error("Request-guard integration tests require the local runtime database role.");
  }
}
