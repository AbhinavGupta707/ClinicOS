#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const CP8_SCENARIO_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp8",
  "ai_safety_qa_flow.json"
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_EMAIL_PATTERN = /^[^@\s]+@example\.test$/;
const REQUIRED_ROUTE_FAMILIES = [
  "ai-scribe-session",
  "ai-consent-block",
  "ai-transcript-segment",
  "ai-source-anchor",
  "ai-draft-generation",
  "ai-review-decision",
  "ai-review-boundary",
  "ai-session-read",
  "ai-retention-delete"
];
const REQUIRED_BROWSER_SELECTORS = [
  "cp8-ai-review-workspace",
  "cp8-fixture-alert",
  "cp8-review-readiness",
  "cp8-source-anchors",
  "cp8-warning-list",
  "cp8-reject-draft",
  "cp8-selected-status",
  "cp8-dental-chart-draft",
  "cp8-action-proposal-draft"
];

export async function loadCp8Scenario(scenarioPath = CP8_SCENARIO_PATH) {
  const raw = await readFile(scenarioPath, "utf8");
  return JSON.parse(raw);
}

export function validateCp8Scenario(scenario) {
  assert.equal(scenario.schemaVersion, "clinic-os.cp8.ai-safety-fixture.v1");
  assertLocalSyntheticOnly(scenario);
  assert.equal(scenario.clock.businessDate, "2026-07-07");
  assert.equal(scenario.clock.timezone, "Asia/Kolkata");
  assertIsoWithOffset(scenario.clock.fixedNow, "clock.fixedNow");

  const knownTenantIds = new Set();
  const knownClinicIds = new Set();
  const knownActorKeys = new Set();
  const knownPatientIds = new Set();
  const knownEncounterIds = new Set();

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

  for (const patient of scenario.patients) {
    assertUuid(patient.id, `patient ${patient.key}.id`);
    assertKnownReference(knownTenantIds, patient.tenantId, `patient ${patient.key}.tenantId`);
    assert.match(patient.email, TEST_EMAIL_PATTERN, `patient ${patient.key}.email`);
    knownPatientIds.add(patient.id);
  }

  for (const encounter of scenario.encounters) {
    assertUuid(encounter.id, `encounter ${encounter.key}.id`);
    assertKnownReference(
      knownPatientIds,
      encounter.patientId,
      `encounter ${encounter.key}.patientId`
    );
    knownEncounterIds.add(encounter.id);
  }

  assertConsentStates(scenario, knownPatientIds, knownActorKeys);
  assertRetentionPolicies(scenario);
  const transcriptSegments = assertTranscripts(scenario, knownEncounterIds);
  assertCaptureAttempts(scenario, knownEncounterIds, knownActorKeys);
  assertGoldenOutputs(scenario, knownEncounterIds, transcriptSegments);
  assertUnsafeOutputs(scenario, knownEncounterIds, transcriptSegments);
  assertReviewDecisions(scenario);
  assertRoleBoundaries(scenario);
  assertFlow(scenario, knownActorKeys);
  assertBrowserChecklist(scenario.browserSmokeChecklist);

  return true;
}

export function summarizeCp8Scenario(scenario) {
  return {
    actors: scenario.actors.length,
    browserSelectors: scenario.browserSmokeChecklist.requiredSelectors.length,
    captureAttempts: scenario.captureAttempts.length,
    consentStates: scenario.consentStates.length,
    flowSteps: scenario.flow.steps.length,
    goldenOutputs: scenario.goldenOutputs.length,
    reviewDecisions: scenario.reviewDecisions.length,
    roleTenantExpectations: scenario.roleTenantExpectations.length,
    transcripts: scenario.transcripts.length,
    unsafeOutputs: scenario.unsafeOutputs.length
  };
}

function assertConsentStates(scenario, knownPatientIds, knownActorKeys) {
  const consentByKey = new Map(scenario.consentStates.map((state) => [state.key, state]));
  assert.equal(consentByKey.get("activeAiAudioConsent")?.active, true);
  assert.equal(consentByKey.get("activeAiAudioConsent")?.audioTranscription, true);
  assert.equal(consentByKey.get("activeAiAudioConsent")?.aiDocumentation, true);
  assert.equal(consentByKey.get("noAiAudioConsent")?.active, false);
  assert.equal(consentByKey.get("revokedAiAudioConsent")?.active, false);
  assert.ok(
    consentByKey.get("revokedAiAudioConsent")?.revokedAt,
    "revoked consent needs revokedAt"
  );

  for (const state of scenario.consentStates) {
    assertKnownReference(knownPatientIds, state.patientId, `consent ${state.key}.patientId`);
    if (state.consentRecordId)
      assertUuid(state.consentRecordId, `consent ${state.key}.consentRecordId`);
    if (state.capturedAt) assertIsoWithOffset(state.capturedAt, `consent ${state.key}.capturedAt`);
    if (state.revokedAt) assertIsoWithOffset(state.revokedAt, `consent ${state.key}.revokedAt`);
    if (state.capturedByActorKey) {
      assertKnownKey(
        knownActorKeys,
        state.capturedByActorKey,
        `consent ${state.key}.capturedByActorKey`
      );
    }
    if (!state.active) {
      assert.equal(
        state.audioTranscription || state.aiDocumentation,
        false,
        `inactive consent ${state.key} must not allow AI/audio`
      );
    }
  }
}

