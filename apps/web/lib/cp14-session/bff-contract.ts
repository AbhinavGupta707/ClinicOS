const STATE_COOKIE_NAME_PRODUCTION = "__Host-clinicos_oauth_state";
const SAFE_HEADER_NAME = /^[a-z0-9-]{1,64}$/;
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface Cp14BffConfiguration {
  productionLike: boolean;
  issuer: string;
  mfaAssurancePolicy: Cp14MfaAssurancePolicy;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  clientId: string;
  clientSecret: string | null;
  apiAudience: string;
  webOrigin: string;
  callbackUri: string;
  apiBaseUrl: string;
  allowedApiPathPrefixes: readonly string[];
  stateCookieName?: string;
}

export interface Cp14MfaAssurancePolicy {
  policyId: string;
  reviewedRealmEvidenceId: string | null;
  acceptedAcrValues: readonly string[];
  primaryFactorAmrValues: readonly string[];
  secondaryFactorAmrValues: readonly string[];
  phishingResistantAmrValues: readonly string[];
}

export interface Cp14BffRequest {
  method: string;
  url: string;
  headers: Readonly<Record<string, Cp14HeaderValue>>;
  body?: Uint8Array | null;
}

export type Cp14HeaderValue = string | readonly string[] | null | undefined;

export interface Cp14WebSessionTokenSet {
  accessToken: string;
  refreshToken: string;
  idToken?: string | null;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export interface Cp14SafeWebSession {
  absoluteExpiresAt: string;
  csrfToken: string;
  acr: string | null;
  amr: readonly string[];
  mfaAssurancePolicyId: string;
  mfaVerified: boolean;
  shouldRotate: boolean;
}

export interface Cp14AuthorityResolver {
  resolve(input: { subject: string; issuer: string }): Promise<{
    active: boolean;
    authorityRevision: string;
  }>;
}

export interface Cp14TransactionsPort {
  begin(input: {
    channel: "web_bff";
    clientId: string;
    authorizationEndpoint: string;
    redirectUri: string;
    returnTo: string;
    productionLike: boolean;
    now: Date;
  }): Promise<{ authorizationUrl: string; state: string; expiresAt: string }>;
  complete(input: {
    callbackUrl: string;
    cookieState: string | null;
    expectedChannel: "web_bff";
    now: Date;
  }): Promise<{
    code: string;
    codeVerifier: string;
    nonce: string;
    clientId: string;
    redirectUri: string;
    returnTo: string;
  }>;
}

export interface Cp14WebSessionsPort {
  readonly cookieName: string;
  createAuthenticatedSession(input: {
    subject: string;
    issuer: string;
    authorizedParty: string;
    keycloakSessionId?: string | null;
    tokens: Cp14WebSessionTokenSet;
    authorityRevision: string;
    amr?: readonly string[];
    acr?: string | null;
    previousSessionId?: string | null;
    now: Date;
  }): Promise<{ cookie: string; csrfToken: string; safeSession: Cp14SafeWebSession }>;
  inspect(
    sessionId: string,
    authorityResolver: Cp14AuthorityResolver,
    now: Date
  ): Promise<Cp14SafeWebSession>;
  rotate(
    sessionId: string,
    authorityResolver: Cp14AuthorityResolver,
    now: Date
  ): Promise<{ cookie: string; csrfToken: string; safeSession: Cp14SafeWebSession }>;
  withAccessToken<T>(input: {
    sessionId: string;
    authorityResolver: Cp14AuthorityResolver;
    tokenRefresher: Cp14OidcTokenClient;
    now: Date;
    execute: (accessToken: string, session: Cp14SafeWebSession) => Promise<T>;
  }): Promise<T>;
  revoke(
    sessionId: string,
    reason: "logout",
    now: Date,
    providerRevoker: Cp14OidcTokenClient
  ): Promise<void>;
  parseSessionId(cookieHeader: Cp14HeaderValue): string | null;
  verifyCsrfToken(sessionId: string, suppliedToken: string | null | undefined): boolean;
  clearCookie(): string;
}

export interface Cp14BffSecurityPort {
  assertBoundary(request: Cp14BffRequest): void;
  assertMutation(request: Cp14BffRequest, verifyCsrfToken: (token: string) => boolean): void;
  sensitiveHeaders(): Readonly<Record<string, string>>;
}

export interface Cp14IdentityValidator {
  validate(
    claims: unknown,
    policy: {
      now: Date;
      expectedIssuer: string;
      requiredAudience: string;
      acceptedAuthorizedParties: readonly string[];
      mfaAssurancePolicy: Cp14MfaAssurancePolicy;
    }
  ): {
    subject: string;
    issuer: string;
    authorizedParty: string;
    keycloakSessionId: string;
    amr: readonly string[];
    acr: string | null;
  };
}

export interface Cp14BffResponse {
  status: number;
  headers: Readonly<Record<string, string | readonly string[]>>;
  body: Uint8Array | Readonly<Record<string, unknown>> | null;
}

export class Cp14BffError extends Error {
  readonly code:
    | "BAD_REQUEST"
    | "UNAUTHENTICATED"
    | "PERMISSION_DENIED"
    | "PAYLOAD_TOO_LARGE"
    | "UPSTREAM_REJECTED";

