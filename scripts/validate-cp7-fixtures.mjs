#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const CP7_SCENARIO_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp7",
  "integration_ops_migration_flow.json"
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_EMAIL_PATTERN = /^[^@\s]+@example\.test$/;
const REQUIRED_PROVIDER_KEYS = [
  "whatsapp_cloud",
  "razorpay",
  "exotel",
  "google_business_profile"
];
const REQUIRED_ROUTE_FAMILIES = [
  "provider-health",
  "dead-letter-events",
  "dead-letter-replay",
  "migration-batches",
  "migration-row-resolution",
  "migration-commit"
];
const REQUIRED_BROWSER_SELECTORS = [
  "workspace",
  "fixtureAlert",
  "providerReadiness",
  "providerDashboard",
  "deadLetterReplay",
  "replayAction",
  "replayStatus",
  "migrationReview",
  "migrationStatus",
  "resolveMigrationConflict",
  "commitMigrationBatch",
  "timeline"
];

export async function loadCp7Scenario(scenarioPath = CP7_SCENARIO_PATH) {
  const raw = await readFile(scenarioPath, "utf8");
  return JSON.parse(raw);
}

export function validateCp7Scenario(scenario) {
  assert.equal(scenario.schemaVersion, "clinic-os.cp7.qa-fixture.v1");
  assertLocalSyntheticOnly(scenario);
  assert.equal(scenario.clock.businessDate, "2026-07-07");
  assert.equal(scenario.clock.timezone, "Asia/Kolkata");
  assertIsoWithOffset(scenario.clock.fixedNow, "clock.fixedNow");

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
    assert.match(actor.email, TEST_EMAIL_PATTERN, `actor ${actor.key}.email`);
    knownActorKeys.add(actor.key);
  }

  assertProviderHealth(scenario.providerHealth);
  assertDeadLetters(scenario.deadLetterEvents);
  assertMigrationBatches(scenario.migrationBatches);
  assertFlow(scenario, knownActorKeys);
  assertBrowserSelectors(scenario.browserSelectorContract);

  return true;
}

export function summarizeCp7Scenario(scenario) {
  const rows = scenario.migrationBatches.flatMap((batch) => batch.rows);
  return {
    actors: scenario.actors.length,
    deadLetterEvents: scenario.deadLetterEvents.length,
    fixtureRows: rows.length,
    flowSteps: scenario.flow.steps.length,
    migrationBatches: scenario.migrationBatches.length,
    providerHealthChecks: scenario.providerHealth.length,
    unresolvedMigrationConflicts: scenario.migrationBatches.flatMap((batch) =>
      batch.conflicts.filter((conflict) => conflict.status === "unresolved")
    ).length
  };
}

function assertProviderHealth(providerHealth) {
  assert.ok(Array.isArray(providerHealth), "providerHealth must be an array");
  const providerByKey = new Map(providerHealth.map((provider) => [provider.providerKey, provider]));

  for (const providerKey of REQUIRED_PROVIDER_KEYS) {
    assert.ok(providerByKey.has(providerKey), `${providerKey} provider health is missing`);
  }

  assert.equal(providerByKey.get("whatsapp_cloud").expectedStatus, "degraded");
  assert.equal(providerByKey.get("whatsapp_cloud").mode, "configured/degraded");
  assert.equal(providerByKey.get("razorpay").expectedStatus, "degraded");
  assert.match(providerByKey.get("razorpay").unavailableReason, /WEBHOOK_URL/);
  assert.equal(providerByKey.get("exotel").expectedStatus, "unavailable");
  assert.equal(providerByKey.get("google_business_profile").mode, "manual/source only");

  for (const provider of providerHealth) {
    assertIsoWithOffset(provider.checkedAt, `provider ${provider.key}.checkedAt`);
    assert.ok(
      ["available", "degraded", "not_configured", "unavailable"].includes(provider.expectedStatus),
      `provider ${provider.key}.expectedStatus is invalid`
    );
    assert.equal(typeof provider.unavailableReason, "string");
  }
}

