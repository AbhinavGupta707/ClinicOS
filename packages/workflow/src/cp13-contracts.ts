export const CP13_WORKFLOW_SCHEMA_VERSION = "1.0" as const;
export const CP13_WORKFLOW_VERSION = 1 as const;

export const CP13_MAX_DUE_GENERATION_BATCH_SIZE = 25;
export const CP13_DUE_GENERATION_CONTINUE_AS_NEW_BATCH_THRESHOLD = 20;

export const CP13_DUE_GENERATION_VERSION_MARKER = "cp13-due-generation-v1";
export const CP13_INSTRUCTION_SEND_VERSION_MARKER = "cp13-instruction-send-v1";
export const CP13_PAYMENT_RECOVERY_VERSION_MARKER = "cp13-payment-recovery-v1";

export const CP13_ACTIVITY_RETRY_POLICY = {
  initialInterval: "5 seconds",
  backoffCoefficient: 2,
  maximumInterval: "5 minutes",
  maximumAttempts: 6
} as const;

export const CP13_EVIDENCE_ACTIVITY_RETRY_POLICY = {
  initialInterval: "2 seconds",
  backoffCoefficient: 2,
  maximumInterval: "1 minute",
  maximumAttempts: 10
} as const;

export const CP13_PERMANENT_ACTIVITY_FAILURE = "CP13_PERMANENT_ACTIVITY_FAILURE";

export type Cp13DueGenerationKind = "continuity" | "sop";

export interface Cp13WorkflowIdentity {
  readonly schemaVersion: typeof CP13_WORKFLOW_SCHEMA_VERSION;
  readonly workflowVersion: typeof CP13_WORKFLOW_VERSION;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly actorUserId: string;
  readonly eventId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
}

export interface Cp13DueGenerationContinuation {
  readonly cursor: string | null;
  readonly processedCount: number;
  readonly createdCount: number;
  readonly skippedCount: number;
  readonly batchCount: number;
  readonly continueAsNewCount: number;
}

export interface Cp13DueGenerationWorkflowInput extends Cp13WorkflowIdentity {
  readonly generationKind: Cp13DueGenerationKind;
  readonly asOf: string;
  readonly batchSize: number;
  /** Signed opaque repository cursor. Workflow code may only pass it back to an activity. */
  readonly cursor: string | null;
  /** Written only by workflow continue-as-new, never by an outbox producer. */
  readonly continuation?: Cp13DueGenerationContinuation;
}

export type Cp13DueGenerationStatus = "running" | "completed" | "failed";

export interface Cp13DueGenerationProgress {
  readonly generationKind: Cp13DueGenerationKind;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly actorUserId: string;
  readonly eventId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly asOf: string;
  readonly batchSize: number;
  readonly status: Cp13DueGenerationStatus;
  readonly cursor: string | null;
  readonly processedCount: number;
  readonly createdCount: number;
  readonly skippedCount: number;
  readonly batchCount: number;
  readonly continueAsNewCount: number;
  readonly failureClassification?: Cp13WorkflowFailure["classification"];
  readonly failureCode?: string;
}

export interface Cp13DueGenerationBatchRequest {
  readonly generationKind: Cp13DueGenerationKind;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly actorUserId: string;
  readonly eventId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly asOf: string;
  readonly batchSize: number;
  readonly cursor: string | null;
}

export interface Cp13DueGenerationBatchResult {
  readonly processedCount: number;
  readonly createdCount: number;
  readonly skippedCount: number;
  readonly complete: boolean;
  readonly nextCursor: string | null;
  readonly evidenceId: string;
}

export interface Cp13WorkflowFailure {
  readonly classification: "permanent" | "retry_exhausted";
  readonly code: string;
}

export interface Cp13DueGenerationWorkflowResult {
  readonly generationKind: Cp13DueGenerationKind;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly actorUserId: string;
  readonly eventId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
  readonly asOf: string;
  readonly status: "completed" | "failed";
  readonly processedCount: number;
  readonly createdCount: number;
  readonly skippedCount: number;
  readonly batchCount: number;
  readonly continueAsNewCount: number;
  readonly terminalCursor: string | null;
  readonly failure?: Cp13WorkflowFailure;
}

export interface Cp13PatientInstructionSendWorkflowInput extends Cp13WorkflowIdentity {
  readonly patientId: string;
  readonly instructionId: string;
}

export interface Cp13PatientInstructionSendActivityRequest {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly actorUserId: string;
  readonly patientId: string;
  readonly instructionId: string;
  readonly eventId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly requestedAt: string;
}

