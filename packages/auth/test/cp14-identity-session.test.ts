import assert from "node:assert/strict";
import test from "node:test";
import {
  MobileTokenManager,
  OAuthFlowError,
  OAuthTransactionManager,
  WebSessionError,
  WebSessionManager,
  assertActiveBreakGlassGrant,
  assertMfaForAccess,
  buildJmlControlPlan,
  principalFromProductionKeycloakClaims,
  type MobileTokenVault,
  type OAuthTransactionRecord,
  type OAuthTransactionStore,
  type StoredMobileTokenSet,
  type WebSessionEnvelope,
  type WebSessionRevocationReason,
  type WebSessionStore
} from "../src/index.ts";

const now = new Date("2026-07-10T12:00:00.000Z");

test("Authorization Code + PKCE transactions are S256, bounded, same-origin, and single-use", async () => {
  const store = new TestOAuthStore();
  const manager = new OAuthTransactionManager({
    store,
    stateHmacKey: Buffer.alloc(32, 1)
  });
  const begun = await manager.begin({
    channel: "web_bff",
    clientId: "clinic-os-web-bff",
    authorizationEndpoint:
      "https://identity.clinicos.example/realms/clinic-os/protocol/openid-connect/auth",
    redirectUri: "https://app.clinicos.example/auth/callback",
    returnTo: "/clinic/day?view=queue",
    productionLike: true,
    now
  });
  const authorization = new URL(begun.authorizationUrl);
  assert.equal(authorization.searchParams.get("response_type"), "code");
  assert.equal(authorization.searchParams.get("response_mode"), "query");
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorization.searchParams.has("code_verifier"), false);
  assert.equal(authorization.searchParams.get("scope")?.includes("offline_access"), false);

  const completed = await manager.complete({
    callbackUrl: `https://app.clinicos.example/auth/callback?code=${"c".repeat(43)}&state=${begun.state}`,
    cookieState: begun.state,
    expectedChannel: "web_bff",
    now: new Date(now.getTime() + 30_000)
  });
  assert.equal(completed.returnTo, "/clinic/day?view=queue");
  assert.equal(completed.codeVerifier.length >= 43, true);

  await assert.rejects(
    manager.complete({
      callbackUrl: `https://app.clinicos.example/auth/callback?code=${"c".repeat(43)}&state=${begun.state}`,
      cookieState: begun.state,
      expectedChannel: "web_bff",
      now: new Date(now.getTime() + 31_000)
    }),
    (error) => error instanceof OAuthFlowError && error.code === "replayed_transaction"
  );
});

test("OAuth callbacks reject state mismatch, tokens in URLs, fragments, and open redirects", async () => {
  const manager = new OAuthTransactionManager({
    store: new TestOAuthStore(),
    stateHmacKey: Buffer.alloc(32, 2)
  });
  await assert.rejects(
    manager.begin({
      channel: "web_bff",
      clientId: "clinic-os-web-bff",
      authorizationEndpoint: "https://identity.example/auth",
      redirectUri: "https://app.example/callback",
      returnTo: "//attacker.example/phish",
      productionLike: true,
      now
    }),
    /same-origin/
  );
  const begun = await manager.begin({
    channel: "mobile",
    clientId: "clinic-os-mobile",
    authorizationEndpoint: "https://identity.example/auth",
    redirectUri: "clinic-os://auth/callback",
    productionLike: true,
    now
  });
  await assert.rejects(
    manager.complete({
      callbackUrl: `clinic-os://auth/callback?code=${"c".repeat(43)}&state=${begun.state}&access_token=leak`,
      cookieState: begun.state,
      expectedChannel: "mobile",
      now
    }),
    /never accepted/
  );
  await assert.rejects(
    manager.complete({
      callbackUrl: `clinic-os://auth/callback?code=${"c".repeat(43)}&state=${begun.state}#token=leak`,
      cookieState: begun.state,
      expectedChannel: "mobile",
      now
    }),
    /fragments/
  );
  await assert.rejects(
    manager.complete({
      callbackUrl: `clinic-os://attacker/callback?code=${"c".repeat(43)}&state=${begun.state}`,
      cookieState: begun.state,
      expectedChannel: "mobile",
      now
    }),
    /target does not match/
  );
});

