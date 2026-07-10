import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual
} from "node:crypto";
import {
  validateRequiredSecurityAuditIntent,
  type RequiredSecurityAuditIntent
} from "./security-audit.ts";
import {
  hasMfaEvidence,
  normalizeCanonicalKeycloakIssuer,
  normalizeMfaAssurancePolicy,
  type MfaAssurancePolicy
} from "./production-identity.ts";

const OPAQUE_ID_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const COOKIE_NAME_PATTERN = /^(?:__Host-)?[A-Za-z0-9_-]{3,64}$/;
const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;
const AUTHORITY_REVISION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const TOKEN_PATTERN = /^[\x21-\x7E]{16,32768}$/;

export type WebSessionRevocationReason =
  | "logout"
  | "login_rotation"
  | "periodic_rotation"
  | "authority_changed"
  | "membership_revoked"
  | "expired"
  | "refresh_rejected"
  | "refresh_replay"
  | "refresh_recovery_uncertain"
  | "administrator_revoked"
  | "jml_transition";

export interface SessionEncryptionKey {
  id: string;
  key: Uint8Array;
}

export interface WebSessionPolicy {
  productionLike: boolean;
  expectedIssuer: string;
  mfaAssurancePolicy: MfaAssurancePolicy;
  cookieName: string;
  secureCookie: boolean;
  idleTtlSeconds: number;
  absoluteTtlSeconds: number;
  rotateAfterSeconds: number;
  refreshLeewaySeconds: number;
  refreshLeaseSeconds: number;
  lookupHmacKey: Uint8Array;
  csrfHmacKey: Uint8Array;
  encryptionKeys: readonly [SessionEncryptionKey, ...SessionEncryptionKey[]];
}

export interface WebSessionEnvelope {
  schemaVersion: 2;
  recordVersion: number;
  familyKey: string;
  keyId: string;
  iv: string;
  ciphertext: string;
  tag: string;
  expiresAt: string;
}

export interface WebSessionStoredEntry {
  envelope: WebSessionEnvelope;
  lastSeenAt: string;
}

export type WebSessionRotateResult =
  | { status: "rotated" }
  | { status: "refresh_in_progress"; leaseExpiresAt: string }
  | { status: "version_changed" }
  | { status: "missing_or_revoked" };

export type WebSessionRefreshClaimResult =
  | { status: "claimed" }
  | { status: "refresh_in_progress"; leaseExpiresAt: string }
  | { status: "orphaned_dispatched_refresh" }
  | { status: "version_changed" }
  | { status: "missing_or_revoked" };

export type WebSessionRefreshWaitResult =
  | { status: "completed"; entry: WebSessionStoredEntry }
  | { status: "retry_claim" }
  | { status: "orphaned_dispatched_refresh" }
  | { status: "missing_or_revoked" };

export type WebSessionRevocationResult = "revoked" | "already_revoked" | "missing";

/**
 * The production store must implement these operations atomically (Redis Lua or an equivalent
 * transactional store). A process-local store is suitable only as a test double.
 */
export interface WebSessionStore {
  readonly atomicity: "session_state_and_required_audit_outbox";
  create(
    sessionKey: string,
    envelope: WebSessionEnvelope,
    lastSeenAt: Date,
    expiresAt: Date,
    requiredAudit: RequiredSecurityAuditIntent
  ): Promise<boolean>;
  read(sessionKey: string, now: Date): Promise<WebSessionStoredEntry | null>;
  /** Monotonic activity update; concurrent touches never mutate token recordVersion. */
  touchActivity(
    sessionKey: string,
    observedAt: Date,
    expiresAt: Date
  ): Promise<"touched" | "missing">;
  rotate(
    previousSessionKey: string,
    nextSessionKey: string,
    expectedRecordVersion: number,
    envelope: WebSessionEnvelope,
    lastSeenAt: Date,
    expiresAt: Date,
    requiredAudit: RequiredSecurityAuditIntent
  ): Promise<WebSessionRotateResult>;
  claimRefresh(input: {
    sessionKey: string;
    expectedRecordVersion: number;
    leaseId: string;
    claimedAt: Date;
    leaseExpiresAt: Date;
  }): Promise<WebSessionRefreshClaimResult>;
  markRefreshDispatched(input: {
    sessionKey: string;
    expectedRecordVersion: number;
    leaseId: string;
    dispatchedAt: Date;
  }): Promise<boolean>;
  completeRefresh(input: {
    sessionKey: string;
    expectedRecordVersion: number;
    leaseId: string;
    envelope: WebSessionEnvelope;
    /** Store must retain max(current lastSeenAt, supplied lastSeenAt). */
    lastSeenAt: Date;
    expiresAt: Date;
  }): Promise<boolean>;
  /** Wait via bounded polling/pub-sub without holding a process-local lock. */
  waitForRefresh(input: {
    sessionKey: string;
    observedRecordVersion: number;
    waitUntil: Date;
  }): Promise<WebSessionRefreshWaitResult>;
  delete(sessionKey: string): Promise<void>;
  revokeSessionFamily(input: {
    sessionKey: string;
    familyKey: string;
    reason: WebSessionRevocationReason;
    revokedAt: Date;
    expiresAt: Date;
    requiredAudits: readonly [RequiredSecurityAuditIntent, ...RequiredSecurityAuditIntent[]];
  }): Promise<WebSessionRevocationResult>;
  isFamilyRevoked(familyKey: string, now: Date): Promise<boolean>;
}

