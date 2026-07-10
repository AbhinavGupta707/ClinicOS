import test from "node:test";
import assert from "node:assert/strict";
import {
  RequestScopeResolutionError,
  buildAccessContext,
  authorize,
  deriveVerifiedRequestScope,
  permissionsForScope,
  principalFromVerifiedKeycloakClaims
} from "../src/index.ts";

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

test("CP3 authorization lets assistants draft but not sign clinical artifacts", () => {
  const assistantContext = contextForRole("assistant");
  const doctorContext = contextForRole("doctor", "10000000-0000-4000-8000-000000001002");

  assert.equal(
    authorize(assistantContext, {
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000101",
      permission: "clinical.note.write"
    }).allowed,
    true
  );
  assert.equal(
    authorize(assistantContext, {
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000101",
      permission: "prescription.write"
    }).allowed,
    true
  );
  assert.equal(
    authorize(assistantContext, {
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000101",
      permission: "clinical.note.sign"
    }).reason,
    "missing_permission"
  );
  assert.equal(
    authorize(assistantContext, {
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000101",
      permission: "prescription.sign"
    }).reason,
    "missing_permission"
  );

  assert.equal(
    authorize(doctorContext, {
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000101",
      permission: "clinical.note.sign"
    }).allowed,
    true
  );
  assert.equal(
    authorize(doctorContext, {
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000101",
      permission: "prescription.sign"
    }).allowed,
    true
  );
});

test("CP3 authorization denies accountant auditor and wrong-tenant clinical mutations", () => {
  for (const role of ["accountant", "auditor"] as const) {
    const scopedContext = contextForRole(role);

    for (const permission of [
      "patient.write",
      "intake.write",
      "clinical.note.write",
      "prescription.write",
      "clinical.note.sign",
      "prescription.sign"
    ] as const) {
      assert.equal(
        authorize(scopedContext, {
          tenantId: "10000000-0000-4000-8000-000000000001",
          clinicId: "10000000-0000-4000-8000-000000000101",
          permission
        }).reason,
        "missing_permission"
      );
    }
  }

  const doctorContext = contextForRole("doctor", "10000000-0000-4000-8000-000000001002");

  for (const permission of [
    "intake.write",
    "clinical.note.write",
    "prescription.write",
    "clinical.note.sign",
    "prescription.sign"
  ] as const) {
    assert.equal(
      authorize(doctorContext, {
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000101",
        permission,
        resourceTenantId: "20000000-0000-4000-8000-000000000001"
      }).reason,
      "tenant_mismatch"
    );
  }

  assert.equal(
    authorize(doctorContext, {
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000101",
      permission: "prescription.sign",
      resourceClinicId: "10000000-0000-4000-8000-000000000202"
    }).reason,
    "clinic_mismatch"
  );
});

test("access context discards roles and memberships that do not belong to the verified user", () => {
  const poisoned = buildAccessContext({
    ...context,
    memberships: [
      ...context.memberships,
      {
        tenantId: context.tenant.id,
        userId: "10000000-0000-4000-8000-000000009999",
        status: "active"
      }
    ],
    clinicAssignments: [
      ...context.clinicAssignments,
      {
        tenantId: context.tenant.id,
        clinicId: "10000000-0000-4000-8000-000000000202",
        userId: "10000000-0000-4000-8000-000000009999",
        status: "active"
      }
    ],
    roleAssignments: [
      ...context.roleAssignments,
      {
        tenantId: context.tenant.id,
        clinicId: context.clinicAssignments[0]!.clinicId,
        userId: "10000000-0000-4000-8000-000000009999",
        roleSlug: "doctor"
      },
      {
        tenantId: context.tenant.id,
        clinicId: "10000000-0000-4000-8000-000000000202",
        userId: context.user.id,
        roleSlug: "owner"
      }
    ]
  });

  assert.deepEqual(poisoned.roleSlugs, ["assistant"]);
  assert.equal(poisoned.memberships.length, 1);
  assert.equal(poisoned.clinicAssignments.length, 1);
  assert.equal(poisoned.permissions.includes("clinical.note.sign"), false);
  assert.equal(poisoned.permissions.includes("clinic.manage"), false);
});

