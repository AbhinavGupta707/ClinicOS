import assert from "node:assert/strict";
import test from "node:test";
import { buildAccessContext, principalFromVerifiedKeycloakClaims } from "@clinic-os/auth";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import { createPaymentProvider } from "@clinic-os/integrations";
import {
  commitMigrationBatch,
  createClinicOsApiServer,
  createMigrationBatch,
  InMemoryAuditSink,
  listDeadLetterEvents,
  listMigrationBatches,
  listMigrationBatchRows,
  listProviderHealth,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  replayDeadLetterEvent,
  resolveMigrationBatchRow,
  rollbackMigrationBatch,
  type OperationsDependencies,
  type OperationsRequestContext
} from "../src/index.ts";

const expectedIssuer = "http://localhost:8080/realms/clinicos-local";
const acceptedAudience = "clinic-os-api";
const clinicId = CHECKPOINT1_SEED_IDS.clinicId;

test("CP7 migration import separates invalid rows, resolves duplicates, commits idempotently, and rolls back imports", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant", "cp7-create");
  const accountant = await operationsContext("seed-accountant", "cp7-accountant");

  await assert.rejects(
    () =>
      createMigrationBatch(accountant, dependencies, {
        importType: "patients",
        rows: [{ fullName: "Forbidden Import", phone: "+91 99999 11111" }]
      }),
    /missing_permission/
  );

  const created = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem: "ray_legacy_export",
    sourceFileName: "patients.csv",
    csv: [
      "external_reference,full_name,phone,email,date_of_birth,gender,source_type",
      "legacy-new,Asha Import,+91 99900 01111,asha.import@example.test,1984-02-03,female,practo",
      "legacy-dup,Rhea Synthetic,+91 98765 43210,rhea.synthetic@example.test,,female,google",
      "legacy-bad,,123,bad-email,not-a-date,unknown,practo"
    ].join("\n")
  });

  assert.equal(created.status, 201);
  assert.equal(created.body.batch.rowCount, 3);
  assert.equal(created.body.batch.invalidRowCount, 1);
  assert.equal(created.body.batch.conflictRowCount, 1);
  assert.equal(created.body.batch.state, "needs_review");
  assert.equal("rawPayload" in created.body.rows[0], false);

  const duplicateRow = created.body.rows.find((row) => row.matchStatus === "duplicate_candidate");
  assert.ok(duplicateRow);
  assert.equal(duplicateRow.conflicts[0].conflictType, "duplicate_patient");

  await assert.rejects(
    () =>
      commitMigrationBatch(
        { ...assistant, idempotencyKey: "cp7-commit-1" },
        dependencies,
        created.body.batch.id,
        {}
      ),
    /unresolved duplicate/
  );

  const resolved = await resolveMigrationBatchRow(
    assistant,
    dependencies,
    created.body.batch.id,
    duplicateRow.id,
    {
      action: "link_existing",
      targetPatientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
      note: "Confirmed same patient during import review."
    }
  );
  assert.equal(resolved.body.row.status, "ready_to_commit");
  assert.equal(resolved.body.row.matchStatus, "resolved");

  const committed = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-commit-1" },
    dependencies,
    created.body.batch.id,
    {}
  );
  assert.equal(committed.status, 202);
  assert.equal(committed.body.batch.state, "partially_committed");
  assert.equal(committed.body.importedRecordLinks.length, 2);
  assert.ok(
    committed.body.importedRecordLinks.every(
      (link) => link.verificationStatus === "imported_unverified"
    )
  );
  assert.equal(repository.patients.length, 2);
  assert.equal(
    repository.patients.find(
      (patient) => patient.id === CHECKPOINT1_SEED_IDS.patients.rheaSynthetic
    )?.fullName,
    "Rhea Synthetic"
  );

  const repeated = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-commit-1" },
    dependencies,
    created.body.batch.id,
    {}
  );
  assert.equal(repeated.body.commit.id, committed.body.commit.id);

  assert.ok(auditSink.events.some((event) => event.action === "migration.batch.created"));
  assert.ok(auditSink.events.some((event) => event.action === "migration.row.resolved"));
  assert.ok(auditSink.events.some((event) => event.action === "migration.batch.committed"));
  assert.ok(repository.outboxEvents.some((event) => event.eventType === "patient.imported"));

  const rolledBack = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-rollback-1" },
    dependencies,
    created.body.batch.id,
    {}
  );
  assert.equal(rolledBack.status, 202);
  assert.equal(rolledBack.body.batch.state, "rolled_back");
  assert.equal(rolledBack.body.blockedLinks.length, 0);
  assert.equal(repository.patients.length, 1);
  assert.equal(
    repository.importedRecordLinks.every((link) => link.verificationStatus === "rolled_back"),
    true
  );
});

