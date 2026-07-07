import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRoles } from "../../packages/domain/src/permissions.ts";
import { buildCp9SmokePlan } from "../../scripts/cp9-contract-smoke.mjs";
import { buildCp9LoadPlan } from "../../scripts/cp9-load-smoke.mjs";
import {
  loadCp9Scenario,
  summarizeCp9Scenario,
  validateCp9Scenario
} from "../../scripts/validate-cp9-fixtures.mjs";

test("CP9 performance QA scenario is deterministic and local-test only", async () => {
  const scenario = await loadCp9Scenario();

  assert.equal(validateCp9Scenario(scenario), true);
  assert.deepEqual(summarizeCp9Scenario(scenario), {
    actors: 7,
    browserRegisteredUnavailableSurfaces: 2,
    fixtureOnlyEvidence: 3,
    performanceDeferredEndpoints: 2,
    performanceEndpoints: 7,
    roleExpectations: 5,
    routeContracts: 5,
    tenantIsolationExpectations: 5,
    tenants: 2
  });
});

test("CP9 dry-run route contracts cover export, audit, FHIR, break-glass, and retention", async () => {
  const scenario = await loadCp9Scenario();
  const plan = buildCp9SmokePlan(scenario);
  const routeFamilies = new Set(plan.routeContracts.map((request) => request.routeFamily));
  const isolationFamilies = new Set(
    plan.tenantIsolationRequests.map((request) => request.routeFamily)
  );

  for (const family of ["patient-export", "audit-review", "fhir-export", "break-glass", "retention"]) {
    assert.ok(routeFamilies.has(family), `${family} route contract missing`);
    assert.ok(isolationFamilies.has(family), `${family} tenant isolation missing`);
  }

  assert.ok(plan.routeContracts.every((request) => request.liveImplemented === false));
  assert.ok(plan.tenantIsolationRequests.every((request) => request.liveImplemented === false));
  assert.ok(
    plan.routeContracts.some((request) => request.ownerLane === "fhir_abdm"),
    "FHIR route assumptions must name FHIR/ABDM ownership"
  );
});

test("CP9 tenant-isolation policy denies wrong-tenant access for route families", async () => {
  const scenario = await loadCp9Scenario();
  const primaryTenant = scenario.tenants.find((tenant) => tenant.key === "primaryTenant");
  const primaryClinic = scenario.clinics.find((clinic) => clinic.key === "primaryClinic");
  const wrongTenantOwner = contextForActor(scenario, "wrongTenantOwner");

  for (const expectation of scenario.tenantIsolationExpectations) {
    const decision = authorizeActor(wrongTenantOwner, {
      clinicId: wrongTenantOwner.clinicAssignments[0].clinicId,
      permission: expectation.requiredPermission,
      resourceClinicId: primaryClinic.id,
      resourceTenantId: primaryTenant.id,
      tenantId: wrongTenantOwner.tenant.id
    });

    assert.equal(decision.allowed, false, expectation.key);
    assert.equal(decision.reason, "tenant_mismatch", expectation.key);
  }
});

test("CP9 role expectations keep privacy, export, and break-glass permissions narrow", async () => {
  const scenario = await loadCp9Scenario();
  const primaryTenant = scenario.tenants.find((tenant) => tenant.key === "primaryTenant");
  const primaryClinic = scenario.clinics.find((clinic) => clinic.key === "primaryClinic");

  for (const expectation of scenario.roleExpectations) {
    const context = contextForActor(scenario, expectation.actorKey);
    const decision = authorizeActor(context, {
      clinicId: primaryClinic.id,
      permission: expectation.permission,
      tenantId: primaryTenant.id
    });

    assert.equal(decision.allowed, expectation.expected === "allow", expectation.key);
    if (expectation.expected === "deny") {
      assert.equal(decision.reason, expectation.expectedReason, expectation.key);
    }
    if (expectation.mustDenyPermission) {
      const denied = authorizeActor(context, {
        clinicId: primaryClinic.id,
        permission: expectation.mustDenyPermission,
        tenantId: primaryTenant.id
      });
      assert.equal(denied.allowed, false, expectation.key);
      assert.equal(denied.reason, "missing_permission", expectation.key);
    }
  }
});

