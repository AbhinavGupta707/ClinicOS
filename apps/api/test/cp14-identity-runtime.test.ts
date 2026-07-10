import assert from "node:assert/strict";
import { test } from "node:test";
import type { RedisScriptClient } from "@clinic-os/auth";
import {
  CP14_REDIS_TOKEN_REVOCATION_MUTATION_SCRIPT,
  RedisTokenRevocationStore,
  RedisTokenRevocationStoreError
} from "../src/features/identity-session-edge/index.ts";

const now = new Date("2026-07-10T12:00:00.000Z");
const subject = "keycloak-subject-0001";
const tokenId = "access-token-id-0001";
const sessionId = "keycloak-session-0001";

test("token revocation mutation has one final HSET and rejects Redis Cluster", async () => {
  const writes = [
    ...CP14_REDIS_TOKEN_REVOCATION_MUTATION_SCRIPT.matchAll(
      /redis\.call\('(HSET|HDEL|SET|DEL|XADD)'/g
    ),
    ...CP14_REDIS_TOKEN_REVOCATION_MUTATION_SCRIPT.matchAll(/redis\.call\(unpack\(command\)\)/g)
  ];
  assert.equal(writes.length, 1);
  const writeIndex = writes[0]?.index ?? -1;
  assert.ok(writeIndex >= 0);
  assert.doesNotMatch(
    CP14_REDIS_TOKEN_REVOCATION_MUTATION_SCRIPT.slice(writeIndex + 1),
    /redis\.call\(/
  );

  const redis = new RevocationRedisDouble();
  redis.clusterEnabled = true;
  await assert.rejects(makeStore(redis).readiness(), RedisTokenRevocationStoreError);
  assert.equal(redis.hash.size, 0);
});

test("distributed revocation atomically records token, session, and monotonic subject cutoffs", async () => {
  const redis = new RevocationRedisDouble();
  const store = makeStore(redis);
  await store.readiness();
  await store.recordRevocation({
    subject,
    tokenId,
    keycloakSessionId: sessionId,
    subjectTokensIssuedThrough: new Date(now.getTime() - 1_000),
    reason: "jml_transition",
    revokedAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000)
  });
  assert.equal(await store.isRevoked(query({ tokenId })), true);
  assert.equal(await store.isRevoked(query({ tokenId: "different-token-id-1" })), true);
  assert.equal(
    await store.isRevoked(
      query({
        tokenId: "future-token-id-0001",
        keycloakSessionId: "future-session-id-0001",
        issuedAt: new Date(now.getTime() + 1_000).toISOString(),
        now: new Date(now.getTime() + 1_000)
      })
    ),
    false
  );
  assert.equal(
    [...redis.hash.keys()].some((field) => field.includes(subject)),
    false
  );
  assert.equal(
    [...redis.hash.keys()].some((field) => field.includes(tokenId)),
    false
  );

  await Promise.all([
    store.recordRevocation({
      subject,
      subjectTokensIssuedThrough: new Date(now.getTime() - 5_000),
      reason: "authority_revision",
      revokedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000)
    }),
    store.recordRevocation({
      subject,
      subjectTokensIssuedThrough: new Date(now.getTime() + 500),
      reason: "administrator_action",
      revokedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000)
    })
  ]);
  assert.equal(
    await store.isRevoked(
      query({
        tokenId: "cutoff-token-id-0001",
        keycloakSessionId: "cutoff-session-id-01",
        issuedAt: new Date(now.getTime() + 250).toISOString(),
        now: new Date(now.getTime() + 1_000)
      })
    ),
    true
  );
});

test("revocation write uncertainty leaves no partial marker and checks fail closed", async () => {
  const redis = new RevocationRedisDouble();
  const store = makeStore(redis);
  redis.failNextMutation = true;
  await assert.rejects(
    store.recordRevocation({
      subject,
      tokenId,
      keycloakSessionId: sessionId,
      reason: "logout",
      revokedAt: now,
      expiresAt: new Date(now.getTime() + 600_000)
    }),
    /could not confirm/
  );
  assert.equal(redis.hash.size, 0);
  redis.failChecks = true;
  const error = await store.isRevoked(query({})).catch((caught: unknown) => caught);
  assert.ok(error instanceof RedisTokenRevocationStoreError);
  assert.equal(error.code, "dependency_unavailable");
  assert.doesNotMatch(String(error), new RegExp(tokenId));
});

test("later exact revocations cannot shorten token or Keycloak-session marker retention", async () => {
  const redis = new RevocationRedisDouble();
  const store = makeStore(redis);
  await store.recordRevocation({
    subject,
    tokenId,
    keycloakSessionId: sessionId,
    reason: "administrator_action",
    revokedAt: now,
    expiresAt: new Date(now.getTime() + 3_600_000)
  });
  await store.recordRevocation({
    subject,
    tokenId,
    keycloakSessionId: sessionId,
    reason: "logout",
    revokedAt: new Date(now.getTime() + 1_000),
    expiresAt: new Date(now.getTime() + 601_000)
  });
  const later = new Date(now.getTime() + 1_200_000);
  assert.equal(
    await store.isRevoked(
      query({
        tokenId,
        keycloakSessionId: "unrelated-session-0001",
        now: later
      })
    ),
    true,
    "token marker must retain the longer first expiry"
  );
  assert.equal(
    await store.isRevoked(
      query({
        tokenId: "unrelated-token-id-01",
        keycloakSessionId: sessionId,
        now: later
      })
    ),
    true,
    "session marker must retain the longer first expiry"
  );
});

