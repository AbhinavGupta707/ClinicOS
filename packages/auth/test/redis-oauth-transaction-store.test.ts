import assert from "node:assert/strict";
import { createCipheriv, randomBytes } from "node:crypto";
import { test } from "node:test";
import {
  OAuthTransactionManager,
  RedisOAuthTransactionStore,
  RedisOAuthTransactionStoreError,
  type OAuthTransactionRecord,
  type RedisOAuthTransactionStoreOptions,
  type RedisScriptClient
} from "../src/index.ts";

const NOW = new Date("2026-09-22T12:00:00.000Z");
const KEY = "a".repeat(64);
const OTHER_KEY = "b".repeat(64);
const KEY_MATERIAL = Buffer.alloc(32, 7);
const ENCRYPTION_KEY = { id: "test-key-1", key: KEY_MATERIAL };

test("OAuth Redis adapter encrypts verifier evidence and does not overwrite an existing login", async () => {
  const redis = new StringRedisDouble();
  const first = store(redis);
  const second = store(redis);
  const record = transaction();
  const created = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      (i % 2 ? first : second).create(KEY, record, new Date(record.expiresAt))
    )
  );
  assert.equal(created.filter(Boolean).length, 1);
  const [redisKey, value] = [...redis.values][0];
  assert.ok(!redisKey.includes(KEY));
  assert.ok(!value.includes(record.codeVerifier));
  assert.ok(!value.includes(record.nonce));
  assert.ok(!value.includes(record.returnTo));
  assert.equal(redis.expiry.get(redisKey), Date.parse(record.expiresAt));
  const consumed = await Promise.all(
    Array.from({ length: 20 }, (_, i) => (i % 2 ? first : second).consume(KEY, NOW))
  );
  assert.equal(consumed.filter(Boolean).length, 1);
  assert.deepEqual(consumed.find(Boolean), record);
  assert.equal(await first.consume(KEY, NOW), null);
});