function assertDeadLetters(deadLetters) {
  assert.ok(Array.isArray(deadLetters), "deadLetterEvents must be an array");
  assert.ok(deadLetters.some((event) => event.replayAvailable === true));
  assert.ok(deadLetters.some((event) => event.status === "blocked"));

  for (const event of deadLetters) {
    assertUuid(event.id, `deadLetter ${event.key}.id`);
    assert.ok(REQUIRED_PROVIDER_KEYS.includes(event.providerKey));
    assertIsoWithOffset(event.failedAt, `deadLetter ${event.key}.failedAt`);
    assert.ok(Number.isInteger(event.attempts) && event.attempts > 0);

    if (event.replayAvailable === false) {
      assert.equal(typeof event.replayBlockedReason, "string");
    }
  }
}

function assertMigrationBatches(batches) {
  assert.ok(Array.isArray(batches), "migrationBatches must be an array");

  for (const batch of batches) {
    assertUuid(batch.id, `migrationBatch ${batch.key}.id`);
    assert.equal(batch.status, "needs_review");
    assert.equal(batch.commit.state, "blocked");
    assert.match(batch.commit.blockedReason, /duplicate review/i);
    assertIsoWithOffset(batch.uploadedAt, `migrationBatch ${batch.key}.uploadedAt`);
    assert.ok(batch.rows.some((row) => row.status === "valid"));
    assert.ok(batch.rows.some((row) => row.status === "conflict"));
    assert.ok(batch.rows.some((row) => row.status === "rejected"));
    assert.ok(batch.conflicts.some((conflict) => conflict.status === "unresolved"));

    const rowKeys = new Set(batch.rows.map((row) => row.key));
    for (const row of batch.rows) {
      assertUuid(row.id, `migration row ${row.key}.id`);
      assert.equal(typeof row.externalReference, "string");
      assert.ok(["appointment", "invoice", "patient"].includes(row.target));
      assert.ok(["conflict", "rejected", "valid"].includes(row.status));
      if (row.status !== "valid") assert.equal(typeof row.issue, "string");
    }

    for (const conflict of batch.conflicts) {
      assertUuid(conflict.id, `migration conflict ${conflict.key}.id`);
      assert.ok(rowKeys.has(conflict.rowKey), `conflict ${conflict.key} references unknown row`);
      assert.equal(conflict.type, "possible_duplicate");
      assert.equal(conflict.status, "unresolved");
      assert.match(conflict.candidateSummary, /verified ClinicOS patient/);
    }
  }
}

function assertFlow(scenario, knownActorKeys) {
  const routeFamilies = new Set(scenario.flow.steps.map((step) => step.routeFamily));
  for (const family of REQUIRED_ROUTE_FAMILIES) {
    assert.ok(routeFamilies.has(family), `${family} route family missing from CP7 flow`);
  }

  for (const step of scenario.flow.steps) {
    assertKnownKey(knownActorKeys, step.actorKey, `step ${step.key}.actorKey`);
    assert.ok(["GET", "POST"].includes(step.method), `Unsupported method ${step.method}`);
    assert.ok(step.path.startsWith("/v1/"), `step ${step.key}.path must be a /v1 route`);
    assert.ok([200, 202, 403].includes(Number(step.expectedStatus)));
    assert.notEqual(step.expectedBodyIncludes?.includes("Provider success confirmed"), true);

    if (step.key === "replay-dead-letter-event") {
      assert.deepEqual(step.expectedBodyMustNotInclude, ["delivered", "read"]);
    }
  }
}

function assertBrowserSelectors(selectors) {
  for (const key of REQUIRED_BROWSER_SELECTORS) {
    assert.equal(typeof selectors[key], "string", `${key} selector missing`);
    assert.ok(selectors[key].startsWith("cp7-"), `${key} selector must be cp7-scoped`);
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
    /access[_-]?token/i,
    /key[_-]?secret/i,
    /webhook[_-]?secret/i,
    /aadhaar/i,
    /pan[_-]?card/i,
    /abha[_-]?(address|number)/i,
    /upi:\/\/pay/i
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(pattern.test(serialized), false, `fixture contains forbidden pattern ${pattern}`);
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

async function main() {
  const scenario = await loadCp7Scenario();
  validateCp7Scenario(scenario);
  console.log(JSON.stringify(summarizeCp7Scenario(scenario), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
