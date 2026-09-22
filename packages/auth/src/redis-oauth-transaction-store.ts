import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  assertPkceVerifier,
  safeRelativeReturnPath,
  type OAuthTransactionRecord,
  type OAuthTransactionStore
} from "./oauth-pkce.ts";
import {
  OpaqueRedisKeyspace,
  RedisRuntimeDependency,
  type RedisRuntimeClientOptions
} from "./redis-runtime.ts";
import type { SessionEncryptionKey } from "./web-session.ts";

const MAXIMUM_TTL_MS = 600_000;
const MAXIMUM_ENVELOPE_BYTES = 12_288;
const RECORD_FIELDS = [
  "channel",
  "clientId",
  "redirectUri",
  "codeVerifier",
  "nonce",
  "returnTo",
  "createdAt",
  "expiresAt"
];

export interface RedisOAuthTransactionStoreOptions extends RedisRuntimeClientOptions {
  keyHmacSecret: Uint8Array;
  /** First key encrypts new transactions; retained keys decrypt in-flight logins during rotation. */
  encryptionKeys: readonly [SessionEncryptionKey, ...SessionEncryptionKey[]];
  keyPrefix?: string;
  commandTimeoutMs?: number;
  now: () => Date;
}

export class RedisOAuthTransactionStoreError extends Error {
  readonly code: "dependency_unavailable" | "corrupt_response" | "invalid_input";

  constructor(code: RedisOAuthTransactionStoreError["code"]) {
    super(
      code === "invalid_input"
        ? "OAuth transaction storage input is invalid."
        : code === "corrupt_response"
          ? "OAuth transaction storage returned invalid evidence."
          : "OAuth transaction storage could not confirm the operation."
    );
    this.name = "RedisOAuthTransactionStoreError";
    this.code = code;
  }
}

/**
 * Distributed PKCE state, never a process-local fallback. Redis 6.2+ SET NX PXAT creates with
 * absolute expiry in one command; GETDEL consumes once across all application processes.
 * Tokens are not stored here. Verifiers, nonces and return paths are encrypted with AES-256-GCM,
 * bound to the opaque Redis key. A lost reply is uncertainty, never permission to retry a login.
 */
export class RedisOAuthTransactionStore implements OAuthTransactionStore {
  readonly atomicity = "create_if_absent_and_consume_once" as const;
  readonly #redis: RedisRuntimeDependency;
  readonly #keys: OpaqueRedisKeyspace;
  readonly #encryptionKeys: ReadonlyMap<string, Buffer>;
  readonly #activeKeyId: string;
  readonly #now: () => Date;
  readonly #commandTimeoutMs: number;

  constructor(options: RedisOAuthTransactionStoreOptions) {
    if (typeof options.now !== "function") throw invalidInput();
    const timeout = options.commandTimeoutMs ?? 3_000;
    if (!Number.isSafeInteger(timeout) || timeout < 100 || timeout > 10_000) throw invalidInput();
    if (
      !Array.isArray(options.encryptionKeys) ||
      options.encryptionKeys.length < 1 ||
      options.encryptionKeys.length > 5
    )
      throw invalidInput();
    const encryptionKeys = new Map<string, Buffer>();
    for (const entry of options.encryptionKeys) {
      if (
        !entry ||
        typeof entry.id !== "string" ||
        !/^[A-Za-z0-9._-]{1,64}$/.test(entry.id) ||
        !(entry.key instanceof Uint8Array) ||
        entry.key.byteLength !== 32 ||
        encryptionKeys.has(entry.id)
      )
        throw invalidInput();
      encryptionKeys.set(entry.id, Buffer.from(entry.key));
    }
    try {
      this.#keys = new OpaqueRedisKeyspace({
        prefix: options.keyPrefix ?? "clinicos:oauth:v1",
        hmacKey: options.keyHmacSecret
      });
      this.#redis = new RedisRuntimeDependency(options);
    } catch {
      throw invalidInput();
    }
    this.#encryptionKeys = encryptionKeys;
    this.#activeKeyId = options.encryptionKeys[0].id;
    this.#now = options.now;
    this.#commandTimeoutMs = timeout;
  }

  async readiness(): Promise<void> {
    // A unique, one-second probe checks primary writability and both required command grants.
    const key = this.#keys.key("probe", randomBytes(16).toString("hex"));
    const created = await this.#command(["SET", key, "ready", "NX", "PX", "1000"]);
    if (created !== "OK" || (await this.#command(["GETDEL", key])) !== "ready") {
      throw unavailable();
    }
  }

  async create(
    transactionKey: string,
    transaction: OAuthTransactionRecord,
    expiresAt: Date
  ): Promise<boolean> {
    const key = this.#transactionKey(transactionKey);
    const nowMs = instant(this.#now());
    let record: OAuthTransactionRecord;
    try {
      record = validatedRecord(transaction);
      if (
        instant(expiresAt) !== Date.parse(record.expiresAt) ||
        Date.parse(record.createdAt) > nowMs ||
        instant(expiresAt) <= nowMs ||
        instant(expiresAt) - nowMs > MAXIMUM_TTL_MS
      )
        throw invalidInput();
    } catch {
      throw invalidInput();
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#encryptionKeys.get(this.#activeKeyId)!, iv);
    cipher.setAAD(associatedData(key, this.#activeKeyId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(record), "utf8"),
      cipher.final()
    ]);
    const envelope = JSON.stringify({
      version: 1,
      keyId: this.#activeKeyId,
      iv: iv.toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url")
    });
    if (Buffer.byteLength(envelope) > MAXIMUM_ENVELOPE_BYTES) throw invalidInput();
    const reply = await this.#command([
      "SET",
      key,
      envelope,
      "NX",
      "PXAT",
      String(instant(expiresAt))
    ]);
    if (reply === "OK") return true;
    if (reply === null) return false;
    throw corruptResponse();
  }

  async consume(transactionKey: string, now: Date): Promise<OAuthTransactionRecord | null> {
    const key = this.#transactionKey(transactionKey);
    const nowMs = instant(now);
    const reply = await this.#command(["GETDEL", key]);
    if (reply === null) return null;
    try {
      if (typeof reply !== "string" || Buffer.byteLength(reply) > MAXIMUM_ENVELOPE_BYTES) {
        throw corruptResponse();
      }
      const envelope: unknown = JSON.parse(reply);
      if (
        !isRecord(envelope) ||
        !exactFields(envelope, ["version", "keyId", "iv", "ciphertext", "tag"]) ||
        envelope.version !== 1 ||
        typeof envelope.keyId !== "string"
      )
        throw corruptResponse();
      const encryptionKey = this.#encryptionKeys.get(envelope.keyId);
      if (!encryptionKey) throw corruptResponse();
      const decipher = createDecipheriv("aes-256-gcm", encryptionKey, decode(envelope.iv, 12, 12));
      decipher.setAAD(associatedData(key, envelope.keyId));
      decipher.setAuthTag(decode(envelope.tag, 16, 16));
      const clear = Buffer.concat([
        decipher.update(decode(envelope.ciphertext, 1, 8192)),
        decipher.final()
      ]);
      const record = validatedRecord(JSON.parse(clear.toString("utf8")));
      if (Date.parse(record.createdAt) > nowMs) throw corruptResponse();
      if (Date.parse(record.expiresAt) <= nowMs) return null;
      return record;
    } catch {
      // The value is already consumed. Never restore malformed, expired or unconfirmed evidence.
      throw corruptResponse();
    }
  }

  async close(): Promise<void> {
    await this.#bounded(() => this.#redis.close());
  }

  #transactionKey(transactionKey: string): string {
    if (typeof transactionKey !== "string" || !/^[a-f0-9]{64}$/.test(transactionKey))
      throw invalidInput();
    return this.#keys.key("transaction", transactionKey);
  }

  async #command(args: readonly string[]): Promise<unknown> {
    return this.#bounded(async () => {
      await this.#redis.ensureNonClusterPrimaryTopology();
      return this.#redis.client.sendCommand(args);
    });
  }

  async #bounded<T>(operation: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(unavailable()), this.#commandTimeoutMs);
        })
      ]);
    } catch {
      // Never reflect Redis errors, URLs, credentials or ciphertext; never retry uncertain writes.
      throw unavailable();
    } finally {
      clearTimeout(timer);
    }
  }
}

