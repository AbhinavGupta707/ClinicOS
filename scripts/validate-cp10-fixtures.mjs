#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  isClinicRoleSlug,
  isPermissionKey,
  permissionsForRoles
} from "../packages/domain/src/permissions.ts";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const CP10_SCENARIO_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp10",
  "clinic_day_regression_flow.json"
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_EMAIL_PATTERN = /^[^@\s]+@example\.test$/;
const TEST_PHONE_PATTERN = /^\+91991000\d{4}$/;
const WEB_ROLE_SLUGS = new Set([
  "owner",
  "doctor",
  "assistant",
  "receptionist",
  "accountant",
  "platform_admin"
]);
const REQUIRED_CHECKPOINTS = [2, 3, 4, 5, 6, 7, 8, 9];
const REQUIRED_SEGMENT_KEYS = [
  "lead-patient-appointment",
  "intake-consent-encounter",
  "dental-chart-media",
  "treatment-checkout-payment-instructions",
  "continuity-lab-inventory-events",
  "integration-migration-ops",
  "ai-review-safety",
  "security-privacy-readiness",
  "owner-dashboard"
];
const REQUIRED_ROUTE_FAMILIES = [
  "leads",
  "patients",
  "appointments",
  "queue",
  "intake",
  "consent",
  "encounter",
  "dental-chart",
  "media-upload",
  "media-signed-access",
  "treatment-plan",
  "billing",
  "payment",
  "instructions",
  "tasks",
  "recalls",
  "lab",
  "inventory",
  "incidents",
  "owner-dashboard",
  "provider-health",
  "migration-row-resolution",
  "ai-scribe",
  "patient-export",
  "retention"
];
const REQUIRED_ACTOR_KEYS = [
  "owner",
  "doctor",
  "assistant",
  "receptionist",
  "accountant",
  "auditor",
  "platformSupport",
  "wrongTenantOwner"
];
const KNOWN_SURFACES = new Set([
  "accounting",
  "appointments",
  "chart-drafts",
  "checkout",
  "compliance",
  "dental-media",
  "encounter",
  "integrations",
  "lab",
  "lead-inbox",
  "note-drafts",
  "operations",
  "owner-control",
  "patients",
  "pilot-readiness",
  "platform-support",
  "tasks",
  "today"
]);
const REQUIRED_BROWSER_ENV = [
  "NEXT_PUBLIC_CLINIC_OS_USE_DEV_ME_FIXTURE=true",
  "NEXT_PUBLIC_CLINIC_OS_USE_CP2_WORKFLOW_FIXTURE=true",
  "NEXT_PUBLIC_CLINIC_OS_USE_CP3_WORKFLOW_FIXTURE=true",
  "NEXT_PUBLIC_CLINIC_OS_USE_CP4_WORKFLOW_FIXTURE=true",
  "NEXT_PUBLIC_CLINIC_OS_USE_CP5_WORKFLOW_FIXTURE=true",
  "NEXT_PUBLIC_CLINIC_OS_USE_CP6_OPERATIONS_FIXTURE=true",
  "NEXT_PUBLIC_CLINIC_OS_USE_CP7_INTEGRATION_OPS_FIXTURE=true",
  "NEXT_PUBLIC_CLINIC_OS_USE_CP8_REVIEW_FIXTURE=true"
];
const FORBIDDEN_LIVE_ROUTE_PATTERNS = [
  /\/v1\/patients\/[^/]+\/media\/upload-url/,
  /\/v1\/media-assets\//,
  /\/signed-access\b/,
  /\/external-media-links\b/
];

export async function loadCp10Scenario(scenarioPath = CP10_SCENARIO_PATH) {
  const raw = await readFile(scenarioPath, "utf8");
  return JSON.parse(raw);
}

