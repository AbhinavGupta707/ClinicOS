import { createHash, randomUUID } from "node:crypto";
import {
  assertAuthorized,
  roleSlugsForScope,
  type AccessContext,
  type AuthorizationRequest
} from "@clinic-os/auth";
import type { ClinicOsConfig } from "@clinic-os/config";
import type {
  ClinicOperationsRepository,
  CreateAppointmentInput,
  CreateAuditReviewInput,
  CreateBreakGlassAccessInput,
  CreateDeletionRequestInput,
  CreateAiActionProposalInput,
  CreateAiDraftOutputInput,
  CreateAiSourceAnchorInput,
  CreateConsentInput,
  CreateCorrectiveActionInput,
  CreateDentalChartSnapshotInput,
  CreateEncounterInput,
  CreateInventoryCategoryInput,
  CreateInventoryCheckRunInput,
  CreateInventoryCheckTemplateInput,
  CreateInventoryItemInput,
  CreateIncidentInput,
  CreateInvoiceInput,
  CreateIntakeFormSubmissionInput,
  CreateIntakeFormTemplateInput,
  CreateLabCaseInput,
  CreateLabReconciliationInput,
  CreateLabVendorInput,
  CreateLeadInput,
  CreateMigrationBatchInput,
  CreatePatientInput,
  CreatePatientInstructionInput,
  CreateProcedurePerformedInput,
  CreatePrescriptionInput,
  CreateRecallRuleInput,
  CreateReceiptInput,
  CreateSopScheduleInput,
  CreateSopTemplateInput,
  CreateTaskInput,
  CreateStockLedgerEntryInput,
  CreateTreatmentPlanInput,
  GenerateDueContinuityInput,
  GenerateDueSopRunsInput,
  PatientRecordExportInput,
  ProviderOperationsRegistryPort,
  ProviderRegistrationHealthRecord,
  RecordRecallActionInput,
  RepositoryScope,
  ResolveMigrationRowInput,
  RecordAiReviewDecisionInput,
  ReviewBreakGlassAccessInput,
  ReviewDeletionRequestInput,
  RunRetentionJobInput,
  SopRunSearchFilter,
  TaskSearchFilter,
  UpdateCorrectiveActionInput,
  UpdateDentalFindingRepositoryInput,
  UpdateInventoryCheckRunInput,
  UpdateLabCaseStatusInput,
  UpdateSopRunInput,
  UpdateTaskInput,
  UpdateTreatmentPlanInput
} from "@clinic-os/db";
import {
  assertAppointmentTransition,
  assertEncounterTransition,
  defaultAiRetentionPolicy,
  evaluateAiAudioReadiness,
  assertMediaMimeType,
  assertManualPaymentEvidence,
  assertPrescriptionMedicationList,
  assertBreakGlassRequestPolicy,
  assertLeadTransition,
  assertPatientCreateMinimum,
  assertRetentionRunPolicy,
  applyPaymentToInvoice,
  buildCp10PilotReadinessPlan,
  buildOwnerDashboardProjection,
  buildMorningDashboard,
  buildPatientDuplicateSuggestions,
  calculateBillingLineTotals,
  calculateEndAt,
  correctiveActionEffectiveStatus,
  hasClinicalNoteContent,
  isAppointmentStatus,
  isAiReviewDecision,
  isAiSourceAnchorType,
  isAuditReviewStatus,
  isBillingCurrency,
  isBreakGlassAccessCategory,
  isConsentCaptureMethod,
  isConsentPurpose,
  isDeletionRequestType,
  isDentalFindingReviewStatus,
  isDentalFindingSource,
  isDentalFindingStatus,
  isDentalFindingType,
  isEncounterStatus,
  isIntakeFormType,
  isIntakeSubmissionSource,
  isCorrectiveActionStatus,
  isCorrectiveActionType,
  isIncidentCategory,
  isIncidentSeverity,
  isIncidentStatus,
  isInventoryCategoryKind,
  isInventoryCheckRunStatus,
  isLabCaseStatus,
  isLabReconciliationEntryStatus,
  isLabReconciliationStatus,
  isPatientInstructionChannel,
  coercePatientImportRows,
  duplicateCandidatesForPatientImport,
  isMigrationImportType,
  isMigrationResolutionAction,
  isRecallActionType,
  isRecallRuleAnchor,
  isRecallStatus,
  isMediaScanStatus,
  isMediaType,
  isSopRecurrenceType,
  isSopRunItemStatus,
  isSopRunStatus,
  isTaskPriority,
  isTaskSourceWorkflow,
  isTaskStatus,
  isTaskType,
  isTreatmentPlanStatus,
  isManualPaymentMethod,
  isRetentionJobMode,
  isValidLeadStatus,
  mediaAssetCanBeViewed,
  normalizePatientRecordExportSections,
  isUuid,
  toPublicMediaAsset,
  toPublicMediaUploadReservation,
  parsePatientMigrationCsv,
  summarizeMigrationBatchState,
  validatePatientImportRow,
  type AppointmentRecord,
  type AppointmentStatus,
  type AuditEventForReviewRecord,
  type AiSessionDetail,
  type AiSessionRecord,
  type ClinicalNoteContent,
  type ConsentCaptureMethod,
  type ConsentPurpose,
  type CreateDentalFindingInput,
  type Cp10PilotReadinessInput,
  type DentalChartSnapshotFinding,
  type DomainEventType,
  type EncounterStatus,
  type IntakeFormType,
  type IntakeSubmissionSource,
  type InvoiceDetail,
  type IntegrationDeadLetterRecord,
  type IntegrationDeadLetterStatus,
  type LeadIntent,
  type LeadSource,
  type LeadStatus,
  type LabCaseStatus,
  type MediaScanStatus,
  type MediaType,
  type ManualPaymentMethod,
  type MigrationBatchDetail,
  type MigrationBatchState,
  type MigrationRowRecord,
  type PaymentProviderKey as BillingPaymentProviderKey,
  type PaymentRequestRecord,
  type PaymentRequestType,
  type PaymentTransactionRecord,
  type PatientRecordExportRecord,
  type PatientTimelineItem as DomainPatientTimelineItem,
  type PatientInstructionRecord,
  type PatientRecordExportSnapshot,
  type PatientSource,
  type PricebookProcedureRecord,
  type PrescriptionMedication,
  type QueueStatus,
  type Clock,
  type RecallRecord,
  type SopRunDetail,
  type SopScheduleRecord,
  type SopTemplateDetail,
  type TaskRecord,
  type TreatmentPlanDetail,
  type UUID
} from "@clinic-os/domain";
import { systemClock } from "@clinic-os/domain";
import {
  createMessagingProvider,
  createAiGatewayProvider,
  AiGatewayProviderError,
  PaymentProviderError,
  createTelephonyProvider,
  type AiGatewayProvider,
  type AdapterCapability,
  type PaymentProvider,
  type PaymentProviderRequestKind,
  type PaymentProviderRequestResult,
  type PaymentProviderWebhookEvent,
  type ProviderHealth,
  type RawPaymentWebhook
} from "@clinic-os/integrations";
import {
  createAuditEvent,
  redactPhi,
  type AuditEventRecord,
  type KnownAuditAction
} from "@clinic-os/security";
import { ApiError } from "./errors.ts";
import type { MediaStorageProvider } from "./media-storage.ts";

export interface OperationsRequestContext {
  requestId: string;
  accessContext: AccessContext;
  clinicId: UUID;
  clinicTimeZone?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
}

export interface OperationsDependencies {
  repository: ClinicOperationsRepository;
  clock?: Clock;
  auditSink?: {
    appendAuditEvent(event: AuditEventRecord): Promise<void>;
  };
  mediaStorage?: MediaStorageProvider;
  paymentProvider?: PaymentProvider;
  paymentRepository?: PaymentOperationsRepository;
  runtimeConfig?: ClinicOsConfig;
  aiGatewayProvider?: AiGatewayProvider;
  providerOperationsRegistry?: ProviderOperationsRegistryPort;
}

const SYSTEM_INTEGRATION_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000000" as UUID;

export interface ApiSuccess<T> {
  status: number;
  body: T;
}

export type ApiPaymentState =
  | "payment_requested"
  | "qr_created"
  | "link_created"
  | "partially_paid"
  | "paid"
  | "failed"
  | "reconciliation_required"
  | "manually_recorded";

export interface PaymentRouteInvoiceRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  invoiceNumber: string;
  paymentState: ApiPaymentState;
  totalAmountPaise: number;
  amountPaidPaise: number;
  amountDuePaise: number;
  currency: string;
  updatedAt: string;
}

export interface PaymentRouteRequestRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  invoiceId: UUID;
  requestType: PaymentProviderRequestKind;
  status: "created" | "sent" | "failed" | "cancelled" | "expired";
  providerKey: string;
  providerRequestId: string;
  amountPaise: number;
  currency: string;
  paymentUrl: string | null;
  qrImageUrl: string | null;
  qrString: string | null;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PaymentRouteTransactionRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  invoiceId: UUID;
  source: "provider_webhook" | "manual";
  status: "succeeded" | "failed" | "ignored_duplicate" | "reconciliation_required";
  providerKey: string | null;
  providerPaymentId: string | null;
  providerEventId: string | null;
  idempotencyKey: string;
  amountPaise: number;
  appliedAmountPaise: number;
  currency: string;
  method: string | null;
  recordedByUserId: UUID | null;
  auditReason: string | null;
  reference: string | null;
  receivedAt: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface PaymentRouteReconciliationItemRecord {
  id: UUID;
  tenantId: UUID | null;
  clinicId: UUID | null;
  patientId: UUID | null;
  invoiceId: UUID | null;
  providerKey: string | null;
  providerPaymentId: string | null;
  providerEventId: string | null;
  reason:
    | "overpayment"
    | "duplicate_provider_transaction"
    | "missing_invoice_reference"
    | "currency_mismatch"
    | "provider_failure"
    | "manual_review_required";
  amountPaise: number;
  currency: string | null;
  status: "open" | "resolved";
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface PaymentWebhookReceiptRecord {
  id: UUID;
  providerKey: string;
  providerEventId: string | null;
  receivedAt: string;
  status: "received" | "verified" | "rejected" | "processed";
  rawBodySha256: string;
}

export interface PaymentProviderWebhookApplicationResult {
  status: "processed" | "duplicate" | "ignored" | "reconciliation_required";
  invoice: PaymentRouteInvoiceRecord | null;
  transaction: PaymentRouteTransactionRecord | null;
  reconciliationItem: PaymentRouteReconciliationItemRecord | null;
  replayed: boolean;
}

export interface PaymentOperationsRepository {
  findPaymentInvoiceById(
    scope: RepositoryScope,
    invoiceId: UUID
  ): Promise<PaymentRouteInvoiceRecord | null>;
  createPaymentRequestFromProvider(
    scope: RepositoryScope,
    input: {
      invoice: PaymentRouteInvoiceRecord;
      providerResult: PaymentProviderRequestResult;
      createdByUserId: UUID;
    }
  ): Promise<{ invoice: PaymentRouteInvoiceRecord; paymentRequest: PaymentRouteRequestRecord }>;
  recordManualPayment(
    scope: RepositoryScope,
    input: {
      invoice: PaymentRouteInvoiceRecord;
      amountPaise: number;
      currency: string;
      method: ManualPaymentMethod;
      reason: string;
      reference: string;
      receivedAt: string;
      idempotencyKey: string;
      evidence: Record<string, unknown>;
    }
  ): Promise<{
    invoice: PaymentRouteInvoiceRecord;
    transaction: PaymentRouteTransactionRecord;
    reconciliationItem: PaymentRouteReconciliationItemRecord | null;
    replayed: boolean;
  }>;
  recordPaymentWebhookReceipt(input: {
    providerKey: string;
    providerEventId: string | null;
    receivedAt: string;
    headers: Record<string, string | undefined>;
    rawBody: string;
  }): Promise<PaymentWebhookReceiptRecord>;
  markPaymentWebhookReceiptRejected(
    receiptId: UUID,
    input: { reason: string; providerEventId?: string | null }
  ): Promise<void>;
  applyPaymentProviderWebhook(
    event: PaymentProviderWebhookEvent,
    input: { receiptId: UUID }
  ): Promise<PaymentProviderWebhookApplicationResult>;
}

const LEAD_INTENTS = new Set<LeadIntent>([
  "appointment_request",
  "pricing_query",
  "followup",
  "emergency",
  "lab_vendor",
  "unknown"
]);
const LEAD_SOURCES = new Set<LeadSource>([
  "manual",
  "whatsapp",
  "phone",
  "call",
  "walkin",
  "practo",
  "google",
  "website",
  "instagram",
  "referral",
  "recall_campaign"
]);
const PATIENT_SOURCES = new Set<PatientSource>([...LEAD_SOURCES, "imported", "external_system"]);
const QUEUE_STATUSES = new Set<QueueStatus>([
  "waiting",
  "called",
  "in_consult",
  "completed",
  "cancelled"
]);

const DOCTOR_ONLY_SIGNATURE_PERMISSIONS = new Set([
  "clinical.note.sign",
  "prescription.sign"
] as const);

export async function listPatients(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: { query?: string | null; phone?: string | null; source?: string | null }
) {
  authorize(context, { permission: "patient.read" });
  const patients = await dependencies.repository.listPatients(scopeFrom(context), {
    query: filter.query,
    phone: filter.phone,
    source: filter.source ? parsePatientSource(filter.source) : null
  });

  return ok({ patients });
}

export async function createPatient(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "patient.write" });
  const input = parseCreatePatient(body);
  assertPatientCreateMinimum(input);

  const scope = scopeFrom(context);
  const sourceLead = input.leadId
    ? await dependencies.repository.findLeadById(scope, input.leadId)
    : null;

  if (input.leadId && !sourceLead) {
    throw notFound("Source lead not found.", { lead_id: input.leadId });
  }

  if (sourceLead) {
    if (sourceLead.patientId) {
      throw validation("Source lead is already matched to a patient.", {
        lead_id: sourceLead.id,
        patient_id: sourceLead.patientId
      });
    }
    assertLeadTransition(sourceLead.status, "matched");
  }

  const duplicateRecords = await dependencies.repository.findPatientDuplicateCandidates(scope, {
    fullName: input.fullName,
    phone: input.phone
  });
  const duplicateSuggestions = buildPatientDuplicateSuggestions(
    { fullName: input.fullName, phone: input.phone },
    duplicateRecords
  );
  const patient = await dependencies.repository.createPatient(scope, input);
  const attributionSource = toLeadSource(input.source);

  if (attributionSource) {
    await dependencies.repository.createAttributionTouch(scope, {
      patientId: patient.id,
      leadId: sourceLead?.id ?? null,
      source: attributionSource,
      touchType: "first_touch",
      occurredAt: nowIso(dependencies),
      metadata: input.sourceDetail ?? {}
    });
  }

  await audit(context, dependencies, "patient.record.created", {
    patientId: patient.id,
    resourceType: "patient",
    resourceId: patient.id,
    metadata: { source: input.source, duplicateSuggestionCount: duplicateSuggestions.length }
  });
  await appendOutbox(context, dependencies, {
    eventType: "patient.created",
    aggregateType: "patient",
    aggregateId: patient.id,
    patientId: patient.id,
    payload: { patientId: patient.id, source: patient.source }
  });

  const matchedLead = sourceLead
    ? await dependencies.repository.matchLeadToPatient(scope, sourceLead.id, patient.id)
    : null;

  if (sourceLead && !matchedLead) {
    throw notFound("Source lead not found after patient creation.", { lead_id: sourceLead.id });
  }

  if (matchedLead) {
    await audit(context, dependencies, "lead.matched_to_patient", {
      patientId: patient.id,
      resourceType: "lead",
      resourceId: matchedLead.id,
      metadata: { source: matchedLead.source, createdPatient: true }
    });
    await appendOutbox(context, dependencies, {
      eventType: "lead.matched_to_patient",
      aggregateType: "lead",
      aggregateId: matchedLead.id,
      patientId: patient.id,
      payload: { leadId: matchedLead.id, patientId: patient.id, createdPatient: true }
    });
  }

  if (duplicateSuggestions.length > 0) {
    await appendOutbox(context, dependencies, {
      eventType: "patient.duplicate_detected",
      aggregateType: "patient",
      aggregateId: patient.id,
      patientId: patient.id,
      payload: { patientId: patient.id, suggestions: duplicateSuggestions }
    });
  }

  return created({ patient, duplicateSuggestions, matchedLead });
}

export async function getPatient(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  const patient = await dependencies.repository.findPatientById(scopeFrom(context), patientId);

  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  await audit(context, dependencies, "patient.record.viewed", {
    patientId: patient.id,
    resourceType: "patient",
    resourceId: patient.id
  });

  return ok({ patient });
}

export async function updatePatient(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.write" });
  const input = objectBody(body);
  const patient = await dependencies.repository.updatePatient(scopeFrom(context), patientId, {
    fullName: optionalString(input.fullName, "fullName"),
    phone: optionalNullableString(input.phone, "phone"),
    email: optionalNullableString(input.email, "email"),
    dateOfBirth: optionalNullableString(input.dateOfBirth, "dateOfBirth"),
    gender: input.gender === undefined ? undefined : parseGender(input.gender)
  });

  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  await audit(context, dependencies, "patient.record.updated", {
    patientId: patient.id,
    resourceType: "patient",
    resourceId: patient.id
  });
  await appendOutbox(context, dependencies, {
    eventType: "patient.updated",
    aggregateType: "patient",
    aggregateId: patient.id,
    patientId: patient.id,
    payload: { patientId: patient.id }
  });

  return ok({ patient });
}

export async function listAuditReviewEvents(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: {
    patientId?: string | null;
    action?: string | null;
    category?: string | null;
    riskLevel?: string | null;
    limit?: string | null;
  }
) {
  authorize(context, { permission: "audit.read" });
  const auditEvents = await dependencies.repository.listAuditEvents(scopeFrom(context), {
    patientId: filter.patientId ? uuidField(filter.patientId, "patientId") : null,
    action: filter.action,
    category: parseOptionalAuditCategory(filter.category),
    riskLevel: parseOptionalAuditRiskLevel(filter.riskLevel),
    limit: parseOptionalLimit(filter.limit, 50, 100)
  });

  return ok({ auditEvents: auditEvents.map(publicAuditEventForReview) });
}

export async function reviewAuditEvent(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  auditEventId: UUID,
  body: unknown
) {
  authorize(context, { permission: "audit.review" });
  const input = parseAuditReviewInput(body);
  const review = await dependencies.repository.createAuditReview(
    scopeFrom(context),
    auditEventId,
    input
  );
  if (!review) throw notFound("Audit event not found.", { audit_event_id: auditEventId });

  await audit(context, dependencies, "audit_event.reviewed", {
    resourceType: "audit_event",
    resourceId: auditEventId,
    metadata: {
      reviewStatus: review.reviewStatus,
      disposition: review.disposition
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "audit_event.reviewed",
    aggregateType: "audit_event",
    aggregateId: auditEventId,
    payload: {
      auditEventId,
      reviewId: review.id,
      reviewStatus: review.reviewStatus
    }
  });

  return created({ review });
}

export async function createPatientRecordExport(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "patient.export" });
  const input = parsePatientRecordExportInput(patientId, body);
  const snapshot = await dependencies.repository.buildPatientRecordExportSnapshot(
    scopeFrom(context),
    patientId,
    input.sections
  );
  if (!snapshot) throw notFound("Patient not found.", { patient_id: patientId });

  const safeSnapshot = sanitizePatientRecordExportSnapshot(snapshot);
  const payloadDigest = createHash("sha256").update(JSON.stringify(safeSnapshot)).digest("hex");
  const exportRecord = await dependencies.repository.createPatientRecordExport(scopeFrom(context), {
    ...input,
    snapshot: safeSnapshot,
    payloadDigest
  });

  await audit(context, dependencies, "patient.record.export_requested", {
    patientId,
    resourceType: "data_export",
    resourceId: exportRecord.id,
    metadata: {
      reason: input.reason,
      sections: input.sections,
      format: input.format
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "patient.record_export.requested",
    aggregateType: "data_export",
    aggregateId: exportRecord.id,
    patientId,
    payload: {
      exportId: exportRecord.id,
      patientId,
      sections: input.sections,
      format: input.format
    }
  });
  await audit(context, dependencies, "patient.record.exported", {
    patientId,
    resourceType: "data_export",
    resourceId: exportRecord.id,
    metadata: {
      sections: input.sections,
      payloadDigest,
      safety: safeSnapshot.manifest.safety
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "patient.record_export.completed",
    aggregateType: "data_export",
    aggregateId: exportRecord.id,
    patientId,
    payload: {
      exportId: exportRecord.id,
      patientId,
      sections: input.sections,
      payloadDigest,
      safety: safeSnapshot.manifest.safety
    }
  });

  return created({ export: publicPatientRecordExport(exportRecord, { includePayload: true }) });
}

export async function listPatientRecordExports(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  filter: { status?: string | null; limit?: string | null }
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.export" });
  const patient = await dependencies.repository.findPatientById(scopeFrom(context), patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const exports = await dependencies.repository.listPatientRecordExports(scopeFrom(context), {
    patientId,
    status: parseOptionalDataExportStatus(filter.status),
    limit: parseOptionalLimit(filter.limit, 25, 100)
  });
  return ok({ exports: exports.map((record) => publicPatientRecordExport(record)) });
}

export async function createDeletionRequest(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "privacy.request" });
  const input = parseCreateDeletionRequest(body);
  const request = await dependencies.repository.createDeletionRequest(scopeFrom(context), input);
  if (!request) throw notFound("Patient not found.", { patient_id: input.patientId });

  await audit(context, dependencies, "deletion.request.created", {
    patientId: request.patientId,
    resourceType: "deletion_request",
    resourceId: request.id,
    metadata: {
      requestType: request.requestType,
      requestedCategories: request.scope.requestedCategories,
      protectedClinicalRecords: request.scope.protectedClinicalRecords,
      protectedAuditRecords: request.scope.protectedAuditRecords
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "deletion_request.created",
    aggregateType: "deletion_request",
    aggregateId: request.id,
    patientId: request.patientId,
    payload: {
      deletionRequestId: request.id,
      patientId: request.patientId,
      requestType: request.requestType,
      status: request.status
    }
  });

  return created({ deletionRequest: request });
}

export async function listDeletionRequests(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: { patientId?: string | null; status?: string | null; limit?: string | null }
) {
  authorize(context, { permission: "retention.manage" });
  const requests = await dependencies.repository.listDeletionRequests(scopeFrom(context), {
    patientId: filter.patientId ? uuidField(filter.patientId, "patientId") : null,
    status: parseOptionalDeletionRequestStatus(filter.status),
    limit: parseOptionalLimit(filter.limit, 50, 100)
  });
  return ok({ deletionRequests: requests });
}

export async function reviewDeletionRequest(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  requestId: UUID,
  body: unknown
) {
  authorize(context, { permission: "retention.manage" });
  const input = parseReviewDeletionRequest(body);
  const request = await dependencies.repository.reviewDeletionRequest(
    scopeFrom(context),
    requestId,
    input
  );
  if (!request) throw notFound("Deletion request not found.", { deletion_request_id: requestId });

  await audit(context, dependencies, "deletion.request.reviewed", {
    patientId: request.patientId,
    resourceType: "deletion_request",
    resourceId: request.id,
    metadata: {
      decision: input.decision,
      status: request.status,
      protectedClinicalRecords: request.scope.protectedClinicalRecords,
      protectedAuditRecords: request.scope.protectedAuditRecords
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "deletion_request.reviewed",
    aggregateType: "deletion_request",
    aggregateId: request.id,
    patientId: request.patientId,
    payload: {
      deletionRequestId: request.id,
      patientId: request.patientId,
      status: request.status,
      decision: input.decision
    }
  });

  return ok({ deletionRequest: request });
}

export async function runRetentionJob(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "retention.manage" });
  const input = parseRunRetentionJob(body, nowIso(dependencies));
  const scope = scopeFrom(context);
  const deletionRequest = input.deletionRequestId
    ? await dependencies.repository.findDeletionRequestById(scope, input.deletionRequestId)
    : null;
  if (input.deletionRequestId && !deletionRequest) {
    throw notFound("Deletion request not found.", { deletion_request_id: input.deletionRequestId });
  }
  if (deletionRequest && deletionRequest.status !== "approved_pending_retention_job") {
    throw conflict("Retention jobs require an approved deletion request.", {
      deletion_request_id: deletionRequest.id,
      status: deletionRequest.status
    });
  }
  if (deletionRequest && input.patientId && deletionRequest.patientId !== input.patientId) {
    throw validation("Retention job patientId must match the approved deletion request.", {
      deletion_request_id: deletionRequest.id,
      request_patient_id: deletionRequest.patientId,
      patient_id: input.patientId
    });
  }
  const runInput =
    deletionRequest && !input.patientId
      ? { ...input, patientId: deletionRequest.patientId }
      : input;
  const result = await dependencies.repository.runRetentionJob(scope, runInput);

  await audit(context, dependencies, "retention.job.completed", {
    resourceType: "retention_job_run",
    resourceId: result.run.id,
    metadata: {
      mode: result.run.mode,
      policyCode: result.run.policyCode,
      deletionRequestId: result.run.deletionRequestId,
      summary: result.run.summary,
      protectedActions: result.actions
        .filter((action) => action.protectedRecord)
        .map((action) => ({
          actionKind: action.actionKind,
          targetType: action.targetType,
          status: action.status
        }))
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "retention.run.completed",
    aggregateType: "retention_run",
    aggregateId: result.run.id,
    patientId: runInput.patientId ?? undefined,
    payload: {
      runId: result.run.id,
      mode: result.run.mode,
      policyCode: result.run.policyCode,
      summary: result.run.summary
    }
  });

  return accepted({ retentionRun: result.run, actions: result.actions });
}

export async function createBreakGlassAccessRequest(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "break_glass.request" });
  const input = parseCreateBreakGlassAccessRequest(body);
  const access = await dependencies.repository.createBreakGlassAccessRequest(
    scopeFrom(context),
    input
  );
  if (!access) throw notFound("Patient not found.", { patient_id: input.patientId });

  await audit(context, dependencies, "break_glass.requested", {
    patientId: access.patientId,
    resourceType: "break_glass_access",
    resourceId: access.id,
    metadata: {
      reason: access.reason,
      expiresAt: access.expiresAt,
      accessCategories: access.accessCategories,
      status: access.status
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "break_glass.requested",
    aggregateType: "break_glass_access",
    aggregateId: access.id,
    patientId: access.patientId,
    payload: {
      breakGlassAccessId: access.id,
      patientId: access.patientId,
      expiresAt: access.expiresAt,
      accessCategories: access.accessCategories,
      status: access.status
    }
  });

  return created({ breakGlassAccess: access });
}

export async function listBreakGlassAccessRequests(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: {
    patientId?: string | null;
    status?: string | null;
    requestedByUserId?: string | null;
    limit?: string | null;
  }
) {
  authorize(context, { permission: "break_glass.approve" });
  const accesses = await dependencies.repository.listBreakGlassAccessRequests(scopeFrom(context), {
    patientId: filter.patientId ? uuidField(filter.patientId, "patientId") : null,
    status: parseOptionalBreakGlassStatus(filter.status),
    requestedByUserId: filter.requestedByUserId
      ? uuidField(filter.requestedByUserId, "requestedByUserId")
      : null,
    limit: parseOptionalLimit(filter.limit, 50, 100)
  });
  return ok({ breakGlassAccesses: accesses });
}

export async function reviewBreakGlassAccessRequest(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  requestId: UUID,
  body: unknown
) {
  authorize(context, { permission: "break_glass.approve" });
  const input = parseReviewBreakGlassAccessRequest(body);
  const access = await dependencies.repository.reviewBreakGlassAccessRequest(
    scopeFrom(context),
    requestId,
    input
  );
  if (!access)
    throw notFound("Break-glass access request not found.", { break_glass_access_id: requestId });

  const action: KnownAuditAction =
    input.decision === "approve"
      ? "break_glass.approved"
      : input.decision === "revoke"
        ? "break_glass.revoked"
        : "break_glass.denied";
  await audit(context, dependencies, action, {
    patientId: access.patientId,
    resourceType: "break_glass_access",
    resourceId: access.id,
    metadata: {
      decision: input.decision,
      status: access.status,
      expiresAt: access.expiresAt,
      accessCategories: access.accessCategories
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "break_glass.reviewed",
    aggregateType: "break_glass_access",
    aggregateId: access.id,
    patientId: access.patientId,
    payload: {
      breakGlassAccessId: access.id,
      patientId: access.patientId,
      decision: input.decision,
      status: access.status,
      expiresAt: access.expiresAt
    }
  });

  return ok({ breakGlassAccess: access });
}

export async function createMigrationBatch(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "migration.manage" });
  const scope = scopeFrom(context);
  const input = await parseCreateMigrationBatchInput(scope, dependencies, body);
  const detail = await dependencies.repository.createMigrationBatch(scope, input);

  await audit(context, dependencies, "migration.batch.created", {
    resourceType: "migration_batch",
    resourceId: detail.batch.id,
    metadata: {
      importType: detail.batch.importType,
      rowCount: detail.batch.rowCount,
      invalidRowCount: detail.batch.invalidRowCount,
      conflictRowCount: detail.batch.conflictRowCount
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "migration.batch.created",
    aggregateType: "migration_batch",
    aggregateId: detail.batch.id,
    payload: {
      batchId: detail.batch.id,
      importType: detail.batch.importType,
      state: detail.batch.state,
      rowCount: detail.batch.rowCount,
      invalidRowCount: detail.batch.invalidRowCount,
      conflictRowCount: detail.batch.conflictRowCount
    }
  });

  return created(toMigrationBatchResponse(detail));
}

export async function getMigrationBatch(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  batchId: UUID
) {
  authorize(context, { permission: "migration.manage" });
  const detail = await dependencies.repository.findMigrationBatchById(scopeFrom(context), batchId);
  if (!detail) throw notFound("Migration batch not found.", { batch_id: batchId });
  return ok(toMigrationBatchResponse(detail));
}

export async function listProviderHealth(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "migration.manage" });
  const config = runtimeConfigFrom(dependencies);
  if (dependencies.providerOperationsRegistry) {
    const registrations = await dependencies.providerOperationsRegistry.list({
      tenantId: context.accessContext.tenant.id,
      clinicId: context.clinicId,
      actorUserId: context.accessContext.user.id
    });
    return ok({
      providers: [
        ...officialProviderCards(registrations, nowIso(dependencies)),
        manualProviderCard({
          checkedAt: nowIso(dependencies),
          activationChecks: [
            "No official telephony provider has been selected or registered.",
            "Manual missed-call capture remains the only enabled path.",
            "No telephony credentials, callbacks, recordings or provider state are implied."
          ],
          category: "telephony",
          evidence: "Telephony is deliberately disabled pending owner provider selection.",
          id: "telephony-disabled",
          label: "Telephony",
          mode: "disabled",
          providerKey: "exotel",
          status: "not_configured"
        }),
        manualProviderCard({
          checkedAt: nowIso(dependencies),
          activationChecks: [
            "Google Business Profile is manual source attribution only.",
            "No Google API read/write dependency is active."
          ],
          category: "source",
          evidence: "Google is manual/source only; no live profile API dependency is active.",
          id: "google-business",
          label: "Google Business Profile",
          mode: "manual/source only",
          providerKey: "google_business_profile",
          status: "not_configured"
        }),
        manualProviderCard({
          checkedAt: nowIso(dependencies),
          activationChecks: [
            "Clinic-approved import batches use durable migration review routes.",
            "Verified ClinicOS records are never overwritten silently."
          ],
          category: "migration",
          evidence: "Manual import review is available through migration batch routes.",
          id: "manual-import",
          label: "Manual import",
          mode: "durable migration review",
          providerKey: "manual_import",
          status: "available"
        })
      ]
    });
  }
  const [messagingHealth, paymentHealth, telephonyHealth] = await Promise.all([
    createRuntimeMessagingProvider(config).healthCheck(),
    paymentProviderFrom(dependencies).healthCheck(),
    createRuntimeTelephonyProvider(config).healthCheck()
  ]);

  return ok({
    providers: [
      providerCardFromHealth({
        activationChecks: whatsappActivationChecks(config, messagingHealth),
        category: "messaging",
        health: messagingHealth,
        id: "whatsapp-cloud",
        label: "WhatsApp Cloud",
        mode: whatsappProviderMode(config, messagingHealth),
        providerKey: "whatsapp_cloud"
      }),
      providerCardFromHealth({
        activationChecks: razorpayActivationChecks(config, paymentHealth),
        category: "payments",
        health: paymentHealth,
        id: "razorpay",
        label: "Razorpay",
        mode: razorpayProviderMode(config, paymentHealth),
        providerKey: "razorpay"
      }),
      providerCardFromHealth({
        activationChecks: telephonyActivationChecks(config, telephonyHealth),
        category: "telephony",
        health: telephonyHealth,
        id: "telephony-exotel",
        label: "Telephony",
        mode: telephonyProviderMode(config, telephonyHealth),
        providerKey: "exotel"
      }),
      manualProviderCard({
        checkedAt: nowIso(dependencies),
        activationChecks: [
          "Google Business Profile OAuth/account variables are not configured in CP7.",
          "Manual source attribution remains ClinicOS-owned and auditable.",
          "No Google API read/write dependency is active."
        ],
        category: "source",
        evidence: "Google is manual/source only; no live profile API dependency is active.",
        id: "google-business",
        label: "Google Business Profile",
        mode: "manual/source only",
        providerKey: "google_business_profile",
        status: "not_configured"
      }),
      manualProviderCard({
        checkedAt: nowIso(dependencies),
        activationChecks: [
          "Clinic-approved import batches use durable migration review routes.",
          "Rows are marked imported/unverified until review.",
          "Verified ClinicOS records are never overwritten silently."
        ],
        category: "migration",
        evidence: "Manual import review is available through migration batch routes.",
        id: "manual-import",
        label: "Manual import",
        mode: "durable migration review",
        providerKey: "manual_import",
        status: "available"
      })
    ]
  });
}