test("separate managers complete one shared login exactly once using the existing PKCE contract", async () => {
  const redis = new StringRedisDouble();
  const managers = [store(redis), store(redis)].map(
    (storage) =>
      new OAuthTransactionManager({
        store: storage,
        stateHmacKey: Buffer.alloc(32, 5)
      })
  );
  const begun = await managers[0].begin({
    channel: "web_bff",
    clientId: "clinic-os-web-bff",
    authorizationEndpoint: "https://identity.example/realms/clinic-os/protocol/openid-connect/auth",
    redirectUri: "https://clinic.example/auth/callback",
    returnTo: "/surface/patients",
    productionLike: true,
    now: NOW
  });
  const input = {
    callbackUrl: `https://clinic.example/auth/callback?code=${"c".repeat(43)}&state=${begun.state}`,
    cookieState: begun.state,
    expectedChannel: "web_bff" as const,
    now: NOW
  };
  const results = await Promise.allSettled([
    managers[0].complete(input),
    managers[1].complete(input)
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.filter((r) => r.status === "rejected").length, 1);
  assert.equal(redis.values.size, 0);
});

test("OAuth Redis readiness exercises a writable primary and consume permission", async () => {
  const redis = new StringRedisDouble();
  await store(redis).readiness();
  assert.equal(redis.values.size, 0);
  assert.equal(redis.commands.filter((c) => c[0] === "GETDEL").length, 1);
  for (const failure of ["cluster", "read_only", "getdel_denied"] as const) {
    const dependency = new StringRedisDouble();
    dependency.failure = failure;
    await assert.rejects(store(dependency).readiness(), { code: "dependency_unavailable" });
  }
});

test("logical expiry is rejected and destroyed even before Redis removes the key", async () => {
  const redis = new StringRedisDouble();
  const adapter = store(redis);
  const record = transaction();
  await adapter.create(KEY, record, new Date(record.expiresAt));
  assert.equal(await adapter.consume(KEY, new Date(record.expiresAt)), null);
  assert.equal(redis.values.size, 0);
});

test("OAuth storage preserves in-flight logins during encryption-key rotation", async () => {
  const redis = new StringRedisDouble();
  const original = store(redis);
  const record = transaction();
  await original.create(KEY, record, new Date(record.expiresAt));
  const rotated = store(redis, {
    encryptionKeys: [{ id: "test-key-2", key: Buffer.alloc(32, 8) }, ENCRYPTION_KEY]
  });
  assert.deepEqual(await rotated.consume(KEY, NOW), record);
  await rotated.create(OTHER_KEY, record, new Date(record.expiresAt));
  assert.equal(JSON.parse([...redis.values.values()][0]).keyId, "test-key-2");
  await assert.rejects(original.consume(OTHER_KEY, NOW), { code: "corrupt_response" });
  assert.equal(redis.values.size, 0);
});

test("ciphertext cannot move between login state keys or be modified", async () => {
  for (const mode of ["swap", "tamper"]) {
    const redis = new StringRedisDouble();
    const adapter = store(redis);
    const record = transaction();
    await adapter.create(KEY, record, new Date(record.expiresAt));
    await adapter.create(OTHER_KEY, record, new Date(record.expiresAt));
    const [first, second] = [...redis.values.keys()];
    if (mode === "swap") redis.values.set(second, redis.values.get(first)!);
    else {
      const value = JSON.parse(redis.values.get(second)!);
      value.tag = Buffer.alloc(16, 1).toString("base64url");
      redis.values.set(second, JSON.stringify(value));
    }
    await assert.rejects(adapter.consume(OTHER_KEY, NOW), { code: "corrupt_response" });
    assert.equal(await adapter.consume(OTHER_KEY, NOW), null);
    assert.deepEqual(await adapter.consume(KEY, NOW), record);
  }
});

test("corrupt Redis envelopes fail closed without returning stored data", async () => {
  for (const value of ["not-json", "{}", "null", "[]", "sensitive".repeat(2000)]) {
    const redis = new StringRedisDouble();
    const adapter = store(redis);
    const record = transaction();
    await adapter.create(KEY, record, new Date(record.expiresAt));
    redis.values.set([...redis.values.keys()][0], value);
    await assert.rejects(adapter.consume(KEY, NOW), (error: unknown) => {
      assert.ok(error instanceof RedisOAuthTransactionStoreError);
      assert.equal(error.code, "corrupt_response");
      assert.ok(!error.message.includes("sensitive"));
      return true;
    });
    assert.equal(redis.values.size, 0);
  }
});

test("authenticated but malformed records are consumed and rejected", async () => {
  for (const overrides of [
    { channel: "unrecognized" },
    { nonce: "short" },
    { codeVerifier: "short" },
    { redirectUri: "https://clinic.example/auth/callback?next=elsewhere" },
    { returnTo: "https://attacker.example" },
    { unexpected: "secret" },
    { createdAt: "2026-09-22T12:00:01.000Z" },
    { expiresAt: "2026-09-22T12:11:00.000Z" }
  ]) {
    const redis = new StringRedisDouble();
    const adapter = store(redis);
    const record = transaction();
    await adapter.create(KEY, record, new Date(record.expiresAt));
    const redisKey = [...redis.values.keys()][0];
    redis.values.set(redisKey, encryptRecord(redisKey, { ...record, ...overrides }));
    await assert.rejects(adapter.consume(KEY, NOW), { code: "corrupt_response" });
    assert.equal(redis.values.size, 0);
  }
});

test("invalid transaction inputs never reach Redis", async () => {
  const redis = new StringRedisDouble();
  const adapter = store(redis);
  for (const overrides of [
    { expiresAt: "2026-09-22T12:11:00.000Z" },
    { createdAt: "2026-09-22T12:00:01.000Z" },
    { expiresAt: "2026-09-22T12:00:00.000Z" },
    { nonce: "short" },
    { codeVerifier: "invalid!" },
    { clientId: "a" },
    { returnTo: "//attacker.example" },
    { extra: "not-allowed" }
  ]) {
    const record = { ...transaction(), ...overrides };
    await assert.rejects(adapter.create(KEY, record, new Date(record.expiresAt)), {
      code: "invalid_input"
    });
  }
  await assert.rejects(
    adapter.create("raw-oauth-state", transaction(), new Date(transaction().expiresAt)),
    { code: "invalid_input" }
  );
  await assert.rejects(adapter.consume(KEY, new Date("invalid")), { code: "invalid_input" });
  await assert.rejects(adapter.create(KEY, transaction(), new Date(NOW)), {
    code: "invalid_input"
  });
  assert.equal(redis.commands.length, 0);
});

test("keys are copied, bounded and distinct by ID", async () => {
  const redis = new StringRedisDouble();
  const key = Buffer.alloc(32, 7);
  const adapter = store(redis, { encryptionKeys: [{ id: "test-key-1", key }] });
  key.fill(0);
  await adapter.create(KEY, transaction(), new Date(transaction().expiresAt));
  assert.deepEqual(await store(redis).consume(KEY, NOW), transaction());
  for (const invalid of [
    { encryptionKeys: [] },
    { encryptionKeys: [ENCRYPTION_KEY, ENCRYPTION_KEY] },
    { encryptionKeys: [{ id: "bad id", key: KEY_MATERIAL }] },
    { encryptionKeys: [{ id: "short", key: Buffer.alloc(16) }] },
    { keyHmacSecret: Buffer.alloc(4) },
    { commandTimeoutMs: 0 },
    { commandTimeoutMs: 10_001 }
  ])
    assert.throws(() => store(redis, invalid as Partial<RedisOAuthTransactionStoreOptions>), {
      code: "invalid_input"
    });
});

test("lost create and consume replies never produce a retry or fabricated success", async () => {
  const redis = new StringRedisDouble();
  const adapter = store(redis);
  redis.failure = "lost_reply";
  await assert.rejects(adapter.create(KEY, transaction(), new Date(transaction().expiresAt)), {
    code: "dependency_unavailable"
  });
  assert.equal(redis.commands.filter((c) => c[0] === "SET").length, 1);
  assert.equal(redis.values.size, 1);
  await assert.rejects(adapter.consume(KEY, NOW), { code: "dependency_unavailable" });
  assert.equal(redis.commands.filter((c) => c[0] === "GETDEL").length, 1);
  assert.equal(redis.values.size, 0);
  redis.failure = null;
  assert.equal(await adapter.consume(KEY, NOW), null);
});

test(
  "unexpected protocol replies and stalled commands fail closed with bounded errors",
  { timeout: 2000 },
  async () => {
    const redis = new StringRedisDouble();
    const adapter = store(redis, { commandTimeoutMs: 100 });
    redis.failure = "unexpected_reply";
    await assert.rejects(adapter.create(KEY, transaction(), new Date(transaction().expiresAt)), {
      code: "corrupt_response"
    });
    redis.failure = "stall";
    await assert.rejects(adapter.consume(KEY, NOW), { code: "dependency_unavailable" });
    assert.equal(redis.commands.filter((c) => c[0] === "GETDEL").length, 1);
  }
);

function store(
  client: RedisScriptClient,
  overrides: Partial<RedisOAuthTransactionStoreOptions> = {}
) {
  return new RedisOAuthTransactionStore({
    client,
    keyHmacSecret: Buffer.alloc(32, 2),
    encryptionKeys: [ENCRYPTION_KEY],
    now: () => new Date(NOW),
    ...overrides
  });
}

function transaction(): OAuthTransactionRecord {
  return {
    channel: "web_bff",
    clientId: "clinic-os-web-bff",
    redirectUri: "https://clinic.example/auth/callback",
    codeVerifier: "v".repeat(86),
    nonce: "n".repeat(43),
    returnTo: "/surface/patients",
    createdAt: NOW.toISOString(),
    expiresAt: "2026-09-22T12:05:00.000Z"
  };
}

function encryptRecord(redisKey: string, record: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY_MATERIAL, iv);
  cipher.setAAD(Buffer.from(`clinicos:oauth:v1\u0000${redisKey}\u0000test-key-1`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record)), cipher.final()]);
  return JSON.stringify({
    version: 1,
    keyId: "test-key-1",
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url")
  });
}

