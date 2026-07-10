import type {
  AppointmentConflict,
  AppointmentRecord,
  AppointmentStatus,
  AuditEventForReviewRecord,
  AuditReviewRecord,
  AiActionProposalRecord,
  AiDraftOutputRecord,
  AiJobRecord,
  AiProviderMode,
  AiReviewDecision,
  AiReviewDecisionRecord,
  AiSessionDetail,
  AiSessionRecord,
  AiSourceAnchorRecord,
  AiTranscriptSegmentRecord,
  AiRetentionPolicy,
  AiConsentSnapshot,
  AppointmentTypeRecord,
  AttributionTouchRecord,
  BreakGlassAccessCategory,
  BreakGlassAccessRecord,
  ChairOrRoomRecord,
  ClinicalNoteContent,
  ClinicalNoteVersionRecord,
  Clinic,
  ClinicAssignment,
  ClinicUser,
  ConsentCaptureMethod,
  ConsentEnforcementState,
  ConsentPurpose,
  ConsentRecord,
  AcceptTreatmentPlanInput,
  CreateAuditReviewInput,
  CreateBreakGlassAccessInput,
  CreateDeletionRequestInput,
  CreateInvoiceInput,
  CreatePaymentRequestInput,
  CreateProcedurePerformedInput,
  CreateReceiptInput,
  CreateDentalFindingInput,
  CorrectiveActionRecord,
  CorrectiveActionStatus,
  CreateTreatmentPlanInput,
  DataExportStatus,
  DeletionRequestRecord,
  DeletionRequestStatus,
  DomainEventType,
  DentalChartSnapshotRecord,
  DentalChartView,
  DentalFindingHistoryRecord,
  DentalFindingRecord,
  EncounterRecord,
  EncounterStatus,
  IncidentCategory,
  IncidentRecord,
  IncidentSeverity,
  InventoryCategoryKind,
  InventoryCategoryRecord,
  InventoryCheckRunDetail,
  InventoryCheckRunStatus,
  InventoryCheckTemplateLineRecord,
  InventoryCheckTemplateRecord,
  InventoryExceptionRecord,
  InventoryItemRecord,
  LabCaseDetail,
  LabCaseStatus,
  LabReconciliationDetail,
  LabReconciliationEntryStatus,
  LabReconciliationStatus,
  LabVendorRecord,
  IntakeFormTemplateRecord,
  IntakeFormType,
  IntakeFormSubmissionRecord,
  IntakeSubmissionSource,
  IntegrationDeadLetterRecord,
  IntegrationDeadLetterStatus,
  MediaAssetRecord,
  MediaScanStatus,
  MediaStorageProviderKey,
  MediaType,
  MigrationBatchDetail,
  MigrationBatchRecord,
  MigrationBatchState,
  MigrationCommitResult,
  MigrationConflictRecord,
  MigrationImportType,
  MigrationNormalizedRecord,
  MigrationResolutionAction,
  MigrationRollbackResult,
  MigrationRowRecord,
  MigrationRowStatus,
  InvoiceDetail,
  PaymentRequestRecord,
  PaymentTransactionRecord,
  MediaUploadReservationRecord,
  OwnerDashboardProjectionData,
  PatientRecordExportRecord,
  PatientRecordExportSection,
  PatientRecordExportSnapshot,
  PatientRecord,
  PatientInstructionRecord,
  PatientSource,
  PatientTimelineItem,
  PricebookProcedureRecord,
  PrescriptionMedication,
  PrescriptionRecord,
  ProcurementSuggestionRecord,
  ProcedurePerformedRecord,
  ProviderScheduleRecord,
  QueueEntryRecord,
  QueueStatus,
  RecallActionType,
  RecallRecord,
  RecallRuleAnchor,
  RecallRuleRecord,
  RecallStatus,
  ReceiptRecord,
  RecordPaymentTransactionInput,
  RetentionRunResult,
  ReviewBreakGlassAccessInput,
  ReviewDeletionRequestInput,
  RoleAssignment,
  RunRetentionJobInput,
  SopRecurrenceType,
  SopRunDetail,
  SopRunItemStatus,
  SopRunStatus,
  SopScheduleRecord,
  SopTemplateDetail,
  StockLedgerEntryRecord,
  StockLedgerMovementType,
  TaskRecord,
  TaskPriority,
  TaskSourceWorkflow,
  TaskStatus,
  TaskType,
  Tenant,
  TenantMembership,
  TreatmentPlanDetail,
  UpdateTreatmentPlanInput,
  UUID
} from "@clinic-os/domain";
import type { LeadIntent, LeadRecord, LeadSource, LeadStatus } from "@clinic-os/domain";

export type {
  AcceptTreatmentPlanInput,
  CreateAuditReviewInput,
  CreateBreakGlassAccessInput,
  CreateDeletionRequestInput,
  CreateDentalFindingInput,
  CreateInvoiceInput,
  CreatePaymentRequestInput,
  CreateProcedurePerformedInput,
  CreateReceiptInput,
  CreateTreatmentPlanInput,
  OwnerDashboardProjectionData,
  RecordPaymentTransactionInput,
  RetentionRunResult,
  ReviewBreakGlassAccessInput,
  ReviewDeletionRequestInput,
  RunRetentionJobInput,
  UpdateTreatmentPlanInput
} from "@clinic-os/domain";

export interface IdentityAccessSnapshot {
  tenant: Tenant;
  user: ClinicUser;
  memberships: TenantMembership[];
  clinicAssignments: ClinicAssignment[];
  roleAssignments: RoleAssignment[];
  clinics: Clinic[];
}

export interface IdentityRepository {
  findAccessByKeycloakSubject(subject: string): Promise<IdentityAccessSnapshot | null>;
}

export interface PatientRepository {
  findPatientById(scope: {
    tenantId: UUID;
    clinicId: UUID;
    patientId: UUID;
  }): Promise<PatientRecord | null>;
}

export interface AuditEventSink<TAuditEvent> {
  appendAuditEvent(event: TAuditEvent): Promise<void>;
}

export interface RepositoryScope {
  tenantId: UUID;
  clinicId: UUID;
  actorUserId: UUID;
}

export interface DateRangeFilter {
  startAt: string;
  endAt: string;
}

export interface PatientSearchFilter {
  query?: string | null;
  phone?: string | null;
  source?: PatientSource | null;
  limit?: number | null;
}

export interface AuditEventSearchFilter {
  patientId?: UUID | null;
  action?: string | null;
  category?: AuditEventForReviewRecord["category"] | null;
  riskLevel?: AuditEventForReviewRecord["riskLevel"] | null;
  limit?: number | null;
}

export interface PatientRecordExportInput {
  patientId: UUID;
  sections: PatientRecordExportSection[];
  reason: string;
  format: "json";
  snapshot: PatientRecordExportSnapshot;
  payloadDigest: string;
}

export interface PatientRecordExportSearchFilter {
  patientId?: UUID | null;
  status?: DataExportStatus | null;
  limit?: number | null;
}

export interface DeletionRequestSearchFilter {
  patientId?: UUID | null;
  status?: DeletionRequestStatus | null;
  limit?: number | null;
}

export interface BreakGlassAccessSearchFilter {
  patientId?: UUID | null;
  status?: BreakGlassAccessRecord["status"] | null;
  requestedByUserId?: UUID | null;
  limit?: number | null;
}

