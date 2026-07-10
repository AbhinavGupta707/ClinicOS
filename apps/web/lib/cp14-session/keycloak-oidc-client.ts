import type { Cp14OidcTokenClient, Cp14WebSessionTokenSet } from "./bff-contract";

const TOKEN_PATTERN = /^[\x21-\x7E]{64,32768}$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._:-]{3,128}$/;
const JWT_IDENTIFIER_PATTERN = /^[A-Za-z0-9._:-]{8,255}$/;
const JWT_SEGMENT_PATTERN = /^[A-Za-z0-9_-]+$/;
const JSON_CONTENT_TYPE = /^application\/(?:json|jwk-set\+json)(?:;\s*charset=utf-8)?$/i;
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAXIMUM_RESPONSE_BYTES = 65_536;

export interface KeycloakOidcHttpRequest {
  url: string;
  method: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body: Uint8Array | null;
  timeoutMs: number;
  maximumResponseBytes: number;
}

export interface KeycloakOidcHttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: Uint8Array;
}

export interface KeycloakOidcHttpTransport {
  request(input: KeycloakOidcHttpRequest): Promise<KeycloakOidcHttpResponse>;
}

export interface KeycloakOidcClientConfiguration {
  productionLike: boolean;
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiAudience: string;
  maximumAccessTokenLifetimeSeconds?: number;
  maximumRefreshTokenLifetimeSeconds?: number;
  requestTimeoutMs?: number;
  maximumResponseBytes?: number;
  /**
   * Keycloak does not standardize a replay-specific token error. Only realm-tested exact response
   * descriptions may opt into confirmed replay classification; every other invalid_grant remains
   * a confirmed rejection.
   */
  confirmedReplayErrorDescriptions?: readonly string[];
  /** Master composition binds this to `new WebSessionRefreshProviderError(failure)`. */
  refreshProviderErrorFactory: (failure: KeycloakRefreshProviderFailure) => Error;
  transport?: KeycloakOidcHttpTransport;
  now: () => Date;
}

export type KeycloakRefreshProviderFailure =
  | {
      classification: "confirmed_rejection";
      reasonCode: "invalid_grant" | "session_expired" | "consent_revoked" | "identity_disabled";
    }
  | { classification: "confirmed_replay"; reasonCode: "refresh_token_reuse" }
  | {
      classification: "transport_uncertain";
      reasonCode: "timeout" | "network_error" | "provider_unavailable" | "malformed_response";
    };

interface NormalizedConfiguration {
  productionLike: boolean;
  issuer: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  jwksEndpoint: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  apiAudience: string;
  maximumAccessTokenLifetimeSeconds: number;
  maximumRefreshTokenLifetimeSeconds: number;
  requestTimeoutMs: number;
  maximumResponseBytes: number;
  confirmedReplayErrorDescriptions: readonly string[];
}

export class KeycloakOidcClientError extends Error {
  readonly code: "invalid_configuration" | "exchange_rejected" | "revocation_unconfirmed";

  constructor(code: KeycloakOidcClientError["code"], message: string) {
    super(message);
    this.name = "KeycloakOidcClientError";
    this.code = code;
  }
}

export class KeycloakOidcTransportError extends Error {
  readonly classification: "timeout" | "network_error" | "response_too_large";

  constructor(classification: KeycloakOidcTransportError["classification"]) {
    super("The bounded identity-provider request did not complete.");
    this.name = "KeycloakOidcTransportError";
    this.classification = classification;
  }
}

/** Official Keycloak Authorization Code/refresh/revocation adapter for the server-only web BFF. */
export class KeycloakOidcBffClient implements Cp14OidcTokenClient {
  readonly #configuration: NormalizedConfiguration;
  readonly #transport: KeycloakOidcHttpTransport;
  readonly #now: () => Date;
  readonly #jwtVerifier: KeycloakJwksVerifier;
  readonly #refreshProviderErrorFactory: (failure: KeycloakRefreshProviderFailure) => Error;
  readonly #classifiedRefreshErrors = new WeakSet<object>();