export type Cp13PatientInstructionSendActivityResult =
  | {
      readonly outcome: "requested";
      readonly providerSubmissionId: string;
      readonly requestEvidenceId: string;
    }
  | {
      readonly outcome: "permanent_failure";
      readonly failureCode: string;
      readonly requestEvidenceId: string;
    };

export type Cp13PatientInstructionSendWorkflowResult =
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
      readonly status: "requested";
      readonly providerSubmissionId: string;
      readonly requestEvidenceId: string;
    }
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
      readonly status: "failed";
      readonly failure: Cp13WorkflowFailure;
      readonly requestEvidenceId?: string;
    };

export type Cp13PaymentRequestType = "payment_link" | "invoice_qr";

export interface Cp13PaymentRequestRecoveryWorkflowInput extends Cp13WorkflowIdentity {
  readonly patientId: string;
  readonly invoiceId: string;
  readonly durableIntentId: string;
  readonly intentDigest: string;
  readonly intentStatus: "pending_provider_request";
  readonly requestType: Cp13PaymentRequestType;
}

export interface Cp13PaymentIntentIdentity {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly actorUserId: string;
  readonly patientId: string;
  readonly invoiceId: string;
  readonly durableIntentId: string;
  readonly intentDigest: string;
  readonly requestType: Cp13PaymentRequestType;
}

export interface Cp13PaymentIntentClaimRequest extends Cp13PaymentIntentIdentity {
  readonly eventId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export interface Cp13ClaimedPaymentIntent extends Cp13PaymentIntentIdentity {
  readonly claimToken: string;
  readonly providerKey: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly description: string | null;
  readonly expiresAt: string | null;
  readonly customer: Cp13PaymentProviderCustomer | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface Cp13PaymentProviderCustomer {
  readonly name?: string | null;
  readonly email?: string | null;
  readonly contact?: string | null;
}

export type Cp13PaymentRequestArtifact =
  | {
      readonly kind: "payment_link";
      readonly paymentUrl: string;
    }
  | {
      readonly kind: "invoice_qr";
      readonly qrString: string | null;
      readonly qrImageUrl: string | null;
    };

export type Cp13PaymentRequestRecoveryResult = Cp13PaymentIntentIdentity &
  (
    | {
        readonly status: "requested";
        readonly evidenceId: string;
        readonly providerKey: string;
        readonly providerRequestId: string;
        readonly artifact: Cp13PaymentRequestArtifact;
      }
    | {
        readonly status: "reconciliation_required";
        readonly evidenceId: string;
        readonly reconciliationReasonCode: string;
      }
    | {
        readonly status: "failed";
        readonly evidenceId: string;
        readonly failure: Cp13WorkflowFailure;
      }
  );

export type Cp13PaymentIntentClaimResult =
  | {
      readonly outcome: "claimed";
      readonly intent: Cp13ClaimedPaymentIntent;
    }
  | {
      readonly outcome: "already_terminal";
      readonly result: Cp13PaymentRequestRecoveryResult;
    }
  | {
      readonly outcome: "reconciliation_required";
      readonly reasonCode: string;
      readonly evidenceId: string;
    };

export interface Cp13ProviderPaymentRequestRecoveryRequest extends Cp13ClaimedPaymentIntent {
  readonly eventId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
}

export type Cp13ProviderPaymentRequestRecoveryResult =
  | {
      readonly outcome: "created_or_recovered";
      readonly providerKey: string;
      readonly providerRequestId: string;
      readonly artifact: Cp13PaymentRequestArtifact;
      readonly providerEvidenceId: string;
    }
  | {
      readonly outcome: "ambiguous";
      readonly reasonCode: string;
      readonly providerEvidenceId: string;
    }
  | {
      readonly outcome: "permanent_failure";
      readonly failureCode: string;
      readonly providerEvidenceId: string;
    };

export interface Cp13FinalizePaymentRequestRecoveryRequest extends Cp13PaymentIntentIdentity {
  readonly claimToken: string | null;
  readonly eventId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly resolution:
    | {
        readonly status: "requested";
        readonly providerKey: string;
        readonly providerRequestId: string;
        readonly artifact: Cp13PaymentRequestArtifact;
        readonly providerEvidenceId: string;
      }
    | {
        readonly status: "reconciliation_required";
        readonly reasonCode: string;
        readonly sourceEvidenceId?: string;
      }
    | {
        readonly status: "failed";
        readonly failure: Cp13WorkflowFailure;
        readonly sourceEvidenceId?: string;
      };
}