test("production token validation requires issuer, audience, authorized party, expiry, and bounded lifetime", () => {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const claims = {
    sub: "keycloak-subject-0001",
    iss: "https://identity.example/realms/clinic-os",
    aud: ["clinic-os-api"],
    azp: "clinic-os-mobile",
    exp: issuedAt + 300,
    iat: issuedAt,
    nbf: issuedAt,
    typ: "Bearer",
    jti: "token-id-00000001",
    sid: "session-id-000001",
    auth_time: issuedAt,
    amr: ["pwd", "otp"],
    acr: "urn:clinicos:aal2"
  };
  const principal = principalFromProductionKeycloakClaims(claims, {
    expectedIssuer: claims.iss,
    requiredAudience: "clinic-os-api",
    acceptedAuthorizedParties: ["clinic-os-web-bff", "clinic-os-mobile"],
    now
  });
  assert.equal(principal.authorizedParty, "clinic-os-mobile");
  assert.deepEqual(principal.amr, ["otp", "pwd"]);

  assert.throws(
    () =>
      principalFromProductionKeycloakClaims(
        { ...claims, azp: "attacker-client" },
        {
          expectedIssuer: claims.iss,
          requiredAudience: "clinic-os-api",
          acceptedAuthorizedParties: ["clinic-os-mobile"],
          now
        }
      ),
    /authorized party/
  );
  assert.throws(
    () =>
      principalFromProductionKeycloakClaims(
        { ...claims, exp: issuedAt - 31 },
        {
          expectedIssuer: claims.iss,
          requiredAudience: "clinic-os-api",
          acceptedAuthorizedParties: ["clinic-os-mobile"],
          now
        }
      ),
    /expired/
  );
  assert.throws(
    () =>
      principalFromProductionKeycloakClaims(
        { ...claims, exp: issuedAt + 601 },
        {
          expectedIssuer: claims.iss,
          requiredAudience: "clinic-os-api",
          acceptedAuthorizedParties: ["clinic-os-mobile"],
          now
        }
      ),
    /lifetime/
  );
});

test("web sessions use encrypted opaque cookies, rotate fixation identifiers, and reject old cookies", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const created = await manager.createAuthenticatedSession({
    subject: "keycloak-subject-0001",
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-web-bff",
    keycloakSessionId: "keycloak-session-001",
    authorityRevision: "authority-revision-1",
    amr: ["pwd", "otp"],
    tokens: tokenSet(now),
    now
  });
  assert.match(created.cookie, /^clinicos_cp14_session=/);
  assert.match(created.cookie, /HttpOnly/);
  assert.match(created.cookie, /SameSite=Lax/);
  assert.equal(created.cookie.includes("access-token"), false);
  const previousId = manager.parseSessionId(created.cookie);
  assert.ok(previousId);
  assert.equal(
    store.rawEnvelopes().some((value) => value.includes("refresh-token")),
    false
  );

  const authorityResolver = activeAuthority("authority-revision-1");
  const rotated = await manager.rotate(
    previousId,
    authorityResolver,
    new Date(now.getTime() + 601_000)
  );
  const nextId = manager.parseSessionId(rotated.cookie);
  assert.ok(nextId);
  assert.notEqual(nextId, previousId);
  await assert.rejects(
    manager.inspect(previousId, authorityResolver, new Date(now.getTime() + 602_000)),
    (error) => error instanceof WebSessionError && error.code === "invalid_session"
  );
  const active = await manager.inspect(
    nextId,
    authorityResolver,
    new Date(now.getTime() + 602_000)
  );
  assert.equal(active.authorityRevision, "authority-revision-1");
  assert.equal(manager.verifyCsrfToken(nextId, active.csrfToken), true);
  assert.equal(manager.verifyCsrfToken(nextId, "x".repeat(43)), false);
});

