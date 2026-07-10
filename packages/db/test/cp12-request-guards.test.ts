import assert from "node:assert/strict";
import test from "node:test";
import type { UUID } from "@clinic-os/domain";
import {
  API_IDEMPOTENCY_MAX_REPLAY_JSON_DEPTH,
  OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES,
  PostgresClinicUnitOfWork,
  createPostgresClinicModuleUnitOfWork,
  type ApiIdempotencyClaimInput,
  type ApiRequestGuardsPort,
  type ScopedApiRequestGuardsPort,
  type SqlConnectionFactory,
  type SqlQueryClient,
  type SqlQueryResult
} from "../src/index.ts";
import type { RepositoryScope } from "../src/repositories.ts";

const SCOPE = Object.freeze({
  tenantId: "10000000-0000-4000-8000-000000000001",
  clinicId: "10000000-0000-4000-8000-000000000101",
  actorUserId: "10000000-0000-4000-8000-000000001001"
}) satisfies Readonly<RepositoryScope>;
const RESOURCE_ID = "10000000-0000-4000-8000-000000002001" as UUID;
const RECORD_ID = "10000000-0000-4000-8000-000000009001" as UUID;
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const CLAIMED_AT = "2026-07-10T12:00:00.000Z";
const LEASE_EXPIRES_AT = "2026-07-10T12:01:00.000Z";
const COMPLETED_AT = "2026-07-10T12:00:10.000Z";
const REPLAY_EXPIRES_AT = "2026-07-10T13:00:10.000Z";

test("CP12 request guard atomically claims, completes, replays, and rejects digest reuse", async () => {
  const database = new GuardDatabase();
  const unitOfWork = new PostgresClinicUnitOfWork(new GuardSqlPool(database));
  const input = claimInput("cp12-request-key-001");

  const first = await unitOfWork.run(async ({ requestGuards }) => {
    const claimed = await requestGuards.idempotency.claim(SCOPE, input);
    assert.equal(claimed.outcome, "claimed");
    if (claimed.outcome !== "claimed") throw new Error("claim expected");
    const completed = await requestGuards.idempotency.complete(SCOPE, {
      claim: claimed.claim,
      completedAt: COMPLETED_AT,
      expiresAt: REPLAY_EXPIRES_AT,
      response: {
        status: 201,
        headers: {
          "cache-control": "no-store",
          "content-type": "application/json",
          etag: '"2"',
          location: `/v1/patients/${RESOURCE_ID}`
        },
        body: { patientId: RESOURCE_ID, rowVersion: 2 }
      }
    });
    assert.deepEqual(completed, { outcome: "completed" });
    return claimed;
  });
  assert.equal(first.outcome, "claimed");

  const replay = await unitOfWork.run(({ requestGuards }) =>
    requestGuards.idempotency.claim(SCOPE, {
      ...input,
      leaseOwner: "request-worker-2"
    })
  );
  assert.deepEqual(replay, {
    outcome: "replay",
    response: {
      status: 201,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json",
        etag: '"2"',
        location: `/v1/patients/${RESOURCE_ID}`
      },
      body: { patientId: RESOURCE_ID, rowVersion: 2 }
    },
    completedAt: COMPLETED_AT,
    expiresAt: REPLAY_EXPIRES_AT
  });

  const conflict = await unitOfWork.run(({ requestGuards }) =>
    requestGuards.idempotency.claim(SCOPE, {
      ...input,
      requestDigest: DIGEST_B,
      leaseOwner: "request-worker-3"
    })
  );
  assert.deepEqual(conflict, { outcome: "digest_conflict" });
  assertGuardQueriesResetRls(database.queries);
});

test("CP12 concurrent claims expose one owner and one active processing conflict", async () => {
  const database = new GuardDatabase();
  const unitOfWork = new PostgresClinicUnitOfWork(new GuardSqlPool(database));
  const input = claimInput("cp12-concurrent-key-001");

  const outcomes = await Promise.all([
    unitOfWork.run(({ requestGuards }) => requestGuards.idempotency.claim(SCOPE, input)),
    unitOfWork.run(({ requestGuards }) =>
      requestGuards.idempotency.claim(SCOPE, { ...input, leaseOwner: "request-worker-2" })
    )
  ]);

  assert.deepEqual(outcomes.map((result) => result.outcome).sort(), ["claimed", "in_progress"]);
  assert.equal(database.records.size, 1);
});

