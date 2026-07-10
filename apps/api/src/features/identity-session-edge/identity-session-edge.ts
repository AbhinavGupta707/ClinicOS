import {
  AuthenticationError,
  assertMfaForAccess,
  deriveVerifiedRequestScope,
  principalFromProductionKeycloakClaims,
  type ProductionAuthenticatedPrincipal,
  type VerifiedRequestScope
} from "@clinic-os/auth";
import { BoundaryError } from "@clinic-os/security";
import type {
  IdentitySessionEdgeConfiguration,
  TokenRevocationStore,
  VerifyIdentitySessionEdgeInput
} from "./contracts.ts";

export interface VerifiedIdentitySessionEdgeContext {
  principal: ProductionAuthenticatedPrincipal;
  scope: VerifiedRequestScope;
}

export class IdentitySessionEdgeGuard {
  readonly #configuration: IdentitySessionEdgeConfiguration;
  readonly #revocations: TokenRevocationStore;

  constructor(input: {
    configuration: IdentitySessionEdgeConfiguration;
    revocations: TokenRevocationStore;
  }) {
    this.#configuration = normalizeConfiguration(input.configuration);
    if (
      this.#configuration.productionLike &&
      input.revocations.durability !== "distributed_durable"
    ) {
      throw new Error("Production API token revocation requires a distributed durable store.");
    }
    this.#revocations = input.revocations;
  }

  async readiness(): Promise<void> {
    await this.#revocations.readiness();
  }

  async verify(input: VerifyIdentitySessionEdgeInput): Promise<VerifiedIdentitySessionEdgeContext> {
    assertNoBrowserSessionCookie(input.cookieHeader, this.#configuration.browserSessionCookieName);
    let principal: ProductionAuthenticatedPrincipal;
    try {
      principal = principalFromProductionKeycloakClaims(input.claims, {
        expectedIssuer: this.#configuration.expectedIssuer,
        requiredAudience: this.#configuration.requiredAudience,
        acceptedAuthorizedParties: this.#configuration.acceptedAuthorizedParties,
        maximumAccessTokenLifetimeSeconds: this.#configuration.maximumAccessTokenLifetimeSeconds,
        now: input.now
      });
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw new BoundaryError({ code: "UNAUTHENTICATED", message: error.message });
      }
      throw error;
    }
    if (
      principal.subject !== input.accessContext.principal.subject ||
      principal.issuer !== input.accessContext.principal.issuer
    ) {
      throw new BoundaryError({
        code: "UNAUTHENTICATED",
        message: "Verified token does not match the resolved ClinicOS identity."
      });
    }
    if (
      await this.#revocations.isRevoked({
        subject: principal.subject,
        tokenId: principal.tokenId,
        keycloakSessionId: principal.keycloakSessionId,
        issuedAt: principal.issuedAt,
        now: input.now
      })
    ) {
      throw new BoundaryError({
        code: "UNAUTHENTICATED",
        message: "Access token session has been revoked."
      });
    }

    let scope: VerifiedRequestScope;
    try {
      scope = deriveVerifiedRequestScope({
        context: input.accessContext,
        clinics: input.clinics,
        selectedClinicId: input.selectedClinicId
      });
      assertMfaForAccess({
        roleSlugs: scope.roleSlugs,
        amr: principal.amr,
        acr: principal.acr
      });
    } catch (error) {
      throw new BoundaryError({
        code: error instanceof AuthenticationError ? "UNAUTHENTICATED" : "PERMISSION_DENIED",
        message:
          error instanceof AuthenticationError
            ? error.message
            : "Verified identity has no active ClinicOS membership for this request."
      });
    }
    return { principal, scope };
  }
}

export function assertNoBrowserSessionCookie(
  cookieHeader: string | readonly string[] | null | undefined,
  browserSessionCookieName: string
): void {
  if (!cookieHeader) return;
  if (typeof cookieHeader !== "string") {
    throw new BoundaryError({
      code: "BAD_REQUEST",
      message: "Multiple Cookie headers are not accepted."
    });
  }
  const names = cookieHeader
    .split(";")
    .map((part) => part.trim().split("=", 1)[0])
    .filter(Boolean);
  if (names.includes(browserSessionCookieName)) {
    throw new BoundaryError({
      code: "UNAUTHENTICATED",
      message: "ClinicOS API does not accept browser session cookies; use the same-origin BFF."
    });
  }
}

function normalizeConfiguration(
  configuration: IdentitySessionEdgeConfiguration
): IdentitySessionEdgeConfiguration {
  let issuer: URL;
  try {
    issuer = new URL(configuration.expectedIssuer);
  } catch {
    throw new Error("Identity edge issuer is malformed.");
  }
  if (configuration.productionLike && issuer.protocol !== "https:") {
    throw new Error("Production identity issuer must use HTTPS.");
  }
  if (
    !/^[A-Za-z0-9._:-]{3,128}$/.test(configuration.requiredAudience) ||
    configuration.acceptedAuthorizedParties.some(
      (clientId) => !/^[A-Za-z0-9._:-]{3,128}$/.test(clientId)
    ) ||
    new Set(configuration.acceptedAuthorizedParties).size !==
      configuration.acceptedAuthorizedParties.length
  ) {
    throw new Error("Identity edge audience/client allowlist is malformed.");
  }
  if (
    !Number.isSafeInteger(configuration.maximumAccessTokenLifetimeSeconds) ||
    configuration.maximumAccessTokenLifetimeSeconds < 60 ||
    configuration.maximumAccessTokenLifetimeSeconds > 600
  ) {
    throw new Error("Identity edge access-token lifetime is outside policy.");
  }
  if (!/^(?:__Host-)?[A-Za-z0-9_-]{3,64}$/.test(configuration.browserSessionCookieName)) {
    throw new Error("Identity edge browser session cookie name is malformed.");
  }
  if (
    configuration.productionLike &&
    !configuration.browserSessionCookieName.startsWith("__Host-")
  ) {
    throw new Error("Production browser sessions require a __Host- cookie name.");
  }
  return Object.freeze({ ...configuration, expectedIssuer: issuer.toString().replace(/\/$/, "") });
}
