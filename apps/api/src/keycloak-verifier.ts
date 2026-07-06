import { createPublicKey, createVerify, type KeyObject } from "node:crypto";
import type { KeycloakAccessTokenClaims } from "@clinic-os/auth";
import { ApiError } from "./errors.ts";

type JsonWebKey = Record<string, unknown> & { kid?: string };

interface JsonWebKeySet {
  keys: JsonWebKey[];
}

interface JwtHeader {
  alg?: string;
  kid?: string;
  typ?: string;
}

export interface KeycloakVerifierOptions {
  expectedIssuer: string;
  jwksUri: string;
  fetchImpl?: typeof fetch;
  cacheTtlMs?: number;
}

export class KeycloakJwtVerifier {
  readonly #expectedIssuer: string;
  readonly #jwksUri: string;
  readonly #fetchImpl: typeof fetch;
  readonly #cacheTtlMs: number;
  #cachedKeys: { fetchedAt: number; keys: JsonWebKey[] } | null = null;

  constructor(options: KeycloakVerifierOptions) {
    this.#expectedIssuer = options.expectedIssuer;
    this.#jwksUri = options.jwksUri;
    this.#fetchImpl = options.fetchImpl ?? fetch;
    this.#cacheTtlMs = options.cacheTtlMs ?? 5 * 60 * 1000;
  }

  async verifyAuthorizationHeader(
    authorizationHeader: string | undefined
  ): Promise<KeycloakAccessTokenClaims> {
    if (!authorizationHeader) {
      throw new ApiError(401, "UNAUTHENTICATED", "Bearer access token is required.");
    }

    const [scheme, token] = authorizationHeader.split(/\s+/, 2);

    if (scheme?.toLowerCase() !== "bearer" || !token) {
      throw new ApiError(
        401,
        "UNAUTHENTICATED",
        "Authorization header must use Bearer token format."
      );
    }

    return this.verifyToken(token);
  }

  async verifyToken(token: string): Promise<KeycloakAccessTokenClaims> {
    const parts = token.split(".");

    if (parts.length !== 3) {
      throw new ApiError(401, "UNAUTHENTICATED", "Bearer token is not a compact JWT.");
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts as [string, string, string];
    const header = parseJsonSegment<JwtHeader>(encodedHeader, "JWT header");

    if (header.alg !== "RS256") {
      throw new ApiError(401, "UNAUTHENTICATED", "Only RS256 Keycloak access tokens are accepted.");
    }

    if (!header.kid) {
      throw new ApiError(401, "UNAUTHENTICATED", "Keycloak access token is missing key id.");
    }

    const claims = parseJsonSegment<KeycloakAccessTokenClaims>(encodedPayload, "JWT payload");

    if (claims.iss !== this.#expectedIssuer) {
      throw new ApiError(401, "UNAUTHENTICATED", "Keycloak issuer is not accepted.");
    }

    const publicKey = await this.#getPublicKey(header.kid);
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    verifier.end();

    if (!verifier.verify(publicKey, base64UrlDecode(encodedSignature))) {
      throw new ApiError(401, "UNAUTHENTICATED", "Keycloak access token signature is invalid.");
    }

    return claims;
  }

  async #getPublicKey(kid: string): Promise<KeyObject> {
    const keys = await this.#getKeys();
    const jwk = keys.find((candidate) => candidate.kid === kid);

    if (!jwk) {
      this.#cachedKeys = null;
      const refreshed = await this.#getKeys();
      const refreshedJwk = refreshed.find((candidate) => candidate.kid === kid);

      if (!refreshedJwk) {
        throw new ApiError(401, "UNAUTHENTICATED", "Keycloak signing key is not trusted.");
      }

      return createPublicKey({ key: refreshedJwk, format: "jwk" });
    }

    return createPublicKey({ key: jwk, format: "jwk" });
  }

  async #getKeys(): Promise<JsonWebKey[]> {
    const now = Date.now();

    if (this.#cachedKeys && now - this.#cachedKeys.fetchedAt < this.#cacheTtlMs) {
      return this.#cachedKeys.keys;
    }

    const response = await this.#fetchImpl(this.#jwksUri, {
      headers: { accept: "application/json" }
    });

    if (!response.ok) {
      throw new ApiError(503, "CONFIGURATION_ERROR", "Keycloak JWKS endpoint is unavailable.", {
        jwks_uri: this.#jwksUri,
        status: response.status
      });
    }

    const body = (await response.json()) as JsonWebKeySet;

    if (!Array.isArray(body.keys)) {
      throw new ApiError(503, "CONFIGURATION_ERROR", "Keycloak JWKS response is malformed.", {
        jwks_uri: this.#jwksUri
      });
    }

    this.#cachedKeys = { fetchedAt: now, keys: body.keys };
    return body.keys;
  }
}

function parseJsonSegment<T>(encoded: string, label: string): T {
  try {
    return JSON.parse(base64UrlDecode(encoded).toString("utf8")) as T;
  } catch {
    throw new ApiError(401, "UNAUTHENTICATED", `${label} is not valid base64url JSON.`);
  }
}

function base64UrlDecode(value: string): Buffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, "base64");
}
