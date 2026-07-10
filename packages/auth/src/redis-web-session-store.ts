import {
  validateRequiredSecurityAuditIntent,
  type RequiredSecurityAuditIntent
} from "./security-audit.ts";
import {
  OpaqueRedisKeyspace,
  RedisRuntimeDependency,
  type RedisRuntimeClientOptions
} from "./redis-runtime.ts";
import type {
  WebSessionEnvelope,
  WebSessionRefreshClaimResult,
  WebSessionRefreshWaitResult,
  WebSessionRevocationReason,
  WebSessionRevocationResult,
  WebSessionRotateResult,
  WebSessionStoredEntry,
  WebSessionStore
} from "./web-session.ts";

const STORE_KEY_PATTERN = /^[a-f0-9]{64}$/;
const LEASE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DEFAULT_MAXIMUM_TTL_MS = 43_200_000;

const LUA_ACTIVE_STATE = `
local function active_state(serialized, now_ms)
  if not serialized then return nil end
  local value = cjson.decode(serialized)
  if type(value) ~= 'table' or value.kind ~= 'session' or
     type(value.expiresAtMs) ~= 'number' or value.expiresAtMs <= now_ms then
    return nil
  end
  return value
end
`;

const LUA_AUDIT_FIELD_VALID = `
local function audit_field_valid(hash_key, field, serialized)
  local decoded = cjson.decode(serialized)
  if type(decoded) ~= 'table' or decoded.kind ~= 'required_security_audit' or
     type(decoded.deduplicationKey) ~= 'string' or type(decoded.intent) ~= 'table' then
    return false
  end
  local existing = redis.call('HGET', hash_key, field)
  return not existing or existing == serialized
end
`;

const CREATE_SCRIPT = `-- clinicos:cp14:web-session:create
${LUA_ACTIVE_STATE}
${LUA_AUDIT_FIELD_VALID}
local now_ms = tonumber(ARGV[6])
if active_state(redis.call('HGET', KEYS[1], ARGV[1]), now_ms) then return 'exists' end
local family = redis.call('HGET', KEYS[1], ARGV[2])
if family then
  local decoded_family = cjson.decode(family)
  if type(decoded_family) ~= 'table' or type(decoded_family.expiresAtMs) ~= 'number' then
    return 'invalid'
  end
  if decoded_family.expiresAtMs > now_ms then return 'family_revoked' end
end
local state = cjson.decode(ARGV[3])
if type(state) ~= 'table' or state.kind ~= 'session' or
   type(state.envelope) ~= 'table' or state.envelope.familyKey ~= ARGV[7] then
  return 'invalid'
end
if not audit_field_valid(KEYS[1], ARGV[4], ARGV[5]) then return 'invalid' end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[3], ARGV[4], ARGV[5])
return 'created'
`;

const TOUCH_SCRIPT = `-- clinicos:cp14:web-session:touch
${LUA_ACTIVE_STATE}
local now_ms = tonumber(ARGV[5])
local state = active_state(redis.call('HGET', KEYS[1], ARGV[1]), now_ms)
if not state then return 'missing' end
local observed = tonumber(ARGV[2])
if observed > state.lastSeenAtMs then
  state.lastSeenAtMs = observed
  state.lastSeenAt = ARGV[3]
end
state.expiresAtMs = tonumber(ARGV[4])
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(state))
return 'touched'
`;

const ROTATE_SCRIPT = `-- clinicos:cp14:web-session:rotate
${LUA_ACTIVE_STATE}
${LUA_AUDIT_FIELD_VALID}
local now_ms = tonumber(ARGV[9])
local current = active_state(redis.call('HGET', KEYS[1], ARGV[1]), now_ms)
if not current then return {'missing_or_revoked'} end
local family = redis.call('HGET', KEYS[1], ARGV[3])
if family then
  local decoded_family = cjson.decode(family)
  if type(decoded_family) ~= 'table' or type(decoded_family.expiresAtMs) ~= 'number' then
    return {'invalid'}
  end
  if decoded_family.expiresAtMs > now_ms then return {'missing_or_revoked'} end
end
local expected = tonumber(ARGV[7])
if type(current.envelope) ~= 'table' or current.envelope.familyKey ~= ARGV[10] then
  return {'invalid'}
end
if current.envelope.recordVersion ~= expected then return {'version_changed'} end
if current.refreshLease ~= nil and current.refreshLease ~= cjson.null then
  return {'refresh_in_progress', tostring(current.refreshLease.expiresAtMs)}
end
if active_state(redis.call('HGET', KEYS[1], ARGV[2]), now_ms) then return {'version_changed'} end
local next_state = cjson.decode(ARGV[4])
if type(next_state) ~= 'table' or next_state.kind ~= 'session' or
   type(next_state.envelope) ~= 'table' or next_state.envelope.familyKey ~= ARGV[10] or
   next_state.envelope.recordVersion ~= expected + 1 then return {'invalid'} end
if not audit_field_valid(KEYS[1], ARGV[5], ARGV[6]) then return {'invalid'} end
local tombstone = cjson.decode(ARGV[8])
if type(tombstone) ~= 'table' or tombstone.kind ~= 'unavailable' then return {'invalid'} end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[8], ARGV[2], ARGV[4], ARGV[5], ARGV[6])
return {'rotated'}
`;

