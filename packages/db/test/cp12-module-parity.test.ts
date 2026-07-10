import test from "node:test";
import assert from "node:assert/strict";
import type { Clock, UUID } from "@clinic-os/domain";
import {
  CLINIC_MODULE_OPERATION_OWNERS,
  createPostgresClinicModuleUnitOfWork,
  type PatientAdministrationRepositoryPort
} from "../src/modules/index.ts";
import type { SqlConnectionFactory, SqlQueryClient, SqlQueryResult } from "../src/postgres.ts";
import type { RepositoryScope } from "../src/repositories.ts";

const TENANT_A_SCOPE = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  clinicId: "10000000-0000-4000-8000-000000000101",
  actorUserId: "10000000-0000-4000-8000-000000001001"
} as const satisfies RepositoryScope;
const TENANT_B_SCOPE = {
  tenantId: "20000000-0000-4000-8000-000000000001",
  clinicId: "20000000-0000-4000-8000-000000000101",
  actorUserId: "20000000-0000-4000-8000-000000001001"
} as const satisfies RepositoryScope;
const PATIENT_ID = "10000000-0000-4000-8000-000000002099" as UUID;
const FIXED_NOW = "2026-07-09T12:00:00.000Z";
const fixedClock: Clock = { now: () => new Date(FIXED_NOW) };

interface AuthorizedTestContext {
  readonly verifiedScope: Readonly<RepositoryScope>;
}

test("CP12 adapters expose only their owned behavior and no caller scope parameter", async () => {
  const pool = new RecordingSqlPool();
  const unitOfWork = moduleUnitOfWork(pool);

  await unitOfWork.run(contextFor(TENANT_A_SCOPE), async ({ repositories, evidence }) => {
    const expectedByPort = {
      patientAdministration: CLINIC_MODULE_OPERATION_OWNERS.patientAdministration,
      scheduling: CLINIC_MODULE_OPERATION_OWNERS.scheduling,
      clinicalCare: CLINIC_MODULE_OPERATION_OWNERS.clinicalCare,
      dentalTreatment: CLINIC_MODULE_OPERATION_OWNERS.dentalTreatment,
      billing: CLINIC_MODULE_OPERATION_OWNERS.billing,
      continuity: CLINIC_MODULE_OPERATION_OWNERS.continuity,
      clinicOperations: CLINIC_MODULE_OPERATION_OWNERS.clinicOperations,
      privacySecurity: CLINIC_MODULE_OPERATION_OWNERS.privacySecurity,
      dataIntegrations: CLINIC_MODULE_OPERATION_OWNERS.dataIntegrations,
      aiScribe: CLINIC_MODULE_OPERATION_OWNERS.aiScribe,
      clinicalMedia: CLINIC_MODULE_OPERATION_OWNERS.clinicalMedia
    };

    for (const [portName, expectedOperations] of Object.entries(expectedByPort)) {
      const port = repositories[portName as keyof typeof repositories];
      assert.deepEqual(Object.keys(port).sort(), [...expectedOperations].sort());
      assert.equal(Object.isFrozen(port), true);
    }

    assert.deepEqual(Object.keys(evidence).sort(), ["appendAuditEvent", "appendOutboxEvent"]);
    assert.equal(Object.isFrozen(repositories), true);
    assert.equal(Object.isFrozen(evidence), true);
  });
});