test("CP12 stale processing leases are reclaimed only for the canonical digest", async () => {
  const database = new GuardDatabase();
  const unitOfWork = new PostgresClinicUnitOfWork(new GuardSqlPool(database));
  const input = claimInput("cp12-stale-key-001");
  const initial = await unitOfWork.run(({ requestGuards }) =>
    requestGuards.idempotency.claim(SCOPE, input)
  );
  assert.equal(initial.outcome, "claimed");
  const record = onlyRecord(database);
  record.lease_expires_at = "2026-07-10T11:59:59.000Z";

  const conflict = await unitOfWork.run(({ requestGuards }) =>
    requestGuards.idempotency.claim(SCOPE, {
      ...input,
      requestDigest: DIGEST_B,
      leaseOwner: "wrong-digest-worker"
    })
  );
  assert.deepEqual(conflict, { outcome: "digest_conflict" });

  const reclaimed = await unitOfWork.run(({ requestGuards }) =>
    requestGuards.idempotency.claim(SCOPE, {
      ...input,
      leaseOwner: "recovery-worker",
      leaseExpiresAt: "2026-07-10T12:02:00.000Z"
    })
  );
  assert.equal(reclaimed.outcome, "claimed");
  if (reclaimed.outcome !== "claimed") throw new Error("reclaim expected");
  assert.equal(reclaimed.reclaimed, true);
  assert.equal(reclaimed.claim.leaseOwner, "recovery-worker");
  const reclaimSql = database.queries.find((query) =>
    /set lease_owner = \$7, lease_expires_at = \$8/u.test(query.sql)
  )?.sql;
  assert.match(reclaimSql ?? "", /lease_expires_at <= \$9/u);
  assert.doesNotMatch(reclaimSql ?? "", /created_at/u);
});

test("CP12 expired replay content is scrubbed into an immutable response-free tombstone", async () => {
  const database = new GuardDatabase();
  const unitOfWork = new PostgresClinicUnitOfWork(new GuardSqlPool(database));
  const input = claimInput("cp12-expiry-key-001");

  await unitOfWork.run(async ({ requestGuards }) => {
    const claimed = await requestGuards.idempotency.claim(SCOPE, input);
    if (claimed.outcome !== "claimed") throw new Error("claim expected");
    await requestGuards.idempotency.complete(SCOPE, {
      claim: claimed.claim,
      completedAt: "2026-07-10T12:00:01.000Z",
      expiresAt: "2026-07-10T12:00:02.000Z",
      response: {
        status: 200,
        headers: { "content-type": "application/json" },
        body: { sensitiveSyntheticPayload: "must-be-scrubbed" }
      }
    });
  });

  const expired = await unitOfWork.run(({ requestGuards }) =>
    requestGuards.idempotency.claim(SCOPE, {
      ...input,
      now: "2026-07-10T12:00:03.000Z",
      leaseExpiresAt: "2026-07-10T12:01:03.000Z",
      leaseOwner: "expiry-worker"
    })
  );
  assert.deepEqual(expired, { outcome: "expired" });
  assert.deepEqual(onlyRecord(database), {
    ...onlyRecord(database),
    state: "expired",
    response_status: null,
    response_headers: {},
    response_body: null,
    lease_owner: null,
    lease_expires_at: null
  });
});

test("CP12 claim and row-version advancement roll back with the enclosing unit of work", async () => {
  const database = new GuardDatabase();
  database.versions.set(`patients:${RESOURCE_ID}`, 7);
  const unitOfWork = new PostgresClinicUnitOfWork(new GuardSqlPool(database));

  await assert.rejects(
    unitOfWork.run(async ({ requestGuards }) => {
      const claim = await requestGuards.idempotency.claim(
        SCOPE,
        claimInput("cp12-rollback-key-001")
      );
      assert.equal(claim.outcome, "claimed");
      const advanced = await requestGuards.optimisticConcurrency.advanceVersion(SCOPE, {
        operationId: "updatePatient",
        resourceId: RESOURCE_ID,
        expectedVersion: 7
      });
      assert.deepEqual(advanced, { outcome: "advanced", rowVersion: 8 });
      throw new Error("CP12_REQUEST_GUARD_ROLLBACK");
    }),
    /CP12_REQUEST_GUARD_ROLLBACK/u
  );

  assert.equal(database.records.size, 0);
  assert.equal(database.versions.get(`patients:${RESOURCE_ID}`), 7);
  assert.equal(database.transactionEndings.at(-1), "rollback");
});

