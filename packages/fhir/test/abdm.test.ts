import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ABDM_PUBLISHED_FHIR_IG,
  evaluateAbdmCapabilityBoundary,
  evaluateAbdmReadiness,
  missingAbdmCredentialKeys,
  redactAbdmReadinessForLogs
} from "../src/index.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURE_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp9",
  "fhir_abdm_readiness_fixture.json"
);

test("CP9 ABDM readiness is not configured and unavailable with empty credentials", async () => {
  const fixture = await loadFixture();
  const readiness = evaluateAbdmReadiness(fixture.abdmReadiness.input);

  assert.deepEqual(readiness, fixture.abdmReadiness.expected);
  assert.equal(readiness.configurationStatus, "not_configured");
  assert.equal(readiness.availabilityStatus, "unavailable");
  assert.equal(readiness.exchangeMode, "fixture_only");
  assert.equal(readiness.liveExchangeAllowed, false);
  assert.deepEqual(readiness.missingCredentialKeys, [
    "clientId",
    "clientSecret",
    "baseUrl",
    "hipId",
    "hiuId",
    "cmId"
  ]);
});

test("CP9 ABDM log summary redacts credential values", async () => {
  const fixture = await loadFixture();
  const readiness = evaluateAbdmReadiness({
    ...fixture.abdmReadiness.input,
    credentials: {
      baseUrl: "https://sandbox.abdm.example.test",
      clientId: "sandbox-client",
      clientSecret: "secret-value",
      cmId: "sandbox-cm",
      hipId: "sandbox-hip",
      hiuId: "sandbox-hiu"
    }
  });
  const summary = redactAbdmReadinessForLogs(readiness);
  const serialized = JSON.stringify(summary);

  assert.equal(serialized.includes("secret-value"), false);
  assert.equal(serialized.includes("sandbox-client"), false);
  assert.equal(serialized.includes("https://sandbox.abdm.example.test"), false);
  assert.equal(summary.configurationStatus, "sandbox_configured_unapproved");
  assert.deepEqual(summary.missingCredentialKeys, readiness.missingCredentialKeys);
});

test("CP16 ABDM credentials and flags cannot substitute for official activation", () => {
  const credentials = {
    baseUrl: "https://sandbox.abdm.example.test",
    clientId: "sandbox-client",
    clientSecret: "secret-value",
    cmId: "sandbox-cm",
    hipId: "sandbox-hip",
    hiuId: "sandbox-hiu"
  };
  const readiness = evaluateAbdmReadiness({
    careContexts: [
      {
        careContextReference: "clinicos-care-context-1",
        consentStatus: "granted",
        display: "Synthetic encounter context",
        id: "30000000-0000-4000-8000-000000008001",
        patientId: "30000000-0000-4000-8000-000000002001",
        resourceReference: "Encounter/30000000-0000-4000-8000-000000008001",
        type: "encounter"
      }
    ],
    credentials,
    evaluatedAt: "2026-07-07T10:35:00+05:30",
    featureFlags: {
      abdmEnabled: true,
      abhaLinkingEnabled: true,
      careContextLinkingEnabled: true,
      consentExchangeEnabled: true,
      sandboxActivationApproved: true,
      simulatorMode: true
    },
    patient: {
      abhaAddress: "synthetic@abdm",
      abhaConsentActive: true,
      dataExchangeConsentActive: true,
      patientId: "30000000-0000-4000-8000-000000002001"
    }
  });

  assert.equal(readiness.configurationStatus, "sandbox_configured_unapproved");
  assert.equal(readiness.availabilityStatus, "unavailable");
  assert.equal(readiness.exchangeMode, "fixture_only");
  assert.equal(readiness.liveExchangeAllowed, false);
  assert.deepEqual(missingAbdmCredentialKeys(credentials), []);
});

test("CP16 ABDM capability is unregistered without exact official 6.5.0 evidence", () => {
  const unavailable = evaluateAbdmCapabilityBoundary({
    activation: null,
    evaluatedAt: "2026-07-14T10:00:00.000Z"
  });
  assert.deepEqual(unavailable, {
    activationStatus: "unregistered",
    availability: "unavailable",
    evaluatedAt: "2026-07-14T10:00:00.000Z",
    igPackage: "ndhm.in#6.5.0",
    liveExchangeAllowed: false,
    reason: "official_activation_absent",
    registered: false
  });

  const sandbox = evaluateAbdmCapabilityBoundary({
    activation: {
      registrationId: "registration-123",
      environment: "sandbox",
      igPackage: ABDM_PUBLISHED_FHIR_IG.packageSpec,
      registeredAt: "2026-07-14T09:00:00.000Z",
      sandboxEvidenceId: "sandbox-evidence-123",
      status: "sandbox_verified",
      validatorEvidenceId: "validator-evidence-123",
      verifiedAt: "2026-07-14T09:30:00.000Z"
    },
    evaluatedAt: "2026-07-14T10:00:00.000Z"
  });
  assert.equal(sandbox.registered, true);
  assert.equal(sandbox.availability, "sandbox_only");
  assert.equal(sandbox.liveExchangeAllowed, false);
});

async function loadFixture() {
  return JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
}