export interface ActiveBreakGlassAccessFilter {
  patientId: UUID;
  userId: UUID;
  requiredCategory?: BreakGlassAccessCategory | null;
  at: string;
}

export interface CreatePatientInput {
  fullName: string;
  phone: string;
  email?: string | null;
  dateOfBirth?: string | null;
  gender?: PatientRecord["gender"] | null;
  source: PatientSource;
  sourceDetail?: Record<string, unknown>;
}

export interface UpdatePatientInput {
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  dateOfBirth?: string | null;
  gender?: PatientRecord["gender"] | null;
}

export interface CreateMigrationConflictInput {
  conflictType: MigrationConflictRecord["conflictType"];
  severity: MigrationConflictRecord["severity"];
  targetRecordType?: string | null;
  targetRecordId?: UUID | null;
  fieldName?: string | null;
  summary: string;
  evidence?: Record<string, unknown>;
}

export interface CreateMigrationRowInput {
  rowNumber: number;
  importType: MigrationImportType;
  externalRecordId?: string | null;
  rawPayload: Record<string, unknown>;
  rawPayloadDigest: string;
  normalizedRecord?: MigrationNormalizedRecord | null;
  validationErrors: MigrationRowRecord["validationErrors"];
  status: MigrationRowStatus;
  matchStatus: MigrationRowRecord["matchStatus"];
  conflicts?: CreateMigrationConflictInput[];
}

export interface CreateMigrationBatchInput {
  importType: MigrationImportType;
  sourceSystem: string;
  sourceFileName?: string | null;
  sourceChecksum?: string | null;
  state: MigrationBatchRecord["state"];
  rows: CreateMigrationRowInput[];
}

export interface ResolveMigrationRowInput {
  action: MigrationResolutionAction;
  targetRecordType?: string | null;
  targetRecordId?: UUID | null;
  note?: string | null;
}

export interface MigrationRowsFilter {
  matchStatus?: MigrationRowRecord["matchStatus"] | null;
  status?: MigrationRowStatus | null;
}

export interface MigrationBatchSearchFilter {
  status?: MigrationBatchState | null;
  limit?: number | null;
}

export interface CommitMigrationBatchInput {
  idempotencyKey?: string | null;
}

export interface RollbackMigrationBatchInput {
  idempotencyKey?: string | null;
}

export interface IntegrationDeadLetterSearchFilter {
  status?: IntegrationDeadLetterStatus | null;
  limit?: number | null;
}

export interface ReplayIntegrationDeadLetterInput {
  reviewedByUserId: UUID;
  reason?: string | null;
}

export interface CreateLeadInput {
  primaryContact: string;
  intent: LeadIntent;
  source: LeadSource;
  sourceDetail: Record<string, unknown>;
}

export interface LeadSearchFilter {
  source?: LeadSource | null;
  status?: LeadStatus | null;
  limit?: number | null;
}

export interface CreateAppointmentInput {
  patientId: UUID;
  leadId?: UUID | null;
  providerUserId: UUID;
  appointmentTypeId: UUID;
  chairId?: UUID | null;
  status: AppointmentStatus;
  startAt: string;
  endAt: string;
  source: LeadSource;
  reason?: string | null;
  notes?: string | null;
}

export interface AppointmentSearchFilter {
  date?: string | null;
  providerUserId?: UUID | null;
  status?: AppointmentStatus | null;
}

export interface AppointmentConflictFilter {
  appointmentIdToExclude?: UUID | null;
  providerUserId: UUID;
  chairId?: UUID | null;
  startAt: string;
  endAt: string;
}

export interface CreateTaskInput {
  patientId?: UUID | null;
  leadId?: UUID | null;
  appointmentId?: UUID | null;
  invoiceId?: UUID | null;
  encounterId?: UUID | null;
  treatmentPlanId?: UUID | null;
  procedurePerformedId?: UUID | null;
  taskType: TaskType;
  sourceWorkflow?: TaskSourceWorkflow;
  sourceRecordType?: string | null;
  sourceRecordId?: UUID | null;
  title: string;
  description?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  dueAt?: string | null;
  assignedToUserId?: UUID | null;
  idempotencyKey?: string | null;
}

export interface TaskSearchFilter {
  status?: TaskStatus | null;
  dueDate?: string | null;
  dueBefore?: string | null;
  assignedToUserId?: UUID | null;
  patientId?: UUID | null;
  sourceWorkflow?: TaskSourceWorkflow | null;
  limit?: number | null;
}

export interface UpdateTaskInput {
  status?: TaskStatus;
  assignedToUserId?: UUID | null;
  priority?: TaskPriority;
  dueAt?: string | null;
  title?: string;
  description?: string | null;
  completionEvidence?: Record<string, unknown>;
  cancelledReason?: string | null;
}

export interface CreateRecallRuleInput {
  code: string;
  title: string;
  anchor?: RecallRuleAnchor;
  offsetDays: number;
  procedureCategory?: string | null;
  pricebookProcedureId?: UUID | null;
  defaultTaskTitle?: string | null;
  defaultTaskPriority?: TaskPriority;
}

export interface RecallSearchFilter {
  status?: RecallStatus | null;
  dueBefore?: string | null;
  patientId?: UUID | null;
  limit?: number | null;
}

export interface RecordRecallActionInput {
  actionType: RecallActionType;
  method?: string | null;
  appointmentId?: UUID | null;
  evidence?: Record<string, unknown>;
  notes?: string | null;
}

export interface GenerateDueContinuityInput {
  asOf: string;
  batchSize?: number;
  cursor?: string | null;
}

export class DueGenerationInputError extends Error {
  readonly code = "DUE_GENERATION_INPUT_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "DueGenerationInputError";
  }
}

export class DueGenerationConfigurationError extends Error {
  readonly code = "DUE_GENERATION_CONFIGURATION_INVALID";

  constructor(message: string) {
    super(message);
    this.name = "DueGenerationConfigurationError";
  }
}

export interface GenerateDueContinuityResult {
  recallTasksCreated: TaskRecord[];
  followUpTasksCreated: TaskRecord[];
  recallsCreated: RecallRecord[];
  skippedExistingKeys: string[];
  processedCount: number;
  complete: boolean;
  nextCursor: string | null;
}

export interface CreateSopTemplateInput {
  code: string;
  title: string;
  description?: string | null;
  items: {
    title: string;
    instructions?: string | null;
    evidenceRequired?: boolean;
  }[];
}

export interface CreateSopScheduleInput {
  templateId: UUID;
  title: string;
  recurrenceType: SopRecurrenceType;
  intervalDays?: number | null;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  dueTime: string;
  timezone?: string | null;
  startsOn: string;
  endsOn?: string | null;
  assignedToUserId?: UUID | null;
  defaultTaskPriority?: TaskPriority;
}

export interface SopRunSearchFilter {
  date?: string | null;
  status?: SopRunStatus | null;
  dueBefore?: string | null;
  limit?: number | null;
}

export interface UpdateSopRunInput {
  status?: SopRunStatus;
  completionEvidence?: Record<string, unknown>;
  items?: {
    itemId: UUID;
    status: SopRunItemStatus;
    evidence?: Record<string, unknown>;
  }[];
}