test("CP12 optimistic concurrency uses the exact compile-time operation/table allowlist", async () => {
  const database = new GuardDatabase();
  for (const table of Object.values(OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES)) {
    database.versions.set(`${table}:${RESOURCE_ID}`, 3);
  }
  const unitOfWork = new PostgresClinicUnitOfWork(new GuardSqlPool(database));

  await unitOfWork.run(async ({ requestGuards }) => {
    for (const operationId of Object.keys(OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES) as Array<
      keyof typeof OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES
    >) {
      const read = await requestGuards.optimisticConcurrency.readCurrentVersion(SCOPE, {
        operationId,
        resourceId: RESOURCE_ID
      });
      assert.deepEqual(read, { outcome: "found", rowVersion: 3 });
      const advanced = await requestGuards.optimisticConcurrency.advanceVersion(SCOPE, {
        operationId,
        resourceId: RESOURCE_ID,
        expectedVersion: 3
      });
      assert.deepEqual(advanced, { outcome: "advanced", rowVersion: 4 });
      const stale = await requestGuards.optimisticConcurrency.advanceVersion(SCOPE, {
        operationId,
        resourceId: RESOURCE_ID,
        expectedVersion: 3
      });
      assert.deepEqual(stale, { outcome: "precondition_not_matched" });
    }
  });

  for (const table of Object.values(OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES)) {
    assert.ok(
      database.queries.some((query) => new RegExp(`update ${table} `, "u").test(query.sql))
    );
  }
  const guardedQueryCount = database.queries.filter((query) => isGuardedQuery(query.sql)).length;
  assert.equal(guardedQueryCount, Object.keys(OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES).length * 3);
  assertGuardQueriesResetRls(database.queries);
});

test("CP12 invalid versions and resource identifiers fail before guarded SQL", async () => {
  const database = new GuardDatabase();
  const unitOfWork = new PostgresClinicUnitOfWork(new GuardSqlPool(database));

  await assert.rejects(
    unitOfWork.run(({ requestGuards }) =>
      requestGuards.optimisticConcurrency.advanceVersion(SCOPE, {
        operationId: "updatePatient",
        resourceId: RESOURCE_ID,
        expectedVersion: 0
      })
    ),
    /positive safe integer/u
  );
  await assert.rejects(
    unitOfWork.run(({ requestGuards }) =>
      requestGuards.optimisticConcurrency.readCurrentVersion(SCOPE, {
        operationId: "updatePatient",
        resourceId: "not-a-uuid" as UUID
      })
    ),
    /resourceId must be a valid UUID/u
  );
  await assert.rejects(
    unitOfWork.run(({ requestGuards }) =>
      requestGuards.optimisticConcurrency.readCurrentVersion(SCOPE, {
        operationId: "constructor" as "updatePatient",
        resourceId: RESOURCE_ID
      })
    ),
    /operation is not allowlisted/u
  );
  assert.equal(database.queries.filter((query) => isGuardedQuery(query.sql)).length, 0);
});