test("token revocation behavior runs through the official Redis client contract", async () => {
  const redisUrl = process.env.CLINICOS_CP14_REDIS_URL;
  const fake = redisUrl ? null : new RevocationRedisDouble();
  const store = new RedisTokenRevocationStore({
    ...(redisUrl ? { redisUrl } : { client: fake! }),
    keyHmacSecret: Buffer.alloc(32, 8),
    keyPrefix: `clinicos:cp14:revocation-test:${process.pid}`,
    now: () => new Date(now)
  });
  try {
    await store.readiness();
    await store.recordRevocation({
      subject,
      tokenId,
      keycloakSessionId: sessionId,
      reason: "administrator_action",
      revokedAt: now,
      expiresAt: new Date(now.getTime() + 3_600_000)
    });
    assert.equal(await store.isRevoked(query({})), true);
    await store.recordRevocation({
      subject,
      tokenId,
      keycloakSessionId: sessionId,
      reason: "logout",
      revokedAt: new Date(now.getTime() + 1_000),
      expiresAt: new Date(now.getTime() + 601_000)
    });
    assert.equal(
      await store.isRevoked(
        query({
          tokenId: "contract-other-token-01",
          keycloakSessionId: sessionId,
          now: new Date(now.getTime() + 1_200_000)
        })
      ),
      true
    );
    const purged = await store.purgeExpiredRevocationsBatch({
      now: new Date(now.getTime() + 3_600_001),
      count: 100
    });
    assert.ok(purged.deleted >= 2);
  } finally {
    await store.close();
  }
});

class RevocationRedisDouble implements RedisScriptClient {
  isOpen = true;
  isReady = true;
  clusterEnabled = false;
  failNextMutation = false;
  failChecks = false;
  readonly hash = new Map<string, string>();

  async connect() {
    this.isOpen = true;
    this.isReady = true;
  }

  async ping() {
    return "PONG";
  }

  async sendCommand() {
    return `# Cluster\r\ncluster_enabled:${this.clusterEnabled ? 1 : 0}\r\n`;
  }

  async eval(script: string, options: { keys: readonly string[]; arguments: readonly string[] }) {
    const marker = script.split("\n", 1)[0];
    const a = options.arguments;
    if (marker?.includes(":readiness")) return "ready";
    if (marker?.includes(":record")) {
      if (this.failNextMutation) {
        this.failNextMutation = false;
        throw new Error("synthetic final HSET failure");
      }
      for (const field of [a[0], a[1]]) {
        if (!field) continue;
        const next = JSON.parse(a[4]!);
        const existing = this.hash.get(field);
        if (existing)
          next.expiresAtMs = Math.max(next.expiresAtMs, JSON.parse(existing).expiresAtMs);
        this.hash.set(field, JSON.stringify(next));
      }
      if (a[2]) {
        const existing = this.hash.get(a[2]);
        const previous = existing ? JSON.parse(existing) : null;
        this.hash.set(
          a[2],
          JSON.stringify({
            schemaVersion: 1,
            kind: "subject-cutoff",
            cutoffMs: Math.max(Number(a[5]), previous?.cutoffMs ?? 0),
            expiresAtMs: Math.max(Number(a[3]), previous?.expiresAtMs ?? 0)
          })
        );
      }
      return "recorded";
    }
    if (marker?.includes(":check")) {
      if (this.failChecks) throw new Error("synthetic Redis loss");
      const nowMs = Number(a[1]);
      for (const field of [a[2], a[3]]) {
        const raw = field ? this.hash.get(field) : null;
        if (raw && JSON.parse(raw).expiresAtMs > nowMs) return "revoked";
      }
      const subjectRaw = a[4] ? this.hash.get(a[4]) : null;
      if (subjectRaw) {
        const value = JSON.parse(subjectRaw);
        if (value.expiresAtMs > nowMs && Number(a[0]) <= value.cutoffMs) return "revoked";
      }
      return "active";
    }
    if (marker?.includes(":purge-expired")) {
      let deleted = 0;
      for (const [field, raw] of [...this.hash.entries()]) {
        const value = JSON.parse(raw);
        if (value.expiresAtMs <= Number(a[2])) {
          this.hash.delete(field);
          deleted += 1;
        }
      }
      return ["0", String(deleted)];
    }
    throw new Error(`unsupported script: ${marker}`);
  }

  async quit() {
    this.isOpen = false;
    this.isReady = false;
  }

  on() {}
}

function makeStore(client: RevocationRedisDouble) {
  return new RedisTokenRevocationStore({
    client,
    keyHmacSecret: Buffer.alloc(32, 6),
    now: () => new Date(now)
  });
}

function query(
  overrides: Partial<{
    tokenId: string;
    keycloakSessionId: string;
    issuedAt: string;
    now: Date;
  }>
) {
  return {
    subject,
    tokenId,
    keycloakSessionId: sessionId,
    issuedAt: new Date(now.getTime() - 2_000).toISOString(),
    now,
    ...overrides
  };
}
