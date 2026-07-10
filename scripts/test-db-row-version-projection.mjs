#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const fixedClock = { now: () => new Date("2026-07-10T12:00:00.000Z") };
const pool = new Pool({ connectionString: databaseUrl, max: 4 });
const unitOfWork = createPostgresClinicModuleUnitOfWork({
  client: pool,
  clock: fixedClock,
  resolveScope: (context) => context.scope
});
const token = randomUUID();
const recallId = randomUUID();
const rollbackRecallId = randomUUID();
let patientId;
let taskId;
let rollbackTaskId;
let recallRuleId;

try {
  const created = await unitOfWork.run({ scope }, async ({ repositories }) => {
    const patient = await repositories.patientAdministration.createPatient({
      fullName: `CP12 Row Version Synthetic ${token}`,
      phone: phoneForToken(token),
      gender: "unknown",
      source: "manual",
      sourceDetail: { evidence: "cp12_row_version_projection" }
    });
    const task = await repositories.continuity.createTask({
      patientId: patient.id,
      taskType: "recall",
      sourceWorkflow: "recall_generation",
      sourceRecordType: "recall",
      sourceRecordId: recallId,
      title: "CP12 linked recall action",
      status: "open",
      idempotencyKey: `cp12-row-version-task-${token}`
    });
    const rollbackTask = await repositories.continuity.createTask({
      patientId: patient.id,
      taskType: "recall",
      sourceWorkflow: "recall_generation",
      sourceRecordType: "recall",
      sourceRecordId: rollbackRecallId,
      title: "CP12 linked recall rollback",
      status: "open",
      idempotencyKey: `cp12-row-version-rollback-task-${token}`
    });
    const rule = await repositories.continuity.createRecallRule({
      code: `CP12-RV-${token}`,
      title: "CP12 row-version regression",
      offsetDays: 180
    });
    return { patient, task, rollbackTask, rule };
  });
  patientId = created.patient.id;
  taskId = created.task.id;
  rollbackTaskId = created.rollbackTask.id;
  recallRuleId = created.rule.id;
  assert.equal(created.patient.rowVersion, 1);
  assert.equal(created.task.rowVersion, 1);
  assert.equal(created.rollbackTask.rowVersion, 1);

  const projectedAfterAdvance = await unitOfWork.run(
    { scope },
    async ({ repositories, requestGuards }) => {
      const before = await repositories.patientAdministration.findPatientById(patientId);
      assert.equal(before?.rowVersion, 1);
      const advanced = await requestGuards.optimisticConcurrency.advanceVersion({
        operationId: "updatePatient",
        resourceId: patientId,
        expectedVersion: 1
      });
      assert.deepEqual(advanced, { outcome: "advanced", rowVersion: 2 });
      return repositories.patientAdministration.findPatientById(patientId);
    }
  );
  assert.equal(projectedAfterAdvance?.rowVersion, 2);

  await withScope(pool, scope, async (client) => {
    await client.query(
      `insert into recalls (
         id, tenant_id, clinic_id, recall_rule_id, patient_id, task_id, status, due_at,
         created_by_user_id, updated_by_user_id
       )
       values
         ($1, $3, $4, $5, $6, $7, 'due', $9, $10, $10),
         ($2, $3, $4, $5, $6, $8, 'due', $9, $10, $10)`,
      [
        recallId,
        rollbackRecallId,
        scope.tenantId,
        scope.clinicId,
        recallRuleId,
        patientId,
        taskId,
        rollbackTaskId,
        "2026-07-10T12:00:00.000Z",
        scope.actorUserId
      ]
    );
  });

  const completedTask = await unitOfWork.run({ scope }, async ({ repositories }) => {
    const recall = await repositories.continuity.recordRecallAction(recallId, {
      actionType: "completed",
      method: "system",
      evidence: { evidence: "cp12_row_version_projection" }
    });
    assert.equal(recall?.status, "completed");
    return repositories.continuity.findTaskById(taskId);
  });
  assert.equal(completedTask?.status, "done");
  assert.equal(completedTask?.rowVersion, 2);

  const repeatedTask = await unitOfWork.run({ scope }, async ({ repositories }) => {
    await repositories.continuity.recordRecallAction(recallId, {
      actionType: "completed",
      method: "system",
      evidence: { evidence: "cp12_row_version_projection" }
    });
    return repositories.continuity.findTaskById(taskId);
  });
  assert.equal(repeatedTask?.rowVersion, 2);

  await assert.rejects(
    unitOfWork.run({ scope }, async ({ repositories }) => {
      await repositories.continuity.recordRecallAction(rollbackRecallId, {
        actionType: "completed",
        method: "system",
        evidence: { evidence: "cp12_row_version_projection" }
      });
      const task = await repositories.continuity.findTaskById(rollbackTaskId);
      assert.equal(task?.status, "done");
      assert.equal(task?.rowVersion, 2);
      throw new Error("CP12_ROW_VERSION_REAL_ROLLBACK");
    }),
    /CP12_ROW_VERSION_REAL_ROLLBACK/u
  );

  const rollbackState = await unitOfWork.run({ scope }, async ({ repositories }) => ({
    task: await repositories.continuity.findTaskById(rollbackTaskId),
    recall: (await repositories.continuity.listRecalls({ patientId, limit: 10 })).find(
      (candidate) => candidate.id === rollbackRecallId
    )
  }));
  assert.equal(rollbackState.task?.status, "open");
  assert.equal(rollbackState.task?.rowVersion, 1);
  assert.equal(rollbackState.recall?.status, "due");

  console.log(
    JSON.stringify(
      {
        createDefaultRowVersion: "pass",
        guardAdvanceProjection: "pass",
        linkedRecallTaskSingleAdvance: "pass",
        linkedRecallTaskRollback: "pass"
      },
      null,
      2
    )
  );
} finally {
  try {
    if (patientId) {
      await withScope(pool, scope, async (client) => {
        await client.query(`delete from recalls where tenant_id = $1 and id = any($2::uuid[])`, [
          scope.tenantId,
          [recallId, rollbackRecallId]
        ]);
        if (taskId || rollbackTaskId) {
          await client.query(`delete from tasks where tenant_id = $1 and id = any($2::uuid[])`, [
            scope.tenantId,
            [taskId, rollbackTaskId].filter(Boolean)
          ]);
        }
        if (recallRuleId) {
          await client.query(`delete from recall_rules where tenant_id = $1 and id = $2`, [
            scope.tenantId,
            recallRuleId
          ]);
        }
        await client.query(
          `delete from patient_timeline_items where tenant_id = $1 and patient_id = $2`,
          [scope.tenantId, patientId]
        );
        await client.query(
          `delete from patient_contacts where tenant_id = $1 and patient_id = $2`,
          [scope.tenantId, patientId]
        );
        await client.query(`delete from patients where tenant_id = $1 and id = $2`, [
          scope.tenantId,
          patientId
        ]);
      });
    }
  } finally {
    await pool.end();
  }
}

async function withScope(targetPool, repositoryScope, callback) {
  const client = await targetPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [repositoryScope.tenantId]);
    await client.query("select set_config('app.clinic_id', $1, true)", [repositoryScope.clinicId]);
    await client.query("select set_config('app.user_id', $1, true)", [repositoryScope.actorUserId]);
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function phoneForToken(value) {
  const digits = value.replace(/\D/gu, "").padEnd(10, "0").slice(0, 10);
  return `+91${digits}`;
}

function assertLocalRuntimeUrl(connectionString) {
  const parsed = new URL(connectionString);
  if (
    !new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(parsed.hostname) ||
    parsed.pathname !== "/clinic_os" ||
    parsed.username !== "clinic_os_runtime"
  ) {
    throw new Error("Row-version integration tests require the local runtime database role.");
  }
}