test("CP12 Postgres seam preserves tenant scoping, pooled reset, atomicity, and idempotency", async () => {
  const pool = new RecordingSqlPool();
  const unitOfWork = moduleUnitOfWork(pool);
  const idempotencyKey = "cp12-patient-created-001";

  const patient = await unitOfWork.run(
    contextFor(TENANT_A_SCOPE),
    async ({ repositories, evidence }) => {
      const created = await repositories.patientAdministration.createPatient({
        fullName: "CP12 Synthetic Patient",
        phone: "+919999000099",
        gender: "unknown",
        source: "manual",
        sourceDetail: { evidence: "cp12_module_seam" }
      });
      await evidence.appendAuditEvent({
        id: "10000000-0000-4000-8000-000000009001",
        action: "patient.created",
        category: "clinical",
        riskLevel: "medium",
        phiInvolved: true,
        resourceType: "patient",
        resourceId: created.id,
        patientId: created.id,
        metadata: { evidence: "cp12_module_seam" },
        ipAddress: null,
        userAgent: "cp12-repository-test",
        correlationId: idempotencyKey,
        occurredAt: FIXED_NOW
      });
      const event = {
        eventType: "patient.created" as const,
        aggregateType: "patient",
        aggregateId: created.id,
        patientId: created.id,
        idempotencyKey,
        correlationId: idempotencyKey,
        payload: { patientId: created.id },
        occurredAt: FIXED_NOW
      };
      await evidence.appendOutboxEvent(event);
      await evidence.appendOutboxEvent(event);
      return created;
    }
  );

  assert.equal(patient.id, PATIENT_ID);
  assert.equal(pool.connectCalls, 1);
  assert.equal(pool.client.releaseCalls, 1);
  assert.deepEqual(pool.client.transactionEndings, ["commit"]);
  assert.equal(queryCount(pool.client, /^begin$/u), 1);
  assert.equal(queryCount(pool.client, /^commit$/u), 1);
  assert.equal(queryCount(pool.client, /^rollback$/u), 0);
  assert.equal(queryCount(pool.client, /insert into patients/u), 1);
  assert.equal(queryCount(pool.client, /insert into patient_timeline_items/u), 1);
  assert.equal(queryCount(pool.client, /insert into audit_events/u), 1);

  const outboxQueries = matchingQueries(pool.client, /insert into outbox_events/u);
  assert.equal(outboxQueries.length, 2);
  for (const query of outboxQueries) {
    assert.match(query.sql, /on conflict \(tenant_id, idempotency_key\).*do nothing/su);
    assert.equal(query.values[0], TENANT_A_SCOPE.tenantId);
    assert.equal(query.values[1], TENANT_A_SCOPE.clinicId);
    assert.equal(query.values[3], TENANT_A_SCOPE.actorUserId);
    assert.equal(query.values[7], idempotencyKey);
  }

  const auditQuery = matchingQueries(pool.client, /insert into audit_events/u)[0];
  assert.equal(auditQuery?.values[1], TENANT_A_SCOPE.tenantId);
  assert.equal(auditQuery?.values[2], TENANT_A_SCOPE.clinicId);
  assert.equal(auditQuery?.values[3], "user");
  assert.equal(auditQuery?.values[4], TENANT_A_SCOPE.actorUserId);

  const tenantSettings = matchingQueries(pool.client, /set_config\('app\.tenant_id'/u);
  assert.ok(tenantSettings.length >= 4);
  assert.ok(tenantSettings.every((query) => query.values[0] === TENANT_A_SCOPE.tenantId));
  assert.ok(tenantSettings.every((query) => /, true\)/u.test(query.sql)));

  const crossTenantRead = await unitOfWork.run(contextFor(TENANT_B_SCOPE), ({ repositories }) =>
    repositories.patientAdministration.findPatientById(PATIENT_ID)
  );
  assert.equal(crossTenantRead, null);
  assert.equal(pool.connectCalls, 2);
  assert.equal(pool.client.releaseCalls, 2);
  assert.deepEqual(pool.client.contextsAtBegin, [{}, {}]);
  assert.deepEqual(pool.client.transactionEndings, ["commit", "commit"]);

  const patientRead = matchingQueries(pool.client, /select \*\s+from patients/u).at(-1);
  assert.equal(patientRead?.values[0], TENANT_B_SCOPE.tenantId);
  assert.equal(patientRead?.values[1], TENANT_B_SCOPE.clinicId);
  assert.equal(patientRead?.values[2], PATIENT_ID);
});

