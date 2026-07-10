import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  KeycloakOidcBffClient,
  KeycloakOidcTransportError,
  type KeycloakOidcHttpRequest,
  type KeycloakOidcHttpResponse,
  type KeycloakOidcHttpTransport,
  type KeycloakRefreshProviderFailure
} from "../lib/cp14-session";

const now = new Date("2026-07-10T12:00:00.000Z");
const nowSeconds = Math.floor(now.getTime() / 1000);
const issuer = "https://identity.example/realms/clinic-os";
const clientId = "clinic-os-web-bff";
const apiAudience = "clinic-os-api";
const clientSecret = "s".repeat(48);
const redirectUri = "https://app.example/auth/callback";
const keyId = "keycloak-signing-key-0001";
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = keys.publicKey.export({ format: "jwk" });

describe("CP14 official Keycloak OIDC BFF client", () => {
  it("pins exact issuer endpoints and confidential-client inputs", async () => {
    expect(() =>
      client(new TestTransport(), {
        tokenEndpoint: `${issuer}/protocol/openid-connect/token?realm=attacker`
      })
    ).toThrow(/configuration is invalid/);
    expect(() =>
      client(new TestTransport(), {
        revocationEndpoint: `${issuer}/protocol/openid-connect/revoke/extra`
      })
    ).toThrow(/configuration is invalid/);

    const oidc = client(new TestTransport());
    await expect(
      oidc.exchangeAuthorizationCode({
        tokenEndpoint: `${issuer}/protocol/openid-connect/token`,
        code: "c".repeat(43),
        codeVerifier: "v".repeat(43),
        clientId,
        clientSecret: "wrong-secret".repeat(4),
        redirectUri
      })
    ).rejects.toMatchObject({ code: "invalid_configuration" });
  });

  it("exchanges code+PKCE through bounded official endpoints and verifies JWKS signatures and identity", async () => {
    const transport = new TestTransport();
    const oidc = client(transport);
    const result = await oidc.exchangeAuthorizationCode({
      tokenEndpoint: `${issuer}/protocol/openid-connect/token`,
      code: "c".repeat(43),
      codeVerifier: "v".repeat(43),
      clientId,
      clientSecret,
      redirectUri
    });
    expect(result.idTokenNonce).toBe("n".repeat(43));
    expect(result.idTokenSubject).toBe("keycloak-subject-0001");
    expect(result.tokens.accessExpiresAt.toISOString()).toBe("2026-07-10T12:05:00.000Z");
    expect(result.tokens.refreshExpiresAt.toISOString()).toBe("2026-07-10T13:00:00.000Z");
    expect((result.claims as Record<string, unknown>).azp).toBe(clientId);
    expect(transport.requests.map((request) => request.url)).toEqual([
      `${issuer}/protocol/openid-connect/token`,
      `${issuer}/protocol/openid-connect/certs`
    ]);
    const form = new URLSearchParams(
      new TextDecoder().decode(transport.requests[0]!.body ?? new Uint8Array())
    );
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code_verifier")).toBe("v".repeat(43));
    expect(form.get("client_secret")).toBe(clientSecret);
    expect(transport.requests[0]!.timeoutMs).toBe(5_000);
    expect(transport.requests[0]!.maximumResponseBytes).toBe(65_536);
  });

  it("rejects malformed signatures, lifetime drift, and subject drift without exposing material", async () => {
    const transport = new TestTransport();
    transport.tokenResponse = tokenResponse({
      access_token: `${signedJwt(accessClaims())}tampered`
    });
    const oidc = client(transport);
    const error = await oidc
      .exchangeAuthorizationCode(exchangeInput())
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "exchange_rejected" });
    expect(String(error)).not.toContain(clientSecret);
    expect(String(error)).not.toContain("tampered");

    const drift = new TestTransport();
    drift.tokenResponse = tokenResponse({
      id_token: signedJwt(idClaims({ sub: "different-subject-0001" }))
    });
    await expect(client(drift).exchangeAuthorizationCode(exchangeInput())).rejects.toMatchObject({
      code: "exchange_rejected"
    });

    for (const malformed of [{ exp: String(nowSeconds + 300) }, { jti: 12_345_678 }]) {
      const wrongType = new TestTransport();
      wrongType.tokenResponse = tokenResponse({
        access_token: signedJwt(accessClaims(malformed))
      });
      await expect(
        client(wrongType).exchangeAuthorizationCode(exchangeInput())
      ).rejects.toMatchObject({ code: "exchange_rejected" });
    }

    const malformedAmr = new TestTransport();
    malformedAmr.tokenResponse = tokenResponse({
      access_token: signedJwt(accessClaims({ amr: [1] }))
    });
    const uncertain = await client(malformedAmr)
      .refresh(refreshInput())
      .catch((caught: unknown) => caught);
    expect((uncertain as ClassifiedRefreshError).failure).toEqual({
      classification: "transport_uncertain",
      reasonCode: "malformed_response"
    });
  });

  it("requires exact OIDC azp binding for multi-audience ID tokens and rejects ambiguous audiences", async () => {
    const invalidClaims = [
      { aud: [clientId, "another-client"] },
      { aud: [clientId, "another-client"], azp: "wrong-client" },
      { aud: [clientId, clientId], azp: clientId },
      { aud: [clientId, 42], azp: clientId },
      { aud: [clientId, "x".repeat(256)], azp: clientId },
      { aud: clientId, azp: "wrong-client" }
    ];
    for (const claims of invalidClaims) {
      const transport = new TestTransport();
      transport.tokenResponse = tokenResponse({
        id_token: signedJwt(idClaims(claims))
      });
      await expect(
        client(transport).exchangeAuthorizationCode(exchangeInput())
      ).rejects.toMatchObject({
        code: "exchange_rejected"
      });
    }

    const accepted = new TestTransport();
    accepted.tokenResponse = tokenResponse({
      id_token: signedJwt(idClaims({ aud: [clientId, "another-client"], azp: clientId }))
    });
    await expect(
      client(accepted).exchangeAuthorizationCode(exchangeInput())
    ).resolves.toMatchObject({
      idTokenSubject: "keycloak-subject-0001"
    });
  });

  it("distinguishes confirmed invalid_grant from realm-proven replay and transport uncertainty", async () => {
    const invalidGrant = new TestTransport();
    invalidGrant.tokenResponse = jsonResponse(400, {
      error: "invalid_grant",
      error_description: "Token is not active"
    });
    const rejected = await client(invalidGrant)
      .refresh(refreshInput())
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(ClassifiedRefreshError);
    expect((rejected as ClassifiedRefreshError).failure).toEqual({
      classification: "confirmed_rejection",
      reasonCode: "invalid_grant"
    });

    const replay = new TestTransport();
    replay.tokenResponse = jsonResponse(400, {
      error: "invalid_grant",
      error_description: "Realm-confirmed refresh token reuse"
    });
    const replayed = await client(replay)
      .refresh(refreshInput())
      .catch((error: unknown) => error);
    expect((replayed as ClassifiedRefreshError).failure).toEqual({
      classification: "confirmed_replay",
      reasonCode: "refresh_token_reuse"
    });

    const network = new TestTransport();
    network.transportFailure = new KeycloakOidcTransportError("network_error");
    const uncertain = await client(network)
      .refresh(refreshInput())
      .catch((error: unknown) => error);
    expect((uncertain as ClassifiedRefreshError).failure).toEqual({
      classification: "transport_uncertain",
      reasonCode: "network_error"
    });
    expect(String(uncertain)).not.toContain(refreshInput().refreshToken);
  });

  it("validates refresh rotation and confirms revocation only on official success", async () => {
    const transport = new TestTransport();
    const oidc = client(transport);
    const refreshed = await oidc.refresh(refreshInput());
    expect(refreshed.subject).toBe("keycloak-subject-0001");
    expect(refreshed.issuer).toBe(issuer);
    expect(refreshed.authorizedParty).toBe(clientId);
    expect(refreshed.keycloakSessionId).toBe("keycloak-session-0001");
    expect(refreshed.refreshToken).not.toBe(refreshInput().refreshToken);

    await oidc.revoke(refreshInput());
    expect(transport.requests.at(-1)?.url).toBe(`${issuer}/protocol/openid-connect/revoke`);
    const revokeForm = new URLSearchParams(
      new TextDecoder().decode(transport.requests.at(-1)!.body ?? new Uint8Array())
    );
    expect(revokeForm.get("token_type_hint")).toBe("refresh_token");

    const unavailable = new TestTransport();
    unavailable.revocationResponse = jsonResponse(503, { error: "temporarily_unavailable" });
    await expect(client(unavailable).revoke(refreshInput())).rejects.toMatchObject({
      code: "revocation_unconfirmed"
    });
  });
});