function assertRetentionPolicies(scenario) {
  const retentionByKey = new Map(scenario.retentionPolicies.map((policy) => [policy.key, policy]));
  assert.equal(retentionByKey.get("deleteRawAudioAfter7Days")?.deleteRawAudioAfterDays, 7);
  assert.equal(retentionByKey.get("noRawAudioRetention")?.rawAudioRetained, false);

  for (const policy of scenario.retentionPolicies) {
    assert.equal(typeof policy.key, "string");
    assert.ok(Number.isInteger(policy.deleteRawAudioAfterDays));
    assert.ok(policy.deleteRawAudioAfterDays >= 0);
    assert.equal(policy.transcriptRetainedForAudit, true);
  }
}

function assertTranscripts(scenario, knownEncounterIds) {
  const consentKeys = new Set(scenario.consentStates.map((state) => state.key));
  const segments = new Map();

  for (const transcript of scenario.transcripts) {
    assertUuid(transcript.id, `transcript ${transcript.key}.id`);
    assertKnownReference(
      knownEncounterIds,
      transcript.encounterId,
      `transcript ${transcript.key}.encounterId`
    );
    assertKnownKey(
      consentKeys,
      transcript.consentStateKey,
      `transcript ${transcript.key}.consentStateKey`
    );
    assert.equal(transcript.providerMode, "simulator");
    assert.match(transcript.localOnlyAudioUri, /^local-fixture:\/\//);
    assert.ok(Array.isArray(transcript.segments) && transcript.segments.length > 0);

    for (const segment of transcript.segments) {
      assert.match(segment.id, /^seg-cp8-\d{3}$/);
      assert.ok(["doctor", "patient", "assistant"].includes(segment.speaker));
      assert.equal(typeof segment.text, "string");
      assert.equal(segment.text.includes("Synthetic"), segment.speaker === "patient");
      assert.ok(Number.isInteger(segment.startMs) && segment.startMs >= 0);
      assert.ok(Number.isInteger(segment.endMs) && segment.endMs > segment.startMs);
      segments.set(segment.id, { ...segment, transcriptKey: transcript.key });
    }
  }

  return segments;
}

function assertCaptureAttempts(scenario, knownEncounterIds, knownActorKeys) {
  const consentByKey = new Map(scenario.consentStates.map((state) => [state.key, state]));
  const attemptByKey = new Map(scenario.captureAttempts.map((attempt) => [attempt.key, attempt]));

  assert.equal(attemptByKey.get("start-audio-with-active-consent")?.expectedStatus, 201);
  assert.equal(attemptByKey.get("block-audio-with-no-consent")?.expectedStatus, 409);
  assert.equal(attemptByKey.get("block-audio-with-no-consent")?.processingBlocked, true);
  assert.equal(attemptByKey.get("block-audio-after-revocation")?.expectedStatus, 409);
  assert.equal(attemptByKey.get("block-audio-after-revocation")?.processingBlocked, true);

  for (const attempt of scenario.captureAttempts) {
    assertKnownKey(knownActorKeys, attempt.actorKey, `capture ${attempt.key}.actorKey`);
    assertKnownReference(
      knownEncounterIds,
      attempt.encounterId,
      `capture ${attempt.key}.encounterId`
    );
    const consent = consentByKey.get(attempt.consentStateKey);
    assert.ok(consent, `capture ${attempt.key} references unknown consent`);
    if (consent.active) {
      assert.equal(
        attempt.processingBlocked,
        false,
        `active consent attempt ${attempt.key} should not be blocked`
      );
      assert.equal(attempt.expectedStatus, 201);
    } else {
      assert.equal(
        attempt.processingBlocked,
        true,
        `inactive consent attempt ${attempt.key} must be blocked`
      );
      assert.equal(attempt.expectedStatus, 409);
      assert.match(attempt.expectedReason, /consent/);
    }
  }
}

function assertGoldenOutputs(scenario, knownEncounterIds, transcriptSegments) {
  const outputKeys = new Set();
  for (const output of scenario.goldenOutputs) {
    outputKeys.add(output.key);
    assertBaseOutput(output, knownEncounterIds);
    assert.equal(output.validation.status, "pass", `${output.key} must pass validation`);
    assert.deepEqual(output.validation.reasons, []);
    assert.deepEqual(output.unsupportedClaims, []);
    assert.equal(output.application.applied, false, `${output.key} must not be applied by AI`);
    assert.ok(output.warnings.length > 0, `${output.key} must include warnings`);
    assertSourceAnchors(output, transcriptSegments);
    assertClinicalClaimsAnchored(output, transcriptSegments);
    if (output.outputType === "dental_chart_patch")
      assertDentalPatchToothAnchors(output, transcriptSegments);
  }
  return outputKeys;
}

function assertUnsafeOutputs(scenario, knownEncounterIds, transcriptSegments) {
  const unsafeByKey = new Map(scenario.unsafeOutputs.map((output) => [output.key, output]));
  assert.ok(unsafeByKey.has("unsupportedDiagnosisOutput"), "unsupported diagnosis fixture missing");
  assert.ok(unsafeByKey.has("wrongToothChartPatchOutput"), "wrong-tooth fixture missing");

  for (const output of scenario.unsafeOutputs) {
    assertBaseOutput(output, knownEncounterIds);
    assert.equal(
      output.expectedValidation.status,
      "reject",
      `${output.key} must be expected to reject`
    );
    assert.equal(output.application.applied, false, `${output.key} must not be applied`);
    assert.equal(output.application.state, "rejected_not_applied");
    assert.ok(output.warnings.length > 0, `${output.key} must include rejection warning`);
    if (output.expectedValidation.reasons.includes("unsupported_claim")) {
      assert.ok(output.unsupportedClaims.length > 0, `${output.key} must name unsupported claims`);
      assert.ok(
        output.clinicalClaims.some((claim) => claim.sourceSegmentIds.length === 0),
        `${output.key} must include an unanchored claim`
      );
    }
    if (output.expectedValidation.reasons.includes("wrong_tooth")) {
      assertDentalPatchToothMismatch(output, transcriptSegments);
    }
  }
}

function assertBaseOutput(output, knownEncounterIds) {
  assertUuid(output.id, `AI output ${output.key}.id`);
  assertKnownReference(
    knownEncounterIds,
    output.encounterId,
    `AI output ${output.key}.encounterId`
  );
  assert.ok(
    ["clinical_note_draft", "dental_chart_patch", "action_proposal"].includes(output.outputType),
    `${output.key} has unsupported outputType`
  );
  assert.match(output.schemaVersion ?? `${toPascal(output.outputType)}.v1`, /\.v1$/);
  assert.equal(typeof output.retentionPolicyKey, "string");
  assert.ok(Array.isArray(output.clinicalClaims), `${output.key} clinicalClaims missing`);
  assert.ok(Array.isArray(output.warnings), `${output.key} warnings missing`);
}

function assertSourceAnchors(output, transcriptSegments) {
  assert.ok(output.sourceAnchors.length > 0, `${output.key} must include source anchors`);
  for (const anchor of output.sourceAnchors) {
    assert.equal(typeof anchor.field, "string");
    assert.equal(typeof anchor.transcriptKey, "string");
    assert.ok(anchor.segmentIds.length > 0, `${output.key}.${anchor.field} must anchor segments`);
    for (const segmentId of anchor.segmentIds) {
      const segment = transcriptSegments.get(segmentId);
      assert.ok(segment, `${output.key}.${anchor.field} references unknown segment ${segmentId}`);
      assert.equal(segment.transcriptKey, anchor.transcriptKey);
    }
  }
}

function assertClinicalClaimsAnchored(output, transcriptSegments) {
  for (const claim of output.clinicalClaims) {
    assert.equal(typeof claim.claim, "string");
    assert.ok(claim.sourceSegmentIds.length > 0, `${output.key} claim lacks source segment`);
    for (const segmentId of claim.sourceSegmentIds) {
      assert.ok(
        transcriptSegments.has(segmentId),
        `${output.key} claim references unknown segment`
      );
    }
  }
}

function assertDentalPatchToothAnchors(output, transcriptSegments) {
  for (const finding of output.structured.findings) {
    assert.match(finding.toothNumber, /^[1-8][1-8]$/, `${output.key} invalid FDI tooth`);
    for (const segmentId of finding.sourceSegmentIds) {
      const segment = transcriptSegments.get(segmentId);
      assert.ok(
        segment.text.includes(`tooth ${finding.toothNumber}`),
        `${output.key} tooth lacks matching source`
      );
    }
  }
}

function assertDentalPatchToothMismatch(output, transcriptSegments) {
  for (const finding of output.structured.findings) {
    assert.match(finding.toothNumber, /^[1-8][1-8]$/, `${output.key} invalid FDI tooth`);
    assert.ok(
      finding.sourceSegmentIds.some((segmentId) => {
        const segment = transcriptSegments.get(segmentId);
        return segment && !segment.text.includes(`tooth ${finding.toothNumber}`);
      }),
      `${output.key} wrong-tooth fixture must mismatch source segment`
    );
  }
}

function assertReviewDecisions(scenario) {
  const outputKeys = new Set([
    ...scenario.goldenOutputs.map((output) => output.key),
    ...scenario.unsafeOutputs.map((output) => output.key)
  ]);
  const decisionByKey = new Map(
    scenario.reviewDecisions.map((decision) => [decision.key, decision])
  );

  assert.equal(decisionByKey.get("doctor-rejects-unsupported-output")?.retainedForEvaluation, true);
  assert.equal(decisionByKey.get("doctor-rejects-unsupported-output")?.applied, false);
  assert.equal(
    decisionByKey.get("assistant-approves-chart-patch-review-only")?.requiresSeparateClinicalSign,
    true
  );

  for (const decision of scenario.reviewDecisions) {
    assertKnownKey(outputKeys, decision.outputKey, `review ${decision.key}.outputKey`);
    assert.equal(
      decision.retainedForEvaluation,
      true,
      `review ${decision.key} must retain evaluation evidence`
    );
    assert.equal(
      decision.applied,
      false,
      `review ${decision.key} must not claim AI applied product state`
    );
  }
}

function assertRoleBoundaries(scenario) {
  const expectations = new Map(
    scenario.roleTenantExpectations.map((expectation) => [expectation.key, expectation])
  );
  assert.equal(expectations.get("doctor-can-approve-note-draft")?.expected, "allow");
  assert.equal(expectations.get("assistant-cannot-sign-or-apply-clinical-note")?.expected, "deny");
  assert.equal(
    expectations.get("assistant-cannot-sign-or-apply-clinical-note")?.expectedReason,
    "doctor_required"
  );
  assert.equal(
    expectations.get("assistant-can-review-chart-patch-but-not-final-sign")?.expected,
    "allow_review_only"
  );
  assert.equal(
    expectations.get("receptionist-cannot-review-ai-clinical-output")?.expectedReason,
    "missing_permission"
  );
}

function assertFlow(scenario, knownActorKeys) {
  const routeFamilies = new Set(scenario.flow.steps.map((step) => step.routeFamily));
  for (const family of REQUIRED_ROUTE_FAMILIES) {
    assert.ok(routeFamilies.has(family), `${family} route family missing from CP8 flow`);
  }

  for (const step of scenario.flow.steps) {
    assertKnownKey(knownActorKeys, step.actorKey, `flow ${step.key}.actorKey`);
    assert.ok(["GET", "POST"].includes(step.method), `Unsupported method ${step.method}`);
    assert.ok(step.path.startsWith("/v1/"), `flow ${step.key}.path must be a /v1 route`);
    assert.ok([200, 201, 202, 400, 403, 409].includes(Number(step.expectedStatus)));
    assert.equal(
      step.path.includes("/apply"),
      false,
      `flow ${step.key} must not use autonomous apply route`
    );
    assert.equal(step.expectedBodyIncludes?.includes("appliedToRecord"), false);
    assert.ok(
      Array.isArray(step.expectedBodyMustNotInclude),
      `flow ${step.key} must define exclusions`
    );
  }
}

function assertBrowserChecklist(checklist) {
  assert.deepEqual(checklist.mobileViewport, {
    height: 844,
    noHorizontalOverflowRequired: true,
    width: 390
  });
  assert.equal(checklist.status, "review_ux_merged_mobile_capture_verified_in_expo");
  for (const selector of REQUIRED_BROWSER_SELECTORS) {
    assert.ok(
      checklist.requiredSelectors.includes(selector),
      `${selector} browser selector missing`
    );
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
    /api[_-]?key/i,
    /key[_-]?secret/i,
    /webhook[_-]?secret/i,
    /aadhaar/i,
    /pan[_-]?card/i,
    /abha[_-]?(address|number)/i,
    /upi:\/\/pay/i,
    /rawAudioBytes/i
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
  assert.match(
    value,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    `${label} must include offset`
  );
}

function toPascal(value) {
  return value
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join("");
}

async function main() {
  const scenario = await loadCp8Scenario();
  validateCp8Scenario(scenario);
  console.log(JSON.stringify(summarizeCp8Scenario(scenario), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
  });
}