const CLAIM_SCRIPT = `-- clinicos:cp14:web-session:claim-refresh
${LUA_ACTIVE_STATE}
local state = active_state(redis.call('HGET', KEYS[1], ARGV[1]), tonumber(ARGV[4]))
if not state then return {'missing_or_revoked'} end
local expected = tonumber(ARGV[2])
if state.envelope.recordVersion ~= expected then return {'version_changed'} end
local lease = state.refreshLease
if lease ~= nil and lease ~= cjson.null then
  if lease.expiresAtMs > tonumber(ARGV[4]) then
    return {'refresh_in_progress', tostring(lease.expiresAtMs)}
  end
  if lease.phase == 'dispatched' then return {'orphaned_dispatched_refresh'} end
end
state.refreshLease = {
  id = ARGV[3], recordVersion = expected, phase = 'claimed',
  expiresAtMs = tonumber(ARGV[5]), expiresAt = ARGV[6]
}
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(state))
return {'claimed'}
`;

const DISPATCH_SCRIPT = `-- clinicos:cp14:web-session:mark-refresh-dispatched
${LUA_ACTIVE_STATE}
local state = active_state(redis.call('HGET', KEYS[1], ARGV[1]), tonumber(ARGV[5]))
if not state then return 'rejected' end
local expected = tonumber(ARGV[2])
local lease = state.refreshLease
if state.envelope.recordVersion ~= expected or lease == nil or lease == cjson.null or
   lease.id ~= ARGV[3] or lease.recordVersion ~= expected or lease.phase ~= 'claimed' then
  return 'rejected'
end
lease.phase = 'dispatched'
lease.dispatchedAt = ARGV[4]
state.refreshLease = lease
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(state))
return 'dispatched'
`;

const COMPLETE_SCRIPT = `-- clinicos:cp14:web-session:complete-refresh
${LUA_ACTIVE_STATE}
local current = active_state(redis.call('HGET', KEYS[1], ARGV[1]), tonumber(ARGV[6]))
if not current then return 'rejected' end
local expected = tonumber(ARGV[2])
local lease = current.refreshLease
if current.envelope.recordVersion ~= expected or lease == nil or lease == cjson.null or
   lease.id ~= ARGV[3] or lease.recordVersion ~= expected or lease.phase ~= 'dispatched' then
  return 'rejected'
end
local next_state = cjson.decode(ARGV[4])
if type(next_state) ~= 'table' or next_state.kind ~= 'session' or
   next_state.envelope.familyKey ~= current.envelope.familyKey or
   next_state.envelope.recordVersion ~= expected + 1 then return 'invalid' end
if current.lastSeenAtMs > next_state.lastSeenAtMs then
  next_state.lastSeenAtMs = current.lastSeenAtMs
  next_state.lastSeenAt = current.lastSeenAt
end
next_state.expiresAtMs = tonumber(ARGV[5])
next_state.refreshLease = cjson.null
redis.call('HSET', KEYS[1], ARGV[1], cjson.encode(next_state))
return 'completed'
`;

const WAIT_SCRIPT = `-- clinicos:cp14:web-session:wait-refresh
${LUA_ACTIVE_STATE}
local state = active_state(redis.call('HGET', KEYS[1], ARGV[1]), tonumber(ARGV[3]))
if not state then return {'missing_or_revoked'} end
local observed = tonumber(ARGV[2])
if state.envelope.recordVersion > observed then
  return {'completed', cjson.encode({envelope = state.envelope, lastSeenAt = state.lastSeenAt})}
end
if state.envelope.recordVersion < observed then return {'invalid'} end
local lease = state.refreshLease
if lease == nil or lease == cjson.null then return {'retry_claim'} end
if lease.expiresAtMs <= tonumber(ARGV[3]) then
  if lease.phase == 'dispatched' then return {'orphaned_dispatched_refresh'} end
  return {'retry_claim'}
end
return {'waiting', tostring(lease.expiresAtMs)}
`;

