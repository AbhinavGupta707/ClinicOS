import { WorkflowExecutionAlreadyStartedError, type Client } from "@temporalio/client";
import {
  CLINIC_OS_TASK_QUEUE,
  buildCp13PatientInstructionSendWorkflowId,
  durablePatientInstructionSendRequestWorkflow,
  type Cp13PatientInstructionSendWorkflowInput
} from "@clinic-os/workflow";
import { cp13WorkflowIdentityFromEnvelope } from "../../cp13/outbox-validation.js";
import { permanentOutboxFailure } from "../errors.js";
import type { OutboxEventHandler, OutboxEventRecord, OutboxHandlerContext } from "../types.js";

export const CP13_PATIENT_INSTRUCTION_SEND_REQUESTED_EVENT = "instruction.send_requested";

export interface Cp13PatientInstructionSendRequestedHandlerOptions {
  readonly temporalClient: Client;
  readonly taskQueue?: string;
}

export class Cp13PatientInstructionSendRequestedHandler implements OutboxEventHandler {
  readonly eventType = CP13_PATIENT_INSTRUCTION_SEND_REQUESTED_EVENT;
  readonly #temporalClient: Client;
  readonly #taskQueue: string;

  constructor(options: Cp13PatientInstructionSendRequestedHandlerOptions) {
    this.#temporalClient = options.temporalClient;
    this.#taskQueue = options.taskQueue ?? CLINIC_OS_TASK_QUEUE;
  }

  async handle(event: OutboxEventRecord, context: OutboxHandlerContext): Promise<void> {
    const input = instructionInput(event);
    try {
      await this.#temporalClient.workflow.start(durablePatientInstructionSendRequestWorkflow, {
        workflowId: buildCp13PatientInstructionSendWorkflowId(input),
        workflowIdReusePolicy: "REJECT_DUPLICATE",
        taskQueue: this.#taskQueue,
        workflowExecutionTimeout: "30 minutes",
        args: [input],
        memo: {
          tenantId: context.tenantId,
          clinicId: context.clinicId,
          eventId: event.eventId,
          correlationId: context.correlationId,
          resourceType: "patient_instruction"
        }
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) return;
      throw error;
    }
  }
}

function instructionInput(event: OutboxEventRecord): Cp13PatientInstructionSendWorkflowInput {
  const payload = event.payload;
  if (
    event.aggregateType !== "patient_instruction" ||
    payload.instructionId !== event.aggregateId ||
    typeof payload.patientId !== "string" ||
    payload.patientId.length === 0 ||
    payload.channel !== "whatsapp" ||
    payload.status !== "send_requested" ||
    payload.providerConfirmationReceived !== false ||
    payload.providerDeliveryConfirmedAt !== null ||
    payload.deliveredAt !== null ||
    payload.readAt !== null ||
    [
      "tenantId",
      "clinicId",
      "actor",
      "actorUserId",
      "eventId",
      "correlationId",
      "idempotencyKey",
      "requestedAt"
    ].some((key) => key in payload)
  ) {
    throw permanentOutboxFailure(
      "CP13_INSTRUCTION_SEND_PAYLOAD_INVALID",
      "instruction send workflow requires request-only evidence matching the outbox aggregate"
    );
  }
  return {
    ...cp13WorkflowIdentityFromEnvelope(event),
    patientId: payload.patientId,
    instructionId: event.aggregateId
  };
}