test("CP7 patient import reconciles exact cross-batch replay and reviews changed linked records", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = { repository, auditSink };
  const assistant = await operationsContext("seed-assistant", "cp7-cross-batch-replay");
  const sourceSystem = "canonical_patient_import";
  const originalRow = {
    externalReference: "stable-patient-1",
    fullName: "Replay Synthetic",
    phone: "+91 99900 04444",
    email: "replay.original@example.test",
    dateOfBirth: "1990-04-05",
    gender: "female"
  };

  const initial = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [originalRow]
  });
  const initialCommit = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-initial-import" },
    dependencies,
    initial.body.batch.id,
    {}
  );
  const linkedPatientId = initialCommit.body.rows[0].committedRecordId;
  assert.ok(linkedPatientId);
  assert.equal(repository.patients.length, 2);

  const exactReplay = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [originalRow]
  });
  assert.equal(exactReplay.body.rows[0].status, "ready_to_commit");
  assert.equal(exactReplay.body.rows[0].matchStatus, "resolved");
  assert.equal(exactReplay.body.rows[0].conflicts.length, 0);

  const replayCommit = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-exact-replay" },
    dependencies,
    exactReplay.body.batch.id,
    {}
  );
  assert.equal(replayCommit.body.rows[0].committedRecordId, linkedPatientId);
  assert.equal(replayCommit.body.commit.summary.reconciledRows, 1);
  assert.equal(replayCommit.body.importedRecordLinks.length, 0);
  assert.equal(repository.patients.length, 2);

  const replayRollback = await rollbackMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-exact-replay-rollback" },
    dependencies,
    exactReplay.body.batch.id,
    {}
  );
  assert.equal(replayRollback.body.batch.state, "rolled_back");
  assert.equal(replayRollback.body.rows[0].status, "rolled_back");
  assert.equal(repository.patients.length, 2);
  assert.ok(repository.patients.some((patient) => patient.id === linkedPatientId));

  const changedReplay = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem,
    rows: [{ ...originalRow, email: "replay.changed@example.test" }]
  });
  assert.equal(changedReplay.body.batch.state, "needs_review");
  assert.equal(changedReplay.body.rows[0].matchStatus, "conflict");
  assert.equal(changedReplay.body.rows[0].conflicts[0].conflictType, "verified_record_overlap");
  assert.deepEqual(changedReplay.body.rows[0].conflicts[0].evidence.differingFields, ["email"]);
  assert.equal(
    JSON.stringify(changedReplay.body.rows[0].conflicts[0].evidence).includes(
      "replay.original@example.test"
    ),
    false
  );

  const resolved = await resolveMigrationBatchRow(
    assistant,
    dependencies,
    changedReplay.body.batch.id,
    changedReplay.body.rows[0].id,
    {
      action: "link_existing",
      targetRecordId: linkedPatientId,
      note: "Confirmed identity; preserve the current ClinicOS demographic value for review."
    }
  );
  assert.equal(resolved.body.row.status, "ready_to_commit");
  const changedCommit = await commitMigrationBatch(
    { ...assistant, idempotencyKey: "cp7-changed-replay" },
    dependencies,
    changedReplay.body.batch.id,
    {}
  );
  assert.equal(changedCommit.body.rows[0].committedRecordId, linkedPatientId);
  assert.equal(changedCommit.body.commit.summary.reconciledRows, 1);
  assert.equal(repository.patients.length, 2);
  assert.equal(
    repository.patients.find((patient) => patient.id === linkedPatientId)?.email,
    originalRow.email
  );
});

test("CP7 patient import blocks duplicate external references inside one batch", async () => {
  const dependencies: OperationsDependencies = {
    repository: new LocalFixtureClinicOperationsRepository(),
    auditSink: new InMemoryAuditSink()
  };
  const assistant = await operationsContext("seed-assistant", "cp7-duplicate-external-ref");
  const created = await createMigrationBatch(assistant, dependencies, {
    importType: "patients",
    sourceSystem: "canonical_patient_import",
    rows: [
      {
        externalReference: "duplicate-external-1",
        fullName: "First Synthetic",
        phone: "+91 99900 05551"
      },
      {
        externalReference: "duplicate-external-1",
        fullName: "Second Synthetic",
        phone: "+91 99900 05552"
      }
    ]
  });

  assert.equal(created.body.batch.state, "needs_review");
  assert.equal(created.body.rows[0].status, "ready_to_commit");
  assert.equal(created.body.rows[1].status, "needs_review");
  assert.equal(created.body.rows[1].conflicts[0].conflictType, "field_conflict");
  assert.equal(created.body.rows[1].conflicts[0].fieldName, "externalReference");
  assert.equal(created.body.rows[1].conflicts[0].evidence.firstRowNumber, 1);
});