export interface GenerateDueSopRunsInput {
  asOf: string;
  batchSize?: number;
  cursor?: string | null;
}

export interface GenerateDueSopRunsResult {
  runsCreated: SopRunDetail[];
  skippedExistingKeys: string[];
  processedCount: number;
  complete: boolean;
  nextCursor: string | null;
}

export interface CreateLabVendorInput {
  displayName: string;
  phone?: string | null;
  email?: string | null;
  address?: Record<string, unknown>;
  taxRegistrationNumber?: string | null;
  paymentTermsDays?: number | null;
}

export interface LabCaseSearchFilter {
  status?: LabCaseStatus | null;
  dueBefore?: string | null;
  vendorId?: UUID | null;
  patientId?: UUID | null;
}

export interface CreateLabCaseInput {
  vendorId: UUID;
  patientId: UUID;
  encounterId?: UUID | null;
  treatmentPlanId?: UUID | null;
  treatmentPlanEstimateItemId?: UUID | null;
  procedurePerformedId?: UUID | null;
  title: string;
  priority?: "routine" | "urgent";
  dueAt: string;
  clinicalNotes?: string | null;
  internalNotes?: string | null;
  expectedCostMinor?: number | null;
  slipMetadata?: Record<string, unknown>;
  items: Array<{
    itemType: string;
    toothNumber?: string | null;
    material?: string | null;
    shade?: string | null;
    quantity?: number;
    notes?: string | null;
  }>;
}

export interface UpdateLabCaseStatusInput {
  status: LabCaseStatus;
  reason?: string | null;
  evidence?: Record<string, unknown>;
}

export interface CreateLabReconciliationInput {
  vendorId: UUID;
  periodStart: string;
  periodEnd: string;
  status?: LabReconciliationStatus;
  invoiceReference?: string | null;
  invoiceAmountMinor?: number | null;
  evidence?: Record<string, unknown>;
  entries: Array<{
    labCaseId: UUID;
    status?: LabReconciliationEntryStatus;
    invoiceAmountMinor?: number | null;
    notes?: string | null;
  }>;
}

export interface CreateInventoryCategoryInput {
  code: string;
  displayName: string;
  kind: InventoryCategoryKind;
  active?: boolean;
}

export interface CreateInventoryItemInput {
  categoryId: UUID;
  sku: string;
  displayName: string;
  unitOfMeasure: string;
  storageLocation: string;
  trackQuantity?: boolean;
  minimumQuantity?: number;
  reorderQuantity?: number;
  openingQuantity?: number;
}

export interface CreateStockLedgerEntryInput {
  itemId: UUID;
  movementType: StockLedgerMovementType;
  quantityDelta: number;
  unitCostMinor?: number | null;
  currency?: "INR" | null;
  sourceTable?: string | null;
  sourceId?: UUID | null;
  reason: string;
  evidence?: Record<string, unknown>;
}

export interface CreateInventoryCheckTemplateInput {
  code: string;
  displayName: string;
  cadence: InventoryCheckTemplateRecord["cadence"];
  active?: boolean;
  lines: Array<{
    itemId: UUID;
    sequence: number;
    drawerLocation: string;
    expectedQuantity?: number | null;
    required?: boolean;
    instructions?: string | null;
  }>;
}

export interface CreateInventoryCheckRunInput {
  templateId: UUID;
  notes?: string | null;
}

export interface UpdateInventoryCheckRunInput {
  status: InventoryCheckRunStatus;
  notes?: string | null;
  lines?: Array<{
    lineId: UUID;
    countedQuantity: number;
    exceptionNotes?: string | null;
  }>;
}

export interface InventoryExceptionFilter {
  itemId?: UUID | null;
  checkRunId?: UUID | null;
}

export interface IncidentSearchFilter {
  status?: IncidentRecord["status"] | null;
  severity?: IncidentSeverity | null;
  category?: IncidentCategory | null;
}

export interface CreateIncidentInput {
  patientId?: UUID | null;
  appointmentId?: UUID | null;
  labCaseId?: UUID | null;
  inventoryItemId?: UUID | null;
  category: IncidentCategory;
  severity: IncidentSeverity;
  occurredAt: string;
  location?: string | null;
  summary: string;
  description: string;
  impact?: string | null;
  learning?: string | null;
  immediateAction?: string | null;
  evidence?: Record<string, unknown>;
  ownerUserId?: UUID | null;
}

export interface CreateCorrectiveActionInput {
  incidentId?: UUID | null;
  actionType: CorrectiveActionRecord["actionType"];
  title: string;
  description: string;
  ownerUserId: UUID;
  dueAt: string;
  verificationEvidence?: Record<string, unknown>;
}

export interface UpdateCorrectiveActionInput {
  status: CorrectiveActionStatus;
  completionEvidence?: Record<string, unknown>;
  verificationEvidence?: Record<string, unknown>;
}