export interface WebSessionAuthority {
  active: boolean;
  authorityRevision: string;
}

export interface WebSessionAuthorityResolver {
  resolve(input: { subject: string; issuer: string }): Promise<WebSessionAuthority>;
}

export interface WebSessionTokenSet {
  accessToken: string;
  refreshToken: string;
  idToken?: string | null;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export interface RefreshedWebSessionTokenSet extends WebSessionTokenSet {
  subject: string;
  issuer: string;
  authorizedParty: string;
  keycloakSessionId?: string | null;
  amr: readonly string[];
  acr: string | null;
}

export interface WebSessionTokenRefresher {
  refresh(input: {
    refreshToken: string;
    subject: string;
    issuer: string;
    authorizedParty: string;
  }): Promise<RefreshedWebSessionTokenSet>;
}

export interface WebSessionProviderRevoker {
  revoke(input: {
    refreshToken: string;
    subject: string;
    issuer: string;
    authorizedParty: string;
  }): Promise<void>;
}

interface StoredWebSessionRecord {
  schemaVersion: 2;
  recordVersion: number;
  familyId: string;
  subject: string;
  issuer: string;
  authorizedParty: string;
  keycloakSessionId: string | null;
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  createdAt: string;
  rotatedAt: string;
  absoluteExpiresAt: string;
  authorityRevision: string;
  amr: string[];
  acr: string | null;
}

export interface SafeWebSession {
  subject: string;
  issuer: string;
  authorizedParty: string;
  keycloakSessionId: string | null;
  createdAt: string;
  lastSeenAt: string;
  absoluteExpiresAt: string;
  authorityRevision: string;
  amr: readonly string[];
  acr: string | null;
  mfaAssurancePolicyId: string;
  mfaVerified: boolean;
  csrfToken: string;
  shouldRotate: boolean;
}

export interface CreatedWebSession {
  cookie: string;
  csrfToken: string;
  safeSession: SafeWebSession;
}

export type RotatedWebSession = CreatedWebSession;

export type WebSessionRefreshProviderFailure =
  | {
      classification: "confirmed_rejection";
      reasonCode: "invalid_grant" | "session_expired" | "consent_revoked" | "identity_disabled";
    }
  | {
      classification: "confirmed_replay";
      reasonCode: "refresh_token_reuse";
    }
  | {
      classification: "transport_uncertain";
      reasonCode: "timeout" | "network_error" | "provider_unavailable" | "malformed_response";
    };

/** Official OIDC adapters use this only after classifying the provider/transport result. */
export class WebSessionRefreshProviderError extends Error {
  readonly failure: WebSessionRefreshProviderFailure;

  constructor(failure: WebSessionRefreshProviderFailure) {
    super("OIDC refresh did not produce an accepted durable token result.");
    this.name = "WebSessionRefreshProviderError";
    this.failure = Object.freeze({ ...failure });
  }
}

export class WebSessionError extends Error {
  readonly code:
    | "invalid_configuration"
    | "invalid_session"
    | "expired_session"
    | "revoked_session"
    | "authority_changed"
    | "rotation_conflict"
    | "refresh_rejected"
    | "refresh_replay"
    | "refresh_recovery_required";

  constructor(code: WebSessionError["code"], message: string) {
    super(message);
    this.name = "WebSessionError";
    this.code = code;
  }
}

export class WebSessionManager {
  readonly #store: WebSessionStore;
  readonly #policy: NormalizedWebSessionPolicy;
  readonly #randomBytes: (size: number) => Buffer;

  constructor(input: {
    store: WebSessionStore;
    policy: WebSessionPolicy;
    randomBytesImpl?: (size: number) => Buffer;
  }) {
    if (input.store.atomicity !== "session_state_and_required_audit_outbox") {
      throw new Error(
        "Web session storage must atomically persist state and required audit-outbox evidence."
      );
    }
    this.#store = input.store;
    this.#policy = normalizePolicy(input.policy);
    this.#randomBytes = input.randomBytesImpl ?? randomBytes;
  }

  get cookieName(): string {
    return this.#policy.cookieName;
  }