  constructor(configuration: KeycloakOidcClientConfiguration) {
    if (typeof configuration.now !== "function") throw invalidConfiguration();
    this.#configuration = normalizeConfiguration(configuration);
    this.#transport = configuration.transport ?? new FetchKeycloakOidcHttpTransport();
    this.#now = configuration.now;
    if (typeof configuration.refreshProviderErrorFactory !== "function") {
      throw invalidConfiguration();
    }
    this.#refreshProviderErrorFactory = configuration.refreshProviderErrorFactory;
    this.#jwtVerifier = new KeycloakJwksVerifier({
      issuer: this.#configuration.issuer,
      jwksEndpoint: this.#configuration.jwksEndpoint,
      transport: this.#transport,
      timeoutMs: this.#configuration.requestTimeoutMs,
      maximumResponseBytes: this.#configuration.maximumResponseBytes
    });
  }

  async exchangeAuthorizationCode(input: {
    tokenEndpoint: string;
    code: string;
    codeVerifier: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  }): Promise<{
    claims: unknown;
    idTokenNonce: string;
    idTokenSubject: string;
    tokens: Cp14WebSessionTokenSet;
  }> {
    assertExactExchangeConfiguration(input, this.#configuration);
    if (!/^[\x21-\x7E]{16,2048}$/.test(input.code) || /[\r\n]/.test(input.code)) {
      throw invalidConfiguration();
    }
    if (!/^[A-Za-z0-9._~-]{43,128}$/.test(input.codeVerifier)) {
      throw invalidConfiguration();
    }
    try {
      const response = await this.#postForm(
        this.#configuration.tokenEndpoint,
        new URLSearchParams({
          grant_type: "authorization_code",
          code: input.code,
          code_verifier: input.codeVerifier,
          client_id: this.#configuration.clientId,
          client_secret: this.#configuration.clientSecret,
          redirect_uri: this.#configuration.redirectUri
        })
      );
      if (response.status !== 200) throw exchangeRejected();
      const now = trustedInstant(this.#now());
      const tokenResponse = parseTokenResponse(response);
      if (!tokenResponse.id_token) throw exchangeRejected();
      const accessClaims = await this.#verifyAccessToken(tokenResponse.access_token, now);
      const idClaims = await this.#jwtVerifier.verify({
        token: tokenResponse.id_token,
        audience: this.#configuration.clientId,
        now,
        maximumLifetimeSeconds: this.#configuration.maximumAccessTokenLifetimeSeconds,
        kind: "id"
      });
      const subject = requiredIdentifier(accessClaims.sub);
      const idSubject = requiredIdentifier(idClaims.sub);
      const nonce = requiredOpaqueClaim(idClaims.nonce, 16, 256);
      if (subject !== idSubject) throw exchangeRejected();
      return {
        claims: accessClaims,
        idTokenNonce: nonce,
        idTokenSubject: idSubject,
        tokens: tokenSetFromResponse(tokenResponse, accessClaims, now, this.#configuration)
      };
    } catch (error) {
      if (error instanceof KeycloakOidcClientError) throw error;
      throw exchangeRejected();
    }
  }

  async refresh(input: {
    refreshToken: string;
    subject: string;
    issuer: string;
    authorizedParty: string;
  }): Promise<
    Cp14WebSessionTokenSet & {
      subject: string;
      issuer: string;
      authorizedParty: string;
      keycloakSessionId?: string | null;
      amr: readonly string[];
      acr: string | null;
    }
  > {
    try {
      assertToken(input.refreshToken);
      if (
        input.issuer !== this.#configuration.issuer ||
        input.authorizedParty !== this.#configuration.clientId ||
        requiredIdentifier(input.subject) !== input.subject
      ) {
        throw this.#refreshFailure({
          classification: "transport_uncertain",
          reasonCode: "malformed_response"
        });
      }
      const response = await this.#postForm(
        this.#configuration.tokenEndpoint,
        new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: input.refreshToken,
          client_id: this.#configuration.clientId,
          client_secret: this.#configuration.clientSecret
        })
      );
      if (response.status !== 200) this.#throwRefreshFailure(response);
      const now = trustedInstant(this.#now());
      const tokenResponse = parseTokenResponse(response);
      if (tokenResponse.refresh_token === input.refreshToken) {
        throw this.#refreshFailure({
          classification: "transport_uncertain",
          reasonCode: "malformed_response"
        });
      }
      const claims = await this.#verifyAccessToken(tokenResponse.access_token, now);
      const subject = requiredIdentifier(claims.sub);
      const authorizedParty = requiredIdentifier(claims.azp);
      const keycloakSessionId = optionalSessionIdentifier(claims.sid ?? claims.session_state);
      if (
        subject !== input.subject ||
        claims.iss !== input.issuer ||
        authorizedParty !== input.authorizedParty
      ) {
        throw this.#refreshFailure({
          classification: "transport_uncertain",
          reasonCode: "malformed_response"
        });
      }
      if (tokenResponse.id_token) {
        const idClaims = await this.#jwtVerifier.verify({
          token: tokenResponse.id_token,
          audience: this.#configuration.clientId,
          now,
          maximumLifetimeSeconds: this.#configuration.maximumAccessTokenLifetimeSeconds,
          kind: "id"
        });
        if (requiredIdentifier(idClaims.sub) !== subject) {
          throw this.#refreshFailure({
            classification: "transport_uncertain",
            reasonCode: "malformed_response"
          });
        }
      }
      return {
        ...tokenSetFromResponse(tokenResponse, claims, now, this.#configuration),
        subject,
        issuer: this.#configuration.issuer,
        authorizedParty,
        keycloakSessionId,
        amr: authenticationMethods(claims.amr),
        acr: authenticationContext(claims.acr)
      };
    } catch (error) {
      if (typeof error === "object" && error !== null && this.#classifiedRefreshErrors.has(error)) {
        throw error;
      }
      if (error instanceof KeycloakOidcTransportError) {
        throw this.#refreshFailure({
          classification: "transport_uncertain",
          reasonCode:
            error.classification === "timeout"
              ? "timeout"
              : error.classification === "network_error"
                ? "network_error"
                : "malformed_response"
        });
      }
      throw this.#refreshFailure({
        classification: "transport_uncertain",
        reasonCode: "malformed_response"
      });
    }
  }

  async revoke(input: {
    refreshToken: string;
    subject: string;
    issuer: string;
    authorizedParty: string;
  }): Promise<void> {
    try {
      assertToken(input.refreshToken);
      if (
        input.issuer !== this.#configuration.issuer ||
        input.authorizedParty !== this.#configuration.clientId ||
        requiredIdentifier(input.subject) !== input.subject
      ) {
        throw new Error("invalid revocation binding");
      }
      const response = await this.#postForm(
        this.#configuration.revocationEndpoint,
        new URLSearchParams({
          token: input.refreshToken,
          token_type_hint: "refresh_token",
          client_id: this.#configuration.clientId,
          client_secret: this.#configuration.clientSecret
        })
      );
      if (response.status !== 200 && response.status !== 204) throw new Error("rejected");
    } catch {
      throw new KeycloakOidcClientError(
        "revocation_unconfirmed",
        "Identity-provider revocation was not confirmed."
      );
    }
  }

  async #verifyAccessToken(token: string, now: Date): Promise<Record<string, unknown>> {
    const claims = await this.#jwtVerifier.verify({
      token,
      audience: this.#configuration.apiAudience,
      now,
      maximumLifetimeSeconds: this.#configuration.maximumAccessTokenLifetimeSeconds,
      kind: "access"
    });
    if (
      claims.typ !== "Bearer" ||
      claims.azp !== this.#configuration.clientId ||
      typeof claims.jti !== "string" ||
      !JWT_IDENTIFIER_PATTERN.test(claims.jti) ||
      !optionalSessionIdentifier(claims.sid ?? claims.session_state)
    ) {
      throw new Error("access token claims invalid");
    }
    return claims;
  }

  #throwRefreshFailure(response: KeycloakOidcHttpResponse): never {
    if (response.status === 429 || response.status >= 500) {
      throw this.#refreshFailure({
        classification: "transport_uncertain",
        reasonCode: "provider_unavailable"
      });
    }
    const error = parseOauthError(response);
    if (response.status === 400 && error.error === "invalid_grant") {
      if (
        error.error_description &&
        this.#configuration.confirmedReplayErrorDescriptions.includes(error.error_description)
      ) {
        throw this.#refreshFailure({
          classification: "confirmed_replay",
          reasonCode: "refresh_token_reuse"
        });
      }
      throw this.#refreshFailure({
        classification: "confirmed_rejection",
        reasonCode: "invalid_grant"
      });
    }
    throw this.#refreshFailure({
      classification: "transport_uncertain",
      reasonCode: "malformed_response"
    });
  }

  #refreshFailure(failure: KeycloakRefreshProviderFailure): Error {
    const error = this.#refreshProviderErrorFactory(Object.freeze({ ...failure }));
    if (!(error instanceof Error)) throw invalidConfiguration();
    this.#classifiedRefreshErrors.add(error);
    return error;
  }

  #postForm(url: string, form: URLSearchParams): Promise<KeycloakOidcHttpResponse> {
    return this.#transport.request({
      url,
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded"
      },
      body: new TextEncoder().encode(form.toString()),
      timeoutMs: this.#configuration.requestTimeoutMs,
      maximumResponseBytes: this.#configuration.maximumResponseBytes
    });
  }
}