test("web sessions fail closed for revoked memberships and stale authority revisions", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const created = await manager.createAuthenticatedSession({
    subject: "keycloak-subject-0002",
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-web-bff",
    authorityRevision: "authority-revision-1",
    tokens: tokenSet(now),
    now
  });
  const sessionId = manager.parseSessionId(created.cookie)!;
  await assert.rejects(
    manager.inspect(
      sessionId,
      activeAuthority("authority-revision-2"),
      new Date(now.getTime() + 1_000)
    ),
    (error) => error instanceof WebSessionError && error.code === "authority_changed"
  );

  const second = await manager.createAuthenticatedSession({
    subject: "keycloak-subject-0003",
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-web-bff",
    authorityRevision: "authority-revision-1",
    tokens: tokenSet(now),
    now
  });
  await assert.rejects(
    manager.inspect(
      manager.parseSessionId(second.cookie)!,
      { resolve: async () => ({ active: false, authorityRevision: "authority-revision-1" }) },
      new Date(now.getTime() + 1_000)
    ),
    /inactive/
  );
});

test("concurrent refresh is treated as replay and revokes the web session family", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const created = await manager.createAuthenticatedSession({
    subject: "keycloak-subject-0004",
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-web-bff",
    authorityRevision: "authority-revision-1",
    tokens: {
      ...tokenSet(now),
      accessExpiresAt: new Date(now.getTime() + 30_000)
    },
    now
  });
  const sessionId = manager.parseSessionId(created.cookie)!;
  store.failCompareAndSwapAtCall = 2;
  await assert.rejects(
    manager.withAccessToken({
      sessionId,
      authorityResolver: activeAuthority("authority-revision-1"),
      tokenRefresher: {
        refresh: async () => ({
          subject: "keycloak-subject-0004",
          issuer: "https://identity.example/realms/clinic-os",
          authorizedParty: "clinic-os-web-bff",
          ...tokenSet(new Date(now.getTime() + 1_000))
        })
      },
      now: new Date(now.getTime() + 1_000),
      execute: async () => "should-not-run"
    }),
    (error) => error instanceof WebSessionError && error.code === "refresh_replay"
  );
});

test("mobile tokens require device-only secure storage and purge on refresh replay", async () => {
  const vault = new TestMobileVault();
  const manager = new MobileTokenManager({
    vault,
    versionFactory: sequence("vault-version"),
    expectedIssuer: "https://identity.example/realms/clinic-os",
    acceptedAuthorizedParties: ["clinic-os-mobile"]
  });
  await manager.establish({
    response: mobileResponse(60),
    subject: "keycloak-subject-mobile",
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-mobile",
    now
  });
  vault.failCompareAndSwap = true;
  await assert.rejects(
    manager.withAccessToken({
      now: new Date(now.getTime() + 1_000),
      refresher: {
        refresh: async () => ({
          response: mobileResponse(300),
          subject: "keycloak-subject-mobile",
          issuer: "https://identity.example/realms/clinic-os",
          authorizedParty: "clinic-os-mobile"
        })
      },
      execute: async () => "should-not-run"
    }),
    /Concurrent mobile refresh/
  );
  assert.equal(await vault.read(), null);

  assert.throws(
    () =>
      new MobileTokenManager({
        vault: {
          ...vault,
          backupPolicy: "excluded",
          kind: "web_storage"
        } as unknown as MobileTokenVault,
        versionFactory: () => "version-1",
        expectedIssuer: "https://identity.example/realms/clinic-os",
        acceptedAuthorizedParties: ["clinic-os-mobile"]
      }),
    /OS secure storage/
  );
});

test("mobile logout purges locally before requiring upstream refresh-token revocation", async () => {
  const vault = new TestMobileVault();
  const manager = new MobileTokenManager({
    vault,
    versionFactory: sequence("logout-version"),
    expectedIssuer: "https://identity.example/realms/clinic-os",
    acceptedAuthorizedParties: ["clinic-os-mobile"]
  });
  await manager.establish({
    response: mobileResponse(300),
    subject: "keycloak-subject-mobile",
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-mobile",
    now
  });
  let revocations = 0;
  await manager.logout({
    revoke: async (input) => {
      assert.equal(input.authorizedParty, "clinic-os-mobile");
      revocations += 1;
    }
  });
  assert.equal(revocations, 1);
  assert.equal(await vault.read(), null);

  await manager.establish({
    response: mobileResponse(300),
    subject: "keycloak-subject-mobile",
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-mobile",
    now
  });
  await assert.rejects(
    manager.logout({ revoke: async () => Promise.reject(new Error("provider unavailable")) }),
    /revocation was not confirmed/
  );
  assert.equal(await vault.read(), null);
});

