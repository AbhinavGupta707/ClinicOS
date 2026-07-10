import {
  OpaqueRedisKeyspace,
  RedisRuntimeDependency,
  type RedisRuntimeClientOptions
} from "@clinic-os/auth";
import type { TokenRevocationQuery, TokenRevocationStore } from "./contracts.ts";

const IDENTIFIER_PATTERN = /^[A-Za-z0-9._:@/-]{8,255}$/;
const DEFAULT_MAXIMUM_RETENTION_MS = 43_200_000;

const READINESS_SCRIPT = `-- clinicos:cp14:token-revocation:readiness
local state_kind = redis.call('TYPE', KEYS[2])
if type(state_kind) == 'table' then state_kind = state_kind['ok'] end
if state_kind ~= 'none' and state_kind ~= 'hash' then return 'invalid' end
local write = redis.call('SET', KEYS[1], ARGV[1], 'PX', 5000)
if type(write) == 'table' then write = write['ok'] end
if write ~= 'OK' then return 'invalid' end
return 'ready'
`;

const RECORD_REVOCATION_SCRIPT = `-- clinicos:cp14:token-revocation:record
local kind = redis.call('TYPE', KEYS[1])
if type(kind) == 'table' then kind = kind['ok'] end
if kind ~= 'none' and kind ~= 'hash' then return 'invalid' end
local command = {'HSET', KEYS[1]}
local new_marker = cjson.decode(ARGV[5])
if type(new_marker) ~= 'table' or new_marker.kind ~= 'exact-revocation' or
   type(new_marker.expiresAtMs) ~= 'number' then return 'invalid' end
for index = 1, 2 do
  if ARGV[index] ~= '' then
    local marker_expiry = new_marker.expiresAtMs
    local existing = redis.call('HGET', KEYS[1], ARGV[index])
    if existing then
      local decoded = cjson.decode(existing)
      if type(decoded) ~= 'table' or decoded.kind ~= 'exact-revocation' or
         type(decoded.expiresAtMs) ~= 'number' then return 'invalid' end
      marker_expiry = math.max(marker_expiry, decoded.expiresAtMs)
    end
    table.insert(command, ARGV[index])
    table.insert(command, cjson.encode({
      schemaVersion = 1, kind = 'exact-revocation',
      reason = new_marker.reason, revokedAt = new_marker.revokedAt,
      expiresAtMs = marker_expiry
    }))
  end
end
if ARGV[3] ~= '' then
  local cutoff = tonumber(ARGV[6])
  local expires_at = tonumber(ARGV[4])
  local existing = redis.call('HGET', KEYS[1], ARGV[3])
  if existing then
    local decoded = cjson.decode(existing)
    if type(decoded) ~= 'table' or decoded.kind ~= 'subject-cutoff' or
       type(decoded.cutoffMs) ~= 'number' or type(decoded.expiresAtMs) ~= 'number' then
      return 'invalid'
    end
    cutoff = math.max(cutoff, decoded.cutoffMs)
    expires_at = math.max(expires_at, decoded.expiresAtMs)
  end
  table.insert(command, ARGV[3])
  table.insert(command, cjson.encode({
    schemaVersion = 1, kind = 'subject-cutoff',
    cutoffMs = cutoff, expiresAtMs = expires_at
  }))
end
if #command == 2 then return 'invalid' end
redis.call(unpack(command))
return 'recorded'
`;

const CHECK_REVOCATION_SCRIPT = `-- clinicos:cp14:token-revocation:check
local kind = redis.call('TYPE', KEYS[1])
if type(kind) == 'table' then kind = kind['ok'] end
if kind == 'none' then return 'active' end
if kind ~= 'hash' then return 'invalid' end
local now_ms = tonumber(ARGV[2])
for index = 1, 2 do
  local marker = redis.call('HGET', KEYS[1], ARGV[index + 2])
  if marker then
    local decoded = cjson.decode(marker)
    if type(decoded) ~= 'table' or decoded.kind ~= 'exact-revocation' or
       type(decoded.expiresAtMs) ~= 'number' then return 'invalid' end
    if decoded.expiresAtMs > now_ms then return 'revoked' end
  end
end
local cutoff = redis.call('HGET', KEYS[1], ARGV[5])
if cutoff then
  local decoded = cjson.decode(cutoff)
  if type(decoded) ~= 'table' or decoded.kind ~= 'subject-cutoff' or
     type(decoded.cutoffMs) ~= 'number' or type(decoded.expiresAtMs) ~= 'number' then
    return 'invalid'
  end
  if decoded.expiresAtMs > now_ms and tonumber(ARGV[1]) <= decoded.cutoffMs then return 'revoked' end
end
return 'active'
`;

