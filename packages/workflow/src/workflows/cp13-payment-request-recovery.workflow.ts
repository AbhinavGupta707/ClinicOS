import { defineQuery, patched, proxyActivities, setHandler } from "@temporalio/workflow";
import type { Cp13PaymentRequestRecoveryActivities } from "../activities/cp13-activities.js";
import {
  CP13_ACTIVITY_RETRY_POLICY,
  CP13_PAYMENT_RECOVERY_VERSION_MARKER,
  CP13_PERMANENT_ACTIVITY_FAILURE,
  type Cp13FinalizePaymentRequestRecoveryRequest,
  type Cp13PaymentIntentIdentity,
  type Cp13PaymentRequestRecoveryResult,
  type Cp13PaymentRequestRecoveryWorkflowInput,
  type Cp13WorkflowFailure
} from "../cp13-contracts.js";
import {
  claimedPaymentIntentIsAuthoritative,
  paymentRecoveryResultIsAuthoritative,
  planProviderPaymentResolution,
  safeCp13FailureCode,
  toProviderPaymentRequestRecoveryRequest
} from "../cp13-workflow-state.js";
import { classifyCp13ActivityFailure } from "./cp13-failure.js";

const activities = proxyActivities<Cp13PaymentRequestRecoveryActivities>({
  startToCloseTimeout: "2 minutes",
  retry: {
    ...CP13_ACTIVITY_RETRY_POLICY,
    nonRetryableErrorTypes: [CP13_PERMANENT_ACTIVITY_FAILURE]
  }
});

export type Cp13PaymentRequestRecoveryProgress =
  | (Cp13PaymentIntentIdentity & {
      readonly status: "claiming" | "provider_recovery" | "finalizing";
    })
  | Cp13PaymentRequestRecoveryResult;

export const cp13PaymentRequestRecoveryProgressQuery =
  defineQuery<Cp13PaymentRequestRecoveryProgress>("cp13.payment_request_recovery.progress");

export async function durablePaymentRequestRecoveryWorkflow(
  input: Cp13PaymentRequestRecoveryWorkflowInput
): Promise<Cp13PaymentRequestRecoveryResult> {
  patched(CP13_PAYMENT_RECOVERY_VERSION_MARKER);
  const identity = paymentIdentity(input);
  let progress: Cp13PaymentRequestRecoveryProgress = { ...identity, status: "claiming" };
  setHandler(cp13PaymentRequestRecoveryProgressQuery, () => progress);

  let claim;
  try {
    claim = await activities.claimPaymentRequestIntent({
      ...identity,
      eventId: input.eventId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey
    });
  } catch (error) {
    return finalizeFailure(classifyCp13ActivityFailure(error), identity, input, null, (value) => {
      progress = value;
    });
  }

  if (claim.outcome === "already_terminal") {
    if (paymentRecoveryResultIsAuthoritative(identity, claim.result)) {
      progress = claim.result;
      return claim.result;
    }
    return finalizeReconciliation(
      "PAYMENT_TERMINAL_RESULT_MISMATCH",
      identity,
      input,
      null,
      undefined,
      (value) => {
        progress = value;
      }
    );
  }

  if (claim.outcome === "reconciliation_required") {
    return finalizeReconciliation(
      safeCp13FailureCode(claim.reasonCode, "PAYMENT_INTENT_RECONCILIATION_REQUIRED"),
      identity,
      input,
      null,
      claim.evidenceId,
      (value) => {
        progress = value;
      }
    );
  }

  if (!claimedPaymentIntentIsAuthoritative(identity, claim.intent)) {
    return finalizeReconciliation(
      "PAYMENT_INTENT_AUTHORITY_MISMATCH",
      identity,
      input,
      null,
      undefined,
      (value) => {
        progress = value;
      }
    );
  }

  progress = { ...identity, status: "provider_recovery" };
  let resolution: Cp13FinalizePaymentRequestRecoveryRequest;
  try {
    const providerResult = await activities.createOrRecoverProviderPaymentRequest(
      toProviderPaymentRequestRecoveryRequest(claim.intent, {
        eventId: input.eventId,
        correlationId: input.correlationId,
        idempotencyKey: input.idempotencyKey
      })
    );
    resolution = planProviderPaymentResolution(identity, claim.intent, providerResult, {
      eventId: input.eventId,
      correlationId: input.correlationId,
      idempotencyKey: input.idempotencyKey
    });
  } catch (error) {
    resolution = failureFinalization(
      classifyCp13ActivityFailure(error),
      identity,
      input,
      claim.intent.claimToken
    );
  }

  progress = { ...identity, status: "finalizing" };
  const result = await activities.finalizeOrReconcilePaymentRequestIntent(resolution);
  if (
    !paymentRecoveryResultIsAuthoritative(identity, result) ||
    result.status !== resolution.resolution.status
  ) {
    const failed: Cp13PaymentRequestRecoveryResult = {
      ...identity,
      status: "failed",
      evidenceId: result.evidenceId,
      failure: {
        classification: "permanent",
        code: "PAYMENT_FINALIZE_RESULT_MISMATCH"
      }
    };
    progress = failed;
    return failed;
  }
  progress = result;
  return result;
}