export async function getPilotReadiness(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "clinic.manage" });
  const config = runtimeConfigFrom(dependencies);
  const readinessInput: Cp10PilotReadinessInput = {
    clinicId: context.clinicId,
    clinicName: "Configured ClinicOS clinic",
    environment: config.clinicOsEnv,
    productionLike: config.isProductionLike,
    syntheticDataOnly: config.pilotInputs.syntheticDataOnly,
    tenantId: context.accessContext.tenant.id,
    pilotInputs: {
      appointmentExportPath: config.pilotInputs.appointmentExportPath,
      patientExportPath: config.pilotInputs.patientExportPath,
      pricebookPath: config.pilotInputs.pricebookPath,
      templatesDir: config.pilotInputs.templatesDir,
      xraySampleDir: config.pilotInputs.xraySampleDir
    },
    providers: {
      whatsapp: {
        credentialsPresent: Boolean(
          config.providers.whatsapp.accessToken &&
          config.providers.whatsapp.appId &&
          config.providers.whatsapp.appSecret &&
          config.providers.whatsapp.businessAccountId &&
          config.providers.whatsapp.phoneNumberId &&
          config.providers.whatsapp.webhookVerifyToken
        ),
        provider: config.providers.whatsapp.provider,
        signedWebhookConfigured: false
      },
      payment: {
        credentialsPresent: Boolean(
          config.providers.payment.razorpayKeyId &&
          config.providers.payment.razorpayKeySecret &&
          config.providers.payment.razorpayWebhookSecret
        ),
        provider: config.providers.payment.provider,
        signedWebhookConfigured: Boolean(
          config.providers.payment.razorpayWebhookUrl &&
          config.providers.payment.razorpayWebhookSecret
        )
      },
      telephony: {
        credentialsPresent: Boolean(
          config.providers.telephony.accountSid &&
          config.providers.telephony.apiKey &&
          config.providers.telephony.apiToken &&
          config.providers.telephony.virtualNumber &&
          config.providers.telephony.webhookSecret
        ),
        provider: config.providers.telephony.provider,
        signedWebhookConfigured: false
      },
      ai: {
        dataResidencyApproved: false,
        llmCredentialsPresent: Boolean(
          (config.providers.ai.llmProvider === "fireworks" &&
            config.providers.ai.fireworksApiKey &&
            config.providers.ai.llmBaseUrl &&
            config.providers.ai.llmModelPrimary) ||
          (config.providers.ai.llmProvider === "openai" &&
            config.providers.ai.openaiApiKey &&
            config.providers.ai.llmModelPrimary)
        ),
        llmProvider: config.providers.ai.llmProvider,
        transcriptionCredentialsPresent: Boolean(
          (config.providers.ai.transcriptionProvider === "openai" &&
            config.providers.ai.openaiApiKey &&
            config.providers.ai.transcriptionModel) ||
          (config.providers.ai.transcriptionProvider === "deepgram" &&
            config.providers.ai.deepgramApiKey &&
            config.providers.ai.transcriptionModel)
        ),
        transcriptionProvider: config.providers.ai.transcriptionProvider
      }
    },
    operations: {
      abdmSandboxVerified: false,
      backupRestore: {
        drillMode: config.operations.backupRestore.drillMode,
        dryRunEvidence: config.operations.backupRestore.drillMode === "dry_run",
        liveRestoreVerified: false
      },
      cloud: {
        accountConfigured: Boolean(config.operations.cloud.accountId),
        applyVerified: false,
        drRegion: config.operations.cloud.drRegion,
        kmsConfigured: Boolean(config.operations.cloud.kmsKeyAlias),
        primaryRegion: config.operations.cloud.primaryRegion,
        terraformBackendConfigured: Boolean(
          config.operations.cloud.terraformStateBucket && config.operations.cloud.terraformLockTable
        )
      },
      alerting: {
        destinationConfigured: Boolean(
          (config.operations.alerting.provider === "email" &&
            config.operations.alerting.contactEmail) ||
          (config.operations.alerting.provider === "slack" &&
            config.operations.alerting.slackWebhookUrl) ||
          (config.operations.alerting.provider === "sentry" && config.operations.alerting.sentryDsn)
        ),
        provider: config.operations.alerting.provider
      },
      githubPushVerified: false,
      physicalDeviceVerified: false
    }
  };

  return ok({
    readiness: buildCp10PilotReadinessPlan(readinessInput)
  });
}

export async function listMigrationBatches(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: { status?: string | null; limit?: string | null }
) {
  authorize(context, { permission: "migration.manage" });
  const details = await dependencies.repository.listMigrationBatches(scopeFrom(context), {
    limit: parseOptionalLimit(filter.limit, 25, 100),
    status: parseOptionalMigrationBatchState(filter.status)
  });
  return ok({ migrationBatches: details.map(toMigrationBatchResponse) });
}

export async function listMigrationBatchRows(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  batchId: UUID,
  filter: { matchStatus?: string | null; status?: string | null }
) {
  authorize(context, { permission: "migration.manage" });
  const rows = await dependencies.repository.listMigrationRows(scopeFrom(context), batchId, {
    matchStatus: parseOptionalMigrationMatchStatus(filter.matchStatus),
    status: parseOptionalMigrationRowStatus(filter.status)
  });
  if (rows.length === 0) {
    const batch = await dependencies.repository.findMigrationBatchById(scopeFrom(context), batchId);
    if (!batch) throw notFound("Migration batch not found.", { batch_id: batchId });
  }
  return ok({ rows: rows.map(toPublicMigrationRow) });
}

export async function listDeadLetterEvents(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: { status?: string | null; limit?: string | null }
) {
  authorize(context, { permission: "migration.manage" });
  const deadLetters = await dependencies.repository.listIntegrationDeadLetters(scopeFrom(context), {
    limit: parseOptionalLimit(filter.limit, 50, 100),
    status: parseOptionalIntegrationDeadLetterStatus(filter.status)
  });
  return ok({ deadLetterEvents: deadLetters.map(toPublicDeadLetterEvent) });
}

export async function replayDeadLetterEvent(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  deadLetterId: UUID,
  body: unknown
) {
  authorize(context, { permission: "migration.manage" });
  const input = objectBody(body);
  const replay = await dependencies.repository.requestIntegrationDeadLetterReplay(
    scopeFrom(context),
    deadLetterId,
    {
      reason: optionalNullableString(input.reason, "reason") ?? null,
      reviewedByUserId: context.accessContext.user.id
    }
  );
  if (!replay)
    throw notFound("Dead-letter event not found or replay is not available.", {
      dead_letter_event_id: deadLetterId
    });

  await audit(context, dependencies, "integration.dead_letter.replayed", {
    resourceType: "integration_dead_letter",
    resourceId: replay.id,
    metadata: {
      providerKey: replay.providerKey,
      status: replay.status
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "integration.dead_letter.replayed",
    aggregateType: "integration_dead_letter",
    aggregateId: replay.id,
    payload: {
      deadLetterEventId: replay.id,
      providerKey: replay.providerKey,
      status: replay.status
    }
  });

  return accepted({
    replay: {
      status: "accepted",
      deadLetterEvent: toPublicDeadLetterEvent(replay),
      outcomeDetail:
        "Replay request was recorded for a handler to process; no provider-confirmed patient state was advanced."
    }
  });
}

export async function resolveMigrationBatchRow(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  batchId: UUID,
  rowId: UUID,
  body: unknown
) {
  authorize(context, { permission: "migration.manage" });
  const input = parseResolveMigrationRowInput(body);
  const row = await dependencies.repository.resolveMigrationRow(
    scopeFrom(context),
    batchId,
    rowId,
    input
  );
  if (!row)
    throw notFound("Migration row not found or resolution target is unavailable.", {
      batch_id: batchId,
      row_id: rowId
    });

  await audit(context, dependencies, "migration.row.resolved", {
    resourceType: "migration_row",
    resourceId: row.id,
    metadata: {
      batchId,
      action: input.action,
      targetRecordType: input.targetRecordType ?? null,
      targetRecordId: input.targetRecordId ?? null
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "migration.row.resolved",
    aggregateType: "migration_row",
    aggregateId: row.id,
    payload: {
      batchId,
      rowId: row.id,
      action: input.action,
      matchStatus: row.matchStatus,
      status: row.status
    }
  });

  return ok({ row: toPublicMigrationRow(row) });
}

export async function commitMigrationBatch(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  batchId: UUID,
  body: unknown
) {
  authorize(context, { permission: "migration.manage" });
  const detail = await dependencies.repository.findMigrationBatchById(scopeFrom(context), batchId);
  if (!detail) throw notFound("Migration batch not found.", { batch_id: batchId });
  if (!["committed", "partially_committed"].includes(detail.batch.state)) {
    const unresolvedRows = detail.rows.filter(
      (row) =>
        row.status === "needs_review" ||
        row.matchStatus === "duplicate_candidate" ||
        row.matchStatus === "conflict"
    );
    if (unresolvedRows.length > 0) {
      throw validation("Migration batch has unresolved duplicate or conflict rows.", {
        batch_id: batchId,
        unresolved_row_ids: unresolvedRows.map((row) => row.id)
      });
    }
    if (!detail.rows.some((row) => row.status === "ready_to_commit")) {
      throw validation("Migration batch has no ready rows to commit.", { batch_id: batchId });
    }
  }

  const commitInput = parseMigrationActionInput(body, context);
  const result = await dependencies.repository.commitMigrationBatch(
    scopeFrom(context),
    batchId,
    commitInput
  );
  if (!result) throw notFound("Migration batch not found.", { batch_id: batchId });

  await audit(context, dependencies, "migration.batch.committed", {
    resourceType: "migration_batch",
    resourceId: batchId,
    metadata: {
      status: result.commit.status,
      committedRows: result.batch.committedRowCount,
      importedRecordLinks: result.importedRecordLinks.length
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "migration.batch.committed",
    aggregateType: "migration_batch",
    aggregateId: batchId,
    payload: {
      batchId,
      state: result.batch.state,
      committedRows: result.batch.committedRowCount,
      failedRows: result.batch.failedRowCount
    }
  });
  for (const link of result.importedRecordLinks.filter(
    (candidate) => candidate.targetRecordType === "patient"
  )) {
    await appendOutbox(context, dependencies, {
      eventType: "patient.imported",
      aggregateType: "imported_record_link",
      aggregateId: link.id,
      patientId: link.targetRecordId,
      payload: {
        batchId,
        rowId: link.rowId,
        patientId: link.targetRecordId,
        linkType: link.linkType,
        verificationStatus: link.verificationStatus
      }
    });
  }

  return accepted({
    batch: result.batch,
    commit: result.commit,
    rows: result.rows.map(toPublicMigrationRow),
    importedRecordLinks: result.importedRecordLinks
  });
}

export async function rollbackMigrationBatch(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  batchId: UUID,
  body: unknown
) {
  authorize(context, { permission: "migration.manage" });
  const actionInput = parseMigrationActionInput(body, context);
  const result = await dependencies.repository.rollbackMigrationBatch(
    scopeFrom(context),
    batchId,
    actionInput
  );
  if (!result) throw notFound("Migration batch not found.", { batch_id: batchId });

  await audit(context, dependencies, "migration.batch.rolled_back", {
    resourceType: "migration_batch",
    resourceId: batchId,
    metadata: {
      status: result.rollback.status,
      rolledBackRows: result.batch.rolledBackRowCount,
      blockedLinks: result.blockedLinks.length
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "migration.batch.rolled_back",
    aggregateType: "migration_batch",
    aggregateId: batchId,
    payload: {
      batchId,
      state: result.batch.state,
      rolledBackRows: result.batch.rolledBackRowCount,
      blockedLinks: result.blockedLinks.length
    }
  });

  return accepted({
    batch: result.batch,
    rollback: result.rollback,
    rows: result.rows.map(toPublicMigrationRow),
    importedRecordLinks: result.importedRecordLinks,
    blockedLinks: result.blockedLinks
  });
}

export async function getPatientTimeline(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  const patient = await dependencies.repository.findPatientById(scopeFrom(context), patientId);

  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const timeline = (
    await dependencies.repository.findPatientTimeline(scopeFrom(context), patientId)
  ).map(toPublicPatientTimelineItem);
  await audit(context, dependencies, "patient.timeline.viewed", {
    patientId,
    resourceType: "patient_timeline",
    resourceId: patientId
  });

  return ok({ timeline, items: timeline });
}

export async function getPatientPrepSummary(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  input: { appointmentId?: UUID | null }
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "clinical.note.read" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);

  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  let appointment: AppointmentRecord | null = null;
  if (input.appointmentId) {
    appointment = await dependencies.repository.findAppointmentById(scope, input.appointmentId);
    if (!appointment)
      throw notFound("Appointment not found.", { appointment_id: input.appointmentId });
    if (appointment.patientId !== patientId) {
      throw validation("Appointment does not belong to the requested patient.", {
        appointment_id: appointment.id,
        patient_id: patientId
      });
    }
  }

  const [timelineItems, intakeSubmissions, consents, enforcementState] = await Promise.all([
    dependencies.repository.findPatientTimeline(scope, patientId),
    dependencies.repository.listPatientIntakeFormSubmissions(scope, patientId),
    dependencies.repository.listPatientConsents(scope, patientId),
    dependencies.repository.getConsentEnforcementState(scope, patientId)
  ]);
  const timeline = timelineItems.map(toPublicPatientTimelineItem);
  const latestIntake = intakeSubmissions[0] ?? null;
  const priorClinicalTimeline = timeline.filter((item) =>
    ["clinical_note", "prescription", "appointment"].includes(item.itemType)
  );
  const prepSummary = {
    patient: {
      id: patient.id,
      fullName: patient.fullName,
      phone: patient.phone,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender
    },
    appointment: appointment
      ? {
          id: appointment.id,
          status: appointment.status,
          startAt: appointment.startAt,
          endAt: appointment.endAt,
          providerUserId: appointment.providerUserId,
          reason: appointment.reason
        }
      : null,
    generatedAt: nowIso(dependencies),
    latestIntakeResponse: latestIntake,
    consentEnforcementState: enforcementState,
    activeConsentPurposes: consents
      .filter((consent) => consent.status === "active")
      .map((consent) => consent.purpose)
      .sort(),
    timelineHighlights: timeline.slice(0, 10),
    priorClinicalTimeline,
    medicalHistoryChangePromptRequired: latestIntake
      ? Object.keys(latestIntake.medicalHistorySnapshot).length === 0
      : true,
    dataCoverage: {
      dentalMedia: "deferred_to_checkpoint_4",
      treatmentPlans: "deferred_to_checkpoint_5",
      labCases: "deferred_to_checkpoint_7",
      invoicesAndPayments: "deferred_to_checkpoint_5"
    }
  };

  await audit(context, dependencies, "clinical_prep.viewed", {
    patientId,
    resourceType: "patient",
    resourceId: patientId,
    metadata: {
      appointmentId: appointment?.id ?? null,
      latestIntakeResponseId: latestIntake?.id ?? null,
      timelineHighlights: timeline.length
    }
  });

  return ok({ prepSummary, summary: prepSummary });
}

export async function listLeads(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: { source?: string | null; status?: string | null }
) {
  authorize(context, { permission: "message.read" });
  const leads = await dependencies.repository.listLeads(scopeFrom(context), {
    source: filter.source ? parseLeadSource(filter.source) : null,
    status: filter.status ? parseLeadStatus(filter.status) : null
  });

  return ok({ leads });
}

export async function createLead(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "message.write" });
  const input = parseCreateLead(body);
  const lead = await dependencies.repository.createLead(scopeFrom(context), input);
  const possibleMatches = await dependencies.repository.findPatientDuplicateCandidates(
    scopeFrom(context),
    {
      fullName: String(input.sourceDetail.patientName ?? ""),
      phone: input.primaryContact
    }
  );

  await dependencies.repository.createAttributionTouch(scopeFrom(context), {
    leadId: lead.id,
    source: lead.source,
    touchType: "first_touch",
    occurredAt: lead.firstSeenAt,
    externalRef:
      typeof lead.sourceDetail.externalRef === "string" ? lead.sourceDetail.externalRef : null,
    metadata: lead.sourceDetail
  });
  await audit(context, dependencies, "lead.created", {
    resourceType: "lead",
    resourceId: lead.id,
    metadata: { source: lead.source, intent: lead.intent }
  });
  await appendOutbox(context, dependencies, {
    eventType: "lead.created",
    aggregateType: "lead",
    aggregateId: lead.id,
    payload: { leadId: lead.id, source: lead.source, intent: lead.intent }
  });

  return created({
    lead,
    patientMatchSuggestions: buildPatientDuplicateSuggestions(
      {
        fullName: String(input.sourceDetail.patientName ?? input.primaryContact),
        phone: input.primaryContact
      },
      possibleMatches
    )
  });
}

export async function matchLeadToPatient(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  leadId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.write" });
  authorize(context, { permission: "message.write" });
  const patientId = uuidField(objectBody(body).patientId, "patientId");
  const scope = scopeFrom(context);
  const lead = await dependencies.repository.findLeadById(scope, leadId);
  const patient = await dependencies.repository.findPatientById(scope, patientId);

  if (!lead) throw notFound("Lead not found.", { lead_id: leadId });
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  assertLeadTransition(lead.status, "matched");
  const matchedLead = await dependencies.repository.matchLeadToPatient(scope, leadId, patientId);

  if (!matchedLead) throw notFound("Lead not found.", { lead_id: leadId });

  await audit(context, dependencies, "lead.matched_to_patient", {
    patientId,
    resourceType: "lead",
    resourceId: leadId,
    metadata: { source: matchedLead.source }
  });
  await appendOutbox(context, dependencies, {
    eventType: "lead.matched_to_patient",
    aggregateType: "lead",
    aggregateId: leadId,
    patientId,
    payload: { leadId, patientId }
  });

  return ok({ lead: matchedLead });
}

export async function updateLeadStatus(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  leadId: UUID,
  body: unknown
) {
  authorize(context, { permission: "message.write" });
  const status = parseLeadStatus(requiredString(objectBody(body).status, "status"));
  const scope = scopeFrom(context);
  const lead = await dependencies.repository.findLeadById(scope, leadId);

  if (!lead) throw notFound("Lead not found.", { lead_id: leadId });

  assertLeadTransition(lead.status, status);
  const updatedLead = await dependencies.repository.updateLeadStatus(scope, leadId, status);

  return ok({ lead: updatedLead });
}

export async function convertLeadToAppointment(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  leadId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.write" });
  authorize(context, { permission: "schedule.write" });
  const scope = scopeFrom(context);
  const lead = await dependencies.repository.findLeadById(scope, leadId);

  if (!lead) throw notFound("Lead not found.", { lead_id: leadId });
  if (!lead.patientId) {
    throw validation("Lead must be matched to a patient before conversion.", { lead_id: leadId });
  }

  const appointmentInput = parseCreateAppointment(body, {
    patientId: lead.patientId,
    leadId,
    source: lead.source
  });
  const appointment = await bookAppointment(context, dependencies, appointmentInput);
  const bookedLead = await dependencies.repository.updateLeadStatus(scope, leadId, "booked");

  await dependencies.repository.createAttributionTouch(scope, {
    patientId: appointment.patientId,
    leadId,
    appointmentId: appointment.id,
    source: lead.source,
    touchType: "booking_touch",
    occurredAt: appointment.createdAt,
    externalRef:
      typeof lead.sourceDetail.externalRef === "string" ? lead.sourceDetail.externalRef : null,
    metadata: { convertedFromLead: true }
  });
  await audit(context, dependencies, "lead.converted_to_appointment", {
    patientId: appointment.patientId,
    resourceType: "lead",
    resourceId: leadId,
    metadata: { appointmentId: appointment.id }
  });
  await appendOutbox(context, dependencies, {
    eventType: "lead.converted_to_appointment",
    aggregateType: "lead",
    aggregateId: leadId,
    patientId: appointment.patientId,
    payload: { leadId, appointmentId: appointment.id, patientId: appointment.patientId }
  });

  return created({ lead: bookedLead, appointment });
}

export async function listAppointments(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: { date?: string | null; providerId?: string | null; status?: string | null }
) {
  authorize(context, { permission: "schedule.read" });
  const appointments = await dependencies.repository.listAppointments(scopeFrom(context), {
    date: filter.date ?? null,
    providerUserId: filter.providerId ? uuidField(filter.providerId, "providerId") : null,
    status: filter.status ? parseAppointmentStatus(filter.status) : null
  });

  return ok({ appointments });
}

export async function listAppointmentTypes(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "schedule.read" });
  const appointmentTypes = await dependencies.repository.listAppointmentTypes(scopeFrom(context));
  return ok({ appointmentTypes });
}

export async function listChairs(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "schedule.read" });
  const chairs = await dependencies.repository.listChairs(scopeFrom(context));
  return ok({ chairs });
}

export async function listProviderSchedules(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  providerId?: string | null
) {
  authorize(context, { permission: "schedule.read" });
  const providerSchedules = await dependencies.repository.listProviderSchedules(
    scopeFrom(context),
    providerId ? uuidField(providerId, "providerId") : null
  );
  return ok({ providerSchedules });
}

export async function createAppointment(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "schedule.write" });
  const appointment = await bookAppointment(context, dependencies, parseCreateAppointment(body));
  return created({ appointment });
}

export async function updateAppointment(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  appointmentId: UUID,
  body: unknown
) {
  authorize(context, { permission: "schedule.write" });
  const statusValue = objectBody(body).status;

  if (statusValue === undefined) {
    throw validation("Only appointment status patching is currently supported.", {
      supported_fields: ["status"]
    });
  }

  return transitionAppointment(
    context,
    dependencies,
    appointmentId,
    parseAppointmentStatus(requiredString(statusValue, "status"))
  );
}

export async function confirmAppointment(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  appointmentId: UUID
) {
  authorize(context, { permission: "schedule.write" });
  return transitionAppointment(context, dependencies, appointmentId, "confirmed");
}

export async function checkInAppointment(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  appointmentId: UUID
) {
  authorize(context, { permission: "queue.manage" });
  const response = await transitionAppointment(context, dependencies, appointmentId, "checked_in");
  const appointment = response.body.appointment;
  const queueEntry = await dependencies.repository.createQueueEntry(
    scopeFrom(context),
    appointment
  );

  await audit(context, dependencies, "queue.entry_created", {
    patientId: appointment.patientId,
    resourceType: "queue_entry",
    resourceId: queueEntry.id,
    metadata: { appointmentId: appointment.id }
  });
  await appendOutbox(context, dependencies, {
    eventType: "queue.entry_created",
    aggregateType: "queue_entry",
    aggregateId: queueEntry.id,
    patientId: appointment.patientId,
    payload: { queueEntryId: queueEntry.id, appointmentId: appointment.id }
  });

  return ok({ appointment, queueEntry });
}

export async function markAppointmentNoShow(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  appointmentId: UUID
) {
  authorize(context, { permission: "schedule.write" });
  return transitionAppointment(context, dependencies, appointmentId, "no_show");
}

export async function listQueue(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  date: string
) {
  authorize(context, { permission: "queue.manage" });
  const queue = await dependencies.repository.listQueueEntries(scopeFrom(context), date);
  return ok({ queue });
}

export async function updateQueueEntry(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  queueEntryId: UUID,
  body: unknown
) {
  authorize(context, { permission: "queue.manage" });
  const status = parseQueueStatus(requiredString(objectBody(body).status, "status"));
  const queueEntry = await dependencies.repository.updateQueueEntry(
    scopeFrom(context),
    queueEntryId,
    status
  );

  if (!queueEntry) throw notFound("Queue entry not found.", { queue_entry_id: queueEntryId });

  if (queueEntry.status === "called") {
    await appendOutbox(context, dependencies, {
      eventType: "queue.entry_called",
      aggregateType: "queue_entry",
      aggregateId: queueEntry.id,
      patientId: queueEntry.patientId,
      payload: { queueEntryId: queueEntry.id, appointmentId: queueEntry.appointmentId }
    });
  }

  return ok({ queueEntry });
}

export async function getMorningDashboard(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  date: string
) {
  authorize(context, { permission: "schedule.read" });
  const data = await dependencies.repository.loadDashboardData(scopeFrom(context), date);
  return ok({ dashboard: buildMorningDashboard({ date, ...data }) });
}

export async function listTasks(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  query: URLSearchParams = new URLSearchParams()
) {
  authorize(context, { permission: "task.manage" });
  const tasks = await dependencies.repository.listTasks(scopeFrom(context), parseTaskSearch(query));
  return ok({ tasks: tasks.map(publicTask) });
}

export async function createTask(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "task.manage" });
  const task = await dependencies.repository.createTask(scopeFrom(context), parseCreateTask(body));
  await audit(context, dependencies, "task.created", {
    patientId: task.patientId,
    resourceType: "task",
    resourceId: task.id,
    metadata: taskAuditMetadata(task)
  });
  await appendOutbox(context, dependencies, {
    eventType: "task.created",
    aggregateType: "task",
    aggregateId: task.id,
    patientId: task.patientId,
    payload: taskAuditMetadata(task)
  });
  return created({ task: publicTask(task) });
}

export async function updateTask(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  taskId: UUID,
  body: unknown
) {
  authorize(context, { permission: "task.manage" });
  const task = await dependencies.repository.updateTask(
    scopeFrom(context),
    taskId,
    parseUpdateTask(body)
  );
  if (!task) throw notFound("Task not found.", { task_id: taskId });
  const eventType = task.status === "done" ? "task.completed" : "task.status_changed";
  await audit(context, dependencies, eventType, {
    patientId: task.patientId,
    resourceType: "task",
    resourceId: task.id,
    metadata: taskAuditMetadata(task)
  });
  await appendOutbox(context, dependencies, {
    eventType,
    aggregateType: "task",
    aggregateId: task.id,
    patientId: task.patientId,
    payload: taskAuditMetadata(task)
  });
  return ok({ task: publicTask(task) });
}

export async function generateDueContinuityTasks(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "task.manage" });
  authorize(context, { permission: "recall.manage" });
  const result = await dependencies.repository.generateDueContinuityTasks(
    scopeFrom(context),
    parseGenerateDueContinuity(body, nowIso(dependencies))
  );
  for (const recall of result.recallsCreated) {
    await audit(context, dependencies, "recall.due", {
      patientId: recall.patientId,
      resourceType: "recall",
      resourceId: recall.id,
      metadata: recallAuditMetadata(recall)
    });
    await appendOutbox(context, dependencies, {
      eventType: "recall.due",
      aggregateType: "recall",
      aggregateId: recall.id,
      patientId: recall.patientId,
      payload: recallAuditMetadata(recall)
    });
  }
  for (const task of [...result.recallTasksCreated, ...result.followUpTasksCreated]) {
    await audit(context, dependencies, "task.due", {
      patientId: task.patientId,
      resourceType: "task",
      resourceId: task.id,
      metadata: taskAuditMetadata(task)
    });
    await appendOutbox(context, dependencies, {
      eventType: "task.due",
      aggregateType: "task",
      aggregateId: task.id,
      patientId: task.patientId,
      payload: taskAuditMetadata(task)
    });
  }
  return accepted({
    recallTasksCreated: result.recallTasksCreated.map(publicTask),
    followUpTasksCreated: result.followUpTasksCreated.map(publicTask),
    recallsCreated: result.recallsCreated.map(publicRecall),
    skippedExistingKeys: result.skippedExistingKeys,
    processedCount: result.processedCount,
    complete: result.complete,
    nextCursor: result.nextCursor
  });
}

export async function createRecallRule(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "recall.manage" });
  const rule = await dependencies.repository.createRecallRule(
    scopeFrom(context),
    parseCreateRecallRule(body)
  );
  await audit(context, dependencies, "recall.rule_created", {
    resourceType: "recall_rule",
    resourceId: rule.id,
    metadata: {
      code: rule.code,
      anchor: rule.anchor,
      offsetDays: rule.offsetDays,
      procedureCategory: rule.procedureCategory,
      pricebookProcedureId: rule.pricebookProcedureId
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "recall.rule_created",
    aggregateType: "recall_rule",
    aggregateId: rule.id,
    payload: {
      code: rule.code,
      anchor: rule.anchor,
      offsetDays: rule.offsetDays,
      procedureCategory: rule.procedureCategory,
      pricebookProcedureId: rule.pricebookProcedureId
    }
  });
  return created({ recallRule: rule });
}

export async function listRecalls(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  query: URLSearchParams = new URLSearchParams()
) {
  authorize(context, { permission: "recall.manage" });
  const recalls = await dependencies.repository.listRecalls(
    scopeFrom(context),
    parseRecallSearch(query)
  );
  return ok({ recalls: recalls.map(publicRecall) });
}

export async function recordRecallAction(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  recallId: UUID,
  body: unknown
) {
  authorize(context, { permission: "recall.manage" });
  const input = parseRecallAction(body);
  const recall = await dependencies.repository.recordRecallAction(
    scopeFrom(context),
    recallId,
    input
  );
  if (!recall) throw notFound("Recall not found.", { recall_id: recallId });
  const eventType =
    recall.status === "completed"
      ? "recall.completed"
      : input.actionType === "manual_contact_requested" || input.actionType === "manual_contacted"
        ? "recall.sent"
        : "recall.action_recorded";
  await audit(context, dependencies, eventType, {
    patientId: recall.patientId,
    resourceType: "recall",
    resourceId: recall.id,
    metadata: recallAuditMetadata(recall)
  });
  await appendOutbox(context, dependencies, {
    eventType,
    aggregateType: "recall",
    aggregateId: recall.id,
    patientId: recall.patientId,
    payload: recallAuditMetadata(recall)
  });
  return ok({ recall: publicRecall(recall) });
}

export async function createSopTemplate(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "sop.manage" });
  const detail = await dependencies.repository.createSopTemplate(
    scopeFrom(context),
    parseCreateSopTemplate(body)
  );
  await audit(context, dependencies, "sop_template.created", {
    resourceType: "sop_template",
    resourceId: detail.template.id,
    metadata: { code: detail.template.code, itemCount: detail.items.length }
  });
  await appendOutbox(context, dependencies, {
    eventType: "sop_template.created",
    aggregateType: "sop_template",
    aggregateId: detail.template.id,
    payload: { code: detail.template.code, itemCount: detail.items.length }
  });
  return created({ sopTemplate: publicSopTemplateDetail(detail) });
}

export async function createSopSchedule(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "sop.manage" });
  const schedule = await dependencies.repository.createSopSchedule(
    scopeFrom(context),
    parseCreateSopSchedule(body)
  );
  if (!schedule) throw notFound("SOP template not found.", {});
  await audit(context, dependencies, "sop_schedule.created", {
    resourceType: "sop_schedule",
    resourceId: schedule.id,
    metadata: sopScheduleAuditMetadata(schedule)
  });
  await appendOutbox(context, dependencies, {
    eventType: "sop_schedule.created",
    aggregateType: "sop_schedule",
    aggregateId: schedule.id,
    payload: sopScheduleAuditMetadata(schedule)
  });
  return created({ sopSchedule: schedule });
}

export async function generateDueSopRuns(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "sop.manage" });
  const result = await dependencies.repository.generateDueSopRuns(
    scopeFrom(context),
    parseGenerateDueSopRuns(body, nowIso(dependencies))
  );
  for (const detail of result.runsCreated) {
    await audit(context, dependencies, "sop_run.created", {
      resourceType: "sop_run",
      resourceId: detail.run.id,
      metadata: sopRunAuditMetadata(detail)
    });
    await appendOutbox(context, dependencies, {
      eventType: "sop_run.created",
      aggregateType: "sop_run",
      aggregateId: detail.run.id,
      payload: sopRunAuditMetadata(detail)
    });
  }
  return accepted({
    sopRunsCreated: result.runsCreated.map(publicSopRunDetail),
    skippedExistingKeys: result.skippedExistingKeys,
    processedCount: result.processedCount,
    complete: result.complete,
    nextCursor: result.nextCursor
  });
}

export async function listSopRuns(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  query: URLSearchParams = new URLSearchParams()
) {
  authorize(context, { permission: "sop.manage" });
  const runs = await dependencies.repository.listSopRuns(
    scopeFrom(context),
    parseSopRunSearch(query)
  );
  return ok({ sopRuns: runs.map(publicSopRunDetail) });
}

export async function updateSopRun(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  sopRunId: UUID,
  body: unknown
) {
  authorize(context, { permission: "sop.manage" });
  const detail = await dependencies.repository.updateSopRun(
    scopeFrom(context),
    sopRunId,
    parseUpdateSopRun(body)
  );
  if (!detail) throw notFound("SOP run not found.", { sop_run_id: sopRunId });
  const eventType = detail.run.status === "completed" ? "sop_run.completed" : "sop_run.updated";
  await audit(context, dependencies, eventType, {
    resourceType: "sop_run",
    resourceId: detail.run.id,
    metadata: sopRunAuditMetadata(detail)
  });
  await appendOutbox(context, dependencies, {
    eventType,
    aggregateType: "sop_run",
    aggregateId: detail.run.id,
    payload: sopRunAuditMetadata(detail)
  });
  return ok({ sopRun: publicSopRunDetail(detail) });
}

export async function listLabVendors(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "lab.manage" });
  const labVendors = await dependencies.repository.listLabVendors(scopeFrom(context));
  return ok({ labVendors });
}

export async function createLabVendor(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "lab.manage" });
  const vendor = await dependencies.repository.createLabVendor(
    scopeFrom(context),
    parseCreateLabVendor(body)
  );

  await audit(context, dependencies, "lab_vendor.created", {
    resourceType: "lab_vendor",
    resourceId: vendor.id,
    metadata: { displayName: vendor.displayName }
  });
  await appendOutbox(context, dependencies, {
    eventType: "lab_vendor.created",
    aggregateType: "lab_vendor",
    aggregateId: vendor.id,
    payload: { vendorId: vendor.id, displayName: vendor.displayName }
  });

  return created({ labVendor: vendor });
}

export async function listLabCases(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: { status?: string | null; dueBefore?: string | null; vendorId?: string | null }
) {
  authorize(context, { permission: "lab.manage" });
  const labCases = await dependencies.repository.listLabCases(scopeFrom(context), {
    status: filter.status ? parseLabCaseStatus(filter.status) : null,
    dueBefore: filter.dueBefore ?? null,
    vendorId: filter.vendorId ? uuidField(filter.vendorId, "vendorId") : null
  });
  return ok({ labCases });
}

