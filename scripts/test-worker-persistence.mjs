#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import { PostgresOutboxRepository } from "@clinic-os/worker";

const runtimeUrl =
  process.env.DATABASE_URL ??
  "postgresql://clinic_os_runtime:clinic_os_runtime@127.0.0.1:5432/clinic_os";
const workerUrl =
  process.env.WORKER_DATABASE_URL ??
  "postgresql://clinic_os_worker:clinic_os_worker@127.0.0.1:5432/clinic_os";
assertLocalUrl(runtimeUrl, "clinic_os_runtime");
assertLocalUrl(workerUrl, "clinic_os_worker");

const runtimePool = new Pool({ connectionString: runtimeUrl, max: 1 });
const workerPool = new Pool({ connectionString: workerUrl, max: 2 });
const repository = new PostgresOutboxRepository({ pool: workerPool });
const now = new Date();
const processedEventId = randomUUID();
const deadLetterEventId = randomUUID();
const processedType = `cp11.worker.processed.${processedEventId}`;
const deadLetterType = `cp11.worker.dead_letter.${deadLetterEventId}`;

try {
  await insertEvent(runtimePool, processedEventId, processedType, now);
  await insertEvent(runtimePool, deadLetterEventId, deadLetterType, now);

  const firstClaim = await repository.claimDueEvents({
    workerId: "cp11-worker-persistence",
    leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
    batchSize: 1,
    now: now.toISOString(),
    eventTypes: [processedType]
  });
  assert.equal(firstClaim.length, 1);
  assert.equal(firstClaim[0]?.eventId, processedEventId);
  const firstAttempt = await repository.recordAttemptStarted(
    firstClaim[0],
    "cp11-worker-persistence",
    now.toISOString()
  );
  const retryAt = new Date(now.getTime() + 1000).toISOString();
  await repository.scheduleRetry(firstClaim[0], firstAttempt, {
    nextAttemptAt: retryAt,
    failureCode: "CP11_TRANSIENT_PROBE",
    failureMessage: "Synthetic transient worker persistence probe"
  });

  const retryClaim = await repository.claimDueEvents({
    workerId: "cp11-worker-persistence-retry",
    leaseUntil: new Date(now.getTime() + 120_000).toISOString(),
    batchSize: 1,
    now: new Date(now.getTime() + 2000).toISOString(),
    eventTypes: [processedType]
  });
  assert.equal(retryClaim.length, 1);
  const secondAttempt = await repository.recordAttemptStarted(
    retryClaim[0],
    "cp11-worker-persistence-retry",
    new Date(now.getTime() + 2000).toISOString()
  );
  assert.equal(secondAttempt.attemptNumber, 2);
  await repository.markAttemptSucceeded(
    secondAttempt.attemptId,
    new Date(now.getTime() + 2100).toISOString()
  );
  await repository.markProcessed(processedEventId, new Date(now.getTime() + 2100).toISOString());

  const deadLetterClaim = await repository.claimDueEvents({
    workerId: "cp11-worker-persistence",
    leaseUntil: new Date(now.getTime() + 60_000).toISOString(),
    batchSize: 1,
    now: now.toISOString(),
    eventTypes: [deadLetterType]
  });
  assert.equal(deadLetterClaim.length, 1);
  const deadLetterAttempt = await repository.recordAttemptStarted(
    deadLetterClaim[0],
    "cp11-worker-persistence",
    now.toISOString()
  );
  await repository.moveToDeadLetter(deadLetterClaim[0], deadLetterAttempt, {
    failureCode: "CP11_PERMANENT_PROBE",
    failureMessage: "Synthetic permanent worker persistence probe",
    failedAt: new Date(now.getTime() + 100).toISOString(),
    attemptStatus: "failed_permanent"
  });

  const evidence = await workerPool.query(
    `select
       (select status from outbox_events where id = $1) as processed_status,
       (select count(*)::integer from outbox_attempts where event_id = $1) as processed_attempts,
       (select status from outbox_events where id = $2) as dead_letter_status,
       (select count(*)::integer from dead_letter_events where event_id = $2) as dead_letter_rows`,
    [processedEventId, deadLetterEventId]
  );
  assert.deepEqual(evidence.rows[0], {
    processed_status: "processed",
    processed_attempts: 2,
    dead_letter_status: "dead_lettered",
    dead_letter_rows: 1
  });

  console.log(
    JSON.stringify(
      {
        workerLeastPrivilegeRole: "pass",
        durableClaimAndLease: "pass",
        durableRetryAndSecondAttempt: "pass",
        durableProcessedState: "pass",
        durableDeadLetterReviewState: "pass"
      },
      null,
      2
    )
  );
} finally {
  await repository.close();
  await workerPool.end();
  await runtimePool.end();
}

async function insertEvent(pool, eventId, eventType, occurredAt) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [
      CHECKPOINT1_SEED_IDS.tenantId
    ]);
    await client.query("select set_config('app.clinic_id', $1, true)", [
      CHECKPOINT1_SEED_IDS.clinicId
    ]);
    await client.query("select set_config('app.user_id', $1, true)", [
      CHECKPOINT1_SEED_IDS.users.owner
    ]);
    await client.query(
      `insert into outbox_events (
         id, tenant_id, clinic_id, event_type, schema_version, actor_type, actor_id,
         aggregate_type, aggregate_id, idempotency_key, correlation_id, payload, occurred_at
       ) values ($1, $2, $3, $4, '1.0', 'system', $5, 'cp11_worker_probe', $1, $6, $6, '{}'::jsonb, $7)`,
      [
        eventId,
        CHECKPOINT1_SEED_IDS.tenantId,
        CHECKPOINT1_SEED_IDS.clinicId,
        eventType,
        CHECKPOINT1_SEED_IDS.users.owner,
        `cp11-worker-probe:${eventId}`,
        occurredAt.toISOString()
      ]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function assertLocalUrl(connectionString, expectedUser) {
  const parsed = new URL(connectionString);
  assert.equal(new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(parsed.hostname), true);
  assert.equal(parsed.pathname, "/clinic_os");
  assert.equal(parsed.username, expectedUser);
}