const REVOKE_SCRIPT = `-- clinicos:cp14:web-session:revoke-family
${LUA_ACTIVE_STATE}
${LUA_AUDIT_FIELD_VALID}
local now_ms = tonumber(ARGV[7])
local existing_family = redis.call('HGET', KEYS[1], ARGV[2])
if existing_family then
  local family = cjson.decode(existing_family)
  if type(family) ~= 'table' or type(family.expiresAtMs) ~= 'number' then return 'invalid' end
  if family.expiresAtMs > now_ms then return 'already_revoked' end
end
local current = active_state(redis.call('HGET', KEYS[1], ARGV[1]), now_ms)
if not current then return 'missing' end
if current.envelope.familyKey ~= ARGV[3] then return 'invalid' end
local marker = cjson.decode(ARGV[4])
local unavailable = cjson.decode(ARGV[5])
local audit_count = tonumber(ARGV[8])
if type(marker) ~= 'table' or marker.kind ~= 'family-revocation' or
   type(unavailable) ~= 'table' or unavailable.kind ~= 'unavailable' or audit_count < 1 then
  return 'invalid'
end
for index = 1, audit_count do
  local field_index = 8 + ((index - 1) * 2) + 1
  if not audit_field_valid(KEYS[1], ARGV[field_index], ARGV[field_index + 1]) then
    return 'invalid'
  end
end
local write = {'HSET', KEYS[1], ARGV[1], ARGV[5], ARGV[2], ARGV[4]}
for index = 1, audit_count do
  local field_index = 8 + ((index - 1) * 2) + 1
  table.insert(write, ARGV[field_index])
  table.insert(write, ARGV[field_index + 1])
end
redis.call(unpack(write))
return 'revoked'
`;

/** Test-visible proof surface: every state mutation has exactly one final write command. */
export const CP14_REDIS_WEB_SESSION_MUTATION_SCRIPTS = Object.freeze({
  create: CREATE_SCRIPT,
  touch: TOUCH_SCRIPT,
  rotate: ROTATE_SCRIPT,
  claimRefresh: CLAIM_SCRIPT,
  markRefreshDispatched: DISPATCH_SCRIPT,
  completeRefresh: COMPLETE_SCRIPT,
  revokeFamily: REVOKE_SCRIPT
});

interface RedisRefreshLease {
  id: string;
  recordVersion: number;
  phase: "claimed" | "dispatched";
  expiresAtMs: number;
  expiresAt: string;
  dispatchedAt?: string;
}

interface RedisStoredSession {
  schemaVersion: 1;
  kind: "session";
  envelope: WebSessionEnvelope;
  lastSeenAt: string;
  lastSeenAtMs: number;
  expiresAtMs: number;
  refreshLease: RedisRefreshLease | null;
}

interface RedisAuditRecord {
  schemaVersion: 1;
  kind: "required_security_audit";
  deduplicationKey: string;
  intent: RequiredSecurityAuditIntent;
}

export interface RedisSecurityAuditOutboxPage {
  nextCursor: string;
  items: readonly {
    field: string;
    deduplicationKey: string;
    intent: RequiredSecurityAuditIntent;
  }[];
}

export interface RedisWebSessionStoreOptions extends RedisRuntimeClientOptions {
  keyHmacSecret: Uint8Array;
  keyPrefix?: string;
  maximumTtlMs?: number;
  pollIntervalMs?: number;
  now: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

export class RedisWebSessionStoreError extends Error {
  readonly code: "dependency_unavailable" | "corrupt_response" | "invalid_input";

  constructor(code: RedisWebSessionStoreError["code"], message: string) {
    super(message);
    this.name = "RedisWebSessionStoreError";
    this.code = code;
  }
}

/**
 * Non-cluster Redis primary/replica implementation. Session state, family tombstones and HMAC-keyed
 * pending audit fields share one hash, so every mutation ends with one all-or-nothing HSET command.
 * State expiry is enforced on every read/mutation and by `purgeExpiredStateBatch`; audit fields are
 * retained until an idempotent downstream sink acknowledges them.
 */
export class RedisWebSessionStore implements WebSessionStore {
  readonly atomicity = "session_state_and_required_audit_outbox" as const;
  readonly stateAndAuditHashKey: string;
  readonly pendingAuditFieldPattern: string;
  readonly #redis: RedisRuntimeDependency;
  readonly #keys: OpaqueRedisKeyspace;
  readonly #maximumTtlMs: number;
  readonly #pollIntervalMs: number;
  readonly #now: () => Date;
  readonly #sleep: (milliseconds: number) => Promise<void>;

