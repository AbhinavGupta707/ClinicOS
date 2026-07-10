import { randomUUID } from "node:crypto";
import type { KeycloakAccessTokenClaims } from "@clinic-os/auth";
import {
  CHECKPOINT1_SEED_IDS,
  CHECKPOINT1_SEED_USERS,
  DueGenerationInputError,
  type AppointmentSearchFilter,
  type AcceptTreatmentPlanInput,
  type AmendClinicalNoteInput,
  type AmendClinicalNoteResult,
  type ActiveBreakGlassAccessFilter,
  type AuditEventSearchFilter,
  type ClinicOperationsRepository,
  type AiRetentionDeletionResult,
  type CreateAppointmentInput,
  type CreateAuditReviewInput,
  type CreateBreakGlassAccessInput,
  type CreateDeletionRequestInput,
  type CreateAiActionProposalInput,
  type CreateAiDraftOutputInput,
  type CreateAiJobInput,
  type CreateAiSessionInput,
  type CreateAiSourceAnchorInput,
  type CreateAiTranscriptSegmentInput,
  type CreateAttributionTouchInput,
  type CreateConsentInput,
  type CreateDentalChartSnapshotInput,
  type CreateEncounterInput,
  type CreateDentalFindingInput,
  type CreateInvoiceInput,
  type CreateIntakeFormSubmissionInput,
  type CreateIntakeFormTemplateInput,
  type CreateLeadInput,
  type CreateMediaUploadReservationInput,
  type CreateMigrationBatchInput,
  type CreatePatientInput,
  type CreatePatientInstructionInput,
  type CreatePaymentRequestInput,
  type CreatePrescriptionInput,
  type CreateProcedurePerformedInput,
  type CreateRecallRuleInput,
  type CreateReceiptInput,
  type CreateSopScheduleInput,
  type CreateSopTemplateInput,
  type CreateTreatmentPlanInput,
  type CreateTaskInput,
  type CompleteMediaUploadInput,
  type CreateCorrectiveActionInput,
  type DashboardDataSet,
  type DeletionRequestSearchFilter,
  type DentalFindingMutationResult,
  type GenerateDueContinuityInput,
  type GenerateDueContinuityResult,
  type GenerateDueSopRunsInput,
  type GenerateDueSopRunsResult,
  type IntegrationDeadLetterSearchFilter,
  type BreakGlassAccessSearchFilter,
  type CreateInventoryCategoryInput,
  type CreateInventoryCheckRunInput,
  type CreateInventoryCheckTemplateInput,
  type CreateInventoryItemInput,
  type CreateIncidentInput,
  type CreateLabCaseInput,
  type CreateLabReconciliationInput,
  type CreateLabVendorInput,
  type CreateStockLedgerEntryInput,
  type IdentityAccessSnapshot,
  type IdentityRepository,
  type IncidentSearchFilter,
  type InventoryExceptionFilter,
  type LabCaseSearchFilter,
  type LeadSearchFilter,
  type CommitMigrationBatchInput,
  type MigrationBatchSearchFilter,
  type MigrationRowsFilter,
  type OwnerDashboardProjectionData,
  type OutboxEventInput,
  type PatientSearchFilter,
  type PatientRecordExportInput,
  type PatientRecordExportSearchFilter,
  type RecallSearchFilter,
  type RepositoryScope,
  type RecordPaymentTransactionInput,
  type RecordAiReviewDecisionInput,
  type RecordRecallActionInput,
  type ReplayIntegrationDeadLetterInput,
  type RetentionRunResult,
  type ReviewBreakGlassAccessInput,
  type ReviewDeletionRequestInput,
  type RevokeConsentInput,
  type ResolveMigrationRowInput,
  type RollbackMigrationBatchInput,
  type RunRetentionJobInput,
  type SaveClinicalNoteDraftInput,
  type SignClinicalNoteResult,
  type SopRunSearchFilter,
  type TaskSearchFilter,
  type UpdateCorrectiveActionInput,
  type UpdateDentalFindingRepositoryInput,
  type UpdateInventoryCheckRunInput,
  type UpdateLabCaseStatusInput,
  type UpdateSopRunInput,
  type UpdateTaskInput,
  type UpdateTreatmentPlanInput,
  type UpdatePatientInput
} from "@clinic-os/db";
import {
  addDaysIso,
  assertInvoiceReceiptable,
  assertMinorCurrencyAmount,
  assertPositiveMinorCurrencyAmount,
  assertSopRunCompletion,
  assertTaskCompletionEvidence,
  assertTaskTransition,
  assertFiniteQuantity,
  assertLabCaseTransition,
  assertDentalFindingUpdateReason,
  assertClinicalNoteCanBeAmended,
  assertClinicalNoteCanBeSigned,
  assertEncounterTransition,
  assertPrescriptionCanBeSigned,
  assertTreatmentPlanAcceptable,
  assertTreatmentPlanMutable,
  assertValidDentalFinding,
  assertSupportedSourceAnchors,
  buildDentalChartSnapshotState,
  buildPaymentFollowUpKey,
  buildPostOpFollowUpKey,
  buildRecallGenerationKey,
  buildSopRunGenerationKey,
  clinicLocalDate,
  clinicLocalDateFromClock,
  clinicLocalDateTimeToInstant,
  calculateBillingLineTotals,
  calculateInvoicePaymentStatus,
  calculateInventoryVariance,
  classifyInventoryException,
  buildConsentEnforcementState,
  detectAppointmentConflicts,
  isSettledPaymentTransaction,
  normalizeClinicalNoteContent,
  normalizeDentalSurface,
  normalizeDentalToothNumber,
  normalizePhone,
  toDentalFindingSnapshotFinding,
  type AppointmentConflict,
  type AppointmentRecord,
  type AppointmentStatus,
  type AppointmentTypeRecord,
  type AuditEventForReviewRecord,
  type AuditReviewRecord,
  type AiActionProposalRecord,
  type AiDraftOutputRecord,
  type AiJobRecord,
  type AiReviewDecisionRecord,
  type AiSessionDetail,
  type AiSessionRecord,
  type AiSourceAnchorRecord,
  type AiTranscriptSegmentRecord,
  type AttributionTouchRecord,
  type BreakGlassAccessRecord,
  type ChairOrRoomRecord,
  type Clock,
  type ClinicalNoteVersionRecord,
  type ConsentRecord,
  correctiveActionEffectiveStatus,
  type CorrectiveActionRecord,
  type DeletionRequestRecord,
  type DentalChartRecord,
  type DentalChartSnapshotRecord,
  type DentalFindingHistoryRecord,
  type DentalFindingRecord,
  type DentalSurface,
  type DentalToothNumber,
  type EncounterRecord,
  type InvoiceDetail,
  type InvoiceItemRecord,
  type InvoiceRecord,
  type IntakeFormSubmissionRecord,
  type IntakeFormTemplateRecord,
  type IncidentRecord,
  type InventoryCategoryRecord,
  type InventoryCheckRunDetail,
  type InventoryCheckRunLineRecord,
  type InventoryCheckRunRecord,
  type InventoryCheckTemplateLineRecord,
  type InventoryCheckTemplateRecord,
  type InventoryExceptionRecord,
  type InventoryItemRecord,
  type LabCaseDetail,
  type LabCaseItemRecord,
  type LabCaseRecord,
  type LabCaseStatusHistoryRecord,
  type LabReconciliationDetail,
  type LabReconciliationEntryRecord,
  type LabReconciliationRecord,
  type LabVendorRecord,
  type LeadRecord,
  mediaAssetStatusForScan,
  type MediaAssetRecord,
  type MediaUploadReservationRecord,
  type ImportedRecordLinkRecord,
  type IntegrationDeadLetterRecord,
  type MigrationBatchDetail,
  type MigrationBatchRecord,
  type MigrationCommitRecord,
  type MigrationCommitResult,
  type MigrationConflictRecord,
  type MigrationRollbackResult,
  type MigrationRowRecord,
  type PaymentRequestRecord,
  type PaymentTransactionRecord,
  type PatientRecord,
  type PatientRecordExportRecord,
  type PatientRecordExportSection,
  type PatientRecordExportSnapshot,
  type PatientInstructionRecord,
  type PatientTimelineItem,
  type PricebookProcedureRecord,
  type PrescriptionRecord,
  type ProcurementSuggestionRecord,
  type ProcedurePerformedRecord,
  type ProviderScheduleRecord,
  type QueueEntryRecord,
  type QueueStatus,
  type RecallRecord,
  type RecallRuleRecord,
  type ReceiptPaymentAllocation,
  type ReceiptRecord,
  type RetentionActionRecord,
  type RetentionRunRecord,
  type SopRunDetail,
  type SopRunItemRecord,
  type SopRunItemStatus,
  type SopRunRecord,
  type SopRunStatus,
  type SopScheduleRecord,
  type SopTemplateDetail,
  type SopTemplateItemRecord,
  type SopTemplateRecord,
  type StockLedgerEntryRecord,
  type TaskRecord,
  type TreatmentPlanDetail,
  type TreatmentPlanEstimateItemRecord,
  type TreatmentPlanPhaseRecord,
  type TreatmentPlanRecord,
  type UUID
} from "@clinic-os/domain";
import { systemClock } from "@clinic-os/domain";
import type { AuditEventRecord } from "@clinic-os/security";

const tenant = {
  id: CHECKPOINT1_SEED_IDS.tenantId,
  slug: "clinicos-synthetic-tenant",
  legalName: "ClinicOS Synthetic Dental Private Limited",
  displayName: "ClinicOS Synthetic Tenant",
  status: "active" as const
};

const clinic = {
  id: CHECKPOINT1_SEED_IDS.clinicId,
  tenantId: CHECKPOINT1_SEED_IDS.tenantId,
  slug: "synthetic-dental-clinic",
  displayName: "Synthetic Dental Clinic",
  status: "active" as const,
  timezone: "Asia/Kolkata"
};

const LOCAL_CP6_IDS = {
  labVendor: "10000000-0000-4000-8000-000000090001" as UUID,
  inventoryCategory: "10000000-0000-4000-8000-000000091001" as UUID,
  inventoryItemComposite: "10000000-0000-4000-8000-000000092001" as UUID,
  inventoryTemplate: "10000000-0000-4000-8000-000000093001" as UUID,
  inventoryTemplateLine: "10000000-0000-4000-8000-000000094001" as UUID
};

const CP6_OWNER_DASHBOARD_FIXTURE: OwnerDashboardProjectionData = {
  patients: [
    { id: cp6Id("2001"), source: "google", createdAt: "2026-07-01T08:00:00.000Z" },
    { id: cp6Id("2002"), source: "practo", createdAt: "2026-07-02T08:00:00.000Z" },
    { id: cp6Id("2003"), source: "referral", createdAt: "2026-07-03T08:00:00.000Z" }
  ],
  leads: [
    {
      id: cp6Id("3001"),
      patientId: cp6Id("2001"),
      source: "google",
      status: "booked",
      firstSeenAt: "2026-07-01T08:05:00.000Z"
    },
    {
      id: cp6Id("3002"),
      patientId: cp6Id("2002"),
      source: "practo",
      status: "booked",
      firstSeenAt: "2026-07-02T08:05:00.000Z"
    }
  ],
  appointments: [
    {
      id: cp6Id("4001"),
      patientId: cp6Id("2001"),
      leadId: cp6Id("3001"),
      status: "completed",
      source: "google",
      startAt: "2026-07-03T09:00:00.000Z"
    },
    {
      id: cp6Id("4002"),
      patientId: cp6Id("2002"),
      leadId: cp6Id("3002"),
      status: "no_show",
      source: "practo",
      startAt: "2026-07-03T10:00:00.000Z"
    },
    {
      id: cp6Id("4003"),
      patientId: cp6Id("2003"),
      leadId: null,
      status: "confirmed",
      source: "referral",
      startAt: "2026-07-06T10:00:00.000Z"
    }
  ],
  encounters: [
    {
      id: cp6Id("5001"),
      patientId: cp6Id("2001"),
      appointmentId: cp6Id("4001"),
      status: "closed",
      createdAt: "2026-07-03T09:10:00.000Z"
    },
    {
      id: cp6Id("5002"),
      patientId: cp6Id("2002"),
      appointmentId: cp6Id("4002"),
      status: "cancelled",
      createdAt: "2026-07-03T10:10:00.000Z"
    }
  ],
  attributionTouches: [
    {
      id: cp6Id("6001"),
      patientId: cp6Id("2001"),
      leadId: cp6Id("3001"),
      appointmentId: cp6Id("4001"),
      invoiceId: cp6Id("9001"),
      source: "google",
      touchType: "revenue_touch",
      occurredAt: "2026-07-03T10:30:00.000Z"
    }
  ],
  treatmentPlans: [
    {
      id: cp6Id("7001"),
      patientId: cp6Id("2001"),
      status: "accepted",
      totalMinor: 900000,
      presentedAt: "2026-07-03T09:25:00.000Z",
      acceptedAt: "2026-07-03T09:35:00.000Z",
      createdAt: "2026-07-03T09:20:00.000Z"
    },
    {
      id: cp6Id("7002"),
      patientId: cp6Id("2002"),
      status: "presented",
      totalMinor: 600000,
      presentedAt: "2026-07-04T09:25:00.000Z",
      acceptedAt: null,
      createdAt: "2026-07-04T09:20:00.000Z"
    }
  ],
  procedures: [
    {
      id: cp6Id("8001"),
      patientId: cp6Id("2001"),
      encounterId: cp6Id("5001"),
      treatmentPlanId: cp6Id("7001"),
      invoiceId: cp6Id("9001"),
      status: "completed",
      totalMinor: 900000,
      performedAt: "2026-07-03T09:50:00.000Z"
    },
    {
      id: cp6Id("8002"),
      patientId: cp6Id("2002"),
      encounterId: cp6Id("5002"),
      treatmentPlanId: cp6Id("7002"),
      invoiceId: cp6Id("9002"),
      status: "completed",
      totalMinor: 600000,
      performedAt: "2026-07-04T10:00:00.000Z"
    },
    {
      id: cp6Id("8003"),
      patientId: cp6Id("2003"),
      encounterId: cp6Id("5001"),
      treatmentPlanId: cp6Id("7001"),
      invoiceId: null,
      status: "completed",
      totalMinor: 250000,
      performedAt: "2026-07-05T10:00:00.000Z"
    }
  ],
  invoices: [
    {
      id: cp6Id("9001"),
      patientId: cp6Id("2001"),
      treatmentPlanId: cp6Id("7001"),
      status: "issued",
      paymentStatus: "paid",
      currency: "INR",
      totalMinor: 900000,
      paidMinor: 900000,
      balanceMinor: 0,
      issuedAt: "2026-07-03T10:15:00.000Z",
      dueAt: "2026-07-03T18:00:00.000Z"
    },
    {
      id: cp6Id("9002"),
      patientId: cp6Id("2002"),
      treatmentPlanId: cp6Id("7002"),
      status: "issued",
      paymentStatus: "unpaid",
      currency: "INR",
      totalMinor: 600000,
      paidMinor: 0,
      balanceMinor: 600000,
      issuedAt: "2026-07-04T10:15:00.000Z",
      dueAt: "2026-07-05T18:00:00.000Z"
    }
  ],
  payments: [
    {
      id: cp6Id("a001"),
      invoiceId: cp6Id("9001"),
      status: "manually_recorded",
      amountMinor: 900000,
      receivedAt: "2026-07-03T10:30:00.000Z"
    }
  ],
  recalls: [
    {
      id: cp6Id("b001"),
      patientId: cp6Id("2001"),
      source: "google",
      status: "completed",
      dueAt: "2026-07-02T09:00:00.000Z",
      completedAt: "2026-07-02T11:00:00.000Z",
      bookedAppointmentId: cp6Id("4001")
    },
    {
      id: cp6Id("b002"),
      patientId: cp6Id("2002"),
      source: "practo",
      status: "contacted",
      dueAt: "2026-07-04T09:00:00.000Z",
      completedAt: null,
      bookedAppointmentId: null
    },
    {
      id: cp6Id("b003"),
      patientId: cp6Id("2003"),
      source: "referral",
      status: "due",
      dueAt: "2026-07-06T09:00:00.000Z",
      completedAt: null,
      bookedAppointmentId: null
    }
  ],
  tasks: [
    {
      id: cp6Id("c001"),
      patientId: cp6Id("2001"),
      taskType: "post_op_follow_up",
      status: "done",
      dueAt: "2026-07-02T12:00:00.000Z",
      createdAt: "2026-07-01T12:00:00.000Z",
      updatedAt: "2026-07-02T13:00:00.000Z"
    },
    {
      id: cp6Id("c002"),
      patientId: cp6Id("2002"),
      taskType: "payment_due",
      status: "open",
      dueAt: "2026-07-05T12:00:00.000Z",
      createdAt: "2026-07-04T12:00:00.000Z",
      updatedAt: "2026-07-04T12:00:00.000Z"
    },
    {
      id: cp6Id("c003"),
      patientId: null,
      taskType: "procurement",
      status: "in_progress",
      dueAt: "2026-07-06T12:00:00.000Z",
      createdAt: "2026-07-05T12:00:00.000Z",
      updatedAt: "2026-07-05T12:00:00.000Z"
    },
    {
      id: cp6Id("c004"),
      patientId: null,
      taskType: "capa",
      status: "open",
      dueAt: "2026-07-09T12:00:00.000Z",
      createdAt: "2026-07-05T12:00:00.000Z",
      updatedAt: "2026-07-05T12:00:00.000Z"
    }
  ],
  sopRuns: [
    {
      id: cp6Id("d001"),
      templateKey: "switch-check",
      status: "completed",
      scheduledFor: "2026-07-02T08:00:00.000Z",
      completedAt: "2026-07-02T08:15:00.000Z"
    },
    {
      id: cp6Id("d002"),
      templateKey: "inventory-check",
      status: "scheduled",
      scheduledFor: "2026-07-05T08:00:00.000Z",
      completedAt: null
    }
  ],
  labCases: [
    {
      id: cp6Id("e001"),
      patientId: cp6Id("2001"),
      status: "rework_required",
      dueAt: "2026-07-05T09:00:00.000Z",
      createdAt: "2026-07-01T09:00:00.000Z",
      completedAt: null,
      reconciliationStatus: "pending",
      expectedAmountMinor: 45000,
      invoiceAmountMinor: null
    },
    {
      id: cp6Id("e002"),
      patientId: cp6Id("2002"),
      status: "sent_to_lab",
      dueAt: "2026-07-08T09:00:00.000Z",
      createdAt: "2026-07-04T09:00:00.000Z",
      completedAt: null,
      reconciliationStatus: "not_required",
      expectedAmountMinor: 30000,
      invoiceAmountMinor: null
    },
    {
      id: cp6Id("e003"),
      patientId: cp6Id("2003"),
      status: "completed",
      dueAt: "2026-07-04T09:00:00.000Z",
      createdAt: "2026-07-01T09:00:00.000Z",
      completedAt: "2026-07-05T09:00:00.000Z",
      reconciliationStatus: "variance",
      expectedAmountMinor: 20000,
      invoiceAmountMinor: 22000
    }
  ],
  inventoryExceptions: [
    {
      id: cp6Id("f001"),
      itemKey: "composite-a2",
      severity: "critical",
      status: "procurement_requested",
      detectedAt: "2026-07-02T08:00:00.000Z",
      resolvedAt: null,
      procurementTaskId: cp6Id("c003")
    },
    {
      id: cp6Id("f002"),
      itemKey: "gloves-m",
      severity: "medium",
      status: "open",
      detectedAt: "2026-07-03T08:00:00.000Z",
      resolvedAt: null,
      procurementTaskId: null
    },
    {
      id: cp6Id("f003"),
      itemKey: "etchant",
      severity: "low",
      status: "resolved",
      detectedAt: "2026-07-04T08:00:00.000Z",
      resolvedAt: "2026-07-05T08:00:00.000Z",
      procurementTaskId: null
    }
  ],
  incidents: [
    {
      id: cp6Id("a101"),
      category: "lab_delay",
      severity: "high",
      status: "open",
      occurredAt: "2026-07-04T12:00:00.000Z"
    },
    {
      id: cp6Id("a102"),
      category: "missed_payment_collection",
      severity: "medium",
      status: "closed",
      occurredAt: "2026-07-03T12:00:00.000Z"
    }
  ],
  correctiveActions: [
    {
      id: cp6Id("a201"),
      incidentId: cp6Id("a101"),
      status: "assigned",
      dueAt: "2026-07-05T18:00:00.000Z",
      assignedAt: "2026-07-04T13:00:00.000Z",
      completedAt: null
    },
    {
      id: cp6Id("a202"),
      incidentId: cp6Id("a102"),
      status: "completed",
      dueAt: "2026-07-05T18:00:00.000Z",
      assignedAt: "2026-07-03T13:00:00.000Z",
      completedAt: "2026-07-04T13:00:00.000Z"
    }
  ],
  dataSources: [
    {
      key: "cp6-local-continuity-fixture",
      label: "CP6 local continuity operations fixture",
      status: "local_fixture",
      recordCount: 35,
      provenance: [
        "apps/api/src/local-fixture.ts",
        "fixtures/synthetic/cp6/continuity_owner_dashboard_flow.json"
      ],
      notes:
        "Synthetic local/test fixture rows for CP6 owner dashboard and acceptance harness only."
    }
  ]
};

export class LocalFixtureIdentityRepository implements IdentityRepository {
  async findAccessByKeycloakSubject(subject: string): Promise<IdentityAccessSnapshot | null> {
    const seedUser = CHECKPOINT1_SEED_USERS.find(
      (candidate) => candidate.keycloakSubject === subject
    );

    if (!seedUser) return null;

    const userId = CHECKPOINT1_SEED_IDS.users[seedUser.key];

    return {
      tenant,
      clinics: [clinic],
      user: {
        id: userId,
        displayName: seedUser.displayName,
        email: seedUser.email,
        phone: null,
        status: "active"
      },
      memberships: [
        {
          tenantId: tenant.id,
          userId,
          status: "active"
        }
      ],
      clinicAssignments: [
        {
          tenantId: tenant.id,
          clinicId: clinic.id,
          userId,
          status: "active"
        }
      ],
      roleAssignments: [
        {
          tenantId: tenant.id,
          clinicId: clinic.id,
          userId,
          roleSlug: seedUser.roleSlug
        }
      ]
    };
  }
}

export class InMemoryAuditSink {
  readonly events: AuditEventRecord[] = [];

  async appendAuditEvent(event: AuditEventRecord): Promise<void> {
    this.events.push(event);
  }
}

export class LocalFixtureClinicOperationsRepository implements ClinicOperationsRepository {
  readonly #clock: Clock;
  readonly #clinicTimeZone: string;

  constructor(options: { clock?: Clock; clinicTimeZone?: string } = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#clinicTimeZone = options.clinicTimeZone ?? clinic.timezone;
  }