  constructor(code: Cp14BffError["code"], message: string) {
    super(message);
    this.name = "Cp14BffError";
    this.code = code;
  }
}

export interface Cp14OidcTokenClient {
  exchangeAuthorizationCode(input: {
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
  }>;
  refresh(input: {
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
  >;
  revoke(input: {
    refreshToken: string;
    subject: string;
    issuer: string;
    authorizedParty: string;
  }): Promise<void>;
}

export interface Cp14ApiTransport {
  send(input: {
    url: string;
    method: string;
    headers: Readonly<Record<string, string>>;
    body: Uint8Array | null;
    timeoutMs: number;
    maximumResponseBytes: number;
  }): Promise<{
    status: number;
    headers: Readonly<Record<string, Cp14HeaderValue>>;
    body: Uint8Array;
  }>;
}

interface NormalizedBffConfiguration extends Cp14BffConfiguration {
  clientSecret: string;
  stateCookieName: string;
  apiBaseUrl: string;
  webOrigin: string;
}

export class Cp14BffRuntime {
  readonly #configuration: NormalizedBffConfiguration;
  readonly #security: Cp14BffSecurityPort;
  readonly #identity: Cp14IdentityValidator;
  readonly #transactions: Cp14TransactionsPort;
  readonly #sessions: Cp14WebSessionsPort;
  readonly #authorityResolver: Cp14AuthorityResolver;
  readonly #tokens: Cp14OidcTokenClient;
  readonly #api: Cp14ApiTransport;

  constructor(input: {
    configuration: Cp14BffConfiguration;
    security: Cp14BffSecurityPort;
    identity: Cp14IdentityValidator;
    transactions: Cp14TransactionsPort;
    sessions: Cp14WebSessionsPort;
    authorityResolver: Cp14AuthorityResolver;
    tokens: Cp14OidcTokenClient;
    api: Cp14ApiTransport;
  }) {
    this.#configuration = normalizeBffConfiguration(input.configuration);
    this.#security = input.security;
    this.#identity = input.identity;
    this.#transactions = input.transactions;
    this.#sessions = input.sessions;
    this.#authorityResolver = input.authorityResolver;
    this.#tokens = input.tokens;
    this.#api = input.api;
  }

  async beginLogin(request: Cp14BffRequest, now: Date): Promise<Cp14BffResponse> {
    assertMethod(request, "GET");
    this.#assertBoundary(request);
    const url = parseRequestUrl(request.url, this.#configuration.webOrigin);
    const returnTo = safeRelativeReturnPath(url.searchParams.get("returnTo") ?? "/");
    const begun = await this.#transactions.begin({
      channel: "web_bff",
      clientId: this.#configuration.clientId,
      authorizationEndpoint: this.#configuration.authorizationEndpoint,
      redirectUri: this.#configuration.callbackUri,
      returnTo,
      productionLike: this.#configuration.productionLike,
      now
    });
    return {
      status: 302,
      headers: {
        ...this.#security.sensitiveHeaders(),
        location: begun.authorizationUrl,
        "set-cookie": serializeStateCookie(
          this.#configuration.stateCookieName,
          begun.state,
          this.#configuration.productionLike,
          300
        )
      },
      body: null
    };
  }

  async completeLogin(request: Cp14BffRequest, now: Date): Promise<Cp14BffResponse> {
    assertMethod(request, "GET");
    this.#assertBoundary(request);
    const cookieHeader = header(request, "cookie");
    const state = parseCookie(cookieHeader, this.#configuration.stateCookieName);
    const completed = await this.#transactions.complete({
      callbackUrl: parseRequestUrl(request.url, this.#configuration.webOrigin).toString(),
      cookieState: state,
      expectedChannel: "web_bff",
      now
    });
    const exchanged = await this.#tokens.exchangeAuthorizationCode({
      tokenEndpoint: this.#configuration.tokenEndpoint,
      code: completed.code,
      codeVerifier: completed.codeVerifier,
      clientId: completed.clientId,
      clientSecret: this.#configuration.clientSecret,
      redirectUri: completed.redirectUri
    });
    const principal = this.#identity.validate(exchanged.claims, {
      now,
      expectedIssuer: this.#configuration.issuer,
      requiredAudience: this.#configuration.apiAudience,
      acceptedAuthorizedParties: [this.#configuration.clientId],
      mfaAssurancePolicy: this.#configuration.mfaAssurancePolicy
    });
    if (
      exchanged.idTokenNonce !== completed.nonce ||
      exchanged.idTokenSubject !== principal.subject
    ) {
      throw new Cp14BffError(
        "UNAUTHENTICATED",
        "OIDC ID-token nonce or subject does not match the login transaction."
      );
    }
    const authority = await this.#authorityResolver.resolve({
      subject: principal.subject,
      issuer: principal.issuer
    });
    if (!authority.active) {
      throw new Cp14BffError("UNAUTHENTICATED", "ClinicOS membership is inactive.");
    }
    const previousSessionId = this.#sessions.parseSessionId(cookieHeader);
    const created = await this.#sessions.createAuthenticatedSession({
      subject: principal.subject,
      issuer: principal.issuer,
      authorizedParty: principal.authorizedParty,
      keycloakSessionId: principal.keycloakSessionId,
      tokens: exchanged.tokens,
      authorityRevision: authority.authorityRevision,
      amr: principal.amr,
      acr: principal.acr,
      previousSessionId,
      now
    });
    this.#assertSessionMfaPolicy(created.safeSession);
    return {
      status: 303,
      headers: {
        ...this.#security.sensitiveHeaders(),
        location: completed.returnTo,
        "set-cookie": [
          created.cookie,
          clearStateCookie(this.#configuration.stateCookieName, this.#configuration.productionLike)
        ]
      },
      body: null
    };
  }

  async sessionStatus(request: Cp14BffRequest, now: Date): Promise<Cp14BffResponse> {
    assertMethod(request, "GET");
    this.#assertBoundary(request);
    const sessionId = this.#requireSessionId(request);
    let session = await this.#sessions.inspect(sessionId, this.#authorityResolver, now);
    this.#assertSessionMfaPolicy(session);
    let cookie: string | null = null;
    if (session.shouldRotate) {
      const rotated = await this.#sessions.rotate(sessionId, this.#authorityResolver, now);
      session = rotated.safeSession;
      this.#assertSessionMfaPolicy(session);
      cookie = rotated.cookie;
    }
    return {
      status: 200,
      headers: {
        ...this.#security.sensitiveHeaders(),
        "content-type": "application/json; charset=utf-8",
        ...(cookie ? { "set-cookie": cookie } : {})
      },
      body: {
        authenticated: true,
        expiresAt: session.absoluteExpiresAt,
        csrfToken: session.csrfToken,
        authenticationAssurance: session.acr,
        authenticationMethods: [...session.amr],
        mfaVerified: session.mfaVerified
      }
    };
  }

  async logout(request: Cp14BffRequest, now: Date): Promise<Cp14BffResponse> {
    assertMethod(request, "POST");
    const sessionId = this.#requireSessionId(request);
    this.#assertMutation(request, sessionId);
    let upstreamConfirmed = true;
    try {
      await this.#sessions.revoke(sessionId, "logout", now, this.#tokens);
    } catch (error) {
      if (!hasErrorCode(error, "refresh_rejected")) throw error;
      upstreamConfirmed = false;
    }
    return {
      status: upstreamConfirmed ? 204 : 503,
      headers: {
        ...this.#security.sensitiveHeaders(),
        "set-cookie": this.#sessions.clearCookie(),
        ...(upstreamConfirmed ? {} : { "retry-after": "30" })
      },
      body: upstreamConfirmed
        ? null
        : {
            error: {
              code: "IDENTITY_REVOCATION_UNCONFIRMED",
              message: "Local session ended; identity-provider revocation is not yet confirmed."
            }
          }
    };
  }

  async proxyApi(request: Cp14BffRequest, targetPath: string, now: Date): Promise<Cp14BffResponse> {
    const method = request.method.toUpperCase();
    if (!["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      throw new Cp14BffError("BAD_REQUEST", "BFF method is not accepted.");
    }
    const sessionId = this.#requireSessionId(request);
    if (MUTATION_METHODS.has(method)) this.#assertMutation(request, sessionId);
    else this.#assertBoundary(request);
    const body = request.body ? Buffer.from(request.body) : null;
    if (body && body.byteLength > 1_048_576) {
      throw new Cp14BffError(
        "PAYLOAD_TOO_LARGE",
        "BFF request body exceeds the configured byte limit."
      );
    }
    const url = this.#apiTarget(targetPath);
    return this.#sessions.withAccessToken({
      sessionId,
      authorityResolver: this.#authorityResolver,
      tokenRefresher: this.#tokens,
      now,
      execute: async (accessToken, session) => {
        this.#assertSessionMfaPolicy(session);
        const response = await this.#api.send({
          url,
          method,
          headers: {
            accept: acceptedHeader(request, "accept", "application/json"),
            ...(body
              ? { "content-type": acceptedHeader(request, "content-type", "application/json") }
              : {}),
            authorization: `Bearer ${accessToken}`,
            ...(header(request, "x-clinic-id")
              ? { "x-clinic-id": acceptedHeader(request, "x-clinic-id", "") }
              : {}),
            ...(header(request, "idempotency-key")
              ? { "idempotency-key": acceptedHeader(request, "idempotency-key", "") }
              : {}),
            ...(header(request, "if-match")
              ? { "if-match": acceptedHeader(request, "if-match", "") }
              : {})
          },
          body,
          timeoutMs: 15_000,
          maximumResponseBytes: 2_097_152
        });
        const upstreamHeaders = validateUpstreamResponseHeaders(response.headers);
        return {
          status: response.status,
          headers: {
            ...this.#security.sensitiveHeaders(),
            ...upstreamHeaders
          },
          body: response.body
        };
      }
    });
  }

  #assertBoundary(request: Cp14BffRequest): void {
    this.#security.assertBoundary(request);
  }

  #assertMutation(request: Cp14BffRequest, sessionId: string): void {
    this.#security.assertMutation(request, (token) =>
      this.#sessions.verifyCsrfToken(sessionId, token)
    );
  }

  #requireSessionId(request: Cp14BffRequest): string {
    const sessionId = this.#sessions.parseSessionId(header(request, "cookie"));
    if (!sessionId) {
      throw new Cp14BffError("UNAUTHENTICATED", "Web session is required.");
    }
    return sessionId;
  }

  #apiTarget(targetPath: string): string {
    const relative = safeRelativeReturnPath(targetPath);
    const target = new URL(relative, this.#configuration.apiBaseUrl);
    if (
      target.origin !== new URL(this.#configuration.apiBaseUrl).origin ||
      target.hash ||
      !this.#configuration.allowedApiPathPrefixes.some(
        (prefix) => target.pathname === prefix || target.pathname.startsWith(`${prefix}/`)
      )
    ) {
      throw new Cp14BffError("PERMISSION_DENIED", "BFF API destination is not allowlisted.");
    }
    return target.toString();
  }

  #assertSessionMfaPolicy(session: Cp14SafeWebSession): void {
    if (
      session.mfaAssurancePolicyId !== this.#configuration.mfaAssurancePolicy.policyId ||
      session.mfaVerified !==
        hasConfiguredMfaEvidence(session, this.#configuration.mfaAssurancePolicy)
    ) {
      throw new Cp14BffError(
        "UNAUTHENTICATED",
        "Web session MFA assurance does not match the configured reviewed policy."
      );
    }
  }
}

