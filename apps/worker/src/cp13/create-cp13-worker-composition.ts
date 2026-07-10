import type { Client } from "@temporalio/client";
import {
  createCp13WorkflowActivities,
  type ApprovalActivities,
  type Cp13ActivityPorts,
  type Cp13WorkflowActivities
} from "@clinic-os/workflow";
import { ApprovalWorkflowRequestedHandler } from "../outbox/handlers/approval-workflow-requested.js";
import {
  Cp13ContinuityDueGenerationRequestedHandler,
  Cp13SopDueGenerationRequestedHandler
} from "../outbox/handlers/cp13-due-generation-requested.js";
import { Cp13PatientInstructionSendRequestedHandler } from "../outbox/handlers/cp13-patient-instruction-send-requested.js";
import { Cp13PaymentRequestRecoveryRequestedHandler } from "../outbox/handlers/cp13-payment-request-recovery-requested.js";
import type { OutboxEventHandler } from "../outbox/types.js";

export interface Cp13WorkerCompositionOptions {
  readonly temporalClient: Client;
  readonly approvalActivities?: ApprovalActivities;
  readonly cp13ActivityPorts: Cp13ActivityPorts;
  readonly taskQueue?: string;
}

export interface Cp13WorkerComposition {
  readonly handlers: readonly OutboxEventHandler[];
  readonly activities: Partial<ApprovalActivities> & Cp13WorkflowActivities;
}

/**
 * Creates the complete CP13 registration unit. Master wiring must use the returned handler list as
 * a whole so the pre-existing approval workflow remains available alongside the four CP13 action
 * event handlers.
 */
export function createCp13WorkerComposition(
  options: Cp13WorkerCompositionOptions
): Cp13WorkerComposition {
  const temporalOptions = {
    temporalClient: options.temporalClient,
    ...(options.taskQueue ? { taskQueue: options.taskQueue } : {})
  };
  const cp13Handlers = [
    new Cp13ContinuityDueGenerationRequestedHandler(temporalOptions),
    new Cp13SopDueGenerationRequestedHandler(temporalOptions),
    new Cp13PatientInstructionSendRequestedHandler(temporalOptions),
    new Cp13PaymentRequestRecoveryRequestedHandler(temporalOptions)
  ];
  return {
    handlers: options.approvalActivities
      ? [new ApprovalWorkflowRequestedHandler(temporalOptions), ...cp13Handlers]
      : cp13Handlers,
    activities: {
      ...(options.approvalActivities ?? {}),
      ...createCp13WorkflowActivities(options.cp13ActivityPorts)
    }
  };
}