  readonly patients: PatientRecord[] = [
    {
      id: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      rowVersion: 1,
      fullName: "Rhea Synthetic",
      phone: "+919876543210",
      email: "rhea.synthetic@example.test",
      dateOfBirth: null,
      gender: "female",
      abhaAddress: null,
      source: "manual",
      createdAt: "2026-07-06T09:00:00.000Z",
      updatedAt: "2026-07-06T09:00:00.000Z"
    }
  ];
  readonly leads: LeadRecord[] = [];
  readonly appointmentTypes: AppointmentTypeRecord[] = [
    {
      id: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      code: "consultation",
      displayName: "Consultation",
      defaultDurationMinutes: 30,
      color: "#2563eb",
      active: true
    }
  ];
  readonly chairs: ChairOrRoomRecord[] = [
    {
      id: CHECKPOINT1_SEED_IDS.chairs.operatoryOne,
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      code: "op-1",
      displayName: "Operatory 1",
      active: true
    }
  ];
  readonly providerSchedules: ProviderScheduleRecord[] = [
    {
      id: CHECKPOINT1_SEED_IDS.providerSchedules.doctorWeekday,
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
      dayOfWeek: 1,
      startsAt: "09:00",
      endsAt: "17:00",
      effectiveFrom: "2026-07-06",
      effectiveUntil: null,
      active: true
    }
  ];
  readonly appointments: AppointmentRecord[] = [];
  readonly queueEntries: QueueEntryRecord[] = [];
  readonly tasks: TaskRecord[] = [];
  readonly recallRules: RecallRuleRecord[] = [];
  readonly recalls: RecallRecord[] = [];
  readonly sopTemplates: SopTemplateRecord[] = [];
  readonly sopTemplateItems: SopTemplateItemRecord[] = [];
  readonly sopSchedules: SopScheduleRecord[] = [];
  readonly sopRuns: SopRunRecord[] = [];
  readonly sopRunItems: SopRunItemRecord[] = [];
  readonly labVendors: LabVendorRecord[] = [
    {
      id: LOCAL_CP6_IDS.labVendor,
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      displayName: "Synthetic Crown Lab",
      phone: "+911140000001",
      email: "lab@example.test",
      address: { locality: "Synthetic Dental Market" },
      taxRegistrationNumber: null,
      paymentTermsDays: 30,
      status: "active",
      createdAt: "2026-07-07T08:00:00.000Z",
      updatedAt: "2026-07-07T08:00:00.000Z"
    }
  ];
  readonly labCases: LabCaseRecord[] = [];
  readonly labCaseItems: LabCaseItemRecord[] = [];
  readonly labCaseStatusHistory: LabCaseStatusHistoryRecord[] = [];
  readonly labReconciliations: LabReconciliationRecord[] = [];
  readonly labReconciliationEntries: LabReconciliationEntryRecord[] = [];
  readonly inventoryCategories: InventoryCategoryRecord[] = [
    {
      id: LOCAL_CP6_IDS.inventoryCategory,
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      code: "restorative-materials",
      displayName: "Restorative materials",
      kind: "material",
      active: true,
      createdAt: "2026-07-07T08:00:00.000Z",
      updatedAt: "2026-07-07T08:00:00.000Z"
    }
  ];
  readonly inventoryItems: InventoryItemRecord[] = [
    {
      id: LOCAL_CP6_IDS.inventoryItemComposite,
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      categoryId: LOCAL_CP6_IDS.inventoryCategory,
      sku: "COMP-A2",
      displayName: "Composite resin A2",
      unitOfMeasure: "syringe",
      storageLocation: "Drawer A",
      trackQuantity: true,
      minimumQuantity: 5,
      reorderQuantity: 10,
      currentQuantity: 8,
      status: "active",
      createdAt: "2026-07-07T08:00:00.000Z",
      updatedAt: "2026-07-07T08:00:00.000Z"
    }
  ];
  readonly stockLedgerEntries: StockLedgerEntryRecord[] = [];
  readonly inventoryCheckTemplates: InventoryCheckTemplateRecord[] = [
    {
      id: LOCAL_CP6_IDS.inventoryTemplate,
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      code: "monthly-drawer-a",
      displayName: "Monthly Drawer A inventory",
      cadence: "monthly",
      active: true,
      createdAt: "2026-07-07T08:00:00.000Z",
      updatedAt: "2026-07-07T08:00:00.000Z"
    }
  ];
  readonly inventoryCheckTemplateLines: InventoryCheckTemplateLineRecord[] = [
    {
      id: LOCAL_CP6_IDS.inventoryTemplateLine,
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      templateId: LOCAL_CP6_IDS.inventoryTemplate,
      itemId: LOCAL_CP6_IDS.inventoryItemComposite,
      sequence: 1,
      drawerLocation: "Drawer A",
      expectedQuantity: 8,
      required: true,
      instructions: "Count sealed composite resin syringes."
    }
  ];
  readonly inventoryCheckRuns: InventoryCheckRunRecord[] = [];
  readonly inventoryCheckRunLines: InventoryCheckRunLineRecord[] = [];
  readonly procurementSuggestions: ProcurementSuggestionRecord[] = [];
  readonly incidents: IncidentRecord[] = [];
  readonly correctiveActions: CorrectiveActionRecord[] = [];
  readonly timelineItems: PatientTimelineItem[] = [
    {
      id: uuid(),
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
      itemType: "patient_created",
      sourceTable: "patients",
      sourceId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
      occurredAt: "2026-07-06T09:00:00.000Z",
      title: "Patient registered",
      summary: "Synthetic local fixture patient",
      metadata: { fixture: true }
    }
  ];
  readonly attributionTouches: AttributionTouchRecord[] = [];
  readonly outboxEvents: OutboxEventInput[] = [];
  readonly migrationBatches: MigrationBatchRecord[] = [];
  readonly migrationRows: MigrationRowRecord[] = [];
  readonly migrationConflicts: MigrationConflictRecord[] = [];
  readonly migrationCommits: MigrationCommitRecord[] = [];
  readonly importedRecordLinks: ImportedRecordLinkRecord[] = [];
  readonly integrationDeadLetters: IntegrationDeadLetterRecord[] = [];
  readonly intakeFormTemplates: IntakeFormTemplateRecord[] = [
    {
      id: uuid(),
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      code: "new_patient_intake",
      displayName: "New patient intake",
      formType: "patient_intake",
      version: 1,
      schema: {
        fields: ["chiefComplaint", "medicalHistory", "allergies", "currentMedications"]
      },
      active: true,
      createdAt: "2026-07-07T08:00:00.000Z",
      updatedAt: "2026-07-07T08:00:00.000Z"
    }
  ];
  readonly intakeFormSubmissions: IntakeFormSubmissionRecord[] = [];
  readonly consents: ConsentRecord[] = [];
  readonly encounters: EncounterRecord[] = [];
  readonly clinicalNoteVersions: ClinicalNoteVersionRecord[] = [];
  readonly prescriptions: PrescriptionRecord[] = [];
  readonly patientInstructions: PatientInstructionRecord[] = [];
  readonly aiSessions: AiSessionRecord[] = [];
  readonly aiTranscriptSegments: AiTranscriptSegmentRecord[] = [];
  readonly aiSourceAnchors: AiSourceAnchorRecord[] = [];
  readonly aiJobs: AiJobRecord[] = [];
  readonly aiDraftOutputs: AiDraftOutputRecord[] = [];
  readonly aiActionProposals: AiActionProposalRecord[] = [];
  readonly aiReviewDecisions: AiReviewDecisionRecord[] = [];
  readonly mediaUploadReservations: MediaUploadReservationRecord[] = [];
  readonly mediaAssets: MediaAssetRecord[] = [];
  readonly dentalCharts: DentalChartRecord[] = [
    {
      id: uuid(),
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
      numberingSystem: "fdi",
      createdByUserId: CHECKPOINT1_SEED_IDS.users.assistant,
      updatedByUserId: null,
      createdAt: "2026-07-07T08:00:00.000Z",
      updatedAt: "2026-07-07T08:00:00.000Z"
    }
  ];
  readonly dentalFindings: DentalFindingRecord[] = [];
  readonly dentalFindingHistory: DentalFindingHistoryRecord[] = [];
  readonly dentalChartSnapshots: DentalChartSnapshotRecord[] = [];
  readonly pricebookProcedures: PricebookProcedureRecord[] = [
    {
      id: uuid(),
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      code: "CONSULT",
      displayName: "Dental consultation",
      category: "consultation",
      description: "Chairside examination and treatment discussion",
      defaultUnitPriceMinor: 50000,
      currency: "INR",
      taxRateBasisPoints: 0,
      status: "active",
      createdAt: "2026-07-07T08:00:00.000Z",
      updatedAt: "2026-07-07T08:00:00.000Z"
    },
    {
      id: uuid(),
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      code: "SCALING",
      displayName: "Scaling and polishing",
      category: "periodontics",
      description: "Full-mouth scaling and polishing",
      defaultUnitPriceMinor: 150000,
      currency: "INR",
      taxRateBasisPoints: 0,
      status: "active",
      createdAt: "2026-07-07T08:00:00.000Z",
      updatedAt: "2026-07-07T08:00:00.000Z"
    },
    {
      id: uuid(),
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      code: "RESTORE-COMP",
      displayName: "Composite restoration",
      category: "restorative",
      description: "Tooth-coloured direct restoration",
      defaultUnitPriceMinor: 250000,
      currency: "INR",
      taxRateBasisPoints: 0,
      status: "active",
      createdAt: "2026-07-07T08:00:00.000Z",
      updatedAt: "2026-07-07T08:00:00.000Z"
    },
    {
      id: uuid(),
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      code: "RCT",
      displayName: "Root canal treatment",
      category: "endodontics",
      description: "Root canal therapy excluding crown",
      defaultUnitPriceMinor: 650000,
      currency: "INR",
      taxRateBasisPoints: 0,
      status: "active",
      createdAt: "2026-07-07T08:00:00.000Z",
      updatedAt: "2026-07-07T08:00:00.000Z"
    }
  ];
  readonly treatmentPlans: TreatmentPlanRecord[] = [];
  readonly treatmentPlanPhases: TreatmentPlanPhaseRecord[] = [];
  readonly treatmentPlanEstimateItems: TreatmentPlanEstimateItemRecord[] = [];
  readonly proceduresPerformed: ProcedurePerformedRecord[] = [];
  readonly invoices: InvoiceRecord[] = [];
  readonly invoiceItems: InvoiceItemRecord[] = [];
  readonly paymentRequests: PaymentRequestRecord[] = [];
  readonly paymentTransactions: PaymentTransactionRecord[] = [];
  readonly receipts: ReceiptRecord[] = [];
  readonly auditEvents: AuditEventForReviewRecord[] = [
    {
      id: uuid(),
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      actorType: "user",
      actorId: CHECKPOINT1_SEED_IDS.users.assistant,
      action: "patient.record.viewed",
      category: "phi_access",
      riskLevel: "medium",
      phiInvolved: true,
      resourceType: "patient",
      resourceId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
      patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
      metadata: { workflow: "local_cp9_audit_review_fixture", patientName: "Rhea Synthetic" },
      ipAddress: null,
      userAgent: "local-fixture",
      correlationId: "cp9-audit-fixture",
      occurredAt: "2026-07-07T08:30:00.000Z",
      review: null
    }
  ];
  readonly auditReviews: AuditReviewRecord[] = [];
  readonly patientRecordExports: PatientRecordExportRecord[] = [];
  readonly deletionRequests: DeletionRequestRecord[] = [];
  readonly retentionRuns: RetentionRunRecord[] = [];
  readonly retentionActions: RetentionActionRecord[] = [];
  readonly breakGlassAccesses: BreakGlassAccessRecord[] = [];

  async listPatients(
    scope: RepositoryScope,
    filter: PatientSearchFilter = {}
  ): Promise<PatientRecord[]> {
    return this.patients
      .filter((patient) => matchesScope(patient, scope))
      .filter((patient) => {
        if (filter.source && patient.source !== filter.source) return false;
        if (filter.phone && normalizePhone(patient.phone ?? "") !== normalizePhone(filter.phone))
          return false;
        if (filter.query && !patient.fullName.toLowerCase().includes(filter.query.toLowerCase()))
          return false;
        return true;
      })
      .slice(0, filter.limit ?? 50);
  }

  async findPatientById(scope: RepositoryScope, patientId: UUID): Promise<PatientRecord | null> {
    return (
      this.patients.find((patient) => matchesScope(patient, scope) && patient.id === patientId) ??
      null
    );
  }

  async findPatientTimeline(
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<PatientTimelineItem[]> {
    return this.timelineItems
      .filter((item) => matchesScope(item, scope) && item.patientId === patientId)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  async findPatientDuplicateCandidates(
    scope: RepositoryScope,
    input: { fullName: string; phone: string }
  ): Promise<PatientRecord[]> {
    const normalizedPhone = normalizePhone(input.phone);
    const nameTokens = input.fullName.toLowerCase().split(/\s+/).filter(Boolean);

    return this.patients
      .filter((patient) => matchesScope(patient, scope))
      .filter((patient) => {
        if (patient.phone && normalizePhone(patient.phone) === normalizedPhone) return true;
        return nameTokens.some((token) => patient.fullName.toLowerCase().includes(token));
      });
  }

  async createPatient(scope: RepositoryScope, input: CreatePatientInput): Promise<PatientRecord> {
    const now = this.#nowIso();
    const patient: PatientRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      rowVersion: 1,
      fullName: input.fullName,
      phone: input.phone,
      email: input.email ?? null,
      dateOfBirth: input.dateOfBirth ?? null,
      gender: input.gender ?? "unknown",
      abhaAddress: null,
      source: input.source,
      createdAt: now,
      updatedAt: now
    };

    this.patients.push(patient);
    this.dentalCharts.push({
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: patient.id,
      numberingSystem: "fdi",
      createdByUserId: scope.actorUserId,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now
    });
    this.timelineItems.push(
      this.#timeline(scope, patient.id, "patient_created", "patients", patient.id, "Patient registered")
    );
    return patient;
  }

  async updatePatient(
    scope: RepositoryScope,
    patientId: UUID,
    input: UpdatePatientInput
  ): Promise<PatientRecord | null> {
    const patient = await this.findPatientById(scope, patientId);
    if (!patient) return null;
    advanceFixtureRowVersion(patient);

    Object.assign(patient, {
      fullName: input.fullName ?? patient.fullName,
      phone: input.phone === undefined ? patient.phone : input.phone,
      email: input.email === undefined ? patient.email : input.email,
      dateOfBirth: input.dateOfBirth === undefined ? patient.dateOfBirth : input.dateOfBirth,
      gender: input.gender ?? patient.gender,
      updatedAt: this.#nowIso()
    });

    return patient;
  }

  async listAuditEvents(
    scope: RepositoryScope,
    filter: AuditEventSearchFilter = {}
  ): Promise<AuditEventForReviewRecord[]> {
    return this.auditEvents
      .filter((event) => event.tenantId === scope.tenantId)
      .filter((event) => !event.clinicId || event.clinicId === scope.clinicId)
      .filter((event) => !filter.patientId || event.patientId === filter.patientId)
      .filter((event) => !filter.action || event.action === filter.action)
      .filter((event) => !filter.category || event.category === filter.category)
      .filter((event) => !filter.riskLevel || event.riskLevel === filter.riskLevel)
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
      .slice(0, filter.limit ?? 50)
      .map((event) => ({
        ...event,
        review:
          this.auditReviews.find(
            (review) => matchesScope(review, scope) && review.auditEventId === event.id
          ) ?? null
      }));
  }

  async createAuditReview(
    scope: RepositoryScope,
    auditEventId: UUID,
    input: CreateAuditReviewInput
  ): Promise<AuditReviewRecord | null> {
    const event = (await this.listAuditEvents(scope, { limit: 100 })).find(
      (candidate) => candidate.id === auditEventId
    );
    if (!event) return null;

    const now = this.#nowIso();
    const review: AuditReviewRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      auditEventId,
      reviewStatus: input.reviewStatus,
      disposition: input.disposition,
      notes: input.notes ?? null,
      reviewedByUserId: scope.actorUserId,
      reviewedAt: now,
      createdAt: now
    };
    this.auditReviews.push(review);
    return review;
  }

  async buildPatientRecordExportSnapshot(
    scope: RepositoryScope,
    patientId: UUID,
    sections: PatientRecordExportSection[]
  ): Promise<PatientRecordExportSnapshot | null> {
    const patient = await this.findPatientById(scope, patientId);
    if (!patient) return null;

    const sectionSet = new Set(sections);
    const patientEncounters = this.encounters.filter(
      (encounter) => matchesScope(encounter, scope) && encounter.patientId === patientId
    );
    const encounterIds = new Set(patientEncounters.map((encounter) => encounter.id));
    const patientAiSessions = this.aiSessions.filter(
      (session) => matchesScope(session, scope) && session.patientId === patientId
    );
    const aiSessionIds = new Set(patientAiSessions.map((session) => session.id));
    const mediaAssets = this.mediaAssets
      .filter((asset) => matchesScope(asset, scope) && asset.patientId === patientId)
      .map((asset) => {
        const {
          objectKey: _objectKey,
          storageProvider: _storageProvider,
          storageRegion: _storageRegion,
          ...publicAsset
        } = asset;
        return publicAsset;
      });
    const chart =
      this.dentalCharts.find((candidate) => matchesScope(candidate, scope) && candidate.patientId === patientId) ??
      null;
    const findings = this.dentalFindings.filter(
      (finding) => matchesScope(finding, scope) && finding.patientId === patientId
    );
    const findingIds = new Set(findings.map((finding) => finding.id));
    const invoices = this.invoices.filter(
      (invoice) => matchesScope(invoice, scope) && invoice.patientId === patientId
    );
    const invoiceIds = new Set(invoices.map((invoice) => invoice.id));

    return {
      manifest: {
        schemaVersion: "cp9.patient_record_export.v1",
        generatedAt: this.#nowIso(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        patientId,
        sections,
        format: "json",
        safety: {
          rawStorageReferences: "excluded",
          rawProviderPayloads: "excluded",
          auditMetadata: "phi_redacted",
          tenantScoped: true
        }
      },
      patient: sectionSet.has("demographics") ? patient : null,
      consents: sectionSet.has("consents")
        ? this.consents.filter((consent) => matchesScope(consent, scope) && consent.patientId === patientId)
        : [],
      timeline: sectionSet.has("timeline")
        ? await this.findPatientTimeline(scope, patientId)
        : [],
      intakeSubmissions: sectionSet.has("intake")
        ? this.intakeFormSubmissions.filter(
            (submission) => matchesScope(submission, scope) && submission.patientId === patientId
          )
        : [],
      encounters: sectionSet.has("encounters") ? patientEncounters : [],
      clinicalNotes: sectionSet.has("clinical_notes")
        ? this.clinicalNoteVersions.filter(
            (note) => matchesScope(note, scope) && encounterIds.has(note.encounterId)
          )
        : [],
      prescriptions: sectionSet.has("prescriptions")
        ? this.prescriptions.filter(
            (prescription) =>
              matchesScope(prescription, scope) && prescription.patientId === patientId
          )
        : [],
      instructions: sectionSet.has("instructions")
        ? this.patientInstructions.filter(
            (instruction) =>
              matchesScope(instruction, scope) && instruction.patientId === patientId
          )
        : [],
      dentalChart: {
        chart: sectionSet.has("dental_chart") ? chart : null,
        findings: sectionSet.has("dental_chart") ? findings : [],
        findingHistory: sectionSet.has("dental_chart")
          ? this.dentalFindingHistory.filter(
              (entry) => matchesScope(entry, scope) && findingIds.has(entry.findingId)
            )
          : [],
        snapshots: sectionSet.has("dental_chart")
          ? this.dentalChartSnapshots.filter(
              (snapshot) => matchesScope(snapshot, scope) && snapshot.patientId === patientId
            )
          : []
      },
      mediaAssets: sectionSet.has("media") ? mediaAssets : [],
      billing: {
        invoices: sectionSet.has("billing") ? invoices : [],
        paymentRequests: sectionSet.has("billing")
          ? this.paymentRequests.filter(
              (request) => matchesScope(request, scope) && invoiceIds.has(request.invoiceId)
            )
          : [],
        paymentTransactions: sectionSet.has("billing")
          ? this.paymentTransactions.filter(
              (transaction) =>
                matchesScope(transaction, scope) && invoiceIds.has(transaction.invoiceId)
            )
          : [],
        receipts: sectionSet.has("billing")
          ? this.receipts.filter((receipt) => matchesScope(receipt, scope) && invoiceIds.has(receipt.invoiceId))
          : []
      },
      aiEvidence: {
        sessions: sectionSet.has("ai_evidence") ? patientAiSessions : [],
        sourceAnchors: sectionSet.has("ai_evidence")
          ? this.aiSourceAnchors.filter((anchor) => matchesScope(anchor, scope) && aiSessionIds.has(anchor.sessionId))
          : [],
        draftOutputs: sectionSet.has("ai_evidence")
          ? this.aiDraftOutputs.filter((output) => matchesScope(output, scope) && aiSessionIds.has(output.sessionId))
          : [],
        actionProposals: sectionSet.has("ai_evidence")
          ? this.aiActionProposals.filter(
              (proposal) => matchesScope(proposal, scope) && aiSessionIds.has(proposal.sessionId)
            )
          : [],
        reviewDecisions: sectionSet.has("ai_evidence")
          ? this.aiReviewDecisions.filter(
              (decision) => matchesScope(decision, scope) && aiSessionIds.has(decision.sessionId)
            )
          : []
      },
      privacyAuditTrail: sectionSet.has("privacy_audit")
        ? await this.listAuditEvents(scope, { patientId, limit: 100 })
        : []
    };
  }