function normalizeBffConfiguration(
  configuration: Cp14BffConfiguration
): NormalizedBffConfiguration {
  if (!configuration.clientSecret || Buffer.byteLength(configuration.clientSecret) < 32) {
    throw new Error("Web BFF client secret is missing or shorter than 32 bytes.");
  }
  const issuer = canonicalKeycloakIssuerUrl(configuration.issuer, configuration.productionLike);
  const mfaAssurancePolicy = normalizeBffMfaAssurancePolicy(configuration.mfaAssurancePolicy);
  const authorizationEndpoint = trustedServerUrl(
    configuration.authorizationEndpoint,
    configuration.productionLike,
    "authorization endpoint"
  );
  const tokenEndpoint = trustedServerUrl(
    configuration.tokenEndpoint,
    configuration.productionLike,
    "token endpoint"
  );
  const revocationEndpoint = trustedServerUrl(
    configuration.revocationEndpoint,
    configuration.productionLike,
    "revocation endpoint"
  );
  const exactOidcPaths = new Map<URL, string>([
    [authorizationEndpoint, `${issuer.pathname}/protocol/openid-connect/auth`],
    [tokenEndpoint, `${issuer.pathname}/protocol/openid-connect/token`],
    [revocationEndpoint, `${issuer.pathname}/protocol/openid-connect/revoke`]
  ]);
  for (const [endpoint, expectedPath] of exactOidcPaths) {
    if (endpoint.origin !== issuer.origin || endpoint.pathname !== expectedPath) {
      throw new Error("OIDC endpoint does not match its exact standard issuer path.");
    }
  }
  const webOrigin = trustedOrigin(configuration.webOrigin, configuration.productionLike);
  const callback = trustedServerUrl(
    configuration.callbackUri,
    configuration.productionLike,
    "callback URI"
  );
  if (
    callback.origin !== webOrigin ||
    callback.pathname === "/" ||
    callback.pathname.includes("%") ||
    callback.pathname.includes("//")
  )
    throw new Error("BFF callback must use one canonical path on the configured web origin.");
  const apiBase = trustedServerUrl(
    configuration.apiBaseUrl,
    configuration.productionLike,
    "API base URL",
    "slash"
  );
  if (apiBase.pathname !== "/") {
    throw new Error("BFF API base URL must be an exact origin root.");
  }
  if (
    configuration.allowedApiPathPrefixes.length === 0 ||
    configuration.allowedApiPathPrefixes.some(
      (prefix) => !prefix.startsWith("/v1/") || prefix.includes("..") || prefix.includes("\\")
    )
  ) {
    throw new Error("BFF API allowlist must contain explicit /v1/ path prefixes.");
  }
  const stateCookieName =
    configuration.stateCookieName ??
    (configuration.productionLike ? STATE_COOKIE_NAME_PRODUCTION : "clinicos_oauth_state");
  if (
    !/^(?:__Host-)?[A-Za-z0-9_-]{3,64}$/.test(stateCookieName) ||
    (configuration.productionLike && !stateCookieName.startsWith("__Host-"))
  ) {
    throw new Error("OAuth state cookie name is invalid.");
  }
  return Object.freeze({
    ...configuration,
    issuer: `${issuer.origin}${issuer.pathname}`,
    mfaAssurancePolicy,
    authorizationEndpoint: authorizationEndpoint.toString(),
    tokenEndpoint: tokenEndpoint.toString(),
    revocationEndpoint: revocationEndpoint.toString(),
    webOrigin,
    callbackUri: callback.toString(),
    apiBaseUrl: apiBase.toString(),
    clientSecret: configuration.clientSecret,
    stateCookieName,
    allowedApiPathPrefixes: [...new Set(configuration.allowedApiPathPrefixes)].sort()
  });
}