test("CP12 idempotency rejects impossible instants and overlong lease or replay retention", async () => {
  const database = new GuardDatabase();
  const unitOfWork = new PostgresClinicUnitOfWork(new GuardSqlPool(database));

  await assert.rejects(
    unitOfWork.run(({ requestGuards }) =>
      requestGuards.idempotency.claim(SCOPE, {
        ...claimInput("cp12-invalid-date-001"),
        now: "2026-02-30T12:00:00.000Z"
      })
    ),
    /now must be a valid ISO instant/u
  );
  await assert.rejects(
    unitOfWork.run(({ requestGuards }) =>
      requestGuards.idempotency.claim(SCOPE, {
        ...claimInput("cp12-long-lease-001"),
        leaseExpiresAt: "2026-07-10T12:05:00.001Z"
      })
    ),
    /lease exceeds the maximum duration/u
  );
  await assert.rejects(
    unitOfWork.run(async ({ requestGuards }) => {
      const claim = await requestGuards.idempotency.claim(
        SCOPE,
        claimInput("cp12-long-retention-001")
      );
      if (claim.outcome !== "claimed") throw new Error("claim expected");
      await requestGuards.idempotency.complete(SCOPE, {
        claim: claim.claim,
        completedAt: COMPLETED_AT,
        expiresAt: "2026-07-11T12:00:10.001Z",
        response: { status: 200, headers: {}, body: null }
      });
    }),
    /retention exceeds the maximum duration/u
  );

  assert.equal(database.records.size, 0);
  assert.equal(
    database.queries.filter((query) => /insert into api_idempotency_records/u.test(query.sql))
      .length,
    1,
    "invalid claim bounds fail before SQL; the retention case claims then rolls back"
  );
});

test("CP12 replay JSON recursively rejects prototype-mutating property names", async () => {
  for (const [index, unsafeName] of ["__proto__", "constructor", "prototype"].entries()) {
    const database = new GuardDatabase();
    const unitOfWork = new PostgresClinicUnitOfWork(new GuardSqlPool(database));
    const unsafe = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(unsafe, unsafeName, {
      enumerable: true,
      value: { nested: true }
    });

    await assert.rejects(
      unitOfWork.run(async ({ requestGuards }) => {
        const claim = await requestGuards.idempotency.claim(
          SCOPE,
          claimInput(`cp12-unsafe-json-00${index}`)
        );
        if (claim.outcome !== "claimed") throw new Error("claim expected");
        await requestGuards.idempotency.complete(SCOPE, {
          claim: claim.claim,
          completedAt: COMPLETED_AT,
          expiresAt: REPLAY_EXPIRES_AT,
          response: {
            status: 200,
            headers: { "content-type": "application/json" },
            body: { safe: { nested: unsafe } } as never
          }
        });
      }),
      /prototype-mutating property name/u,
      unsafeName
    );
    assert.equal(database.records.size, 0, unsafeName);
  }
});

test("CP12 replay JSON rejects nesting beyond the runtime-contract depth bound", async () => {
  const database = new GuardDatabase();
  const unitOfWork = new PostgresClinicUnitOfWork(new GuardSqlPool(database));
  let overDepthBody: unknown = "leaf";
  for (let depth = 0; depth <= API_IDEMPOTENCY_MAX_REPLAY_JSON_DEPTH; depth += 1) {
    overDepthBody = { nested: overDepthBody };
  }

  await assert.rejects(
    unitOfWork.run(async ({ requestGuards }) => {
      const claim = await requestGuards.idempotency.claim(SCOPE, claimInput("cp12-over-depth-001"));
      if (claim.outcome !== "claimed") throw new Error("claim expected");
      await requestGuards.idempotency.complete(SCOPE, {
        claim: claim.claim,
        completedAt: COMPLETED_AT,
        expiresAt: REPLAY_EXPIRES_AT,
        response: {
          status: 200,
          headers: { "content-type": "application/json" },
          body: overDepthBody as never
        }
      });
    }),
    /maximum nesting depth/u
  );
  assert.equal(database.records.size, 0);
});

