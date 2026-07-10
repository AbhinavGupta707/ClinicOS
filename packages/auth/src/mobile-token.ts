import type { OAuthTransactionManager } from "./oauth-pkce.ts";

const TOKEN_PATTERN = /^[\x21-\x7E]{16,32768}$/;
const VAULT_VERSION_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface MobileTokenEndpointResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  refresh_expires_in?: number;
  id_token?: string;
  scope?: string;
  session_state?: string;
  "not-before-policy"?: number;
}

export interface StoredMobileTokenSet {
  schemaVersion: 1;
  version: string;
  subject: string;
  issuer: string;
  authorizedParty: string;
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  accessExpiresAt: string;
  refreshExpiresAt: string;
  storedAt: string;
}

/**
 * Expo implementations must bind this contract to Keychain/Keystore through SecureStore with device
 * authentication and backup exclusion. Web Storage and unencrypted AsyncStorage cannot implement it.
 */
export interface MobileTokenVault {
  readonly kind: "os_secure_storage";
  readonly accessibility: "after_first_unlock_this_device_only" | "when_unlocked_this_device_only";
  readonly backupPolicy: "excluded";
  read(): Promise<StoredMobileTokenSet | null>;
  create(tokens: StoredMobileTokenSet): Promise<boolean>;
  compareAndSwap(expectedVersion: string, tokens: StoredMobileTokenSet): Promise<boolean>;
  purge(): Promise<void>;
}

export interface MobileTokenRefresher {
  refresh(refreshToken: string): Promise<{
    response: MobileTokenEndpointResponse;
    subject: string;
    issuer: string;
    authorizedParty: string;
  }>;
}

export interface MobileTokenRevoker {
  revoke(input: {
    refreshToken: string;
    subject: string;
    issuer: string;
    authorizedParty: string;
  }): Promise<void>;
}

export class MobileTokenError extends Error {
  readonly code:
    | "invalid_configuration"
    | "invalid_token_response"
    | "missing_tokens"
    | "expired_tokens"
    | "refresh_replay"
    | "identity_mismatch"
    | "revocation_unconfirmed";

  constructor(code: MobileTokenError["code"], message: string) {
    super(message);
    this.name = "MobileTokenError";
    this.code = code;
  }
}

export class MobileTokenManager {
  readonly #vault: MobileTokenVault;
  readonly #versionFactory: () => string;
  readonly #maximumRefreshLifetimeSeconds: number;
  readonly #expectedIssuer: string;
  readonly #acceptedAuthorizedParties: readonly string[];

  constructor(input: {
    vault: MobileTokenVault;
    versionFactory: () => string;
    expectedIssuer: string;
    acceptedAuthorizedParties: readonly [string, ...string[]];
    maximumRefreshLifetimeSeconds?: number;
  }) {
    if (
      input.vault.kind !== "os_secure_storage" ||
      input.vault.backupPolicy !== "excluded" ||
      !["after_first_unlock_this_device_only", "when_unlocked_this_device_only"].includes(
        input.vault.accessibility
      )
    ) {
      throw new MobileTokenError(
        "invalid_configuration",
        "Mobile tokens require device-only OS secure storage with backup exclusion."
      );
    }
    const maximumRefreshLifetimeSeconds = input.maximumRefreshLifetimeSeconds ?? 43_200;
    if (
      !Number.isSafeInteger(maximumRefreshLifetimeSeconds) ||
      maximumRefreshLifetimeSeconds < 900 ||
      maximumRefreshLifetimeSeconds > 86_400
    ) {
      throw new MobileTokenError(
        "invalid_configuration",
        "Mobile refresh lifetime must be between 15 minutes and 24 hours."
      );
    }
    this.#vault = input.vault;
    this.#versionFactory = input.versionFactory;
    this.#maximumRefreshLifetimeSeconds = maximumRefreshLifetimeSeconds;
    this.#expectedIssuer = normalizeExpectedIssuer(input.expectedIssuer);
    this.#acceptedAuthorizedParties = normalizeAuthorizedParties(input.acceptedAuthorizedParties);
  }