export async function createLabCase(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "lab.manage" });
  const input = parseCreateLabCase(body);
  const result = await dependencies.repository.createLabCase(scopeFrom(context), input);
  if (!result)
    throw notFound("Lab vendor, patient, or clinical linkage not found.", {
      vendor_id: input.vendorId,
      patient_id: input.patientId
    });

  await audit(context, dependencies, "lab_case.created", {
    patientId: result.labCase.patientId,
    resourceType: "lab_case",
    resourceId: result.labCase.id,
    metadata: { vendorId: result.labCase.vendorId, dueAt: result.labCase.dueAt }
  });
  await audit(context, dependencies, "lab_slip.generated", {
    patientId: result.labCase.patientId,
    resourceType: "lab_case",
    resourceId: result.labCase.id,
    metadata: {
      slipNumber: result.labCase.slipNumber,
      slipVersion: result.labCase.slipVersion
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "lab_case.created",
    aggregateType: "lab_case",
    aggregateId: result.labCase.id,
    patientId: result.labCase.patientId,
    payload: {
      labCaseId: result.labCase.id,
      vendorId: result.labCase.vendorId,
      dueAt: result.labCase.dueAt,
      slipNumber: result.labCase.slipNumber
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "lab_slip.generated",
    aggregateType: "lab_slip",
    aggregateId: result.labCase.id,
    patientId: result.labCase.patientId,
    payload: {
      labCaseId: result.labCase.id,
      slipNumber: result.labCase.slipNumber,
      slipVersion: result.labCase.slipVersion
    }
  });

  return created({ labCase: result });
}

export async function updateLabCase(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  labCaseId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "lab.manage" });
  const input = parseUpdateLabCaseStatus(body);
  const before = await dependencies.repository.findLabCaseById(scopeFrom(context), labCaseId);
  if (!before) throw notFound("Lab case not found.", { lab_case_id: labCaseId });

  let result;
  try {
    result = await dependencies.repository.updateLabCaseStatus(
      scopeFrom(context),
      labCaseId,
      input
    );
  } catch (error) {
    throw conflict(error instanceof Error ? error.message : "Invalid lab case transition.", {
      lab_case_id: labCaseId,
      to_status: input.status
    });
  }
  if (!result) throw notFound("Lab case not found.", { lab_case_id: labCaseId });

  const action = labCaseAuditAction(input.status);
  const eventType = labCaseEventType(input.status);
  await audit(context, dependencies, action, {
    patientId: result.labCase.patientId,
    resourceType: "lab_case",
    resourceId: result.labCase.id,
    metadata: { fromStatus: before.labCase.status, toStatus: result.labCase.status }
  });
  await appendOutbox(context, dependencies, {
    eventType,
    aggregateType: "lab_case",
    aggregateId: result.labCase.id,
    patientId: result.labCase.patientId,
    payload: {
      labCaseId: result.labCase.id,
      fromStatus: before.labCase.status,
      toStatus: result.labCase.status
    }
  });

  return ok({ labCase: result });
}

export async function createLabReconciliation(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "lab.manage" });
  const input = parseCreateLabReconciliation(body);
  const result = await dependencies.repository.createLabReconciliation(scopeFrom(context), input);
  if (!result)
    throw notFound("Lab vendor or lab case not found for reconciliation.", {
      vendor_id: input.vendorId
    });

  await audit(context, dependencies, "lab_reconciliation.created", {
    resourceType: "lab_reconciliation",
    resourceId: result.reconciliation.id,
    metadata: {
      vendorId: result.reconciliation.vendorId,
      periodStart: result.reconciliation.periodStart,
      periodEnd: result.reconciliation.periodEnd,
      entryCount: result.entries.length,
      varianceAmountMinor: result.reconciliation.varianceAmountMinor
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "lab_reconciliation.created",
    aggregateType: "lab_reconciliation",
    aggregateId: result.reconciliation.id,
    payload: {
      reconciliationId: result.reconciliation.id,
      vendorId: result.reconciliation.vendorId,
      periodStart: result.reconciliation.periodStart,
      periodEnd: result.reconciliation.periodEnd,
      entryCount: result.entries.length,
      varianceAmountMinor: result.reconciliation.varianceAmountMinor
    }
  });

  return created({ labReconciliation: result });
}

export async function listInventoryCategories(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "inventory.manage" });
  const categories = await dependencies.repository.listInventoryCategories(scopeFrom(context));
  return ok({ categories });
}

export async function createInventoryCategory(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "inventory.manage" });
  const category = await dependencies.repository.createInventoryCategory(
    scopeFrom(context),
    parseCreateInventoryCategory(body)
  );

  await audit(context, dependencies, "inventory_category.created", {
    resourceType: "inventory_category",
    resourceId: category.id,
    metadata: { kind: category.kind }
  });
  await appendOutbox(context, dependencies, {
    eventType: "inventory_category.created",
    aggregateType: "inventory_category",
    aggregateId: category.id,
    payload: { categoryId: category.id, kind: category.kind }
  });

  return created({ category });
}

export async function listInventoryItems(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "inventory.manage" });
  const items = await dependencies.repository.listInventoryItems(scopeFrom(context));
  return ok({ items });
}

export async function createInventoryItem(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "inventory.manage" });
  const input = parseCreateInventoryItem(body);
  const item = await dependencies.repository.createInventoryItem(scopeFrom(context), input);
  if (!item) throw notFound("Inventory category not found.", { category_id: input.categoryId });

  await audit(context, dependencies, "inventory_item.created", {
    resourceType: "inventory_item",
    resourceId: item.id,
    metadata: { sku: item.sku, openingQuantity: input.openingQuantity ?? 0 }
  });
  await appendOutbox(context, dependencies, {
    eventType: "inventory_item.created",
    aggregateType: "inventory_item",
    aggregateId: item.id,
    payload: { itemId: item.id, sku: item.sku, openingQuantity: input.openingQuantity ?? 0 }
  });

  return created({ item });
}

export async function createStockLedgerEntry(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "inventory.manage" });
  const input = parseCreateStockLedgerEntry(body);
  const entry = await dependencies.repository.createStockLedgerEntry(scopeFrom(context), input);
  if (!entry) throw notFound("Inventory item not found.", { item_id: input.itemId });

  await audit(context, dependencies, "inventory_stock.adjusted", {
    resourceType: "stock_ledger_entry",
    resourceId: entry.id,
    metadata: {
      itemId: entry.itemId,
      movementType: entry.movementType,
      quantityDelta: entry.quantityDelta,
      quantityAfter: entry.quantityAfter
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "inventory_stock.adjusted",
    aggregateType: "stock_ledger_entry",
    aggregateId: entry.id,
    payload: {
      itemId: entry.itemId,
      movementType: entry.movementType,
      quantityDelta: entry.quantityDelta,
      quantityAfter: entry.quantityAfter
    }
  });

  return created({ stockLedgerEntry: entry });
}

export async function listInventoryCheckTemplates(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "inventory.manage" });
  const templates = await dependencies.repository.listInventoryCheckTemplates(scopeFrom(context));
  return ok({ templates });
}

export async function createInventoryCheckTemplate(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "inventory.manage" });
  const input = parseCreateInventoryCheckTemplate(body);
  const template = await dependencies.repository.createInventoryCheckTemplate(
    scopeFrom(context),
    input
  );
  if (!template) throw notFound("Inventory item not found for check template.", {});
  return created({ template });
}

export async function createInventoryCheckRun(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "inventory.manage" });
  const input = parseCreateInventoryCheckRun(body);
  const run = await dependencies.repository.createInventoryCheckRun(scopeFrom(context), input);
  if (!run)
    throw notFound("Inventory check template not found.", { template_id: input.templateId });

  await audit(context, dependencies, "inventory_check.created", {
    resourceType: "inventory_check_run",
    resourceId: run.run.id,
    metadata: { templateId: run.run.templateId, lineCount: run.lines.length }
  });
  await appendOutbox(context, dependencies, {
    eventType: "inventory_check.created",
    aggregateType: "inventory_check_run",
    aggregateId: run.run.id,
    payload: { checkRunId: run.run.id, templateId: run.run.templateId, lineCount: run.lines.length }
  });

  return created({ checkRun: run });
}

export async function updateInventoryCheckRun(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  checkRunId: UUID,
  body: unknown
) {
  authorize(context, { permission: "inventory.manage" });
  const input = parseUpdateInventoryCheckRun(body);
  const run = await dependencies.repository.updateInventoryCheckRun(
    scopeFrom(context),
    checkRunId,
    input
  );
  if (!run)
    throw conflict("Inventory check run cannot be updated for this state or payload.", {
      check_run_id: checkRunId
    });

  if (run.run.status === "completed") {
    const exceptionLines = run.lines.filter((line) => line.exceptionType);
    await audit(context, dependencies, "inventory_check.completed", {
      resourceType: "inventory_check_run",
      resourceId: run.run.id,
      metadata: {
        exceptionCount: exceptionLines.length,
        procurementSuggestionCount: run.procurementSuggestions.length
      }
    });
    await appendOutbox(context, dependencies, {
      eventType: "inventory_check.completed",
      aggregateType: "inventory_check_run",
      aggregateId: run.run.id,
      payload: {
        checkRunId: run.run.id,
        exceptionCount: exceptionLines.length
      }
    });
    for (const line of exceptionLines) {
      if (line.exceptionType !== "low_stock" && line.exceptionType !== "missing_item") continue;
      await audit(context, dependencies, "inventory.low_stock_detected", {
        resourceType: "inventory_item",
        resourceId: line.itemId,
        metadata: {
          checkRunId: run.run.id,
          checkRunLineId: line.id,
          exceptionType: line.exceptionType,
          expectedQuantity: line.expectedQuantity,
          countedQuantity: line.countedQuantity
        }
      });
      await appendOutbox(context, dependencies, {
        eventType: "inventory.low_stock_detected",
        aggregateType: "inventory_item",
        aggregateId: line.itemId,
        payload: {
          checkRunId: run.run.id,
          checkRunLineId: line.id,
          exceptionType: line.exceptionType,
          expectedQuantity: line.expectedQuantity,
          countedQuantity: line.countedQuantity
        }
      });
    }
    for (const suggestion of run.procurementSuggestions) {
      await audit(context, dependencies, "inventory.procurement_suggested", {
        resourceType: "procurement_suggestion",
        resourceId: suggestion.id,
        metadata: {
          itemId: suggestion.itemId,
          suggestedQuantity: suggestion.suggestedQuantity,
          taskCreation: "suggested_not_created"
        }
      });
      await appendOutbox(context, dependencies, {
        eventType: "inventory.procurement_suggested",
        aggregateType: "procurement_suggestion",
        aggregateId: suggestion.id,
        payload: {
          suggestionId: suggestion.id,
          itemId: suggestion.itemId,
          suggestedQuantity: suggestion.suggestedQuantity,
          taskCreation: "suggested_not_created"
        }
      });
    }
  }

  return ok({ checkRun: run });
}

export async function listInventoryExceptions(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: { itemId?: string | null; checkRunId?: string | null }
) {
  authorize(context, { permission: "inventory.manage" });
  const exceptions = await dependencies.repository.listInventoryExceptions(scopeFrom(context), {
    itemId: filter.itemId ? uuidField(filter.itemId, "itemId") : null,
    checkRunId: filter.checkRunId ? uuidField(filter.checkRunId, "checkRunId") : null
  });
  return ok({ exceptions });
}

export async function listIncidents(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: { status?: string | null; severity?: string | null; category?: string | null }
) {
  authorize(context, { permission: "incident.manage" });
  const incidents = await dependencies.repository.listIncidents(scopeFrom(context), {
    status: filter.status ? parseIncidentStatus(filter.status) : null,
    severity: filter.severity ? parseIncidentSeverity(filter.severity) : null,
    category: filter.category ? parseIncidentCategory(filter.category) : null
  });
  return ok({ incidents });
}

export async function createIncident(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "incident.manage" });
  const input = parseCreateIncident(body);
  const incident = await dependencies.repository.createIncident(scopeFrom(context), input);
  if (!incident) throw notFound("Incident linkage not found.", {});

  await audit(context, dependencies, "incident.created", {
    patientId: incident.patientId,
    resourceType: "incident",
    resourceId: incident.id,
    metadata: {
      category: incident.category,
      severity: incident.severity,
      labCaseId: incident.labCaseId,
      inventoryItemId: incident.inventoryItemId
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "incident.created",
    aggregateType: "incident",
    aggregateId: incident.id,
    patientId: incident.patientId,
    payload: {
      incidentId: incident.id,
      category: incident.category,
      severity: incident.severity,
      status: incident.status
    }
  });

  return created({ incident });
}

export async function listCorrectiveActions(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "corrective_action.manage" });
  const correctiveActions = (
    await dependencies.repository.listCorrectiveActions(scopeFrom(context))
  ).map(publicCorrectiveAction);
  return ok({ correctiveActions });
}

export async function createCorrectiveAction(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "corrective_action.manage" });
  const input = parseCreateCorrectiveAction(body);
  const correctiveAction = await dependencies.repository.createCorrectiveAction(
    scopeFrom(context),
    input
  );
  if (!correctiveAction)
    throw notFound("Incident not found.", { incident_id: input.incidentId ?? null });

  await audit(context, dependencies, "corrective_action.created", {
    resourceType: "corrective_action",
    resourceId: correctiveAction.id,
    metadata: {
      incidentId: correctiveAction.incidentId,
      actionType: correctiveAction.actionType,
      dueAt: correctiveAction.dueAt
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "corrective_action.created",
    aggregateType: "corrective_action",
    aggregateId: correctiveAction.id,
    payload: {
      correctiveActionId: correctiveAction.id,
      incidentId: correctiveAction.incidentId,
      dueAt: correctiveAction.dueAt
    }
  });

  return created({ correctiveAction: publicCorrectiveAction(correctiveAction) });
}

export async function updateCorrectiveAction(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  correctiveActionId: UUID,
  body: unknown
) {
  authorize(context, { permission: "corrective_action.manage" });
  const input = parseUpdateCorrectiveAction(body);
  const correctiveAction = await dependencies.repository.updateCorrectiveAction(
    scopeFrom(context),
    correctiveActionId,
    input
  );
  if (!correctiveAction)
    throw notFound("Corrective action not found or already closed.", {
      corrective_action_id: correctiveActionId
    });

  const action =
    correctiveAction.status === "completed"
      ? "corrective_action.completed"
      : "corrective_action.status_changed";
  await audit(context, dependencies, action, {
    resourceType: "corrective_action",
    resourceId: correctiveAction.id,
    metadata: {
      incidentId: correctiveAction.incidentId,
      status: correctiveAction.status,
      effectiveStatus: correctiveActionEffectiveStatus(correctiveAction)
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: action,
    aggregateType: "corrective_action",
    aggregateId: correctiveAction.id,
    payload: {
      correctiveActionId: correctiveAction.id,
      incidentId: correctiveAction.incidentId,
      status: correctiveAction.status,
      effectiveStatus: correctiveActionEffectiveStatus(correctiveAction)
    }
  });

  return ok({ correctiveAction: publicCorrectiveAction(correctiveAction) });
}

export async function getOwnerDashboard(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: { from?: string | null; to?: string | null; defaultDate?: string }
) {
  authorize(context, { permission: "analytics.read" });
  const range = parseOwnerDashboardRange(
    filter,
    filter.defaultDate ?? nowIso(dependencies).slice(0, 10)
  );
  const data = await dependencies.repository.loadOwnerDashboardProjectionData(
    scopeFrom(context),
    range
  );
  const dashboard = buildOwnerDashboardProjection({
    from: range.startAt,
    to: range.endAt,
    generatedAt: nowIso(dependencies),
    data
  });

  await audit(context, dependencies, "owner_dashboard.viewed", {
    resourceType: "owner_dashboard",
    resourceId: context.clinicId,
    metadata: {
      from: range.startAt,
      to: range.endAt,
      sourceKeys: dashboard.dataSources.map((source) => source.key),
      revenueSources: dashboard.revenue.bySource.map((source) => source.source)
    }
  });

  return ok({ dashboard });
}

export async function listPricebookProcedures(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "billing.read" });
  const procedures = await dependencies.repository.listPricebookProcedures(scopeFrom(context));

  await audit(context, dependencies, "pricebook.procedure_catalog.viewed", {
    resourceType: "pricebook_procedure",
    resourceId: context.clinicId,
    metadata: { procedureCount: procedures.length }
  });

  return ok({ procedures: procedures.map(publicPricebookProcedure) });
}

export async function createPatientTreatmentPlan(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.write" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const input = parseCreateTreatmentPlan(body);
  const result = await billingRepositoryOperation(
    () => dependencies.repository.createTreatmentPlan(scope, patientId, input),
    { patient_id: patientId }
  );
  if (!result) throw notFound("Patient or encounter not found.", { patient_id: patientId });

  await audit(context, dependencies, "treatment_plan.created", {
    patientId,
    resourceType: "treatment_plan",
    resourceId: result.detail.treatmentPlan.id,
    metadata: treatmentPlanAuditMetadata(result.detail)
  });
  await appendOutbox(context, dependencies, {
    eventType: "treatment_plan.created",
    aggregateType: "treatment_plan",
    aggregateId: result.detail.treatmentPlan.id,
    patientId,
    payload: {
      treatmentPlanId: result.detail.treatmentPlan.id,
      patientId,
      status: result.detail.treatmentPlan.status,
      totalMinor: result.detail.treatmentPlan.totalMinor,
      itemCount: treatmentPlanItemCount(result.detail)
    }
  });

  return created({ treatmentPlan: publicTreatmentPlanDetail(result.detail) });
}

export async function updateTreatmentPlan(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  treatmentPlanId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.write" });
  const input = parseUpdateTreatmentPlan(body);
  const result = await billingRepositoryOperation(
    () => dependencies.repository.updateTreatmentPlan(scopeFrom(context), treatmentPlanId, input),
    { treatment_plan_id: treatmentPlanId }
  );
  if (!result) throw notFound("Treatment plan not found.", { treatment_plan_id: treatmentPlanId });

  await audit(context, dependencies, "treatment_plan.updated", {
    patientId: result.detail.treatmentPlan.patientId,
    resourceType: "treatment_plan",
    resourceId: result.detail.treatmentPlan.id,
    metadata: treatmentPlanAuditMetadata(result.detail)
  });

  return ok({ treatmentPlan: publicTreatmentPlanDetail(result.detail) });
}

export async function acceptTreatmentPlan(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  treatmentPlanId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.write" });
  const input = parseAcceptTreatmentPlan(body);
  const result = await billingRepositoryOperation(
    () => dependencies.repository.acceptTreatmentPlan(scopeFrom(context), treatmentPlanId, input),
    { treatment_plan_id: treatmentPlanId }
  );
  if (!result) throw notFound("Treatment plan not found.", { treatment_plan_id: treatmentPlanId });

  await audit(context, dependencies, "treatment_plan.accepted", {
    patientId: result.detail.treatmentPlan.patientId,
    resourceType: "treatment_plan",
    resourceId: result.detail.treatmentPlan.id,
    metadata: treatmentPlanAuditMetadata(result.detail)
  });
  await appendOutbox(context, dependencies, {
    eventType: "treatment_plan.accepted",
    aggregateType: "treatment_plan",
    aggregateId: result.detail.treatmentPlan.id,
    patientId: result.detail.treatmentPlan.patientId,
    payload: {
      treatmentPlanId: result.detail.treatmentPlan.id,
      patientId: result.detail.treatmentPlan.patientId,
      acceptedAt: result.detail.treatmentPlan.acceptedAt,
      totalMinor: result.detail.treatmentPlan.totalMinor
    }
  });

  return ok({ treatmentPlan: publicTreatmentPlanDetail(result.detail) });
}

export async function createEncounterProcedurePerformed(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "clinical.note.write" });
  const input = parseCreateProcedurePerformed(body);
  const result = await billingRepositoryOperation(
    () => dependencies.repository.createProcedurePerformed(scopeFrom(context), encounterId, input),
    {
      encounter_id: encounterId,
      treatment_plan_id: input.treatmentPlanId,
      treatment_plan_estimate_item_id: input.treatmentPlanEstimateItemId
    }
  );
  if (!result)
    throw notFound("Encounter or accepted treatment plan item not found.", {
      encounter_id: encounterId
    });

  await audit(context, dependencies, "procedure.completed", {
    patientId: result.procedure.patientId,
    resourceType: "procedure_performed",
    resourceId: result.procedure.id,
    metadata: {
      encounterId,
      treatmentPlanId: result.procedure.treatmentPlanId,
      estimateItemId: result.procedure.treatmentPlanEstimateItemId,
      totalMinor: result.procedure.totalMinor
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "procedure.completed",
    aggregateType: "procedure_performed",
    aggregateId: result.procedure.id,
    patientId: result.procedure.patientId,
    payload: {
      procedurePerformedId: result.procedure.id,
      encounterId,
      patientId: result.procedure.patientId,
      treatmentPlanId: result.procedure.treatmentPlanId,
      treatmentPlanEstimateItemId: result.procedure.treatmentPlanEstimateItemId
    }
  });

  return created({
    procedure: publicProcedurePerformed(result.procedure),
    treatmentPlan: publicTreatmentPlanDetail(result.treatmentPlan)
  });
}

export async function createInvoice(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "billing.write" });
  const input = parseCreateInvoice(body);
  const result = await billingRepositoryOperation(
    () => dependencies.repository.createInvoice(scopeFrom(context), input),
    {
      treatment_plan_id: input.treatmentPlanId ?? null,
      procedure_performed_ids: input.procedurePerformedIds ?? []
    }
  );
  if (!result) {
    throw conflict("Invoice requires completed, accepted, uninvoiced procedure evidence.", {
      treatment_plan_id: input.treatmentPlanId ?? null,
      procedure_performed_ids: input.procedurePerformedIds ?? []
    });
  }

  await audit(context, dependencies, "invoice.created", {
    patientId: result.invoiceDetail.invoice.patientId,
    resourceType: "invoice",
    resourceId: result.invoiceDetail.invoice.id,
    metadata: invoiceAuditMetadata(result.invoiceDetail)
  });
  await appendOutbox(context, dependencies, {
    eventType: "invoice.created",
    aggregateType: "invoice",
    aggregateId: result.invoiceDetail.invoice.id,
    patientId: result.invoiceDetail.invoice.patientId,
    payload: {
      invoiceId: result.invoiceDetail.invoice.id,
      invoiceNumber: result.invoiceDetail.invoice.invoiceNumber,
      patientId: result.invoiceDetail.invoice.patientId,
      totalMinor: result.invoiceDetail.invoice.totalMinor,
      procedurePerformedIds: result.procedures.map((procedure) => procedure.id)
    }
  });

  return created({ invoice: publicInvoiceDetail(result.invoiceDetail) });
}

export async function getInvoice(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  invoiceId: UUID
) {
  authorize(context, { permission: "billing.read" });
  const invoice = await dependencies.repository.findInvoiceById(scopeFrom(context), invoiceId);
  if (!invoice) throw notFound("Invoice not found.", { invoice_id: invoiceId });

  await audit(context, dependencies, "invoice.viewed", {
    patientId: invoice.invoice.patientId,
    resourceType: "invoice",
    resourceId: invoice.invoice.id,
    metadata: invoiceAuditMetadata(invoice)
  });

  return ok({ invoice: publicInvoiceDetail(invoice) });
}

export async function createInvoiceReceipt(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  invoiceId: UUID,
  body: unknown
) {
  authorize(context, { permission: "billing.write" });
  const input = parseCreateReceipt(body);
  const result = await billingRepositoryOperation(
    () => dependencies.repository.createReceipt(scopeFrom(context), invoiceId, input),
    {
      invoice_id: invoiceId,
      payment_transaction_ids: input.paymentTransactionIds ?? []
    }
  );
  if (!result) throw notFound("Invoice not found.", { invoice_id: invoiceId });

  await audit(context, dependencies, "receipt.generated", {
    patientId: result.receipt.patientId,
    resourceType: "receipt",
    resourceId: result.receipt.id,
    metadata: {
      invoiceId,
      receiptNumber: result.receipt.receiptNumber,
      amountMinor: result.receipt.amountMinor,
      paymentTransactionIds: result.receipt.paymentAllocations.map(
        (allocation) => allocation.paymentTransactionId
      )
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "receipt.generated",
    aggregateType: "receipt",
    aggregateId: result.receipt.id,
    patientId: result.receipt.patientId,
    payload: {
      receiptId: result.receipt.id,
      invoiceId,
      patientId: result.receipt.patientId,
      receiptNumber: result.receipt.receiptNumber,
      amountMinor: result.receipt.amountMinor
    }
  });

  return created({
    receipt: publicReceipt(result.receipt),
    invoice: publicInvoiceDetail(result.invoiceDetail)
  });
}

export async function listIntakeFormTemplates(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "patient.read" });
  const templates = await dependencies.repository.listIntakeFormTemplates(scopeFrom(context));
  return ok({ templates });
}

export async function createIntakeFormTemplate(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "clinic.manage" });
  const template = await dependencies.repository.createIntakeFormTemplate(
    scopeFrom(context),
    parseCreateIntakeFormTemplate(body)
  );
  return created({ template });
}

export async function submitPatientIntakeForm(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "intake.write" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const input = parseCreateIntakeFormSubmission(body, patientId);
  const template = await dependencies.repository.findIntakeFormTemplateById(
    scope,
    input.templateId
  );
  if (!template || !template.active) {
    throw notFound("Intake form template not found.", { template_id: input.templateId });
  }

  const formResponse = await dependencies.repository.createIntakeFormSubmission(scope, input);

  await audit(context, dependencies, "form_response.submitted", {
    patientId,
    resourceType: "form_response",
    resourceId: formResponse.id,
    metadata: { templateId: input.templateId, source: input.source }
  });
  await appendOutbox(context, dependencies, {
    eventType: "form_response.submitted",
    aggregateType: "form_response",
    aggregateId: formResponse.id,
    patientId,
    payload: {
      formResponseId: formResponse.id,
      patientId,
      templateId: input.templateId,
      source: input.source
    }
  });

  return created({ formResponse, submission: formResponse });
}

export async function listPatientConsents(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const consents = await dependencies.repository.listPatientConsents(scope, patientId);
  const enforcementState = await dependencies.repository.getConsentEnforcementState(
    scope,
    patientId
  );

  await audit(context, dependencies, "consent.enforcement.checked", {
    patientId,
    resourceType: "consent",
    resourceId: patientId,
    metadata: {
      activePurposes: enforcementState.activePurposes,
      revokedPurposes: enforcementState.revokedPurposes
    }
  });

  return ok({ consents, enforcementState });
}

export async function createPatientConsent(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "intake.write" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const input = parseCreateConsent(body, patientId);
  const existing = await dependencies.repository.listPatientConsents(scope, patientId);
  const duplicateActiveConsent = existing.find(
    (consent) => consent.purpose === input.purpose && consent.status === "active"
  );
  if (duplicateActiveConsent) {
    throw conflict("An active consent already exists for this purpose.", {
      consent_id: duplicateActiveConsent.id,
      purpose: input.purpose
    });
  }

  const consent = await dependencies.repository.createConsent(scope, input);
  const enforcementState = await dependencies.repository.getConsentEnforcementState(
    scope,
    patientId
  );

  await audit(context, dependencies, "consent.created", {
    patientId,
    resourceType: "consent",
    resourceId: consent.id,
    metadata: { purpose: consent.purpose, captureMethod: consent.captureMethod }
  });
  await appendOutbox(context, dependencies, {
    eventType: "consent.created",
    aggregateType: "consent",
    aggregateId: consent.id,
    patientId,
    payload: {
      consentId: consent.id,
      patientId,
      purpose: consent.purpose,
      enforcementState
    }
  });

  return created({ consent, enforcementState });
}

export async function revokePatientConsent(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  consentId: UUID,
  body: unknown
) {
  authorize(context, { permission: "intake.write" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const existing = (await dependencies.repository.listPatientConsents(scope, patientId)).find(
    (consent) => consent.id === consentId
  );
  if (!existing) throw notFound("Consent not found.", { consent_id: consentId });
  if (existing.status !== "active") {
    throw conflict("Consent is already revoked.", { consent_id: consentId });
  }

  const consent = await dependencies.repository.revokeConsent(scope, consentId, {
    revocationReason: requiredString(objectBody(body).reason, "reason")
  });
  if (!consent) throw notFound("Consent not found.", { consent_id: consentId });

  const enforcementState = await dependencies.repository.getConsentEnforcementState(
    scope,
    patientId
  );

  await audit(context, dependencies, "consent.revoked", {
    patientId,
    resourceType: "consent",
    resourceId: consent.id,
    metadata: { purpose: consent.purpose, enforcementState }
  });
  await appendOutbox(context, dependencies, {
    eventType: "consent.revoked",
    aggregateType: "consent",
    aggregateId: consent.id,
    patientId,
    payload: {
      consentId: consent.id,
      patientId,
      purpose: consent.purpose,
      enforcementState
    }
  });

  return ok({ consent, enforcementState });
}

export async function createAiScribeSession(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID,
  body: unknown
) {
  authorize(context, { permission: "ai.scribe.write" });
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });
  const input = parseCreateAiScribeSessionInput(body);
  const consents = await dependencies.repository.listPatientConsents(scope, encounter.patientId);
  const readiness = evaluateAiAudioReadiness(consents, {
    requireRawAudioRetention: input.requireRawAudioRetention
  });

  await audit(context, dependencies, "consent.enforcement.checked", {
    patientId: encounter.patientId,
    resourceType: "ai_session",
    resourceId: encounter.id,
    metadata: {
      workflow: "ai_scribe",
      allowed: readiness.allowed,
      blockedReasons: readiness.blockedReasons.map((reason) => ({
        purpose: reason.purpose,
        reason: reason.reason,
        consentId: reason.consentId
      }))
    }
  });

  if (!readiness.allowed) {
    throw conflict("Active AI/audio consent is required before scribe capture or processing.", {
      code: "AI_AUDIO_CONSENT_REQUIRED",
      blockedReasons: readiness.blockedReasons
    });
  }

  const provider = resolveAiGatewayProvider(dependencies);
  const retentionPolicy = defaultAiRetentionPolicy({
    rawAudioRetentionAllowed: input.requireRawAudioRetention,
    providerMode: provider.providerMode
  });
  const session = await dependencies.repository.createAiSession(scope, {
    patientId: encounter.patientId,
    encounterId: encounter.id,
    providerMode: provider.providerMode,
    llmProviderKey: provider.providerKey,
    transcriptionProviderKey:
      dependencies.runtimeConfig?.providers.ai.transcriptionProvider ?? provider.providerKey,
    consentSnapshot: {
      evaluatedAt: readiness.evaluatedAt,
      aiAudioCaptureAllowed: true,
      rawAudioRetentionAllowed: input.requireRawAudioRetention,
      decisionReasons: readiness.decisions.map((decision) => ({
        purpose: decision.purpose,
        allowed: decision.allowed,
        reason: decision.reason,
        consentId: decision.consentId
      }))
    },
    retentionPolicy,
    languageHint: input.languageHint,
    metadata: { source: "api", captureSurface: input.captureSurface }
  });

  await audit(context, dependencies, "ai.session.started", {
    patientId: session.patientId,
    resourceType: "ai_session",
    resourceId: session.id,
    metadata: aiSessionAuditMetadata(session)
  });
  await appendOutbox(context, dependencies, {
    eventType: "ai.session.started",
    aggregateType: "ai_session",
    aggregateId: session.id,
    patientId: session.patientId,
    payload: aiSessionAuditMetadata(session)
  });

  return created({ session: toPublicAiSession(session) });
}

export async function getAiScribeSession(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  sessionId: UUID
) {
  authorize(context, { permission: "ai.scribe.read" });
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  const detail = await dependencies.repository.findAiSessionDetail(scopeFrom(context), sessionId);
  if (!detail) throw notFound("AI scribe session not found.", { session_id: sessionId });
  return ok({ aiScribeSession: toPublicAiSessionDetail(detail) });
}

export async function listEncounterAiScribeSessions(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID
) {
  authorize(context, { permission: "ai.scribe.read" });
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });
  const sessions = await dependencies.repository.listAiSessionsForEncounter(scope, encounterId);
  return ok({ sessions: sessions.map(toPublicAiSession) });
}