  constructor(options: RedisWebSessionStoreOptions) {
    if (typeof options.now !== "function") throw invalidInput();
    this.#redis = new RedisRuntimeDependency(options);
    this.#keys = new OpaqueRedisKeyspace({
      prefix: options.keyPrefix ?? "clinicos:web-session:v1",
      hmacKey: options.keyHmacSecret
    });
    this.stateAndAuditHashKey = this.#keys.singleton("state-outbox");
    this.pendingAuditFieldPattern = `${this.#keys.prefix}:audit-field:*`;
    this.#maximumTtlMs = options.maximumTtlMs ?? DEFAULT_MAXIMUM_TTL_MS;
    if (
      !Number.isSafeInteger(this.#maximumTtlMs) ||
      this.#maximumTtlMs < 900_000 ||
      this.#maximumTtlMs > DEFAULT_MAXIMUM_TTL_MS
    ) {
      throw invalidInput();
    }
    this.#pollIntervalMs = options.pollIntervalMs ?? 50;
    if (
      !Number.isSafeInteger(this.#pollIntervalMs) ||
      this.#pollIntervalMs < 10 ||
      this.#pollIntervalMs > 250
    ) {
      throw invalidInput();
    }
    this.#now = options.now;
    this.#sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async readiness(): Promise<void> {
    try {
      await this.#redis.ping();
      const result = await this.#redis.evaluate(
        `-- clinicos:cp14:web-session:readiness
local kind = redis.call('TYPE', KEYS[1])
if type(kind) == 'table' then kind = kind['ok'] end
if kind ~= 'none' and kind ~= 'hash' then return 'invalid' end
local write = redis.call('SET', KEYS[2], ARGV[1], 'PX', 5000)
if type(write) == 'table' then write = write['ok'] end
if write ~= 'OK' then return 'invalid' end
return 'ready'`,
        [this.stateAndAuditHashKey, this.#keys.singleton("readiness")],
        [String(trustedInstant(this.#now()).getTime())]
      );
      if (result !== "ready") throw new Error("invalid readiness response");
    } catch {
      throw dependencyUnavailable();
    }
  }

  async close(): Promise<void> {
    await this.#redis.close();
  }

  async create(
    sessionKey: string,
    envelope: WebSessionEnvelope,
    lastSeenAt: Date,
    expiresAt: Date,
    requiredAudit: RequiredSecurityAuditIntent
  ): Promise<boolean> {
    assertStoreKey(sessionKey);
    validateEnvelope(envelope);
    const seen = trustedInstant(lastSeenAt);
    const expiry = boundedExpiry(expiresAt, seen, this.#maximumTtlMs);
    const audit = auditRecord(requiredAudit);
    const result = await this.#eval(CREATE_SCRIPT, [
      this.#sessionField(sessionKey),
      this.#familyField(envelope.familyKey),
      serializeState(envelope, seen, expiry, null),
      this.#auditField(audit.deduplicationKey),
      JSON.stringify(audit),
      String(seen.getTime()),
      envelope.familyKey
    ]);
    if (result === "created") return true;
    if (result === "exists" || result === "family_revoked") return false;
    throw corruptResponse();
  }

  async read(sessionKey: string, now: Date): Promise<WebSessionStoredEntry | null> {
    assertStoreKey(sessionKey);
    const current = trustedInstant(now);
    const raw = await this.#eval(
      "-- clinicos:cp14:web-session:read\nreturn redis.call('HGET', KEYS[1], ARGV[1])",
      [this.#sessionField(sessionKey)]
    );
    if (raw === null) return null;
    if (typeof raw !== "string") throw corruptResponse();
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw corruptResponse();
    }
    if (isRecord(decoded) && decoded.kind === "unavailable") {
      if (!Number.isSafeInteger(decoded.expiresAtMs)) throw corruptResponse();
      return null;
    }
    const state = parseState(raw);
    return state.expiresAtMs <= current.getTime() ? null : publicEntry(state);
  }

  async touchActivity(
    sessionKey: string,
    observedAt: Date,
    expiresAt: Date
  ): Promise<"touched" | "missing"> {
    assertStoreKey(sessionKey);
    const observed = trustedInstant(observedAt);
    const expiry = boundedExpiry(expiresAt, observed, this.#maximumTtlMs);
    const result = await this.#eval(TOUCH_SCRIPT, [
      this.#sessionField(sessionKey),
      String(observed.getTime()),
      observed.toISOString(),
      String(expiry),
      String(observed.getTime())
    ]);
    if (result === "touched" || result === "missing") return result;
    throw corruptResponse();
  }

  async rotate(
    previousSessionKey: string,
    nextSessionKey: string,
    expectedRecordVersion: number,
    envelope: WebSessionEnvelope,
    lastSeenAt: Date,
    expiresAt: Date,
    requiredAudit: RequiredSecurityAuditIntent
  ): Promise<WebSessionRotateResult> {
    assertStoreKey(previousSessionKey);
    assertStoreKey(nextSessionKey);
    assertRecordVersion(expectedRecordVersion);
    validateEnvelope(envelope);
    if (envelope.recordVersion !== expectedRecordVersion + 1) throw invalidInput();
    const seen = trustedInstant(lastSeenAt);
    const expiry = boundedExpiry(expiresAt, seen, this.#maximumTtlMs);
    const audit = auditRecord(requiredAudit);
    const result = resultArray(
      await this.#eval(ROTATE_SCRIPT, [
        this.#sessionField(previousSessionKey),
        this.#sessionField(nextSessionKey),
        this.#familyField(envelope.familyKey),
        serializeState(envelope, seen, expiry, null),
        this.#auditField(audit.deduplicationKey),
        JSON.stringify(audit),
        String(expectedRecordVersion),
        unavailableTombstone(expiry),
        String(seen.getTime()),
        envelope.familyKey
      ])
    );
    const status = result[0];
    if (status === "rotated" || status === "version_changed" || status === "missing_or_revoked") {
      return { status };
    }
    if (status === "refresh_in_progress") {
      return { status, leaseExpiresAt: epochResult(result[1]).toISOString() };
    }
    throw corruptResponse();
  }

