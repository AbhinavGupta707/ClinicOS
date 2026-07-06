export interface KeycloakAccessTokenClaims {
  sub: string;
  iss: string;
  aud?: string | string[];
  azp?: string;
  exp: number;
  nbf?: number;
  iat?: number;
  email?: string;
  email_verified?: boolean;
  name?: string;
  preferred_username?: string;
  realm_access?: {
    roles?: string[];
  };
  resource_access?: Record<string, { roles?: string[] }>;
}

export interface KeycloakValidationOptions {
  expectedIssuer: string;
  acceptedAudiences: readonly string[];
  acceptedClientIds?: readonly string[];
  clockSkewSeconds?: number;
  now?: Date;
}

export interface AuthenticatedPrincipal {
  subject: string;
  issuer: string;
  email: string | null;
  displayName: string | null;
  username: string | null;
  keycloakRoles: string[];
}

export class AuthenticationError extends Error {
  readonly code = "UNAUTHENTICATED";

  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

function hasAcceptedAudience(claims: KeycloakAccessTokenClaims, acceptedAudiences: readonly string[]): boolean {
  const audiences = Array.isArray(claims.aud) ? claims.aud : claims.aud ? [claims.aud] : [];
  return audiences.some((audience) => acceptedAudiences.includes(audience));
}

function hasAcceptedClient(claims: KeycloakAccessTokenClaims, acceptedClientIds: readonly string[]): boolean {
  return Boolean(claims.azp && acceptedClientIds.includes(claims.azp));
}

export function principalFromVerifiedKeycloakClaims(
  claims: KeycloakAccessTokenClaims,
  options: KeycloakValidationOptions
): AuthenticatedPrincipal {
  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000);
  const clockSkewSeconds = options.clockSkewSeconds ?? 60;

  if (!claims.sub) throw new AuthenticationError("Keycloak token is missing subject.");
  if (claims.iss !== options.expectedIssuer) throw new AuthenticationError("Keycloak issuer is not accepted.");
  if (claims.exp + clockSkewSeconds < nowSeconds) throw new AuthenticationError("Keycloak token is expired.");
  if (claims.nbf && claims.nbf - clockSkewSeconds > nowSeconds) {
    throw new AuthenticationError("Keycloak token is not valid yet.");
  }

  const audienceAccepted = hasAcceptedAudience(claims, options.acceptedAudiences);
  const clientAccepted = options.acceptedClientIds
    ? hasAcceptedClient(claims, options.acceptedClientIds)
    : false;

  if (!audienceAccepted && !clientAccepted) {
    throw new AuthenticationError("Keycloak token audience is not accepted.");
  }

  const resourceRoles = Object.values(claims.resource_access ?? {}).flatMap((resource) => resource.roles ?? []);
  const realmRoles = claims.realm_access?.roles ?? [];
  const keycloakRoles = [...new Set([...realmRoles, ...resourceRoles])].sort();

  return {
    subject: claims.sub,
    issuer: claims.iss,
    email: claims.email ?? null,
    displayName: claims.name ?? claims.preferred_username ?? null,
    username: claims.preferred_username ?? null,
    keycloakRoles
  };
}