  async createAuthenticatedSession(input: {
    subject: string;
    issuer: string;
    authorizedParty: string;
    keycloakSessionId?: string | null;
    tokens: WebSessionTokenSet;
    authorityRevision: string;
    amr?: readonly string[];
    acr?: string | null;
    previousSessionId?: string | null;
    now: Date;
  }): Promise<CreatedWebSession> {
    const now = trustedInstant(input.now, "session creation time");
    validateIdentity(
      input.subject,
      input.issuer,
      input.authorizedParty,
      input.authorityRevision,
      this.#policy.expectedIssuer
    );
    validateTokenSet(input.tokens, now);

    if (input.previousSessionId) {
      await this.revoke(input.previousSessionId, "login_rotation", now);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const sessionId = randomOpaqueId(this.#randomBytes);
      const familyId = randomOpaqueId(this.#randomBytes);
      const absoluteExpiresAt = new Date(now.getTime() + this.#policy.absoluteTtlSeconds * 1000);
      const record: StoredWebSessionRecord = {
        schemaVersion: 2,
        recordVersion: 1,
        familyId,
        subject: input.subject,
        issuer: input.issuer,
        authorizedParty: input.authorizedParty,
        keycloakSessionId: input.keycloakSessionId ?? null,
        accessToken: input.tokens.accessToken,
        refreshToken: input.tokens.refreshToken,
        idToken: input.tokens.idToken ?? null,
        accessExpiresAt: input.tokens.accessExpiresAt.toISOString(),
        refreshExpiresAt: input.tokens.refreshExpiresAt.toISOString(),
        createdAt: now.toISOString(),
        rotatedAt: now.toISOString(),
        absoluteExpiresAt: absoluteExpiresAt.toISOString(),
        authorityRevision: input.authorityRevision,
        amr: normalizeAmr(input.amr ?? []),
        acr: normalizeAcr(input.acr ?? null)
      };
      const sessionKey = this.#sessionKey(sessionId);
      const envelope = encryptRecord(record, sessionKey, this.#policy, this.#randomBytes);
      const created = await this.#store.create(
        sessionKey,
        envelope,
        now,
        absoluteExpiresAt,
        this.#sessionAudit(record, envelope.familyKey, "auth.session.created", "login", now)
      );
      if (!created) continue;
      return this.#createdSession(sessionId, record, now, now);
    }
    throw new WebSessionError(
      "invalid_configuration",
      "Session store rejected unique session creation."
    );
  }

  async inspect(
    sessionId: string,
    authorityResolver: WebSessionAuthorityResolver,
    now: Date
  ): Promise<SafeWebSession> {
    const loaded = await this.#loadActive(sessionId, authorityResolver, now, true);
    return this.#safeSession(sessionId, loaded.record, loaded.now, loaded.lastSeenAt);
  }

  async rotate(
    sessionId: string,
    authorityResolver: WebSessionAuthorityResolver,
    now: Date
  ): Promise<RotatedWebSession> {
    let loaded = await this.#loadActive(sessionId, authorityResolver, now, false);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const nextSessionId = randomOpaqueId(this.#randomBytes);
      const nextRecord: StoredWebSessionRecord = {
        ...loaded.record,
        recordVersion: loaded.record.recordVersion + 1,
        rotatedAt: loaded.now.toISOString()
      };
      const nextSessionKey = this.#sessionKey(nextSessionId);
      const envelope = encryptRecord(nextRecord, nextSessionKey, this.#policy, this.#randomBytes);
      const result = await this.#store.rotate(
        loaded.sessionKey,
        nextSessionKey,
        loaded.record.recordVersion,
        envelope,
        loaded.now,
        new Date(nextRecord.absoluteExpiresAt),
        this.#sessionAudit(
          nextRecord,
          envelope.familyKey,
          "auth.session.rotated",
          "periodic_rotation",
          loaded.now
        )
      );
      if (result.status === "rotated") {
        return this.#createdSession(nextSessionId, nextRecord, loaded.now, loaded.now);
      }
      if (result.status === "refresh_in_progress") {
        const waited = await this.#store.waitForRefresh({
          sessionKey: loaded.sessionKey,
          observedRecordVersion: loaded.record.recordVersion,
          waitUntil: new Date(result.leaseExpiresAt)
        });
        if (waited.status === "orphaned_dispatched_refresh") {
          await this.#revokeUncertainRefresh(loaded);
        }
        if (waited.status === "missing_or_revoked") break;
      } else if (result.status === "missing_or_revoked") {
        break;
      }
      loaded = await this.#loadActive(sessionId, authorityResolver, now, false);
    }
    throw new WebSessionError("rotation_conflict", "Session was concurrently rotated or revoked.");
  }

  async withAccessToken<T>(input: {
    sessionId: string;
    authorityResolver: WebSessionAuthorityResolver;
    tokenRefresher: WebSessionTokenRefresher;
    now: Date;
    execute: (accessToken: string, session: SafeWebSession) => Promise<T>;
  }): Promise<T> {
    let loaded = await this.#loadActive(input.sessionId, input.authorityResolver, input.now, true);
    const accessExpiresAt = new Date(loaded.record.accessExpiresAt);
    if (
      accessExpiresAt.getTime() - loaded.now.getTime() <=
      this.#policy.refreshLeewaySeconds * 1000
    ) {
      loaded = await this.#refresh(loaded, input.tokenRefresher);
    }
    return input.execute(
      loaded.record.accessToken,
      this.#safeSession(input.sessionId, loaded.record, loaded.now, loaded.lastSeenAt)
    );
  }

  async revoke(
    sessionId: string,
    reason: WebSessionRevocationReason,
    now: Date,
    providerRevoker?: WebSessionProviderRevoker
  ): Promise<void> {
    const revokedAt = trustedInstant(now, "session revocation time");
    const sessionKey = this.#sessionKey(sessionId);
    const entry = await this.#store.read(sessionKey, revokedAt);
    if (!entry) return;
    const envelope = entry.envelope;
    let record: StoredWebSessionRecord;
    try {
      record = decryptRecord(envelope, sessionKey, this.#policy);
      validateStoredRecord(record, envelope, this.#policy);
    } catch {
      await this.#store.delete(sessionKey);
      throw new WebSessionError("invalid_session", "Session record could not be verified.");
    }
    const absoluteExpiresAt = new Date(record.absoluteExpiresAt);
    const revocation = await this.#store.revokeSessionFamily({
      sessionKey,
      familyKey: envelope.familyKey,
      reason,
      revokedAt,
      expiresAt: absoluteExpiresAt,
      requiredAudits: [
        this.#sessionAudit(record, envelope.familyKey, "auth.session.revoked", reason, revokedAt)
      ]
    });
    if (providerRevoker && revocation === "revoked") {
      try {
        await providerRevoker.revoke({
          refreshToken: record.refreshToken,
          subject: record.subject,
          issuer: record.issuer,
          authorizedParty: record.authorizedParty
        });
      } catch {
        throw new WebSessionError(
          "refresh_rejected",
          "Local session was revoked, but upstream identity revocation was not confirmed."
        );
      }
    }
  }