function parseRequestUrl(value: string, base: string): URL {
  let url: URL;
  try {
    url = new URL(value, base);
  } catch {
    throw new Cp14BffError("BAD_REQUEST", "BFF request URL is malformed.");
  }
  if (url.origin !== base) {
    throw new Cp14BffError("PERMISSION_DENIED", "BFF request origin is not trusted.");
  }
  return url;
}

function trustedServerUrl(
  value: string,
  productionLike: boolean,
  label: string,
  rootForm: "origin" | "slash" = "origin"
): URL {
  if (
    typeof value !== "string" ||
    value.length < 8 ||
    value.length > 2048 ||
    value.trim() !== value ||
    /[\u0000-\u001F\u007F\\]/.test(value)
  ) {
    throw new Error(`BFF ${label} is malformed or unbounded.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`BFF ${label} is malformed.`);
  }
  const localHttp =
    !productionLike &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !localHttp) throw new Error(`BFF ${label} must use HTTPS.`);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(`BFF ${label} contains forbidden components.`);
  if (productionLike && url.port) throw new Error(`BFF ${label} cannot use a production port.`);
  const canonical =
    url.pathname === "/" && rootForm === "origin" ? url.origin : `${url.origin}${url.pathname}`;
  if (value !== canonical) {
    throw new Error(`BFF ${label} is not in canonical form.`);
  }
  return url;
}

function canonicalKeycloakIssuerUrl(value: string, productionLike: boolean): URL {
  const issuer = trustedServerUrl(value, productionLike, "issuer");
  if (!/^\/realms\/[a-z][a-z0-9-]{2,62}$/.test(issuer.pathname)) {
    throw new Error("BFF issuer must use one canonical bounded Keycloak realm path.");
  }
  return issuer;
}

function trustedOrigin(value: string, productionLike: boolean): string {
  const url = trustedServerUrl(value, productionLike, "web origin");
  if (url.pathname !== "/" || url.search)
    throw new Error("BFF web origin cannot include a path or query.");
  return url.origin;
}

function normalizeBffMfaAssurancePolicy(policy: Cp14MfaAssurancePolicy): Cp14MfaAssurancePolicy {
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(policy.policyId)) {
    throw new Error("BFF MFA assurance policy id is malformed.");
  }
  if (
    policy.reviewedRealmEvidenceId !== null &&
    !/^[A-Za-z0-9._:-]{8,128}$/.test(policy.reviewedRealmEvidenceId)
  ) {
    throw new Error("BFF MFA realm-evidence id is malformed.");
  }
  const acceptedAcrValues = exactPolicyValues(
    policy.acceptedAcrValues,
    /^[\x21-\x7E]{1,255}$/,
    "ACR"
  );
  if (acceptedAcrValues.some((value) => value.includes("*"))) {
    throw new Error("BFF MFA ACR allowlist cannot contain wildcards.");
  }
  const primaryFactorAmrValues = exactPolicyValues(
    policy.primaryFactorAmrValues,
    /^[a-z0-9._:-]{1,64}$/,
    "primary AMR"
  );
  const secondaryFactorAmrValues = exactPolicyValues(
    policy.secondaryFactorAmrValues,
    /^[a-z0-9._:-]{1,64}$/,
    "secondary AMR"
  );
  const phishingResistantAmrValues = exactPolicyValues(
    policy.phishingResistantAmrValues,
    /^[a-z0-9._:-]{1,64}$/,
    "phishing-resistant AMR"
  );
  const allAmr = [
    ...primaryFactorAmrValues,
    ...secondaryFactorAmrValues,
    ...phishingResistantAmrValues
  ];
  if (new Set(allAmr).size !== allAmr.length) {
    throw new Error("BFF MFA AMR factor classes must be disjoint.");
  }
  if (
    !policy.reviewedRealmEvidenceId &&
    (acceptedAcrValues.length > 0 || phishingResistantAmrValues.length > 0)
  ) {
    throw new Error("BFF ACR and single-factor MFA evidence require reviewed realm evidence.");
  }
  return Object.freeze({
    policyId: policy.policyId,
    reviewedRealmEvidenceId: policy.reviewedRealmEvidenceId,
    acceptedAcrValues: Object.freeze(acceptedAcrValues),
    primaryFactorAmrValues: Object.freeze(primaryFactorAmrValues),
    secondaryFactorAmrValues: Object.freeze(secondaryFactorAmrValues),
    phishingResistantAmrValues: Object.freeze(phishingResistantAmrValues)
  });
}

function hasConfiguredMfaEvidence(
  session: Pick<Cp14SafeWebSession, "amr" | "acr">,
  policy: Cp14MfaAssurancePolicy
): boolean {
  const methods = [
    ...new Set(session.amr.map((value) => value.trim().toLowerCase()).filter(Boolean))
  ];
  if (methods.some((value) => !/^[a-z0-9._:-]{1,64}$/.test(value))) {
    throw new Cp14BffError("UNAUTHENTICATED", "Web session AMR evidence is malformed.");
  }
  if (
    session.acr !== null &&
    (!/^[\x21-\x7E]{1,255}$/.test(session.acr) || session.acr.trim() !== session.acr)
  ) {
    throw new Cp14BffError("UNAUTHENTICATED", "Web session ACR evidence is malformed.");
  }
  if (
    policy.reviewedRealmEvidenceId &&
    session.acr !== null &&
    policy.acceptedAcrValues.includes(session.acr)
  ) {
    return true;
  }
  if (
    policy.reviewedRealmEvidenceId &&
    methods.some((method) => policy.phishingResistantAmrValues.includes(method))
  ) {
    return true;
  }
  return (
    methods.some((method) => policy.primaryFactorAmrValues.includes(method)) &&
    methods.some((method) => policy.secondaryFactorAmrValues.includes(method))
  );
}

function exactPolicyValues(values: readonly string[], pattern: RegExp, label: string): string[] {
  if (!Array.isArray(values) || values.length > 32) {
    throw new Error(`BFF MFA ${label} allowlist is unbounded.`);
  }
  if (values.some((value) => !pattern.test(value) || value.trim() !== value)) {
    throw new Error(`BFF MFA ${label} allowlist is malformed.`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`BFF MFA ${label} allowlist contains duplicates.`);
  }
  return [...values].sort();
}

function serializeStateCookie(
  name: string,
  value: string,
  productionLike: boolean,
  maxAge: number
): string {
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    "Priority=High"
  ];
  if (productionLike) attributes.push("Secure");
  return attributes.join("; ");
}

function clearStateCookie(name: string, productionLike: boolean): string {
  const attributes = [
    `${name}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Priority=High"
  ];
  if (productionLike) attributes.push("Secure");
  return attributes.join("; ");
}

function parseCookie(headerValue: Cp14HeaderValue, name: string): string | null {
  if (!headerValue) return null;
  if (typeof headerValue !== "string") {
    throw new Cp14BffError("BAD_REQUEST", "Multiple Cookie headers are not accepted.");
  }
  const values = headerValue
    .split(";")
    .map((part) => part.trim().split("=", 2))
    .filter(([cookieName]) => cookieName === name)
    .map(([, value]) => value ?? "");
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{32,256}$/.test(values[0]!)) {
    throw new Cp14BffError("UNAUTHENTICATED", "OAuth state cookie is missing or malformed.");
  }
  return values[0]!;
}

