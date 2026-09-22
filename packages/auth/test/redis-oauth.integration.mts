import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createClient } from "redis";
import {
  OAuthTransactionManager,
  OpaqueRedisKeyspace,
  RedisOAuthTransactionStore,
  type OAuthTransactionRecord
} from "../src/index.ts";

// Explicit command only; never silently substitute a double or skip an integration gate.
assert.equal(
  process.env.CLINICOS_OAUTH_REDIS_TEST_ENABLED,
  "true",
  "Synthetic Redis test opt-in is required."
);
assert.equal(process.env.PILOT_SYNTHETIC_DATA_ONLY, "true", "Synthetic-data opt-in is required.");
const redisUrl = process.env.CLINICOS_OAUTH_REDIS_TEST_URL;
assert.ok(redisUrl, "An explicit disposable loopback Redis URL is required.");
let parsed: URL;
try {
  parsed = new URL(redisUrl);
} catch {
  throw new Error("The synthetic Redis test URL is invalid.");
}
assert.ok(
  parsed.protocol === "redis:" &&
    ["127.0.0.1", "[::1]"].includes(parsed.hostname) &&
    !parsed.username &&
    !parsed.password &&
    !parsed.search &&
    !parsed.hash &&
    /^\/(?:[0-9]|1[0-5])?$/.test(parsed.pathname || "/"),
  "Only a credential-free loopback test Redis is accepted."
);

test(
  "real Redis: distributed PKCE transactions are encrypted, bounded and consumed once",
  { timeout: 20_000 },
  async () => {
    const prefix = `clinicos:oauth:test:${randomBytes(12).toString("hex")}`;
    const keyHmacSecret = randomBytes(32);
    const encryptionKey = { id: "synthetic-test-key", key: randomBytes(32) };
    const keyspace = new OpaqueRedisKeyspace({ prefix, hmacKey: keyHmacSecret });
    const ownedKeys: string[] = [];
    const inspector = createClient({
      url: redisUrl,
      disableOfflineQueue: true,
      socket: { connectTimeout: 2_000, reconnectStrategy: false }
    });
    inspector.on("error", () => {});
    const stores = Array.from(
      { length: 4 },
      () =>
        new RedisOAuthTransactionStore({
          redisUrl,
          keyHmacSecret,
          keyPrefix: prefix,
          encryptionKeys: [encryptionKey],
          now: () => new Date()
        })
    );
    const key = () => {
      const id = randomBytes(32).toString("hex");
      const redisKey = keyspace.key("transaction", id);
      ownedKeys.push(redisKey);
      return { id, redisKey };
    };
    const makeRecord = (ttl = 300_000): OAuthTransactionRecord => {
      const created = new Date();
      return {
        channel: "web_bff",
        clientId: "clinic-os-web-bff",
        redirectUri: "https://clinic.example/auth/callback",
        codeVerifier: randomBytes(64).toString("base64url"),
        nonce: randomBytes(32).toString("base64url"),
        returnTo: "/surface/patients",
        createdAt: created.toISOString(),
        expiresAt: new Date(created.getTime() + ttl).toISOString()
      };
    };
    try {
      await inspector.connect();
      await Promise.all(stores.map((s) => s.readiness()));
      const collision = key();
      const record = makeRecord();
      const created = await Promise.all(
        Array.from({ length: 32 }, (_, i) =>
          stores[i % stores.length].create(collision.id, record, new Date(record.expiresAt))
        )
      );
      assert.equal(created.filter(Boolean).length, 1);
      const raw = await inspector.get(collision.redisKey);
      assert.ok(
        raw &&
          !raw.includes(record.codeVerifier) &&
          !raw.includes(record.nonce) &&
          !raw.includes(record.returnTo)
      );
      const ttl = await inspector.pTTL(collision.redisKey);
      assert.ok(
        ttl > 0 && ttl <= 300_000,
        "Redis must attach finite expiry atomically with the record."
      );
      const consumed = await Promise.all(
        Array.from({ length: 32 }, (_, i) =>
          stores[i % stores.length].consume(collision.id, new Date())
        )
      );
      assert.equal(consumed.filter(Boolean).length, 1);
      assert.deepEqual(consumed.find(Boolean), record);
      assert.equal(await inspector.exists(collision.redisKey), 0);

      const expiring = key();
      const short = makeRecord(1_000);
      await stores[0].create(expiring.id, short, new Date(short.expiresAt));
      await delay(1_100);
      assert.equal(await inspector.exists(expiring.redisKey), 0);
      assert.equal(await stores[1].consume(expiring.id, new Date()), null);

      const corrupt = key();
      await inspector.set(corrupt.redisKey, "synthetic-corrupt-evidence", { PX: 5_000 });
      await assert.rejects(stores[0].consume(corrupt.id, new Date()), { code: "corrupt_response" });
      assert.equal(await inspector.exists(corrupt.redisKey), 0);

      const wrongType = key();
      await inspector.hSet(wrongType.redisKey, "synthetic", "wrong-type");
      await inspector.pExpire(wrongType.redisKey, 5_000);
      await assert.rejects(stores[0].consume(wrongType.id, new Date()), {
        code: "dependency_unavailable"
      });

      const stateHmacKey = randomBytes(32);
      const managers = stores.map((store) => new OAuthTransactionManager({ store, stateHmacKey }));
      const begun = await managers[0].begin({
        channel: "web_bff",
        clientId: "clinic-os-web-bff",
        authorizationEndpoint:
          "https://identity.example/realms/clinic-os/protocol/openid-connect/auth",
        redirectUri: "https://clinic.example/auth/callback",
        productionLike: true,
        now: new Date()
      });
      // The manager owns this HMAC mapping; derive only this test's generated state for exact cleanup.
      ownedKeys.push(
        keyspace.key(
          "transaction",
          createHmac("sha256", stateHmacKey).update(`oauth-state\u0000${begun.state}`).digest("hex")
        )
      );
      const results = await Promise.allSettled(
        managers.map((manager) =>
          manager.complete({
            callbackUrl: `https://clinic.example/auth/callback?code=${"c".repeat(43)}&state=${begun.state}`,
            cookieState: begun.state,
            expectedChannel: "web_bff",
            now: new Date()
          })
        )
      );
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(results.filter((r) => r.status === "rejected").length, 3);
    } finally {
      // Never flush, scan or reset a Redis database. Every deleted key was allocated above by this test.
      if (inspector.isReady && ownedKeys.length) await inspector.del(ownedKeys);
      await Promise.all(stores.map((s) => s.close()));
      if (inspector.isOpen) await inspector.quit();
    }
  }
);
