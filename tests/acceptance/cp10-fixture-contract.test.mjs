import assert from "node:assert/strict";
import test from "node:test";
import { permissionsForRoles } from "../../packages/domain/src/permissions.ts";
import { buildCp4SmokePlan } from "../../scripts/cp4-contract-smoke.mjs";
import { buildCp10SmokePlan } from "../../scripts/cp10-contract-smoke.mjs";
import { loadCp4Scenario } from "../../scripts/validate-cp4-fixtures.mjs";
import {
  loadCp10Scenario,
  summarizeCp10Scenario,
  validateCp10Scenario
} from "../../scripts/validate-cp10-fixtures.mjs";

test("CP10 release-candidate scenario is deterministic and local-test only", async () => {
  const scenario = await loadCp10Scenario();

  assert.equal(validateCp10Scenario(scenario), true);
  assert.deepEqual(summarizeCp10Scenario(scenario), {
    actors: 8,
    browserSurfaces: 3,
    deferredEvidence: 3,
    migrationEvidence: 2,
    providerUnavailableChecks: 6,
    roleMatrixRows: 7,
    sourceReferences: 8,
    tenantIsolationAssertions: 5,
    workflowSegments: 9,
    workflowSteps: 37
  });
});

test("CP10 clinic-day plan covers the implemented dental-first chain only", async () => {
  const scenario = await loadCp10Scenario();
  const plan = buildCp10SmokePlan(scenario);
  const routeFamilies = new Set(plan.workflowRequests.flatMap((request) => request.routeFamilies));

  for (const family of [
    "leads",
    "patients",
    "appointments",
    "intake",
    "encounter",
    "dental-chart",
    "media-upload",
    "treatment-plan",
    "billing",
    "payment",
    "instructions",
    "tasks",
    "recalls",
    "lab",
    "inventory",
    "incidents",
    "owner-dashboard"
  ]) {
    assert.ok(routeFamilies.has(family), `${family} missing from CP10 workflow`);
  }

  assert.equal(
    plan.workflowRequests.every((request) => request.liveImplemented),
    true
  );
  assert.equal(
    JSON.stringify(plan.workflowRequests).includes("/external-media-links"),
    false,
    "external imaging links must remain deferred"
  );
  assert.equal(
    JSON.stringify(plan.workflowRequests).includes("/media-assets/"),
    false,
    "legacy CP4 media-assets routes must not re-enter CP10 live plan"
  );
});

test("CP10 role matrix matches current domain permission grants", async () => {
  const scenario = await loadCp10Scenario();

  for (const row of scenario.roleMatrix) {
    const grants = new Set(permissionsForRoles([row.roleSlug]));
    for (const permission of row.mustAllowPermissions) {
      assert.ok(grants.has(permission), `${row.actorKey} should grant ${permission}`);
    }
    for (const permission of row.mustDenyPermissions) {
      assert.equal(grants.has(permission), false, `${row.actorKey} must deny ${permission}`);
    }
  }

  const accountant = scenario.roleMatrix.find((row) => row.actorKey === "accountant");
  assert.ok(accountant);
  assert.deepEqual(accountant.mustSeeSurfaces, ["checkout", "accounting"]);
  for (const denied of [
    "patient.phi.read",
    "clinical.note.read",
    "dental.chart.read",
    "media.read"
  ]) {
    assert.ok(accountant.mustDenyPermissions.includes(denied), `accountant must deny ${denied}`);
  }

  const auditor = scenario.roleMatrix.find((row) => row.actorKey === "auditor");
  assert.ok(auditor);
  assert.deepEqual(auditor.mustAllowPermissions, ["audit.read", "audit.review", "analytics.read"]);
  assert.deepEqual(auditor.mustSeeSurfaces, []);
});

test("CP10 tenant-isolation assertions deny cross-tenant access even with powerful roles", async () => {
  const scenario = await loadCp10Scenario();
  const primaryTenant = scenario.tenants.find((tenant) => tenant.key === "primaryTenant");
  const primaryClinic = scenario.clinics.find((clinic) => clinic.key === "primaryClinic");
  const wrongTenantContext = contextForActor(scenario, "wrongTenantOwner");

  for (const expectation of scenario.tenantIsolationAssertions) {
    const decision = authorizeActor(wrongTenantContext, {
      clinicId: wrongTenantContext.clinicAssignments[0].clinicId,
      permission: expectation.requiredPermission,
      resourceClinicId: primaryClinic.id,
      resourceTenantId: primaryTenant.id,
      tenantId: wrongTenantContext.tenant.id
    });

    assert.equal(decision.allowed, false, expectation.key);
    assert.equal(decision.reason, "tenant_mismatch", expectation.key);
  }
});

