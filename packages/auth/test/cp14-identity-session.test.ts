import assert from "node:assert/strict";
import test from "node:test";
import {
  MobileTokenManager,
  OAuthFlowError,
  OAuthTransactionManager,
  WebSessionError,
  WebSessionManager,
  WebSessionRefreshProviderError,
  assertActiveBreakGlassGrant,
  assertMfaForAccess,
  buildJmlControlPlan,
  executeJmlControlPlan,
  hasMfaEvidence,
  principalFromProductionKeycloakClaims,
  type MobileTokenVault,
  type OAuthTransactionRecord,
  type OAuthTransactionStore,
  type RequiredSecurityAuditIntent,
  type StoredMobileTokenSet,
  type WebSessionEnvelope,
  type WebSessionRefreshClaimResult,
  type WebSessionRefreshWaitResult,
  type WebSessionRevocationReason,
  type WebSessionRotateResult,
  type WebSessionStoredEntry,
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
  assert.equal(created.safeSession.mfaAssurancePolicyId, mfaPolicy().policyId);
  assert.equal(created.safeSession.mfaVerified, true);
  const weakAssurance = await createWebSessionManager(
    new TestWebSessionStore()
  ).createAuthenticatedSession({
    subject: "keycloak-subject-weak-mfa",
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-web-bff",
    authorityRevision: "authority-revision-1",
    amr: ["otp"],
    acr: "urn:unproved:aal2",
    tokens: tokenSet(now),
    now
  });
  assert.equal(weakAssurance.safeSession.mfaVerified, false);
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
  assert.deepEqual(
    store.auditIntents
      .filter((intent) => ["auth.session.created", "auth.session.rotated"].includes(intent.action))
      .map((intent) => intent.action),
    ["auth.session.created", "auth.session.rotated"]
  );
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

test("web sessions pin one canonical expected issuer across create and encrypted reload", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  await assert.rejects(
    manager.createAuthenticatedSession({
      subject: "keycloak-subject-wrong-issuer",
      issuer: "https://attacker.example/realms/clinic-os",
      authorizedParty: "clinic-os-web-bff",
      authorityRevision: "authority-revision-1",
      tokens: tokenSet(now),
      now
    }),
    /does not match configuration/
  );

  const sessionId = await createWebSession(
    manager,
    "keycloak-subject-encrypted-issuer",
    tokenSet(now)
  );
  const miswiredManager = createWebSessionManager(
    store,
    "https://identity.example/realms/other-realm"
  );
  await assert.rejects(
    miswiredManager.inspect(sessionId, activeAuthority("authority-revision-1"), now),
    /does not match configuration/
  );

  assert.throws(
    () =>
      createWebSessionManager(
        new TestWebSessionStore(),
        "http://identity.internal/realms/clinic-os"
      ),
    /loopback/
  );
  assert.throws(
    () =>
      createWebSessionManager(
        new TestWebSessionStore(),
        "https://identity.example/realms/clinic-os?issuer=confused"
      ),
    /query/
  );
  assert.throws(
    () =>
      createWebSessionManager(
        new TestWebSessionStore(),
        "https://identity.example:8443/realms/clinic-os",
        true
      ),
    /without a port/
  );
});

test("ordinary concurrent touches are monotonic and never contend on token recordVersion", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const sessionId = await createWebSession(manager, "keycloak-subject-touch", tokenSet(now));
  const sessions = await Promise.all(
    Array.from({ length: 16 }, (_, index) =>
      manager.inspect(
        sessionId,
        activeAuthority("authority-revision-1"),
        new Date(now.getTime() + 1_000 + index)
      )
    )
  );
  assert.equal(sessions.length, 16);
  assert.deepEqual(store.recordVersions(), [1]);
  assert.equal(
    store.auditIntents.filter((intent) => intent.action === "auth.session.created").length,
    1
  );
});

