import test from "node:test";
import assert from "node:assert/strict";
import { buildAccessContext, authorize, permissionsForScope, principalFromVerifiedKeycloakClaims } from "../src/index.ts";

const now = new Date("2026-07-06T10:00:00Z");

const principal = principalFromVerifiedKeycloakClaims(
  {
    sub: "seed-assistant",
    iss: "http://localhost:8080/realms/clinicos-local",
    aud: "clinicos-api",
    azp: "clinicos-web",
    exp: Math.floor(now.getTime() / 1000) + 300,
    preferred_username: "assistant",
    realm_access: { roles: ["clinic-user"] }
  },
  {
    expectedIssuer: "http://localhost:8080/realms/clinicos-local",
    acceptedAudiences: ["clinicos-api"],
    acceptedClientIds: ["clinicos-web"],
    now
  }
);

const context = buildAccessContext({
  principal,
  tenant: {
    id: "10000000-0000-4000-8000-000000000001",
    slug: "demo-dental-care",
    legalName: "Demo Dental Care Private Limited",
    displayName: "Demo Dental Care",
    status: "active"
  },
  user: {
    id: "10000000-0000-4000-8000-000000001003",
    displayName: "Meera Assistant",
    email: "assistant@demo.clinicos.local",
    phone: null,
    status: "active"
  },
  memberships: [
    {
      tenantId: "10000000-0000-4000-8000-000000000001",
      userId: "10000000-0000-4000-8000-000000001003",
      status: "active"
    }
  ],
  clinicAssignments: [
    {
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000101",
      userId: "10000000-0000-4000-8000-000000001003",
      status: "active"
    }
  ],
  roleAssignments: [
    {
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000101",
      userId: "10000000-0000-4000-8000-000000001003",
      roleSlug: "assistant"
    }
  ]
});

test("Keycloak claims become a principal only with accepted issuer and audience", () => {
  assert.equal(principal.subject, "seed-assistant");
  assert.deepEqual(principal.keycloakRoles, ["clinic-user"]);

  assert.throws(
    () =>
      principalFromVerifiedKeycloakClaims(
        {
          sub: "seed-assistant",
          iss: "https://attacker.example",
          aud: "clinicos-api",
          exp: Math.floor(now.getTime() / 1000) + 300
        },
        {
          expectedIssuer: "http://localhost:8080/realms/clinicos-local",
          acceptedAudiences: ["clinicos-api"],
          now
        }
      ),
    /issuer/
  );
});

test("authorization allows clinic-scoped assistant scheduling work", () => {
  const decision = authorize(context, {
    tenantId: "10000000-0000-4000-8000-000000000001",
    clinicId: "10000000-0000-4000-8000-000000000101",
    permission: "schedule.write"
  });

  assert.equal(decision.allowed, true);
});

test("authorization denies cross-tenant and doctor-only actions", () => {
  assert.equal(
    authorize(context, {
      tenantId: "10000000-0000-4000-8000-000000000002",
      clinicId: "10000000-0000-4000-8000-000000000101",
      permission: "schedule.write"
    }).reason,
    "tenant_mismatch"
  );

  assert.equal(
    authorize(context, {
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000101",
      permission: "clinical.note.sign"
    }).reason,
    "missing_permission"
  );
});

test("authorization scopes role permissions to the requested clinic", () => {
  const scopedContext = buildAccessContext({
    ...context,
    clinicAssignments: [
      ...context.clinicAssignments,
      {
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000202",
        userId: "10000000-0000-4000-8000-000000001003",
        status: "active"
      }
    ],
    roleAssignments: [
      ...context.roleAssignments,
      {
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000202",
        userId: "10000000-0000-4000-8000-000000001003",
        roleSlug: "accountant"
      }
    ]
  });

  assert.equal(
    permissionsForScope(
      scopedContext,
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000202"
    ).includes("clinical.note.write"),
    false
  );

  assert.equal(
    authorize(scopedContext, {
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000202",
      permission: "clinical.note.write"
    }).reason,
    "missing_permission"
  );
});
