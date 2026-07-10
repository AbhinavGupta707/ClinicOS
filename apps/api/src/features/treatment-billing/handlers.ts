import { randomUUID } from "node:crypto";
import { permissionsForScope } from "@clinic-os/auth";
import type { DomainEventType, PermissionKey, UUID } from "@clinic-os/domain";
import type {
  CreateInvoiceInput,
  CreatePaymentRequestInput,
  CreateProcedurePerformedInput,
  CreateReceiptInput,
  CreateTreatmentPlanInput,
  InvoiceDetail,
  PatientInstructionRecord,
  PaymentRequestRecord,
  PaymentTransactionRecord,
  PricebookProcedureRecord,
  ReceiptRecord,
  TreatmentPlanDetail,
  UpdateTreatmentPlanInput
} from "@clinic-os/domain";
import {
  PaymentProviderError,
  type PaymentProvider,
  type PaymentProviderRequestResult,
  type ProviderHealth
} from "@clinic-os/integrations";
import { createAuditEvent, type KnownAuditAction } from "@clinic-os/security";
import {
  assertCp13ManualPaymentEvidence,
  assertInstructionRemainsRequestEvidence,
  assertInvoiceCreationReferencesCompletedEvidence,
  normalizeCp13PaymentRequestType
} from "../../../../../packages/domain/src/cp13/treatment-billing/invariants.ts";
import { ApiError } from "../../errors.ts";
import type {
  ClinicFeatureExecutionContext,
  ClinicFeatureOperationHandler,
  ClinicFeatureOperationRequest
} from "../contracts.ts";
import { CP13_TREATMENT_BILLING_CLINIC_OPERATION_IDS } from "../cp13-operation-ownership.ts";

export type TreatmentBillingClinicOperationId =
  (typeof CP13_TREATMENT_BILLING_CLINIC_OPERATION_IDS)[number];

export type TreatmentBillingClinicHandler =
  ClinicFeatureOperationHandler<TreatmentBillingClinicOperationId>;

export type TreatmentBillingClinicHandlerMap = Readonly<
  Record<TreatmentBillingClinicOperationId, TreatmentBillingClinicHandler>
>;

export interface TreatmentBillingHandlerFactoryInput {
  readonly paymentProvider: PaymentProvider;
}

export function createTreatmentBillingHandlerMap(
  dependencies: TreatmentBillingHandlerFactoryInput
): TreatmentBillingClinicHandlerMap {
  const handlers = {
    listPricebookProcedures: handleListPricebookProcedures,
    createPatientTreatmentPlan: handleCreatePatientTreatmentPlan,
    updateTreatmentPlan: handleUpdateTreatmentPlan,
    acceptTreatmentPlan: handleAcceptTreatmentPlan,
    createEncounterProcedurePerformed: handleCreateEncounterProcedurePerformed,
    createInvoice: handleCreateInvoice,
    getInvoice: handleGetInvoice,
    createInvoiceReceipt: handleCreateInvoiceReceipt,
    createPatientInstruction: handleCreatePatientInstruction,
    createInvoicePaymentRequest: (request, context) =>
      handleCreateInvoicePaymentRequest(request, context, dependencies.paymentProvider),
    recordInvoiceManualPayment: handleRecordInvoiceManualPayment
  } satisfies Record<TreatmentBillingClinicOperationId, TreatmentBillingClinicHandler>;

  return Object.freeze(handlers);
}

async function handleListPricebookProcedures(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext
) {
  assertPermissions(request, ["billing.read"]);
  const procedures = await context.repositories.billing.listPricebookProcedures();
  await appendAudit(request, context, {
    action: "pricebook.procedure_catalog.viewed",
    resourceType: "pricebook_procedure",
    resourceId: request.access.clinicId,
    metadata: { procedureCount: procedures.length }
  });
  return ok({ procedures: procedures.map(publicPricebookProcedure) });
}

async function handleCreatePatientTreatmentPlan(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext
) {
  assertPermissions(request, ["patient.read", "patient.phi.read", "dental.chart.write"]);
  const patientId = pathUuid(request, "patientId");
  const input = parseCreateTreatmentPlan(requestBody(request));
  const result = await domainMutation(
    () => context.repositories.dentalTreatment.createTreatmentPlan(patientId, input),
    "Treatment plan could not be created from the supplied patient, encounter, and pricebook state."
  );
  if (!result) {
    throw notFound("Patient or encounter was not found for treatment plan creation.", {
      patient_id: patientId
    });
  }
  const plan = result.detail.treatmentPlan;
  await appendMutationEvidence(request, context, {
    action: "treatment_plan.created",
    resourceType: "treatment_plan",
    resourceId: plan.id,
    patientId: plan.patientId,
    metadata: treatmentPlanEvidence(result.detail),
    eventType: "treatment_plan.created",
    aggregateType: "treatment_plan",
    aggregateId: plan.id,
    payload: treatmentPlanEvidence(result.detail)
  });
  return created({ treatmentPlan: publicTreatmentPlan(result.detail) });
}

