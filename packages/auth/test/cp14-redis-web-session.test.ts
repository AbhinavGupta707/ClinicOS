import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CP14_REDIS_WEB_SESSION_MUTATION_SCRIPTS,
  RedisWebSessionStore,
  RedisWebSessionStoreError,
  type RedisScriptClient,
  type RequiredSecurityAuditIntent,
  type WebSessionEnvelope
} from "../src/index.ts";

const baseNow = new Date("2026-07-10T12:00:00.000Z");
const sessionKey = "a".repeat(64);
const nextSessionKey = "b".repeat(64);
const familyKey = "f".repeat(64);
const leaseId = "l".repeat(43);

test("every Redis session mutation has one final state-changing command", () => {
  for (const [name, script] of Object.entries(CP14_REDIS_WEB_SESSION_MUTATION_SCRIPTS)) {
    const directWrites = [
      ...script.matchAll(/redis\.call\('(HSET|HDEL|SET|DEL|XADD|RPUSH|LPUSH)'/g)
    ];
    const dynamicWrites = [...script.matchAll(/redis\.call\(unpack\(write\)\)/g)];
    assert.equal(
      directWrites.length + dynamicWrites.length,
      1,
      `${name} must contain one state-changing command`
    );
    const writeIndex = directWrites[0]?.index ?? dynamicWrites[0]?.index ?? -1;
    assert.ok(writeIndex >= 0);
    assert.doesNotMatch(script.slice(writeIndex + 1), /redis\.call\(/, `${name} writes last`);
  }
});

test("Redis web sessions reject cluster mode and prove a writable dependency", async () => {
  const clustered = new HashRedisDouble();
  clustered.clusterEnabled = true;
  const store = makeStore(clustered);
  await assert.rejects(store.readiness(), RedisWebSessionStoreError);
  assert.equal(clustered.hash.size, 0);

  const primary = new HashRedisDouble();
  await makeStore(primary).readiness();
  assert.equal(primary.topologyChecks, 1);
});

test(
  "official Redis connections fail closed without an unbounded reconnect loop",
  { timeout: 2_000 },
  async () => {
    const store = new RedisWebSessionStore({
      redisUrl: "redis://127.0.0.1:1",
      connectTimeoutMs: 100,
      keyHmacSecret: Buffer.alloc(32, 9),
      keyPrefix: `clinicos:cp14:unreachable-test:${process.pid}`,
      now: () => new Date(baseNow)
    });
    try {
      await assert.rejects(store.readiness(), RedisWebSessionStoreError);
    } finally {
      await store.close();
    }
  }
);

test("Redis web-session state and audit fields roll back together on final-write failure", async () => {
  const redis = new HashRedisDouble();
  const store = makeStore(redis);
  redis.failNextMutation = true;
  await assert.rejects(
    store.create(sessionKey, envelope(1), baseNow, plus(3_600_000), audit("created")),
    /could not confirm/
  );
  assert.equal(redis.hash.size, 0);

  const outcomes = await Promise.all(
    Array.from({ length: 8 }, () =>
      store.create(sessionKey, envelope(1), baseNow, plus(3_600_000), audit("created"))
    )
  );
  assert.equal(outcomes.filter(Boolean).length, 1);
  assert.equal(
    [...redis.hash.keys()].some((field) => field.includes(sessionKey)),
    false
  );
  assert.equal(
    [...redis.hash.keys()].some((field) => field.includes(familyKey)),
    false
  );
  assert.equal(
    [...redis.hash.values()].filter((value) => value.includes("required_security_audit")).length,
    1
  );
});

test("Redis web-session refresh is single-flight, detects orphaned dispatch, and preserves versions", async () => {
  let clock = new Date(baseNow);
  const redis = new HashRedisDouble();
  const store = makeStore(redis, { now: () => new Date(clock), sleep: async () => undefined });
  assert.equal(
    await store.create(sessionKey, envelope(1), baseNow, plus(3_600_000), audit("created")),
    true
  );
  const claims = await Promise.all(
    Array.from({ length: 6 }, (_, index) =>
      store.claimRefresh({
        sessionKey,
        expectedRecordVersion: 1,
        leaseId: `${String(index).padStart(1, "x")}${"l".repeat(42)}`,
        claimedAt: baseNow,
        leaseExpiresAt: plus(10_000)
      })
    )
  );
  assert.equal(claims.filter((claim) => claim.status === "claimed").length, 1);
  const claimedIndex = claims.findIndex((claim) => claim.status === "claimed");
  const winningLease = `${String(claimedIndex).padStart(1, "x")}${"l".repeat(42)}`;
  assert.equal(
    await store.markRefreshDispatched({
      sessionKey,
      expectedRecordVersion: 1,
      leaseId: winningLease,
      dispatchedAt: baseNow
    }),
    true
  );
  clock = plus(10_001);
  assert.deepEqual(
    await store.claimRefresh({
      sessionKey,
      expectedRecordVersion: 1,
      leaseId,
      claimedAt: clock,
      leaseExpiresAt: new Date(clock.getTime() + 10_000)
    }),
    { status: "orphaned_dispatched_refresh" }
  );

  const secondRedis = new HashRedisDouble();
  clock = new Date(baseNow);
  const second = makeStore(secondRedis, {
    now: () => new Date(clock),
    sleep: async () => undefined
  });
  await second.create(sessionKey, envelope(1), baseNow, plus(3_600_000), audit("created-two"));
  assert.deepEqual(
    await second.claimRefresh({
      sessionKey,
      expectedRecordVersion: 1,
      leaseId,
      claimedAt: baseNow,
      leaseExpiresAt: plus(10_000)
    }),
    { status: "claimed" }
  );
  await second.markRefreshDispatched({
    sessionKey,
    expectedRecordVersion: 1,
    leaseId,
    dispatchedAt: baseNow
  });
  assert.equal(
    await second.completeRefresh({
      sessionKey,
      expectedRecordVersion: 1,
      leaseId,
      envelope: envelope(2),
      lastSeenAt: plus(1_000),
      expiresAt: plus(3_600_000)
    }),
    true
  );
  assert.deepEqual(
    await second.waitForRefresh({ sessionKey, observedRecordVersion: 1, waitUntil: plus(10_000) }),
    {
      status: "completed",
      entry: { envelope: envelope(2), lastSeenAt: plus(1_000).toISOString() }
    }
  );
});

test("Redis refresh wait remains bounded when the injected clock stops advancing", async () => {
  const redis = new HashRedisDouble();
  let sleeps = 0;
  const store = makeStore(redis, {
    now: () => new Date(baseNow),
    sleep: async () => {
      sleeps += 1;
    }
  });
  await store.create(sessionKey, envelope(1), baseNow, plus(3_600_000), audit("created-frozen"));
  assert.deepEqual(
    await store.claimRefresh({
      sessionKey,
      expectedRecordVersion: 1,
      leaseId,
      claimedAt: baseNow,
      leaseExpiresAt: plus(10_000)
    }),
    { status: "claimed" }
  );
  assert.deepEqual(
    await store.waitForRefresh({
      sessionKey,
      observedRecordVersion: 1,
      waitUntil: plus(10)
    }),
    { status: "retry_claim" }
  );
  assert.equal(sleeps, 3);
});

test("Redis revocation is replay-safe and required audits remain pending until durable acknowledgement", async () => {
  const redis = new HashRedisDouble();
  const store = makeStore(redis);
  await store.create(sessionKey, envelope(1), baseNow, plus(3_600_000), audit("created"));
  const requiredAudits = [audit("refresh-replay"), audit("revoked")] as const;
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      store.revokeSessionFamily({
        sessionKey,
        familyKey,
        reason: "refresh_replay",
        revokedAt: plus(1_000),
        expiresAt: plus(3_600_000),
        requiredAudits
      })
    )
  );
  assert.equal(results.filter((result) => result === "revoked").length, 1);
  assert.equal(results.filter((result) => result === "already_revoked").length, 5);
  assert.equal(await store.isFamilyRevoked(familyKey, plus(2_000)), true);
  assert.equal(await store.read(sessionKey, plus(2_000)), null);

  const page = await store.scanPendingAudits();
  assert.equal(page.items.length, 3);
  assert.equal(new Set(page.items.map((item) => item.deduplicationKey)).size, 3);
  assert.equal(await store.acknowledgePendingAudit(page.items[0]!.deduplicationKey), true);
  assert.equal((await store.scanPendingAudits()).items.length, 2);
});