test("MFA, JML, and break-glass controls fail closed and revoke before privilege changes", () => {
  assert.throws(
    () => assertMfaForAccess({ roleSlugs: ["platform_admin"], amr: ["pwd"] }),
    /Multi-factor/
  );
  assert.doesNotThrow(() =>
    assertMfaForAccess({ roleSlugs: ["owner_admin"], amr: ["pwd", "webauthn"] })
  );
  const mover = buildJmlControlPlan({
    commandId: "jml-command-0001",
    transition: "mover",
    subject: "keycloak-subject-0001",
    tenantId: "tenant-00000001",
    requestedBy: "requester-000001",
    approvedBy: "approver-000001",
    ticketId: "SEC-1001",
    requestedRoles: ["platform_admin"]
  });
  assert.equal(mover.steps[0], "lock_application_access");
  assert.ok(
    mover.steps.indexOf("revoke_application_session_families") <
      mover.steps.indexOf("set_product_roles")
  );
  assert.ok(mover.steps.includes("require_privileged_mfa"));

  assert.throws(
    () =>
      assertActiveBreakGlassGrant(
        {
          grantId: "grant-00000001",
          tenantId: "tenant-00000001",
          clinicId: "clinic-00000001",
          patientId: "patient-0000001",
          requesterUserId: "user-000000001",
          approverUserId: "user-000000001",
          reasonCode: "patient_safety",
          ticketId: "INC-1001",
          grantedAt: now,
          expiresAt: new Date(now.getTime() + 10 * 60_000),
          allowedCapabilities: ["patient.phi.read"]
        },
        {
          actorUserId: "user-000000001",
          tenantId: "tenant-00000001",
          clinicId: "clinic-00000001",
          patientId: "patient-0000001",
          requiredCapability: "patient.phi.read",
          now,
          amr: ["pwd", "otp"]
        }
      ),
    /independent approval/
  );

  const scopedGrant = {
    grantId: "grant-00000002",
    tenantId: "tenant-00000001",
    clinicId: "clinic-00000001",
    patientId: "patient-0000001",
    requesterUserId: "user-000000001",
    approverUserId: "user-000000002",
    reasonCode: "clinical_emergency" as const,
    ticketId: "INC-1002",
    grantedAt: now,
    expiresAt: new Date(now.getTime() + 10 * 60_000),
    allowedCapabilities: ["patient.phi.read"]
  };
  const scopedInput = {
    actorUserId: "user-000000001",
    tenantId: "tenant-00000001",
    clinicId: "clinic-00000001",
    patientId: "patient-0000001",
    requiredCapability: "patient.phi.read",
    now,
    amr: ["pwd", "webauthn"]
  };
  assert.doesNotThrow(() => assertActiveBreakGlassGrant(scopedGrant, scopedInput));
  assert.throws(
    () =>
      assertActiveBreakGlassGrant(scopedGrant, {
        ...scopedInput,
        patientId: "patient-0000002"
      }),
    /tenant, clinic, and patient scope/
  );
});

class TestOAuthStore implements OAuthTransactionStore {
  readonly atomicity = "create_if_absent_and_consume_once" as const;
  readonly #records = new Map<string, OAuthTransactionRecord>();

  async create(key: string, record: OAuthTransactionRecord): Promise<boolean> {
    if (this.#records.has(key)) return false;
    this.#records.set(key, structuredClone(record));
    return true;
  }

  async consume(key: string): Promise<OAuthTransactionRecord | null> {
    const record = this.#records.get(key) ?? null;
    this.#records.delete(key);
    return record;
  }
}

class TestWebSessionStore implements WebSessionStore {
  readonly atomicity = "required" as const;
  readonly #sessions = new Map<string, WebSessionEnvelope>();
  readonly #revoked = new Set<string>();
  compareAndSwapCalls = 0;
  failCompareAndSwapAtCall: number | null = null;

