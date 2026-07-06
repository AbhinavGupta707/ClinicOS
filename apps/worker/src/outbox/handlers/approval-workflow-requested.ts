import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";
import {
  CLINIC_OS_TASK_QUEUE,
  durableApprovalTimerWorkflow,
  type ApprovalWorkflowInput
} from "@clinic-os/workflow";
import { permanentOutboxFailure } from "../errors.js";
import type { OutboxEventHandler, OutboxEventRecord, OutboxHandlerContext } from "../types.js";

export const APPROVAL_WORKFLOW_REQUESTED_EVENT = "workflow.approval.requested";

export interface ApprovalWorkflowRequestedHandlerOptions {
  readonly temporalClient: Client;
  readonly taskQueue?: string;
}

export class ApprovalWorkflowRequestedHandler implements OutboxEventHandler {
  readonly eventType = APPROVAL_WORKFLOW_REQUESTED_EVENT;
  readonly #temporalClient: Client;
  readonly #taskQueue: string;

  constructor(options: ApprovalWorkflowRequestedHandlerOptions) {
    this.#temporalClient = options.temporalClient;
    this.#taskQueue = options.taskQueue ?? CLINIC_OS_TASK_QUEUE;
  }

  async handle(event: OutboxEventRecord, context: OutboxHandlerContext): Promise<void> {
    const input = toApprovalWorkflowInput(event);
    const workflowId = buildApprovalWorkflowId(input);

    try {
      await this.#temporalClient.workflow.start(durableApprovalTimerWorkflow, {
        workflowId,
        taskQueue: this.#taskQueue,
        args: [input],
        memo: {
          tenantId: context.tenantId,
          clinicId: context.clinicId,
          eventId: event.eventId,
          correlationId: context.correlationId
        }
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return;
      throw error;
    }
  }
}

export function buildApprovalWorkflowId(input: ApprovalWorkflowInput): string {
  return [
    "tenant",
    input.tenantId,
    "clinic",
    input.clinicId,
    "approval",
    input.workflowRunId
  ].join("/");
}

function toApprovalWorkflowInput(event: OutboxEventRecord): ApprovalWorkflowInput {
  const payload = event.payload;
  const candidate = payload["workflow"] ?? payload;

  if (!isApprovalWorkflowInput(candidate)) {
    throw permanentOutboxFailure(
      "INVALID_APPROVAL_WORKFLOW_PAYLOAD",
      "workflow.approval.requested payload must contain an ApprovalWorkflowInput"
    );
  }

  if (candidate.tenantId !== event.tenantId || candidate.clinicId !== event.clinicId) {
    throw permanentOutboxFailure(
      "APPROVAL_WORKFLOW_CONTEXT_MISMATCH",
      "approval workflow tenant/clinic context must match the outbox envelope"
    );
  }

  return candidate;
}

function isApprovalWorkflowInput(value: unknown): value is ApprovalWorkflowInput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.workflowRunId === "string" &&
    typeof candidate.tenantId === "string" &&
    typeof candidate.clinicId === "string" &&
    candidate.schemaVersion === "1.0" &&
    typeof candidate.correlationId === "string" &&
    typeof candidate.idempotencyKey === "string" &&
    isDomainReference(candidate.subject) &&
    isWorkflowActor(candidate.requestedBy) &&
    typeof candidate.requestedAt === "string" &&
    isApprovalBlock(candidate.approval) &&
    isApprovalActionReference(candidate.action)
  );
}

function isDomainReference(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.aggregateType === "string" && typeof candidate.aggregateId === "string";
}

function isWorkflowActor(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.type === "string" && typeof candidate.id === "string";
}

function isApprovalBlock(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.requiredPermission === "string" &&
    typeof candidate.timeoutMs === "number" &&
    Number.isFinite(candidate.timeoutMs) &&
    candidate.timeoutMs > 0
  );
}

function isApprovalActionReference(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.actionType === "string" && isDomainReference(candidate.target);
}
