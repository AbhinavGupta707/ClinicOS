import { describe, expect, it } from "vitest";
import {
  Cp14BffRuntime,
  type Cp14BffRequest,
  type Cp14OidcTokenClient,
  type Cp14SafeWebSession,
  type Cp14TransactionsPort,
  type Cp14WebSessionTokenSet,
  type Cp14WebSessionsPort
} from "../lib/cp14-session";

const now = new Date("2026-07-10T12:00:00.000Z");
const issuer = "https://identity.example/realms/clinic-os";

describe("CP14 same-origin BFF", () => {
  it("fails closed without the confidential client secret", () => {
    expect(() => newRuntime({ clientSecret: null })).toThrow(/client secret is missing/);
  });

  it("runs PKCE login/callback/session/proxy/logout without exposing tokens to browser JS", async () => {
    const tokenClient = new TestTokenClient();
    const apiCalls: Array<Record<string, unknown>> = [];
    const runtime = newRuntime({ tokenClient, apiCalls });
    const login = await runtime.beginLogin(
      request("GET", "/auth/login?returnTo=%2Fclinic%2Fday"),
      now
    );
    expect(login.status).toBe(302);
    const authorizationUrl = new URL(String(login.headers.location));
    expect(authorizationUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorizationUrl.searchParams.has("code_verifier")).toBe(false);
    expect(authorizationUrl.searchParams.get("scope")).not.toContain("offline_access");
    tokenClient.expectedNonce = authorizationUrl.searchParams.get("nonce")!;
    const stateCookie = String(login.headers["set-cookie"]);
    expect(stateCookie).toContain("HttpOnly");
    expect(stateCookie).toContain("Secure");
    expect(stateCookie).toContain("Path=/");
    const state = authorizationUrl.searchParams.get("state")!;

    const callback = await runtime.completeLogin(
      request("GET", `/auth/callback?code=${"c".repeat(43)}&state=${state}`, {
        cookie: cookiePair(stateCookie)
      }),
      new Date(now.getTime() + 1_000)
    );
    expect(callback.status).toBe(303);
    expect(callback.headers.location).toBe("/clinic/day");
    const cookies = callback.headers["set-cookie"] as readonly string[];
    const sessionCookie = cookies[0]!;
    expect(sessionCookie).toContain("__Host-clinicos_session=");
    expect(sessionCookie).not.toContain("access-token");
    expect(sessionCookie).not.toContain("refresh-token");

    await expect(
      runtime.completeLogin(
        request("GET", `/auth/callback?code=${"c".repeat(43)}&state=${state}`, {
          cookie: cookiePair(stateCookie)
        }),
        new Date(now.getTime() + 2_000)
      )
    ).rejects.toThrow(/already consumed/);

    const cookie = cookiePair(sessionCookie);
    const session = await runtime.sessionStatus(
      request("GET", "/auth/session", { cookie }),
      new Date(now.getTime() + 3_000)
    );
    const sessionBody = session.body as Record<string, unknown>;
    expect(sessionBody.authenticated).toBe(true);
    expect(sessionBody.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(sessionBody)).not.toContain("access-token");
    expect(JSON.stringify(sessionBody)).not.toContain("refresh-token");

    const proxied = await runtime.proxyApi(
      request("GET", "/bff/v1/me", { cookie }),
      "/v1/me",
      new Date(now.getTime() + 4_000)
    );
    expect(proxied.status).toBe(200);
    expect(proxied.headers.authorization).toBeUndefined();
    expect(proxied.headers["set-cookie"]).toBeUndefined();
    expect(apiCalls).toHaveLength(1);
    expect(String(apiCalls[0]!.authorization)).toMatch(/^Bearer access-token-/);

    await expect(
      runtime.proxyApi(
        request("GET", "/bff/v1/me", { cookie }),
        "https://attacker.example/v1/me",
        new Date(now.getTime() + 4_500)
      )
    ).rejects.toThrow(/same-origin/);

    await expect(
      runtime.logout(
        request("POST", "/auth/logout", {
          cookie,
          origin: "https://app.example",
          "sec-fetch-site": "same-origin",
          "x-csrf-token": "wrong-csrf-token"
        }),
        new Date(now.getTime() + 5_000)
      )
    ).rejects.toThrow(/CSRF/);

    const logout = await runtime.logout(
      request("POST", "/auth/logout", {
        cookie,
        origin: "https://app.example",
        "sec-fetch-site": "same-origin",
        "x-csrf-token": String(sessionBody.csrfToken)
      }),
      new Date(now.getTime() + 6_000)
    );
    expect(logout.status).toBe(204);
    expect(logout.headers["set-cookie"]).toContain("Max-Age=0");
    expect(tokenClient.revocations).toBe(1);
  });

  it("rejects wrong hosts, origins, cross-site mutation, and non-allowlisted API targets", async () => {
    const runtime = newRuntime({});
    await expect(
      runtime.beginLogin(
        request("GET", "/auth/login", { "x-forwarded-host": "attacker.example" }),
        now
      )
    ).rejects.toThrow(/host/);

    await expect(
      runtime.proxyApi(request("GET", "/bff"), "https://attacker.example/v1/me", now)
    ).rejects.toThrow(/session is required/i);
  });
});