  async create(key: string, envelope: WebSessionEnvelope): Promise<boolean> {
    if (this.#sessions.has(key)) return false;
    this.#sessions.set(key, structuredClone(envelope));
    return true;
  }

  async read(key: string): Promise<WebSessionEnvelope | null> {
    return structuredClone(this.#sessions.get(key) ?? null);
  }

  async compareAndSwap(
    key: string,
    expected: number,
    envelope: WebSessionEnvelope
  ): Promise<boolean> {
    this.compareAndSwapCalls += 1;
    if (this.failCompareAndSwapAtCall === this.compareAndSwapCalls) return false;
    const current = this.#sessions.get(key);
    if (!current || current.recordVersion !== expected) return false;
    this.#sessions.set(key, structuredClone(envelope));
    return true;
  }

  async rotate(
    previousKey: string,
    nextKey: string,
    expected: number,
    envelope: WebSessionEnvelope
  ): Promise<boolean> {
    const current = this.#sessions.get(previousKey);
    if (!current || current.recordVersion !== expected || this.#sessions.has(nextKey)) return false;
    this.#sessions.delete(previousKey);
    this.#sessions.set(nextKey, structuredClone(envelope));
    return true;
  }

  async delete(key: string): Promise<void> {
    this.#sessions.delete(key);
  }

  async revokeFamily(familyKey: string, _reason: WebSessionRevocationReason): Promise<void> {
    this.#revoked.add(familyKey);
  }

  async isFamilyRevoked(familyKey: string): Promise<boolean> {
    return this.#revoked.has(familyKey);
  }

  rawEnvelopes(): string[] {
    return [...this.#sessions.values()].map((value) => JSON.stringify(value));
  }
}

class TestMobileVault implements MobileTokenVault {
  readonly kind = "os_secure_storage" as const;
  readonly accessibility = "when_unlocked_this_device_only" as const;
  readonly backupPolicy = "excluded" as const;
  value: StoredMobileTokenSet | null = null;
  failCompareAndSwap = false;

  async read(): Promise<StoredMobileTokenSet | null> {
    return structuredClone(this.value);
  }

  async create(tokens: StoredMobileTokenSet): Promise<boolean> {
    if (this.value) return false;
    this.value = structuredClone(tokens);
    return true;
  }

  async compareAndSwap(expected: string, tokens: StoredMobileTokenSet): Promise<boolean> {
    if (this.failCompareAndSwap || this.value?.version !== expected) return false;
    this.value = structuredClone(tokens);
    return true;
  }

  async purge(): Promise<void> {
    this.value = null;
  }
}

function createWebSessionManager(store: WebSessionStore): WebSessionManager {
  return new WebSessionManager({
    store,
    policy: {
      productionLike: false,
      cookieName: "clinicos_cp14_session",
      secureCookie: false,
      idleTtlSeconds: 900,
      absoluteTtlSeconds: 3600,
      rotateAfterSeconds: 600,
      refreshLeewaySeconds: 60,
      lookupHmacKey: Buffer.alloc(32, 3),
      csrfHmacKey: Buffer.alloc(32, 4),
      encryptionKeys: [{ id: "key-2026-07", key: Buffer.alloc(32, 5) }]
    }
  });
}

function tokenSet(at: Date) {
  return {
    accessToken: `access-token-${"a".repeat(32)}`,
    refreshToken: `refresh-token-${"r".repeat(32)}`,
    idToken: `identity-token-${"i".repeat(32)}`,
    accessExpiresAt: new Date(at.getTime() + 300_000),
    refreshExpiresAt: new Date(at.getTime() + 3_600_000)
  };
}

function mobileResponse(accessSeconds: number) {
  return {
    access_token: `mobile-access-${"a".repeat(32)}`,
    refresh_token: `mobile-refresh-${"r".repeat(32)}`,
    token_type: "Bearer",
    expires_in: accessSeconds,
    refresh_expires_in: 3600
  };
}

function activeAuthority(authorityRevision: string) {
  return {
    resolve: async () => ({ active: true, authorityRevision })
  };
}

function sequence(prefix: string): () => string {
  let value = 0;
  return () => `${prefix}-${++value}`;
}