test("CP12 seam rolls domain, timeline, audit, and outbox work back in the same transaction", async () => {
  const pool = new RecordingSqlPool();
  const unitOfWork = moduleUnitOfWork(pool);
  const forcedRollback = new Error("CP12_FORCED_ROLLBACK");

  await assert.rejects(
    unitOfWork.run(contextFor(TENANT_A_SCOPE), async ({ repositories, evidence }) => {
      const patient = await repositories.patientAdministration.createPatient({
        fullName: "CP12 Rolled Back Patient",
        phone: "+919999000098",
        source: "manual"
      });
      await evidence.appendAuditEvent({
        id: "10000000-0000-4000-8000-000000009002",
        action: "patient.created",
        category: "clinical",
        riskLevel: "medium",
        phiInvolved: true,
        resourceType: "patient",
        resourceId: patient.id,
        patientId: patient.id,
        metadata: { evidence: "cp12_forced_rollback" },
        ipAddress: null,
        userAgent: "cp12-repository-test",
        correlationId: "cp12-forced-rollback",
        occurredAt: FIXED_NOW
      });
      await evidence.appendOutboxEvent({
        eventType: "patient.created",
        aggregateType: "patient",
        aggregateId: patient.id,
        patientId: patient.id,
        idempotencyKey: "cp12-forced-rollback",
        payload: { patientId: patient.id },
        occurredAt: FIXED_NOW
      });
      throw forcedRollback;
    }),
    (error) => error === forcedRollback
  );

  assert.equal(queryCount(pool.client, /^begin$/u), 1);
  assert.equal(queryCount(pool.client, /^commit$/u), 0);
  assert.equal(queryCount(pool.client, /^rollback$/u), 1);
  assert.equal(queryCount(pool.client, /insert into patients/u), 1);
  assert.equal(queryCount(pool.client, /insert into patient_timeline_items/u), 1);
  assert.equal(queryCount(pool.client, /insert into audit_events/u), 1);
  assert.equal(queryCount(pool.client, /insert into outbox_events/u), 1);
  assert.deepEqual(pool.client.transactionEndings, ["rollback"]);
  assert.deepEqual(pool.client.localContext, {});
});

test("CP12 seam preserves legacy null and exact error semantics", async () => {
  const databaseError = Object.assign(new Error("synthetic unique violation"), { code: "23505" });
  const pool = new RecordingSqlPool({
    failWhen: (sql) => (/insert into patients/u.test(sql) ? databaseError : null)
  });
  const unitOfWork = moduleUnitOfWork(pool);

  await assert.rejects(
    unitOfWork.run(contextFor(TENANT_A_SCOPE), ({ repositories }) =>
      repositories.patientAdministration.createPatient({
        fullName: "CP12 Error Patient",
        phone: "+919999000097",
        source: "manual"
      })
    ),
    (error) => error === databaseError && (error as { code?: string }).code === "23505"
  );
  assert.deepEqual(pool.client.transactionEndings, ["rollback"]);

  pool.client.failWhen = undefined;
  const missing = await unitOfWork.run(contextFor(TENANT_A_SCOPE), ({ repositories }) =>
    repositories.patientAdministration.findPatientById(PATIENT_ID)
  );
  assert.equal(missing, null);
  assert.deepEqual(pool.client.transactionEndings, ["rollback", "commit"]);
});

test("CP12 authority resolution fails before opening a transaction", async () => {
  const pool = new RecordingSqlPool();
  const unitOfWork = moduleUnitOfWork(pool);
  const invalidContext: AuthorizedTestContext = {
    verifiedScope: { ...TENANT_A_SCOPE, actorUserId: "" as UUID }
  };

  await assert.rejects(
    unitOfWork.run(invalidContext, async () => undefined),
    /non-empty actorUserId/u
  );
  assert.equal(pool.connectCalls, 0);
});