async function handleUpdateTreatmentPlan(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext
) {
  assertPermissions(request, ["patient.read", "patient.phi.read", "dental.chart.write"]);
  const treatmentPlanId = pathUuid(request, "treatmentPlanId");
  const result = await domainMutation(
    () =>
      context.repositories.dentalTreatment.updateTreatmentPlan(
        treatmentPlanId,
        parseUpdateTreatmentPlan(requestBody(request))
      ),
    "Treatment plan is not mutable from its current state."
  );
  if (!result)
    throw notFound("Treatment plan was not found.", { treatment_plan_id: treatmentPlanId });
  const plan = result.detail.treatmentPlan;
  await appendAudit(request, context, {
    action: "treatment_plan.updated",
    resourceType: "treatment_plan",
    resourceId: plan.id,
    patientId: plan.patientId,
    metadata: treatmentPlanEvidence(result.detail)
  });
  return ok({ treatmentPlan: publicTreatmentPlan(result.detail) });
}

async function handleAcceptTreatmentPlan(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext
) {
  assertPermissions(request, ["patient.read", "patient.phi.read", "dental.chart.write"]);
  const treatmentPlanId = pathUuid(request, "treatmentPlanId");
  const body = requestBody(request);
  const result = await domainMutation(
    () =>
      context.repositories.dentalTreatment.acceptTreatmentPlan(treatmentPlanId, {
        acceptedByName: nullableString(body.acceptedByName),
        acceptanceEvidence: recordValue(body.acceptanceEvidence)
      }),
    "Treatment plan cannot be accepted from its current state."
  );
  if (!result)
    throw notFound("Treatment plan was not found.", { treatment_plan_id: treatmentPlanId });
  const plan = result.detail.treatmentPlan;
  if (plan.status !== "accepted" || !plan.acceptedAt || !plan.acceptedByUserId) {
    throw new Error("Accepted treatment plan did not retain attributable acceptance evidence.");
  }
  await appendMutationEvidence(request, context, {
    action: "treatment_plan.accepted",
    resourceType: "treatment_plan",
    resourceId: plan.id,
    patientId: plan.patientId,
    metadata: treatmentPlanEvidence(result.detail),
    eventType: "treatment_plan.accepted",
    aggregateType: "treatment_plan",
    aggregateId: plan.id,
    payload: {
      ...treatmentPlanEvidence(result.detail),
      acceptedAt: plan.acceptedAt
    }
  });
  return ok({ treatmentPlan: publicTreatmentPlan(result.detail) });
}

async function handleCreateEncounterProcedurePerformed(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext
) {
  assertPermissions(request, ["patient.read", "patient.phi.read", "clinical.note.write"]);
  const encounterId = pathUuid(request, "encounterId");
  const input = parseCreateProcedure(requestBody(request));
  const result = await domainMutation(
    () => context.repositories.dentalTreatment.createProcedurePerformed(encounterId, input),
    "Completed procedure evidence requires an accepted, incomplete treatment plan item."
  );
  if (!result) {
    throw notFound("Encounter or accepted treatment plan item was not found.", {
      encounter_id: encounterId,
      treatment_plan_id: input.treatmentPlanId,
      treatment_plan_estimate_item_id: input.treatmentPlanEstimateItemId
    });
  }
  const procedure = result.procedure;
  if (procedure.status !== "completed" || procedure.invoiceId !== null) {
    throw new Error("Procedure completion did not preserve uninvoiced completed evidence.");
  }
  await appendMutationEvidence(request, context, {
    action: "procedure.completed",
    resourceType: "procedure_performed",
    resourceId: procedure.id,
    patientId: procedure.patientId,
    metadata: procedureEvidence(procedure),
    eventType: "procedure.completed",
    aggregateType: "procedure_performed",
    aggregateId: procedure.id,
    payload: procedureEvidence(procedure)
  });
  return created({
    procedure: publicProcedure(procedure),
    treatmentPlan: publicTreatmentPlan(result.treatmentPlan)
  });
}