  parseSessionId(cookieHeader: string | readonly string[] | null | undefined): string | null {
    if (cookieHeader === undefined || cookieHeader === null) return null;
    if (typeof cookieHeader !== "string") {
      throw new WebSessionError("invalid_session", "Multiple Cookie headers are not accepted.");
    }
    const matches = cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => part.split("=", 2))
      .filter(([name]) => name === this.#policy.cookieName);
    if (matches.length === 0) return null;
    if (matches.length !== 1 || !matches[0]?.[1] || !OPAQUE_ID_PATTERN.test(matches[0][1])) {
      throw new WebSessionError("invalid_session", "Session cookie is malformed or ambiguous.");
    }
    return matches[0][1];
  }

  verifyCsrfToken(sessionId: string, suppliedToken: string | null | undefined): boolean {
    if (!suppliedToken || !OPAQUE_ID_PATTERN.test(suppliedToken)) return false;
    return secureEqual(this.#csrfToken(sessionId), suppliedToken);
  }

  clearCookie(): string {
    return clearCookie(this.#policy);
  }

  async #loadActive(
    sessionId: string,
    authorityResolver: WebSessionAuthorityResolver,
    nowInput: Date,
    touch: boolean
  ): Promise<LoadedSession> {
    const now = trustedInstant(nowInput, "session access time");
    const sessionKey = this.#sessionKey(sessionId);
    const entry = await this.#store.read(sessionKey, now);
    if (!entry) throw new WebSessionError("invalid_session", "Session is unavailable.");
    const envelope = entry.envelope;
    if (await this.#store.isFamilyRevoked(envelope.familyKey, now)) {
      await this.#store.delete(sessionKey);
      throw new WebSessionError("revoked_session", "Session has been revoked.");
    }
    const record = decryptRecord(envelope, sessionKey, this.#policy);
    validateStoredRecord(record, envelope, this.#policy);
    const absoluteExpiresAt = new Date(record.absoluteExpiresAt);
    const refreshExpiresAt = new Date(record.refreshExpiresAt);
    const lastSeenAt = new Date(entry.lastSeenAt);
    if (Number.isNaN(lastSeenAt.getTime())) {
      await this.#store.delete(sessionKey);
      throw new WebSessionError("invalid_session", "Session activity timestamp is invalid.");
    }
    if (
      absoluteExpiresAt.getTime() <= now.getTime() ||
      refreshExpiresAt.getTime() <= now.getTime() ||
      lastSeenAt.getTime() + this.#policy.idleTtlSeconds * 1000 <= now.getTime()
    ) {
      await this.#revokeLoaded({ sessionKey, envelope, record, now, lastSeenAt }, "expired", null);
      throw new WebSessionError("expired_session", "Session has expired.");
    }

    const authority = await authorityResolver.resolve({
      subject: record.subject,
      issuer: record.issuer
    });
    if (!authority.active || !AUTHORITY_REVISION_PATTERN.test(authority.authorityRevision)) {
      await this.#revokeLoaded(
        { sessionKey, envelope, record, now, lastSeenAt },
        "membership_revoked",
        null
      );
      throw new WebSessionError("authority_changed", "Verified membership is inactive.");
    }
    if (authority.authorityRevision !== record.authorityRevision) {
      await this.#revokeLoaded(
        { sessionKey, envelope, record, now, lastSeenAt },
        "authority_changed",
        null
      );
      throw new WebSessionError("authority_changed", "Session authority is stale.");
    }

    const loaded = { sessionKey, envelope, record, now, lastSeenAt };
    if (!touch) return loaded;
    const touched = await this.#store.touchActivity(sessionKey, now, absoluteExpiresAt);
    return { ...loaded, lastSeenAt: touched === "touched" ? now : lastSeenAt };
  }

  async #refresh(
    loaded: LoadedSession,
    refresher: WebSessionTokenRefresher
  ): Promise<LoadedSession> {
    let current = loaded;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const leaseId = randomOpaqueId(this.#randomBytes);
      const leaseExpiresAt = new Date(
        current.now.getTime() + this.#policy.refreshLeaseSeconds * 1000
      );
      const claim = await this.#store.claimRefresh({
        sessionKey: current.sessionKey,
        expectedRecordVersion: current.record.recordVersion,
        leaseId,
        claimedAt: current.now,
        leaseExpiresAt
      });
      if (claim.status === "orphaned_dispatched_refresh") {
        return this.#revokeUncertainRefresh(current);
      }
      if (claim.status === "missing_or_revoked") {
        throw new WebSessionError("revoked_session", "Session is unavailable or revoked.");
      }
      if (claim.status === "version_changed") {
        current = await this.#reloadAfterRefresh(current);
        if (!this.#needsRefresh(current)) return current;
        continue;
      }
      if (claim.status === "refresh_in_progress") {
        const waited = await this.#store.waitForRefresh({
          sessionKey: current.sessionKey,
          observedRecordVersion: current.record.recordVersion,
          waitUntil: new Date(claim.leaseExpiresAt)
        });
        if (waited.status === "orphaned_dispatched_refresh") {
          await this.#revokeUncertainRefresh(current);
        }
        if (waited.status === "missing_or_revoked") {
          throw new WebSessionError("revoked_session", "Session is unavailable or revoked.");
        }
        if (waited.status === "retry_claim") continue;
        if (waited.status !== "completed") continue;
        current = this.#loadedFromEntry(current.sessionKey, waited.entry, current.now);
        if (!this.#needsRefresh(current)) return current;
        continue;
      }

