#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { Pool } from "pg";
import { testCurrentSessionAuthority } from "./test-session-authority.mjs";
import { testIssuerBoundIdentityBootstrap } from "./test-identity-bootstrap.mjs";
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
const identityIssuer = "http://localhost:8080/realms/clinic-os-local";
const fixedClock = { now: () => new Date("2026-07-09T12:00:00.000Z") };
const pool = new Pool({ connectionString: databaseUrl, max: 3 });

try {
  const identityRepository = new PostgresIdentityRepository(pool);
  const tenantAIdentity = await identityRepository.findAccessByKeycloakIdentity({
    issuer: identityIssuer,
    subject: "seed-owner"
  });
  const tenantBIdentity = await identityRepository.findAccessByKeycloakIdentity({
    issuer: identityIssuer,
    subject: "seed-isolation-owner"
  });
  const unknownIdentity = await identityRepository.findAccessByKeycloakIdentity({
    issuer: identityIssuer,
    subject: "unknown-synthetic-subject"
  });
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
  assert.equal(
    await identityRepository.findAccessByKeycloakIdentity({
      issuer: "https://unregistered.example/realms/clinic-os",
      subject: "seed-owner"
    }),
    null
  );
  await testIssuerBoundIdentityBootstrap(pool);
  await testCurrentSessionAuthority(pool);

  const noContext = await pool.query(
    `select
       nullif(current_setting('app.identity_subject', true), '') as identity_subject,
       nullif(current_setting('app.identity_issuer', true), '') as identity_issuer,
       nullif(current_setting('app.tenant_id', true), '') as tenant_id,
       (select count(*)::integer from clinics) as clinics,
       (select count(*)::integer from memberships) as memberships,
       (select count(*)::integer from patients) as patients`
  );
  assert.deepEqual(noContext.rows[0], {
    identity_subject: null,
    identity_issuer: null,
    tenant_id: null,
    clinics: 0,
    memberships: 0,
    patients: 0
  });

  const repository = new PostgresClinicOperationsRepository(pool, {
    clock: fixedClock,
    dueGenerationCursorSecret: "repository-test-cursor-signing-secret-000000000001"
  });
  const tenantAClinicDoctors = await repository.listClinicDoctors(tenantA);
  assert.deepEqual(tenantAClinicDoctors, [
    {
      tenantId: tenantA.tenantId,
      clinicId: tenantA.clinicId,
      providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
      displayName: "Dr Kabir Doctor"
    }
  ]);
  assert.deepEqual(
    await repository.listClinicDoctors(tenantBScope),
    [],
    "clinic doctor lookup must not cross tenant or clinic scope"
  );
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

  await assert.rejects(
    unitOfWork.run(async ({ repository: transactionRepository }) => {
      const token = randomUUID();
      const externalRecordId = `repository-replay-${token}`;
      const normalizedRecord = {
        recordType: "patient",
        externalReference: externalRecordId,
        fullName: `Repository Replay ${token}`,
        phone: phoneForToken(token),
        normalizedPhone: phoneForToken(token).replace(/\D/gu, ""),
        email: null,
        dateOfBirth: null,
        gender: "unknown",
        source: "imported",
        sourceDetail: { originalSource: "manual" }
      };
      const migrationRow = {
        rowNumber: 1,
        importType: "patients",
        externalRecordId,
        rawPayload: { externalRecordId },
        rawPayloadDigest: sha256({ externalRecordId }),
        normalizedRecord,
        validationErrors: [],
        status: "ready_to_commit",
        matchStatus: "none",
        conflicts: []
      };
      const firstBatch = await transactionRepository.createMigrationBatch(tenantA, {
        importType: "patients",
        sourceSystem: "repository_replay_test",
        sourceFileName: "synthetic-patients.json",
        sourceChecksum: sha256({ token, batch: 1 }),
        state: "ready_to_commit",
        rows: [migrationRow]
      });
      const firstCommit = await transactionRepository.commitMigrationBatch(
        tenantA,
        firstBatch.batch.id,
        { idempotencyKey: `repository-first-${token}` }
      );
      assert.ok(firstCommit);
      const firstPatientId = firstCommit.rows[0]?.committedRecordId;
      assert.ok(firstPatientId);
      const links = await transactionRepository.listImportedRecordLinksByExternalIds(tenantA, {
        sourceSystem: "repository_replay_test",
        targetRecordType: "patient",
        externalRecordIds: [externalRecordId]
      });
      assert.equal(links.length, 1);
      assert.equal(links[0]?.targetRecordId, firstPatientId);

      const replayBatch = await transactionRepository.createMigrationBatch(tenantA, {
        importType: "patients",
        sourceSystem: "repository_replay_test",
        sourceFileName: "synthetic-patients-replay.json",
        sourceChecksum: sha256({ token, batch: 2 }),
        state: "ready_to_commit",
        rows: [{ ...migrationRow, matchStatus: "resolved" }]
      });
      const replayCommit = await transactionRepository.commitMigrationBatch(
        tenantA,
        replayBatch.batch.id,
        { idempotencyKey: `repository-replay-${token}` }
      );
      assert.ok(replayCommit);
      assert.equal(replayCommit.rows[0]?.committedRecordId, firstPatientId);
      assert.equal(replayCommit.commit.summary.reconciledRows, 1);
      assert.equal(replayCommit.importedRecordLinks.length, 0);

      const appointment = await transactionRepository.createAppointment(tenantA, {
        patientId: firstPatientId,
        providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
        appointmentTypeId: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
        chairId: null,
        status: "booked",
        startAt: "2099-01-01T09:00:00.000Z",
        endAt: "2099-01-01T09:30:00.000Z",
        source: "manual",
        reason: "Repository clinic-day projection test"
      });
      const overflowLeads = [];
      const overflowTasks = [];
      for (let index = 0; index < 51; index += 1) {
        overflowLeads.push(
          await transactionRepository.createLead(tenantA, {
            primaryContact: `+91980000${String(index).padStart(4, "0")}`,
            intent: "appointment_request",
            source: "manual",
            sourceDetail: { syntheticProbe: token, index }
          })
        );
        overflowTasks.push(
          await transactionRepository.createTask(tenantA, {
            taskType: "manual",
            sourceWorkflow: "manual",
            title: `Clinic-day bounded-list probe ${index}`,
            dueAt: "2099-01-01T10:00:00.000Z",
            idempotencyKey: `repository-dashboard-${token}-${index}`
          })
        );
      }
      const dashboard = await transactionRepository.loadDashboardData(tenantA, "2099-01-01");
      assert.equal(dashboard.clinicDayAppointments.length, 1);
      assert.equal(dashboard.leads.length > 50, true);
      assert.equal(dashboard.tasks.length > 50, true);
      const dashboardLeadIds = new Set(dashboard.leads.map((lead) => lead.id));
      const dashboardTaskIds = new Set(dashboard.tasks.map((task) => task.id));
      assert.equal(
        overflowLeads.every((lead) => dashboardLeadIds.has(lead.id)),
        true
      );
      assert.equal(
        overflowTasks.every((task) => dashboardTaskIds.has(task.id)),
        true
      );
      assert.deepEqual(dashboard.clinicDayAppointments[0], {
        id: appointment.id,
        rowVersion: appointment.rowVersion,
        patientId: firstPatientId,
        patientName: normalizedRecord.fullName,
        patientPhone: normalizedRecord.phone,
        patientKind: "new",
        providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
        providerName: "Dr Kabir Doctor",
        appointmentTypeId: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
        appointmentTypeName: "Consultation",
        chairId: null,
        chairName: null,
        status: "booked",
        startAt: "2099-01-01T09:00:00.000Z",
        endAt: "2099-01-01T09:30:00.000Z",
        source: "manual",
        reason: "Repository clinic-day projection test",
        queueEntryId: null,
        queueStatus: null,
        queuePosition: null,
        checkedInAt: null,
        updatedAt: appointment.updatedAt
      });
      throw new Error("REPOSITORY_MVP_SLICE_ROLLBACK");
    }),
    /REPOSITORY_MVP_SLICE_ROLLBACK/u
  );
  assert.equal(await concurrentMigrationReplayProbe(repository, tenantA, pool), true);
  for (const linkExistingPatient of [false, true]) {
    assert.equal(
      await sourceIndependentMigrationProbe(repository, tenantA, pool, linkExistingPatient),
      true
    );
  }
  assert.equal(await concurrentBatchCommitRollbackProbe(repository, tenantA, pool), true);
  assert.equal(await concurrentReconciliationRollbackProbe(repository, tenantA, pool), true);

  const postOperationsContext = await pool.query(
    `select
       nullif(current_setting('app.identity_subject', true), '') as identity_subject,
       nullif(current_setting('app.identity_issuer', true), '') as identity_issuer,
       nullif(current_setting('app.tenant_id', true), '') as tenant_id,
       (select count(*)::integer from patients) as patients`
  );
  assert.deepEqual(postOperationsContext.rows[0], {
    identity_subject: null,
    identity_issuer: null,
    tenant_id: null,
    patients: 0
  });

  console.log(
    JSON.stringify(
      {
        identityBootstrapIsolation: "pass",
        issuerBoundReadOnlyBootstrap: "pass",
        pooledContextReset: "pass",
        repositoryTenantIsolation: "pass",
        domainAuditOutboxCommit: "pass",
        domainAuditOutboxRollback: "pass",
        outboxIdempotency: "pass",
        crossTenantForeignKey: "pass",
        migrationReplayReconciliation: "pass",
        concurrentMigrationReplay: "pass",
        sourceIndependentMigration: "pass",
        concurrentBatchCommitRollback: "pass",
        concurrentReconciliationRollback: "pass",
        clinicDayProjection: "pass"
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

function sha256(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function concurrentMigrationReplayProbe(repository, scope, connectionPool) {
  const token = randomUUID();
  const sourceSystem = "repository_concurrent_replay_test";
  const externalRecordId = `repository-concurrent-${token}`;
  const phone = phoneForToken(token);
  const normalizedRecord = {
    recordType: "patient",
    externalReference: externalRecordId,
    fullName: `Concurrent Replay ${token}`,
    phone,
    normalizedPhone: phone.replace(/\D/gu, ""),
    email: null,
    dateOfBirth: null,
    gender: "unknown",
    source: "imported",
    sourceDetail: { originalSource: "manual" }
  };
  const row = {
    rowNumber: 1,
    importType: "patients",
    externalRecordId,
    rawPayload: { externalRecordId },
    rawPayloadDigest: sha256({ externalRecordId }),
    normalizedRecord,
    validationErrors: [],
    status: "ready_to_commit",
    matchStatus: "none",
    conflicts: []
  };
  const batches = await Promise.all(
    [1, 2].map((batchNumber) =>
      repository.createMigrationBatch(scope, {
        importType: "patients",
        sourceSystem,
        sourceFileName: `concurrent-${batchNumber}.json`,
        sourceChecksum: sha256({ token, batchNumber }),
        state: "ready_to_commit",
        rows: [row]
      })
    )
  );
  const blockingClient = await connectionPool.connect();
  let commitPromises = [];
  try {
    await blockingClient.query("begin");
    const lockKey = JSON.stringify([
      scope.tenantId,
      scope.clinicId,
      sourceSystem,
      externalRecordId,
      "patient"
    ]);
    await blockingClient.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [
      lockKey
    ]);
    commitPromises = batches.map((batch, index) =>
      repository.commitMigrationBatch(scope, batch.batch.id, {
        idempotencyKey: `repository-concurrent-${token}-${index + 1}`
      })
    );

    let observedWaitingCommit = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const waiting = await blockingClient.query(
        "select exists (select 1 from pg_locks where locktype = 'advisory' and not granted) as waiting"
      );
      if (waiting.rows[0]?.waiting === true) {
        observedWaitingCommit = true;
        break;
      }
      await delay(10);
    }
    assert.equal(observedWaitingCommit, true);
    await blockingClient.query("commit");
  } catch (error) {
    await blockingClient.query("rollback");
    await Promise.allSettled(commitPromises);
    throw error;
  } finally {
    blockingClient.release();
  }

  const commits = await Promise.all(commitPromises);
  assert.ok(commits[0]);
  assert.ok(commits[1]);
  const patientIds = commits.map((commit) => commit.rows[0]?.committedRecordId);
  assert.ok(patientIds[0]);
  assert.equal(patientIds[1], patientIds[0]);
  assert.equal(
    commits.reduce((total, commit) => total + Number(commit.commit.summary.reconciledRows ?? 0), 0),
    1
  );
  assert.equal(
    commits.reduce((total, commit) => total + commit.importedRecordLinks.length, 0),
    1
  );

  const originIndex = commits.findIndex((commit) => commit.importedRecordLinks.length === 1);
  assert.notEqual(originIndex, -1);
  const replayIndex = originIndex === 0 ? 1 : 0;
  const replayRollback = await repository.rollbackMigrationBatch(
    scope,
    batches[replayIndex].batch.id,
    { idempotencyKey: `repository-concurrent-replay-rollback-${token}` }
  );
  assert.ok(replayRollback);
  assert.equal(replayRollback.rows[0]?.status, "rolled_back");
  assert.ok(await repository.findPatientById(scope, patientIds[0]));

  const originRollback = await repository.rollbackMigrationBatch(
    scope,
    batches[originIndex].batch.id,
    { idempotencyKey: `repository-concurrent-origin-rollback-${token}` }
  );
  assert.ok(originRollback);
  assert.equal(originRollback.batch.state, "rolled_back");
  assert.equal(await repository.findPatientById(scope, patientIds[0]), null);
  assert.deepEqual(
    await repository.listImportedRecordLinksByExternalIds(scope, {
      sourceSystem,
      targetRecordType: "patient",
      externalRecordIds: [externalRecordId]
    }),
    []
  );
  return true;
}

async function sourceIndependentMigrationProbe(
  repository,
  scope,
  connectionPool,
  linkExistingPatient
) {
  const token = randomUUID();
  const sourceSystem = `repository_source_independent_${token}`;
  for (const importType of ["patients", "practitioners", "appointments"]) {
    await assert.rejects(
      repository.createMigrationBatch(scope, {
        importType,
        sourceSystem,
        state: "ready_to_commit",
        rows: [
          {
            rowNumber: 1,
            importType,
            externalRecordId: null,
            rawPayload: {},
            rawPayloadDigest: sha256({ token, importType, case: "missing-external-id" }),
            normalizedRecord: null,
            validationErrors: [],
            status: "ready_to_commit",
            matchStatus: "none",
            conflicts: []
          }
        ]
      }),
      /requires a stable external record identifier/u
    );
  }
  const practitionerExternalId = `practitioner-${token}`;
  const patientExternalId = `patient-${token}`;
  const appointmentExternalId = `appointment-${token}`;
  const practitionerRecord = {
    recordType: "provider_user",
    externalReference: practitionerExternalId,
    displayName: "Repository External Doctor",
    email: null,
    phone: null,
    sourceDetail: { originalSource: "practo" }
  };
  const practitionerBatch = await repository.createMigrationBatch(scope, {
    importType: "practitioners",
    sourceSystem,
    sourceFileName: "synthetic-practitioners.json",
    sourceChecksum: sha256({ token, type: "practitioners" }),
    state: "needs_review",
    rows: [
      {
        rowNumber: 1,
        importType: "practitioners",
        externalRecordId: practitionerExternalId,
        rawPayload: practitionerRecord,
        rawPayloadDigest: sha256(practitionerRecord),
        normalizedRecord: practitionerRecord,
        validationErrors: [],
        status: "needs_review",
        matchStatus: "conflict",
        conflicts: [
          {
            conflictType: "invalid_reference",
            severity: "blocking",
            targetRecordType: "provider_user",
            fieldName: "externalReference",
            summary: "Map this external practitioner to an existing eligible ClinicOS doctor."
          }
        ]
      }
    ]
  });
  const practitionerRow = practitionerBatch.rows[0];
  assert.ok(practitionerRow);
  assert.ok(
    await repository.resolveMigrationRow(scope, practitionerBatch.batch.id, practitionerRow.id, {
      action: "link_existing",
      targetRecordType: "provider_user",
      targetRecordId: CHECKPOINT1_SEED_IDS.users.doctor,
      note: "Repository integration probe mapping."
    })
  );
  const practitionerCommit = await repository.commitMigrationBatch(
    scope,
    practitionerBatch.batch.id,
    { idempotencyKey: `source-independent-practitioner-${token}` }
  );
  assert.equal(practitionerCommit?.importedRecordLinks[0]?.linkType, "linked_existing");

  const unresolvedAppointmentRecord = {
    recordType: "appointment",
    externalReference: `unresolved-${appointmentExternalId}`,
    patientExternalReference: patientExternalId,
    providerExternalReference: practitionerExternalId,
    appointmentTypeCode: "consultation",
    chairCode: null,
    startAt: "2099-01-31T09:00:00.000Z",
    endAt: "2099-01-31T09:30:00.000Z",
    status: "booked",
    source: "practo",
    reason: null,
    notes: null,
    sourceDetail: { originalSource: "practo" }
  };
  const unresolvedAppointmentBatch = await repository.createMigrationBatch(scope, {
    importType: "appointments",
    sourceSystem,
    sourceFileName: "synthetic-unresolved-appointment.json",
    sourceChecksum: sha256({ token, type: "unresolved-appointment" }),
    state: "needs_review",
    rows: [
      {
        ...migrationReadyRow(
          "appointments",
          unresolvedAppointmentRecord.externalReference,
          unresolvedAppointmentRecord
        ),
        status: "needs_review",
        matchStatus: "conflict",
        conflicts: [
          {
            conflictType: "invalid_reference",
            severity: "blocking",
            targetRecordType: "patient",
            fieldName: "patientExternalReference",
            summary: "The appointment patient reference has no active ClinicOS patient mapping."
          }
        ]
      }
    ]
  });
  assert.equal(
    await repository.resolveMigrationRow(
      scope,
      unresolvedAppointmentBatch.batch.id,
      unresolvedAppointmentBatch.rows[0].id,
      {
        action: "create_new",
        targetRecordType: null,
        targetRecordId: null,
        note: "A generic action must not bypass unresolved appointment dependencies."
      }
    ),
    null
  );
  assert.equal(
    (await repository.listMigrationRows(scope, unresolvedAppointmentBatch.batch.id))[0]?.status,
    "needs_review"
  );

  const phone = phoneForToken(token);
  const patientRecord = {
    recordType: "patient",
    externalReference: patientExternalId,
    fullName: `Source Independent ${token}`,
    phone,
    normalizedPhone: phone.replace(/\D/gu, ""),
    email: null,
    dateOfBirth: null,
    gender: "unknown",
    source: "imported",
    sourceDetail: { originalSource: "practo" }
  };
  const patientBatch = await repository.createMigrationBatch(scope, {
    importType: "patients",
    sourceSystem,
    sourceFileName: "synthetic-patients.json",
    sourceChecksum: sha256({ token, type: "patients" }),
    state: linkExistingPatient ? "needs_review" : "ready_to_commit",
    rows: [
      {
        ...migrationReadyRow("patients", patientExternalId, patientRecord),
        ...(linkExistingPatient
          ? {
              status: "needs_review",
              matchStatus: "duplicate_candidate",
              conflicts: [
                {
                  conflictType: "duplicate_patient",
                  severity: "blocking",
                  targetRecordType: "patient",
                  targetRecordId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
                  summary: "Synthetic candidate for the link-only rollback probe."
                }
              ]
            }
          : {})
      }
    ]
  });
  if (linkExistingPatient) {
    const unrelated = await repository.createPatient(scope, {
      fullName: `Unrelated Review Candidate ${token}`,
      phone: phoneForToken(randomUUID()),
      gender: "unknown",
      source: "manual",
      sourceDetail: { evidence: "candidate_guard" }
    });
    assert.equal(
      await repository.resolveMigrationRow(scope, patientBatch.batch.id, patientBatch.rows[0].id, {
        action: "link_existing",
        targetRecordType: "patient",
        targetRecordId: unrelated.id
      }),
      null,
      "an existing patient outside this row's reviewed candidates must be rejected"
    );
    assert.equal(
      (await repository.listMigrationRows(scope, patientBatch.batch.id))[0]?.status,
      "needs_review"
    );
    assert.ok(
      await repository.resolveMigrationRow(scope, patientBatch.batch.id, patientBatch.rows[0].id, {
        action: "link_existing",
        targetRecordType: "patient",
        targetRecordId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
        note: "Verify link-only patient dependency protection."
      })
    );
  }
  const patientCommit = await repository.commitMigrationBatch(scope, patientBatch.batch.id, {
    idempotencyKey: `source-independent-patient-${token}`
  });
  const patientId = patientCommit?.rows[0]?.committedRecordId;
  assert.ok(patientId);

  const appointmentRecord = {
    recordType: "appointment",
    externalReference: appointmentExternalId,
    patientExternalReference: patientExternalId,
    providerExternalReference: practitionerExternalId,
    appointmentTypeCode: "consultation",
    chairCode: null,
    startAt: "2099-02-01T09:00:00.000Z",
    endAt: "2099-02-01T09:30:00.000Z",
    status: "booked",
    source: "practo",
    reason: null,
    notes: null,
    sourceDetail: { originalSource: "practo" }
  };
  const appointmentBatch = await repository.createMigrationBatch(scope, {
    importType: "appointments",
    sourceSystem,
    sourceFileName: "synthetic-appointments.json",
    sourceChecksum: sha256({ token, type: "appointments" }),
    state: "ready_to_commit",
    rows: [migrationReadyRow("appointments", appointmentExternalId, appointmentRecord)]
  });
  const blockingClient = await connectionPool.connect();
  let appointmentCommitPromise;
  let practitionerRollbackPromise;
  try {
    await blockingClient.query("begin");
    const dependencyLockKey = JSON.stringify([
      scope.tenantId,
      scope.clinicId,
      sourceSystem,
      linkExistingPatient ? patientExternalId : practitionerExternalId,
      linkExistingPatient ? "patient" : "provider_user"
    ]);
    await blockingClient.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [
      dependencyLockKey
    ]);
    appointmentCommitPromise = repository.commitMigrationBatch(scope, appointmentBatch.batch.id, {
      idempotencyKey: `source-independent-appointment-${token}`
    });
    await waitForAdvisoryLockWaiters(blockingClient, 1);
    practitionerRollbackPromise = repository.rollbackMigrationBatch(
      scope,
      linkExistingPatient ? patientBatch.batch.id : practitionerBatch.batch.id,
      { idempotencyKey: `source-independent-reference-blocked-${token}` }
    );
    await waitForAdvisoryLockWaiters(blockingClient, 2);
    await blockingClient.query("commit");
  } catch (error) {
    await blockingClient.query("rollback");
    await Promise.allSettled(
      [appointmentCommitPromise, practitionerRollbackPromise].filter(Boolean)
    );
    throw error;
  } finally {
    blockingClient.release();
  }
  const [appointmentCommit, blockedPractitionerRollback] = await Promise.all([
    appointmentCommitPromise,
    practitionerRollbackPromise
  ]);
  const appointmentId = appointmentCommit?.rows[0]?.committedRecordId;
  assert.ok(appointmentId);
  const appointment = await repository.findAppointmentById(scope, appointmentId);
  assert.equal(appointment?.patientId, patientId);
  assert.equal(appointment?.providerUserId, CHECKPOINT1_SEED_IDS.users.doctor);
  assert.equal(blockedPractitionerRollback?.batch.state, "partially_committed");
  assert.equal(blockedPractitionerRollback?.blockedLinks.length, 1);

  const blockedPatientRollback = await repository.rollbackMigrationBatch(
    scope,
    patientBatch.batch.id,
    {
      idempotencyKey: `source-independent-patient-blocked-again-${token}`
    }
  );
  assert.equal(blockedPatientRollback?.blockedLinks.length, 1);
  assert.match(
    String(blockedPatientRollback.blockedLinks[0].metadata.rollbackBlockedReason),
    /patient mapping/
  );
  assert.equal(typeof blockedPatientRollback.blockedLinks[0].metadata.rollbackBlockedAt, "string");
  const blockedPatientRetry = await repository.rollbackMigrationBatch(
    scope,
    patientBatch.batch.id,
    { idempotencyKey: `source-independent-patient-blocked-again-${token}` }
  );
  assert.deepEqual(
    blockedPatientRetry?.blockedLinks,
    blockedPatientRollback.blockedLinks,
    "the first blocked response must include the same persisted explanation as its retry"
  );
  const retainedLinks = await repository.listImportedRecordLinksByExternalIds(scope, {
    sourceSystem,
    targetRecordType: "patient",
    externalRecordIds: [patientExternalId]
  });
  assert.equal(retainedLinks[0]?.targetRecordId, patientId);

  const appointmentRollback = await repository.rollbackMigrationBatch(
    scope,
    appointmentBatch.batch.id,
    { idempotencyKey: `source-independent-appointment-rollback-${token}` }
  );
  assert.equal(appointmentRollback?.batch.state, "rolled_back");
  assert.equal(await repository.findAppointmentById(scope, appointmentId), null);
  const patientRollback = await repository.rollbackMigrationBatch(scope, patientBatch.batch.id, {
    idempotencyKey: `source-independent-patient-rollback-${token}`
  });
  assert.equal(patientRollback?.batch.state, "rolled_back");
  assert.equal(Boolean(await repository.findPatientById(scope, patientId)), linkExistingPatient);
  const practitionerRollback = await repository.rollbackMigrationBatch(
    scope,
    practitionerBatch.batch.id,
    { idempotencyKey: `source-independent-practitioner-rollback-${token}` }
  );
  assert.equal(practitionerRollback?.batch.state, "rolled_back");
  return true;
}

async function concurrentBatchCommitRollbackProbe(repository, scope, connectionPool) {
  const token = randomUUID();
  const sourceSystem = `repository_batch_transition_${token}`;
  const externalRecordId = `batch-transition-${token}`;
  const phone = phoneForToken(token);
  const normalizedRecord = {
    recordType: "patient",
    externalReference: externalRecordId,
    fullName: `Batch Transition ${token}`,
    phone,
    normalizedPhone: phone.replace(/\D/gu, ""),
    email: null,
    dateOfBirth: null,
    gender: "unknown",
    source: "imported",
    sourceDetail: { originalSource: "manual" }
  };
  const batch = await repository.createMigrationBatch(scope, {
    importType: "patients",
    sourceSystem,
    sourceFileName: "batch-transition.json",
    sourceChecksum: sha256({ token }),
    state: "ready_to_commit",
    rows: [migrationReadyRow("patients", externalRecordId, normalizedRecord)]
  });
  const blockingClient = await connectionPool.connect();
  let commitPromise;
  let rollbackPromise;
  try {
    await blockingClient.query("begin");
    const lockKey = JSON.stringify([
      scope.tenantId,
      scope.clinicId,
      sourceSystem,
      externalRecordId,
      "patient"
    ]);
    await blockingClient.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [
      lockKey
    ]);
    commitPromise = repository.commitMigrationBatch(scope, batch.batch.id, {
      idempotencyKey: `batch-transition-commit-${token}`
    });
    await waitForAdvisoryLockWaiters(blockingClient, 1);
    rollbackPromise = repository.rollbackMigrationBatch(scope, batch.batch.id, {
      idempotencyKey: `batch-transition-rollback-${token}`
    });
    await delay(20);
    await blockingClient.query("commit");
  } catch (error) {
    await blockingClient.query("rollback");
    await Promise.allSettled([commitPromise, rollbackPromise].filter(Boolean));
    throw error;
  } finally {
    blockingClient.release();
  }
  const [commit, rollback] = await Promise.all([commitPromise, rollbackPromise]);
  assert.ok(commit);
  assert.ok(rollback);
  const committedPatientId = commit.rows[0]?.committedRecordId;
  assert.ok(committedPatientId);
  assert.equal(rollback.batch.state, "rolled_back");
  assert.equal(await repository.findPatientById(scope, committedPatientId), null);
  return true;
}

async function concurrentReconciliationRollbackProbe(repository, scope, connectionPool) {
  const token = randomUUID();
  const sourceSystem = `repository_reconciliation_rollback_${token}`;
  const externalRecordId = `reconciliation-rollback-${token}`;
  const phone = phoneForToken(token);
  const normalizedRecord = {
    recordType: "patient",
    externalReference: externalRecordId,
    fullName: `Reconciliation Rollback ${token}`,
    phone,
    normalizedPhone: phone.replace(/\D/gu, ""),
    email: null,
    dateOfBirth: null,
    gender: "unknown",
    source: "imported",
    sourceDetail: { originalSource: "manual" }
  };
  const initialBatch = await repository.createMigrationBatch(scope, {
    importType: "patients",
    sourceSystem,
    sourceFileName: "reconciliation-rollback-initial.json",
    sourceChecksum: sha256({ token, batch: "initial" }),
    state: "ready_to_commit",
    rows: [migrationReadyRow("patients", externalRecordId, normalizedRecord)]
  });
  const initialCommit = await repository.commitMigrationBatch(scope, initialBatch.batch.id, {
    idempotencyKey: `reconciliation-rollback-initial-${token}`
  });
  const patientId = initialCommit?.rows[0]?.committedRecordId;
  assert.ok(patientId);
  const replayBatch = await repository.createMigrationBatch(scope, {
    importType: "patients",
    sourceSystem,
    sourceFileName: "reconciliation-rollback-replay.json",
    sourceChecksum: sha256({ token, batch: "replay" }),
    state: "ready_to_commit",
    rows: [migrationReadyRow("patients", externalRecordId, normalizedRecord)]
  });

  const blockingClient = await connectionPool.connect();
  let replayCommitPromise;
  let initialRollbackPromise;
  try {
    await blockingClient.query("begin");
    const lockKey = JSON.stringify([
      scope.tenantId,
      scope.clinicId,
      sourceSystem,
      externalRecordId,
      "patient"
    ]);
    await blockingClient.query("select pg_advisory_xact_lock(hashtextextended($1::text, 0))", [
      lockKey
    ]);
    replayCommitPromise = repository.commitMigrationBatch(scope, replayBatch.batch.id, {
      idempotencyKey: `reconciliation-rollback-replay-${token}`
    });
    await waitForAdvisoryLockWaiters(blockingClient, 1);
    initialRollbackPromise = repository.rollbackMigrationBatch(scope, initialBatch.batch.id, {
      idempotencyKey: `reconciliation-rollback-blocked-${token}`
    });
    await waitForAdvisoryLockWaiters(blockingClient, 2);
    await blockingClient.query("commit");
  } catch (error) {
    await blockingClient.query("rollback");
    await Promise.allSettled([replayCommitPromise, initialRollbackPromise].filter(Boolean));
    throw error;
  } finally {
    blockingClient.release();
  }

  const [replayCommit, initialRollback] = await Promise.all([
    replayCommitPromise,
    initialRollbackPromise
  ]);
  assert.equal(replayCommit?.rows[0]?.committedRecordId, patientId);
  assert.equal(initialRollback?.batch.state, "partially_committed");
  assert.equal(initialRollback?.blockedLinks.length, 1);
  assert.ok(await repository.findPatientById(scope, patientId));

  const replayRollback = await repository.rollbackMigrationBatch(scope, replayBatch.batch.id, {
    idempotencyKey: `reconciliation-rollback-replay-cleanup-${token}`
  });
  assert.equal(replayRollback?.batch.state, "rolled_back");
  const initialCleanup = await repository.rollbackMigrationBatch(scope, initialBatch.batch.id, {
    idempotencyKey: `reconciliation-rollback-initial-cleanup-${token}`
  });
  assert.equal(initialCleanup?.batch.state, "rolled_back");
  assert.equal(await repository.findPatientById(scope, patientId), null);
  return true;
}

async function waitForAdvisoryLockWaiters(client, expectedCount) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await client.query(
      `select count(*)::integer as count
       from pg_locks as waiting
       where waiting.locktype = 'advisory'
         and not waiting.granted
         and exists (
           select 1
           from pg_locks as held
           where held.pid = pg_backend_pid()
             and held.locktype = 'advisory'
             and held.granted
             and held.database is not distinct from waiting.database
             and held.classid = waiting.classid
             and held.objid = waiting.objid
             and held.objsubid = waiting.objsubid
         )`
    );
    if ((result.rows[0]?.count ?? 0) >= expectedCount) return;
    await delay(10);
  }
  assert.fail(`Expected at least ${expectedCount} waiting advisory locks.`);
}

function migrationReadyRow(importType, externalRecordId, normalizedRecord) {
  return {
    rowNumber: 1,
    importType,
    externalRecordId,
    rawPayload: normalizedRecord,
    rawPayloadDigest: sha256(normalizedRecord),
    normalizedRecord,
    validationErrors: [],
    status: "ready_to_commit",
    matchStatus: "none",
    conflicts: []
  };
}
