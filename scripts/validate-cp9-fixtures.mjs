#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const CP9_SCENARIO_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp9",
  "performance_qa_flow.json"
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_EMAIL_PATTERN = /^[^@\s]+@example\.test$/;
const WEB_ROLE_SLUGS = new Set([
  "owner",
  "doctor",
  "assistant",
  "receptionist",
  "accountant",
  "platform_admin"
]);
const CLINIC_ROLE_SLUGS = new Set([
  "owner_admin",
  "doctor",
  "assistant",
  "receptionist",
  "accountant",
  "auditor",
  "platform_admin"
]);
const PERMISSION_KEYS = new Set([
  "audit.read",
  "break_glass.approve",
  "break_glass.request",
  "patient.export",
  "security.manage"
]);
const REQUIRED_ROUTE_FAMILIES = [
  "patient-export",
  "audit-review",
  "fhir-export",
  "break-glass",
  "retention"
];
const REQUIRED_TENANT_ISOLATION_FAMILIES = [
  "patient-export",
  "audit-review",
  "fhir-export",
  "break-glass",
  "retention"
];

export async function loadCp9Scenario(scenarioPath = CP9_SCENARIO_PATH) {
  const raw = await readFile(scenarioPath, "utf8");
  return JSON.parse(raw);
}

export function validateCp9Scenario(scenario) {
  assert.equal(scenario.schemaVersion, "clinic-os.cp9.performance-qa-fixture.v1");
  assertLocalSyntheticOnly(scenario);
  assert.equal(scenario.clock.businessDate, "2026-07-07");
  assert.equal(scenario.clock.timezone, "Asia/Kolkata");
  assertIsoWithOffset(scenario.clock.fixedNow, "clock.fixedNow");
  assertIsoWithOffset(scenario.clock.clinicHoursWindow.startsAt, "clock.clinicHoursWindow.startsAt");
  assertIsoWithOffset(scenario.clock.clinicHoursWindow.endsAt, "clock.clinicHoursWindow.endsAt");

  const knownTenantIds = new Set();
  const knownClinicIds = new Set();
  const knownActorKeys = new Set();
  const knownPatientIds = new Set();

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
    assert.match(actor.email, TEST_EMAIL_PATTERN, `actor ${actor.key}.email`);
    assert.ok(CLINIC_ROLE_SLUGS.has(actor.roleSlug), `actor ${actor.key}.roleSlug is not canonical`);
    assert.ok(WEB_ROLE_SLUGS.has(actor.webRoleSlug), `actor ${actor.key}.webRoleSlug is invalid`);
    knownActorKeys.add(actor.key);
  }

  for (const patient of scenario.patients) {
    assertUuid(patient.id, `patient ${patient.key}.id`);
    assertKnownReference(knownTenantIds, patient.tenantId, `patient ${patient.key}.tenantId`);
    assertKnownReference(knownClinicIds, patient.clinicId, `patient ${patient.key}.clinicId`);
    assert.match(patient.email, TEST_EMAIL_PATTERN, `patient ${patient.key}.email`);
    assert.equal(
      String(patient.fullName).includes("Synthetic"),
      true,
      `patient ${patient.key} must be visibly synthetic`
    );
    knownPatientIds.add(patient.id);
  }

  assertRouteContracts(scenario.routeContracts, knownActorKeys);
  assertTenantIsolation(scenario.tenantIsolationExpectations, knownActorKeys);
  assertRoleExpectations(scenario.roleExpectations, knownActorKeys);
  assertPerformanceSmoke(scenario.performanceSmoke, knownActorKeys);
  assertBrowserChecklist(scenario.browserSmokeChecklist);
  assertFixtureOnlyEvidence(scenario.fixtureOnlyEvidence);
  assertNoProductionPhiMarkers(scenario);

  return true;
}

export function summarizeCp9Scenario(scenario) {
  return {
    actors: scenario.actors.length,
    browserRegisteredUnavailableSurfaces:
      scenario.browserSmokeChecklist.registeredUnavailableSurfaces.length,
    fixtureOnlyEvidence: scenario.fixtureOnlyEvidence.length,
    performanceDeferredEndpoints: scenario.performanceSmoke.deferredEndpoints.length,
    performanceEndpoints: scenario.performanceSmoke.endpoints.length,
    roleExpectations: scenario.roleExpectations.length,
    routeContracts: scenario.routeContracts.length,
    tenantIsolationExpectations: scenario.tenantIsolationExpectations.length,
    tenants: scenario.tenants.length
  };
}

