import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  validateRequiredSecurityAuditIntent,
  canonicalSecurityAuditPayload,
  type RequiredSecurityAuditIntent
} from "../src/security-audit.ts";
import {
  PostgresSecurityAuditSink,
  SecurityAuditSinkError
} from "../src/postgres-security-audit-sink.ts";
import {
  SecurityAuditDispatcher,
  type PendingSecurityAuditSource
} from "../src/security-audit-dispatcher.ts";
import type { RedisSecurityAuditOutboxPage } from "../src/redis-web-session-store.ts";
const now = new Date("2026-09-24T12:00:00.000Z");
function intent(key = "synthetic-audit-1"): RequiredSecurityAuditIntent {
  return {
    schemaVersion: 1,
    action: "auth.session.created",
    occurredAt: now.toISOString(),
    deduplicationKey: key,
    subject: "synthetic-user",
    issuer: "https://identity.example/realms/test",
    authorizedParty: "clinic-web",
    reasonCode: "login"
  };
}
function item(key: string) {
  const value = intent(key);
  return {
    field: "opaque-field",
    deduplicationKey: key,
    intent: value,
    serializedRecord: JSON.stringify(value)
  };
}

test("audit boundary rejects extra secrets, unknown schema/actions, absent fields and noncanonical dates", () => {
  for (const bad of [
    null,
    {},
    { ...intent(), schemaVersion: 2 },
    { ...intent(), action: "fake" },
    { ...intent(), accessToken: "sensitive" },
    { ...intent(), issuer: undefined },
    { ...intent(), subject: 123 },
    { ...intent(), occurredAt: "2026-09-24" },
    { ...intent(), reasonCode: undefined },
    { ...intent(), action: "auth.mfa.denied", reasonCode: "login", roleSlugs: [] }
  ])
    assert.throws(() => validateRequiredSecurityAuditIntent(bad as never));
  const roles = ["doctor", "owner_admin"];
  const value = {
    ...intent(),
    action: "auth.mfa.denied",
    reasonCode: "privileged_role",
    roleSlugs: roles
  } as const;
  const canonical = validateRequiredSecurityAuditIntent(value);
  roles.pop();
  assert.equal((canonical as typeof value).roleSlugs.length, 2);
  assert.equal(
    JSON.stringify(canonicalSecurityAuditPayload(value)).includes(value.deduplicationKey),
    false
  );
});

test("Postgres sink commits matching evidence, rejects changed payload and sanitizes SQL failure", async () => {
  for (const mode of ["insert", "replay", "conflict", "outage", "commit_uncertain"] as const) {
    const calls: string[] = [];
    let released = false;
    let digest = "";
    const sink = new PostgresSecurityAuditSink({
      async connect() {
        return {
          async query(sql: string, values?: readonly unknown[]) {
            calls.push(sql);
            if (sql.startsWith("insert into")) {
              assert.equal(String(values?.[0]).includes("synthetic-audit"), false);
              assert.equal(String(values?.[2]).includes("deduplicationKey"), false);
              digest = String(values?.[1]);
              if (mode === "outage") throw new Error("password=DO_NOT_EXPOSE");
            }
            if (sql.startsWith("select payload_digest,"))
              return {
                rows: [
                  {
                    payload_digest: mode === "conflict" ? "b".repeat(64) : digest,
                    matches: mode !== "conflict"
                  }
                ]
              };
            if (sql === "commit" && mode === "commit_uncertain")
              throw new Error("sensitive network diagnostic");
            return { rows: [] };
          },
          release() {
            released = true;
          }
        } as never;
      }
    });
    if (mode === "insert" || mode === "replay") await sink.append(intent());
    else
      await assert.rejects(
        sink.append(intent()),
        (error: unknown) =>
          error instanceof SecurityAuditSinkError && !/password|sensitive/.test(error.message)
      );
    assert.equal(calls.at(-1), ["insert", "replay"].includes(mode) ? "commit" : "rollback");
    assert.equal(released, true);
  }
});

function setup(keys = ["synthetic-audit-1"], batchSize = 100) {
  let clock = new Date(now);
  let failSink = false;
  let failAck = false;
  let changed = false;
  const pending = keys.map(item);
  const retained = new Map<string, string>();
  let scans = 0;
  const source: PendingSecurityAuditSource = {
    async scanPendingAudits() {
      scans++;
      return { nextCursor: "0", items: [...pending] };
    },
    async acknowledgePendingAudit(entry) {
      if (failAck) {
        failAck = false;
        throw new Error("uncertain acknowledgement");
      }
      if (changed) return "changed";
      const index = pending.findIndex((p) => p.deduplicationKey === entry.deduplicationKey);
      if (index < 0) return "missing";
      pending.splice(index, 1);
      return "acknowledged";
    },
    async readiness() {}
  };
  const sink = {
    durability: "durable_append_only" as const,
    async readiness() {},
    async append(value: RequiredSecurityAuditIntent) {
      if (failSink) throw new Error("synthetic database down");
      const digest = createHash("sha256")
        .update(JSON.stringify(canonicalSecurityAuditPayload(value)))
        .digest("hex");
      const old = retained.get(value.deduplicationKey);
      if (old && old !== digest) throw new SecurityAuditSinkError("conflicting_evidence");
      retained.set(value.deduplicationKey, digest);
    }
  };
  const make = () =>
    new SecurityAuditDispatcher({
      source,
      sink,
      now: () => clock,
      batchSize,
      maximumSilenceMs: 1000
    });
  return {
    dispatcher: make(),
    make,
    pending,
    retained,
    setClock: (value: Date) => {
      clock = value;
    },
    failSink: (value: boolean) => {
      failSink = value;
    },
    failAck: () => {
      failAck = true;
    },
    changed: () => {
      changed = true;
    },
    scans: () => scans
  };
}