test("CP12 request-guard ports reject escape and drain unawaited operations before commit", async () => {
  const database = new GuardDatabase();
  database.versions.set(`patients:${RESOURCE_ID}`, 1);
  const unitOfWork = new PostgresClinicUnitOfWork(new GuardSqlPool(database));
  let escaped: ScopedApiRequestGuardsPort | undefined;

  await unitOfWork.run(async ({ requestGuards }) => {
    escaped = requestGuards;
  });
  const queryCountAfterCommit = database.queries.length;
  assert.throws(
    () =>
      escaped?.optimisticConcurrency.readCurrentVersion(SCOPE, {
        operationId: "updatePatient",
        resourceId: RESOURCE_ID
      }),
    /no longer inside its active unit of work/u
  );
  assert.equal(database.queries.length, queryCountAfterCommit);

  const blocker = deferred<void>();
  database.nextVersionQueryBlocker = blocker;
  const transactionEndingCountBeforeUnawaitedRead = database.transactionEndings.length;
  let settled = false;
  const run = unitOfWork
    .run(async ({ requestGuards }) => {
      void requestGuards.optimisticConcurrency.readCurrentVersion(SCOPE, {
        operationId: "updatePatient",
        resourceId: RESOURCE_ID
      });
    })
    .then(() => {
      settled = true;
    });
  await blocker.started;
  assert.equal(settled, false);
  assert.equal(database.transactionEndings.length, transactionEndingCountBeforeUnawaitedRead);
  blocker.resolve();
  await run;
  assert.equal(settled, true);
  assert.equal(database.transactionEndings.at(-1), "commit");
});

test("CP12 module composition binds verified authority once and leases the bound guard port", async () => {
  const database = new GuardDatabase();
  database.versions.set(`patients:${RESOURCE_ID}`, 4);
  const unitOfWork = createPostgresClinicModuleUnitOfWork<{
    readonly verifiedScope: Readonly<RepositoryScope>;
  }>({
    client: new GuardSqlPool(database),
    resolveScope: (context) => context.verifiedScope
  });
  let escaped: ApiRequestGuardsPort | undefined;

  await unitOfWork.run({ verifiedScope: SCOPE }, async ({ requestGuards }) => {
    escaped = requestGuards;
    assert.equal(Object.isFrozen(requestGuards), true);
    assert.equal(Object.isFrozen(requestGuards.idempotency), true);
    assert.equal(Object.isFrozen(requestGuards.optimisticConcurrency), true);
    assert.equal(requestGuards.idempotency.claim.length, 1);
    assert.equal(requestGuards.optimisticConcurrency.readCurrentVersion.length, 1);
    assert.deepEqual(
      await requestGuards.optimisticConcurrency.readCurrentVersion({
        operationId: "updatePatient",
        resourceId: RESOURCE_ID
      }),
      { outcome: "found", rowVersion: 4 }
    );
  });

  assert.throws(
    () =>
      escaped?.optimisticConcurrency.readCurrentVersion({
        operationId: "updatePatient",
        resourceId: RESOURCE_ID
      }),
    /no longer inside its active unit of work/u
  );
});

function claimInput(idempotencyKey: string): ApiIdempotencyClaimInput {
  return {
    operationId: "updatePatient",
    idempotencyKey,
    requestDigest: DIGEST_A,
    now: CLAIMED_AT,
    leaseOwner: "request-worker-1",
    leaseExpiresAt: LEASE_EXPIRES_AT
  };
}

interface StoredIdempotencyRecord {
  id: UUID;
  tenant_id: string;
  clinic_id: string;
  actor_user_id: string;
  operation_id: string;
  idempotency_key: string;
  request_digest: string;
  state: "completed" | "expired" | "processing";
  lease_owner: string | null;
  lease_expires_at: string | null;
  response_status: number | null;
  response_headers: Record<string, string>;
  response_body: unknown;
  created_at: string;
  completed_at: string | null;
  expires_at: string | null;
  expired_at: string | null;
}

interface RecordedQuery {
  readonly sql: string;
  readonly values: readonly unknown[];
}

class GuardDatabase {
  records = new Map<string, StoredIdempotencyRecord>();
  versions = new Map<string, number>();
  readonly queries: RecordedQuery[] = [];
  readonly transactionEndings: Array<"commit" | "rollback"> = [];
  nextVersionQueryBlocker: Deferred<void> | undefined;
}

class GuardSqlPool implements SqlConnectionFactory {
  readonly #database: GuardDatabase;

  constructor(database: GuardDatabase) {
    this.#database = database;
  }

