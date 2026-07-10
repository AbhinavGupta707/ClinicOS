import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";
import {
  CLINIC_OS_TASK_QUEUE,
  buildCp13PaymentRequestRecoveryWorkflowId,
  durablePaymentRequestRecoveryWorkflow
} from "@clinic-os/workflow";
import { parsePaymentRecoveryWorkflowInput } from "../../cp13/outbox-validation.js";
import type { OutboxEventHandler, OutboxEventRecord, OutboxHandlerContext } from "../types.js";

export const CP13_PAYMENT_REQUEST_RECOVERY_REQUESTED_EVENT =
  "workflow.cp13.payment_request_recovery.requested";

export interface Cp13PaymentRequestRecoveryRequestedHandlerOptions {
  readonly temporalClient: Client;
  readonly taskQueue?: string;
}

export class Cp13PaymentRequestRecoveryRequestedHandler implements OutboxEventHandler {
  readonly eventType = CP13_PAYMENT_REQUEST_RECOVERY_REQUESTED_EVENT;
  readonly #temporalClient: Client;
  readonly #taskQueue: string;

  constructor(options: Cp13PaymentRequestRecoveryRequestedHandlerOptions) {
    this.#temporalClient = options.temporalClient;
    this.#taskQueue = options.taskQueue ?? CLINIC_OS_TASK_QUEUE;
  }

  async handle(event: OutboxEventRecord, context: OutboxHandlerContext): Promise<void> {
    const input = parsePaymentRecoveryWorkflowInput(event);
    try {
      await this.#temporalClient.workflow.start(durablePaymentRequestRecoveryWorkflow, {
        workflowId: buildCp13PaymentRequestRecoveryWorkflowId(input),
        workflowIdReusePolicy: "REJECT_DUPLICATE",
        taskQueue: this.#taskQueue,
        workflowExecutionTimeout: "30 minutes",
        args: [input],
        memo: {
          tenantId: context.tenantId,
          clinicId: context.clinicId,
          eventId: event.eventId,
          correlationId: context.correlationId,
          resourceType: "payment_request_intent"
        }
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return;
      throw error;
    }
  }
}
