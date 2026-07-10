import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  createPostgresClinicModuleUnitOfWork,
  type ClinicModuleTransactionContext,
  type PaymentRequestIntentRecord
} from "@clinic-os/db";
import { systemClock, type DomainEventType, type UUID } from "@clinic-os/domain";
import {
  PaymentProviderError,
  type PaymentProvider,
  type PaymentProviderRequestResult
} from "@clinic-os/integrations";
import type {
  Cp13ActivityPorts,
  Cp13ClaimedPaymentIntent,
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
} from "@clinic-os/workflow";

interface ActivityScope {
  readonly tenantId: UUID;
  readonly clinicId: UUID;
  readonly actorUserId: UUID;
}

export interface PostgresCp13ActivityPortsOptions {
  readonly pool: Pool;
  readonly paymentProvider: PaymentProvider;
  readonly workerId: string;
  readonly dueGenerationCursorSecret?: string;
  readonly now?: () => Date;
}

export function createPostgresCp13ActivityPorts(
  options: PostgresCp13ActivityPortsOptions
): Cp13ActivityPorts {
  const now = options.now ?? (() => systemClock.now());
  const unitOfWork = createPostgresClinicModuleUnitOfWork<ActivityScope>({
    client: options.pool,
    resolveScope: (scope) => scope,
    dueGenerationCursorSecret: options.dueGenerationCursorSecret
  });

  const run = <TRequest extends ActivityScope, TResult>(
    request: TRequest,
    callback: (context: ClinicModuleTransactionContext) => Promise<TResult>
  ) => unitOfWork.run(request, callback);

  const generateDueBatch = async (
    request: Cp13DueGenerationBatchRequest
  ): Promise<Cp13DueGenerationBatchResult> =>
    run(scopeFrom(request), async (context) => {
      const generated =
        request.generationKind === "continuity"
          ? await context.repositories.continuity.generateDueContinuityTasks({
              asOf: request.asOf,
              batchSize: request.batchSize,
              cursor: request.cursor
            })
          : await context.repositories.continuity.generateDueSopRuns({
              asOf: request.asOf,
              batchSize: request.batchSize,
              cursor: request.cursor
            });
      let ordinal = 0;
      let createdCount = 0;
      let skippedCount = 0;
      if ("recallsCreated" in generated) {
        for (const recall of generated.recallsCreated) {
          await appendEntityEvidence(context, request, {
            action: "recall.due",
            eventType: "recall.due",
            aggregateType: "recall",
            aggregateId: recall.id,
            patientId: recall.patientId,
            payload: { recallId: recall.id, patientId: recall.patientId, dueAt: recall.dueAt },
            ordinal: ordinal++
          });
        }
        for (const task of [...generated.recallTasksCreated, ...generated.followUpTasksCreated]) {
          await appendEntityEvidence(context, request, {
            action: "task.due",
            eventType: "task.due",
            aggregateType: "task",
            aggregateId: task.id,
            patientId: task.patientId,
            payload: {
              taskId: task.id,
              patientId: task.patientId,
              taskType: task.taskType,
              status: task.status,
              dueAt: task.dueAt
            },
            ordinal: ordinal++
          });
        }
        createdCount = countCp13DueGenerationCreatedCandidates(generated);
        skippedCount = generated.skippedExistingKeys.length;
      } else {
        for (const detail of generated.runsCreated) {
          await appendEntityEvidence(context, request, {
            action: "sop_run.created",
            eventType: "sop_run.created",
            aggregateType: "sop_run",
            aggregateId: detail.run.id,
            payload: {
              sopRunId: detail.run.id,
              scheduleId: detail.run.scheduleId,
              dueAt: detail.run.dueAt,
              status: detail.run.status
            },
            ordinal: ordinal++
          });
        }
        createdCount = generated.runsCreated.length;
        skippedCount = generated.skippedExistingKeys.length;
      }
      const evidenceId = await appendAudit(context, request, {
        action: "workflow.cp13.due_generation_batch_completed",
        category: "operations",
        riskLevel: "medium",
        phiInvolved: false,
        resourceType: "clinic",
        resourceId: request.clinicId,
        metadata: {
          generationKind: request.generationKind,
          processedCount: generated.processedCount,
          createdCount,
          skippedCount,
          complete: generated.complete
        }
      });
      return {
        processedCount: generated.processedCount,
        createdCount,
        skippedCount,
        complete: generated.complete,
        nextCursor: generated.nextCursor,
        evidenceId
      };
    });

  const claimPaymentRequestIntent = async (
    request: Cp13PaymentIntentClaimRequest
  ): Promise<Cp13PaymentIntentClaimResult> => {
    const claimToken = `temporal:${options.workerId}:${request.eventId}:${randomUUID()}`;
    const claimedAt = now().toISOString();
    return run(scopeFrom(request), async (context) => {
      const stored = await context.repositories.durableIntegrity?.findPaymentRequestIntentById(
        request.durableIntentId as UUID
      );
      if (!stored) {
        return {
          outcome: "reconciliation_required",
          reasonCode: "PAYMENT_INTENT_NOT_FOUND",
          evidenceId: request.durableIntentId
        };
      }
      const activeAccount =
        await context.repositories.durableIntegrity?.findActivePaymentProviderAccount({
          providerKey: stored.providerKey,
          requiredCapability: stored.requiredCapability
        });
      if (
        activeAccount?.outcome !== "resolved" ||
        activeAccount.account.externalAccountId !== stored.externalAccountId
      ) {
        return {
          outcome: "reconciliation_required",
          reasonCode: "PAYMENT_PROVIDER_ACCOUNT_UNAVAILABLE",
          evidenceId: stored.id
        };
      }
      const claimed = await context.repositories.durableIntegrity?.claimStoredPaymentRequestIntent({
        intentId: request.durableIntentId as UUID,
        requestDigest: request.intentDigest,
        leaseOwner: claimToken,
        leaseExpiresAt: new Date(new Date(claimedAt).getTime() + 120_000).toISOString(),
        requestedAt: claimedAt
      });
      if (!claimed) throw new Error("CP13 durable payment intent adapter is unavailable.");
      if (claimed.outcome === "in_progress") {
        throw new Error("CP13 payment request intent is still leased by another recovery attempt.");
      }
      if (claimed.outcome === "replayed" && claimed.intent) {
        const terminal = terminalPaymentResult(claimed.intent, request);
        return terminal
          ? { outcome: "already_terminal", result: terminal }
          : {
              outcome: "reconciliation_required",
              reasonCode: "PAYMENT_TERMINAL_RESULT_INVALID",
              evidenceId: claimed.intent.id
            };
      }
      if (claimed.outcome === "request_mismatch") {
        return {
          outcome: "reconciliation_required",
          reasonCode: "PAYMENT_INTENT_DIGEST_MISMATCH",
          evidenceId: claimed.intent?.id ?? request.durableIntentId
        };
      }
      if (claimed.outcome === "account_unavailable" || claimed.outcome === "not_found") {
        return {
          outcome: "reconciliation_required",
          reasonCode:
            claimed.outcome === "not_found"
              ? "PAYMENT_INTENT_NOT_FOUND"
              : "PAYMENT_PROVIDER_ACCOUNT_UNAVAILABLE",
          evidenceId: claimed.intent?.id ?? request.durableIntentId
        };
      }
      if (!claimed.intent) throw new Error("Claimed payment intent was not returned.");
      return {
        outcome: "claimed",
        intent: claimedPaymentIntent(claimed.intent, request, claimToken)
      };
    });
  };

  const createOrRecoverProviderPaymentRequest = async (
    request: Cp13ProviderPaymentRequestRecoveryRequest
  ): Promise<Cp13ProviderPaymentRequestRecoveryResult> => {
    if (options.paymentProvider.providerKey !== request.providerKey) {
      return {
        outcome: "ambiguous",
        reasonCode: "PAYMENT_PROVIDER_RUNTIME_MISMATCH",
        providerEvidenceId: request.durableIntentId
      };
    }
    let result: PaymentProviderRequestResult;
    try {
      const providerInput = {
        tenantId: request.tenantId,
        clinicId: request.clinicId,
        patientId: request.patientId,
        invoiceId: request.invoiceId,
        amountPaise: request.amountMinor,
        currency: request.currency,
        description: request.description,
        expiresAt: request.expiresAt,
        idempotencyKey: request.idempotencyKey,
        customer: request.customer,
        metadata: { ...request.metadata }
      };
      result =
        request.requestType === "invoice_qr"
          ? await options.paymentProvider.createInvoiceQr(providerInput)
          : await options.paymentProvider.createPaymentLink(providerInput);
    } catch (error) {
      if (
        error instanceof PaymentProviderError &&
        ["not_configured", "verification_failed"].includes(error.status)
      ) {
        return {
          outcome: "permanent_failure",
          failureCode: "PAYMENT_PROVIDER_NOT_CONFIGURED",
          providerEvidenceId: request.durableIntentId
        };
      }
      throw error;
    }
    const artifact = providerArtifact(result, request);
    if (!artifact) {
      return {
        outcome: "ambiguous",
        reasonCode: "PAYMENT_PROVIDER_RESULT_MISMATCH",
        providerEvidenceId: result.providerRequestId || request.durableIntentId
      };
    }
    return {
      outcome: "created_or_recovered",
      providerKey: request.providerKey,
      providerRequestId: result.providerRequestId,
      artifact,
      providerEvidenceId: result.providerRequestId
    };
  };

  const finalizeOrReconcilePaymentRequestIntent = async (
    request: Cp13FinalizePaymentRequestRecoveryRequest
  ): Promise<Cp13PaymentRequestRecoveryResult> =>
    run(scopeFrom(request), async (context) => {
      const durable = context.repositories.durableIntegrity;
      if (!durable) throw new Error("CP13 durable payment intent adapter is unavailable.");
      const existing = await durable.findPaymentRequestIntentById(request.durableIntentId as UUID);
      if (!existing) {
        const evidenceId = await appendAudit(context, request, {
          action: "workflow.cp13.payment_intent_missing",
          category: "integration",
          riskLevel: "high",
          phiInvolved: false,
          resourceType: "payment_request_intent",
          resourceId: request.durableIntentId,
          metadata: { reasonCode: "PAYMENT_INTENT_NOT_FOUND" },
          occurredAt: now().toISOString()
        });
        return paymentReconciliationResult(request, "PAYMENT_INTENT_NOT_FOUND", evidenceId);
      }
      if (existing.requestDigest !== request.intentDigest) {
        const evidenceId = randomUUID();
        const result = paymentReconciliationResult(
          request,
          "PAYMENT_INTENT_DIGEST_MISMATCH",
          evidenceId
        );
        await appendPaymentTerminalAudit(
          context,
          request,
          evidenceId,
          existing.patientId,
          result,
          now().toISOString()
        );
        return result;
      }
      const terminal = terminalPaymentResult(existing, request);
      if (existing.status !== "claimed" && terminal) return terminal;
      if (existing.status !== "claimed") {
        const evidenceId = randomUUID();
        const result = paymentReconciliationResult(
          request,
          existing.mismatchReason ?? "PAYMENT_TERMINAL_RESULT_INVALID",
          evidenceId
        );
        await appendPaymentTerminalAudit(
          context,
          request,
          evidenceId,
          existing.patientId,
          result,
          now().toISOString()
        );
        return result;
      }

      const claimToken =
        request.claimToken ??
        (await recoverFinalizationLease(durable, request, options.workerId, now)).claimToken;
      const evidenceId = randomUUID();
      let paymentRequestId: UUID | null = null;
      let providerArtifactReference: string | null = null;
      let result: Cp13PaymentRequestRecoveryResult;
      if (request.resolution.status === "requested") {
        const artifact = request.resolution.artifact;
        providerArtifactReference = request.resolution.providerRequestId;
        const paymentRequest = await context.repositories.billing.createPaymentRequest({
          invoiceId: existing.invoiceId,
          provider: existing.providerKey,
          requestType:
            existing.canonicalRequest.requestType === "invoice_qr" ? "dynamic_qr" : "payment_link",
          amountMinor: existing.canonicalRequest.amountMinor,
          currency: existing.canonicalRequest.currency === "INR" ? "INR" : undefined,
          providerReferenceId: request.resolution.providerRequestId,
          providerUrl: artifact.kind === "payment_link" ? artifact.paymentUrl : artifact.qrImageUrl,
          providerQrPayload:
            artifact.kind === "invoice_qr" ? (artifact.qrString ?? artifact.qrImageUrl) : null,
          expiresAt: existing.canonicalRequest.expiresAt,
          metadata: {
            cp13IntentId: existing.id,
            cp13IntentDigest: existing.requestDigest,
            providerEvidenceId: request.resolution.providerEvidenceId
          }
        });
        if (!paymentRequest) throw new Error("Payment request could not be persisted atomically.");
        paymentRequestId = paymentRequest.id;
        result = {
          ...paymentIdentity(request),
          status: "requested",
          evidenceId,
          providerKey: request.resolution.providerKey,
          providerRequestId: request.resolution.providerRequestId,
          artifact
        };
        await appendAudit(context, request, {
          id: evidenceId,
          action: "payment.requested",
          category: "billing",
          riskLevel: "medium",
          phiInvolved: true,
          resourceType: "payment_request",
          resourceId: paymentRequest.id,
          patientId: existing.patientId,
          metadata: {
            invoiceId: existing.invoiceId,
            paymentRequestId: paymentRequest.id,
            providerKey: existing.providerKey,
            amountMinor: existing.canonicalRequest.amountMinor,
            currency: existing.canonicalRequest.currency
          },
          occurredAt: now().toISOString()
        });
        await context.evidence.appendOutboxEvent({
          eventType: "payment.requested",
          aggregateType: "payment_request",
          aggregateId: paymentRequest.id,
          patientId: existing.patientId,
          idempotencyKey: `${request.idempotencyKey}:payment.requested:${paymentRequest.id}`,
          correlationId: request.correlationId,
          payload: {
            paymentRequestId: paymentRequest.id,
            invoiceId: existing.invoiceId,
            patientId: existing.patientId,
            provider: existing.providerKey,
            amountMinor: existing.canonicalRequest.amountMinor,
            currency: existing.canonicalRequest.currency,
            status: paymentRequest.status
          },
          occurredAt: now().toISOString()
        });
      } else if (request.resolution.status === "reconciliation_required") {
        result = paymentReconciliationResult(request, request.resolution.reasonCode, evidenceId);
        await appendPaymentTerminalAudit(
          context,
          request,
          evidenceId,
          existing.patientId,
          result,
          now().toISOString()
        );
      } else {
        result = {
          ...paymentIdentity(request),
          status: "failed",
          evidenceId,
          failure: request.resolution.failure
        };
        await appendPaymentTerminalAudit(
          context,
          request,
          evidenceId,
          existing.patientId,
          result,
          now().toISOString()
        );
      }
      const finalized = await durable.finalizePaymentRequestIntent({
        intentId: existing.id,
        leaseOwner: claimToken,
        requestDigest: existing.requestDigest,
        status:
          result.status === "requested"
            ? "completed"
            : result.status === "failed"
              ? "failed"
              : "reconciliation_required",
        paymentRequestId,
        providerArtifactReference,
        resultDigest: sha256Json(result),
        resultProjection: { ...result },
        processedAt: now().toISOString()
      });
      if (finalized.outcome !== "finalized" && finalized.outcome !== "replayed") {
        throw new Error(`Payment intent finalization failed with ${finalized.outcome}.`);
      }
      return result;
    });

  return {
    dueGeneration: {
      generateContinuityDueBatch: generateDueBatch,
      generateSopDueBatch: generateDueBatch,
      recordCp13DueGenerationTerminal: (result) =>
        run(scopeFrom(result), async (context) => {
          await appendAudit(context, result, {
            action:
              result.status === "completed"
                ? "workflow.cp13.due_generation_completed"
                : "workflow.cp13.due_generation_failed",
            category: "operations",
            riskLevel: result.status === "completed" ? "medium" : "high",
            phiInvolved: false,
            resourceType: "clinic",
            resourceId: result.clinicId,
            metadata: {
              generationKind: result.generationKind,
              processedCount: result.processedCount,
              createdCount: result.createdCount,
              skippedCount: result.skippedCount,
              status: result.status,
              failureCode: result.failure?.code ?? null
            }
          });
        })
    },
    patientInstruction: {
      requestPatientInstructionSend: (request) =>
        recordUnavailableInstruction(contextRunner(run), request),
      recordPatientInstructionSendTerminal: (result) =>
        run(scopeFrom(result), async (context) => {
          await appendAudit(context, result, {
            action:
              result.status === "requested"
                ? "workflow.cp13.instruction_send_requested"
                : "workflow.cp13.instruction_send_failed",
            category: "integration",
            riskLevel: result.status === "requested" ? "medium" : "high",
            phiInvolved: true,
            resourceType: "patient_instruction",
            resourceId: result.instructionId,
            patientId: result.patientId as UUID,
            metadata: {
              status: result.status,
              failureCode: result.status === "failed" ? result.failure.code : null
            }
          });
        })
    },
    paymentRequestRecovery: {
      claimPaymentRequestIntent,
      createOrRecoverProviderPaymentRequest,
      finalizeOrReconcilePaymentRequestIntent
    }
  };
}