  async claimRefresh(input: {
    sessionKey: string;
    expectedRecordVersion: number;
    leaseId: string;
    claimedAt: Date;
    leaseExpiresAt: Date;
  }): Promise<WebSessionRefreshClaimResult> {
    assertStoreKey(input.sessionKey);
    assertRecordVersion(input.expectedRecordVersion);
    assertLease(input.leaseId);
    const claimed = trustedInstant(input.claimedAt);
    const leaseExpiry = trustedInstant(input.leaseExpiresAt);
    if (
      leaseExpiry.getTime() <= claimed.getTime() ||
      leaseExpiry.getTime() - claimed.getTime() > 30_000
    ) {
      throw invalidInput();
    }
    const result = resultArray(
      await this.#eval(CLAIM_SCRIPT, [
        this.#sessionField(input.sessionKey),
        String(input.expectedRecordVersion),
        input.leaseId,
        String(claimed.getTime()),
        String(leaseExpiry.getTime()),
        leaseExpiry.toISOString()
      ])
    );
    const status = result[0];
    if (
      status === "claimed" ||
      status === "orphaned_dispatched_refresh" ||
      status === "version_changed" ||
      status === "missing_or_revoked"
    ) {
      return { status };
    }
    if (status === "refresh_in_progress") {
      return { status, leaseExpiresAt: epochResult(result[1]).toISOString() };
    }
    throw corruptResponse();
  }

  async markRefreshDispatched(input: {
    sessionKey: string;
    expectedRecordVersion: number;
    leaseId: string;
    dispatchedAt: Date;
  }): Promise<boolean> {
    assertStoreKey(input.sessionKey);
    assertRecordVersion(input.expectedRecordVersion);
    assertLease(input.leaseId);
    const dispatched = trustedInstant(input.dispatchedAt);
    const result = await this.#eval(DISPATCH_SCRIPT, [
      this.#sessionField(input.sessionKey),
      String(input.expectedRecordVersion),
      input.leaseId,
      dispatched.toISOString(),
      String(dispatched.getTime())
    ]);
    if (result === "dispatched") return true;
    if (result === "rejected") return false;
    throw corruptResponse();
  }

  async completeRefresh(input: {
    sessionKey: string;
    expectedRecordVersion: number;
    leaseId: string;
    envelope: WebSessionEnvelope;
    lastSeenAt: Date;
    expiresAt: Date;
  }): Promise<boolean> {
    assertStoreKey(input.sessionKey);
    assertRecordVersion(input.expectedRecordVersion);
    assertLease(input.leaseId);
    validateEnvelope(input.envelope);
    if (input.envelope.recordVersion !== input.expectedRecordVersion + 1) throw invalidInput();
    const seen = trustedInstant(input.lastSeenAt);
    const expiry = boundedExpiry(input.expiresAt, seen, this.#maximumTtlMs);
    const result = await this.#eval(COMPLETE_SCRIPT, [
      this.#sessionField(input.sessionKey),
      String(input.expectedRecordVersion),
      input.leaseId,
      serializeState(input.envelope, seen, expiry, null),
      String(expiry),
      String(seen.getTime())
    ]);
    if (result === "completed") return true;
    if (result === "rejected") return false;
    throw corruptResponse();
  }

  async waitForRefresh(input: {
    sessionKey: string;
    observedRecordVersion: number;
    waitUntil: Date;
  }): Promise<WebSessionRefreshWaitResult> {
    assertStoreKey(input.sessionKey);
    assertRecordVersion(input.observedRecordVersion);
    const deadline = trustedInstant(input.waitUntil);
    const startedAtMs = trustedInstant(this.#now()).getTime();
    const maximumPolls =
      Math.ceil(Math.max(0, deadline.getTime() - startedAtMs) / this.#pollIntervalMs) + 2;
    let polls = 0;
    while (true) {
      polls += 1;
      if (polls > maximumPolls) return { status: "retry_claim" };
      const now = trustedInstant(this.#now());
      const result = resultArray(
        await this.#eval(WAIT_SCRIPT, [
          this.#sessionField(input.sessionKey),
          String(input.observedRecordVersion),
          String(now.getTime())
        ])
      );
      const status = result[0];
      if (
        status === "retry_claim" ||
        status === "orphaned_dispatched_refresh" ||
        status === "missing_or_revoked"
      ) {
        return { status };
      }
      if (status === "completed") {
        if (typeof result[1] !== "string") throw corruptResponse();
        return { status, entry: parsePublicEntry(result[1]) };
      }
      if (status !== "waiting") throw corruptResponse();
      if (now.getTime() >= deadline.getTime()) return { status: "retry_claim" };
      const leaseExpiry = epochResult(result[1]).getTime();
      await this.#sleep(
        Math.max(
          1,
          Math.min(
            this.#pollIntervalMs,
            deadline.getTime() - now.getTime(),
            leaseExpiry - now.getTime()
          )
        )
      );
    }
  }

  async delete(sessionKey: string): Promise<void> {
    assertStoreKey(sessionKey);
    const result = await this.#eval(
      "-- clinicos:cp14:web-session:delete\nreturn redis.call('HDEL', KEYS[1], ARGV[1])",
      [this.#sessionField(sessionKey)]
    );
    if (!Number.isSafeInteger(Number(result))) throw corruptResponse();
  }

  async revokeSessionFamily(input: {
    sessionKey: string;
    familyKey: string;
    reason: WebSessionRevocationReason;
    revokedAt: Date;
    expiresAt: Date;
    requiredAudits: readonly [RequiredSecurityAuditIntent, ...RequiredSecurityAuditIntent[]];
  }): Promise<WebSessionRevocationResult> {
    assertStoreKey(input.sessionKey);
    assertStoreKey(input.familyKey);
    const revoked = trustedInstant(input.revokedAt);
    const expiry = boundedExpiry(input.expiresAt, revoked, this.#maximumTtlMs);
    const audits = input.requiredAudits.map(auditRecord);
    const args = [
      this.#sessionField(input.sessionKey),
      this.#familyField(input.familyKey),
      input.familyKey,
      JSON.stringify({
        schemaVersion: 1,
        kind: "family-revocation",
        reason: input.reason,
        revokedAt: revoked.toISOString(),
        expiresAtMs: expiry
      }),
      unavailableTombstone(expiry),
      String(expiry),
      String(revoked.getTime()),
      String(audits.length)
    ];
    for (const audit of audits) {
      args.push(this.#auditField(audit.deduplicationKey), JSON.stringify(audit));
    }
    const result = await this.#eval(REVOKE_SCRIPT, args);
    if (result === "revoked" || result === "already_revoked" || result === "missing") return result;
    throw corruptResponse();
  }

  async isFamilyRevoked(familyKey: string, now: Date): Promise<boolean> {
    assertStoreKey(familyKey);
    const current = trustedInstant(now);
    const raw = await this.#eval(
      "-- clinicos:cp14:web-session:is-family-revoked\nreturn redis.call('HGET', KEYS[1], ARGV[1])",
      [this.#familyField(familyKey)]
    );
    if (raw === null) return false;
    if (typeof raw !== "string") throw corruptResponse();
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw corruptResponse();
    }
    if (
      !isRecord(value) ||
      value.kind !== "family-revocation" ||
      !Number.isSafeInteger(value.expiresAtMs)
    ) {
      throw corruptResponse();
    }
    return Number(value.expiresAtMs) > current.getTime();
  }

  /** Read-only fan-in page. Delivery is at-least-once and keyed by audit deduplicationKey. */
  async scanPendingAudits(cursor = "0", count = 100): Promise<RedisSecurityAuditOutboxPage> {
    if (!/^\d{1,20}$/.test(cursor) || !Number.isSafeInteger(count) || count < 1 || count > 500) {
      throw invalidInput();
    }
    const result = resultArray(
      await this.#eval(
        "-- clinicos:cp14:web-session:scan-audits\nreturn redis.call('HSCAN', KEYS[1], ARGV[1], 'MATCH', ARGV[2], 'COUNT', ARGV[3])",
        [cursor, this.pendingAuditFieldPattern, String(count)]
      )
    );
    if (typeof result[0] !== "string" || !Array.isArray(result[1])) throw corruptResponse();
    const pairs = result[1];
    if (pairs.length % 2 !== 0) throw corruptResponse();
    const items: RedisSecurityAuditOutboxPage["items"][number][] = [];
    for (let index = 0; index < pairs.length; index += 2) {
      const field = pairs[index];
      const raw = pairs[index + 1];
      if (typeof field !== "string" || typeof raw !== "string") throw corruptResponse();
      const record = parseAuditRecord(raw);
      items.push({ field, deduplicationKey: record.deduplicationKey, intent: record.intent });
    }
    return { nextCursor: result[0], items };
  }

  /** Acknowledge only after the authoritative audit sink durably accepts the deduplication key. */
  async acknowledgePendingAudit(deduplicationKey: string): Promise<boolean> {
    const intentField = this.#auditField(deduplicationKey);
    const result = await this.#eval(
      "-- clinicos:cp14:web-session:ack-audit\nreturn redis.call('HDEL', KEYS[1], ARGV[1])",
      [intentField]
    );
    const numeric = Number(result);
    if (numeric === 0) return false;
    if (numeric === 1) return true;
    throw corruptResponse();
  }

  /** Physically remove logically expired session/family/tombstone fields in bounded batches. */
  async purgeExpiredStateBatch(input: {
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
    const result = resultArray(
      await this.#eval(
        `-- clinicos:cp14:web-session:purge-expired
local page = redis.call('HSCAN', KEYS[1], ARGV[1], 'COUNT', ARGV[2])
local expired = {}
for index = 1, #page[2], 2 do
  local field = page[2][index]
  if string.find(field, ':audit-field:', 1, true) == nil then
    local value = cjson.decode(page[2][index + 1])
    if type(value) == 'table' and type(value.expiresAtMs) == 'number' and
       value.expiresAtMs <= tonumber(ARGV[3]) then table.insert(expired, field) end
  end
end
if #expired > 0 then redis.call('HDEL', KEYS[1], unpack(expired)) end
return {page[1], tostring(#expired)}`,
        [cursor, String(count), String(now.getTime())]
      )
    );
    if (typeof result[0] !== "string") throw corruptResponse();
    const deleted = Number(result[1]);
    if (!Number.isSafeInteger(deleted) || deleted < 0 || deleted > count) throw corruptResponse();
    return { nextCursor: result[0], deleted };
  }

  #sessionField(value: string): string {
    return this.#keys.key("session-field", value);
  }

  #familyField(value: string): string {
    return this.#keys.key("family-field", value);
  }

  #auditField(value: string): string {
    if (!/^[A-Za-z0-9._:-]{8,384}$/.test(value)) throw invalidInput();
    return this.#keys.key("audit-field", value);
  }

  async #eval(script: string, args: readonly string[]): Promise<unknown> {
    try {
      return await this.#redis.evaluate(script, [this.stateAndAuditHashKey], args);
    } catch {
      throw dependencyUnavailable();
    }
  }
}