  async createPatientRecordExport(
    scope: RepositoryScope,
    input: PatientRecordExportInput
  ): Promise<PatientRecordExportRecord> {
    const now = this.#nowIso();
    const record: PatientRecordExportRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: input.patientId,
      status: "completed",
      format: input.format,
      sections: input.sections,
      requestedByUserId: scope.actorUserId,
      completedByUserId: scope.actorUserId,
      requestedAt: now,
      completedAt: now,
      manifest: input.snapshot.manifest,
      payload: input.snapshot,
      payloadDigest: input.payloadDigest,
      failureReason: null,
      createdAt: now,
      updatedAt: now
    };
    this.patientRecordExports.push(record);
    return record;
  }

  async listPatientRecordExports(
    scope: RepositoryScope,
    filter: PatientRecordExportSearchFilter = {}
  ): Promise<PatientRecordExportRecord[]> {
    return this.patientRecordExports
      .filter((record) => matchesScope(record, scope))
      .filter((record) => !filter.patientId || record.patientId === filter.patientId)
      .filter((record) => !filter.status || record.status === filter.status)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
      .slice(0, filter.limit ?? 25);
  }

  async createDeletionRequest(
    scope: RepositoryScope,
    input: CreateDeletionRequestInput
  ): Promise<DeletionRequestRecord | null> {
    const patient = await this.findPatientById(scope, input.patientId);
    if (!patient) return null;
    const now = this.#nowIso();
    const request: DeletionRequestRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: input.patientId,
      requestType: input.requestType,
      status: "requested",
      reason: input.reason,
      requestedByUserId: scope.actorUserId,
      requestedAt: now,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewReason: null,
      scope: {
        requestedCategories: input.requestedCategories,
        protectedClinicalRecords: "not_deleted",
        protectedAuditRecords: "not_deleted"
      },
      createdAt: now,
      updatedAt: now
    };
    this.deletionRequests.push(request);
    return request;
  }

  async listDeletionRequests(
    scope: RepositoryScope,
    filter: DeletionRequestSearchFilter = {}
  ): Promise<DeletionRequestRecord[]> {
    return this.deletionRequests
      .filter((request) => matchesScope(request, scope))
      .filter((request) => !filter.patientId || request.patientId === filter.patientId)
      .filter((request) => !filter.status || request.status === filter.status)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
      .slice(0, filter.limit ?? 50);
  }

  async findDeletionRequestById(
    scope: RepositoryScope,
    requestId: UUID
  ): Promise<DeletionRequestRecord | null> {
    return (
      this.deletionRequests.find(
        (request) => matchesScope(request, scope) && request.id === requestId
      ) ?? null
    );
  }

  async reviewDeletionRequest(
    scope: RepositoryScope,
    requestId: UUID,
    input: ReviewDeletionRequestInput
  ): Promise<DeletionRequestRecord | null> {
    const request = this.deletionRequests.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === requestId
    );
    if (!request) return null;
    const now = this.#nowIso();
    request.status =
      input.decision === "approve"
        ? "approved_pending_retention_job"
        : input.decision === "cancel"
          ? "cancelled"
          : "rejected";
    request.reviewedByUserId = scope.actorUserId;
    request.reviewedAt = now;
    request.reviewReason = input.reviewReason;
    request.updatedAt = now;
    return request;
  }

  async runRetentionJob(
    scope: RepositoryScope,
    input: RunRetentionJobInput
  ): Promise<RetentionRunResult> {
    const asOf = new Date(input.asOf);
    const cutoff = new Date(asOf.getTime() - input.transcriptDeleteAfterDays * 24 * 60 * 60 * 1000);
    const now = this.#nowIso();
    const runId = uuid();
    const actions: RetentionActionRecord[] = [];
    const eligibleSessions = this.aiSessions.filter((session) => {
      if (!matchesScope(session, scope)) return false;
      if (input.patientId && session.patientId !== input.patientId) return false;
      if (session.status === "retention_deleted") return false;
      return new Date(session.startedAt).getTime() <= cutoff.getTime();
    });

    for (const session of eligibleSessions) {
      const segmentCount = this.aiTranscriptSegments.filter(
        (segment) => matchesScope(segment, scope) && segment.sessionId === session.id
      ).length;
      const status = input.mode === "execute" ? "completed" : "planned";
      actions.push({
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        runId,
        patientId: session.patientId,
        actionKind: "ai_transcript_delete",
        status,
        targetType: "ai_session",
        targetId: session.id,
        protectedRecord: false,
        evidence: {
          transcriptSegmentCount: segmentCount,
          policyCode: input.policyCode,
          mode: input.mode
        },
        completedAt: input.mode === "execute" ? now : null,
        createdAt: now
      });

      if (input.mode === "execute") {
        const remainingSegments = this.aiTranscriptSegments.filter((segment) => segment.sessionId !== session.id);
        this.aiTranscriptSegments.splice(0, this.aiTranscriptSegments.length, ...remainingSegments);
        session.status = "retention_deleted";
        session.rawAudioDeletedAt = now;
        session.transcriptDeletedAt = now;
      }
    }

    for (const protectedTarget of ["clinical_records", "audit_events"] as const) {
      actions.push({
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        runId,
        patientId: input.patientId ?? null,
        actionKind:
          protectedTarget === "clinical_records"
            ? "protected_clinical_record_skipped"
            : "protected_audit_record_skipped",
        status: "skipped",
        targetType: protectedTarget,
        targetId: input.patientId ?? scope.clinicId,
        protectedRecord: true,
        evidence: {
          reason: "Protected clinical and audit records are never deleted by CP9 retention jobs.",
          mode: input.mode,
          deletionRequestId: input.deletionRequestId ?? null
        },
        completedAt: null,
        createdAt: now
      });
    }

    const run: RetentionRunRecord = {
      id: runId,
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      mode: input.mode,
      status: "completed",
      policyCode: input.policyCode,
      asOf: input.asOf,
      deletionRequestId: input.deletionRequestId ?? null,
      startedByUserId: scope.actorUserId,
      startedAt: now,
      completedAt: now,
      summary: {
        eligibleTransientPayloads: eligibleSessions.length,
        completedActions: actions.filter((action) => action.status === "completed").length,
        protectedRecordsSkipped: actions.filter((action) => action.protectedRecord).length
      },
      createdAt: now
    };
    this.retentionRuns.push(run);
    this.retentionActions.push(...actions);
    if (input.mode === "execute" && input.deletionRequestId) {
      const request = await this.findDeletionRequestById(scope, input.deletionRequestId);
      if (request) {
        request.status = "completed";
        request.updatedAt = now;
      }
    }
    return { run, actions };
  }

  async createBreakGlassAccessRequest(
    scope: RepositoryScope,
    input: CreateBreakGlassAccessInput
  ): Promise<BreakGlassAccessRecord | null> {
    const patient = await this.findPatientById(scope, input.patientId);
    if (!patient) return null;
    const now = this.#nowIso();
    const access: BreakGlassAccessRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      requestedByUserId: scope.actorUserId,
      patientId: input.patientId,
      reason: input.reason,
      status: "requested",
      accessCategories: input.accessCategories,
      accessScope: {
        patientId: input.patientId,
        resourceTypes: input.accessCategories,
        clinicalJustification: input.reason
      },
      requestedAt: now,
      expiresAt: input.expiresAt,
      reviewedByUserId: null,
      reviewedAt: null,
      reviewReason: null,
      revokedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.breakGlassAccesses.push(access);
    return access;
  }

  async listBreakGlassAccessRequests(
    scope: RepositoryScope,
    filter: BreakGlassAccessSearchFilter = {}
  ): Promise<BreakGlassAccessRecord[]> {
    return this.breakGlassAccesses
      .filter((access) => matchesScope(access, scope))
      .filter((access) => !filter.patientId || access.patientId === filter.patientId)
      .filter((access) => !filter.status || access.status === filter.status)
      .filter((access) => !filter.requestedByUserId || access.requestedByUserId === filter.requestedByUserId)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))
      .slice(0, filter.limit ?? 50);
  }

  async reviewBreakGlassAccessRequest(
    scope: RepositoryScope,
    requestId: UUID,
    input: ReviewBreakGlassAccessInput
  ): Promise<BreakGlassAccessRecord | null> {
    const access = this.breakGlassAccesses.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === requestId
    );
    if (!access) return null;
    const now = this.#nowIso();
    access.status =
      input.decision === "approve" ? "approved" : input.decision === "revoke" ? "revoked" : "denied";
    access.reviewedByUserId = scope.actorUserId;
    access.reviewedAt = now;
    access.reviewReason = input.reviewReason;
    access.revokedAt = input.decision === "revoke" ? now : access.revokedAt;
    access.updatedAt = now;
    return access;
  }

  async findActiveBreakGlassAccess(
    scope: RepositoryScope,
    filter: ActiveBreakGlassAccessFilter
  ): Promise<BreakGlassAccessRecord | null> {
    const at = new Date(filter.at).getTime();
    return (
      this.breakGlassAccesses.find(
        (access) =>
          matchesScope(access, scope) &&
          access.status === "approved" &&
          access.revokedAt === null &&
          access.requestedByUserId === filter.userId &&
          access.patientId === filter.patientId &&
          new Date(access.expiresAt).getTime() > at &&
          (!filter.requiredCategory || access.accessCategories.includes(filter.requiredCategory))
      ) ?? null
    );
  }

  async createMigrationBatch(
    scope: RepositoryScope,
    input: CreateMigrationBatchInput
  ): Promise<MigrationBatchDetail> {
    const now = this.#nowIso();
    const batch: MigrationBatchRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      importType: input.importType,
      sourceSystem: input.sourceSystem,
      sourceFileName: input.sourceFileName ?? null,
      sourceChecksum: input.sourceChecksum ?? null,
      state: input.state,
      uploadedByUserId: scope.actorUserId,
      committedByUserId: null,
      rolledBackByUserId: null,
      rowCount: input.rows.length,
      validRowCount: input.rows.filter((row) => row.status !== "invalid").length,
      invalidRowCount: input.rows.filter((row) => row.status === "invalid").length,
      conflictRowCount: input.rows.filter((row) =>
        ["needs_review", "conflict", "duplicate_candidate"].includes(row.matchStatus)
      ).length,
      readyRowCount: input.rows.filter((row) => row.status === "ready_to_commit").length,
      committedRowCount: 0,
      rolledBackRowCount: 0,
      failedRowCount: 0,
      committedAt: null,
      rolledBackAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.migrationBatches.push(batch);

    for (const rowInput of input.rows) {
      const row: MigrationRowRecord = {
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        batchId: batch.id,
        rowNumber: rowInput.rowNumber,
        importType: rowInput.importType,
        externalRecordId: rowInput.externalRecordId ?? null,
        rawPayloadDigest: rowInput.rawPayloadDigest,
        rawPayloadRef: {
          rowId: "00000000-0000-4000-8000-000000000000" as UUID,
          digest: rowInput.rawPayloadDigest,
          retained: true
        },
        normalizedRecord: rowInput.normalizedRecord ?? null,
        validationErrors: rowInput.validationErrors,
        status: rowInput.status,
        matchStatus: rowInput.matchStatus,
        resolutionAction: null,
        resolutionTargetRecordType: null,
        resolutionTargetRecordId: null,
        resolutionNote: null,
        committedRecordType: null,
        committedRecordId: null,
        errorMessage: null,
        conflicts: [],
        createdAt: now,
        updatedAt: now
      };
      row.rawPayloadRef = { ...row.rawPayloadRef, rowId: row.id };
      this.migrationRows.push(row);

      for (const conflictInput of rowInput.conflicts ?? []) {
        const conflict: MigrationConflictRecord = {
          id: uuid(),
          tenantId: scope.tenantId,
          clinicId: scope.clinicId,
          batchId: batch.id,
          rowId: row.id,
          conflictType: conflictInput.conflictType,
          severity: conflictInput.severity,
          targetRecordType: conflictInput.targetRecordType ?? null,
          targetRecordId: conflictInput.targetRecordId ?? null,
          fieldName: conflictInput.fieldName ?? null,
          summary: conflictInput.summary,
          evidence: conflictInput.evidence ?? {},
          status: "open",
          resolutionAction: null,
          resolvedByUserId: null,
          resolvedAt: null,
          createdAt: now,
          updatedAt: now
        };
        this.migrationConflicts.push(conflict);
      }
    }

    this.#refreshMigrationBatchCounts(batch);
    return this.#migrationBatchDetail(scope, batch);
  }

  async findMigrationBatchById(
    scope: RepositoryScope,
    batchId: UUID
  ): Promise<MigrationBatchDetail | null> {
    const batch =
      this.migrationBatches.find((candidate) => matchesScope(candidate, scope) && candidate.id === batchId) ??
      null;
    return batch ? this.#migrationBatchDetail(scope, batch) : null;
  }

  async listMigrationBatches(
    scope: RepositoryScope,
    filter: MigrationBatchSearchFilter = {}
  ): Promise<MigrationBatchDetail[]> {
    return this.migrationBatches
      .filter((batch) => matchesScope(batch, scope))
      .filter((batch) => !filter.status || batch.state === filter.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, filter.limit ?? 25)
      .map((batch) => this.#migrationBatchDetail(scope, batch));
  }

  async listMigrationRows(
    scope: RepositoryScope,
    batchId: UUID,
    filter: MigrationRowsFilter = {}
  ): Promise<MigrationRowRecord[]> {
    return this.migrationRows
      .filter((row) => matchesScope(row, scope) && row.batchId === batchId)
      .filter((row) => {
        if (filter.matchStatus && row.matchStatus !== filter.matchStatus) return false;
        if (filter.status && row.status !== filter.status) return false;
        return true;
      })
      .sort((left, right) => left.rowNumber - right.rowNumber)
      .map((row) => this.#migrationRowWithConflicts(scope, row));
  }

  async resolveMigrationRow(
    scope: RepositoryScope,
    batchId: UUID,
    rowId: UUID,
    input: ResolveMigrationRowInput
  ): Promise<MigrationRowRecord | null> {
    const batch =
      this.migrationBatches.find((candidate) => matchesScope(candidate, scope) && candidate.id === batchId) ??
      null;
    const row =
      this.migrationRows.find(
        (candidate) => matchesScope(candidate, scope) && candidate.batchId === batchId && candidate.id === rowId
      ) ?? null;
    if (!batch || !row) return null;
    if (row.status === "committed" || row.status === "rolled_back") return null;

    if (input.action === "link_existing") {
      const patient = input.targetRecordId
        ? await this.findPatientById(scope, input.targetRecordId)
        : null;
      if (!patient) return null;
      row.resolutionTargetRecordType = input.targetRecordType ?? "patient";
      row.resolutionTargetRecordId = patient.id;
    } else {
      row.resolutionTargetRecordType = null;
      row.resolutionTargetRecordId = null;
    }

    row.resolutionAction = input.action;
    row.resolutionNote = input.note ?? null;
    row.status = input.action === "skip" ? "skipped" : "ready_to_commit";
    row.matchStatus = input.action === "skip" ? "skipped" : "resolved";
    row.updatedAt = this.#nowIso();

    for (const conflict of this.migrationConflicts.filter(
      (candidate) => matchesScope(candidate, scope) && candidate.batchId === batchId && candidate.rowId === rowId
    )) {
      conflict.status = input.action === "skip" ? "ignored" : "resolved";
      conflict.resolutionAction = input.action;
      conflict.resolvedByUserId = scope.actorUserId;
      conflict.resolvedAt = row.updatedAt;
      conflict.updatedAt = row.updatedAt;
    }

    this.#refreshMigrationBatchCounts(batch);
    return this.#migrationRowWithConflicts(scope, row);
  }

  async commitMigrationBatch(
    scope: RepositoryScope,
    batchId: UUID,
    input: CommitMigrationBatchInput = {}
  ): Promise<MigrationCommitResult | null> {
    const batch =
      this.migrationBatches.find((candidate) => matchesScope(candidate, scope) && candidate.id === batchId) ??
      null;
    if (!batch) return null;

    const existing = this.#findExistingMigrationCommit(scope, batchId, "commit", input.idempotencyKey);
    if (existing || batch.state === "committed" || batch.state === "partially_committed") {
      return {
        batch,
        commit: existing ?? this.#latestMigrationCommit(scope, batchId, "commit") ?? this.#createMigrationCommit(scope, batchId, "commit", "succeeded", input.idempotencyKey ?? null, {}, null),
        rows: await this.listMigrationRows(scope, batchId),
        importedRecordLinks: this.#importedLinksForBatch(scope, batchId)
      };
    }

    const readyRows = this.migrationRows.filter(
      (row) => matchesScope(row, scope) && row.batchId === batchId && row.status === "ready_to_commit"
    );
    const linksCreated: ImportedRecordLinkRecord[] = [];

    for (const row of readyRows) {
      if (!row.normalizedRecord || row.normalizedRecord.recordType !== "patient") {
        row.status = "failed";
        row.errorMessage = "Only patient import rows can be committed in CP7.";
        continue;
      }

      if (row.resolutionAction === "link_existing") {
        if (!row.resolutionTargetRecordId) {
          row.status = "failed";
          row.errorMessage = "Resolved existing patient target is missing.";
          continue;
        }

        row.committedRecordType = "patient";
        row.committedRecordId = row.resolutionTargetRecordId;
        row.status = "committed";
        linksCreated.push(
          this.#createImportedRecordLink(scope, batch, row, row.resolutionTargetRecordId, "linked_existing")
        );
        continue;
      }

      const patient = await this.createPatient(scope, {
        fullName: row.normalizedRecord.fullName,
        phone: row.normalizedRecord.phone,
        email: row.normalizedRecord.email,
        dateOfBirth: row.normalizedRecord.dateOfBirth,
        gender: row.normalizedRecord.gender,
        source: "imported",
        sourceDetail: {
          sourceSystem: batch.sourceSystem,
          externalReference: row.externalRecordId,
          ...row.normalizedRecord.sourceDetail
        }
      });
      row.committedRecordType = "patient";
      row.committedRecordId = patient.id;
      row.status = "committed";
      row.updatedAt = this.#nowIso();
      linksCreated.push(this.#createImportedRecordLink(scope, batch, row, patient.id, "created_from_import"));
    }

    const failedRows = this.migrationRows.filter(
      (row) => matchesScope(row, scope) && row.batchId === batchId && row.status === "failed"
    );
    this.#refreshMigrationBatchCounts(batch);
    batch.committedByUserId = scope.actorUserId;
    batch.committedAt = this.#nowIso();
    batch.state =
      failedRows.length > 0 || batch.invalidRowCount > 0 || batch.conflictRowCount > 0
        ? "partially_committed"
        : "committed";
    batch.updatedAt = batch.committedAt;

    const commit = this.#createMigrationCommit(
      scope,
      batchId,
      "commit",
      batch.state === "committed" ? "succeeded" : "partially_succeeded",
      input.idempotencyKey ?? null,
      {
        committedRows: batch.committedRowCount,
        invalidRows: batch.invalidRowCount,
        failedRows: batch.failedRowCount,
        linksCreated: linksCreated.length
      },
      failedRows.length > 0 ? { failedRowIds: failedRows.map((row) => row.id) } : null
    );

    return {
      batch,
      commit,
      rows: await this.listMigrationRows(scope, batchId),
      importedRecordLinks: this.#importedLinksForBatch(scope, batchId)
    };
  }

  async rollbackMigrationBatch(
    scope: RepositoryScope,
    batchId: UUID,
    input: RollbackMigrationBatchInput = {}
  ): Promise<MigrationRollbackResult | null> {
    const batch =
      this.migrationBatches.find((candidate) => matchesScope(candidate, scope) && candidate.id === batchId) ??
      null;
    if (!batch) return null;

    const existing = this.#findExistingMigrationCommit(scope, batchId, "rollback", input.idempotencyKey);
    if (existing || batch.state === "rolled_back") {
      return {
        batch,
        rollback: existing ?? this.#latestMigrationCommit(scope, batchId, "rollback") ?? this.#createMigrationCommit(scope, batchId, "rollback", "succeeded", input.idempotencyKey ?? null, {}, null),
        rows: await this.listMigrationRows(scope, batchId),
        importedRecordLinks: this.#importedLinksForBatch(scope, batchId),
        blockedLinks: []
      };
    }

    const links = this.#importedLinksForBatch(scope, batchId).filter(
      (link) => link.verificationStatus === "imported_unverified"
    );
    const blockedLinks: ImportedRecordLinkRecord[] = [];
    const rolledBackLinks: ImportedRecordLinkRecord[] = [];

    for (const link of links) {
      if (link.linkType === "created_from_import" && this.#patientHasRollbackBlockingDependencies(scope, link.targetRecordId)) {
        link.metadata = {
          ...link.metadata,
          rollbackBlockedAt: this.#nowIso(),
          rollbackBlockedReason: "Imported patient has downstream clinical or billing dependencies."
        };
        blockedLinks.push(link);
        continue;
      }

      if (link.linkType === "created_from_import") {
        removeWhere(this.dentalCharts, (chart) => matchesScope(chart, scope) && chart.patientId === link.targetRecordId);
        removeWhere(this.timelineItems, (item) => matchesScope(item, scope) && item.patientId === link.targetRecordId);
        removeWhere(this.patients, (patient) => matchesScope(patient, scope) && patient.id === link.targetRecordId);
      }

      link.verificationStatus = "rolled_back";
      link.updatedAt = this.#nowIso();
      rolledBackLinks.push(link);

      const row = this.migrationRows.find(
        (candidate) => matchesScope(candidate, scope) && candidate.id === link.rowId
      );
      if (row) {
        row.status = "rolled_back";
        row.matchStatus = row.resolutionAction === "link_existing" ? "resolved" : row.matchStatus;
        row.updatedAt = link.updatedAt;
      }
    }

    this.#refreshMigrationBatchCounts(batch);
    batch.rolledBackByUserId = scope.actorUserId;
    batch.rolledBackAt = this.#nowIso();
    batch.state = blockedLinks.length > 0 ? "partially_committed" : "rolled_back";
    batch.updatedAt = batch.rolledBackAt;

    const rollback = this.#createMigrationCommit(
      scope,
      batchId,
      "rollback",
      blockedLinks.length > 0 ? "partially_succeeded" : "succeeded",
      input.idempotencyKey ?? null,
      {
        rolledBackLinks: rolledBackLinks.length,
        blockedLinks: blockedLinks.length
      },
      blockedLinks.length > 0 ? { blockedLinkIds: blockedLinks.map((link) => link.id) } : null
    );

    return {
      batch,
      rollback,
      rows: await this.listMigrationRows(scope, batchId),
      importedRecordLinks: this.#importedLinksForBatch(scope, batchId),
      blockedLinks
    };
  }

  async listIntegrationDeadLetters(
    scope: RepositoryScope,
    filter: IntegrationDeadLetterSearchFilter = {}
  ): Promise<IntegrationDeadLetterRecord[]> {
    return this.integrationDeadLetters
      .filter(
        (deadLetter) =>
          deadLetter.tenantId === scope.tenantId &&
          (deadLetter.clinicId === null || deadLetter.clinicId === scope.clinicId)
      )
      .filter((deadLetter) => !filter.status || deadLetter.status === filter.status)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, filter.limit ?? 50)
      .map((deadLetter) => ({ ...deadLetter }));
  }

  async requestIntegrationDeadLetterReplay(
    scope: RepositoryScope,
    deadLetterId: UUID,
    input: ReplayIntegrationDeadLetterInput
  ): Promise<IntegrationDeadLetterRecord | null> {
    const deadLetter =
      this.integrationDeadLetters.find(
        (candidate) =>
          candidate.tenantId === scope.tenantId &&
          (candidate.clinicId === null || candidate.clinicId === scope.clinicId) &&
          candidate.id === deadLetterId
      ) ?? null;
    if (!deadLetter || ["replayed", "resolved", "discarded"].includes(deadLetter.status)) {
      return null;
    }

    const requestedAt = this.#nowIso();
    deadLetter.status = "retry_scheduled";
    deadLetter.retryCount += 1;
    deadLetter.nextRetryAt = requestedAt;
    deadLetter.updatedAt = requestedAt;
    deadLetter.lastErrorDigest = input.reason
      ? `reviewed:${input.reviewedByUserId}:${input.reason.slice(0, 64)}`
      : deadLetter.lastErrorDigest;
    return { ...deadLetter };
  }

  async listLeads(scope: RepositoryScope, filter: LeadSearchFilter = {}): Promise<LeadRecord[]> {
    return this.leads
      .filter((lead) => matchesScope(lead, scope))
      .filter((lead) => {
        if (filter.source && lead.source !== filter.source) return false;
        if (filter.status && lead.status !== filter.status) return false;
        return true;
      })
      .slice(0, filter.limit ?? 50);
  }

  async findLeadById(scope: RepositoryScope, leadId: UUID): Promise<LeadRecord | null> {
    return this.leads.find((lead) => matchesScope(lead, scope) && lead.id === leadId) ?? null;
  }

  async createLead(scope: RepositoryScope, input: CreateLeadInput): Promise<LeadRecord> {
    const now = this.#nowIso();
    const lead: LeadRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      rowVersion: 1,
      patientId: null,
      primaryContact: input.primaryContact,
      status: "new",
      intent: input.intent,
      source: input.source,
      sourceDetail: input.sourceDetail,
      firstSeenAt: now,
      lastActivityAt: now,
      createdByUserId: scope.actorUserId
    };

    this.leads.push(lead);
    return lead;
  }

  async updateLeadStatus(
    scope: RepositoryScope,
    leadId: UUID,
    status: LeadRecord["status"]
  ): Promise<LeadRecord | null> {
    const lead = await this.findLeadById(scope, leadId);
    if (!lead) return null;
    advanceFixtureRowVersion(lead);
    lead.status = status;
    lead.lastActivityAt = this.#nowIso();
    return lead;
  }

  async matchLeadToPatient(
    scope: RepositoryScope,
    leadId: UUID,
    patientId: UUID
  ): Promise<LeadRecord | null> {
    const lead = await this.findLeadById(scope, leadId);
    if (!lead) return null;
    advanceFixtureRowVersion(lead);
    lead.patientId = patientId;
    lead.status = "matched";
    lead.lastActivityAt = this.#nowIso();
    this.timelineItems.push(
      this.#timeline(scope, patientId, "lead_matched", "leads", leadId, "Lead matched to patient")
    );
    return lead;
  }

  async listAppointmentTypes(scope: RepositoryScope): Promise<AppointmentTypeRecord[]> {
    return this.appointmentTypes.filter((type) => matchesScope(type, scope) && type.active);
  }

  async listChairs(scope: RepositoryScope): Promise<ChairOrRoomRecord[]> {
    return this.chairs.filter((chair) => matchesScope(chair, scope) && chair.active);
  }

  async listProviderSchedules(
    scope: RepositoryScope,
    providerUserId?: UUID | null
  ): Promise<ProviderScheduleRecord[]> {
    return this.providerSchedules.filter(
      (schedule) =>
        matchesScope(schedule, scope) &&
        (!providerUserId || schedule.providerUserId === providerUserId)
    );
  }

  async listAppointments(
    scope: RepositoryScope,
    filter: AppointmentSearchFilter = {}
  ): Promise<AppointmentRecord[]> {
    return this.appointments
      .filter((appointment) => matchesScope(appointment, scope))
      .filter((appointment) => {
        if (filter.date && !appointment.startAt.startsWith(filter.date)) return false;
        if (filter.providerUserId && appointment.providerUserId !== filter.providerUserId)
          return false;
        if (filter.status && appointment.status !== filter.status) return false;
        return true;
      })
      .sort((left, right) => left.startAt.localeCompare(right.startAt));
  }

  async findAppointmentById(
    scope: RepositoryScope,
    appointmentId: UUID
  ): Promise<AppointmentRecord | null> {
    return (
      this.appointments.find(
        (appointment) => matchesScope(appointment, scope) && appointment.id === appointmentId
      ) ?? null
    );
  }

  async findAppointmentConflicts(
    scope: RepositoryScope,
    filter: {
      appointmentIdToExclude?: UUID | null;
      providerUserId: UUID;
      chairId?: UUID | null;
      startAt: string;
      endAt: string;
    }
  ): Promise<AppointmentConflict[]> {
    const existing = this.appointments.filter(
      (appointment) =>
        matchesScope(appointment, scope) && appointment.id !== filter.appointmentIdToExclude
    );

    return detectAppointmentConflicts(
      {
        providerUserId: filter.providerUserId,
        chairId: filter.chairId ?? null,
        startAt: filter.startAt,
        endAt: filter.endAt
      },
      existing
    );
  }

  async createAppointment(
    scope: RepositoryScope,
    input: CreateAppointmentInput
  ): Promise<AppointmentRecord> {
    const now = this.#nowIso();
    const appointment: AppointmentRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      rowVersion: 1,
      patientId: input.patientId,
      leadId: input.leadId ?? null,
      providerUserId: input.providerUserId,
      appointmentTypeId: input.appointmentTypeId,
      chairId: input.chairId ?? null,
      status: input.status,
      startAt: input.startAt,
      endAt: input.endAt,
      source: input.source,
      reason: input.reason ?? null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now
    };

    this.appointments.push(appointment);
    this.timelineItems.push(
      this.#timeline(
        scope,
        appointment.patientId,
        "appointment_created",
        "appointments",
        appointment.id,
        "Appointment booked"
      )
    );
    return appointment;
  }

  async updateAppointmentStatus(
    scope: RepositoryScope,
    appointmentId: UUID,
    status: AppointmentStatus
  ): Promise<AppointmentRecord | null> {
    const appointment = await this.findAppointmentById(scope, appointmentId);
    if (!appointment) return null;
    advanceFixtureRowVersion(appointment);
    appointment.status = status;
    appointment.updatedAt = this.#nowIso();

    const timelineType =
      status === "confirmed"
        ? "appointment_confirmed"
        : status === "checked_in"
          ? "patient_checked_in"
          : status === "no_show"
            ? "appointment_no_show"
            : null;

    if (timelineType) {
      this.timelineItems.push(
        this.#timeline(
          scope,
          appointment.patientId,
          timelineType,
          "appointments",
          appointment.id,
          status === "checked_in" ? "Patient checked in" : `Appointment ${status.replace("_", " ")}`
        )
      );
    }

    return appointment;
  }

  async createQueueEntry(
    scope: RepositoryScope,
    appointment: AppointmentRecord
  ): Promise<QueueEntryRecord> {
    const existing = this.queueEntries.find(
      (entry) => matchesScope(entry, scope) && entry.appointmentId === appointment.id
    );
    if (existing) return existing;

    const queueEntry: QueueEntryRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      rowVersion: 1,
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      providerUserId: appointment.providerUserId,
      status: "waiting",
      position: this.queueEntries.filter((entry) => matchesScope(entry, scope)).length + 1,
      checkedInAt: this.#nowIso(),
      calledAt: null,
      completedAt: null
    };

    this.queueEntries.push(queueEntry);
    this.timelineItems.push(
      this.#timeline(
        scope,
        appointment.patientId,
        "queue_entry_created",
        "queue_entries",
        queueEntry.id,
        "Queue entry created"
      )
    );
    return queueEntry;
  }

  async listQueueEntries(scope: RepositoryScope, date: string): Promise<QueueEntryRecord[]> {
    return this.queueEntries
      .filter((entry) => matchesScope(entry, scope) && entry.checkedInAt.startsWith(date))
      .sort((left, right) => left.position - right.position);
  }

  async updateQueueEntry(
    scope: RepositoryScope,
    queueEntryId: UUID,
    status: QueueStatus
  ): Promise<QueueEntryRecord | null> {
    const queueEntry = this.queueEntries.find(
      (entry) => matchesScope(entry, scope) && entry.id === queueEntryId
    );
    if (!queueEntry) return null;
    advanceFixtureRowVersion(queueEntry);
    queueEntry.status = status;
    if (status === "called") queueEntry.calledAt = queueEntry.calledAt ?? this.#nowIso();
    if (status === "completed")
      queueEntry.completedAt = queueEntry.completedAt ?? this.#nowIso();
    return queueEntry;
  }

  async listTasks(scope: RepositoryScope, filter: TaskSearchFilter = {}): Promise<TaskRecord[]> {
    return this.tasks
      .filter((task) => matchesScope(task, scope))
      .filter((task) => {
        if (filter.status && task.status !== filter.status) return false;
        if (filter.patientId && task.patientId !== filter.patientId) return false;
        if (filter.assignedToUserId && task.assignedToUserId !== filter.assignedToUserId)
          return false;
        if (filter.sourceWorkflow && task.sourceWorkflow !== filter.sourceWorkflow) return false;
        if (filter.dueDate && !task.dueAt?.startsWith(filter.dueDate)) return false;
        if (filter.dueBefore && (!task.dueAt || task.dueAt > filter.dueBefore)) return false;
        return true;
      })
      .sort((left, right) => taskSortKey(left).localeCompare(taskSortKey(right)))
      .slice(0, filter.limit ?? 100);
  }

  async findTaskById(scope: RepositoryScope, taskId: UUID): Promise<TaskRecord | null> {
    return this.tasks.find((task) => matchesScope(task, scope) && task.id === taskId) ?? null;
  }

  async createTask(scope: RepositoryScope, input: CreateTaskInput): Promise<TaskRecord> {
    return this.insertTask(scope, input);
  }

  async updateTask(
    scope: RepositoryScope,
    taskId: UUID,
    input: UpdateTaskInput
  ): Promise<TaskRecord | null> {
    const task = await this.findTaskById(scope, taskId);
    if (!task) return null;
    const nextStatus = input.status ?? task.status;
    assertTaskTransition(task.status, nextStatus);
    const completionEvidence =
      input.completionEvidence ?? (nextStatus === "done" ? task.completionEvidence : {});
    const completedAt = nextStatus === "done" ? task.completedAt ?? this.#nowIso() : null;
    const completedByUserId =
      nextStatus === "done" ? task.completedByUserId ?? scope.actorUserId : null;
    assertTaskCompletionEvidence({
      status: nextStatus,
      evidence: completionEvidence,
      completedAt,
      completedByUserId
    });
    advanceFixtureRowVersion(task);

    Object.assign(task, {
      status: nextStatus,
      title: input.title ?? task.title,
      description: input.description === undefined ? task.description : input.description,
      priority: input.priority ?? task.priority,
      dueAt: input.dueAt === undefined ? task.dueAt : input.dueAt,
      assignedToUserId:
        input.assignedToUserId === undefined ? task.assignedToUserId : input.assignedToUserId,
      assignedByUserId:
        input.assignedToUserId === undefined || input.assignedToUserId === task.assignedToUserId
          ? task.assignedByUserId
          : scope.actorUserId,
      completedByUserId,
      completedAt,
      completionEvidence,
      cancelledReason: input.cancelledReason ?? task.cancelledReason,
      updatedByUserId: scope.actorUserId,
      statusChangedAt: nextStatus === task.status ? task.statusChangedAt : this.#nowIso(),
      updatedAt: this.#nowIso()
    });
    if (task.patientId) {
      this.timelineItems.push(
        this.#timeline(
          scope,
          task.patientId,
          nextStatus === "done" ? "task_completed" : "task_status_changed",
          "tasks",
          task.id,
          nextStatus === "done" ? "Task completed" : "Task status changed",
          { status: nextStatus, taskType: task.taskType }
        )
      );
    }
    return task;
  }

  async createRecallRule(
    scope: RepositoryScope,
    input: CreateRecallRuleInput
  ): Promise<RecallRuleRecord> {
    if (
      input.anchor === "checkout_completed" &&
      (input.procedureCategory != null || input.pricebookProcedureId != null)
    ) {
      throw new DueGenerationInputError(
        "Checkout-anchored recall rules cannot include procedure filters."
      );
    }
    const now = this.#nowIso();
    const rule: RecallRuleRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      code: input.code,
      title: input.title,
      status: "active",
      anchor: input.anchor ?? "procedure_completed",
      offsetDays: input.offsetDays,
      procedureCategory: input.procedureCategory ?? null,
      pricebookProcedureId: input.pricebookProcedureId ?? null,
      defaultTaskTitle: input.defaultTaskTitle ?? input.title,
      defaultTaskPriority: input.defaultTaskPriority ?? "normal",
      createdByUserId: scope.actorUserId,
      updatedByUserId: scope.actorUserId,
      createdAt: now,
      updatedAt: now
    };
    this.recallRules.push(rule);
    return rule;
  }

  async listRecalls(scope: RepositoryScope, filter: RecallSearchFilter = {}): Promise<RecallRecord[]> {
    return this.recalls
      .filter((recall) => matchesScope(recall, scope))
      .filter((recall) => {
        if (filter.status && recall.status !== filter.status) return false;
        if (filter.patientId && recall.patientId !== filter.patientId) return false;
        if (filter.dueBefore && recall.dueAt > filter.dueBefore) return false;
        return true;
      })
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
      .slice(0, filter.limit ?? 100);
  }

  async recordRecallAction(
    scope: RepositoryScope,
    recallId: UUID,
    input: RecordRecallActionInput
  ): Promise<RecallRecord | null> {
    const recall = this.recalls.find((candidate) => matchesScope(candidate, scope) && candidate.id === recallId);
    if (!recall) return null;
    const statusByAction = {
      manual_contact_requested: "contact_requested",
      manual_contacted: "contacted",
      appointment_booked: "booked",
      completed: "completed",
      skipped: "skipped",
      cancelled: "cancelled"
    } as const;
    const evidence = {
      actionType: input.actionType,
      method: input.method ?? null,
      notes: input.notes ?? null,
      providerConfirmationReceived: false,
      ...(input.evidence ?? {})
    };
    Object.assign(recall, {
      status: statusByAction[input.actionType],
      appointmentId: input.appointmentId ?? recall.appointmentId,
      actionEvidence: evidence,
      lastActionAt: this.#nowIso(),
      updatedByUserId: scope.actorUserId,
      updatedAt: this.#nowIso()
    });
    if (recall.taskId && ["booked", "completed", "skipped"].includes(recall.status)) {
      const linkedTask = await this.findTaskById(scope, recall.taskId);
      if (linkedTask && linkedTask.status !== "done") {
        await this.updateTask(scope, recall.taskId, {
          status: "done",
          completionEvidence: evidence
        });
      }
    }
    this.timelineItems.push(
      this.#timeline(
        scope,
        recall.patientId,
        "recall_action_recorded",
        "recalls",
        recall.id,
        "Recall action recorded",
        { status: recall.status, actionType: input.actionType }
      )
    );
    return recall;
  }

  async generateDueContinuityTasks(
    scope: RepositoryScope,
    input: GenerateDueContinuityInput
  ): Promise<GenerateDueContinuityResult> {
    const asOfMs = new Date(input.asOf).getTime();
    const recallTasksCreated: TaskRecord[] = [];
    const followUpTasksCreated: TaskRecord[] = [];
    const recallsCreated: RecallRecord[] = [];
    const skippedExistingKeys: string[] = [];
    const rules = this.recallRules.filter((rule) => matchesScope(rule, scope) && rule.status === "active");

    for (const rule of rules) {
      if (rule.anchor !== "procedure_completed") continue;
      for (const procedure of this.proceduresPerformed.filter(
        (candidate) => matchesScope(candidate, scope) && candidate.status === "completed"
      )) {
        const pricebookProcedure = this.pricebookProcedures.find(
          (candidate) => candidate.id === procedure.pricebookProcedureId
        );
        if (rule.pricebookProcedureId && rule.pricebookProcedureId !== procedure.pricebookProcedureId)
          continue;
        if (rule.procedureCategory && rule.procedureCategory !== pricebookProcedure?.category) continue;
        const dueAt = addDaysIso(procedure.performedAt, rule.offsetDays);
        if (new Date(dueAt).getTime() > asOfMs) continue;
        const key = buildRecallGenerationKey({
          recallRuleId: rule.id,
          sourceProcedurePerformedId: procedure.id,
          patientId: procedure.patientId,
          dueAt
        });
        const existingRecall = this.recalls.find(
          (recall) =>
            matchesScope(recall, scope) &&
            recall.recallRuleId === rule.id &&
            recall.sourceProcedurePerformedId === procedure.id
        );
        if (existingRecall || this.tasks.some((task) => matchesScope(task, scope) && task.idempotencyKey === key)) {
          skippedExistingKeys.push(key);
          continue;
        }
        const now = this.#nowIso();
        const recall: RecallRecord = {
          id: uuid(),
          tenantId: scope.tenantId,
          clinicId: scope.clinicId,
          recallRuleId: rule.id,
          patientId: procedure.patientId,
          sourceProcedurePerformedId: procedure.id,
          sourceInvoiceId: null,
          taskId: null,
          appointmentId: null,
          status: "due",
          dueAt,
          lastActionAt: null,
          actionEvidence: {},
          createdByUserId: scope.actorUserId,
          updatedByUserId: scope.actorUserId,
          createdAt: now,
          updatedAt: now
        };
        this.recalls.push(recall);
        recallsCreated.push(recall);
        const task = this.insertTask(scope, {
          patientId: procedure.patientId,
          encounterId: procedure.encounterId,
          treatmentPlanId: procedure.treatmentPlanId,
          procedurePerformedId: procedure.id,
          taskType: "recall",
          sourceWorkflow: "recall_generation",
          sourceRecordType: "recall",
          sourceRecordId: recall.id,
          title: rule.defaultTaskTitle,
          description: `Recall generated from ${rule.title}.`,
          priority: rule.defaultTaskPriority,
          dueAt,
          idempotencyKey: key
        });
        recall.taskId = task.id;
        recall.updatedAt = this.#nowIso();
        recallTasksCreated.push(task);
        this.timelineItems.push(
          this.#timeline(scope, recall.patientId, "recall_due", "recalls", recall.id, "Recall due", {
            recallRuleId: rule.id,
            taskId: task.id
          })
        );
      }
    }

    for (const rule of rules.filter((candidate) => candidate.anchor === "checkout_completed")) {
      for (const invoice of this.invoices.filter(
        (candidate) => matchesScope(candidate, scope) && candidate.status === "issued"
      )) {
        const dueAt = addDaysIso(invoice.issuedAt, rule.offsetDays);
        if (new Date(dueAt).getTime() > asOfMs) continue;
        const key = buildRecallGenerationKey({
          recallRuleId: rule.id,
          sourceInvoiceId: invoice.id,
          patientId: invoice.patientId,
          dueAt
        });
        const existingRecall = this.recalls.find(
          (recall) =>
            matchesScope(recall, scope) &&
            recall.recallRuleId === rule.id &&
            recall.sourceInvoiceId === invoice.id
        );
        if (
          existingRecall ||
          this.tasks.some((task) => matchesScope(task, scope) && task.idempotencyKey === key)
        ) {
          skippedExistingKeys.push(key);
          continue;
        }
        const now = this.#nowIso();
        const recall: RecallRecord = {
          id: uuid(),
          tenantId: scope.tenantId,
          clinicId: scope.clinicId,
          recallRuleId: rule.id,
          patientId: invoice.patientId,
          sourceProcedurePerformedId: null,
          sourceInvoiceId: invoice.id,
          taskId: null,
          appointmentId: null,
          status: "due",
          dueAt,
          lastActionAt: null,
          actionEvidence: {},
          createdByUserId: scope.actorUserId,
          updatedByUserId: scope.actorUserId,
          createdAt: now,
          updatedAt: now
        };
        this.recalls.push(recall);
        recallsCreated.push(recall);
        const task = this.insertTask(scope, {
          patientId: invoice.patientId,
          invoiceId: invoice.id,
          treatmentPlanId: invoice.treatmentPlanId,
          taskType: "recall",
          sourceWorkflow: "recall_generation",
          sourceRecordType: "recall",
          sourceRecordId: recall.id,
          title: rule.defaultTaskTitle,
          description: `Recall generated from ${rule.title}.`,
          priority: rule.defaultTaskPriority,
          dueAt,
          idempotencyKey: key
        });
        recall.taskId = task.id;
        recall.updatedAt = this.#nowIso();
        recallTasksCreated.push(task);
        this.timelineItems.push(
          this.#timeline(
            scope,
            recall.patientId,
            "recall_due",
            "recalls",
            recall.id,
            "Recall due",
            { recallRuleId: rule.id, taskId: task.id }
          )
        );
      }
    }

    for (const procedure of this.proceduresPerformed.filter(
      (candidate) => matchesScope(candidate, scope) && candidate.status === "completed"
    )) {
      const dueAt = addDaysIso(procedure.performedAt, 1);
      if (new Date(dueAt).getTime() > asOfMs) continue;
      const key = buildPostOpFollowUpKey(procedure.id);
      if (this.tasks.some((task) => matchesScope(task, scope) && task.idempotencyKey === key)) {
        skippedExistingKeys.push(key);
        continue;
      }
      followUpTasksCreated.push(
        this.insertTask(scope, {
          patientId: procedure.patientId,
          encounterId: procedure.encounterId,
          treatmentPlanId: procedure.treatmentPlanId,
          procedurePerformedId: procedure.id,
          taskType: "post_op_follow_up",
          sourceWorkflow: "post_op_follow_up",
          sourceRecordType: "procedure_performed_record",
          sourceRecordId: procedure.id,
          title: "Post-op follow-up",
          description: "Manual patient follow-up after completed procedure. Record contact evidence after staff action.",
          priority: "normal",
          dueAt,
          idempotencyKey: key
        })
      );
    }

    for (const invoice of this.invoices.filter(
      (candidate) =>
        matchesScope(candidate, scope) &&
        candidate.status === "issued" &&
        candidate.balanceMinor > 0 &&
        candidate.dueAt !== null &&
        candidate.dueAt <= input.asOf &&
        ["unpaid", "payment_requested", "partially_paid", "reconciliation_required"].includes(candidate.paymentStatus)
    )) {
      const key = buildPaymentFollowUpKey(invoice.id);
      if (this.tasks.some((task) => matchesScope(task, scope) && task.idempotencyKey === key)) {
        skippedExistingKeys.push(key);
        continue;
      }
      followUpTasksCreated.push(
        this.insertTask(scope, {
          patientId: invoice.patientId,
          invoiceId: invoice.id,
          treatmentPlanId: invoice.treatmentPlanId,
          taskType: "payment_follow_up",
          sourceWorkflow: "payment_follow_up",
          sourceRecordType: "invoice",
          sourceRecordId: invoice.id,
          title: "Payment follow-up",
          description: "Manual follow-up for invoice balance due. Payment state changes require verified provider or manual payment evidence.",
          priority: "high",
          dueAt: invoice.dueAt,
          idempotencyKey: key
        })
      );
    }

    return {
      recallTasksCreated,
      followUpTasksCreated,
      recallsCreated,
      skippedExistingKeys,
      processedCount:
        recallTasksCreated.length + followUpTasksCreated.length + skippedExistingKeys.length,
      complete: true,
      nextCursor: null
    };
  }

  async createSopTemplate(scope: RepositoryScope, input: CreateSopTemplateInput): Promise<SopTemplateDetail> {
    const now = this.#nowIso();
    const template: SopTemplateRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      code: input.code,
      title: input.title,
      description: input.description ?? null,
      status: "active",
      createdByUserId: scope.actorUserId,
      updatedByUserId: scope.actorUserId,
      createdAt: now,
      updatedAt: now
    };
    this.sopTemplates.push(template);
    const items = input.items.map((item, index): SopTemplateItemRecord => {
      const record = {
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        templateId: template.id,
        itemIndex: index + 1,
        title: item.title,
        instructions: item.instructions ?? null,
        evidenceRequired: item.evidenceRequired ?? false,
        createdAt: now,
        updatedAt: now
      };
      this.sopTemplateItems.push(record);
      return record;
    });
    return { template, items };
  }

  async createSopSchedule(
    scope: RepositoryScope,
    input: CreateSopScheduleInput
  ): Promise<SopScheduleRecord | null> {
    const template = this.sopTemplates.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === input.templateId && candidate.status === "active"
    );
    if (!template) return null;
    const now = this.#nowIso();
    const schedule: SopScheduleRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      templateId: template.id,
      title: input.title,
      status: "active",
      recurrenceType: input.recurrenceType,
      intervalDays: input.intervalDays ?? null,
      dayOfWeek: input.dayOfWeek ?? null,
      dayOfMonth: input.dayOfMonth ?? null,
      dueTime: input.dueTime,
      timezone: input.timezone ?? "Asia/Kolkata",
      startsOn: input.startsOn,
      endsOn: input.endsOn ?? null,
      assignedToUserId: input.assignedToUserId ?? null,
      defaultTaskPriority: input.defaultTaskPriority ?? "normal",
      createdByUserId: scope.actorUserId,
      updatedByUserId: scope.actorUserId,
      createdAt: now,
      updatedAt: now
    };
    this.sopSchedules.push(schedule);
    return schedule;
  }

  async generateDueSopRuns(
    scope: RepositoryScope,
    input: GenerateDueSopRunsInput
  ): Promise<GenerateDueSopRunsResult> {
    const runsCreated: SopRunDetail[] = [];
    const skippedExistingKeys: string[] = [];
    const asOf = new Date(input.asOf);

    for (const schedule of this.sopSchedules.filter(
      (candidate) => matchesScope(candidate, scope) && candidate.status === "active"
    )) {
      const dueAt = sopDueAtForAsOf(schedule, asOf);
      if (!dueAt || new Date(dueAt).getTime() > asOf.getTime()) continue;
      const key = buildSopRunGenerationKey(schedule.id, dueAt);
      if (this.sopRuns.some((run) => matchesScope(run, scope) && run.generatedFromKey === key)) {
        skippedExistingKeys.push(key);
        continue;
      }
      const now = this.#nowIso();
      const run: SopRunRecord = {
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        rowVersion: 1,
        templateId: schedule.templateId,
        scheduleId: schedule.id,
        taskId: null,
        dueAt,
        status: "due",
        assignedToUserId: schedule.assignedToUserId,
        startedByUserId: null,
        startedAt: null,
        completedByUserId: null,
        completedAt: null,
        completionEvidence: {},
        generatedFromKey: key,
        createdAt: now,
        updatedAt: now
      };
      this.sopRuns.push(run);
      const templateItems = this.sopTemplateItems
        .filter((item) => matchesScope(item, scope) && item.templateId === schedule.templateId)
        .sort((left, right) => left.itemIndex - right.itemIndex);
      for (const item of templateItems) {
        this.sopRunItems.push({
          id: uuid(),
          tenantId: scope.tenantId,
          clinicId: scope.clinicId,
          sopRunId: run.id,
          templateItemId: item.id,
          itemIndex: item.itemIndex,
          title: item.title,
          instructions: item.instructions,
          evidenceRequired: item.evidenceRequired,
          status: "pending",
          evidence: {},
          completedByUserId: null,
          completedAt: null,
          createdAt: now,
          updatedAt: now
        });
      }
      const task = this.insertTask(scope, {
        taskType: "sop",
        sourceWorkflow: "sop_run",
        sourceRecordType: "sop_run",
        sourceRecordId: run.id,
        title: schedule.title,
        description: "Recurring SOP checklist run.",
        priority: schedule.defaultTaskPriority,
        dueAt,
        assignedToUserId: schedule.assignedToUserId,
        idempotencyKey: key
      });
      run.taskId = task.id;
      const detail = this.sopRunDetail(scope, run.id);
      if (detail) runsCreated.push(detail);
    }

    return {
      runsCreated,
      skippedExistingKeys,
      processedCount: runsCreated.length + skippedExistingKeys.length,
      complete: true,
      nextCursor: null
    };
  }

  async listSopRuns(scope: RepositoryScope, filter: SopRunSearchFilter = {}): Promise<SopRunDetail[]> {
    return this.sopRuns
      .filter((run) => matchesScope(run, scope))
      .filter((run) => {
        if (filter.status && run.status !== filter.status) return false;
        if (filter.date && !run.dueAt.startsWith(filter.date)) return false;
        if (filter.dueBefore && run.dueAt > filter.dueBefore) return false;
        return true;
      })
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
      .slice(0, filter.limit ?? 100)
      .map((run) => this.sopRunDetail(scope, run.id))
      .filter((detail): detail is SopRunDetail => detail !== null);
  }

  async updateSopRun(
    scope: RepositoryScope,
    sopRunId: UUID,
    input: UpdateSopRunInput
  ): Promise<SopRunDetail | null> {
    const run = this.sopRuns.find((candidate) => matchesScope(candidate, scope) && candidate.id === sopRunId);
    if (!run) return null;
    for (const itemInput of input.items ?? []) {
      const item = this.sopRunItems.find(
        (candidate) => matchesScope(candidate, scope) && candidate.id === itemInput.itemId && candidate.sopRunId === run.id
      );
      if (!item) continue;
      Object.assign(item, {
        status: itemInput.status,
        evidence: itemInput.evidence ?? item.evidence,
        completedByUserId: itemInput.status === "done" ? scope.actorUserId : null,
        completedAt: itemInput.status === "done" ? this.#nowIso() : null,
        updatedAt: this.#nowIso()
      });
    }
    Object.assign(run, {
      status: input.status ?? run.status,
      startedByUserId:
        input.status === "in_progress" && !run.startedByUserId ? scope.actorUserId : run.startedByUserId,
      startedAt: input.status === "in_progress" && !run.startedAt ? this.#nowIso() : run.startedAt,
      completedByUserId: input.status === "completed" ? scope.actorUserId : null,
      completedAt: input.status === "completed" ? this.#nowIso() : null,
      completionEvidence: input.completionEvidence ?? run.completionEvidence,
      updatedAt: this.#nowIso()
    });
    const detail = this.sopRunDetail(scope, run.id);
    if (detail) assertSopRunCompletion(detail);
    advanceFixtureRowVersion(run);
    if (run.status === "completed" && run.taskId) {
      await this.updateTask(scope, run.taskId, {
        status: "done",
        completionEvidence: run.completionEvidence
      });
    }
    return detail;
  }

  private insertTask(scope: RepositoryScope, input: CreateTaskInput): TaskRecord {
    if (input.idempotencyKey) {
      const existing = this.tasks.find(
        (task) => matchesScope(task, scope) && task.idempotencyKey === input.idempotencyKey
      );
      if (existing) return existing;
    }
    const now = this.#nowIso();
    const task: TaskRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      rowVersion: 1,
      patientId: input.patientId ?? null,
      leadId: input.leadId ?? null,
      appointmentId: input.appointmentId ?? null,
      invoiceId: input.invoiceId ?? null,
      encounterId: input.encounterId ?? null,
      treatmentPlanId: input.treatmentPlanId ?? null,
      procedurePerformedId: input.procedurePerformedId ?? null,
      taskType: input.taskType,
      sourceWorkflow: input.sourceWorkflow ?? "manual",
      sourceRecordType: input.sourceRecordType ?? null,
      sourceRecordId: input.sourceRecordId ?? null,
      title: input.title,
      description: input.description ?? null,
      priority: input.priority ?? "normal",
      status: input.status ?? "open",
      dueAt: input.dueAt ?? null,
      assignedToUserId: input.assignedToUserId ?? null,
      assignedByUserId: input.assignedToUserId ? scope.actorUserId : null,
      completedByUserId: null,
      completedAt: null,
      completionEvidence: {},
      cancelledReason: null,
      idempotencyKey: input.idempotencyKey ?? null,
      createdByUserId: scope.actorUserId,
      updatedByUserId: scope.actorUserId,
      statusChangedAt: now,
      createdAt: now,
      updatedAt: now
    };

    this.tasks.push(task);
    if (task.patientId) {
      this.timelineItems.push(
        this.#timeline(scope, task.patientId, "task_created", "tasks", task.id, "Task created", {
          taskType: task.taskType,
          sourceWorkflow: task.sourceWorkflow
        })
      );
    }
    return task;
  }

  private sopRunDetail(scope: RepositoryScope, sopRunId: UUID): SopRunDetail | null {
    const run = this.sopRuns.find((candidate) => matchesScope(candidate, scope) && candidate.id === sopRunId);
    if (!run) return null;
    return {
      run,
      items: this.sopRunItems
        .filter((item) => matchesScope(item, scope) && item.sopRunId === run.id)
        .sort((left, right) => left.itemIndex - right.itemIndex)
    };
  }

  async listLabVendors(scope: RepositoryScope): Promise<LabVendorRecord[]> {
    return this.labVendors
      .filter((vendor) => matchesScope(vendor, scope) && vendor.status === "active")
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async findLabVendorById(scope: RepositoryScope, vendorId: UUID): Promise<LabVendorRecord | null> {
    return this.labVendors.find((vendor) => matchesScope(vendor, scope) && vendor.id === vendorId) ?? null;
  }

  async createLabVendor(scope: RepositoryScope, input: CreateLabVendorInput): Promise<LabVendorRecord> {
    const now = this.#nowIso();
    const vendor: LabVendorRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      displayName: input.displayName,
      phone: input.phone ?? null,
      email: input.email ?? null,
      address: input.address ?? {},
      taxRegistrationNumber: input.taxRegistrationNumber ?? null,
      paymentTermsDays: input.paymentTermsDays ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now
    };

    this.labVendors.push(vendor);
    return vendor;
  }

  async listLabCases(scope: RepositoryScope, filter: LabCaseSearchFilter = {}): Promise<LabCaseDetail[]> {
    return this.labCases
      .filter((labCase) => matchesScope(labCase, scope))
      .filter((labCase) => {
        if (filter.status && labCase.status !== filter.status) return false;
        if (filter.dueBefore && labCase.dueAt > filter.dueBefore) return false;
        if (filter.vendorId && labCase.vendorId !== filter.vendorId) return false;
        if (filter.patientId && labCase.patientId !== filter.patientId) return false;
        return true;
      })
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt))
      .map((labCase) => this.labCaseDetail(scope, labCase.id))
      .filter((detail): detail is LabCaseDetail => detail !== null);
  }

  async findLabCaseById(scope: RepositoryScope, labCaseId: UUID): Promise<LabCaseDetail | null> {
    return this.labCaseDetail(scope, labCaseId);
  }

  async createLabCase(scope: RepositoryScope, input: CreateLabCaseInput): Promise<LabCaseDetail | null> {
    const [vendor, patient] = await Promise.all([
      this.findLabVendorById(scope, input.vendorId),
      this.findPatientById(scope, input.patientId)
    ]);
    if (!vendor || !patient) return null;

    if (input.encounterId && !(await this.findEncounterById(scope, input.encounterId))) return null;
    if (
      input.treatmentPlanId &&
      !this.treatmentPlans.some((plan) => matchesScope(plan, scope) && plan.id === input.treatmentPlanId)
    ) {
      return null;
    }
    if (
      input.procedurePerformedId &&
      !this.proceduresPerformed.some(
        (procedure) => matchesScope(procedure, scope) && procedure.id === input.procedurePerformedId
      )
    ) {
      return null;
    }

    const now = this.#nowIso();
    const labCase: LabCaseRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      rowVersion: 1,
      vendorId: input.vendorId,
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      treatmentPlanId: input.treatmentPlanId ?? null,
      treatmentPlanEstimateItemId: input.treatmentPlanEstimateItemId ?? null,
      procedurePerformedId: input.procedurePerformedId ?? null,
      title: input.title,
      status: "draft",
      priority: input.priority ?? "routine",
      dueAt: input.dueAt,
      clinicalNotes: input.clinicalNotes ?? null,
      internalNotes: input.internalNotes ?? null,
      slipNumber: this.nextLabSlipNumber(scope),
      slipVersion: 1,
      slipGeneratedAt: now,
      slipGeneratedByUserId: scope.actorUserId,
      slipMetadata: input.slipMetadata ?? {},
      expectedCostMinor: input.expectedCostMinor ?? null,
      currency: "INR",
      sentAt: null,
      receivedAt: null,
      completedAt: null,
      cancelledAt: null,
      cancellationReason: null,
      createdByUserId: scope.actorUserId,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now
    };
    this.labCases.push(labCase);

    for (const item of input.items) {
      this.labCaseItems.push({
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        labCaseId: labCase.id,
        itemType: item.itemType,
        toothNumber: item.toothNumber ? normalizeDentalToothNumber(item.toothNumber) : null,
        material: item.material ?? null,
        shade: item.shade ?? null,
        quantity: item.quantity ?? 1,
        notes: item.notes ?? null,
        createdAt: now
      });
    }

    this.labCaseStatusHistory.push(
      this.labCaseHistory(scope, labCase, null, "draft", "Lab case created", {
        slipNumber: labCase.slipNumber
      })
    );
    this.timelineItems.push(
      this.#timeline(scope, labCase.patientId, "lab_case_created", "lab_cases", labCase.id, "Lab case created")
    );

    return this.labCaseDetail(scope, labCase.id);
  }

  async updateLabCaseStatus(
    scope: RepositoryScope,
    labCaseId: UUID,
    input: UpdateLabCaseStatusInput
  ): Promise<LabCaseDetail | null> {
    const labCase = this.labCases.find((candidate) => matchesScope(candidate, scope) && candidate.id === labCaseId);
    if (!labCase) return null;

    assertLabCaseTransition(labCase.status, input.status);
    const fromStatus = labCase.status;
    const now = this.#nowIso();
    advanceFixtureRowVersion(labCase);
    labCase.status = input.status;
    labCase.updatedAt = now;
    labCase.updatedByUserId = scope.actorUserId;
    if (input.status === "sent_to_lab") labCase.sentAt = labCase.sentAt ?? now;
    if (input.status === "received_by_lab") labCase.receivedAt = labCase.receivedAt ?? now;
    if (input.status === "returned") labCase.receivedAt = labCase.receivedAt ?? now;
    if (input.status === "completed") labCase.completedAt = labCase.completedAt ?? now;
    if (input.status === "cancelled") {
      labCase.cancelledAt = labCase.cancelledAt ?? now;
      labCase.cancellationReason = input.reason ?? "cancelled";
    }

    this.labCaseStatusHistory.push(
      this.labCaseHistory(scope, labCase, fromStatus, input.status, input.reason ?? null, input.evidence ?? {})
    );

    const timelineType =
      input.status === "sent_to_lab"
        ? "lab_case_sent"
        : input.status === "returned"
          ? "lab_case_returned"
          : input.status === "completed"
            ? "lab_case_completed"
            : null;
    if (timelineType) {
      this.timelineItems.push(
        this.#timeline(scope, labCase.patientId, timelineType, "lab_cases", labCase.id, `Lab case ${input.status.replace(/_/g, " ")}`)
      );
    }

    return this.labCaseDetail(scope, labCase.id);
  }

  async createLabReconciliation(
    scope: RepositoryScope,
    input: CreateLabReconciliationInput
  ): Promise<LabReconciliationDetail | null> {
    const vendor = await this.findLabVendorById(scope, input.vendorId);
    if (!vendor) return null;

    const now = this.#nowIso();
    const entries: LabReconciliationEntryRecord[] = [];
    for (const entryInput of input.entries) {
      const detail = await this.findLabCaseById(scope, entryInput.labCaseId);
      if (!detail || detail.labCase.vendorId !== input.vendorId) return null;
      const expectedAmountMinor = detail.labCase.expectedCostMinor ?? 0;
      const invoiceAmountMinor = entryInput.invoiceAmountMinor ?? null;
      const varianceAmountMinor = (invoiceAmountMinor ?? expectedAmountMinor) - expectedAmountMinor;
      entries.push({
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        reconciliationId: "00000000-0000-4000-8000-000000000000" as UUID,
        labCaseId: detail.labCase.id,
        patientId: detail.labCase.patientId,
        status:
          entryInput.status ??
          (invoiceAmountMinor === null
            ? "missing_invoice"
            : varianceAmountMinor === 0
              ? "matched"
              : "amount_variance"),
        expectedAmountMinor,
        invoiceAmountMinor,
        varianceAmountMinor,
        notes: entryInput.notes ?? null,
        createdAt: now
      });
    }

    const expectedAmountMinor = entries.reduce((sum, entry) => sum + entry.expectedAmountMinor, 0);
    const invoiceAmountMinor = input.invoiceAmountMinor ?? null;
    const varianceAmountMinor = (invoiceAmountMinor ?? expectedAmountMinor) - expectedAmountMinor;
    const reconciliation: LabReconciliationRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      vendorId: input.vendorId,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      status: input.status ?? (varianceAmountMinor === 0 ? "matched" : "variance_review"),
      invoiceReference: input.invoiceReference ?? null,
      invoiceAmountMinor,
      expectedAmountMinor,
      varianceAmountMinor,
      currency: "INR",
      evidence: input.evidence ?? {},
      createdByUserId: scope.actorUserId,
      approvedByUserId: null,
      approvedAt: null,
      createdAt: now,
      updatedAt: now
    };

    for (const entry of entries) entry.reconciliationId = reconciliation.id;
    this.labReconciliations.push(reconciliation);
    this.labReconciliationEntries.push(...entries);

    return { reconciliation, entries };
  }

  async listInventoryCategories(scope: RepositoryScope): Promise<InventoryCategoryRecord[]> {
    return this.inventoryCategories
      .filter((category) => matchesScope(category, scope))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async createInventoryCategory(
    scope: RepositoryScope,
    input: CreateInventoryCategoryInput
  ): Promise<InventoryCategoryRecord> {
    const now = this.#nowIso();
    const category: InventoryCategoryRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      code: input.code,
      displayName: input.displayName,
      kind: input.kind,
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now
    };
    this.inventoryCategories.push(category);
    return category;
  }

  async listInventoryItems(scope: RepositoryScope): Promise<InventoryItemRecord[]> {
    return this.inventoryItems
      .filter((item) => matchesScope(item, scope))
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async findInventoryItemById(scope: RepositoryScope, itemId: UUID): Promise<InventoryItemRecord | null> {
    return this.inventoryItems.find((item) => matchesScope(item, scope) && item.id === itemId) ?? null;
  }

  async createInventoryItem(
    scope: RepositoryScope,
    input: CreateInventoryItemInput
  ): Promise<InventoryItemRecord | null> {
    const category = this.inventoryCategories.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === input.categoryId && candidate.active
    );
    if (!category) return null;

    const openingQuantity = input.openingQuantity ?? 0;
    assertFiniteQuantity(openingQuantity, "openingQuantity");
    const now = this.#nowIso();
    const item: InventoryItemRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      categoryId: input.categoryId,
      sku: input.sku,
      displayName: input.displayName,
      unitOfMeasure: input.unitOfMeasure,
      storageLocation: input.storageLocation,
      trackQuantity: input.trackQuantity ?? true,
      minimumQuantity: input.minimumQuantity ?? 0,
      reorderQuantity: input.reorderQuantity ?? 0,
      currentQuantity: openingQuantity,
      status: "active",
      createdAt: now,
      updatedAt: now
    };
    this.inventoryItems.push(item);
    if (openingQuantity > 0) {
      this.stockLedgerEntries.push({
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        itemId: item.id,
        movementType: "opening_balance",
        quantityDelta: openingQuantity,
        quantityAfter: openingQuantity,
        unitCostMinor: null,
        currency: null,
        sourceTable: "inventory_items",
        sourceId: item.id,
        reason: "Opening quantity recorded",
        evidence: { source: "manual_opening_balance" },
        recordedByUserId: scope.actorUserId,
        recordedAt: now
      });
    }
    return item;
  }

  async createStockLedgerEntry(
    scope: RepositoryScope,
    input: CreateStockLedgerEntryInput
  ): Promise<StockLedgerEntryRecord | null> {
    const item = await this.findInventoryItemById(scope, input.itemId);
    if (!item) return null;
    const quantityAfter = item.currentQuantity + input.quantityDelta;
    assertFiniteQuantity(quantityAfter, "quantityAfter");
    const entry: StockLedgerEntryRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      itemId: item.id,
      movementType: input.movementType,
      quantityDelta: input.quantityDelta,
      quantityAfter,
      unitCostMinor: input.unitCostMinor ?? null,
      currency: input.currency ?? null,
      sourceTable: input.sourceTable ?? null,
      sourceId: input.sourceId ?? null,
      reason: input.reason,
      evidence: input.evidence ?? {},
      recordedByUserId: scope.actorUserId,
      recordedAt: this.#nowIso()
    };
    item.currentQuantity = quantityAfter;
    item.updatedAt = entry.recordedAt;
    this.stockLedgerEntries.push(entry);
    return entry;
  }

  async listInventoryCheckTemplates(scope: RepositoryScope): Promise<
    Array<InventoryCheckTemplateRecord & { lines: InventoryCheckTemplateLineRecord[] }>
  > {
    return this.inventoryCheckTemplates
      .filter((template) => matchesScope(template, scope) && template.active)
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
      .map((template) => ({
        ...template,
        lines: this.inventoryCheckTemplateLines
          .filter((line) => matchesScope(line, scope) && line.templateId === template.id)
          .sort((left, right) => left.sequence - right.sequence)
      }));
  }

  async createInventoryCheckTemplate(
    scope: RepositoryScope,
    input: CreateInventoryCheckTemplateInput
  ): Promise<(InventoryCheckTemplateRecord & { lines: InventoryCheckTemplateLineRecord[] }) | null> {
    for (const line of input.lines) {
      if (!(await this.findInventoryItemById(scope, line.itemId))) return null;
    }
    const now = this.#nowIso();
    const template: InventoryCheckTemplateRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      code: input.code,
      displayName: input.displayName,
      cadence: input.cadence,
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now
    };
    this.inventoryCheckTemplates.push(template);
    for (const line of input.lines) {
      this.inventoryCheckTemplateLines.push({
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        templateId: template.id,
        itemId: line.itemId,
        sequence: line.sequence,
        drawerLocation: line.drawerLocation,
        expectedQuantity: line.expectedQuantity ?? null,
        required: line.required ?? true,
        instructions: line.instructions ?? null
      });
    }
    const [created] = (await this.listInventoryCheckTemplates(scope)).filter(
      (candidate) => candidate.id === template.id
    );
    return created ?? null;
  }

  async createInventoryCheckRun(
    scope: RepositoryScope,
    input: CreateInventoryCheckRunInput
  ): Promise<InventoryCheckRunDetail | null> {
    const template = (await this.listInventoryCheckTemplates(scope)).find(
      (candidate) => candidate.id === input.templateId
    );
    if (!template) return null;

    const now = this.#nowIso();
    const run: InventoryCheckRunRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      rowVersion: 1,
      templateId: template.id,
      status: "in_progress",
      startedByUserId: scope.actorUserId,
      completedByUserId: null,
      startedAt: now,
      completedAt: null,
      notes: input.notes ?? null,
      createdAt: now,
      updatedAt: now
    };
    this.inventoryCheckRuns.push(run);

    for (const templateLine of template.lines) {
      const item = await this.findInventoryItemById(scope, templateLine.itemId);
      if (!item) return null;
      this.inventoryCheckRunLines.push({
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        checkRunId: run.id,
        templateLineId: templateLine.id,
        itemId: templateLine.itemId,
        sequence: templateLine.sequence,
        drawerLocation: templateLine.drawerLocation,
        expectedQuantity: templateLine.expectedQuantity ?? item.currentQuantity,
        countedQuantity: null,
        varianceQuantity: null,
        exceptionType: null,
        exceptionNotes: null,
        countedByUserId: null,
        countedAt: null
      });
    }

    return this.inventoryCheckRunDetail(scope, run.id);
  }

  async updateInventoryCheckRun(
    scope: RepositoryScope,
    checkRunId: UUID,
    input: UpdateInventoryCheckRunInput
  ): Promise<InventoryCheckRunDetail | null> {
    const run = this.inventoryCheckRuns.find((candidate) => matchesScope(candidate, scope) && candidate.id === checkRunId);
    if (!run) return null;
    if (run.status === "completed" || run.status === "cancelled") return null;

    const now = this.#nowIso();
    for (const lineInput of input.lines ?? []) {
      const line = this.inventoryCheckRunLines.find(
        (candidate) => matchesScope(candidate, scope) && candidate.id === lineInput.lineId && candidate.checkRunId === run.id
      );
      if (!line) return null;
      const item = await this.findInventoryItemById(scope, line.itemId);
      if (!item) return null;
      const varianceQuantity = calculateInventoryVariance({
        expectedQuantity: line.expectedQuantity,
        countedQuantity: lineInput.countedQuantity
      });
      line.countedQuantity = lineInput.countedQuantity;
      line.varianceQuantity = varianceQuantity;
      line.exceptionType = classifyInventoryException({
        expectedQuantity: line.expectedQuantity,
        countedQuantity: lineInput.countedQuantity,
        minimumQuantity: item.minimumQuantity
      });
      line.exceptionNotes = lineInput.exceptionNotes ?? null;
      line.countedByUserId = scope.actorUserId;
      line.countedAt = now;

      if (varianceQuantity !== 0) {
        await this.createStockLedgerEntry(scope, {
          itemId: item.id,
          movementType: "check_variance",
          quantityDelta: varianceQuantity,
          sourceTable: "inventory_check_run_lines",
          sourceId: line.id,
          reason: "Inventory check count variance",
          evidence: {
            checkRunId: run.id,
            expectedQuantity: line.expectedQuantity,
            countedQuantity: line.countedQuantity
          }
        });
      }

      if (line.exceptionType === "low_stock" || line.exceptionType === "missing_item") {
        this.ensureProcurementSuggestion(scope, item, line, run.id);
      }
    }

    if (input.status === "completed") {
      const uncountedRequiredLine = this.inventoryCheckRunLines.find(
        (line) => matchesScope(line, scope) && line.checkRunId === run.id && line.countedQuantity === null
      );
      if (uncountedRequiredLine) return null;
    }
    advanceFixtureRowVersion(run);
    run.status = input.status;
    run.notes = input.notes ?? run.notes;
    run.updatedAt = now;
    if (input.status === "completed") {
      run.completedByUserId = scope.actorUserId;
      run.completedAt = now;
    }
    return this.inventoryCheckRunDetail(scope, run.id);
  }

  async listInventoryExceptions(
    scope: RepositoryScope,
    filter: InventoryExceptionFilter = {}
  ): Promise<InventoryExceptionRecord[]> {
    const exceptions: InventoryExceptionRecord[] = [];
    for (const line of this.inventoryCheckRunLines) {
      if (!matchesScope(line, scope) || !line.exceptionType) continue;
      if (filter.itemId && line.itemId !== filter.itemId) continue;
      if (filter.checkRunId && line.checkRunId !== filter.checkRunId) continue;
      const item = await this.findInventoryItemById(scope, line.itemId);
      if (!item) continue;
      const suggestion =
        this.procurementSuggestions.find(
          (candidate) =>
            matchesScope(candidate, scope) &&
            candidate.sourceCheckRunLineId === line.id &&
            candidate.status === "suggested"
        ) ?? null;
      exceptions.push({
        item,
        checkRunLine: line,
        procurementSuggestion: suggestion,
        exceptionType: line.exceptionType,
        quantityAvailable: line.countedQuantity ?? item.currentQuantity,
        thresholdQuantity: item.minimumQuantity,
        suggestedTask: {
          taskType: "procurement",
          title: `Review procurement for ${item.displayName}`,
          status: "suggested_not_created"
        }
      });
    }

    for (const item of this.inventoryItems) {
      if (!matchesScope(item, scope) || item.currentQuantity >= item.minimumQuantity) continue;
      if (filter.itemId && item.id !== filter.itemId) continue;
      if (exceptions.some((exception) => exception.item.id === item.id)) continue;
      const suggestion =
        this.procurementSuggestions.find(
          (candidate) => matchesScope(candidate, scope) && candidate.itemId === item.id && candidate.status === "suggested"
        ) ?? null;
      exceptions.push({
        item,
        checkRunLine: null,
        procurementSuggestion: suggestion,
        exceptionType: "low_stock",
        quantityAvailable: item.currentQuantity,
        thresholdQuantity: item.minimumQuantity,
        suggestedTask: {
          taskType: "procurement",
          title: `Review procurement for ${item.displayName}`,
          status: "suggested_not_created"
        }
      });
    }
    return exceptions;
  }

  async listIncidents(scope: RepositoryScope, filter: IncidentSearchFilter = {}): Promise<IncidentRecord[]> {
    return this.incidents
      .filter((incident) => matchesScope(incident, scope))
      .filter((incident) => {
        if (filter.status && incident.status !== filter.status) return false;
        if (filter.severity && incident.severity !== filter.severity) return false;
        if (filter.category && incident.category !== filter.category) return false;
        return true;
      })
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  }

  async createIncident(scope: RepositoryScope, input: CreateIncidentInput): Promise<IncidentRecord | null> {
    if (input.patientId && !(await this.findPatientById(scope, input.patientId))) return null;
    if (input.appointmentId && !(await this.findAppointmentById(scope, input.appointmentId))) return null;
    if (input.labCaseId && !(await this.findLabCaseById(scope, input.labCaseId))) return null;
    if (input.inventoryItemId && !(await this.findInventoryItemById(scope, input.inventoryItemId))) return null;

    const now = this.#nowIso();
    const incident: IncidentRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: input.patientId ?? null,
      appointmentId: input.appointmentId ?? null,
      labCaseId: input.labCaseId ?? null,
      inventoryItemId: input.inventoryItemId ?? null,
      category: input.category,
      severity: input.severity,
      status: "open",
      occurredAt: input.occurredAt,
      location: input.location ?? null,
      summary: input.summary,
      description: input.description,
      impact: input.impact ?? null,
      learning: input.learning ?? null,
      immediateAction: input.immediateAction ?? null,
      evidence: input.evidence ?? {},
      reportedByUserId: scope.actorUserId,
      ownerUserId: input.ownerUserId ?? null,
      resolvedAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now
    };
    this.incidents.push(incident);
    if (incident.patientId) {
      this.timelineItems.push(
        this.#timeline(scope, incident.patientId, "incident_created", "incidents", incident.id, "Incident recorded")
      );
    }
    return incident;
  }

  async listCorrectiveActions(scope: RepositoryScope): Promise<CorrectiveActionRecord[]> {
    return this.correctiveActions
      .filter((action) => matchesScope(action, scope))
      .sort((left, right) => left.dueAt.localeCompare(right.dueAt));
  }

  async createCorrectiveAction(
    scope: RepositoryScope,
    input: CreateCorrectiveActionInput
  ): Promise<CorrectiveActionRecord | null> {
    const incident = input.incidentId
      ? this.incidents.find((candidate) => matchesScope(candidate, scope) && candidate.id === input.incidentId)
      : null;
    if (input.incidentId && !incident) return null;

    const now = this.#nowIso();
    const action: CorrectiveActionRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      rowVersion: 1,
      incidentId: input.incidentId ?? null,
      actionType: input.actionType,
      title: input.title,
      description: input.description,
      status: "open",
      ownerUserId: input.ownerUserId,
      dueAt: input.dueAt,
      completedAt: null,
      completedByUserId: null,
      completionEvidence: {},
      verificationEvidence: input.verificationEvidence ?? {},
      createdByUserId: scope.actorUserId,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now
    };
    this.correctiveActions.push(action);
    if (incident) {
      incident.status = "capa_assigned";
      incident.updatedAt = now;
      if (incident.patientId) {
        this.timelineItems.push(
          this.#timeline(
            scope,
            incident.patientId,
            "corrective_action_created",
            "corrective_actions",
            action.id,
            "Corrective action assigned"
          )
        );
      }
    }
    return action;
  }

  async updateCorrectiveAction(
    scope: RepositoryScope,
    correctiveActionId: UUID,
    input: UpdateCorrectiveActionInput
  ): Promise<CorrectiveActionRecord | null> {
    const action = this.correctiveActions.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === correctiveActionId
    );
    if (!action || action.status === "completed" || action.status === "cancelled") return null;

    const now = this.#nowIso();
    advanceFixtureRowVersion(action);
    action.status = input.status;
    action.updatedAt = now;
    action.updatedByUserId = scope.actorUserId;
    action.verificationEvidence = input.verificationEvidence ?? action.verificationEvidence;
    if (input.status === "completed") {
      action.completedAt = now;
      action.completedByUserId = scope.actorUserId;
      action.completionEvidence = input.completionEvidence ?? {};
    }

    if (action.incidentId) {
      const incident = this.incidents.find(
        (candidate) => matchesScope(candidate, scope) && candidate.id === action.incidentId
      );
      if (incident && input.status === "completed") {
        const openSibling = this.correctiveActions.some(
          (candidate) =>
            matchesScope(candidate, scope) &&
            candidate.incidentId === incident.id &&
            candidate.id !== action.id &&
            ["open", "in_progress", "overdue"].includes(correctiveActionEffectiveStatus(candidate))
        );
        if (!openSibling) {
          incident.status = "resolved";
          incident.resolvedAt = now;
          incident.updatedAt = now;
        }
        if (incident.patientId) {
          this.timelineItems.push(
            this.#timeline(
              scope,
              incident.patientId,
              "corrective_action_completed",
              "corrective_actions",
              action.id,
              "Corrective action completed"
            )
          );
        }
      }
    }

    return action;
  }

  async createAttributionTouch(
    scope: RepositoryScope,
    input: CreateAttributionTouchInput
  ): Promise<AttributionTouchRecord> {
    const touch: AttributionTouchRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: input.patientId ?? null,
      leadId: input.leadId ?? null,
      appointmentId: input.appointmentId ?? null,
      invoiceId: input.invoiceId ?? null,
      source: input.source,
      medium: input.medium ?? null,
      campaign: input.campaign ?? null,
      externalRef: input.externalRef ?? null,
      touchType: input.touchType,
      occurredAt: input.occurredAt,
      metadata: input.metadata ?? {}
    };

    this.attributionTouches.push(touch);
    if (touch.patientId) {
      this.timelineItems.push(
        this.#timeline(
          scope,
          touch.patientId,
          "attribution_touch_created",
          "attribution_touches",
          touch.id,
          "Attribution touch recorded"
        )
      );
    }
    return touch;
  }

  async appendOutboxEvent(_scope: RepositoryScope, event: OutboxEventInput): Promise<void> {
    this.outboxEvents.push(event);
  }

  async loadDashboardData(scope: RepositoryScope, date: string): Promise<DashboardDataSet> {
    const appointments = await this.listAppointments(scope, { date });
    return {
      appointments,
      leads: this.leads.filter(
        (lead) => matchesScope(lead, scope) && ["new", "contacted", "matched"].includes(lead.status)
      ),
      tasks: this.tasks.filter(
        (task) => matchesScope(task, scope) && ["open", "in_progress"].includes(task.status)
      ),
      queue: await this.listQueueEntries(scope, date),
      returningPatientIds: new Set(
        this.appointments
          .filter(
            (appointment) =>
              matchesScope(appointment, scope) && appointment.startAt < `${date}T00:00:00.000Z`
          )
        .map((appointment) => appointment.patientId)
      )
    };
  }

  async loadOwnerDashboardProjectionData(
    scope: RepositoryScope,
    _range: { startAt: string; endAt: string }
  ): Promise<OwnerDashboardProjectionData> {
    const scopedPatients = this.patients.filter((patient) => matchesScope(patient, scope));
    const scopedLeads = this.leads.filter((lead) => matchesScope(lead, scope));
    const scopedAppointments = this.appointments.filter((appointment) =>
      matchesScope(appointment, scope)
    );
    const scopedEncounters = this.encounters.filter((encounter) => matchesScope(encounter, scope));
    const scopedAttributionTouches = this.attributionTouches.filter((touch) =>
      matchesScope(touch, scope)
    );
    const scopedTreatmentPlans = this.treatmentPlans.filter((plan) => matchesScope(plan, scope));
    const scopedProcedures = this.proceduresPerformed.filter((procedure) =>
      matchesScope(procedure, scope)
    );
    const scopedInvoices = this.invoices.filter((invoice) => matchesScope(invoice, scope));
    const scopedPayments = this.paymentTransactions.filter((payment) =>
      matchesScope(payment, scope)
    );
    const scopedTasks = this.tasks.filter((task) => matchesScope(task, scope));

    return mergeOwnerDashboardProjectionData(
      {
        patients: scopedPatients.map((patient) => ({
          id: patient.id,
          source: patient.source,
          createdAt: patient.createdAt
        })),
        leads: scopedLeads.map((lead) => ({
          id: lead.id,
          patientId: lead.patientId,
          source: lead.source,
          status: lead.status,
          firstSeenAt: lead.firstSeenAt
        })),
        appointments: scopedAppointments.map((appointment) => ({
          id: appointment.id,
          patientId: appointment.patientId,
          leadId: appointment.leadId,
          status: appointment.status,
          source: appointment.source,
          startAt: appointment.startAt
        })),
        encounters: scopedEncounters.map((encounter) => ({
          id: encounter.id,
          patientId: encounter.patientId,
          appointmentId: encounter.appointmentId,
          status: encounter.status,
          createdAt: encounter.createdAt
        })),
        attributionTouches: scopedAttributionTouches.map((touch) => ({
          id: touch.id,
          patientId: touch.patientId,
          leadId: touch.leadId,
          appointmentId: touch.appointmentId,
          invoiceId: touch.invoiceId,
          source: touch.source,
          touchType: touch.touchType,
          occurredAt: touch.occurredAt
        })),
        treatmentPlans: scopedTreatmentPlans.map((plan) => ({
          id: plan.id,
          patientId: plan.patientId,
          status: plan.status,
          totalMinor: plan.totalMinor,
          presentedAt: plan.presentedAt,
          acceptedAt: plan.acceptedAt,
          createdAt: plan.createdAt
        })),
        procedures: scopedProcedures.map((procedure) => ({
          id: procedure.id,
          patientId: procedure.patientId,
          encounterId: procedure.encounterId,
          treatmentPlanId: procedure.treatmentPlanId,
          invoiceId: procedure.invoiceId,
          status: procedure.status,
          totalMinor: procedure.totalMinor,
          performedAt: procedure.performedAt
        })),
        invoices: scopedInvoices.map((invoice) => ({
          id: invoice.id,
          patientId: invoice.patientId,
          treatmentPlanId: invoice.treatmentPlanId,
          status: invoice.status,
          paymentStatus: invoice.paymentStatus,
          currency: invoice.currency,
          totalMinor: invoice.totalMinor,
          paidMinor: invoice.paidMinor,
          balanceMinor: invoice.balanceMinor,
          issuedAt: invoice.issuedAt,
          dueAt: invoice.dueAt
        })),
        payments: scopedPayments.map((payment) => ({
          id: payment.id,
          invoiceId: payment.invoiceId,
          status: payment.status,
          amountMinor: payment.amountMinor,
          receivedAt: payment.receivedAt
        })),
        recalls: scopedTasks
          .filter((task) => task.taskType === "recall" && task.dueAt)
          .map((task) => ({
            id: task.id,
            patientId: task.patientId,
            source: null,
            status: task.status === "done" ? "completed" : "due",
            dueAt: task.dueAt ?? task.createdAt,
            completedAt: task.status === "done" ? task.updatedAt : null,
            bookedAppointmentId: null
          })),
        tasks: scopedTasks.map((task) => ({
          id: task.id,
          patientId: task.patientId,
          taskType: task.taskType,
          status: task.status,
          dueAt: task.dueAt,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt
        })),
        sopRuns: [],
        labCases: [],
        inventoryExceptions: [],
        incidents: [],
        correctiveActions: [],
        dataSources: [
          {
            key: "local-runtime-domain-records",
            label: "Local fixture repository runtime domain rows",
            status: "local_fixture",
            recordCount:
              scopedPatients.length +
              scopedLeads.length +
              scopedAppointments.length +
              scopedTasks.length +
              scopedInvoices.length +
              scopedPayments.length,
            provenance: [
              "apps/api/src/local-fixture.ts",
              "packages/domain/src/dashboard.ts"
            ],
            notes:
              "Explicit local/test fixture mode only; production API uses the Postgres repository."
          }
        ]
      },
      CP6_OWNER_DASHBOARD_FIXTURE
    );
  }

  async listPricebookProcedures(scope: RepositoryScope): Promise<PricebookProcedureRecord[]> {
    return this.pricebookProcedures
      .filter((procedure) => matchesScope(procedure, scope) && procedure.status === "active")
      .sort(
        (left, right) =>
          left.category.localeCompare(right.category) ||
          left.displayName.localeCompare(right.displayName)
      );
  }

  async findPricebookProcedureById(
    scope: RepositoryScope,
    procedureId: UUID
  ): Promise<PricebookProcedureRecord | null> {
    return (
      this.pricebookProcedures.find(
        (procedure) =>
          matchesScope(procedure, scope) &&
          procedure.id === procedureId &&
          procedure.status === "active"
      ) ?? null
    );
  }

  async listIntakeFormTemplates(scope: RepositoryScope): Promise<IntakeFormTemplateRecord[]> {
    return this.intakeFormTemplates
      .filter((template) => matchesScope(template, scope) && template.active)
      .sort((left, right) => left.code.localeCompare(right.code) || right.version - left.version);
  }

  async findIntakeFormTemplateById(
    scope: RepositoryScope,
    templateId: UUID
  ): Promise<IntakeFormTemplateRecord | null> {
    return (
      this.intakeFormTemplates.find(
        (template) => matchesScope(template, scope) && template.id === templateId
      ) ?? null
    );
  }

  async createIntakeFormTemplate(
    scope: RepositoryScope,
    input: CreateIntakeFormTemplateInput
  ): Promise<IntakeFormTemplateRecord> {
    const now = this.#nowIso();
    const template: IntakeFormTemplateRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      code: input.code,
      displayName: input.displayName,
      formType: input.formType,
      version: input.version,
      schema: input.schema,
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now
    };

    this.intakeFormTemplates.push(template);
    return template;
  }

  async createIntakeFormSubmission(
    scope: RepositoryScope,
    input: CreateIntakeFormSubmissionInput
  ): Promise<IntakeFormSubmissionRecord> {
    const template = await this.findIntakeFormTemplateById(scope, input.templateId);
    if (!template) throw new Error("Intake form template not found.");
    const submittedAt = this.#nowIso();
    const submission: IntakeFormSubmissionRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: input.patientId,
      templateId: input.templateId,
      templateVersion: template.version,
      source: input.source,
      responses: input.responses,
      medicalHistorySnapshot: input.medicalHistorySnapshot ?? {},
      provenance: input.provenance ?? {},
      submittedByUserId: scope.actorUserId,
      submittedAt
    };

    this.intakeFormSubmissions.push(submission);
    this.timelineItems.push(
      this.#timeline(
        scope,
        input.patientId,
        "form_response_submitted",
        "form_responses",
        submission.id,
        input.source === "assistant_paper_card"
          ? "Assistant-entered paper intake"
          : "Digital intake submitted"
      )
    );
    return submission;
  }

  async listPatientIntakeFormSubmissions(
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<IntakeFormSubmissionRecord[]> {
    return this.intakeFormSubmissions
      .filter((submission) => matchesScope(submission, scope) && submission.patientId === patientId)
      .sort((left, right) => right.submittedAt.localeCompare(left.submittedAt));
  }

  async listPatientConsents(scope: RepositoryScope, patientId: UUID): Promise<ConsentRecord[]> {
    return this.consents
      .filter((consent) => matchesScope(consent, scope) && consent.patientId === patientId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createConsent(scope: RepositoryScope, input: CreateConsentInput): Promise<ConsentRecord> {
    const now = this.#nowIso();
    const consent: ConsentRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: input.patientId,
      purpose: input.purpose,
      status: "active",
      templateCode: input.templateCode,
      templateVersion: input.templateVersion,
      captureMethod: input.captureMethod,
      grantedByName: input.grantedByName ?? null,
      relationshipToPatient: input.relationshipToPatient ?? null,
      evidence: input.evidence ?? {},
      provenance: input.provenance ?? {},
      createdByUserId: scope.actorUserId,
      createdAt: now,
      revokedByUserId: null,
      revokedAt: null,
      revocationReason: null
    };

    this.consents.push(consent);
    this.timelineItems.push(
      this.#timeline(scope, input.patientId, "consent_created", "consents", consent.id, "Consent recorded")
    );
    return consent;
  }

  async revokeConsent(
    scope: RepositoryScope,
    consentId: UUID,
    input: RevokeConsentInput
  ): Promise<ConsentRecord | null> {
    const consent = this.consents.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === consentId
    );
    if (!consent || consent.status !== "active") return null;

    consent.status = "revoked";
    consent.revokedByUserId = scope.actorUserId;
    consent.revokedAt = this.#nowIso();
    consent.revocationReason = input.revocationReason;
    this.timelineItems.push(
      this.#timeline(scope, consent.patientId, "consent_revoked", "consents", consent.id, "Consent revoked")
    );
    return consent;
  }

  async getConsentEnforcementState(scope: RepositoryScope, patientId: UUID) {
    return buildConsentEnforcementState(patientId, await this.listPatientConsents(scope, patientId));
  }

  async createEncounter(scope: RepositoryScope, input: CreateEncounterInput): Promise<EncounterRecord> {
    const now = this.#nowIso();
    const encounter: EncounterRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      rowVersion: 1,
      patientId: input.patientId,
      appointmentId: input.appointmentId ?? null,
      providerUserId: input.providerUserId,
      status: "scheduled",
      reason: input.reason ?? null,
      medicalHistorySnapshot: input.medicalHistorySnapshot ?? {},
      startedAt: null,
      closedAt: null,
      createdAt: now,
      updatedAt: now
    };

    this.encounters.push(encounter);
    this.timelineItems.push(
      this.#timeline(scope, input.patientId, "encounter_created", "encounters", encounter.id, "Encounter created")
    );
    return encounter;
  }

  async findEncounterById(scope: RepositoryScope, encounterId: UUID): Promise<EncounterRecord | null> {
    return (
      this.encounters.find(
        (encounter) => matchesScope(encounter, scope) && encounter.id === encounterId
      ) ?? null
    );
  }

  async transitionEncounter(
    scope: RepositoryScope,
    encounterId: UUID,
    status: EncounterRecord["status"],
    _reason?: string | null
  ): Promise<EncounterRecord | null> {
    const encounter = await this.findEncounterById(scope, encounterId);
    if (!encounter) return null;

    assertEncounterTransition(encounter.status, status);
    const previous = encounter.status;
    advanceFixtureRowVersion(encounter);
    encounter.status = status;
    encounter.updatedAt = this.#nowIso();
    if (status === "drafting") encounter.startedAt = encounter.startedAt ?? encounter.updatedAt;
    if (status === "closed") encounter.closedAt = encounter.closedAt ?? encounter.updatedAt;

    if (previous === "scheduled" && status === "drafting") {
      this.timelineItems.push(
        this.#timeline(
          scope,
          encounter.patientId,
          "encounter_started",
          "encounters",
          encounter.id,
          "Encounter started"
        )
      );
    }

    return encounter;
  }

  async saveClinicalNoteDraft(
    scope: RepositoryScope,
    encounterId: UUID,
    input: SaveClinicalNoteDraftInput
  ): Promise<ClinicalNoteVersionRecord | null> {
    const encounter = await this.findEncounterById(scope, encounterId);
    if (!encounter || ["signed", "amended", "closed", "cancelled"].includes(encounter.status)) {
      return null;
    }

    const content = normalizeClinicalNoteContent(input.content);
    const existingDraft = this.clinicalNoteVersions
      .filter(
        (note) =>
          matchesScope(note, scope) && note.encounterId === encounterId && note.status === "draft"
      )
      .sort((left, right) => right.versionNumber - left.versionNumber)[0];

    if (existingDraft) {
      existingDraft.content = content;
      advanceFixtureRowVersion(encounter);
      encounter.status = input.readyForSign ? "ready_for_sign" : "drafting";
      encounter.updatedAt = this.#nowIso();
      return existingDraft;
    }

    const note: ClinicalNoteVersionRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      encounterId,
      patientId: encounter.patientId,
      versionNumber: this.nextClinicalNoteVersion(scope, encounterId),
      status: "draft",
      content,
      amendmentReason: null,
      amendedFromVersionId: null,
      signedByUserId: null,
      signedAt: null,
      createdByUserId: scope.actorUserId,
      createdAt: this.#nowIso()
    };

    this.clinicalNoteVersions.push(note);
    this.timelineItems.push(
      this.#timeline(
        scope,
        encounter.patientId,
        "clinical_note_draft_created",
        "clinical_note_versions",
        note.id,
        "Clinical note drafted"
      )
    );
    advanceFixtureRowVersion(encounter);
    encounter.status = input.readyForSign ? "ready_for_sign" : "drafting";
    encounter.updatedAt = note.createdAt;
    return note;
  }

  async listClinicalNoteVersions(
    scope: RepositoryScope,
    encounterId: UUID
  ): Promise<ClinicalNoteVersionRecord[]> {
    return this.clinicalNoteVersions
      .filter((note) => matchesScope(note, scope) && note.encounterId === encounterId)
      .sort((left, right) => right.versionNumber - left.versionNumber);
  }

  async signClinicalNote(
    scope: RepositoryScope,
    encounterId: UUID
  ): Promise<SignClinicalNoteResult | null> {
    const encounter = await this.findEncounterById(scope, encounterId);
    if (!encounter) return null;
    const draft = (await this.listClinicalNoteVersions(scope, encounterId)).find(
      (note) => note.status === "draft"
    );
    if (!draft) return null;

    assertClinicalNoteCanBeSigned(draft);
    advanceFixtureRowVersion(encounter);
    draft.status = "signed";
    draft.signedByUserId = scope.actorUserId;
    draft.signedAt = this.#nowIso();
    encounter.status = "signed";
    encounter.updatedAt = draft.signedAt;
    this.timelineItems.push(
      this.#timeline(
        scope,
        encounter.patientId,
        "clinical_note_signed",
        "clinical_note_versions",
        draft.id,
        "Clinical note signed"
      )
    );

    return { encounter, note: draft };
  }

  async amendClinicalNote(
    scope: RepositoryScope,
    encounterId: UUID,
    input: AmendClinicalNoteInput
  ): Promise<AmendClinicalNoteResult | null> {
    const encounter = await this.findEncounterById(scope, encounterId);
    if (!encounter) return null;
    const amendedFrom = (await this.listClinicalNoteVersions(scope, encounterId)).find((note) =>
      ["signed", "amended"].includes(note.status)
    );
    if (!amendedFrom) return null;

    assertClinicalNoteCanBeAmended(amendedFrom);
    const now = this.#nowIso();
    const note: ClinicalNoteVersionRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      encounterId,
      patientId: encounter.patientId,
      versionNumber: this.nextClinicalNoteVersion(scope, encounterId),
      status: "amended",
      content: normalizeClinicalNoteContent(input.content),
      amendmentReason: input.amendmentReason,
      amendedFromVersionId: amendedFrom.id,
      signedByUserId: scope.actorUserId,
      signedAt: now,
      createdByUserId: scope.actorUserId,
      createdAt: now
    };

    this.clinicalNoteVersions.push(note);
    advanceFixtureRowVersion(encounter);
    encounter.status = "amended";
    encounter.updatedAt = now;
    this.timelineItems.push(
      this.#timeline(
        scope,
        encounter.patientId,
        "clinical_note_amended",
        "clinical_note_versions",
        note.id,
        "Clinical note amended"
      )
    );

    return { encounter, note, amendedFrom };
  }

  async createPrescription(
    scope: RepositoryScope,
    encounterId: UUID,
    input: CreatePrescriptionInput
  ): Promise<PrescriptionRecord | null> {
    const encounter = await this.findEncounterById(scope, encounterId);
    if (!encounter) return null;
    const prescription: PrescriptionRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      encounterId,
      patientId: encounter.patientId,
      status: "draft",
      medications: input.medications,
      notes: input.notes ?? null,
      createdByUserId: scope.actorUserId,
      createdAt: this.#nowIso(),
      signedByUserId: null,
      signedAt: null
    };

    this.prescriptions.push(prescription);
    this.timelineItems.push(
      this.#timeline(
        scope,
        encounter.patientId,
        "prescription_draft_created",
        "prescriptions",
        prescription.id,
        "Prescription drafted"
      )
    );
    return prescription;
  }

  async findPrescriptionById(
    scope: RepositoryScope,
    prescriptionId: UUID
  ): Promise<PrescriptionRecord | null> {
    return (
      this.prescriptions.find(
        (prescription) => matchesScope(prescription, scope) && prescription.id === prescriptionId
      ) ?? null
    );
  }

  async signPrescription(
    scope: RepositoryScope,
    prescriptionId: UUID
  ): Promise<PrescriptionRecord | null> {
    const prescription = await this.findPrescriptionById(scope, prescriptionId);
    if (!prescription) return null;

    assertPrescriptionCanBeSigned(prescription);
    prescription.status = "signed";
    prescription.signedByUserId = scope.actorUserId;
    prescription.signedAt = this.#nowIso();
    this.timelineItems.push(
      this.#timeline(
        scope,
        prescription.patientId,
        "prescription_signed",
        "prescriptions",
        prescription.id,
        "Prescription signed"
      )
    );
    return prescription;
  }

  async createPatientInstruction(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreatePatientInstructionInput
  ): Promise<PatientInstructionRecord | null> {
    const patient = await this.findPatientById(scope, patientId);
    if (!patient) return null;

    const now = this.#nowIso();
    const instruction: PatientInstructionRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId,
      channel: input.channel,
      templateId: input.templateId.trim(),
      title: input.title?.trim() || "Post-care instructions",
      body:
        input.body?.trim() ||
        "Follow the clinic-approved post-care instructions. Contact the clinic if symptoms worsen.",
      status: input.channel === "print" ? "ready_for_print" : "send_requested",
      renderedAt: now,
      printJobId: input.channel === "print" ? `print_${uuid()}` : null,
      outboxEventId: input.channel === "whatsapp" ? (input.outboxEventId ?? null) : null,
      providerConfirmationReceived: false,
      providerDeliveryConfirmedAt: null,
      deliveredAt: null,
      readAt: null,
      createdByUserId: scope.actorUserId,
      createdAt: now
    };
    this.patientInstructions.push(instruction);
    this.timelineItems.push(
      this.#timeline(
        scope,
        patientId,
        input.channel === "print" ? "instruction_print_requested" : "instruction_send_requested",
        "patient_instruction_requests",
        instruction.id,
        input.channel === "print" ? "Instruction print requested" : "Instruction send requested",
        {
          instructionId: instruction.id,
          templateId: instruction.templateId,
          channel: instruction.channel,
          outboxEventId: instruction.outboxEventId,
          providerConfirmationReceived: false
        }
      )
    );
    return instruction;
  }

  async createAiSession(scope: RepositoryScope, input: CreateAiSessionInput): Promise<AiSessionRecord> {
    const now = this.#nowIso();
    const session: AiSessionRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: input.patientId,
      encounterId: input.encounterId,
      status: "capture_ready",
      providerMode: input.providerMode,
      llmProviderKey: input.llmProviderKey,
      transcriptionProviderKey: input.transcriptionProviderKey,
      consentSnapshot: input.consentSnapshot,
      retentionPolicy: input.retentionPolicy,
      languageHint: input.languageHint ?? null,
      startedByUserId: scope.actorUserId,
      startedAt: now,
      endedAt: null,
      rawAudioDeletedAt: input.retentionPolicy.rawAudioRetention === "disabled" ? now : null,
      transcriptDeletedAt: null,
      metadata: input.metadata ?? {}
    };
    this.aiSessions.push(session);
    this.timelineItems.push(
      this.#timeline(scope, input.patientId, "ai_session_started", "ai_sessions", session.id, "AI scribe session started", {
        encounterId: input.encounterId,
        providerMode: input.providerMode,
        rawAudioRetention: input.retentionPolicy.rawAudioRetention
      })
    );
    return session;
  }

  async findAiSessionById(scope: RepositoryScope, sessionId: UUID): Promise<AiSessionRecord | null> {
    return this.aiSessions.find((session) => matchesScope(session, scope) && session.id === sessionId) ?? null;
  }

  async findAiSessionDetail(scope: RepositoryScope, sessionId: UUID): Promise<AiSessionDetail | null> {
    const session = await this.findAiSessionById(scope, sessionId);
    if (!session) return null;
    return {
      session,
      transcriptSegments: this.aiTranscriptSegments
        .filter((segment) => matchesScope(segment, scope) && segment.sessionId === sessionId)
        .sort((left, right) => left.sequence - right.sequence),
      sourceAnchors: this.aiSourceAnchors.filter(
        (anchor) => matchesScope(anchor, scope) && anchor.sessionId === sessionId
      ),
      jobs: this.aiJobs.filter((job) => matchesScope(job, scope) && job.sessionId === sessionId),
      draftOutputs: this.aiDraftOutputs.filter(
        (output) => matchesScope(output, scope) && output.sessionId === sessionId
      ),
      actionProposals: this.aiActionProposals.filter(
        (proposal) => matchesScope(proposal, scope) && proposal.sessionId === sessionId
      ),
      reviewDecisions: this.aiReviewDecisions.filter(
        (decision) => matchesScope(decision, scope) && decision.sessionId === sessionId
      )
    };
  }

  async listAiSessionsForEncounter(scope: RepositoryScope, encounterId: UUID): Promise<AiSessionRecord[]> {
    return this.aiSessions
      .filter((session) => matchesScope(session, scope) && session.encounterId === encounterId)
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async createAiTranscriptSegment(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiTranscriptSegmentInput
  ): Promise<{ segment: AiTranscriptSegmentRecord; sourceAnchor: AiSourceAnchorRecord } | null> {
    const session = await this.findAiSessionById(scope, sessionId);
    if (!session || session.status === "retention_deleted") return null;
    const now = this.#nowIso();
    const sequence =
      this.aiTranscriptSegments.filter((segment) => matchesScope(segment, scope) && segment.sessionId === sessionId)
        .length + 1;
    const segment: AiTranscriptSegmentRecord = {
      id: input.id ?? uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      sessionId,
      patientId: session.patientId,
      encounterId: session.encounterId,
      sequence,
      speakerRole: input.speakerRole ?? "unknown",
      text: input.text,
      startsAtMs: input.startsAtMs,
      endsAtMs: input.endsAtMs,
      sourceHash: input.sourceHash,
      createdByUserId: scope.actorUserId,
      createdAt: now
    };
    const sourceAnchor: AiSourceAnchorRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      sessionId,
      patientId: session.patientId,
      encounterId: session.encounterId,
      anchorType: "transcript_segment",
      sourceRecordType: "ai_transcript_segments",
      sourceRecordId: segment.id,
      transcriptSegmentId: segment.id,
      startsAtMs: segment.startsAtMs,
      endsAtMs: segment.endsAtMs,
      textQuoteDigest: segment.sourceHash,
      supported: true,
      unsupportedReason: null,
      createdAt: now
    };
    this.aiTranscriptSegments.push(segment);
    this.aiSourceAnchors.push(sourceAnchor);
    session.status = "processing";
    return { segment, sourceAnchor };
  }

  async createAiSourceAnchor(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiSourceAnchorInput
  ): Promise<AiSourceAnchorRecord | null> {
    const session = await this.findAiSessionById(scope, sessionId);
    if (!session) return null;
    const anchor: AiSourceAnchorRecord = {
      id: input.id ?? uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      sessionId,
      patientId: session.patientId,
      encounterId: session.encounterId,
      anchorType: input.anchorType,
      sourceRecordType: input.sourceRecordType,
      sourceRecordId: input.sourceRecordId,
      transcriptSegmentId: input.transcriptSegmentId ?? null,
      startsAtMs: input.startsAtMs ?? null,
      endsAtMs: input.endsAtMs ?? null,
      textQuoteDigest: input.textQuoteDigest ?? null,
      supported: input.supported ?? input.anchorType === "transcript_segment",
      unsupportedReason: input.unsupportedReason ?? (input.anchorType === "transcript_segment" ? null : "unsupported_source_anchor"),
      createdAt: this.#nowIso()
    };
    this.aiSourceAnchors.push(anchor);
    return anchor;
  }

  async createAiJob(scope: RepositoryScope, sessionId: UUID, input: CreateAiJobInput): Promise<AiJobRecord | null> {
    const session = await this.findAiSessionById(scope, sessionId);
    if (!session) return null;
    const now = this.#nowIso();
    const job: AiJobRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      sessionId,
      patientId: session.patientId,
      encounterId: session.encounterId,
      jobType: input.jobType,
      status: input.status,
      providerMode: input.providerMode,
      providerKey: input.providerKey,
      inputDigest: input.inputDigest,
      outputSummary: input.outputSummary ?? {},
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      createdByUserId: scope.actorUserId,
      createdAt: now,
      completedAt: input.completedAt ?? (input.status === "succeeded" || input.status === "failed" ? now : null)
    };
    this.aiJobs.push(job);
    return job;
  }

  async createAiDraftOutput(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiDraftOutputInput
  ): Promise<AiDraftOutputRecord | null> {
    const session = await this.findAiSessionById(scope, sessionId);
    if (!session) return null;
    assertSupportedSourceAnchors(this.aiSourceAnchors, input.sourceAnchorIds);
    const output: AiDraftOutputRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      sessionId,
      jobId: input.jobId ?? null,
      patientId: session.patientId,
      encounterId: session.encounterId,
      outputType: input.outputType,
      reviewStatus: "needs_review",
      content: input.content,
      confidence: input.confidence,
      warnings: input.warnings ?? [],
      sourceAnchorIds: [...input.sourceAnchorIds],
      unsupportedSourceAnchorIds: input.unsupportedSourceAnchorIds ?? [],
      schemaVersion: input.schemaVersion,
      providerMode: input.providerMode,
      providerRequestDigest: input.providerRequestDigest,
      createdByUserId: scope.actorUserId,
      createdAt: this.#nowIso(),
      reviewedByUserId: null,
      reviewedAt: null
    };
    this.aiDraftOutputs.push(output);
    session.status = "ready_for_review";
    this.timelineItems.push(
      this.#timeline(scope, session.patientId, "ai_draft_generated", "ai_draft_outputs", output.id, "AI draft generated", {
        encounterId: session.encounterId,
        outputType: output.outputType,
        reviewStatus: output.reviewStatus
      })
    );
    return output;
  }

  async createAiActionProposal(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiActionProposalInput
  ): Promise<AiActionProposalRecord | null> {
    const session = await this.findAiSessionById(scope, sessionId);
    if (!session) return null;
    assertSupportedSourceAnchors(this.aiSourceAnchors, input.sourceAnchorIds);
    const proposal: AiActionProposalRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      sessionId,
      outputId: input.outputId ?? null,
      patientId: session.patientId,
      encounterId: session.encounterId,
      proposalType: input.proposalType,
      reviewStatus: "needs_review",
      title: input.title,
      description: input.description,
      proposedPayload: input.proposedPayload,
      requiredPermission: input.requiredPermission,
      sourceAnchorIds: [...input.sourceAnchorIds],
      unsupportedSourceAnchorIds: input.unsupportedSourceAnchorIds ?? [],
      providerMode: input.providerMode,
      createdByUserId: scope.actorUserId,
      createdAt: this.#nowIso(),
      reviewedByUserId: null,
      reviewedAt: null
    };
    this.aiActionProposals.push(proposal);
    return proposal;
  }

  async recordAiReviewDecision(
    scope: RepositoryScope,
    sessionId: UUID,
    input: RecordAiReviewDecisionInput
  ): Promise<AiReviewDecisionRecord | null> {
    const session = await this.findAiSessionById(scope, sessionId);
    if (!session) return null;
    const target =
      input.targetType === "draft_output"
        ? this.aiDraftOutputs.find((output) => matchesScope(output, scope) && output.id === input.targetId)
        : this.aiActionProposals.find((proposal) => matchesScope(proposal, scope) && proposal.id === input.targetId);
    if (!target) return null;

    const now = this.#nowIso();
    target.reviewStatus =
      input.decision === "approve"
        ? "approved_review_only"
        : input.decision === "reject"
          ? "rejected"
          : "needs_review";
    target.reviewedByUserId = scope.actorUserId;
    target.reviewedAt = now;

    const decision: AiReviewDecisionRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      sessionId,
      targetType: input.targetType,
      targetId: input.targetId,
      decision: input.decision,
      reason: input.reason,
      editedContent: input.editedContent ?? null,
      appliedWorkflow: "review_only",
      appliedRecordId: null,
      reviewedByUserId: scope.actorUserId,
      reviewedAt: now
    };
    this.aiReviewDecisions.push(decision);
    return decision;
  }

  async deleteAiSessionRetainedPayloads(
    scope: RepositoryScope,
    sessionId: UUID
  ): Promise<AiRetentionDeletionResult | null> {
    const session = await this.findAiSessionById(scope, sessionId);
    if (!session) return null;
    const deletedTranscriptSegments = this.aiTranscriptSegments.filter(
      (segment) => matchesScope(segment, scope) && segment.sessionId === sessionId
    ).length;
    removeWhere(
      this.aiTranscriptSegments,
      (segment) => matchesScope(segment, scope) && segment.sessionId === sessionId
    );
    session.status = "retention_deleted";
    session.rawAudioDeletedAt = session.rawAudioDeletedAt ?? this.#nowIso();
    session.transcriptDeletedAt = this.#nowIso();
    return { session, deletedTranscriptSegments, deletedRawAudioReferences: true };
  }

  async createMediaUploadReservation(
    scope: RepositoryScope,
    input: CreateMediaUploadReservationInput
  ): Promise<MediaUploadReservationRecord> {
    const now = this.#nowIso();
    const reservation: MediaUploadReservationRecord = {
      id: input.id,
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: input.patientId,
      encounterId: input.encounterId ?? null,
      toothNumber: input.toothNumber ?? null,
      dentalFindingId: input.dentalFindingId ?? null,
      mediaType: input.mediaType,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      expectedFileSizeBytes: input.expectedFileSizeBytes,
      expectedSha256Digest: input.expectedSha256Digest ?? null,
      objectKey: input.objectKey,
      storageProvider: input.storageProvider,
      storageRegion: input.storageRegion ?? null,
      status: "reserved",
      expiresAt: input.expiresAt,
      createdByUserId: scope.actorUserId,
      createdAt: now,
      completedAt: null,
      mediaAssetId: null,
      tags: input.tags ?? [],
      provenance: input.provenance ?? {}
    };

    this.mediaUploadReservations.push(reservation);
    return reservation;
  }

  async findMediaUploadReservationById(
    scope: RepositoryScope,
    uploadId: UUID
  ): Promise<MediaUploadReservationRecord | null> {
    return (
      this.mediaUploadReservations.find(
        (reservation) => matchesScope(reservation, scope) && reservation.id === uploadId
      ) ?? null
    );
  }

  async completeMediaUpload(
    scope: RepositoryScope,
    uploadId: UUID,
    input: CompleteMediaUploadInput
  ): Promise<MediaAssetRecord | null> {
    const reservation = await this.findMediaUploadReservationById(scope, uploadId);
    if (!reservation || reservation.status !== "reserved") return null;

    const now = this.#nowIso();
    const asset: MediaAssetRecord = {
      id: uuid(),
      tenantId: reservation.tenantId,
      clinicId: reservation.clinicId,
      patientId: reservation.patientId,
      encounterId: reservation.encounterId,
      toothNumber: reservation.toothNumber,
      dentalFindingId: reservation.dentalFindingId,
      mediaType: reservation.mediaType,
      originalFilename: reservation.originalFilename,
      mimeType: reservation.mimeType,
      fileSizeBytes: input.contentLength,
      sha256Digest: input.sha256Digest ?? reservation.expectedSha256Digest,
      objectKey: reservation.objectKey,
      objectVersion: input.objectVersion ?? null,
      storageProvider: reservation.storageProvider,
      storageRegion: reservation.storageRegion,
      status: mediaAssetStatusForScan(input.scanStatus),
      scanStatus: input.scanStatus,
      quarantineReason: input.quarantineReason ?? null,
      tags: reservation.tags,
      provenance: reservation.provenance,
      dicomMetadata: input.dicomMetadata ?? {},
      createdByUserId: reservation.createdByUserId,
      uploadedByUserId: scope.actorUserId,
      createdAt: reservation.createdAt,
      uploadedAt: now,
      updatedAt: now
    };

    reservation.status = "completed";
    reservation.completedAt = now;
    reservation.mediaAssetId = asset.id;
    this.mediaAssets.push(asset);
    this.timelineItems.push(
      this.#timeline(
        scope,
        asset.patientId,
        "media_uploaded",
        "media_assets",
        asset.id,
        `${asset.mediaType.replace("_", " ")} uploaded`,
        {
          mediaAssetId: asset.id,
          mediaType: asset.mediaType,
          encounterId: asset.encounterId,
          toothNumber: asset.toothNumber,
          dentalFindingId: asset.dentalFindingId
        }
      )
    );
    return asset;
  }

  async listPatientMediaAssets(
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<MediaAssetRecord[]> {
    return this.mediaAssets
      .filter((asset) => matchesScope(asset, scope) && asset.patientId === patientId)
      .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
  }

  async findMediaAssetById(
    scope: RepositoryScope,
    mediaAssetId: UUID
  ): Promise<MediaAssetRecord | null> {
    return (
      this.mediaAssets.find((asset) => matchesScope(asset, scope) && asset.id === mediaAssetId) ??
      null
    );
  }

  async getDentalChart(scope: RepositoryScope, patientId: UUID) {
    const chart = this.ensureDentalChart(scope, patientId);
    if (!chart) return null;

    return {
      chart,
      findings: this.dentalFindings
        .filter((finding) => matchesScope(finding, scope) && finding.patientId === patientId)
        .sort(
          (left, right) =>
            left.toothNumber.localeCompare(right.toothNumber) ||
            (left.surface ?? "").localeCompare(right.surface ?? "") ||
            right.createdAt.localeCompare(left.createdAt)
        ),
      snapshots: this.dentalChartSnapshots
        .filter((snapshot) => matchesScope(snapshot, scope) && snapshot.patientId === patientId)
        .sort((left, right) => right.snapshotVersion - left.snapshotVersion)
    };
  }

  async createDentalFinding(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreateDentalFindingInput
  ): Promise<DentalFindingMutationResult | null> {
    const chart = this.ensureDentalChart(scope, patientId);
    if (!chart) return null;
    if (input.encounterId) {
      const encounter = await this.findEncounterById(scope, input.encounterId);
      if (!encounter || encounter.patientId !== patientId) return null;
    }

    const normalized = normalizeFixtureCreateDentalFindingInput(input);
    const now = this.#nowIso();
    const finding: DentalFindingRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      rowVersion: 1,
      patientId,
      encounterId: normalized.encounterId,
      toothNumber: normalized.toothNumber,
      numberingSystem: "fdi",
      surface: normalized.surface,
      findingType: normalized.findingType,
      severity: normalized.severity,
      status: normalized.status,
      reviewStatus: normalized.reviewStatus,
      source: normalized.source,
      confidence: normalized.confidence,
      notes: normalized.notes,
      provenance: normalized.provenance,
      treatmentReference: normalized.treatmentReference,
      createdByUserId: scope.actorUserId,
      updatedByUserId: null,
      reviewedByUserId: normalized.reviewStatus === "reviewed" ? scope.actorUserId : null,
      reviewedAt: normalized.reviewStatus === "reviewed" ? now : null,
      createdAt: now,
      updatedAt: now
    };
    this.dentalFindings.push(finding);
    const history = this.appendDentalFindingHistory(scope, finding, {
      changeType: "created",
      reason: null,
      beforeState: null,
      provenance: normalized.provenance
    });
    this.timelineItems.push({
      ...this.#timeline(
        scope,
        patientId,
        "dental_finding_created",
        "dental_findings",
        finding.id,
        `Dental finding added on ${finding.toothNumber}`
      ),
      summary: finding.surface
        ? `${finding.findingType} on ${finding.surface}`
        : finding.findingType,
      metadata: {
        findingId: finding.id,
        encounterId: finding.encounterId,
        toothNumber: finding.toothNumber,
        surface: finding.surface,
        status: finding.status,
        reviewStatus: finding.reviewStatus
      }
    });

    return { finding, history };
  }

  async updateDentalFinding(
    scope: RepositoryScope,
    findingId: UUID,
    input: UpdateDentalFindingRepositoryInput
  ): Promise<DentalFindingMutationResult | null> {
    assertDentalFindingUpdateReason(input.changeReason);
    const finding = this.dentalFindings.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === findingId
    );
    if (!finding) return null;
    if (input.encounterId) {
      const encounter = await this.findEncounterById(scope, input.encounterId);
      if (!encounter || encounter.patientId !== finding.patientId) return null;
    }

    const beforeState = toDentalFindingSnapshotFinding(finding);
    const next = normalizeFixtureUpdateDentalFindingInput(finding, input);
    const now = this.#nowIso();
    advanceFixtureRowVersion(finding);
    Object.assign(finding, {
      encounterId: next.encounterId,
      toothNumber: next.toothNumber,
      surface: next.surface,
      findingType: next.findingType,
      severity: next.severity,
      status: next.status,
      reviewStatus: next.reviewStatus,
      source: next.source,
      confidence: next.confidence,
      notes: next.notes,
      provenance: next.provenance,
      treatmentReference: next.treatmentReference,
      updatedByUserId: scope.actorUserId,
      reviewedByUserId:
        next.reviewStatus === "reviewed" ? finding.reviewedByUserId ?? scope.actorUserId : null,
      reviewedAt: next.reviewStatus === "reviewed" ? finding.reviewedAt ?? now : null,
      updatedAt: now
    });
    const history = this.appendDentalFindingHistory(scope, finding, {
      changeType: "updated",
      reason: input.changeReason.trim(),
      beforeState,
      provenance: input.provenance ?? {}
    });
    this.timelineItems.push({
      ...this.#timeline(
        scope,
        finding.patientId,
        "dental_finding_updated",
        "dental_findings",
        finding.id,
        `Dental finding updated on ${finding.toothNumber}`
      ),
      summary: input.changeReason.trim(),
      metadata: {
        findingId: finding.id,
        encounterId: finding.encounterId,
        toothNumber: finding.toothNumber,
        surface: finding.surface,
        status: finding.status,
        reviewStatus: finding.reviewStatus
      }
    });

    return { finding, history };
  }

  async listDentalFindingHistory(
    scope: RepositoryScope,
    findingId: UUID
  ): Promise<DentalFindingHistoryRecord[]> {
    return this.dentalFindingHistory
      .filter((history) => matchesScope(history, scope) && history.findingId === findingId)
      .sort((left, right) => right.changedAt.localeCompare(left.changedAt));
  }

  async createDentalChartSnapshot(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreateDentalChartSnapshotInput
  ): Promise<DentalChartSnapshotRecord | null> {
    const chart = this.ensureDentalChart(scope, patientId);
    if (!chart) return null;
    if (input.encounterId) {
      const encounter = await this.findEncounterById(scope, input.encounterId);
      if (!encounter || encounter.patientId !== patientId) return null;
    }

    const findings = this.dentalFindings.filter(
      (finding) => matchesScope(finding, scope) && finding.patientId === patientId
    );
    const now = this.#nowIso();
    const snapshot: DentalChartSnapshotRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId,
      encounterId: input.encounterId ?? null,
      snapshotVersion: this.nextDentalSnapshotVersion(scope, patientId),
      chartState: buildDentalChartSnapshotState(findings, now),
      reason: input.reason ?? null,
      provenance: input.provenance ?? {},
      createdByUserId: scope.actorUserId,
      createdAt: now
    };
    this.dentalChartSnapshots.push(snapshot);
    this.timelineItems.push({
      ...this.#timeline(
        scope,
        patientId,
        "dental_chart_snapshot_created",
        "dental_chart_snapshots",
        snapshot.id,
        `Dental chart snapshot v${snapshot.snapshotVersion}`
      ),
      summary: input.reason ?? `${snapshot.chartState.findingCount} finding(s) captured`,
      metadata: {
        snapshotId: snapshot.id,
        encounterId: snapshot.encounterId,
        snapshotVersion: snapshot.snapshotVersion,
        findingCount: snapshot.chartState.findingCount,
        numberingSystem: chart.numberingSystem
      }
    });

    return snapshot;
  }

  async createTreatmentPlan(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreateTreatmentPlanInput
  ) {
    const patient = await this.findPatientById(scope, patientId);
    if (!patient) return null;
    if (input.encounterId) {
      const encounter = await this.findEncounterById(scope, input.encounterId);
      if (!encounter || encounter.patientId !== patientId) return null;
    }

    const now = this.#nowIso();
    const treatmentPlan: TreatmentPlanRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      rowVersion: 1,
      patientId,
      encounterId: input.encounterId ?? null,
      title: input.title.trim(),
      status: input.status ?? "draft",
      currency: "INR",
      subtotalMinor: 0,
      discountMinor: 0,
      taxMinor: 0,
      totalMinor: 0,
      clinicalSummary: input.clinicalSummary?.trim() || null,
      presentedAt: input.status === "presented" ? now : null,
      acceptedAt: null,
      acceptedByUserId: null,
      acceptedByName: null,
      acceptanceEvidence: {},
      createdByUserId: scope.actorUserId,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now
    };

    this.treatmentPlans.push(treatmentPlan);
    this.replaceTreatmentPlanPhases(scope, treatmentPlan, input.phases);
    this.recalculateTreatmentPlanTotals(treatmentPlan);
    this.timelineItems.push(
      this.#timeline(
        scope,
        patientId,
        "treatment_plan_created",
        "treatment_plans",
        treatmentPlan.id,
        "Treatment plan created",
        { treatmentPlanId: treatmentPlan.id, status: treatmentPlan.status }
      )
    );

    return { detail: this.treatmentPlanDetail(scope, treatmentPlan.id) };
  }

  async findTreatmentPlanById(
    scope: RepositoryScope,
    treatmentPlanId: UUID
  ): Promise<TreatmentPlanDetail | null> {
    const plan = this.treatmentPlans.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === treatmentPlanId
    );
    return plan ? this.treatmentPlanDetail(scope, treatmentPlanId) : null;
  }

  async updateTreatmentPlan(
    scope: RepositoryScope,
    treatmentPlanId: UUID,
    input: UpdateTreatmentPlanInput
  ) {
    const plan = this.treatmentPlans.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === treatmentPlanId
    );
    if (!plan) return null;

    assertTreatmentPlanMutable(plan);
    advanceFixtureRowVersion(plan);

    if (input.title !== undefined) plan.title = input.title.trim();
    if (input.clinicalSummary !== undefined) {
      plan.clinicalSummary = input.clinicalSummary?.trim() || null;
    }
    if (input.status !== undefined) {
      plan.status = input.status;
      if (input.status === "presented") {
        plan.presentedAt = plan.presentedAt ?? this.#nowIso();
      }
    }
    if (input.phases) {
      this.treatmentPlanPhases.splice(
        0,
        this.treatmentPlanPhases.length,
        ...this.treatmentPlanPhases.filter(
          (phase) => !matchesScope(phase, scope) || phase.treatmentPlanId !== treatmentPlanId
        )
      );
      this.treatmentPlanEstimateItems.splice(
        0,
        this.treatmentPlanEstimateItems.length,
        ...this.treatmentPlanEstimateItems.filter(
          (item) => !matchesScope(item, scope) || item.treatmentPlanId !== treatmentPlanId
        )
      );
      this.replaceTreatmentPlanPhases(scope, plan, input.phases);
      this.recalculateTreatmentPlanTotals(plan);
    }
    plan.updatedByUserId = scope.actorUserId;
    plan.updatedAt = this.#nowIso();

    return { detail: this.treatmentPlanDetail(scope, treatmentPlanId) };
  }

  async acceptTreatmentPlan(
    scope: RepositoryScope,
    treatmentPlanId: UUID,
    input: AcceptTreatmentPlanInput
  ) {
    const plan = this.treatmentPlans.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === treatmentPlanId
    );
    if (!plan) return null;
    const items = this.treatmentPlanEstimateItems.filter(
      (item) => matchesScope(item, scope) && item.treatmentPlanId === treatmentPlanId
    );

    assertTreatmentPlanAcceptable(plan, items.length);
    const now = this.#nowIso();
    advanceFixtureRowVersion(plan);
    plan.status = "accepted";
    plan.presentedAt = plan.presentedAt ?? now;
    plan.acceptedAt = now;
    plan.acceptedByUserId = scope.actorUserId;
    plan.acceptedByName = input.acceptedByName?.trim() || null;
    plan.acceptanceEvidence = input.acceptanceEvidence ?? {};
    plan.updatedByUserId = scope.actorUserId;
    plan.updatedAt = now;
    for (const item of items) {
      item.status = "accepted";
      item.updatedAt = now;
    }
    this.timelineItems.push(
      this.#timeline(
        scope,
        plan.patientId,
        "treatment_plan_accepted",
        "treatment_plans",
        plan.id,
        "Treatment plan accepted",
        { treatmentPlanId: plan.id, totalMinor: plan.totalMinor, currency: plan.currency }
      )
    );

    return { detail: this.treatmentPlanDetail(scope, treatmentPlanId) };
  }

  async createProcedurePerformed(
    scope: RepositoryScope,
    encounterId: UUID,
    input: CreateProcedurePerformedInput
  ) {
    const encounter = await this.findEncounterById(scope, encounterId);
    if (!encounter) return null;
    const detail = await this.findTreatmentPlanById(scope, input.treatmentPlanId);
    if (!detail || detail.treatmentPlan.patientId !== encounter.patientId) return null;
    if (detail.treatmentPlan.status !== "accepted") {
      throw new Error("Procedures can only be completed from an accepted treatment plan.");
    }
    const estimateItem = detail.phases
      .flatMap((phase) => phase.estimateItems)
      .find((item) => item.id === input.treatmentPlanEstimateItemId);
    if (!estimateItem || estimateItem.status !== "accepted") return null;
    const duplicate = this.proceduresPerformed.find(
      (procedure) =>
        matchesScope(procedure, scope) &&
        procedure.treatmentPlanEstimateItemId === estimateItem.id &&
        procedure.status === "completed"
    );
    if (duplicate) {
      throw new Error("This accepted treatment plan item is already completed.");
    }

    const now = this.#nowIso();
    advanceFixtureRowVersion(detail.treatmentPlan);
    const procedure: ProcedurePerformedRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: encounter.patientId,
      encounterId,
      treatmentPlanId: detail.treatmentPlan.id,
      treatmentPlanEstimateItemId: estimateItem.id,
      pricebookProcedureId: estimateItem.pricebookProcedureId,
      dentalFindingId: estimateItem.dentalFindingId,
      invoiceId: null,
      toothNumber: estimateItem.toothNumber,
      quantity: estimateItem.quantity,
      unitPriceMinor: estimateItem.unitPriceMinor,
      discountMinor: estimateItem.discountMinor,
      taxRateBasisPoints: estimateItem.taxRateBasisPoints,
      taxMinor: estimateItem.taxMinor,
      totalMinor: estimateItem.totalMinor,
      status: "completed",
      performedByUserId: scope.actorUserId,
      performedAt: input.performedAt ?? now,
      notes: input.notes?.trim() || null,
      outcome: input.outcome?.trim() || null,
      provenance: input.provenance ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.proceduresPerformed.push(procedure);
    estimateItem.status = "completed";
    estimateItem.updatedAt = now;
    this.timelineItems.push(
      this.#timeline(
        scope,
        procedure.patientId,
        "procedure_completed",
        "procedure_performed_records",
        procedure.id,
        "Procedure completed",
        {
          procedurePerformedId: procedure.id,
          treatmentPlanId: procedure.treatmentPlanId,
          estimateItemId: procedure.treatmentPlanEstimateItemId
        }
      )
    );

    return {
      procedure,
      treatmentPlan: this.treatmentPlanDetail(scope, detail.treatmentPlan.id)
    };
  }

  async listCompletedProceduresForInvoice(
    scope: RepositoryScope,
    input: CreateInvoiceInput
  ): Promise<ProcedurePerformedRecord[]> {
    const requestedIds = new Set(input.procedurePerformedIds ?? []);
    return this.proceduresPerformed
      .filter((procedure) => matchesScope(procedure, scope))
      .filter((procedure) => procedure.status === "completed" && !procedure.invoiceId)
      .filter((procedure) => !input.patientId || procedure.patientId === input.patientId)
      .filter((procedure) => !input.treatmentPlanId || procedure.treatmentPlanId === input.treatmentPlanId)
      .filter((procedure) => requestedIds.size === 0 || requestedIds.has(procedure.id))
      .sort((left, right) => left.performedAt.localeCompare(right.performedAt));
  }

  async createInvoice(scope: RepositoryScope, input: CreateInvoiceInput) {
    const procedures = await this.listCompletedProceduresForInvoice(scope, input);
    if (procedures.length === 0) return null;
    const patientIds = new Set(procedures.map((procedure) => procedure.patientId));
    if (patientIds.size !== 1) {
      throw new Error("Invoice procedures must belong to exactly one patient.");
    }
    const treatmentPlanIds = new Set(procedures.map((procedure) => procedure.treatmentPlanId));
    if (input.treatmentPlanId && treatmentPlanIds.size !== 1) {
      throw new Error("Invoice procedures must belong to the requested treatment plan.");
    }

    const totals = procedures.reduce(
      (total, procedure) => ({
        subtotalMinor: total.subtotalMinor + procedure.unitPriceMinor * procedure.quantity,
        discountMinor: total.discountMinor + procedure.discountMinor,
        taxMinor: total.taxMinor + procedure.taxMinor,
        totalMinor: total.totalMinor + procedure.totalMinor
      }),
      { subtotalMinor: 0, discountMinor: 0, taxMinor: 0, totalMinor: 0 }
    );
    const now = this.#nowIso();
    const invoice: InvoiceRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: procedures[0].patientId,
      invoiceNumber: this.nextInvoiceNumber(scope),
      status: "issued",
      paymentStatus: "unpaid",
      currency: "INR",
      subtotalMinor: totals.subtotalMinor,
      discountMinor: totals.discountMinor,
      taxMinor: totals.taxMinor,
      totalMinor: totals.totalMinor,
      paidMinor: 0,
      refundedMinor: 0,
      balanceMinor: totals.totalMinor,
      treatmentPlanId: input.treatmentPlanId ?? (treatmentPlanIds.size === 1 ? procedures[0].treatmentPlanId : null),
      issuedAt: now,
      dueAt: input.dueAt ?? null,
      createdByUserId: scope.actorUserId,
      updatedByUserId: null,
      createdAt: now,
      updatedAt: now
    };

    this.invoices.push(invoice);
    for (const procedure of procedures) {
      procedure.invoiceId = invoice.id;
      procedure.updatedAt = now;
      const pricebookProcedure = this.pricebookProcedures.find(
        (candidate) => candidate.id === procedure.pricebookProcedureId
      );
      this.invoiceItems.push({
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        invoiceId: invoice.id,
        patientId: invoice.patientId,
        procedurePerformedId: procedure.id,
        treatmentPlanEstimateItemId: procedure.treatmentPlanEstimateItemId,
        pricebookProcedureId: procedure.pricebookProcedureId,
        description: pricebookProcedure?.displayName ?? "Completed dental procedure",
        quantity: procedure.quantity,
        unitPriceMinor: procedure.unitPriceMinor,
        discountMinor: procedure.discountMinor,
        taxRateBasisPoints: procedure.taxRateBasisPoints,
        taxMinor: procedure.taxMinor,
        totalMinor: procedure.totalMinor,
        createdAt: now
      });
    }
    this.timelineItems.push(
      this.#timeline(scope, invoice.patientId, "invoice_created", "invoices", invoice.id, "Invoice created", {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        totalMinor: invoice.totalMinor,
        currency: invoice.currency
      })
    );

    return {
      invoiceDetail: this.invoiceDetail(scope, invoice.id),
      procedures
    };
  }

  async findInvoiceById(scope: RepositoryScope, invoiceId: UUID): Promise<InvoiceDetail | null> {
    const invoice = this.invoices.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === invoiceId
    );
    return invoice ? this.invoiceDetail(scope, invoiceId) : null;
  }

  async createPaymentRequest(
    scope: RepositoryScope,
    input: CreatePaymentRequestInput
  ): Promise<PaymentRequestRecord | null> {
    const invoice = this.invoices.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === input.invoiceId
    );
    if (!invoice || invoice.status !== "issued") return null;
    assertPositiveMinorCurrencyAmount(input.amountMinor, "amountMinor");
    if (input.amountMinor > invoice.balanceMinor) {
      throw new Error("Payment request amount cannot exceed invoice balance.");
    }

    const now = this.#nowIso();
    const request: PaymentRequestRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      invoiceId: invoice.id,
      patientId: invoice.patientId,
      provider: input.provider,
      requestType: input.requestType,
      status: input.providerReferenceId ? "provider_created" : "requested",
      amountMinor: input.amountMinor,
      currency: input.currency ?? "INR",
      providerReferenceId: input.providerReferenceId ?? null,
      providerUrl: input.providerUrl ?? null,
      providerQrPayload: input.providerQrPayload ?? null,
      expiresAt: input.expiresAt ?? null,
      metadata: input.metadata ?? {},
      createdByUserId: scope.actorUserId,
      createdAt: now,
      updatedAt: now
    };

    this.paymentRequests.push(request);
    invoice.paymentStatus = calculateInvoicePaymentStatus({
      totalMinor: invoice.totalMinor,
      paidMinor: invoice.paidMinor,
      refundedMinor: invoice.refundedMinor,
      hasPaymentRequest: true,
      invoiceStatus: invoice.status
    });
    invoice.updatedByUserId = scope.actorUserId;
    invoice.updatedAt = now;
    return request;
  }

  async recordPaymentTransaction(
    scope: RepositoryScope,
    input: RecordPaymentTransactionInput
  ): Promise<PaymentTransactionRecord | null> {
    const invoice = this.invoices.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === input.invoiceId
    );
    if (!invoice) return null;
    if (input.paymentRequestId) {
      const request = this.paymentRequests.find(
        (candidate) =>
          matchesScope(candidate, scope) &&
          candidate.id === input.paymentRequestId &&
          candidate.invoiceId === invoice.id
      );
      if (!request) return null;
    }
    if (input.idempotencyKey) {
      const existing = this.paymentTransactions.find(
        (payment) =>
          matchesScope(payment, scope) &&
          payment.provider === input.provider &&
          payment.idempotencyKey === input.idempotencyKey
      );
      if (existing) return existing;
    }
    assertPositiveMinorCurrencyAmount(input.amountMinor, "amountMinor");
    if (input.currency && input.currency !== invoice.currency) {
      throw new Error("Payment currency must match invoice currency.");
    }
    if (input.status === "succeeded" && input.verificationStatus !== "verified") {
      throw new Error("Provider payment success requires verified provider evidence.");
    }
    if (
      input.status === "manually_recorded" &&
      input.verificationStatus !== "not_required_manual"
    ) {
      throw new Error("Manual payment requires not_required_manual verification status.");
    }

    const now = this.#nowIso();
    const payment: PaymentTransactionRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      invoiceId: invoice.id,
      patientId: invoice.patientId,
      paymentRequestId: input.paymentRequestId ?? null,
      provider: input.provider,
      providerPaymentId: input.providerPaymentId ?? null,
      providerOrderId: input.providerOrderId ?? null,
      amountMinor: input.amountMinor,
      currency: input.currency ?? invoice.currency,
      method: input.method.trim(),
      status: input.status,
      verificationStatus: input.verificationStatus,
      reconciliationStatus: input.reconciliationStatus ?? "matched",
      idempotencyKey: input.idempotencyKey ?? null,
      receivedAt: input.receivedAt ?? now,
      recordedByUserId: input.recordedByUserId === undefined ? scope.actorUserId : input.recordedByUserId,
      receiptId: null,
      metadata: input.metadata ?? {},
      createdAt: now,
      updatedAt: now
    };

    this.paymentTransactions.push(payment);
    this.recalculateInvoicePaymentState(scope, invoice);
    if (isSettledPaymentTransaction(payment)) {
      this.timelineItems.push(
        this.#timeline(scope, invoice.patientId, "payment_recorded", "payment_transactions", payment.id, "Payment recorded", {
          invoiceId: invoice.id,
          paymentTransactionId: payment.id,
          amountMinor: payment.amountMinor,
          provider: payment.provider,
          method: payment.method
        })
      );
    }
    return payment;
  }

  async createReceipt(
    scope: RepositoryScope,
    invoiceId: UUID,
    input: CreateReceiptInput
  ) {
    const invoice = this.invoices.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === invoiceId
    );
    if (!invoice) return null;
    const requestedIds = new Set(input.paymentTransactionIds ?? []);
    const payments = this.paymentTransactions.filter(
      (payment) =>
        matchesScope(payment, scope) &&
        payment.invoiceId === invoiceId &&
        (requestedIds.size === 0 || requestedIds.has(payment.id))
    );

    assertInvoiceReceiptable({ invoice, payments });
    const receiptablePayments = payments.filter(
      (payment) => isSettledPaymentTransaction(payment) && !payment.receiptId
    );
    const allocations: ReceiptPaymentAllocation[] = receiptablePayments.map((payment) => ({
      paymentTransactionId: payment.id,
      amountMinor: payment.amountMinor
    }));
    const amountMinor = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
    assertPositiveMinorCurrencyAmount(amountMinor, "receiptAmountMinor");

    const now = this.#nowIso();
    const receipt: ReceiptRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      invoiceId,
      patientId: invoice.patientId,
      receiptNumber: this.nextReceiptNumber(scope),
      status: "generated",
      amountMinor,
      currency: invoice.currency,
      paymentAllocations: allocations,
      generatedByUserId: scope.actorUserId,
      generatedAt: now,
      voidedByUserId: null,
      voidedAt: null,
      voidReason: null
    };

    this.receipts.push(receipt);
    for (const payment of receiptablePayments) {
      payment.receiptId = receipt.id;
      payment.updatedAt = now;
    }
    this.timelineItems.push(
      this.#timeline(scope, invoice.patientId, "receipt_generated", "receipts", receipt.id, "Receipt generated", {
        invoiceId,
        receiptId: receipt.id,
        receiptNumber: receipt.receiptNumber,
        amountMinor
      })
    );

    return {
      invoiceDetail: this.invoiceDetail(scope, invoiceId),
      receipt
    };
  }

  replaceTreatmentPlanPhases(
    scope: RepositoryScope,
    plan: TreatmentPlanRecord,
    phases: CreateTreatmentPlanInput["phases"]
  ): void {
    if (phases.length === 0) {
      throw new Error("Treatment plan requires at least one phase.");
    }

    phases.forEach((phaseInput, phaseIndex) => {
      if (phaseInput.items.length === 0) {
        throw new Error("Treatment plan phases require at least one estimate item.");
      }

      const now = this.#nowIso();
      const phase: TreatmentPlanPhaseRecord = {
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        treatmentPlanId: plan.id,
        phaseIndex: phaseIndex + 1,
        title: phaseInput.title.trim(),
        description: phaseInput.description?.trim() || null,
        estimatedStartAfterDays: phaseInput.estimatedStartAfterDays ?? null,
        createdAt: now,
        updatedAt: now
      };
      this.treatmentPlanPhases.push(phase);

      for (const itemInput of phaseInput.items) {
        const pricebookProcedure = this.pricebookProcedures.find(
          (procedure) =>
            matchesScope(procedure, scope) &&
            procedure.id === itemInput.pricebookProcedureId &&
            procedure.status === "active"
        );
        if (!pricebookProcedure) {
          throw new Error("Pricebook procedure is not active or not available.");
        }

        if (itemInput.dentalFindingId) {
          const finding = this.dentalFindings.find(
            (candidate) =>
              matchesScope(candidate, scope) &&
              candidate.id === itemInput.dentalFindingId &&
              candidate.patientId === plan.patientId
          );
          if (!finding) {
            throw new Error("Dental finding does not belong to the treatment plan patient.");
          }
        }

        const quantity = itemInput.quantity ?? 1;
        const unitPriceMinor = itemInput.unitPriceMinor ?? pricebookProcedure.defaultUnitPriceMinor;
        const taxRateBasisPoints =
          itemInput.taxRateBasisPoints ?? pricebookProcedure.taxRateBasisPoints;
        const totals = calculateBillingLineTotals({
          quantity,
          unitPriceMinor,
          discountMinor: itemInput.discountMinor ?? 0,
          taxRateBasisPoints
        });
        const item: TreatmentPlanEstimateItemRecord = {
          id: uuid(),
          tenantId: scope.tenantId,
          clinicId: scope.clinicId,
          treatmentPlanId: plan.id,
          phaseId: phase.id,
          pricebookProcedureId: pricebookProcedure.id,
          dentalFindingId: itemInput.dentalFindingId ?? null,
          toothNumber: itemInput.toothNumber ? normalizeDentalToothNumber(itemInput.toothNumber) : null,
          quantity,
          unitPriceMinor,
          discountMinor: totals.discountMinor,
          taxRateBasisPoints,
          taxMinor: totals.taxMinor,
          totalMinor: totals.totalMinor,
          estimatedVisits: itemInput.estimatedVisits ?? 1,
          priority: itemInput.priority?.trim() || null,
          notes: itemInput.notes?.trim() || null,
          status: plan.status === "accepted" ? "accepted" : "planned",
          createdAt: now,
          updatedAt: now
        };
        this.treatmentPlanEstimateItems.push(item);
      }
    });
  }

  recalculateTreatmentPlanTotals(plan: TreatmentPlanRecord): void {
    const items = this.treatmentPlanEstimateItems.filter(
      (item) => item.tenantId === plan.tenantId && item.treatmentPlanId === plan.id
    );
    plan.subtotalMinor = items.reduce(
      (total, item) => total + item.unitPriceMinor * item.quantity,
      0
    );
    plan.discountMinor = items.reduce((total, item) => total + item.discountMinor, 0);
    plan.taxMinor = items.reduce((total, item) => total + item.taxMinor, 0);
    plan.totalMinor = items.reduce((total, item) => total + item.totalMinor, 0);
    plan.updatedAt = this.#nowIso();
  }

  labCaseDetail(scope: RepositoryScope, labCaseId: UUID): LabCaseDetail | null {
    const labCase = this.labCases.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === labCaseId
    );
    if (!labCase) return null;
    const vendor = this.labVendors.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === labCase.vendorId
    );
    if (!vendor) return null;
    return {
      labCase,
      vendor,
      items: this.labCaseItems
        .filter((item) => matchesScope(item, scope) && item.labCaseId === labCaseId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      statusHistory: this.labCaseStatusHistory
        .filter((history) => matchesScope(history, scope) && history.labCaseId === labCaseId)
        .sort((left, right) => left.changedAt.localeCompare(right.changedAt))
    };
  }

  labCaseHistory(
    scope: RepositoryScope,
    labCase: LabCaseRecord,
    fromStatus: LabCaseStatusHistoryRecord["fromStatus"],
    toStatus: LabCaseStatusHistoryRecord["toStatus"],
    reason: string | null,
    evidence: Record<string, unknown>
  ): LabCaseStatusHistoryRecord {
    return {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      labCaseId: labCase.id,
      patientId: labCase.patientId,
      fromStatus,
      toStatus,
      reason,
      evidence,
      changedByUserId: scope.actorUserId,
      changedAt: this.#nowIso()
    };
  }

  nextLabSlipNumber(scope: RepositoryScope): string {
    const next = this.labCases.filter((labCase) => matchesScope(labCase, scope)).length + 1;
    return `LAB-${this.#clinicDateKey()}-${String(next).padStart(4, "0")}`;
  }

  inventoryCheckRunDetail(scope: RepositoryScope, checkRunId: UUID): InventoryCheckRunDetail | null {
    const run = this.inventoryCheckRuns.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === checkRunId
    );
    if (!run) return null;
    const template = this.inventoryCheckTemplates.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === run.templateId
    );
    if (!template) return null;
    return {
      run,
      template,
      lines: this.inventoryCheckRunLines
        .filter((line) => matchesScope(line, scope) && line.checkRunId === checkRunId)
        .sort((left, right) => left.sequence - right.sequence),
      procurementSuggestions: this.procurementSuggestions
        .filter((suggestion) => matchesScope(suggestion, scope) && suggestion.sourceCheckRunId === checkRunId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    };
  }

  ensureProcurementSuggestion(
    scope: RepositoryScope,
    item: InventoryItemRecord,
    line: InventoryCheckRunLineRecord,
    checkRunId: UUID
  ): ProcurementSuggestionRecord {
    const existing = this.procurementSuggestions.find(
      (suggestion) =>
        matchesScope(suggestion, scope) &&
        suggestion.itemId === item.id &&
        suggestion.sourceCheckRunLineId === line.id &&
        suggestion.status === "suggested"
    );
    if (existing) return existing;

    const now = this.#nowIso();
    const suggestedQuantity = Math.max(item.reorderQuantity, item.minimumQuantity - (line.countedQuantity ?? 0));
    const suggestion: ProcurementSuggestionRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      itemId: item.id,
      sourceCheckRunId: checkRunId,
      sourceCheckRunLineId: line.id,
      status: "suggested",
      suggestedQuantity,
      reason: `${item.displayName} is below minimum stock after inventory check.`,
      taskId: null,
      evidence: {
        expectedQuantity: line.expectedQuantity,
        countedQuantity: line.countedQuantity,
        exceptionType: line.exceptionType,
        taskCreation: "suggested_not_created"
      },
      createdByUserId: scope.actorUserId,
      createdAt: now,
      updatedAt: now
    };
    this.procurementSuggestions.push(suggestion);
    return suggestion;
  }

  treatmentPlanDetail(scope: RepositoryScope, treatmentPlanId: UUID): TreatmentPlanDetail {
    const treatmentPlan = this.treatmentPlans.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === treatmentPlanId
    );
    if (!treatmentPlan) throw new Error("Treatment plan not found.");

    const phases = this.treatmentPlanPhases
      .filter((phase) => matchesScope(phase, scope) && phase.treatmentPlanId === treatmentPlanId)
      .sort((left, right) => left.phaseIndex - right.phaseIndex)
      .map((phase) => ({
        ...phase,
        estimateItems: this.treatmentPlanEstimateItems
          .filter((item) => matchesScope(item, scope) && item.phaseId === phase.id)
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      }));

    return { treatmentPlan, phases };
  }

  invoiceDetail(scope: RepositoryScope, invoiceId: UUID): InvoiceDetail {
    const invoice = this.invoices.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === invoiceId
    );
    if (!invoice) throw new Error("Invoice not found.");
    this.recalculateInvoicePaymentState(scope, invoice);

    return {
      invoice,
      items: this.invoiceItems
        .filter((item) => matchesScope(item, scope) && item.invoiceId === invoiceId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
      paymentRequests: this.paymentRequests
        .filter((request) => matchesScope(request, scope) && request.invoiceId === invoiceId)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
      payments: this.paymentTransactions
        .filter((payment) => matchesScope(payment, scope) && payment.invoiceId === invoiceId)
        .sort((left, right) => right.receivedAt.localeCompare(left.receivedAt)),
      receipts: this.receipts
        .filter((receipt) => matchesScope(receipt, scope) && receipt.invoiceId === invoiceId)
        .sort((left, right) => right.generatedAt.localeCompare(left.generatedAt))
    };
  }

  nextInvoiceNumber(scope: RepositoryScope): string {
    const next =
      this.invoices.filter((invoice) => matchesScope(invoice, scope)).length + 1;
    return `INV-${this.#clinicDateKey()}-${String(next).padStart(4, "0")}`;
  }

  nextReceiptNumber(scope: RepositoryScope): string {
    const next =
      this.receipts.filter((receipt) => matchesScope(receipt, scope)).length + 1;
    return `RCT-${this.#clinicDateKey()}-${String(next).padStart(4, "0")}`;
  }

  #nowIso(): string {
    return this.#clock.now().toISOString();
  }

  #clinicDateKey(): string {
    return clinicLocalDateFromClock(this.#clock, this.#clinicTimeZone).replace(/-/g, "");
  }

  #timeline(
    scope: RepositoryScope,
    patientId: UUID,
    itemType: PatientTimelineItem["itemType"],
    sourceTable: string,
    sourceId: UUID,
    title: string,
    metadata: Record<string, unknown> = {}
  ): PatientTimelineItem {
    return timelineAt(
      scope,
      patientId,
      itemType,
      sourceTable,
      sourceId,
      title,
      this.#nowIso(),
      metadata
    );
  }

  recalculateInvoicePaymentState(scope: RepositoryScope, invoice: InvoiceRecord): void {
    const payments = this.paymentTransactions.filter(
      (payment) => matchesScope(payment, scope) && payment.invoiceId === invoice.id
    );
    const hasPaymentRequest = this.paymentRequests.some(
      (request) => matchesScope(request, scope) && request.invoiceId === invoice.id
    );
    const hasReconciliationIssue = payments.some(
      (payment) =>
        payment.status === "reconciliation_required" ||
        payment.reconciliationStatus === "requires_review"
    );
    const paidMinor = payments
      .filter((payment) => isSettledPaymentTransaction(payment))
      .reduce((total, payment) => total + payment.amountMinor, 0);
    const refundedMinor = payments
      .filter((payment) => payment.status === "refunded")
      .reduce((total, payment) => total + payment.amountMinor, 0);

    invoice.paidMinor = paidMinor;
    invoice.refundedMinor = refundedMinor;
    invoice.balanceMinor = Math.max(invoice.totalMinor - paidMinor + refundedMinor, 0);
    invoice.paymentStatus = calculateInvoicePaymentStatus({
      totalMinor: invoice.totalMinor,
      paidMinor,
      refundedMinor,
      hasPaymentRequest,
      hasReconciliationIssue,
      invoiceStatus: invoice.status
    });
    invoice.updatedAt = this.#nowIso();
  }

  nextClinicalNoteVersion(scope: RepositoryScope, encounterId: UUID): number {
    return (
      Math.max(
        0,
        ...this.clinicalNoteVersions
          .filter((note) => matchesScope(note, scope) && note.encounterId === encounterId)
          .map((note) => note.versionNumber)
      ) + 1
    );
  }

  ensureDentalChart(scope: RepositoryScope, patientId: UUID): DentalChartRecord | null {
    const patient = this.patients.find(
      (candidate) => matchesScope(candidate, scope) && candidate.id === patientId
    );
    if (!patient) return null;

    let chart = this.dentalCharts.find(
      (candidate) => matchesScope(candidate, scope) && candidate.patientId === patientId
    );
    if (!chart) {
      const now = this.#nowIso();
      chart = {
        id: uuid(),
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        patientId,
        numberingSystem: "fdi",
        createdByUserId: scope.actorUserId,
        updatedByUserId: null,
        createdAt: now,
        updatedAt: now
      };
      this.dentalCharts.push(chart);
    }

    return chart;
  }

  nextDentalSnapshotVersion(scope: RepositoryScope, patientId: UUID): number {
    return (
      Math.max(
        0,
        ...this.dentalChartSnapshots
          .filter((snapshot) => matchesScope(snapshot, scope) && snapshot.patientId === patientId)
          .map((snapshot) => snapshot.snapshotVersion)
      ) + 1
    );
  }

  appendDentalFindingHistory(
    scope: RepositoryScope,
    finding: DentalFindingRecord,
    input: {
      changeType: DentalFindingHistoryRecord["changeType"];
      reason: string | null;
      beforeState: DentalFindingHistoryRecord["beforeState"];
      provenance: Record<string, unknown>;
    }
  ): DentalFindingHistoryRecord {
    const history: DentalFindingHistoryRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      findingId: finding.id,
      patientId: finding.patientId,
      encounterId: finding.encounterId,
      changeType: input.changeType,
      changedByUserId: scope.actorUserId,
      changedAt: this.#nowIso(),
      reason: input.reason,
      beforeState: input.beforeState,
      afterState: toDentalFindingSnapshotFinding(finding),
      provenance: input.provenance
    };
    this.dentalFindingHistory.push(history);
    return history;
  }

  #migrationBatchDetail(scope: RepositoryScope, batch: MigrationBatchRecord): MigrationBatchDetail {
    const rows = this.migrationRows
      .filter((row) => matchesScope(row, scope) && row.batchId === batch.id)
      .sort((left, right) => left.rowNumber - right.rowNumber)
      .map((row) => this.#migrationRowWithConflicts(scope, row));
    const conflicts = this.migrationConflicts
      .filter((conflict) => matchesScope(conflict, scope) && conflict.batchId === batch.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return { batch, rows, conflicts };
  }

  #migrationRowWithConflicts(scope: RepositoryScope, row: MigrationRowRecord): MigrationRowRecord {
    return {
      ...row,
      rawPayloadRef: { ...row.rawPayloadRef },
      conflicts: this.migrationConflicts
        .filter((conflict) => matchesScope(conflict, scope) && conflict.rowId === row.id)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    };
  }

  #refreshMigrationBatchCounts(batch: MigrationBatchRecord): void {
    const rows = this.migrationRows.filter(
      (row) =>
        row.tenantId === batch.tenantId &&
        row.clinicId === batch.clinicId &&
        row.batchId === batch.id
    );
    const openConflictRowIds = new Set(
      this.migrationConflicts
        .filter(
          (conflict) =>
            conflict.tenantId === batch.tenantId &&
            conflict.clinicId === batch.clinicId &&
            conflict.batchId === batch.id &&
            conflict.status === "open"
        )
        .map((conflict) => conflict.rowId)
    );

    batch.rowCount = rows.length;
    batch.validRowCount = rows.filter((row) => row.status !== "invalid").length;
    batch.invalidRowCount = rows.filter((row) => row.status === "invalid").length;
    batch.conflictRowCount = openConflictRowIds.size;
    batch.readyRowCount = rows.filter((row) => row.status === "ready_to_commit").length;
    batch.committedRowCount = rows.filter((row) => row.status === "committed").length;
    batch.rolledBackRowCount = rows.filter((row) => row.status === "rolled_back").length;
    batch.failedRowCount = rows.filter((row) => row.status === "failed").length;

    if (!["committed", "partially_committed", "rolled_back", "failed"].includes(batch.state)) {
      if (batch.conflictRowCount > 0) batch.state = "needs_review";
      else if (batch.readyRowCount > 0) batch.state = "ready_to_commit";
      else batch.state = rows.length > 0 ? "validated" : "uploaded";
    }
    batch.updatedAt = this.#nowIso();
  }

  #createMigrationCommit(
    scope: RepositoryScope,
    batchId: UUID,
    action: MigrationCommitRecord["action"],
    status: MigrationCommitRecord["status"],
    idempotencyKey: string | null,
    summary: Record<string, unknown>,
    errorSummary: Record<string, unknown> | null
  ): MigrationCommitRecord {
    const now = this.#nowIso();
    const commit: MigrationCommitRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      batchId,
      action,
      status,
      idempotencyKey,
      requestedByUserId: scope.actorUserId,
      summary,
      errorSummary,
      startedAt: now,
      finishedAt: now
    };
    this.migrationCommits.push(commit);
    return commit;
  }

  #findExistingMigrationCommit(
    scope: RepositoryScope,
    batchId: UUID,
    action: MigrationCommitRecord["action"],
    idempotencyKey?: string | null
  ): MigrationCommitRecord | null {
    if (!idempotencyKey) return null;
    return (
      this.migrationCommits.find(
        (commit) =>
          matchesScope(commit, scope) &&
          commit.batchId === batchId &&
          commit.action === action &&
          commit.idempotencyKey === idempotencyKey
      ) ?? null
    );
  }

  #latestMigrationCommit(
    scope: RepositoryScope,
    batchId: UUID,
    action: MigrationCommitRecord["action"]
  ): MigrationCommitRecord | null {
    return (
      this.migrationCommits
        .filter((commit) => matchesScope(commit, scope) && commit.batchId === batchId && commit.action === action)
        .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0] ?? null
    );
  }

  #createImportedRecordLink(
    scope: RepositoryScope,
    batch: MigrationBatchRecord,
    row: MigrationRowRecord,
    targetRecordId: UUID,
    linkType: ImportedRecordLinkRecord["linkType"]
  ): ImportedRecordLinkRecord {
    const existing = this.importedRecordLinks.find(
      (link) =>
        matchesScope(link, scope) &&
        link.batchId === batch.id &&
        link.rowId === row.id &&
        link.targetRecordType === "patient" &&
        link.targetRecordId === targetRecordId
    );
    if (existing) return existing;

    const now = this.#nowIso();
    const link: ImportedRecordLinkRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      batchId: batch.id,
      rowId: row.id,
      importType: batch.importType,
      sourceSystem: batch.sourceSystem,
      externalRecordId: row.externalRecordId,
      targetRecordType: "patient",
      targetRecordId,
      linkType,
      verificationStatus: "imported_unverified",
      verifiedByUserId: null,
      verifiedAt: null,
      metadata: {
        rowNumber: row.rowNumber,
        resolutionAction: row.resolutionAction ?? "create_new"
      },
      createdByUserId: scope.actorUserId,
      createdAt: now,
      updatedAt: now
    };
    this.importedRecordLinks.push(link);
    return link;
  }

  #importedLinksForBatch(scope: RepositoryScope, batchId: UUID): ImportedRecordLinkRecord[] {
    return this.importedRecordLinks
      .filter((link) => matchesScope(link, scope) && link.batchId === batchId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  #patientHasRollbackBlockingDependencies(scope: RepositoryScope, patientId: UUID): boolean {
    return (
      this.appointments.some((record) => matchesScope(record, scope) && record.patientId === patientId) ||
      this.encounters.some((record) => matchesScope(record, scope) && record.patientId === patientId) ||
      this.intakeFormSubmissions.some((record) => matchesScope(record, scope) && record.patientId === patientId) ||
      this.consents.some((record) => matchesScope(record, scope) && record.patientId === patientId) ||
      this.dentalFindings.some((record) => matchesScope(record, scope) && record.patientId === patientId) ||
      this.mediaAssets.some((record) => matchesScope(record, scope) && record.patientId === patientId) ||
      this.treatmentPlans.some((record) => matchesScope(record, scope) && record.patientId === patientId) ||
      this.proceduresPerformed.some((record) => matchesScope(record, scope) && record.patientId === patientId) ||
      this.invoices.some((record) => matchesScope(record, scope) && record.patientId === patientId) ||
      this.labCases.some((record) => matchesScope(record, scope) && record.patientId === patientId) ||
      this.incidents.some((record) => matchesScope(record, scope) && record.patientId === patientId)
    );
  }
}