export interface CreateAttributionTouchInput {
  patientId?: UUID | null;
  leadId?: UUID | null;
  appointmentId?: UUID | null;
  invoiceId?: UUID | null;
  source: LeadSource;
  medium?: string | null;
  campaign?: string | null;
  externalRef?: string | null;
  touchType: AttributionTouchRecord["touchType"];
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

export interface OutboxEventInput {
  eventType: DomainEventType;
  aggregateType: string;
  aggregateId: UUID;
  patientId?: UUID | null;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface CreateIntakeFormTemplateInput {
  code: string;
  displayName: string;
  formType: IntakeFormType;
  version: number;
  schema: Record<string, unknown>;
  active?: boolean;
}

export interface CreateIntakeFormSubmissionInput {
  patientId: UUID;
  templateId: UUID;
  source: IntakeSubmissionSource;
  responses: Record<string, unknown>;
  medicalHistorySnapshot?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

export interface CreateConsentInput {
  patientId: UUID;
  purpose: ConsentPurpose;
  templateCode: string;
  templateVersion: number;
  captureMethod: ConsentCaptureMethod;
  grantedByName?: string | null;
  relationshipToPatient?: string | null;
  evidence?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

export interface RevokeConsentInput {
  revocationReason: string;
}

export interface CreateEncounterInput {
  patientId: UUID;
  appointmentId?: UUID | null;
  providerUserId: UUID;
  reason?: string | null;
  medicalHistorySnapshot?: Record<string, unknown>;
}

export interface SaveClinicalNoteDraftInput {
  content: ClinicalNoteContent;
  readyForSign?: boolean;
}

export interface AmendClinicalNoteInput {
  content: ClinicalNoteContent;
  amendmentReason: string;
}

export interface CreatePrescriptionInput {
  medications: PrescriptionMedication[];
  notes?: string | null;
}

export interface CreatePatientInstructionInput {
  channel: PatientInstructionRecord["channel"];
  templateId: string;
  title?: string | null;
  body?: string | null;
  outboxEventId?: UUID | null;
}

export interface CreateAiSessionInput {
  patientId: UUID;
  encounterId: UUID;
  providerMode: AiProviderMode;
  llmProviderKey: string;
  transcriptionProviderKey: string;
  consentSnapshot: AiConsentSnapshot;
  retentionPolicy: AiRetentionPolicy;
  languageHint?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateAiTranscriptSegmentInput {
  id?: UUID;
  text: string;
  speakerRole?: AiTranscriptSegmentRecord["speakerRole"];
  startsAtMs: number;
  endsAtMs: number;
  sourceHash: string;
}

export interface CreateAiSourceAnchorInput {
  id?: UUID;
  anchorType: AiSourceAnchorRecord["anchorType"];
  sourceRecordType: string;
  sourceRecordId: UUID | string;
  transcriptSegmentId?: UUID | null;
  startsAtMs?: number | null;
  endsAtMs?: number | null;
  textQuoteDigest?: string | null;
  supported?: boolean;
  unsupportedReason?: string | null;
}

export interface CreateAiJobInput {
  jobType: AiJobRecord["jobType"];
  status: AiJobRecord["status"];
  providerMode: AiProviderMode;
  providerKey: string;
  inputDigest: string;
  outputSummary?: Record<string, unknown>;
  errorCode?: string | null;
  errorMessage?: string | null;
  completedAt?: string | null;
}

export interface CreateAiDraftOutputInput {
  jobId?: UUID | null;
  outputType: AiDraftOutputRecord["outputType"];
  content: AiDraftOutputRecord["content"];
  confidence: number;
  warnings?: string[];
  sourceAnchorIds: UUID[];
  unsupportedSourceAnchorIds?: UUID[];
  schemaVersion: string;
  providerMode: AiProviderMode;
  providerRequestDigest: string;
}

export interface CreateAiActionProposalInput {
  outputId?: UUID | null;
  proposalType: AiActionProposalRecord["proposalType"];
  title: string;
  description: string;
  proposedPayload: Record<string, unknown>;
  requiredPermission: string;
  sourceAnchorIds: UUID[];
  unsupportedSourceAnchorIds?: UUID[];
  providerMode: AiProviderMode;
}

export interface RecordAiReviewDecisionInput {
  targetType: AiReviewDecisionRecord["targetType"];
  targetId: UUID;
  decision: AiReviewDecision;
  reason: string;
  editedContent?: Record<string, unknown> | null;
}

export interface AiRetentionDeletionResult {
  session: AiSessionRecord;
  deletedTranscriptSegments: number;
  deletedRawAudioReferences: boolean;
}

export interface CreateMediaUploadReservationInput {
  id: UUID;
  patientId: UUID;
  encounterId?: UUID | null;
  toothNumber?: string | null;
  dentalFindingId?: UUID | null;
  mediaType: MediaType;
  originalFilename: string;
  mimeType: string;
  expectedFileSizeBytes: number;
  expectedSha256Digest?: string | null;
  objectKey: string;
  storageProvider: MediaStorageProviderKey;
  storageRegion?: string | null;
  expiresAt: string;
  tags?: string[];
  provenance?: Record<string, unknown>;
}

export interface CompleteMediaUploadInput {
  contentLength: number;
  sha256Digest?: string | null;
  objectVersion?: string | null;
  scanStatus: MediaScanStatus;
  quarantineReason?: string | null;
  dicomMetadata?: Record<string, unknown>;
}

export type ClinicalMediaReceiptState = "matched" | "mismatch" | "consumed";

export interface RecordClinicalMediaReceiptInput {
  uploadId: UUID;
  providerKey: MediaStorageProviderKey;
  providerArtifactReference: string;
  contentLength: number;
  mimeType: string;
  sha256Digest: string;
  storedAt: string;
  receivedAt: string;
}

export interface ClinicalMediaReceiptRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  uploadId: UUID;
  patientId: UUID;
  providerKey: MediaStorageProviderKey;
  receiptFingerprint: string;
  providerArtifactFingerprint: string;
  contentLength: number;
  mimeType: string;
  sha256Digest: string;
  state: ClinicalMediaReceiptState;
  mismatchReason: string | null;
  storedAt: string;
  receivedAt: string;
  lastVerifiedAt: string;
  consumedAt: string | null;
}

export type RecordClinicalMediaReceiptResult =
  | {
      outcome: "recorded" | "replayed";
      receipt: ClinicalMediaReceiptRecord;
    }
  | {
      outcome: "mismatch";
      receipt: ClinicalMediaReceiptRecord;
      reason: string;
    }
  | {
      outcome: "not_found" | "not_receivable";
      receipt: null;
    };

export interface AtomicAppointmentCheckInResult {
  outcome: "checked_in" | "repaired" | "replayed" | "invalid_state" | "not_found";
  appointment: AppointmentRecord | null;
  queueEntry: QueueEntryRecord | null;
  appointmentStatusChanged: boolean;
  queueEntryCreated: boolean;
}

export interface ProviderEligibilityResult {
  providerUserId: UUID;
  userActive: boolean;
  membershipActive: boolean;
  clinicAssignmentActive: boolean;
  doctorRoleActive: boolean;
  eligible: boolean;
}

export type PaymentProviderKey = "razorpay" | "simulator";

export interface ActivePaymentProviderAccount {
  externalAccountId: UUID;
  providerKey: PaymentProviderKey;
  status: "available";
  capabilityKeys: string[];
}

export type FindActivePaymentProviderAccountResult =
  | {
      outcome: "resolved";
      account: ActivePaymentProviderAccount;
    }
  | {
      outcome: "not_configured" | "ambiguous" | "degraded" | "unavailable";
      account: null;
    };

export interface FindActivePaymentProviderAccountInput {
  providerKey: PaymentProviderKey;
  requiredCapability: string;
}

export interface AppendPaymentProviderIntegrationOutboxInput extends Omit<
  OutboxEventInput,
  "idempotencyKey" | "correlationId"
> {
  externalAccountId: UUID;
  providerKey: PaymentProviderKey;
  requiredCapability: string;
  idempotencyKey: string;
  correlationId: string;
}

export type AppendPaymentProviderIntegrationOutboxResult = {
  outcome: "appended" | "replayed" | "mismatch" | "account_unavailable";
  outboxEventId: UUID | null;
};

export interface ClaimPaymentRequestIntentInput {
  externalAccountId: UUID;
  providerKey: PaymentProviderKey;
  requiredCapability: string;
  invoiceId: UUID;
  idempotencyKey: string;
  requestDigest: string;
  canonicalRequest: CanonicalPaymentProviderRequest;
  leaseOwner: string;
  leaseExpiresAt: string;
  requestedAt: string;
}

export interface CanonicalPaymentProviderRequest {
  requestType: "payment_link" | "invoice_qr";
  amountMinor: number;
  currency: string;
  description: string | null;
  expiresAt: string | null;
  customer: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
}

export interface PaymentRequestIntentRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  externalAccountId: UUID;
  providerKey: PaymentProviderKey;
  requiredCapability: string;
  invoiceId: UUID;
  patientId: UUID;
  idempotencyKey: string;
  requestDigest: string;
  canonicalRequest: CanonicalPaymentProviderRequest;
  status: "claimed" | "completed" | "failed" | "reconciliation_required";
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  paymentRequestId: UUID | null;
  providerArtifactFingerprint: string | null;
  resultDigest: string | null;
  resultProjection: Record<string, unknown> | null;
  mismatchReason: string | null;
  requestedAt: string;
  processedAt: string | null;
}

export type ClaimPaymentRequestIntentResult =
  | {
      outcome: "claimed" | "recovered" | "in_progress" | "replayed";
      intent: PaymentRequestIntentRecord;
    }
  | {
      outcome:
        | "request_mismatch"
        | "account_unavailable"
        | "invoice_not_found"
        | "invoice_not_collectible";
      intent: PaymentRequestIntentRecord | null;
    };

export interface ClaimStoredPaymentRequestIntentInput {
  intentId: UUID;
  requestDigest: string;
  leaseOwner: string;
  leaseExpiresAt: string;
  requestedAt: string;
}

export type ClaimStoredPaymentRequestIntentResult =
  | {
      outcome: "claimed" | "recovered" | "in_progress" | "replayed";
      intent: PaymentRequestIntentRecord;
    }
  | {
      outcome: "request_mismatch" | "account_unavailable" | "not_found";
      intent: PaymentRequestIntentRecord | null;
    };

export interface FinalizePaymentRequestIntentInput {
  intentId: UUID;
  leaseOwner: string;
  requestDigest: string;
  status: "completed" | "failed" | "reconciliation_required";
  paymentRequestId?: UUID | null;
  providerArtifactReference?: string | null;
  resultDigest: string;
  resultProjection: Record<string, unknown>;
  processedAt: string;
}

export type FinalizePaymentRequestIntentResult = {
  outcome: "finalized" | "replayed" | "mismatch" | "lost_lease" | "not_found";
  intent: PaymentRequestIntentRecord | null;
};

export interface ClaimVerifiedPaymentProviderEventInput {
  externalAccountId: UUID;
  providerEventId: string;
  idempotencyKey: string;
  eventName: string;
  eventKind: string;
  rawBodySha256: string;
  signatureSha256: string;
  normalizedEventSha256: string;
  normalizedEvent: Record<string, unknown>;
  receivedAt: string;
  leaseOwner: string;
  leaseExpiresAt: string;
}

export interface PaymentProviderEventRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  externalAccountId: UUID;
  providerEventId: string;
  idempotencyKey: string;
  eventName: string;
  eventKind: string;
  rawBodySha256: string;
  signatureSha256: string;
  normalizedEventSha256: string;
  normalizedEvent: Record<string, unknown>;
  evidenceState: "verified" | "mismatch" | "reconciliation_required" | "applied";
  processingStatus: "processing" | "applied" | "ignored" | "reconciliation_required" | "failed";
  mismatchReason: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  resultDigest: string | null;
  resultProjection: Record<string, unknown> | null;
  receivedAt: string;
  processedAt: string | null;
}

export type ClaimVerifiedPaymentProviderEventResult =
  | {
      outcome: "claimed" | "recovered" | "in_progress" | "duplicate";
      event: PaymentProviderEventRecord;
    }
  | {
      outcome: "evidence_mismatch" | "account_unavailable";
      event: PaymentProviderEventRecord | null;
    };

export interface CreatePaymentReconciliationInput {
  providerEventRecordId: UUID;
  invoiceId: UUID | null;
  patientId: UUID | null;
  reason:
    | "overpayment"
    | "missing_invoice_reference"
    | "currency_mismatch"
    | "invalid_provider_amount"
    | "scope_mismatch"
    | "manual_review_required";
  capturedAmountMinor: number;
  appliedAmountMinor: number;
  unallocatedAmountMinor: number;
  currency: string | null;
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface PaymentReconciliationRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  providerEventRecordId: UUID;
  invoiceId: UUID | null;
  patientId: UUID | null;
  reason: CreatePaymentReconciliationInput["reason"];
  capturedAmountMinor: number;
  appliedAmountMinor: number;
  unallocatedAmountMinor: number;
  currency: string | null;
  status: "open" | "resolved" | "dismissed";
  evidence: Record<string, unknown>;
  createdAt: string;
}

export interface CompletePaymentProviderEventInput {
  providerEventRecordId: UUID;
  leaseOwner: string;
  processingStatus: "applied" | "ignored" | "reconciliation_required" | "failed";
  resultDigest: string;
  resultProjection: Record<string, unknown>;
  processedAt: string;
}

export type CompletePaymentProviderEventResult = {
  outcome: "completed" | "replayed" | "mismatch" | "lost_lease" | "not_found";
  event: PaymentProviderEventRecord | null;
};

/**
 * Additive CP13 durability seam. It stays separate from the 140-operation compatibility interface
 * so fixture repositories cannot accidentally be treated as production durability adapters.
 */
export interface DurableIntegrityRepository {
  recordClinicalMediaReceipt(
    scope: RepositoryScope,
    input: RecordClinicalMediaReceiptInput
  ): Promise<RecordClinicalMediaReceiptResult>;
  checkInAppointmentWithQueue(
    scope: RepositoryScope,
    appointmentId: UUID,
    reason?: string | null
  ): Promise<AtomicAppointmentCheckInResult>;
  findProviderEligibility(
    scope: RepositoryScope,
    providerUserId: UUID
  ): Promise<ProviderEligibilityResult>;
  findActivePaymentProviderAccount(
    scope: RepositoryScope,
    input: FindActivePaymentProviderAccountInput
  ): Promise<FindActivePaymentProviderAccountResult>;
  appendPaymentProviderIntegrationOutboxEvent(
    scope: RepositoryScope,
    input: AppendPaymentProviderIntegrationOutboxInput
  ): Promise<AppendPaymentProviderIntegrationOutboxResult>;
  claimPaymentRequestIntent(
    scope: RepositoryScope,
    input: ClaimPaymentRequestIntentInput
  ): Promise<ClaimPaymentRequestIntentResult>;
  claimStoredPaymentRequestIntent(
    scope: RepositoryScope,
    input: ClaimStoredPaymentRequestIntentInput
  ): Promise<ClaimStoredPaymentRequestIntentResult>;
  findPaymentRequestIntentById(
    scope: RepositoryScope,
    intentId: UUID
  ): Promise<PaymentRequestIntentRecord | null>;
  finalizePaymentRequestIntent(
    scope: RepositoryScope,
    input: FinalizePaymentRequestIntentInput
  ): Promise<FinalizePaymentRequestIntentResult>;
  claimVerifiedPaymentProviderEvent(
    scope: RepositoryScope,
    input: ClaimVerifiedPaymentProviderEventInput
  ): Promise<ClaimVerifiedPaymentProviderEventResult>;
  createPaymentReconciliation(
    scope: RepositoryScope,
    input: CreatePaymentReconciliationInput
  ): Promise<PaymentReconciliationRecord>;
  completePaymentProviderEvent(
    scope: RepositoryScope,
    input: CompletePaymentProviderEventInput
  ): Promise<CompletePaymentProviderEventResult>;
}

export interface CreateDentalChartSnapshotInput {
  encounterId?: UUID | null;
  reason?: string | null;
  provenance?: Record<string, unknown>;
}

export interface UpdateDentalFindingRepositoryInput {
  encounterId?: UUID | null;
  toothNumber?: string;
  surface?: string | null;
  findingType?: DentalFindingRecord["findingType"];
  severity?: string | null;
  status?: DentalFindingRecord["status"];
  reviewStatus?: DentalFindingRecord["reviewStatus"];
  source?: DentalFindingRecord["source"];
  confidence?: number | null;
  notes?: string | null;
  provenance?: Record<string, unknown>;
  treatmentReference?: Record<string, unknown>;
  changeReason: string;
}

export interface DentalFindingMutationResult {
  finding: DentalFindingRecord;
  history: DentalFindingHistoryRecord;
}

export interface CreateTreatmentPlanResult {
  detail: TreatmentPlanDetail;
}

export interface UpdateTreatmentPlanResult {
  detail: TreatmentPlanDetail;
}

export interface AcceptTreatmentPlanResult {
  detail: TreatmentPlanDetail;
}

export interface CreateProcedurePerformedResult {
  procedure: ProcedurePerformedRecord;
  treatmentPlan: TreatmentPlanDetail;
}

export interface CreateInvoiceResult {
  invoiceDetail: InvoiceDetail;
  procedures: ProcedurePerformedRecord[];
}

export interface CreateReceiptResult {
  invoiceDetail: InvoiceDetail;
  receipt: ReceiptRecord;
}

export interface SignClinicalNoteResult {
  encounter: EncounterRecord;
  note: ClinicalNoteVersionRecord;
}

export interface AmendClinicalNoteResult {
  encounter: EncounterRecord;
  note: ClinicalNoteVersionRecord;
  amendedFrom: ClinicalNoteVersionRecord;
}

export interface DashboardDataSet {
  appointments: AppointmentRecord[];
  leads: LeadRecord[];
  tasks: TaskRecord[];
  queue: QueueEntryRecord[];
  returningPatientIds: Set<UUID>;
}

export interface ClinicOperationsRepository {
  listPatients(scope: RepositoryScope, filter?: PatientSearchFilter): Promise<PatientRecord[]>;
  findPatientById(scope: RepositoryScope, patientId: UUID): Promise<PatientRecord | null>;
  findPatientTimeline(scope: RepositoryScope, patientId: UUID): Promise<PatientTimelineItem[]>;
  findPatientDuplicateCandidates(
    scope: RepositoryScope,
    input: { fullName: string; phone: string }
  ): Promise<PatientRecord[]>;
  createPatient(scope: RepositoryScope, input: CreatePatientInput): Promise<PatientRecord>;
  updatePatient(
    scope: RepositoryScope,
    patientId: UUID,
    input: UpdatePatientInput
  ): Promise<PatientRecord | null>;

