import type {
  Cp13DueGenerationWorkflowInput,
  Cp13PatientInstructionSendWorkflowInput,
  Cp13PaymentRequestRecoveryWorkflowInput
} from "./cp13-contracts.js";

export function buildCp13DueGenerationWorkflowId(
  input: Pick<
    Cp13DueGenerationWorkflowInput,
    "tenantId" | "clinicId" | "actorUserId" | "generationKind" | "asOf"
  >
): string {
  return [
    "tenant",
    input.tenantId,
    "clinic",
    input.clinicId,
    "actor",
    input.actorUserId,
    "clinic-day",
    input.generationKind,
    input.asOf
  ].join("/");
}

export function buildCp13PatientInstructionSendWorkflowId(
  input: Pick<
    Cp13PatientInstructionSendWorkflowInput,
    "tenantId" | "clinicId" | "actorUserId" | "patientId" | "instructionId"
  >
): string {
  return [
    "tenant",
    input.tenantId,
    "clinic",
    input.clinicId,
    "actor",
    input.actorUserId,
    "patient",
    input.patientId,
    "instruction-send",
    input.instructionId
  ].join("/");
}

export function buildCp13PaymentRequestRecoveryWorkflowId(
  input: Pick<
    Cp13PaymentRequestRecoveryWorkflowInput,
    "tenantId" | "clinicId" | "actorUserId" | "durableIntentId"
  >
): string {
  return [
    "tenant",
    input.tenantId,
    "clinic",
    input.clinicId,
    "actor",
    input.actorUserId,
    "payment-request-recovery",
    input.durableIntentId
  ].join("/");
}