function validatedRecord(value: unknown): OAuthTransactionRecord {
  if (
    !isRecord(value) ||
    !exactFields(value, RECORD_FIELDS) ||
    RECORD_FIELDS.some((field) => typeof value[field] !== "string")
  )
    throw invalidInput();
  const record = value as unknown as OAuthTransactionRecord;
  if (
    !["web_bff", "mobile"].includes(record.channel) ||
    !/^[A-Za-z0-9._:-]{3,128}$/.test(record.clientId) ||
    !/^[A-Za-z0-9._~-]{32,256}$/.test(record.nonce) ||
    record.redirectUri.length > 2048 ||
    record.returnTo.length > 2048
  )
    throw invalidInput();
  assertPkceVerifier(record.codeVerifier);
  if (safeRelativeReturnPath(record.returnTo) !== record.returnTo) throw invalidInput();
  const redirect = new URL(record.redirectUri);
  const protocols = record.channel === "web_bff" ? ["https:", "http:"] : ["https:", "clinic-os:"];
  if (
    !protocols.includes(redirect.protocol) ||
    redirect.username ||
    redirect.password ||
    redirect.search ||
    redirect.hash
  )
    throw invalidInput();
  const created = canonicalInstant(record.createdAt);
  const expires = canonicalInstant(record.expiresAt);
  if (expires <= created || expires - created > MAXIMUM_TTL_MS) throw invalidInput();
  return Object.freeze({ ...record });
}

function canonicalInstant(value: string): number {
  const date = new Date(value);
  const ms = instant(date);
  if (date.toISOString() !== value) throw invalidInput();
  return ms;
}

function instant(value: Date): number {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()) || value.getTime() < 0)
    throw invalidInput();
  return value.getTime();
}

function associatedData(redisKey: string, keyId: string): Buffer {
  return Buffer.from(`clinicos:oauth:v1\u0000${redisKey}\u0000${keyId}`, "utf8");
}

function decode(value: unknown, minimum: number, maximum: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw corruptResponse();
  const bytes = Buffer.from(value, "base64url");
  if (
    bytes.byteLength < minimum ||
    bytes.byteLength > maximum ||
    bytes.toString("base64url") !== value
  ) {
    throw corruptResponse();
  }
  return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return (
    Object.keys(value).length === fields.length &&
    fields.every((field) => Object.hasOwn(value, field))
  );
}

function invalidInput(): RedisOAuthTransactionStoreError {
  return new RedisOAuthTransactionStoreError("invalid_input");
}
function corruptResponse(): RedisOAuthTransactionStoreError {
  return new RedisOAuthTransactionStoreError("corrupt_response");
}
function unavailable(): RedisOAuthTransactionStoreError {
  return new RedisOAuthTransactionStoreError("dependency_unavailable");
}