test("ordinary activity during external refresh does not invalidate refresh completion", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const sessionId = await createWebSession(manager, "keycloak-subject-touch-refresh", {
    ...tokenSet(now),
    accessExpiresAt: new Date(now.getTime() + 30_000)
  });
  const providerStarted = deferred<void>();
  const providerResult = deferred<ReturnType<typeof refreshedTokenSet>>();
  let refreshCalls = 0;
  const refreshing = manager.withAccessToken({
    sessionId,
    authorityResolver: activeAuthority("authority-revision-1"),
    tokenRefresher: {
      refresh: async () => {
        refreshCalls += 1;
        providerStarted.resolve();
        return providerResult.promise;
      }
    },
    now: new Date(now.getTime() + 1_000),
    execute: async () => "refreshed-request"
  });
  await providerStarted.promise;
  const ordinary = await manager.inspect(
    sessionId,
    activeAuthority("authority-revision-1"),
    new Date(now.getTime() + 2_000)
  );
  assert.equal(ordinary.subject, "keycloak-subject-touch-refresh");
  providerResult.resolve(
    refreshedTokenSet("keycloak-subject-touch-refresh", new Date(now.getTime() + 2_000))
  );
  assert.equal(await refreshing, "refreshed-request");
  assert.equal(refreshCalls, 1);
  assert.deepEqual(store.recordVersions(), [2]);
  assert.equal(
    store.auditIntents.some((intent) => intent.action === "auth.refresh.replay_detected"),
    false
  );
});

test("concurrent refresh callers share one durable provider refresh", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const sessionId = await createWebSession(manager, "keycloak-subject-single-flight", {
    ...tokenSet(now),
    accessExpiresAt: new Date(now.getTime() + 30_000)
  });
  const providerStarted = deferred<void>();
  const providerResult = deferred<ReturnType<typeof refreshedTokenSet>>();
  let refreshCalls = 0;
  const input = (label: string) => ({
    sessionId,
    authorityResolver: activeAuthority("authority-revision-1"),
    tokenRefresher: {
      refresh: async () => {
        refreshCalls += 1;
        providerStarted.resolve();
        return providerResult.promise;
      }
    },
    now: new Date(now.getTime() + 1_000),
    execute: async () => label
  });
  const first = manager.withAccessToken(input("first"));
  await providerStarted.promise;
  const second = manager.withAccessToken(input("second"));
  await eventually(() => store.refreshWaiterCount === 1);
  providerResult.resolve(
    refreshedTokenSet("keycloak-subject-single-flight", new Date(now.getTime() + 2_000))
  );
  assert.deepEqual(await Promise.all([first, second]), ["first", "second"]);
  assert.equal(refreshCalls, 1);
  assert.deepEqual(store.recordVersions(), [2]);
});

test("an ordinary request already validated before rotation completes without reviving the old id", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const sessionId = await createWebSession(
    manager,
    "keycloak-subject-rotation-request",
    tokenSet(now)
  );
  const authorityEntered = deferred<void>();
  const authorityRelease = deferred<void>();
  const inFlight = manager.inspect(
    sessionId,
    {
      resolve: async () => {
        authorityEntered.resolve();
        await authorityRelease.promise;
        return { active: true, authorityRevision: "authority-revision-1" };
      }
    },
    new Date(now.getTime() + 601_000)
  );
  await authorityEntered.promise;
  const rotated = await manager.rotate(
    sessionId,
    activeAuthority("authority-revision-1"),
    new Date(now.getTime() + 601_000)
  );
  authorityRelease.resolve();
  assert.equal((await inFlight).subject, "keycloak-subject-rotation-request");
  const nextSessionId = manager.parseSessionId(rotated.cookie)!;
  assert.notEqual(nextSessionId, sessionId);
  await assert.rejects(
    manager.inspect(
      sessionId,
      activeAuthority("authority-revision-1"),
      new Date(now.getTime() + 602_000)
    ),
    /unavailable/
  );
});