export async function createAiScribeTranscriptSegment(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  sessionId: UUID,
  body: unknown
) {
  authorize(context, { permission: "ai.scribe.write" });
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  const scope = scopeFrom(context);
  const session = await dependencies.repository.findAiSessionById(scope, sessionId);
  if (!session) throw notFound("AI scribe session not found.", { session_id: sessionId });
  await assertAiConsentStillActive(context, dependencies, session, {
    requireRawAudioRetention: session.retentionPolicy.rawAudioRetention === "retain_until"
  });

  const input = parseCreateAiTranscriptSegmentInput(body);
  const result = await dependencies.repository.createAiTranscriptSegment(scope, sessionId, {
    ...input,
    sourceHash: sha256Text(input.text)
  });
  if (!result)
    throw conflict("AI scribe session is not accepting transcript segments.", {
      session_id: sessionId
    });

  await audit(context, dependencies, "ai.transcript.segment_created", {
    patientId: session.patientId,
    resourceType: "ai_transcript_segment",
    resourceId: result.segment.id,
    metadata: {
      sessionId,
      encounterId: session.encounterId,
      sequence: result.segment.sequence,
      sourceHash: result.segment.sourceHash
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "ai.transcript.segment_created",
    aggregateType: "ai_transcript_segment",
    aggregateId: result.segment.id,
    patientId: session.patientId,
    payload: {
      sessionId,
      encounterId: session.encounterId,
      sequence: result.segment.sequence,
      sourceAnchorId: result.sourceAnchor.id
    }
  });

  return created({
    segment: toPublicAiTranscriptSegment(result.segment),
    sourceAnchor: result.sourceAnchor
  });
}

export async function createAiScribeSourceAnchor(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  sessionId: UUID,
  body: unknown
) {
  authorize(context, { permission: "ai.scribe.write" });
  const input = parseCreateAiSourceAnchorInput(body);
  const anchor = await dependencies.repository.createAiSourceAnchor(
    scopeFrom(context),
    sessionId,
    input
  );
  if (!anchor) throw notFound("AI scribe session not found.", { session_id: sessionId });
  return created({ sourceAnchor: anchor });
}

export async function generateAiScribeDrafts(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  sessionId: UUID,
  body: unknown
) {
  authorize(context, { permission: "ai.scribe.write" });
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  const scope = scopeFrom(context);
  const detail = await dependencies.repository.findAiSessionDetail(scope, sessionId);
  if (!detail) throw notFound("AI scribe session not found.", { session_id: sessionId });
  await assertAiConsentStillActive(context, dependencies, detail.session, {
    requireRawAudioRetention: detail.session.retentionPolicy.rawAudioRetention === "retain_until"
  });
  if (detail.transcriptSegments.length === 0) {
    throw validation("Transcript segments are required before draft generation.", {
      session_id: sessionId
    });
  }

  const input = parseGenerateAiDraftsInput(body);
  const sourceAnchorIds =
    input.sourceAnchorIds.length > 0
      ? input.sourceAnchorIds
      : detail.sourceAnchors
          .filter((anchor) => anchor.anchorType === "transcript_segment")
          .map((anchor) => anchor.id);
  const selectedAnchors = detail.sourceAnchors.filter((anchor) =>
    sourceAnchorIds.includes(anchor.id)
  );
  if (selectedAnchors.length !== sourceAnchorIds.length) {
    throw validation("Every sourceAnchorId must belong to the AI scribe session.", {
      sourceAnchorIds
    });
  }
  const unsupportedAnchors = selectedAnchors.filter((anchor) => !anchor.supported);
  if (unsupportedAnchors.length > 0) {
    throw validation("Unsupported source anchors cannot support AI draft generation.", {
      unsupportedSourceAnchorIds: unsupportedAnchors.map((anchor) => anchor.id)
    });
  }

  const provider = resolveAiGatewayProvider(dependencies);
  let providerResult;
  try {
    providerResult = await provider.generateDrafts({
      tenantId: context.accessContext.tenant.id,
      clinicId: context.clinicId,
      patientId: detail.session.patientId,
      encounterId: detail.session.encounterId,
      sessionId,
      segments: detail.transcriptSegments,
      sourceAnchorIds,
      correlationId: context.requestId
    });
  } catch (error) {
    if (error instanceof AiGatewayProviderError) {
      await dependencies.repository.createAiJob(scope, sessionId, {
        jobType: "draft_generation",
        status: "blocked",
        providerMode: provider.providerMode,
        providerKey: provider.providerKey,
        inputDigest: sha256Json({ sessionId, sourceAnchorIds }),
        outputSummary: { providerStatus: error.status },
        errorCode: error.status,
        errorMessage: error.message,
        completedAt: nowIso(dependencies)
      });
      throw new ApiError(503, "AI_PROVIDER_UNAVAILABLE", error.message, {
        providerKey: error.providerKey,
        status: error.status
      });
    }
    throw error;
  }

  const job = await dependencies.repository.createAiJob(scope, sessionId, {
    jobType: "draft_generation",
    status: "succeeded",
    providerMode: providerResult.providerMode,
    providerKey: providerResult.providerKey,
    inputDigest: sha256Json({ sessionId, sourceAnchorIds }),
    outputSummary: {
      outputTypes: ["clinical_note_draft", "dental_chart_patch_draft"],
      actionProposalCount: providerResult.actionProposals.length
    },
    completedAt: nowIso(dependencies)
  });
  if (!job) throw notFound("AI scribe session not found.", { session_id: sessionId });

  const clinicalSourceAnchorIds = providerResult.clinicalNoteDraft.sourceAnchorIds.map((value) =>
    uuidField(value, "providerResult.clinicalNoteDraft.sourceAnchorIds")
  );
  const dentalSourceAnchorIds = providerResult.dentalChartPatchDraft.sourceAnchorIds.map((value) =>
    uuidField(value, "providerResult.dentalChartPatchDraft.sourceAnchorIds")
  );
  const dentalChartPatchContent = {
    ...providerResult.dentalChartPatchDraft.content,
    encounterId: uuidField(
      providerResult.dentalChartPatchDraft.content.encounterId,
      "providerResult.dentalChartPatchDraft.content.encounterId"
    ),
    findings: providerResult.dentalChartPatchDraft.content.findings.map((finding) => ({
      ...finding,
      sourceAnchorIds: finding.sourceAnchorIds.map((value) =>
        uuidField(value, "providerResult.dentalChartPatchDraft.content.findings.sourceAnchorIds")
      )
    })),
    warnings: [...providerResult.dentalChartPatchDraft.content.warnings]
  };

  const clinicalOutput = await dependencies.repository.createAiDraftOutput(scope, sessionId, {
    jobId: job.id,
    outputType: "clinical_note_draft",
    content: providerResult.clinicalNoteDraft.content,
    confidence: providerResult.clinicalNoteDraft.confidence,
    warnings: providerResult.clinicalNoteDraft.warnings,
    sourceAnchorIds: clinicalSourceAnchorIds,
    schemaVersion: "ClinicalNoteDraft.v1",
    providerMode: providerResult.providerMode,
    providerRequestDigest: providerResult.providerRequestDigest
  });
  const chartOutput = await dependencies.repository.createAiDraftOutput(scope, sessionId, {
    jobId: job.id,
    outputType: "dental_chart_patch_draft",
    content: dentalChartPatchContent,
    confidence: providerResult.dentalChartPatchDraft.confidence,
    warnings: providerResult.dentalChartPatchDraft.warnings,
    sourceAnchorIds: dentalSourceAnchorIds,
    schemaVersion: "DentalChartPatchDraft.v1",
    providerMode: providerResult.providerMode,
    providerRequestDigest: providerResult.providerRequestDigest
  });
  if (!clinicalOutput || !chartOutput) {
    throw notFound("AI scribe session not found.", { session_id: sessionId });
  }

  const proposals = [];
  for (const proposal of providerResult.actionProposals) {
    const createdProposal = await dependencies.repository.createAiActionProposal(scope, sessionId, {
      outputId: clinicalOutput.id,
      proposalType: proposal.proposalType,
      title: proposal.title,
      description: proposal.description,
      proposedPayload: proposal.proposedPayload,
      requiredPermission: proposal.requiredPermission,
      sourceAnchorIds: proposal.sourceAnchorIds.map((value) =>
        uuidField(value, "providerResult.actionProposals.sourceAnchorIds")
      ),
      providerMode: providerResult.providerMode
    });
    if (createdProposal) {
      proposals.push(createdProposal);
      await audit(context, dependencies, "ai.action_proposal.created", {
        patientId: detail.session.patientId,
        resourceType: "ai_action_proposal",
        resourceId: createdProposal.id,
        metadata: {
          sessionId,
          encounterId: detail.session.encounterId,
          proposalType: createdProposal.proposalType,
          requiredPermission: createdProposal.requiredPermission,
          reviewStatus: createdProposal.reviewStatus
        }
      });
      await appendOutbox(context, dependencies, {
        eventType: "ai.action_proposal.created",
        aggregateType: "ai_action_proposal",
        aggregateId: createdProposal.id,
        patientId: detail.session.patientId,
        payload: {
          sessionId,
          encounterId: detail.session.encounterId,
          proposalType: createdProposal.proposalType,
          requiredPermission: createdProposal.requiredPermission,
          reviewStatus: createdProposal.reviewStatus
        }
      });
    }
  }

  await audit(context, dependencies, "ai.draft.generated", {
    patientId: detail.session.patientId,
    resourceType: "ai_session",
    resourceId: sessionId,
    metadata: {
      sessionId,
      jobId: job.id,
      outputIds: [clinicalOutput.id, chartOutput.id],
      providerMode: providerResult.providerMode
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "ai.draft.generated",
    aggregateType: "ai_session",
    aggregateId: sessionId,
    patientId: detail.session.patientId,
    payload: {
      sessionId,
      jobId: job.id,
      outputIds: [clinicalOutput.id, chartOutput.id],
      proposalIds: proposals.map((proposal) => proposal.id)
    }
  });

  return created({
    job,
    draftOutputs: [clinicalOutput, chartOutput],
    actionProposals: proposals
  });
}

export async function recordAiScribeReviewDecision(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  sessionId: UUID,
  body: unknown
) {
  authorize(context, { permission: "ai.scribe.review" });
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  const input = parseRecordAiReviewDecisionInput(body);
  const decision = await dependencies.repository.recordAiReviewDecision(
    scopeFrom(context),
    sessionId,
    input
  );
  if (!decision)
    throw notFound("AI review target not found.", {
      session_id: sessionId,
      target_id: input.targetId
    });
  const session = await dependencies.repository.findAiSessionById(scopeFrom(context), sessionId);
  if (!session) throw notFound("AI scribe session not found.", { session_id: sessionId });

  await audit(context, dependencies, "ai.review_decision.recorded", {
    patientId: session.patientId,
    resourceType: "ai_review_decision",
    resourceId: decision.id,
    metadata: {
      sessionId,
      targetType: decision.targetType,
      targetId: decision.targetId,
      decision: decision.decision,
      appliedWorkflow: decision.appliedWorkflow,
      appliedRecordId: decision.appliedRecordId
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "ai.review_decision.recorded",
    aggregateType: "ai_review_decision",
    aggregateId: decision.id,
    patientId: session.patientId,
    payload: {
      sessionId,
      targetType: decision.targetType,
      targetId: decision.targetId,
      decision: decision.decision,
      appliedWorkflow: "review_only",
      appliedRecordId: null
    }
  });
  return ok({ reviewDecision: decision });
}

export async function deleteAiScribeRetainedPayloads(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  sessionId: UUID
) {
  authorize(context, { permission: "ai.scribe.review" });
  const scope = scopeFrom(context);
  const result = await dependencies.repository.deleteAiSessionRetainedPayloads(scope, sessionId);
  if (!result) throw notFound("AI scribe session not found.", { session_id: sessionId });
  await dependencies.repository.createAiJob(scope, sessionId, {
    jobType: "retention_delete",
    status: "succeeded",
    providerMode: result.session.providerMode,
    providerKey: result.session.llmProviderKey,
    inputDigest: sha256Json({
      sessionId,
      deletedTranscriptSegments: result.deletedTranscriptSegments
    }),
    outputSummary: {
      deletedTranscriptSegments: result.deletedTranscriptSegments,
      deletedRawAudioReferences: result.deletedRawAudioReferences
    },
    completedAt: nowIso(dependencies)
  });
  await audit(context, dependencies, "ai.retention.deleted", {
    patientId: result.session.patientId,
    resourceType: "ai_session",
    resourceId: sessionId,
    metadata: {
      deletedTranscriptSegments: result.deletedTranscriptSegments,
      deletedRawAudioReferences: result.deletedRawAudioReferences
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "ai.retention.deleted",
    aggregateType: "ai_session",
    aggregateId: sessionId,
    patientId: result.session.patientId,
    payload: {
      deletedTranscriptSegments: result.deletedTranscriptSegments,
      deletedRawAudioReferences: result.deletedRawAudioReferences
    }
  });
  return ok(result);
}

export async function createEncounter(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "clinical.note.write" });
  const scope = scopeFrom(context);
  const input = parseCreateEncounter(body);
  const patient = await dependencies.repository.findPatientById(scope, input.patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: input.patientId });

  if (input.appointmentId) {
    const appointment = await dependencies.repository.findAppointmentById(
      scope,
      input.appointmentId
    );
    if (!appointment)
      throw notFound("Appointment not found.", { appointment_id: input.appointmentId });
    if (appointment.patientId !== input.patientId) {
      throw validation("Appointment does not belong to the encounter patient.", {
        appointment_id: appointment.id,
        patient_id: input.patientId
      });
    }
  }

  const encounter = await dependencies.repository.createEncounter(scope, input);

  await audit(context, dependencies, "encounter.created", {
    patientId: encounter.patientId,
    resourceType: "encounter",
    resourceId: encounter.id,
    metadata: { appointmentId: encounter.appointmentId, providerUserId: encounter.providerUserId }
  });
  await appendOutbox(context, dependencies, {
    eventType: "encounter.created",
    aggregateType: "encounter",
    aggregateId: encounter.id,
    patientId: encounter.patientId,
    payload: { encounterId: encounter.id, patientId: encounter.patientId, status: encounter.status }
  });

  return created({ encounter });
}

export async function getEncounter(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID
) {
  authorize(context, { permission: "clinical.note.read" });
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  const noteVersions = await dependencies.repository.listClinicalNoteVersions(scope, encounterId);
  return ok({ encounter, noteVersions });
}

export async function startEncounter(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID
) {
  authorize(context, { permission: "clinical.note.write" });
  const scope = scopeFrom(context);
  const existing = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!existing) throw notFound("Encounter not found.", { encounter_id: encounterId });

  try {
    assertEncounterTransition(existing.status, "drafting");
  } catch (error) {
    throw conflict(error instanceof Error ? error.message : "Invalid encounter transition.", {
      encounter_id: encounterId,
      from_status: existing.status,
      to_status: "drafting"
    });
  }
  const encounter = await dependencies.repository.transitionEncounter(
    scope,
    encounterId,
    "drafting",
    "encounter_started"
  );
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  await audit(context, dependencies, "encounter.started", {
    patientId: encounter.patientId,
    resourceType: "encounter",
    resourceId: encounter.id,
    metadata: { appointmentId: encounter.appointmentId }
  });
  await appendOutbox(context, dependencies, {
    eventType: "encounter.started",
    aggregateType: "encounter",
    aggregateId: encounter.id,
    patientId: encounter.patientId,
    payload: { encounterId: encounter.id, patientId: encounter.patientId, status: encounter.status }
  });

  return ok({ encounter });
}

export async function saveEncounterClinicalNoteDraft(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID,
  body: unknown
) {
  authorize(context, { permission: "clinical.note.write" });
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });
  if (["signed", "amended", "closed", "cancelled"].includes(encounter.status)) {
    throw conflict("Signed or closed encounters cannot be edited through the draft endpoint.", {
      encounter_id: encounterId,
      status: encounter.status
    });
  }

  const input = parseSaveClinicalNoteDraft(body);
  if (!hasClinicalNoteContent(input.content)) {
    throw validation("Clinical note draft requires at least one note section.", {
      field: "content"
    });
  }

  const note = await dependencies.repository.saveClinicalNoteDraft(scope, encounterId, input);
  if (!note) {
    throw conflict("Clinical note draft could not be saved for this encounter state.", {
      encounter_id: encounterId,
      status: encounter.status
    });
  }
  const updatedEncounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!updatedEncounter) {
    throw new Error("Encounter could not be reloaded after saving the clinical note draft.");
  }

  await audit(context, dependencies, "clinical_note.draft_created", {
    patientId: encounter.patientId,
    resourceType: "clinical_note",
    resourceId: note.id,
    metadata: { encounterId, readyForSign: input.readyForSign === true }
  });
  await appendOutbox(context, dependencies, {
    eventType: "clinical_note.draft_created",
    aggregateType: "clinical_note",
    aggregateId: note.id,
    patientId: encounter.patientId,
    payload: { encounterId, noteVersionId: note.id, versionNumber: note.versionNumber }
  });

  return ok({ encounter: updatedEncounter, note });
}

export async function signEncounterClinicalNote(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID
) {
  authorizeDoctorSignature(context, "clinical.note.sign");
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  const draft = (await dependencies.repository.listClinicalNoteVersions(scope, encounterId)).find(
    (note) => note.status === "draft"
  );
  if (!draft) {
    throw validation("Encounter does not have a draft clinical note to sign.", {
      encounter_id: encounterId
    });
  }
  if (!hasClinicalNoteContent(draft.content)) {
    throw validation("Clinical note content is required before signing.", {
      clinical_note_version_id: draft.id
    });
  }

  const result = await dependencies.repository.signClinicalNote(scope, encounterId);
  if (!result) throw notFound("Encounter not found.", { encounter_id: encounterId });

  await audit(context, dependencies, "clinical_note.signed", {
    patientId: result.note.patientId,
    resourceType: "clinical_note",
    resourceId: result.note.id,
    metadata: { encounterId, versionNumber: result.note.versionNumber }
  });
  await appendOutbox(context, dependencies, {
    eventType: "clinical_note.signed",
    aggregateType: "clinical_note",
    aggregateId: result.note.id,
    patientId: result.note.patientId,
    payload: {
      encounterId,
      noteVersionId: result.note.id,
      versionNumber: result.note.versionNumber
    }
  });

  return ok(result);
}

export async function amendEncounterClinicalNote(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID,
  body: unknown
) {
  authorizeDoctorSignature(context, "clinical.note.sign");
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  const input = parseAmendClinicalNote(body);
  if (!hasClinicalNoteContent(input.content)) {
    throw validation("Clinical note amendment requires at least one note section.", {
      field: "content"
    });
  }

  const result = await dependencies.repository.amendClinicalNote(scope, encounterId, input);
  if (!result) {
    throw conflict("Encounter does not have a signed note to amend.", {
      encounter_id: encounterId
    });
  }

  await audit(context, dependencies, "clinical_note.amended", {
    patientId: result.note.patientId,
    resourceType: "clinical_note",
    resourceId: result.note.id,
    metadata: {
      encounterId,
      versionNumber: result.note.versionNumber,
      amendedFromVersionId: result.amendedFrom.id
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "clinical_note.amended",
    aggregateType: "clinical_note",
    aggregateId: result.note.id,
    patientId: result.note.patientId,
    payload: {
      encounterId,
      noteVersionId: result.note.id,
      amendedFromVersionId: result.amendedFrom.id,
      versionNumber: result.note.versionNumber
    }
  });

  return ok(result);
}

export async function createEncounterPrescription(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID,
  body: unknown
) {
  authorize(context, { permission: "prescription.write" });
  const input = parseCreatePrescription(body);
  try {
    assertPrescriptionMedicationList(input.medications);
  } catch (error) {
    throw validation(error instanceof Error ? error.message : "Invalid prescription medications.", {
      field: "medications"
    });
  }
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  const prescription = await dependencies.repository.createPrescription(scope, encounterId, input);
  if (!prescription) throw notFound("Encounter not found.", { encounter_id: encounterId });

  await audit(context, dependencies, "prescription.draft_created", {
    patientId: prescription.patientId,
    resourceType: "prescription",
    resourceId: prescription.id,
    metadata: { encounterId, medicationCount: prescription.medications.length }
  });
  await appendOutbox(context, dependencies, {
    eventType: "prescription.draft_created",
    aggregateType: "prescription",
    aggregateId: prescription.id,
    patientId: prescription.patientId,
    payload: {
      prescriptionId: prescription.id,
      encounterId,
      patientId: prescription.patientId,
      medicationCount: prescription.medications.length
    }
  });

  return created({ prescription });
}

export async function signPrescription(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  prescriptionId: UUID
) {
  authorizeDoctorSignature(context, "prescription.sign");
  const scope = scopeFrom(context);
  const existing = await dependencies.repository.findPrescriptionById(scope, prescriptionId);
  if (!existing) throw notFound("Prescription not found.", { prescription_id: prescriptionId });
  if (existing.status !== "draft") {
    throw conflict("Prescription is already signed.", { prescription_id: prescriptionId });
  }

  const prescription = await dependencies.repository.signPrescription(scope, prescriptionId);
  if (!prescription) throw notFound("Prescription not found.", { prescription_id: prescriptionId });

  await audit(context, dependencies, "prescription.signed", {
    patientId: prescription.patientId,
    resourceType: "prescription",
    resourceId: prescription.id,
    metadata: {
      encounterId: prescription.encounterId,
      medicationCount: prescription.medications.length
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "prescription.signed",
    aggregateType: "prescription",
    aggregateId: prescription.id,
    patientId: prescription.patientId,
    payload: {
      prescriptionId: prescription.id,
      encounterId: prescription.encounterId,
      patientId: prescription.patientId,
      medicationCount: prescription.medications.length
    }
  });

  return ok({ prescription });
}

export async function createPatientInstruction(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient_instruction.write" });
  const input = parseCreatePatientInstruction(body);
  const instruction = await dependencies.repository.createPatientInstruction(
    scopeFrom(context),
    patientId,
    input
  );
  if (!instruction) throw notFound("Patient not found.", { patient_id: patientId });

  const eventType =
    instruction.channel === "print" ? "instruction.print_requested" : "instruction.send_requested";
  const payload = {
    instructionId: instruction.id,
    patientId,
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

  await audit(context, dependencies, eventType, {
    patientId,
    resourceType: "patient_instruction",
    resourceId: instruction.id,
    metadata: payload
  });
  await appendOutbox(context, dependencies, {
    eventType,
    aggregateType: "patient_instruction",
    aggregateId: instruction.id,
    patientId,
    payload
  });

  const responseBody = { instruction: publicPatientInstruction(instruction) };
  return instruction.channel === "whatsapp" ? accepted(responseBody) : created(responseBody);
}

export async function getPatientDentalChart(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.read" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const view = await dependencies.repository.getDentalChart(scope, patientId);
  if (!view) throw notFound("Dental chart not found.", { patient_id: patientId });

  const history = await Promise.all(
    view.findings.map(async (finding) => ({
      findingId: finding.id,
      entries: (await dependencies.repository.listDentalFindingHistory(scope, finding.id)).map(
        publicDentalFindingHistory
      )
    }))
  );

  await audit(context, dependencies, "dental_chart.viewed", {
    patientId,
    resourceType: "dental_chart",
    resourceId: view.chart.id,
    metadata: {
      findingCount: view.findings.length,
      snapshotCount: view.snapshots.length,
      numberingSystem: publicDentalNumberingSystem(view.chart.numberingSystem)
    }
  });

  return ok({
    dentalChart: publicDentalChart(view.chart),
    findings: view.findings.map(publicDentalFinding),
    history,
    snapshots: view.snapshots.map(publicDentalChartSnapshot)
  });
}

export async function createPatientDentalFinding(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  const input = parseCreateDentalFinding(body);
  return createDentalFindingForPatient(context, dependencies, patientId, input);
}

export async function createEncounterDentalFinding(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.write" });
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  const input = parseCreateDentalFinding(body, { encounterId });
  return createDentalFindingForPatient(context, dependencies, encounter.patientId, input, {
    preauthorized: true
  });
}

export async function updateDentalFinding(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  findingId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.write" });
  const input = parseUpdateDentalFinding(body);
  const result = await dependencies.repository.updateDentalFinding(
    scopeFrom(context),
    findingId,
    input
  );
  if (!result) throw notFound("Dental finding not found.", { dental_finding_id: findingId });

  await audit(context, dependencies, "dental_finding.updated", {
    patientId: result.finding.patientId,
    resourceType: "dental_finding",
    resourceId: result.finding.id,
    metadata: dentalFindingAuditMetadata(result.finding)
  });
  await appendOutbox(context, dependencies, {
    eventType: "dental.finding.updated",
    aggregateType: "dental_finding",
    aggregateId: result.finding.id,
    patientId: result.finding.patientId,
    payload: {
      findingId: result.finding.id,
      patientId: result.finding.patientId,
      encounterId: result.finding.encounterId,
      toothNumber: result.finding.toothNumber,
      surface: result.finding.surface,
      findingType: result.finding.findingType,
      reviewStatus: result.finding.reviewStatus
    }
  });

  return ok({
    finding: publicDentalFinding(result.finding),
    history: publicDentalFindingHistory(result.history)
  });
}

export async function listDentalFindingHistory(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  findingId: UUID
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.read" });
  const history = await dependencies.repository.listDentalFindingHistory(
    scopeFrom(context),
    findingId
  );

  return ok({ history: history.map(publicDentalFindingHistory) });
}

export async function createDentalChartSnapshot(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.snapshot" });
  const input = parseDentalChartSnapshot(body);
  const snapshot = await dependencies.repository.createDentalChartSnapshot(
    scopeFrom(context),
    patientId,
    input
  );
  if (!snapshot)
    throw notFound("Patient or dental chart context not found.", { patient_id: patientId });

  await audit(context, dependencies, "dental_chart.snapshot_created", {
    patientId: snapshot.patientId,
    resourceType: "dental_chart_snapshot",
    resourceId: snapshot.id,
    metadata: {
      encounterId: snapshot.encounterId,
      snapshotVersion: snapshot.snapshotVersion,
      findingCount: snapshot.chartState.findingCount
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "dental.chart.snapshot_created",
    aggregateType: "dental_chart_snapshot",
    aggregateId: snapshot.id,
    patientId: snapshot.patientId,
    payload: {
      snapshotId: snapshot.id,
      patientId: snapshot.patientId,
      encounterId: snapshot.encounterId,
      snapshotVersion: snapshot.snapshotVersion,
      findingCount: snapshot.chartState.findingCount
    }
  });

  return created({ snapshot: publicDentalChartSnapshot(snapshot) });
}

export async function requestMediaUploadUrl(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "media.write" });
  const storage = mediaStorageFrom(dependencies);
  const input = parseMediaUploadRequest(body);
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, input.patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: input.patientId });

  if (input.encounterId) {
    const encounter = await dependencies.repository.findEncounterById(scope, input.encounterId);
    if (!encounter) throw notFound("Encounter not found.", { encounter_id: input.encounterId });
    if (encounter.patientId !== input.patientId) {
      throw validation("Encounter does not belong to the media patient.", {
        encounter_id: encounter.id,
        patient_id: input.patientId
      });
    }
  }

  const uploadId = randomUUID() as UUID;
  const expiresAt = new Date(nowDate(dependencies).getTime() + 10 * 60 * 1000).toISOString();
  const objectKey = storage.buildObjectKey({
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    patientId: input.patientId,
    uploadId,
    originalFilename: input.originalFilename
  });
  const reservation = await dependencies.repository.createMediaUploadReservation(scope, {
    id: uploadId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    toothNumber: input.toothNumber,
    dentalFindingId: input.dentalFindingId,
    mediaType: input.mediaType,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    expectedFileSizeBytes: input.fileSizeBytes,
    expectedSha256Digest: input.sha256Digest,
    objectKey,
    storageProvider: storage.providerKey,
    storageRegion: storage.region,
    expiresAt,
    tags: input.tags,
    provenance: input.provenance
  });
  const uploadTarget = await storage.createUploadTarget({
    uploadId,
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    patientId: input.patientId,
    objectKey,
    mimeType: input.mimeType,
    expectedFileSizeBytes: input.fileSizeBytes,
    expectedSha256Digest: input.sha256Digest,
    expiresAt
  });

  await audit(context, dependencies, "media.upload_requested", {
    patientId: input.patientId,
    resourceType: "media_upload",
    resourceId: reservation.id,
    metadata: mediaAuditMetadata(reservation)
  });
  await appendOutbox(context, dependencies, {
    eventType: "media.upload_requested",
    aggregateType: "media_upload",
    aggregateId: reservation.id,
    patientId: input.patientId,
    payload: {
      uploadId: reservation.id,
      patientId: input.patientId,
      mediaType: input.mediaType,
      encounterId: input.encounterId,
      toothNumber: input.toothNumber,
      dentalFindingId: input.dentalFindingId
    }
  });

  return created({
    upload: toPublicMediaUploadReservation(reservation),
    uploadTarget
  });
}

export async function receiveMediaUploadContent(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  uploadId: UUID,
  input: { body: Buffer; contentType?: string | null }
) {
  authorize(context, { permission: "media.write" });
  const storage = mediaStorageFrom(dependencies);
  const reservation = await dependencies.repository.findMediaUploadReservationById(
    scopeFrom(context),
    uploadId
  );
  if (!reservation) throw notFound("Media upload reservation not found.", { upload_id: uploadId });
  assertMediaUploadOpen(reservation, nowDate(dependencies).getTime());
  if (input.body.byteLength !== reservation.expectedFileSizeBytes) {
    throw validation("Uploaded object size does not match the reserved media metadata.", {
      upload_id: uploadId,
      expected_bytes: reservation.expectedFileSizeBytes,
      received_bytes: input.body.byteLength
    });
  }
  const contentType = input.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType !== reservation.mimeType.toLowerCase()) {
    throw validation("Uploaded object content-type does not match the reserved media metadata.", {
      upload_id: uploadId,
      expected_mime_type: reservation.mimeType,
      received_mime_type: contentType || null
    });
  }

  const object = await storage.receiveUpload({
    objectKey: reservation.objectKey,
    body: input.body,
    mimeType: reservation.mimeType,
    metadata: {
      tenant_id: reservation.tenantId,
      clinic_id: reservation.clinicId,
      patient_id: reservation.patientId,
      upload_id: reservation.id
    }
  });
  if (
    reservation.expectedSha256Digest &&
    object.sha256Digest !== reservation.expectedSha256Digest
  ) {
    throw validation("Uploaded object digest does not match the reserved media metadata.", {
      upload_id: uploadId
    });
  }

  return ok({
    upload: toPublicMediaUploadReservation(reservation),
    object: {
      contentLength: object.contentLength,
      mimeType: object.mimeType,
      sha256Digest: object.sha256Digest,
      storedAt: object.storedAt
    }
  });
}

export async function completeMediaUpload(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  uploadId: UUID,
  body: unknown
) {
  authorize(context, { permission: "media.write" });
  const storage = mediaStorageFrom(dependencies);
  const input = parseCompleteMediaUpload(body);
  const scope = scopeFrom(context);
  const reservation = await dependencies.repository.findMediaUploadReservationById(scope, uploadId);
  if (!reservation) throw notFound("Media upload reservation not found.", { upload_id: uploadId });
  assertMediaUploadOpen(reservation, nowDate(dependencies).getTime());
  if (input.patientId !== reservation.patientId) {
    throw validation("Complete-upload patient context does not match the upload reservation.", {
      upload_id: uploadId,
      expected_patient_id: reservation.patientId,
      received_patient_id: input.patientId
    });
  }
  if ((input.encounterId ?? null) !== reservation.encounterId) {
    throw validation("Complete-upload encounter context does not match the upload reservation.", {
      upload_id: uploadId,
      expected_encounter_id: reservation.encounterId,
      received_encounter_id: input.encounterId ?? null
    });
  }

  const object = await storage.statObject(reservation.objectKey);
  if (!object) {
    throw conflict("Reserved media object has not been uploaded.", { upload_id: uploadId });
  }
  validateCompletedMediaObject(reservation, object, input);

  const asset = await dependencies.repository.completeMediaUpload(scope, uploadId, {
    contentLength: object.contentLength,
    sha256Digest: object.sha256Digest,
    objectVersion: input.objectVersion,
    scanStatus: input.scanStatus,
    quarantineReason: input.quarantineReason,
    dicomMetadata: input.dicomMetadata
  });
  if (!asset)
    throw conflict("Media upload reservation is no longer completable.", { upload_id: uploadId });

  await audit(context, dependencies, "media.upload_completed", {
    patientId: asset.patientId,
    resourceType: "media_asset",
    resourceId: asset.id,
    metadata: mediaAuditMetadata(asset)
  });
  await appendOutbox(context, dependencies, {
    eventType: "media.upload_completed",
    aggregateType: "media_asset",
    aggregateId: asset.id,
    patientId: asset.patientId,
    payload: {
      mediaAssetId: asset.id,
      uploadId,
      patientId: asset.patientId,
      mediaType: asset.mediaType,
      encounterId: asset.encounterId,
      toothNumber: asset.toothNumber,
      dentalFindingId: asset.dentalFindingId,
      scanStatus: asset.scanStatus
    }
  });

  return created({ mediaAsset: toPublicMediaAsset(asset) });
}

export async function listPatientMediaAssets(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "media.read" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const mediaAssets = (await dependencies.repository.listPatientMediaAssets(scope, patientId)).map(
    toPublicMediaAsset
  );
  return ok({ mediaAssets });
}

export async function createSignedMediaAccess(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  mediaAssetId: UUID,
  body: unknown = {}
) {
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "media.read" });
  const storage = mediaStorageFrom(dependencies);
  const requested = parseSignedMediaAccessRequest(body);
  const asset = await dependencies.repository.findMediaAssetById(scopeFrom(context), mediaAssetId);
  if (!asset) throw notFound("Media asset not found.", { media_asset_id: mediaAssetId });
  if (!mediaAssetCanBeViewed(asset)) {
    throw conflict("Media asset cannot be viewed until scanning clears it.", {
      media_asset_id: mediaAssetId,
      scan_status: asset.scanStatus
    });
  }
  const expiresInSeconds = Math.min(requested.expiresInSeconds ?? 300, 300);
  const expiresAt = new Date(
    nowDate(dependencies).getTime() + expiresInSeconds * 1000
  ).toISOString();
  const access = await storage.createSignedReadAccess({
    objectKey: asset.objectKey,
    mimeType: asset.mimeType,
    expiresAt
  });

  await audit(context, dependencies, "media.viewed", {
    patientId: asset.patientId,
    resourceType: "media_asset",
    resourceId: asset.id,
    metadata: {
      mediaAssetId: asset.id,
      mediaType: asset.mediaType,
      expiresAt: access.expiresAt,
      expiresInSeconds
    }
  });

  return ok({
    mediaAsset: toPublicMediaAsset(asset),
    access
  });
}

export async function createInvoicePaymentRequest(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  invoiceId: UUID,
  body: unknown
) {
  authorize(context, { permission: "billing.write" });
  const provider = paymentProviderFrom(dependencies);
  const scope = scopeFrom(context);
  const invoiceDetail = await dependencies.repository.findInvoiceById(scope, invoiceId);
  if (!invoiceDetail) throw notFound("Invoice not found.", { invoice_id: invoiceId });
  const invoice = invoiceDetail.invoice;
  if (invoice.balanceMinor <= 0) {
    throw conflict("Invoice has no amount due for a new payment request.", {
      invoice_id: invoiceId,
      payment_status: invoice.paymentStatus
    });
  }

  const input = parsePaymentRequest(body, invoice);
  const health = await provider.healthCheck();
  if (
    !health.capabilities.includes(
      input.requestType === "invoice_qr" ? "CREATE_PAYMENT_QR" : "CREATE_PAYMENT_LINKS"
    )
  ) {
    await audit(context, dependencies, "payment.provider.unavailable", {
      patientId: invoice.patientId,
      resourceType: "invoice",
      resourceId: invoice.id,
      metadata: { providerKey: provider.providerKey, providerHealth: health }
    });
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "Payment provider is unavailable for this request type.",
      {
        provider_health: health,
        request_type: input.requestType
      }
    );
  }

  const providerInput = {
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    patientId: invoice.patientId,
    invoiceId: invoice.id,
    amountPaise: input.amountMinor,
    currency: invoice.currency,
    description: input.description,
    expiresAt: input.expiresAt,
    idempotencyKey: context.idempotencyKey,
    customer: input.customer,
    metadata: input.metadata
  };
  let providerResult: PaymentProviderRequestResult;
  try {
    providerResult =
      input.requestType === "invoice_qr"
        ? await provider.createInvoiceQr(providerInput)
        : await provider.createPaymentLink(providerInput);
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      await audit(context, dependencies, "payment.provider.unavailable", {
        patientId: invoice.patientId,
        resourceType: "invoice",
        resourceId: invoice.id,
        metadata: { providerKey: error.providerKey, providerStatus: error.status, ...error.details }
      });
      throw new ApiError(503, "CONFIGURATION_ERROR", error.message, error.details);
    }
    throw error;
  }

  const paymentRequest = await dependencies.repository.createPaymentRequest(scope, {
    invoiceId: invoice.id,
    provider: normalizeBillingPaymentProvider(providerResult.providerKey),
    requestType: normalizePaymentRequestType(providerResult.requestKind),
    amountMinor: providerResult.amountPaise,
    currency: invoice.currency,
    providerReferenceId: providerResult.providerRequestId,
    providerUrl: providerResult.paymentUrl ?? null,
    providerQrPayload: providerResult.qrString ?? providerResult.qrImageUrl ?? null,
    expiresAt: providerResult.expiresAt ?? null,
    metadata: {
      providerStatus: providerResult.status,
      qrImageUrl: providerResult.qrImageUrl ?? null,
      providerMetadata: providerResult.metadata,
      providerHealth: providerResult.providerHealth
    }
  });
  if (!paymentRequest) {
    throw conflict("Payment request could not be created for this invoice state.", {
      invoice_id: invoice.id,
      payment_status: invoice.paymentStatus
    });
  }
  const updatedInvoiceDetail = await dependencies.repository.findInvoiceById(scope, invoice.id);
  if (!updatedInvoiceDetail)
    throw notFound("Invoice not found after payment request.", { invoice_id: invoice.id });

  await audit(context, dependencies, "payment.requested", {
    patientId: invoice.patientId,
    resourceType: "payment_request",
    resourceId: paymentRequest.id,
    metadata: {
      invoiceId,
      providerKey: providerResult.providerKey,
      requestType: paymentRequest.requestType,
      amountMinor: paymentRequest.amountMinor,
      providerHealth: providerResult.providerHealth
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "payment.requested",
    aggregateType: "payment_request",
    aggregateId: paymentRequest.id,
    patientId: invoice.patientId,
    payload: {
      invoiceId,
      paymentRequestId: paymentRequest.id,
      providerKey: providerResult.providerKey,
      requestType: paymentRequest.requestType,
      amountMinor: paymentRequest.amountMinor
    }
  });

  return created({
    invoice: publicInvoiceDetail(updatedInvoiceDetail),
    paymentRequest: publicPaymentRequest(paymentRequest),
    provider: {
      key: provider.providerKey,
      health: providerResult.providerHealth
    }
  });
}

