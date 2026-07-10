import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const OAUTH_VALUE_PATTERN = /^[A-Za-z0-9._~-]{32,256}$/;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9._:-]{3,128}$/;
const CALLBACK_TOKEN_PARAMETERS = new Set([
  "access_token",
  "id_token",
  "refresh_token",
  "token",
  "code_verifier"
]);

export type OAuthClientChannel = "web_bff" | "mobile";

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

export interface OAuthTransactionRecord {
  channel: OAuthClientChannel;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Production implementations must make create-if-absent and consume-once atomic. The state value is
 * never stored directly; callers pass an HMAC-derived lookup key.
 */
export interface OAuthTransactionStore {
  readonly atomicity: "create_if_absent_and_consume_once";
  create(
    transactionKey: string,
    transaction: OAuthTransactionRecord,
    expiresAt: Date
  ): Promise<boolean>;
  consume(transactionKey: string, now: Date): Promise<OAuthTransactionRecord | null>;
}

export interface BeginAuthorizationInput {
  channel: OAuthClientChannel;
  clientId: string;
  authorizationEndpoint: string;
  redirectUri: string;
  scopes?: readonly string[];
  returnTo?: string;
  now: Date;
  ttlSeconds?: number;
  productionLike: boolean;
}

export interface BegunAuthorization {
  authorizationUrl: string;
  state: string;
  expiresAt: string;
}

export interface CompletedAuthorization {
  code: string;
  codeVerifier: string;
  nonce: string;
  clientId: string;
  redirectUri: string;
  returnTo: string;
}

export class OAuthFlowError extends Error {
  readonly code:
    | "invalid_configuration"
    | "invalid_callback"
    | "invalid_state"
    | "expired_transaction"
    | "replayed_transaction";

  constructor(code: OAuthFlowError["code"], message: string) {
    super(message);
    this.name = "OAuthFlowError";
    this.code = code;
  }
}

export class OAuthTransactionManager {
  readonly #store: OAuthTransactionStore;
  readonly #stateHmacKey: Buffer;
  readonly #randomBytes: (size: number) => Buffer;

  constructor(input: {
    store: OAuthTransactionStore;
    stateHmacKey: Uint8Array;
    randomBytesImpl?: (size: number) => Buffer;
  }) {
    if (input.store.atomicity !== "create_if_absent_and_consume_once") {
      throw new Error("OAuth transaction storage must provide atomic single-use semantics.");
    }
    this.#stateHmacKey = copyKey(input.stateHmacKey, "OAuth state HMAC key");
    this.#store = input.store;
    this.#randomBytes = input.randomBytesImpl ?? randomBytes;
  }