function header(request: Cp14BffRequest, name: string): Cp14HeaderValue {
  return request.headers[name] ?? request.headers[name.toLowerCase()];
}

function acceptedHeader(request: Cp14BffRequest, name: string, fallback: string): string {
  const value = header(request, name);
  if (!value) return fallback;
  if (typeof value !== "string" || value.length > 512 || /[\r\n]/.test(value)) {
    throw new Cp14BffError("BAD_REQUEST", "BFF request header is malformed.");
  }
  if (!SAFE_HEADER_NAME.test(name)) throw new Error("BFF forwarded header name is invalid.");
  return value;
}

function validateUpstreamResponseHeaders(
  headers: Readonly<Record<string, Cp14HeaderValue>>
): Readonly<Record<string, string>> {
  const selected = new Map<string, string>();
  const allowed = new Set(["content-type", "etag", "retry-after", "x-request-id"]);
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (!allowed.has(name) || rawValue === undefined || rawValue === null) continue;
    if (selected.has(name) || typeof rawValue !== "string") {
      throw new Cp14BffError(
        "UPSTREAM_REJECTED",
        "Upstream response contains an ambiguous allowlisted header."
      );
    }
    if (rawValue.length === 0 || rawValue.length > 512 || !/^[\x20-\x7E]+$/.test(rawValue)) {
      throw new Cp14BffError(
        "UPSTREAM_REJECTED",
        "Upstream response contains a malformed allowlisted header."
      );
    }
    selected.set(name, rawValue);
  }

  const contentType = selected.get("content-type") ?? "application/json; charset=utf-8";
  if (!/^application\/(?:json|problem\+json)(?:;\s*charset=utf-8)?$/i.test(contentType)) {
    throw new Cp14BffError("UPSTREAM_REJECTED", "Upstream response content type is not accepted.");
  }
  const result: Record<string, string> = { "content-type": contentType.toLowerCase() };

  const etag = selected.get("etag");
  if (etag) {
    if (etag.length > 128 || !/^(?:W\/)?"[\x21\x23-\x7E]{1,96}"$/.test(etag)) {
      throw new Cp14BffError("UPSTREAM_REJECTED", "Upstream ETag is malformed.");
    }
    result.etag = etag;
  }

  const retryAfter = selected.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (!/^\d{1,5}$/.test(retryAfter) || !Number.isSafeInteger(seconds) || seconds > 3600) {
      throw new Cp14BffError("UPSTREAM_REJECTED", "Upstream Retry-After is malformed.");
    }
    result["retry-after"] = retryAfter;
  }

  const requestId = selected.get("x-request-id");
  if (requestId) {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(requestId)) {
      throw new Cp14BffError("UPSTREAM_REJECTED", "Upstream request id is malformed.");
    }
    result["x-request-id"] = requestId;
  }
  return Object.freeze(result);
}

function assertMethod(request: Cp14BffRequest, expected: string): void {
  if (request.method.toUpperCase() !== expected) {
    throw new Cp14BffError("BAD_REQUEST", "BFF request method is not accepted.");
  }
}

function safeRelativeReturnPath(value: string): string {
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    value.includes("\u0000") ||
    /[\r\n]/.test(value)
  ) {
    throw new Cp14BffError("PERMISSION_DENIED", "BFF destination must be a same-origin path.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value, "https://clinicos.invalid");
  } catch {
    throw new Cp14BffError("BAD_REQUEST", "BFF destination is malformed.");
  }
  if (parsed.origin !== "https://clinicos.invalid") {
    throw new Cp14BffError("PERMISSION_DENIED", "BFF destination must be same-origin.");
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function hasErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}
