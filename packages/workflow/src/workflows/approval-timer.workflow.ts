import {
  condition,
  defineQuery,
  defineSignal,
  proxyActivities,
  setHandler,
  sleep
} from "@temporalio/workflow";
import type { ApprovalActivities } from "../activities/approval-activities.js";
import {
  applyApprovalCancellation,
  applyApprovalDecision,
  createInitialApprovalState,
  markActionExecuted,
  markActionFailed,
  markApprovalTimedOut,
  markWaitingForApproval,
  toApprovalWorkflowResult
} from "../approval-state.js";
import type {
  ApprovalCancellation,
  ApprovalDecision,
  ApprovalWorkflowInput,
  ApprovalWorkflowResult,
  ApprovalWorkflowState
} from "../contracts.js";

const activities = proxyActivities<ApprovalActivities>({
  startToCloseTimeout: "60 seconds",
  retry: {
    initialInterval: "5 seconds",
    backoffCoefficient: 2,
    maximumInterval: "5 minutes",
    maximumAttempts: 6
  }
});

export const approvalDecisionSignal = defineSignal<[ApprovalDecision]>("approval.decision");
export const approvalCancellationSignal =
  defineSignal<[ApprovalCancellation]>("approval.cancel");
export const approvalStateQuery =
  defineQuery<ApprovalWorkflowState>("approval.state");

export async function durableApprovalTimerWorkflow(
  input: ApprovalWorkflowInput
): Promise<ApprovalWorkflowResult> {
  let state = createInitialApprovalState(input);
  let pendingDecision: ApprovalDecision | undefined;
  let pendingCancellation: ApprovalCancellation | undefined;

  setHandler(approvalDecisionSignal, (decision) => {
    if (state.status === "waiting_approval") {
      pendingDecision = decision;
    }
  });

  setHandler(approvalCancellationSignal, (cancellation) => {
    pendingCancellation = cancellation;
  });

  setHandler(approvalStateQuery, () => state);

  await activities.recordWorkflowStarted(input);
  const task = await activities.createApprovalTask({ input });
  state = markWaitingForApproval(
    state,
    task.approvalTaskId,
    task.createdAt,
    input.approval.timeoutMs
  );
  await activities.recordWorkflowWaiting(state);

  await Promise.race([
    sleep(input.approval.timeoutMs).then(() => {
      state = markApprovalTimedOut(state);
    }),
    condition(() => pendingDecision !== undefined || pendingCancellation !== undefined).then(() => {
      if (pendingCancellation) {
        state = applyApprovalCancellation(state, pendingCancellation);
      } else if (pendingDecision) {
        state = applyApprovalDecision(state, pendingDecision);
      }
    })
  ]);

  if (state.status === "approved" && state.decision) {
    try {
      const execution = await activities.executeApprovedAction({
        workflowRunId: input.workflowRunId,
        tenantId: input.tenantId,
        clinicId: input.clinicId,
        action: input.action,
        approvedByUserId: state.decision.decidedBy.id,
        idempotencyKey: input.idempotencyKey,
        correlationId: state.decision.correlationId ?? input.correlationId
      });
      state = markActionExecuted(state, execution.actionExecutionId);
    } catch (error) {
      state = markActionFailed(
        state,
        error instanceof Error ? error.message : "approved_action_failed"
      );
    }
  }

  const result = toApprovalWorkflowResult(state);
  await activities.recordWorkflowTerminal(result);
  return result;
}
