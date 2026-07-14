import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReviewOnlyAiArtifact,
  evaluateCp16AiPolicy
} from "../src/cp16/ai/safety.ts";

const scope = {
  tenantId: "tenant-a",
  clinicId: "clinic-a",
  patientId: "patient-a",
  encounterId: "encounter-a",
  purpose: "clinical_draft" as const
};

test("CP16 AI policy requires current purpose-specific consent immediately before processing", () => {
  const allowed = evaluateCp16AiPolicy({
    expectedScope: scope,
    now: "2026-07-14T09:00:30.000Z",
    snapshot: {
      ...scope,
      consentId: "consent-a",
      consentVersion: "v3",
      consentStatus: "granted",
      policyAllowed: true,
      evaluatedAt: "2026-07-14T09:00:00.000Z",
      expiresAt: "2026-07-14T09:01:00.000Z"
    }
  });
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.reviewOnly, true);
  assert.ok(allowed.prohibitedActions.includes("prescribe"));

  const revoked = evaluateCp16AiPolicy({
    expectedScope: scope,
    now: "2026-07-14T09:00:30.000Z",
    snapshot: {
      ...scope,
      consentId: "consent-a",
      consentVersion: "v3",
      consentStatus: "revoked",
      policyAllowed: true,
      evaluatedAt: "2026-07-14T09:00:29.000Z",
      expiresAt: "2026-07-14T09:01:00.000Z"
    }
  });
  assert.deepEqual([revoked.allowed, revoked.code], [false, "consent_revoked"]);
});

test("CP16 AI policy rejects stale and cross-tenant decisions", () => {
  const snapshot = {
    ...scope,
    consentId: "consent-a",
    consentVersion: "v3",
    consentStatus: "granted" as const,
    policyAllowed: true,
    evaluatedAt: "2026-07-14T08:59:00.000Z",
    expiresAt: "2026-07-14T09:02:00.000Z"
  };
  assert.equal(
    evaluateCp16AiPolicy({ expectedScope: scope, snapshot, now: "2026-07-14T09:00:30.000Z" }).code,
    "stale_policy_snapshot"
  );
  assert.equal(
    evaluateCp16AiPolicy({
      expectedScope: { ...scope, tenantId: "tenant-b" },
      snapshot,
      now: "2026-07-14T08:59:30.000Z"
    }).code,
    "scope_mismatch"
  );
});

test("CP16 AI artifacts can never claim autonomous application", () => {
  assert.doesNotThrow(() =>
    assertReviewOnlyAiArtifact({ reviewOnly: true, appliedRecordId: null })
  );
  assert.throws(
    () =>
      assertReviewOnlyAiArtifact({
        reviewOnly: true,
        appliedRecordId: null,
        requestedAction: "sign_clinical_record"
      }),
    /prohibited/
  );
  assert.throws(
    () => assertReviewOnlyAiArtifact({ reviewOnly: false, appliedRecordId: "note-a" }),
    /review-only/
  );
});