  listAuditEvents(
    scope: RepositoryScope,
    filter?: AuditEventSearchFilter
  ): Promise<AuditEventForReviewRecord[]>;
  createAuditReview(
    scope: RepositoryScope,
    auditEventId: UUID,
    input: CreateAuditReviewInput
  ): Promise<AuditReviewRecord | null>;
  buildPatientRecordExportSnapshot(
    scope: RepositoryScope,
    patientId: UUID,
    sections: PatientRecordExportSection[]
  ): Promise<PatientRecordExportSnapshot | null>;
  createPatientRecordExport(
    scope: RepositoryScope,
    input: PatientRecordExportInput
  ): Promise<PatientRecordExportRecord>;
  listPatientRecordExports(
    scope: RepositoryScope,
    filter?: PatientRecordExportSearchFilter
  ): Promise<PatientRecordExportRecord[]>;
  createDeletionRequest(
    scope: RepositoryScope,
    input: CreateDeletionRequestInput
  ): Promise<DeletionRequestRecord | null>;
  findDeletionRequestById(
    scope: RepositoryScope,
    requestId: UUID
  ): Promise<DeletionRequestRecord | null>;
  listDeletionRequests(
    scope: RepositoryScope,
    filter?: DeletionRequestSearchFilter
  ): Promise<DeletionRequestRecord[]>;
  reviewDeletionRequest(
    scope: RepositoryScope,
    requestId: UUID,
    input: ReviewDeletionRequestInput
  ): Promise<DeletionRequestRecord | null>;
  runRetentionJob(scope: RepositoryScope, input: RunRetentionJobInput): Promise<RetentionRunResult>;
  createBreakGlassAccessRequest(
    scope: RepositoryScope,
    input: CreateBreakGlassAccessInput
  ): Promise<BreakGlassAccessRecord | null>;
  listBreakGlassAccessRequests(
    scope: RepositoryScope,
    filter?: BreakGlassAccessSearchFilter
  ): Promise<BreakGlassAccessRecord[]>;
  reviewBreakGlassAccessRequest(
    scope: RepositoryScope,
    requestId: UUID,
    input: ReviewBreakGlassAccessInput
  ): Promise<BreakGlassAccessRecord | null>;
  findActiveBreakGlassAccess(
    scope: RepositoryScope,
    filter: ActiveBreakGlassAccessFilter
  ): Promise<BreakGlassAccessRecord | null>;