test("an orphaned dispatched refresh is recovered by revoking once with durable audit evidence", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const sessionId = await createWebSession(manager, "keycloak-subject-refresh-crash", {
    ...tokenSet(now),
    accessExpiresAt: new Date(now.getTime() + 30_000)
  });
  const providerStarted = deferred<void>();
  const providerResult = deferred<ReturnType<typeof refreshedTokenSet>>();
  let refreshCalls = 0;
  const request = () =>
    manager.withAccessToken({
      sessionId,
      authorityResolver: activeAuthority("authority-revision-1"),
      tokenRefresher: {
        refresh: async () => {
          refreshCalls += 1;
          providerStarted.resolve();
          return providerResult.promise;
        }
      },
      now: new Date(now.getTime() + 1_000),
      execute: async () => "must-not-run"
    });
  const crashedOwner = request();
  await providerStarted.promise;
  const recoveryCaller = request();
  await eventually(() => store.refreshWaiterCount === 1);
  store.expireDispatchedRefreshLease();
  await assert.rejects(
    recoveryCaller,
    (error) => error instanceof WebSessionError && error.code === "refresh_recovery_required"
  );
  providerResult.resolve(
    refreshedTokenSet("keycloak-subject-refresh-crash", new Date(now.getTime() + 2_000))
  );
  await assert.rejects(
    crashedOwner,
    (error) => error instanceof WebSessionError && error.code === "refresh_recovery_required"
  );
  assert.equal(refreshCalls, 1);
  assert.equal(
    store.auditIntents.filter((intent) => intent.action === "auth.refresh.replay_detected").length,
    0
  );
  assert.equal(
    store.auditIntents.filter((intent) => intent.action === "auth.refresh.recovery_uncertain")
      .length,
    1
  );
  assert.equal(
    store.auditIntents.filter((intent) => intent.action === "auth.session.revoked").length,
    1
  );
});

test("required session audit outbox failures roll back mutations and revocation races emit once", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  store.failRequiredAudit = true;
  await assert.rejects(
    manager.createAuthenticatedSession({
      subject: "keycloak-subject-audit-failure",
      issuer: "https://identity.example/realms/clinic-os",
      authorizedParty: "clinic-os-web-bff",
      authorityRevision: "authority-revision-1",
      tokens: tokenSet(now),
      now
    }),
    /audit outbox unavailable/
  );
  assert.deepEqual(store.recordVersions(), []);

  store.failRequiredAudit = false;
  const sessionId = await createWebSession(manager, "keycloak-subject-audit-race", tokenSet(now));
  store.failRequiredAudit = true;
  await assert.rejects(
    manager.rotate(
      sessionId,
      activeAuthority("authority-revision-1"),
      new Date(now.getTime() + 601_000)
    ),
    /audit outbox unavailable/
  );
  assert.equal(
    (
      await manager.inspect(
        sessionId,
        activeAuthority("authority-revision-1"),
        new Date(now.getTime() + 602_000)
      )
    ).subject,
    "keycloak-subject-audit-race"
  );

  store.failRequiredAudit = false;
  await Promise.all([
    manager.revoke(sessionId, "logout", new Date(now.getTime() + 603_000)),
    manager.revoke(sessionId, "logout", new Date(now.getTime() + 603_000))
  ]);
  assert.equal(
    store.auditIntents.filter((intent) => intent.action === "auth.session.revoked").length,
    1
  );
});

test("lost durable refresh completion fails closed instead of reusing uncertain token state", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const sessionId = await createWebSession(manager, "keycloak-subject-completion-loss", {
    ...tokenSet(now),
    accessExpiresAt: new Date(now.getTime() + 30_000)
  });
  store.failRefreshCompletion = true;
  await assert.rejects(
    manager.withAccessToken({
      sessionId,
      authorityResolver: activeAuthority("authority-revision-1"),
      tokenRefresher: {
        refresh: async () =>
          refreshedTokenSet("keycloak-subject-completion-loss", new Date(now.getTime() + 2_000))
      },
      now: new Date(now.getTime() + 1_000),
      execute: async () => "should-not-run"
    }),
    (error) => error instanceof WebSessionError && error.code === "refresh_recovery_required"
  );
  assert.equal(
    store.auditIntents.filter((intent) => intent.action === "auth.refresh.replay_detected").length,
    0
  );
  assert.equal(
    store.auditIntents.filter((intent) => intent.action === "auth.refresh.recovery_uncertain")
      .length,
    1
  );
});

test("provider-confirmed refresh replay revokes atomically with replay and session audits", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const sessionId = await createWebSession(manager, "keycloak-subject-confirmed-replay", {
    ...tokenSet(now),
    accessExpiresAt: new Date(now.getTime() + 30_000)
  });
  await assert.rejects(
    manager.withAccessToken({
      sessionId,
      authorityResolver: activeAuthority("authority-revision-1"),
      tokenRefresher: {
        refresh: async () =>
          Promise.reject(
            new WebSessionRefreshProviderError({
              classification: "confirmed_replay",
              reasonCode: "refresh_token_reuse"
            })
          )
      },
      now: new Date(now.getTime() + 1_000),
      execute: async () => "should-not-run"
    }),
    (error) => error instanceof WebSessionError && error.code === "refresh_replay"
  );
  assert.deepEqual(
    store.auditIntents
      .filter((intent) =>
        ["auth.refresh.replay_detected", "auth.session.revoked"].includes(intent.action)
      )
      .map((intent) => intent.action)
      .sort(),
    ["auth.refresh.replay_detected", "auth.session.revoked"]
  );
});