test("CP7 integration ops API surfaces provider health, dead-letter replay requests, and migration collection reads", async () => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  const dependencies: OperationsDependencies = {
    auditSink,
    paymentProvider: createPaymentProvider({ provider: "simulator" }),
    repository,
    runtimeConfig: config
  };
  const owner = await operationsContext("seed-owner", "cp7-ops");
  const deadLetterId = "12345678-1234-4234-8234-123456789abc";

  repository.integrationDeadLetters.push({
    clinicId,
    createdAt: "2026-07-07T09:40:00.000Z",
    failureCode: "normalization_failed",
    failureStage: "normalization",
    failureSummary: "Signed callback verification is not active.",
    id: deadLetterId,
    lastErrorDigest: "sha256:redacted",
    nextRetryAt: null,
    normalizedEventId: null,
    providerKey: "meta_whatsapp_cloud",
    rawEventId: "22345678-1234-4234-8234-123456789abc",
    retryCount: 3,
    status: "open",
    tenantId: CHECKPOINT1_SEED_IDS.tenantId,
    updatedAt: "2026-07-07T09:40:00.000Z"
  });

  const health = await listProviderHealth(owner, dependencies);
  assert.equal(health.status, 200);
  assert.ok(health.body.providers.some((provider) => provider.providerKey === "whatsapp_cloud"));
  assert.ok(health.body.providers.some((provider) => provider.providerKey === "manual_import"));
  assert.ok(
    health.body.providers.some(
      (provider) => provider.providerKey === "practo" && provider.status === "not_configured"
    )
  );
  assert.equal(JSON.stringify(health.body).includes("Provider success confirmed"), false);

  const listedDeadLetters = await listDeadLetterEvents(owner, dependencies, {
    status: "unreviewed"
  });
  assert.equal(listedDeadLetters.status, 200);
  assert.equal(listedDeadLetters.body.deadLetterEvents[0].status, "unreviewed");
  assert.equal("rawEventId" in listedDeadLetters.body.deadLetterEvents[0], false);

  const replay = await replayDeadLetterEvent(owner, dependencies, deadLetterId, {
    reason: "Owner reviewed provider failure evidence."
  });
  assert.equal(replay.status, 202);
  assert.equal(replay.body.replay.status, "accepted");
  assert.equal(replay.body.replay.deadLetterEvent.status, "replay_requested");
  assert.ok(auditSink.events.some((event) => event.action === "integration.dead_letter.replayed"));
  assert.ok(
    repository.outboxEvents.some((event) => event.eventType === "integration.dead_letter.replayed")
  );

  const created = await createMigrationBatch(owner, dependencies, {
    importType: "patients",
    rows: [{ externalReference: "ops-1", fullName: "Ops Import", phone: "+91 99900 03333" }]
  });
  const listedBatches = await listMigrationBatches(owner, dependencies, {
    status: "ready_to_commit"
  });
  assert.equal(listedBatches.status, 200);
  assert.equal(listedBatches.body.migrationBatches[0].batch.id, created.body.batch.id);
  assert.equal("rawPayload" in listedBatches.body.migrationBatches[0].rows[0], false);
});

test("CP15 provider health uses durable activation truth without returning secret references", async () => {
  const owner = await operationsContext("seed-owner", "cp15-provider-health");
  const dependencies: OperationsDependencies = {
    repository: new LocalFixtureClinicOperationsRepository(),
    runtimeConfig: config,
    providerOperationsRegistry: {
      async list() {
        return [
          {
            registrationId: "12345678-1234-4234-8234-123456789abc" as never,
            providerKey: "meta_whatsapp_cloud",
            activationState: "sandbox_verified",
            providerMode: "test",
            sandboxVerifiedAt: "2026-07-13T08:00:00.000Z",
            productionVerifiedAt: null,
            lastHealthCheckAt: "2026-07-13T08:05:00.000Z",
            lastVerifiedCallbackAt: "2026-07-13T08:04:00.000Z",
            lastReconciledAt: "2026-07-13T08:03:00.000Z",
            lastFailureCode: null,
            createdAt: "2026-07-13T07:00:00.000Z",
            updatedAt: "2026-07-13T08:05:00.000Z"
          }
        ] as const;
      }
    }
  };
  const health = await listProviderHealth(owner, dependencies);
  const meta = health.body.providers.find(
    (provider) => provider.providerKey === "whatsapp_cloud"
  );
  const razorpay = health.body.providers.find(
    (provider) => provider.providerKey === "razorpay"
  );
  assert.equal(meta?.activationState, "sandbox_verified");
  assert.equal(meta?.status, "available");
  assert.equal(meta?.lastVerifiedCallbackAt, "2026-07-13T08:04:00.000Z");
  assert.equal(razorpay?.activationState, "absent");
  assert.equal(razorpay?.status, "not_configured");
  assert.equal(JSON.stringify(health.body).includes("credential_ref"), false);
  assert.equal(JSON.stringify(health.body).includes("webhook_secret"), false);
});