export function createLocalFixtureClaims(input: {
  subject: string;
  expectedIssuer: string;
  acceptedAudience: string;
  now?: Date;
}): KeycloakAccessTokenClaims {
  const seedUser = CHECKPOINT1_SEED_USERS.find(
    (candidate) => candidate.keycloakSubject === input.subject
  );
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const claims: KeycloakAccessTokenClaims = {
    sub: input.subject,
    iss: input.expectedIssuer,
    aud: input.acceptedAudience,
    azp: input.acceptedAudience,
    exp: nowSeconds + 15 * 60,
    iat: nowSeconds,
    email_verified: true
  };

  if (seedUser) {
    claims.email = seedUser.email;
    claims.name = seedUser.displayName;
    claims.preferred_username = seedUser.email;
    claims.realm_access = { roles: [seedUser.roleSlug] };
  }

  return claims;
}

function uuid(): UUID {
  return randomUUID() as UUID;
}

function cp6Id(suffix: string): UUID {
  return `60000000-0000-4000-8000-00000000${suffix}` as UUID;
}

function uuidOrNull(value: string | null | undefined): UUID | null {
  if (!value || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i.test(value)) {
    return null;
  }
  return value as UUID;
}

function matchesScope(record: { tenantId: UUID; clinicId: UUID }, scope: RepositoryScope): boolean {
  return record.tenantId === scope.tenantId && record.clinicId === scope.clinicId;
}