test("timeout after possible provider rotation revokes as uncertain without retrying old refresh", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const sessionId = await createWebSession(manager, "keycloak-subject-timeout", {
    ...tokenSet(now),
    accessExpiresAt: new Date(now.getTime() + 30_000)
  });
  let providerCalls = 0;
  await assert.rejects(
    manager.withAccessToken({
      sessionId,
      authorityResolver: activeAuthority("authority-revision-1"),
      tokenRefresher: {
        refresh: async () => {
          providerCalls += 1;
          throw new Error("timeout after provider may have rotated refresh token");
        }
      },
      now: new Date(now.getTime() + 1_000),
      execute: async () => "should-not-run"
    }),
    (error) => error instanceof WebSessionError && error.code === "refresh_recovery_required"
  );
  assert.equal(providerCalls, 1);
  assert.deepEqual(
    store.auditIntents
      .filter((intent) =>
        ["auth.refresh.recovery_uncertain", "auth.session.revoked"].includes(intent.action)
      )
      .map((intent) => intent.action)
      .sort(),
    ["auth.refresh.recovery_uncertain", "auth.session.revoked"]
  );
});

test("provider-confirmed invalid_grant is rejected without replay or uncertainty classification", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const sessionId = await createWebSession(manager, "keycloak-subject-invalid-grant", {
    ...tokenSet(now),
    accessExpiresAt: new Date(now.getTime() + 30_000)
  });
  let providerCalls = 0;
  await assert.rejects(
    manager.withAccessToken({
      sessionId,
      authorityResolver: activeAuthority("authority-revision-1"),
      tokenRefresher: {
        refresh: async () => {
          providerCalls += 1;
          throw new WebSessionRefreshProviderError({
            classification: "confirmed_rejection",
            reasonCode: "invalid_grant"
          });
        }
      },
      now: new Date(now.getTime() + 1_000),
      execute: async () => "should-not-run"
    }),
    (error) => error instanceof WebSessionError && error.code === "refresh_rejected"
  );
  assert.equal(providerCalls, 1);
  assert.equal(
    store.auditIntents.filter((intent) => intent.action === "auth.session.revoked").length,
    1
  );
  assert.equal(
    store.auditIntents.some((intent) => intent.action.startsWith("auth.refresh.")),
    false
  );
});

test("refreshed identity issuer drift revokes as uncertain before persisting new tokens", async () => {
  const store = new TestWebSessionStore();
  const manager = createWebSessionManager(store);
  const sessionId = await createWebSession(manager, "keycloak-subject-refresh-issuer", {
    ...tokenSet(now),
    accessExpiresAt: new Date(now.getTime() + 30_000)
  });
  await assert.rejects(
    manager.withAccessToken({
      sessionId,
      authorityResolver: activeAuthority("authority-revision-1"),
      tokenRefresher: {
        refresh: async () => ({
          ...refreshedTokenSet("keycloak-subject-refresh-issuer", new Date(now.getTime() + 2_000)),
          issuer: "https://attacker.example/realms/clinic-os"
        })
      },
      now: new Date(now.getTime() + 1_000),
      execute: async () => "should-not-run"
    }),
    (error) => error instanceof WebSessionError && error.code === "refresh_recovery_required"
  );
  assert.equal(
    store.auditIntents.filter((intent) => intent.action === "auth.refresh.recovery_uncertain")
      .length,
    1
  );
});