  createMigrationBatch(
    scope: RepositoryScope,
    input: CreateMigrationBatchInput
  ): Promise<MigrationBatchDetail>;
  listMigrationBatches(
    scope: RepositoryScope,
    filter?: MigrationBatchSearchFilter
  ): Promise<MigrationBatchDetail[]>;
  findMigrationBatchById(
    scope: RepositoryScope,
    batchId: UUID
  ): Promise<MigrationBatchDetail | null>;
  listMigrationRows(
    scope: RepositoryScope,
    batchId: UUID,
    filter?: MigrationRowsFilter
  ): Promise<MigrationRowRecord[]>;
  resolveMigrationRow(
    scope: RepositoryScope,
    batchId: UUID,
    rowId: UUID,
    input: ResolveMigrationRowInput
  ): Promise<MigrationRowRecord | null>;
  commitMigrationBatch(
    scope: RepositoryScope,
    batchId: UUID,
    input?: CommitMigrationBatchInput
  ): Promise<MigrationCommitResult | null>;
  rollbackMigrationBatch(
    scope: RepositoryScope,
    batchId: UUID,
    input?: RollbackMigrationBatchInput
  ): Promise<MigrationRollbackResult | null>;
  listIntegrationDeadLetters(
    scope: RepositoryScope,
    filter?: IntegrationDeadLetterSearchFilter
  ): Promise<IntegrationDeadLetterRecord[]>;
  requestIntegrationDeadLetterReplay(
    scope: RepositoryScope,
    deadLetterId: UUID,
    input: ReplayIntegrationDeadLetterInput
  ): Promise<IntegrationDeadLetterRecord | null>;

  listLeads(scope: RepositoryScope, filter?: LeadSearchFilter): Promise<LeadRecord[]>;
  findLeadById(scope: RepositoryScope, leadId: UUID): Promise<LeadRecord | null>;
  createLead(scope: RepositoryScope, input: CreateLeadInput): Promise<LeadRecord>;
  updateLeadStatus(
    scope: RepositoryScope,
    leadId: UUID,
    status: LeadStatus
  ): Promise<LeadRecord | null>;
  matchLeadToPatient(
    scope: RepositoryScope,
    leadId: UUID,
    patientId: UUID
  ): Promise<LeadRecord | null>;