export async function recordInvoiceManualPayment(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  invoiceId: UUID,
  body: unknown
) {
  authorize(context, { permission: "billing.write" });
  const scope = scopeFrom(context);
  const invoiceDetail = await dependencies.repository.findInvoiceById(scope, invoiceId);
  if (!invoiceDetail) throw notFound("Invoice not found.", { invoice_id: invoiceId });
  const invoice = invoiceDetail.invoice;

  const input = parseManualPayment(body);
  if (input.currency !== invoice.currency) {
    throw validation("Manual payment currency must match the invoice currency.", {
      invoice_id: invoiceId,
      invoice_currency: invoice.currency,
      payment_currency: input.currency
    });
  }
  if (input.amountMinor > invoice.balanceMinor) {
    throw conflict("Manual payment amount exceeds the invoice amount due.", {
      invoice_id: invoiceId,
      balance_minor: invoice.balanceMinor,
      received_amount_minor: input.amountMinor
    });
  }

  const idempotencyKey = context.idempotencyKey ?? `manual:${invoiceId}:${input.reference}`;
  const existing = invoiceDetail.payments.find(
    (payment) => payment.provider === "manual" && payment.idempotencyKey === idempotencyKey
  );
  const transaction = await dependencies.repository.recordPaymentTransaction(scope, {
    invoiceId: invoice.id,
    provider: "manual",
    amountMinor: input.amountMinor,
    currency: input.currency,
    method: input.method,
    status: "manually_recorded",
    verificationStatus: "not_required_manual",
    reconciliationStatus: "matched",
    receivedAt: input.receivedAt ?? nowIso(dependencies),
    idempotencyKey,
    recordedByUserId: scope.actorUserId,
    metadata: {
      reason: input.reason,
      reference: input.reference,
      evidence: input.evidence
    }
  });
  if (!transaction) throw notFound("Invoice not found.", { invoice_id: invoiceId });
  const updatedInvoiceDetail = await dependencies.repository.findInvoiceById(scope, invoice.id);
  if (!updatedInvoiceDetail)
    throw notFound("Invoice not found after payment recording.", { invoice_id: invoice.id });
  const replayed = existing?.id === transaction.id;

  await audit(context, dependencies, "payment.manually_recorded", {
    patientId: invoice.patientId,
    resourceType: "payment_transaction",
    resourceId: transaction.id,
    metadata: {
      invoiceId,
      amountMinor: input.amountMinor,
      method: input.method,
      reference: input.reference,
      reason: input.reason,
      replayed
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "payment.manually_recorded",
    aggregateType: "payment_transaction",
    aggregateId: transaction.id,
    patientId: invoice.patientId,
    payload: {
      invoiceId,
      paymentTransactionId: transaction.id,
      amountMinor: transaction.amountMinor,
      paymentStatus: updatedInvoiceDetail.invoice.paymentStatus,
      replayed
    }
  });

  return created({
    invoice: publicInvoiceDetail(updatedInvoiceDetail),
    transaction: publicPaymentTransaction(transaction),
    reconciliationItem: null,
    replayed
  });
}

export async function processPaymentWebhook(
  dependencies: OperationsDependencies,
  input: {
    requestId: string;
    providerKey: string;
    rawBody: string;
    headers: Record<string, string | undefined>;
    receivedAt: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
) {
  const provider = paymentProviderFrom(dependencies);
  const raw: RawPaymentWebhook = {
    providerKey: input.providerKey,
    headers: input.headers,
    rawBody: input.rawBody,
    receivedAt: input.receivedAt
  };
  const verification = await provider.verifyWebhook(raw);

  if (verification.status !== "verified") {
    throw new ApiError(
      verification.status === "invalid_signature" ? 403 : 400,
      verification.status === "invalid_signature" ? "PERMISSION_DENIED" : "VALIDATION_ERROR",
      verification.message,
      {
        verification_status: verification.status,
        provider_event_id: verification.providerEventId ?? null
      }
    );
  }

  let event: PaymentProviderWebhookEvent;
  try {
    event = await provider.parseWebhook(raw);
  } catch (error) {
    throw error;
  }

  const webhookReceiptId = randomUUID() as UUID;
  const eventScope = scopeFromPaymentWebhook(event);
  if (!eventScope || !event.invoiceId || !isUuid(event.invoiceId)) {
    return ok({
      status: "reconciliation_required",
      replayed: false,
      invoice: null,
      transaction: null,
      reconciliationItem: providerReconciliationItem(
        event,
        "missing_invoice_reference",
        event.amountPaise ?? 0
      ),
      providerEvent: publicProviderWebhookEvent(event)
    });
  }

  const invoiceDetail = await dependencies.repository.findInvoiceById(eventScope, event.invoiceId);
  if (!invoiceDetail) {
    return ok({
      status: "reconciliation_required",
      replayed: false,
      invoice: null,
      transaction: null,
      reconciliationItem: providerReconciliationItem(
        event,
        "missing_invoice_reference",
        event.amountPaise ?? 0
      ),
      providerEvent: publicProviderWebhookEvent(event)
    });
  }

  const invoice = invoiceDetail.invoice;
  const providerKey = normalizeBillingPaymentProvider(event.providerKey);
  const existing = invoiceDetail.payments.find(
    (payment) =>
      payment.provider === providerKey &&
      (payment.idempotencyKey === event.idempotencyKey ||
        (event.providerPaymentId && payment.providerPaymentId === event.providerPaymentId))
  );
  if (existing) {
    return ok({
      status: "duplicate",
      replayed: true,
      invoice: publicInvoiceDetail(invoiceDetail),
      transaction: publicPaymentTransaction(existing),
      reconciliationItem: null,
      providerEvent: publicProviderWebhookEvent(event)
    });
  }

  let transaction: PaymentTransactionRecord | null = null;
  let reconciliationItem: PaymentRouteReconciliationItemRecord | null = null;
  let status: "processed" | "ignored" | "reconciliation_required" = "processed";

  if (event.eventKind === "payment_failed") {
    transaction = await dependencies.repository.recordPaymentTransaction(eventScope, {
      invoiceId: invoice.id,
      provider: providerKey,
      providerPaymentId: event.providerPaymentId ?? null,
      providerOrderId: event.providerPaymentRequestId ?? null,
      amountMinor: positiveProviderAmountMinor(event.amountPaise),
      currency: invoice.currency,
      method: event.method ?? "provider_failure",
      status: "failed",
      verificationStatus: "verified",
      reconciliationStatus: "matched",
      idempotencyKey: event.idempotencyKey,
      receivedAt: event.occurredAt,
      recordedByUserId: null,
      metadata: providerPaymentMetadata(event, { webhookReceiptId })
    });
  } else if (event.eventKind !== "payment_succeeded") {
    status = "ignored";
  } else if (event.currency !== invoice.currency || !event.amountPaise || event.amountPaise <= 0) {
    status = "reconciliation_required";
    reconciliationItem = providerReconciliationItem(
      event,
      event.currency !== invoice.currency ? "currency_mismatch" : "manual_review_required",
      event.amountPaise ?? 0
    );
  } else {
    const appliedAmountMinor = Math.min(event.amountPaise, Math.max(invoice.balanceMinor, 0));
    const overpaymentMinor = Math.max(event.amountPaise - appliedAmountMinor, 0);
    if (appliedAmountMinor > 0) {
      transaction = await dependencies.repository.recordPaymentTransaction(eventScope, {
        invoiceId: invoice.id,
        provider: providerKey,
        providerPaymentId: event.providerPaymentId ?? null,
        providerOrderId: event.providerPaymentRequestId ?? null,
        amountMinor: appliedAmountMinor,
        currency: invoice.currency,
        method: event.method ?? "provider",
        status: "succeeded",
        verificationStatus: "verified",
        reconciliationStatus: overpaymentMinor > 0 ? "requires_review" : "matched",
        idempotencyKey: event.idempotencyKey,
        receivedAt: event.occurredAt,
        recordedByUserId: null,
        metadata: providerPaymentMetadata(event, {
          webhookReceiptId,
          providerCapturedAmountMinor: event.amountPaise,
          appliedAmountMinor,
          overpaymentMinor
        })
      });
      if (overpaymentMinor > 0) {
        status = "reconciliation_required";
        reconciliationItem = providerReconciliationItem(event, "overpayment", overpaymentMinor);
      }
    } else {
      status = "reconciliation_required";
      transaction = await dependencies.repository.recordPaymentTransaction(eventScope, {
        invoiceId: invoice.id,
        provider: providerKey,
        providerPaymentId: event.providerPaymentId ?? null,
        providerOrderId: event.providerPaymentRequestId ?? null,
        amountMinor: event.amountPaise,
        currency: invoice.currency,
        method: event.method ?? "provider",
        status: "reconciliation_required",
        verificationStatus: "verified",
        reconciliationStatus: "requires_review",
        idempotencyKey: event.idempotencyKey,
        receivedAt: event.occurredAt,
        recordedByUserId: null,
        metadata: providerPaymentMetadata(event, {
          webhookReceiptId,
          providerCapturedAmountMinor: event.amountPaise,
          appliedAmountMinor: 0,
          overpaymentMinor: event.amountPaise
        })
      });
      reconciliationItem = providerReconciliationItem(event, "overpayment", event.amountPaise);
    }
  }

  const updatedInvoiceDetail = await dependencies.repository.findInvoiceById(
    eventScope,
    invoice.id
  );
  if (!updatedInvoiceDetail)
    throw notFound("Invoice not found after webhook processing.", { invoice_id: invoice.id });

  if (transaction) {
    const eventType =
      status === "reconciliation_required"
        ? "payment.reconciliation_required"
        : event.eventKind === "payment_failed"
          ? "payment.failed"
          : "payment.succeeded";
    await dependencies.repository.appendOutboxEvent(eventScope, {
      eventType,
      aggregateType: "payment_transaction",
      aggregateId: transaction.id,
      patientId: invoice.patientId,
      occurredAt: event.occurredAt,
      payload: {
        invoiceId: invoice.id,
        paymentTransactionId: transaction.id,
        providerKey: event.providerKey,
        providerEventId: event.providerEventId,
        providerPaymentId: event.providerPaymentId ?? null,
        status,
        reconciliationItemId: reconciliationItem?.id ?? null
      }
    });
  }

  if (dependencies.auditSink && updatedInvoiceDetail) {
    const auditAction =
      status === "reconciliation_required"
        ? "payment.reconciliation_required"
        : event.eventKind === "payment_failed"
          ? "payment.failed"
          : "payment.succeeded";
    await dependencies.auditSink.appendAuditEvent(
      createAuditEvent({
        tenantId: updatedInvoiceDetail.invoice.tenantId,
        clinicId: updatedInvoiceDetail.invoice.clinicId,
        actor: { type: "integration", id: event.providerKey },
        action: auditAction,
        patientId: updatedInvoiceDetail.invoice.patientId,
        resourceType: "payment_webhook",
        resourceId: webhookReceiptId,
        metadata: {
          providerKey: event.providerKey,
          providerEventId: event.providerEventId,
          providerPaymentId: event.providerPaymentId ?? null,
          invoiceId: updatedInvoiceDetail.invoice.id,
          replayed: false,
          status,
          reconciliationItemId: reconciliationItem?.id ?? null,
          transactionId: transaction?.id ?? null
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        correlationId: input.requestId
      })
    );
  }

  return ok({
    status,
    replayed: false,
    invoice: publicInvoiceDetail(updatedInvoiceDetail),
    transaction: transaction ? publicPaymentTransaction(transaction) : null,
    reconciliationItem,
    providerEvent: publicProviderWebhookEvent(event)
  });
}

async function bookAppointment(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  input: CreateAppointmentInput & { allowConflictOverride?: boolean }
): Promise<AppointmentRecord> {
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, input.patientId);

  if (!patient) throw notFound("Patient not found.", { patient_id: input.patientId });

  const conflicts = await dependencies.repository.findAppointmentConflicts(scope, {
    providerUserId: input.providerUserId,
    chairId: input.chairId ?? null,
    startAt: input.startAt,
    endAt: input.endAt
  });

  if (conflicts.length > 0 && !input.allowConflictOverride) {
    throw new ApiError(409, "CONFLICT", "Appointment conflicts with an existing booking.", {
      conflicts
    });
  }

  const appointment = await dependencies.repository.createAppointment(scope, input);

  await dependencies.repository.createTask(scope, {
    patientId: appointment.patientId,
    leadId: appointment.leadId,
    appointmentId: appointment.id,
    taskType: "confirmation",
    sourceWorkflow: "appointment_confirmation",
    sourceRecordType: "appointment",
    sourceRecordId: appointment.id,
    title: "Confirm appointment",
    dueAt: appointment.startAt,
    assignedToUserId: scope.actorUserId
  });
  await audit(context, dependencies, "appointment.created", {
    patientId: appointment.patientId,
    resourceType: "appointment",
    resourceId: appointment.id,
    metadata: { source: appointment.source, status: appointment.status }
  });
  await appendOutbox(context, dependencies, {
    eventType: appointment.status === "requested" ? "appointment.requested" : "appointment.created",
    aggregateType: "appointment",
    aggregateId: appointment.id,
    patientId: appointment.patientId,
    payload: {
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      providerUserId: appointment.providerUserId,
      appointmentTypeId: appointment.appointmentTypeId,
      startAt: appointment.startAt,
      endAt: appointment.endAt,
      source: appointment.source,
      status: appointment.status
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "appointment.confirmation_requested",
    aggregateType: "appointment",
    aggregateId: appointment.id,
    patientId: appointment.patientId,
    payload: { appointmentId: appointment.id, taskType: "confirmation" }
  });

  return appointment;
}

async function createDentalFindingForPatient(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  input: CreateDentalFindingInput,
  options: { preauthorized?: boolean } = {}
) {
  if (!options.preauthorized) {
    authorize(context, { permission: "patient.read" });
    authorize(context, { permission: "patient.phi.read" });
    authorize(context, { permission: "dental.chart.write" });
  }

  const result = await dependencies.repository.createDentalFinding(
    scopeFrom(context),
    patientId,
    input
  );
  if (!result) throw notFound("Patient or encounter not found.", { patient_id: patientId });

  await audit(context, dependencies, "dental_finding.created", {
    patientId: result.finding.patientId,
    resourceType: "dental_finding",
    resourceId: result.finding.id,
    metadata: dentalFindingAuditMetadata(result.finding)
  });
  await appendOutbox(context, dependencies, {
    eventType: "dental.finding.created",
    aggregateType: "dental_finding",
    aggregateId: result.finding.id,
    patientId: result.finding.patientId,
    payload: {
      findingId: result.finding.id,
      patientId: result.finding.patientId,
      encounterId: result.finding.encounterId,
      toothNumber: result.finding.toothNumber,
      surface: result.finding.surface,
      findingType: result.finding.findingType,
      reviewStatus: result.finding.reviewStatus
    }
  });

  return created({
    finding: publicDentalFinding(result.finding),
    history: publicDentalFindingHistory(result.history)
  });
}

async function transitionAppointment(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  appointmentId: UUID,
  status: AppointmentStatus
) {
  const scope = scopeFrom(context);
  const existing = await dependencies.repository.findAppointmentById(scope, appointmentId);

  if (!existing) throw notFound("Appointment not found.", { appointment_id: appointmentId });

  assertAppointmentTransition(existing.status, status);
  const appointment = await dependencies.repository.updateAppointmentStatus(
    scope,
    appointmentId,
    status
  );

  if (!appointment) throw notFound("Appointment not found.", { appointment_id: appointmentId });

  const auditAction = appointmentAuditAction(status);

  await audit(context, dependencies, auditAction, {
    patientId: appointment.patientId,
    resourceType: "appointment",
    resourceId: appointment.id,
    metadata: { fromStatus: existing.status, toStatus: appointment.status }
  });
  await appendOutbox(context, dependencies, {
    eventType: appointmentEventType(status),
    aggregateType: "appointment",
    aggregateId: appointment.id,
    patientId: appointment.patientId,
    payload: {
      appointmentId: appointment.id,
      fromStatus: existing.status,
      toStatus: appointment.status
    }
  });

  return ok({ appointment });
}

function scopeFrom(context: OperationsRequestContext): RepositoryScope {
  return {
    tenantId: context.accessContext.tenant.id,
    clinicId: context.clinicId,
    actorUserId: context.accessContext.user.id
  };
}

function authorize(
  context: OperationsRequestContext,
  request: Pick<AuthorizationRequest, "permission">
): void {
  assertAuthorized(context.accessContext, {
    tenantId: context.accessContext.tenant.id,
    clinicId: context.clinicId,
    permission: request.permission
  });
}

function authorizeDoctorSignature(
  context: OperationsRequestContext,
  permission: "clinical.note.sign" | "prescription.sign"
): void {
  if (!DOCTOR_ONLY_SIGNATURE_PERMISSIONS.has(permission)) {
    throw new ApiError(500, "CONFIGURATION_ERROR", "Invalid doctor-only permission.");
  }

  authorize(context, { permission });
  const roles = roleSlugsForScope(
    context.accessContext,
    context.accessContext.tenant.id,
    context.clinicId
  );

  if (!roles.includes("doctor")) {
    throw new ApiError(403, "PERMISSION_DENIED", "Only doctors can sign clinical records.", {
      required_permission: permission,
      required_role: "doctor"
    });
  }
}

function labCaseAuditAction(status: LabCaseStatus): KnownAuditAction {
  switch (status) {
    case "sent_to_lab":
      return "lab_case.sent";
    case "received_by_lab":
      return "lab_case.received";
    case "returned":
      return "lab_case.returned";
    case "completed":
      return "lab_case.completed";
    case "cancelled":
      return "lab_case.cancelled";
    default:
      return "lab_case.status_changed";
  }
}

function labCaseEventType(status: LabCaseStatus): DomainEventType {
  switch (status) {
    case "sent_to_lab":
      return "lab_case.sent";
    case "received_by_lab":
      return "lab_case.received";
    case "returned":
      return "lab_case.returned";
    case "completed":
      return "lab_case.completed";
    case "cancelled":
      return "lab_case.cancelled";
    default:
      return "lab_case.status_changed";
  }
}

function publicCorrectiveAction<TAction extends { status: string; dueAt: string }>(
  action: TAction
) {
  const effectiveStatus = correctiveActionEffectiveStatus(
    action as Parameters<typeof correctiveActionEffectiveStatus>[0]
  );
  return {
    ...action,
    effectiveStatus,
    overdue: effectiveStatus === "overdue"
  };
}

type PublicTimelineItemType =
  | "patient"
  | "attribution"
  | "lead"
  | "appointment"
  | "queue"
  | "message"
  | "clinical_note"
  | "dental"
  | "treatment_plan"
  | "procedure"
  | "prescription"
  | "instruction"
  | "media"
  | "invoice"
  | "payment"
  | "receipt"
  | "lab"
  | "quality"
  | "task"
  | "consent";

function toPublicPatientTimelineItem(item: DomainPatientTimelineItem) {
  return {
    id: item.id,
    patientId: item.patientId,
    itemType: publicTimelineItemType(item.itemType),
    eventType: timelineEventType(item.itemType),
    occurredAt: item.occurredAt,
    title: item.title,
    summary: item.summary ?? "",
    sensitive: true,
    resourceId: item.sourceId,
    sourceTable: item.sourceTable,
    rawItemType: item.itemType,
    metadata: item.metadata
  };
}

function publicTimelineItemType(
  itemType: DomainPatientTimelineItem["itemType"]
): PublicTimelineItemType {
  switch (itemType) {
    case "patient_created":
      return "patient";
    case "attribution_touch_created":
      return "attribution";
    case "lead_created":
    case "lead_matched":
      return "lead";
    case "appointment_created":
    case "appointment_confirmed":
    case "appointment_no_show":
      return "appointment";
    case "patient_checked_in":
    case "queue_entry_created":
      return "queue";
    case "task_created":
    case "task_status_changed":
    case "task_completed":
    case "recall_due":
    case "recall_action_recorded":
      return "task";
    case "form_response_submitted":
      return "clinical_note";
    case "consent_created":
    case "consent_revoked":
      return "consent";
    case "encounter_created":
    case "encounter_started":
    case "encounter_completed":
      return "clinical_note";
    case "clinical_note_draft_created":
    case "clinical_note_signed":
    case "clinical_note_amended":
      return "clinical_note";
    case "dental_finding_created":
    case "dental_finding_updated":
    case "dental_chart_snapshot_created":
      return "dental";
    case "treatment_plan_created":
    case "treatment_plan_accepted":
      return "treatment_plan";
    case "procedure_completed":
      return "procedure";
    case "invoice_created":
      return "invoice";
    case "payment_recorded":
      return "payment";
    case "receipt_generated":
      return "receipt";
    case "prescription_draft_created":
    case "prescription_signed":
      return "prescription";
    case "instruction_print_requested":
    case "instruction_send_requested":
      return "instruction";
    case "media_uploaded":
      return "media";
    case "invoice_created":
      return "invoice";
    case "payment_requested":
    case "payment_succeeded":
    case "payment_manually_recorded":
    case "payment_reconciliation_required":
      return "payment";
    case "receipt_generated":
      return "invoice";
    case "lab_case_created":
    case "lab_case_sent":
    case "lab_case_returned":
    case "lab_case_completed":
      return "lab";
    case "incident_created":
    case "corrective_action_created":
    case "corrective_action_completed":
      return "quality";
    case "ai_session_started":
    case "ai_draft_generated":
    case "ai_review_decision_recorded":
    case "ai_retention_deleted":
      return "clinical_note";
  }
}

function timelineEventType(itemType: DomainPatientTimelineItem["itemType"]): DomainEventType {
  switch (itemType) {
    case "patient_created":
      return "patient.created";
    case "attribution_touch_created":
      return "attribution.touch.created";
    case "lead_created":
      return "lead.created";
    case "lead_matched":
      return "lead.matched_to_patient";
    case "appointment_created":
      return "appointment.created";
    case "appointment_confirmed":
      return "appointment.confirmed";
    case "patient_checked_in":
      return "patient.checked_in";
    case "queue_entry_created":
      return "queue.entry_created";
    case "appointment_no_show":
      return "appointment.no_show";
    case "task_created":
      return "task.created";
    case "task_status_changed":
      return "task.status_changed";
    case "task_completed":
      return "task.completed";
    case "recall_due":
      return "recall.due";
    case "recall_action_recorded":
      return "recall.action_recorded";
    case "form_response_submitted":
      return "form_response.submitted";
    case "consent_created":
      return "consent.created";
    case "consent_revoked":
      return "consent.revoked";
    case "encounter_created":
      return "encounter.created";
    case "encounter_started":
      return "encounter.started";
    case "encounter_completed":
      return "encounter.completed";
    case "clinical_note_draft_created":
      return "clinical_note.draft_created";
    case "clinical_note_signed":
      return "clinical_note.signed";
    case "clinical_note_amended":
      return "clinical_note.amended";
    case "dental_finding_created":
      return "dental.finding.created";
    case "dental_finding_updated":
      return "dental.finding.updated";
    case "dental_chart_snapshot_created":
      return "dental.chart.snapshot_created";
    case "treatment_plan_created":
      return "treatment_plan.created";
    case "treatment_plan_accepted":
      return "treatment_plan.accepted";
    case "procedure_completed":
      return "procedure.completed";
    case "invoice_created":
      return "invoice.created";
    case "payment_recorded":
      return "payment.succeeded";
    case "receipt_generated":
      return "receipt.generated";
    case "prescription_draft_created":
      return "prescription.draft_created";
    case "prescription_signed":
      return "prescription.signed";
    case "instruction_print_requested":
      return "instruction.print_requested";
    case "instruction_send_requested":
      return "instruction.send_requested";
    case "media_uploaded":
      return "media.upload_completed";
    case "invoice_created":
      return "invoice.created";
    case "payment_requested":
      return "payment.requested";
    case "payment_succeeded":
      return "payment.succeeded";
    case "payment_manually_recorded":
      return "payment.manually_recorded";
    case "payment_reconciliation_required":
      return "payment.reconciliation_required";
    case "receipt_generated":
      return "receipt.generated";
    case "lab_case_created":
      return "lab_case.created";
    case "lab_case_sent":
      return "lab_case.sent";
    case "lab_case_returned":
      return "lab_case.returned";
    case "lab_case_completed":
      return "lab_case.completed";
    case "incident_created":
      return "incident.created";
    case "corrective_action_created":
      return "corrective_action.created";
    case "corrective_action_completed":
      return "corrective_action.completed";
    case "ai_session_started":
      return "ai.session.started";
    case "ai_draft_generated":
      return "ai.draft.generated";
    case "ai_review_decision_recorded":
      return "ai.review_decision.recorded";
    case "ai_retention_deleted":
      return "ai.retention.deleted";
  }
}

async function audit(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  action: KnownAuditAction,
  input: {
    patientId?: UUID | null;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<void> {
  if (!dependencies.auditSink) return;

  await dependencies.auditSink.appendAuditEvent(
    createAuditEvent({
      tenantId: context.accessContext.tenant.id,
      clinicId: context.clinicId,
      actor: { type: "user", id: context.accessContext.user.id },
      action,
      patientId: input.patientId ?? null,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: input.metadata,
      ipAddress: context.ipAddress ?? null,
      userAgent: context.userAgent ?? null,
      correlationId: context.requestId,
      occurredAt: nowDate(dependencies)
    })
  );
}

async function appendOutbox(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  input: {
    eventType: DomainEventType;
    aggregateType: string;
    aggregateId: UUID;
    patientId?: UUID | null;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  await dependencies.repository.appendOutboxEvent(scopeFrom(context), {
    ...input,
    idempotencyKey: context.idempotencyKey,
    correlationId: context.requestId,
    occurredAt: nowIso(dependencies)
  });
}

function nowDate(dependencies: OperationsDependencies): Date {
  return (dependencies.clock ?? systemClock).now();
}

function nowIso(dependencies: OperationsDependencies): string {
  return nowDate(dependencies).toISOString();
}

function parseCreatePatient(body: unknown): CreatePatientInput & { leadId?: UUID | null } {
  const input = objectBody(body);
  return {
    fullName: requiredString(input.fullName, "fullName"),
    phone: requiredString(input.phone, "phone"),
    email: optionalNullableString(input.email, "email"),
    dateOfBirth: optionalNullableString(input.dateOfBirth, "dateOfBirth"),
    gender: input.gender === undefined ? "unknown" : parseGender(input.gender),
    source: parsePatientSource(requiredString(input.source ?? "manual", "source")),
    sourceDetail: recordField(input.sourceDetail, "sourceDetail"),
    leadId: optionalUuid(input.leadId, "leadId")
  };
}

function parseCreateAiScribeSessionInput(body: unknown): {
  requireRawAudioRetention: boolean;
  languageHint?: string | null;
  captureSurface: string;
} {
  const input = objectBody(body);
  return {
    requireRawAudioRetention: booleanField(
      input.requireRawAudioRetention ?? false,
      "requireRawAudioRetention"
    ),
    languageHint: optionalNullableString(input.languageHint, "languageHint") ?? null,
    captureSurface: optionalString(input.captureSurface, "captureSurface") ?? "unknown"
  };
}

function parseCreateAiTranscriptSegmentInput(body: unknown): {
  text: string;
  speakerRole?: "doctor" | "assistant" | "patient" | "unknown";
  startsAtMs: number;
  endsAtMs: number;
} {
  const input = objectBody(body);
  const speakerRole = optionalString(input.speakerRole, "speakerRole");
  if (speakerRole && !["doctor", "assistant", "patient", "unknown"].includes(speakerRole)) {
    throw validation("speakerRole is not supported.", { speakerRole });
  }
  const startsAtMs = integerField(input.startsAtMs, "startsAtMs");
  const endsAtMs = integerField(input.endsAtMs, "endsAtMs");
  if (startsAtMs < 0 || endsAtMs < startsAtMs) {
    throw validation("Transcript segment timing is invalid.", { startsAtMs, endsAtMs });
  }
  return {
    text: requiredString(input.text, "text"),
    speakerRole: speakerRole as "doctor" | "assistant" | "patient" | "unknown" | undefined,
    startsAtMs,
    endsAtMs
  };
}

function parseCreateAiSourceAnchorInput(body: unknown): CreateAiSourceAnchorInput {
  const input = objectBody(body);
  const anchorType = requiredString(input.anchorType, "anchorType");
  if (!isAiSourceAnchorType(anchorType)) {
    throw validation("anchorType is not supported.", { anchorType });
  }
  return {
    anchorType,
    sourceRecordType: requiredString(input.sourceRecordType, "sourceRecordType"),
    sourceRecordId: requiredString(input.sourceRecordId, "sourceRecordId"),
    transcriptSegmentId: optionalUuid(input.transcriptSegmentId, "transcriptSegmentId") ?? null,
    startsAtMs: optionalInteger(input.startsAtMs, "startsAtMs"),
    endsAtMs: optionalInteger(input.endsAtMs, "endsAtMs"),
    textQuoteDigest: optionalSha256Digest(input.textQuoteDigest, "textQuoteDigest") ?? null,
    supported:
      input.supported === undefined ? undefined : booleanField(input.supported, "supported"),
    unsupportedReason: optionalNullableString(input.unsupportedReason, "unsupportedReason") ?? null
  };
}

function parseGenerateAiDraftsInput(body: unknown): { sourceAnchorIds: UUID[] } {
  const input = objectBody(body ?? {});
  const values =
    input.sourceAnchorIds === undefined ? [] : arrayField(input.sourceAnchorIds, "sourceAnchorIds");
  return {
    sourceAnchorIds: values.map((value, index) => uuidField(value, `sourceAnchorIds[${index}]`))
  };
}

function parseRecordAiReviewDecisionInput(body: unknown): RecordAiReviewDecisionInput {
  const input = objectBody(body);
  const targetType = requiredString(input.targetType, "targetType");
  if (targetType !== "draft_output" && targetType !== "action_proposal") {
    throw validation("targetType is not supported.", { targetType });
  }
  const decision = requiredString(input.decision, "decision");
  if (!isAiReviewDecision(decision)) {
    throw validation("decision is not supported.", { decision });
  }
  return {
    targetType,
    targetId: uuidField(input.targetId, "targetId"),
    decision,
    reason: requiredString(input.reason, "reason"),
    editedContent:
      input.editedContent === undefined || input.editedContent === null
        ? null
        : recordField(input.editedContent, "editedContent")
  };
}

async function parseCreateMigrationBatchInput(
  scope: RepositoryScope,
  dependencies: OperationsDependencies,
  body: unknown
): Promise<CreateMigrationBatchInput> {
  const input = objectBody(body);
  const importTypeValue = requiredString(input.importType, "importType");
  if (!isMigrationImportType(importTypeValue)) {
    throw validation("importType is not supported.", { importType: importTypeValue });
  }
  if (importTypeValue !== "patients") {
    throw validation("CP7 currently supports the patient import workflow for committed imports.", {
      importType: importTypeValue
    });
  }

  const sourceSystem = optionalString(input.sourceSystem, "sourceSystem") ?? "manual_csv";
  const sourceFileName = optionalNullableString(input.sourceFileName, "sourceFileName") ?? null;
  const csv = optionalNullableString(input.csv, "csv") ?? null;
  const rowsValue = input.rows;
  const rowDrafts = csv
    ? parsePatientMigrationCsv(csv)
    : coercePatientImportRows(
        arrayField(rowsValue, "rows").map((value, index) => objectField(value, `rows[${index}]`))
      );

  if (rowDrafts.length === 0) {
    throw validation("Migration batch must include at least one row.", {});
  }

  const migrationRows: CreateMigrationBatchInput["rows"] = [];
  for (const draft of rowDrafts) {
    const validationResult = validatePatientImportRow(draft);
    const conflicts = [];
    let status: MigrationRowRecord["status"] = "invalid";
    let matchStatus: MigrationRowRecord["matchStatus"] = "none";

    if (validationResult.normalizedRecord) {
      const existingPatients = await dependencies.repository.findPatientDuplicateCandidates(scope, {
        fullName: validationResult.normalizedRecord.fullName,
        phone: validationResult.normalizedRecord.phone
      });
      const duplicateCandidates = duplicateCandidatesForPatientImport(
        validationResult.normalizedRecord,
        existingPatients
      );
      for (const candidate of duplicateCandidates) {
        conflicts.push({
          conflictType: "duplicate_patient" as const,
          severity: "blocking" as const,
          targetRecordType: "patient",
          targetRecordId: candidate.patient.id,
          summary: `Potential duplicate patient: ${candidate.patient.fullName}`,
          evidence: { candidate }
        });
      }

      status = duplicateCandidates.length > 0 ? "needs_review" : "ready_to_commit";
      matchStatus = duplicateCandidates.length > 0 ? "duplicate_candidate" : "none";
    }

    migrationRows.push({
      rowNumber: validationResult.rowNumber,
      importType: importTypeValue,
      externalRecordId: validationResult.externalReference,
      rawPayload: validationResult.rawPayload,
      rawPayloadDigest: sha256Json(validationResult.rawPayload),
      normalizedRecord: validationResult.normalizedRecord,
      validationErrors: validationResult.validationErrors,
      status,
      matchStatus,
      conflicts
    });
  }

  const readyRows = migrationRows.filter((row) => row.status === "ready_to_commit").length;
  const invalidRows = migrationRows.filter((row) => row.status === "invalid").length;
  const conflictRows = migrationRows.filter(
    (row) => row.matchStatus === "duplicate_candidate"
  ).length;

  return {
    importType: importTypeValue,
    sourceSystem,
    sourceFileName,
    sourceChecksum:
      optionalSha256Digest(input.sourceChecksum, "sourceChecksum") ?? sha256Json(csv ?? rowsValue),
    state: summarizeMigrationBatchState({
      totalRows: migrationRows.length,
      invalidRows,
      conflictRows,
      readyRows
    }),
    rows: migrationRows
  };
}

function parseResolveMigrationRowInput(body: unknown): ResolveMigrationRowInput {
  const input = objectBody(body);
  const action = requiredString(input.action, "action");
  if (!isMigrationResolutionAction(action)) {
    throw validation("action is not a supported migration row resolution.", { action });
  }

  const targetRecordId = optionalUuid(
    input.targetRecordId ?? input.targetPatientId,
    "targetRecordId"
  );
  if (action === "link_existing" && !targetRecordId) {
    throw validation(
      "targetRecordId is required when linking an imported row to an existing record.",
      {
        action
      }
    );
  }

  return {
    action,
    targetRecordType:
      action === "link_existing"
        ? (optionalString(input.targetRecordType, "targetRecordType") ?? "patient")
        : null,
    targetRecordId,
    note: optionalNullableString(input.note, "note") ?? null
  };
}

function parseMigrationActionInput(
  body: unknown,
  context: OperationsRequestContext
): { idempotencyKey?: string | null } {
  const input = objectBody(body);
  return {
    idempotencyKey:
      optionalNullableString(input.idempotencyKey, "idempotencyKey") ??
      context.idempotencyKey ??
      null
  };
}

function parseOptionalMigrationMatchStatus(
  value: string | null | undefined
): MigrationRowRecord["matchStatus"] | null {
  if (!value) return null;
  if (!["none", "duplicate_candidate", "conflict", "resolved", "skipped"].includes(value)) {
    throw validation("matchStatus is not supported.", { matchStatus: value });
  }
  return value as MigrationRowRecord["matchStatus"];
}

function parseOptionalMigrationRowStatus(
  value: string | null | undefined
): MigrationRowRecord["status"] | null {
  if (!value) return null;
  if (
    ![
      "invalid",
      "needs_review",
      "ready_to_commit",
      "committed",
      "skipped",
      "rolled_back",
      "failed"
    ].includes(value)
  ) {
    throw validation("status is not supported.", { status: value });
  }
  return value as MigrationRowRecord["status"];
}

function parseOptionalMigrationBatchState(
  value: string | null | undefined
): MigrationBatchState | null {
  if (!value) return null;
  if (
    ![
      "uploaded",
      "parsed",
      "validated",
      "needs_review",
      "ready_to_commit",
      "committed",
      "partially_committed",
      "failed",
      "rolled_back"
    ].includes(value)
  ) {
    throw validation("status is not supported.", { status: value });
  }
  return value as MigrationBatchState;
}

function parseOptionalIntegrationDeadLetterStatus(
  value: string | null | undefined
): IntegrationDeadLetterStatus | null {
  if (!value) return null;
  if (value === "unreviewed") return "open";
  if (value === "replay_requested") return "retry_scheduled";
  if (value === "replayed") return "replayed";
  if (value === "ignored") return "discarded";
  if (value === "blocked") return "open";
  if (["open", "retry_scheduled", "resolved", "discarded"].includes(value)) {
    return value as IntegrationDeadLetterStatus;
  }
  throw validation("status is not supported for dead-letter events.", { status: value });
}

function parseOptionalLimit(
  value: string | null | undefined,
  fallback: number,
  max: number
): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw validation("limit must be a positive integer.", { limit: value });
  }
  return Math.min(parsed, max);
}

function parseOptionalAuditCategory(value: string | null | undefined) {
  if (!value) return null;
  if (
    [
      "security",
      "administration",
      "phi_access",
      "clinical",
      "billing",
      "operations",
      "quality",
      "integration",
      "privacy"
    ].includes(value)
  ) {
    return value as
      | "security"
      | "administration"
      | "phi_access"
      | "clinical"
      | "billing"
      | "operations"
      | "quality"
      | "integration"
      | "privacy";
  }
  throw validation("Unknown audit category.", { category: value });
}

function parseOptionalAuditRiskLevel(value: string | null | undefined) {
  if (!value) return null;
  if (["low", "medium", "high", "critical"].includes(value)) {
    return value as "low" | "medium" | "high" | "critical";
  }
  throw validation("Unknown audit risk level.", { riskLevel: value });
}

function parseOptionalDataExportStatus(value: string | null | undefined) {
  if (!value) return null;
  if (["requested", "completed", "failed", "cancelled"].includes(value)) {
    return value as "requested" | "completed" | "failed" | "cancelled";
  }
  throw validation("Unknown data export status.", { status: value });
}

function parseOptionalDeletionRequestStatus(value: string | null | undefined) {
  if (!value) return null;
  if (
    ["requested", "approved_pending_retention_job", "rejected", "completed", "cancelled"].includes(
      value
    )
  ) {
    return value as
      "requested" | "approved_pending_retention_job" | "rejected" | "completed" | "cancelled";
  }
  throw validation("Unknown deletion request status.", { status: value });
}

function parseOptionalBreakGlassStatus(value: string | null | undefined) {
  if (!value) return null;
  if (["requested", "approved", "denied", "revoked", "expired"].includes(value)) {
    return value as "requested" | "approved" | "denied" | "revoked" | "expired";
  }
  throw validation("Unknown break-glass status.", { status: value });
}

function parseAuditReviewInput(body: unknown): CreateAuditReviewInput {
  const input = objectBody(body);
  const reviewStatus = requiredString(input.reviewStatus ?? input.status, "reviewStatus");
  if (!isAuditReviewStatus(reviewStatus)) {
    throw validation("reviewStatus must be reviewed, escalated, or dismissed.", { reviewStatus });
  }
  return {
    reviewStatus,
    disposition: requiredString(input.disposition, "disposition"),
    notes: optionalNullableString(input.notes, "notes") ?? null
  };
}

function parsePatientRecordExportInput(
  patientId: UUID,
  body: unknown
): Omit<PatientRecordExportInput, "snapshot" | "payloadDigest"> {
  const input = body === undefined ? {} : objectBody(body);
  const sectionValues =
    input.sections === undefined ? undefined : stringArrayField(input.sections, "sections");
  return {
    patientId,
    sections: normalizePatientRecordExportSections(sectionValues),
    reason: optionalString(input.reason, "reason") ?? "patient_record_handover",
    format: "json"
  };
}

function parseCreateDeletionRequest(body: unknown): CreateDeletionRequestInput {
  const input = objectBody(body);
  const requestType = requiredString(input.requestType, "requestType");
  if (!isDeletionRequestType(requestType)) {
    throw validation("requestType is not supported for CP9 deletion workflows.", { requestType });
  }
  const requestedCategories = stringArrayField(
    input.requestedCategories ?? ["ai_transient_payloads"],
    "requestedCategories"
  );
  if (requestedCategories.length === 0) {
    throw validation("requestedCategories must include at least one category.", {
      requestedCategories
    });
  }
  return {
    patientId: uuidField(input.patientId, "patientId"),
    requestType,
    reason: requiredString(input.reason, "reason"),
    requestedCategories
  };
}

function parseReviewDeletionRequest(body: unknown): ReviewDeletionRequestInput {
  const input = objectBody(body);
  const decision = requiredString(input.decision, "decision");
  if (!["approve", "reject", "cancel"].includes(decision)) {
    throw validation("decision must be approve, reject, or cancel.", { decision });
  }
  return {
    decision: decision as ReviewDeletionRequestInput["decision"],
    reviewReason: requiredString(input.reviewReason ?? input.reason, "reviewReason")
  };
}

function parseRunRetentionJob(body: unknown, defaultAsOf: string): RunRetentionJobInput {
  const input = objectBody(body);
  const mode = optionalString(input.mode, "mode") ?? "dry_run";
  if (!isRetentionJobMode(mode)) throw validation("mode must be dry_run or execute.", { mode });
  const parsed = {
    mode,
    asOf: optionalString(input.asOf, "asOf") ?? defaultAsOf,
    policyCode: optionalString(input.policyCode, "policyCode") ?? "cp9-ai-transient-payloads-v1",
    patientId: optionalUuid(input.patientId, "patientId"),
    deletionRequestId: optionalUuid(input.deletionRequestId, "deletionRequestId"),
    transcriptDeleteAfterDays:
      input.transcriptDeleteAfterDays === undefined
        ? 1
        : integerField(input.transcriptDeleteAfterDays, "transcriptDeleteAfterDays", {
            min: 0,
            max: 3650
          })
  };
  assertRetentionRunPolicy(parsed);
  return parsed;
}

function parseCreateBreakGlassAccessRequest(body: unknown): CreateBreakGlassAccessInput {
  const input = objectBody(body);
  const categories = stringArrayField(input.accessCategories, "accessCategories");
  const accessCategories = categories.map((category, index) => {
    if (!isBreakGlassAccessCategory(category)) {
      throw validation(`accessCategories[${index}] is not supported.`, { category });
    }
    return category;
  });
  const parsed = {
    patientId: uuidField(input.patientId, "patientId"),
    reason: requiredString(input.reason, "reason"),
    expiresAt: requiredString(input.expiresAt, "expiresAt"),
    accessCategories
  };
  try {
    assertBreakGlassRequestPolicy(parsed);
  } catch (error) {
    throw validation(error instanceof Error ? error.message : "Invalid break-glass request.");
  }
  return parsed;
}

function parseReviewBreakGlassAccessRequest(body: unknown): ReviewBreakGlassAccessInput {
  const input = objectBody(body);
  const decision = requiredString(input.decision, "decision");
  if (!["approve", "deny", "revoke"].includes(decision)) {
    throw validation("decision must be approve, deny, or revoke.", { decision });
  }
  return {
    decision: decision as ReviewBreakGlassAccessInput["decision"],
    reviewReason: requiredString(input.reviewReason ?? input.reason, "reviewReason")
  };
}

function toMigrationBatchResponse(detail: MigrationBatchDetail) {
  return {
    batch: detail.batch,
    rows: detail.rows.map(toPublicMigrationRow),
    conflicts: detail.conflicts
  };
}

function toPublicMigrationRow(row: MigrationRowRecord): MigrationRowRecord {
  return {
    ...row,
    rawPayloadRef: { ...row.rawPayloadRef }
  };
}

function toPublicDeadLetterEvent(deadLetter: IntegrationDeadLetterRecord) {
  const replayAvailable =
    ["open", "retry_scheduled"].includes(deadLetter.status) &&
    Boolean(deadLetter.rawEventId ?? deadLetter.normalizedEventId);
  return {
    attempts: deadLetter.retryCount,
    eventType: `${deadLetter.failureStage}.${deadLetter.failureCode}`,
    failedAt: deadLetter.createdAt,
    id: deadLetter.id,
    lastError: deadLetter.failureSummary,
    outcomeDetail:
      deadLetter.status === "retry_scheduled"
        ? "Replay request is recorded for handler processing; provider success is not confirmed."
        : "Dead-letter is reviewable; replay does not advance provider state without handler evidence.",
    providerKey: publicProviderKey(deadLetter.providerKey),
    replayAvailable,
    ...(replayAvailable
      ? {}
      : {
          replayBlockedReason:
            "Replay requires a retained raw or normalized provider event reference."
        }),
    status: publicDeadLetterStatus(deadLetter)
  };
}

function publicDeadLetterStatus(
  deadLetter: IntegrationDeadLetterRecord
): "blocked" | "ignored" | "replayed" | "replay_requested" | "unreviewed" {
  if (deadLetter.status === "retry_scheduled") return "replay_requested";
  if (deadLetter.status === "replayed") return "replayed";
  if (deadLetter.status === "resolved" || deadLetter.status === "discarded") return "ignored";
  if (!deadLetter.rawEventId && !deadLetter.normalizedEventId) return "blocked";
  return "unreviewed";
}

function runtimeConfigFrom(dependencies: OperationsDependencies): ClinicOsConfig {
  if (!dependencies.runtimeConfig) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "ClinicOS runtime config is not available for integration provider health."
    );
  }
  return dependencies.runtimeConfig;
}

function createRuntimeMessagingProvider(config: ClinicOsConfig) {
  return createMessagingProvider({
    provider: config.providers.whatsapp.provider,
    accessToken: config.providers.whatsapp.accessToken,
    appSecret: config.providers.whatsapp.appSecret,
    businessAccountId: config.providers.whatsapp.businessAccountId,
    phoneNumberId: config.providers.whatsapp.phoneNumberId,
    webhookVerifyToken: config.providers.whatsapp.webhookVerifyToken,
    appSecretProofRequired: config.providers.whatsapp.appSecretProofRequired,
    templateNamespace: config.providers.whatsapp.templateNamespace,
    allowLiveMetaApiCalls: false,
    liveHealthCheckEnabled: false
  });
}

function createRuntimeTelephonyProvider(config: ClinicOsConfig) {
  return createTelephonyProvider({
    provider: config.providers.telephony.provider,
    accountSid: config.providers.telephony.accountSid,
    apiKey: config.providers.telephony.apiKey,
    apiToken: config.providers.telephony.apiToken,
    virtualNumber: config.providers.telephony.virtualNumber,
    webhookSecret: config.providers.telephony.webhookSecret,
    regionSubdomain: config.providers.telephony.regionSubdomain,
    webhookCallbackConfigured: false
  });
}

function officialProviderCards(
  registrations: readonly ProviderRegistrationHealthRecord[],
  checkedAt: string
) {
  const cards: Array<Record<string, unknown>> = registrations.map((registration) => {
    const meta = registration.providerKey === "meta_whatsapp_cloud";
    const status = officialProviderPublicStatus(registration.activationState);
    const capabilities = meta
      ? ["Signed callbacks", "Template send", "Delivery receipts"]
      : ["Signed callbacks", "Payment Link / QR", "Payment reconciliation"];
    return {
      activationChecks: [
        `Registration state: ${registration.activationState}.`,
        registration.sandboxVerifiedAt
          ? "Official sandbox verification evidence is recorded."
          : "Official sandbox verification evidence is not recorded.",
        registration.productionVerifiedAt
          ? "Production verification evidence is recorded."
          : "Production activation is not verified."
      ],
      activationState: registration.activationState,
      capabilities: capabilities.map((label) => ({
        detail: `${label} is ${status === "available" ? "verified" : status === "degraded" ? "not yet verified" : "disabled"} for this registration.`,
        key: label.toLowerCase().replaceAll(/[^a-z0-9]+/gu, "_"),
        label,
        status:
          status === "available" ? "available" : status === "degraded" ? "degraded" : "unavailable"
      })),
      category: meta ? ("messaging" as const) : ("payments" as const),
      checkedAt: registration.lastHealthCheckAt ?? checkedAt,
      evidence:
        registration.activationState === "degraded" && registration.lastFailureCode
          ? `Registration is degraded with bounded failure code ${registration.lastFailureCode}.`
          : `Durable registration truth is ${registration.activationState}.`,
      id: registration.registrationId,
      label: meta ? "WhatsApp Cloud" : "Razorpay",
      lastFailureCode: registration.lastFailureCode,
      lastReconciledAt: registration.lastReconciledAt,
      lastVerifiedCallbackAt: registration.lastVerifiedCallbackAt,
      mode: registration.providerMode,
      productionVerifiedAt: registration.productionVerifiedAt,
      providerKey: meta ? ("whatsapp_cloud" as const) : ("razorpay" as const),
      sandboxVerifiedAt: registration.sandboxVerifiedAt,
      status
    };
  });
  for (const provider of ["meta_whatsapp_cloud", "razorpay"] as const) {
    if (registrations.some((registration) => registration.providerKey === provider)) continue;
    const meta = provider === "meta_whatsapp_cloud";
    cards.push({
      activationChecks: [
        "No durable provider registration exists for this clinic.",
        "Credentials and callback state are not inferred from process environment variables.",
        "Provider dashboard activation remains unavailable."
      ],
      activationState: "absent",
      capabilities: [],
      category: meta ? "messaging" : "payments",
      checkedAt,
      evidence: "No durable provider registration is present.",
      id: meta ? "whatsapp-cloud-absent" : "razorpay-absent",
      label: meta ? "WhatsApp Cloud" : "Razorpay",
      lastFailureCode: null,
      lastReconciledAt: null,
      lastVerifiedCallbackAt: null,
      mode: "disabled",
      productionVerifiedAt: null,
      providerKey: meta ? "whatsapp_cloud" : "razorpay",
      sandboxVerifiedAt: null,
      status: "not_configured"
    });
  }
  return cards;
}

function officialProviderPublicStatus(
  state: ProviderRegistrationHealthRecord["activationState"]
): "available" | "degraded" | "not_configured" | "unavailable" {
  if (state === "sandbox_verified" || state === "production_verified") return "available";
  if (state === "registered" || state === "configured" || state === "degraded") {
    return "degraded";
  }
  if (state === "disabled") return "unavailable";
  return "not_configured";
}

function providerCardFromHealth(input: {
  activationChecks: string[];
  category: "messaging" | "migration" | "payments" | "source" | "telephony";
  health: ProviderHealth;
  id: string;
  label: string;
  mode: string;
  providerKey:
    "exotel" | "google_business_profile" | "manual_import" | "razorpay" | "whatsapp_cloud";
}) {
  const status = publicProviderStatus(input.providerKey, input.health);
  return {
    activationChecks: input.activationChecks,
    capabilities: input.health.capabilities.map((capability) =>
      providerCapability(capability, status)
    ),
    category: input.category,
    checkedAt: input.health.checkedAt,
    evidence: input.health.message ?? `${input.label} health check completed.`,
    id: input.id,
    label: input.label,
    mode: input.mode,
    providerKey: input.providerKey,
    status
  };
}

function manualProviderCard(input: {
  activationChecks: string[];
  category: "messaging" | "migration" | "payments" | "source" | "telephony";
  checkedAt: string;
  evidence: string;
  id: string;
  label: string;
  mode: string;
  providerKey:
    "exotel" | "google_business_profile" | "manual_import" | "razorpay" | "whatsapp_cloud";
  status: "available" | "degraded" | "not_configured" | "unavailable";
}) {
  return {
    activationChecks: input.activationChecks,
    capabilities: [],
    category: input.category,
    checkedAt: input.checkedAt,
    evidence: input.evidence,
    id: input.id,
    label: input.label,
    mode: input.mode,
    providerKey: input.providerKey,
    status: input.status
  };
}

function publicProviderStatus(
  providerKey:
    "exotel" | "google_business_profile" | "manual_import" | "razorpay" | "whatsapp_cloud",
  health: ProviderHealth
): "available" | "degraded" | "not_configured" | "unavailable" {
  if (providerKey === "razorpay" && health.providerKey === "simulator") return "not_configured";
  if (providerKey === "exotel" && health.providerKey === "simulator") return "not_configured";
  return health.status;
}

function providerCapability(
  capability: AdapterCapability,
  providerStatus: "available" | "degraded" | "not_configured" | "unavailable"
) {
  const status =
    providerStatus === "available"
      ? "available"
      : providerStatus === "degraded"
        ? "degraded"
        : "unavailable";
  return {
    detail: `${capabilityLabel(capability)} is ${status.replace("_", " ")} for this provider boundary.`,
    key: capability.toLowerCase(),
    label: capabilityLabel(capability),
    status
  };
}

function capabilityLabel(capability: AdapterCapability) {
  return capability
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function whatsappActivationChecks(config: ClinicOsConfig, health: ProviderHealth): string[] {
  return [
    `Configured provider: ${config.providers.whatsapp.provider}.`,
    health.message ?? "WhatsApp provider health check completed.",
    "Live Meta API calls remain disabled for health checks unless explicitly enabled in provider code."
  ];
}

function razorpayActivationChecks(config: ClinicOsConfig, health: ProviderHealth): string[] {
  return [
    `Configured provider: ${config.providers.payment.provider}.`,
    health.message ?? "Payment provider health check completed.",
    config.providers.payment.razorpayWebhookUrl
      ? "Hosted Razorpay webhook URL is configured."
      : "RAZORPAY_WEBHOOK_URL is missing; provider-paid state requires signed callback registration."
  ];
}

function telephonyActivationChecks(config: ClinicOsConfig, health: ProviderHealth): string[] {
  return [
    `Configured provider: ${config.providers.telephony.provider}.`,
    health.message ?? "Telephony provider health check completed.",
    "Signed telephony callback registration must exist before live missed-call capture is shown as active."
  ];
}

function whatsappProviderMode(config: ClinicOsConfig, health: ProviderHealth) {
  if (config.providers.whatsapp.provider === "meta_cloud" && health.status === "available") {
    return "configured/no-live-health-probe";
  }
  if (config.providers.whatsapp.provider === "meta_cloud") return "configured/degraded";
  return health.status === "not_configured" ? "not configured" : "provider unavailable";
}

function razorpayProviderMode(config: ClinicOsConfig, health: ProviderHealth) {
  if (config.providers.payment.provider !== "razorpay") return "not configured";
  if (!config.providers.payment.razorpayWebhookUrl) return "sandbox webhook URL missing";
  return health.status;
}

function telephonyProviderMode(config: ClinicOsConfig, health: ProviderHealth) {
  if (config.providers.telephony.provider !== "exotel") return "provider unavailable";
  return health.status === "available" ? "configured callback" : "provider unavailable";
}

function publicProviderKey(
  providerKey: string
): "exotel" | "google_business_profile" | "manual_import" | "razorpay" | "whatsapp_cloud" {
  if (providerKey === "meta_whatsapp_cloud" || providerKey === "whatsapp_cloud")
    return "whatsapp_cloud";
  if (providerKey === "telephony" || providerKey === "exotel") return "exotel";
  if (providerKey === "google_business_profile" || providerKey === "google_business")
    return "google_business_profile";
  if (providerKey === "manual_import") return "manual_import";
  if (providerKey === "razorpay") return "razorpay";
  return "manual_import";
}

function sha256Json(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

function parseCreateLead(body: unknown): CreateLeadInput {
  const input = objectBody(body);
  return {
    primaryContact: requiredString(input.primaryContact, "primaryContact"),
    intent: parseLeadIntent(requiredString(input.intent ?? "unknown", "intent")),
    source: parseLeadSource(requiredString(input.source, "source")),
    sourceDetail: recordField(input.sourceDetail, "sourceDetail")
  };
}

function parseCreateAppointment(
  body: unknown,
  defaults: Partial<CreateAppointmentInput> = {}
): CreateAppointmentInput & { allowConflictOverride?: boolean } {
  const input = objectBody(body);
  const startAt = requiredString(input.startAt, "startAt");
  const endAt =
    typeof input.endAt === "string"
      ? input.endAt
      : calculateEndAt(startAt, numberField(input.durationMinutes ?? 30, "durationMinutes"));

  return {
    patientId: defaults.patientId ?? uuidField(input.patientId, "patientId"),
    leadId: defaults.leadId ?? optionalUuid(input.leadId, "leadId"),
    providerUserId: uuidField(input.providerUserId, "providerUserId"),
    appointmentTypeId: uuidField(input.appointmentTypeId, "appointmentTypeId"),
    chairId: optionalUuid(input.chairId, "chairId"),
    status: parseAppointmentStatus(
      requiredString(input.status ?? defaults.status ?? "booked", "status")
    ),
    startAt,
    endAt,
    source: defaults.source ?? parseLeadSource(requiredString(input.source ?? "manual", "source")),
    reason: optionalNullableString(input.reason, "reason"),
    notes: optionalNullableString(input.notes, "notes"),
    allowConflictOverride: Boolean(input.allowConflictOverride)
  };
}

function parseTaskSearch(query: URLSearchParams): TaskSearchFilter {
  const status = query.get("status");
  const sourceWorkflow = query.get("sourceWorkflow");
  return {
    status: status ? parseTaskStatus(status) : null,
    dueDate: query.get("dueDate"),
    dueBefore: query.get("dueBefore"),
    assignedToUserId: uuidOrNullQuery(query.get("assignedToUserId"), "assignedToUserId"),
    patientId: uuidOrNullQuery(query.get("patientId"), "patientId"),
    sourceWorkflow: sourceWorkflow ? parseTaskSourceWorkflow(sourceWorkflow) : null,
    limit: integerQueryParam(query.get("limit"), "limit")
  };
}

function parseCreateTask(body: unknown): CreateTaskInput {
  const input = objectBody(body);
  const taskType = parseTaskType(requiredString(input.taskType ?? "manual", "taskType"));
  return {
    patientId: optionalUuid(input.patientId, "patientId"),
    leadId: optionalUuid(input.leadId, "leadId"),
    appointmentId: optionalUuid(input.appointmentId, "appointmentId"),
    invoiceId: optionalUuid(input.invoiceId, "invoiceId"),
    encounterId: optionalUuid(input.encounterId, "encounterId"),
    treatmentPlanId: optionalUuid(input.treatmentPlanId, "treatmentPlanId"),
    procedurePerformedId: optionalUuid(input.procedurePerformedId, "procedurePerformedId"),
    taskType,
    sourceWorkflow:
      input.sourceWorkflow === undefined
        ? "manual"
        : parseTaskSourceWorkflow(requiredString(input.sourceWorkflow, "sourceWorkflow")),
    sourceRecordType: optionalNullableString(input.sourceRecordType, "sourceRecordType"),
    sourceRecordId: optionalUuid(input.sourceRecordId, "sourceRecordId"),
    title: requiredString(input.title, "title"),
    description: optionalNullableString(input.description, "description"),
    priority:
      input.priority === undefined
        ? "normal"
        : parseTaskPriority(requiredString(input.priority, "priority")),
    status:
      input.status === undefined
        ? undefined
        : parseTaskStatus(requiredString(input.status, "status")),
    dueAt: optionalNullableString(input.dueAt, "dueAt"),
    assignedToUserId: optionalUuid(input.assignedToUserId, "assignedToUserId"),
    idempotencyKey: optionalNullableString(input.idempotencyKey, "idempotencyKey")
  };
}

function parseUpdateTask(body: unknown): UpdateTaskInput {
  const input = objectBody(body);
  const parsed = {
    status:
      input.status === undefined
        ? undefined
        : parseTaskStatus(requiredString(input.status, "status")),
    assignedToUserId:
      input.assignedToUserId === undefined
        ? undefined
        : optionalUuid(input.assignedToUserId, "assignedToUserId"),
    priority:
      input.priority === undefined
        ? undefined
        : parseTaskPriority(requiredString(input.priority, "priority")),
    dueAt: input.dueAt === undefined ? undefined : optionalNullableString(input.dueAt, "dueAt"),
    title: input.title === undefined ? undefined : requiredString(input.title, "title"),
    description:
      input.description === undefined
        ? undefined
        : optionalNullableString(input.description, "description"),
    completionEvidence:
      input.completionEvidence === undefined
        ? undefined
        : recordField(input.completionEvidence, "completionEvidence"),
    cancelledReason:
      input.cancelledReason === undefined
        ? undefined
        : optionalNullableString(input.cancelledReason, "cancelledReason")
  };
  if (parsed.status === "done" && !parsed.completionEvidence) {
    throw validation("Completed tasks require completionEvidence.", {
      field: "completionEvidence"
    });
  }
  if (parsed.status === "cancelled" && !parsed.cancelledReason) {
    throw validation("Cancelled tasks require cancelledReason.", { field: "cancelledReason" });
  }
  return parsed;
}

function parseGenerateDueContinuity(
  body: unknown,
  defaultAsOf: string
): GenerateDueContinuityInput {
  const input = body === undefined ? {} : objectBody(body);
  return {
    asOf: requiredString(input.asOf ?? defaultAsOf, "asOf"),
    batchSize:
      input.batchSize === undefined
        ? undefined
        : integerField(input.batchSize, "batchSize", { min: 1, max: 25 }),
    cursor: optionalNullableString(input.cursor, "cursor")
  };
}

function parseCreateRecallRule(body: unknown): CreateRecallRuleInput {
  const input = objectBody(body);
  const anchor =
    input.anchor === undefined
      ? undefined
      : parseRecallRuleAnchor(requiredString(input.anchor, "anchor"));
  const parsed = {
    code: requiredString(input.code, "code"),
    title: requiredString(input.title, "title"),
    anchor,
    offsetDays: integerField(input.offsetDays ?? 183, "offsetDays", { min: 1, max: 3650 }),
    procedureCategory: optionalNullableString(input.procedureCategory, "procedureCategory"),
    pricebookProcedureId: optionalUuid(input.pricebookProcedureId, "pricebookProcedureId"),
    defaultTaskTitle: optionalNullableString(input.defaultTaskTitle, "defaultTaskTitle"),
    defaultTaskPriority:
      input.defaultTaskPriority === undefined
        ? "normal"
        : parseTaskPriority(requiredString(input.defaultTaskPriority, "defaultTaskPriority"))
  };
  if (
    parsed.anchor === "checkout_completed" &&
    (parsed.procedureCategory !== null || parsed.pricebookProcedureId !== null)
  ) {
    throw validation("Checkout-anchored recalls cannot include procedure filters.", {
      field: "anchor"
    });
  }
  return parsed;
}

function parseRecallSearch(query: URLSearchParams) {
  const status = query.get("status");
  return {
    status: status ? parseRecallStatus(status) : null,
    dueBefore: query.get("dueBefore"),
    patientId: uuidOrNullQuery(query.get("patientId"), "patientId"),
    limit: integerQueryParam(query.get("limit"), "limit")
  };
}

function parseRecallAction(body: unknown): RecordRecallActionInput {
  const input = objectBody(body);
  return {
    actionType: parseRecallActionType(requiredString(input.actionType, "actionType")),
    method: optionalNullableString(input.method, "method"),
    appointmentId: optionalUuid(input.appointmentId, "appointmentId"),
    evidence: recordField(input.evidence, "evidence"),
    notes: optionalNullableString(input.notes, "notes")
  };
}

function parseCreateSopTemplate(body: unknown): CreateSopTemplateInput {
  const input = objectBody(body);
  const items = input.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw validation("SOP template items must be a non-empty array.", { field: "items" });
  }
  return {
    code: requiredString(input.code, "code"),
    title: requiredString(input.title, "title"),
    description: optionalNullableString(input.description, "description"),
    items: items.map((itemValue, index) => {
      const item = objectField(itemValue, `items[${index}]`);
      return {
        title: requiredString(item.title, `items[${index}].title`),
        instructions: optionalNullableString(item.instructions, `items[${index}].instructions`),
        evidenceRequired:
          item.evidenceRequired === undefined
            ? false
            : booleanField(item.evidenceRequired, `items[${index}].evidenceRequired`)
      };
    })
  };
}

function parseCreateSopSchedule(body: unknown): CreateSopScheduleInput {
  const input = objectBody(body);
  const recurrenceType = parseSopRecurrenceType(
    requiredString(input.recurrenceType, "recurrenceType")
  );
  const parsed = {
    templateId: uuidField(input.templateId, "templateId"),
    title: requiredString(input.title, "title"),
    recurrenceType,
    intervalDays:
      input.intervalDays === undefined || input.intervalDays === null
        ? null
        : integerField(input.intervalDays, "intervalDays", { min: 1, max: 365 }),
    dayOfWeek:
      input.dayOfWeek === undefined || input.dayOfWeek === null
        ? null
        : integerField(input.dayOfWeek, "dayOfWeek", { min: 0, max: 6 }),
    dayOfMonth:
      input.dayOfMonth === undefined || input.dayOfMonth === null
        ? null
        : integerField(input.dayOfMonth, "dayOfMonth", { min: 1, max: 31 }),
    dueTime: requiredString(input.dueTime, "dueTime"),
    timezone: optionalNullableString(input.timezone, "timezone"),
    startsOn: requiredString(input.startsOn, "startsOn"),
    endsOn: optionalNullableString(input.endsOn, "endsOn"),
    assignedToUserId: optionalUuid(input.assignedToUserId, "assignedToUserId"),
    defaultTaskPriority:
      input.defaultTaskPriority === undefined
        ? "normal"
        : parseTaskPriority(requiredString(input.defaultTaskPriority, "defaultTaskPriority"))
  };
  assertSopScheduleShape(parsed);
  return parsed;
}

function parseGenerateDueSopRuns(body: unknown, defaultAsOf: string): GenerateDueSopRunsInput {
  const input = body === undefined ? {} : objectBody(body);
  return {
    asOf: requiredString(input.asOf ?? defaultAsOf, "asOf"),
    batchSize:
      input.batchSize === undefined
        ? undefined
        : integerField(input.batchSize, "batchSize", { min: 1, max: 25 }),
    cursor: optionalNullableString(input.cursor, "cursor")
  };
}

function parseSopRunSearch(query: URLSearchParams): SopRunSearchFilter {
  const status = query.get("status");
  return {
    date: query.get("date"),
    status: status ? parseSopRunStatus(status) : null,
    dueBefore: query.get("dueBefore"),
    limit: integerQueryParam(query.get("limit"), "limit")
  };
}

function parseUpdateSopRun(body: unknown): UpdateSopRunInput {
  const input = objectBody(body);
  const items = input.items;
  const parsed = {
    status:
      input.status === undefined
        ? undefined
        : parseSopRunStatus(requiredString(input.status, "status")),
    completionEvidence:
      input.completionEvidence === undefined
        ? undefined
        : recordField(input.completionEvidence, "completionEvidence"),
    items: items === undefined ? undefined : parseSopRunItemUpdates(items)
  };
  if (parsed.status === "completed" && !parsed.completionEvidence) {
    throw validation("Completed SOP runs require completionEvidence.", {
      field: "completionEvidence"
    });
  }
  return parsed;
}

function parseSopRunItemUpdates(value: unknown): NonNullable<UpdateSopRunInput["items"]> {
  if (!Array.isArray(value)) throw validation("items must be an array.", { field: "items" });
  return value.map((itemValue, index) => {
    const item = objectField(itemValue, `items[${index}]`);
    return {
      itemId: uuidField(item.itemId ?? item.id, `items[${index}].itemId`),
      status: parseSopRunItemStatus(requiredString(item.status, `items[${index}].status`)),
      evidence: recordField(item.evidence, `items[${index}].evidence`)
    };
  });
}

function parseCreateIntakeFormTemplate(body: unknown): CreateIntakeFormTemplateInput {
  const input = objectBody(body);
  return {
    code: requiredString(input.code, "code"),
    displayName: requiredString(input.displayName, "displayName"),
    formType: parseIntakeFormType(requiredString(input.formType, "formType")),
    version: integerField(input.version ?? 1, "version", { min: 1 }),
    schema: recordField(input.schema, "schema"),
    active: input.active === undefined ? true : booleanField(input.active, "active")
  };
}

function parseCreateIntakeFormSubmission(
  body: unknown,
  patientId: UUID
): CreateIntakeFormSubmissionInput {
  const input = objectBody(body);
  return {
    patientId,
    templateId: uuidField(input.templateId, "templateId"),
    source: parseIntakeSubmissionSource(requiredString(input.source ?? "digital", "source")),
    responses: recordField(input.responses, "responses"),
    medicalHistorySnapshot: recordField(input.medicalHistorySnapshot, "medicalHistorySnapshot"),
    provenance: recordField(input.provenance, "provenance")
  };
}

function parseCreateConsent(body: unknown, patientId: UUID): CreateConsentInput {
  const input = objectBody(body);
  return {
    patientId,
    purpose: parseConsentPurpose(requiredString(input.purpose, "purpose")),
    templateCode: requiredString(input.templateCode, "templateCode"),
    templateVersion: integerField(input.templateVersion, "templateVersion", { min: 1 }),
    captureMethod: parseConsentCaptureMethod(
      requiredString(input.captureMethod ?? "clinic_staff", "captureMethod")
    ),
    grantedByName: optionalNullableString(input.grantedByName, "grantedByName"),
    relationshipToPatient: optionalNullableString(
      input.relationshipToPatient,
      "relationshipToPatient"
    ),
    evidence: recordField(input.evidence, "evidence"),
    provenance: recordField(input.provenance, "provenance")
  };
}

function parseCreateEncounter(body: unknown): CreateEncounterInput {
  const input = objectBody(body);
  return {
    patientId: uuidField(input.patientId, "patientId"),
    appointmentId: optionalUuid(input.appointmentId, "appointmentId"),
    providerUserId: uuidField(input.providerUserId, "providerUserId"),
    reason: optionalNullableString(input.reason, "reason"),
    medicalHistorySnapshot: recordField(input.medicalHistorySnapshot, "medicalHistorySnapshot")
  };
}

function parseSaveClinicalNoteDraft(body: unknown): {
  content: ClinicalNoteContent;
  readyForSign?: boolean;
} {
  const input = objectBody(body);
  return {
    content: parseClinicalNoteContent(input.content ?? input.sections),
    readyForSign:
      input.readyForSign === undefined
        ? undefined
        : booleanField(input.readyForSign, "readyForSign")
  };
}

function parseAmendClinicalNote(body: unknown): {
  content: ClinicalNoteContent;
  amendmentReason: string;
} {
  const input = objectBody(body);
  return {
    content: parseClinicalNoteContent(input.content ?? input.sections),
    amendmentReason: requiredString(input.amendmentReason ?? input.reason, "amendmentReason")
  };
}

function parseCreatePrescription(body: unknown): CreatePrescriptionInput {
  const input = objectBody(body);
  return {
    medications: parsePrescriptionMedications(input.medications),
    notes: optionalNullableString(input.notes, "notes")
  };
}

function parseCreatePatientInstruction(body: unknown): CreatePatientInstructionInput {
  const input = objectBody(body);
  const channel = requiredString(input.channel ?? "print", "channel");
  if (!isPatientInstructionChannel(channel)) {
    throw validation("channel must be print or whatsapp.", { field: "channel" });
  }

  return {
    channel,
    templateId: requiredString(input.templateId, "templateId"),
    title: optionalNullableString(input.title, "title"),
    body: optionalNullableString(input.body, "body")
  };
}

function parseCreateDentalFinding(
  body: unknown,
  defaults: { encounterId?: UUID | null } = {}
): CreateDentalFindingInput {
  const input = objectBody(body);
  const bodyEncounterId = optionalUuid(input.encounterId, "encounterId");
  if (defaults.encounterId && bodyEncounterId && bodyEncounterId !== defaults.encounterId) {
    throw validation("Dental finding encounter context does not match the route.", {
      expected_encounter_id: defaults.encounterId,
      received_encounter_id: bodyEncounterId
    });
  }
  const statusFields = parseDentalStatusFields(
    input.status,
    input.reviewStatus ?? input.reviewState
  );

  return {
    encounterId: defaults.encounterId ?? bodyEncounterId,
    toothNumber: requiredString(input.toothNumber, "toothNumber"),
    surface: parseDentalSurfaceField(input.surface ?? input.surfaces),
    findingType: parseDentalFindingType(requiredString(input.findingType, "findingType")),
    severity: optionalNullableString(input.severity, "severity"),
    status: statusFields.status,
    reviewStatus: statusFields.reviewStatus,
    source:
      input.source === undefined
        ? undefined
        : parseDentalFindingSource(requiredString(input.source, "source")),
    confidence: optionalUnitNumber(input.confidence, "confidence"),
    notes: optionalNullableString(input.notes ?? input.note ?? input.doctorNote, "notes"),
    provenance: recordField(input.provenance, "provenance"),
    treatmentReference: recordField(input.treatmentReference, "treatmentReference")
  };
}

function parseUpdateDentalFinding(body: unknown): UpdateDentalFindingRepositoryInput {
  const input = objectBody(body);
  const statusFields = parseDentalStatusFields(
    input.status,
    input.reviewStatus ?? input.reviewState
  );

  return {
    encounterId:
      input.encounterId === undefined ? undefined : optionalUuid(input.encounterId, "encounterId"),
    toothNumber:
      input.toothNumber === undefined
        ? undefined
        : requiredString(input.toothNumber, "toothNumber"),
    surface:
      input.surface === undefined && input.surfaces === undefined
        ? undefined
        : parseDentalSurfaceField(input.surface ?? input.surfaces),
    findingType:
      input.findingType === undefined
        ? undefined
        : parseDentalFindingType(requiredString(input.findingType, "findingType")),
    severity:
      input.severity === undefined ? undefined : optionalNullableString(input.severity, "severity"),
    status: statusFields.status,
    reviewStatus: statusFields.reviewStatus,
    source:
      input.source === undefined
        ? undefined
        : parseDentalFindingSource(requiredString(input.source, "source")),
    confidence:
      input.confidence === undefined
        ? undefined
        : optionalUnitNumber(input.confidence, "confidence"),
    notes:
      input.notes === undefined && input.note === undefined && input.doctorNote === undefined
        ? undefined
        : optionalNullableString(input.notes ?? input.note ?? input.doctorNote, "notes"),
    provenance: recordField(input.provenance, "provenance"),
    treatmentReference: recordField(input.treatmentReference, "treatmentReference"),
    changeReason: requiredString(
      input.changeReason ?? input.reason ?? input.doctorNote ?? input.note,
      "changeReason"
    )
  };
}

function parseDentalChartSnapshot(body: unknown): CreateDentalChartSnapshotInput {
  const input = objectBody(body);
  return {
    encounterId: optionalUuid(input.encounterId, "encounterId"),
    reason: optionalNullableString(input.reason, "reason"),
    provenance: recordField(input.provenance, "provenance")
  };
}

function parseCreateTreatmentPlan(body: unknown): CreateTreatmentPlanInput {
  const input = objectBody(body);
  return {
    encounterId: optionalUuid(input.encounterId, "encounterId"),
    title: requiredString(input.title, "title"),
    clinicalSummary: optionalNullableString(input.clinicalSummary, "clinicalSummary"),
    status:
      input.status === undefined
        ? undefined
        : parseDraftTreatmentPlanStatus(requiredString(input.status, "status")),
    phases: parseTreatmentPlanPhases(input.phases)
  };
}

function parseUpdateTreatmentPlan(body: unknown): UpdateTreatmentPlanInput {
  const input = objectBody(body);
  return {
    title: input.title === undefined ? undefined : requiredString(input.title, "title"),
    clinicalSummary:
      input.clinicalSummary === undefined
        ? undefined
        : optionalNullableString(input.clinicalSummary, "clinicalSummary"),
    status:
      input.status === undefined
        ? undefined
        : parseMutableTreatmentPlanStatus(requiredString(input.status, "status")),
    phases: input.phases === undefined ? undefined : parseTreatmentPlanPhases(input.phases)
  };
}

function parseAcceptTreatmentPlan(body: unknown) {
  const input = body === undefined ? {} : objectBody(body);
  return {
    acceptedByName: optionalNullableString(input.acceptedByName, "acceptedByName"),
    acceptanceEvidence: recordField(input.acceptanceEvidence, "acceptanceEvidence")
  };
}

function parseCreateProcedurePerformed(body: unknown): CreateProcedurePerformedInput {
  const input = objectBody(body);
  return {
    treatmentPlanId: uuidField(input.treatmentPlanId, "treatmentPlanId"),
    treatmentPlanEstimateItemId: uuidField(
      input.treatmentPlanEstimateItemId ?? input.estimateItemId,
      "treatmentPlanEstimateItemId"
    ),
    performedAt: optionalNullableString(input.performedAt, "performedAt"),
    notes: optionalNullableString(input.notes, "notes"),
    outcome: optionalNullableString(input.outcome, "outcome"),
    provenance: recordField(input.provenance, "provenance")
  };
}

function parseCreateInvoice(body: unknown): CreateInvoiceInput {
  const input = objectBody(body);
  if (input.items !== undefined || input.lineItems !== undefined) {
    throw validation("Invoice line items must be derived from completed procedure evidence.", {
      forbidden_fields: ["items", "lineItems"]
    });
  }
  const procedurePerformedIds = uuidArrayField(
    input.procedurePerformedIds ?? input.procedureIds,
    "procedurePerformedIds"
  );
  const treatmentPlanId = optionalUuid(input.treatmentPlanId, "treatmentPlanId");

  if (!treatmentPlanId && procedurePerformedIds.length === 0) {
    throw validation("Invoice creation requires treatmentPlanId or procedurePerformedIds.", {
      required_any: ["treatmentPlanId", "procedurePerformedIds"]
    });
  }

  return {
    patientId: optionalUuid(input.patientId, "patientId"),
    treatmentPlanId,
    procedurePerformedIds,
    dueAt: optionalNullableString(input.dueAt, "dueAt")
  };
}

function parseCreateReceipt(body: unknown): CreateReceiptInput {
  const input = body === undefined ? {} : objectBody(body);
  return {
    paymentTransactionIds: uuidArrayField(input.paymentTransactionIds, "paymentTransactionIds")
  };
}

function parseTreatmentPlanPhases(value: unknown): CreateTreatmentPlanInput["phases"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw validation("phases must be a non-empty array.", { field: "phases" });
  }

  return value.map((phaseValue, phaseIndex) => {
    const phase = objectField(phaseValue, `phases[${phaseIndex}]`);
    const items = phase.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw validation(`phases[${phaseIndex}].items must be a non-empty array.`, {
        field: `phases[${phaseIndex}].items`
      });
    }

    return {
      title: requiredString(phase.title, `phases[${phaseIndex}].title`),
      description: optionalNullableString(phase.description, `phases[${phaseIndex}].description`),
      estimatedStartAfterDays:
        phase.estimatedStartAfterDays === undefined || phase.estimatedStartAfterDays === null
          ? null
          : integerField(
              phase.estimatedStartAfterDays,
              `phases[${phaseIndex}].estimatedStartAfterDays`,
              {
                min: 0
              }
            ),
      items: items.map((itemValue, itemIndex) => {
        const item = objectField(itemValue, `phases[${phaseIndex}].items[${itemIndex}]`);
        const quantity = integerField(
          item.quantity ?? 1,
          `phases[${phaseIndex}].items[${itemIndex}].quantity`,
          {
            min: 1,
            max: 999
          }
        );
        const unitPriceMinor =
          item.unitPriceMinor === undefined || item.unitPriceMinor === null
            ? null
            : integerField(
                item.unitPriceMinor,
                `phases[${phaseIndex}].items[${itemIndex}].unitPriceMinor`,
                {
                  min: 0
                }
              );
        const discountMinor = integerField(
          item.discountMinor ?? 0,
          `phases[${phaseIndex}].items[${itemIndex}].discountMinor`,
          { min: 0 }
        );
        const taxRateBasisPoints =
          item.taxRateBasisPoints === undefined || item.taxRateBasisPoints === null
            ? null
            : integerField(
                item.taxRateBasisPoints,
                `phases[${phaseIndex}].items[${itemIndex}].taxRateBasisPoints`,
                { min: 0, max: 10000 }
              );

        if (unitPriceMinor !== null) {
          try {
            calculateBillingLineTotals({
              quantity,
              unitPriceMinor,
              discountMinor,
              taxRateBasisPoints: taxRateBasisPoints ?? 0
            });
          } catch (error) {
            throw validation(
              error instanceof Error ? error.message : "Invalid estimate item total.",
              {
                field: `phases[${phaseIndex}].items[${itemIndex}]`
              }
            );
          }
        }

        return {
          pricebookProcedureId: uuidField(
            item.pricebookProcedureId,
            `phases[${phaseIndex}].items[${itemIndex}].pricebookProcedureId`
          ),
          dentalFindingId: optionalUuid(
            item.dentalFindingId,
            `phases[${phaseIndex}].items[${itemIndex}].dentalFindingId`
          ),
          toothNumber: optionalNullableString(
            item.toothNumber,
            `phases[${phaseIndex}].items[${itemIndex}].toothNumber`
          ),
          quantity,
          unitPriceMinor,
          discountMinor,
          taxRateBasisPoints,
          estimatedVisits: integerField(
            item.estimatedVisits ?? 1,
            `phases[${phaseIndex}].items[${itemIndex}].estimatedVisits`,
            { min: 1, max: 99 }
          ),
          priority: optionalNullableString(
            item.priority,
            `phases[${phaseIndex}].items[${itemIndex}].priority`
          ),
          notes: optionalNullableString(
            item.notes,
            `phases[${phaseIndex}].items[${itemIndex}].notes`
          )
        };
      })
    };
  });
}

function parseMediaUploadRequest(body: unknown): {
  patientId: UUID;
  encounterId: UUID | null;
  toothNumber: string | null;
  dentalFindingId: UUID | null;
  mediaType: MediaType;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Digest: string | null;
  tags: string[];
  provenance: Record<string, unknown>;
} {
  const input = objectBody(body);
  const mediaType = parseMediaType(requiredString(input.mediaType, "mediaType"));
  const mimeType = requiredString(input.mimeType, "mimeType").toLowerCase();

  try {
    assertMediaMimeType(mediaType, mimeType);
  } catch (error) {
    throw validation(error instanceof Error ? error.message : "Invalid media mime type.", {
      field: "mimeType",
      mediaType,
      mimeType
    });
  }

  return {
    patientId: uuidField(input.patientId, "patientId"),
    encounterId: optionalUuid(input.encounterId, "encounterId"),
    toothNumber: optionalNullableString(input.toothNumber, "toothNumber") ?? null,
    dentalFindingId: optionalUuid(input.dentalFindingId, "dentalFindingId"),
    mediaType,
    originalFilename: requiredString(input.originalFilename, "originalFilename"),
    mimeType,
    fileSizeBytes: integerField(input.fileSizeBytes, "fileSizeBytes", {
      min: 1,
      max: 100 * 1024 * 1024
    }),
    sha256Digest: optionalSha256Digest(input.sha256Digest, "sha256Digest"),
    tags: stringArrayField(input.tags, "tags"),
    provenance: recordField(input.provenance, "provenance")
  };
}

function parseCompleteMediaUpload(body: unknown): {
  patientId: UUID;
  encounterId: UUID | null;
  contentLength?: number | null;
  sha256Digest?: string | null;
  mimeType?: string | null;
  objectVersion?: string | null;
  scanStatus: MediaScanStatus;
  quarantineReason?: string | null;
  dicomMetadata: Record<string, unknown>;
} {
  const input = objectBody(body);
  return {
    patientId: uuidField(input.patientId, "patientId"),
    encounterId: optionalUuid(input.encounterId, "encounterId"),
    contentLength:
      input.contentLength === undefined || input.contentLength === null
        ? null
        : integerField(input.contentLength, "contentLength", { min: 1, max: 100 * 1024 * 1024 }),
    sha256Digest: optionalSha256Digest(input.sha256Digest, "sha256Digest"),
    mimeType: optionalNullableString(input.mimeType, "mimeType")?.toLowerCase() ?? null,
    objectVersion: optionalNullableString(input.objectVersion, "objectVersion"),
    scanStatus: parseMediaScanStatus(requiredString(input.scanStatus ?? "pending", "scanStatus")),
    quarantineReason: optionalNullableString(input.quarantineReason, "quarantineReason"),
    dicomMetadata: recordField(input.dicomMetadata, "dicomMetadata")
  };
}

function parseSignedMediaAccessRequest(body: unknown): { expiresInSeconds?: number } {
  const input = body === undefined ? {} : objectBody(body);
  if (input.expiresInSeconds === undefined) return {};
  return {
    expiresInSeconds: integerField(input.expiresInSeconds, "expiresInSeconds", {
      min: 30,
      max: 300
    })
  };
}

function parsePaymentRequest(
  body: unknown,
  invoice: { id: UUID; balanceMinor: number }
): {
  requestType: PaymentProviderRequestKind;
  amountMinor: number;
  expiresAt: string | null;
  description: string | null;
  customer: { name?: string | null; email?: string | null; contact?: string | null } | null;
  metadata: Record<string, unknown>;
} {
  const input = objectBody(body);
  const requestType = parsePaymentRequestType(
    requiredString(input.requestType ?? input.type ?? "payment_link", "requestType")
  );
  const amountMinor =
    input.amountMinor === undefined && input.amountPaise === undefined
      ? invoice.balanceMinor
      : integerField(input.amountMinor ?? input.amountPaise, "amountMinor", { min: 1 });

  if (amountMinor > invoice.balanceMinor) {
    throw conflict("Payment request amount exceeds the invoice amount due.", {
      invoice_id: invoice.id,
      balance_minor: invoice.balanceMinor,
      requested_amount_minor: amountMinor
    });
  }

  return {
    requestType,
    amountMinor,
    expiresAt: optionalNullableString(input.expiresAt, "expiresAt") ?? null,
    description: optionalNullableString(input.description, "description") ?? null,
    customer: parsePaymentCustomer(input.customer),
    metadata: recordField(input.metadata, "metadata")
  };
}

function parseManualPayment(body: unknown): {
  amountMinor: number;
  currency: string;
  method: ManualPaymentMethod;
  reason: string;
  reference: string;
  receivedAt: string | null;
  evidence: Record<string, unknown>;
} {
  const input = objectBody(body);
  const method = parseManualPaymentMethod(requiredString(input.method, "method"));
  const amountMinor = integerField(input.amountMinor ?? input.amountPaise, "amountMinor", {
    min: 1
  });
  const parsed = {
    amountPaise: amountMinor,
    currency: requiredString(input.currency ?? "INR", "currency").toUpperCase(),
    method,
    reason: requiredString(input.reason, "reason"),
    reference: requiredString(input.reference, "reference"),
    receivedAt: optionalNullableString(input.receivedAt, "receivedAt") ?? null,
    evidence: recordField(input.evidence, "evidence")
  };

  try {
    assertManualPaymentEvidence(parsed);
  } catch (error) {
    throw validation(
      error instanceof Error ? error.message : "Manual payment evidence is invalid.",
      {
        field: "manualPayment"
      }
    );
  }

  return {
    amountMinor,
    currency: parsed.currency,
    method: parsed.method,
    reason: parsed.reason,
    reference: parsed.reference,
    receivedAt: parsed.receivedAt,
    evidence: parsed.evidence
  };
}

function parsePaymentCustomer(
  value: unknown
): { name?: string | null; email?: string | null; contact?: string | null } | null {
  if (value === undefined || value === null) return null;
  const input = objectField(value, "customer");
  return {
    name: optionalNullableString(input.name, "customer.name"),
    email: optionalNullableString(input.email, "customer.email"),
    contact: optionalNullableString(input.contact, "customer.contact")
  };
}

function parseCreateLabVendor(body: unknown): CreateLabVendorInput {
  const input = objectBody(body);
  return {
    displayName: requiredString(input.displayName ?? input.name, "displayName"),
    phone: optionalNullableString(input.phone, "phone"),
    email: optionalNullableString(input.email, "email"),
    address: recordField(input.address, "address"),
    taxRegistrationNumber: optionalNullableString(
      input.taxRegistrationNumber,
      "taxRegistrationNumber"
    ),
    paymentTermsDays:
      input.paymentTermsDays === undefined
        ? undefined
        : integerField(input.paymentTermsDays, "paymentTermsDays", { min: 0, max: 365 })
  };
}

function parseCreateLabCase(body: unknown): CreateLabCaseInput {
  const input = objectBody(body);
  const items = arrayField(input.items, "items").map((value, index) => {
    const item = objectField(value, `items[${index}]`);
    return {
      itemType: requiredString(item.itemType ?? item.type, `items[${index}].itemType`),
      toothNumber: optionalNullableString(item.toothNumber, `items[${index}].toothNumber`),
      material: optionalNullableString(item.material, `items[${index}].material`),
      shade: optionalNullableString(item.shade, `items[${index}].shade`),
      quantity:
        item.quantity === undefined
          ? 1
          : integerField(item.quantity, `items[${index}].quantity`, { min: 1, max: 99 }),
      notes: optionalNullableString(item.notes, `items[${index}].notes`)
    };
  });
  if (items.length === 0)
    throw validation("Lab case requires at least one item.", { field: "items" });
  return {
    vendorId: uuidField(input.vendorId, "vendorId"),
    patientId: uuidField(input.patientId, "patientId"),
    encounterId: optionalUuid(input.encounterId, "encounterId"),
    treatmentPlanId: optionalUuid(input.treatmentPlanId, "treatmentPlanId"),
    treatmentPlanEstimateItemId: optionalUuid(
      input.treatmentPlanEstimateItemId,
      "treatmentPlanEstimateItemId"
    ),
    procedurePerformedId: optionalUuid(input.procedurePerformedId, "procedurePerformedId"),
    title: requiredString(input.title, "title"),
    priority: parseLabPriority(input.priority ?? "routine"),
    dueAt: requiredString(input.dueAt, "dueAt"),
    clinicalNotes: optionalNullableString(input.clinicalNotes, "clinicalNotes"),
    internalNotes: optionalNullableString(input.internalNotes, "internalNotes"),
    expectedCostMinor:
      input.expectedCostMinor === undefined || input.expectedCostMinor === null
        ? null
        : integerField(input.expectedCostMinor, "expectedCostMinor", { min: 0 }),
    slipMetadata: recordField(input.slipMetadata, "slipMetadata"),
    items
  };
}

function parseUpdateLabCaseStatus(body: unknown): UpdateLabCaseStatusInput {
  const input = objectBody(body);
  return {
    status: parseLabCaseStatus(requiredString(input.status, "status")),
    reason: optionalNullableString(input.reason, "reason"),
    evidence: recordField(input.evidence, "evidence")
  };
}

function parseCreateLabReconciliation(body: unknown): CreateLabReconciliationInput {
  const input = objectBody(body);
  const entries = arrayField(input.entries, "entries").map((value, index) => {
    const entry = objectField(value, `entries[${index}]`);
    return {
      labCaseId: uuidField(entry.labCaseId, `entries[${index}].labCaseId`),
      status:
        entry.status === undefined
          ? undefined
          : parseLabReconciliationEntryStatus(
              requiredString(entry.status, `entries[${index}].status`)
            ),
      invoiceAmountMinor:
        entry.invoiceAmountMinor === undefined || entry.invoiceAmountMinor === null
          ? null
          : integerField(entry.invoiceAmountMinor, `entries[${index}].invoiceAmountMinor`, {
              min: 0
            }),
      notes: optionalNullableString(entry.notes, `entries[${index}].notes`)
    };
  });
  if (entries.length === 0) {
    throw validation("Lab reconciliation requires at least one entry.", { field: "entries" });
  }
  return {
    vendorId: uuidField(input.vendorId, "vendorId"),
    periodStart: requiredString(input.periodStart, "periodStart"),
    periodEnd: requiredString(input.periodEnd, "periodEnd"),
    status:
      input.status === undefined
        ? undefined
        : parseLabReconciliationStatus(requiredString(input.status, "status")),
    invoiceReference: optionalNullableString(input.invoiceReference, "invoiceReference"),
    invoiceAmountMinor:
      input.invoiceAmountMinor === undefined || input.invoiceAmountMinor === null
        ? null
        : integerField(input.invoiceAmountMinor, "invoiceAmountMinor", { min: 0 }),
    evidence: recordField(input.evidence, "evidence"),
    entries
  };
}

function parseCreateInventoryCategory(body: unknown): CreateInventoryCategoryInput {
  const input = objectBody(body);
  return {
    code: requiredString(input.code, "code"),
    displayName: requiredString(input.displayName, "displayName"),
    kind: parseInventoryCategoryKind(requiredString(input.kind, "kind")),
    active: input.active === undefined ? undefined : booleanField(input.active, "active")
  };
}

function parseCreateInventoryItem(body: unknown): CreateInventoryItemInput {
  const input = objectBody(body);
  return {
    categoryId: uuidField(input.categoryId, "categoryId"),
    sku: requiredString(input.sku, "sku"),
    displayName: requiredString(input.displayName, "displayName"),
    unitOfMeasure: requiredString(input.unitOfMeasure, "unitOfMeasure"),
    storageLocation: requiredString(input.storageLocation, "storageLocation"),
    trackQuantity:
      input.trackQuantity === undefined
        ? undefined
        : booleanField(input.trackQuantity, "trackQuantity"),
    minimumQuantity:
      input.minimumQuantity === undefined
        ? undefined
        : nonNegativeNumberField(input.minimumQuantity, "minimumQuantity"),
    reorderQuantity:
      input.reorderQuantity === undefined
        ? undefined
        : nonNegativeNumberField(input.reorderQuantity, "reorderQuantity"),
    openingQuantity:
      input.openingQuantity === undefined
        ? undefined
        : nonNegativeNumberField(input.openingQuantity, "openingQuantity")
  };
}

function parseCreateStockLedgerEntry(body: unknown): CreateStockLedgerEntryInput {
  const input = objectBody(body);
  return {
    itemId: uuidField(input.itemId, "itemId"),
    movementType: parseStockLedgerMovementType(requiredString(input.movementType, "movementType")),
    quantityDelta: numberField(input.quantityDelta, "quantityDelta"),
    unitCostMinor:
      input.unitCostMinor === undefined || input.unitCostMinor === null
        ? null
        : integerField(input.unitCostMinor, "unitCostMinor", { min: 0 }),
    currency:
      input.currency === undefined || input.currency === null
        ? null
        : parseBillingCurrency(requiredString(input.currency, "currency")),
    sourceTable: optionalNullableString(input.sourceTable, "sourceTable"),
    sourceId: optionalUuid(input.sourceId, "sourceId"),
    reason: requiredString(input.reason, "reason"),
    evidence: recordField(input.evidence, "evidence")
  };
}

function parseCreateInventoryCheckTemplate(body: unknown): CreateInventoryCheckTemplateInput {
  const input = objectBody(body);
  const lines = arrayField(input.lines, "lines").map((value, index) => {
    const line = objectField(value, `lines[${index}]`);
    return {
      itemId: uuidField(line.itemId, `lines[${index}].itemId`),
      sequence: integerField(line.sequence ?? index + 1, `lines[${index}].sequence`, { min: 1 }),
      drawerLocation: requiredString(line.drawerLocation, `lines[${index}].drawerLocation`),
      expectedQuantity:
        line.expectedQuantity === undefined || line.expectedQuantity === null
          ? null
          : nonNegativeNumberField(line.expectedQuantity, `lines[${index}].expectedQuantity`),
      required:
        line.required === undefined
          ? true
          : booleanField(line.required, `lines[${index}].required`),
      instructions: optionalNullableString(line.instructions, `lines[${index}].instructions`)
    };
  });
  if (lines.length === 0) {
    throw validation("Inventory check template requires at least one line.", { field: "lines" });
  }
  return {
    code: requiredString(input.code, "code"),
    displayName: requiredString(input.displayName, "displayName"),
    cadence: parseInventoryCadence(requiredString(input.cadence ?? "monthly", "cadence")),
    active: input.active === undefined ? undefined : booleanField(input.active, "active"),
    lines
  };
}

function parseCreateInventoryCheckRun(body: unknown): CreateInventoryCheckRunInput {
  const input = objectBody(body);
  return {
    templateId: uuidField(input.templateId, "templateId"),
    notes: optionalNullableString(input.notes, "notes")
  };
}

function parseUpdateInventoryCheckRun(body: unknown): UpdateInventoryCheckRunInput {
  const input = objectBody(body);
  return {
    status: parseInventoryCheckRunStatus(requiredString(input.status, "status")),
    notes: optionalNullableString(input.notes, "notes"),
    lines:
      input.lines === undefined
        ? undefined
        : arrayField(input.lines, "lines").map((value, index) => {
            const line = objectField(value, `lines[${index}]`);
            return {
              lineId: uuidField(line.lineId ?? line.id, `lines[${index}].lineId`),
              countedQuantity: nonNegativeNumberField(
                line.countedQuantity,
                `lines[${index}].countedQuantity`
              ),
              exceptionNotes: optionalNullableString(
                line.exceptionNotes,
                `lines[${index}].exceptionNotes`
              )
            };
          })
  };
}

function parseCreateIncident(body: unknown): CreateIncidentInput {
  const input = objectBody(body);
  return {
    patientId: optionalUuid(input.patientId, "patientId"),
    appointmentId: optionalUuid(input.appointmentId, "appointmentId"),
    labCaseId: optionalUuid(input.labCaseId, "labCaseId"),
    inventoryItemId: optionalUuid(input.inventoryItemId, "inventoryItemId"),
    category: parseIncidentCategory(requiredString(input.category, "category")),
    severity: parseIncidentSeverity(requiredString(input.severity, "severity")),
    occurredAt: requiredString(input.occurredAt, "occurredAt"),
    location: optionalNullableString(input.location, "location"),
    summary: requiredString(input.summary, "summary"),
    description: requiredString(input.description, "description"),
    impact: optionalNullableString(input.impact, "impact"),
    learning: optionalNullableString(input.learning, "learning"),
    immediateAction: optionalNullableString(input.immediateAction, "immediateAction"),
    evidence: recordField(input.evidence, "evidence"),
    ownerUserId: optionalUuid(input.ownerUserId, "ownerUserId")
  };
}

function parseCreateCorrectiveAction(body: unknown): CreateCorrectiveActionInput {
  const input = objectBody(body);
  return {
    incidentId: optionalUuid(input.incidentId, "incidentId"),
    actionType: parseCorrectiveActionType(
      requiredString(input.actionType ?? "corrective", "actionType")
    ),
    title: requiredString(input.title, "title"),
    description: requiredString(input.description, "description"),
    ownerUserId: uuidField(input.ownerUserId, "ownerUserId"),
    dueAt: requiredString(input.dueAt, "dueAt"),
    verificationEvidence: recordField(input.verificationEvidence, "verificationEvidence")
  };
}

function parseUpdateCorrectiveAction(body: unknown): UpdateCorrectiveActionInput {
  const input = objectBody(body);
  return {
    status: parseCorrectiveActionStatus(requiredString(input.status, "status")),
    completionEvidence: recordField(input.completionEvidence, "completionEvidence"),
    verificationEvidence:
      input.verificationEvidence === undefined
        ? undefined
        : recordField(input.verificationEvidence, "verificationEvidence")
  };
}

function parseClinicalNoteContent(value: unknown): ClinicalNoteContent {
  const input = objectField(value, "content");
  return {
    chiefComplaint: optionalString(input.chiefComplaint, "chiefComplaint"),
    history: optionalString(input.history, "history"),
    examination: optionalString(input.examination, "examination"),
    investigations: optionalString(input.investigations, "investigations"),
    diagnosis: optionalString(input.diagnosis, "diagnosis"),
    treatmentPlan: optionalString(input.treatmentPlan, "treatmentPlan"),
    treatmentPerformed: optionalString(input.treatmentPerformed, "treatmentPerformed"),
    followUpInstructions: optionalString(input.followUpInstructions, "followUpInstructions"),
    additionalSections: recordField(input.additionalSections, "additionalSections")
  };
}

function parsePrescriptionMedications(value: unknown): PrescriptionMedication[] {
  if (!Array.isArray(value)) {
    throw validation("medications must be an array.", { field: "medications" });
  }

  return value.map((item, index) => {
    const input = objectField(item, `medications[${index}]`);
    return {
      name: requiredString(input.name, `medications[${index}].name`),
      strength: optionalString(input.strength, `medications[${index}].strength`),
      route: optionalString(input.route, `medications[${index}].route`),
      frequency: requiredString(input.frequency, `medications[${index}].frequency`),
      duration: requiredString(input.duration, `medications[${index}].duration`),
      instructions: optionalString(input.instructions, `medications[${index}].instructions`)
    };
  });
}

function parseGender(value: unknown) {
  const gender = requiredString(value, "gender");
  if (!["female", "male", "other", "unknown"].includes(gender)) {
    throw validation("Invalid patient gender.", { field: "gender" });
  }
  return gender as "female" | "male" | "other" | "unknown";
}

function parsePatientSource(value: string): PatientSource {
  if (!PATIENT_SOURCES.has(value as PatientSource)) {
    throw validation("Invalid patient source.", { field: "source", value });
  }
  return value as PatientSource;
}

function parseLeadSource(value: string): LeadSource {
  if (!LEAD_SOURCES.has(value as LeadSource)) {
    throw validation("Invalid lead source.", { field: "source", value });
  }
  return value as LeadSource;
}

function toLeadSource(source: PatientSource): LeadSource | null {
  return LEAD_SOURCES.has(source as LeadSource) ? (source as LeadSource) : null;
}

function parseLeadIntent(value: string): LeadIntent {
  if (!LEAD_INTENTS.has(value as LeadIntent)) {
    throw validation("Invalid lead intent.", { field: "intent", value });
  }
  return value as LeadIntent;
}

function parseLeadStatus(value: string): LeadStatus {
  if (!isValidLeadStatus(value))
    throw validation("Invalid lead status.", { field: "status", value });
  return value;
}

function parseAppointmentStatus(value: string): AppointmentStatus {
  if (!isAppointmentStatus(value)) {
    throw validation("Invalid appointment status.", { field: "status", value });
  }
  return value;
}

function parseIntakeFormType(value: string): IntakeFormType {
  if (!isIntakeFormType(value)) {
    throw validation("Invalid intake form type.", { field: "formType", value });
  }
  return value;
}

function parseIntakeSubmissionSource(value: string): IntakeSubmissionSource {
  if (!isIntakeSubmissionSource(value)) {
    throw validation("Invalid intake submission source.", { field: "source", value });
  }
  return value;
}

function parseConsentPurpose(value: string): ConsentPurpose {
  if (!isConsentPurpose(value)) {
    throw validation("Invalid consent purpose.", { field: "purpose", value });
  }
  return value;
}

function parseConsentCaptureMethod(value: string): ConsentCaptureMethod {
  if (!isConsentCaptureMethod(value)) {
    throw validation("Invalid consent capture method.", { field: "captureMethod", value });
  }
  return value;
}

function parseEncounterStatus(value: string): EncounterStatus {
  if (!isEncounterStatus(value)) {
    throw validation("Invalid encounter status.", { field: "status", value });
  }
  return value;
}

function parseDraftTreatmentPlanStatus(value: string): "draft" | "presented" {
  if (value !== "draft" && value !== "presented") {
    throw validation("Treatment plan creation only supports draft or presented status.", {
      field: "status",
      value
    });
  }
  return value;
}

function parseMutableTreatmentPlanStatus(
  value: string
): "draft" | "presented" | "declined" | "deferred" | "cancelled" {
  if (!isTreatmentPlanStatus(value) || value === "accepted") {
    throw validation(
      "Treatment plan status must be draft, presented, declined, deferred, or cancelled.",
      {
        field: "status",
        value
      }
    );
  }
  return value;
}

function parseQueueStatus(value: string): QueueStatus {
  if (!QUEUE_STATUSES.has(value as QueueStatus)) {
    throw validation("Invalid queue status.", { field: "status", value });
  }
  return value as QueueStatus;
}

function parseTaskStatus(value: string) {
  if (!isTaskStatus(value)) throw validation("Invalid task status.", { field: "status", value });
  return value;
}

function parseTaskType(value: string) {
  if (!isTaskType(value)) throw validation("Invalid task type.", { field: "taskType", value });
  return value;
}

function parseTaskPriority(value: string) {
  if (!isTaskPriority(value))
    throw validation("Invalid task priority.", { field: "priority", value });
  return value;
}

function parseTaskSourceWorkflow(value: string) {
  if (!isTaskSourceWorkflow(value)) {
    throw validation("Invalid task source workflow.", { field: "sourceWorkflow", value });
  }
  return value;
}

function parseRecallRuleAnchor(value: string) {
  if (!isRecallRuleAnchor(value))
    throw validation("Invalid recall rule anchor.", { field: "anchor", value });
  return value;
}

function parseRecallStatus(value: string) {
  if (!isRecallStatus(value))
    throw validation("Invalid recall status.", { field: "status", value });
  return value;
}

function parseRecallActionType(value: string) {
  if (!isRecallActionType(value)) {
    throw validation("Invalid recall action type.", { field: "actionType", value });
  }
  return value;
}

function parseSopRecurrenceType(value: string) {
  if (!isSopRecurrenceType(value)) {
    throw validation("Invalid SOP recurrence type.", { field: "recurrenceType", value });
  }
  return value;
}

function parseSopRunStatus(value: string) {
  if (!isSopRunStatus(value))
    throw validation("Invalid SOP run status.", { field: "status", value });
  return value;
}

function parseSopRunItemStatus(value: string) {
  if (!isSopRunItemStatus(value)) {
    throw validation("Invalid SOP run item status.", { field: "status", value });
  }
  return value;
}

function assertSopScheduleShape(input: CreateSopScheduleInput): void {
  const valid =
    (input.recurrenceType === "daily" &&
      input.intervalDays === null &&
      input.dayOfWeek === null &&
      input.dayOfMonth === null) ||
    (input.recurrenceType === "weekly" &&
      input.intervalDays === null &&
      input.dayOfWeek !== null &&
      input.dayOfMonth === null) ||
    (input.recurrenceType === "monthly" &&
      input.intervalDays === null &&
      input.dayOfWeek === null &&
      input.dayOfMonth !== null) ||
    (input.recurrenceType === "interval_days" &&
      input.intervalDays !== null &&
      input.dayOfWeek === null &&
      input.dayOfMonth === null);
  if (!valid) {
    throw validation("SOP schedule recurrence fields do not match recurrenceType.", {
      recurrenceType: input.recurrenceType
    });
  }
}

function parseMediaType(value: string): MediaType {
  if (!isMediaType(value)) {
    throw validation("Invalid media type.", { field: "mediaType", value });
  }
  return value;
}

function parseDentalFindingType(value: string): CreateDentalFindingInput["findingType"] {
  if (!isDentalFindingType(value)) {
    throw validation("Invalid dental finding type.", { field: "findingType", value });
  }
  return value;
}

function parseDentalFindingStatus(
  value: string
): NonNullable<UpdateDentalFindingRepositoryInput["status"]> {
  if (!isDentalFindingStatus(value)) {
    throw validation("Invalid dental finding status.", { field: "status", value });
  }
  return value;
}

function parseDentalFindingReviewStatus(
  value: string
): NonNullable<UpdateDentalFindingRepositoryInput["reviewStatus"]> {
  if (!isDentalFindingReviewStatus(value)) {
    throw validation("Invalid dental finding review status.", { field: "reviewStatus", value });
  }
  return value;
}

function parseDentalFindingSource(
  value: string
): NonNullable<UpdateDentalFindingRepositoryInput["source"]> {
  if (!isDentalFindingSource(value)) {
    throw validation("Invalid dental finding source.", { field: "source", value });
  }
  return value;
}

function parseDentalStatusFields(
  status: unknown,
  reviewStatus: unknown
): {
  status?: UpdateDentalFindingRepositoryInput["status"];
  reviewStatus?: UpdateDentalFindingRepositoryInput["reviewStatus"];
} {
  const parsed: {
    status?: UpdateDentalFindingRepositoryInput["status"];
    reviewStatus?: UpdateDentalFindingRepositoryInput["reviewStatus"];
  } = {};

  if (status !== undefined) {
    const value = requiredString(status, "status");
    if (value === "reviewed") {
      parsed.reviewStatus = "reviewed";
    } else if (value === "resolved") {
      parsed.status = "treated";
    } else {
      parsed.status = parseDentalFindingStatus(value);
    }
  }

  if (reviewStatus !== undefined) {
    parsed.reviewStatus = parseDentalFindingReviewStatus(
      requiredString(reviewStatus, "reviewStatus")
    );
  }

  return parsed;
}

function parseDentalSurfaceField(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length > 1) {
      throw validation("Dental findings currently accept one surface per finding row.", {
        field: "surfaces"
      });
    }
    return optionalNullableString(value[0], "surfaces[0]") ?? null;
  }
  return optionalNullableString(value, "surface") ?? null;
}