export function validateCp10Scenario(scenario) {
  assert.equal(scenario.schemaVersion, "clinic-os.cp10.release-candidate-qa-fixture.v1");
  assertLocalSyntheticOnly(scenario);
  assert.equal(scenario.clock.businessDate, "2026-07-07");
  assert.equal(scenario.clock.timezone, "Asia/Kolkata");
  assertIsoWithOffset(scenario.clock.fixedNow, "clock.fixedNow");
  assertIsoWithOffset(scenario.clock.clinicDayWindow.startsAt, "clock.clinicDayWindow.startsAt");
  assertIsoWithOffset(scenario.clock.clinicDayWindow.endsAt, "clock.clinicDayWindow.endsAt");

  const knownTenantIds = new Set();
  const knownClinicIds = new Set();
  const knownActorKeys = new Set();

  for (const tenant of scenario.tenants) {
    assertUuid(tenant.id, `tenant ${tenant.key}.id`);
    knownTenantIds.add(tenant.id);
  }

  for (const clinic of scenario.clinics) {
    assertUuid(clinic.id, `clinic ${clinic.key}.id`);
    assertKnownReference(knownTenantIds, clinic.tenantId, `clinic ${clinic.key}.tenantId`);
    knownClinicIds.add(clinic.id);
  }

  for (const actor of scenario.actors) {
    assertUuid(actor.id, `actor ${actor.key}.id`);
    assertKnownReference(knownTenantIds, actor.tenantId, `actor ${actor.key}.tenantId`);
    assertKnownReference(knownClinicIds, actor.clinicId, `actor ${actor.key}.clinicId`);
    assert.equal(isClinicRoleSlug(actor.roleSlug), true, `actor ${actor.key}.roleSlug invalid`);
    if (actor.webRoleSlug !== null) {
      assert.ok(WEB_ROLE_SLUGS.has(actor.webRoleSlug), `actor ${actor.key}.webRoleSlug invalid`);
    }
    assert.match(actor.email, TEST_EMAIL_PATTERN, `actor ${actor.key}.email`);
    knownActorKeys.add(actor.key);
  }

  for (const actorKey of REQUIRED_ACTOR_KEYS) {
    assert.ok(knownActorKeys.has(actorKey), `${actorKey} actor missing`);
  }

  for (const patient of scenario.patients) {
    assertUuid(patient.id, `patient ${patient.key}.id`);
    assertKnownReference(knownTenantIds, patient.tenantId, `patient ${patient.key}.tenantId`);
    assertKnownReference(knownClinicIds, patient.clinicId, `patient ${patient.key}.clinicId`);
    assert.match(patient.email, TEST_EMAIL_PATTERN, `patient ${patient.key}.email`);
    assert.match(patient.phone, TEST_PHONE_PATTERN, `patient ${patient.key}.phone`);
    assert.match(patient.fullName, /Synthetic/, `patient ${patient.key} must be synthetic`);
  }

  assertSourceReferences(scenario.sourceReferences);
  assertClinicDayWorkflow(scenario.clinicDayWorkflow, knownActorKeys);
  assertRoleMatrix(scenario.roleMatrix, knownActorKeys);
  assertTenantIsolation(scenario.tenantIsolationAssertions, knownActorKeys);
  assertProviderUnavailableChecks(scenario.providerUnavailableChecks);
  assertMigrationEvidence(scenario.migrationDryRunEvidence);
  assertDeferredEvidence(scenario.fixtureOnlyOrDeferredEvidence);
  assertBrowserSmokePlan(scenario.browserSmokePlan);

  return true;
}

export function summarizeCp10Scenario(scenario) {
  return {
    actors: scenario.actors.length,
    browserSurfaces: scenario.browserSmokePlan.surfaces.length,
    deferredEvidence: scenario.fixtureOnlyOrDeferredEvidence.length,
    migrationEvidence: scenario.migrationDryRunEvidence.length,
    providerUnavailableChecks: scenario.providerUnavailableChecks.length,
    roleMatrixRows: scenario.roleMatrix.length,
    sourceReferences: scenario.sourceReferences.length,
    tenantIsolationAssertions: scenario.tenantIsolationAssertions.length,
    workflowSegments: scenario.clinicDayWorkflow.segments.length,
    workflowSteps: scenario.clinicDayWorkflow.segments.flatMap((segment) => segment.steps).length
  };
}