      const dispatched = await this.#store.markRefreshDispatched({
        sessionKey: current.sessionKey,
        expectedRecordVersion: current.record.recordVersion,
        leaseId,
        dispatchedAt: current.now
      });
      if (!dispatched) {
        const waited = await this.#store.waitForRefresh({
          sessionKey: current.sessionKey,
          observedRecordVersion: current.record.recordVersion,
          waitUntil: leaseExpiresAt
        });
        if (waited.status === "orphaned_dispatched_refresh") {
          await this.#revokeUncertainRefresh(current);
        }
        if (waited.status === "completed") {
          current = this.#loadedFromEntry(current.sessionKey, waited.entry, current.now);
          if (!this.#needsRefresh(current)) return current;
        }
        continue;
      }

      let refreshed: RefreshedWebSessionTokenSet;
      try {
        refreshed = await refresher.refresh({
          refreshToken: current.record.refreshToken,
          subject: current.record.subject,
          issuer: current.record.issuer,
          authorizedParty: current.record.authorizedParty
        });
        validateTokenSet(refreshed, current.now);
        if (
          refreshed.subject !== current.record.subject ||
          refreshed.issuer !== current.record.issuer ||
          refreshed.issuer !== this.#policy.expectedIssuer ||
          refreshed.authorizedParty !== current.record.authorizedParty ||
          (current.record.keycloakSessionId &&
            refreshed.keycloakSessionId !== current.record.keycloakSessionId)
        ) {
          throw new WebSessionError(
            "refresh_rejected",
            "Refreshed token identity does not match session."
          );
        }
      } catch (error) {
        if (
          error instanceof WebSessionRefreshProviderError &&
          error.failure.classification === "confirmed_replay"
        ) {
          await this.#revokeLoaded(current, "refresh_replay", "auth.refresh.replay_detected");
          throw new WebSessionError(
            "refresh_replay",
            "Identity provider detected refresh-token replay; the session family was revoked."
          );
        }
        if (
          error instanceof WebSessionRefreshProviderError &&
          error.failure.classification === "confirmed_rejection"
        ) {
          await this.#revokeLoaded(current, "refresh_rejected", null);
          throw new WebSessionError(
            "refresh_rejected",
            "Identity provider confirmed that session refresh was rejected."
          );
        }
        return this.#revokeUncertainRefresh(current);
      }

      let nextRecord: StoredWebSessionRecord;
      let nextEnvelope: WebSessionEnvelope;
      let completed: boolean;
      try {
        nextRecord = {
          ...current.record,
          recordVersion: current.record.recordVersion + 1,
          accessToken: refreshed.accessToken,
          refreshToken: refreshed.refreshToken,
          idToken: refreshed.idToken ?? current.record.idToken,
          accessExpiresAt: refreshed.accessExpiresAt.toISOString(),
          refreshExpiresAt: refreshed.refreshExpiresAt.toISOString(),
          amr: normalizeAmr(refreshed.amr),
          acr: normalizeAcr(refreshed.acr)
        };
        nextEnvelope = encryptRecord(
          nextRecord,
          current.sessionKey,
          this.#policy,
          this.#randomBytes
        );
        completed = await this.#store.completeRefresh({
          sessionKey: current.sessionKey,
          expectedRecordVersion: current.record.recordVersion,
          leaseId,
          envelope: nextEnvelope,
          lastSeenAt: current.now,
          expiresAt: new Date(nextRecord.absoluteExpiresAt)
        });
      } catch {
        return this.#revokeUncertainRefresh(current);
      }
      if (!completed) {
        await this.#revokeUncertainRefresh(current);
      }
      return {
        ...current,
        envelope: nextEnvelope,
        record: nextRecord,
        lastSeenAt: current.now
      };
    }
    throw new WebSessionError(
      "refresh_recovery_required",
      "Session refresh did not reach a durable terminal state."
    );
  }

  async #reloadAfterRefresh(loaded: LoadedSession): Promise<LoadedSession> {
    const entry = await this.#store.read(loaded.sessionKey, loaded.now);
    if (!entry) throw new WebSessionError("invalid_session", "Session is unavailable.");
    return this.#loadedFromEntry(loaded.sessionKey, entry, loaded.now);
  }

  #loadedFromEntry(sessionKey: string, entry: WebSessionStoredEntry, now: Date): LoadedSession {
    const record = decryptRecord(entry.envelope, sessionKey, this.#policy);
    validateStoredRecord(record, entry.envelope, this.#policy);
    const lastSeenAt = trustedInstant(new Date(entry.lastSeenAt), "session activity time");
    return { sessionKey, envelope: entry.envelope, record, now, lastSeenAt };
  }

  #needsRefresh(loaded: LoadedSession): boolean {
    return (
      new Date(loaded.record.accessExpiresAt).getTime() - loaded.now.getTime() <=
      this.#policy.refreshLeewaySeconds * 1000
    );
  }

  async #revokeLoaded(
    loaded: LoadedSession,
    reason: WebSessionRevocationReason,
    refreshAuditAction: "auth.refresh.replay_detected" | "auth.refresh.recovery_uncertain" | null
  ): Promise<void> {
    const sessionRevoked = this.#sessionAudit(
      loaded.record,
      loaded.envelope.familyKey,
      "auth.session.revoked",
      reason,
      loaded.now
    );
    const requiredAudits: readonly [RequiredSecurityAuditIntent, ...RequiredSecurityAuditIntent[]] =
      refreshAuditAction
        ? [
            this.#sessionAudit(
              loaded.record,
              loaded.envelope.familyKey,
              refreshAuditAction,
              reason,
              loaded.now
            ),
            sessionRevoked
          ]
        : [sessionRevoked];
    await this.#store.revokeSessionFamily({
      sessionKey: loaded.sessionKey,
      familyKey: loaded.envelope.familyKey,
      reason,
      revokedAt: loaded.now,
      expiresAt: new Date(loaded.record.absoluteExpiresAt),
      requiredAudits
    });
  }

  async #revokeUncertainRefresh(loaded: LoadedSession): Promise<never> {
    await this.#revokeLoaded(
      loaded,
      "refresh_recovery_uncertain",
      "auth.refresh.recovery_uncertain"
    );
    throw new WebSessionError(
      "refresh_recovery_required",
      "A dispatched refresh did not commit durably; the session family was revoked."
    );
  }

  #sessionAudit(
    record: StoredWebSessionRecord,
    familyKey: string,
    action:
      | "auth.session.created"
      | "auth.session.rotated"
      | "auth.session.revoked"
      | "auth.refresh.replay_detected"
      | "auth.refresh.recovery_uncertain",
    reasonCode: string,
    occurredAt: Date
  ): RequiredSecurityAuditIntent {
    return validateRequiredSecurityAuditIntent({
      schemaVersion: 1,
      action,
      occurredAt: occurredAt.toISOString(),
      deduplicationKey: `${action}:${familyKey}:${record.recordVersion}:${reasonCode}`,
      subject: record.subject,
      issuer: record.issuer,
      authorizedParty: record.authorizedParty,
      reasonCode
    });
  }

  #createdSession(
    sessionId: string,
    record: StoredWebSessionRecord,
    now: Date,
    lastSeenAt: Date
  ): CreatedWebSession {
    return {
      cookie: serializeCookie(sessionId, this.#policy, this.#policy.absoluteTtlSeconds),
      csrfToken: this.#csrfToken(sessionId),
      safeSession: this.#safeSession(sessionId, record, now, lastSeenAt)
    };
  }

  #safeSession(
    sessionId: string,
    record: StoredWebSessionRecord,
    now: Date,
    lastSeenAt: Date
  ): SafeWebSession {
    const rotatedAt = new Date(record.rotatedAt);
    return {
      subject: record.subject,
      issuer: record.issuer,
      authorizedParty: record.authorizedParty,
      keycloakSessionId: record.keycloakSessionId,
      createdAt: record.createdAt,
      lastSeenAt: lastSeenAt.toISOString(),
      absoluteExpiresAt: record.absoluteExpiresAt,
      authorityRevision: record.authorityRevision,
      amr: record.amr,
      acr: record.acr,
      mfaAssurancePolicyId: this.#policy.mfaAssurancePolicy.policyId,
      mfaVerified: hasMfaEvidence(
        { amr: record.amr, acr: record.acr },
        this.#policy.mfaAssurancePolicy
      ),
      csrfToken: this.#csrfToken(sessionId),
      shouldRotate: rotatedAt.getTime() + this.#policy.rotateAfterSeconds * 1000 <= now.getTime()
    };
  }

  #sessionKey(sessionId: string): string {
    assertOpaqueId(sessionId, "session id");
    return createHmac("sha256", this.#policy.lookupHmacKey)
      .update(`web-session\u0000${sessionId}`)
      .digest("hex");
  }

  #csrfToken(sessionId: string): string {
    assertOpaqueId(sessionId, "session id");
    return createHmac("sha256", this.#policy.csrfHmacKey)
      .update(`csrf\u0000${sessionId}`)
      .digest("base64url");
  }
}