test("legacy replay-conflict behavior is no longer used for concurrent ordinary activity", async () => {
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
  assert.equal(
    await manager.withAccessToken({
      sessionId,
      authorityResolver: activeAuthority("authority-revision-1"),
      tokenRefresher: {
        refresh: async () =>
          refreshedTokenSet("keycloak-subject-0004", new Date(now.getTime() + 1_000))
      },
      now: new Date(now.getTime() + 1_000),
      execute: async () => "completed"
    }),
    "completed"
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

test("MFA, JML, and break-glass controls persist required audit evidence", async () => {
  const auditOutbox = new TestRequiredAuditOutbox();
  assert.equal(hasMfaEvidence({ amr: ["otp"], acr: "urn:unproved:aal2" }, mfaPolicy()), false);
  assert.equal(hasMfaEvidence({ amr: ["webauthn"], acr: "mfa:2" }, mfaPolicy()), false);
  assert.equal(hasMfaEvidence({ amr: ["mfa"] }, mfaPolicy()), false);
  assert.equal(hasMfaEvidence({ amr: ["pwd", "otp"] }, mfaPolicy()), true);
  assert.equal(
    hasMfaEvidence(
      { amr: ["pwd"], acr: "urn:clinicos:reviewed:aal2" },
      {
        ...mfaPolicy(),
        policyId: "reviewed-realm-acr-v1",
        reviewedRealmEvidenceId: "realm-evidence-2026-07-10",
        acceptedAcrValues: ["urn:clinicos:reviewed:aal2"]
      }
    ),
    true
  );
  await assert.rejects(
    assertMfaForAccess({
      roleSlugs: ["platform_admin"],
      amr: ["pwd"],
      mfaAssurancePolicy: mfaPolicy(),
      subject: "keycloak-subject-0001",
      issuer: "https://identity.example/realms/clinic-os",
      authorizedParty: "clinic-os-web-bff",
      auditDeduplicationKey: "token-id-00000001",
      now,
      auditOutbox
    }),
    /Multi-factor/
  );
  assert.equal(auditOutbox.intents.at(-1)?.action, "auth.mfa.denied");
  auditOutbox.fail = true;
  await assert.rejects(
    assertMfaForAccess({
      roleSlugs: ["platform_admin"],
      amr: ["pwd"],
      mfaAssurancePolicy: mfaPolicy(),
      subject: "keycloak-subject-0001",
      issuer: "https://identity.example/realms/clinic-os",
      authorizedParty: "clinic-os-web-bff",
      auditDeduplicationKey: "token-id-00000001-audit-failure",
      now,
      auditOutbox
    }),
    /audit outbox unavailable/
  );
  auditOutbox.fail = false;
  await assert.doesNotReject(
    assertMfaForAccess({
      roleSlugs: ["owner_admin"],
      amr: ["pwd", "webauthn"],
      mfaAssurancePolicy: mfaPolicy(),
      subject: "keycloak-subject-0001",
      issuer: "https://identity.example/realms/clinic-os",
      authorizedParty: "clinic-os-web-bff",
      auditDeduplicationKey: "token-id-00000002",
      now,
      auditOutbox
    })
  );
  const moverCommand = {
    commandId: "jml-command-0001",
    transition: "mover",
    subject: "keycloak-subject-0001",
    tenantId: "tenant-00000001",
    requestedBy: "requester-000001",
    approvedBy: "approver-000001",
    ticketId: "SEC-1001",
    requestedRoles: ["platform_admin"]
  } as const;
  const mover = buildJmlControlPlan(moverCommand);
  assert.equal(mover.steps[0], "lock_application_access");
  assert.ok(
    mover.steps.indexOf("revoke_application_session_families") <
      mover.steps.indexOf("set_product_roles")
  );
  assert.ok(mover.steps.includes("require_privileged_mfa"));

  const coordinatedAudits: RequiredSecurityAuditIntent[] = [];
  await executeJmlControlPlan(
    moverCommand,
    {
      atomicity: "security_state_and_required_audit_outbox",
      executeStep: async ({ requiredAudit }) => {
        if (requiredAudit) coordinatedAudits.push(requiredAudit);
      }
    },
    now
  );
  assert.deepEqual(
    coordinatedAudits.map((intent) => intent.action),
    ["identity.mover.completed"]
  );
  let completionCommitted = false;
  await assert.rejects(
    executeJmlControlPlan(
      moverCommand,
      {
        atomicity: "security_state_and_required_audit_outbox",
        executeStep: async ({ requiredAudit }) => {
          if (requiredAudit) throw new Error("required audit outbox unavailable");
          completionCommitted = false;
        }
      },
      now
    ),
    /audit outbox unavailable/
  );
  assert.equal(completionCommitted, false);

  await assert.rejects(
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
        amr: ["pwd", "otp"],
        mfaAssurancePolicy: mfaPolicy(),
        issuer: "https://identity.example/realms/clinic-os",
        authorizedParty: "clinic-os-web-bff",
        auditDeduplicationKey: "grant-00000001",
        auditOutbox
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
    amr: ["pwd", "webauthn"],
    mfaAssurancePolicy: mfaPolicy(),
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-web-bff",
    auditDeduplicationKey: "grant-00000002",
    auditOutbox
  };
  await assert.doesNotReject(assertActiveBreakGlassGrant(scopedGrant, scopedInput));
  await assert.rejects(
    assertActiveBreakGlassGrant(scopedGrant, {
      ...scopedInput,
      patientId: "patient-0000002"
    }),
    /tenant, clinic, and patient scope/
  );
  await assert.rejects(
    assertActiveBreakGlassGrant(scopedGrant, {
      ...scopedInput,
      amr: ["pwd"],
      acr: "urn:unproved:aal2",
      auditDeduplicationKey: "grant-00000002-no-mfa"
    }),
    /Break-glass access requires multi-factor/
  );
  assert.equal(auditOutbox.intents.at(-1)?.action, "auth.mfa.denied");
  assert.equal(
    auditOutbox.intents.at(-1)?.action === "auth.mfa.denied"
      ? auditOutbox.intents.at(-1)?.reasonCode
      : null,
    "break_glass"
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

class TestRequiredAuditOutbox {
  readonly atomicity = "durable_transactional_outbox" as const;
  readonly intents: RequiredSecurityAuditIntent[] = [];
  fail = false;

  async persistRequired(intent: RequiredSecurityAuditIntent): Promise<void> {
    if (this.fail) throw new Error("required audit outbox unavailable");
    this.intents.push(structuredClone(intent));
  }
}

class TestWebSessionStore implements WebSessionStore {
  readonly atomicity = "session_state_and_required_audit_outbox" as const;
  readonly #sessions = new Map<
    string,
    WebSessionStoredEntry & {
      refreshLease: {
        id: string;
        recordVersion: number;
        phase: "claimed" | "dispatched";
        expiresAt: string;
      } | null;
    }
  >();
  readonly #revoked = new Set<string>();
  readonly auditIntents: RequiredSecurityAuditIntent[] = [];
  readonly #refreshWaiters = new Set<() => void>();
  failRequiredAudit = false;
  failRefreshCompletion = false;
  refreshWaiterCount = 0;

  async create(
    key: string,
    envelope: WebSessionEnvelope,
    lastSeenAt: Date,
    _expiresAt: Date,
    requiredAudit: RequiredSecurityAuditIntent
  ): Promise<boolean> {
    if (this.#sessions.has(key)) return false;
    this.#persistAudits([requiredAudit]);
    this.#sessions.set(key, {
      envelope: structuredClone(envelope),
      lastSeenAt: lastSeenAt.toISOString(),
      refreshLease: null
    });
    return true;
  }

  async read(key: string): Promise<WebSessionStoredEntry | null> {
    const entry = this.#sessions.get(key);
    return entry
      ? structuredClone({ envelope: entry.envelope, lastSeenAt: entry.lastSeenAt })
      : null;
  }

  async touchActivity(key: string, observedAt: Date): Promise<"touched" | "missing"> {
    const entry = this.#sessions.get(key);
    if (!entry) return "missing";
    if (new Date(entry.lastSeenAt).getTime() < observedAt.getTime()) {
      entry.lastSeenAt = observedAt.toISOString();
    }
    return "touched";
  }

  async rotate(
    previousKey: string,
    nextKey: string,
    expected: number,
    envelope: WebSessionEnvelope,
    lastSeenAt: Date,
    _expiresAt: Date,
    requiredAudit: RequiredSecurityAuditIntent
  ): Promise<WebSessionRotateResult> {
    const current = this.#sessions.get(previousKey);
    if (!current || this.#revoked.has(current.envelope.familyKey)) {
      return { status: "missing_or_revoked" };
    }
    if (current.envelope.recordVersion !== expected) return { status: "version_changed" };
    if (current.refreshLease) {
      return {
        status: "refresh_in_progress",
        leaseExpiresAt: current.refreshLease.expiresAt
      };
    }
    if (this.#sessions.has(nextKey)) return { status: "version_changed" };
    this.#persistAudits([requiredAudit]);
    this.#sessions.delete(previousKey);
    this.#sessions.set(nextKey, {
      envelope: structuredClone(envelope),
      lastSeenAt: lastSeenAt.toISOString(),
      refreshLease: null
    });
    this.#notifyRefreshWaiters();
    return { status: "rotated" };
  }

  async claimRefresh(input: {
    sessionKey: string;
    expectedRecordVersion: number;
    leaseId: string;
    claimedAt: Date;
    leaseExpiresAt: Date;
  }): Promise<WebSessionRefreshClaimResult> {
    const entry = this.#sessions.get(input.sessionKey);
    if (!entry || this.#revoked.has(entry.envelope.familyKey)) {
      return { status: "missing_or_revoked" };
    }
    if (entry.envelope.recordVersion !== input.expectedRecordVersion) {
      return { status: "version_changed" };
    }
    if (entry.refreshLease) {
      if (new Date(entry.refreshLease.expiresAt).getTime() <= input.claimedAt.getTime()) {
        if (entry.refreshLease.phase === "dispatched") {
          return { status: "orphaned_dispatched_refresh" };
        }
      } else {
        return {
          status: "refresh_in_progress",
          leaseExpiresAt: entry.refreshLease.expiresAt
        };
      }
    }
    entry.refreshLease = {
      id: input.leaseId,
      recordVersion: input.expectedRecordVersion,
      phase: "claimed",
      expiresAt: input.leaseExpiresAt.toISOString()
    };
    return { status: "claimed" };
  }

  async markRefreshDispatched(input: {
    sessionKey: string;
    expectedRecordVersion: number;
    leaseId: string;
  }): Promise<boolean> {
    const entry = this.#sessions.get(input.sessionKey);
    if (
      !entry ||
      entry.envelope.recordVersion !== input.expectedRecordVersion ||
      entry.refreshLease?.id !== input.leaseId ||
      entry.refreshLease.recordVersion !== input.expectedRecordVersion ||
      entry.refreshLease.phase !== "claimed"
    ) {
      return false;
    }
    entry.refreshLease.phase = "dispatched";
    return true;
  }

  async completeRefresh(input: {
    sessionKey: string;
    expectedRecordVersion: number;
    leaseId: string;
    envelope: WebSessionEnvelope;
    lastSeenAt: Date;
  }): Promise<boolean> {
    const entry = this.#sessions.get(input.sessionKey);
    if (
      this.failRefreshCompletion ||
      !entry ||
      entry.envelope.recordVersion !== input.expectedRecordVersion ||
      entry.refreshLease?.id !== input.leaseId ||
      entry.refreshLease.phase !== "dispatched"
    ) {
      return false;
    }
    entry.envelope = structuredClone(input.envelope);
    if (new Date(entry.lastSeenAt).getTime() < input.lastSeenAt.getTime()) {
      entry.lastSeenAt = input.lastSeenAt.toISOString();
    }
    entry.refreshLease = null;
    this.#notifyRefreshWaiters();
    return true;
  }

  async waitForRefresh(input: {
    sessionKey: string;
    observedRecordVersion: number;
  }): Promise<WebSessionRefreshWaitResult> {
    const immediate = this.#refreshWaitResult(input.sessionKey, input.observedRecordVersion, false);
    if (immediate) return immediate;
    this.refreshWaiterCount += 1;
    await new Promise<void>((resolve) => this.#refreshWaiters.add(resolve));
    return (
      this.#refreshWaitResult(input.sessionKey, input.observedRecordVersion, true) ?? {
        status: "retry_claim"
      }
    );
  }

  #refreshWaitResult(
    sessionKey: string,
    observedRecordVersion: number,
    assumeExpired: boolean
  ): WebSessionRefreshWaitResult | null {
    const entry = this.#sessions.get(sessionKey);
    if (!entry || this.#revoked.has(entry.envelope.familyKey)) {
      return { status: "missing_or_revoked" };
    }
    if (entry.envelope.recordVersion > observedRecordVersion) {
      return {
        status: "completed",
        entry: structuredClone({ envelope: entry.envelope, lastSeenAt: entry.lastSeenAt })
      };
    }
    if (!entry.refreshLease) return { status: "retry_claim" };
    if (!assumeExpired) return null;
    if (entry.refreshLease.phase === "claimed") {
      return { status: "retry_claim" };
    }
    return { status: "orphaned_dispatched_refresh" };
  }

  async delete(key: string): Promise<void> {
    this.#sessions.delete(key);
  }

  async revokeSessionFamily(input: {
    sessionKey: string;
    familyKey: string;
    reason: WebSessionRevocationReason;
    requiredAudits: readonly [RequiredSecurityAuditIntent, ...RequiredSecurityAuditIntent[]];
  }): Promise<"revoked" | "already_revoked" | "missing"> {
    if (this.#revoked.has(input.familyKey)) return "already_revoked";
    const entry = this.#sessions.get(input.sessionKey);
    if (!entry || entry.envelope.familyKey !== input.familyKey) return "missing";
    this.#persistAudits(input.requiredAudits);
    this.#revoked.add(input.familyKey);
    this.#sessions.delete(input.sessionKey);
    this.#notifyRefreshWaiters();
    return "revoked";
  }

  async isFamilyRevoked(familyKey: string): Promise<boolean> {
    return this.#revoked.has(familyKey);
  }

  rawEnvelopes(): string[] {
    return [...this.#sessions.values()].map((value) => JSON.stringify(value.envelope));
  }

  recordVersions(): number[] {
    return [...this.#sessions.values()].map((value) => value.envelope.recordVersion);
  }

  expireDispatchedRefreshLease(): void {
    const entry = [...this.#sessions.values()].find(
      (candidate) => candidate.refreshLease?.phase === "dispatched"
    );
    assert.ok(entry?.refreshLease, "expected a dispatched refresh lease");
    entry.refreshLease.expiresAt = new Date(now.getTime() - 1).toISOString();
    this.#notifyRefreshWaiters();
  }

  #persistAudits(intents: readonly RequiredSecurityAuditIntent[]): void {
    if (this.failRequiredAudit) throw new Error("required audit outbox unavailable");
    this.auditIntents.push(...structuredClone(intents));
  }

  #notifyRefreshWaiters(): void {
    const waiters = [...this.#refreshWaiters];
    this.#refreshWaiters.clear();
    for (const resolve of waiters) resolve();
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

function createWebSessionManager(
  store: WebSessionStore,
  expectedIssuer = "https://identity.example/realms/clinic-os",
  productionLike = false
): WebSessionManager {
  return new WebSessionManager({
    store,
    policy: {
      productionLike,
      expectedIssuer,
      mfaAssurancePolicy: mfaPolicy(),
      cookieName: productionLike ? "__Host-clinicos_cp14_session" : "clinicos_cp14_session",
      secureCookie: productionLike,
      idleTtlSeconds: 900,
      absoluteTtlSeconds: 3600,
      rotateAfterSeconds: 600,
      refreshLeewaySeconds: 60,
      refreshLeaseSeconds: 10,
      lookupHmacKey: Buffer.alloc(32, 3),
      csrfHmacKey: Buffer.alloc(32, 4),
      encryptionKeys: [{ id: "key-2026-07", key: Buffer.alloc(32, 5) }]
    }
  });
}

async function createWebSession(
  manager: WebSessionManager,
  subject: string,
  tokens: ReturnType<typeof tokenSet>
): Promise<string> {
  const created = await manager.createAuthenticatedSession({
    subject,
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-web-bff",
    keycloakSessionId: "keycloak-session-001",
    authorityRevision: "authority-revision-1",
    amr: ["pwd", "otp"],
    tokens,
    now
  });
  return manager.parseSessionId(created.cookie)!;
}

function refreshedTokenSet(subject: string, at: Date) {
  return {
    subject,
    issuer: "https://identity.example/realms/clinic-os",
    authorizedParty: "clinic-os-web-bff",
    keycloakSessionId: "keycloak-session-001",
    amr: ["pwd", "otp"],
    acr: "urn:clinicos:aal2",
    ...tokenSet(at)
  };
}

function mfaPolicy() {
  return {
    policyId: "clinicos-amr-two-factor-v1",
    reviewedRealmEvidenceId: null,
    acceptedAcrValues: [] as string[],
    primaryFactorAmrValues: ["pwd"],
    secondaryFactorAmrValues: ["otp", "totp", "webauthn"],
    phishingResistantAmrValues: [] as string[]
  };
}

function deferred<T>() {
  let resolvePromise!: (value: T | PromiseLike<T>) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    resolve: (value?: T) => resolvePromise(value as T),
    reject: rejectPromise
  };
}

async function eventually(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail("deterministic concurrent operation did not reach the expected state");
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