  async establish(input: {
    response: MobileTokenEndpointResponse;
    subject: string;
    issuer: string;
    authorizedParty: string;
    now: Date;
  }): Promise<void> {
    const record = this.#record(input);
    if (!(await this.#vault.create(record))) {
      await this.#vault.purge();
      throw new MobileTokenError(
        "refresh_replay",
        "A mobile token set already exists; interactive login must rotate from a clean vault."
      );
    }
  }

  async withAccessToken<T>(input: {
    now: Date;
    refresher: MobileTokenRefresher;
    execute: (accessToken: string) => Promise<T>;
  }): Promise<T> {
    const now = trustedInstant(input.now, "mobile token access time");
    let stored = await this.#vault.read();
    if (!stored)
      throw new MobileTokenError("missing_tokens", "Mobile authentication is unavailable.");
    validateStored(stored, this.#expectedIssuer, this.#acceptedAuthorizedParties);
    if (new Date(stored.refreshExpiresAt).getTime() <= now.getTime()) {
      await this.#vault.purge();
      throw new MobileTokenError("expired_tokens", "Mobile authentication has expired.");
    }
    if (new Date(stored.accessExpiresAt).getTime() - now.getTime() <= 60_000) {
      let refreshed: Awaited<ReturnType<MobileTokenRefresher["refresh"]>>;
      try {
        refreshed = await input.refresher.refresh(stored.refreshToken);
      } catch {
        await this.#vault.purge();
        throw new MobileTokenError("expired_tokens", "Mobile token refresh was rejected.");
      }
      if (
        refreshed.subject !== stored.subject ||
        refreshed.issuer !== stored.issuer ||
        refreshed.authorizedParty !== stored.authorizedParty
      ) {
        await this.#vault.purge();
        throw new MobileTokenError(
          "identity_mismatch",
          "Refreshed mobile identity does not match."
        );
      }
      const next = this.#record({
        response: refreshed.response,
        subject: stored.subject,
        issuer: stored.issuer,
        authorizedParty: stored.authorizedParty,
        now
      });
      if (!(await this.#vault.compareAndSwap(stored.version, next))) {
        await this.#vault.purge();
        throw new MobileTokenError(
          "refresh_replay",
          "Concurrent mobile refresh detected; token material was purged."
        );
      }
      stored = next;
    }
    return input.execute(stored.accessToken);
  }

  async logout(revoker: MobileTokenRevoker): Promise<void> {
    const stored = await this.#vault.read();
    await this.#vault.purge();
    if (!stored) return;
    validateStored(stored, this.#expectedIssuer, this.#acceptedAuthorizedParties);
    try {
      await revoker.revoke({
        refreshToken: stored.refreshToken,
        subject: stored.subject,
        issuer: stored.issuer,
        authorizedParty: stored.authorizedParty
      });
    } catch {
      throw new MobileTokenError(
        "revocation_unconfirmed",
        "Local mobile tokens were purged, but identity-provider revocation was not confirmed."
      );
    }
  }

  #record(input: {
    response: MobileTokenEndpointResponse;
    subject: string;
    issuer: string;
    authorizedParty: string;
    now: Date;
  }): StoredMobileTokenSet {
    const now = trustedInstant(input.now, "mobile token storage time");
    assertMobileIdentity(
      input.subject,
      input.issuer,
      input.authorizedParty,
      this.#expectedIssuer,
      this.#acceptedAuthorizedParties
    );
    const response = validateMobileTokenResponse(
      input.response,
      this.#maximumRefreshLifetimeSeconds
    );
    const version = this.#versionFactory();
    if (!VAULT_VERSION_PATTERN.test(version)) {
      throw new MobileTokenError("invalid_configuration", "Mobile vault version is malformed.");
    }
    return {
      schemaVersion: 1,
      version,
      subject: input.subject,
      issuer: input.issuer,
      authorizedParty: input.authorizedParty,
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      idToken: response.id_token ?? null,
      accessExpiresAt: new Date(now.getTime() + response.expires_in * 1000).toISOString(),
      refreshExpiresAt: new Date(
        now.getTime() + (response.refresh_expires_in ?? this.#maximumRefreshLifetimeSeconds) * 1000
      ).toISOString(),
      storedAt: now.toISOString()
    };
  }
}

export function validateMobileTokenResponse(
  response: MobileTokenEndpointResponse,
  maximumRefreshLifetimeSeconds = 43_200
): MobileTokenEndpointResponse {
  if (
    !response ||
    typeof response !== "object" ||
    typeof response.token_type !== "string" ||
    response.token_type.toLowerCase() !== "bearer" ||
    !TOKEN_PATTERN.test(response.access_token) ||
    !TOKEN_PATTERN.test(response.refresh_token)
  ) {
    throw new MobileTokenError(
      "invalid_token_response",
      "Mobile token endpoint response is malformed."
    );
  }
  if (
    !Number.isSafeInteger(response.expires_in) ||
    response.expires_in < 60 ||
    response.expires_in > 600
  ) {
    throw new MobileTokenError(
      "invalid_token_response",
      "Mobile access-token lifetime must be between 60 and 600 seconds."
    );
  }
  if (
    response.refresh_expires_in !== undefined &&
    (!Number.isSafeInteger(response.refresh_expires_in) ||
      response.refresh_expires_in <= response.expires_in ||
      response.refresh_expires_in > maximumRefreshLifetimeSeconds)
  ) {
    throw new MobileTokenError(
      "invalid_token_response",
      "Mobile refresh-token lifetime exceeds policy."
    );
  }
  return response;
}

/** Type-only anchor used by Expo integration to keep transaction state behind the same contract. */
export type MobileAuthorizationTransactionManager = OAuthTransactionManager;

function validateStored(
  stored: StoredMobileTokenSet,
  expectedIssuer: string,
  acceptedAuthorizedParties: readonly string[]
): void {
  if (
    stored.schemaVersion !== 1 ||
    !VAULT_VERSION_PATTERN.test(stored.version) ||
    !TOKEN_PATTERN.test(stored.accessToken) ||
    !TOKEN_PATTERN.test(stored.refreshToken) ||
    [stored.accessExpiresAt, stored.refreshExpiresAt, stored.storedAt].some((value) =>
      Number.isNaN(new Date(value).getTime())
    )
  ) {
    throw new MobileTokenError("invalid_token_response", "Stored mobile token set is malformed.");
  }
  assertMobileIdentity(
    stored.subject,
    stored.issuer,
    stored.authorizedParty,
    expectedIssuer,
    acceptedAuthorizedParties
  );
}

function normalizeExpectedIssuer(value: string): string {
  let issuer: URL;
  try {
    issuer = new URL(value);
  } catch {
    throw new MobileTokenError("invalid_configuration", "Mobile issuer is malformed.");
  }
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    throw new MobileTokenError("invalid_configuration", "Mobile issuer must use canonical HTTPS.");
  }
  return issuer.toString().replace(/\/$/, "");
}

function normalizeAuthorizedParties(values: readonly string[]): readonly string[] {
  const normalized = [...new Set(values)];
  if (
    normalized.length === 0 ||
    normalized.length !== values.length ||
    normalized.some((value) => !/^[A-Za-z0-9._:-]{3,128}$/.test(value))
  ) {
    throw new MobileTokenError(
      "invalid_configuration",
      "Mobile authorized-party allowlist is malformed."
    );
  }
  return Object.freeze(normalized.sort());
}

function assertMobileIdentity(
  subject: string,
  issuer: string,
  authorizedParty: string,
  expectedIssuer: string,
  acceptedAuthorizedParties: readonly string[]
): void {
  if (
    !subject ||
    Buffer.byteLength(subject) > 255 ||
    /[\u0000\r\n]/.test(subject) ||
    issuer !== expectedIssuer ||
    !acceptedAuthorizedParties.includes(authorizedParty)
  ) {
    throw new MobileTokenError("identity_mismatch", "Mobile token identity is not accepted.");
  }
}

function trustedInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${label} must be a valid injected instant.`);
  }
  return new Date(value.getTime());
}