class TestTokenClient implements Cp14OidcTokenClient {
  expectedNonce = "";
  revocations = 0;

  async exchangeAuthorizationCode() {
    const issuedAt = Math.floor((now.getTime() + 1_000) / 1000);
    return {
      claims: {
        sub: "keycloak-subject-0001",
        iss: issuer,
        aud: ["clinic-os-api"],
        azp: "clinic-os-web-bff",
        exp: issuedAt + 300,
        iat: issuedAt,
        nbf: issuedAt,
        typ: "Bearer",
        jti: "token-id-00000001",
        sid: "session-id-000001",
        auth_time: issuedAt,
        amr: ["pwd", "otp"],
        acr: "urn:clinicos:aal2"
      },
      idTokenNonce: this.expectedNonce,
      idTokenSubject: "keycloak-subject-0001",
      tokens: tokenSet(new Date(now.getTime() + 1_000))
    };
  }

  async refresh() {
    return {
      subject: "keycloak-subject-0001",
      issuer,
      authorizedParty: "clinic-os-web-bff",
      keycloakSessionId: "session-id-000001",
      ...tokenSet(new Date(now.getTime() + 10_000))
    };
  }

  async revoke(): Promise<void> {
    this.revocations += 1;
  }
}

class TestTransactions implements Cp14TransactionsPort {
  active = false;
  returnTo = "/";
  readonly state = "s".repeat(43);
  readonly nonce = "n".repeat(43);

  async begin(input: Parameters<Cp14TransactionsPort["begin"]>[0]) {
    this.active = true;
    this.returnTo = input.returnTo;
    const url = new URL(input.authorizationEndpoint);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "query");
    url.searchParams.set("scope", "email openid profile");
    url.searchParams.set("state", this.state);
    url.searchParams.set("nonce", this.nonce);
    url.searchParams.set("code_challenge", "p".repeat(43));
    url.searchParams.set("code_challenge_method", "S256");
    return {
      authorizationUrl: url.toString(),
      state: this.state,
      expiresAt: new Date(input.now.getTime() + 300_000).toISOString()
    };
  }

  async complete(input: Parameters<Cp14TransactionsPort["complete"]>[0]) {
    const url = new URL(input.callbackUrl);
    if (
      !this.active ||
      input.cookieState !== this.state ||
      url.searchParams.get("state") !== this.state
    ) {
      throw new Error("OAuth login transaction is missing, expired, or already consumed.");
    }
    this.active = false;
    return {
      code: url.searchParams.get("code")!,
      codeVerifier: "v".repeat(43),
      nonce: this.nonce,
      clientId: "clinic-os-web-bff",
      redirectUri: "https://app.example/auth/callback",
      returnTo: this.returnTo
    };
  }
}

class TestSessions implements Cp14WebSessionsPort {
  readonly cookieName = "__Host-clinicos_session";
  readonly sessionId = "i".repeat(43);
  readonly csrfToken = "z".repeat(43);
  active = false;
  accessToken = `access-token-${"a".repeat(32)}`;

  async createAuthenticatedSession(): Promise<{
    cookie: string;
    csrfToken: string;
    safeSession: Cp14SafeWebSession;
  }> {
    this.active = true;
    return {
      cookie: `${this.cookieName}=${this.sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      csrfToken: this.csrfToken,
      safeSession: this.safeSession()
    };
  }

  async inspect(): Promise<Cp14SafeWebSession> {
    if (!this.active) throw new Error("Session is unavailable.");
    return this.safeSession();
  }

  async rotate() {
    return {
      cookie: `${this.cookieName}=${this.sessionId}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      csrfToken: this.csrfToken,
      safeSession: this.safeSession()
    };
  }

  async withAccessToken<T>(input: {
    execute: (accessToken: string, session: Cp14SafeWebSession) => Promise<T>;
  }): Promise<T> {
    if (!this.active) throw new Error("Session is unavailable.");
    return input.execute(this.accessToken, this.safeSession());
  }

  async revoke(
    _sessionId: string,
    _reason: "logout",
    _now: Date,
    provider: Cp14OidcTokenClient
  ): Promise<void> {
    this.active = false;
    await provider.revoke({
      refreshToken: `refresh-token-${"r".repeat(32)}`,
      subject: "keycloak-subject-0001",
      issuer,
      authorizedParty: "clinic-os-web-bff"
    });
  }

