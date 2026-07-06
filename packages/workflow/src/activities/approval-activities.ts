import type {
  ApprovalActionReference,
  ApprovalWorkflowInput,
  ApprovalWorkflowResult,
  ApprovalWorkflowState
} from "../contracts.js";

export interface CreateApprovalTaskRequest {
  readonly input: ApprovalWorkflowInput;
}

export interface CreateApprovalTaskResult {
  readonly approvalTaskId: string;
  readonly createdAt: string;
}

export interface ExecuteApprovedActionRequest {
  readonly workflowRunId: string;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly action: ApprovalActionReference;
  readonly approvedByUserId: string;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

export interface ExecuteApprovedActionResult {
  readonly actionExecutionId: string;
}

export interface ApprovalActivities {
  recordWorkflowStarted(input: ApprovalWorkflowInput): Promise<void>;
  createApprovalTask(request: CreateApprovalTaskRequest): Promise<CreateApprovalTaskResult>;
  recordWorkflowWaiting(state: ApprovalWorkflowState): Promise<void>;
  executeApprovedAction(
    request: ExecuteApprovedActionRequest
  ): Promise<ExecuteApprovedActionResult>;
  recordWorkflowTerminal(result: ApprovalWorkflowResult): Promise<void>;
}

export interface ApprovalActivityPorts {
  readonly workflowStateRecorder: {
    recordStarted(input: ApprovalWorkflowInput): Promise<void>;
    recordWaiting(state: ApprovalWorkflowState): Promise<void>;
    recordTerminal(result: ApprovalWorkflowResult): Promise<void>;
  };
  readonly approvalTaskCreator: {
    create(request: CreateApprovalTaskRequest): Promise<CreateApprovalTaskResult>;
  };
  readonly approvedActionExecutor: {
    execute(request: ExecuteApprovedActionRequest): Promise<ExecuteApprovedActionResult>;
  };
}

export function createApprovalActivities(ports: ApprovalActivityPorts): ApprovalActivities {
  return {
    recordWorkflowStarted: (input) => ports.workflowStateRecorder.recordStarted(input),
    createApprovalTask: (request) => ports.approvalTaskCreator.create(request),
    recordWorkflowWaiting: (state) => ports.workflowStateRecorder.recordWaiting(state),
    executeApprovedAction: (request) => ports.approvedActionExecutor.execute(request),
    recordWorkflowTerminal: (result) => ports.workflowStateRecorder.recordTerminal(result)
  };
}