interface LoadedSession {
  sessionKey: string;
  envelope: WebSessionEnvelope;
  record: StoredWebSessionRecord;
  now: Date;
  lastSeenAt: Date;
}

interface NormalizedWebSessionPolicy extends Omit<
  WebSessionPolicy,
  "lookupHmacKey" | "csrfHmacKey" | "encryptionKeys"
> {
  lookupHmacKey: Buffer;
  csrfHmacKey: Buffer;
  encryptionKeys: readonly NormalizedSessionEncryptionKey[];
}

interface NormalizedSessionEncryptionKey {
  id: string;
  key: Buffer;
}

function normalizePolicy(policy: WebSessionPolicy): NormalizedWebSessionPolicy {
  let expectedIssuer: string;
  let mfaAssurancePolicy: MfaAssurancePolicy;
  try {
    expectedIssuer = normalizeCanonicalKeycloakIssuer(policy.expectedIssuer, policy.productionLike);
    mfaAssurancePolicy = normalizeMfaAssurancePolicy(policy.mfaAssurancePolicy);
  } catch (error) {
    throw new WebSessionError(
      "invalid_configuration",
      error instanceof Error ? error.message : "Session identity policy is invalid."
    );
  }
  if (!COOKIE_NAME_PATTERN.test(policy.cookieName)) {
    throw new WebSessionError("invalid_configuration", "Session cookie name is invalid.");
  }
  if (policy.productionLike) {
    if (!policy.secureCookie || !policy.cookieName.startsWith("__Host-")) {
      throw new WebSessionError(
        "invalid_configuration",
        "Production sessions require a Secure __Host- cookie."
      );
    }
  } else if (policy.cookieName.startsWith("__Host-") && !policy.secureCookie) {
    throw new WebSessionError(
      "invalid_configuration",
      "__Host- cookies cannot be emitted without Secure."
    );
  }
  assertPolicySeconds(policy.idleTtlSeconds, 300, 1800, "idle TTL");
  assertPolicySeconds(policy.absoluteTtlSeconds, 900, 43_200, "absolute TTL");
  assertPolicySeconds(policy.rotateAfterSeconds, 300, 1800, "rotation interval");
  assertPolicySeconds(policy.refreshLeewaySeconds, 15, 120, "refresh leeway");
  assertPolicySeconds(policy.refreshLeaseSeconds, 5, 30, "refresh lease");
  if (policy.idleTtlSeconds >= policy.absoluteTtlSeconds) {
    throw new WebSessionError(
      "invalid_configuration",
      "Session idle TTL must be below absolute TTL."
    );
  }
  const encryptionKeys = policy.encryptionKeys.map((entry) => {
    if (!KEY_ID_PATTERN.test(entry.id)) {
      throw new WebSessionError("invalid_configuration", "Session encryption key id is invalid.");
    }
    const key = Buffer.from(entry.key);
    if (key.byteLength !== 32) {
      throw new WebSessionError(
        "invalid_configuration",
        "AES-256-GCM session keys must contain exactly 32 bytes."
      );
    }
    return { id: entry.id, key };
  });
  if (new Set(encryptionKeys.map((entry) => entry.id)).size !== encryptionKeys.length) {
    throw new WebSessionError(
      "invalid_configuration",
      "Session encryption key ids must be unique."
    );
  }
  return {
    ...policy,
    expectedIssuer,
    mfaAssurancePolicy,
    lookupHmacKey: copyHmacKey(policy.lookupHmacKey, "session lookup HMAC key"),
    csrfHmacKey: copyHmacKey(policy.csrfHmacKey, "CSRF HMAC key"),
    encryptionKeys
  };
}