async function handleCreateInvoice(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext
) {
  assertPermissions(request, ["billing.write"]);
  const input = parseCreateInvoice(requestBody(request));
  try {
    assertInvoiceCreationReferencesCompletedEvidence(input);
  } catch (error) {
    throw validationFrom(error);
  }
  const result = await domainMutation(
    () => context.repositories.billing.createInvoice(input),
    "Invoice requires completed, accepted, uninvoiced procedure evidence."
  );
  if (!result) {
    throw conflict("Invoice requires completed, accepted, uninvoiced procedure evidence.", {
      treatment_plan_id: input.treatmentPlanId ?? null,
      procedure_performed_ids: input.procedurePerformedIds ?? []
    });
  }
  const invoice = result.invoiceDetail.invoice;
  const invoicedProcedureIds = new Set(
    result.invoiceDetail.items.map((item) => item.procedurePerformedId)
  );
  if (
    result.procedures.some(
      (procedure) => procedure.status !== "completed" || !invoicedProcedureIds.has(procedure.id)
    )
  ) {
    throw new Error("Invoice did not retain completed procedure evidence atomically.");
  }
  await appendMutationEvidence(request, context, {
    action: "invoice.created",
    resourceType: "invoice",
    resourceId: invoice.id,
    patientId: invoice.patientId,
    metadata: invoiceEvidence(result.invoiceDetail),
    eventType: "invoice.created",
    aggregateType: "invoice",
    aggregateId: invoice.id,
    payload: {
      invoiceId: invoice.id,
      patientId: invoice.patientId,
      invoiceNumber: invoice.invoiceNumber,
      totalMinor: invoice.totalMinor,
      procedurePerformedIds: result.procedures.map((procedure) => procedure.id)
    }
  });
  return created({ invoice: publicInvoice(result.invoiceDetail) });
}

async function handleGetInvoice(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext
) {
  assertPermissions(request, ["billing.read"]);
  const invoiceId = pathUuid(request, "invoiceId");
  const invoice = await context.repositories.billing.findInvoiceById(invoiceId);
  if (!invoice) throw notFound("Invoice was not found.", { invoice_id: invoiceId });
  await appendAudit(request, context, {
    action: "invoice.viewed",
    resourceType: "invoice",
    resourceId: invoiceId,
    patientId: invoice.invoice.patientId,
    metadata: invoiceEvidence(invoice)
  });
  return ok({ invoice: publicInvoice(invoice) });
}

async function handleCreateInvoiceReceipt(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext
) {
  assertPermissions(request, ["billing.write"]);
  const invoiceId = pathUuid(request, "invoiceId");
  const body = requestBody(request);
  const input: CreateReceiptInput = {
    paymentTransactionIds: stringArray(body.paymentTransactionIds) as UUID[]
  };
  const result = await domainMutation(
    () => context.repositories.billing.createReceipt(invoiceId, input),
    "Receipt generation requires settled, verified, unreceipted payment evidence."
  );
  if (!result) throw notFound("Invoice was not found.", { invoice_id: invoiceId });
  await appendMutationEvidence(request, context, {
    action: "receipt.generated",
    resourceType: "receipt",
    resourceId: result.receipt.id,
    patientId: result.receipt.patientId,
    metadata: receiptEvidence(result.receipt),
    eventType: "receipt.generated",
    aggregateType: "receipt",
    aggregateId: result.receipt.id,
    payload: receiptEvidence(result.receipt)
  });
  return created({
    receipt: publicReceipt(result.receipt),
    invoice: publicInvoice(result.invoiceDetail)
  });
}

async function handleCreatePatientInstruction(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext
) {
  assertPermissions(request, ["patient.read", "patient_instruction.write"]);
  const patientId = pathUuid(request, "patientId");
  const body = requestBody(request);
  const channel = body.channel === "whatsapp" ? "whatsapp" : "print";
  const outboxEventId = channel === "whatsapp" ? (randomUUID() as UUID) : null;
  const instruction = await context.repositories.clinicalCare.createPatientInstruction(patientId, {
    channel,
    templateId: requiredString(body.templateId, "templateId"),
    title: nullableString(body.title),
    body: nullableString(body.body),
    outboxEventId
  });
  if (!instruction) throw notFound("Patient was not found.", { patient_id: patientId });
  assertInstructionRemainsRequestEvidence(instruction);
  const eventType =
    instruction.channel === "print" ? "instruction.print_requested" : "instruction.send_requested";
  const payload = instructionEvidence(instruction);
  await appendMutationEvidence(request, context, {
    action: eventType,
    resourceType: "patient_instruction",
    resourceId: instruction.id,
    patientId,
    metadata: payload,
    eventType,
    aggregateType: "patient_instruction",
    aggregateId: instruction.id,
    payload
  });
  const response = { instruction: publicInstruction(instruction) };
  return instruction.channel === "whatsapp" ? accepted(response) : created(response);
}