function assertRouteContracts(contracts, knownActorKeys) {
  const families = new Set(contracts.map((contract) => contract.routeFamily));
  for (const family of REQUIRED_ROUTE_FAMILIES) {
    assert.ok(families.has(family), `${family} route contract missing`);
  }

  for (const contract of contracts) {
    assertKnownKey(knownActorKeys, contract.actorKey, `route ${contract.key}.actorKey`);
    assertHttpMethod(contract.method, `route ${contract.key}.method`);
    assertV1Path(contract.path, `route ${contract.key}.path`);
    assert.ok(PERMISSION_KEYS.has(contract.requiredPermission), `${contract.key} permission invalid`);
    assert.ok([200, 201, 202].includes(contract.expectedStatus), `${contract.key} status invalid`);
    assert.equal(
      contract.liveImplemented,
      false,
      `${contract.key} must remain dry-run until CP9 route owner activates it`
    );
    assert.ok(Array.isArray(contract.expectedBodyMustNotInclude));
  }
}

function assertTenantIsolation(expectations, knownActorKeys) {
  const families = new Set(expectations.map((expectation) => expectation.routeFamily));
  for (const family of REQUIRED_TENANT_ISOLATION_FAMILIES) {
    assert.ok(families.has(family), `${family} tenant-isolation expectation missing`);
  }

  for (const expectation of expectations) {
    assertKnownKey(knownActorKeys, expectation.actorKey, `tenant ${expectation.key}.actorKey`);
    assertHttpMethod(expectation.method, `tenant ${expectation.key}.method`);
    assertV1Path(expectation.path, `tenant ${expectation.key}.path`);
    assert.ok(
      PERMISSION_KEYS.has(expectation.requiredPermission),
      `${expectation.key} permission invalid`
    );
    assert.equal(expectation.expected, "deny");
    assert.equal(expectation.expectedStatus, 403);
    assert.equal(expectation.expectedReason, "tenant_mismatch");
    assert.equal(
      expectation.liveImplemented,
      false,
      `${expectation.key} must remain dry-run until route owner activates it`
    );
  }
}

function assertRoleExpectations(expectations, knownActorKeys) {
  for (const expectation of expectations) {
    assertKnownKey(knownActorKeys, expectation.actorKey, `role ${expectation.key}.actorKey`);
    assert.ok(PERMISSION_KEYS.has(expectation.permission), `${expectation.key} permission invalid`);
    assert.ok(["allow", "deny"].includes(expectation.expected), `${expectation.key} invalid`);
    if (expectation.mustDenyPermission) {
      assert.ok(PERMISSION_KEYS.has(expectation.mustDenyPermission));
    }
    if (expectation.expected === "deny") {
      assert.equal(expectation.expectedReason, "missing_permission");
    }
  }
}

function assertPerformanceSmoke(performanceSmoke, knownActorKeys) {
  const thresholds = performanceSmoke.thresholds;
  assert.equal(performanceSmoke.mode, "read_only_local_smoke");
  assert.ok(Number.isInteger(thresholds.concurrency) && thresholds.concurrency >= 2);
  assert.ok(Number.isInteger(thresholds.totalRequests) && thresholds.totalRequests >= 24);
  assert.ok(thresholds.maxP95LatencyMs >= 250 && thresholds.maxP95LatencyMs <= 2000);
  assert.ok(thresholds.maxP99LatencyMs >= thresholds.maxP95LatencyMs);
  assert.equal(thresholds.maxErrorRate, 0);
  assert.equal(thresholds.maxStatus429Rate, 0);
  assert.ok(thresholds.maxResponseBytes <= 1024 * 1024);

  for (const endpoint of performanceSmoke.endpoints) {
    assertHttpMethod(endpoint.method, `load ${endpoint.key}.method`);
    assert.ok(
      endpoint.path.startsWith("/v1/") || endpoint.path.startsWith("/health/"),
      `load ${endpoint.key}.path must be API or health route`
    );
    if (endpoint.actorKey) {
      assertKnownKey(knownActorKeys, endpoint.actorKey, `load ${endpoint.key}.actorKey`);
    }
    assert.equal(endpoint.expectedStatus, 200);
    assert.equal(endpoint.liveImplemented, true);
    assert.equal(typeof endpoint.requiresAuth, "boolean");
  }

  for (const endpoint of performanceSmoke.deferredEndpoints) {
    assertV1Path(endpoint.path, `deferred load ${endpoint.key}.path`, { allowTemplate: true });
    assert.ok(REQUIRED_ROUTE_FAMILIES.includes(endpoint.routeFamily));
    assert.match(endpoint.reason, /owns canonical|route activation/i);
  }
}