function encryptRecord(
  record: StoredWebSessionRecord,
  sessionKey: string,
  policy: NormalizedWebSessionPolicy,
  randomBytesImpl: (size: number) => Buffer
): WebSessionEnvelope {
  const currentKey = policy.encryptionKeys[0];
  if (!currentKey) throw new Error("Current session encryption key is unavailable.");
  const iv = randomBytesImpl(12);
  if (iv.byteLength !== 12) throw new Error("Session IV generator returned an invalid length.");
  const familyKey = createHmac("sha256", policy.lookupHmacKey)
    .update(`session-family\u0000${record.familyId}`)
    .digest("hex");
  const aad = Buffer.from(
    `clinic-os:web-session:v1:${sessionKey}:${currentKey.id}:${familyKey}`,
    "utf8"
  );
  const cipher = createCipheriv("aes-256-gcm", currentKey.key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(record), "utf8"), cipher.final()]);
  return {
    schemaVersion: 2,
    recordVersion: record.recordVersion,
    familyKey,
    keyId: currentKey.id,
    iv: iv.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    expiresAt: record.absoluteExpiresAt
  };
}

function decryptRecord(
  envelope: WebSessionEnvelope,
  sessionKey: string,
  policy: NormalizedWebSessionPolicy
): StoredWebSessionRecord {
  if (envelope.schemaVersion !== 2 || !KEY_ID_PATTERN.test(envelope.keyId)) {
    throw new WebSessionError("invalid_session", "Session envelope version or key is invalid.");
  }
  const key = policy.encryptionKeys.find((candidate) => candidate.id === envelope.keyId);
  if (!key) throw new WebSessionError("invalid_session", "Session encryption key is unavailable.");
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key.key,
      Buffer.from(envelope.iv, "base64url")
    );
    decipher.setAAD(
      Buffer.from(
        `clinic-os:web-session:v1:${sessionKey}:${envelope.keyId}:${envelope.familyKey}`,
        "utf8"
      )
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
      decipher.final()
    ]);
    return JSON.parse(plaintext.toString("utf8")) as StoredWebSessionRecord;
  } catch {
    throw new WebSessionError("invalid_session", "Session record authentication failed.");
  }
}