test("Redis adapter behavior runs against the configured official client contract", async () => {
  const redisUrl = process.env.CLINICOS_CP14_REDIS_URL;
  const fake = redisUrl ? null : new HashRedisDouble();
  const store = new RedisWebSessionStore({
    ...(redisUrl ? { redisUrl } : { client: fake! }),
    keyHmacSecret: Buffer.alloc(32, 7),
    keyPrefix: `clinicos:cp14:auth-test:${process.pid}`,
    now: () => new Date(baseNow),
    sleep: async () => undefined
  });
  try {
    await store.readiness();
    assert.equal(
      await store.create(sessionKey, envelope(1), baseNow, plus(3_600_000), audit("contract")),
      true
    );
    assert.equal((await store.read(sessionKey, baseNow))?.envelope.recordVersion, 1);
    assert.deepEqual(
      await store.rotate(
        sessionKey,
        nextSessionKey,
        1,
        envelope(2),
        plus(1_000),
        plus(3_600_000),
        audit("rotated")
      ),
      { status: "rotated" }
    );
    assert.equal(await store.read(sessionKey, plus(2_000)), null);
    assert.equal((await store.read(nextSessionKey, plus(2_000)))?.envelope.recordVersion, 2);
    assert.deepEqual(
      await store.claimRefresh({
        sessionKey: nextSessionKey,
        expectedRecordVersion: 2,
        leaseId,
        claimedAt: plus(2_000),
        leaseExpiresAt: plus(12_000)
      }),
      { status: "claimed" }
    );
    assert.equal(
      await store.markRefreshDispatched({
        sessionKey: nextSessionKey,
        expectedRecordVersion: 2,
        leaseId,
        dispatchedAt: plus(2_000)
      }),
      true
    );
    assert.equal(
      await store.completeRefresh({
        sessionKey: nextSessionKey,
        expectedRecordVersion: 2,
        leaseId,
        envelope: envelope(3),
        lastSeenAt: plus(3_000),
        expiresAt: plus(3_600_000)
      }),
      true
    );
    assert.equal(
      await store.revokeSessionFamily({
        sessionKey: nextSessionKey,
        familyKey,
        reason: "logout",
        revokedAt: plus(4_000),
        expiresAt: plus(3_600_000),
        requiredAudits: [audit("contract-revoked")]
      }),
      "revoked"
    );
    assert.equal(await store.isFamilyRevoked(familyKey, plus(5_000)), true);
    const pending = await store.scanPendingAudits();
    assert.ok(pending.items.length >= 3);
    const purged = await store.purgeExpiredStateBatch({ now: plus(3_600_001), count: 100 });
    assert.ok(purged.deleted >= 2);
    assert.ok((await store.scanPendingAudits()).items.length >= 3);
  } finally {
    await store.close();
  }
});