async function handleCreateInvoicePaymentRequest(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext,
  provider: PaymentProvider
) {
  assertPermissions(request, ["billing.write"]);
  const invoiceId = pathUuid(request, "invoiceId");
  const invoiceDetail = await context.repositories.billing.findInvoiceById(invoiceId);
  if (!invoiceDetail) throw notFound("Invoice was not found.", { invoice_id: invoiceId });
  const invoice = invoiceDetail.invoice;
  if (invoice.status !== "issued" || invoice.balanceMinor <= 0) {
    throw conflict("Invoice has no collectible balance for a new payment request.", {
      invoice_id: invoiceId,
      invoice_status: invoice.status,
      payment_status: invoice.paymentStatus
    });
  }
  const body = requestBody(request);
  const requestType = body.requestType === "invoice_qr" ? "invoice_qr" : "payment_link";
  const amountMinor = optionalPositiveInteger(body.amountMinor) ?? invoice.balanceMinor;
  if (amountMinor > invoice.balanceMinor) {
    throw conflict("Payment request amount cannot exceed the immutable invoice balance.", {
      invoice_id: invoiceId,
      balance_minor: invoice.balanceMinor,
      requested_amount_minor: amountMinor
    });
  }
  const health = await provider.healthCheck();
  const capability = requestType === "invoice_qr" ? "CREATE_PAYMENT_QR" : "CREATE_PAYMENT_LINKS";
  if (!health.capabilities.includes(capability)) {
    throw dependencyUnavailable("Payment provider is unavailable for this request type.", {
      provider_key: provider.providerKey,
      provider_status: health.status,
      required_capability: capability
    });
  }
  const providerInput = {
    tenantId: request.access.context.tenant.id,
    clinicId: request.access.clinicId,
    patientId: invoice.patientId,
    invoiceId,
    amountPaise: amountMinor,
    currency: invoice.currency,
    description: nullableString(body.description),
    expiresAt: nullableString(body.expiresAt),
    idempotencyKey: idempotencyKey(request),
    customer: nullableRecord(body.customer),
    metadata: recordValue(body.metadata)
  };
  let providerResult: PaymentProviderRequestResult;
  try {
    providerResult =
      requestType === "invoice_qr"
        ? await provider.createInvoiceQr(providerInput)
        : await provider.createPaymentLink(providerInput);
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      throw dependencyUnavailable("Payment provider request could not be completed.", {
        provider_key: error.providerKey,
        provider_status: error.status
      });
    }
    throw error;
  }
  assertProviderRequestResult(providerResult, {
    amountMinor,
    currency: invoice.currency,
    requestType
  });
  const repositoryInput: CreatePaymentRequestInput = {
    invoiceId,
    provider: billingProviderKey(providerResult.providerKey),
    requestType: normalizeCp13PaymentRequestType(requestType),
    amountMinor,
    currency: invoice.currency,
    providerReferenceId: providerResult.providerRequestId,
    providerUrl: providerResult.paymentUrl ?? null,
    providerQrPayload: providerResult.qrString ?? providerResult.qrImageUrl ?? null,
    expiresAt: providerResult.expiresAt ?? null,
    metadata: {
      providerStatus: providerResult.status,
      providerMetadata: providerResult.metadata,
      providerHealth: publicProviderHealth(providerResult.providerHealth)
    }
  };
  const paymentRequest = await domainMutation(
    () => context.repositories.billing.createPaymentRequest(repositoryInput),
    "Payment request could not be persisted for the current invoice state."
  );
  if (!paymentRequest) {
    throw conflict("Payment request could not be persisted for the current invoice state.", {
      invoice_id: invoiceId
    });
  }
  const updatedInvoice = await context.repositories.billing.findInvoiceById(invoiceId);
  if (!updatedInvoice) throw new Error("Invoice disappeared after payment request creation.");
  await appendMutationEvidence(request, context, {
    action: "payment.requested",
    resourceType: "payment_request",
    resourceId: paymentRequest.id,
    patientId: invoice.patientId,
    metadata: paymentRequestEvidence(paymentRequest),
    eventType: "payment.requested",
    aggregateType: "payment_request",
    aggregateId: paymentRequest.id,
    payload: paymentRequestEvidence(paymentRequest)
  });
  return created({
    invoice: publicInvoice(updatedInvoice),
    paymentRequest: publicPaymentRequest(paymentRequest),
    provider: publicProviderHealth(health)
  });
}

