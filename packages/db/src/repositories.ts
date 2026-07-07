import type {
  AppointmentConflict,
  AppointmentRecord,
  AppointmentStatus,
  AppointmentTypeRecord,
  AttributionTouchRecord,
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
  CreateInvoiceInput,
  CreatePaymentRequestInput,
  CreateProcedurePerformedInput,
  CreateReceiptInput,
  CreateDentalFindingInput,
  CreateTreatmentPlanInput,
  DomainEventType,
  DentalChartSnapshotRecord,
  DentalChartView,
  DentalFindingHistoryRecord,
  DentalFindingRecord,
  EncounterRecord,
  EncounterStatus,
  IntakeFormTemplateRecord,
  IntakeFormType,
  IntakeFormSubmissionRecord,
  IntakeSubmissionSource,
  MediaAssetRecord,
  MediaScanStatus,
  MediaStorageProviderKey,
  MediaType,
  InvoiceDetail,
  PaymentRequestRecord,
  PaymentTransactionRecord,
  MediaUploadReservationRecord,
  PatientRecord,
  PatientInstructionRecord,
  PatientSource,
  PatientTimelineItem,
  PricebookProcedureRecord,
  PrescriptionMedication,
  PrescriptionRecord,
  ProcedurePerformedRecord,
  ProviderScheduleRecord,
  QueueEntryRecord,
  QueueStatus,
  ReceiptRecord,
  RecordPaymentTransactionInput,
  RoleAssignment,
  TaskRecord,
  TaskStatus,
  TaskType,
  Tenant,
  TenantMembership,
  TreatmentPlanDetail,
  UpdateTreatmentPlanInput,
  UUID
} from "@clinic-os/domain";
import type { LeadIntent, LeadRecord, LeadSource, LeadStatus } from "@clinic-os/domain";

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
  findPatientById(scope: { tenantId: UUID; clinicId: UUID; patientId: UUID }): Promise<PatientRecord | null>;
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
  taskType: TaskType;
  title: string;
  status?: TaskStatus;
  dueAt?: string | null;
  assignedToUserId?: UUID | null;
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
  updatePatient(scope: RepositoryScope, patientId: UUID, input: UpdatePatientInput): Promise<PatientRecord | null>;

  listLeads(scope: RepositoryScope, filter?: LeadSearchFilter): Promise<LeadRecord[]>;
  findLeadById(scope: RepositoryScope, leadId: UUID): Promise<LeadRecord | null>;
  createLead(scope: RepositoryScope, input: CreateLeadInput): Promise<LeadRecord>;
  updateLeadStatus(scope: RepositoryScope, leadId: UUID, status: LeadStatus): Promise<LeadRecord | null>;
  matchLeadToPatient(scope: RepositoryScope, leadId: UUID, patientId: UUID): Promise<LeadRecord | null>;

  listAppointmentTypes(scope: RepositoryScope): Promise<AppointmentTypeRecord[]>;
  listChairs(scope: RepositoryScope): Promise<ChairOrRoomRecord[]>;
  listProviderSchedules(scope: RepositoryScope, providerUserId?: UUID | null): Promise<ProviderScheduleRecord[]>;
  listAppointments(scope: RepositoryScope, filter?: AppointmentSearchFilter): Promise<AppointmentRecord[]>;
  findAppointmentById(scope: RepositoryScope, appointmentId: UUID): Promise<AppointmentRecord | null>;
  findAppointmentConflicts(
    scope: RepositoryScope,
    filter: AppointmentConflictFilter
  ): Promise<AppointmentConflict[]>;
  createAppointment(scope: RepositoryScope, input: CreateAppointmentInput): Promise<AppointmentRecord>;
  updateAppointmentStatus(
    scope: RepositoryScope,
    appointmentId: UUID,
    status: AppointmentStatus,
    reason?: string | null
  ): Promise<AppointmentRecord | null>;

  createQueueEntry(scope: RepositoryScope, appointment: AppointmentRecord): Promise<QueueEntryRecord>;
  listQueueEntries(scope: RepositoryScope, date: string): Promise<QueueEntryRecord[]>;
  updateQueueEntry(scope: RepositoryScope, queueEntryId: UUID, status: QueueStatus): Promise<QueueEntryRecord | null>;

  createTask(scope: RepositoryScope, input: CreateTaskInput): Promise<TaskRecord>;
  createAttributionTouch(
    scope: RepositoryScope,
    input: CreateAttributionTouchInput
  ): Promise<AttributionTouchRecord>;
  appendOutboxEvent(scope: RepositoryScope, event: OutboxEventInput): Promise<void>;
  loadDashboardData(scope: RepositoryScope, date: string): Promise<DashboardDataSet>;

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
  revokeConsent(scope: RepositoryScope, consentId: UUID, input: RevokeConsentInput): Promise<ConsentRecord | null>;
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
  signClinicalNote(scope: RepositoryScope, encounterId: UUID): Promise<SignClinicalNoteResult | null>;
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
  signPrescription(scope: RepositoryScope, prescriptionId: UUID): Promise<PrescriptionRecord | null>;
  createPatientInstruction(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreatePatientInstructionInput
  ): Promise<PatientInstructionRecord | null>;

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
  createInvoice(scope: RepositoryScope, input: CreateInvoiceInput): Promise<CreateInvoiceResult | null>;
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