test("CP12 transaction-bound ports cannot be used after commit", async () => {
  const pool = new RecordingSqlPool();
  const unitOfWork = moduleUnitOfWork(pool);
  let escapedPort: PatientAdministrationRepositoryPort | undefined;

  await unitOfWork.run(contextFor(TENANT_A_SCOPE), async ({ repositories }) => {
    escapedPort = repositories.patientAdministration;
  });

  const queryCountAfterCommit = pool.client.queries.length;
  assert.throws(
    () => escapedPort?.findPatientById(PATIENT_ID),
    /no longer inside its active unit of work/u
  );
  assert.equal(pool.client.queries.length, queryCountAfterCommit);
});

function moduleUnitOfWork(pool: SqlConnectionFactory) {
  return createPostgresClinicModuleUnitOfWork<AuthorizedTestContext>({
    client: pool,
    clock: fixedClock,
    resolveScope: (context) => context.verifiedScope
  });
}

function contextFor(scope: Readonly<RepositoryScope>): AuthorizedTestContext {
  return Object.freeze({ verifiedScope: Object.freeze({ ...scope }) });
}

interface RecordedQuery {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class RecordingSqlPool implements SqlConnectionFactory {
  readonly client: RecordingSqlClient;
  connectCalls = 0;

  constructor(options: { failWhen?: (sql: string) => Error | null } = {}) {
    this.client = new RecordingSqlClient(options);
  }

  async connect(): Promise<SqlQueryClient> {
    this.connectCalls += 1;
    return this.client;
  }

  query<TResult = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<SqlQueryResult<TResult>> {
    return this.client.query<TResult>(sql, values);
  }
}

class RecordingSqlClient implements SqlQueryClient {
  readonly queries: RecordedQuery[] = [];
  readonly contextsAtBegin: Array<Record<string, string>> = [];
  readonly transactionEndings: Array<"commit" | "rollback"> = [];
  localContext: Record<string, string> = {};
  releaseCalls = 0;
  failWhen: ((sql: string) => Error | null) | undefined;
  #inTransaction = false;

  constructor(options: { failWhen?: (sql: string) => Error | null } = {}) {
    this.failWhen = options.failWhen;
  }

  async query<TResult = Record<string, unknown>>(
    rawSql: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TResult>> {
    const sql = rawSql.trim().replace(/\s+/gu, " ");
    this.queries.push({ sql, values: [...values] });

    if (sql === "begin") {
      assert.equal(
        this.#inTransaction,
        false,
        "the module seam must not open a nested transaction"
      );
      this.contextsAtBegin.push({ ...this.localContext });
      this.#inTransaction = true;
      this.localContext = {};
      return { rows: [] };
    }
    if (sql === "commit" || sql === "rollback") {
      assert.equal(this.#inTransaction, true);
      this.transactionEndings.push(sql);
      this.#inTransaction = false;
      this.localContext = {};
      return { rows: [] };
    }

    const setConfig = /set_config\('([^']+)', \$1, true\)/u.exec(sql);
    if (setConfig?.[1]) {
      assert.equal(this.#inTransaction, true);
      this.localContext[setConfig[1]] = String(values[0] ?? "");
      return { rows: [] };
    }

    const failure = this.failWhen?.(sql);
    if (failure) throw failure;

    if (/insert into patients/u.test(sql)) {
      const row = {
        id: PATIENT_ID,
        tenant_id: values[0],
        clinic_id: values[1],
        row_version: 1,
        full_name: values[2],
        phone: values[3],
        email: values[4],
        date_of_birth: values[5],
        gender: values[6],
        source: values[7],
        abha_address: null,
        created_at: FIXED_NOW,
        updated_at: FIXED_NOW
      };
      return { rows: [row as TResult] };
    }

    return { rows: [] };
  }

  release(): void {
    assert.equal(this.#inTransaction, false);
    this.releaseCalls += 1;
  }
}

function matchingQueries(client: RecordingSqlClient, pattern: RegExp): RecordedQuery[] {
  return client.queries.filter((query) => pattern.test(query.sql));
}

function queryCount(client: RecordingSqlClient, pattern: RegExp): number {
  return matchingQueries(client, pattern).length;
}