async function handleRecordInvoiceManualPayment(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext
) {
  assertPermissions(request, ["billing.write"]);
  const invoiceId = pathUuid(request, "invoiceId");
  const invoiceDetail = await context.repositories.billing.findInvoiceById(invoiceId);
  if (!invoiceDetail) throw notFound("Invoice was not found.", { invoice_id: invoiceId });
  const body = requestBody(request);
  const input = {
    amountMinor: requiredPositiveInteger(body.amountMinor, "amountMinor"),
    currency:
      body.currency === "INR" || body.currency === undefined ? "INR" : String(body.currency),
    method: requiredString(body.method, "method"),
    reason: requiredString(body.reason, "reason"),
    reference: requiredString(body.reference, "reference"),
    receivedAt: nullableString(body.receivedAt),
    evidence: recordValue(body.evidence)
  };
  try {
    assertCp13ManualPaymentEvidence(input);
  } catch (error) {
    throw validationFrom(error);
  }
  const key = idempotencyKey(request);
  const existing = invoiceDetail.payments.find(
    (payment) => payment.provider === "manual" && payment.idempotencyKey === key
  );
  if (existing) {
    return created({
      invoice: publicInvoice(invoiceDetail),
      transaction: publicPaymentTransaction(existing),
      reconciliationItem: null,
      replayed: true
    });
  }
  const invoice = invoiceDetail.invoice;
  if (invoice.status !== "issued") {
    throw conflict("Manual payment can only be recorded against an issued invoice.", {
      invoice_id: invoiceId,
      invoice_status: invoice.status
    });
  }
  if (input.amountMinor > invoice.balanceMinor) {
    throw conflict(
      "Manual payment cannot exceed the invoice balance; correct the evidence first.",
      {
        invoice_id: invoiceId,
        balance_minor: invoice.balanceMinor,
        received_amount_minor: input.amountMinor
      }
    );
  }
  const transaction = await context.repositories.billing.recordPaymentTransaction({
    invoiceId,
    provider: "manual",
    amountMinor: input.amountMinor,
    currency: "INR",
    method: input.method,
    status: "manually_recorded",
    verificationStatus: "not_required_manual",
    reconciliationStatus: "matched",
    idempotencyKey: key,
    receivedAt: input.receivedAt,
    recordedByUserId: request.access.context.user.id,
    metadata: {
      reason: input.reason,
      reference: input.reference,
      evidence: input.evidence
    }
  });
  if (!transaction) throw notFound("Invoice was not found.", { invoice_id: invoiceId });
  const updatedInvoice = await context.repositories.billing.findInvoiceById(invoiceId);
  if (!updatedInvoice) throw new Error("Invoice disappeared after manual payment recording.");
  await appendMutationEvidence(request, context, {
    action: "payment.manually_recorded",
    resourceType: "payment_transaction",
    resourceId: transaction.id,
    patientId: invoice.patientId,
    metadata: manualPaymentEvidence(transaction, input.reason, input.reference),
    eventType: "payment.manually_recorded",
    aggregateType: "payment_transaction",
    aggregateId: transaction.id,
    payload: manualPaymentEvidence(transaction, input.reason, input.reference)
  });
  return created({
    invoice: publicInvoice(updatedInvoice),
    transaction: publicPaymentTransaction(transaction),
    reconciliationItem: null,
    replayed: false
  });
}

function assertPermissions(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  required: readonly PermissionKey[]
): void {
  const activePermissions = permissionsForScope(
    request.access.context,
    request.access.context.tenant.id,
    request.access.clinicId
  );
  for (const permission of required) {
    if (!activePermissions.includes(permission)) {
      throw new ApiError(
        403,
        "PERMISSION_DENIED",
        "The verified identity is not authorized for this operation.",
        {
          reason: "missing_permission",
          required_permission: permission
        }
      );
    }
  }
}

async function appendMutationEvidence(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext,
  input: {
    readonly action: KnownAuditAction;
    readonly resourceType: string;
    readonly resourceId: UUID;
    readonly patientId: UUID;
    readonly metadata: Record<string, unknown>;
    readonly eventType: DomainEventType;
    readonly aggregateType: string;
    readonly aggregateId: UUID;
    readonly payload: Record<string, unknown>;
  }
): Promise<void> {
  const occurredAt = validNow(context).toISOString();
  await appendAudit(request, context, { ...input, occurredAt });
  await context.evidence.appendOutboxEvent({
    eventType: input.eventType,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    patientId: input.patientId,
    idempotencyKey: outboxIdempotencyKey(request),
    correlationId: request.metadata.requestId,
    payload: input.payload,
    occurredAt
  });
}

async function appendAudit(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  context: ClinicFeatureExecutionContext,
  input: {
    readonly action: KnownAuditAction;
    readonly resourceType: string;
    readonly resourceId: string;
    readonly patientId?: UUID;
    readonly metadata: Record<string, unknown>;
    readonly occurredAt?: string;
  }
): Promise<void> {
  const audit = createAuditEvent({
    tenantId: request.access.context.tenant.id,
    clinicId: request.access.clinicId,
    actor: { type: "user", id: request.access.context.user.id },
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    patientId: input.patientId,
    metadata: input.metadata,
    ipAddress: request.metadata.ipAddress,
    userAgent: request.metadata.userAgent,
    correlationId: request.metadata.requestId,
    occurredAt: input.occurredAt ? new Date(input.occurredAt) : validNow(context)
  });
  const {
    tenantId: _tenantId,
    clinicId: _clinicId,
    actorType: _actorType,
    actorId: _actorId,
    ...event
  } = audit;
  await context.evidence.appendAuditEvent(event);
}