function removeWhere<T>(items: T[], predicate: (item: T) => boolean): void {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) items.splice(index, 1);
  }
}

function taskSortKey(task: TaskRecord): string {
  const priorityRank = { urgent: "1", high: "2", normal: "3", low: "4" }[task.priority];
  return `${priorityRank}:${task.dueAt ?? "9999-12-31T23:59:59.999Z"}:${task.updatedAt}`;
}

function sopDueAtForAsOf(schedule: SopScheduleRecord, asOf: Date): string | null {
  const asOfDate = clinicLocalDate(asOf, schedule.timezone);
  const localDay = new Date(`${asOfDate}T00:00:00.000Z`);
  if (asOfDate < schedule.startsOn) return null;
  if (schedule.endsOn && asOfDate > schedule.endsOn) return null;

  const dayMatches =
    schedule.recurrenceType === "daily" ||
    (schedule.recurrenceType === "weekly" && localDay.getUTCDay() === schedule.dayOfWeek) ||
    (schedule.recurrenceType === "monthly" && localDay.getUTCDate() === schedule.dayOfMonth) ||
    (schedule.recurrenceType === "interval_days" &&
      schedule.intervalDays !== null &&
      daysBetween(schedule.startsOn, asOfDate) % schedule.intervalDays === 0);
  if (!dayMatches) return null;

  try {
    return clinicLocalDateTimeToInstant(asOfDate, schedule.dueTime, schedule.timezone).toISOString();
  } catch {
    return null;
  }
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.floor((end - start) / 86_400_000);
}

