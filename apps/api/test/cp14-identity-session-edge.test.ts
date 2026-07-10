import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAccessContext,
  principalFromVerifiedKeycloakClaims,
  type KeycloakAccessTokenClaims,
  type RequiredSecurityAuditIntent
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
  const auditOutbox = new TestSecurityAuditOutbox();
  const guard = createGuard(new TestRevocationStore(), auditOutbox);
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
  assert.equal(auditOutbox.intents.at(-1)?.action, "auth.mfa.denied");
  assert.equal(auditOutbox.intents.at(-1)?.tenantId, tenantId);
  assert.equal(auditOutbox.intents.at(-1)?.clinicId, clinicId);
  for (const bypassClaims of [
    { ...tokenClaims(["otp"]), acr: "urn:unproved:aal2" },
    { ...tokenClaims(["webauthn"]), acr: "urn:unproved:mfa" },
    { ...tokenClaims(["mfa"]), acr: "2" }
  ]) {
    await assert.rejects(
      guard.verify({
        claims: bypassClaims,
        accessContext: context("owner_admin"),
        clinics: [clinic()],
        selectedClinicId: clinicId,
        now
      }),
      (error) => error instanceof BoundaryError && error.code === "UNAUTHENTICATED"
    );
  }

  const reviewedAcrGuard = new IdentitySessionEdgeGuard({
    configuration: {
      ...configuration(),
      mfaAssurancePolicy: {
        ...mfaPolicy(),
        policyId: "reviewed-realm-acr-v1",
        reviewedRealmEvidenceId: "realm-evidence-2026-07-10",
        acceptedAcrValues: ["urn:clinicos:reviewed:aal2"]
      }
    },
    revocations: new TestRevocationStore(),
    securityAuditOutbox: new TestSecurityAuditOutbox()
  });
  await assert.doesNotReject(
    reviewedAcrGuard.verify({
      claims: { ...tokenClaims(["pwd"]), acr: "urn:clinicos:reviewed:aal2" },
      accessContext: context("owner_admin"),
      clinics: [clinic()],
      selectedClinicId: clinicId,
      now
    })
  );
  auditOutbox.fail = true;
  await assert.rejects(
    guard.verify({
      claims: tokenClaims(["pwd"]),
      accessContext: context("owner_admin"),
      clinics: [clinic()],
      selectedClinicId: clinicId,
      now
    }),
    /audit outbox unavailable/
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
        },
        securityAuditOutbox: new TestSecurityAuditOutbox()
      }),
    /distributed durable/
  );
  assert.throws(
    () =>
      new IdentitySessionEdgeGuard({
        configuration: configuration(),
        revocations: new TestRevocationStore(),
        securityAuditOutbox: {
          ...new TestSecurityAuditOutbox(),
          durability: "in_memory_test_double"
        }
      }),
    /distributed durable outbox/
  );
  assert.match(IDENTITY_SESSION_EDGE_RESPONSE_HEADERS["cache-control"]!, /no-store/);
  assert.equal(IDENTITY_SESSION_EDGE_RESPONSE_HEADERS["x-content-type-options"], "nosniff");
});

test("identity issuer is canonical in production and HTTP remains loopback-only locally", () => {
  for (const expectedIssuer of [
    "https://user@identity.example/realms/clinic-os",
    "https://identity.example/realms/clinic-os?query=1",
    "https://identity.example/realms/clinic-os#fragment",
    "https://identity.example/realms/clinic-os/",
    "https://identity.example/realms/../clinic-os",
    "https://IDENTITY.example/realms/clinic-os",
    "https://identity.example:443/realms/clinic-os"
  ]) {
    assert.throws(
      () =>
        new IdentitySessionEdgeGuard({
          configuration: { ...configuration(), expectedIssuer },
          revocations: new TestRevocationStore(),
          securityAuditOutbox: new TestSecurityAuditOutbox()
        }),
      /issuer/
    );
  }

  assert.doesNotThrow(
    () =>
      new IdentitySessionEdgeGuard({
        configuration: {
          ...configuration(),
          productionLike: false,
          expectedIssuer: "http://localhost:8080/realms/clinic-os",
          browserSessionCookieName: "clinicos_session"
        },
        revocations: new TestRevocationStore(),
        securityAuditOutbox: new TestSecurityAuditOutbox()
      })
  );
  assert.throws(
    () =>
      new IdentitySessionEdgeGuard({
        configuration: {
          ...configuration(),
          productionLike: false,
          expectedIssuer: "http://identity.internal/realms/clinic-os",
          browserSessionCookieName: "clinicos_session"
        },
        revocations: new TestRevocationStore(),
        securityAuditOutbox: new TestSecurityAuditOutbox()
      }),
    /loopback/
  );
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

class TestSecurityAuditOutbox {
  readonly atomicity = "durable_transactional_outbox" as const;
  readonly durability = "distributed_durable" as const;
  readonly intents: RequiredSecurityAuditIntent[] = [];
  fail = false;

  async readiness(): Promise<void> {}

  async persistRequired(intent: RequiredSecurityAuditIntent): Promise<void> {
    if (this.fail) throw new Error("required audit outbox unavailable");
    this.intents.push(structuredClone(intent));
  }
}

function createGuard(
  revocations: TokenRevocationStore,
  securityAuditOutbox = new TestSecurityAuditOutbox()
): IdentitySessionEdgeGuard {
  return new IdentitySessionEdgeGuard({
    configuration: configuration(),
    revocations,
    securityAuditOutbox
  });
}

function configuration() {
  return {
    productionLike: true,
    expectedIssuer: issuer,
    mfaAssurancePolicy: mfaPolicy(),
    requiredAudience: "clinic-os-api",
    acceptedAuthorizedParties: ["clinic-os-web-bff", "clinic-os-mobile"] as [string, ...string[]],
    maximumAccessTokenLifetimeSeconds: 300,
    browserSessionCookieName: "__Host-clinicos_session"
  };
}

function mfaPolicy() {
  return {
    policyId: "clinicos-amr-two-factor-v1",
    reviewedRealmEvidenceId: null,
    acceptedAcrValues: [] as string[],
    primaryFactorAmrValues: ["pwd"],
    secondaryFactorAmrValues: ["otp", "totp", "webauthn"],
    phishingResistantAmrValues: [] as string[]
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