  parseSessionId(cookieHeader: string | readonly string[] | null | undefined): string | null {
    if (typeof cookieHeader !== "string") return null;
    return cookieHeader.includes(`${this.cookieName}=${this.sessionId}`) ? this.sessionId : null;
  }

  verifyCsrfToken(_sessionId: string, suppliedToken: string | null | undefined): boolean {
    return suppliedToken === this.csrfToken;
  }

  clearCookie(): string {
    return `${this.cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  }

  private safeSession(): Cp14SafeWebSession {
    return {
      absoluteExpiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
      csrfToken: this.csrfToken,
      acr: "urn:clinicos:aal2",
      amr: ["pwd", "otp"],
      shouldRotate: false
    };
  }
}

function newRuntime(input: {
  clientSecret?: string | null;
  tokenClient?: TestTokenClient;
  apiCalls?: Array<Record<string, unknown>>;
}) {
  const sessions = new TestSessions();
  return new Cp14BffRuntime({
    configuration: {
      productionLike: true,
      issuer,
      authorizationEndpoint: `${issuer}/protocol/openid-connect/auth`,
      tokenEndpoint: `${issuer}/protocol/openid-connect/token`,
      revocationEndpoint: `${issuer}/protocol/openid-connect/revoke`,
      clientId: "clinic-os-web-bff",
      clientSecret: input.clientSecret === undefined ? "s".repeat(48) : input.clientSecret,
      apiAudience: "clinic-os-api",
      webOrigin: "https://app.example",
      callbackUri: "https://app.example/auth/callback",
      apiBaseUrl: "https://api.internal.example/",
      allowedApiPathPrefixes: ["/v1/me", "/v1/patients"]
    },
    security: {
      assertBoundary: (request) => {
        if (
          request.headers["x-forwarded-host"] !== "app.example" ||
          request.headers["x-forwarded-proto"] !== "https" ||
          (request.headers.origin && request.headers.origin !== "https://app.example")
        ) {
          throw new Error("Request host or origin is not trusted.");
        }
      },
      assertMutation: (request, verifyCsrf) => {
        if (request.headers.origin !== "https://app.example") {
          throw new Error("Request origin is not trusted.");
        }
        if (request.headers["sec-fetch-site"] !== "same-origin") {
          throw new Error("Cross-site browser mutation is not accepted.");
        }
        if (request.headers.authorization) {
          throw new Error("Browser BFF requests cannot supply bearer authorization.");
        }
        const csrf = request.headers["x-csrf-token"];
        if (typeof csrf !== "string" || !verifyCsrf(csrf))
          throw new Error("CSRF verification failed.");
      },
      sensitiveHeaders: () => ({
        "cache-control": "private, no-store, max-age=0, must-revalidate",
        "x-content-type-options": "nosniff",
        "referrer-policy": "no-referrer"
      })
    },
    identity: {
      validate: (_claims, policy) => {
        expect(policy.expectedIssuer).toBe(issuer);
        expect(policy.requiredAudience).toBe("clinic-os-api");
        expect(policy.acceptedAuthorizedParties).toEqual(["clinic-os-web-bff"]);
        return {
          subject: "keycloak-subject-0001",
          issuer,
          authorizedParty: "clinic-os-web-bff",
          keycloakSessionId: "session-id-000001",
          amr: ["pwd", "otp"],
          acr: "urn:clinicos:aal2"
        };
      }
    },
    transactions: new TestTransactions(),
    sessions,
    authorityResolver: {
      resolve: async () => ({ active: true, authorityRevision: "authority-revision-1" })
    },
    tokens: input.tokenClient ?? new TestTokenClient(),
    api: {
      send: async (request) => {
        input.apiCalls?.push({
          url: request.url,
          method: request.method,
          authorization: request.headers.authorization
        });
        return {
          status: 200,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "set-cookie": "must-not-be-forwarded=1",
            "x-request-id": "request-0001"
          },
          body: Buffer.from('{"ok":true}')
        };
      }
    }
  });
}

function request(
  method: string,
  url: string,
  headers: Record<string, string> = {}
): Cp14BffRequest {
  return {
    method,
    url,
    headers: {
      host: "internal-alb.local",
      "x-forwarded-host": "app.example",
      "x-forwarded-proto": "https",
      ...headers
    }
  };
}

function cookiePair(setCookie: string): string {
  return setCookie.split(";", 1)[0]!;
}

function tokenSet(at: Date): Cp14WebSessionTokenSet {
  return {
    accessToken: `access-token-${"a".repeat(32)}`,
    refreshToken: `refresh-token-${"r".repeat(32)}`,
    idToken: `identity-token-${"i".repeat(32)}`,
    accessExpiresAt: new Date(at.getTime() + 300_000),
    refreshExpiresAt: new Date(at.getTime() + 3_600_000)
  };
}