export function countCp13DueGenerationCreatedCandidates(
  generated:
    | {
        readonly recallsCreated: readonly unknown[];
        readonly followUpTasksCreated: readonly unknown[];
      }
    | { readonly runsCreated: readonly unknown[] }
): number {
  if ("recallsCreated" in generated) {
    // A procedure/checkout candidate creates both a recall and its linked task. Workflow
    // progress counts candidate outcomes, not the number of durable entities emitted.
    return generated.recallsCreated.length + generated.followUpTasksCreated.length;
  }
  return generated.runsCreated.length;
}

function scopeFrom(input: {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly actorUserId: string;
}): ActivityScope {
  return {
    tenantId: input.tenantId as UUID,
    clinicId: input.clinicId as UUID,
    actorUserId: input.actorUserId as UUID
  };
}

function contextRunner(
  run: <TRequest extends ActivityScope, TResult>(
    request: TRequest,
    callback: (context: ClinicModuleTransactionContext) => Promise<TResult>
  ) => Promise<TResult>
) {
  return run;
}

async function recordUnavailableInstruction(
  run: ReturnType<typeof contextRunner>,
  request: Cp13PatientInstructionSendActivityRequest
): Promise<Cp13PatientInstructionSendActivityResult> {
  return run(scopeFrom(request), async (context) => {
    const evidenceId = await appendAudit(context, request, {
      action: "instruction.send_failed",
      category: "integration",
      riskLevel: "high",
      phiInvolved: true,
      resourceType: "patient_instruction",
      resourceId: request.instructionId,
      patientId: request.patientId as UUID,
      metadata: { failureCode: "INSTRUCTION_PROVIDER_NOT_ACTIVATED" }
    });
    return {
      outcome: "permanent_failure",
      failureCode: "INSTRUCTION_PROVIDER_NOT_ACTIVATED",
      requestEvidenceId: evidenceId
    };
  });
}

