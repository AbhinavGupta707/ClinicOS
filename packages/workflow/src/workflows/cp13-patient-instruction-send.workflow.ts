import { defineQuery, patched, proxyActivities, setHandler } from "@temporalio/workflow";
import type { Cp13PatientInstructionActivities } from "../activities/cp13-activities.js";
import {
  CP13_ACTIVITY_RETRY_POLICY,
  CP13_EVIDENCE_ACTIVITY_RETRY_POLICY,
  CP13_INSTRUCTION_SEND_VERSION_MARKER,
  CP13_PERMANENT_ACTIVITY_FAILURE,
  type Cp13PatientInstructionSendWorkflowInput,
  type Cp13PatientInstructionSendWorkflowResult
} from "../cp13-contracts.js";
import { classifyCp13ActivityFailure } from "./cp13-failure.js";
import { safeCp13FailureCode } from "../cp13-workflow-state.js";

const instructionActivities = proxyActivities<
  Pick<Cp13PatientInstructionActivities, "requestPatientInstructionSend">
>({
  startToCloseTimeout: "2 minutes",
  retry: {
    ...CP13_ACTIVITY_RETRY_POLICY,
    nonRetryableErrorTypes: [CP13_PERMANENT_ACTIVITY_FAILURE]
  }
});

const evidenceActivities = proxyActivities<
  Pick<Cp13PatientInstructionActivities, "recordPatientInstructionSendTerminal">
>({
  startToCloseTimeout: "60 seconds",
  retry: CP13_EVIDENCE_ACTIVITY_RETRY_POLICY
});

export type Cp13PatientInstructionSendProgress =
  | {
      readonly tenantId: string;
      readonly clinicId: string;
      readonly actorUserId: string;
      readonly eventId: string;
      readonly correlationId: string;
      readonly idempotencyKey: string;
      readonly requestedAt: string;
      readonly patientId: string;
      readonly instructionId: string;
      readonly status: "running";
    }
  | Cp13PatientInstructionSendWorkflowResult;

export const cp13PatientInstructionSendProgressQuery =
  defineQuery<Cp13PatientInstructionSendProgress>("cp13.instruction_send.progress");

export async function durablePatientInstructionSendRequestWorkflow(
  input: Cp13PatientInstructionSendWorkflowInput
): Promise<Cp13PatientInstructionSendWorkflowResult> {
  patched(CP13_INSTRUCTION_SEND_VERSION_MARKER);
  let progress: Cp13PatientInstructionSendProgress = {
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    eventId: input.eventId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    requestedAt: input.requestedAt,
    patientId: input.patientId,
    instructionId: input.instructionId,
    status: "running"
  };
  setHandler(cp13PatientInstructionSendProgressQuery, () => progress);

  try {
    const activityResult = await instructionActivities.requestPatientInstructionSend({
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      patientId: input.patientId,
      instructionId: input.instructionId,
      eventId: input.eventId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      requestedAt: input.requestedAt
    });
    progress =
      activityResult.outcome === "requested" &&
      activityResult.providerSubmissionId.length > 0 &&
      activityResult.providerSubmissionId.length <= 512 &&
      activityResult.requestEvidenceId.length > 0 &&
      activityResult.requestEvidenceId.length <= 512
        ? {
            tenantId: input.tenantId,
            clinicId: input.clinicId,
            actorUserId: input.actorUserId,
            eventId: input.eventId,
            correlationId: input.correlationId,
            idempotencyKey: input.idempotencyKey,
            requestedAt: input.requestedAt,
            patientId: input.patientId,
            instructionId: input.instructionId,
            status: "requested",
            providerSubmissionId: activityResult.providerSubmissionId,
            requestEvidenceId: activityResult.requestEvidenceId
          }
        : activityResult.outcome === "permanent_failure" &&
            activityResult.requestEvidenceId.length > 0 &&
            activityResult.requestEvidenceId.length <= 512
          ? {
              tenantId: input.tenantId,
              clinicId: input.clinicId,
              actorUserId: input.actorUserId,
              eventId: input.eventId,
              correlationId: input.correlationId,
              idempotencyKey: input.idempotencyKey,
              requestedAt: input.requestedAt,
              patientId: input.patientId,
              instructionId: input.instructionId,
              status: "failed",
              failure: {
                classification: "permanent",
                code: safeCp13FailureCode(
                  activityResult.failureCode,
                  "INSTRUCTION_SEND_PERMANENT_FAILURE"
                )
              },
              requestEvidenceId: activityResult.requestEvidenceId
            }
          : {
              tenantId: input.tenantId,
              clinicId: input.clinicId,
              actorUserId: input.actorUserId,
              eventId: input.eventId,
              correlationId: input.correlationId,
              idempotencyKey: input.idempotencyKey,
              requestedAt: input.requestedAt,
              patientId: input.patientId,
              instructionId: input.instructionId,
              status: "failed",
              failure: {
                classification: "permanent",
                code: "INSTRUCTION_SEND_ACTIVITY_RESULT_INVALID"
              }
            };
  } catch (error) {
    progress = {
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      actorUserId: input.actorUserId,
      eventId: input.eventId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey,
      requestedAt: input.requestedAt,
      patientId: input.patientId,
      instructionId: input.instructionId,
      status: "failed",
      failure: classifyCp13ActivityFailure(error)
    };
  }

  await evidenceActivities.recordPatientInstructionSendTerminal(progress);
  return progress;
}
