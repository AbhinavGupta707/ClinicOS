import assert from "node:assert/strict";
import test from "node:test";
import {
  assertTaskCompletionEvidence,
  assertTaskTransition,
  buildPaymentFollowUpKey,
  buildPostOpFollowUpKey,
  buildRecallGenerationKey,
  buildSopRunGenerationKey,
  taskDueState,
  type UUID
} from "../src/index.ts";

const patientId = "10000000-0000-4000-8000-000000000201" as UUID;
const recallRuleId = "10000000-0000-4000-8000-000000001001" as UUID;
const procedureId = "10000000-0000-4000-8000-000000001002" as UUID;

test("continuity task transitions require terminal-state discipline", () => {
  assert.doesNotThrow(() => assertTaskTransition("open", "in_progress"));
  assert.doesNotThrow(() => assertTaskTransition("in_progress", "done"));
  assert.throws(() => assertTaskTransition("done", "open"), /cannot transition/);
  assert.throws(() => assertTaskTransition("cancelled", "in_progress"), /cannot transition/);
});

test("completed tasks require actor, timestamp, and evidence", () => {
  assert.throws(
    () =>
      assertTaskCompletionEvidence({
        status: "done",
        evidence: {},
        completedAt: "2026-07-07T08:00:00.000Z",
        completedByUserId: patientId
      }),
    /completion evidence/
  );
  assert.doesNotThrow(() =>
    assertTaskCompletionEvidence({
      status: "done",
      evidence: { method: "phone", summary: "Spoke with patient." },
      completedAt: "2026-07-07T08:00:00.000Z",
      completedByUserId: patientId
    })
  );
});

test("continuity due-state and idempotency keys are deterministic", () => {
  assert.equal(taskDueState({ status: "open", dueAt: null }, "2026-07-07T08:00:00.000Z"), "unscheduled");
  assert.equal(
    taskDueState({ status: "open", dueAt: "2026-07-06T08:00:00.000Z" }, "2026-07-07T08:00:00.000Z"),
    "overdue"
  );
  assert.equal(
    buildRecallGenerationKey({
      recallRuleId,
      sourceProcedurePerformedId: procedureId,
      patientId,
      dueAt: "2027-01-07T08:00:00.000Z"
    }),
    `recall:${recallRuleId}:${procedureId}:2027-01-07`
  );
  assert.equal(buildPostOpFollowUpKey(procedureId), `post-op-follow-up:${procedureId}`);
  assert.equal(buildPaymentFollowUpKey(procedureId), `payment-follow-up:${procedureId}`);
  assert.equal(buildSopRunGenerationKey(recallRuleId, "2026-07-07T09:00:00.000Z"), `sop-run:${recallRuleId}:2026-07-07`);
});
