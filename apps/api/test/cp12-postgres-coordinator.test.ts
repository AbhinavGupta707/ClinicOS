import assert from "node:assert/strict";
import test from "node:test";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import { BoundaryError } from "@clinic-os/security";
import type { AtomicMutationRequest } from "../src/framework/contracts.ts";
import { PostgresAtomicMutationCoordinator } from "../src/framework/postgres-mutation-coordinator.ts";

const NOW = new Date("2026-07-10T12:00:00.000Z");
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const RESOURCE_ID = CHECKPOINT1_SEED_IDS.patientId;
const APPOINTMENT_ID = "10000000-0000-4000-8000-000000003099";

test("Postgres coordinator commits, replays exact public output, and rejects digest reuse", async () => {
  const database = new FakeTransactionalDatabase();
  database.versions.set(versionKey("updatePatient", RESOURCE_ID), 7);
  const coordinator = createCoordinator(database);
  let effects = 0;
  const request = mutationRequest({ key: "cp12-durable-first-001", expectedEtag: '"rv-7"' });

  const first = await coordinator.execute(request, async (transaction) => {
    effects += 1;
    assert.equal(transaction.repository, database.repository);
    assert.equal(transaction.auditSink, database.auditSink);
    return {
      status: 200,
      body: { patient: { id: RESOURCE_ID, rowVersion: 8 } },
      headers: { etag: '"rv-8"', "set-cookie": "session=must-not-escape" }
    };
  });
  assert.deepEqual(first, {
    response: {
      status: 200,
      body: { patient: { id: RESOURCE_ID, rowVersion: 8 } },
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        etag: '"rv-8"'
      }
    },
    replayed: false,
    etag: '"rv-8"'
  });
  assert.equal(database.versions.get(versionKey("updatePatient", RESOURCE_ID)), 8);
  assert.equal(first.response.headers?.["set-cookie"], undefined);

  const replay = await coordinator.execute(request, async () => {
    effects += 1;
    throw new Error("Replay must not dispatch the domain effect.");
  });
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(replay.response.headers?.["set-cookie"], undefined);
  assert.equal(effects, 1);

  await assert.rejects(
    coordinator.execute({
      ...request,
      idempotency: { ...request.idempotency, requestDigest: DIGEST_B }
    }, async () => ({ status: 200, body: {} })),
    (error) =>
      error instanceof BoundaryError &&
      error.code === "CONFLICT" &&
      error.safeDetails.reason === "idempotency_key_conflict"
  );
});

test("Postgres coordinator maps active, stale, and expired claims without disclosure", async () => {
  const database = new FakeTransactionalDatabase();
  const coordinator = createCoordinator(database);
  database.seedProcessing("cp12-active-claim-001", DIGEST_A, "2026-07-10T12:01:00.000Z");
  await assert.rejects(
    coordinator.execute(mutationRequest({ key: "cp12-active-claim-001" }), async () => ({
      status: 201,
      body: { created: true }
    })),
    (error) =>
      error instanceof BoundaryError &&
      error.safeDetails.reason === "idempotency_request_in_progress"
  );

  database.seedProcessing("cp12-stale-claim-001", DIGEST_A, "2026-07-10T11:59:59.000Z");
  const reclaimed = await coordinator.execute(
    mutationRequest({ key: "cp12-stale-claim-001" }),
    async () => ({ status: 201, body: { reclaimed: true } })
  );
  assert.equal(reclaimed.response.status, 201);
  assert.equal(database.record("cp12-stale-claim-001")?.state, "completed");

  database.seedCompleted(
    "cp12-expired-claim-001",
    DIGEST_A,
    "2026-07-10T11:59:59.000Z",
    { status: 200, headers: { "cache-control": "no-store" }, body: { secret: "scrub" } }
  );
  await assert.rejects(
    coordinator.execute(mutationRequest({ key: "cp12-expired-claim-001" }), async () => ({
      status: 200,
      body: { mustNotRun: true }
    })),
    (error) =>
      error instanceof BoundaryError && error.safeDetails.reason === "idempotency_replay_expired"
  );
  const expired = database.record("cp12-expired-claim-001");
  assert.equal(expired?.state, "expired");
  assert.equal(expired?.response, null);
});

