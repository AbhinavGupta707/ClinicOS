import type {
  AccessContext,
  KeycloakAccessTokenClaims,
  RequiredSecurityAuditOutbox
} from "@clinic-os/auth";
import type { Clinic, UUID } from "@clinic-os/domain";

export interface TokenRevocationQuery {
  subject: string;
  tokenId: string;
  keycloakSessionId: string;
  issuedAt: string;
  now: Date;
}

/** Distributed production implementation is required; dependency failure must remove readiness. */
export interface TokenRevocationStore {
  readonly durability: "distributed_durable" | "in_memory_test_double";
  readiness(): Promise<void>;
  isRevoked(query: TokenRevocationQuery): Promise<boolean>;
}

export interface IdentitySecurityAuditOutbox extends RequiredSecurityAuditOutbox {
  readonly durability: "distributed_durable" | "in_memory_test_double";
  readiness(): Promise<void>;
}

export interface IdentitySessionEdgeConfiguration {
  productionLike: boolean;
  expectedIssuer: string;
  requiredAudience: string;
  acceptedAuthorizedParties: readonly [string, ...string[]];
  maximumAccessTokenLifetimeSeconds: number;
  browserSessionCookieName: string;
}

export interface VerifyIdentitySessionEdgeInput {
  claims: KeycloakAccessTokenClaims;
  accessContext: AccessContext;
  clinics: readonly Clinic[];
  selectedClinicId?: UUID | null;
  cookieHeader?: string | readonly string[] | null;
  now: Date;
}