export const CP14_REDIS_TOKEN_REVOCATION_MUTATION_SCRIPT = RECORD_REVOCATION_SCRIPT;

export interface RedisTokenRevocationStoreOptions extends RedisRuntimeClientOptions {
  keyHmacSecret: Uint8Array;
  keyPrefix?: string;
  maximumRetentionMs?: number;
  now: () => Date;
}

export interface RecordTokenRevocationInput {
  subject: string;
  tokenId?: string | null;
  keycloakSessionId?: string | null;
  /** Revokes every token for the subject issued at or before this trusted instant. */
  subjectTokensIssuedThrough?: Date | null;
  reason:
    | "logout"
    | "refresh_replay"
    | "administrator_action"
    | "authority_revision"
    | "jml_transition"
    | "break_glass_expired";
  revokedAt: Date;
  expiresAt: Date;
}

export class RedisTokenRevocationStoreError extends Error {
  readonly code: "dependency_unavailable" | "invalid_input" | "corrupt_response";

  constructor(code: RedisTokenRevocationStoreError["code"], message: string) {
    super(message);
    this.name = "RedisTokenRevocationStoreError";
    this.code = code;
  }
}

/** Distributed, fail-closed revocation state for the production API identity edge. */
export class RedisTokenRevocationStore implements TokenRevocationStore {
  readonly durability = "distributed_durable" as const;
  readonly revocationHashKey: string;
  readonly #redis: RedisRuntimeDependency;
  readonly #keys: OpaqueRedisKeyspace;
  readonly #maximumRetentionMs: number;
  readonly #now: () => Date;