test("CP7 migration routes expose create and row listing contract without raw payloads", async (t) => {
  const repository = new LocalFixtureClinicOperationsRepository();
  const server = createClinicOsApiServer({
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    operationsRepository: repository,
    auditSink: new InMemoryAuditSink(),
    useLocalAuthFixture: true,
    repositoryMode: "fixture"
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip(
        "Socket binding is blocked in this sandbox; run the CP7 route smoke outside the sandbox."
      );
      return;
    }
    throw error;
  }

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const createResponse = await postJson(baseUrl, "/v1/migration-batches", {
      importType: "patients",
      rows: [{ externalReference: "route-1", fullName: "Route Import", phone: "+919990002222" }]
    });
    assert.equal(createResponse.status, 201);
    const createBody = await createResponse.json();
    assert.equal(createBody.batch.state, "ready_to_commit");
    assert.equal("rawPayload" in createBody.rows[0], false);
    assert.equal(createBody.rows[0].rawPayloadRef.retained, true);

    const rowsResponse = await fetch(
      `${baseUrl}/v1/migration-batches/${createBody.batch.id}/rows?matchStatus=none`,
      { headers: { "x-clinic-os-dev-subject": "seed-assistant" } }
    );
    assert.equal(rowsResponse.status, 200);
    const rowsBody = await rowsResponse.json();
    assert.equal(rowsBody.rows.length, 1);
    assert.equal("rawPayload" in rowsBody.rows[0], false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
});

async function operationsContext(
  subject: string,
  requestId: string
): Promise<OperationsRequestContext> {
  const identityRepository = new LocalFixtureIdentityRepository();
  const claims = createClaims(subject);
  const principal = principalFromVerifiedKeycloakClaims(claims, {
    expectedIssuer,
    acceptedAudiences: [acceptedAudience],
    acceptedClientIds: [acceptedAudience],
    now: new Date("2026-07-07T08:00:00.000Z")
  });
  const snapshot = await identityRepository.findAccessByKeycloakSubject(subject);
  assert.ok(snapshot);

  return {
    requestId,
    accessContext: buildAccessContext({
      principal,
      tenant: snapshot.tenant,
      user: snapshot.user,
      memberships: snapshot.memberships,
      clinicAssignments: snapshot.clinicAssignments,
      roleAssignments: snapshot.roleAssignments
    }),
    clinicId,
    ipAddress: "127.0.0.1",
    userAgent: "node-test"
  };
}

function createClaims(subject: string) {
  const issuedAt = Math.floor(new Date("2026-07-07T08:00:00.000Z").getTime() / 1000);
  return {
    sub: subject,
    iss: expectedIssuer,
    aud: acceptedAudience,
    azp: acceptedAudience,
    exp: issuedAt + 300,
    iat: issuedAt
  };
}

async function postJson(baseUrl: string, path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-clinic-os-dev-subject": "seed-assistant",
      "idempotency-key": "cp7-route-create-batch"
    },
    body: JSON.stringify(body)
  });
}

const config = {
  nodeEnv: "development",
  clinicOsEnv: "local",
  isProductionLike: false,
  services: {
    databaseUrl: "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os",
    redisUrl: "redis://localhost:6379",
    temporalAddress: "localhost:7233"
  },
  auth: {
    keycloakBaseUrl: "http://localhost:8080",
    keycloakRealm: "clinic-os-local",
    keycloakClientId: "clinic-os-web"
  },
  storage: {
    region: "ap-south-1",
    bucket: "clinic-os-local"
  },
  providers: {
    whatsapp: { provider: "simulator", appSecretProofRequired: false },
    payment: { provider: "simulator", qrMode: "payment_link_qr" },
    telephony: { provider: "simulator", regionSubdomain: "api.in.exotel.com" },
    ai: { llmProvider: "simulator", transcriptionProvider: "simulator" }
  },
  pilotInputs: {
    syntheticDataOnly: true
  }
};