test("CP9 load smoke declares honest local thresholds and deferred CP9 endpoints", async () => {
  const scenario = await loadCp9Scenario();
  const plan = buildCp9LoadPlan(scenario);

  assert.equal(plan.thresholds.concurrency, 6);
  assert.equal(plan.thresholds.totalRequests, 48);
  assert.equal(plan.thresholds.maxP95LatencyMs, 750);
  assert.equal(plan.thresholds.maxP99LatencyMs, 1500);
  assert.equal(plan.thresholds.maxErrorRate, 0);
  assert.equal(plan.thresholds.maxStatus429Rate, 0);
  assert.deepEqual(
    plan.endpoints.map((endpoint) => endpoint.key),
    [
      "health-ready",
      "session-context",
      "appointments-day-read",
      "queue-day-read",
      "tasks-open-read",
      "provider-health-read",
      "owner-dashboard-aggregate-read"
    ]
  );
  assert.deepEqual(
    plan.deferredEndpoints.map((endpoint) => endpoint.routeFamily),
    ["audit-review", "fhir-export"]
  );
});

test("CP9 browser checklist records registered-unavailable dependency instead of fake UI", async () => {
  const scenario = await loadCp9Scenario();
  const checklist = scenario.browserSmokeChecklist;

  assert.deepEqual(checklist.activeCp9ProductSurfaces, []);
  assert.equal(checklist.registeredUnavailableSurfaces.length, 2);
  assert.match(checklist.integrationDependency, /Activate Playwright CP9 product workflow smoke/);

  const renderedTextContract = checklist.registeredUnavailableSurfaces
    .flatMap((surface) => surface.requiredText)
    .join("\n");
  for (const forbidden of ["Export complete", "Audit approved", "FHIR exchange active"]) {
    assert.equal(renderedTextContract.includes(forbidden), false);
  }
});

function contextForActor(scenario, actorKey) {
  const actor = scenario.actors.find((candidate) => candidate.key === actorKey);
  assert.ok(actor, `missing actor ${actorKey}`);
  const tenant = scenario.tenants.find((candidate) => candidate.id === actor.tenantId);
  const clinic = scenario.clinics.find((candidate) => candidate.id === actor.clinicId);
  assert.ok(tenant, `missing tenant for ${actorKey}`);
  assert.ok(clinic, `missing clinic for ${actorKey}`);

  return {
    clinicAssignments: [
      {
        clinicId: clinic.id,
        status: "active",
        tenantId: tenant.id,
        userId: actor.id
      }
    ],
    memberships: [
      {
        status: "active",
        tenantId: tenant.id,
        userId: actor.id
      }
    ],
    principal: {
      displayName: actor.key,
      email: actor.email,
      issuer: "http://localhost:8080/realms/clinic-os-local",
      keycloakRoles: ["clinic-user"],
      subject: actor.key,
      username: actor.key
    },
    roleAssignments: [
      {
        clinicId: clinic.id,
        roleSlug: actor.roleSlug,
        tenantId: tenant.id,
        userId: actor.id
      }
    ],
    tenant: {
      displayName: tenant.name,
      id: tenant.id,
      legalName: tenant.name,
      slug: tenant.key,
      status: "active"
    },
    user: {
      displayName: actor.key,
      email: actor.email,
      id: actor.id,
      phone: null,
      status: "active"
    }
  };
}

function authorizeActor(context, request) {
  const tenantMatches = context.tenant.id === request.tenantId;
  const resourceTenantMatches = !request.resourceTenantId || request.resourceTenantId === request.tenantId;

  if (!tenantMatches || !resourceTenantMatches) {
    return { allowed: false, reason: "tenant_mismatch" };
  }

  const hasActiveMembership = context.memberships.some(
    (membership) => membership.tenantId === request.tenantId && membership.status === "active"
  );

  if (!hasActiveMembership) {
    return { allowed: false, reason: "inactive_membership" };
  }

  if (request.clinicId) {
    const hasClinicAssignment = context.clinicAssignments.some(
      (assignment) =>
        assignment.tenantId === request.tenantId &&
        assignment.clinicId === request.clinicId &&
        assignment.status === "active"
    );
    const hasTenantWideRole = context.roleAssignments.some(
      (assignment) => assignment.tenantId === request.tenantId && assignment.clinicId === null
    );

    if (!hasClinicAssignment && !hasTenantWideRole) {
      return { allowed: false, reason: "clinic_mismatch" };
    }
  }

  if (request.resourceClinicId && request.clinicId && request.resourceClinicId !== request.clinicId) {
    return { allowed: false, reason: "clinic_mismatch" };
  }

  const scopedRoles = [
    ...new Set(
      context.roleAssignments
        .filter((assignment) => {
          if (assignment.tenantId !== request.tenantId) return false;
          return assignment.clinicId === null || !request.clinicId || assignment.clinicId === request.clinicId;
        })
        .map((assignment) => assignment.roleSlug)
    )
  ];
  const permissions = permissionsForRoles(scopedRoles);

  if (!permissions.includes(request.permission)) {
    return { allowed: false, reason: "missing_permission" };
  }

  return { allowed: true, reason: "allowed" };
}
