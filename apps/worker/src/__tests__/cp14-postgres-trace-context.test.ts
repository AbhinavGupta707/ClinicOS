import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { PostgresOutboxRepository } from "../postgres/postgres-outbox-repository.js";

const eventId = "11111111-1111-4111-8111-111111111111";
const traceparent = "00-10000000000000000000000000000001-1000000000000001-01";

test("worker loads durable trace correlation separately from the outbox payload", async () => {
  const queries: string[] = [];
  const repository = new PostgresOutboxRepository({
    pool: {
      connect: async () => {
        throw new Error("not used");
      },
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [{ traceparent }] };
      },
      end: async () => undefined
    } as unknown as Pool
  });

  assert.deepEqual(await repository.loadForEvent(eventId), { traceparent });
  assert.equal(repository.durability, "durable");
  assert.match(queries[0] ?? "", /from outbox_trace_contexts/u);
  assert.doesNotMatch(queries[0] ?? "", /payload/u);
});

test("worker rejects malformed durable trace correlation", async () => {
  const repository = new PostgresOutboxRepository({
    pool: {
      connect: async () => {
        throw new Error("not used");
      },
      query: async () => ({ rows: [{ traceparent: "patient-123" }] }),
      end: async () => undefined
    } as unknown as Pool
  });

  await assert.rejects(repository.loadForEvent(eventId), /OUTBOX_TRACE_CONTEXT_INVALID/u);
});