async function appendEntityEvidence(
  context: ClinicModuleTransactionContext,
  request: Cp13DueGenerationBatchRequest,
  input: {
    readonly action: string;
    readonly eventType: DomainEventType;
    readonly aggregateType: string;
    readonly aggregateId: UUID;
    readonly patientId?: UUID | null;
    readonly payload: Record<string, unknown>;
    readonly ordinal: number;
  }
): Promise<void> {
  const occurredAt = request.asOf;
  await appendAudit(context, request, {
    action: input.action,
    category: input.aggregateType === "sop_run" ? "operations" : "phi_access",
    riskLevel: "medium",
    phiInvolved: Boolean(input.patientId),
    resourceType: input.aggregateType,
    resourceId: input.aggregateId,
    patientId: input.patientId,
    metadata: input.payload,
    occurredAt
  });
  await context.evidence.appendOutboxEvent({
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    patientId: input.patientId,
    idempotencyKey: `${request.idempotencyKey}:${input.eventType}:${input.aggregateId}:${input.ordinal}`,
    correlationId: request.correlationId,
    payload: input.payload,
    occurredAt
  });
}

async function appendAudit(
  context: ClinicModuleTransactionContext,
  request: { readonly correlationId: string; readonly requestedAt?: string },
  input: {
    readonly id?: string;
    readonly action: string;
    readonly category: string;
    readonly riskLevel: string;
    readonly phiInvolved: boolean;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly patientId?: UUID | null;
    readonly metadata: Record<string, unknown>;
    readonly occurredAt?: string;
  }
): Promise<string> {
  const id = input.id ?? randomUUID();
  const occurredAt = input.occurredAt ?? request.requestedAt;
  if (!occurredAt) throw new Error("CP13 activity audit evidence requires an explicit instant.");
  await context.evidence.appendAuditEvent({
    id: id as UUID,
    action: input.action,
    category: input.category,
    riskLevel: input.riskLevel,
    phiInvolved: input.phiInvolved,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    patientId: input.patientId ?? null,
    metadata: input.metadata,
    ipAddress: null,
    userAgent: "clinic-os-temporal-worker",
    correlationId: request.correlationId,
    occurredAt
  });
  return id;
}