function serializeState(
  envelope: WebSessionEnvelope,
  lastSeenAt: Date,
  expiresAtMs: number,
  refreshLease: RedisRefreshLease | null
): string {
  return JSON.stringify({
    schemaVersion: 1,
    kind: "session",
    envelope,
    lastSeenAt: lastSeenAt.toISOString(),
    lastSeenAtMs: lastSeenAt.getTime(),
    expiresAtMs,
    refreshLease
  } satisfies RedisStoredSession);
}

function parseState(raw: string): RedisStoredSession {
  if (Buffer.byteLength(raw) > 131_072) throw corruptResponse();
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw corruptResponse();
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "session" ||
    !isRecord(value.envelope) ||
    typeof value.lastSeenAt !== "string" ||
    !Number.isSafeInteger(value.lastSeenAtMs) ||
    !Number.isSafeInteger(value.expiresAtMs)
  ) {
    throw corruptResponse();
  }
  const envelope = value.envelope as unknown as WebSessionEnvelope;
  validateEnvelope(envelope, true);
  if (new Date(value.lastSeenAt).getTime() !== value.lastSeenAtMs) throw corruptResponse();
  return {
    schemaVersion: 1,
    kind: "session",
    envelope,
    lastSeenAt: value.lastSeenAt,
    lastSeenAtMs: Number(value.lastSeenAtMs),
    expiresAtMs: Number(value.expiresAtMs),
    refreshLease: parseLease(value.refreshLease)
  };
}

