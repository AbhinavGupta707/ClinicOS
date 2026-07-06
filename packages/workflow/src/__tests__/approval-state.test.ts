import assert from "node:assert/strict";
import test from "node:test";
import {
  applyApprovalCancellation,
  applyApprovalDecision,
  createInitialApprovalState,
  markActionExecuted,
  markApprovalTimedOut,
  markWaitingForApproval
} from "../approval-state.js";
import type { ApprovalWorkflowInput } from "../contracts.js";

const input: ApprovalWorkflowInput = {
  workflowRunId: "workflow-run-001",
  tenantId: "tenant-001",
  clinicId: "clinic-001",
  schemaVersion: "1.0",
  subject: {
    aggregateType: "action_proposal",
    aggregateId: "proposal-001"
  },
  requestedBy: {
    type: "user",
    id: "assistant-001"
  },
  requestedAt: "2026-07-06T09:00:00.000Z",
  correlationId: "corr-001",
  idempotencyKey: "tenant-001:clinic-001:proposal-001",
  approval: {
    requiredPermission: "action_proposal.approve",
    timeoutMs: 60000
  },
  action: {
    actionType: "action_proposal.execute",
    target: {
      aggregateType: "appointment",
      aggregateId: "appointment-001"
    }
  }
};

test("approval state records approval task, expiry, and approved execution", () => {
  const started = createInitialApprovalState(input);
  const waiting = markWaitingForApproval(
    started,
    "approval-task-001",
    "2026-07-06T09:00:10.000Z",
    input.approval.timeoutMs
  );

  assert.equal(waiting.status, "waiting_approval");
  assert.equal(waiting.expiresAt, "2026-07-06T09:01:10.000Z");

  const approved = applyApprovalDecision(waiting, {
    decision: "approved",
    decidedBy: { type: "user", id: "doctor-001" },
    decidedAt: "2026-07-06T09:00:20.000Z",
    correlationId: "corr-approval-001"
  });

  const executed = markActionExecuted(approved, "execution-001");
  assert.equal(executed.status, "action_executed");
  assert.equal(executed.actionExecutionId, "execution-001");
});

test("approval timeout is explicit and does not execute the action", () => {
  const waiting = markWaitingForApproval(
    createInitialApprovalState(input),
    "approval-task-001",
    "2026-07-06T09:00:10.000Z",
    input.approval.timeoutMs
  );

  const timedOut = markApprovalTimedOut(waiting);
  assert.equal(timedOut.status, "timed_out");
  assert.equal(timedOut.terminalReason, "approval_timeout");
});

test("approval cancellation wins as a terminal business state", () => {
  const waiting = markWaitingForApproval(
    createInitialApprovalState(input),
    "approval-task-001",
    "2026-07-06T09:00:10.000Z",
    input.approval.timeoutMs
  );

  const cancelled = applyApprovalCancellation(waiting, {
    cancelledBy: { type: "user", id: "owner-001" },
    cancelledAt: "2026-07-06T09:00:30.000Z",
    reason: "clinic closed early"
  });

  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.terminalReason, "clinic closed early");
});