function claimedPaymentIntent(
  intent: PaymentRequestIntentRecord,
  request: Cp13PaymentIntentClaimRequest,
  claimToken: string
): Cp13ClaimedPaymentIntent {
  return {
    ...paymentIdentity(request),
    claimToken,
    providerKey: intent.providerKey,
    amountMinor: intent.canonicalRequest.amountMinor,
    currency: intent.canonicalRequest.currency,
    description: intent.canonicalRequest.description,
    expiresAt: intent.canonicalRequest.expiresAt,
    customer: intent.canonicalRequest.customer,
    metadata: intent.canonicalRequest.metadata
  };
}

function paymentIdentity(input: {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly actorUserId: string;
  readonly patientId: string;
  readonly invoiceId: string;
  readonly durableIntentId: string;
  readonly intentDigest: string;
  readonly requestType: "payment_link" | "invoice_qr";
}) {
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

function terminalPaymentResult(
  intent: PaymentRequestIntentRecord,
  expected: Parameters<typeof paymentIdentity>[0]
): Cp13PaymentRequestRecoveryResult | null {
  const candidate = intent.resultProjection;
  if (
    !candidate ||
    candidate.tenantId !== expected.tenantId ||
    candidate.clinicId !== expected.clinicId ||
    candidate.actorUserId !== expected.actorUserId ||
    candidate.patientId !== expected.patientId ||
    candidate.invoiceId !== expected.invoiceId ||
    candidate.durableIntentId !== expected.durableIntentId ||
    candidate.intentDigest !== expected.intentDigest ||
    candidate.requestType !== expected.requestType ||
    !["requested", "failed", "reconciliation_required"].includes(String(candidate.status)) ||
    typeof candidate.evidenceId !== "string"
  ) {
    return null;
  }
  return candidate as unknown as Cp13PaymentRequestRecoveryResult;
}

function providerArtifact(
  result: PaymentProviderRequestResult,
  request: Cp13ProviderPaymentRequestRecoveryRequest
): Cp13ProviderPaymentRequestRecoveryResult extends infer _T
  ? | { kind: "payment_link"; paymentUrl: string }
    | {
        kind: "invoice_qr";
        qrString: string | null;
        qrImageUrl: string | null;
      }
    | null
  : never {
  if (
    result.status !== "created" ||
    result.providerKey !== request.providerKey ||
    result.requestKind !== request.requestType ||
    result.amountPaise !== request.amountMinor ||
    result.currency !== request.currency ||
    result.providerRequestId.trim().length === 0
  ) {
    return null;
  }
  if (request.requestType === "payment_link") {
    return isHttpsUrl(result.paymentUrl)
      ? { kind: "payment_link", paymentUrl: result.paymentUrl }
      : null;
  }
  const qrString = nonEmpty(result.qrString) ? result.qrString : null;
  const qrImageUrl = isHttpsUrl(result.qrImageUrl) ? result.qrImageUrl : null;
  return qrString || qrImageUrl ? { kind: "invoice_qr", qrString, qrImageUrl } : null;
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isHttpsUrl(value: string | null | undefined): value is string {
  if (!nonEmpty(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

async function recoverFinalizationLease(
  durable: NonNullable<ClinicModuleTransactionContext["repositories"]["durableIntegrity"]>,
  request: Cp13FinalizePaymentRequestRecoveryRequest,
  workerId: string,
  now: () => Date
): Promise<{ claimToken: string }> {
  const claimToken = `temporal:${workerId}:${request.eventId}:${randomUUID()}`;
  const claimedAt = now().toISOString();
  const claimed = await durable.claimStoredPaymentRequestIntent({
    intentId: request.durableIntentId as UUID,
    requestDigest: request.intentDigest,
    leaseOwner: claimToken,
    leaseExpiresAt: new Date(new Date(claimedAt).getTime() + 120_000).toISOString(),
    requestedAt: claimedAt
  });
  if (claimed.outcome !== "claimed" && claimed.outcome !== "recovered") {
    throw new Error(`Payment intent finalization lease failed with ${claimed.outcome}.`);
  }
  return { claimToken };
}

function paymentReconciliationResult(
  request: Cp13FinalizePaymentRequestRecoveryRequest,
  reasonCode: string,
  evidenceId: string
): Cp13PaymentRequestRecoveryResult {
  return {
    ...paymentIdentity(request),
    status: "reconciliation_required",
    evidenceId,
    reconciliationReasonCode: reasonCode
  };
}

async function appendPaymentTerminalAudit(
  context: ClinicModuleTransactionContext,
  request: Cp13FinalizePaymentRequestRecoveryRequest,
  evidenceId: string,
  patientId: UUID,
  result: Cp13PaymentRequestRecoveryResult,
  occurredAt: string
): Promise<void> {
  await appendAudit(context, request, {
    id: evidenceId,
    action:
      result.status === "reconciliation_required"
        ? "payment.reconciliation_required"
        : "payment.failed",
    category: "billing",
    riskLevel: "high",
    phiInvolved: true,
    resourceType: "payment_request_intent",
    resourceId: request.durableIntentId,
    patientId,
    metadata: {
      invoiceId: request.invoiceId,
      status: result.status,
      reasonCode:
        result.status === "reconciliation_required"
          ? result.reconciliationReasonCode
          : result.status === "failed"
            ? result.failure.code
            : null
    },
    occurredAt
  });
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}