  async begin(input: BeginAuthorizationInput): Promise<BegunAuthorization> {
    const now = trustedInstant(input.now, "OAuth transaction creation time");
    const ttlSeconds = input.ttlSeconds ?? 300;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 600) {
      throw new OAuthFlowError(
        "invalid_configuration",
        "OAuth transaction TTL must be between 60 and 600 seconds."
      );
    }
    assertClientId(input.clientId);
    const authorizationEndpoint = trustedHttpsUrl(
      input.authorizationEndpoint,
      input.productionLike,
      "authorization endpoint"
    );
    const redirectUri = trustedRedirectUri(input.redirectUri, input.channel, input.productionLike);
    const returnTo = safeRelativeReturnPath(input.returnTo ?? "/");
    const scopes = normalizeScopes(input.scopes ?? ["openid", "profile", "email"]);
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = randomBase64Url(this.#randomBytes, 32);
      const nonce = randomBase64Url(this.#randomBytes, 32);
      const pkce = createPkcePair(this.#randomBytes);
      const transaction: OAuthTransactionRecord = {
        channel: input.channel,
        clientId: input.clientId,
        redirectUri: redirectUri.toString(),
        codeVerifier: pkce.codeVerifier,
        nonce,
        returnTo,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString()
      };
      const created = await this.#store.create(this.#stateKey(state), transaction, expiresAt);
      if (!created) continue;

      authorizationEndpoint.search = "";
      authorizationEndpoint.hash = "";
      authorizationEndpoint.searchParams.set("client_id", input.clientId);
      authorizationEndpoint.searchParams.set("redirect_uri", redirectUri.toString());
      authorizationEndpoint.searchParams.set("response_type", "code");
      authorizationEndpoint.searchParams.set("response_mode", "query");
      authorizationEndpoint.searchParams.set("scope", scopes.join(" "));
      authorizationEndpoint.searchParams.set("state", state);
      authorizationEndpoint.searchParams.set("nonce", nonce);
      authorizationEndpoint.searchParams.set("code_challenge", pkce.codeChallenge);
      authorizationEndpoint.searchParams.set("code_challenge_method", "S256");

      return {
        authorizationUrl: authorizationEndpoint.toString(),
        state,
        expiresAt: expiresAt.toISOString()
      };
    }

    throw new OAuthFlowError(
      "invalid_configuration",
      "OAuth transaction storage rejected unique state creation."
    );
  }

  async complete(input: {
    callbackUrl: string;
    cookieState: string | null;
    expectedChannel: OAuthClientChannel;
    now: Date;
  }): Promise<CompletedAuthorization> {
    const now = trustedInstant(input.now, "OAuth callback time");
    const callback = parseAuthorizationCodeCallback(input.callbackUrl);
    if (!input.cookieState || !secureEqual(callback.state, input.cookieState)) {
      throw new OAuthFlowError(
        "invalid_state",
        "OAuth callback state does not match the login transaction."
      );
    }

    const transaction = await this.#store.consume(this.#stateKey(callback.state), now);
    if (!transaction) {
      throw new OAuthFlowError(
        "replayed_transaction",
        "OAuth login transaction is missing, expired, or already consumed."
      );
    }
    if (transaction.channel !== input.expectedChannel) {
      throw new OAuthFlowError("invalid_state", "OAuth login transaction channel does not match.");
    }
    validateConsumedTransaction(transaction, callback.url, now);
    const expiresAt = new Date(transaction.expiresAt);
    if (expiresAt.getTime() <= now.getTime()) {
      throw new OAuthFlowError("expired_transaction", "OAuth login transaction has expired.");
    }

    return {
      code: callback.code,
      codeVerifier: transaction.codeVerifier,
      nonce: transaction.nonce,
      clientId: transaction.clientId,
      redirectUri: transaction.redirectUri,
      returnTo: transaction.returnTo
    };
  }

  #stateKey(state: string): string {
    if (!OAUTH_VALUE_PATTERN.test(state)) {
      throw new OAuthFlowError("invalid_state", "OAuth state is malformed.");
    }
    return createHmac("sha256", this.#stateHmacKey)
      .update(`oauth-state\u0000${state}`)
      .digest("hex");
  }
}

export function createPkcePair(randomBytesImpl: (size: number) => Buffer = randomBytes): PkcePair {
  const codeVerifier = randomBase64Url(randomBytesImpl, 64);
  assertPkceVerifier(codeVerifier);
  return {
    codeVerifier,
    codeChallenge: createHash("sha256").update(codeVerifier, "ascii").digest("base64url"),
    codeChallengeMethod: "S256"
  };
}

export function parseAuthorizationCodeCallback(callbackUrl: string): {
  code: string;
  state: string;
  url: URL;
} {
  let url: URL;
  try {
    url = new URL(callbackUrl);
  } catch {
    throw new OAuthFlowError("invalid_callback", "OAuth callback URL is malformed.");
  }
  if (url.hash) {
    throw new OAuthFlowError("invalid_callback", "OAuth callback fragments are not accepted.");
  }
  for (const parameter of CALLBACK_TOKEN_PARAMETERS) {
    if (url.searchParams.has(parameter)) {
      throw new OAuthFlowError(
        "invalid_callback",
        "OAuth tokens and verifier material are never accepted in callback URLs."
      );
    }
  }
  const error = singleParameter(url.searchParams, "error", false);
  if (error) {
    throw new OAuthFlowError("invalid_callback", "Identity provider rejected the login request.");
  }
  const code = singleParameter(url.searchParams, "code", true);
  const state = singleParameter(url.searchParams, "state", true);
  if (!OAUTH_VALUE_PATTERN.test(code) || !OAUTH_VALUE_PATTERN.test(state)) {
    throw new OAuthFlowError("invalid_callback", "OAuth callback code or state is malformed.");
  }
  return { code, state, url };
}

export function safeRelativeReturnPath(value: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("\u0000") ||
    /[\r\n]/.test(value)
  ) {
    throw new OAuthFlowError(
      "invalid_configuration",
      "OAuth return path must be a same-origin path."
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value, "https://clinicos.invalid");
  } catch {
    throw new OAuthFlowError("invalid_configuration", "OAuth return path is malformed.");
  }
  if (parsed.origin !== "https://clinicos.invalid") {
    throw new OAuthFlowError("invalid_configuration", "OAuth return path must be same-origin.");
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

export function assertPkceVerifier(value: string): void {
  if (value.length < 43 || value.length > 128 || !BASE64URL_PATTERN.test(value)) {
    throw new OAuthFlowError(
      "invalid_configuration",
      "PKCE verifier must be 43-128 base64url characters."
    );
  }
}

function trustedRedirectUri(
  value: string,
  channel: OAuthClientChannel,
  productionLike: boolean
): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OAuthFlowError("invalid_configuration", "OAuth redirect URI is malformed.");
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new OAuthFlowError(
      "invalid_configuration",
      "OAuth redirect URI contains forbidden components."
    );
  }
  if (parsed.search) {
    throw new OAuthFlowError(
      "invalid_configuration",
      "OAuth redirect URI query parameters are not accepted."
    );
  }
  if (channel === "web_bff") {
    if (productionLike && parsed.protocol !== "https:") {
      throw new OAuthFlowError("invalid_configuration", "Production web callback must use HTTPS.");
    }
    if (!productionLike && !["http:", "https:"].includes(parsed.protocol)) {
      throw new OAuthFlowError("invalid_configuration", "Web callback must use HTTP or HTTPS.");
    }
  } else if (!["https:", "clinic-os:"].includes(parsed.protocol)) {
    throw new OAuthFlowError(
      "invalid_configuration",
      "Mobile callback must use the claimed HTTPS link or the registered ClinicOS app scheme."
    );
  }
  return parsed;
}

function validateConsumedTransaction(
  transaction: OAuthTransactionRecord,
  callback: URL,
  now: Date
): void {
  assertClientId(transaction.clientId);
  assertPkceVerifier(transaction.codeVerifier);
  if (!OAUTH_VALUE_PATTERN.test(transaction.nonce)) {
    throw new OAuthFlowError("invalid_state", "OAuth transaction nonce is malformed.");
  }
  if (safeRelativeReturnPath(transaction.returnTo) !== transaction.returnTo) {
    throw new OAuthFlowError("invalid_state", "OAuth transaction return target is malformed.");
  }
  let redirect: URL;
  try {
    redirect = new URL(transaction.redirectUri);
  } catch {
    throw new OAuthFlowError("invalid_state", "OAuth transaction redirect URI is malformed.");
  }
  if (
    redirect.username ||
    redirect.password ||
    redirect.hash ||
    redirect.search ||
    callback.username ||
    callback.password ||
    callback.protocol !== redirect.protocol ||
    callback.hostname !== redirect.hostname ||
    callback.port !== redirect.port ||
    callback.pathname !== redirect.pathname
  ) {
    throw new OAuthFlowError(
      "invalid_state",
      "OAuth callback target does not match the transaction."
    );
  }
  const createdAt = new Date(transaction.createdAt);
  const expiresAt = new Date(transaction.expiresAt);
  if (
    Number.isNaN(createdAt.getTime()) ||
    Number.isNaN(expiresAt.getTime()) ||
    createdAt.getTime() > now.getTime() ||
    expiresAt.getTime() <= createdAt.getTime() ||
    expiresAt.getTime() - createdAt.getTime() > 600_000
  ) {
    throw new OAuthFlowError("invalid_state", "OAuth transaction timestamps are malformed.");
  }
}

function trustedHttpsUrl(value: string, productionLike: boolean, label: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OAuthFlowError("invalid_configuration", `OAuth ${label} is malformed.`);
  }
  const localHttp =
    !productionLike &&
    parsed.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new OAuthFlowError("invalid_configuration", `OAuth ${label} must use HTTPS.`);
  }
  if (parsed.username || parsed.password || parsed.hash) {
    throw new OAuthFlowError(
      "invalid_configuration",
      `OAuth ${label} contains forbidden components.`
    );
  }
  return parsed;
}

