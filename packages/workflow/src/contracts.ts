export type WorkflowActorType = "user" | "system" | "integration" | "ai" | "workflow";

export interface WorkflowActor {
  readonly type: WorkflowActorType;
  readonly id: string;
}

export interface DomainReference {
  readonly aggregateType: string;
  readonly aggregateId: string;
}

export interface ApprovalActionReference {
  readonly actionType:
    | "action_proposal.execute"
    | "appointment.confirmation.send"
    | "recall.message.send"
    | "payment.reminder.send"
    | "lab_case.advance"
    | "migration.commit";
  readonly target: DomainReference;
}

export interface ApprovalWorkflowInput {
  readonly workflowRunId: string;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly schemaVersion: "1.0";
  readonly subject: DomainReference;
  readonly requestedBy: WorkflowActor;
  readonly requestedAt: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly approval: {
    readonly requiredPermission: string;
    readonly timeoutMs: number;
  };
  readonly action: ApprovalActionReference;
}

export type ApprovalDecisionValue = "approved" | "rejected";

export interface ApprovalDecision {
  readonly decision: ApprovalDecisionValue;
  readonly decidedBy: WorkflowActor;
  readonly decidedAt: string;
  readonly reason?: string;
  readonly correlationId?: string;
}

export interface ApprovalCancellation {
  readonly cancelledBy: WorkflowActor;
  readonly cancelledAt: string;
  readonly reason: string;
  readonly correlationId?: string;
}

export type ApprovalWorkflowStatus =
  | "started"
  | "waiting_approval"
  | "approved"
  | "rejected"
  | "timed_out"
  | "cancelled"
  | "action_executed"
  | "action_failed";

export interface ApprovalWorkflowState {
  readonly workflowRunId: string;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly subject: DomainReference;
  readonly action: ApprovalActionReference;
  readonly requiredPermission: string;
  readonly status: ApprovalWorkflowStatus;
  readonly requestedAt: string;
  readonly approvalTaskId?: string;
  readonly waitingSince?: string;
  readonly expiresAt?: string;
  readonly decision?: ApprovalDecision;
  readonly cancellation?: ApprovalCancellation;
  readonly terminalReason?: string;
  readonly actionExecutionId?: string;
}

export interface ApprovalWorkflowResult {
  readonly workflowRunId: string;
  readonly status: ApprovalWorkflowStatus;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly correlationId: string;
  readonly actionExecutionId?: string;
  readonly terminalReason?: string;
}