function validateStoredRecord(
  record: StoredWebSessionRecord,
  envelope: WebSessionEnvelope,
  policy: NormalizedWebSessionPolicy
): void {
  const expectedFamilyKey = createHmac("sha256", policy.lookupHmacKey)
    .update(`session-family\u0000${record.familyId}`)
    .digest("hex");
  if (
    record.schemaVersion !== 2 ||
    !Number.isSafeInteger(record.recordVersion) ||
    record.recordVersion < 1 ||
    record.recordVersion !== envelope.recordVersion ||
    record.absoluteExpiresAt !== envelope.expiresAt ||
    !secureEqual(expectedFamilyKey, envelope.familyKey)
  ) {
    throw new WebSessionError("invalid_session", "Session record version is invalid.");
  }
  validateIdentity(
    record.subject,
    record.issuer,
    record.authorizedParty,
    record.authorityRevision,
    policy.expectedIssuer
  );
  assertOpaqueId(record.familyId, "session family id");
  for (const value of [
    record.createdAt,
    record.rotatedAt,
    record.absoluteExpiresAt,
    record.accessExpiresAt,
    record.refreshExpiresAt
  ]) {
    if (Number.isNaN(new Date(value).getTime())) {
      throw new WebSessionError("invalid_session", "Session timestamps are invalid.");
    }
  }
  if (
    new Date(record.absoluteExpiresAt).getTime() - new Date(record.createdAt).getTime() >
    policy.absoluteTtlSeconds * 1000
  ) {
    throw new WebSessionError("invalid_session", "Session exceeds the configured absolute TTL.");
  }
  if (!TOKEN_PATTERN.test(record.accessToken) || !TOKEN_PATTERN.test(record.refreshToken)) {
    throw new WebSessionError("invalid_session", "Session token material is malformed.");
  }
  normalizeAmr(record.amr);
  normalizeAcr(record.acr);
}

function validateTokenSet(tokens: WebSessionTokenSet, now: Date): void {
  if (!TOKEN_PATTERN.test(tokens.accessToken) || !TOKEN_PATTERN.test(tokens.refreshToken)) {
    throw new WebSessionError("invalid_session", "OIDC token response is malformed.");
  }
  const accessExpiresAt = trustedInstant(tokens.accessExpiresAt, "access token expiry");
  const refreshExpiresAt = trustedInstant(tokens.refreshExpiresAt, "refresh token expiry");
  if (
    accessExpiresAt.getTime() <= now.getTime() ||
    refreshExpiresAt.getTime() <= accessExpiresAt.getTime()
  ) {
    throw new WebSessionError("invalid_session", "OIDC token lifetimes are invalid.");
  }
}

function validateIdentity(
  subject: string,
  issuer: string,
  authorizedParty: string,
  authorityRevision: string,
  expectedIssuer: string
): void {
  if (!subject || Buffer.byteLength(subject) > 255 || /[\u0000\r\n]/.test(subject)) {
    throw new WebSessionError("invalid_session", "Session subject is invalid.");
  }
  if (issuer !== expectedIssuer) {
    throw new WebSessionError("invalid_session", "Session issuer does not match configuration.");
  }
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(authorizedParty)) {
    throw new WebSessionError("invalid_session", "Session authorized party is invalid.");
  }
  if (!AUTHORITY_REVISION_PATTERN.test(authorityRevision)) {
    throw new WebSessionError("invalid_session", "Session authority revision is invalid.");
  }
}

function serializeCookie(
  value: string,
  policy: NormalizedWebSessionPolicy,
  maxAgeSeconds: number
): string {
  assertOpaqueId(value, "session cookie value");
  const parts = [
    `${policy.cookieName}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
    "Priority=High"
  ];
  if (policy.secureCookie) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(policy: NormalizedWebSessionPolicy): string {
  const parts = [
    `${policy.cookieName}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Priority=High"
  ];
  if (policy.secureCookie) parts.push("Secure");
  return parts.join("; ");
}

function randomOpaqueId(impl: (size: number) => Buffer): string {
  const value = impl(32).toString("base64url");
  assertOpaqueId(value, "generated opaque id");
  return value;
}

function assertOpaqueId(value: string, label: string): void {
  if (!OPAQUE_ID_PATTERN.test(value)) {
    throw new WebSessionError("invalid_session", `${label} is malformed.`);
  }
}

function normalizeAmr(values: readonly string[]): string[] {
  const normalized = [
    ...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))
  ];
  if (normalized.some((value) => !/^[a-z0-9._:-]{1,64}$/.test(value))) {
    throw new WebSessionError("invalid_session", "Session authentication methods are invalid.");
  }
  return normalized.sort();
}

function normalizeAcr(value: string | null): string | null {
  if (value === null) return null;
  if (!/^[\x21-\x7E]{1,255}$/.test(value) || value.trim() !== value) {
    throw new WebSessionError("invalid_session", "Session authentication context is invalid.");
  }
  return value;
}

function assertPolicySeconds(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new WebSessionError(
      "invalid_configuration",
      `Session ${label} must be between ${minimum} and ${maximum} seconds.`
    );
  }
}

function copyHmacKey(value: Uint8Array, label: string): Buffer {
  const key = Buffer.from(value);
  if (key.byteLength < 32) {
    throw new WebSessionError("invalid_configuration", `${label} must contain at least 32 bytes.`);
  }
  return key;
}

function trustedInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid injected instant.`);
  }
  return new Date(value.getTime());
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
