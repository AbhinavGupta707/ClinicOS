#!/usr/bin/env node
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import {
  CHECKPOINT1_SEED_IDS,
  PostgresClinicOperationsRepository,
  PostgresClinicUnitOfWork,
  PostgresIdentityRepository
} from "@clinic-os/db";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://clinic_os_runtime:clinic_os_runtime@127.0.0.1:5432/clinic_os";
assertLocalRuntimeUrl(databaseUrl);

const tenantB = {
  tenantId: "20000000-0000-4000-8000-000000000001",
  clinicId: "20000000-0000-4000-8000-000000000101",
  ownerUserId: "20000000-0000-4000-8000-000000001001",
  patientId: "20000000-0000-4000-8000-000000002001"
};
const tenantA = {
  tenantId: CHECKPOINT1_SEED_IDS.tenantId,
  clinicId: CHECKPOINT1_SEED_IDS.clinicId,
  actorUserId: CHECKPOINT1_SEED_IDS.users.owner
};
const tenantBScope = {
  tenantId: tenantB.tenantId,
  clinicId: tenantB.clinicId,
  actorUserId: tenantB.ownerUserId
};
const fixedClock = { now: () => new Date("2026-07-09T12:00:00.000Z") };
const pool = new Pool({ connectionString: databaseUrl, max: 1 });

try {
  const identityRepository = new PostgresIdentityRepository(pool);
  const tenantAIdentity = await identityRepository.findAccessByKeycloakSubject("seed-owner");
  const tenantBIdentity =
    await identityRepository.findAccessByKeycloakSubject("seed-isolation-owner");
  const unknownIdentity = await identityRepository.findAccessByKeycloakSubject(
    "unknown-synthetic-subject"
  );
  assert.equal(tenantAIdentity?.tenant.id, tenantA.tenantId);
  assert.deepEqual(
    tenantAIdentity?.clinics.map((clinic) => clinic.id),
    [tenantA.clinicId]
  );
  assert.deepEqual(
    tenantAIdentity?.roleAssignments.map((role) => role.roleSlug),
    ["owner_admin"]
  );
  assert.equal(tenantBIdentity?.tenant.id, tenantB.tenantId);
  assert.deepEqual(
    tenantBIdentity?.clinics.map((clinic) => clinic.id),
    [tenantB.clinicId]
  );
  assert.equal(unknownIdentity, null);

  const noContext = await pool.query(
    `select
       nullif(current_setting('app.identity_subject', true), '') as identity_subject,
       nullif(current_setting('app.tenant_id', true), '') as tenant_id,
       (select count(*)::integer from clinics) as clinics,
       (select count(*)::integer from memberships) as memberships,
       (select count(*)::integer from patients) as patients`
  );
  assert.deepEqual(noContext.rows[0], {
    identity_subject: null,
    tenant_id: null,
    clinics: 0,
    memberships: 0,
    patients: 0
  });

  const repository = new PostgresClinicOperationsRepository(pool, { clock: fixedClock });
  const tenantAPatients = await repository.listPatients(tenantA);
  const tenantBPatients = await repository.listPatients(tenantBScope);
  assert.equal(
    tenantAPatients.some((patient) => patient.id === CHECKPOINT1_SEED_IDS.patients.rheaSynthetic),
    true,
    "tenant A must retain its canonical synthetic seed patient"
  );
  assert.equal(
    tenantAPatients.some((patient) => patient.id === tenantB.patientId),
    false,
    "tenant A repository scope must never expose tenant B's patient"
  );
  assert.deepEqual(
    tenantBPatients.map((patient) => patient.id),
    [tenantB.patientId]
  );
  assert.equal(
    await repository.findPatientById(tenantA, tenantB.patientId),
    null,
    "tenant A repository scope must not read tenant B's patient"
  );

  const unitOfWork = new PostgresClinicUnitOfWork(pool, { clock: fixedClock });
  const successToken = randomUUID();
  const successName = `CP11 Atomic Success ${successToken}`;
  const successCorrelation = `cp11-success-${successToken}`;
  const successAuditId = randomUUID();
  let successPatientId;
  await unitOfWork.run(async ({ repository: transactionRepository, auditSink }) => {
    const patient = await transactionRepository.createPatient(tenantA, {
      fullName: successName,
      phone: phoneForToken(successToken),
      gender: "unknown",
      source: "manual",
      sourceDetail: { evidence: "cp11_atomicity" }
    });
    successPatientId = patient.id;
    await auditSink.appendAuditEvent({
      id: successAuditId,
      tenantId: tenantA.tenantId,
      clinicId: tenantA.clinicId,
      actorType: "user",
      actorId: tenantA.actorUserId,
      action: "patient.created",
      category: "clinical",
      riskLevel: "medium",
      phiInvolved: true,
      resourceType: "patient",
      resourceId: patient.id,
      patientId: patient.id,
      metadata: { evidence: "cp11_atomicity" },
      ipAddress: null,
      userAgent: "cp11-repository-test",
      correlationId: successCorrelation,
      occurredAt: fixedClock.now().toISOString()
    });
    const outboxEvent = {
      eventType: "patient.created",
      aggregateType: "patient",
      aggregateId: patient.id,
      patientId: patient.id,
      idempotencyKey: successCorrelation,
      correlationId: successCorrelation,
      payload: { patientId: patient.id, evidence: "cp11_atomicity" },
      occurredAt: fixedClock.now().toISOString()
    };
    await transactionRepository.appendOutboxEvent(tenantA, outboxEvent);
    await transactionRepository.appendOutboxEvent(tenantA, outboxEvent);
  });

  const committed = await withScope(pool, tenantA, async (client) =>
    client.query(
      `select
         (select count(*)::integer from patients where id = $1 and full_name = $2) as domain_writes,
         (select count(*)::integer from audit_events where id = $3 and correlation_id = $4) as audit_writes,
         (select count(*)::integer from outbox_events where idempotency_key = $4) as outbox_writes,
         (select count(*)::integer from patient_timeline_items where patient_id = $1) as timeline_writes`,
      [successPatientId, successName, successAuditId, successCorrelation]
    )
  );
  assert.deepEqual(committed.rows[0], {
    domain_writes: 1,
    audit_writes: 1,
    outbox_writes: 1,
    timeline_writes: 1
  });

  const rollbackToken = randomUUID();
  const rollbackName = `CP11 Atomic Rollback ${rollbackToken}`;
  const rollbackCorrelation = `cp11-rollback-${rollbackToken}`;
  const rollbackAuditId = randomUUID();
  let rollbackPatientId;
  await assert.rejects(
    unitOfWork.run(async ({ repository: transactionRepository, auditSink }) => {
      const patient = await transactionRepository.createPatient(tenantA, {
        fullName: rollbackName,
        phone: phoneForToken(rollbackToken),
        gender: "unknown",
        source: "manual",
        sourceDetail: { evidence: "cp11_forced_rollback" }
      });
      rollbackPatientId = patient.id;
      await auditSink.appendAuditEvent({
        id: rollbackAuditId,
        tenantId: tenantA.tenantId,
        clinicId: tenantA.clinicId,
        actorType: "user",
        actorId: tenantA.actorUserId,
        action: "patient.created",
        category: "clinical",
        riskLevel: "medium",
        phiInvolved: true,
        resourceType: "patient",
        resourceId: patient.id,
        patientId: patient.id,
        metadata: { evidence: "cp11_forced_rollback" },
        ipAddress: null,
        userAgent: "cp11-repository-test",
        correlationId: rollbackCorrelation,
        occurredAt: fixedClock.now().toISOString()
      });
      await transactionRepository.appendOutboxEvent(tenantA, {
        eventType: "patient.created",
        aggregateType: "patient",
        aggregateId: patient.id,
        patientId: patient.id,
        idempotencyKey: rollbackCorrelation,
        correlationId: rollbackCorrelation,
        payload: { patientId: patient.id, evidence: "cp11_forced_rollback" },
        occurredAt: fixedClock.now().toISOString()
      });
      throw new Error("CP11_FORCED_ROLLBACK");
    }),
    /CP11_FORCED_ROLLBACK/u
  );

  const rolledBack = await withScope(pool, tenantA, async (client) =>
    client.query(
      `select
         (select count(*)::integer from patients where id = $1) as domain_writes,
         (select count(*)::integer from audit_events where id = $2) as audit_writes,
         (select count(*)::integer from outbox_events where idempotency_key = $3) as outbox_writes,
         (select count(*)::integer from patient_timeline_items where patient_id = $1) as timeline_writes`,
      [rollbackPatientId, rollbackAuditId, rollbackCorrelation]
    )
  );
  assert.deepEqual(rolledBack.rows[0], {
    domain_writes: 0,
    audit_writes: 0,
    outbox_writes: 0,
    timeline_writes: 0
  });

  const crossTenantConstraintDenied = await crossTenantForeignKeyProbe(pool);
  assert.equal(crossTenantConstraintDenied, true);

  const postOperationsContext = await pool.query(
    `select
       nullif(current_setting('app.identity_subject', true), '') as identity_subject,
       nullif(current_setting('app.tenant_id', true), '') as tenant_id,
       (select count(*)::integer from patients) as patients`
  );
  assert.deepEqual(postOperationsContext.rows[0], {
    identity_subject: null,
    tenant_id: null,
    patients: 0
  });

  console.log(
    JSON.stringify(
      {
        identityBootstrapIsolation: "pass",
        pooledContextReset: "pass",
        repositoryTenantIsolation: "pass",
        domainAuditOutboxCommit: "pass",
        domainAuditOutboxRollback: "pass",
        outboxIdempotency: "pass",
        crossTenantForeignKey: "pass"
      },
      null,
      2
    )
  );
} finally {
  await pool.end();
}