  listAppointmentTypes(scope: RepositoryScope): Promise<AppointmentTypeRecord[]>;
  listChairs(scope: RepositoryScope): Promise<ChairOrRoomRecord[]>;
  listProviderSchedules(
    scope: RepositoryScope,
    providerUserId?: UUID | null
  ): Promise<ProviderScheduleRecord[]>;
  listAppointments(
    scope: RepositoryScope,
    filter?: AppointmentSearchFilter
  ): Promise<AppointmentRecord[]>;
  findAppointmentById(
    scope: RepositoryScope,
    appointmentId: UUID
  ): Promise<AppointmentRecord | null>;
  findAppointmentConflicts(
    scope: RepositoryScope,
    filter: AppointmentConflictFilter
  ): Promise<AppointmentConflict[]>;
  createAppointment(
    scope: RepositoryScope,
    input: CreateAppointmentInput
  ): Promise<AppointmentRecord>;
  updateAppointmentStatus(
    scope: RepositoryScope,
    appointmentId: UUID,
    status: AppointmentStatus,
    reason?: string | null
  ): Promise<AppointmentRecord | null>;

  createQueueEntry(
    scope: RepositoryScope,
    appointment: AppointmentRecord
  ): Promise<QueueEntryRecord>;
  listQueueEntries(scope: RepositoryScope, date: string): Promise<QueueEntryRecord[]>;
  updateQueueEntry(
    scope: RepositoryScope,
    queueEntryId: UUID,
    status: QueueStatus
  ): Promise<QueueEntryRecord | null>;

  listTasks(scope: RepositoryScope, filter?: TaskSearchFilter): Promise<TaskRecord[]>;
  findTaskById(scope: RepositoryScope, taskId: UUID): Promise<TaskRecord | null>;
  createTask(scope: RepositoryScope, input: CreateTaskInput): Promise<TaskRecord>;
  updateTask(
    scope: RepositoryScope,
    taskId: UUID,
    input: UpdateTaskInput
  ): Promise<TaskRecord | null>;
  createRecallRule(scope: RepositoryScope, input: CreateRecallRuleInput): Promise<RecallRuleRecord>;
  listRecalls(scope: RepositoryScope, filter?: RecallSearchFilter): Promise<RecallRecord[]>;
  recordRecallAction(
    scope: RepositoryScope,
    recallId: UUID,
    input: RecordRecallActionInput
  ): Promise<RecallRecord | null>;
  generateDueContinuityTasks(
    scope: RepositoryScope,
    input: GenerateDueContinuityInput
  ): Promise<GenerateDueContinuityResult>;
  createSopTemplate(
    scope: RepositoryScope,
    input: CreateSopTemplateInput
  ): Promise<SopTemplateDetail>;
  createSopSchedule(
    scope: RepositoryScope,
    input: CreateSopScheduleInput
  ): Promise<SopScheduleRecord | null>;
  generateDueSopRuns(
    scope: RepositoryScope,
    input: GenerateDueSopRunsInput
  ): Promise<GenerateDueSopRunsResult>;
  listSopRuns(scope: RepositoryScope, filter?: SopRunSearchFilter): Promise<SopRunDetail[]>;
  updateSopRun(
    scope: RepositoryScope,
    sopRunId: UUID,
    input: UpdateSopRunInput
  ): Promise<SopRunDetail | null>;

  listLabVendors(scope: RepositoryScope): Promise<LabVendorRecord[]>;
  findLabVendorById(scope: RepositoryScope, vendorId: UUID): Promise<LabVendorRecord | null>;
  createLabVendor(scope: RepositoryScope, input: CreateLabVendorInput): Promise<LabVendorRecord>;
  listLabCases(scope: RepositoryScope, filter?: LabCaseSearchFilter): Promise<LabCaseDetail[]>;
  findLabCaseById(scope: RepositoryScope, labCaseId: UUID): Promise<LabCaseDetail | null>;
  createLabCase(scope: RepositoryScope, input: CreateLabCaseInput): Promise<LabCaseDetail | null>;
  updateLabCaseStatus(
    scope: RepositoryScope,
    labCaseId: UUID,
    input: UpdateLabCaseStatusInput
  ): Promise<LabCaseDetail | null>;
  createLabReconciliation(
    scope: RepositoryScope,
    input: CreateLabReconciliationInput
  ): Promise<LabReconciliationDetail | null>;

  listInventoryCategories(scope: RepositoryScope): Promise<InventoryCategoryRecord[]>;
  createInventoryCategory(
    scope: RepositoryScope,
    input: CreateInventoryCategoryInput
  ): Promise<InventoryCategoryRecord>;
  listInventoryItems(scope: RepositoryScope): Promise<InventoryItemRecord[]>;
  findInventoryItemById(scope: RepositoryScope, itemId: UUID): Promise<InventoryItemRecord | null>;
  createInventoryItem(
    scope: RepositoryScope,
    input: CreateInventoryItemInput
  ): Promise<InventoryItemRecord | null>;
  createStockLedgerEntry(
    scope: RepositoryScope,
    input: CreateStockLedgerEntryInput
  ): Promise<StockLedgerEntryRecord | null>;
  listInventoryCheckTemplates(
    scope: RepositoryScope
  ): Promise<Array<InventoryCheckTemplateRecord & { lines: InventoryCheckTemplateLineRecord[] }>>;
  createInventoryCheckTemplate(
    scope: RepositoryScope,
    input: CreateInventoryCheckTemplateInput
  ): Promise<(InventoryCheckTemplateRecord & { lines: InventoryCheckTemplateLineRecord[] }) | null>;
  createInventoryCheckRun(
    scope: RepositoryScope,
    input: CreateInventoryCheckRunInput
  ): Promise<InventoryCheckRunDetail | null>;
  updateInventoryCheckRun(
    scope: RepositoryScope,
    checkRunId: UUID,
    input: UpdateInventoryCheckRunInput
  ): Promise<InventoryCheckRunDetail | null>;
  listInventoryExceptions(
    scope: RepositoryScope,
    filter?: InventoryExceptionFilter
  ): Promise<InventoryExceptionRecord[]>;

  listIncidents(scope: RepositoryScope, filter?: IncidentSearchFilter): Promise<IncidentRecord[]>;
  createIncident(
    scope: RepositoryScope,
    input: CreateIncidentInput
  ): Promise<IncidentRecord | null>;
  listCorrectiveActions(scope: RepositoryScope): Promise<CorrectiveActionRecord[]>;
  createCorrectiveAction(
    scope: RepositoryScope,
    input: CreateCorrectiveActionInput
  ): Promise<CorrectiveActionRecord | null>;
  updateCorrectiveAction(
    scope: RepositoryScope,
    correctiveActionId: UUID,
    input: UpdateCorrectiveActionInput
  ): Promise<CorrectiveActionRecord | null>;

  createAttributionTouch(
    scope: RepositoryScope,
    input: CreateAttributionTouchInput
  ): Promise<AttributionTouchRecord>;
  appendOutboxEvent(scope: RepositoryScope, event: OutboxEventInput): Promise<void>;
  loadDashboardData(scope: RepositoryScope, date: string): Promise<DashboardDataSet>;
  loadOwnerDashboardProjectionData(
    scope: RepositoryScope,
    range: DateRangeFilter
  ): Promise<OwnerDashboardProjectionData>;

  listPricebookProcedures(scope: RepositoryScope): Promise<PricebookProcedureRecord[]>;
  findPricebookProcedureById(
    scope: RepositoryScope,
    procedureId: UUID
  ): Promise<PricebookProcedureRecord | null>;

