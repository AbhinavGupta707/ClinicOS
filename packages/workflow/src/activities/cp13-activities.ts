import { ApplicationFailure } from "@temporalio/activity";
import type {
  Cp13DueGenerationBatchRequest,
  Cp13DueGenerationBatchResult,
  Cp13DueGenerationWorkflowResult,
  Cp13FinalizePaymentRequestRecoveryRequest,
  Cp13PatientInstructionSendActivityRequest,
  Cp13PatientInstructionSendActivityResult,
  Cp13PatientInstructionSendWorkflowResult,
  Cp13PaymentIntentClaimRequest,
  Cp13PaymentIntentClaimResult,
  Cp13PaymentRequestRecoveryResult,
  Cp13ProviderPaymentRequestRecoveryRequest,
  Cp13ProviderPaymentRequestRecoveryResult
} from "../cp13-contracts.js";
import { CP13_PERMANENT_ACTIVITY_FAILURE } from "../cp13-contracts.js";

export interface Cp13DueGenerationActivities {
  generateContinuityDueBatch(
    request: Cp13DueGenerationBatchRequest
  ): Promise<Cp13DueGenerationBatchResult>;
  generateSopDueBatch(
    request: Cp13DueGenerationBatchRequest
  ): Promise<Cp13DueGenerationBatchResult>;
  recordCp13DueGenerationTerminal(result: Cp13DueGenerationWorkflowResult): Promise<void>;
}

export interface Cp13PatientInstructionActivities {
  requestPatientInstructionSend(
    request: Cp13PatientInstructionSendActivityRequest
  ): Promise<Cp13PatientInstructionSendActivityResult>;
  recordPatientInstructionSendTerminal(
    result: Cp13PatientInstructionSendWorkflowResult
  ): Promise<void>;
}

export interface Cp13PaymentRequestRecoveryActivities {
  claimPaymentRequestIntent(
    request: Cp13PaymentIntentClaimRequest
  ): Promise<Cp13PaymentIntentClaimResult>;
  createOrRecoverProviderPaymentRequest(
    request: Cp13ProviderPaymentRequestRecoveryRequest
  ): Promise<Cp13ProviderPaymentRequestRecoveryResult>;
  finalizeOrReconcilePaymentRequestIntent(
    request: Cp13FinalizePaymentRequestRecoveryRequest
  ): Promise<Cp13PaymentRequestRecoveryResult>;
}

export type Cp13WorkflowActivities = Cp13DueGenerationActivities &
  Cp13PatientInstructionActivities &
  Cp13PaymentRequestRecoveryActivities;

export interface Cp13ActivityPorts {
  readonly dueGeneration: Cp13DueGenerationActivities;
  readonly patientInstruction: Cp13PatientInstructionActivities;
  readonly paymentRequestRecovery: Cp13PaymentRequestRecoveryActivities;
}

export function createCp13WorkflowActivities(ports: Cp13ActivityPorts): Cp13WorkflowActivities {
  return {
    generateContinuityDueBatch: (request) =>
      ports.dueGeneration.generateContinuityDueBatch(request),
    generateSopDueBatch: (request) => ports.dueGeneration.generateSopDueBatch(request),
    recordCp13DueGenerationTerminal: (result) =>
      ports.dueGeneration.recordCp13DueGenerationTerminal(result),
    requestPatientInstructionSend: (request) =>
      ports.patientInstruction.requestPatientInstructionSend(request),
    recordPatientInstructionSendTerminal: (result) =>
      ports.patientInstruction.recordPatientInstructionSendTerminal(result),
    claimPaymentRequestIntent: (request) =>
      ports.paymentRequestRecovery.claimPaymentRequestIntent(request),
    createOrRecoverProviderPaymentRequest: (request) =>
      ports.paymentRequestRecovery.createOrRecoverProviderPaymentRequest(request),
    finalizeOrReconcilePaymentRequestIntent: (request) =>
      ports.paymentRequestRecovery.finalizeOrReconcilePaymentRequestIntent(request)
  };
}

/**
 * Activity adapters use this for authority, validation, or provider failures that cannot succeed
 * on retry. Retryable infrastructure/provider failures should be thrown normally or as a retryable
 * ApplicationFailure so Temporal applies the workflow's bounded retry policy.
 */
export function permanentCp13ActivityFailure(code: string): ApplicationFailure {
  return ApplicationFailure.nonRetryable(code, CP13_PERMANENT_ACTIVITY_FAILURE);
}