test("CP10 provider checks distinguish simulator/no-credential evidence from live readiness", async () => {
  const scenario = await loadCp10Scenario();
  const checksByProvider = new Map(
    scenario.providerUnavailableChecks.map((check) => [check.providerKey, check])
  );

  for (const provider of ["whatsapp_cloud", "razorpay", "exotel", "ai_gateway", "abdm", "aws"]) {
    const check = checksByProvider.get(provider);
    assert.ok(check, `${provider} check missing`);
    assert.equal(check.liveProviderReady, false, provider);
    assert.equal(check.mustReportState.includes("available"), false, provider);
  }

  assert.match(checksByProvider.get("ai_gateway").mode, /simulator/);
  assert.ok(
    checksByProvider
      .get("ai_gateway")
      .mustNotClaim.some((claim) => /clinical record updated by AI/i.test(claim))
  );
  assert.ok(
    checksByProvider
      .get("whatsapp_cloud")
      .mustNotClaim.every((claim) => !/provider confirmed/i.test(claim))
  );
});

test("CP10 migration references preserve row-based dry-run evidence", async () => {
  const scenario = await loadCp10Scenario();
  const migrationText = JSON.stringify(scenario.migrationDryRunEvidence);

  assert.match(migrationText, /rows\/\{rowId\}\/resolve/);
  assert.match(migrationText, /no overwrite without explicit resolution/);
  assert.match(migrationText, /non-mutating default/);
  assert.doesNotMatch(migrationText, /conflicts\/\{conflictId\}\/resolve/);
});

test("CP10 browser plan covers implemented surfaces and unavailable shells honestly", async () => {
  const scenario = await loadCp10Scenario();
  const plan = buildCp10SmokePlan(scenario).browserSmokePlan;

  assert.equal(plan.mobileViewport.width, 390);
  assert.ok(plan.requiredFixtureEnv.includes("NEXT_PUBLIC_CLINIC_OS_USE_CP8_REVIEW_FIXTURE=true"));

  const assistant = plan.surfaces.find((surface) => surface.key === "assistant-clinic-day-chain");
  assert.ok(assistant);
  assert.ok(assistant.expectedTestIds.includes("cp7-integration-ops-workspace"));
  assert.ok(assistant.expectedTestIds.includes("cp8-ai-review-workspace"));
  assert.ok(assistant.mustNotContain.includes("signed by AI"));

  const platform = plan.surfaces.find(
    (surface) => surface.key === "platform-support-unavailable-shell"
  );
  assert.ok(platform);
  assert.ok(platform.mustNotContain.includes("Break-glass approved"));
});

test("CP10 keeps CP4 durable media route assumptions canonical", async () => {
  const cp4Scenario = await loadCp4Scenario();
  const cp4Plan = buildCp4SmokePlan(cp4Scenario);
  const cp10Scenario = await loadCp10Scenario();
  const cp10Plan = buildCp10SmokePlan(cp10Scenario);
  const cp10MediaRoutes = cp10Plan.workflowRequests
    .filter((request) => request.segmentKey === "dental-chart-media")
    .map((request) => `${request.method} ${request.path}`);

  assert.ok(
    cp4Plan.flowRequests.some((request) => request.path === "/v1/media/upload-urls"),
    "CP4 canonical upload-url route missing"
  );
  assert.ok(
    cp4Plan.flowRequests.some(
      (request) => request.path === "/v1/media/assets/{mediaAssetId}/signed-url"
    ),
    "CP4 canonical signed-url route missing"
  );
  assert.deepEqual(
    cp10MediaRoutes.filter((route) => route.includes("/media/")),
    [
      "POST /v1/media/upload-urls",
      "PUT /v1/media/uploads/{uploadId}/content",
      "POST /v1/media/uploads/{uploadId}/complete",
      "POST /v1/media/assets/{mediaAssetId}/signed-url"
    ]
  );
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
    roleAssignments: [
      {
        clinicId: clinic.id,
        roleSlug: actor.roleSlug,
        tenantId: tenant.id,
        userId: actor.id
      }
    ],
    tenant: {
      id: tenant.id
    }
  };
}

function authorizeActor(context, request) {
  const tenantMatches = context.tenant.id === request.tenantId;
  const resourceTenantMatches =
    !request.resourceTenantId || request.resourceTenantId === request.tenantId;

  if (!tenantMatches || !resourceTenantMatches) {
    return { allowed: false, reason: "tenant_mismatch" };
  }

  const hasClinicAssignment = context.clinicAssignments.some(
    (assignment) =>
      assignment.tenantId === request.tenantId &&
      assignment.clinicId === request.clinicId &&
      assignment.status === "active"
  );

  if (!hasClinicAssignment) {
    return { allowed: false, reason: "clinic_mismatch" };
  }

  if (request.resourceClinicId && request.resourceClinicId !== request.clinicId) {
    return { allowed: false, reason: "clinic_mismatch" };
  }

  const permissions = permissionsForRoles(
    context.roleAssignments
      .filter((assignment) => assignment.tenantId === request.tenantId)
      .map((assignment) => assignment.roleSlug)
  );

  if (!permissions.includes(request.permission)) {
    return { allowed: false, reason: "missing_permission" };
  }

  return { allowed: true, reason: "allowed" };
}