async function withScope(targetPool, scope, callback) {
  const client = await targetPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [scope.tenantId]);
    await client.query("select set_config('app.clinic_id', $1, true)", [scope.clinicId]);
    await client.query("select set_config('app.user_id', $1, true)", [scope.actorUserId]);
    return await callback(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

async function crossTenantForeignKeyProbe(targetPool) {
  const client = await targetPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantA.tenantId]);
    await client.query("select set_config('app.clinic_id', $1, true)", [tenantA.clinicId]);
    await client.query("select set_config('app.user_id', $1, true)", [tenantA.actorUserId]);
    try {
      await client.query(
        `insert into patient_contacts
           (tenant_id, clinic_id, patient_id, contact_type, value, normalized_value, source)
         values ($1, $2, $3, 'phone', '+919999999999', '919999999999', 'manual')`,
        [tenantA.tenantId, tenantA.clinicId, tenantB.patientId]
      );
      return false;
    } catch (error) {
      return error?.code === "23503";
    }
  } finally {
    await client.query("rollback");
    client.release();
  }
}

function assertLocalRuntimeUrl(connectionString) {
  const parsed = new URL(connectionString);
  if (
    !new Set(["127.0.0.1", "localhost", "[::1]", "::1"]).has(parsed.hostname) ||
    parsed.pathname !== "/clinic_os" ||
    parsed.username !== "clinic_os_runtime"
  ) {
    throw new Error(
      "Repository integration tests require the local clinic_os_runtime database role."
    );
  }
}

function phoneForToken(token) {
  const digits = token.replace(/\D/gu, "").padEnd(10, "0").slice(0, 10);
  return `+91${digits}`;
}