/** Wire double for deterministic fault/crypto cases; real command semantics have a separate Redis test. */
class StringRedisDouble implements RedisScriptClient {
  isOpen = true;
  isReady = true;
  values = new Map<string, string>();
  expiry = new Map<string, number>();
  commands: Array<readonly string[]> = [];
  failure:
    "cluster" | "read_only" | "getdel_denied" | "lost_reply" | "stall" | "unexpected_reply" | null =
    null;
  async connect() {
    this.isOpen = true;
    this.isReady = true;
  }
  async quit() {
    this.isOpen = false;
    this.isReady = false;
  }
  on() {
    return this;
  }
  async ping() {
    return "PONG";
  }
  async eval(): Promise<unknown> {
    throw new Error("No Lua is used by the OAuth adapter.");
  }
  async sendCommand(args: readonly string[]): Promise<unknown> {
    this.commands.push(args);
    const [command, key, value] = args;
    if (command === "INFO") return `cluster_enabled:${this.failure === "cluster" ? "1" : "0"}\r\n`;
    if (this.failure === "stall") return new Promise(() => {});
    if (
      this.failure === "read_only" ||
      (this.failure === "getdel_denied" && command === "GETDEL")
    ) {
      throw new Error("sensitive-redis-error-with-credentials");
    }
    let result: unknown;
    if (command === "SET") {
      if (this.values.has(key)) result = null;
      else {
        this.values.set(key, value);
        this.expiry.set(key, Number(args[5]));
        result = "OK";
      }
    } else if (command === "GETDEL") {
      result = this.values.get(key) ?? null;
      this.values.delete(key);
    } else throw new Error("Unsupported double command");
    if (this.failure === "lost_reply") throw new Error("sensitive-lost-reply");
    return this.failure === "unexpected_reply" ? "unexpected" : result;
  }
}