function normalizeScopes(scopes: readonly string[]): string[] {
  const normalized = [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))].sort();
  if (!normalized.includes("openid")) {
    throw new OAuthFlowError(
      "invalid_configuration",
      "OIDC authorization requires the openid scope."
    );
  }
  if (normalized.includes("offline_access")) {
    throw new OAuthFlowError(
      "invalid_configuration",
      "ClinicOS interactive clients do not request offline access."
    );
  }
  if (normalized.some((scope) => !/^[A-Za-z0-9._:-]{1,64}$/.test(scope))) {
    throw new OAuthFlowError(
      "invalid_configuration",
      "OIDC scope contains unsupported characters."
    );
  }
  return normalized;
}

function assertClientId(value: string): void {
  if (!CLIENT_ID_PATTERN.test(value)) {
    throw new OAuthFlowError("invalid_configuration", "OIDC client id is malformed.");
  }
}

function singleParameter(searchParams: URLSearchParams, name: string, required: boolean): string {
  const values = searchParams.getAll(name);
  if (values.length > 1) {
    throw new OAuthFlowError("invalid_callback", `OAuth callback contains duplicate ${name}.`);
  }
  const value = values[0]?.trim() ?? "";
  if (required && !value) {
    throw new OAuthFlowError("invalid_callback", `OAuth callback is missing ${name}.`);
  }
  return value;
}

function randomBase64Url(impl: (size: number) => Buffer, size: number): string {
  const value = impl(size).toString("base64url");
  if (!BASE64URL_PATTERN.test(value)) {
    throw new Error("Secure random generator did not produce base64url output.");
  }
  return value;
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function copyKey(value: Uint8Array, label: string): Buffer {
  const copy = Buffer.from(value);
  if (copy.byteLength < 32) throw new Error(`${label} must contain at least 32 bytes.`);
  return copy;
}

function trustedInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid injected instant.`);
  }
  return new Date(value.getTime());
}