function assertSourceReferences(sourceReferences) {
  const checkpointSet = new Set(sourceReferences.map((reference) => reference.checkpoint));
  for (const checkpoint of REQUIRED_CHECKPOINTS) {
    assert.ok(checkpointSet.has(checkpoint), `CP${checkpoint} source reference missing`);
  }

  for (const reference of sourceReferences) {
    assert.match(reference.fixturePath, /^fixtures\/synthetic\/cp\d\//);
    assert.match(reference.validator, /^node scripts\/validate-cp\d-fixtures\.mjs/);
    assert.match(reference.contractSmoke, /^node scripts\/cp\d-contract-smoke\.mjs --dry-run/);
    assert.equal(typeof reference.evidenceBoundary, "string");
    assert.notEqual(reference.evidenceBoundary.trim(), "");
  }
}

function assertClinicDayWorkflow(workflow, knownActorKeys) {
  assert.equal(workflow.mode, "deterministic_contract_dry_run");
  assert.match(workflow.coverageAssertion, /lead -> patient -> appointment -> intake -> encounter/);
  assert.match(workflow.coverageAssertion, /owner dashboard/);

  const segmentKeys = new Set(workflow.segments.map((segment) => segment.key));
  for (const key of REQUIRED_SEGMENT_KEYS) {
    assert.ok(segmentKeys.has(key), `${key} segment missing`);
  }

  const routeFamilies = new Set(workflow.segments.flatMap((segment) => segment.routeFamilies));
  for (const family of REQUIRED_ROUTE_FAMILIES) {
    assert.ok(routeFamilies.has(family), `${family} route family missing`);
  }

  for (const segment of workflow.segments) {
    assert.equal(segment.implemented, true, `${segment.key} must cover implemented workflow only`);
    assert.ok(
      REQUIRED_CHECKPOINTS.includes(segment.checkpoint),
      `${segment.key} checkpoint invalid`
    );
    assertKnownKey(knownActorKeys, segment.primaryActorKey, `${segment.key}.primaryActorKey`);
    assert.ok(Array.isArray(segment.routeFamilies) && segment.routeFamilies.length > 0);
    assert.ok(Array.isArray(segment.steps) && segment.steps.length > 0);

    for (const step of segment.steps) {
      assertKnownKey(knownActorKeys, step.actorKey, `step ${step.key}.actorKey`);
      assertHttpMethod(step.method, `step ${step.key}.method`);
      assertApiPath(step.path, `step ${step.key}.path`);
      assertStatusList(step.expectedStatus, `step ${step.key}.expectedStatus`);
      assert.equal(typeof step.liveImplemented, "boolean", `step ${step.key}.liveImplemented`);
      if (step.liveImplemented) assertNoLegacyLiveRoute(step.path, step.key);
      if (step.providerBoundary)
        assert.match(step.providerBoundary, /simulator|unavailable|request|review/i);
    }
  }
}

function assertRoleMatrix(roleMatrix, knownActorKeys) {
  const actorRows = new Set(roleMatrix.map((row) => row.actorKey));
  for (const actorKey of [
    "owner",
    "doctor",
    "assistant",
    "receptionist",
    "accountant",
    "auditor",
    "platformSupport"
  ]) {
    assert.ok(actorRows.has(actorKey), `${actorKey} role-matrix row missing`);
  }

  for (const row of roleMatrix) {
    assertKnownKey(knownActorKeys, row.actorKey, `role row ${row.actorKey}`);
    assert.equal(isClinicRoleSlug(row.roleSlug), true, `${row.actorKey}.roleSlug invalid`);

    const grants = new Set(permissionsForRoles([row.roleSlug]));
    for (const permission of row.mustAllowPermissions) {
      assert.equal(isPermissionKey(permission), true, `${row.actorKey} allow permission invalid`);
      assert.ok(grants.has(permission), `${row.actorKey} must grant ${permission}`);
    }
    for (const permission of row.mustDenyPermissions) {
      assert.equal(isPermissionKey(permission), true, `${row.actorKey} deny permission invalid`);
      assert.equal(
        grants.has(permission),
        false,
        `${row.actorKey} unexpectedly grants ${permission}`
      );
    }
    for (const surface of [...row.mustSeeSurfaces, ...row.mustNotSeeSurfaces]) {
      assert.ok(
        KNOWN_SURFACES.has(surface),
        `${row.actorKey} references unknown surface ${surface}`
      );
    }
  }
}

function assertTenantIsolation(expectations, knownActorKeys) {
  assert.ok(expectations.length >= 5, "tenant isolation must cover at least five route families");
  const families = new Set();

  for (const expectation of expectations) {
    assertKnownKey(knownActorKeys, expectation.actorKey, `tenant ${expectation.key}.actorKey`);
    assertHttpMethod(expectation.method, `tenant ${expectation.key}.method`);
    assertApiPath(expectation.path, `tenant ${expectation.key}.path`);
    assert.equal(isPermissionKey(expectation.requiredPermission), true);
    assert.equal(expectation.expected, "deny");
    assertStatusList(expectation.expectedStatus, `tenant ${expectation.key}.expectedStatus`);
    assert.ok(expectation.expectedStatus.includes(403), `${expectation.key} must accept 403`);
    assert.equal(expectation.expectedReason, "tenant_mismatch");
    assert.equal(expectation.liveImplemented, true);
    families.add(expectation.requiredPermission);
  }

  for (const permission of [
    "patient.read",
    "clinical.note.sign",
    "media.read",
    "billing.read",
    "analytics.read"
  ]) {
    assert.ok(families.has(permission), `${permission} tenant assertion missing`);
  }
}

function assertProviderUnavailableChecks(checks) {
  const providers = new Set(checks.map((check) => check.providerKey));
  for (const provider of ["whatsapp_cloud", "razorpay", "exotel", "ai_gateway", "abdm", "aws"]) {
    assert.ok(providers.has(provider), `${provider} provider unavailable check missing`);
  }

  for (const check of checks) {
    assert.equal(check.liveProviderReady, false, `${check.key} must not claim live readiness`);
    assert.ok(Array.isArray(check.mustReportState) && check.mustReportState.length > 0);
    assert.ok(Array.isArray(check.mustNotClaim) && check.mustNotClaim.length > 0);
    assert.equal(
      check.mustReportState.includes("available"),
      false,
      `${check.key} must not say available`
    );
    assert.match(check.evidence, /CP[5789]|Terraform|restore/i);
  }
}

function assertMigrationEvidence(rows) {
  assert.ok(rows.length >= 2, "migration dry-run evidence needs CP7 and CP9 references");
  const serialized = JSON.stringify(rows);
  assert.match(serialized, /rows\/\{rowId\}\/resolve/, "row-based migration resolution missing");
  assert.match(serialized, /non-mutating default/, "restore dry-run non-mutating evidence missing");
  assert.doesNotMatch(serialized, /conflicts\/\{conflictId\}\/resolve/);
}

function assertDeferredEvidence(rows) {
  assert.ok(rows.length >= 3, "deferred evidence register too small");
  for (const row of rows) {
    assert.equal(row.mustNotMarkPassed, true, `${row.key} must be marked as not passed`);
    assert.match(row.reason, /deferred|requires?|not a live/i);
  }
}

function assertBrowserSmokePlan(plan) {
  assert.equal(plan.mode, "gated_playwright_existing_surfaces");
  for (const env of REQUIRED_BROWSER_ENV) {
    assert.ok(plan.requiredFixtureEnv.includes(env), `${env} missing from browser fixture env`);
  }
  assert.equal(plan.mobileViewport.width, 390);
  assert.ok(plan.mobileViewport.maxHorizontalOverflowPx <= 1);
  assert.ok(plan.surfaces.length >= 3);

  for (const surface of plan.surfaces) {
    assert.ok(WEB_ROLE_SLUGS.has(surface.role), `${surface.key} role invalid`);
    for (const requestPath of surface.paths) {
      assert.ok(requestPath.startsWith("/surface/"), `${surface.key} path must be a surface route`);
    }
    const requiredTextOrIds = [...(surface.expectedTestIds ?? []), ...(surface.expectedText ?? [])];
    assert.ok(requiredTextOrIds.length > 0, `${surface.key} must assert visible output`);
    for (const forbidden of surface.mustNotContain ?? []) {
      assert.equal(typeof forbidden, "string");
      assert.notEqual(forbidden.trim(), "");
    }
  }
}

function assertLocalSyntheticOnly(scenario) {
  assert.equal(scenario.fixtureUse.localOnly, true, "fixture must be local-only");
  assert.equal(scenario.fixtureUse.syntheticOnly, true, "fixture must be synthetic-only");
  assert.equal(scenario.fixtureUse.productionUseDenied, true, "fixture must deny production use");
  assert.deepEqual(scenario.fixtureUse.allowedEnvironments, ["local", "development", "test", "ci"]);

  const serialized = JSON.stringify(scenario);
  const emails = serialized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const email of emails) {
    assert.match(email, TEST_EMAIL_PATTERN, `${email} must use .example.test`);
  }

  const forbiddenPatterns = [
    /@gmail\.com/i,
    /@yahoo\./i,
    /@hotmail\./i,
    /sk_live/i,
    /rzp_live/i,
    /razorpay_live/i,
    /access[_-]?token/i,
    /key[_-]?secret/i,
    /webhook[_-]?secret/i,
    /aadhaar/i,
    /pan[_-]?card/i,
    /upi:\/\/pay/i
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(serialized), false, `fixture contains forbidden pattern ${pattern}`);
  }
}