class HashRedisDouble implements RedisScriptClient {
  isOpen = true;
  isReady = true;
  clusterEnabled = false;
  failNextMutation = false;
  topologyChecks = 0;
  readonly hash = new Map<string, string>();

  async connect() {
    this.isOpen = true;
    this.isReady = true;
  }

  async ping() {
    return "PONG";
  }

  async sendCommand(args: readonly string[]) {
    assert.deepEqual(args, ["INFO", "cluster"]);
    this.topologyChecks += 1;
    return `# Cluster\r\ncluster_enabled:${this.clusterEnabled ? 1 : 0}\r\n`;
  }

  async eval(script: string, options: { keys: readonly string[]; arguments: readonly string[] }) {
    const a = options.arguments;
    const marker = script.split("\n", 1)[0];
    if (marker?.includes(":readiness")) return "ready";
    if (marker?.includes(":create")) {
      if (this.active(a[0]!, Number(a[5]))) return "exists";
      if (this.activeFamily(a[1]!, Number(a[5]))) return "family_revoked";
      this.mutate(() => {
        this.hash.set(a[0]!, a[2]!);
        this.hash.set(a[3]!, a[4]!);
      });
      return "created";
    }
    if (marker?.includes(":read") && !marker.includes("readiness"))
      return this.hash.get(a[0]!) ?? null;
    if (marker?.includes(":touch")) {
      const state = this.active(a[0]!, Number(a[4]));
      if (!state) return "missing";
      if (Number(a[1]) > state.lastSeenAtMs) {
        state.lastSeenAtMs = Number(a[1]);
        state.lastSeenAt = a[2];
      }
      state.expiresAtMs = Number(a[3]);
      this.mutate(() => this.hash.set(a[0]!, JSON.stringify(state)));
      return "touched";
    }
    if (marker?.includes(":rotate")) {
      const current = this.active(a[0]!, Number(a[8]));
      if (!current || this.activeFamily(a[2]!, Number(a[8]))) return ["missing_or_revoked"];
      if (current.envelope.recordVersion !== Number(a[6])) return ["version_changed"];
      if (current.refreshLease)
        return ["refresh_in_progress", String(current.refreshLease.expiresAtMs)];
      if (this.active(a[1]!, Number(a[8]))) return ["version_changed"];
      this.mutate(() => {
        this.hash.set(a[0]!, a[7]!);
        this.hash.set(a[1]!, a[3]!);
        this.hash.set(a[4]!, a[5]!);
      });
      return ["rotated"];
    }
    if (marker?.includes(":claim-refresh")) {
      const state = this.active(a[0]!, Number(a[3]));
      if (!state) return ["missing_or_revoked"];
      if (state.envelope.recordVersion !== Number(a[1])) return ["version_changed"];
      if (state.refreshLease) {
        if (state.refreshLease.expiresAtMs > Number(a[3]))
          return ["refresh_in_progress", String(state.refreshLease.expiresAtMs)];
        if (state.refreshLease.phase === "dispatched") return ["orphaned_dispatched_refresh"];
      }
      state.refreshLease = {
        id: a[2],
        recordVersion: Number(a[1]),
        phase: "claimed",
        expiresAtMs: Number(a[4]),
        expiresAt: a[5]
      };
      this.mutate(() => this.hash.set(a[0]!, JSON.stringify(state)));
      return ["claimed"];
    }
    if (marker?.includes(":mark-refresh-dispatched")) {
      const state = this.active(a[0]!, Number(a[4]));
      if (
        !state ||
        state.envelope.recordVersion !== Number(a[1]) ||
        state.refreshLease?.id !== a[2] ||
        state.refreshLease.phase !== "claimed"
      )
        return "rejected";
      state.refreshLease.phase = "dispatched";
      state.refreshLease.dispatchedAt = a[3];
      this.mutate(() => this.hash.set(a[0]!, JSON.stringify(state)));
      return "dispatched";
    }
    if (marker?.includes(":complete-refresh")) {
      const state = this.active(a[0]!, Number(a[5]));
      if (
        !state ||
        state.envelope.recordVersion !== Number(a[1]) ||
        state.refreshLease?.id !== a[2] ||
        state.refreshLease.phase !== "dispatched"
      )
        return "rejected";
      const next = JSON.parse(a[3]!);
      next.lastSeenAtMs = Math.max(next.lastSeenAtMs, state.lastSeenAtMs);
      if (next.lastSeenAtMs === state.lastSeenAtMs) next.lastSeenAt = state.lastSeenAt;
      next.refreshLease = null;
      this.mutate(() => this.hash.set(a[0]!, JSON.stringify(next)));
      return "completed";
    }
    if (marker?.includes(":wait-refresh")) {
      const state = this.active(a[0]!, Number(a[2]));
      if (!state) return ["missing_or_revoked"];
      if (state.envelope.recordVersion > Number(a[1]))
        return [
          "completed",
          JSON.stringify({ envelope: state.envelope, lastSeenAt: state.lastSeenAt })
        ];
      if (!state.refreshLease) return ["retry_claim"];
      if (state.refreshLease.expiresAtMs <= Number(a[2]))
        return [
          state.refreshLease.phase === "dispatched" ? "orphaned_dispatched_refresh" : "retry_claim"
        ];
      return ["waiting", String(state.refreshLease.expiresAtMs)];
    }
    if (marker?.includes(":delete")) return this.hash.delete(a[0]!) ? 1 : 0;
    if (marker?.includes(":revoke-family")) {
      if (this.activeFamily(a[1]!, Number(a[6]))) return "already_revoked";
      const current = this.active(a[0]!, Number(a[6]));
      if (!current) return "missing";
      this.mutate(() => {
        this.hash.set(a[0]!, a[4]!);
        this.hash.set(a[1]!, a[3]!);
        for (let index = 0; index < Number(a[7]); index += 1) {
          this.hash.set(a[8 + index * 2]!, a[9 + index * 2]!);
        }
      });
      return "revoked";
    }
    if (marker?.includes(":is-family-revoked")) return this.hash.get(a[0]!) ?? null;
    if (marker?.includes(":scan-audits")) {
      const values = [...this.hash.entries()].filter(([field]) => field.includes(":audit-field:"));
      return ["0", values.flat()];
    }
    if (marker?.includes(":ack-audit")) return this.hash.delete(a[0]!) ? 1 : 0;
    if (marker?.includes(":purge-expired")) {
      let deleted = 0;
      for (const [field, raw] of [...this.hash.entries()]) {
        if (field.includes(":audit-field:")) continue;
        const value = JSON.parse(raw);
        if (typeof value.expiresAtMs === "number" && value.expiresAtMs <= Number(a[2])) {
          this.hash.delete(field);
          deleted += 1;
        }
      }
      return ["0", String(deleted)];
    }
    throw new Error(`unsupported script marker: ${marker}`);
  }