function assertBrowserChecklist(checklist) {
  assert.deepEqual(checklist.activeCp9ProductSurfaces, []);
  assert.equal(checklist.registeredUnavailableSurfaces.length, 2);
  assert.equal(checklist.mobileViewport.width, 390);
  assert.equal(checklist.mobileViewport.maxHorizontalOverflowPx, 1);

  for (const surface of checklist.registeredUnavailableSurfaces) {
    assert.ok(surface.path.startsWith("/surface/"));
    assert.ok(WEB_ROLE_SLUGS.has(surface.role));
    assert.ok(surface.requiredText.includes("Unavailable"));
    assert.ok(surface.mustNotInclude.length > 0);
  }
}

function assertFixtureOnlyEvidence(rows) {
  const keys = new Set(rows.map((row) => row.key));
  for (const key of ["abdm-feature-gate", "backup-restore-boundary", "browser-cp9-unavailable-state"]) {
    assert.ok(keys.has(key), `${key} fixture-only evidence missing`);
  }

  for (const row of rows) {
    assert.equal(typeof row.reason, "string");
    assert.ok(row.mustNotInclude.length > 0);
  }
}

function assertLocalSyntheticOnly(scenario) {
  assert.equal(scenario.fixtureUse.localOnly, true);
  assert.equal(scenario.fixtureUse.syntheticOnly, true);
  assert.equal(scenario.fixtureUse.productionUseDenied, true);
  assert.deepEqual(scenario.fixtureUse.allowedEnvironments, ["local", "development", "test", "ci"]);
}

function assertNoProductionPhiMarkers(scenario) {
  const serialized = JSON.stringify(scenario);
  assert.equal(/\+91\s?\d{10}/.test(serialized), false, "CP9 fixture must not include phone numbers");
  assert.equal(/sk_live|rzp_live|AKIA[0-9A-Z]{16}/.test(serialized), false, "CP9 fixture leaked a secret-like token");
  assert.equal(/ABHA-\d{2,}/i.test(serialized), false, "CP9 fixture must not include real ABHA-like ids");
}

function assertUuid(value, label) {
  assert.equal(typeof value, "string", `${label} must be string`);
  assert.match(value, UUID_PATTERN, `${label} must be deterministic UUIDv4-shaped id`);
}

function assertKnownReference(knownValues, value, label) {
  assert.ok(knownValues.has(value), `${label} references unknown id ${value}`);
}

function assertKnownKey(knownKeys, value, label) {
  assert.ok(knownKeys.has(value), `${label} references unknown key ${value}`);
}

function assertHttpMethod(value, label) {
  assert.ok(["GET", "POST", "PATCH", "PUT"].includes(value), `${label} uses unsupported method`);
}

function assertV1Path(value, label, options = {}) {
  assert.equal(typeof value, "string", `${label} must be string`);
  assert.ok(value.startsWith("/v1/"), `${label} must be a /v1 route`);
  if (!options.allowTemplate) {
    assert.equal(value.includes("{"), false, `${label} must not contain template braces`);
  }
}

function assertIsoWithOffset(value, label) {
  assert.equal(typeof value, "string", `${label} must be string`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/);
}

async function main() {
  const scenario = await loadCp9Scenario();
  validateCp9Scenario(scenario);
  console.log(JSON.stringify(summarizeCp9Scenario(scenario), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