function mergeOwnerDashboardProjectionData(
  left: OwnerDashboardProjectionData,
  right: OwnerDashboardProjectionData
): OwnerDashboardProjectionData {
  return {
    patients: [...left.patients, ...right.patients],
    leads: [...left.leads, ...right.leads],
    appointments: [...left.appointments, ...right.appointments],
    encounters: [...left.encounters, ...right.encounters],
    attributionTouches: [...left.attributionTouches, ...right.attributionTouches],
    treatmentPlans: [...left.treatmentPlans, ...right.treatmentPlans],
    procedures: [...left.procedures, ...right.procedures],
    invoices: [...left.invoices, ...right.invoices],
    payments: [...left.payments, ...right.payments],
    recalls: [...left.recalls, ...right.recalls],
    tasks: [...left.tasks, ...right.tasks],
    sopRuns: [...left.sopRuns, ...right.sopRuns],
    labCases: [...left.labCases, ...right.labCases],
    inventoryExceptions: [...left.inventoryExceptions, ...right.inventoryExceptions],
    incidents: [...left.incidents, ...right.incidents],
    correctiveActions: [...left.correctiveActions, ...right.correctiveActions],
    dataSources: [...left.dataSources, ...right.dataSources]
  };
}

function timelineAt(
  scope: RepositoryScope,
  patientId: UUID,
  itemType: PatientTimelineItem["itemType"],
  sourceTable: string,
  sourceId: UUID,
  title: string,
  occurredAt: string,
  metadata: Record<string, unknown> = {}
): PatientTimelineItem {
  return {
    id: uuid(),
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    patientId,
    itemType,
    sourceTable,
    sourceId,
    occurredAt,
    title,
    summary: null,
    metadata
  };
}