function parseMediaScanStatus(value: string): MediaScanStatus {
  if (!isMediaScanStatus(value)) {
    throw validation("Invalid media scan status.", { field: "scanStatus", value });
  }
  return value;
}

function parseLabPriority(value: unknown): "routine" | "urgent" {
  const parsed = requiredString(value, "priority");
  if (parsed !== "routine" && parsed !== "urgent") {
    throw validation("Invalid lab case priority.", { field: "priority", value: parsed });
  }
  return parsed;
}

function parseLabCaseStatus(value: string): LabCaseStatus {
  if (!isLabCaseStatus(value)) {
    throw validation("Invalid lab case status.", { field: "status", value });
  }
  return value;
}

function parseLabReconciliationStatus(
  value: string
): NonNullable<CreateLabReconciliationInput["status"]> {
  if (!isLabReconciliationStatus(value)) {
    throw validation("Invalid lab reconciliation status.", { field: "status", value });
  }
  return value;
}

function parseLabReconciliationEntryStatus(
  value: string
): NonNullable<CreateLabReconciliationInput["entries"][number]["status"]> {
  if (!isLabReconciliationEntryStatus(value)) {
    throw validation("Invalid lab reconciliation entry status.", { field: "status", value });
  }
  return value;
}

function parseInventoryCategoryKind(value: string): CreateInventoryCategoryInput["kind"] {
  if (!isInventoryCategoryKind(value)) {
    throw validation("Invalid inventory category kind.", { field: "kind", value });
  }
  return value;
}