export class FetchKeycloakOidcHttpTransport implements KeycloakOidcHttpTransport {
  async request(input: KeycloakOidcHttpRequest): Promise<KeycloakOidcHttpResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), input.timeoutMs);
    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body ? new TextDecoder().decode(input.body) : null,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
        referrerPolicy: "no-referrer",
        signal: controller.signal
      });
      if (response.redirected) throw new KeycloakOidcTransportError("network_error");
      const body = await readBoundedBody(response, input.maximumResponseBytes);
      const headers: Record<string, string> = {};
      for (const name of ["content-type", "cache-control"]) {
        const value = response.headers.get(name);
        if (value !== null) headers[name] = value;
      }
      return { status: response.status, headers, body };
    } catch (error) {
      if (error instanceof KeycloakOidcTransportError) throw error;
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw new KeycloakOidcTransportError("timeout");
      }
      throw new KeycloakOidcTransportError("network_error");
    } finally {
      clearTimeout(timer);
    }
  }
}

class KeycloakJwksVerifier {
  readonly #issuer: string;
  readonly #jwksEndpoint: string;
  readonly #transport: KeycloakOidcHttpTransport;
  readonly #timeoutMs: number;
  readonly #maximumResponseBytes: number;
  #cache: { expiresAtMs: number; keys: Map<string, JsonWebKey> } | null = null;