type NormalizedDentalFindingInput = Omit<
  Required<CreateDentalFindingInput>,
  "surface" | "toothNumber"
> & {
  surface: DentalSurface | null;
  toothNumber: DentalToothNumber;
};

function normalizeFixtureCreateDentalFindingInput(
  input: CreateDentalFindingInput
): NormalizedDentalFindingInput {
  const normalized = {
    encounterId: input.encounterId ?? null,
    toothNumber: normalizeDentalToothNumber(input.toothNumber),
    surface: normalizeDentalSurface(input.surface),
    findingType: input.findingType,
    severity: input.severity?.trim() || null,
    status: input.status ?? "active",
    reviewStatus: input.reviewStatus ?? "needs_review",
    source: input.source ?? "manual",
    confidence: input.confidence ?? null,
    notes: input.notes?.trim() || null,
    provenance: input.provenance ?? {},
    treatmentReference: input.treatmentReference ?? {}
  };

  assertValidDentalFinding(normalized);
  return normalized;
}

function normalizeFixtureUpdateDentalFindingInput(
  existing: DentalFindingRecord,
  input: UpdateDentalFindingRepositoryInput
): NormalizedDentalFindingInput {
  const normalized = {
    encounterId: input.encounterId === undefined ? existing.encounterId : input.encounterId,
    toothNumber: normalizeDentalToothNumber(input.toothNumber ?? existing.toothNumber),
    surface:
      input.surface === undefined
        ? existing.surface
        : normalizeDentalSurface(input.surface),
    findingType: input.findingType ?? existing.findingType,
    severity: input.severity === undefined ? existing.severity : input.severity?.trim() || null,
    status: input.status ?? existing.status,
    reviewStatus: input.reviewStatus ?? existing.reviewStatus,
    source: input.source ?? existing.source,
    confidence: input.confidence === undefined ? existing.confidence : input.confidence,
    notes: input.notes === undefined ? existing.notes : input.notes?.trim() || null,
    provenance: input.provenance ?? existing.provenance,
    treatmentReference: input.treatmentReference ?? existing.treatmentReference
  };

  assertValidDentalFinding(normalized);
  return normalized;
}

function advanceFixtureRowVersion(record: { rowVersion: number }): void {
  if (!Number.isSafeInteger(record.rowVersion) || record.rowVersion < 1) {
    throw new Error("Fixture rowVersion must be a positive safe integer.");
  }
  if (record.rowVersion === Number.MAX_SAFE_INTEGER) {
    throw new Error("Fixture rowVersion cannot advance beyond the safe integer limit.");
  }
  record.rowVersion += 1;
}