function parseInventoryCadence(value: string): CreateInventoryCheckTemplateInput["cadence"] {
  if (["daily", "weekly", "monthly", "ad_hoc"].includes(value)) {
    return value as CreateInventoryCheckTemplateInput["cadence"];
  }
  throw validation("Invalid inventory check cadence.", { field: "cadence", value });
}

function parseInventoryCheckRunStatus(value: string): UpdateInventoryCheckRunInput["status"] {
  if (!isInventoryCheckRunStatus(value)) {
    throw validation("Invalid inventory check run status.", { field: "status", value });
  }
  return value;
}

function parseStockLedgerMovementType(value: string): CreateStockLedgerEntryInput["movementType"] {
  if (
    [
      "opening_balance",
      "manual_adjustment",
      "consumption",
      "check_variance",
      "procurement_received",
      "write_off"
    ].includes(value)
  ) {
    return value as CreateStockLedgerEntryInput["movementType"];
  }
  throw validation("Invalid stock ledger movement type.", { field: "movementType", value });
}

function parseIncidentCategory(value: string): CreateIncidentInput["category"] {
  if (!isIncidentCategory(value)) {
    throw validation("Invalid incident category.", { field: "category", value });
  }
  return value;
}

function parseIncidentSeverity(value: string): CreateIncidentInput["severity"] {
  if (!isIncidentSeverity(value)) {
    throw validation("Invalid incident severity.", { field: "severity", value });
  }
  return value;
}