function parseCreateTreatmentPlan(body: JsonRecord): CreateTreatmentPlanInput {
  return {
    encounterId: nullableUuid(body.encounterId),
    title: requiredString(body.title, "title"),
    clinicalSummary: nullableString(body.clinicalSummary),
    status:
      body.status === undefined
        ? undefined
        : body.status === "presented" || body.status === "draft"
          ? body.status
          : invalidTreatmentPlanStatus(),
    phases: parseTreatmentPlanPhases(body.phases)
  };
}

function parseUpdateTreatmentPlan(body: JsonRecord): UpdateTreatmentPlanInput {
  return {
    title: body.title === undefined ? undefined : requiredString(body.title, "title"),
    clinicalSummary:
      body.clinicalSummary === undefined ? undefined : nullableString(body.clinicalSummary),
    status:
      body.status === undefined
        ? undefined
        : body.status === "draft" ||
            body.status === "presented" ||
            body.status === "declined" ||
            body.status === "deferred" ||
            body.status === "cancelled"
          ? body.status
          : invalidTreatmentPlanStatus(),
    phases: body.phases === undefined ? undefined : parseTreatmentPlanPhases(body.phases)
  };
}

function parseTreatmentPlanPhases(value: unknown): CreateTreatmentPlanInput["phases"] {
  return arrayValue(value, "phases").map((phaseValue) => {
    const phase = objectValue(phaseValue, "phase");
    return {
      title: requiredString(phase.title, "phase.title"),
      description: nullableString(phase.description),
      estimatedStartAfterDays: nullableInteger(phase.estimatedStartAfterDays),
      items: arrayValue(phase.items, "phase.items").map((itemValue) => {
        const item = objectValue(itemValue, "phase.item");
        return {
          pricebookProcedureId: requiredUuid(item.pricebookProcedureId, "pricebookProcedureId"),
          dentalFindingId: nullableUuid(item.dentalFindingId),
          toothNumber: nullableString(item.toothNumber),
          quantity: optionalPositiveInteger(item.quantity),
          estimatedVisits: optionalPositiveInteger(item.estimatedVisits),
          priority: nullableString(item.priority),
          notes: nullableString(item.notes)
        };
      })
    };
  });
}

function invalidTreatmentPlanStatus(): never {
  throw new ApiError(400, "VALIDATION_ERROR", "Treatment plan status is invalid.", {
    field: "status"
  });
}

function parseCreateProcedure(body: JsonRecord): CreateProcedurePerformedInput {
  return {
    treatmentPlanId: requiredUuid(body.treatmentPlanId, "treatmentPlanId"),
    treatmentPlanEstimateItemId: requiredUuid(
      body.treatmentPlanEstimateItemId,
      "treatmentPlanEstimateItemId"
    ),
    performedAt: nullableString(body.performedAt),
    notes: nullableString(body.notes),
    outcome: nullableString(body.outcome),
    provenance: recordValue(body.provenance)
  };
}

function parseCreateInvoice(body: JsonRecord): CreateInvoiceInput {
  return {
    patientId: nullableUuid(body.patientId),
    treatmentPlanId: nullableUuid(body.treatmentPlanId),
    procedurePerformedIds: stringArray(body.procedurePerformedIds) as UUID[],
    dueAt: nullableString(body.dueAt)
  };
}

function requestBody(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>
): JsonRecord {
  return objectValue(request.parsed.body ?? {}, "body");
}

function pathUuid(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>,
  key: string
): UUID {
  return requiredUuid(objectValue(request.parsed.path, "path")[key], key);
}

function idempotencyKey(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>
): string {
  const headers = objectValue(request.parsed.headers, "headers");
  return requiredString(headers["idempotency-key"], "idempotency-key");
}

function outboxIdempotencyKey(
  request: ClinicFeatureOperationRequest<TreatmentBillingClinicOperationId>
): string | null {
  const headers = objectValue(request.parsed.headers, "headers");
  const key = headers["idempotency-key"];
  return typeof key === "string" ? `cp13:${request.operationId}:${key}` : null;
}

function validNow(context: ClinicFeatureExecutionContext): Date {
  const value = context.clock.now();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Treatment billing clock returned an invalid instant.");
  }
  return value;
}

async function domainMutation<TResult>(
  operation: () => Promise<TResult>,
  safeMessage: string
): Promise<TResult> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && isExpectedWorkflowInvariant(error.message)) {
      throw conflict(safeMessage, { reason: "invalid_workflow_state" });
    }
    throw error;
  }
}

function isExpectedWorkflowInvariant(message: string): boolean {
  return [
    /treatment plan/iu,
    /accepted.*plan item/iu,
    /already completed/iu,
    /invoice procedures/iu,
    /invoice balance/iu,
    /payment request amount/iu,
    /receipt generation/iu,
    /settled.*payment evidence/iu,
    /pricebook procedure/iu
  ].some((pattern) => pattern.test(message));
}