  constructor(input: {
    issuer: string;
    jwksEndpoint: string;
    transport: KeycloakOidcHttpTransport;
    timeoutMs: number;
    maximumResponseBytes: number;
  }) {
    this.#issuer = input.issuer;
    this.#jwksEndpoint = input.jwksEndpoint;
    this.#transport = input.transport;
    this.#timeoutMs = input.timeoutMs;
    this.#maximumResponseBytes = input.maximumResponseBytes;
  }

  async verify(input: {
    token: string;
    audience: string;
    now: Date;
    maximumLifetimeSeconds: number;
    kind: "access" | "id";
  }): Promise<Record<string, unknown>> {
    assertToken(input.token);
    const parts = input.token.split(".");
    if (parts.length !== 3 || parts.some((part) => !JWT_SEGMENT_PATTERN.test(part))) {
      throw new Error("JWT compact serialization invalid");
    }
    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = parseJwtSegment(encodedHeader, 4_096);
    const claims = parseJwtSegment(encodedPayload, 32_768);
    if (
      header.alg !== "RS256" ||
      typeof header.kid !== "string" ||
      !JWT_IDENTIFIER_PATTERN.test(header.kid) ||
      header.crit !== undefined ||
      header.b64 !== undefined
    ) {
      throw new Error("JWT protected header invalid");
    }
    let jwk = await this.#key(header.kid, input.now);
    let verified = await verifyJwtSignature(jwk, encodedHeader, encodedPayload, encodedSignature);
    if (!verified) {
      // One bounded refresh supports Keycloak signing-key rotation without accepting stale keys.
      await this.#refreshKeys(input.now);
      jwk = await this.#key(header.kid, input.now);
      verified = await verifyJwtSignature(jwk, encodedHeader, encodedPayload, encodedSignature);
    }
    if (!verified) throw new Error("JWT signature invalid");
    validateJwtClaims(claims, {
      issuer: this.#issuer,
      audience: input.audience,
      now: input.now,
      maximumLifetimeSeconds: input.maximumLifetimeSeconds,
      kind: input.kind
    });
    return claims;
  }

