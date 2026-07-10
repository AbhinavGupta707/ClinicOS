import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";
import {
  CLINIC_OS_TASK_QUEUE,
  buildCp13DueGenerationWorkflowId,
  durableContinuityDueGenerationWorkflow,
  durableSopDueGenerationWorkflow,
  type Cp13DueGenerationKind
} from "@clinic-os/workflow";
import { parseDueGenerationWorkflowInput } from "../../cp13/outbox-validation.js";
import type { OutboxEventHandler, OutboxEventRecord, OutboxHandlerContext } from "../types.js";

export const CP13_CONTINUITY_DUE_GENERATION_REQUESTED_EVENT =
  "workflow.cp13.continuity_due_generation.requested";
export const CP13_SOP_DUE_GENERATION_REQUESTED_EVENT = "workflow.cp13.sop_due_generation.requested";

interface Cp13DueGenerationRequestedHandlerOptions {
  readonly temporalClient: Client;
  readonly taskQueue?: string;
}

abstract class Cp13DueGenerationRequestedHandler implements OutboxEventHandler {
  abstract readonly eventType: string;
  abstract readonly generationKind: Cp13DueGenerationKind;
  readonly #temporalClient: Client;
  readonly #taskQueue: string;

  constructor(options: Cp13DueGenerationRequestedHandlerOptions) {
    this.#temporalClient = options.temporalClient;
    this.#taskQueue = options.taskQueue ?? CLINIC_OS_TASK_QUEUE;
  }

  async handle(event: OutboxEventRecord, context: OutboxHandlerContext): Promise<void> {
    const input = parseDueGenerationWorkflowInput(event, this.generationKind);
    const workflowId = buildCp13DueGenerationWorkflowId(input);
    const workflow =
      this.generationKind === "continuity"
        ? durableContinuityDueGenerationWorkflow
        : durableSopDueGenerationWorkflow;
    try {
      await this.#temporalClient.workflow.start(workflow, {
        workflowId,
        workflowIdReusePolicy: "REJECT_DUPLICATE",
        taskQueue: this.#taskQueue,
        workflowExecutionTimeout: "24 hours",
        args: [input],
        memo: {
          tenantId: context.tenantId,
          clinicId: context.clinicId,
          eventId: event.eventId,
          correlationId: context.correlationId,
          generationKind: this.generationKind
        }
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return;
      throw error;
    }
  }
}

export class Cp13ContinuityDueGenerationRequestedHandler extends Cp13DueGenerationRequestedHandler {
  readonly eventType = CP13_CONTINUITY_DUE_GENERATION_REQUESTED_EVENT;
  readonly generationKind = "continuity" as const;
}

export class Cp13SopDueGenerationRequestedHandler extends Cp13DueGenerationRequestedHandler {
  readonly eventType = CP13_SOP_DUE_GENERATION_REQUESTED_EVENT;
  readonly generationKind = "sop" as const;
}