  async connect(): Promise<SqlQueryClient> {
    return new GuardSqlClient(this.#database);
  }

  query<TResult = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<SqlQueryResult<TResult>> {
    return new GuardSqlClient(this.#database).query<TResult>(sql, values);
  }
}

class GuardSqlClient implements SqlQueryClient {
  readonly #database: GuardDatabase;
  #recordsSnapshot = new Map<string, StoredIdempotencyRecord>();
  #versionsSnapshot = new Map<string, number>();
  #inTransaction = false;

  constructor(database: GuardDatabase) {
    this.#database = database;
  }

  async query<TResult = Record<string, unknown>>(
    rawSql: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<TResult>> {
    const sql = rawSql.trim().replace(/\s+/gu, " ");
    this.#database.queries.push({ sql, values: [...values] });
    if (sql === "begin") {
      assert.equal(this.#inTransaction, false);
      this.#inTransaction = true;
      this.#recordsSnapshot = cloneRecords(this.#database.records);
      this.#versionsSnapshot = new Map(this.#database.versions);
      return { rows: [] };
    }
    if (sql === "commit") {
      assert.equal(this.#inTransaction, true);
      this.#database.transactionEndings.push("commit");
      this.#inTransaction = false;
      return { rows: [] };
    }
    if (sql === "rollback") {
      assert.equal(this.#inTransaction, true);
      this.#database.records = cloneRecords(this.#recordsSnapshot);
      this.#database.versions = new Map(this.#versionsSnapshot);
      this.#database.transactionEndings.push("rollback");
      this.#inTransaction = false;
      return { rows: [] };
    }
    if (/set_config\('app\.(?:tenant_id|clinic_id|user_id)'/u.test(sql)) {
      assert.equal(this.#inTransaction, true);
      return { rows: [] };
    }
    assert.equal(this.#inTransaction, true, "guarded SQL must remain inside one transaction");

    if (/insert into api_idempotency_records/u.test(sql)) {
      const key = idempotencyIdentity(values.slice(0, 5));
      if (this.#database.records.has(key)) return { rows: [] };
      const record: StoredIdempotencyRecord = {
        id: RECORD_ID,
        tenant_id: String(values[0]),
        clinic_id: String(values[1]),
        actor_user_id: String(values[2]),
        operation_id: String(values[3]),
        idempotency_key: String(values[4]),
        request_digest: String(values[5]),
        state: "processing",
        lease_owner: String(values[6]),
        lease_expires_at: String(values[7]),
        response_status: null,
        response_headers: {},
        response_body: null,
        created_at: String(values[8]),
        completed_at: null,
        expires_at: null,
        expired_at: null
      };
      this.#database.records.set(key, record);
      return { rows: [{ id: record.id } as TResult] };
    }

    if (/returning request_digest/u.test(sql)) {
      const record = this.#database.records.get(idempotencyIdentity(values.slice(0, 5)));
      if (
        !record ||
        record.state !== "completed" ||
        !record.expires_at ||
        Date.parse(record.expires_at) > Date.parse(String(values[5]))
      ) {
        return { rows: [] };
      }
      expireRecord(record, String(values[5]));
      return { rows: [{ request_digest: record.request_digest } as TResult] };
    }

    if (/set lease_owner = \$7, lease_expires_at = \$8/u.test(sql)) {
      const record = this.#database.records.get(idempotencyIdentity(values.slice(0, 5)));
      if (
        !record ||
        record.request_digest !== values[5] ||
        record.state !== "processing" ||
        !record.lease_expires_at ||
        Date.parse(record.lease_expires_at) > Date.parse(String(values[8]))
      ) {
        return { rows: [] };
      }
      record.lease_owner = String(values[6]);
      record.lease_expires_at = String(values[7]);
      return { rows: [{ id: record.id } as TResult] };
    }

    if (/select id, request_digest, state, lease_expires_at/u.test(sql)) {
      const record = this.#database.records.get(idempotencyIdentity(values));
      return { rows: record ? [{ ...record } as TResult] : [] };
    }

    if (/set state = 'completed'/u.test(sql)) {
      const record = [...this.#database.records.values()].find(
        (candidate) =>
          candidate.tenant_id === values[0] &&
          candidate.clinic_id === values[1] &&
          candidate.id === values[2]
      );
      if (
        !record ||
        record.state !== "processing" ||
        record.lease_owner !== values[3] ||
        record.request_digest !== values[4]
      ) {
        return { rows: [] };
      }
      record.state = "completed";
      record.lease_owner = null;
      record.lease_expires_at = null;
      record.response_status = Number(values[5]);
      record.response_headers = JSON.parse(String(values[6])) as Record<string, string>;
      record.response_body = JSON.parse(String(values[7])) as unknown;
      record.completed_at = String(values[8]);
      record.expires_at = String(values[9]);
      return { rows: [{ id: record.id } as TResult] };
    }

    if (/set state = 'expired'/u.test(sql) && /and id = \$3/u.test(sql)) {
      const record = [...this.#database.records.values()].find(
        (candidate) =>
          candidate.tenant_id === values[0] &&
          candidate.clinic_id === values[1] &&
          candidate.id === values[2]
      );
      if (
        record?.state === "completed" &&
        record.expires_at &&
        Date.parse(record.expires_at) <= Date.parse(String(values[3]))
      ) {
        expireRecord(record, String(values[3]));
      }
      return { rows: [] };
    }

    const versionRead = /select row_version from ([a-z_]+) /u.exec(sql);
    if (versionRead?.[1]) {
      const blocker = this.#database.nextVersionQueryBlocker;
      if (blocker) {
        this.#database.nextVersionQueryBlocker = undefined;
        blocker.markStarted();
        await blocker.promise;
      }
      const version = this.#database.versions.get(`${versionRead[1]}:${String(values[2])}`);
      return { rows: version ? [{ row_version: version } as TResult] : [] };
    }

    const versionAdvance = /update ([a-z_]+) set row_version = row_version \+ 1/u.exec(sql);
    if (versionAdvance?.[1]) {
      const key = `${versionAdvance[1]}:${String(values[2])}`;
      const version = this.#database.versions.get(key);
      if (version !== Number(values[3])) return { rows: [] };
      this.#database.versions.set(key, version + 1);
      return { rows: [{ row_version: version + 1 } as TResult] };
    }

    throw new Error(`Unexpected request-guard SQL in test adapter: ${sql}`);
  }

  release(): void {
    assert.equal(this.#inTransaction, false);
  }
}

function idempotencyIdentity(values: readonly unknown[]): string {
  return values.slice(0, 5).map(String).join("|");
}

function onlyRecord(database: GuardDatabase): StoredIdempotencyRecord {
  assert.equal(database.records.size, 1);
  const record = [...database.records.values()][0];
  if (!record) throw new Error("record expected");
  return record;
}

function cloneRecords(
  records: ReadonlyMap<string, StoredIdempotencyRecord>
): Map<string, StoredIdempotencyRecord> {
  return new Map([...records].map(([key, value]) => [key, structuredClone(value)]));
}

function expireRecord(record: StoredIdempotencyRecord, expiredAt: string): void {
  record.state = "expired";
  record.lease_owner = null;
  record.lease_expires_at = null;
  record.response_status = null;
  record.response_headers = {};
  record.response_body = null;
  record.expired_at = expiredAt;
}

function isGuardedQuery(sql: string): boolean {
  return /api_idempotency_records|(?:select|update) row_version|update (?:patients|leads|appointments|queue_entries|encounters|dental_findings|treatment_plans|tasks|sop_runs|lab_cases|inventory_check_runs|corrective_actions) set row_version/u.test(
    sql
  );
}

function assertGuardQueriesResetRls(queries: readonly RecordedQuery[]): void {
  for (const [index, query] of queries.entries()) {
    if (!isGuardedQuery(query.sql)) continue;
    assert.deepEqual(
      queries.slice(index - 3, index).map((candidate) => candidate.sql),
      [
        "select set_config('app.tenant_id', $1, true)",
        "select set_config('app.clinic_id', $1, true)",
        "select set_config('app.user_id', $1, true)"
      ]
    );
  }
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly started: Promise<void>;
  resolve(value?: T): void;
  markStarted(): void;
}

function deferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let resolveStarted!: () => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  const started = new Promise<void>((resolve) => {
    resolveStarted = resolve;
  });
  return {
    promise,
    started,
    resolve: (value?: T) => resolvePromise(value as T),
    markStarted: () => resolveStarted()
  };
}