  async #key(kid: string, now: Date): Promise<JsonWebKey> {
    if (!this.#cache || this.#cache.expiresAtMs <= now.getTime() || !this.#cache.keys.has(kid)) {
      await this.#refreshKeys(now);
    }
    const key = this.#cache?.keys.get(kid);
    if (!key) throw new Error("JWT key id unavailable");
    return key;
  }

  async #refreshKeys(now: Date): Promise<void> {
    const response = await this.#transport.request({
      url: this.#jwksEndpoint,
      method: "GET",
      headers: { accept: "application/json" },
      body: null,
      timeoutMs: this.#timeoutMs,
      maximumResponseBytes: this.#maximumResponseBytes
    });
    if (response.status !== 200) throw new Error("JWKS unavailable");
    const payload = parseJsonResponse(response);
    if (!Array.isArray(payload.keys) || payload.keys.length < 1 || payload.keys.length > 32) {
      throw new Error("JWKS shape invalid");
    }
    const keys = new Map<string, JsonWebKey>();
    for (const candidate of payload.keys) {
      if (
        !isRecord(candidate) ||
        candidate.kty !== "RSA" ||
        candidate.alg !== "RS256" ||
        (candidate.use !== undefined && candidate.use !== "sig") ||
        typeof candidate.kid !== "string" ||
        !JWT_IDENTIFIER_PATTERN.test(candidate.kid) ||
        typeof candidate.n !== "string" ||
        !/^[A-Za-z0-9_-]{128,2048}$/.test(candidate.n) ||
        typeof candidate.e !== "string" ||
        !/^[A-Za-z0-9_-]{2,16}$/.test(candidate.e) ||
        keys.has(candidate.kid)
      ) {
        throw new Error("JWKS key invalid");
      }
      keys.set(candidate.kid, {
        kty: "RSA",
        alg: "RS256",
        use: "sig",
        kid: candidate.kid,
        n: candidate.n,
        e: candidate.e,
        key_ops: ["verify"]
      } as JsonWebKey);
    }
    const cacheSeconds = cacheLifetimeSeconds(response.headers["cache-control"]);
    this.#cache = { expiresAtMs: now.getTime() + cacheSeconds * 1000, keys };
  }
}

interface KeycloakTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token: string | null;
  token_type: "Bearer";
  expires_in: number;
  refresh_expires_in: number;
}