function assertProviderRequestResult(
  result: PaymentProviderRequestResult,
  expected: {
    readonly amountMinor: number;
    readonly currency: string;
    readonly requestType: "payment_link" | "invoice_qr";
  }
): void {
  const expectedKind = expected.requestType;
  if (
    result.status !== "created" ||
    result.amountPaise !== expected.amountMinor ||
    result.currency !== expected.currency ||
    result.requestKind !== expectedKind ||
    result.providerRequestId.trim().length === 0
  ) {
    throw dependencyUnavailable("Payment provider returned an inconsistent request result.", {
      provider_key: result.providerKey,
      reason: "provider_result_mismatch"
    });
  }
}

function billingProviderKey(value: string): "razorpay" | "simulator" {
  if (value === "razorpay" || value === "simulator") return value;
  throw dependencyUnavailable("Unsupported payment provider result.", {
    provider_key: value
  });
}

function publicProviderHealth(health: ProviderHealth) {
  return {
    key: health.providerKey,
    status: health.status,
    checkedAt: health.checkedAt,
    capabilities: [...health.capabilities]
  };
}

function publicPricebookProcedure(procedure: PricebookProcedureRecord) {
  return {
    id: procedure.id,
    code: procedure.code,
    displayName: procedure.displayName,
    category: procedure.category,
    description: procedure.description,
    defaultUnitPriceMinor: procedure.defaultUnitPriceMinor,
    currency: procedure.currency,
    taxRateBasisPoints: procedure.taxRateBasisPoints,
    status: procedure.status
  };
}

function publicTreatmentPlan(detail: TreatmentPlanDetail) {
  return {
    ...detail.treatmentPlan,
    phases: detail.phases.map((phase) => ({
      ...phase,
      estimateItems: phase.estimateItems.map((item) => ({ ...item }))
    }))
  };
}

function publicProcedure<T extends { provenance: Record<string, unknown> }>(procedure: T) {
  const { provenance: _provenance, ...publicRecord } = procedure;
  return publicRecord;
}

function publicInvoice(detail: InvoiceDetail) {
  return {
    ...detail.invoice,
    items: detail.items.map(({ tenantId: _tenantId, clinicId: _clinicId, ...item }) => item),
    paymentRequests: detail.paymentRequests.map(publicPaymentRequest),
    payments: detail.payments.map(publicPaymentTransaction),
    receipts: detail.receipts.map(publicReceipt)
  };
}

function publicPaymentRequest(request: PaymentRequestRecord) {
  return {
    id: request.id,
    invoiceId: request.invoiceId,
    patientId: request.patientId,
    provider: request.provider,
    requestType: request.requestType,
    status: request.status,
    amountMinor: request.amountMinor,
    currency: request.currency,
    providerReferenceId: request.providerReferenceId,
    providerUrl: request.providerUrl,
    providerQrPayload: request.providerQrPayload,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt
  };
}

function publicPaymentTransaction(payment: PaymentTransactionRecord) {
  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    patientId: payment.patientId,
    paymentRequestId: payment.paymentRequestId,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    providerOrderId: payment.providerOrderId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    verificationStatus: payment.verificationStatus,
    reconciliationStatus: payment.reconciliationStatus,
    receivedAt: payment.receivedAt,
    receiptId: payment.receiptId,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt
  };
}

function publicInstruction(instruction: PatientInstructionRecord) {
  return {
    id: instruction.id,
    patientId: instruction.patientId,
    channel: instruction.channel,
    templateId: instruction.templateId,
    title: instruction.title,
    body: instruction.body,
    status: instruction.status,
    renderedAt: instruction.renderedAt,
    printJobId: instruction.printJobId,
    outboxEventId: instruction.outboxEventId,
    providerConfirmationReceived: false,
    providerDeliveryConfirmedAt: null,
    deliveredAt: null,
    readAt: null,
    createdAt: instruction.createdAt
  };
}

function publicReceipt(receipt: ReceiptRecord) {
  return {
    id: receipt.id,
    invoiceId: receipt.invoiceId,
    patientId: receipt.patientId,
    receiptNumber: receipt.receiptNumber,
    status: receipt.status,
    amountMinor: receipt.amountMinor,
    currency: receipt.currency,
    paymentAllocations: receipt.paymentAllocations,
    generatedAt: receipt.generatedAt
  };
}

function treatmentPlanEvidence(detail: TreatmentPlanDetail) {
  return {
    treatmentPlanId: detail.treatmentPlan.id,
    patientId: detail.treatmentPlan.patientId,
    status: detail.treatmentPlan.status,
    totalMinor: detail.treatmentPlan.totalMinor,
    itemCount: detail.phases.reduce((count, phase) => count + phase.estimateItems.length, 0)
  };
}