  async quit() {
    this.isOpen = false;
    this.isReady = false;
  }

  on() {}

  private mutate(effect: () => void) {
    if (this.failNextMutation) {
      this.failNextMutation = false;
      throw new Error("synthetic final write failure");
    }
    effect();
  }

  private active(field: string, nowMs: number): any | null {
    const raw = this.hash.get(field);
    if (!raw) return null;
    const value = JSON.parse(raw);
    return value.kind === "session" && value.expiresAtMs > nowMs ? value : null;
  }

  private activeFamily(field: string, nowMs: number): boolean {
    const raw = this.hash.get(field);
    if (!raw) return false;
    const value = JSON.parse(raw);
    return value.kind === "family-revocation" && value.expiresAtMs > nowMs;
  }
}

function makeStore(
  client: HashRedisDouble,
  overrides: Partial<{ now: () => Date; sleep: (milliseconds: number) => Promise<void> }> = {}
) {
  return new RedisWebSessionStore({
    client,
    keyHmacSecret: Buffer.alloc(32, 3),
    now: () => new Date(baseNow),
    ...overrides
  });
}

function envelope(recordVersion: number): WebSessionEnvelope {
  return {
    schemaVersion: 2,
    recordVersion,
    familyKey,
    keyId: "key-1",
    iv: "i".repeat(16),
    ciphertext: `${"c".repeat(32)}${recordVersion}`,
    tag: "t".repeat(16),
    expiresAt: plus(3_600_000).toISOString()
  };
}

function audit(suffix: string): RequiredSecurityAuditIntent {
  return {
    schemaVersion: 1,
    action: suffix.includes("refresh")
      ? "auth.refresh.replay_detected"
      : suffix.includes("revoked")
        ? "auth.session.revoked"
        : suffix.includes("rotated")
          ? "auth.session.rotated"
          : "auth.session.created",
    occurredAt: baseNow.toISOString(),
    deduplicationKey: `auth.cp14.redis.${suffix.replaceAll("-", ".")}:family-0001`,
    subject: "keycloak-subject-0001",
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-web-bff",
    reasonCode: suffix.includes("refresh") ? "refresh_replay" : suffix
  };
}

function plus(milliseconds: number): Date {
  return new Date(baseNow.getTime() + milliseconds);
}
