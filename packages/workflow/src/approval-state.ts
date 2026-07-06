import type {
  ApprovalCancellation,
  ApprovalDecision,
  ApprovalWorkflowInput,
  ApprovalWorkflowResult,
  ApprovalWorkflowState
} from "./contracts.js";

export function createInitialApprovalState(input: ApprovalWorkflowInput): ApprovalWorkflowState {
  return {
    workflowRunId: input.workflowRunId,
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    subject: input.subject,
    action: input.action,
    requiredPermission: input.approval.requiredPermission,
    status: "started",
    requestedAt: input.requestedAt
  };
}

export function markWaitingForApproval(
  state: ApprovalWorkflowState,
  approvalTaskId: string,
  waitingSince: string,
  timeoutMs: number
): ApprovalWorkflowState {
  return {
    ...state,
    status: "waiting_approval",
    approvalTaskId,
    waitingSince,
    expiresAt: new Date(new Date(waitingSince).getTime() + timeoutMs).toISOString()
  };
}

export function applyApprovalDecision(
  state: ApprovalWorkflowState,
  decision: ApprovalDecision
): ApprovalWorkflowState {
  if (state.status !== "waiting_approval") return state;

  return {
    ...state,
    status: decision.decision === "approved" ? "approved" : "rejected",
    decision,
    terminalReason: decision.reason
  };
}

export function applyApprovalCancellation(
  state: ApprovalWorkflowState,
  cancellation: ApprovalCancellation
): ApprovalWorkflowState {
  if (isTerminalApprovalState(state)) return state;

  return {
    ...state,
    status: "cancelled",
    cancellation,
    terminalReason: cancellation.reason
  };
}

export function markApprovalTimedOut(state: ApprovalWorkflowState): ApprovalWorkflowState {
  if (state.status !== "waiting_approval") return state;

  return {
    ...state,
    status: "timed_out",
    terminalReason: "approval_timeout"
  };
}

export function markActionExecuted(
  state: ApprovalWorkflowState,
  actionExecutionId: string
): ApprovalWorkflowState {
  if (state.status !== "approved") return state;

  return {
    ...state,
    status: "action_executed",
    actionExecutionId
  };
}

export function markActionFailed(
  state: ApprovalWorkflowState,
  terminalReason: string
): ApprovalWorkflowState {
  if (state.status !== "approved") return state;

  return {
    ...state,
    status: "action_failed",
    terminalReason
  };
}

export function isTerminalApprovalState(state: ApprovalWorkflowState): boolean {
  return (
    state.status === "action_executed" ||
    state.status === "action_failed" ||
    state.status === "cancelled" ||
    state.status === "rejected" ||
    state.status === "timed_out"
  );
}

export function toApprovalWorkflowResult(state: ApprovalWorkflowState): ApprovalWorkflowResult {
  return {
    workflowRunId: state.workflowRunId,
    status: state.status,
    tenantId: state.tenantId,
    clinicId: state.clinicId,
    correlationId: state.correlationId,
    ...(state.actionExecutionId ? { actionExecutionId: state.actionExecutionId } : {}),
    ...(state.terminalReason ? { terminalReason: state.terminalReason } : {})
  };
}