function procedureEvidence(procedure: {
  id: UUID;
  patientId: UUID;
  encounterId: UUID;
  treatmentPlanId: UUID;
  treatmentPlanEstimateItemId: UUID;
  totalMinor: number;
}) {
  return {
    procedurePerformedId: procedure.id,
    patientId: procedure.patientId,
    encounterId: procedure.encounterId,
    treatmentPlanId: procedure.treatmentPlanId,
    treatmentPlanEstimateItemId: procedure.treatmentPlanEstimateItemId,
    totalMinor: procedure.totalMinor
  };
}

function invoiceEvidence(detail: InvoiceDetail) {
  return {
    invoiceId: detail.invoice.id,
    patientId: detail.invoice.patientId,
    invoiceNumber: detail.invoice.invoiceNumber,
    status: detail.invoice.status,
    paymentStatus: detail.invoice.paymentStatus,
    totalMinor: detail.invoice.totalMinor,
    paidMinor: detail.invoice.paidMinor,
    balanceMinor: detail.invoice.balanceMinor,
    itemCount: detail.items.length
  };
}

function receiptEvidence(receipt: ReceiptRecord) {
  return {
    receiptId: receipt.id,
    invoiceId: receipt.invoiceId,
    patientId: receipt.patientId,
    receiptNumber: receipt.receiptNumber,
    amountMinor: receipt.amountMinor,
    paymentTransactionIds: receipt.paymentAllocations.map(
      (allocation) => allocation.paymentTransactionId
    )
  };
}

function instructionEvidence(instruction: PatientInstructionRecord) {
  return {
    instructionId: instruction.id,
    patientId: instruction.patientId,
    templateId: instruction.templateId,
    channel: instruction.channel,
    status: instruction.status,
    printJobId: instruction.printJobId,
    outboxEventId: instruction.outboxEventId,
    providerConfirmationReceived: false,
    providerDeliveryConfirmedAt: null,
    deliveredAt: null,
    readAt: null
  };
}

function paymentRequestEvidence(request: PaymentRequestRecord) {
  return {
    invoiceId: request.invoiceId,
    patientId: request.patientId,
    paymentRequestId: request.id,
    providerKey: request.provider,
    requestType: request.requestType,
    amountMinor: request.amountMinor,
    status: request.status
  };
}

function manualPaymentEvidence(
  transaction: PaymentTransactionRecord,
  reason: string,
  reference: string
) {
  return {
    invoiceId: transaction.invoiceId,
    patientId: transaction.patientId,
    paymentTransactionId: transaction.id,
    amountMinor: transaction.amountMinor,
    method: transaction.method,
    reason,
    reference,
    paymentStatus: transaction.status
  };
}

type JsonRecord = Record<string, unknown>;

function objectValue(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Uint8Array) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be an object.`, { field });
  }
  return value as JsonRecord;
}

function arrayValue(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be an array.`, { field });
  }
  return value;
}

function recordValue(value: unknown): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  return { ...objectValue(value, "record") };
}

function nullableRecord(value: unknown): Record<string, unknown> | null {
  return value === undefined || value === null ? null : recordValue(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a non-empty string.`, { field });
  }
  return value.trim();
}

function nullableString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ApiError(400, "VALIDATION_ERROR", "Expected a string or null value.");
  }
  return value.trim() || null;
}

function requiredUuid(value: unknown, field: string): UUID {
  const parsed = requiredString(value, field);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(parsed)) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a UUID.`, { field });
  }
  return parsed as UUID;
}

function nullableUuid(value: unknown): UUID | null {
  return value === undefined || value === null ? null : requiredUuid(value, "uuid");
}

function stringArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return arrayValue(value, "array").map((item) => requiredString(item, "array item"));
}

function requiredPositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ApiError(400, "VALIDATION_ERROR", `${field} must be a positive safe integer.`, {
      field
    });
  }
  return value as number;
}

function optionalPositiveInteger(value: unknown): number | undefined {
  return value === undefined || value === null
    ? undefined
    : requiredPositiveInteger(value, "positive integer");
}

function nullableInteger(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ApiError(400, "VALIDATION_ERROR", "Expected a non-negative safe integer.");
  }
  return value as number;
}

function ok(body: unknown) {
  return { status: 200, body };
}

function created(body: unknown) {
  return { status: 201, body };
}

function accepted(body: unknown) {
  return { status: 202, body };
}

function notFound(message: string, details: Record<string, unknown> = {}) {
  return new ApiError(404, "NOT_FOUND", message, details);
}

function conflict(message: string, details: Record<string, unknown> = {}) {
  return new ApiError(409, "CONFLICT", message, details);
}

function dependencyUnavailable(message: string, details: Record<string, unknown> = {}) {
  return new ApiError(503, "DEPENDENCY_UNAVAILABLE", message, details);
}

function validationFrom(error: unknown) {
  return new ApiError(
    400,
    "VALIDATION_ERROR",
    error instanceof Error ? error.message : "Treatment billing input failed validation."
  );
}