class ClassifiedRefreshError extends Error {
  constructor(readonly failure: KeycloakRefreshProviderFailure) {
    super("OIDC refresh did not produce an accepted durable token result.");
    this.name = "ClassifiedRefreshError";
  }
}

class TestTransport implements KeycloakOidcHttpTransport {
  readonly requests: KeycloakOidcHttpRequest[] = [];
  tokenResponse: KeycloakOidcHttpResponse = tokenResponse();
  revocationResponse: KeycloakOidcHttpResponse = jsonResponse(200, {});
  transportFailure: Error | null = null;

  async request(input: KeycloakOidcHttpRequest): Promise<KeycloakOidcHttpResponse> {
    this.requests.push(structuredClone(input));
    if (this.transportFailure) throw this.transportFailure;
    if (input.url.endsWith("/protocol/openid-connect/certs")) {
      return jsonResponse(
        200,
        {
          keys: [
            {
              kty: "RSA",
              alg: "RS256",
              use: "sig",
              kid: keyId,
              n: publicJwk.n,
              e: publicJwk.e
            }
          ]
        },
        { "cache-control": "public, max-age=60" }
      );
    }
    if (input.url.endsWith("/protocol/openid-connect/revoke")) {
      return this.revocationResponse;
    }
    return this.tokenResponse;
  }
}

