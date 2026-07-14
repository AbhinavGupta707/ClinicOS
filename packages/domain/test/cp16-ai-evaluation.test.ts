import assert from "node:assert/strict";
import test from "node:test";
import {
  CP16_AI_EVALUATION_VERSION,
  evaluateCp16AiActivation,
  type Cp16AiEvaluationObservation
} from "../src/cp16/ai/evaluation.ts";

function passingCase(caseId: string): Cp16AiEvaluationObservation {
  return {
    caseId,
    task: "speech_quality",
    schemaConformant: true,
    unsafeOutputBlocked: true,
    unsafeOutputExpected: true,
    sourceAnchorTruePositives: 10,
    sourceAnchorFalsePositives: 0,
    criticalOmission: false,
    expectedMedicalTerms: 8,
    matchedMedicalTerms: 8,
    referenceWords: 100,
    wordErrors: 4
  };
}

test("versioned CP16 evaluation harness enforces activation thresholds", () => {
  const result = evaluateCp16AiActivation({
    task: "speech_quality",
    observations: Array.from({ length: 100 }, (_, index) => passingCase(`case-${index}`))
  });
  assert.equal(result.version, CP16_AI_EVALUATION_VERSION);
  assert.equal(result.passed, true);
  assert.equal(result.metrics.wordErrorRate, 0.04);
});

test("versioned CP16 evaluation harness fails closed on unsafe output and medical-term loss", () => {
  const cases = Array.from({ length: 100 }, (_, index) => passingCase(`case-${index}`));
  for (const index of [0, 1, 2]) {
    cases[index] = {
      ...cases[index]!,
      unsafeOutputBlocked: index !== 0,
      matchedMedicalTerms: 0
    };
  }
  const result = evaluateCp16AiActivation({ task: "speech_quality", observations: cases });
  assert.equal(result.passed, false);
  assert.ok(result.failedThresholds.includes("unsafeOutputBlockRate"));
  assert.ok(result.failedThresholds.includes("minimumMedicalTermRecall"));
});

test("versioned CP16 evaluation harness rejects denominator-free evidence and duplicate cases", () => {
  const unsupported = Array.from({ length: 100 }, (_, index) => ({
    ...passingCase(`unsupported-${index}`),
    unsafeOutputExpected: false,
    sourceAnchorTruePositives: 0,
    expectedMedicalTerms: 0,
    matchedMedicalTerms: 0,
    referenceWords: 0,
    wordErrors: 0
  }));
  const result = evaluateCp16AiActivation({ task: "speech_quality", observations: unsupported });
  assert.equal(result.passed, false);
  assert.ok(result.failedThresholds.includes("minimumUnsafeCases"));
  assert.ok(result.failedThresholds.includes("minimumReferenceWords"));
  assert.ok(result.failedThresholds.includes("sourceAnchorPrecision"));
  assert.ok(result.failedThresholds.includes("minimumMedicalTermRecall"));

  assert.throws(() => evaluateCp16AiActivation({
    task: "speech_quality",
    observations: [passingCase("duplicate"), passingCase("duplicate")]
  }), /duplicated/);
});