test("dispatcher bounds oversized pages, requires a clean sweep and removes stale readiness", async () => {
  const h = setup(["synthetic-1", "synthetic-2", "synthetic-3"], 2);
  await assert.rejects(h.dispatcher.readiness());
  assert.deepEqual(await h.dispatcher.runOnce(), {
    delivered: 2,
    conflicts: 0,
    scanComplete: false
  });
  await assert.rejects(h.dispatcher.readiness());
  assert.deepEqual(await h.dispatcher.runOnce(), {
    delivered: 1,
    conflicts: 0,
    scanComplete: true
  });
  assert.equal(h.scans(), 1);
  await h.dispatcher.readiness();
  h.setClock(new Date(now.getTime() + 1001));
  await assert.rejects(h.dispatcher.readiness());
});

test("database failure retains pending records; restart after commit-before-ack safely replays", async () => {
  const h = setup();
  h.failSink(true);
  await assert.rejects(h.dispatcher.runOnce());
  assert.equal(h.pending.length, 1);
  assert.equal(h.retained.size, 0);
  h.failSink(false);
  h.failAck();
  await assert.rejects(h.dispatcher.runOnce());
  assert.equal(h.pending.length, 1);
  assert.equal(h.retained.size, 1);
  const restarted = h.make();
  await restarted.runOnce();
  await restarted.readiness();
  assert.equal(h.pending.length, 0);
  assert.equal(h.retained.size, 1);
});

test("conflicting evidence is retained without starving unrelated audits or restoring readiness", async () => {
  const h = setup(["synthetic-poison", "synthetic-good"]);
  h.retained.set("synthetic-poison", "inconsistent-digest");
  assert.deepEqual(await h.dispatcher.runOnce(), {
    delivered: 1,
    conflicts: 1,
    scanComplete: true
  });
  assert.deepEqual(
    h.pending.map((p) => p.deduplicationKey),
    ["synthetic-poison"]
  );
  await assert.rejects(h.dispatcher.readiness());
  assert.equal((await h.dispatcher.runOnce()).conflicts, 1);
  await assert.rejects(h.dispatcher.readiness());
});

test("changed acknowledgements preserve replacement evidence and fail readiness", async () => {
  const h = setup();
  h.changed();
  assert.equal((await h.dispatcher.runOnce()).conflicts, 1);
  assert.equal(h.pending.length, 1);
  await assert.rejects(h.dispatcher.readiness());
});

test("privileged-role MFA evidence needs a role; break-glass denial may precede a product role", () => {
  assert.throws(() =>
    validateRequiredSecurityAuditIntent({
      ...intent(),
      action: "auth.mfa.denied",
      reasonCode: "privileged_role",
      roleSlugs: []
    })
  );
  assert.equal(
    validateRequiredSecurityAuditIntent({
      ...intent(),
      action: "auth.mfa.denied",
      reasonCode: "break_glass",
      roleSlugs: []
    }).action,
    "auth.mfa.denied"
  );
});

test(
  "a timed-out commit destroys its connection, retains Redis evidence, and retries idempotently",
  { timeout: 3000 },
  async () => {
    let hangCommit = true;
    const commands: string[] = [];
    const releases: boolean[] = [];
    let storedDigest: string | undefined;
    const pending = [item("synthetic-timeout")];
    const source: PendingSecurityAuditSource = {
      async scanPendingAudits() {
        return { nextCursor: "0", items: [...pending] };
      },
      async acknowledgePendingAudit() {
        pending.pop();
        return "acknowledged";
      },
      async readiness() {}
    };
    const pool = {
      async connect() {
        let attemptedDigest = "";
        return {
          async query(sql: string, values?: readonly unknown[]) {
            commands.push(sql);
            if (sql.startsWith("insert into")) attemptedDigest = String(values?.[1]);
            if (sql.startsWith("select payload_digest,"))
              return { rows: [{ payload_digest: storedDigest ?? attemptedDigest, matches: true }] };
            if (sql === "commit") {
              storedDigest ??= attemptedDigest;
              if (hangCommit) return new Promise(() => {});
            }
            return { rows: [] };
          },
          release(discard: boolean) {
            releases.push(discard);
          }
        } as never;
      }
    };
    const sink = new PostgresSecurityAuditSink(pool, { commandTimeoutMs: 100 });
    const dispatcher = new SecurityAuditDispatcher({ source, sink, now: () => now });
    await assert.rejects(dispatcher.runOnce());
    assert.equal(pending.length, 1);
    assert.ok(storedDigest);
    assert.equal(commands.includes("rollback"), false);
    assert.deepEqual(releases, [true]);
    hangCommit = false;
    await new SecurityAuditDispatcher({ source, sink, now: () => now }).runOnce();
    assert.equal(pending.length, 0);
    assert.deepEqual(releases, [true, false]);
  }
);

test(
  "a pool acquisition arriving after the deadline is discarded and never queried",
  { timeout: 3000 },
  async () => {
    let complete: (client: never) => void = () => {};
    let released = false;
    let queries = 0;
    const sink = new PostgresSecurityAuditSink(
      {
        connect: () =>
          new Promise((resolve) => {
            complete = resolve;
          })
      },
      { commandTimeoutMs: 100 }
    );
    await assert.rejects(sink.append(intent()));
    complete({
      async query() {
        queries++;
        return { rows: [] };
      },
      release(discard: boolean) {
        released = discard;
      }
    } as never);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(released, true);
    assert.equal(queries, 0);
  }
);