async function finalizeFailure(
  failure: Cp13WorkflowFailure,
  identity: Cp13PaymentIntentIdentity,
  input: Cp13PaymentRequestRecoveryWorkflowInput,
  claimToken: string | null,
  setProgress: (progress: Cp13PaymentRequestRecoveryProgress) => void
): Promise<Cp13PaymentRequestRecoveryResult> {
  const request = failureFinalization(failure, identity, input, claimToken);
  setProgress({ ...identity, status: "finalizing" });
  const result = await activities.finalizeOrReconcilePaymentRequestIntent(request);
  if (paymentRecoveryResultIsAuthoritative(identity, result) && result.status === "failed") {
    setProgress(result);
    return result;
  }
  const failed = finalizeMismatch(identity, result.evidenceId);
  setProgress(failed);
  return failed;
}

async function finalizeReconciliation(
  reasonCode: string,
  identity: Cp13PaymentIntentIdentity,
  input: Cp13PaymentRequestRecoveryWorkflowInput,
  claimToken: string | null,
  sourceEvidenceId: string | undefined,
  setProgress: (progress: Cp13PaymentRequestRecoveryProgress) => void
): Promise<Cp13PaymentRequestRecoveryResult> {
  const request: Cp13FinalizePaymentRequestRecoveryRequest = {
    ...identity,
    claimToken,
    eventId: input.eventId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    resolution: {
      status: "reconciliation_required",
      reasonCode,
      ...(sourceEvidenceId ? { sourceEvidenceId } : {})
    }
  };
  setProgress({ ...identity, status: "finalizing" });
  const result = await activities.finalizeOrReconcilePaymentRequestIntent(request);
  if (
    paymentRecoveryResultIsAuthoritative(identity, result) &&
    result.status === "reconciliation_required"
  ) {
    setProgress(result);
    return result;
  }
  const failed = finalizeMismatch(identity, result.evidenceId);
  setProgress(failed);
  return failed;
}

function failureFinalization(
  failure: Cp13WorkflowFailure,
  identity: Cp13PaymentIntentIdentity,
  input: Cp13PaymentRequestRecoveryWorkflowInput,
  claimToken: string | null
): Cp13FinalizePaymentRequestRecoveryRequest {
  return {
    ...identity,
    claimToken,
    eventId: input.eventId,
    correlationId: input.correlationId,
    idempotencyKey: input.idempotencyKey,
    resolution: {
      status: "failed",
      failure
    }
  };
}

function finalizeMismatch(
  identity: Cp13PaymentIntentIdentity,
  evidenceId: string
): Cp13PaymentRequestRecoveryResult {
  return {
    ...identity,
    status: "failed",
    evidenceId,
    failure: {
      classification: "permanent",
      code: "PAYMENT_FINALIZE_RESULT_MISMATCH"
    }
  };
}

function paymentIdentity(
  input: Cp13PaymentRequestRecoveryWorkflowInput
): Cp13PaymentIntentIdentity {
  return {
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    actorUserId: input.actorUserId,
    patientId: input.patientId,
    invoiceId: input.invoiceId,
    durableIntentId: input.durableIntentId,
    intentDigest: input.intentDigest,
    requestType: input.requestType
  };
}