function normalizeConfiguration(input: KeycloakOidcClientConfiguration): NormalizedConfiguration {
  const issuer = canonicalIssuer(input.issuer, input.productionLike);
  const tokenEndpoint = exactEndpoint(
    input.tokenEndpoint,
    issuer,
    "/protocol/openid-connect/token",
    input.productionLike
  );
  const revocationEndpoint = exactEndpoint(
    input.revocationEndpoint,
    issuer,
    "/protocol/openid-connect/revoke",
    input.productionLike
  );
  const jwksEndpoint = `${issuer}/protocol/openid-connect/certs`;
  if (!CLIENT_ID_PATTERN.test(input.clientId) || !CLIENT_ID_PATTERN.test(input.apiAudience)) {
    throw invalidConfiguration();
  }
  if (
    typeof input.clientSecret !== "string" ||
    Buffer.byteLength(input.clientSecret) < 32 ||
    Buffer.byteLength(input.clientSecret) > 512 ||
    /[\u0000\r\n]/.test(input.clientSecret)
  ) {
    throw invalidConfiguration();
  }
  const redirectUri = canonicalUrl(input.redirectUri, input.productionLike);
  const maximumAccessTokenLifetimeSeconds = input.maximumAccessTokenLifetimeSeconds ?? 300;
  const maximumRefreshTokenLifetimeSeconds = input.maximumRefreshTokenLifetimeSeconds ?? 43_200;
  if (
    !Number.isSafeInteger(maximumAccessTokenLifetimeSeconds) ||
    maximumAccessTokenLifetimeSeconds < 60 ||
    maximumAccessTokenLifetimeSeconds > 600 ||
    !Number.isSafeInteger(maximumRefreshTokenLifetimeSeconds) ||
    maximumRefreshTokenLifetimeSeconds < 900 ||
    maximumRefreshTokenLifetimeSeconds > 43_200
  ) {
    throw invalidConfiguration();
  }
  const requestTimeoutMs = input.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maximumResponseBytes = input.maximumResponseBytes ?? DEFAULT_MAXIMUM_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(requestTimeoutMs) ||
    requestTimeoutMs < 500 ||
    requestTimeoutMs > 15_000 ||
    !Number.isSafeInteger(maximumResponseBytes) ||
    maximumResponseBytes < 4_096 ||
    maximumResponseBytes > 131_072
  ) {
    throw invalidConfiguration();
  }
  const replayDescriptions = input.confirmedReplayErrorDescriptions ?? [];
  if (
    replayDescriptions.length > 8 ||
    replayDescriptions.some(
      (value) =>
        typeof value !== "string" ||
        value.length < 8 ||
        value.length > 256 ||
        value.trim() !== value ||
        /[\u0000\r\n]/.test(value)
    ) ||
    new Set(replayDescriptions).size !== replayDescriptions.length
  ) {
    throw invalidConfiguration();
  }
  return Object.freeze({
    productionLike: input.productionLike,
    issuer,
    tokenEndpoint,
    revocationEndpoint,
    jwksEndpoint,
    clientId: input.clientId,
    clientSecret: input.clientSecret,
    redirectUri,
    apiAudience: input.apiAudience,
    maximumAccessTokenLifetimeSeconds,
    maximumRefreshTokenLifetimeSeconds,
    requestTimeoutMs,
    maximumResponseBytes,
    confirmedReplayErrorDescriptions: Object.freeze([...replayDescriptions])
  });
}

function canonicalIssuer(value: string, productionLike: boolean): string {
  const canonical = canonicalUrl(value, productionLike);
  const url = new URL(canonical);
  if (!/^\/realms\/[a-z][a-z0-9-]{2,62}$/.test(url.pathname)) {
    throw invalidConfiguration();
  }
  return canonical;
}

function exactEndpoint(
  value: string,
  issuer: string,
  suffix: string,
  productionLike: boolean
): string {
  const endpoint = canonicalUrl(value, productionLike);
  if (endpoint !== `${issuer}${suffix}`) throw invalidConfiguration();
  return endpoint;
}

function canonicalUrl(value: string, productionLike: boolean): string {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 2_048 ||
    value.trim() !== value ||
    /[\u0000-\u001F\u007F\\]/.test(value)
  ) {
    throw invalidConfiguration();
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalidConfiguration();
  }
  const localHttp =
    !productionLike &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw invalidConfiguration();
  if (url.username || url.password || url.search || url.hash || (productionLike && url.port)) {
    throw invalidConfiguration();
  }
  const canonical = url.pathname === "/" ? url.origin : `${url.origin}${url.pathname}`;
  if (value !== canonical) throw invalidConfiguration();
  return canonical;
}