test("inactive tenant user and membership states fail closed", () => {
  const request = {
    tenantId: context.tenant.id,
    clinicId: context.clinicAssignments[0]!.clinicId,
    permission: "schedule.write" as const
  };

  assert.equal(
    authorize(
      buildAccessContext({ ...context, tenant: { ...context.tenant, status: "suspended" } }),
      request
    ).reason,
    "inactive_identity"
  );
  assert.equal(
    authorize(
      buildAccessContext({ ...context, user: { ...context.user, status: "suspended" } }),
      request
    ).reason,
    "inactive_identity"
  );
  assert.equal(
    authorize(
      buildAccessContext({
        ...context,
        memberships: context.memberships.map((membership) => ({
          ...membership,
          status: "suspended"
        }))
      }),
      request
    ).reason,
    "inactive_membership"
  );
});

test("verified request scope derives actor tenant and clinic only from active identity records", () => {
  const scope = deriveVerifiedRequestScope({
    context,
    clinics: [
      {
        id: context.clinicAssignments[0]!.clinicId,
        tenantId: context.tenant.id,
        slug: "verified-clinic",
        displayName: "Verified Clinic",
        status: "active",
        timezone: "Asia/Kolkata"
      },
      {
        id: "10000000-0000-4000-8000-000000000202",
        tenantId: context.tenant.id,
        slug: "unassigned-clinic",
        displayName: "Unassigned Clinic",
        status: "active",
        timezone: "Asia/Kolkata"
      }
    ],
    selectedClinicId: context.clinicAssignments[0]!.clinicId
  });

  assert.equal(scope.actorUserId, context.user.id);
  assert.equal(scope.tenantId, context.tenant.id);
  assert.equal(scope.clinicId, context.clinicAssignments[0]!.clinicId);
  assert.equal(scope.provenance.actor, "verified_identity_subject");
  assert.equal(scope.provenance.tenant, "verified_active_membership");
  assert.equal(scope.provenance.clinic, "verified_active_assignment");
  assert.throws(
    () =>
      deriveVerifiedRequestScope({
        context,
        clinics: [
          {
            id: "10000000-0000-4000-8000-000000000202",
            tenantId: context.tenant.id,
            slug: "unassigned-clinic",
            displayName: "Unassigned Clinic",
            status: "active",
            timezone: "Asia/Kolkata"
          }
        ],
        selectedClinicId: "10000000-0000-4000-8000-000000000202"
      }),
    (error: unknown) =>
      error instanceof RequestScopeResolutionError && error.reason === "clinic_mismatch"
  );
});

test("auth role and tenant negative matrix denies every disallowed critical capability", () => {
  const matrix = {
    assistant: ["clinical.note.sign", "prescription.sign", "billing.write", "clinic.manage"],
    accountant: ["patient.write", "clinical.note.write", "clinical.note.sign", "media.write"],
    auditor: ["patient.write", "schedule.write", "clinical.note.write", "billing.write"]
  } as const;

  for (const [role, permissions] of Object.entries(matrix)) {
    const scoped = contextForRole(role as keyof typeof matrix);
    for (const permission of permissions) {
      assert.equal(
        authorize(scoped, {
          tenantId: context.tenant.id,
          clinicId: context.clinicAssignments[0]!.clinicId,
          permission
        }).allowed,
        false,
        `${role} must not receive ${permission}`
      );
      assert.equal(
        authorize(scoped, {
          tenantId: "20000000-0000-4000-8000-000000000001",
          clinicId: context.clinicAssignments[0]!.clinicId,
          permission
        }).reason,
        "tenant_mismatch"
      );
    }
  }
});

function contextForRole(
  roleSlug: "assistant" | "doctor" | "accountant" | "auditor",
  userId = context.user.id
) {
  return buildAccessContext({
    principal,
    tenant: context.tenant,
    user: { ...context.user, id: userId },
    memberships: [
      {
        tenantId: "10000000-0000-4000-8000-000000000001",
        userId,
        status: "active"
      }
    ],
    clinicAssignments: [
      {
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000101",
        userId,
        status: "active"
      }
    ],
    roleAssignments: [
      {
        tenantId: "10000000-0000-4000-8000-000000000001",
        clinicId: "10000000-0000-4000-8000-000000000101",
        userId,
        roleSlug
      }
    ]
  });
}