  listIntakeFormTemplates(scope: RepositoryScope): Promise<IntakeFormTemplateRecord[]>;
  findIntakeFormTemplateById(
    scope: RepositoryScope,
    templateId: UUID
  ): Promise<IntakeFormTemplateRecord | null>;
  createIntakeFormTemplate(
    scope: RepositoryScope,
    input: CreateIntakeFormTemplateInput
  ): Promise<IntakeFormTemplateRecord>;
  createIntakeFormSubmission(
    scope: RepositoryScope,
    input: CreateIntakeFormSubmissionInput
  ): Promise<IntakeFormSubmissionRecord>;
  listPatientIntakeFormSubmissions(
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<IntakeFormSubmissionRecord[]>;

  listPatientConsents(scope: RepositoryScope, patientId: UUID): Promise<ConsentRecord[]>;
  createConsent(scope: RepositoryScope, input: CreateConsentInput): Promise<ConsentRecord>;
  revokeConsent(
    scope: RepositoryScope,
    consentId: UUID,
    input: RevokeConsentInput
  ): Promise<ConsentRecord | null>;
  getConsentEnforcementState(
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<ConsentEnforcementState>;

  createEncounter(scope: RepositoryScope, input: CreateEncounterInput): Promise<EncounterRecord>;
  findEncounterById(scope: RepositoryScope, encounterId: UUID): Promise<EncounterRecord | null>;
  transitionEncounter(
    scope: RepositoryScope,
    encounterId: UUID,
    status: EncounterStatus,
    reason?: string | null
  ): Promise<EncounterRecord | null>;
  saveClinicalNoteDraft(
    scope: RepositoryScope,
    encounterId: UUID,
    input: SaveClinicalNoteDraftInput
  ): Promise<ClinicalNoteVersionRecord | null>;
  listClinicalNoteVersions(
    scope: RepositoryScope,
    encounterId: UUID
  ): Promise<ClinicalNoteVersionRecord[]>;
  signClinicalNote(
    scope: RepositoryScope,
    encounterId: UUID
  ): Promise<SignClinicalNoteResult | null>;
  amendClinicalNote(
    scope: RepositoryScope,
    encounterId: UUID,
    input: AmendClinicalNoteInput
  ): Promise<AmendClinicalNoteResult | null>;

  createPrescription(
    scope: RepositoryScope,
    encounterId: UUID,
    input: CreatePrescriptionInput
  ): Promise<PrescriptionRecord | null>;
  findPrescriptionById(
    scope: RepositoryScope,
    prescriptionId: UUID
  ): Promise<PrescriptionRecord | null>;
  signPrescription(
    scope: RepositoryScope,
    prescriptionId: UUID
  ): Promise<PrescriptionRecord | null>;
  createPatientInstruction(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreatePatientInstructionInput
  ): Promise<PatientInstructionRecord | null>;

  createAiSession(scope: RepositoryScope, input: CreateAiSessionInput): Promise<AiSessionRecord>;
  findAiSessionById(scope: RepositoryScope, sessionId: UUID): Promise<AiSessionRecord | null>;
  findAiSessionDetail(scope: RepositoryScope, sessionId: UUID): Promise<AiSessionDetail | null>;
  listAiSessionsForEncounter(scope: RepositoryScope, encounterId: UUID): Promise<AiSessionRecord[]>;
  createAiTranscriptSegment(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiTranscriptSegmentInput
  ): Promise<{ segment: AiTranscriptSegmentRecord; sourceAnchor: AiSourceAnchorRecord } | null>;
  createAiSourceAnchor(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiSourceAnchorInput
  ): Promise<AiSourceAnchorRecord | null>;
  createAiJob(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiJobInput
  ): Promise<AiJobRecord | null>;
  createAiDraftOutput(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiDraftOutputInput
  ): Promise<AiDraftOutputRecord | null>;
  createAiActionProposal(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiActionProposalInput
  ): Promise<AiActionProposalRecord | null>;
  recordAiReviewDecision(
    scope: RepositoryScope,
    sessionId: UUID,
    input: RecordAiReviewDecisionInput
  ): Promise<AiReviewDecisionRecord | null>;
  deleteAiSessionRetainedPayloads(
    scope: RepositoryScope,
    sessionId: UUID
  ): Promise<AiRetentionDeletionResult | null>;

  createMediaUploadReservation(
    scope: RepositoryScope,
    input: CreateMediaUploadReservationInput
  ): Promise<MediaUploadReservationRecord>;
  findMediaUploadReservationById(
    scope: RepositoryScope,
    uploadId: UUID
  ): Promise<MediaUploadReservationRecord | null>;
  completeMediaUpload(
    scope: RepositoryScope,
    uploadId: UUID,
    input: CompleteMediaUploadInput
  ): Promise<MediaAssetRecord | null>;
  listPatientMediaAssets(scope: RepositoryScope, patientId: UUID): Promise<MediaAssetRecord[]>;
  findMediaAssetById(scope: RepositoryScope, mediaAssetId: UUID): Promise<MediaAssetRecord | null>;

  getDentalChart(scope: RepositoryScope, patientId: UUID): Promise<DentalChartView | null>;
  createDentalFinding(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreateDentalFindingInput
  ): Promise<DentalFindingMutationResult | null>;
  updateDentalFinding(
    scope: RepositoryScope,
    findingId: UUID,
    input: UpdateDentalFindingRepositoryInput
  ): Promise<DentalFindingMutationResult | null>;
  listDentalFindingHistory(
    scope: RepositoryScope,
    findingId: UUID
  ): Promise<DentalFindingHistoryRecord[]>;
  createDentalChartSnapshot(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreateDentalChartSnapshotInput
  ): Promise<DentalChartSnapshotRecord | null>;

  createTreatmentPlan(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreateTreatmentPlanInput
  ): Promise<CreateTreatmentPlanResult | null>;
  findTreatmentPlanById(
    scope: RepositoryScope,
    treatmentPlanId: UUID
  ): Promise<TreatmentPlanDetail | null>;
  updateTreatmentPlan(
    scope: RepositoryScope,
    treatmentPlanId: UUID,
    input: UpdateTreatmentPlanInput
  ): Promise<UpdateTreatmentPlanResult | null>;
  acceptTreatmentPlan(
    scope: RepositoryScope,
    treatmentPlanId: UUID,
    input: AcceptTreatmentPlanInput
  ): Promise<AcceptTreatmentPlanResult | null>;
  createProcedurePerformed(
    scope: RepositoryScope,
    encounterId: UUID,
    input: CreateProcedurePerformedInput
  ): Promise<CreateProcedurePerformedResult | null>;
  listCompletedProceduresForInvoice(
    scope: RepositoryScope,
    input: CreateInvoiceInput
  ): Promise<ProcedurePerformedRecord[]>;
  createInvoice(
    scope: RepositoryScope,
    input: CreateInvoiceInput
  ): Promise<CreateInvoiceResult | null>;
  findInvoiceById(scope: RepositoryScope, invoiceId: UUID): Promise<InvoiceDetail | null>;
  createPaymentRequest(
    scope: RepositoryScope,
    input: CreatePaymentRequestInput
  ): Promise<PaymentRequestRecord | null>;
  recordPaymentTransaction(
    scope: RepositoryScope,
    input: RecordPaymentTransactionInput
  ): Promise<PaymentTransactionRecord | null>;
  createReceipt(
    scope: RepositoryScope,
    invoiceId: UUID,
    input: CreateReceiptInput
  ): Promise<CreateReceiptResult | null>;
}