test("Postgres coordinator accepts only strong numeric If-Match and emits the exact next ETag", async () => {
  const database = new FakeTransactionalDatabase();
  database.versions.set(versionKey("updatePatient", RESOURCE_ID), 3);
  const coordinator = createCoordinator(database);

  for (const [key, expectedEtag] of [
    ["cp12-weak-etag-001", 'W/"rv-3"'],
    ["cp12-unquoted-etag-001", "3"]
  ]) {
    await assert.rejects(
      coordinator.execute(mutationRequest({ key, expectedEtag }), async () => ({
        status: 200,
        body: { patient: {} }
      })),
      (error) => error instanceof BoundaryError && error.code === "VALIDATION_ERROR"
    );
    assert.equal(database.record(key), undefined);
  }

  await assert.rejects(
    coordinator.execute(
      mutationRequest({ key: "cp12-stale-etag-001", expectedEtag: '"rv-2"' }),
      async () => ({ status: 200, body: { patient: {} } })
    ),
    (error) =>
      error instanceof BoundaryError && error.safeDetails.reason === "if_match_failed"
  );
  assert.equal(database.record("cp12-stale-etag-001"), undefined);
  assert.equal(database.versions.get(versionKey("updatePatient", RESOURCE_ID)), 3);

  const exact = await coordinator.execute(
    mutationRequest({ key: "cp12-exact-etag-001", expectedEtag: '"rv-3"' }),
    async () => ({
      status: 200,
      body: { patient: { rowVersion: 4 } },
      headers: { etag: '"rv-4"' }
    })
  );
  assert.equal(exact.etag, '"rv-4"');
  assert.equal(exact.response.headers?.etag, '"rv-4"');
});