function assertNoLegacyLiveRoute(stepPath, key) {
  for (const pattern of FORBIDDEN_LIVE_ROUTE_PATTERNS) {
    assert.equal(pattern.test(stepPath), false, `${key} uses legacy/deferred route ${stepPath}`);
  }
}

function assertUuid(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string UUID`);
  assert.match(value, UUID_PATTERN, `${label} must be a deterministic v4-style UUID`);
}

function assertKnownReference(ids, value, label) {
  assertUuid(value, label);
  assert.ok(ids.has(value), `${label} references unknown id ${value}`);
}

function assertKnownKey(keys, value, label) {
  assert.equal(typeof value, "string", `${label} must be a string key`);
  assert.ok(keys.has(value), `${label} references unknown key ${value}`);
}

function assertIsoWithOffset(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
}

function assertHttpMethod(value, label) {
  assert.ok(["GET", "POST", "PATCH", "PUT"].includes(value), `${label} method invalid`);
}

function assertApiPath(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok(
    value.startsWith("/v1/") || value.startsWith("/health/"),
    `${label} must be a canonical API path`
  );
}

function assertStatusList(value, label) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  assert.ok(value.length > 0, `${label} must not be empty`);
  for (const status of value) {
    assert.ok(Number.isInteger(status), `${label} status must be integer`);
    assert.ok(status >= 200 && status <= 599, `${label} status out of range`);
  }
}

async function main() {
  const scenario = await loadCp10Scenario();
  validateCp10Scenario(scenario);
  console.log("CP10 release-candidate QA fixture is valid:");
  console.log(JSON.stringify(summarizeCp10Scenario(scenario), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