  constructor(options: RedisTokenRevocationStoreOptions) {
    if (typeof options.now !== "function") throw invalidInput();
    this.#redis = new RedisRuntimeDependency(options);
    this.#keys = new OpaqueRedisKeyspace({
      prefix: options.keyPrefix ?? "clinicos:token-revocation:v1",
      hmacKey: options.keyHmacSecret
    });
    this.revocationHashKey = this.#keys.singleton("revocation-state");
    this.#maximumRetentionMs = options.maximumRetentionMs ?? DEFAULT_MAXIMUM_RETENTION_MS;
    if (
      !Number.isSafeInteger(this.#maximumRetentionMs) ||
      this.#maximumRetentionMs < 600_000 ||
      this.#maximumRetentionMs > 86_400_000
    ) {
      throw invalidInput();
    }
    this.#now = options.now;
  }

  async readiness(): Promise<void> {
    try {
      await this.#redis.ping();
      const nonce = String(trustedInstant(this.#now()).getTime());
      const result = await this.#redis.evaluate(
        READINESS_SCRIPT,
        [this.#keys.singleton("readiness"), this.revocationHashKey],
        [nonce]
      );
      if (result !== "ready") throw new Error("invalid readiness result");
    } catch {
      throw new RedisTokenRevocationStoreError(
        "dependency_unavailable",
        "The distributed token-revocation dependency is unavailable."
      );
    }
  }

  async close(): Promise<void> {
    await this.#redis.close();
  }

  async recordRevocation(input: RecordTokenRevocationInput): Promise<void> {
    assertIdentifier(input.subject);
    if (input.tokenId) assertIdentifier(input.tokenId);
    if (input.keycloakSessionId) assertIdentifier(input.keycloakSessionId);
    if (!input.tokenId && !input.keycloakSessionId && !input.subjectTokensIssuedThrough) {
      throw invalidInput();
    }
    if (
      ![
        "logout",
        "refresh_replay",
        "administrator_action",
        "authority_revision",
        "jml_transition",
        "break_glass_expired"
      ].includes(input.reason)
    ) {
      throw invalidInput();
    }
    const revokedAt = trustedInstant(input.revokedAt);
    const expiresAt = trustedInstant(input.expiresAt);
    const retention = expiresAt.getTime() - revokedAt.getTime();
    if (retention <= 0 || retention > this.#maximumRetentionMs) throw invalidInput();
    const subjectCutoff = input.subjectTokensIssuedThrough
      ? trustedInstant(input.subjectTokensIssuedThrough)
      : null;
    if (subjectCutoff && subjectCutoff.getTime() > revokedAt.getTime() + 60_000) {
      throw invalidInput();
    }
    const marker = JSON.stringify({
      schemaVersion: 1,
      kind: "exact-revocation",
      reason: input.reason,
      revokedAt: revokedAt.toISOString(),
      expiresAtMs: expiresAt.getTime()
    });
    const tokenField = input.tokenId ? this.#keys.key("token-field", input.tokenId) : "";
    const sessionField = input.keycloakSessionId
      ? this.#keys.key("session-field", input.keycloakSessionId)
      : "";
    const subjectField = subjectCutoff ? this.#keys.key("subject-field", input.subject) : "";
    try {
      const result = await this.#redis.evaluate(
        RECORD_REVOCATION_SCRIPT,
        [this.revocationHashKey],
        [
          tokenField,
          sessionField,
          subjectField,
          String(expiresAt.getTime()),
          marker,
          String(subjectCutoff?.getTime() ?? 0)
        ]
      );
      if (result !== "recorded") throw new Error("invalid record result");
    } catch {
      throw new RedisTokenRevocationStoreError(
        "dependency_unavailable",
        "The distributed token-revocation dependency could not confirm the write."
      );
    }
  }

  async isRevoked(query: TokenRevocationQuery): Promise<boolean> {
    assertIdentifier(query.subject);
    assertIdentifier(query.tokenId);
    assertIdentifier(query.keycloakSessionId);
    const issuedAt = trustedInstant(new Date(query.issuedAt));
    const now = trustedInstant(query.now);
    if (issuedAt.getTime() > now.getTime() + 60_000) throw invalidInput();
    try {
      const result = await this.#redis.evaluate(
        CHECK_REVOCATION_SCRIPT,
        [this.revocationHashKey],
        [
          String(issuedAt.getTime()),
          String(now.getTime()),
          this.#keys.key("token-field", query.tokenId),
          this.#keys.key("session-field", query.keycloakSessionId),
          this.#keys.key("subject-field", query.subject)
        ]
      );
      if (result === "revoked") return true;
      if (result === "active") return false;
      throw new Error("invalid check result");
    } catch {
      throw new RedisTokenRevocationStoreError(
        "dependency_unavailable",
        "The distributed token-revocation dependency could not confirm token state."
      );
    }
  }

  /** Physically removes logically expired revocation fields in a bounded single-write batch. */
  async purgeExpiredRevocationsBatch(input: {
    cursor?: string;
    count?: number;
    now: Date;
  }): Promise<{ nextCursor: string; deleted: number }> {
    const cursor = input.cursor ?? "0";
    const count = input.count ?? 100;
    const now = trustedInstant(input.now);
    if (!/^\d{1,20}$/.test(cursor) || !Number.isSafeInteger(count) || count < 1 || count > 500) {
      throw invalidInput();
    }
    try {
      const result = await this.#redis.evaluate(
        `-- clinicos:cp14:token-revocation:purge-expired
local page = redis.call('HSCAN', KEYS[1], ARGV[1], 'COUNT', ARGV[2])
local expired = {}
for index = 1, #page[2], 2 do
  local value = cjson.decode(page[2][index + 1])
  if type(value) ~= 'table' or type(value.expiresAtMs) ~= 'number' then
    return {'invalid', '0'}
  end
  if value.expiresAtMs <= tonumber(ARGV[3]) then table.insert(expired, page[2][index]) end
end
if #expired > 0 then redis.call('HDEL', KEYS[1], unpack(expired)) end
return {page[1], tostring(#expired)}`,
        [this.revocationHashKey],
        [cursor, String(count), String(now.getTime())]
      );
      if (!Array.isArray(result) || result.length !== 2 || typeof result[0] !== "string") {
        throw new Error("invalid purge response");
      }
      const deleted = Number(result[1]);
      if (!Number.isSafeInteger(deleted) || deleted < 0 || deleted > count) {
        throw new Error("invalid purge count");
      }
      return { nextCursor: result[0], deleted };
    } catch {
      throw new RedisTokenRevocationStoreError(
        "dependency_unavailable",
        "The distributed token-revocation dependency could not confirm expiry cleanup."
      );
    }
  }
}

function assertIdentifier(value: string): void {
  if (!IDENTIFIER_PATTERN.test(value) || /(?:token|secret|password)=/i.test(value)) {
    throw invalidInput();
  }
}

function trustedInstant(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw invalidInput();
  return new Date(value.getTime());
}

function invalidInput(): RedisTokenRevocationStoreError {
  return new RedisTokenRevocationStoreError(
    "invalid_input",
    "Distributed token-revocation input is invalid."
  );
}