test("Postgres coordinator rolls claim and version back on thrown and returned error paths", async () => {
  const database = new FakeTransactionalDatabase();
  database.versions.set(versionKey("updatePatient", RESOURCE_ID), 10);
  const coordinator = createCoordinator(database);

  await assert.rejects(
    coordinator.execute(
      mutationRequest({ key: "cp12-thrown-rollback-001", expectedEtag: '"rv-10"' }),
      async () => {
        throw new Error("synthetic domain rollback");
      }
    ),
    /synthetic domain rollback/u
  );
  assert.equal(database.record("cp12-thrown-rollback-001"), undefined);
  assert.equal(database.versions.get(versionKey("updatePatient", RESOURCE_ID)), 10);

  let returnedErrorEffects = 0;
  const returnedErrorRequest = mutationRequest({
    key: "cp12-returned-error-001",
    expectedEtag: '"rv-10"'
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await coordinator.execute(returnedErrorRequest, async () => {
      returnedErrorEffects += 1;
      return {
        status: 409,
        body: {
          error: {
            code: "CONFLICT",
            message: "Synthetic validated conflict.",
            details: {},
            request_id: "cp12-returned-error"
          }
        }
      };
    });
    assert.equal(result.response.status, 409);
    assert.equal(result.replayed, false);
    assert.equal(result.etag, null);
    assert.equal(result.response.headers?.etag, undefined);
  }
  assert.equal(returnedErrorEffects, 2);
  assert.equal(database.record("cp12-returned-error-001"), undefined);
  assert.equal(database.versions.get(versionKey("updatePatient", RESOURCE_ID)), 10);
  assert.equal(database.transactionEndings.filter((value) => value === "rollback").length, 3);
});

test("an existing-resource action invalidates an earlier version and rolls back on error", async () => {
  const database = new FakeTransactionalDatabase();
  database.versions.set(versionKey("updateAppointment", APPOINTMENT_ID), 4);
  const coordinator = createCoordinator(database);
  const actionRequest = {
    ...mutationRequest({ key: "cp12-appointment-action-001" }),
    idempotency: {
      operationId: "confirmAppointment",
      key: "cp12-appointment-action-001",
      requestDigest: DIGEST_A
    },
    versionAdvances: [
      { operationId: "updateAppointment" as const, resourceId: APPOINTMENT_ID }
    ]
  };
  await coordinator.execute(actionRequest, async () => ({
    status: 200,
    body: { appointment: { id: APPOINTMENT_ID, rowVersion: 5 } },
    headers: { etag: '"rv-5"' }
  }));
  assert.equal(database.versions.get(versionKey("updateAppointment", APPOINTMENT_ID)), 5);

  const stalePatch = {
    ...mutationRequest({ key: "cp12-appointment-stale-patch-001" }),
    idempotency: {
      operationId: "updateAppointment",
      key: "cp12-appointment-stale-patch-001",
      requestDigest: DIGEST_A
    },
    concurrency: {
      operationId: "updateAppointment" as const,
      resourceId: APPOINTMENT_ID,
      expectedEtag: '"rv-4"'
    },
    versionAdvances: [
      { operationId: "updateAppointment" as const, resourceId: APPOINTMENT_ID }
    ]
  };
  await assert.rejects(
    coordinator.execute(stalePatch, async () => ({ status: 200, body: {} })),
    (error) =>
      error instanceof BoundaryError && error.safeDetails.reason === "if_match_failed"
  );

  const returnedErrorAction = {
    ...actionRequest,
    idempotency: {
      ...actionRequest.idempotency,
      key: "cp12-appointment-action-error-001",
      requestDigest: DIGEST_B
    }
  };
  const errorResult = await coordinator.execute(returnedErrorAction, async () => ({
    status: 409,
    body: { error: { code: "CONFLICT", message: "Synthetic conflict.", details: {} } }
  }));
  assert.equal(errorResult.response.status, 409);
  assert.equal(database.versions.get(versionKey("updateAppointment", APPOINTMENT_ID)), 5);
  assert.equal(database.record("cp12-appointment-action-error-001"), undefined);
});

test("Postgres coordinator readiness fails closed without leaking dependency errors", async () => {
  const database = new FakeTransactionalDatabase();
  const coordinator = new PostgresAtomicMutationCoordinator({
    unitOfWork: database,
    readinessProbe: async () => {
      throw new Error("postgresql://secret-user:secret-password@private-host/database");
    }
  });
  await assert.rejects(
    coordinator.readiness(),
    (error) =>
      error instanceof BoundaryError &&
      error.code === "DEPENDENCY_UNAVAILABLE" &&
      !error.publicMessage.includes("secret")
  );
});

function createCoordinator(database: FakeTransactionalDatabase) {
  return new PostgresAtomicMutationCoordinator({
    unitOfWork: database,
    readinessProbe: async () => "ready"
  });
}

function mutationRequest(input: {
  key: string;
  requestDigest?: string;
  expectedEtag?: string | null;
}): AtomicMutationRequest {
  const expectedEtag = input.expectedEtag === undefined ? null : input.expectedEtag;
  return {
    identity: {
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      actorUserId: CHECKPOINT1_SEED_IDS.users.assistant
    },
    idempotency: {
      operationId: expectedEtag ? "updatePatient" : "createPatient",
      key: input.key,
      requestDigest: input.requestDigest ?? DIGEST_A
    },
    concurrency: expectedEtag
      ? { operationId: "updatePatient", resourceId: RESOURCE_ID, expectedEtag }
      : null,
    versionAdvances: expectedEtag
      ? [{ operationId: "updatePatient", resourceId: RESOURCE_ID }]
      : [],
    requestId: `request-${input.key}`,
    now: new Date(NOW.getTime())
  };
}

interface StoredRecord {
  id: string;
  digest: string;
  state: "processing" | "completed" | "expired";
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  expiresAt: string | null;
  response: { status: number; headers: Record<string, string>; body: unknown } | null;
}

class FakeTransactionalDatabase {
  records = new Map<string, StoredRecord>();
  versions = new Map<string, number>();
  transactionEndings: string[] = [];
  repository = Object.freeze({ marker: "transaction-bound-repository" });
  auditSink = Object.freeze({
    appendAuditEvent: async () => undefined
  });
  #tail = Promise.resolve();
  #recordSequence = 0;

  async run(callback) {
    let release = () => {};
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const previous = this.#tail;
    this.#tail = previous.then(() => current);
    await previous;
    const stagedRecords = structuredClone(this.records);
    const stagedVersions = structuredClone(this.versions);
    try {
      const result = await callback({
        repository: this.repository,
        auditSink: this.auditSink,
        requestGuards: this.#guards(stagedRecords, stagedVersions)
      });
      this.records = stagedRecords;
      this.versions = stagedVersions;
      this.transactionEndings.push("commit");
      return result;
    } catch (error) {
      this.transactionEndings.push("rollback");
      throw error;
    } finally {
      release();
    }
  }

  record(key: string) {
    return this.records.get(recordKey(key));
  }

  seedProcessing(key: string, digest: string, leaseExpiresAt: string) {
    this.records.set(recordKey(key), {
      id: this.#nextRecordId(),
      digest,
      state: "processing",
      leaseOwner: "seed-owner",
      leaseExpiresAt,
      expiresAt: null,
      response: null
    });
  }

  seedCompleted(
    key: string,
    digest: string,
    expiresAt: string,
    response: StoredRecord["response"]
  ) {
    this.records.set(recordKey(key), {
      id: this.#nextRecordId(),
      digest,
      state: "completed",
      leaseOwner: null,
      leaseExpiresAt: null,
      expiresAt,
      response
    });
  }

  #guards(records: Map<string, StoredRecord>, versions: Map<string, number>) {
    return {
      idempotency: {
        claim: async (_scope, input) => {
          const key = recordKey(input.idempotencyKey);
          const stored = records.get(key);
          if (!stored) {
            const recordId = this.#nextRecordId();
            records.set(key, {
              id: recordId,
              digest: input.requestDigest,
              state: "processing",
              leaseOwner: input.leaseOwner,
              leaseExpiresAt: input.leaseExpiresAt,
              expiresAt: null,
              response: null
            });
            return {
              outcome: "claimed",
              claim: {
                recordId,
                requestDigest: input.requestDigest,
                leaseOwner: input.leaseOwner
              },
              reclaimed: false
            };
          }
          if (stored.digest !== input.requestDigest) return { outcome: "digest_conflict" };
          if (stored.state === "expired") return { outcome: "expired" };
          if (stored.state === "processing") {
            if (Date.parse(stored.leaseExpiresAt ?? "") > Date.parse(input.now)) {
              return { outcome: "in_progress" };
            }
            stored.leaseOwner = input.leaseOwner;
            stored.leaseExpiresAt = input.leaseExpiresAt;
            return {
              outcome: "claimed",
              claim: {
                recordId: stored.id,
                requestDigest: input.requestDigest,
                leaseOwner: input.leaseOwner
              },
              reclaimed: true
            };
          }
          if (Date.parse(stored.expiresAt ?? "") <= Date.parse(input.now)) {
            stored.state = "expired";
            stored.response = null;
            return { outcome: "expired" };
          }
          return {
            outcome: "replay",
            response: structuredClone(stored.response),
            completedAt: NOW.toISOString(),
            expiresAt: stored.expiresAt
          };
        },
        complete: async (_scope, input) => {
          const stored = [...records.values()].find(
            (candidate) =>
              candidate.id === input.claim.recordId &&
              candidate.state === "processing" &&
              candidate.digest === input.claim.requestDigest &&
              candidate.leaseOwner === input.claim.leaseOwner
          );
          if (!stored) return { outcome: "not_owned" };
          stored.state = "completed";
          stored.leaseOwner = null;
          stored.leaseExpiresAt = null;
          stored.expiresAt = input.expiresAt;
          stored.response = structuredClone(input.response);
          return { outcome: "completed" };
        }
      },
      optimisticConcurrency: {
        readCurrentVersion: async (_scope, input) => {
          const version = versions.get(versionKey(input.operationId, input.resourceId));
          return version ? { outcome: "found", rowVersion: version } : { outcome: "not_found" };
        },
        advanceVersion: async (_scope, input) => {
          const key = versionKey(input.operationId, input.resourceId);
          const version = versions.get(key);
          if (version !== input.expectedVersion) return { outcome: "precondition_not_matched" };
          versions.set(key, version + 1);
          return { outcome: "advanced", rowVersion: version + 1 };
        }
      }
    };
  }

  #nextRecordId(): string {
    return `10000000-0000-4000-8000-${String(++this.#recordSequence).padStart(12, "0")}`;
  }
}

function recordKey(key: string): string {
  return `${CHECKPOINT1_SEED_IDS.tenantId}:${CHECKPOINT1_SEED_IDS.clinicId}:${CHECKPOINT1_SEED_IDS.users.assistant}:${key}`;
}

function versionKey(operationId: string, resourceId: string): string {
  return `${operationId}:${resourceId}`;
}