function client(
  transport: TestTransport,
  overrides: Partial<ConstructorParameters<typeof KeycloakOidcBffClient>[0]> = {}
) {
  return new KeycloakOidcBffClient({
    productionLike: true,
    issuer,
    tokenEndpoint: `${issuer}/protocol/openid-connect/token`,
    revocationEndpoint: `${issuer}/protocol/openid-connect/revoke`,
    clientId,
    clientSecret,
    redirectUri,
    apiAudience,
    confirmedReplayErrorDescriptions: ["Realm-confirmed refresh token reuse"],
    refreshProviderErrorFactory: (failure) => new ClassifiedRefreshError(failure),
    transport,
    now: () => new Date(now),
    ...overrides
  });
}

function exchangeInput() {
  return {
    tokenEndpoint: `${issuer}/protocol/openid-connect/token`,
    code: "c".repeat(43),
    codeVerifier: "v".repeat(43),
    clientId,
    clientSecret,
    redirectUri
  };
}

function refreshInput() {
  return {
    refreshToken: `old-refresh-${"r".repeat(64)}`,
    subject: "keycloak-subject-0001",
    issuer,
    authorizedParty: clientId
  };
}

function tokenResponse(overrides: Record<string, unknown> = {}): KeycloakOidcHttpResponse {
  return jsonResponse(200, {
    access_token: signedJwt(accessClaims()),
    refresh_token: `new-refresh-${"r".repeat(64)}`,
    id_token: signedJwt(idClaims()),
    token_type: "Bearer",
    expires_in: 300,
    refresh_expires_in: 3_600,
    ...overrides
  });
}

function accessClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: issuer,
    sub: "keycloak-subject-0001",
    aud: [apiAudience],
    azp: clientId,
    typ: "Bearer",
    iat: nowSeconds,
    nbf: nowSeconds,
    exp: nowSeconds + 300,
    jti: "access-token-id-0001",
    sid: "keycloak-session-0001",
    amr: ["pwd", "otp"],
    acr: "urn:clinicos:aal2",
    ...overrides
  };
}

function idClaims(overrides: Record<string, unknown> = {}) {
  return {
    iss: issuer,
    sub: "keycloak-subject-0001",
    aud: clientId,
    iat: nowSeconds,
    exp: nowSeconds + 300,
    nonce: "n".repeat(43),
    ...overrides
  };
}

function signedJwt(payload: Record<string, unknown>): string {
  const header = base64url({ alg: "RS256", typ: "JWT", kid: keyId });
  const body = base64url(payload);
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), keys.privateKey).toString(
    "base64url"
  );
  return `${header}.${body}.${signature}`;
}

function base64url(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  headers: Record<string, string> = {}
): KeycloakOidcHttpResponse {
  return {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
    body: new TextEncoder().encode(JSON.stringify(body))
  };
}
