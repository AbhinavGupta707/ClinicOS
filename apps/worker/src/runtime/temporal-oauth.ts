export interface TemporalOAuthOptions {
  readonly tokenUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly token_type?: unknown;
  readonly expires_in?: unknown;
}

export class TemporalOAuthTokenProvider {
  readonly #options: TemporalOAuthOptions;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  readonly #sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  #token?: string;
  #refreshAtMs = 0;

  constructor(options: TemporalOAuthOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? fetch;
    this.#now = options.now ?? Date.now;
    this.#sleep = options.sleep ?? abortableSleep;
  }

  get currentToken(): string {
    if (!this.#token) throw new Error("Temporal OAuth token has not been initialized");
    return this.#token;
  }

  async refresh(signal?: AbortSignal): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.#options.clientId,
      client_secret: this.#options.clientSecret
    });
    const timeout = AbortSignal.timeout(10_000);
    const response = await this.#fetch(this.#options.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout
    });
    if (!response.ok) {
      throw new Error(`Temporal OAuth token endpoint returned ${response.status}`);
    }
    const result = (await response.json()) as TokenResponse;
    if (
      typeof result.access_token !== "string" ||
      result.access_token.length < 64 ||
      result.access_token.length > 16_384 ||
      result.token_type !== "Bearer" ||
      !Number.isInteger(result.expires_in) ||
      (result.expires_in as number) < 60 ||
      (result.expires_in as number) > 600
    ) {
      throw new Error("Temporal OAuth token response is malformed or outside the bounded lifetime");
    }
    const expectedIssuer = this.#options.tokenUrl.replace(
      /\/protocol\/openid-connect\/token$/u,
      ""
    );
    validateTokenClaims(result.access_token, expectedIssuer, this.#options.clientId);
    this.#token = result.access_token;
    this.#refreshAtMs =
      this.#now() + Math.max(10_000, (result.expires_in as number) * 1_000 - 60_000);
    return this.#token;
  }

  async run(signal: AbortSignal, onRefresh: (token: string) => Promise<void>): Promise<void> {
    while (!signal.aborted) {
      await this.#sleep(Math.max(1_000, this.#refreshAtMs - this.#now()), signal);
      if (signal.aborted) return;
      await onRefresh(await this.refresh(signal));
    }
  }
}

function validateTokenClaims(token: string, expectedIssuer: string, expectedClientId: string): void {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Temporal OAuth access token must be a JWT");
  let claims: unknown;
  try {
    claims = JSON.parse(Buffer.from(parts[1] as string, "base64url").toString("utf8"));
  } catch {
    throw new Error("Temporal OAuth access token payload is malformed");
  }
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) {
    throw new Error("Temporal OAuth access token claims are malformed");
  }
  const record = claims as Record<string, unknown>;
  const audience = Array.isArray(record.aud) ? record.aud : [record.aud];
  const permissions = record.permissions;
  if (
    typeof record.sub !== "string" ||
    record.iss !== expectedIssuer ||
    record.azp !== expectedClientId ||
    !audience.includes("clinic-os-temporal") ||
    !Array.isArray(permissions) ||
    !permissions.includes("default:worker") ||
    !permissions.includes("default:write")
  ) {
    throw new Error(
      "Temporal OAuth access token is missing its exact issuer, client, audience, or permissions"
    );
  }
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timeout = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true }
    );
  });
}
