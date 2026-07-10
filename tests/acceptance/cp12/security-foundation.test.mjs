import assert from "node:assert/strict";
import test from "node:test";
import {
  RequestScopeResolutionError,
  authorize,
  buildAccessContext,
  deriveVerifiedRequestScope
} from "../../../packages/auth/src/index.ts";
import {
  BOUNDARY_ERROR_STATUS,
  BoundaryError,
  assertContentLengthWithinBudget,
  assertStrictObject,
  createBodyBudgetCounter,
  createRequestCorrelationContext,
  enforceExpensiveOperationBudget,
  enforceQueryBudget,
  enforceRateBudget,
  parsePaginationBudget,
  serializeBoundaryError
} from "../../../packages/security/src/index.ts";

const TENANT_ID = "10000000-0000-4000-8000-000000000001";
const CLINIC_ID = "10000000-0000-4000-8000-000000000101";
const OTHER_CLINIC_ID = "10000000-0000-4000-8000-000000000202";
const USER_ID = "10000000-0000-4000-8000-000000001003";
const now = new Date("2026-07-10T12:00:00.000Z");

test("CP12 auth role tenant and clinic negative matrix fails closed", () => {
  const deniedByRole = {
    assistant: ["clinical.note.sign", "prescription.sign", "billing.write", "clinic.manage"],
    accountant: ["patient.write", "clinical.note.write", "clinical.note.sign", "media.write"],
    auditor: ["patient.write", "schedule.write", "clinical.note.write", "billing.write"]
  };

  for (const [role, permissions] of Object.entries(deniedByRole)) {
    const context = contextForRole(role);
    for (const permission of permissions) {
      assert.equal(
        authorize(context, { tenantId: TENANT_ID, clinicId: CLINIC_ID, permission }).reason,
        "missing_permission",
        `${role} must not receive ${permission}`
      );
      assert.equal(
        authorize(context, {
          tenantId: "20000000-0000-4000-8000-000000000001",
          clinicId: CLINIC_ID,
          permission
        }).reason,
        "tenant_mismatch"
      );
      assert.equal(
        authorize(context, {
          tenantId: TENANT_ID,
          clinicId: CLINIC_ID,
          resourceClinicId: OTHER_CLINIC_ID,
          permission
        }).reason,
        "clinic_mismatch"
      );
    }
  }

  const inactive = contextForRole("assistant", { membershipStatus: "suspended" });
  assert.equal(
    authorize(inactive, {
      tenantId: TENANT_ID,
      clinicId: CLINIC_ID,
      permission: "schedule.write"
    }).reason,
    "inactive_membership"
  );
});

test("CP12 request scope ignores client authority fields and accepts only a verified clinic selector", () => {
  const context = contextForRole("assistant");
  const scope = deriveVerifiedRequestScope({
    context,
    clinics: [clinic(CLINIC_ID), clinic(OTHER_CLINIC_ID)],
    selectedClinicId: CLINIC_ID
  });
  assert.deepEqual(
    {
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      actorUserId: scope.actorUserId
    },
    { tenantId: TENANT_ID, clinicId: CLINIC_ID, actorUserId: USER_ID }
  );

  assert.throws(
    () =>
      deriveVerifiedRequestScope({
        context,
        clinics: [clinic(CLINIC_ID), clinic(OTHER_CLINIC_ID)],
        selectedClinicId: OTHER_CLINIC_ID
      }),
    (error) => error instanceof RequestScopeResolutionError && error.reason === "clinic_mismatch"
  );

  for (const authorityField of [
    "tenantId",
    "clinicId",
    "actorUserId",
    "createdByUserId",
    "role",
    "permissions",
    "signedByUserId",
    "paymentStatus",
    "providerConfirmationReceived"
  ]) {
    assert.throws(
      () =>
        assertStrictObject({ displayName: "Synthetic", [authorityField]: "spoofed" }, [
          "displayName"
        ]),
      (error) => error instanceof BoundaryError && error.status === 422
    );
  }
});