function parseLease(value: unknown): RedisRefreshLease | null {
  if (value === null || value === undefined) return null;
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !LEASE_PATTERN.test(value.id) ||
    !Number.isSafeInteger(value.recordVersion) ||
    Number(value.recordVersion) < 1 ||
    (value.phase !== "claimed" && value.phase !== "dispatched") ||
    !Number.isSafeInteger(value.expiresAtMs) ||
    typeof value.expiresAt !== "string" ||
    new Date(value.expiresAt).getTime() !== value.expiresAtMs
  ) {
    throw corruptResponse();
  }
  return value as unknown as RedisRefreshLease;
}

function auditRecord(intentInput: RequiredSecurityAuditIntent): RedisAuditRecord {
  const intent = validateRequiredSecurityAuditIntent(intentInput);
  const record: RedisAuditRecord = {
    schemaVersion: 1,
    kind: "required_security_audit",
    deduplicationKey: intent.deduplicationKey,
    intent
  };
  if (Buffer.byteLength(JSON.stringify(record)) > 8_192) throw invalidInput();
  return record;
}

function parseAuditRecord(raw: string): RedisAuditRecord {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw corruptResponse();
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.kind !== "required_security_audit" ||
    typeof value.deduplicationKey !== "string" ||
    !isRecord(value.intent)
  ) {
    throw corruptResponse();
  }
  const intent = validateRequiredSecurityAuditIntent(
    value.intent as unknown as RequiredSecurityAuditIntent
  );
  if (intent.deduplicationKey !== value.deduplicationKey) throw corruptResponse();
  return {
    schemaVersion: 1,
    kind: "required_security_audit",
    deduplicationKey: value.deduplicationKey,
    intent
  };
}