function parseIncidentStatus(
  value: string
): NonNullable<Parameters<ClinicOperationsRepository["listIncidents"]>[1]>["status"] {
  if (!isIncidentStatus(value)) {
    throw validation("Invalid incident status.", { field: "status", value });
  }
  return value;
}

function parseCorrectiveActionType(value: string): CreateCorrectiveActionInput["actionType"] {
  if (!isCorrectiveActionType(value)) {
    throw validation("Invalid corrective action type.", { field: "actionType", value });
  }
  return value;
}

function parseCorrectiveActionStatus(value: string): UpdateCorrectiveActionInput["status"] {
  if (!isCorrectiveActionStatus(value)) {
    throw validation("Invalid corrective action status.", { field: "status", value });
  }
  return value;
}

function parsePaymentRequestType(value: string): PaymentProviderRequestKind {
  if (value === "payment_link") return "payment_link";
  if (value === "invoice_qr" || value === "dynamic_qr" || value === "qr" || value === "qr_code")
    return "invoice_qr";
  throw validation("Invalid payment request type.", { field: "requestType", value });
}

function parseBillingCurrency(value: string): "INR" {
  const normalized = value.toUpperCase();
  if (!isBillingCurrency(normalized)) {
    throw validation("Invalid billing currency.", { field: "currency", value });
  }
  return normalized;
}

function parseManualPaymentMethod(value: string): ManualPaymentMethod {
  if (!isManualPaymentMethod(value)) {
    throw validation("Invalid manual payment method.", { field: "method", value });
  }
  return value;
}

function normalizePaymentRequestType(kind: PaymentProviderRequestKind): PaymentRequestType {
  return kind === "invoice_qr" ? "dynamic_qr" : "payment_link";
}

function normalizeBillingPaymentProvider(providerKey: string): BillingPaymentProviderKey {
  if (providerKey === "razorpay") return "razorpay";
  if (providerKey === "simulator") return "simulator";
  return "simulator";
}

function scopeFromPaymentWebhook(event: PaymentProviderWebhookEvent): RepositoryScope | null {
  if (!event.tenantId || !event.clinicId || !isUuid(event.tenantId) || !isUuid(event.clinicId)) {
    return null;
  }
  return {
    tenantId: event.tenantId,
    clinicId: event.clinicId,
    actorUserId: SYSTEM_INTEGRATION_ACTOR_USER_ID
  };
}

function positiveProviderAmountMinor(amountMinor: number | null | undefined): number {
  return amountMinor && amountMinor > 0 ? amountMinor : 1;
}

function providerPaymentMetadata(
  event: PaymentProviderWebhookEvent,
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...metadata,
    providerEventId: event.providerEventId,
    providerEventName: event.eventName,
    providerEventKind: event.eventKind,
    rawBodySha256: event.rawBodySha256,
    providerPayload: event.payload
  };
}

function providerReconciliationItem(
  event: PaymentProviderWebhookEvent,
  reason: PaymentRouteReconciliationItemRecord["reason"],
  amountMinor: number
): PaymentRouteReconciliationItemRecord {
  return {
    id: randomUUID() as UUID,
    tenantId: event.tenantId && isUuid(event.tenantId) ? event.tenantId : null,
    clinicId: event.clinicId && isUuid(event.clinicId) ? event.clinicId : null,
    patientId: event.patientId && isUuid(event.patientId) ? event.patientId : null,
    invoiceId: event.invoiceId && isUuid(event.invoiceId) ? event.invoiceId : null,
    providerKey: event.providerKey,
    providerPaymentId: event.providerPaymentId ?? null,
    providerEventId: event.providerEventId,
    reason,
    amountPaise: amountMinor,
    currency: event.currency ?? null,
    status: "open",
    createdAt: event.occurredAt,
    metadata: providerPaymentMetadata(event, {})
  };
}

function publicProviderWebhookEvent(event: PaymentProviderWebhookEvent) {
  return {
    providerKey: event.providerKey,
    providerEventId: event.providerEventId,
    eventName: event.eventName,
    eventKind: event.eventKind
  };
}

function mediaStorageFrom(dependencies: OperationsDependencies): MediaStorageProvider {
  if (!dependencies.mediaStorage) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "Media storage provider is not configured for this ClinicOS runtime."
    );
  }
  return dependencies.mediaStorage;
}

function paymentProviderFrom(dependencies: OperationsDependencies): PaymentProvider {
  if (!dependencies.paymentProvider) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "Payment provider is not configured for this ClinicOS runtime."
    );
  }
  return dependencies.paymentProvider;
}

function paymentRepositoryFrom(dependencies: OperationsDependencies): PaymentOperationsRepository {
  if (!dependencies.paymentRepository) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "Payment repository adapter is not configured yet. Merge the CP5 Billing Domain storage adapter before enabling durable payment routes."
    );
  }
  return dependencies.paymentRepository;
}

function assertMediaUploadOpen(
  input: {
    id: UUID;
    status: string;
    expiresAt: string;
  },
  nowMs: number
): void {
  if (input.status !== "reserved") {
    throw conflict("Media upload reservation is not open.", {
      upload_id: input.id,
      status: input.status
    });
  }
  if (new Date(input.expiresAt).getTime() <= nowMs) {
    throw conflict("Media upload reservation has expired.", {
      upload_id: input.id,
      expires_at: input.expiresAt
    });
  }
}

function validateCompletedMediaObject(
  reservation: {
    id: UUID;
    expectedFileSizeBytes: number;
    expectedSha256Digest: string | null;
    mimeType: string;
  },
  object: { contentLength: number; sha256Digest: string; mimeType: string },
  input: { contentLength?: number | null; sha256Digest?: string | null; mimeType?: string | null }
): void {
  if (object.contentLength !== reservation.expectedFileSizeBytes) {
    throw validation("Stored media object size does not match the upload reservation.", {
      upload_id: reservation.id
    });
  }
  if (
    input.contentLength !== undefined &&
    input.contentLength !== null &&
    input.contentLength !== object.contentLength
  ) {
    throw validation("Complete-upload size does not match stored object metadata.", {
      upload_id: reservation.id
    });
  }
  if (object.mimeType.toLowerCase() !== reservation.mimeType.toLowerCase()) {
    throw validation("Stored media object content-type does not match the upload reservation.", {
      upload_id: reservation.id
    });
  }
  if (input.mimeType && input.mimeType.toLowerCase() !== object.mimeType.toLowerCase()) {
    throw validation("Complete-upload content-type does not match stored object metadata.", {
      upload_id: reservation.id
    });
  }
  if (
    reservation.expectedSha256Digest &&
    object.sha256Digest !== reservation.expectedSha256Digest
  ) {
    throw validation("Stored media object digest does not match the upload reservation.", {
      upload_id: reservation.id
    });
  }
  if (input.sha256Digest && input.sha256Digest !== object.sha256Digest) {
    throw validation("Complete-upload digest does not match stored object metadata.", {
      upload_id: reservation.id
    });
  }
}

function resolveAiGatewayProvider(dependencies: OperationsDependencies): AiGatewayProvider {
  if (dependencies.aiGatewayProvider) return dependencies.aiGatewayProvider;
  const config = dependencies.runtimeConfig;
  return createAiGatewayProvider({
    llmProvider: config?.providers.ai.llmProvider ?? "simulator",
    transcriptionProvider: config?.providers.ai.transcriptionProvider ?? "simulator",
    openaiApiKey: config?.providers.ai.openaiApiKey,
    fireworksApiKey: config?.providers.ai.fireworksApiKey,
    deepgramApiKey: config?.providers.ai.deepgramApiKey,
    dataResidencyApproved: false,
    liveCallsEnabled: false
  });
}

async function assertAiConsentStillActive(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  session: AiSessionRecord,
  input: { requireRawAudioRetention: boolean }
): Promise<void> {
  const consents = await dependencies.repository.listPatientConsents(
    scopeFrom(context),
    session.patientId
  );
  const readiness = evaluateAiAudioReadiness(consents, {
    requireRawAudioRetention: input.requireRawAudioRetention
  });
  await audit(context, dependencies, "consent.enforcement.checked", {
    patientId: session.patientId,
    resourceType: "ai_session",
    resourceId: session.id,
    metadata: {
      workflow: "ai_scribe",
      allowed: readiness.allowed,
      blockedReasons: readiness.blockedReasons.map((reason) => ({
        purpose: reason.purpose,
        reason: reason.reason,
        consentId: reason.consentId
      }))
    }
  });
  if (!readiness.allowed) {
    throw conflict("Active AI/audio consent is required before scribe processing.", {
      code: "AI_AUDIO_CONSENT_REQUIRED",
      blockedReasons: readiness.blockedReasons
    });
  }
}

function toPublicAiSession(session: AiSessionRecord) {
  return {
    ...session,
    consentSnapshot: {
      evaluatedAt: session.consentSnapshot.evaluatedAt,
      aiAudioCaptureAllowed: session.consentSnapshot.aiAudioCaptureAllowed,
      rawAudioRetentionAllowed: session.consentSnapshot.rawAudioRetentionAllowed,
      decisionReasons: session.consentSnapshot.decisionReasons
    },
    retentionPolicy: session.retentionPolicy
  };
}

function toPublicAiSessionDetail(detail: AiSessionDetail) {
  return {
    session: toPublicAiSession(detail.session),
    transcriptSegments: detail.transcriptSegments.map(toPublicAiTranscriptSegment),
    sourceAnchors: detail.sourceAnchors,
    jobs: detail.jobs,
    draftOutputs: detail.draftOutputs,
    actionProposals: detail.actionProposals,
    reviewDecisions: detail.reviewDecisions
  };
}

function toPublicAiTranscriptSegment(segment: AiSessionDetail["transcriptSegments"][number]) {
  return {
    id: segment.id,
    tenantId: segment.tenantId,
    clinicId: segment.clinicId,
    sessionId: segment.sessionId,
    patientId: segment.patientId,
    encounterId: segment.encounterId,
    sequence: segment.sequence,
    speakerRole: segment.speakerRole,
    startsAtMs: segment.startsAtMs,
    endsAtMs: segment.endsAtMs,
    textDigest: segment.sourceHash,
    createdByUserId: segment.createdByUserId,
    createdAt: segment.createdAt
  };
}

function aiSessionAuditMetadata(session: AiSessionRecord) {
  return {
    sessionId: session.id,
    encounterId: session.encounterId,
    providerMode: session.providerMode,
    llmProviderKey: session.llmProviderKey,
    transcriptionProviderKey: session.transcriptionProviderKey,
    rawAudioRetention: session.retentionPolicy.rawAudioRetention,
    providerTrainingAllowed: session.retentionPolicy.providerTrainingAllowed
  };
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mediaAuditMetadata(input: {
  mediaType: MediaType;
  mimeType: string;
  encounterId?: UUID | null;
  toothNumber?: string | null;
  dentalFindingId?: UUID | null;
  tags?: string[];
  scanStatus?: MediaScanStatus;
}) {
  return {
    mediaType: input.mediaType,
    mimeType: input.mimeType,
    encounterId: input.encounterId ?? null,
    toothNumber: input.toothNumber ?? null,
    dentalFindingId: input.dentalFindingId ?? null,
    tagCount: input.tags?.length ?? 0,
    ...(input.scanStatus ? { scanStatus: input.scanStatus } : {})
  };
}

function publicDentalNumberingSystem(value: string): string {
  return value.toUpperCase();
}

function publicDentalChart<T extends { numberingSystem: string }>(chart: T) {
  return {
    ...chart,
    numberingSystem: publicDentalNumberingSystem(chart.numberingSystem),
    notation: publicDentalNumberingSystem(chart.numberingSystem)
  };
}

function publicDentalFinding<T extends { numberingSystem: string; surface?: string | null }>(
  finding: T
) {
  return {
    ...finding,
    numberingSystem: publicDentalNumberingSystem(finding.numberingSystem),
    surfaces: finding.surface ? [finding.surface] : []
  };
}

function publicDentalFindingHistory<
  T extends {
    beforeState: DentalChartSnapshotFinding | null;
    afterState: DentalChartSnapshotFinding;
  }
>(history: T) {
  return {
    ...history,
    beforeState: history.beforeState ? publicDentalSnapshotFinding(history.beforeState) : null,
    afterState: publicDentalSnapshotFinding(history.afterState)
  };
}

function publicDentalSnapshotFinding<T extends DentalChartSnapshotFinding>(finding: T) {
  const numberingSystem = publicDentalNumberingSystem(finding.numberingSystem);
  const surface = finding.surface;

  return {
    ...finding,
    numberingSystem,
    surfaces: surface ? [surface] : []
  };
}

function publicDentalChartSnapshot<T extends { chartState: { numberingSystem: string } }>(
  snapshot: T
) {
  return {
    ...snapshot,
    chartState: {
      ...snapshot.chartState,
      numberingSystem: publicDentalNumberingSystem(snapshot.chartState.numberingSystem)
    }
  };
}

function publicTask(task: TaskRecord) {
  return {
    id: task.id,
    rowVersion: task.rowVersion,
    patientId: task.patientId,
    leadId: task.leadId,
    appointmentId: task.appointmentId,
    invoiceId: task.invoiceId,
    encounterId: task.encounterId,
    treatmentPlanId: task.treatmentPlanId,
    procedurePerformedId: task.procedurePerformedId,
    taskType: task.taskType,
    sourceWorkflow: task.sourceWorkflow,
    sourceRecordType: task.sourceRecordType,
    sourceRecordId: task.sourceRecordId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    status: task.status,
    dueAt: task.dueAt,
    assignedToUserId: task.assignedToUserId,
    completedByUserId: task.completedByUserId,
    completedAt: task.completedAt,
    completionEvidence: task.completionEvidence,
    cancelledReason: task.cancelledReason,
    statusChangedAt: task.statusChangedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

function publicRecall(recall: RecallRecord) {
  return {
    id: recall.id,
    recallRuleId: recall.recallRuleId,
    patientId: recall.patientId,
    sourceProcedurePerformedId: recall.sourceProcedurePerformedId,
    sourceInvoiceId: recall.sourceInvoiceId,
    taskId: recall.taskId,
    appointmentId: recall.appointmentId,
    status: recall.status,
    dueAt: recall.dueAt,
    lastActionAt: recall.lastActionAt,
    actionEvidence: recall.actionEvidence,
    createdAt: recall.createdAt,
    updatedAt: recall.updatedAt
  };
}

function publicSopTemplateDetail(detail: SopTemplateDetail) {
  return {
    ...detail.template,
    items: detail.items.map((item) => ({ ...item }))
  };
}

function publicSopRunDetail(detail: SopRunDetail) {
  return {
    ...detail.run,
    items: detail.items.map((item) => ({ ...item }))
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

function publicTreatmentPlanDetail(detail: TreatmentPlanDetail) {
  return {
    ...detail.treatmentPlan,
    phases: detail.phases.map((phase) => ({
      ...phase,
      estimateItems: phase.estimateItems.map((item) => ({ ...item }))
    }))
  };
}

function publicProcedurePerformed<T extends { provenance?: Record<string, unknown> }>(
  procedure: T
) {
  const { provenance: _provenance, ...publicProcedure } = procedure;
  return publicProcedure;
}

function publicInvoiceDetail(detail: InvoiceDetail) {
  return {
    ...detail.invoice,
    items: detail.items.map((item) => ({
      id: item.id,
      invoiceId: item.invoiceId,
      patientId: item.patientId,
      procedurePerformedId: item.procedurePerformedId,
      treatmentPlanEstimateItemId: item.treatmentPlanEstimateItemId,
      pricebookProcedureId: item.pricebookProcedureId,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      discountMinor: item.discountMinor,
      taxRateBasisPoints: item.taxRateBasisPoints,
      taxMinor: item.taxMinor,
      totalMinor: item.totalMinor,
      createdAt: item.createdAt
    })),
    paymentRequests: detail.paymentRequests.map((request) => ({
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
    })),
    payments: detail.payments.map((payment) => ({
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
    })),
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

function publicPatientInstruction(instruction: PatientInstructionRecord) {
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
    providerConfirmationReceived: instruction.providerConfirmationReceived,
    providerDeliveryConfirmedAt: instruction.providerDeliveryConfirmedAt,
    deliveredAt: instruction.deliveredAt,
    readAt: instruction.readAt,
    createdAt: instruction.createdAt
  };
}

function publicReceipt<
  T extends {
    id: UUID;
    invoiceId: UUID;
    patientId: UUID;
    receiptNumber: string;
    status: string;
    amountMinor: number;
    currency: string;
    paymentAllocations: readonly unknown[];
    generatedAt: string;
  }
>(receipt: T) {
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

const EXPORT_PRIVATE_KEY_PATTERNS = [
  /^objectKey$/i,
  /storage.*key/i,
  /storage.*path/i,
  /^storageProvider$/i,
  /^storageRegion$/i,
  /bucket/i,
  /signed.*url/i,
  /upload.*url/i,
  /download.*url/i,
  /^raw.*payload$/i,
  /private.*payload/i,
  /provider.*payload/i,
  /^rawProvider/i
];

function publicAuditEventForReview(event: AuditEventForReviewRecord) {
  return {
    ...event,
    metadata: redactPhi(event.metadata),
    review: event.review ? { ...event.review } : null
  };
}

function publicPatientRecordExport(
  record: PatientRecordExportRecord,
  options: { includePayload?: boolean } = {}
) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    clinicId: record.clinicId,
    patientId: record.patientId,
    status: record.status,
    format: record.format,
    sections: record.sections,
    requestedByUserId: record.requestedByUserId,
    completedByUserId: record.completedByUserId,
    requestedAt: record.requestedAt,
    completedAt: record.completedAt,
    manifest: record.manifest,
    payloadDigest: record.payloadDigest,
    payloadAvailable: record.payload !== null,
    failureReason: record.failureReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...(options.includePayload && record.payload
      ? { payload: sanitizePatientRecordExportSnapshot(record.payload) }
      : {})
  };
}

function sanitizePatientRecordExportSnapshot(
  snapshot: PatientRecordExportSnapshot
): PatientRecordExportSnapshot {
  const scrubbed = scrubPrivateExportPayloads(snapshot);

  return {
    ...scrubbed,
    manifest: {
      ...scrubbed.manifest,
      safety: {
        rawStorageReferences: "excluded",
        rawProviderPayloads: "excluded",
        auditMetadata: "phi_redacted",
        tenantScoped: true
      }
    },
    privacyAuditTrail: scrubbed.privacyAuditTrail.map((event) =>
      publicAuditEventForReview(event)
    ) as AuditEventForReviewRecord[]
  };
}

function scrubPrivateExportPayloads<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => scrubPrivateExportPayloads(item)) as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (EXPORT_PRIVATE_KEY_PATTERNS.some((pattern) => pattern.test(key))) continue;
    output[key] = scrubPrivateExportPayloads(nestedValue);
  }

  return output as T;
}

function treatmentPlanItemCount(detail: TreatmentPlanDetail): number {
  return detail.phases.reduce((count, phase) => count + phase.estimateItems.length, 0);
}

function treatmentPlanAuditMetadata(detail: TreatmentPlanDetail) {
  return {
    status: detail.treatmentPlan.status,
    phaseCount: detail.phases.length,
    itemCount: treatmentPlanItemCount(detail),
    totalMinor: detail.treatmentPlan.totalMinor,
    currency: detail.treatmentPlan.currency
  };
}

function invoiceAuditMetadata(detail: InvoiceDetail) {
  return {
    invoiceNumber: detail.invoice.invoiceNumber,
    status: detail.invoice.status,
    paymentStatus: detail.invoice.paymentStatus,
    totalMinor: detail.invoice.totalMinor,
    paidMinor: detail.invoice.paidMinor,
    balanceMinor: detail.invoice.balanceMinor,
    itemCount: detail.items.length,
    paymentCount: detail.payments.length,
    receiptCount: detail.receipts.length
  };
}

function taskAuditMetadata(task: TaskRecord) {
  return {
    taskType: task.taskType,
    sourceWorkflow: task.sourceWorkflow,
    sourceRecordType: task.sourceRecordType,
    sourceRecordId: task.sourceRecordId,
    status: task.status,
    priority: task.priority,
    dueAt: task.dueAt,
    assignedToUserId: task.assignedToUserId,
    hasCompletionEvidence: Object.keys(task.completionEvidence).length > 0,
    idempotencyKey: task.idempotencyKey
  };
}

function recallAuditMetadata(recall: RecallRecord) {
  return {
    recallRuleId: recall.recallRuleId,
    status: recall.status,
    dueAt: recall.dueAt,
    taskId: recall.taskId,
    appointmentId: recall.appointmentId,
    sourceProcedurePerformedId: recall.sourceProcedurePerformedId,
    sourceInvoiceId: recall.sourceInvoiceId,
    providerConfirmationReceived: false
  };
}

function sopScheduleAuditMetadata(schedule: SopScheduleRecord) {
  return {
    templateId: schedule.templateId,
    recurrenceType: schedule.recurrenceType,
    intervalDays: schedule.intervalDays,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    dueTime: schedule.dueTime,
    startsOn: schedule.startsOn,
    endsOn: schedule.endsOn,
    assignedToUserId: schedule.assignedToUserId
  };
}

function sopRunAuditMetadata(detail: SopRunDetail) {
  return {
    templateId: detail.run.templateId,
    scheduleId: detail.run.scheduleId,
    taskId: detail.run.taskId,
    dueAt: detail.run.dueAt,
    status: detail.run.status,
    itemCount: detail.items.length,
    completedItemCount: detail.items.filter((item) => item.status === "done").length,
    requiredItemCount: detail.items.filter((item) => item.evidenceRequired).length
  };
}

function dentalFindingAuditMetadata(input: {
  toothNumber: string;
  surface?: string | null;
  findingType: string;
  severity?: string | null;
  status: string;
  reviewStatus: string;
  source: string;
  encounterId?: UUID | null;
}) {
  return {
    toothNumber: input.toothNumber,
    surfaces: input.surface ? [input.surface] : [],
    findingType: input.findingType,
    severity: input.severity ?? null,
    status: input.status,
    reviewState: input.reviewStatus,
    source: input.source,
    encounterId: input.encounterId ?? null
  };
}

function appointmentAuditAction(status: AppointmentStatus): KnownAuditAction {
  if (status === "confirmed") return "appointment.confirmed";
  if (status === "checked_in") return "patient.checked_in";
  if (status === "no_show") return "appointment.no_show";
  return "appointment.updated";
}

function appointmentEventType(status: AppointmentStatus): DomainEventType {
  if (status === "confirmed") return "appointment.confirmed";
  if (status === "checked_in") return "patient.checked_in";
  if (status === "no_show") return "appointment.no_show";
  if (status === "cancelled") return "appointment.cancelled";
  return "appointment.rescheduled";
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validation("Request body must be a JSON object.");
  }

  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw validation(`${field} is required.`, { field });
  }
  return value.trim();
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredString(value, field);
}

function parseOwnerDashboardRange(
  filter: { from?: string | null; to?: string | null },
  defaultDate: string
): { startAt: string; endAt: string } {
  const startAt = parseDateBoundary(filter.from ?? defaultDate, "from", "start");
  const endAt = parseDateBoundary(filter.to ?? defaultDate, "to", "end");

  if (Date.parse(startAt) > Date.parse(endAt)) {
    throw validation("Owner dashboard from date must be on or before to date.", {
      from: filter.from,
      to: filter.to
    });
  }

  return { startAt, endAt };
}

function parseDateBoundary(value: string, field: "from" | "to", boundary: "start" | "end"): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return boundary === "start" ? `${trimmed}T00:00:00.000Z` : `${trimmed}T23:59:59.999Z`;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    throw validation(`${field} must be an ISO date or timestamp.`, { field });
  }

  return new Date(timestamp).toISOString();
}

function optionalNullableString(value: unknown, field: string): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return requiredString(value, field);
}

function uuidField(value: unknown, field: string): UUID {
  const candidate = requiredString(value, field);
  if (!isUuid(candidate)) throw validation(`${field} must be a valid UUID.`, { field });
  return candidate;
}

function optionalUuid(value: unknown, field: string): UUID | null {
  if (value === undefined || value === null || value === "") return null;
  return uuidField(value, field);
}

function uuidOrNullQuery(value: string | null, field: string): UUID | null {
  if (!value) return null;
  return uuidField(value, field);
}

function integerQueryParam(value: string | null, field: string): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return integerField(parsed, field, { min: 1, max: 500 });
}

function numberField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validation(`${field} must be a number.`, { field });
  }
  return value;
}

function nonNegativeNumberField(value: unknown, field: string): number {
  const number = numberField(value, field);
  if (number < 0) {
    throw validation(`${field} must be a non-negative number.`, { field });
  }
  return number;
}

function optionalUnitNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const number = numberField(value, field);
  if (number < 0 || number > 1) {
    throw validation(`${field} must be between 0 and 1.`, { field });
  }
  return number;
}

function integerField(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {}
): number {
  const number = numberField(value, field);
  if (!Number.isInteger(number)) {
    throw validation(`${field} must be an integer.`, { field });
  }
  if (options.min !== undefined && number < options.min) {
    throw validation(`${field} must be at least ${options.min}.`, { field });
  }
  if (options.max !== undefined && number > options.max) {
    throw validation(`${field} must be at most ${options.max}.`, { field });
  }
  return number;
}

function optionalInteger(value: unknown, field: string): number | null {
  if (value === undefined || value === null) return null;
  return integerField(value, field);
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw validation(`${field} must be a boolean.`, { field });
  }
  return value;
}

function recordField(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw validation(`${field} must be a JSON object.`, { field });
  }
  return value as Record<string, unknown>;
}

function arrayField(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw validation(`${field} must be an array.`, { field });
  return value;
}

function stringArrayField(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validation(`${field} must be an array.`, { field });

  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw validation(`${field}[${index}] must be a non-empty string.`, {
        field: `${field}[${index}]`
      });
    }
    return item.trim();
  });
}

function uuidArrayField(value: unknown, field: string): UUID[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validation(`${field} must be an array.`, { field });

  return value.map((item, index) => uuidField(item, `${field}[${index}]`));
}

function optionalSha256Digest(value: unknown, field: string): string | null {
  const digest = optionalNullableString(value, field);
  if (digest === undefined || digest === null) return null;
  if (!/^[a-f0-9]{64}$/i.test(digest)) {
    throw validation(`${field} must be a lowercase SHA-256 hex digest.`, { field });
  }
  return digest.toLowerCase();
}

function objectField(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validation(`${field} must be a JSON object.`, { field });
  }
  return value as Record<string, unknown>;
}

function ok<T>(body: T): ApiSuccess<T> {
  return { status: 200, body };
}

function created<T>(body: T): ApiSuccess<T> {
  return { status: 201, body };
}

function accepted<T>(body: T): ApiSuccess<T> {
  return { status: 202, body };
}

function notFound(message: string, details: Record<string, unknown>): ApiError {
  return new ApiError(404, "NOT_FOUND", message, details);
}

function validation(message: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", message, details);
}

function conflict(message: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(409, "CONFLICT", message, details);
}

async function billingRepositoryOperation<T>(
  operation: () => Promise<T>,
  details: Record<string, unknown>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw conflict(
      error instanceof Error ? error.message : "Billing operation violated a domain invariant.",
      details
    );
  }
}

export function randomRequestId(): string {
  return randomUUID();
}