test("CP12 body query pagination rate and expensive-operation budgets are stable", async () => {
  assert.throws(
    () => assertContentLengthWithinBudget("1048577", { maxBytes: 1048576 }),
    (error) => error instanceof BoundaryError && error.status === 413
  );
  const counter = createBodyBudgetCounter({ maxBytes: 4 });
  counter.observe("1234");
  assert.throws(
    () => counter.observe("5"),
    (error) => error instanceof BoundaryError && error.code === "PAYLOAD_TOO_LARGE"
  );

  assert.throws(
    () =>
      enforceQueryBudget(new URLSearchParams("status=open&status=closed"), {
        maxParameters: 8,
        maxTotalBytes: 256,
        maxKeyBytes: 32,
        maxValueBytes: 64,
        maxValuesPerKey: 1
      }),
    (error) => error instanceof BoundaryError && error.status === 400
  );
  assert.throws(
    () =>
      parsePaginationBudget(
        { limit: "501" },
        { defaultLimit: 25, maxLimit: 100, maxCursorBytes: 128 }
      ),
    (error) => error instanceof BoundaryError && error.status === 422
  );

  const store = new QueueBudgetStore([
    { allowed: false, remaining: 0, resetAt: new Date(now.getTime() + 9_000) },
    { allowed: false, remaining: 0, resetAt: new Date(now.getTime() + 20_000) }
  ]);
  await assert.rejects(
    () =>
      enforceRateBudget({
        store,
        bucketKey: "opaque-rate-key",
        policy: { limit: 10, windowSeconds: 60, scope: "tenant_actor" },
        now
      }),
    (error) => {
      assert.ok(error instanceof BoundaryError);
      const serialized = serializeBoundaryError(error, "req-rate");
      assert.equal(serialized.status, 429);
      assert.equal(serialized.headers["retry-after"], "9");
      return true;
    }
  );
  await assert.rejects(
    () =>
      enforceExpensiveOperationBudget({
        store,
        bucketKey: "opaque-cost-key",
        requestedUnits: 5,
        policy: {
          maxUnitsPerRequest: 10,
          maxUnitsPerWindow: 100,
          windowSeconds: 60,
          scope: "tenant"
        },
        now
      }),
    (error) => error instanceof BoundaryError && error.status === 429
  );
});

test("CP12 request-id and sensitive-error contracts keep provenance without PHI or secrets", () => {
  const context = createRequestCorrelationContext({
    requestIdHeader: "patient@example.test invalid",
    method: "POST",
    routeId: "patients.create",
    now,
    generateId: () => "generated-safe-id"
  });
  assert.equal(context.requestId, "generated-safe-id");
  assert.equal(context.requestIdProvenance, "generated_after_invalid_client_value");

  const serialized = serializeBoundaryError(
    new BoundaryError({
      code: "VALIDATION_ERROR",
      message: "Request body failed validation.",
      details: {
        patientName: "Synthetic Patient",
        authorization: "Bearer eyJsecret.payload.signature",
        password: "not-for-output",
        stack: "at private source path"
      }
    }),
    context.requestId
  );
  const output = JSON.stringify(serialized);
  assert.equal(serialized.status, 422);
  assert.doesNotMatch(output, /Synthetic Patient|eyJsecret|not-for-output|private source path/);
  assert.equal(serialized.headers["cache-control"], "no-store");

  assert.deepEqual(
    [
      "BAD_REQUEST",
      "UNAUTHENTICATED",
      "PERMISSION_DENIED",
      "CONFLICT",
      "PAYLOAD_TOO_LARGE",
      "VALIDATION_ERROR",
      "RATE_LIMITED"
    ].map((code) => BOUNDARY_ERROR_STATUS[code]),
    [400, 401, 403, 409, 413, 422, 429]
  );
});

class QueueBudgetStore {
  constructor(results) {
    this.results = results;
  }

  consume(request) {
    this.lastRequest = request;
    const result = this.results.shift();
    if (!result) throw new Error("Missing deterministic budget result.");
    return Promise.resolve(result);
  }
}

function contextForRole(roleSlug, overrides = {}) {
  return buildAccessContext({
    principal: {
      subject: "verified-subject",
      issuer: "https://identity.example.test/realms/clinicos",
      email: null,
      displayName: "Synthetic Staff",
      username: "synthetic-staff",
      keycloakRoles: ["clinic-user"]
    },
    tenant: {
      id: TENANT_ID,
      slug: "synthetic-tenant",
      legalName: "Synthetic Tenant",
      displayName: "Synthetic Tenant",
      status: overrides.tenantStatus ?? "active"
    },
    user: {
      id: USER_ID,
      displayName: "Synthetic Staff",
      email: null,
      phone: null,
      status: overrides.userStatus ?? "active"
    },
    memberships: [
      {
        tenantId: TENANT_ID,
        userId: USER_ID,
        status: overrides.membershipStatus ?? "active"
      }
    ],
    clinicAssignments: [
      {
        tenantId: TENANT_ID,
        clinicId: CLINIC_ID,
        userId: USER_ID,
        status: overrides.clinicStatus ?? "active"
      }
    ],
    roleAssignments: [
      {
        tenantId: TENANT_ID,
        clinicId: CLINIC_ID,
        userId: USER_ID,
        roleSlug
      }
    ]
  });
}

function clinic(id) {
  return {
    id,
    tenantId: TENANT_ID,
    slug: `clinic-${id.slice(-3)}`,
    displayName: "Synthetic Clinic",
    status: "active",
    timezone: "Asia/Kolkata"
  };
}