function unavailableTombstone(expiresAtMs: number): string {
  return JSON.stringify({ schemaVersion: 1, kind: "unavailable", expiresAtMs });
}

function publicEntry(state: RedisStoredSession): WebSessionStoredEntry {
  return { envelope: structuredClone(state.envelope), lastSeenAt: state.lastSeenAt };
}

function parsePublicEntry(raw: string): WebSessionStoredEntry {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw corruptResponse();
  }
  if (!isRecord(value) || !isRecord(value.envelope) || typeof value.lastSeenAt !== "string") {
    throw corruptResponse();
  }
  const envelope = value.envelope as unknown as WebSessionEnvelope;
  validateEnvelope(envelope, true);
  if (Number.isNaN(new Date(value.lastSeenAt).getTime())) throw corruptResponse();
  return { envelope, lastSeenAt: value.lastSeenAt };
}

function validateEnvelope(value: WebSessionEnvelope, stored = false): void {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 2 ||
    !Number.isSafeInteger(value.recordVersion) ||
    value.recordVersion < 1 ||
    !STORE_KEY_PATTERN.test(value.familyKey) ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(value.keyId) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(value.iv) ||
    !/^[A-Za-z0-9_-]{16,64}$/.test(value.tag) ||
    !/^[A-Za-z0-9_-]{1,131072}$/.test(value.ciphertext) ||
    !ISO_PATTERN.test(value.expiresAt) ||
    Number.isNaN(new Date(value.expiresAt).getTime())
  ) {
    if (stored) throw corruptResponse();
    throw invalidInput();
  }
}

function boundedExpiry(expiresAtInput: Date, reference: Date, maximumTtlMs: number): number {
  const expiresAt = trustedInstant(expiresAtInput);
  const ttl = expiresAt.getTime() - reference.getTime();
  if (ttl <= 0 || ttl > maximumTtlMs) throw invalidInput();
  return expiresAt.getTime();
}

function resultArray(value: unknown): unknown[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) throw corruptResponse();
  return value;
}

function epochResult(value: unknown): Date {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) throw corruptResponse();
  return new Date(result);
}

function assertStoreKey(value: string): void {
  if (!STORE_KEY_PATTERN.test(value)) throw invalidInput();
}

function assertLease(value: string): void {
  if (!LEASE_PATTERN.test(value)) throw invalidInput();
}

function assertRecordVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) throw invalidInput();
}

function trustedInstant(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw invalidInput();
  return new Date(value.getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidInput(): RedisWebSessionStoreError {
  return new RedisWebSessionStoreError("invalid_input", "Redis web-session input is invalid.");
}

function corruptResponse(): RedisWebSessionStoreError {
  return new RedisWebSessionStoreError(
    "corrupt_response",
    "The durable web-session dependency returned an invalid result."
  );
}

function dependencyUnavailable(): RedisWebSessionStoreError {
  return new RedisWebSessionStoreError(
    "dependency_unavailable",
    "The durable web-session dependency could not confirm the requested operation."
  );
}
