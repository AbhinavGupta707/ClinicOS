import assert from "node:assert/strict";
import test from "node:test";
import { buildCp8SmokePlan } from "../../scripts/cp8-contract-smoke.mjs";
import {
  loadCp8Scenario,
  summarizeCp8Scenario,
  validateCp8Scenario
} from "../../scripts/validate-cp8-fixtures.mjs";

test("CP8 AI safety scenario is deterministic and local-test only", async () => {
  const scenario = await loadCp8Scenario();

  assert.equal(validateCp8Scenario(scenario), true);
  assert.deepEqual(summarizeCp8Scenario(scenario), {
    actors: 3,
    browserSelectors: 9,
    captureAttempts: 3,
    consentStates: 3,
    flowSteps: 10,
    goldenOutputs: 3,
    reviewDecisions: 3,
    roleTenantExpectations: 4,
    transcripts: 2,
    unsafeOutputs: 2
  });
});

test("CP8 golden outputs require anchors, warnings, and no autonomous application", async () => {
  const scenario = await loadCp8Scenario();

  for (const output of scenario.goldenOutputs) {
    assert.equal(output.validation.status, "pass");
    assert.equal(output.application.applied, false);
    assert.ok(output.sourceAnchors.length > 0, `${output.key} lacks source anchors`);
    assert.ok(output.warnings.length > 0, `${output.key} lacks warnings`);
    assert.deepEqual(output.unsupportedClaims, []);
  }

  const note = scenario.goldenOutputs.find((output) => output.key === "clinicalNoteDraftGolden");
  assert.ok(note.sourceAnchors.some((anchor) => anchor.segmentIds.includes("seg-cp8-002")));
  assert.match(note.structured.plan, /review/i);

  const chartPatch = scenario.goldenOutputs.find((output) => output.key === "dentalChartPatchGolden");
  assert.equal(chartPatch.structured.findings[0].toothNumber, "16");
  assert.deepEqual(chartPatch.structured.findings[0].sourceSegmentIds, ["seg-cp8-002"]);
});

test("CP8 unsafe outputs cover unsupported claims and wrong-tooth rejection", async () => {
  const scenario = await loadCp8Scenario();

  const unsupported = scenario.unsafeOutputs.find(
    (output) => output.key === "unsupportedDiagnosisOutput"
  );
  assert.deepEqual(unsupported.expectedValidation.reasons, ["unsupported_claim"]);
  assert.ok(unsupported.unsupportedClaims.includes("generalized aggressive periodontitis"));
  assert.equal(unsupported.application.applied, false);

  const wrongTooth = scenario.unsafeOutputs.find((output) => output.key === "wrongToothChartPatchOutput");
  assert.deepEqual(wrongTooth.expectedValidation.reasons, ["wrong_tooth"]);
  assert.equal(wrongTooth.structured.findings[0].toothNumber, "26");
  assert.deepEqual(wrongTooth.structured.findings[0].sourceSegmentIds, ["seg-cp8-002"]);
  assert.equal(wrongTooth.application.state, "rejected_not_applied");
});

test("CP8 no-consent and revoked-consent attempts block AI/audio processing", async () => {
  const scenario = await loadCp8Scenario();
  const attempts = new Map(scenario.captureAttempts.map((attempt) => [attempt.key, attempt]));

  assert.equal(attempts.get("start-audio-with-active-consent").expectedStatus, 201);
  assert.equal(attempts.get("start-audio-with-active-consent").processingBlocked, false);

  for (const key of ["block-audio-with-no-consent", "block-audio-after-revocation"]) {
    const attempt = attempts.get(key);
    assert.equal(attempt.expectedStatus, 409);
    assert.equal(attempt.processingBlocked, true);
    assert.match(attempt.expectedReason, /consent/);
  }
});

test("CP8 rejected AI output is retained for evaluation but not applied", async () => {
  const scenario = await loadCp8Scenario();
  const rejectedDecision = scenario.reviewDecisions.find(
    (decision) => decision.key === "doctor-rejects-unsupported-output"
  );
  const rejectedOutput = scenario.unsafeOutputs.find(
    (output) => output.key === rejectedDecision.outputKey
  );

  assert.equal(rejectedDecision.decision, "reject");
  assert.equal(rejectedDecision.retainedForEvaluation, true);
  assert.equal(rejectedDecision.applied, false);
  assert.equal(rejectedOutput.application.state, "rejected_not_applied");
});

test("CP8 doctor and assistant approval boundaries are explicit", async () => {
  const scenario = await loadCp8Scenario();
  const expectations = new Map(
    scenario.roleTenantExpectations.map((expectation) => [expectation.key, expectation])
  );

  assert.equal(expectations.get("doctor-can-approve-note-draft").expected, "allow");
  assert.equal(expectations.get("assistant-cannot-sign-or-apply-clinical-note").expected, "deny");
  assert.equal(
    expectations.get("assistant-cannot-sign-or-apply-clinical-note").expectedReason,
    "doctor_required"
  );
  assert.equal(
    expectations.get("assistant-can-review-chart-patch-but-not-final-sign").expected,
    "allow_review_only"
  );
  assert.equal(
    expectations.get("receptionist-cannot-review-ai-clinical-output").expectedReason,
    "missing_permission"
  );
});

test("CP8 smoke plan separates dry-run contracts from fixture-only evidence", async () => {
  const scenario = await loadCp8Scenario();
  const plan = buildCp8SmokePlan(scenario);

  assert.equal(plan.flowRequests.length, 10);
  assert.equal(plan.safetyRequests.length, 4);
  assert.equal(plan.fixtureOnlyEvidence.length, 3);
  assert.deepEqual(
    plan.flowRequests.map((request) => `${request.method} ${request.path}`),
    [
      "POST /v1/encounters/89999999-9999-4999-8999-999999999999/ai-scribe/sessions",
      "POST /v1/encounters/8aaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/ai-scribe/sessions",
      "POST /v1/encounters/8bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/ai-scribe/sessions",
      "POST /v1/ai-scribe/sessions/{aiScribeSessionId}/transcript-segments",
      "POST /v1/ai-scribe/sessions/{aiScribeSessionId}/generate-drafts",
      "POST /v1/ai-scribe/sessions/{aiScribeSessionId}/source-anchors",
      "POST /v1/ai-scribe/sessions/{aiScribeSessionId}/review-decisions",
      "POST /v1/ai-scribe/sessions/{aiScribeSessionId}/review-decisions",
      "GET /v1/ai-scribe/sessions/{aiScribeSessionId}",
      "POST /v1/ai-scribe/sessions/{aiScribeSessionId}/retention-delete"
    ]
  );

  const serializedPlan = JSON.stringify(plan);
  for (const forbidden of [
    "/v1/ai/apply",
    "/apply-chart-patch",
    "/apply-clinical-note",
    "/signed-record-from-ai",
    "Provider success confirmed"
  ]) {
    assert.equal(serializedPlan.includes(forbidden), false, `${forbidden} must not enter CP8 smoke plan`);
  }

  assert.ok(plan.flowRequests.every((request) => request.liveImplemented === false));
  assert.ok(
    plan.fixtureOnlyEvidence.some((entry) => entry.key === "browser-mobile-checklist"),
    "browser/mobile fixture-only checklist evidence missing"
  );
});
