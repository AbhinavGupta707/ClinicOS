import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccessContext,
  principalFromVerifiedKeycloakClaims,
  type KeycloakAccessTokenClaims
} from "@clinic-os/auth";
import type { AccessContext } from "@clinic-os/auth";
import { BoundaryError } from "@clinic-os/security";
import {
  IDENTITY_SESSION_EDGE_RESPONSE_HEADERS,
  IdentitySessionEdgeGuard,
  type TokenRevocationQuery,
  type TokenRevocationStore
} from "../src/features/identity-session-edge/index.ts";

const now = new Date("2026-07-10T12:00:00.000Z");
const issuer = "https://identity.example/realms/clinic-os";
const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000101";
const userId = "10000000-0000-4000-8000-000000001001";

test("identity edge preserves verified tenant/clinic authority and MFA for privileged roles", async () => {
  const guard = createGuard(new TestRevocationStore());
  const claims = tokenClaims(["pwd", "otp"]);
  const verified = await guard.verify({
    claims,
    accessContext: context("owner_admin"),
    clinics: [clinic()],
    selectedClinicId: clinicId,
    now
  });
  assert.equal(verified.scope.tenantId, tenantId);
  assert.equal(verified.scope.clinicId, clinicId);
  assert.equal(verified.scope.actorUserId, userId);
  assert.equal(verified.scope.provenance.tenant, "verified_active_membership");
  assert.equal(verified.principal.authorizedParty, "clinic-os-web-bff");

  await assert.rejects(
    guard.verify({
      claims: tokenClaims(["pwd"]),
      accessContext: context("owner_admin"),
      clinics: [clinic()],
      selectedClinicId: clinicId,
      now
    }),
    (error) => error instanceof BoundaryError && error.code === "UNAUTHENTICATED"
  );
});

test("identity edge rejects revoked tokens, browser cookies, wrong azp, and expired access", async () => {
  const revoked = new TestRevocationStore();
  revoked.revoked = true;
  await assert.rejects(
    createGuard(revoked).verify({
      claims: tokenClaims(["pwd", "otp"]),
      accessContext: context("owner_admin"),
      clinics: [clinic()],
      now
    }),
    /revoked/
  );

  await assert.rejects(
    createGuard(new TestRevocationStore()).verify({
      claims: tokenClaims(["pwd", "otp"]),
      accessContext: context("owner_admin"),
      clinics: [clinic()],
      cookieHeader: "__Host-clinicos_session=opaque-browser-session",
      now
    }),
    /same-origin BFF/
  );

  await assert.rejects(
    createGuard(new TestRevocationStore()).verify({
      claims: { ...tokenClaims(["pwd", "otp"]), azp: "attacker-client" },
      accessContext: context("owner_admin"),
      clinics: [clinic()],
      now
    }),
    /authorized party/
  );

  await assert.rejects(
    createGuard(new TestRevocationStore()).verify({
      claims: {
        ...tokenClaims(["pwd", "otp"]),
        exp: Math.floor(now.getTime() / 1000) - 31
      },
      accessContext: context("owner_admin"),
      clinics: [clinic()],
      now
    }),
    /expired/
  );
});

test("inactive and cross-clinic membership remain denied after successful token verification", async () => {
  const guard = createGuard(new TestRevocationStore());
  const inactive = context("assistant", "inactive");
  await assert.rejects(
    guard.verify({
      claims: tokenClaims(["pwd"]),
      accessContext: inactive,
      clinics: [clinic()],
      selectedClinicId: clinicId,
      now
    }),
    (error) => error instanceof BoundaryError && error.code === "PERMISSION_DENIED"
  );
  await assert.rejects(
    guard.verify({
      claims: tokenClaims(["pwd"]),
      accessContext: context("assistant"),
      clinics: [clinic()],
      selectedClinicId: "10000000-0000-4000-8000-000000000202",
      now
    }),
    /no active ClinicOS membership/
  );
});

test("identity edge refuses an in-memory revocation store in production and emits no-store headers", () => {
  assert.throws(
    () =>
      new IdentitySessionEdgeGuard({
        configuration: configuration(),
        revocations: {
          ...new TestRevocationStore(),
          durability: "in_memory_test_double"
        }
      }),
    /distributed durable/
  );
  assert.match(IDENTITY_SESSION_EDGE_RESPONSE_HEADERS["cache-control"]!, /no-store/);
  assert.equal(IDENTITY_SESSION_EDGE_RESPONSE_HEADERS["x-content-type-options"], "nosniff");
});

class TestRevocationStore implements TokenRevocationStore {
  readonly durability = "distributed_durable" as const;
  revoked = false;
  lastQuery: TokenRevocationQuery | null = null;

  async readiness(): Promise<void> {}

  async isRevoked(query: TokenRevocationQuery): Promise<boolean> {
    this.lastQuery = query;
    return this.revoked;
  }
}

function createGuard(revocations: TokenRevocationStore): IdentitySessionEdgeGuard {
  return new IdentitySessionEdgeGuard({ configuration: configuration(), revocations });
}

function configuration() {
  return {
    productionLike: true,
    expectedIssuer: issuer,
    requiredAudience: "clinic-os-api",
    acceptedAuthorizedParties: ["clinic-os-web-bff", "clinic-os-mobile"] as [string, ...string[]],
    maximumAccessTokenLifetimeSeconds: 300,
    browserSessionCookieName: "__Host-clinicos_session"
  };
}

function tokenClaims(amr: string[]): KeycloakAccessTokenClaims {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return {
    sub: "keycloak-subject-0001",
    iss: issuer,
    aud: ["clinic-os-api"],
    azp: "clinic-os-web-bff",
    exp: issuedAt + 300,
    iat: issuedAt,
    nbf: issuedAt,
    typ: "Bearer",
    jti: "token-id-00000001",
    sid: "session-id-000001",
    auth_time: issuedAt,
    amr,
    acr: amr.includes("otp") ? "urn:clinicos:aal2" : "urn:clinicos:aal1"
  };
}

function context(
  roleSlug: "owner_admin" | "assistant",
  membershipStatus: "active" | "inactive" = "active"
): AccessContext {
  const principal = principalFromVerifiedKeycloakClaims(tokenClaims(["pwd", "otp"]), {
    expectedIssuer: issuer,
    acceptedAudiences: ["clinic-os-api"],
    acceptedClientIds: ["clinic-os-web-bff"],
    now
  });
  return buildAccessContext({
    principal,
    tenant: {
      id: tenantId,
      slug: "clinic-os-tenant",
      legalName: "ClinicOS Synthetic Tenant",
      displayName: "ClinicOS Synthetic Tenant",
      status: "active"
    },
    user: {
      id: userId,
      displayName: "Synthetic User",
      email: "user@example.invalid",
      phone: null,
      status: "active"
    },
    memberships: [{ tenantId, userId, status: membershipStatus }],
    clinicAssignments: [{ tenantId, clinicId, userId, status: membershipStatus }],
    roleAssignments: [{ tenantId, clinicId, userId, roleSlug }]
  });
}

function clinic() {
  return {
    id: clinicId,
    tenantId,
    slug: "synthetic-clinic",
    displayName: "Synthetic Clinic",
    timezone: "Asia/Kolkata",
    status: "active" as const
  };
}