function assertExactExchangeConfiguration(
  input: {
    tokenEndpoint: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
  },
  configuration: NormalizedConfiguration
): void {
  if (
    input.tokenEndpoint !== configuration.tokenEndpoint ||
    input.clientId !== configuration.clientId ||
    input.clientSecret !== configuration.clientSecret ||
    input.redirectUri !== configuration.redirectUri
  ) {
    throw invalidConfiguration();
  }
}

function parseTokenResponse(response: KeycloakOidcHttpResponse): KeycloakTokenResponse {
  const value = parseJsonResponse(response);
  assertToken(value.access_token);
  assertToken(value.refresh_token);
  if (value.id_token !== undefined && value.id_token !== null) assertToken(value.id_token);
  const expiresIn = value.expires_in;
  const refreshExpiresIn = value.refresh_expires_in;
  if (
    value.token_type !== "Bearer" ||
    typeof expiresIn !== "number" ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn < 1 ||
    typeof refreshExpiresIn !== "number" ||
    !Number.isSafeInteger(refreshExpiresIn) ||
    refreshExpiresIn <= expiresIn
  ) {
    throw new Error("token response invalid");
  }
  return {
    access_token: value.access_token as string,
    refresh_token: value.refresh_token as string,
    id_token: (value.id_token as string | null | undefined) ?? null,
    token_type: "Bearer",
    expires_in: expiresIn,
    refresh_expires_in: refreshExpiresIn
  };
}

function tokenSetFromResponse(
  response: KeycloakTokenResponse,
  claims: Record<string, unknown>,
  now: Date,
  configuration: NormalizedConfiguration
): Cp14WebSessionTokenSet {
  const exp = Number(claims.exp);
  const iat = Number(claims.iat);
  if (
    !Number.isSafeInteger(exp) ||
    !Number.isSafeInteger(iat) ||
    exp <= iat ||
    exp - iat > configuration.maximumAccessTokenLifetimeSeconds ||
    Math.abs(exp * 1000 - (now.getTime() + response.expires_in * 1000)) > 60_000 ||
    response.refresh_expires_in > configuration.maximumRefreshTokenLifetimeSeconds
  ) {
    throw new Error("token lifetimes invalid");
  }
  const refreshExpiresAt = new Date(now.getTime() + response.refresh_expires_in * 1000);
  if (refreshExpiresAt.getTime() <= exp * 1000) throw new Error("refresh lifetime invalid");
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    idToken: response.id_token,
    accessExpiresAt: new Date(exp * 1000),
    refreshExpiresAt
  };
}

function validateJwtClaims(
  claims: Record<string, unknown>,
  input: {
    issuer: string;
    audience: string;
    now: Date;
    maximumLifetimeSeconds: number;
    kind: "access" | "id";
  }
): void {
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  const iat = claims.iat;
  const exp = claims.exp;
  const nbf = claims.nbf === undefined ? null : claims.nbf;
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (
    audiences.length < 1 ||
    audiences.length > 16 ||
    audiences.some(
      (audience) => typeof audience !== "string" || !/^[A-Za-z0-9._:-]{1,255}$/.test(audience)
    ) ||
    new Set(audiences).size !== audiences.length ||
    claims.iss !== input.issuer ||
    !audiences.includes(input.audience) ||
    typeof iat !== "number" ||
    !Number.isSafeInteger(iat) ||
    typeof exp !== "number" ||
    !Number.isSafeInteger(exp) ||
    iat > nowSeconds + 30 ||
    exp <= nowSeconds - 30 ||
    exp <= iat ||
    exp - iat > input.maximumLifetimeSeconds ||
    (nbf !== null &&
      (typeof nbf !== "number" || !Number.isSafeInteger(nbf) || nbf > nowSeconds + 30)) ||
    !requiredIdentifier(claims.sub)
  ) {
    throw new Error(`${input.kind} token claims invalid`);
  }
  if (
    input.kind === "id" &&
    ((audiences.length > 1 && claims.azp !== input.audience) ||
      (claims.azp !== undefined && claims.azp !== input.audience))
  ) {
    throw new Error("ID token authorized-party binding is invalid");
  }
}

function parseOauthError(response: KeycloakOidcHttpResponse): {
  error: string;
  error_description: string | null;
} {
  const value = parseJsonResponse(response);
  if (
    typeof value.error !== "string" ||
    !/^[a-z][a-z0-9_]{2,63}$/.test(value.error) ||
    (value.error_description !== undefined &&
      (typeof value.error_description !== "string" ||
        value.error_description.length > 256 ||
        /[\u0000\r\n]/.test(value.error_description)))
  ) {
    throw new Error("OAuth error invalid");
  }
  return {
    error: value.error,
    error_description: (value.error_description as string | undefined) ?? null
  };
}

function parseJsonResponse(response: KeycloakOidcHttpResponse): Record<string, unknown> {
  const contentType = response.headers["content-type"] ?? response.headers["Content-Type"];
  if (!contentType || !JSON_CONTENT_TYPE.test(contentType) || response.body.byteLength === 0) {
    throw new Error("provider response invalid");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body));
  } catch {
    throw new Error("provider JSON invalid");
  }
  if (!isRecord(value)) throw new Error("provider JSON shape invalid");
  return value;
}

function parseJwtSegment(value: string, maximumBytes: number): Record<string, unknown> {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, "base64url");
  } catch {
    throw new Error("JWT encoding invalid");
  }
  if (decoded.byteLength === 0 || decoded.byteLength > maximumBytes) {
    throw new Error("JWT segment outside bounds");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded));
  } catch {
    throw new Error("JWT JSON invalid");
  }
  if (!isRecord(parsed)) throw new Error("JWT JSON shape invalid");
  return parsed;
}

async function verifyJwtSignature(
  jwk: JsonWebKey,
  encodedHeader: string,
  encodedPayload: string,
  encodedSignature: string
): Promise<boolean> {
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return globalThis.crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    Buffer.from(encodedSignature, "base64url"),
    new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`)
  );
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > maximumBytes) {
    throw new KeycloakOidcTransportError("response_too_large");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    total += part.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new KeycloakOidcTransportError("response_too_large");
    }
    chunks.push(part.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function authenticationMethods(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 16 ||
    value.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("AMR invalid");
  }
  const result = [...new Set(value.map((entry) => entry.trim().toLowerCase()))];
  if (result.some((entry) => !/^[a-z0-9._:-]{1,64}$/.test(entry))) {
    throw new Error("AMR invalid");
  }
  return result.sort();
}

function authenticationContext(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !/^[\x21-\x7E]{1,255}$/.test(value)) {
    throw new Error("ACR invalid");
  }
  return value;
}

function optionalSessionIdentifier(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return requiredIdentifier(value);
}

function requiredIdentifier(value: unknown): string {
  if (typeof value !== "string" || !JWT_IDENTIFIER_PATTERN.test(value)) {
    throw new Error("identity claim invalid");
  }
  return value;
}

function requiredOpaqueClaim(value: unknown, minimum: number, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length < minimum ||
    value.length > maximum ||
    !/^[A-Za-z0-9._~-]+$/.test(value)
  ) {
    throw new Error("opaque claim invalid");
  }
  return value;
}

function assertToken(value: unknown): asserts value is string {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    throw new Error("token shape invalid");
  }
}

function cacheLifetimeSeconds(value: string | undefined): number {
  if (!value || /(?:^|,)\s*(?:no-store|no-cache)\b/i.test(value)) return 60;
  const match = /(?:^|,)\s*max-age=(\d{1,5})(?:,|$)/i.exec(value);
  if (!match) return 60;
  return Math.max(30, Math.min(300, Number(match[1])));
}

function trustedInstant(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error("invalid time");
  return new Date(value.getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidConfiguration(): KeycloakOidcClientError {
  return new KeycloakOidcClientError(
    "invalid_configuration",
    "Keycloak OIDC client configuration is invalid."
  );
}

function exchangeRejected(): KeycloakOidcClientError {
  return new KeycloakOidcClientError(
    "exchange_rejected",
    "Keycloak authorization-code exchange did not produce an accepted token result."
  );
}
