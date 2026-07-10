import { createHash, randomUUID } from "node:crypto";
import type {
  AppointmentConflict,
  AppointmentRecord,
  AppointmentStatus,
  AppointmentTypeRecord,
  AuditEventForReviewRecord,
  AuditReviewRecord,
  AiActionProposalRecord,
  AiDraftOutputRecord,
  AiJobRecord,
  AiReviewDecisionRecord,
  AiSessionDetail,
  AiSessionRecord,
  AiSourceAnchorRecord,
  AiTranscriptSegmentRecord,
  AttributionTouchRecord,
  BreakGlassAccessRecord,
  ChairOrRoomRecord,
  ClinicalNoteVersionRecord,
  Clinic,
  ClinicAssignment,
  ClinicUser,
  Clock,
  ConsentEnforcementState,
  ConsentRecord,
  AcceptTreatmentPlanInput,
  CorrectiveActionRecord,
  DeletionRequestRecord,
  CreateTreatmentPlanInput,
  CreateDentalFindingInput,
  DentalChartRecord,
  DentalChartSnapshotRecord,
  DentalChartView,
  DentalFindingHistoryRecord,
  DentalFindingRecord,
  EncounterRecord,
  InvoiceDetail,
  InvoiceItemRecord,
  InvoiceRecord,
  IncidentRecord,
  InventoryCategoryRecord,
  InventoryCheckRunDetail,
  InventoryCheckRunLineRecord,
  InventoryCheckRunRecord,
  InventoryCheckTemplateLineRecord,
  InventoryCheckTemplateRecord,
  InventoryExceptionRecord,
  InventoryItemRecord,
  IntakeFormSubmissionRecord,
  IntakeFormTemplateRecord,
  LabCaseDetail,
  LabCaseItemRecord,
  LabCaseRecord,
  LabCaseStatusHistoryRecord,
  LabReconciliationDetail,
  LabReconciliationEntryRecord,
  LabReconciliationRecord,
  LabVendorRecord,
  LeadRecord,
  MediaAssetRecord,
  MediaScanStatus,
  MediaStorageProviderKey,
  MediaUploadReservationRecord,
  ImportedRecordLinkRecord,
  IntegrationDeadLetterRecord,
  MigrationBatchDetail,
  MigrationBatchRecord,
  MigrationCommitRecord,
  MigrationCommitResult,
  MigrationConflictRecord,
  MigrationRollbackResult,
  MigrationRowRecord,
  OwnerDashboardProjectionData,
  PaymentRequestRecord,
  PaymentTransactionRecord,
  PatientRecordExportRecord,
  PatientRecordExportSection,
  PatientRecordExportSnapshot,
  PatientGender,
  PatientInstructionRecord,
  PatientRecord,
  PatientTimelineItem,
  PricebookProcedureRecord,
  PrescriptionRecord,
  ProcurementSuggestionRecord,
  ProcedurePerformedRecord,
  ProviderScheduleRecord,
  QueueEntryRecord,
  QueueStatus,
  RecallRecord,
  RecallRuleRecord,
  ReceiptRecord,
  RetentionActionRecord,
  RetentionRunRecord,
  RoleAssignment,
  SopRunDetail,
  SopRunItemRecord,
  SopRunItemStatus,
  SopRunRecord,
  SopRunStatus,
  SopScheduleRecord,
  SopTemplateDetail,
  SopTemplateItemRecord,
  SopTemplateRecord,
  StockLedgerEntryRecord,
  TaskRecord,
  Tenant,
  TenantMembership,
  TreatmentPlanDetail,
  TreatmentPlanEstimateItemRecord,
  TreatmentPlanPhaseRecord,
  TreatmentPlanRecord,
  UUID
} from "@clinic-os/domain";
import {
  addDaysIso,
  assertInvoiceReceiptable,
  assertSopRunCompletion,
  assertTaskCompletionEvidence,
  assertTaskTransition,
  assertFiniteQuantity,
  assertLabCaseTransition,
  assertDentalFindingUpdateReason,
  assertClinicalNoteCanBeAmended,
  assertClinicalNoteCanBeSigned,
  assertPrescriptionCanBeSigned,
  assertPositiveMinorCurrencyAmount,
  assertTreatmentPlanAcceptable,
  assertTreatmentPlanMutable,
  assertValidDentalFinding,
  assertSupportedSourceAnchors,
  buildDentalChartSnapshotState,
  buildPaymentFollowUpKey,
  buildPostOpFollowUpKey,
  buildRecallGenerationKey,
  buildSopRunGenerationKey,
  clinicLocalDateFromClock,
  calculateBillingLineTotals,
  calculateInvoicePaymentStatus,
  calculateInventoryVariance,
  classifyInventoryException,
  normalizeDentalSurface,
  normalizeDentalToothNumber,
  buildConsentEnforcementState,
  isSettledPaymentTransaction,
  mediaAssetStatusForScan,
  normalizeClinicalNoteContent,
  normalizePhone,
  toDentalFindingSnapshotFinding,
  systemClock
} from "@clinic-os/domain";
import { buildSetLocalIdentityRlsStatements, buildSetLocalRlsStatements } from "./rls.ts";
import {
  createScopedPostgresApiRequestGuards,
  type ScopedApiRequestGuardsPort
} from "./api-request-guards.ts";
import { createRepositoryPortTransactionLease } from "./modules/core/scoped-repository-port.ts";
import type {
  AppointmentConflictFilter,
  AppointmentSearchFilter,
  AmendClinicalNoteInput,
  AmendClinicalNoteResult,
  AiRetentionDeletionResult,
  ActiveBreakGlassAccessFilter,
  AuditEventSearchFilter,
  ClinicOperationsRepository,
  CreateInvoiceInput,
  CreateAuditReviewInput,
  CreateBreakGlassAccessInput,
  CreateDeletionRequestInput,
  CreateAiActionProposalInput,
  CreateAiDraftOutputInput,
  CreateAiJobInput,
  CreateAiSessionInput,
  CreateAiSourceAnchorInput,
  CreateAiTranscriptSegmentInput,
  CreatePaymentRequestInput,
  CreateProcedurePerformedInput,
  CreateReceiptInput,
  CreateDentalChartSnapshotInput,
  CreateAppointmentInput,
  CreateAttributionTouchInput,
  CreateConsentInput,
  CreateCorrectiveActionInput,
  CreateEncounterInput,
  CreateInventoryCategoryInput,
  CreateInventoryCheckRunInput,
  CreateInventoryCheckTemplateInput,
  CreateInventoryItemInput,
  CreateIncidentInput,
  CreateIntakeFormSubmissionInput,
  CreateIntakeFormTemplateInput,
  CreateLabCaseInput,
  CreateLabReconciliationInput,
  CreateLabVendorInput,
  CreateLeadInput,
  CreateMediaUploadReservationInput,
  CreateMigrationBatchInput,
  CreatePatientInput,
  CreatePatientInstructionInput,
  CreatePrescriptionInput,
  CreateRecallRuleInput,
  CreateSopScheduleInput,
  CreateSopTemplateInput,
  CreateStockLedgerEntryInput,
  CreateTaskInput,
  DateRangeFilter,
  DeletionRequestSearchFilter,
  DashboardDataSet,
  CommitMigrationBatchInput,
  GenerateDueContinuityInput,
  GenerateDueContinuityResult,
  GenerateDueSopRunsInput,
  GenerateDueSopRunsResult,
  CompleteMediaUploadInput,
  DentalFindingMutationResult,
  IdentityAccessSnapshot,
  IdentityRepository,
  IncidentSearchFilter,
  InventoryExceptionFilter,
  LabCaseSearchFilter,
  LeadSearchFilter,
  BreakGlassAccessSearchFilter,
  IntegrationDeadLetterSearchFilter,
  MigrationBatchSearchFilter,
  MigrationRowsFilter,
  OutboxEventInput,
  PatientSearchFilter,
  PatientRecordExportInput,
  PatientRecordExportSearchFilter,
  RecordAiReviewDecisionInput,
  RecordPaymentTransactionInput,
  RecordRecallActionInput,
  RecallSearchFilter,
  RepositoryScope,
  ReplayIntegrationDeadLetterInput,
  RevokeConsentInput,
  RetentionRunResult,
  ReviewBreakGlassAccessInput,
  ReviewDeletionRequestInput,
  ResolveMigrationRowInput,
  RollbackMigrationBatchInput,
  RunRetentionJobInput,
  SaveClinicalNoteDraftInput,
  SignClinicalNoteResult,
  SopRunSearchFilter,
  TaskSearchFilter,
  UpdateCorrectiveActionInput,
  UpdateDentalFindingRepositoryInput,
  UpdateInventoryCheckRunInput,
  UpdateLabCaseStatusInput,
  UpdateSopRunInput,
  UpdateTaskInput,
  UpdateTreatmentPlanInput,
  UpdatePatientInput
} from "./repositories.ts";

export interface SqlQueryResult<T = Record<string, unknown>> {
  rows: T[];
}

export interface SqlQueryClient {
  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<SqlQueryResult<T>>;
  release?(): void;
}

export interface SqlConnectionFactory extends SqlQueryClient {
  connect?(): Promise<SqlQueryClient>;
  inTransaction?: boolean;
}

export interface PersistableAuditEvent {
  id: string;
  tenantId: UUID;
  clinicId: UUID | null;
  actorType: string;
  actorId: string;
  action: string;
  category: string;
  riskLevel: string;
  phiInvolved: boolean;
  resourceType: string | null;
  resourceId: string | null;
  patientId: UUID | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
  correlationId: string | null;
  occurredAt: string;
}

export class PostgresIdentityRepository implements IdentityRepository {
  readonly #client: SqlConnectionFactory;

  constructor(client: SqlConnectionFactory) {
    this.#client = client;
  }

  async findAccessByKeycloakSubject(subject: string): Promise<IdentityAccessSnapshot | null> {
    return withTransaction(this.#client, async (client) => {
      for (const statement of buildSetLocalIdentityRlsStatements(subject)) {
        await client.query(statement.sql, statement.values);
      }
      const result = await client.query<IdentityAccessRow>(
        `
        select
          tenants.id as tenant_id,
          tenants.slug as tenant_slug,
          tenants.legal_name as tenant_legal_name,
          tenants.display_name as tenant_display_name,
          tenants.status as tenant_status,
          users.id as user_id,
          users.display_name as user_display_name,
          users.email as user_email,
          users.phone as user_phone,
          users.status as user_status,
          memberships.status as membership_status,
          clinics.id as clinic_id,
          clinics.slug as clinic_slug,
          clinics.display_name as clinic_display_name,
          clinics.status as clinic_status,
          clinics.timezone as clinic_timezone,
          clinic_user_assignments.status as clinic_assignment_status,
          roles.slug as role_slug,
          user_role_assignments.clinic_id as role_clinic_id
        from user_identities
        join users on users.id = user_identities.user_id
        join memberships on memberships.user_id = users.id
        join tenants on tenants.id = memberships.tenant_id
        join clinic_user_assignments on clinic_user_assignments.tenant_id = tenants.id
          and clinic_user_assignments.user_id = users.id
        join clinics on clinics.tenant_id = clinic_user_assignments.tenant_id
          and clinics.id = clinic_user_assignments.clinic_id
        left join user_role_assignments on user_role_assignments.tenant_id = tenants.id
          and user_role_assignments.user_id = users.id
          and user_role_assignments.revoked_at is null
        left join roles on roles.tenant_id = user_role_assignments.tenant_id
          and roles.id = user_role_assignments.role_id
        where user_identities.provider = 'keycloak'
          and user_identities.subject = $1
          and memberships.status = 'active'
        order by clinics.slug, roles.slug
      `,
        [subject]
      );

      if (result.rows.length === 0) return null;

      const first = result.rows[0];
      const tenant: Tenant = {
        id: first.tenant_id,
        slug: first.tenant_slug,
        legalName: first.tenant_legal_name,
        displayName: first.tenant_display_name,
        status: first.tenant_status
      };
      const user: ClinicUser = {
        id: first.user_id,
        displayName: first.user_display_name,
        email: first.user_email,
        phone: first.user_phone,
        status: first.user_status
      };

      const clinicById = new Map<UUID, Clinic>();
      const clinicAssignmentsById = new Map<UUID, ClinicAssignment>();
      const roleAssignments: RoleAssignment[] = [];

      for (const row of result.rows) {
        clinicById.set(row.clinic_id, {
          id: row.clinic_id,
          tenantId: row.tenant_id,
          slug: row.clinic_slug,
          displayName: row.clinic_display_name,
          status: row.clinic_status,
          timezone: row.clinic_timezone
        });
        clinicAssignmentsById.set(row.clinic_id, {
          tenantId: row.tenant_id,
          clinicId: row.clinic_id,
          userId: row.user_id,
          status: row.clinic_assignment_status
        });

        if (row.role_slug) {
          roleAssignments.push({
            tenantId: row.tenant_id,
            clinicId: row.role_clinic_id,
            userId: row.user_id,
            roleSlug: row.role_slug
          });
        }
      }

      return {
        tenant,
        user,
        memberships: [
          {
            tenantId: tenant.id,
            userId: user.id,
            status: first.membership_status
          }
        ],
        clinics: [...clinicById.values()],
        clinicAssignments: [...clinicAssignmentsById.values()],
        roleAssignments
      };
    });
  }
}

export class PostgresAuditEventSink {
  readonly #client: SqlConnectionFactory;

  constructor(client: SqlConnectionFactory) {
    this.#client = client;
  }

  async appendAuditEvent(event: PersistableAuditEvent): Promise<void> {
    const clinicId = event.clinicId;
    await withTransaction(this.#client, async (client) => {
      for (const statement of buildSetLocalRlsStatements({
        tenantId: event.tenantId,
        clinicId,
        userId: event.actorType === "user" ? (event.actorId as UUID) : null
      })) {
        await client.query(statement.sql, statement.values);
      }

      await client.query(
        `
          insert into audit_events (
            id,
            tenant_id,
            clinic_id,
            actor_type,
            actor_id,
            action,
            category,
            risk_level,
            phi_involved,
            resource_type,
            resource_id,
            patient_id,
            ip_address,
            user_agent,
            correlation_id,
            metadata,
            occurred_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::inet, $14, $15, $16::jsonb, $17)
        `,
        [
          event.id,
          event.tenantId,
          event.clinicId,
          event.actorType,
          event.actorId,
          event.action,
          event.category,
          event.riskLevel,
          event.phiInvolved,
          event.resourceType,
          event.resourceId,
          event.patientId,
          event.ipAddress,
          event.userAgent,
          event.correlationId,
          JSON.stringify(event.metadata),
          event.occurredAt
        ]
      );
    });
  }
}

export interface PostgresClinicUnitOfWorkContext {
  repository: PostgresClinicOperationsRepository;
  auditSink: PostgresAuditEventSink;
  requestGuards: ScopedApiRequestGuardsPort;
}

export class PostgresClinicUnitOfWork {
  readonly #client: SqlConnectionFactory;
  readonly #clock: Clock;

  constructor(client: SqlConnectionFactory, options: { clock?: Clock } = {}) {
    this.#client = client;
    this.#clock = options.clock ?? systemClock;
  }

  async run<T>(callback: (context: PostgresClinicUnitOfWorkContext) => Promise<T>): Promise<T> {
    return withTransaction(this.#client, async (client) => {
      const transactionClient = new TransactionBoundSqlClient(client);
      const requestGuardLease = createRepositoryPortTransactionLease();
      try {
        const result = await callback({
          repository: new PostgresClinicOperationsRepository(transactionClient, {
            clock: this.#clock
          }),
          auditSink: new PostgresAuditEventSink(transactionClient),
          requestGuards: createScopedPostgresApiRequestGuards(transactionClient, requestGuardLease)
        });
        await requestGuardLease.close();
        return result;
      } catch (error) {
        try {
          await requestGuardLease.close();
        } catch {
          // Preserve the first domain/database error while still draining transaction-bound work.
        }
        throw error;
      }
    });
  }
}

export class PostgresClinicOperationsRepository implements ClinicOperationsRepository {
  readonly #client: SqlConnectionFactory;
  readonly #clock: Clock;

  constructor(client: SqlConnectionFactory, options: { clock?: Clock } = {}) {
    this.#client = client;
    this.#clock = options.clock ?? systemClock;
  }

  async listPatients(
    scope: RepositoryScope,
    filter: PatientSearchFilter = {}
  ): Promise<PatientRecord[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = ["tenant_id = $1", "clinic_id = $2"];

      if (filter.query) {
        values.push(`%${filter.query.trim().toLowerCase()}%`);
        where.push(`lower(full_name) like $${values.length}`);
      }

      if (filter.phone) {
        values.push(normalizePhone(filter.phone));
        where.push(
          `regexp_replace(coalesce(phone, ''), '\\D', '', 'g') = regexp_replace($${values.length}, '\\D', '', 'g')`
        );
      }

      if (filter.source) {
        values.push(filter.source);
        where.push(`source = $${values.length}`);
      }

      values.push(Math.min(filter.limit ?? 50, 100));

      const result = await client.query<PatientRow>(
        `
          select *
          from patients
          where ${where.join(" and ")}
          order by updated_at desc
          limit $${values.length}
        `,
        values
      );

      return result.rows.map(mapPatientRow);
    });
  }

  async findPatientById(scope: RepositoryScope, patientId: UUID): Promise<PatientRecord | null> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<PatientRow>(
        `
          select *
          from patients
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [scope.tenantId, scope.clinicId, patientId]
      );

      return result.rows[0] ? mapPatientRow(result.rows[0]) : null;
    });
  }

  async findPatientTimeline(
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<PatientTimelineItem[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<PatientTimelineRow>(
        `
          select *
          from patient_timeline_items
          where tenant_id = $1 and clinic_id = $2 and patient_id = $3
          order by occurred_at desc
        `,
        [scope.tenantId, scope.clinicId, patientId]
      );

      return result.rows.map(mapTimelineRow);
    });
  }

  async findPatientDuplicateCandidates(
    scope: RepositoryScope,
    input: { fullName: string; phone: string }
  ): Promise<PatientRecord[]> {
    return this.#withRls(scope, async (client) => {
      const normalizedPhone = normalizePhone(input.phone);
      const firstNameToken = input.fullName.trim().toLowerCase().split(/\s+/)[0] ?? "";
      const result = await client.query<PatientRow>(
        `
          select distinct patients.*
          from patients
          left join patient_contacts on patient_contacts.tenant_id = patients.tenant_id
            and patient_contacts.patient_id = patients.id
          where patients.tenant_id = $1
            and patients.clinic_id = $2
            and (
              regexp_replace(coalesce(patients.phone, ''), '\\D', '', 'g') = regexp_replace($3, '\\D', '', 'g')
              or patient_contacts.normalized_value = $3
              or lower(patients.full_name) like $4
            )
          order by patients.updated_at desc
          limit 10
        `,
        [scope.tenantId, scope.clinicId, normalizedPhone, `${firstNameToken}%`]
      );

      return result.rows.map(mapPatientRow);
    });
  }

  async createPatient(scope: RepositoryScope, input: CreatePatientInput): Promise<PatientRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<PatientRow>(
        `
          insert into patients (
            tenant_id,
            clinic_id,
            full_name,
            phone,
            email,
            date_of_birth,
            gender,
            source,
            created_by_user_id,
            updated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.fullName.trim(),
          input.phone,
          input.email ?? null,
          input.dateOfBirth ?? null,
          input.gender ?? "unknown",
          input.source,
          scope.actorUserId
        ]
      );
      const patient = mapPatientRow(result.rows[0]);

      await client.query(
        `
          insert into patient_contacts (
            tenant_id,
            clinic_id,
            patient_id,
            contact_type,
            value,
            normalized_value,
            is_primary,
            source,
            created_by_user_id
          )
          values ($1, $2, $3, 'phone', $4, $5, true, $6, $7)
        `,
        [
          scope.tenantId,
          scope.clinicId,
          patient.id,
          input.phone,
          normalizePhone(input.phone),
          input.source,
          scope.actorUserId
        ]
      );

      await this.#appendTimeline(client, scope, {
        patientId: patient.id,
        itemType: "patient_created",
        sourceTable: "patients",
        sourceId: patient.id,
        title: "Patient registered",
        summary: `Registered from ${input.source}`,
        metadata: input.sourceDetail ?? {}
      });

      return patient;
    });
  }

  async updatePatient(
    scope: RepositoryScope,
    patientId: UUID,
    input: UpdatePatientInput
  ): Promise<PatientRecord | null> {
    return this.#withRls(scope, async (client) => {
      const existing = await this.#findPatientByIdInTransaction(client, scope, patientId);
      if (!existing) return null;

      const result = await client.query<PatientRow>(
        `
          update patients
          set
            full_name = coalesce($4, full_name),
            phone = $5,
            email = $6,
            date_of_birth = $7,
            gender = coalesce($8, gender),
            updated_by_user_id = $9
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          patientId,
          input.fullName ?? existing.fullName,
          input.phone ?? existing.phone,
          input.email ?? existing.email,
          input.dateOfBirth ?? existing.dateOfBirth,
          input.gender ?? existing.gender,
          scope.actorUserId
        ]
      );

      return result.rows[0] ? mapPatientRow(result.rows[0]) : null;
    });
  }

  async listAuditEvents(
    scope: RepositoryScope,
    filter: AuditEventSearchFilter = {}
  ): Promise<AuditEventForReviewRecord[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = [
        "audit_events.tenant_id = $1",
        "(audit_events.clinic_id is null or audit_events.clinic_id = $2)"
      ];

      if (filter.patientId) {
        values.push(filter.patientId);
        where.push(`audit_events.patient_id = $${values.length}`);
      }
      if (filter.action) {
        values.push(filter.action);
        where.push(`audit_events.action = $${values.length}`);
      }
      if (filter.category) {
        values.push(filter.category);
        where.push(`audit_events.category = $${values.length}`);
      }
      if (filter.riskLevel) {
        values.push(filter.riskLevel);
        where.push(`audit_events.risk_level = $${values.length}`);
      }

      values.push(Math.min(filter.limit ?? 50, 100));
      const result = await client.query<AuditEventReviewJoinedRow>(
        `
          select
            audit_events.*,
            audit_event_reviews.id as review_id,
            audit_event_reviews.clinic_id as review_clinic_id,
            audit_event_reviews.review_status,
            audit_event_reviews.disposition,
            audit_event_reviews.notes as review_notes,
            audit_event_reviews.reviewed_by_user_id,
            audit_event_reviews.reviewed_at,
            audit_event_reviews.created_at as review_created_at
          from audit_events
          left join lateral (
            select *
            from audit_event_reviews
            where audit_event_reviews.tenant_id = audit_events.tenant_id
              and audit_event_reviews.audit_event_id = audit_events.id
            order by audit_event_reviews.reviewed_at desc
            limit 1
          ) audit_event_reviews on true
          where ${where.join(" and ")}
          order by audit_events.occurred_at desc
          limit $${values.length}
        `,
        values
      );

      return result.rows.map(mapAuditEventForReviewRow);
    });
  }

  async createAuditReview(
    scope: RepositoryScope,
    auditEventId: UUID,
    input: CreateAuditReviewInput
  ): Promise<AuditReviewRecord | null> {
    return this.#withRls(scope, async (client) => {
      const event = await client.query<{ id: UUID }>(
        `
          select id
          from audit_events
          where tenant_id = $1
            and (clinic_id is null or clinic_id = $2)
            and id = $3
        `,
        [scope.tenantId, scope.clinicId, auditEventId]
      );
      if (!event.rows[0]) return null;

      const result = await client.query<AuditReviewRow>(
        `
          insert into audit_event_reviews (
            tenant_id,
            clinic_id,
            audit_event_id,
            review_status,
            disposition,
            notes,
            reviewed_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          auditEventId,
          input.reviewStatus,
          input.disposition,
          input.notes ?? null,
          scope.actorUserId
        ]
      );

      return mapAuditReviewRow(result.rows[0]);
    });
  }

  async buildPatientRecordExportSnapshot(
    scope: RepositoryScope,
    patientId: UUID,
    sections: PatientRecordExportSection[]
  ): Promise<PatientRecordExportSnapshot | null> {
    return this.#withRls(scope, async (client) => {
      const patient = await this.#findPatientByIdInTransaction(client, scope, patientId);
      if (!patient) return null;
      const sectionSet = new Set(sections);
      const now = this.#clock.now().toISOString();

      const [
        timeline,
        consents,
        intake,
        encounters,
        notes,
        prescriptions,
        instructions,
        chart,
        findings,
        findingHistory,
        chartSnapshots,
        media,
        invoices,
        paymentRequests,
        paymentTransactions,
        receipts,
        aiSessions,
        aiSourceAnchors,
        aiDraftOutputs,
        aiActionProposals,
        aiReviewDecisions,
        auditTrail
      ] = await Promise.all([
        sectionSet.has("timeline")
          ? client.query<PatientTimelineRow>(
              `select * from patient_timeline_items where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by occurred_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("consents")
          ? client.query<ConsentRow>(
              `select * from consents where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("intake")
          ? client.query<IntakeFormSubmissionRow>(
              `select * from form_responses where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by submitted_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("encounters")
          ? client.query<EncounterRow>(
              `select * from encounters where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("clinical_notes")
          ? client.query<ClinicalNoteVersionRow>(
              `select * from clinical_note_versions where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("prescriptions")
          ? client.query<PrescriptionRow>(
              `select * from prescriptions where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("instructions")
          ? client.query<PatientInstructionRow>(
              `select * from patient_instruction_requests where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("dental_chart")
          ? client.query<DentalChartRow>(
              `select * from dental_charts where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at asc limit 1`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("dental_chart")
          ? client.query<DentalFindingRow>(
              `select * from dental_findings where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("dental_chart")
          ? client.query<DentalFindingHistoryRow>(
              `
                select dental_finding_history.*
                from dental_finding_history
                join dental_findings on dental_findings.tenant_id = dental_finding_history.tenant_id
                  and dental_findings.id = dental_finding_history.finding_id
                where dental_finding_history.tenant_id = $1
                  and dental_finding_history.clinic_id = $2
                  and dental_findings.patient_id = $3
                order by dental_finding_history.changed_at desc
              `,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("dental_chart")
          ? client.query<DentalChartSnapshotRow>(
              `select * from dental_chart_snapshots where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("media")
          ? client.query<MediaAssetRow>(
              `select * from media_assets where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by uploaded_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("billing")
          ? client.query<InvoiceRow>(
              `select * from invoices where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by issued_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("billing")
          ? client.query<PaymentRequestRow>(
              `select * from payment_requests where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("billing")
          ? client.query<PaymentTransactionRow>(
              `select * from payment_transactions where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("billing")
          ? client.query<ReceiptRow>(
              `select * from receipts where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by generated_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("ai_evidence")
          ? client.query<AiSessionRow>(
              `select * from ai_sessions where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by started_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("ai_evidence")
          ? client.query<AiSourceAnchorRow>(
              `select * from ai_source_anchors where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("ai_evidence")
          ? client.query<AiDraftOutputRow>(
              `select * from ai_draft_outputs where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("ai_evidence")
          ? client.query<AiActionProposalRow>(
              `select * from ai_action_proposals where tenant_id = $1 and clinic_id = $2 and patient_id = $3 order by created_at desc`,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("ai_evidence")
          ? client.query<AiReviewDecisionRow>(
              `
                select ai_review_decisions.*
                from ai_review_decisions
                join ai_sessions on ai_sessions.tenant_id = ai_review_decisions.tenant_id
                  and ai_sessions.id = ai_review_decisions.session_id
                where ai_review_decisions.tenant_id = $1
                  and ai_review_decisions.clinic_id = $2
                  and ai_sessions.patient_id = $3
                order by ai_review_decisions.reviewed_at desc
              `,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] },
        sectionSet.has("privacy_audit")
          ? client.query<AuditEventReviewJoinedRow>(
              `
                select
                  audit_events.*,
                  audit_event_reviews.id as review_id,
                  audit_event_reviews.clinic_id as review_clinic_id,
                  audit_event_reviews.review_status,
                  audit_event_reviews.disposition,
                  audit_event_reviews.notes as review_notes,
                  audit_event_reviews.reviewed_by_user_id,
                  audit_event_reviews.reviewed_at,
                  audit_event_reviews.created_at as review_created_at
                from audit_events
                left join lateral (
                  select *
                  from audit_event_reviews
                  where audit_event_reviews.tenant_id = audit_events.tenant_id
                    and audit_event_reviews.audit_event_id = audit_events.id
                  order by audit_event_reviews.reviewed_at desc
                  limit 1
                ) audit_event_reviews on true
                where audit_events.tenant_id = $1
                  and (audit_events.clinic_id is null or audit_events.clinic_id = $2)
                  and audit_events.patient_id = $3
                order by audit_events.occurred_at desc
                limit 100
              `,
              [scope.tenantId, scope.clinicId, patientId]
            )
          : { rows: [] }
      ]);

      return {
        manifest: {
          schemaVersion: "cp9.patient_record_export.v1",
          generatedAt: now,
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
        consents: consents.rows.map(mapConsentRow),
        timeline: timeline.rows.map(mapTimelineRow),
        intakeSubmissions: intake.rows.map(mapIntakeFormSubmissionRow),
        encounters: encounters.rows.map(mapEncounterRow),
        clinicalNotes: notes.rows.map(mapClinicalNoteVersionRow),
        prescriptions: prescriptions.rows.map(mapPrescriptionRow),
        instructions: instructions.rows.map(mapPatientInstructionRow),
        dentalChart: {
          chart: chart.rows[0] ? mapDentalChartRow(chart.rows[0]) : null,
          findings: findings.rows.map(mapDentalFindingRow),
          findingHistory: findingHistory.rows.map(mapDentalFindingHistoryRow),
          snapshots: chartSnapshots.rows.map(mapDentalChartSnapshotRow)
        },
        mediaAssets: media.rows.map((row) => {
          const {
            objectKey: _objectKey,
            storageProvider: _storageProvider,
            storageRegion: _storageRegion,
            ...asset
          } = mapMediaAssetRow(row);
          return asset;
        }),
        billing: {
          invoices: invoices.rows.map(mapInvoiceRow),
          paymentRequests: paymentRequests.rows.map(mapPaymentRequestRow),
          paymentTransactions: paymentTransactions.rows.map(mapPaymentTransactionRow),
          receipts: receipts.rows.map(mapReceiptRow)
        },
        aiEvidence: {
          sessions: aiSessions.rows.map(mapAiSessionRow),
          sourceAnchors: aiSourceAnchors.rows.map(mapAiSourceAnchorRow),
          draftOutputs: aiDraftOutputs.rows.map(mapAiDraftOutputRow),
          actionProposals: aiActionProposals.rows.map(mapAiActionProposalRow),
          reviewDecisions: aiReviewDecisions.rows.map(mapAiReviewDecisionRow)
        },
        privacyAuditTrail: auditTrail.rows.map(mapAuditEventForReviewRow)
      };
    });
  }

  async createPatientRecordExport(
    scope: RepositoryScope,
    input: PatientRecordExportInput
  ): Promise<PatientRecordExportRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<PatientRecordExportRow>(
        `
          insert into data_exports (
            tenant_id,
            clinic_id,
            patient_id,
            status,
            format,
            sections,
            requested_by_user_id,
            completed_by_user_id,
            completed_at,
            manifest,
            export_payload,
            payload_digest
          )
          values ($1, $2, $3, 'completed', $4, $5, $6, $6, now(), $7::jsonb, $8::jsonb, $9)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.patientId,
          input.format,
          input.sections,
          scope.actorUserId,
          JSON.stringify(input.snapshot.manifest),
          JSON.stringify(input.snapshot),
          input.payloadDigest
        ]
      );

      return mapPatientRecordExportRow(result.rows[0]);
    });
  }

  async listPatientRecordExports(
    scope: RepositoryScope,
    filter: PatientRecordExportSearchFilter = {}
  ): Promise<PatientRecordExportRecord[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = ["tenant_id = $1", "clinic_id = $2"];
      if (filter.patientId) {
        values.push(filter.patientId);
        where.push(`patient_id = $${values.length}`);
      }
      if (filter.status) {
        values.push(filter.status);
        where.push(`status = $${values.length}`);
      }
      values.push(Math.min(filter.limit ?? 25, 100));
      const result = await client.query<PatientRecordExportRow>(
        `
          select *
          from data_exports
          where ${where.join(" and ")}
          order by requested_at desc
          limit $${values.length}
        `,
        values
      );
      return result.rows.map(mapPatientRecordExportRow);
    });
  }

  async createDeletionRequest(
    scope: RepositoryScope,
    input: CreateDeletionRequestInput
  ): Promise<DeletionRequestRecord | null> {
    return this.#withRls(scope, async (client) => {
      const patient = await this.#findPatientByIdInTransaction(client, scope, input.patientId);
      if (!patient) return null;
      const requestScope = {
        requestedCategories: input.requestedCategories,
        protectedClinicalRecords: "not_deleted",
        protectedAuditRecords: "not_deleted"
      };
      const result = await client.query<DeletionRequestRow>(
        `
          insert into deletion_requests (
            tenant_id,
            clinic_id,
            patient_id,
            request_type,
            status,
            reason,
            requested_by_user_id,
            scope
          )
          values ($1, $2, $3, $4, 'requested', $5, $6, $7::jsonb)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.patientId,
          input.requestType,
          input.reason,
          scope.actorUserId,
          JSON.stringify(requestScope)
        ]
      );
      return mapDeletionRequestRow(result.rows[0]);
    });
  }

  async listDeletionRequests(
    scope: RepositoryScope,
    filter: DeletionRequestSearchFilter = {}
  ): Promise<DeletionRequestRecord[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = ["tenant_id = $1", "clinic_id = $2"];
      if (filter.patientId) {
        values.push(filter.patientId);
        where.push(`patient_id = $${values.length}`);
      }
      if (filter.status) {
        values.push(filter.status);
        where.push(`status = $${values.length}`);
      }
      values.push(Math.min(filter.limit ?? 50, 100));
      const result = await client.query<DeletionRequestRow>(
        `select * from deletion_requests where ${where.join(" and ")} order by requested_at desc limit $${values.length}`,
        values
      );
      return result.rows.map(mapDeletionRequestRow);
    });
  }

  async findDeletionRequestById(
    scope: RepositoryScope,
    requestId: UUID
  ): Promise<DeletionRequestRecord | null> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<DeletionRequestRow>(
        `
          select *
          from deletion_requests
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [scope.tenantId, scope.clinicId, requestId]
      );
      return result.rows[0] ? mapDeletionRequestRow(result.rows[0]) : null;
    });
  }

  async reviewDeletionRequest(
    scope: RepositoryScope,
    requestId: UUID,
    input: ReviewDeletionRequestInput
  ): Promise<DeletionRequestRecord | null> {
    return this.#withRls(scope, async (client) => {
      const nextStatus =
        input.decision === "approve"
          ? "approved_pending_retention_job"
          : input.decision === "cancel"
            ? "cancelled"
            : "rejected";
      const result = await client.query<DeletionRequestRow>(
        `
          update deletion_requests
          set
            status = $4,
            reviewed_by_user_id = $5,
            reviewed_at = now(),
            review_reason = $6
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          requestId,
          nextStatus,
          scope.actorUserId,
          input.reviewReason
        ]
      );
      return result.rows[0] ? mapDeletionRequestRow(result.rows[0]) : null;
    });
  }

  async runRetentionJob(
    scope: RepositoryScope,
    input: RunRetentionJobInput
  ): Promise<RetentionRunResult> {
    return this.#withRls(scope, async (client) => {
      const runResult = await client.query<RetentionRunRow>(
        `
          insert into retention_job_runs (
            tenant_id,
            clinic_id,
            mode,
            status,
            policy_code,
            as_of,
            deletion_request_id,
            started_by_user_id,
            completed_at,
            summary
          )
          values ($1, $2, $3, 'completed', $4, $5, $6, $7, now(), '{}'::jsonb)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.mode,
          input.policyCode,
          input.asOf,
          input.deletionRequestId ?? null,
          scope.actorUserId
        ]
      );
      const runId = runResult.rows[0].id;
      const cutoff = new Date(
        new Date(input.asOf).getTime() - input.transcriptDeleteAfterDays * 24 * 60 * 60 * 1000
      ).toISOString();
      const eligible = await client.query<AiSessionRow>(
        `
          select *
          from ai_sessions
          where tenant_id = $1
            and clinic_id = $2
            and status <> 'retention_deleted'
            and started_at <= $3
            and ($4::uuid is null or patient_id = $4)
          order by started_at asc
        `,
        [scope.tenantId, scope.clinicId, cutoff, input.patientId ?? null]
      );
      const actions: RetentionActionRecord[] = [];

      for (const sessionRow of eligible.rows) {
        const session = mapAiSessionRow(sessionRow);
        const segmentCount = await client.query<{ count: string }>(
          `
            select count(*)::text as count
            from ai_transcript_segments
            where tenant_id = $1 and clinic_id = $2 and session_id = $3
          `,
          [scope.tenantId, scope.clinicId, session.id]
        );
        if (input.mode === "execute") {
          await client.query(
            `
              delete from ai_transcript_segments
              where tenant_id = $1 and clinic_id = $2 and session_id = $3
            `,
            [scope.tenantId, scope.clinicId, session.id]
          );
          await client.query(
            `
              update ai_sessions
              set status = 'retention_deleted',
                  raw_audio_deleted_at = coalesce(raw_audio_deleted_at, now()),
                  transcript_deleted_at = coalesce(transcript_deleted_at, now())
              where tenant_id = $1 and clinic_id = $2 and id = $3
            `,
            [scope.tenantId, scope.clinicId, session.id]
          );
        }
        const actionRow = await client.query<RetentionActionRow>(
          `
            insert into retention_actions (
              tenant_id,
              clinic_id,
              run_id,
              patient_id,
              action_kind,
              status,
              target_type,
              target_id,
              protected_record,
              evidence,
              completed_at
            )
            values ($1, $2, $3, $4, 'ai_transcript_delete', $5, 'ai_session', $6, false, $7::jsonb, case when $5 = 'completed' then now() else null end)
            returning *
          `,
          [
            scope.tenantId,
            scope.clinicId,
            runId,
            session.patientId,
            input.mode === "execute" ? "completed" : "planned",
            session.id,
            JSON.stringify({
              transcriptSegmentCount: Number(segmentCount.rows[0]?.count ?? 0),
              policyCode: input.policyCode,
              mode: input.mode
            })
          ]
        );
        actions.push(mapRetentionActionRow(actionRow.rows[0]));
      }

      for (const protectedTarget of ["clinical_records", "audit_events"] as const) {
        const actionRow = await client.query<RetentionActionRow>(
          `
            insert into retention_actions (
              tenant_id,
              clinic_id,
              run_id,
              patient_id,
              action_kind,
              status,
              target_type,
              target_id,
              protected_record,
              evidence
            )
            values ($1, $2, $3, $4, $5, 'skipped', $6, $7, true, $8::jsonb)
            returning *
          `,
          [
            scope.tenantId,
            scope.clinicId,
            runId,
            input.patientId ?? null,
            protectedTarget === "clinical_records"
              ? "protected_clinical_record_skipped"
              : "protected_audit_record_skipped",
            protectedTarget,
            input.patientId ?? scope.clinicId,
            JSON.stringify({
              reason:
                "Protected clinical and audit records are never deleted by CP9 retention jobs.",
              deletionRequestId: input.deletionRequestId ?? null
            })
          ]
        );
        actions.push(mapRetentionActionRow(actionRow.rows[0]));
      }

      const summary = {
        eligibleTransientPayloads: eligible.rows.length,
        completedActions: actions.filter((action) => action.status === "completed").length,
        protectedRecordsSkipped: actions.filter((action) => action.protectedRecord).length
      };
      const updatedRun = await client.query<RetentionRunRow>(
        `
          update retention_job_runs
          set summary = $4::jsonb
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, runId, JSON.stringify(summary)]
      );

      if (input.mode === "execute" && input.deletionRequestId) {
        await client.query(
          `
            update deletion_requests
            set status = 'completed',
                updated_at = now()
            where tenant_id = $1
              and clinic_id = $2
              and id = $3
              and status = 'approved_pending_retention_job'
          `,
          [scope.tenantId, scope.clinicId, input.deletionRequestId]
        );
      }

      return { run: mapRetentionRunRow(updatedRun.rows[0]), actions };
    });
  }

  async createBreakGlassAccessRequest(
    scope: RepositoryScope,
    input: CreateBreakGlassAccessInput
  ): Promise<BreakGlassAccessRecord | null> {
    return this.#withRls(scope, async (client) => {
      const patient = await this.#findPatientByIdInTransaction(client, scope, input.patientId);
      if (!patient) return null;
      const result = await client.query<BreakGlassAccessRow>(
        `
          insert into break_glass_accesses (
            tenant_id,
            clinic_id,
            user_id,
            patient_id,
            reason,
            status,
            expires_at,
            access_categories,
            access_scope
          )
          values ($1, $2, $3, $4, $5, 'requested', $6, $7, $8::jsonb)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          scope.actorUserId,
          input.patientId,
          input.reason,
          input.expiresAt,
          input.accessCategories,
          JSON.stringify({
            patientId: input.patientId,
            resourceTypes: input.accessCategories,
            clinicalJustification: input.reason
          })
        ]
      );
      return mapBreakGlassAccessRow(result.rows[0]);
    });
  }

  async listBreakGlassAccessRequests(
    scope: RepositoryScope,
    filter: BreakGlassAccessSearchFilter = {}
  ): Promise<BreakGlassAccessRecord[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = ["tenant_id = $1", "clinic_id = $2"];
      if (filter.patientId) {
        values.push(filter.patientId);
        where.push(`patient_id = $${values.length}`);
      }
      if (filter.status) {
        values.push(filter.status);
        where.push(`status = $${values.length}`);
      }
      if (filter.requestedByUserId) {
        values.push(filter.requestedByUserId);
        where.push(`user_id = $${values.length}`);
      }
      values.push(Math.min(filter.limit ?? 50, 100));
      const result = await client.query<BreakGlassAccessRow>(
        `select * from break_glass_accesses where ${where.join(" and ")} order by requested_at desc limit $${values.length}`,
        values
      );
      return result.rows.map(mapBreakGlassAccessRow);
    });
  }

  async reviewBreakGlassAccessRequest(
    scope: RepositoryScope,
    requestId: UUID,
    input: ReviewBreakGlassAccessInput
  ): Promise<BreakGlassAccessRecord | null> {
    return this.#withRls(scope, async (client) => {
      const nextStatus =
        input.decision === "approve"
          ? "approved"
          : input.decision === "revoke"
            ? "revoked"
            : "denied";
      const result = await client.query<BreakGlassAccessRow>(
        `
          update break_glass_accesses
          set
            status = $4,
            approved_by_user_id = case when $4 = 'approved' then $5 else approved_by_user_id end,
            approved_at = case when $4 = 'approved' then now() else approved_at end,
            reviewed_by_user_id = $5,
            reviewed_at = now(),
            review_reason = $6,
            revoked_at = case when $4 = 'revoked' then now() else revoked_at end
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          requestId,
          nextStatus,
          scope.actorUserId,
          input.reviewReason
        ]
      );
      return result.rows[0] ? mapBreakGlassAccessRow(result.rows[0]) : null;
    });
  }

  async findActiveBreakGlassAccess(
    scope: RepositoryScope,
    filter: ActiveBreakGlassAccessFilter
  ): Promise<BreakGlassAccessRecord | null> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<BreakGlassAccessRow>(
        `
          select *
          from break_glass_accesses
          where tenant_id = $1
            and clinic_id = $2
            and user_id = $3
            and patient_id = $4
            and status = 'approved'
            and revoked_at is null
            and expires_at > $5
            and ($6::text is null or $6 = any(access_categories))
          order by approved_at desc nulls last, requested_at desc
          limit 1
        `,
        [
          scope.tenantId,
          scope.clinicId,
          filter.userId,
          filter.patientId,
          filter.at,
          filter.requiredCategory ?? null
        ]
      );
      return result.rows[0] ? mapBreakGlassAccessRow(result.rows[0]) : null;
    });
  }

  async createMigrationBatch(
    scope: RepositoryScope,
    input: CreateMigrationBatchInput
  ): Promise<MigrationBatchDetail> {
    return this.#withRls(scope, async (client) => {
      const batchResult = await client.query<MigrationBatchRow>(
        `
          insert into migration_batches (
            tenant_id,
            clinic_id,
            import_type,
            source_system,
            source_file_name,
            source_checksum,
            state,
            uploaded_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.importType,
          input.sourceSystem,
          input.sourceFileName ?? null,
          input.sourceChecksum ?? null,
          input.state,
          scope.actorUserId
        ]
      );
      const batch = mapMigrationBatchRow(batchResult.rows[0]);

      for (const rowInput of input.rows) {
        const rowResult = await client.query<MigrationRowRow>(
          `
            insert into migration_rows (
              tenant_id,
              clinic_id,
              batch_id,
              row_number,
              import_type,
              external_record_id,
              raw_payload,
              raw_payload_digest,
              normalized_record,
              validation_errors,
              status,
              match_status
            )
            values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10::jsonb, $11, $12)
            returning *
          `,
          [
            scope.tenantId,
            scope.clinicId,
            batch.id,
            rowInput.rowNumber,
            rowInput.importType,
            rowInput.externalRecordId ?? null,
            JSON.stringify(rowInput.rawPayload),
            rowInput.rawPayloadDigest,
            rowInput.normalizedRecord ? JSON.stringify(rowInput.normalizedRecord) : null,
            JSON.stringify(rowInput.validationErrors),
            rowInput.status,
            rowInput.matchStatus
          ]
        );
        const row = mapMigrationRowRow(rowResult.rows[0], []);

        for (const conflictInput of rowInput.conflicts ?? []) {
          await client.query(
            `
              insert into migration_conflicts (
                tenant_id,
                clinic_id,
                batch_id,
                row_id,
                conflict_type,
                severity,
                target_record_type,
                target_record_id,
                field_name,
                summary,
                evidence
              )
              values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
            `,
            [
              scope.tenantId,
              scope.clinicId,
              batch.id,
              row.id,
              conflictInput.conflictType,
              conflictInput.severity,
              conflictInput.targetRecordType ?? null,
              conflictInput.targetRecordId ?? null,
              conflictInput.fieldName ?? null,
              conflictInput.summary,
              JSON.stringify(conflictInput.evidence ?? {})
            ]
          );
        }
      }

      await this.#refreshMigrationBatchCountsInTransaction(client, scope, batch.id);
      const detail = await this.#findMigrationBatchDetailInTransaction(client, scope, batch.id);
      if (!detail) throw new Error("Migration batch was not found after creation.");
      return detail;
    });
  }

  async listMigrationBatches(
    scope: RepositoryScope,
    filter: MigrationBatchSearchFilter = {}
  ): Promise<MigrationBatchDetail[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = ["tenant_id = $1", "clinic_id = $2"];
      if (filter.status) {
        values.push(filter.status);
        where.push(`state = $${values.length}`);
      }
      values.push(Math.min(filter.limit ?? 25, 100));
      const batches = (
        await client.query<MigrationBatchRow>(
          `
            select *
            from migration_batches
            where ${where.join(" and ")}
            order by created_at desc
            limit $${values.length}
          `,
          values
        )
      ).rows.map(mapMigrationBatchRow);

      const details: MigrationBatchDetail[] = [];
      for (const batch of batches) {
        const detail = await this.#findMigrationBatchDetailInTransaction(client, scope, batch.id);
        if (detail) details.push(detail);
      }
      return details;
    });
  }

  async findMigrationBatchById(
    scope: RepositoryScope,
    batchId: UUID
  ): Promise<MigrationBatchDetail | null> {
    return this.#withRls(scope, (client) =>
      this.#findMigrationBatchDetailInTransaction(client, scope, batchId)
    );
  }

  async listMigrationRows(
    scope: RepositoryScope,
    batchId: UUID,
    filter: MigrationRowsFilter = {}
  ): Promise<MigrationRowRecord[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId, batchId];
      const where = ["tenant_id = $1", "clinic_id = $2", "batch_id = $3"];
      if (filter.matchStatus) {
        values.push(filter.matchStatus);
        where.push(`match_status = $${values.length}`);
      }
      if (filter.status) {
        values.push(filter.status);
        where.push(`status = $${values.length}`);
      }
      const result = await client.query<MigrationRowRow>(
        `
          select *
          from migration_rows
          where ${where.join(" and ")}
          order by row_number
        `,
        values
      );
      return this.#attachMigrationRowConflicts(
        client,
        scope,
        result.rows.map((row) => mapMigrationRowRow(row, []))
      );
    });
  }

  async resolveMigrationRow(
    scope: RepositoryScope,
    batchId: UUID,
    rowId: UUID,
    input: ResolveMigrationRowInput
  ): Promise<MigrationRowRecord | null> {
    return this.#withRls(scope, async (client) => {
      if (input.action === "link_existing") {
        const patient = input.targetRecordId
          ? await this.#findPatientByIdInTransaction(client, scope, input.targetRecordId)
          : null;
        if (!patient) return null;
      }

      const updated = await client.query<MigrationRowRow>(
        `
          update migration_rows
          set
            resolution_action = $4,
            resolution_target_record_type = $5,
            resolution_target_record_id = $6,
            resolution_note = $7,
            status = $8,
            match_status = $9
          where tenant_id = $1 and clinic_id = $2 and batch_id = $3 and id = $10
            and status not in ('committed', 'rolled_back')
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          batchId,
          input.action,
          input.action === "link_existing" ? (input.targetRecordType ?? "patient") : null,
          input.action === "link_existing" ? (input.targetRecordId ?? null) : null,
          input.note ?? null,
          input.action === "skip" ? "skipped" : "ready_to_commit",
          input.action === "skip" ? "skipped" : "resolved",
          rowId
        ]
      );
      if (!updated.rows[0]) return null;

      await client.query(
        `
          update migration_conflicts
          set
            status = $4,
            resolution_action = $5,
            resolved_by_user_id = $6,
            resolved_at = now()
          where tenant_id = $1 and clinic_id = $2 and batch_id = $3 and row_id = $7
        `,
        [
          scope.tenantId,
          scope.clinicId,
          batchId,
          input.action === "skip" ? "ignored" : "resolved",
          input.action,
          scope.actorUserId,
          rowId
        ]
      );
      await this.#refreshMigrationBatchCountsInTransaction(client, scope, batchId);
      const [row] = await this.#attachMigrationRowConflicts(client, scope, [
        mapMigrationRowRow(updated.rows[0], [])
      ]);
      return row ?? null;
    });
  }

  async commitMigrationBatch(
    scope: RepositoryScope,
    batchId: UUID,
    input: CommitMigrationBatchInput = {}
  ): Promise<MigrationCommitResult | null> {
    return this.#withRls(scope, async (client) => {
      const batch = await this.#findMigrationBatchRowInTransaction(client, scope, batchId);
      if (!batch) return null;
      const existing = await this.#findMigrationCommitInTransaction(
        client,
        scope,
        batchId,
        "commit",
        input.idempotencyKey ?? null
      );
      if (existing || ["committed", "partially_committed"].includes(batch.state)) {
        const detail = await this.#findMigrationBatchDetailInTransaction(client, scope, batchId);
        if (!detail) return null;
        return {
          batch: detail.batch,
          commit:
            existing ??
            (await this.#latestMigrationCommitInTransaction(client, scope, batchId, "commit")) ??
            (await this.#insertMigrationCommitInTransaction(
              client,
              scope,
              batchId,
              "commit",
              "succeeded",
              input.idempotencyKey ?? null,
              {},
              null
            )),
          rows: detail.rows,
          importedRecordLinks: await this.#listImportedRecordLinksInTransaction(
            client,
            scope,
            batchId
          )
        };
      }

      const readyRows = (
        await client.query<MigrationRowRow>(
          `
            select *
            from migration_rows
            where tenant_id = $1 and clinic_id = $2 and batch_id = $3 and status = 'ready_to_commit'
            order by row_number
          `,
          [scope.tenantId, scope.clinicId, batchId]
        )
      ).rows.map((row) => mapMigrationRowRow(row, []));

      for (const row of readyRows) {
        if (!row.normalizedRecord || row.normalizedRecord.recordType !== "patient") {
          await this.#markMigrationRowFailed(
            client,
            scope,
            row.id,
            "Only patient import rows can be committed in CP7."
          );
          continue;
        }

        if (row.resolutionAction === "link_existing") {
          if (!row.resolutionTargetRecordId) {
            await this.#markMigrationRowFailed(
              client,
              scope,
              row.id,
              "Resolved existing patient target is missing."
            );
            continue;
          }
          await this.#createImportedRecordLinkInTransaction(
            client,
            scope,
            batch,
            row,
            row.resolutionTargetRecordId,
            "linked_existing"
          );
          await this.#markMigrationRowCommitted(
            client,
            scope,
            row.id,
            "patient",
            row.resolutionTargetRecordId
          );
          continue;
        }

        const patient = await this.#insertImportedPatientInTransaction(
          client,
          scope,
          row,
          batch.sourceSystem
        );
        await this.#createImportedRecordLinkInTransaction(
          client,
          scope,
          batch,
          row,
          patient.id,
          "created_from_import"
        );
        await this.#markMigrationRowCommitted(client, scope, row.id, "patient", patient.id);
      }

      const counts = await this.#refreshMigrationBatchCountsInTransaction(client, scope, batchId);
      const finalState =
        counts.failedRowCount > 0 || counts.invalidRowCount > 0 || counts.conflictRowCount > 0
          ? "partially_committed"
          : "committed";
      const batchResult = await client.query<MigrationBatchRow>(
        `
          update migration_batches
          set state = $4, committed_by_user_id = $5, committed_at = now()
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, batchId, finalState, scope.actorUserId]
      );
      const commit = await this.#insertMigrationCommitInTransaction(
        client,
        scope,
        batchId,
        "commit",
        finalState === "committed" ? "succeeded" : "partially_succeeded",
        input.idempotencyKey ?? null,
        {
          committedRows: counts.committedRowCount,
          invalidRows: counts.invalidRowCount,
          failedRows: counts.failedRowCount
        },
        counts.failedRowCount > 0 ? { failedRows: counts.failedRowCount } : null
      );
      const rows = await this.#listMigrationRowsInTransaction(client, scope, batchId);
      return {
        batch: mapMigrationBatchRow(batchResult.rows[0]),
        commit,
        rows,
        importedRecordLinks: await this.#listImportedRecordLinksInTransaction(
          client,
          scope,
          batchId
        )
      };
    });
  }

  async rollbackMigrationBatch(
    scope: RepositoryScope,
    batchId: UUID,
    input: RollbackMigrationBatchInput = {}
  ): Promise<MigrationRollbackResult | null> {
    return this.#withRls(scope, async (client) => {
      const batch = await this.#findMigrationBatchRowInTransaction(client, scope, batchId);
      if (!batch) return null;
      const existing = await this.#findMigrationCommitInTransaction(
        client,
        scope,
        batchId,
        "rollback",
        input.idempotencyKey ?? null
      );
      if (existing || batch.state === "rolled_back") {
        const detail = await this.#findMigrationBatchDetailInTransaction(client, scope, batchId);
        if (!detail) return null;
        return {
          batch: detail.batch,
          rollback:
            existing ??
            (await this.#latestMigrationCommitInTransaction(client, scope, batchId, "rollback")) ??
            (await this.#insertMigrationCommitInTransaction(
              client,
              scope,
              batchId,
              "rollback",
              "succeeded",
              input.idempotencyKey ?? null,
              {},
              null
            )),
          rows: detail.rows,
          importedRecordLinks: await this.#listImportedRecordLinksInTransaction(
            client,
            scope,
            batchId
          ),
          blockedLinks: []
        };
      }

      const links = (
        await client.query<ImportedRecordLinkRow>(
          `
            select *
            from imported_record_links
            where tenant_id = $1 and clinic_id = $2 and batch_id = $3 and verification_status = 'imported_unverified'
            order by created_at
          `,
          [scope.tenantId, scope.clinicId, batchId]
        )
      ).rows.map(mapImportedRecordLinkRow);
      const blockedLinks: ImportedRecordLinkRecord[] = [];

      for (const link of links) {
        if (
          link.linkType === "created_from_import" &&
          (await this.#patientHasRollbackBlockingDependenciesInTransaction(
            client,
            scope,
            link.targetRecordId
          ))
        ) {
          await client.query(
            `
              update imported_record_links
              set metadata = metadata || $4::jsonb
              where tenant_id = $1 and clinic_id = $2 and id = $3
            `,
            [
              scope.tenantId,
              scope.clinicId,
              link.id,
              JSON.stringify({
                rollbackBlockedAt: this.#clock.now().toISOString(),
                rollbackBlockedReason:
                  "Imported patient has downstream clinical or billing dependencies."
              })
            ]
          );
          blockedLinks.push(link);
          continue;
        }

        if (link.linkType === "created_from_import") {
          await client.query(
            `
              delete from dental_charts
              where tenant_id = $1 and clinic_id = $2 and patient_id = $3
            `,
            [scope.tenantId, scope.clinicId, link.targetRecordId]
          );
          await client.query(
            `
              delete from patient_timeline_items
              where tenant_id = $1 and clinic_id = $2 and patient_id = $3
            `,
            [scope.tenantId, scope.clinicId, link.targetRecordId]
          );
          await client.query(
            `
              delete from patients
              where tenant_id = $1 and clinic_id = $2 and id = $3
            `,
            [scope.tenantId, scope.clinicId, link.targetRecordId]
          );
        }

        await client.query(
          `
            update imported_record_links
            set verification_status = 'rolled_back'
            where tenant_id = $1 and clinic_id = $2 and id = $3
          `,
          [scope.tenantId, scope.clinicId, link.id]
        );
        await client.query(
          `
            update migration_rows
            set status = 'rolled_back'
            where tenant_id = $1 and clinic_id = $2 and id = $3
          `,
          [scope.tenantId, scope.clinicId, link.rowId]
        );
      }

      const counts = await this.#refreshMigrationBatchCountsInTransaction(client, scope, batchId);
      const finalState = blockedLinks.length > 0 ? "partially_committed" : "rolled_back";
      const batchResult = await client.query<MigrationBatchRow>(
        `
          update migration_batches
          set state = $4, rolled_back_by_user_id = $5, rolled_back_at = now()
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, batchId, finalState, scope.actorUserId]
      );
      const rollback = await this.#insertMigrationCommitInTransaction(
        client,
        scope,
        batchId,
        "rollback",
        blockedLinks.length > 0 ? "partially_succeeded" : "succeeded",
        input.idempotencyKey ?? null,
        {
          rolledBackRows: counts.rolledBackRowCount,
          blockedLinks: blockedLinks.length
        },
        blockedLinks.length > 0 ? { blockedLinkIds: blockedLinks.map((link) => link.id) } : null
      );
      const rows = await this.#listMigrationRowsInTransaction(client, scope, batchId);
      return {
        batch: mapMigrationBatchRow(batchResult.rows[0]),
        rollback,
        rows,
        importedRecordLinks: await this.#listImportedRecordLinksInTransaction(
          client,
          scope,
          batchId
        ),
        blockedLinks
      };
    });
  }

  async listIntegrationDeadLetters(
    scope: RepositoryScope,
    filter: IntegrationDeadLetterSearchFilter = {}
  ): Promise<IntegrationDeadLetterRecord[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = ["tenant_id = $1", "(clinic_id is null or clinic_id = $2)"];
      if (filter.status) {
        values.push(filter.status);
        where.push(`status = $${values.length}`);
      }
      values.push(Math.min(filter.limit ?? 50, 100));
      const result = await client.query<IntegrationDeadLetterRow>(
        `
          select *
          from integration_dead_letters
          where ${where.join(" and ")}
          order by created_at desc
          limit $${values.length}
        `,
        values
      );
      return result.rows.map(mapIntegrationDeadLetterRow);
    });
  }

  async requestIntegrationDeadLetterReplay(
    scope: RepositoryScope,
    deadLetterId: UUID,
    input: ReplayIntegrationDeadLetterInput
  ): Promise<IntegrationDeadLetterRecord | null> {
    const reasonDigest = input.reason
      ? sha256Text(`${input.reviewedByUserId}:${input.reason}`)
      : null;
    return this.#withRls(scope, async (client) => {
      const result = await client.query<IntegrationDeadLetterRow>(
        `
          update integration_dead_letters
          set status = 'retry_scheduled',
              retry_count = retry_count + 1,
              next_retry_at = now(),
              last_error_digest = coalesce($4, last_error_digest),
              updated_at = now()
          where tenant_id = $1
            and (clinic_id is null or clinic_id = $2)
            and id = $3
            and status not in ('replayed', 'resolved', 'discarded')
          returning *
        `,
        [scope.tenantId, scope.clinicId, deadLetterId, reasonDigest]
      );
      return result.rows[0] ? mapIntegrationDeadLetterRow(result.rows[0]) : null;
    });
  }

  async listLeads(scope: RepositoryScope, filter: LeadSearchFilter = {}): Promise<LeadRecord[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = ["tenant_id = $1", "clinic_id = $2"];

      if (filter.source) {
        values.push(filter.source);
        where.push(`source = $${values.length}`);
      }

      if (filter.status) {
        values.push(filter.status);
        where.push(`status = $${values.length}`);
      }

      values.push(Math.min(filter.limit ?? 50, 100));
      const result = await client.query<LeadRow>(
        `
          select *
          from leads
          where ${where.join(" and ")}
          order by last_activity_at desc
          limit $${values.length}
        `,
        values
      );

      return result.rows.map(mapLeadRow);
    });
  }

  async findLeadById(scope: RepositoryScope, leadId: UUID): Promise<LeadRecord | null> {
    return this.#withRls(scope, async (client) =>
      this.#findLeadByIdInTransaction(client, scope, leadId)
    );
  }

  async createLead(scope: RepositoryScope, input: CreateLeadInput): Promise<LeadRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<LeadRow>(
        `
          insert into leads (
            tenant_id,
            clinic_id,
            primary_contact,
            normalized_primary_contact,
            intent,
            source,
            source_detail,
            created_by_user_id,
            updated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.primaryContact,
          normalizePhone(input.primaryContact),
          input.intent,
          input.source,
          JSON.stringify(input.sourceDetail),
          scope.actorUserId
        ]
      );

      return mapLeadRow(result.rows[0]);
    });
  }

  async updateLeadStatus(
    scope: RepositoryScope,
    leadId: UUID,
    status: LeadRecord["status"]
  ): Promise<LeadRecord | null> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<LeadRow>(
        `
          update leads
          set status = $4, last_activity_at = now(), updated_by_user_id = $5
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, leadId, status, scope.actorUserId]
      );

      return result.rows[0] ? mapLeadRow(result.rows[0]) : null;
    });
  }

  async matchLeadToPatient(
    scope: RepositoryScope,
    leadId: UUID,
    patientId: UUID
  ): Promise<LeadRecord | null> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<LeadRow>(
        `
          update leads
          set patient_id = $4, status = 'matched', last_activity_at = now(), updated_by_user_id = $5
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, leadId, patientId, scope.actorUserId]
      );

      const lead = result.rows[0] ? mapLeadRow(result.rows[0]) : null;

      if (lead) {
        await this.#appendTimeline(client, scope, {
          patientId,
          itemType: "lead_matched",
          sourceTable: "leads",
          sourceId: lead.id,
          title: "Lead matched to patient",
          summary: `Lead from ${lead.source} matched`,
          metadata: { leadId: lead.id, source: lead.source }
        });
      }

      return lead;
    });
  }

  async listAppointmentTypes(scope: RepositoryScope): Promise<AppointmentTypeRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<AppointmentTypeRow>(
        `
          select *
          from appointment_types
          where tenant_id = $1 and clinic_id = $2 and active = true
          order by display_name
        `,
        [scope.tenantId, scope.clinicId]
      );
      return result.rows.map(mapAppointmentTypeRow);
    });
  }

  async listChairs(scope: RepositoryScope): Promise<ChairOrRoomRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<ChairRow>(
        `
          select *
          from chairs_or_rooms
          where tenant_id = $1 and clinic_id = $2 and active = true
          order by display_name
        `,
        [scope.tenantId, scope.clinicId]
      );
      return result.rows.map(mapChairRow);
    });
  }

  async listProviderSchedules(
    scope: RepositoryScope,
    providerUserId?: UUID | null
  ): Promise<ProviderScheduleRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<ProviderScheduleRow>(
        `
          select *
          from provider_schedules
          where tenant_id = $1
            and clinic_id = $2
            and active = true
            and ($3::uuid is null or provider_user_id = $3)
          order by provider_user_id, day_of_week, starts_at
        `,
        [scope.tenantId, scope.clinicId, providerUserId ?? null]
      );
      return result.rows.map(mapProviderScheduleRow);
    });
  }

  async listAppointments(
    scope: RepositoryScope,
    filter: AppointmentSearchFilter = {}
  ): Promise<AppointmentRecord[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = ["tenant_id = $1", "clinic_id = $2"];

      if (filter.date) {
        const { timezone } = await this.#clinicCalendar(client, scope);
        values.push(filter.date, timezone);
        where.push(
          `start_at >= ($${values.length - 1}::date::timestamp at time zone $${values.length})
           and start_at < (($${values.length - 1}::date + 1)::timestamp at time zone $${values.length})`
        );
      }

      if (filter.providerUserId) {
        values.push(filter.providerUserId);
        where.push(`provider_user_id = $${values.length}`);
      }

      if (filter.status) {
        values.push(filter.status);
        where.push(`status = $${values.length}`);
      }

      const result = await client.query<AppointmentRow>(
        `
          select *
          from appointments
          where ${where.join(" and ")}
          order by start_at
        `,
        values
      );
      return result.rows.map(mapAppointmentRow);
    });
  }

  async findAppointmentById(
    scope: RepositoryScope,
    appointmentId: UUID
  ): Promise<AppointmentRecord | null> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<AppointmentRow>(
        `
          select *
          from appointments
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [scope.tenantId, scope.clinicId, appointmentId]
      );
      return result.rows[0] ? mapAppointmentRow(result.rows[0]) : null;
    });
  }

  async findAppointmentConflicts(
    scope: RepositoryScope,
    filter: AppointmentConflictFilter
  ): Promise<AppointmentConflict[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<AppointmentRow>(
        `
          select *
          from appointments
          where tenant_id = $1
            and clinic_id = $2
            and id <> coalesce($7::uuid, '00000000-0000-4000-8000-000000000000'::uuid)
            and status in ('requested', 'booked', 'confirmed', 'checked_in', 'in_consult')
            and start_at < $5
            and $4 < end_at
            and (
              provider_user_id = $3
              or ($6::uuid is not null and chair_id = $6)
            )
          order by start_at
        `,
        [
          scope.tenantId,
          scope.clinicId,
          filter.providerUserId,
          filter.startAt,
          filter.endAt,
          filter.chairId ?? null,
          filter.appointmentIdToExclude ?? null
        ]
      );

      return result.rows.flatMap((row) => {
        const appointment = mapAppointmentRow(row);
        const conflicts: AppointmentConflict[] = [];

        if (appointment.providerUserId === filter.providerUserId) {
          conflicts.push({
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            providerUserId: appointment.providerUserId,
            chairId: appointment.chairId,
            startAt: appointment.startAt,
            endAt: appointment.endAt,
            reason: "provider_overlap"
          });
        }

        if (filter.chairId && appointment.chairId === filter.chairId) {
          conflicts.push({
            appointmentId: appointment.id,
            patientId: appointment.patientId,
            providerUserId: appointment.providerUserId,
            chairId: appointment.chairId,
            startAt: appointment.startAt,
            endAt: appointment.endAt,
            reason: "chair_overlap"
          });
        }

        return conflicts;
      });
    });
  }

  async createAppointment(
    scope: RepositoryScope,
    input: CreateAppointmentInput
  ): Promise<AppointmentRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<AppointmentRow>(
        `
          insert into appointments (
            tenant_id,
            clinic_id,
            patient_id,
            lead_id,
            provider_user_id,
            appointment_type_id,
            chair_id,
            status,
            start_at,
            end_at,
            source,
            reason,
            notes,
            created_by_user_id,
            updated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.patientId,
          input.leadId ?? null,
          input.providerUserId,
          input.appointmentTypeId,
          input.chairId ?? null,
          input.status,
          input.startAt,
          input.endAt,
          input.source,
          input.reason ?? null,
          input.notes ?? null,
          scope.actorUserId
        ]
      );
      const appointment = mapAppointmentRow(result.rows[0]);

      await client.query(
        `
          insert into appointment_status_history (
            tenant_id,
            clinic_id,
            appointment_id,
            from_status,
            to_status,
            changed_by_user_id,
            reason
          )
          values ($1, $2, $3, null, $4, $5, $6)
        `,
        [
          scope.tenantId,
          scope.clinicId,
          appointment.id,
          appointment.status,
          scope.actorUserId,
          "appointment_created"
        ]
      );

      await this.#appendTimeline(client, scope, {
        patientId: appointment.patientId,
        itemType: "appointment_created",
        sourceTable: "appointments",
        sourceId: appointment.id,
        title: "Appointment booked",
        summary: appointment.reason,
        metadata: {
          appointmentId: appointment.id,
          source: appointment.source,
          startAt: appointment.startAt
        }
      });

      return appointment;
    });
  }

  async updateAppointmentStatus(
    scope: RepositoryScope,
    appointmentId: UUID,
    status: AppointmentStatus,
    reason?: string | null
  ): Promise<AppointmentRecord | null> {
    return this.#withRls(scope, async (client) => {
      const existing = await this.#findAppointmentByIdInTransaction(client, scope, appointmentId);
      if (!existing) return null;

      const result = await client.query<AppointmentRow>(
        `
          update appointments
          set status = $4, updated_by_user_id = $5
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, appointmentId, status, scope.actorUserId]
      );
      const appointment = mapAppointmentRow(result.rows[0]);

      await client.query(
        `
          insert into appointment_status_history (
            tenant_id,
            clinic_id,
            appointment_id,
            from_status,
            to_status,
            changed_by_user_id,
            reason
          )
          values ($1, $2, $3, $4, $5, $6, $7)
        `,
        [
          scope.tenantId,
          scope.clinicId,
          appointment.id,
          existing.status,
          status,
          scope.actorUserId,
          reason ?? null
        ]
      );

      const timelineType =
        status === "confirmed"
          ? "appointment_confirmed"
          : status === "checked_in"
            ? "patient_checked_in"
            : status === "no_show"
              ? "appointment_no_show"
              : null;

      if (timelineType) {
        await this.#appendTimeline(client, scope, {
          patientId: appointment.patientId,
          itemType: timelineType,
          sourceTable: "appointments",
          sourceId: appointment.id,
          title:
            status === "checked_in"
              ? "Patient checked in"
              : `Appointment ${status.replace("_", " ")}`,
          summary: reason ?? null,
          metadata: { appointmentId: appointment.id, status }
        });
      }

      return appointment;
    });
  }

  async createQueueEntry(
    scope: RepositoryScope,
    appointment: AppointmentRecord
  ): Promise<QueueEntryRecord> {
    return this.#withRls(scope, async (client) => {
      const calendar = await this.#clinicCalendar(client, scope);
      const checkedInAt = this.#clock.now().toISOString();
      const result = await client.query<QueueEntryRow>(
        `
          insert into queue_entries (
            tenant_id,
            clinic_id,
            appointment_id,
            patient_id,
            provider_user_id,
            position,
            checked_in_at,
            created_by_user_id,
            updated_by_user_id
          )
          values (
            $1,
            $2,
            $3,
            $4,
            $5,
            coalesce(
              (select max(position) + 1
               from queue_entries
               where tenant_id = $1
                 and clinic_id = $2
                 and checked_in_at >= ($8::date::timestamp at time zone $9)
                 and checked_in_at < (($8::date + 1)::timestamp at time zone $9)),
              1
            ),
            $7,
            $6,
            $6
          )
          on conflict (tenant_id, clinic_id, appointment_id) do update set
            status = 'waiting',
            updated_by_user_id = excluded.updated_by_user_id
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          appointment.id,
          appointment.patientId,
          appointment.providerUserId,
          scope.actorUserId,
          checkedInAt,
          calendar.date,
          calendar.timezone
        ]
      );

      const queueEntry = mapQueueEntryRow(result.rows[0]);

      await this.#appendTimeline(client, scope, {
        patientId: queueEntry.patientId,
        itemType: "queue_entry_created",
        sourceTable: "queue_entries",
        sourceId: queueEntry.id,
        title: "Queue entry created",
        summary: null,
        metadata: { appointmentId: queueEntry.appointmentId, status: queueEntry.status }
      });

      return queueEntry;
    });
  }

  async listQueueEntries(scope: RepositoryScope, date: string): Promise<QueueEntryRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<QueueEntryRow>(
        `
          select queue_entries.*
          from queue_entries
          join clinics on clinics.tenant_id = queue_entries.tenant_id
            and clinics.id = queue_entries.clinic_id
          where queue_entries.tenant_id = $1
            and queue_entries.clinic_id = $2
            and queue_entries.checked_in_at >= ($3::date::timestamp at time zone clinics.timezone)
            and queue_entries.checked_in_at < (($3::date + 1)::timestamp at time zone clinics.timezone)
          order by queue_entries.position, queue_entries.checked_in_at
        `,
        [scope.tenantId, scope.clinicId, date]
      );
      return result.rows.map(mapQueueEntryRow);
    });
  }

  async updateQueueEntry(
    scope: RepositoryScope,
    queueEntryId: UUID,
    status: QueueStatus
  ): Promise<QueueEntryRecord | null> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<QueueEntryRow>(
        `
          update queue_entries
          set
            status = $4,
            called_at = case when $4 = 'called' and called_at is null then now() else called_at end,
            completed_at = case when $4 = 'completed' and completed_at is null then now() else completed_at end,
            updated_by_user_id = $5
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, queueEntryId, status, scope.actorUserId]
      );
      return result.rows[0] ? mapQueueEntryRow(result.rows[0]) : null;
    });
  }

  async listTasks(scope: RepositoryScope, filter: TaskSearchFilter = {}): Promise<TaskRecord[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = ["tenant_id = $1", "clinic_id = $2"];

      if (filter.status) {
        values.push(filter.status);
        where.push(`status = $${values.length}`);
      }
      if (filter.patientId) {
        values.push(filter.patientId);
        where.push(`patient_id = $${values.length}`);
      }
      if (filter.assignedToUserId) {
        values.push(filter.assignedToUserId);
        where.push(`assigned_to_user_id = $${values.length}`);
      }
      if (filter.sourceWorkflow) {
        values.push(filter.sourceWorkflow);
        where.push(`source_workflow = $${values.length}`);
      }
      if (filter.dueDate) {
        const start = new Date(`${filter.dueDate}T00:00:00.000Z`);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        values.push(start.toISOString(), end.toISOString());
        where.push(`due_at >= $${values.length - 1} and due_at < $${values.length}`);
      }
      if (filter.dueBefore) {
        values.push(filter.dueBefore);
        where.push(`due_at <= $${values.length}`);
      }

      values.push(Math.min(filter.limit ?? 100, 250));
      const result = await client.query<TaskRow>(
        `
          select *
          from tasks
          where ${where.join(" and ")}
          order by
            case priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
            due_at nulls last,
            updated_at desc
          limit $${values.length}
        `,
        values
      );
      return result.rows.map(mapTaskRow);
    });
  }

  async findTaskById(scope: RepositoryScope, taskId: UUID): Promise<TaskRecord | null> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<TaskRow>(
        `
          select *
          from tasks
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [scope.tenantId, scope.clinicId, taskId]
      );
      return result.rows[0] ? mapTaskRow(result.rows[0]) : null;
    });
  }

  async createTask(scope: RepositoryScope, input: CreateTaskInput): Promise<TaskRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<TaskRow>(
        `
          insert into tasks (
            tenant_id,
            clinic_id,
            patient_id,
            lead_id,
            appointment_id,
            invoice_id,
            encounter_id,
            treatment_plan_id,
            procedure_performed_id,
            task_type,
            source_workflow,
            source_record_type,
            source_record_id,
            title,
            description,
            priority,
            status,
            due_at,
            assigned_to_user_id,
            assigned_by_user_id,
            idempotency_key,
            created_by_user_id,
            updated_by_user_id
          )
          values (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11, $12, $13, $14, $15, $16, $17,
            $18, $19, $20, $21, $22, $22
          )
          on conflict (tenant_id, clinic_id, idempotency_key) where idempotency_key is not null
          do update set updated_at = tasks.updated_at
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.patientId ?? null,
          input.leadId ?? null,
          input.appointmentId ?? null,
          input.invoiceId ?? null,
          input.encounterId ?? null,
          input.treatmentPlanId ?? null,
          input.procedurePerformedId ?? null,
          input.taskType,
          input.sourceWorkflow ?? "manual",
          input.sourceRecordType ?? null,
          input.sourceRecordId ?? null,
          input.title,
          input.description ?? null,
          input.priority ?? "normal",
          input.status ?? "open",
          input.dueAt ?? null,
          input.assignedToUserId ?? null,
          input.assignedToUserId ? scope.actorUserId : null,
          input.idempotencyKey ?? null,
          scope.actorUserId
        ]
      );

      return mapTaskRow(result.rows[0]);
    });
  }

  async updateTask(
    scope: RepositoryScope,
    taskId: UUID,
    input: UpdateTaskInput
  ): Promise<TaskRecord | null> {
    return this.#withRls(scope, async (client) => {
      const existingResult = await client.query<TaskRow>(
        `
          select *
          from tasks
          where tenant_id = $1 and clinic_id = $2 and id = $3
          for update
        `,
        [scope.tenantId, scope.clinicId, taskId]
      );
      if (!existingResult.rows[0]) return null;
      const existing = mapTaskRow(existingResult.rows[0]);
      const nextStatus = input.status ?? existing.status;
      assertTaskTransition(existing.status, nextStatus);

      const completionEvidence =
        input.completionEvidence ?? (nextStatus === "done" ? existing.completionEvidence : {});
      const completedAt =
        nextStatus === "done" ? (existing.completedAt ?? this.#clock.now().toISOString()) : null;
      const completedByUserId =
        nextStatus === "done" ? (existing.completedByUserId ?? scope.actorUserId) : null;
      assertTaskCompletionEvidence({
        status: nextStatus,
        evidence: completionEvidence,
        completedAt,
        completedByUserId
      });

      const result = await client.query<TaskRow>(
        `
          update tasks
          set
            status = $4,
            title = $5,
            description = $6,
            priority = $7,
            due_at = $8,
            assigned_to_user_id = $9,
            assigned_by_user_id = case
              when $9::uuid is distinct from assigned_to_user_id then $10::uuid
              else assigned_by_user_id
            end,
            completed_by_user_id = $11,
            completed_at = $12,
            completion_evidence = $13::jsonb,
            cancelled_reason = $14,
            updated_by_user_id = $10,
            status_changed_at = case when status is distinct from $4 then now() else status_changed_at end
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          taskId,
          nextStatus,
          input.title ?? existing.title,
          input.description === undefined ? existing.description : input.description,
          input.priority ?? existing.priority,
          input.dueAt === undefined ? existing.dueAt : input.dueAt,
          input.assignedToUserId === undefined ? existing.assignedToUserId : input.assignedToUserId,
          scope.actorUserId,
          completedByUserId,
          completedAt,
          JSON.stringify(completionEvidence),
          input.cancelledReason ?? existing.cancelledReason
        ]
      );
      return result.rows[0] ? mapTaskRow(result.rows[0]) : null;
    });
  }

  async createRecallRule(
    scope: RepositoryScope,
    input: CreateRecallRuleInput
  ): Promise<RecallRuleRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<RecallRuleRow>(
        `
          insert into recall_rules (
            tenant_id,
            clinic_id,
            code,
            title,
            anchor,
            offset_days,
            procedure_category,
            pricebook_procedure_id,
            default_task_title,
            default_task_priority,
            created_by_user_id,
            updated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.code,
          input.title,
          input.anchor ?? "procedure_completed",
          input.offsetDays,
          input.procedureCategory ?? null,
          input.pricebookProcedureId ?? null,
          input.defaultTaskTitle ?? input.title,
          input.defaultTaskPriority ?? "normal",
          scope.actorUserId
        ]
      );
      return mapRecallRuleRow(result.rows[0]);
    });
  }

  async listRecalls(
    scope: RepositoryScope,
    filter: RecallSearchFilter = {}
  ): Promise<RecallRecord[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = ["tenant_id = $1", "clinic_id = $2"];
      if (filter.status) {
        values.push(filter.status);
        where.push(`status = $${values.length}`);
      }
      if (filter.patientId) {
        values.push(filter.patientId);
        where.push(`patient_id = $${values.length}`);
      }
      if (filter.dueBefore) {
        values.push(filter.dueBefore);
        where.push(`due_at <= $${values.length}`);
      }
      values.push(Math.min(filter.limit ?? 100, 250));
      const result = await client.query<RecallRow>(
        `
          select *
          from recalls
          where ${where.join(" and ")}
          order by due_at asc, updated_at desc
          limit $${values.length}
        `,
        values
      );
      return result.rows.map(mapRecallRow);
    });
  }

  async recordRecallAction(
    scope: RepositoryScope,
    recallId: UUID,
    input: RecordRecallActionInput
  ): Promise<RecallRecord | null> {
    return this.#withRls(scope, async (client) => {
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
      const result = await client.query<RecallRow>(
        `
          update recalls
          set
            status = $4,
            appointment_id = coalesce($5, appointment_id),
            action_evidence = $6::jsonb,
            last_action_at = now(),
            updated_by_user_id = $7
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          recallId,
          statusByAction[input.actionType],
          input.appointmentId ?? null,
          JSON.stringify(evidence),
          scope.actorUserId
        ]
      );
      const recall = result.rows[0] ? mapRecallRow(result.rows[0]) : null;
      if (recall?.taskId && ["booked", "completed", "skipped"].includes(recall.status)) {
        await client.query(
          `
            update tasks
            set
              status = 'done',
              completed_by_user_id = $4,
              completed_at = now(),
              completion_evidence = $5::jsonb,
              updated_by_user_id = $4,
              status_changed_at = now()
            where tenant_id = $1 and clinic_id = $2 and id = $3 and status <> 'done'
          `,
          [
            scope.tenantId,
            scope.clinicId,
            recall.taskId,
            scope.actorUserId,
            JSON.stringify(evidence)
          ]
        );
      }
      return recall;
    });
  }

  async generateDueContinuityTasks(
    scope: RepositoryScope,
    input: GenerateDueContinuityInput
  ): Promise<GenerateDueContinuityResult> {
    return this.#withRls(scope, async (client) => {
      const asOf = input.asOf;
      const recallTasksCreated: TaskRecord[] = [];
      const followUpTasksCreated: TaskRecord[] = [];
      const recallsCreated: RecallRecord[] = [];
      const skippedExistingKeys: string[] = [];

      const rules = (
        await client.query<RecallRuleRow>(
          `
            select *
            from recall_rules
            where tenant_id = $1 and clinic_id = $2 and status = 'active'
          `,
          [scope.tenantId, scope.clinicId]
        )
      ).rows.map(mapRecallRuleRow);

      const procedureRows = (
        await client.query<ProcedureRecallSourceRow>(
          `
            select
              procedure_performed_records.*,
              pricebook_procedures.category as procedure_category
            from procedure_performed_records
            join pricebook_procedures on pricebook_procedures.tenant_id = procedure_performed_records.tenant_id
              and pricebook_procedures.id = procedure_performed_records.pricebook_procedure_id
            where procedure_performed_records.tenant_id = $1
              and procedure_performed_records.clinic_id = $2
              and procedure_performed_records.status = 'completed'
          `,
          [scope.tenantId, scope.clinicId]
        )
      ).rows;

      for (const rule of rules) {
        for (const procedure of procedureRows) {
          if (
            rule.pricebookProcedureId &&
            rule.pricebookProcedureId !== procedure.pricebook_procedure_id
          )
            continue;
          if (rule.procedureCategory && rule.procedureCategory !== procedure.procedure_category)
            continue;
          const dueAt = addDaysIso(toIso(procedure.performed_at), rule.offsetDays);
          if (new Date(dueAt).getTime() > new Date(asOf).getTime()) continue;
          const idempotencyKey = buildRecallGenerationKey({
            recallRuleId: rule.id,
            sourceProcedurePerformedId: procedure.id,
            patientId: procedure.patient_id,
            dueAt
          });
          const recallResult = await client.query<RecallRow>(
            `
              insert into recalls (
                tenant_id,
                clinic_id,
                recall_rule_id,
                patient_id,
                source_procedure_performed_id,
                status,
                due_at,
                created_by_user_id,
                updated_by_user_id
              )
              values ($1, $2, $3, $4, $5, 'due', $6, $7, $7)
              on conflict (tenant_id, clinic_id, recall_rule_id, source_procedure_performed_id)
                where source_procedure_performed_id is not null
              do nothing
              returning *
            `,
            [
              scope.tenantId,
              scope.clinicId,
              rule.id,
              procedure.patient_id,
              procedure.id,
              dueAt,
              scope.actorUserId
            ]
          );
          if (!recallResult.rows[0]) {
            skippedExistingKeys.push(idempotencyKey);
            continue;
          }
          const recall = mapRecallRow(recallResult.rows[0]);
          recallsCreated.push(recall);
          const task = await this.#insertTaskInTransaction(client, scope, {
            patientId: procedure.patient_id,
            encounterId: procedure.encounter_id,
            treatmentPlanId: procedure.treatment_plan_id,
            procedurePerformedId: procedure.id,
            taskType: "recall",
            sourceWorkflow: "recall_generation",
            sourceRecordType: "recall",
            sourceRecordId: recall.id,
            title: rule.defaultTaskTitle,
            description: `Recall generated from ${rule.title}.`,
            priority: rule.defaultTaskPriority,
            dueAt,
            idempotencyKey
          });
          recallTasksCreated.push(task);
          await client.query(
            `
              update recalls
              set task_id = $4, updated_by_user_id = $5
              where tenant_id = $1 and clinic_id = $2 and id = $3
            `,
            [scope.tenantId, scope.clinicId, recall.id, task.id, scope.actorUserId]
          );
        }
      }

      for (const procedure of procedureRows) {
        const dueAt = addDaysIso(toIso(procedure.performed_at), 1);
        if (new Date(dueAt).getTime() > new Date(asOf).getTime()) continue;
        const key = buildPostOpFollowUpKey(procedure.id);
        const task = await this.#insertTaskInTransaction(client, scope, {
          patientId: procedure.patient_id,
          encounterId: procedure.encounter_id,
          treatmentPlanId: procedure.treatment_plan_id,
          procedurePerformedId: procedure.id,
          taskType: "post_op_follow_up",
          sourceWorkflow: "post_op_follow_up",
          sourceRecordType: "procedure_performed_record",
          sourceRecordId: procedure.id,
          title: "Post-op follow-up",
          description:
            "Manual patient follow-up after completed procedure. Record phone/WhatsApp evidence only after staff action.",
          priority: "normal",
          dueAt,
          idempotencyKey: key
        });
        if (task.idempotencyKey === key && task.createdAt === task.updatedAt)
          followUpTasksCreated.push(task);
        else skippedExistingKeys.push(key);
      }

      const invoiceRows = (
        await client.query<InvoiceRow>(
          `
            select *
            from invoices
            where tenant_id = $1
              and clinic_id = $2
              and status = 'issued'
              and balance_minor > 0
              and due_at is not null
              and due_at <= $3
              and payment_status in ('unpaid', 'payment_requested', 'partially_paid', 'reconciliation_required')
          `,
          [scope.tenantId, scope.clinicId, asOf]
        )
      ).rows;
      for (const invoice of invoiceRows) {
        const key = buildPaymentFollowUpKey(invoice.id);
        const task = await this.#insertTaskInTransaction(client, scope, {
          patientId: invoice.patient_id,
          invoiceId: invoice.id,
          treatmentPlanId: invoice.treatment_plan_id,
          taskType: "payment_follow_up",
          sourceWorkflow: "payment_follow_up",
          sourceRecordType: "invoice",
          sourceRecordId: invoice.id,
          title: "Payment follow-up",
          description:
            "Manual follow-up for invoice balance due. Do not mark paid without verified provider or manual payment evidence.",
          priority: "high",
          dueAt: toIso(invoice.due_at as Date | string),
          idempotencyKey: key
        });
        if (task.idempotencyKey === key && task.createdAt === task.updatedAt)
          followUpTasksCreated.push(task);
        else skippedExistingKeys.push(key);
      }

      return { recallTasksCreated, followUpTasksCreated, recallsCreated, skippedExistingKeys };
    });
  }

  async createSopTemplate(
    scope: RepositoryScope,
    input: CreateSopTemplateInput
  ): Promise<SopTemplateDetail> {
    return this.#withRls(scope, async (client) => {
      const template = mapSopTemplateRow(
        (
          await client.query<SopTemplateRow>(
            `
              insert into sop_templates (
                tenant_id,
                clinic_id,
                code,
                title,
                description,
                created_by_user_id,
                updated_by_user_id
              )
              values ($1, $2, $3, $4, $5, $6, $6)
              returning *
            `,
            [
              scope.tenantId,
              scope.clinicId,
              input.code,
              input.title,
              input.description ?? null,
              scope.actorUserId
            ]
          )
        ).rows[0]
      );

      const items: SopTemplateItemRecord[] = [];
      for (const [index, item] of input.items.entries()) {
        const itemResult = await client.query<SopTemplateItemRow>(
          `
            insert into sop_template_items (
              tenant_id,
              clinic_id,
              template_id,
              item_index,
              title,
              instructions,
              evidence_required
            )
            values ($1, $2, $3, $4, $5, $6, $7)
            returning *
          `,
          [
            scope.tenantId,
            scope.clinicId,
            template.id,
            index + 1,
            item.title,
            item.instructions ?? null,
            item.evidenceRequired ?? false
          ]
        );
        items.push(mapSopTemplateItemRow(itemResult.rows[0]));
      }

      return { template, items };
    });
  }

  async createSopSchedule(
    scope: RepositoryScope,
    input: CreateSopScheduleInput
  ): Promise<SopScheduleRecord | null> {
    return this.#withRls(scope, async (client) => {
      const template = await client.query(
        `
          select id
          from sop_templates
          where tenant_id = $1 and clinic_id = $2 and id = $3 and status = 'active'
        `,
        [scope.tenantId, scope.clinicId, input.templateId]
      );
      if (template.rows.length === 0) return null;

      const result = await client.query<SopScheduleRow>(
        `
          insert into sop_schedules (
            tenant_id,
            clinic_id,
            template_id,
            title,
            recurrence_type,
            interval_days,
            day_of_week,
            day_of_month,
            due_time,
            timezone,
            starts_on,
            ends_on,
            assigned_to_user_id,
            default_task_priority,
            created_by_user_id,
            updated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $15)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.templateId,
          input.title,
          input.recurrenceType,
          input.intervalDays ?? null,
          input.dayOfWeek ?? null,
          input.dayOfMonth ?? null,
          input.dueTime,
          input.timezone ?? "Asia/Kolkata",
          input.startsOn,
          input.endsOn ?? null,
          input.assignedToUserId ?? null,
          input.defaultTaskPriority ?? "normal",
          scope.actorUserId
        ]
      );
      return mapSopScheduleRow(result.rows[0]);
    });
  }

  async generateDueSopRuns(
    scope: RepositoryScope,
    input: GenerateDueSopRunsInput
  ): Promise<GenerateDueSopRunsResult> {
    return this.#withRls(scope, async (client) => {
      const runsCreated: SopRunDetail[] = [];
      const skippedExistingKeys: string[] = [];
      const asOf = new Date(input.asOf);
      const schedules = (
        await client.query<SopScheduleRow>(
          `
            select *
            from sop_schedules
            where tenant_id = $1 and clinic_id = $2 and status = 'active'
          `,
          [scope.tenantId, scope.clinicId]
        )
      ).rows.map(mapSopScheduleRow);

      for (const schedule of schedules) {
        const dueAt = sopDueAtForAsOf(schedule, asOf);
        if (!dueAt || new Date(dueAt).getTime() > asOf.getTime()) continue;
        const key = buildSopRunGenerationKey(schedule.id, dueAt);
        const runResult = await client.query<SopRunRow>(
          `
            insert into sop_runs (
              tenant_id,
              clinic_id,
              template_id,
              schedule_id,
              due_at,
              status,
              assigned_to_user_id,
              generated_from_key
            )
            values ($1, $2, $3, $4, $5, 'due', $6, $7)
            on conflict (tenant_id, clinic_id, generated_from_key) do nothing
            returning *
          `,
          [
            scope.tenantId,
            scope.clinicId,
            schedule.templateId,
            schedule.id,
            dueAt,
            schedule.assignedToUserId,
            key
          ]
        );
        if (!runResult.rows[0]) {
          skippedExistingKeys.push(key);
          continue;
        }

        const run = mapSopRunRow(runResult.rows[0]);
        const templateItems = (
          await client.query<SopTemplateItemRow>(
            `
              select *
              from sop_template_items
              where tenant_id = $1 and clinic_id = $2 and template_id = $3
              order by item_index asc
            `,
            [scope.tenantId, scope.clinicId, schedule.templateId]
          )
        ).rows.map(mapSopTemplateItemRow);
        for (const item of templateItems) {
          await client.query(
            `
              insert into sop_run_items (
                tenant_id,
                clinic_id,
                sop_run_id,
                template_item_id,
                item_index,
                title,
                instructions,
                evidence_required
              )
              values ($1, $2, $3, $4, $5, $6, $7, $8)
            `,
            [
              scope.tenantId,
              scope.clinicId,
              run.id,
              item.id,
              item.itemIndex,
              item.title,
              item.instructions,
              item.evidenceRequired
            ]
          );
        }
        const task = await this.#insertTaskInTransaction(client, scope, {
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
        await client.query(
          `
            update sop_runs
            set task_id = $4
            where tenant_id = $1 and clinic_id = $2 and id = $3
          `,
          [scope.tenantId, scope.clinicId, run.id, task.id]
        );
        const detail = await this.#loadSopRunDetail(client, scope, run.id);
        if (detail) runsCreated.push(detail);
      }

      return { runsCreated, skippedExistingKeys };
    });
  }

  async listSopRuns(
    scope: RepositoryScope,
    filter: SopRunSearchFilter = {}
  ): Promise<SopRunDetail[]> {
    return this.#withRls(scope, async (client) => {
      const values: unknown[] = [scope.tenantId, scope.clinicId];
      const where = ["tenant_id = $1", "clinic_id = $2"];
      if (filter.status) {
        values.push(filter.status);
        where.push(`status = $${values.length}`);
      }
      if (filter.date) {
        const start = new Date(`${filter.date}T00:00:00.000Z`);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 1);
        values.push(start.toISOString(), end.toISOString());
        where.push(`due_at >= $${values.length - 1} and due_at < $${values.length}`);
      }
      if (filter.dueBefore) {
        values.push(filter.dueBefore);
        where.push(`due_at <= $${values.length}`);
      }
      values.push(Math.min(filter.limit ?? 100, 250));
      const rows = (
        await client.query<SopRunRow>(
          `
            select *
            from sop_runs
            where ${where.join(" and ")}
            order by due_at asc
            limit $${values.length}
          `,
          values
        )
      ).rows;

      const details: SopRunDetail[] = [];
      for (const row of rows) {
        const detail = await this.#loadSopRunDetail(client, scope, row.id);
        if (detail) details.push(detail);
      }
      return details;
    });
  }

  async updateSopRun(
    scope: RepositoryScope,
    sopRunId: UUID,
    input: UpdateSopRunInput
  ): Promise<SopRunDetail | null> {
    return this.#withRls(scope, async (client) => {
      const existing = await this.#loadSopRunDetail(client, scope, sopRunId);
      if (!existing) return null;

      for (const item of input.items ?? []) {
        const current = existing.items.find((candidate) => candidate.id === item.itemId);
        if (!current) continue;
        await client.query(
          `
            update sop_run_items
            set
              status = $4,
              evidence = $5::jsonb,
              completed_by_user_id = case when $4 = 'done' then $6 else null end,
              completed_at = case when $4 = 'done' then now() else null end
            where tenant_id = $1 and clinic_id = $2 and id = $3
          `,
          [
            scope.tenantId,
            scope.clinicId,
            item.itemId,
            item.status,
            JSON.stringify(item.evidence ?? current.evidence),
            scope.actorUserId
          ]
        );
      }

      const nextStatus = input.status ?? existing.run.status;
      const completionEvidence = input.completionEvidence ?? existing.run.completionEvidence;
      const result = await client.query<SopRunRow>(
        `
          update sop_runs
          set
            status = $4,
            started_by_user_id = case
              when $4 = 'in_progress' and started_by_user_id is null then $5
              else started_by_user_id
            end,
            started_at = case
              when $4 = 'in_progress' and started_at is null then now()
              else started_at
            end,
            completed_by_user_id = case when $4 = 'completed' then $5 else null end,
            completed_at = case when $4 = 'completed' then now() else null end,
            completion_evidence = $6::jsonb
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          sopRunId,
          nextStatus,
          scope.actorUserId,
          JSON.stringify(completionEvidence)
        ]
      );
      if (!result.rows[0]) return null;
      const detail = await this.#loadSopRunDetail(client, scope, sopRunId);
      if (detail) assertSopRunCompletion(detail);
      return detail;
    });
  }

  async createAttributionTouch(
    scope: RepositoryScope,
    input: CreateAttributionTouchInput
  ): Promise<AttributionTouchRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<AttributionTouchRow>(
        `
          insert into attribution_touches (
            tenant_id,
            clinic_id,
            patient_id,
            lead_id,
            appointment_id,
            invoice_id,
            source,
            medium,
            campaign,
            external_ref,
            touch_type,
            occurred_at,
            metadata
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.patientId ?? null,
          input.leadId ?? null,
          input.appointmentId ?? null,
          input.invoiceId ?? null,
          input.source,
          input.medium ?? null,
          input.campaign ?? null,
          input.externalRef ?? null,
          input.touchType,
          input.occurredAt,
          JSON.stringify(input.metadata ?? {})
        ]
      );

      const touch = mapAttributionTouchRow(result.rows[0]);

      if (touch.patientId) {
        await this.#appendTimeline(client, scope, {
          patientId: touch.patientId,
          itemType: "attribution_touch_created",
          sourceTable: "attribution_touches",
          sourceId: touch.id,
          title: "Attribution touch recorded",
          summary: `${touch.source} ${touch.touchType.replace("_", " ")}`,
          metadata: {
            leadId: touch.leadId,
            appointmentId: touch.appointmentId,
            source: touch.source,
            touchType: touch.touchType
          }
        });
      }

      return touch;
    });
  }

  async appendOutboxEvent(scope: RepositoryScope, event: OutboxEventInput): Promise<void> {
    await this.#withRls(scope, async (client) => {
      await client.query(
        `
          insert into outbox_events (
            tenant_id,
            clinic_id,
            event_type,
            schema_version,
            actor_type,
            actor_id,
            aggregate_type,
            aggregate_id,
            patient_id,
            idempotency_key,
            correlation_id,
            payload,
            occurred_at
          )
          values ($1, $2, $3, '1.0', 'user', $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
          on conflict (tenant_id, idempotency_key) where idempotency_key is not null do nothing
        `,
        [
          scope.tenantId,
          scope.clinicId,
          event.eventType,
          scope.actorUserId,
          event.aggregateType,
          event.aggregateId,
          event.patientId ?? null,
          event.idempotencyKey ?? null,
          event.correlationId ?? null,
          JSON.stringify(event.payload),
          event.occurredAt
        ]
      );
    });
  }

  async loadDashboardData(scope: RepositoryScope, date: string): Promise<DashboardDataSet> {
    return this.#withRls(scope, async (client) => {
      const { timezone } = await this.#clinicCalendar(client, scope);
      const appointments = (
        await client.query<AppointmentRow>(
          `
            select *
            from appointments
            where tenant_id = $1
              and clinic_id = $2
              and start_at >= ($3::date::timestamp at time zone $4)
              and start_at < (($3::date + 1)::timestamp at time zone $4)
            order by start_at
          `,
          [scope.tenantId, scope.clinicId, date, timezone]
        )
      ).rows.map(mapAppointmentRow);
      const leads = (
        await client.query<LeadRow>(
          `
            select *
            from leads
            where tenant_id = $1 and clinic_id = $2 and status in ('new', 'contacted', 'matched')
            order by last_activity_at desc
            limit 50
          `,
          [scope.tenantId, scope.clinicId]
        )
      ).rows.map(mapLeadRow);
      const tasks = (
        await client.query<TaskRow>(
          `
            select *
            from tasks
            where tenant_id = $1
              and clinic_id = $2
              and status in ('open', 'in_progress')
              and (due_at is null or due_at < (($3::date + 1)::timestamp at time zone $4))
            order by due_at nulls last, created_at desc
            limit 50
          `,
          [scope.tenantId, scope.clinicId, date, timezone]
        )
      ).rows.map(mapTaskRow);
      const queue = (
        await client.query<QueueEntryRow>(
          `
            select *
            from queue_entries
            where tenant_id = $1
              and clinic_id = $2
              and checked_in_at >= ($3::date::timestamp at time zone $4)
              and checked_in_at < (($3::date + 1)::timestamp at time zone $4)
            order by position, checked_in_at
          `,
          [scope.tenantId, scope.clinicId, date, timezone]
        )
      ).rows.map(mapQueueEntryRow);
      const returningRows = await client.query<{ patient_id: UUID }>(
        `
          select patient_id
          from appointments
          where tenant_id = $1
            and clinic_id = $2
            and start_at < ($3::date::timestamp at time zone $4)
          group by patient_id
        `,
        [scope.tenantId, scope.clinicId, date, timezone]
      );

      return {
        appointments,
        leads,
        tasks,
        queue,
        returningPatientIds: new Set(returningRows.rows.map((row) => row.patient_id))
      };
    });
  }

  async loadOwnerDashboardProjectionData(
    scope: RepositoryScope,
    range: DateRangeFilter
  ): Promise<OwnerDashboardProjectionData> {
    return this.#withRls(scope, async (client) => {
      const patientRows = await client.query<{
        id: UUID;
        source: OwnerDashboardProjectionData["patients"][number]["source"];
        created_at: Date | string;
      }>(
        `
          select id, source, created_at
          from patients
          where tenant_id = $1 and clinic_id = $2 and created_at <= $3
        `,
        [scope.tenantId, scope.clinicId, range.endAt]
      );
      const leadRows = await client.query<LeadRow>(
        `
          select *
          from leads
          where tenant_id = $1 and clinic_id = $2 and first_seen_at <= $3
        `,
        [scope.tenantId, scope.clinicId, range.endAt]
      );
      const appointmentRows = await client.query<AppointmentRow>(
        `
          select *
          from appointments
          where tenant_id = $1 and clinic_id = $2 and start_at <= $3
        `,
        [scope.tenantId, scope.clinicId, range.endAt]
      );
      const encounterRows = await client.query<EncounterRow>(
        `
          select *
          from encounters
          where tenant_id = $1 and clinic_id = $2 and created_at <= $3
        `,
        [scope.tenantId, scope.clinicId, range.endAt]
      );
      const attributionRows = await client.query<AttributionTouchRow>(
        `
          select *
          from attribution_touches
          where tenant_id = $1 and clinic_id = $2 and occurred_at <= $3
        `,
        [scope.tenantId, scope.clinicId, range.endAt]
      );
      const treatmentPlanRows = await client.query<TreatmentPlanRow>(
        `
          select *
          from treatment_plans
          where tenant_id = $1
            and clinic_id = $2
            and (
              created_at between $3 and $4
              or presented_at between $3 and $4
              or accepted_at between $3 and $4
            )
        `,
        [scope.tenantId, scope.clinicId, range.startAt, range.endAt]
      );
      const procedureRows = await client.query<ProcedurePerformedRow>(
        `
          select *
          from procedure_performed_records
          where tenant_id = $1 and clinic_id = $2 and performed_at <= $3
        `,
        [scope.tenantId, scope.clinicId, range.endAt]
      );
      const invoiceRows = await client.query<InvoiceRow>(
        `
          select *
          from invoices
          where tenant_id = $1 and clinic_id = $2 and issued_at <= $3
        `,
        [scope.tenantId, scope.clinicId, range.endAt]
      );
      const paymentRows = await client.query<PaymentTransactionRow>(
        `
          select *
          from payment_transactions
          where tenant_id = $1 and clinic_id = $2 and received_at between $3 and $4
        `,
        [scope.tenantId, scope.clinicId, range.startAt, range.endAt]
      );
      const taskRows = await client.query<TaskRow>(
        `
          select *
          from tasks
          where tenant_id = $1
            and clinic_id = $2
            and (
              created_at between $3 and $4
              or updated_at between $3 and $4
              or due_at <= $4
            )
        `,
        [scope.tenantId, scope.clinicId, range.startAt, range.endAt]
      );

      const leads = leadRows.rows.map(mapLeadRow);
      const appointments = appointmentRows.rows.map(mapAppointmentRow);
      const encounters = encounterRows.rows.map(mapEncounterRow);
      const attributionTouches = attributionRows.rows.map(mapAttributionTouchRow);
      const treatmentPlans = treatmentPlanRows.rows.map(mapTreatmentPlanRow);
      const procedures = procedureRows.rows.map(mapProcedurePerformedRow);
      const invoices = invoiceRows.rows.map(mapInvoiceRow);
      const payments = paymentRows.rows.map(mapPaymentTransactionRow);
      const tasks = taskRows.rows.map(mapTaskRow);

      return {
        patients: patientRows.rows.map((patient) => ({
          id: patient.id,
          source: patient.source,
          createdAt: toIso(patient.created_at)
        })),
        leads: leads.map((lead) => ({
          id: lead.id,
          patientId: lead.patientId,
          source: lead.source,
          status: lead.status,
          firstSeenAt: lead.firstSeenAt
        })),
        appointments: appointments.map((appointment) => ({
          id: appointment.id,
          patientId: appointment.patientId,
          leadId: appointment.leadId,
          status: appointment.status,
          source: appointment.source,
          startAt: appointment.startAt
        })),
        encounters: encounters.map((encounter) => ({
          id: encounter.id,
          patientId: encounter.patientId,
          appointmentId: encounter.appointmentId,
          status: encounter.status,
          createdAt: encounter.createdAt
        })),
        attributionTouches: attributionTouches.map((touch) => ({
          id: touch.id,
          patientId: touch.patientId,
          leadId: touch.leadId,
          appointmentId: touch.appointmentId,
          invoiceId: touch.invoiceId,
          source: touch.source,
          touchType: touch.touchType,
          occurredAt: touch.occurredAt
        })),
        treatmentPlans: treatmentPlans.map((plan) => ({
          id: plan.id,
          patientId: plan.patientId,
          status: plan.status,
          totalMinor: plan.totalMinor,
          presentedAt: plan.presentedAt,
          acceptedAt: plan.acceptedAt,
          createdAt: plan.createdAt
        })),
        procedures: procedures.map((procedure) => ({
          id: procedure.id,
          patientId: procedure.patientId,
          encounterId: procedure.encounterId,
          treatmentPlanId: procedure.treatmentPlanId,
          invoiceId: procedure.invoiceId,
          status: procedure.status,
          totalMinor: procedure.totalMinor,
          performedAt: procedure.performedAt
        })),
        invoices: invoices.map((invoice) => ({
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
        payments: payments.map((payment) => ({
          id: payment.id,
          invoiceId: payment.invoiceId,
          status: payment.status,
          amountMinor: payment.amountMinor,
          receivedAt: payment.receivedAt
        })),
        recalls: tasks
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
        tasks: tasks.map((task) => ({
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
            key: "owner-dashboard-core-domain-tables",
            label: "Owner dashboard core domain tables",
            status: "ready",
            recordCount:
              patientRows.rows.length +
              leads.length +
              appointments.length +
              treatmentPlans.length +
              procedures.length +
              invoices.length +
              payments.length +
              tasks.length,
            provenance: [
              "patients",
              "leads",
              "appointments",
              "encounters",
              "attribution_touches",
              "treatment_plans",
              "procedure_performed_records",
              "invoices",
              "payment_transactions",
              "tasks"
            ],
            notes: "Live projection uses existing CP2-CP5 durable tables and the CP2 tasks table."
          },
          {
            key: "cp6-continuity-operations-tables",
            label: "CP6 lab, inventory, SOP, incident, and CAPA tables",
            status: "schema_dependency",
            recordCount: 0,
            provenance: [
              "sop_runs",
              "lab_cases",
              "inventory_exceptions",
              "incidents",
              "corrective_actions"
            ],
            notes:
              "Waiting on Workflow/Task Backend and Lab/Inventory/Event CP6 migrations before live rows can contribute."
          }
        ]
      };
    });
  }

  async listPricebookProcedures(scope: RepositoryScope): Promise<PricebookProcedureRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<PricebookProcedureRow>(
        `
          select *
          from pricebook_procedures
          where tenant_id = $1 and clinic_id = $2 and status = 'active'
          order by category, display_name
        `,
        [scope.tenantId, scope.clinicId]
      );
      return result.rows.map(mapPricebookProcedureRow);
    });
  }

  async findPricebookProcedureById(
    scope: RepositoryScope,
    procedureId: UUID
  ): Promise<PricebookProcedureRecord | null> {
    return this.#withRls(scope, async (client) =>
      this.#findPricebookProcedureByIdInTransaction(client, scope, procedureId)
    );
  }

  async listIntakeFormTemplates(scope: RepositoryScope): Promise<IntakeFormTemplateRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<IntakeFormTemplateRow>(
        `
          select *
          from form_templates
          where tenant_id = $1 and clinic_id = $2 and active = true
          order by code, version desc
        `,
        [scope.tenantId, scope.clinicId]
      );
      return result.rows.map(mapIntakeFormTemplateRow);
    });
  }

  async findIntakeFormTemplateById(
    scope: RepositoryScope,
    templateId: UUID
  ): Promise<IntakeFormTemplateRecord | null> {
    return this.#withRls(scope, async (client) =>
      this.#findIntakeFormTemplateByIdInTransaction(client, scope, templateId)
    );
  }

  async createIntakeFormTemplate(
    scope: RepositoryScope,
    input: CreateIntakeFormTemplateInput
  ): Promise<IntakeFormTemplateRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<IntakeFormTemplateRow>(
        `
          insert into form_templates (
            tenant_id,
            clinic_id,
            code,
            display_name,
            form_type,
            version,
            schema,
            active,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.code,
          input.displayName,
          input.formType,
          input.version,
          JSON.stringify(input.schema),
          input.active ?? true,
          scope.actorUserId
        ]
      );

      return mapIntakeFormTemplateRow(result.rows[0]);
    });
  }

  async createIntakeFormSubmission(
    scope: RepositoryScope,
    input: CreateIntakeFormSubmissionInput
  ): Promise<IntakeFormSubmissionRecord> {
    return this.#withRls(scope, async (client) => {
      const template = await this.#findIntakeFormTemplateByIdInTransaction(
        client,
        scope,
        input.templateId
      );

      if (!template) {
        throw new Error("Intake form template not found.");
      }

      const result = await client.query<IntakeFormSubmissionRow>(
        `
          insert into form_responses (
            tenant_id,
            clinic_id,
            patient_id,
            template_id,
            template_version,
            source,
            responses,
            medical_history_snapshot,
            provenance,
            submitted_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.patientId,
          input.templateId,
          template.version,
          input.source,
          JSON.stringify(input.responses),
          JSON.stringify(input.medicalHistorySnapshot ?? {}),
          JSON.stringify(input.provenance ?? {}),
          scope.actorUserId
        ]
      );
      const submission = mapIntakeFormSubmissionRow(result.rows[0]);

      await this.#appendTimeline(client, scope, {
        patientId: input.patientId,
        itemType: "form_response_submitted",
        sourceTable: "form_responses",
        sourceId: submission.id,
        title: "Intake submitted",
        summary:
          input.source === "assistant_paper_card"
            ? "Assistant-entered paper intake"
            : "Digital intake form submitted",
        metadata: {
          templateId: input.templateId,
          templateVersion: template.version,
          source: input.source
        }
      });

      return submission;
    });
  }

  async listPatientIntakeFormSubmissions(
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<IntakeFormSubmissionRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<IntakeFormSubmissionRow>(
        `
          select *
          from form_responses
          where tenant_id = $1 and clinic_id = $2 and patient_id = $3
          order by submitted_at desc
        `,
        [scope.tenantId, scope.clinicId, patientId]
      );
      return result.rows.map(mapIntakeFormSubmissionRow);
    });
  }

  async listPatientConsents(scope: RepositoryScope, patientId: UUID): Promise<ConsentRecord[]> {
    return this.#withRls(scope, async (client) =>
      this.#listPatientConsentsInTransaction(client, scope, patientId)
    );
  }

  async createConsent(scope: RepositoryScope, input: CreateConsentInput): Promise<ConsentRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<ConsentRow>(
        `
          insert into consents (
            tenant_id,
            clinic_id,
            patient_id,
            purpose,
            template_code,
            template_version,
            capture_method,
            granted_by_name,
            relationship_to_patient,
            evidence,
            provenance,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.patientId,
          input.purpose,
          input.templateCode,
          input.templateVersion,
          input.captureMethod,
          input.grantedByName ?? null,
          input.relationshipToPatient ?? null,
          JSON.stringify(input.evidence ?? {}),
          JSON.stringify(input.provenance ?? {}),
          scope.actorUserId
        ]
      );
      const consent = mapConsentRow(result.rows[0]);

      await this.#appendTimeline(client, scope, {
        patientId: consent.patientId,
        itemType: "consent_created",
        sourceTable: "consents",
        sourceId: consent.id,
        title: "Consent recorded",
        summary: consent.purpose.replaceAll("_", " "),
        metadata: { purpose: consent.purpose, captureMethod: consent.captureMethod }
      });

      return consent;
    });
  }

  async revokeConsent(
    scope: RepositoryScope,
    consentId: UUID,
    input: RevokeConsentInput
  ): Promise<ConsentRecord | null> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<ConsentRow>(
        `
          update consents
          set
            status = 'revoked',
            revoked_by_user_id = $4,
            revoked_at = now(),
            revocation_reason = $5
          where tenant_id = $1 and clinic_id = $2 and id = $3 and status = 'active'
          returning *
        `,
        [scope.tenantId, scope.clinicId, consentId, scope.actorUserId, input.revocationReason]
      );
      const consent = result.rows[0] ? mapConsentRow(result.rows[0]) : null;

      if (consent) {
        await this.#appendTimeline(client, scope, {
          patientId: consent.patientId,
          itemType: "consent_revoked",
          sourceTable: "consents",
          sourceId: consent.id,
          title: "Consent revoked",
          summary: consent.purpose.replaceAll("_", " "),
          metadata: { purpose: consent.purpose, reason: input.revocationReason }
        });
      }

      return consent;
    });
  }

  async getConsentEnforcementState(
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<ConsentEnforcementState> {
    const consents = await this.listPatientConsents(scope, patientId);
    return buildConsentEnforcementState(patientId, consents);
  }

  async createEncounter(
    scope: RepositoryScope,
    input: CreateEncounterInput
  ): Promise<EncounterRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<EncounterRow>(
        `
          insert into encounters (
            tenant_id,
            clinic_id,
            patient_id,
            appointment_id,
            provider_user_id,
            reason,
            medical_history_snapshot,
            created_by_user_id,
            updated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $8)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.patientId,
          input.appointmentId ?? null,
          input.providerUserId,
          input.reason ?? null,
          JSON.stringify(input.medicalHistorySnapshot ?? {}),
          scope.actorUserId
        ]
      );
      const encounter = mapEncounterRow(result.rows[0]);

      await this.#appendEncounterStatusHistory(client, scope, encounter, null, "encounter_created");
      await this.#appendTimeline(client, scope, {
        patientId: encounter.patientId,
        itemType: "encounter_created",
        sourceTable: "encounters",
        sourceId: encounter.id,
        title: "Encounter created",
        summary: encounter.reason,
        metadata: {
          appointmentId: encounter.appointmentId,
          providerUserId: encounter.providerUserId
        }
      });

      return encounter;
    });
  }

  async findEncounterById(
    scope: RepositoryScope,
    encounterId: UUID
  ): Promise<EncounterRecord | null> {
    return this.#withRls(scope, async (client) =>
      this.#findEncounterByIdInTransaction(client, scope, encounterId)
    );
  }

  async transitionEncounter(
    scope: RepositoryScope,
    encounterId: UUID,
    status: EncounterRecord["status"],
    reason?: string | null
  ): Promise<EncounterRecord | null> {
    return this.#withRls(scope, async (client) => {
      const existing = await this.#findEncounterByIdInTransaction(client, scope, encounterId);
      if (!existing) return null;

      const result = await client.query<EncounterRow>(
        `
          update encounters
          set
            status = $4,
            started_at = case when $4 = 'drafting' and started_at is null then now() else started_at end,
            closed_at = case when $4 = 'closed' and closed_at is null then now() else closed_at end,
            updated_by_user_id = $5
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, encounterId, status, scope.actorUserId]
      );
      const encounter = mapEncounterRow(result.rows[0]);

      await this.#appendEncounterStatusHistory(
        client,
        scope,
        encounter,
        existing.status,
        reason ?? null
      );

      if (status === "drafting" && existing.status === "scheduled") {
        await this.#appendTimeline(client, scope, {
          patientId: encounter.patientId,
          itemType: "encounter_started",
          sourceTable: "encounters",
          sourceId: encounter.id,
          title: "Encounter started",
          summary: encounter.reason,
          metadata: {
            appointmentId: encounter.appointmentId,
            providerUserId: encounter.providerUserId
          }
        });
      }

      return encounter;
    });
  }

  async saveClinicalNoteDraft(
    scope: RepositoryScope,
    encounterId: UUID,
    input: SaveClinicalNoteDraftInput
  ): Promise<ClinicalNoteVersionRecord | null> {
    return this.#withRls(scope, async (client) => {
      const encounter = await this.#findEncounterByIdInTransaction(client, scope, encounterId);
      if (!encounter || ["signed", "amended", "closed", "cancelled"].includes(encounter.status)) {
        return null;
      }

      const content = normalizeClinicalNoteContent(input.content);
      const existingDraft = await this.#findLatestClinicalNoteVersionInTransaction(
        client,
        scope,
        encounterId,
        "draft"
      );
      let note: ClinicalNoteVersionRecord;

      if (existingDraft) {
        const result = await client.query<ClinicalNoteVersionRow>(
          `
            update clinical_note_versions
            set content = $4::jsonb
            where tenant_id = $1 and clinic_id = $2 and id = $3
            returning *
          `,
          [scope.tenantId, scope.clinicId, existingDraft.id, JSON.stringify(content)]
        );
        note = mapClinicalNoteVersionRow(result.rows[0]);
      } else {
        const versionNumber = await this.#nextClinicalNoteVersionNumber(client, scope, encounterId);
        const result = await client.query<ClinicalNoteVersionRow>(
          `
            insert into clinical_note_versions (
              tenant_id,
              clinic_id,
              encounter_id,
              patient_id,
              version_number,
              content,
              created_by_user_id
            )
            values ($1, $2, $3, $4, $5, $6::jsonb, $7)
            returning *
          `,
          [
            scope.tenantId,
            scope.clinicId,
            encounter.id,
            encounter.patientId,
            versionNumber,
            JSON.stringify(content),
            scope.actorUserId
          ]
        );
        note = mapClinicalNoteVersionRow(result.rows[0]);
        await this.#appendTimeline(client, scope, {
          patientId: note.patientId,
          itemType: "clinical_note_draft_created",
          sourceTable: "clinical_note_versions",
          sourceId: note.id,
          title: "Clinical note drafted",
          summary: `Version ${note.versionNumber}`,
          metadata: { encounterId: note.encounterId, readyForSign: input.readyForSign === true }
        });
      }

      const status = input.readyForSign ? "ready_for_sign" : "drafting";
      await client.query(
        `
          update encounters
          set status = $4, updated_by_user_id = $5
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [scope.tenantId, scope.clinicId, encounterId, status, scope.actorUserId]
      );

      return note;
    });
  }

  async listClinicalNoteVersions(
    scope: RepositoryScope,
    encounterId: UUID
  ): Promise<ClinicalNoteVersionRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<ClinicalNoteVersionRow>(
        `
          select *
          from clinical_note_versions
          where tenant_id = $1 and clinic_id = $2 and encounter_id = $3
          order by version_number desc
        `,
        [scope.tenantId, scope.clinicId, encounterId]
      );
      return result.rows.map(mapClinicalNoteVersionRow);
    });
  }

  async signClinicalNote(
    scope: RepositoryScope,
    encounterId: UUID
  ): Promise<SignClinicalNoteResult | null> {
    return this.#withRls(scope, async (client) => {
      const encounter = await this.#findEncounterByIdInTransaction(client, scope, encounterId);
      if (!encounter) return null;
      const draft = await this.#findLatestClinicalNoteVersionInTransaction(
        client,
        scope,
        encounterId,
        "draft"
      );
      if (!draft) return null;

      assertClinicalNoteCanBeSigned(draft);

      const noteResult = await client.query<ClinicalNoteVersionRow>(
        `
          update clinical_note_versions
          set status = 'signed', signed_by_user_id = $4, signed_at = now()
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, draft.id, scope.actorUserId]
      );
      const note = mapClinicalNoteVersionRow(noteResult.rows[0]);
      const encounterResult = await client.query<EncounterRow>(
        `
          update encounters
          set status = 'signed', updated_by_user_id = $4
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, encounter.id, scope.actorUserId]
      );
      const updatedEncounter = mapEncounterRow(encounterResult.rows[0]);

      await this.#appendEncounterStatusHistory(
        client,
        scope,
        updatedEncounter,
        encounter.status,
        "clinical_note_signed"
      );
      await this.#appendTimeline(client, scope, {
        patientId: note.patientId,
        itemType: "clinical_note_signed",
        sourceTable: "clinical_note_versions",
        sourceId: note.id,
        title: "Clinical note signed",
        summary: `Version ${note.versionNumber}`,
        metadata: { encounterId: note.encounterId, signedByUserId: note.signedByUserId }
      });

      return { encounter: updatedEncounter, note };
    });
  }

  async amendClinicalNote(
    scope: RepositoryScope,
    encounterId: UUID,
    input: AmendClinicalNoteInput
  ): Promise<AmendClinicalNoteResult | null> {
    return this.#withRls(scope, async (client) => {
      const encounter = await this.#findEncounterByIdInTransaction(client, scope, encounterId);
      if (!encounter) return null;
      const latestSigned = await this.#findLatestSignedClinicalNoteVersionInTransaction(
        client,
        scope,
        encounterId
      );
      if (!latestSigned) return null;

      assertClinicalNoteCanBeAmended(latestSigned);

      const versionNumber = await this.#nextClinicalNoteVersionNumber(client, scope, encounterId);
      const noteResult = await client.query<ClinicalNoteVersionRow>(
        `
          insert into clinical_note_versions (
            tenant_id,
            clinic_id,
            encounter_id,
            patient_id,
            version_number,
            status,
            content,
            amendment_reason,
            amended_from_version_id,
            signed_by_user_id,
            signed_at,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, 'amended', $6::jsonb, $7, $8, $9, now(), $9)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          encounter.id,
          encounter.patientId,
          versionNumber,
          JSON.stringify(normalizeClinicalNoteContent(input.content)),
          input.amendmentReason,
          latestSigned.id,
          scope.actorUserId
        ]
      );
      const note = mapClinicalNoteVersionRow(noteResult.rows[0]);
      const encounterResult = await client.query<EncounterRow>(
        `
          update encounters
          set status = 'amended', updated_by_user_id = $4
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, encounter.id, scope.actorUserId]
      );
      const updatedEncounter = mapEncounterRow(encounterResult.rows[0]);

      await this.#appendEncounterStatusHistory(
        client,
        scope,
        updatedEncounter,
        encounter.status,
        "clinical_note_amended"
      );
      await this.#appendTimeline(client, scope, {
        patientId: note.patientId,
        itemType: "clinical_note_amended",
        sourceTable: "clinical_note_versions",
        sourceId: note.id,
        title: "Clinical note amended",
        summary: input.amendmentReason,
        metadata: {
          encounterId: note.encounterId,
          amendedFromVersionId: latestSigned.id,
          versionNumber: note.versionNumber
        }
      });

      return { encounter: updatedEncounter, note, amendedFrom: latestSigned };
    });
  }

  async createPrescription(
    scope: RepositoryScope,
    encounterId: UUID,
    input: CreatePrescriptionInput
  ): Promise<PrescriptionRecord | null> {
    return this.#withRls(scope, async (client) => {
      const encounter = await this.#findEncounterByIdInTransaction(client, scope, encounterId);
      if (!encounter) return null;
      const result = await client.query<PrescriptionRow>(
        `
          insert into prescriptions (
            tenant_id,
            clinic_id,
            encounter_id,
            patient_id,
            medications,
            notes,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5::jsonb, $6, $7)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          encounter.id,
          encounter.patientId,
          JSON.stringify(input.medications),
          input.notes ?? null,
          scope.actorUserId
        ]
      );
      const prescription = mapPrescriptionRow(result.rows[0]);

      await this.#appendTimeline(client, scope, {
        patientId: prescription.patientId,
        itemType: "prescription_draft_created",
        sourceTable: "prescriptions",
        sourceId: prescription.id,
        title: "Prescription drafted",
        summary: `${prescription.medications.length} medication(s)`,
        metadata: { encounterId: prescription.encounterId, status: prescription.status }
      });

      return prescription;
    });
  }

  async findPrescriptionById(
    scope: RepositoryScope,
    prescriptionId: UUID
  ): Promise<PrescriptionRecord | null> {
    return this.#withRls(scope, async (client) =>
      this.#findPrescriptionByIdInTransaction(client, scope, prescriptionId)
    );
  }

  async signPrescription(
    scope: RepositoryScope,
    prescriptionId: UUID
  ): Promise<PrescriptionRecord | null> {
    return this.#withRls(scope, async (client) => {
      const existing = await this.#findPrescriptionByIdInTransaction(client, scope, prescriptionId);
      if (!existing) return null;

      assertPrescriptionCanBeSigned(existing);

      const result = await client.query<PrescriptionRow>(
        `
          update prescriptions
          set status = 'signed', signed_by_user_id = $4, signed_at = now()
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, prescriptionId, scope.actorUserId]
      );
      const prescription = mapPrescriptionRow(result.rows[0]);

      await this.#appendTimeline(client, scope, {
        patientId: prescription.patientId,
        itemType: "prescription_signed",
        sourceTable: "prescriptions",
        sourceId: prescription.id,
        title: "Prescription signed",
        summary: `${prescription.medications.length} medication(s)`,
        metadata: {
          encounterId: prescription.encounterId,
          signedByUserId: prescription.signedByUserId
        }
      });

      return prescription;
    });
  }

  async createPatientInstruction(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreatePatientInstructionInput
  ): Promise<PatientInstructionRecord | null> {
    return this.#withRls(scope, async (client) => {
      const patient = await this.#findPatientByIdInTransaction(client, scope, patientId);
      if (!patient) return null;

      const now = this.#clock.now().toISOString();
      const status = input.channel === "print" ? "ready_for_print" : "send_requested";
      const printJobId = input.channel === "print" ? `print_${randomUUID()}` : null;
      const outboxEventId =
        input.channel === "whatsapp" ? (input.outboxEventId ?? (randomUUID() as UUID)) : null;
      const result = await client.query<PatientInstructionRow>(
        `
          insert into patient_instruction_requests (
            tenant_id,
            clinic_id,
            patient_id,
            channel,
            template_id,
            title,
            body,
            status,
            rendered_at,
            print_job_id,
            outbox_event_id,
            created_by_user_id,
            created_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9::timestamptz, $10, $11, $12, $9::timestamptz)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          patientId,
          input.channel,
          input.templateId.trim(),
          input.title?.trim() || "Post-care instructions",
          input.body?.trim() ||
            "Follow the clinic-approved post-care instructions. Contact the clinic if symptoms worsen.",
          status,
          now,
          printJobId,
          outboxEventId,
          scope.actorUserId
        ]
      );
      const instruction = mapPatientInstructionRow(result.rows[0]);
      await this.#appendTimeline(client, scope, {
        patientId,
        itemType:
          input.channel === "print" ? "instruction_print_requested" : "instruction_send_requested",
        sourceTable: "patient_instruction_requests",
        sourceId: instruction.id,
        title:
          input.channel === "print" ? "Instruction print requested" : "Instruction send requested",
        summary: instruction.templateId,
        metadata: {
          instructionId: instruction.id,
          templateId: instruction.templateId,
          channel: instruction.channel,
          outboxEventId: instruction.outboxEventId,
          providerConfirmationReceived: false
        }
      });

      return instruction;
    });
  }

  async createAiSession(
    scope: RepositoryScope,
    input: CreateAiSessionInput
  ): Promise<AiSessionRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<AiSessionRow>(
        `
          insert into ai_sessions (
            tenant_id,
            clinic_id,
            patient_id,
            encounter_id,
            provider_mode,
            llm_provider_key,
            transcription_provider_key,
            consent_snapshot,
            retention_policy,
            language_hint,
            raw_audio_deleted_at,
            metadata,
            started_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11::timestamptz, $12::jsonb, $13)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.patientId,
          input.encounterId,
          input.providerMode,
          input.llmProviderKey,
          input.transcriptionProviderKey,
          JSON.stringify(input.consentSnapshot),
          JSON.stringify(input.retentionPolicy),
          input.languageHint ?? null,
          input.retentionPolicy.rawAudioRetention === "disabled"
            ? this.#clock.now().toISOString()
            : null,
          JSON.stringify(input.metadata ?? {}),
          scope.actorUserId
        ]
      );
      const session = mapAiSessionRow(result.rows[0]);
      await this.#appendTimeline(client, scope, {
        patientId: session.patientId,
        itemType: "ai_session_started",
        sourceTable: "ai_sessions",
        sourceId: session.id,
        title: "AI scribe session started",
        summary: session.providerMode,
        metadata: {
          encounterId: session.encounterId,
          providerMode: session.providerMode,
          rawAudioRetention: session.retentionPolicy.rawAudioRetention
        }
      });
      return session;
    });
  }

  async findAiSessionById(
    scope: RepositoryScope,
    sessionId: UUID
  ): Promise<AiSessionRecord | null> {
    return this.#withRls(scope, async (client) =>
      this.#findAiSessionByIdInTransaction(client, scope, sessionId)
    );
  }

  async findAiSessionDetail(
    scope: RepositoryScope,
    sessionId: UUID
  ): Promise<AiSessionDetail | null> {
    return this.#withRls(scope, async (client) => {
      const session = await this.#findAiSessionByIdInTransaction(client, scope, sessionId);
      if (!session) return null;
      const transcriptSegments = (
        await client.query<AiTranscriptSegmentRow>(
          `
            select *
            from ai_transcript_segments
            where tenant_id = $1 and clinic_id = $2 and session_id = $3
            order by sequence
          `,
          [scope.tenantId, scope.clinicId, sessionId]
        )
      ).rows.map(mapAiTranscriptSegmentRow);
      const sourceAnchors = await this.#listAiSourceAnchorsInTransaction(client, scope, sessionId);
      const jobs = (
        await client.query<AiJobRow>(
          `
            select *
            from ai_jobs
            where tenant_id = $1 and clinic_id = $2 and session_id = $3
            order by created_at
          `,
          [scope.tenantId, scope.clinicId, sessionId]
        )
      ).rows.map(mapAiJobRow);
      const draftOutputs = (
        await client.query<AiDraftOutputRow>(
          `
            select *
            from ai_draft_outputs
            where tenant_id = $1 and clinic_id = $2 and session_id = $3
            order by created_at
          `,
          [scope.tenantId, scope.clinicId, sessionId]
        )
      ).rows.map(mapAiDraftOutputRow);
      const actionProposals = (
        await client.query<AiActionProposalRow>(
          `
            select *
            from ai_action_proposals
            where tenant_id = $1 and clinic_id = $2 and session_id = $3
            order by created_at
          `,
          [scope.tenantId, scope.clinicId, sessionId]
        )
      ).rows.map(mapAiActionProposalRow);
      const reviewDecisions = (
        await client.query<AiReviewDecisionRow>(
          `
            select *
            from ai_review_decisions
            where tenant_id = $1 and clinic_id = $2 and session_id = $3
            order by reviewed_at
          `,
          [scope.tenantId, scope.clinicId, sessionId]
        )
      ).rows.map(mapAiReviewDecisionRow);
      return {
        session,
        transcriptSegments,
        sourceAnchors,
        jobs,
        draftOutputs,
        actionProposals,
        reviewDecisions
      };
    });
  }

  async listAiSessionsForEncounter(
    scope: RepositoryScope,
    encounterId: UUID
  ): Promise<AiSessionRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<AiSessionRow>(
        `
          select *
          from ai_sessions
          where tenant_id = $1 and clinic_id = $2 and encounter_id = $3
          order by started_at desc
        `,
        [scope.tenantId, scope.clinicId, encounterId]
      );
      return result.rows.map(mapAiSessionRow);
    });
  }

  async createAiTranscriptSegment(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiTranscriptSegmentInput
  ): Promise<{ segment: AiTranscriptSegmentRecord; sourceAnchor: AiSourceAnchorRecord } | null> {
    return this.#withRls(scope, async (client) => {
      const session = await this.#findAiSessionByIdInTransaction(client, scope, sessionId);
      if (!session || session.status === "retention_deleted") return null;
      const sequence = Number(
        (
          await client.query<{ next_sequence: string }>(
            `
              select (coalesce(max(sequence), 0) + 1)::text as next_sequence
              from ai_transcript_segments
              where tenant_id = $1 and clinic_id = $2 and session_id = $3
            `,
            [scope.tenantId, scope.clinicId, sessionId]
          )
        ).rows[0].next_sequence
      );
      const segmentResult = await client.query<AiTranscriptSegmentRow>(
        `
          insert into ai_transcript_segments (
            id,
            tenant_id,
            clinic_id,
            session_id,
            patient_id,
            encounter_id,
            sequence,
            speaker_role,
            text,
            starts_at_ms,
            ends_at_ms,
            source_hash,
            created_by_user_id
          )
          values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          returning *
        `,
        [
          input.id ?? null,
          scope.tenantId,
          scope.clinicId,
          sessionId,
          session.patientId,
          session.encounterId,
          sequence,
          input.speakerRole ?? "unknown",
          input.text,
          input.startsAtMs,
          input.endsAtMs,
          input.sourceHash,
          scope.actorUserId
        ]
      );
      const segment = mapAiTranscriptSegmentRow(segmentResult.rows[0]);
      const sourceAnchor = await this.#createAiSourceAnchorInTransaction(client, scope, session, {
        anchorType: "transcript_segment",
        sourceRecordType: "ai_transcript_segments",
        sourceRecordId: segment.id,
        transcriptSegmentId: segment.id,
        startsAtMs: segment.startsAtMs,
        endsAtMs: segment.endsAtMs,
        textQuoteDigest: segment.sourceHash,
        supported: true,
        unsupportedReason: null
      });
      await client.query(
        `
          update ai_sessions
          set status = 'processing', updated_at = now()
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [scope.tenantId, scope.clinicId, sessionId]
      );
      return { segment, sourceAnchor };
    });
  }

  async createAiSourceAnchor(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiSourceAnchorInput
  ): Promise<AiSourceAnchorRecord | null> {
    return this.#withRls(scope, async (client) => {
      const session = await this.#findAiSessionByIdInTransaction(client, scope, sessionId);
      if (!session) return null;
      return this.#createAiSourceAnchorInTransaction(client, scope, session, input);
    });
  }

  async createAiJob(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiJobInput
  ): Promise<AiJobRecord | null> {
    return this.#withRls(scope, async (client) => {
      const session = await this.#findAiSessionByIdInTransaction(client, scope, sessionId);
      if (!session) return null;
      const result = await client.query<AiJobRow>(
        `
          insert into ai_jobs (
            tenant_id,
            clinic_id,
            session_id,
            patient_id,
            encounter_id,
            job_type,
            status,
            provider_mode,
            provider_key,
            input_digest,
            output_summary,
            error_code,
            error_message,
            created_by_user_id,
            completed_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14, $15::timestamptz)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          sessionId,
          session.patientId,
          session.encounterId,
          input.jobType,
          input.status,
          input.providerMode,
          input.providerKey,
          input.inputDigest,
          JSON.stringify(input.outputSummary ?? {}),
          input.errorCode ?? null,
          input.errorMessage ?? null,
          scope.actorUserId,
          input.completedAt ??
            (input.status === "succeeded" || input.status === "failed"
              ? this.#clock.now().toISOString()
              : null)
        ]
      );
      return mapAiJobRow(result.rows[0]);
    });
  }

  async createAiDraftOutput(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiDraftOutputInput
  ): Promise<AiDraftOutputRecord | null> {
    return this.#withRls(scope, async (client) => {
      const session = await this.#findAiSessionByIdInTransaction(client, scope, sessionId);
      if (!session) return null;
      assertSupportedSourceAnchors(
        await this.#listAiSourceAnchorsInTransaction(client, scope, sessionId),
        input.sourceAnchorIds
      );
      const result = await client.query<AiDraftOutputRow>(
        `
          insert into ai_draft_outputs (
            tenant_id,
            clinic_id,
            session_id,
            job_id,
            patient_id,
            encounter_id,
            output_type,
            content,
            confidence,
            warnings,
            source_anchor_ids,
            unsupported_source_anchor_ids,
            schema_version,
            provider_mode,
            provider_request_digest,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10::jsonb, $11::uuid[], $12::uuid[], $13, $14, $15, $16)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          sessionId,
          input.jobId ?? null,
          session.patientId,
          session.encounterId,
          input.outputType,
          JSON.stringify(input.content),
          input.confidence,
          JSON.stringify(input.warnings ?? []),
          input.sourceAnchorIds,
          input.unsupportedSourceAnchorIds ?? [],
          input.schemaVersion,
          input.providerMode,
          input.providerRequestDigest,
          scope.actorUserId
        ]
      );
      const output = mapAiDraftOutputRow(result.rows[0]);
      await client.query(
        `
          update ai_sessions
          set status = 'ready_for_review', updated_at = now()
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [scope.tenantId, scope.clinicId, sessionId]
      );
      await this.#appendTimeline(client, scope, {
        patientId: output.patientId,
        itemType: "ai_draft_generated",
        sourceTable: "ai_draft_outputs",
        sourceId: output.id,
        title: "AI draft generated",
        summary: output.outputType,
        metadata: {
          encounterId: output.encounterId,
          outputType: output.outputType,
          reviewStatus: output.reviewStatus
        }
      });
      return output;
    });
  }

  async createAiActionProposal(
    scope: RepositoryScope,
    sessionId: UUID,
    input: CreateAiActionProposalInput
  ): Promise<AiActionProposalRecord | null> {
    return this.#withRls(scope, async (client) => {
      const session = await this.#findAiSessionByIdInTransaction(client, scope, sessionId);
      if (!session) return null;
      assertSupportedSourceAnchors(
        await this.#listAiSourceAnchorsInTransaction(client, scope, sessionId),
        input.sourceAnchorIds
      );
      const result = await client.query<AiActionProposalRow>(
        `
          insert into ai_action_proposals (
            tenant_id,
            clinic_id,
            session_id,
            output_id,
            patient_id,
            encounter_id,
            proposal_type,
            title,
            description,
            proposed_payload,
            required_permission,
            source_anchor_ids,
            unsupported_source_anchor_ids,
            provider_mode,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12::uuid[], $13::uuid[], $14, $15)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          sessionId,
          input.outputId ?? null,
          session.patientId,
          session.encounterId,
          input.proposalType,
          input.title,
          input.description,
          JSON.stringify(input.proposedPayload),
          input.requiredPermission,
          input.sourceAnchorIds,
          input.unsupportedSourceAnchorIds ?? [],
          input.providerMode,
          scope.actorUserId
        ]
      );
      return mapAiActionProposalRow(result.rows[0]);
    });
  }

  async recordAiReviewDecision(
    scope: RepositoryScope,
    sessionId: UUID,
    input: RecordAiReviewDecisionInput
  ): Promise<AiReviewDecisionRecord | null> {
    return this.#withRls(scope, async (client) => {
      const session = await this.#findAiSessionByIdInTransaction(client, scope, sessionId);
      if (!session) return null;
      const targetTable =
        input.targetType === "draft_output" ? "ai_draft_outputs" : "ai_action_proposals";
      const reviewStatus =
        input.decision === "approve"
          ? "approved_review_only"
          : input.decision === "reject"
            ? "rejected"
            : "needs_review";
      const updateResult = await client.query<{ id: UUID }>(
        `
          update ${targetTable}
          set review_status = $4, reviewed_by_user_id = $5, reviewed_at = now(), updated_at = now()
          where tenant_id = $1 and clinic_id = $2 and session_id = $3 and id = $6
          returning id
        `,
        [scope.tenantId, scope.clinicId, sessionId, reviewStatus, scope.actorUserId, input.targetId]
      );
      if (!updateResult.rows[0]) return null;
      const result = await client.query<AiReviewDecisionRow>(
        `
          insert into ai_review_decisions (
            tenant_id,
            clinic_id,
            session_id,
            target_type,
            target_id,
            decision,
            reason,
            edited_content,
            reviewed_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          sessionId,
          input.targetType,
          input.targetId,
          input.decision,
          input.reason,
          input.editedContent ? JSON.stringify(input.editedContent) : null,
          scope.actorUserId
        ]
      );
      return mapAiReviewDecisionRow(result.rows[0]);
    });
  }

  async deleteAiSessionRetainedPayloads(
    scope: RepositoryScope,
    sessionId: UUID
  ): Promise<AiRetentionDeletionResult | null> {
    return this.#withRls(scope, async (client) => {
      const session = await this.#findAiSessionByIdInTransaction(client, scope, sessionId);
      if (!session) return null;
      const deleted = await client.query<{ id: UUID }>(
        `
          delete from ai_transcript_segments
          where tenant_id = $1 and clinic_id = $2 and session_id = $3
          returning id
        `,
        [scope.tenantId, scope.clinicId, sessionId]
      );
      const result = await client.query<AiSessionRow>(
        `
          update ai_sessions
          set
            status = 'retention_deleted',
            raw_audio_deleted_at = coalesce(raw_audio_deleted_at, now()),
            transcript_deleted_at = now(),
            updated_at = now()
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [scope.tenantId, scope.clinicId, sessionId]
      );
      return {
        session: mapAiSessionRow(result.rows[0]),
        deletedTranscriptSegments: deleted.rows.length,
        deletedRawAudioReferences: true
      };
    });
  }

  async createMediaUploadReservation(
    scope: RepositoryScope,
    input: CreateMediaUploadReservationInput
  ): Promise<MediaUploadReservationRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<MediaUploadReservationRow>(
        `
          insert into media_uploads (
            id,
            tenant_id,
            clinic_id,
            patient_id,
            encounter_id,
            tooth_number,
            dental_finding_id,
            media_type,
            original_filename,
            mime_type,
            expected_file_size_bytes,
            expected_sha256_digest,
            object_key,
            storage_provider,
            storage_region,
            expires_at,
            created_by_user_id,
            tags,
            provenance
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19::jsonb)
          returning *
        `,
        [
          input.id,
          scope.tenantId,
          scope.clinicId,
          input.patientId,
          input.encounterId ?? null,
          input.toothNumber ?? null,
          input.dentalFindingId ?? null,
          input.mediaType,
          input.originalFilename,
          input.mimeType,
          input.expectedFileSizeBytes,
          input.expectedSha256Digest ?? null,
          input.objectKey,
          input.storageProvider,
          input.storageRegion ?? null,
          input.expiresAt,
          scope.actorUserId,
          JSON.stringify(input.tags ?? []),
          JSON.stringify(input.provenance ?? {})
        ]
      );

      return mapMediaUploadReservationRow(result.rows[0]);
    });
  }

  async findMediaUploadReservationById(
    scope: RepositoryScope,
    uploadId: UUID
  ): Promise<MediaUploadReservationRecord | null> {
    return this.#withRls(scope, async (client) =>
      this.#findMediaUploadReservationByIdInTransaction(client, scope, uploadId)
    );
  }

  async completeMediaUpload(
    scope: RepositoryScope,
    uploadId: UUID,
    input: CompleteMediaUploadInput
  ): Promise<MediaAssetRecord | null> {
    return this.#withRls(scope, async (client) => {
      const reservation = await this.#findMediaUploadReservationByIdInTransaction(
        client,
        scope,
        uploadId
      );
      if (!reservation || reservation.status !== "reserved") return null;

      const result = await client.query<MediaAssetRow>(
        `
          insert into media_assets (
            tenant_id,
            clinic_id,
            patient_id,
            encounter_id,
            tooth_number,
            dental_finding_id,
            media_type,
            original_filename,
            mime_type,
            file_size_bytes,
            sha256_digest,
            object_key,
            object_version,
            storage_provider,
            storage_region,
            status,
            scan_status,
            quarantine_reason,
            tags,
            provenance,
            dicom_metadata,
            created_by_user_id,
            uploaded_by_user_id,
            created_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21::jsonb, $22, $23, $24)
          returning *
        `,
        [
          reservation.tenantId,
          reservation.clinicId,
          reservation.patientId,
          reservation.encounterId,
          reservation.toothNumber,
          reservation.dentalFindingId,
          reservation.mediaType,
          reservation.originalFilename,
          reservation.mimeType,
          input.contentLength,
          input.sha256Digest ?? reservation.expectedSha256Digest,
          reservation.objectKey,
          input.objectVersion ?? null,
          reservation.storageProvider,
          reservation.storageRegion,
          mediaAssetStatusForScan(input.scanStatus),
          input.scanStatus,
          input.quarantineReason ?? null,
          JSON.stringify(reservation.tags),
          JSON.stringify(reservation.provenance),
          JSON.stringify(input.dicomMetadata ?? {}),
          reservation.createdByUserId,
          scope.actorUserId,
          reservation.createdAt
        ]
      );
      const asset = mapMediaAssetRow(result.rows[0]);

      await client.query(
        `
          update media_uploads
          set status = 'completed', completed_at = now(), media_asset_id = $4
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [scope.tenantId, scope.clinicId, uploadId, asset.id]
      );
      await this.#appendTimeline(client, scope, {
        patientId: asset.patientId,
        itemType: "media_uploaded",
        sourceTable: "media_assets",
        sourceId: asset.id,
        title: `${asset.mediaType.replace("_", " ")} uploaded`,
        summary: asset.originalFilename,
        metadata: {
          mediaAssetId: asset.id,
          mediaType: asset.mediaType,
          encounterId: asset.encounterId,
          toothNumber: asset.toothNumber,
          dentalFindingId: asset.dentalFindingId
        }
      });

      return asset;
    });
  }

  async listPatientMediaAssets(
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<MediaAssetRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<MediaAssetRow>(
        `
          select *
          from media_assets
          where tenant_id = $1 and clinic_id = $2 and patient_id = $3 and status <> 'deleted'
          order by uploaded_at desc
        `,
        [scope.tenantId, scope.clinicId, patientId]
      );
      return result.rows.map(mapMediaAssetRow);
    });
  }

  async findMediaAssetById(
    scope: RepositoryScope,
    mediaAssetId: UUID
  ): Promise<MediaAssetRecord | null> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<MediaAssetRow>(
        `
          select *
          from media_assets
          where tenant_id = $1 and clinic_id = $2 and id = $3 and status <> 'deleted'
        `,
        [scope.tenantId, scope.clinicId, mediaAssetId]
      );
      return result.rows[0] ? mapMediaAssetRow(result.rows[0]) : null;
    });
  }

  async getDentalChart(scope: RepositoryScope, patientId: UUID): Promise<DentalChartView | null> {
    return this.#withRls(scope, async (client) => {
      const chart = await this.#ensureDentalChartInTransaction(client, scope, patientId);
      if (!chart) return null;

      const findings = await this.#listDentalFindingsInTransaction(client, scope, patientId);
      const snapshots = await this.#listDentalChartSnapshotsInTransaction(client, scope, patientId);

      return { chart, findings, snapshots };
    });
  }

  async createDentalFinding(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreateDentalFindingInput
  ): Promise<DentalFindingMutationResult | null> {
    return this.#withRls(scope, async (client) => {
      const patient = await this.#findPatientByIdInTransaction(client, scope, patientId);
      if (!patient) return null;

      if (input.encounterId) {
        const encounter = await this.#findEncounterByIdInTransaction(
          client,
          scope,
          input.encounterId
        );
        if (!encounter || encounter.patientId !== patientId) return null;
      }

      await this.#ensureDentalChartInTransaction(client, scope, patientId);
      const normalized = normalizeCreateDentalFindingInput(input);
      const reviewedAt =
        normalized.reviewStatus === "reviewed" ? this.#clock.now().toISOString() : null;
      const result = await client.query<DentalFindingRow>(
        `
          insert into dental_findings (
            tenant_id,
            clinic_id,
            patient_id,
            encounter_id,
            tooth_number,
            numbering_system,
            surface,
            finding_type,
            severity,
            status,
            review_status,
            source,
            confidence,
            notes,
            provenance,
            treatment_reference,
            created_by_user_id,
            updated_by_user_id,
            reviewed_by_user_id,
            reviewed_at
          )
          values (
            $1, $2, $3, $4, $5, 'fdi', $6, $7, $8, $9, $10, $11, $12, $13,
            $14::jsonb, $15::jsonb, $16, null, $17, $18
          )
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          patientId,
          normalized.encounterId,
          normalized.toothNumber,
          normalized.surface,
          normalized.findingType,
          normalized.severity,
          normalized.status,
          normalized.reviewStatus,
          normalized.source,
          normalized.confidence,
          normalized.notes,
          JSON.stringify(normalized.provenance),
          JSON.stringify(normalized.treatmentReference),
          scope.actorUserId,
          normalized.reviewStatus === "reviewed" ? scope.actorUserId : null,
          reviewedAt
        ]
      );
      const finding = mapDentalFindingRow(result.rows[0]);
      const history = await this.#appendDentalFindingHistory(client, scope, {
        finding,
        changeType: "created",
        reason: null,
        beforeState: null,
        provenance: normalized.provenance
      });

      await this.#appendTimeline(client, scope, {
        patientId,
        itemType: "dental_finding_created",
        sourceTable: "dental_findings",
        sourceId: finding.id,
        title: `Dental finding added on ${finding.toothNumber}`,
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
    });
  }

  async updateDentalFinding(
    scope: RepositoryScope,
    findingId: UUID,
    input: UpdateDentalFindingRepositoryInput
  ): Promise<DentalFindingMutationResult | null> {
    return this.#withRls(scope, async (client) => {
      assertDentalFindingUpdateReason(input.changeReason);
      const existing = await this.#findDentalFindingByIdInTransaction(client, scope, findingId);
      if (!existing) return null;

      if (input.encounterId) {
        const encounter = await this.#findEncounterByIdInTransaction(
          client,
          scope,
          input.encounterId
        );
        if (!encounter || encounter.patientId !== existing.patientId) return null;
      }

      const next = normalizeUpdateDentalFindingInput(existing, input);
      const reviewedByUserId =
        next.reviewStatus === "reviewed" ? (existing.reviewedByUserId ?? scope.actorUserId) : null;
      const reviewedAt =
        next.reviewStatus === "reviewed"
          ? (existing.reviewedAt ?? this.#clock.now().toISOString())
          : null;
      const result = await client.query<DentalFindingRow>(
        `
          update dental_findings
          set
            encounter_id = $4,
            tooth_number = $5,
            surface = $6,
            finding_type = $7,
            severity = $8,
            status = $9,
            review_status = $10,
            source = $11,
            confidence = $12,
            notes = $13,
            provenance = $14::jsonb,
            treatment_reference = $15::jsonb,
            updated_by_user_id = $16,
            reviewed_by_user_id = $17,
            reviewed_at = $18
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          findingId,
          next.encounterId,
          next.toothNumber,
          next.surface,
          next.findingType,
          next.severity,
          next.status,
          next.reviewStatus,
          next.source,
          next.confidence,
          next.notes,
          JSON.stringify(next.provenance),
          JSON.stringify(next.treatmentReference),
          scope.actorUserId,
          reviewedByUserId,
          reviewedAt
        ]
      );
      const finding = mapDentalFindingRow(result.rows[0]);
      const history = await this.#appendDentalFindingHistory(client, scope, {
        finding,
        changeType: "updated",
        reason: input.changeReason.trim(),
        beforeState: toDentalFindingSnapshotFinding(existing),
        provenance: input.provenance ?? {}
      });

      await this.#appendTimeline(client, scope, {
        patientId: finding.patientId,
        itemType: "dental_finding_updated",
        sourceTable: "dental_findings",
        sourceId: finding.id,
        title: `Dental finding updated on ${finding.toothNumber}`,
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
    });
  }

  async listDentalFindingHistory(
    scope: RepositoryScope,
    findingId: UUID
  ): Promise<DentalFindingHistoryRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<DentalFindingHistoryRow>(
        `
          select *
          from dental_finding_history
          where tenant_id = $1 and clinic_id = $2 and finding_id = $3
          order by changed_at desc
        `,
        [scope.tenantId, scope.clinicId, findingId]
      );
      return result.rows.map(mapDentalFindingHistoryRow);
    });
  }

  async createDentalChartSnapshot(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreateDentalChartSnapshotInput
  ): Promise<DentalChartSnapshotRecord | null> {
    return this.#withRls(scope, async (client) => {
      const chart = await this.#ensureDentalChartInTransaction(client, scope, patientId);
      if (!chart) return null;

      if (input.encounterId) {
        const encounter = await this.#findEncounterByIdInTransaction(
          client,
          scope,
          input.encounterId
        );
        if (!encounter || encounter.patientId !== patientId) return null;
      }

      const findings = await this.#listDentalFindingsInTransaction(client, scope, patientId);
      const chartState = buildDentalChartSnapshotState(findings);
      const snapshotVersion = await this.#nextDentalChartSnapshotVersion(client, scope, patientId);
      const result = await client.query<DentalChartSnapshotRow>(
        `
          insert into dental_chart_snapshots (
            tenant_id,
            clinic_id,
            patient_id,
            encounter_id,
            snapshot_version,
            chart_state,
            reason,
            provenance,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          patientId,
          input.encounterId ?? null,
          snapshotVersion,
          JSON.stringify(chartState),
          input.reason ?? null,
          JSON.stringify(input.provenance ?? {}),
          scope.actorUserId
        ]
      );
      const snapshot = mapDentalChartSnapshotRow(result.rows[0]);

      await this.#appendTimeline(client, scope, {
        patientId,
        itemType: "dental_chart_snapshot_created",
        sourceTable: "dental_chart_snapshots",
        sourceId: snapshot.id,
        title: `Dental chart snapshot v${snapshot.snapshotVersion}`,
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
    });
  }

  async createTreatmentPlan(
    scope: RepositoryScope,
    patientId: UUID,
    input: CreateTreatmentPlanInput
  ) {
    return this.#withRls(scope, async (client) => {
      const patient = await this.#findPatientByIdInTransaction(client, scope, patientId);
      if (!patient) return null;
      if (input.encounterId) {
        const encounter = await this.#findEncounterByIdInTransaction(
          client,
          scope,
          input.encounterId
        );
        if (!encounter || encounter.patientId !== patientId) return null;
      }

      const result = await client.query<TreatmentPlanRow>(
        `
          insert into treatment_plans (
            tenant_id,
            clinic_id,
            patient_id,
            encounter_id,
            title,
            status,
            clinical_summary,
            presented_at,
            created_by_user_id,
            updated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, case when $6 = 'presented' then now() else null end, $8, $8)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          patientId,
          input.encounterId ?? null,
          input.title.trim(),
          input.status ?? "draft",
          input.clinicalSummary?.trim() || null,
          scope.actorUserId
        ]
      );
      const plan = mapTreatmentPlanRow(result.rows[0]);
      await this.#replaceTreatmentPlanPhasesInTransaction(client, scope, plan, input.phases);
      await this.#recalculateTreatmentPlanTotalsInTransaction(client, scope, plan.id);
      const detail = await this.#findTreatmentPlanDetailInTransaction(client, scope, plan.id);
      if (!detail) return null;

      await this.#appendTimeline(client, scope, {
        patientId,
        itemType: "treatment_plan_created",
        sourceTable: "treatment_plans",
        sourceId: plan.id,
        title: "Treatment plan created",
        summary: detail.treatmentPlan.title,
        metadata: {
          treatmentPlanId: plan.id,
          status: detail.treatmentPlan.status,
          totalMinor: detail.treatmentPlan.totalMinor
        }
      });

      return { detail };
    });
  }

  async findTreatmentPlanById(
    scope: RepositoryScope,
    treatmentPlanId: UUID
  ): Promise<TreatmentPlanDetail | null> {
    return this.#withRls(scope, async (client) =>
      this.#findTreatmentPlanDetailInTransaction(client, scope, treatmentPlanId)
    );
  }

  async updateTreatmentPlan(
    scope: RepositoryScope,
    treatmentPlanId: UUID,
    input: UpdateTreatmentPlanInput
  ) {
    return this.#withRls(scope, async (client) => {
      const existing = await this.#findTreatmentPlanRowInTransaction(
        client,
        scope,
        treatmentPlanId
      );
      if (!existing) return null;
      assertTreatmentPlanMutable(existing);

      await client.query(
        `
          update treatment_plans
          set
            title = coalesce($4, title),
            clinical_summary = $5,
            status = coalesce($6, status),
            presented_at = case
              when coalesce($6, status) = 'presented' then coalesce(presented_at, now())
              else presented_at
            end,
            updated_by_user_id = $7
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [
          scope.tenantId,
          scope.clinicId,
          treatmentPlanId,
          input.title?.trim() ?? null,
          input.clinicalSummary === undefined
            ? existing.clinicalSummary
            : input.clinicalSummary?.trim() || null,
          input.status ?? null,
          scope.actorUserId
        ]
      );

      if (input.phases) {
        await client.query(
          `
            delete from treatment_plan_phases
            where tenant_id = $1 and clinic_id = $2 and treatment_plan_id = $3
          `,
          [scope.tenantId, scope.clinicId, treatmentPlanId]
        );
        await this.#replaceTreatmentPlanPhasesInTransaction(client, scope, existing, input.phases);
        await this.#recalculateTreatmentPlanTotalsInTransaction(client, scope, treatmentPlanId);
      }

      const detail = await this.#findTreatmentPlanDetailInTransaction(
        client,
        scope,
        treatmentPlanId
      );
      return detail ? { detail } : null;
    });
  }

  async acceptTreatmentPlan(
    scope: RepositoryScope,
    treatmentPlanId: UUID,
    input: AcceptTreatmentPlanInput
  ) {
    return this.#withRls(scope, async (client) => {
      const detail = await this.#findTreatmentPlanDetailInTransaction(
        client,
        scope,
        treatmentPlanId
      );
      if (!detail) return null;
      assertTreatmentPlanAcceptable(
        detail.treatmentPlan,
        detail.phases.reduce((count, phase) => count + phase.estimateItems.length, 0)
      );

      await client.query(
        `
          update treatment_plans
          set
            status = 'accepted',
            presented_at = coalesce(presented_at, now()),
            accepted_at = now(),
            accepted_by_user_id = $4,
            accepted_by_name = $5,
            acceptance_evidence = $6::jsonb,
            updated_by_user_id = $4
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [
          scope.tenantId,
          scope.clinicId,
          treatmentPlanId,
          scope.actorUserId,
          input.acceptedByName?.trim() || null,
          JSON.stringify(input.acceptanceEvidence ?? {})
        ]
      );
      await client.query(
        `
          update treatment_plan_estimate_items
          set status = 'accepted'
          where tenant_id = $1 and clinic_id = $2 and treatment_plan_id = $3 and status = 'planned'
        `,
        [scope.tenantId, scope.clinicId, treatmentPlanId]
      );
      const accepted = await this.#findTreatmentPlanDetailInTransaction(
        client,
        scope,
        treatmentPlanId
      );
      if (!accepted) return null;

      await this.#appendTimeline(client, scope, {
        patientId: accepted.treatmentPlan.patientId,
        itemType: "treatment_plan_accepted",
        sourceTable: "treatment_plans",
        sourceId: accepted.treatmentPlan.id,
        title: "Treatment plan accepted",
        summary: accepted.treatmentPlan.title,
        metadata: {
          treatmentPlanId,
          totalMinor: accepted.treatmentPlan.totalMinor,
          currency: accepted.treatmentPlan.currency
        }
      });

      return { detail: accepted };
    });
  }

  async createProcedurePerformed(
    scope: RepositoryScope,
    encounterId: UUID,
    input: CreateProcedurePerformedInput
  ) {
    return this.#withRls(scope, async (client) => {
      const encounter = await this.#findEncounterByIdInTransaction(client, scope, encounterId);
      if (!encounter) return null;
      const plan = await this.#findTreatmentPlanDetailInTransaction(
        client,
        scope,
        input.treatmentPlanId
      );
      if (!plan || plan.treatmentPlan.patientId !== encounter.patientId) return null;
      if (plan.treatmentPlan.status !== "accepted") {
        throw new Error("Procedures can only be completed from an accepted treatment plan.");
      }
      const estimateItem = plan.phases
        .flatMap((phase) => phase.estimateItems)
        .find((item) => item.id === input.treatmentPlanEstimateItemId);
      if (!estimateItem || estimateItem.status !== "accepted") return null;

      const duplicate = await client.query<{ id: UUID }>(
        `
          select id
          from procedure_performed_records
          where tenant_id = $1
            and clinic_id = $2
            and treatment_plan_estimate_item_id = $3
            and status = 'completed'
          limit 1
        `,
        [scope.tenantId, scope.clinicId, estimateItem.id]
      );
      if (duplicate.rows[0]) {
        throw new Error("This accepted treatment plan item is already completed.");
      }

      const result = await client.query<ProcedurePerformedRow>(
        `
          insert into procedure_performed_records (
            tenant_id,
            clinic_id,
            patient_id,
            encounter_id,
            treatment_plan_id,
            treatment_plan_estimate_item_id,
            pricebook_procedure_id,
            dental_finding_id,
            tooth_number,
            quantity,
            unit_price_minor,
            discount_minor,
            tax_rate_basis_points,
            tax_minor,
            total_minor,
            performed_by_user_id,
            performed_at,
            notes,
            outcome,
            provenance
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, coalesce($17::timestamptz, now()), $18, $19, $20::jsonb)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          encounter.patientId,
          encounterId,
          plan.treatmentPlan.id,
          estimateItem.id,
          estimateItem.pricebookProcedureId,
          estimateItem.dentalFindingId,
          estimateItem.toothNumber,
          estimateItem.quantity,
          estimateItem.unitPriceMinor,
          estimateItem.discountMinor,
          estimateItem.taxRateBasisPoints,
          estimateItem.taxMinor,
          estimateItem.totalMinor,
          scope.actorUserId,
          input.performedAt ?? null,
          input.notes?.trim() || null,
          input.outcome?.trim() || null,
          JSON.stringify(input.provenance ?? {})
        ]
      );
      const procedure = mapProcedurePerformedRow(result.rows[0]);
      await client.query(
        `
          update treatment_plan_estimate_items
          set status = 'completed'
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [scope.tenantId, scope.clinicId, estimateItem.id]
      );
      await this.#appendTimeline(client, scope, {
        patientId: procedure.patientId,
        itemType: "procedure_completed",
        sourceTable: "procedure_performed_records",
        sourceId: procedure.id,
        title: "Procedure completed",
        summary: null,
        metadata: {
          procedurePerformedId: procedure.id,
          treatmentPlanId: procedure.treatmentPlanId,
          estimateItemId: procedure.treatmentPlanEstimateItemId
        }
      });
      const treatmentPlan = await this.#findTreatmentPlanDetailInTransaction(
        client,
        scope,
        procedure.treatmentPlanId
      );
      if (!treatmentPlan) return null;

      return { procedure, treatmentPlan };
    });
  }

  async listCompletedProceduresForInvoice(
    scope: RepositoryScope,
    input: CreateInvoiceInput
  ): Promise<ProcedurePerformedRecord[]> {
    return this.#withRls(scope, async (client) =>
      this.#listCompletedProceduresForInvoiceInTransaction(client, scope, input)
    );
  }

  async createInvoice(scope: RepositoryScope, input: CreateInvoiceInput) {
    return this.#withRls(scope, async (client) => {
      const procedures = await this.#listCompletedProceduresForInvoiceInTransaction(
        client,
        scope,
        input
      );
      if (procedures.length === 0) return null;
      const patientIds = new Set(procedures.map((procedure) => procedure.patientId));
      if (patientIds.size !== 1)
        throw new Error("Invoice procedures must belong to exactly one patient.");

      const subtotalMinor = procedures.reduce(
        (total, procedure) => total + procedure.unitPriceMinor * procedure.quantity,
        0
      );
      const discountMinor = procedures.reduce(
        (total, procedure) => total + procedure.discountMinor,
        0
      );
      const taxMinor = procedures.reduce((total, procedure) => total + procedure.taxMinor, 0);
      const totalMinor = procedures.reduce((total, procedure) => total + procedure.totalMinor, 0);
      const invoiceNumber = await this.#nextInvoiceNumber(client, scope);
      const planIds = new Set(procedures.map((procedure) => procedure.treatmentPlanId));
      const invoiceResult = await client.query<InvoiceRow>(
        `
          insert into invoices (
            tenant_id,
            clinic_id,
            patient_id,
            invoice_number,
            subtotal_minor,
            discount_minor,
            tax_minor,
            total_minor,
            balance_minor,
            treatment_plan_id,
            due_at,
            created_by_user_id,
            updated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $8, $9, $10, $11, $11)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          procedures[0].patientId,
          invoiceNumber,
          subtotalMinor,
          discountMinor,
          taxMinor,
          totalMinor,
          input.treatmentPlanId ?? (planIds.size === 1 ? procedures[0].treatmentPlanId : null),
          input.dueAt ?? null,
          scope.actorUserId
        ]
      );
      const invoice = mapInvoiceRow(invoiceResult.rows[0]);

      for (const procedure of procedures) {
        const pricebookProcedure = await this.#findPricebookProcedureByIdInTransaction(
          client,
          scope,
          procedure.pricebookProcedureId
        );
        await client.query(
          `
            insert into invoice_items (
              tenant_id,
              clinic_id,
              invoice_id,
              patient_id,
              procedure_performed_id,
              treatment_plan_estimate_item_id,
              pricebook_procedure_id,
              description,
              quantity,
              unit_price_minor,
              discount_minor,
              tax_rate_basis_points,
              tax_minor,
              total_minor
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `,
          [
            scope.tenantId,
            scope.clinicId,
            invoice.id,
            invoice.patientId,
            procedure.id,
            procedure.treatmentPlanEstimateItemId,
            procedure.pricebookProcedureId,
            pricebookProcedure?.displayName ?? "Completed dental procedure",
            procedure.quantity,
            procedure.unitPriceMinor,
            procedure.discountMinor,
            procedure.taxRateBasisPoints,
            procedure.taxMinor,
            procedure.totalMinor
          ]
        );
        await client.query(
          `
            update procedure_performed_records
            set invoice_id = $4
            where tenant_id = $1 and clinic_id = $2 and id = $3
          `,
          [scope.tenantId, scope.clinicId, procedure.id, invoice.id]
        );
      }

      await this.#appendTimeline(client, scope, {
        patientId: invoice.patientId,
        itemType: "invoice_created",
        sourceTable: "invoices",
        sourceId: invoice.id,
        title: "Invoice created",
        summary: invoice.invoiceNumber,
        metadata: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          totalMinor: invoice.totalMinor,
          currency: invoice.currency
        }
      });
      const invoiceDetail = await this.#findInvoiceDetailInTransaction(client, scope, invoice.id);
      if (!invoiceDetail) return null;

      return { invoiceDetail, procedures };
    });
  }

  async findInvoiceById(scope: RepositoryScope, invoiceId: UUID): Promise<InvoiceDetail | null> {
    return this.#withRls(scope, async (client) =>
      this.#findInvoiceDetailInTransaction(client, scope, invoiceId)
    );
  }

  async createPaymentRequest(
    scope: RepositoryScope,
    input: CreatePaymentRequestInput
  ): Promise<PaymentRequestRecord | null> {
    return this.#withRls(scope, async (client) => {
      const invoice = await this.#findInvoiceRowInTransaction(client, scope, input.invoiceId);
      if (!invoice || invoice.status !== "issued") return null;
      assertPositiveMinorCurrencyAmount(input.amountMinor, "amountMinor");
      if (input.amountMinor > invoice.balanceMinor) {
        throw new Error("Payment request amount cannot exceed invoice balance.");
      }

      const result = await client.query<PaymentRequestRow>(
        `
          insert into payment_requests (
            tenant_id,
            clinic_id,
            invoice_id,
            patient_id,
            provider,
            request_type,
            status,
            amount_minor,
            currency,
            provider_reference_id,
            provider_url,
            provider_qr_payload,
            expires_at,
            metadata,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          invoice.id,
          invoice.patientId,
          input.provider,
          input.requestType,
          input.providerReferenceId ? "provider_created" : "requested",
          input.amountMinor,
          input.currency ?? invoice.currency,
          input.providerReferenceId ?? null,
          input.providerUrl ?? null,
          input.providerQrPayload ?? null,
          input.expiresAt ?? null,
          JSON.stringify(input.metadata ?? {}),
          scope.actorUserId
        ]
      );
      await this.#recalculateInvoicePaymentStateInTransaction(client, scope, invoice.id);
      return mapPaymentRequestRow(result.rows[0]);
    });
  }

  async recordPaymentTransaction(
    scope: RepositoryScope,
    input: RecordPaymentTransactionInput
  ): Promise<PaymentTransactionRecord | null> {
    return this.#withRls(scope, async (client) => {
      const invoice = await this.#findInvoiceRowInTransaction(client, scope, input.invoiceId);
      if (!invoice) return null;
      if (input.status === "succeeded" && input.verificationStatus !== "verified") {
        throw new Error("Provider payment success requires verified provider evidence.");
      }
      if (
        input.status === "manually_recorded" &&
        input.verificationStatus !== "not_required_manual"
      ) {
        throw new Error("Manual payment requires not_required_manual verification status.");
      }
      if (input.currency && input.currency !== invoice.currency) {
        throw new Error("Payment currency must match invoice currency.");
      }
      if (input.paymentRequestId) {
        const request = await client.query<{ id: UUID }>(
          `
            select id
            from payment_requests
            where tenant_id = $1 and clinic_id = $2 and id = $3 and invoice_id = $4
          `,
          [scope.tenantId, scope.clinicId, input.paymentRequestId, invoice.id]
        );
        if (!request.rows[0]) return null;
      }
      if (input.idempotencyKey) {
        const existing = await client.query<PaymentTransactionRow>(
          `
            select *
            from payment_transactions
            where tenant_id = $1 and clinic_id = $2 and provider = $3 and idempotency_key = $4
            limit 1
          `,
          [scope.tenantId, scope.clinicId, input.provider, input.idempotencyKey]
        );
        if (existing.rows[0]) return mapPaymentTransactionRow(existing.rows[0]);
      }

      const result = await client.query<PaymentTransactionRow>(
        `
          insert into payment_transactions (
            tenant_id,
            clinic_id,
            invoice_id,
            patient_id,
            payment_request_id,
            provider,
            provider_payment_id,
            provider_order_id,
            amount_minor,
            currency,
            method,
            status,
            verification_status,
            reconciliation_status,
            idempotency_key,
            received_at,
            recorded_by_user_id,
            metadata
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, coalesce($16::timestamptz, now()), $17, $18::jsonb)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          invoice.id,
          invoice.patientId,
          input.paymentRequestId ?? null,
          input.provider,
          input.providerPaymentId ?? null,
          input.providerOrderId ?? null,
          input.amountMinor,
          input.currency ?? invoice.currency,
          input.method.trim(),
          input.status,
          input.verificationStatus,
          input.reconciliationStatus ?? "matched",
          input.idempotencyKey ?? null,
          input.receivedAt ?? null,
          input.recordedByUserId === undefined ? scope.actorUserId : input.recordedByUserId,
          JSON.stringify(input.metadata ?? {})
        ]
      );
      const payment = mapPaymentTransactionRow(result.rows[0]);
      await this.#recalculateInvoicePaymentStateInTransaction(client, scope, invoice.id);

      if (isSettledPaymentTransaction(payment)) {
        await this.#appendTimeline(client, scope, {
          patientId: payment.patientId,
          itemType: "payment_recorded",
          sourceTable: "payment_transactions",
          sourceId: payment.id,
          title: "Payment recorded",
          summary: payment.method,
          metadata: {
            invoiceId: payment.invoiceId,
            paymentTransactionId: payment.id,
            provider: payment.provider,
            amountMinor: payment.amountMinor
          }
        });
      }

      return payment;
    });
  }

  async createReceipt(scope: RepositoryScope, invoiceId: UUID, input: CreateReceiptInput) {
    return this.#withRls(scope, async (client) => {
      const detail = await this.#findInvoiceDetailInTransaction(client, scope, invoiceId);
      if (!detail) return null;
      const requestedIds = new Set(input.paymentTransactionIds ?? []);
      const candidatePayments = detail.payments.filter(
        (payment) => requestedIds.size === 0 || requestedIds.has(payment.id)
      );
      assertInvoiceReceiptable({ invoice: detail.invoice, payments: candidatePayments });
      const payments = candidatePayments.filter(
        (payment) => isSettledPaymentTransaction(payment) && !payment.receiptId
      );
      const allocations = payments.map((payment) => ({
        paymentTransactionId: payment.id,
        amountMinor: payment.amountMinor
      }));
      const amountMinor = allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);
      const receiptNumber = await this.#nextReceiptNumber(client, scope);
      const result = await client.query<ReceiptRow>(
        `
          insert into receipts (
            tenant_id,
            clinic_id,
            invoice_id,
            patient_id,
            receipt_number,
            amount_minor,
            currency,
            payment_allocations,
            generated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          detail.invoice.id,
          detail.invoice.patientId,
          receiptNumber,
          amountMinor,
          detail.invoice.currency,
          JSON.stringify(allocations),
          scope.actorUserId
        ]
      );
      const receipt = mapReceiptRow(result.rows[0]);
      await client.query(
        `
          update payment_transactions
          set receipt_id = $4
          where tenant_id = $1 and clinic_id = $2 and id = any($3::uuid[])
        `,
        [scope.tenantId, scope.clinicId, payments.map((payment) => payment.id), receipt.id]
      );
      await this.#appendTimeline(client, scope, {
        patientId: receipt.patientId,
        itemType: "receipt_generated",
        sourceTable: "receipts",
        sourceId: receipt.id,
        title: "Receipt generated",
        summary: receipt.receiptNumber,
        metadata: {
          invoiceId: receipt.invoiceId,
          receiptId: receipt.id,
          receiptNumber: receipt.receiptNumber,
          amountMinor: receipt.amountMinor
        }
      });
      const invoiceDetail = await this.#findInvoiceDetailInTransaction(client, scope, invoiceId);
      if (!invoiceDetail) return null;

      return { invoiceDetail, receipt };
    });
  }

  async listLabVendors(scope: RepositoryScope): Promise<LabVendorRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<LabVendorRow>(
        `
          select *
          from lab_vendors
          where tenant_id = $1 and clinic_id = $2 and status = 'active'
          order by display_name
        `,
        [scope.tenantId, scope.clinicId]
      );
      return result.rows.map(mapLabVendorRow);
    });
  }

  async findLabVendorById(scope: RepositoryScope, vendorId: UUID): Promise<LabVendorRecord | null> {
    return this.#withRls(scope, async (client) =>
      this.#findLabVendorByIdInTransaction(client, scope, vendorId)
    );
  }

  async createLabVendor(
    scope: RepositoryScope,
    input: CreateLabVendorInput
  ): Promise<LabVendorRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<LabVendorRow>(
        `
          insert into lab_vendors (
            tenant_id,
            clinic_id,
            display_name,
            phone,
            email,
            address,
            tax_registration_number,
            payment_terms_days,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.displayName,
          input.phone ?? null,
          input.email ?? null,
          JSON.stringify(input.address ?? {}),
          input.taxRegistrationNumber ?? null,
          input.paymentTermsDays ?? null,
          scope.actorUserId
        ]
      );
      return mapLabVendorRow(result.rows[0]);
    });
  }

  async listLabCases(
    scope: RepositoryScope,
    filter: LabCaseSearchFilter = {}
  ): Promise<LabCaseDetail[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<LabCaseRow>(
        `
          select *
          from lab_cases
          where tenant_id = $1
            and clinic_id = $2
            and ($3::text is null or status = $3)
            and ($4::timestamptz is null or due_at <= $4)
            and ($5::uuid is null or vendor_id = $5)
            and ($6::uuid is null or patient_id = $6)
          order by due_at asc
        `,
        [
          scope.tenantId,
          scope.clinicId,
          filter.status ?? null,
          filter.dueBefore ?? null,
          filter.vendorId ?? null,
          filter.patientId ?? null
        ]
      );
      const details: LabCaseDetail[] = [];
      for (const row of result.rows) {
        const detail = await this.#findLabCaseDetailInTransaction(client, scope, row.id);
        if (detail) details.push(detail);
      }
      return details;
    });
  }

  async findLabCaseById(scope: RepositoryScope, labCaseId: UUID): Promise<LabCaseDetail | null> {
    return this.#withRls(scope, async (client) =>
      this.#findLabCaseDetailInTransaction(client, scope, labCaseId)
    );
  }

  async createLabCase(
    scope: RepositoryScope,
    input: CreateLabCaseInput
  ): Promise<LabCaseDetail | null> {
    return this.#withRls(scope, async (client) => {
      const vendor = await this.#findLabVendorByIdInTransaction(client, scope, input.vendorId);
      const patient = await this.#findPatientByIdInTransaction(client, scope, input.patientId);
      if (!vendor || !patient) return null;
      if (
        input.encounterId &&
        !(await this.#findEncounterByIdInTransaction(client, scope, input.encounterId))
      ) {
        return null;
      }

      const slipNumber = await this.#nextLabSlipNumber(client, scope);
      const result = await client.query<LabCaseRow>(
        `
          insert into lab_cases (
            tenant_id,
            clinic_id,
            vendor_id,
            patient_id,
            encounter_id,
            treatment_plan_id,
            treatment_plan_estimate_item_id,
            procedure_performed_id,
            title,
            priority,
            due_at,
            clinical_notes,
            internal_notes,
            slip_number,
            slip_generated_by_user_id,
            slip_metadata,
            expected_cost_minor,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.vendorId,
          input.patientId,
          input.encounterId ?? null,
          input.treatmentPlanId ?? null,
          input.treatmentPlanEstimateItemId ?? null,
          input.procedurePerformedId ?? null,
          input.title,
          input.priority ?? "routine",
          input.dueAt,
          input.clinicalNotes ?? null,
          input.internalNotes ?? null,
          slipNumber,
          scope.actorUserId,
          JSON.stringify(input.slipMetadata ?? {}),
          input.expectedCostMinor ?? null,
          scope.actorUserId
        ]
      );
      const labCase = mapLabCaseRow(result.rows[0]);

      for (const item of input.items) {
        await client.query(
          `
            insert into lab_case_items (
              tenant_id,
              clinic_id,
              lab_case_id,
              item_type,
              tooth_number,
              material,
              shade,
              quantity,
              notes
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            scope.tenantId,
            scope.clinicId,
            labCase.id,
            item.itemType,
            item.toothNumber ? normalizeDentalToothNumber(item.toothNumber) : null,
            item.material ?? null,
            item.shade ?? null,
            item.quantity ?? 1,
            item.notes ?? null
          ]
        );
      }

      await this.#appendLabCaseStatusHistory(
        client,
        scope,
        labCase,
        null,
        "draft",
        "Lab case created",
        {
          slipNumber
        }
      );
      await this.#appendTimeline(client, scope, {
        patientId: labCase.patientId,
        itemType: "lab_case_created",
        sourceTable: "lab_cases",
        sourceId: labCase.id,
        title: "Lab case created",
        summary: labCase.title,
        metadata: { vendorId: labCase.vendorId, slipNumber }
      });

      return this.#findLabCaseDetailInTransaction(client, scope, labCase.id);
    });
  }

  async updateLabCaseStatus(
    scope: RepositoryScope,
    labCaseId: UUID,
    input: UpdateLabCaseStatusInput
  ): Promise<LabCaseDetail | null> {
    return this.#withRls(scope, async (client) => {
      const existingRow = await this.#findLabCaseRowForUpdate(client, scope, labCaseId);
      if (!existingRow) return null;
      const current = mapLabCaseRow(existingRow);
      assertLabCaseTransition(current.status, input.status);

      const result = await client.query<LabCaseRow>(
        `
          update lab_cases
          set
            status = $4,
            sent_at = case when $4 = 'sent_to_lab' then coalesce(sent_at, now()) else sent_at end,
            received_at = case when $4 in ('received_by_lab', 'returned') then coalesce(received_at, now()) else received_at end,
            completed_at = case when $4 = 'completed' then coalesce(completed_at, now()) else completed_at end,
            cancelled_at = case when $4 = 'cancelled' then coalesce(cancelled_at, now()) else cancelled_at end,
            cancellation_reason = case when $4 = 'cancelled' then coalesce($5, 'cancelled') else cancellation_reason end,
            updated_by_user_id = $6
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          labCaseId,
          input.status,
          input.reason ?? null,
          scope.actorUserId
        ]
      );
      const labCase = mapLabCaseRow(result.rows[0]);
      await this.#appendLabCaseStatusHistory(
        client,
        scope,
        labCase,
        current.status,
        input.status,
        input.reason ?? null,
        input.evidence ?? {}
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
        await this.#appendTimeline(client, scope, {
          patientId: labCase.patientId,
          itemType: timelineType,
          sourceTable: "lab_cases",
          sourceId: labCase.id,
          title: `Lab case ${input.status.replace(/_/g, " ")}`,
          summary: input.reason ?? labCase.title,
          metadata: { fromStatus: current.status, toStatus: input.status }
        });
      }

      return this.#findLabCaseDetailInTransaction(client, scope, labCase.id);
    });
  }

  async createLabReconciliation(
    scope: RepositoryScope,
    input: CreateLabReconciliationInput
  ): Promise<LabReconciliationDetail | null> {
    return this.#withRls(scope, async (client) => {
      if (!(await this.#findLabVendorByIdInTransaction(client, scope, input.vendorId))) return null;

      const preparedEntries: Array<{
        labCase: LabCaseRecord;
        status: LabReconciliationEntryRecord["status"];
        expectedAmountMinor: number;
        invoiceAmountMinor: number | null;
        varianceAmountMinor: number;
        notes: string | null;
      }> = [];
      for (const entry of input.entries) {
        const detail = await this.#findLabCaseDetailInTransaction(client, scope, entry.labCaseId);
        if (!detail || detail.labCase.vendorId !== input.vendorId) return null;
        const expectedAmountMinor = detail.labCase.expectedCostMinor ?? 0;
        const invoiceAmountMinor = entry.invoiceAmountMinor ?? null;
        const varianceAmountMinor =
          (invoiceAmountMinor ?? expectedAmountMinor) - expectedAmountMinor;
        preparedEntries.push({
          labCase: detail.labCase,
          status:
            entry.status ??
            (invoiceAmountMinor === null
              ? "missing_invoice"
              : varianceAmountMinor === 0
                ? "matched"
                : "amount_variance"),
          expectedAmountMinor,
          invoiceAmountMinor,
          varianceAmountMinor,
          notes: entry.notes ?? null
        });
      }

      const expectedAmountMinor = preparedEntries.reduce(
        (sum, entry) => sum + entry.expectedAmountMinor,
        0
      );
      const invoiceAmountMinor = input.invoiceAmountMinor ?? null;
      const varianceAmountMinor = (invoiceAmountMinor ?? expectedAmountMinor) - expectedAmountMinor;
      const reconciliationResult = await client.query<LabReconciliationRow>(
        `
          insert into lab_reconciliations (
            tenant_id,
            clinic_id,
            vendor_id,
            period_start,
            period_end,
            status,
            invoice_reference,
            invoice_amount_minor,
            expected_amount_minor,
            variance_amount_minor,
            evidence,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.vendorId,
          input.periodStart,
          input.periodEnd,
          input.status ?? (varianceAmountMinor === 0 ? "matched" : "variance_review"),
          input.invoiceReference ?? null,
          invoiceAmountMinor,
          expectedAmountMinor,
          varianceAmountMinor,
          JSON.stringify(input.evidence ?? {}),
          scope.actorUserId
        ]
      );
      const reconciliation = mapLabReconciliationRow(reconciliationResult.rows[0]);
      const entries: LabReconciliationEntryRecord[] = [];
      for (const entry of preparedEntries) {
        const entryResult = await client.query<LabReconciliationEntryRow>(
          `
            insert into lab_reconciliation_entries (
              tenant_id,
              clinic_id,
              reconciliation_id,
              lab_case_id,
              patient_id,
              status,
              expected_amount_minor,
              invoice_amount_minor,
              variance_amount_minor,
              notes
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            returning *
          `,
          [
            scope.tenantId,
            scope.clinicId,
            reconciliation.id,
            entry.labCase.id,
            entry.labCase.patientId,
            entry.status,
            entry.expectedAmountMinor,
            entry.invoiceAmountMinor,
            entry.varianceAmountMinor,
            entry.notes
          ]
        );
        entries.push(mapLabReconciliationEntryRow(entryResult.rows[0]));
      }
      return { reconciliation, entries };
    });
  }

  async listInventoryCategories(scope: RepositoryScope): Promise<InventoryCategoryRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<InventoryCategoryRow>(
        `
          select *
          from inventory_categories
          where tenant_id = $1 and clinic_id = $2
          order by display_name
        `,
        [scope.tenantId, scope.clinicId]
      );
      return result.rows.map(mapInventoryCategoryRow);
    });
  }

  async createInventoryCategory(
    scope: RepositoryScope,
    input: CreateInventoryCategoryInput
  ): Promise<InventoryCategoryRecord> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<InventoryCategoryRow>(
        `
          insert into inventory_categories (
            tenant_id,
            clinic_id,
            code,
            display_name,
            kind,
            active,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.code,
          input.displayName,
          input.kind,
          input.active ?? true,
          scope.actorUserId
        ]
      );
      return mapInventoryCategoryRow(result.rows[0]);
    });
  }

  async listInventoryItems(scope: RepositoryScope): Promise<InventoryItemRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<InventoryItemRow>(
        `
          select *
          from inventory_items
          where tenant_id = $1 and clinic_id = $2
          order by display_name
        `,
        [scope.tenantId, scope.clinicId]
      );
      return result.rows.map(mapInventoryItemRow);
    });
  }

  async findInventoryItemById(
    scope: RepositoryScope,
    itemId: UUID
  ): Promise<InventoryItemRecord | null> {
    return this.#withRls(scope, async (client) =>
      this.#findInventoryItemByIdInTransaction(client, scope, itemId)
    );
  }

  async createInventoryItem(
    scope: RepositoryScope,
    input: CreateInventoryItemInput
  ): Promise<InventoryItemRecord | null> {
    return this.#withRls(scope, async (client) => {
      const category = await client.query(
        `
          select id
          from inventory_categories
          where tenant_id = $1 and clinic_id = $2 and id = $3 and active = true
        `,
        [scope.tenantId, scope.clinicId, input.categoryId]
      );
      if (!category.rows[0]) return null;

      const openingQuantity = input.openingQuantity ?? 0;
      assertFiniteQuantity(openingQuantity, "openingQuantity");
      const result = await client.query<InventoryItemRow>(
        `
          insert into inventory_items (
            tenant_id,
            clinic_id,
            category_id,
            sku,
            display_name,
            unit_of_measure,
            storage_location,
            track_quantity,
            minimum_quantity,
            reorder_quantity,
            current_quantity,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.categoryId,
          input.sku,
          input.displayName,
          input.unitOfMeasure,
          input.storageLocation,
          input.trackQuantity ?? true,
          input.minimumQuantity ?? 0,
          input.reorderQuantity ?? 0,
          openingQuantity,
          scope.actorUserId
        ]
      );
      const item = mapInventoryItemRow(result.rows[0]);
      if (openingQuantity > 0) {
        await this.#insertStockLedgerEntryInTransaction(client, scope, item, {
          movementType: "opening_balance",
          quantityDelta: openingQuantity,
          sourceTable: "inventory_items",
          sourceId: item.id,
          reason: "Opening quantity recorded",
          evidence: { source: "manual_opening_balance" }
        });
      }
      return item;
    });
  }

  async createStockLedgerEntry(
    scope: RepositoryScope,
    input: CreateStockLedgerEntryInput
  ): Promise<StockLedgerEntryRecord | null> {
    return this.#withRls(scope, async (client) => {
      const item = await this.#findInventoryItemByIdInTransaction(
        client,
        scope,
        input.itemId,
        true
      );
      if (!item) return null;
      return this.#insertStockLedgerEntryInTransaction(client, scope, item, input);
    });
  }

  async listInventoryCheckTemplates(
    scope: RepositoryScope
  ): Promise<Array<InventoryCheckTemplateRecord & { lines: InventoryCheckTemplateLineRecord[] }>> {
    return this.#withRls(scope, async (client) => {
      const templates = (
        await client.query<InventoryCheckTemplateRow>(
          `
            select *
            from inventory_check_templates
            where tenant_id = $1 and clinic_id = $2 and active = true
            order by display_name
          `,
          [scope.tenantId, scope.clinicId]
        )
      ).rows.map(mapInventoryCheckTemplateRow);
      const result: Array<
        InventoryCheckTemplateRecord & { lines: InventoryCheckTemplateLineRecord[] }
      > = [];
      for (const template of templates) {
        result.push({
          ...template,
          lines: await this.#listInventoryCheckTemplateLines(client, scope, template.id)
        });
      }
      return result;
    });
  }

  async createInventoryCheckTemplate(
    scope: RepositoryScope,
    input: CreateInventoryCheckTemplateInput
  ): Promise<
    (InventoryCheckTemplateRecord & { lines: InventoryCheckTemplateLineRecord[] }) | null
  > {
    return this.#withRls(scope, async (client) => {
      for (const line of input.lines) {
        if (!(await this.#findInventoryItemByIdInTransaction(client, scope, line.itemId)))
          return null;
      }
      const templateResult = await client.query<InventoryCheckTemplateRow>(
        `
          insert into inventory_check_templates (
            tenant_id,
            clinic_id,
            code,
            display_name,
            cadence,
            active,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.code,
          input.displayName,
          input.cadence,
          input.active ?? true,
          scope.actorUserId
        ]
      );
      const template = mapInventoryCheckTemplateRow(templateResult.rows[0]);
      for (const line of input.lines) {
        await client.query(
          `
            insert into inventory_check_template_lines (
              tenant_id,
              clinic_id,
              template_id,
              item_id,
              sequence,
              drawer_location,
              expected_quantity,
              required,
              instructions
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            scope.tenantId,
            scope.clinicId,
            template.id,
            line.itemId,
            line.sequence,
            line.drawerLocation,
            line.expectedQuantity ?? null,
            line.required ?? true,
            line.instructions ?? null
          ]
        );
      }
      return {
        ...template,
        lines: await this.#listInventoryCheckTemplateLines(client, scope, template.id)
      };
    });
  }

  async createInventoryCheckRun(
    scope: RepositoryScope,
    input: CreateInventoryCheckRunInput
  ): Promise<InventoryCheckRunDetail | null> {
    return this.#withRls(scope, async (client) => {
      const templateResult = await client.query<InventoryCheckTemplateRow>(
        `
          select *
          from inventory_check_templates
          where tenant_id = $1 and clinic_id = $2 and id = $3 and active = true
        `,
        [scope.tenantId, scope.clinicId, input.templateId]
      );
      if (!templateResult.rows[0]) return null;
      const template = mapInventoryCheckTemplateRow(templateResult.rows[0]);
      const lines = await this.#listInventoryCheckTemplateLines(client, scope, template.id);
      const runResult = await client.query<InventoryCheckRunRow>(
        `
          insert into inventory_check_runs (
            tenant_id,
            clinic_id,
            template_id,
            status,
            started_by_user_id,
            notes
          )
          values ($1, $2, $3, 'in_progress', $4, $5)
          returning *
        `,
        [scope.tenantId, scope.clinicId, template.id, scope.actorUserId, input.notes ?? null]
      );
      const run = mapInventoryCheckRunRow(runResult.rows[0]);
      for (const line of lines) {
        const item = await this.#findInventoryItemByIdInTransaction(client, scope, line.itemId);
        if (!item) return null;
        await client.query(
          `
            insert into inventory_check_run_lines (
              tenant_id,
              clinic_id,
              check_run_id,
              template_line_id,
              item_id,
              sequence,
              drawer_location,
              expected_quantity
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8)
          `,
          [
            scope.tenantId,
            scope.clinicId,
            run.id,
            line.id,
            line.itemId,
            line.sequence,
            line.drawerLocation,
            line.expectedQuantity ?? item.currentQuantity
          ]
        );
      }
      return this.#findInventoryCheckRunDetailInTransaction(client, scope, run.id);
    });
  }

  async updateInventoryCheckRun(
    scope: RepositoryScope,
    checkRunId: UUID,
    input: UpdateInventoryCheckRunInput
  ): Promise<InventoryCheckRunDetail | null> {
    return this.#withRls(scope, async (client) => {
      const runResult = await client.query<InventoryCheckRunRow>(
        `
          select *
          from inventory_check_runs
          where tenant_id = $1 and clinic_id = $2 and id = $3
          for update
        `,
        [scope.tenantId, scope.clinicId, checkRunId]
      );
      if (!runResult.rows[0]) return null;
      const run = mapInventoryCheckRunRow(runResult.rows[0]);
      if (run.status === "completed" || run.status === "cancelled") return null;

      for (const lineInput of input.lines ?? []) {
        const lineResult = await client.query<InventoryCheckRunLineRow>(
          `
            select *
            from inventory_check_run_lines
            where tenant_id = $1 and clinic_id = $2 and check_run_id = $3 and id = $4
            for update
          `,
          [scope.tenantId, scope.clinicId, checkRunId, lineInput.lineId]
        );
        if (!lineResult.rows[0]) return null;
        const line = mapInventoryCheckRunLineRow(lineResult.rows[0]);
        const item = await this.#findInventoryItemByIdInTransaction(
          client,
          scope,
          line.itemId,
          true
        );
        if (!item) return null;
        const varianceQuantity = calculateInventoryVariance({
          expectedQuantity: line.expectedQuantity,
          countedQuantity: lineInput.countedQuantity
        });
        const exceptionType = classifyInventoryException({
          expectedQuantity: line.expectedQuantity,
          countedQuantity: lineInput.countedQuantity,
          minimumQuantity: item.minimumQuantity
        });
        await client.query(
          `
            update inventory_check_run_lines
            set
              counted_quantity = $5,
              variance_quantity = $6,
              exception_type = $7,
              exception_notes = $8,
              counted_by_user_id = $9,
              counted_at = now()
            where tenant_id = $1 and clinic_id = $2 and check_run_id = $3 and id = $4
          `,
          [
            scope.tenantId,
            scope.clinicId,
            checkRunId,
            line.id,
            lineInput.countedQuantity,
            varianceQuantity,
            exceptionType,
            lineInput.exceptionNotes ?? null,
            scope.actorUserId
          ]
        );
        if (varianceQuantity !== 0) {
          await this.#insertStockLedgerEntryInTransaction(client, scope, item, {
            movementType: "check_variance",
            quantityDelta: varianceQuantity,
            sourceTable: "inventory_check_run_lines",
            sourceId: line.id,
            reason: "Inventory check count variance",
            evidence: {
              checkRunId,
              expectedQuantity: line.expectedQuantity,
              countedQuantity: lineInput.countedQuantity
            }
          });
        }
        if (exceptionType === "low_stock" || exceptionType === "missing_item") {
          await this.#ensureProcurementSuggestion(
            client,
            scope,
            item,
            line.id,
            checkRunId,
            exceptionType
          );
        }
      }

      if (input.status === "completed") {
        const uncounted = await client.query(
          `
            select id
            from inventory_check_run_lines
            where tenant_id = $1 and clinic_id = $2 and check_run_id = $3 and counted_quantity is null
            limit 1
          `,
          [scope.tenantId, scope.clinicId, checkRunId]
        );
        if (uncounted.rows[0]) return null;
      }

      await client.query(
        `
          update inventory_check_runs
          set
            status = $4,
            notes = coalesce($5, notes),
            completed_by_user_id = case when $4 = 'completed' then $6 else completed_by_user_id end,
            completed_at = case when $4 = 'completed' then coalesce(completed_at, now()) else completed_at end
          where tenant_id = $1 and clinic_id = $2 and id = $3
        `,
        [
          scope.tenantId,
          scope.clinicId,
          checkRunId,
          input.status,
          input.notes ?? null,
          scope.actorUserId
        ]
      );
      return this.#findInventoryCheckRunDetailInTransaction(client, scope, checkRunId);
    });
  }

  async listInventoryExceptions(
    scope: RepositoryScope,
    filter: InventoryExceptionFilter = {}
  ): Promise<InventoryExceptionRecord[]> {
    return this.#withRls(scope, async (client) => {
      const lineRows = await client.query<InventoryCheckRunLineRow>(
        `
          select *
          from inventory_check_run_lines
          where tenant_id = $1
            and clinic_id = $2
            and exception_type is not null
            and ($3::uuid is null or item_id = $3)
            and ($4::uuid is null or check_run_id = $4)
          order by counted_at desc nulls last
        `,
        [scope.tenantId, scope.clinicId, filter.itemId ?? null, filter.checkRunId ?? null]
      );
      const exceptions: InventoryExceptionRecord[] = [];
      for (const row of lineRows.rows) {
        const line = mapInventoryCheckRunLineRow(row);
        const item = await this.#findInventoryItemByIdInTransaction(client, scope, line.itemId);
        if (!item || !line.exceptionType) continue;
        const suggestion = await this.#findProcurementSuggestionForLine(client, scope, line.id);
        exceptions.push(toInventoryException(item, line, suggestion));
      }

      const lowStockItems = await client.query<InventoryItemRow>(
        `
          select *
          from inventory_items
          where tenant_id = $1
            and clinic_id = $2
            and status = 'active'
            and track_quantity = true
            and current_quantity < minimum_quantity
            and ($3::uuid is null or id = $3)
          order by display_name
        `,
        [scope.tenantId, scope.clinicId, filter.itemId ?? null]
      );
      for (const row of lowStockItems.rows) {
        const item = mapInventoryItemRow(row);
        if (exceptions.some((exception) => exception.item.id === item.id)) continue;
        const suggestion = await this.#findOpenProcurementSuggestionForItem(client, scope, item.id);
        exceptions.push(toInventoryException(item, null, suggestion));
      }
      return exceptions;
    });
  }

  async listIncidents(
    scope: RepositoryScope,
    filter: IncidentSearchFilter = {}
  ): Promise<IncidentRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<IncidentRow>(
        `
          select *
          from incidents
          where tenant_id = $1
            and clinic_id = $2
            and ($3::text is null or status = $3)
            and ($4::text is null or severity = $4)
            and ($5::text is null or category = $5)
          order by occurred_at desc
        `,
        [
          scope.tenantId,
          scope.clinicId,
          filter.status ?? null,
          filter.severity ?? null,
          filter.category ?? null
        ]
      );
      return result.rows.map(mapIncidentRow);
    });
  }

  async createIncident(
    scope: RepositoryScope,
    input: CreateIncidentInput
  ): Promise<IncidentRecord | null> {
    return this.#withRls(scope, async (client) => {
      if (
        input.patientId &&
        !(await this.#findPatientByIdInTransaction(client, scope, input.patientId))
      )
        return null;
      if (
        input.appointmentId &&
        !(await this.#findAppointmentByIdInTransaction(client, scope, input.appointmentId))
      )
        return null;
      if (
        input.labCaseId &&
        !(await this.#findLabCaseDetailInTransaction(client, scope, input.labCaseId))
      )
        return null;
      if (
        input.inventoryItemId &&
        !(await this.#findInventoryItemByIdInTransaction(client, scope, input.inventoryItemId))
      )
        return null;

      const result = await client.query<IncidentRow>(
        `
          insert into incidents (
            tenant_id,
            clinic_id,
            patient_id,
            appointment_id,
            lab_case_id,
            inventory_item_id,
            category,
            severity,
            occurred_at,
            location,
            summary,
            description,
            impact,
            learning,
            immediate_action,
            evidence,
            reported_by_user_id,
            owner_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.patientId ?? null,
          input.appointmentId ?? null,
          input.labCaseId ?? null,
          input.inventoryItemId ?? null,
          input.category,
          input.severity,
          input.occurredAt,
          input.location ?? null,
          input.summary,
          input.description,
          input.impact ?? null,
          input.learning ?? null,
          input.immediateAction ?? null,
          JSON.stringify(input.evidence ?? {}),
          scope.actorUserId,
          input.ownerUserId ?? null
        ]
      );
      const incident = mapIncidentRow(result.rows[0]);
      if (incident.patientId) {
        await this.#appendTimeline(client, scope, {
          patientId: incident.patientId,
          itemType: "incident_created",
          sourceTable: "incidents",
          sourceId: incident.id,
          title: "Incident recorded",
          summary: incident.summary,
          metadata: { category: incident.category, severity: incident.severity }
        });
      }
      return incident;
    });
  }

  async listCorrectiveActions(scope: RepositoryScope): Promise<CorrectiveActionRecord[]> {
    return this.#withRls(scope, async (client) => {
      const result = await client.query<CorrectiveActionRow>(
        `
          select *
          from corrective_actions
          where tenant_id = $1 and clinic_id = $2
          order by due_at asc
        `,
        [scope.tenantId, scope.clinicId]
      );
      return result.rows.map(mapCorrectiveActionRow);
    });
  }

  async createCorrectiveAction(
    scope: RepositoryScope,
    input: CreateCorrectiveActionInput
  ): Promise<CorrectiveActionRecord | null> {
    return this.#withRls(scope, async (client) => {
      const incident = input.incidentId
        ? await this.#findIncidentByIdInTransaction(client, scope, input.incidentId)
        : null;
      if (input.incidentId && !incident) return null;

      const result = await client.query<CorrectiveActionRow>(
        `
          insert into corrective_actions (
            tenant_id,
            clinic_id,
            incident_id,
            action_type,
            title,
            description,
            owner_user_id,
            due_at,
            verification_evidence,
            created_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.incidentId ?? null,
          input.actionType,
          input.title,
          input.description,
          input.ownerUserId,
          input.dueAt,
          JSON.stringify(input.verificationEvidence ?? {}),
          scope.actorUserId
        ]
      );
      const action = mapCorrectiveActionRow(result.rows[0]);
      if (incident) {
        await client.query(
          `
            update incidents
            set status = 'capa_assigned'
            where tenant_id = $1 and clinic_id = $2 and id = $3
          `,
          [scope.tenantId, scope.clinicId, incident.id]
        );
        if (incident.patientId) {
          await this.#appendTimeline(client, scope, {
            patientId: incident.patientId,
            itemType: "corrective_action_created",
            sourceTable: "corrective_actions",
            sourceId: action.id,
            title: "Corrective action assigned",
            summary: action.title,
            metadata: { incidentId: incident.id, dueAt: action.dueAt }
          });
        }
      }
      return action;
    });
  }

  async updateCorrectiveAction(
    scope: RepositoryScope,
    correctiveActionId: UUID,
    input: UpdateCorrectiveActionInput
  ): Promise<CorrectiveActionRecord | null> {
    return this.#withRls(scope, async (client) => {
      const currentResult = await client.query<CorrectiveActionRow>(
        `
          select *
          from corrective_actions
          where tenant_id = $1 and clinic_id = $2 and id = $3
          for update
        `,
        [scope.tenantId, scope.clinicId, correctiveActionId]
      );
      if (!currentResult.rows[0]) return null;
      const current = mapCorrectiveActionRow(currentResult.rows[0]);
      if (current.status === "completed" || current.status === "cancelled") return null;

      const result = await client.query<CorrectiveActionRow>(
        `
          update corrective_actions
          set
            status = $4,
            completed_at = case when $4 = 'completed' then now() else completed_at end,
            completed_by_user_id = case when $4 = 'completed' then $5 else completed_by_user_id end,
            completion_evidence = case when $4 = 'completed' then $6::jsonb else completion_evidence end,
            verification_evidence = coalesce($7::jsonb, verification_evidence),
            updated_by_user_id = $5
          where tenant_id = $1 and clinic_id = $2 and id = $3
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          correctiveActionId,
          input.status,
          scope.actorUserId,
          JSON.stringify(input.completionEvidence ?? {}),
          input.verificationEvidence === undefined
            ? null
            : JSON.stringify(input.verificationEvidence)
        ]
      );
      const action = mapCorrectiveActionRow(result.rows[0]);
      if (action.status === "completed" && action.incidentId) {
        const incident = await this.#findIncidentByIdInTransaction(
          client,
          scope,
          action.incidentId
        );
        const openSibling = await client.query(
          `
            select id
            from corrective_actions
            where tenant_id = $1
              and clinic_id = $2
              and incident_id = $3
              and id <> $4
              and status in ('open', 'in_progress')
            limit 1
          `,
          [scope.tenantId, scope.clinicId, action.incidentId, action.id]
        );
        if (!openSibling.rows[0]) {
          await client.query(
            `
              update incidents
              set status = 'resolved', resolved_at = coalesce(resolved_at, now())
              where tenant_id = $1 and clinic_id = $2 and id = $3
            `,
            [scope.tenantId, scope.clinicId, action.incidentId]
          );
        }
        if (incident?.patientId) {
          await this.#appendTimeline(client, scope, {
            patientId: incident.patientId,
            itemType: "corrective_action_completed",
            sourceTable: "corrective_actions",
            sourceId: action.id,
            title: "Corrective action completed",
            summary: action.title,
            metadata: { incidentId: action.incidentId, completedAt: action.completedAt }
          });
        }
      }
      return action;
    });
  }

  async #findMigrationBatchRowInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    batchId: UUID
  ): Promise<MigrationBatchRecord | null> {
    const result = await client.query<MigrationBatchRow>(
      `
        select *
        from migration_batches
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, batchId]
    );
    return result.rows[0] ? mapMigrationBatchRow(result.rows[0]) : null;
  }

  async #findMigrationBatchDetailInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    batchId: UUID
  ): Promise<MigrationBatchDetail | null> {
    const batch = await this.#findMigrationBatchRowInTransaction(client, scope, batchId);
    if (!batch) return null;
    const rows = await this.#listMigrationRowsInTransaction(client, scope, batchId);
    const conflicts = (
      await client.query<MigrationConflictRow>(
        `
          select *
          from migration_conflicts
          where tenant_id = $1 and clinic_id = $2 and batch_id = $3
          order by created_at
        `,
        [scope.tenantId, scope.clinicId, batchId]
      )
    ).rows.map(mapMigrationConflictRow);
    return { batch, rows, conflicts };
  }

  async #listMigrationRowsInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    batchId: UUID
  ): Promise<MigrationRowRecord[]> {
    const rows = (
      await client.query<MigrationRowRow>(
        `
          select *
          from migration_rows
          where tenant_id = $1 and clinic_id = $2 and batch_id = $3
          order by row_number
        `,
        [scope.tenantId, scope.clinicId, batchId]
      )
    ).rows.map((row) => mapMigrationRowRow(row, []));
    return this.#attachMigrationRowConflicts(client, scope, rows);
  }

  async #attachMigrationRowConflicts(
    client: SqlQueryClient,
    scope: RepositoryScope,
    rows: MigrationRowRecord[]
  ): Promise<MigrationRowRecord[]> {
    if (rows.length === 0) return [];
    const conflicts = (
      await client.query<MigrationConflictRow>(
        `
          select *
          from migration_conflicts
          where tenant_id = $1 and clinic_id = $2 and row_id = any($3::uuid[])
          order by created_at
        `,
        [scope.tenantId, scope.clinicId, rows.map((row) => row.id)]
      )
    ).rows.map(mapMigrationConflictRow);
    return rows.map((row) => ({
      ...row,
      conflicts: conflicts.filter((conflict) => conflict.rowId === row.id)
    }));
  }

  async #refreshMigrationBatchCountsInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    batchId: UUID
  ): Promise<{
    invalidRowCount: number;
    conflictRowCount: number;
    readyRowCount: number;
    committedRowCount: number;
    rolledBackRowCount: number;
    failedRowCount: number;
  }> {
    const counts = await client.query<{
      row_count: string | number;
      valid_row_count: string | number;
      invalid_row_count: string | number;
      conflict_row_count: string | number;
      ready_row_count: string | number;
      committed_row_count: string | number;
      rolled_back_row_count: string | number;
      failed_row_count: string | number;
    }>(
      `
        select
          count(*) as row_count,
          count(*) filter (where status <> 'invalid') as valid_row_count,
          count(*) filter (where status = 'invalid') as invalid_row_count,
          count(distinct migration_rows.id) filter (where migration_conflicts.status = 'open') as conflict_row_count,
          count(*) filter (where migration_rows.status = 'ready_to_commit') as ready_row_count,
          count(*) filter (where migration_rows.status = 'committed') as committed_row_count,
          count(*) filter (where migration_rows.status = 'rolled_back') as rolled_back_row_count,
          count(*) filter (where migration_rows.status = 'failed') as failed_row_count
        from migration_rows
        left join migration_conflicts on migration_conflicts.tenant_id = migration_rows.tenant_id
          and migration_conflicts.row_id = migration_rows.id
        where migration_rows.tenant_id = $1 and migration_rows.clinic_id = $2 and migration_rows.batch_id = $3
      `,
      [scope.tenantId, scope.clinicId, batchId]
    );
    const row = counts.rows[0];
    const nextState =
      Number(row.conflict_row_count) > 0
        ? "needs_review"
        : Number(row.ready_row_count) > 0
          ? "ready_to_commit"
          : Number(row.row_count) > 0
            ? "validated"
            : "uploaded";
    await client.query(
      `
        update migration_batches
        set
          row_count = $4,
          valid_row_count = $5,
          invalid_row_count = $6,
          conflict_row_count = $7,
          ready_row_count = $8,
          committed_row_count = $9,
          rolled_back_row_count = $10,
          failed_row_count = $11,
          state = case
            when state in ('committed', 'partially_committed', 'rolled_back', 'failed') then state
            else $12
          end
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [
        scope.tenantId,
        scope.clinicId,
        batchId,
        Number(row.row_count),
        Number(row.valid_row_count),
        Number(row.invalid_row_count),
        Number(row.conflict_row_count),
        Number(row.ready_row_count),
        Number(row.committed_row_count),
        Number(row.rolled_back_row_count),
        Number(row.failed_row_count),
        nextState
      ]
    );
    return {
      invalidRowCount: Number(row.invalid_row_count),
      conflictRowCount: Number(row.conflict_row_count),
      readyRowCount: Number(row.ready_row_count),
      committedRowCount: Number(row.committed_row_count),
      rolledBackRowCount: Number(row.rolled_back_row_count),
      failedRowCount: Number(row.failed_row_count)
    };
  }

  async #findMigrationCommitInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    batchId: UUID,
    action: MigrationCommitRecord["action"],
    idempotencyKey: string | null
  ): Promise<MigrationCommitRecord | null> {
    if (!idempotencyKey) return null;
    const result = await client.query<MigrationCommitRow>(
      `
        select *
        from migration_commits
        where tenant_id = $1 and clinic_id = $2 and batch_id = $3 and action = $4 and idempotency_key = $5
      `,
      [scope.tenantId, scope.clinicId, batchId, action, idempotencyKey]
    );
    return result.rows[0] ? mapMigrationCommitRow(result.rows[0]) : null;
  }

  async #latestMigrationCommitInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    batchId: UUID,
    action: MigrationCommitRecord["action"]
  ): Promise<MigrationCommitRecord | null> {
    const result = await client.query<MigrationCommitRow>(
      `
        select *
        from migration_commits
        where tenant_id = $1 and clinic_id = $2 and batch_id = $3 and action = $4
        order by started_at desc
        limit 1
      `,
      [scope.tenantId, scope.clinicId, batchId, action]
    );
    return result.rows[0] ? mapMigrationCommitRow(result.rows[0]) : null;
  }

  async #insertMigrationCommitInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    batchId: UUID,
    action: MigrationCommitRecord["action"],
    status: MigrationCommitRecord["status"],
    idempotencyKey: string | null,
    summary: Record<string, unknown>,
    errorSummary: Record<string, unknown> | null
  ): Promise<MigrationCommitRecord> {
    const result = await client.query<MigrationCommitRow>(
      `
        insert into migration_commits (
          tenant_id,
          clinic_id,
          batch_id,
          action,
          status,
          idempotency_key,
          requested_by_user_id,
          summary,
          error_summary,
          finished_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, now())
        on conflict (tenant_id, clinic_id, batch_id, action, idempotency_key)
          where idempotency_key is not null
        do update set summary = migration_commits.summary
        returning *
      `,
      [
        scope.tenantId,
        scope.clinicId,
        batchId,
        action,
        status,
        idempotencyKey,
        scope.actorUserId,
        JSON.stringify(summary),
        errorSummary ? JSON.stringify(errorSummary) : null
      ]
    );
    return mapMigrationCommitRow(result.rows[0]);
  }

  async #insertImportedPatientInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    row: MigrationRowRecord,
    sourceSystem: string
  ): Promise<PatientRecord> {
    if (!row.normalizedRecord || row.normalizedRecord.recordType !== "patient") {
      throw new Error("Migration row does not contain a normalized patient record.");
    }
    const result = await client.query<PatientRow>(
      `
        insert into patients (
          tenant_id,
          clinic_id,
          full_name,
          phone,
          email,
          date_of_birth,
          gender,
          source,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, 'imported', $8, $8)
        returning *
      `,
      [
        scope.tenantId,
        scope.clinicId,
        row.normalizedRecord.fullName,
        row.normalizedRecord.phone,
        row.normalizedRecord.email,
        row.normalizedRecord.dateOfBirth,
        row.normalizedRecord.gender,
        scope.actorUserId
      ]
    );
    const patient = mapPatientRow(result.rows[0]);
    await client.query(
      `
        insert into patient_contacts (
          tenant_id,
          clinic_id,
          patient_id,
          contact_type,
          value,
          normalized_value,
          is_primary,
          source,
          created_by_user_id
        )
        values ($1, $2, $3, 'phone', $4, $5, true, 'imported', $6)
      `,
      [
        scope.tenantId,
        scope.clinicId,
        patient.id,
        row.normalizedRecord.phone,
        normalizePhone(row.normalizedRecord.phone),
        scope.actorUserId
      ]
    );
    await this.#appendTimeline(client, scope, {
      patientId: patient.id,
      itemType: "patient_created",
      sourceTable: "migration_rows",
      sourceId: row.id,
      title: "Patient imported",
      summary: `Imported from ${sourceSystem}`,
      metadata: {
        migrationBatchId: row.batchId,
        migrationRowId: row.id,
        externalRecordId: row.externalRecordId,
        verificationStatus: "imported_unverified"
      }
    });
    return patient;
  }

  async #createImportedRecordLinkInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    batch: MigrationBatchRecord,
    row: MigrationRowRecord,
    targetRecordId: UUID,
    linkType: ImportedRecordLinkRecord["linkType"]
  ): Promise<ImportedRecordLinkRecord> {
    const result = await client.query<ImportedRecordLinkRow>(
      `
        insert into imported_record_links (
          tenant_id,
          clinic_id,
          batch_id,
          row_id,
          import_type,
          source_system,
          external_record_id,
          target_record_type,
          target_record_id,
          link_type,
          metadata,
          created_by_user_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, 'patient', $8, $9, $10::jsonb, $11)
        on conflict do nothing
        returning *
      `,
      [
        scope.tenantId,
        scope.clinicId,
        batch.id,
        row.id,
        batch.importType,
        batch.sourceSystem,
        row.externalRecordId,
        targetRecordId,
        linkType,
        JSON.stringify({
          rowNumber: row.rowNumber,
          resolutionAction: row.resolutionAction ?? "create_new"
        }),
        scope.actorUserId
      ]
    );
    if (result.rows[0]) return mapImportedRecordLinkRow(result.rows[0]);
    const existing = await client.query<ImportedRecordLinkRow>(
      `
        select *
        from imported_record_links
        where tenant_id = $1 and clinic_id = $2 and batch_id = $3 and row_id = $4
        limit 1
      `,
      [scope.tenantId, scope.clinicId, batch.id, row.id]
    );
    return mapImportedRecordLinkRow(existing.rows[0]);
  }

  async #markMigrationRowCommitted(
    client: SqlQueryClient,
    scope: RepositoryScope,
    rowId: UUID,
    recordType: string,
    recordId: UUID
  ): Promise<void> {
    await client.query(
      `
        update migration_rows
        set status = 'committed', committed_record_type = $4, committed_record_id = $5, error_message = null
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, rowId, recordType, recordId]
    );
  }

  async #markMigrationRowFailed(
    client: SqlQueryClient,
    scope: RepositoryScope,
    rowId: UUID,
    errorMessage: string
  ): Promise<void> {
    await client.query(
      `
        update migration_rows
        set status = 'failed', error_message = $4
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, rowId, errorMessage]
    );
  }

  async #listImportedRecordLinksInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    batchId: UUID
  ): Promise<ImportedRecordLinkRecord[]> {
    return (
      await client.query<ImportedRecordLinkRow>(
        `
          select *
          from imported_record_links
          where tenant_id = $1 and clinic_id = $2 and batch_id = $3
          order by created_at
        `,
        [scope.tenantId, scope.clinicId, batchId]
      )
    ).rows.map(mapImportedRecordLinkRow);
  }

  async #patientHasRollbackBlockingDependenciesInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<boolean> {
    const result = await client.query<{ dependency_count: string | number }>(
      `
        select (
          (select count(*) from appointments where tenant_id = $1 and clinic_id = $2 and patient_id = $3)
          + (select count(*) from encounters where tenant_id = $1 and clinic_id = $2 and patient_id = $3)
          + (select count(*) from form_responses where tenant_id = $1 and clinic_id = $2 and patient_id = $3)
          + (select count(*) from consents where tenant_id = $1 and clinic_id = $2 and patient_id = $3)
          + (select count(*) from dental_findings where tenant_id = $1 and clinic_id = $2 and patient_id = $3)
          + (select count(*) from media_assets where tenant_id = $1 and clinic_id = $2 and patient_id = $3)
          + (select count(*) from treatment_plans where tenant_id = $1 and clinic_id = $2 and patient_id = $3)
          + (select count(*) from procedure_performed_records where tenant_id = $1 and clinic_id = $2 and patient_id = $3)
          + (select count(*) from invoices where tenant_id = $1 and clinic_id = $2 and patient_id = $3)
          + (select count(*) from lab_cases where tenant_id = $1 and clinic_id = $2 and patient_id = $3)
          + (select count(*) from incidents where tenant_id = $1 and clinic_id = $2 and patient_id = $3)
        ) as dependency_count
      `,
      [scope.tenantId, scope.clinicId, patientId]
    );
    return Number(result.rows[0]?.dependency_count ?? 0) > 0;
  }

  async #withRls<T>(
    scope: RepositoryScope,
    callback: (client: SqlQueryClient) => Promise<T>
  ): Promise<T> {
    return withTransaction(this.#client, async (client) => {
      for (const statement of buildSetLocalRlsStatements({
        tenantId: scope.tenantId,
        clinicId: scope.clinicId,
        userId: scope.actorUserId
      })) {
        await client.query(statement.sql, statement.values);
      }

      return callback(client);
    });
  }

  async #insertTaskInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    input: CreateTaskInput
  ): Promise<TaskRecord> {
    const result = await client.query<TaskRow>(
      `
        insert into tasks (
          tenant_id,
          clinic_id,
          patient_id,
          lead_id,
          appointment_id,
          invoice_id,
          encounter_id,
          treatment_plan_id,
          procedure_performed_id,
          task_type,
          source_workflow,
          source_record_type,
          source_record_id,
          title,
          description,
          priority,
          status,
          due_at,
          assigned_to_user_id,
          assigned_by_user_id,
          idempotency_key,
          created_by_user_id,
          updated_by_user_id
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21, $22, $22
        )
        on conflict (tenant_id, clinic_id, idempotency_key) where idempotency_key is not null
        do update set updated_at = tasks.updated_at
        returning *
      `,
      [
        scope.tenantId,
        scope.clinicId,
        input.patientId ?? null,
        input.leadId ?? null,
        input.appointmentId ?? null,
        input.invoiceId ?? null,
        input.encounterId ?? null,
        input.treatmentPlanId ?? null,
        input.procedurePerformedId ?? null,
        input.taskType,
        input.sourceWorkflow ?? "manual",
        input.sourceRecordType ?? null,
        input.sourceRecordId ?? null,
        input.title,
        input.description ?? null,
        input.priority ?? "normal",
        input.status ?? "open",
        input.dueAt ?? null,
        input.assignedToUserId ?? null,
        input.assignedToUserId ? scope.actorUserId : null,
        input.idempotencyKey ?? null,
        scope.actorUserId
      ]
    );
    return mapTaskRow(result.rows[0]);
  }

  async #loadSopRunDetail(
    client: SqlQueryClient,
    scope: RepositoryScope,
    sopRunId: UUID
  ): Promise<SopRunDetail | null> {
    const runResult = await client.query<SopRunRow>(
      `
        select *
        from sop_runs
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, sopRunId]
    );
    if (!runResult.rows[0]) return null;
    const items = (
      await client.query<SopRunItemRow>(
        `
          select *
          from sop_run_items
          where tenant_id = $1 and clinic_id = $2 and sop_run_id = $3
          order by item_index asc
        `,
        [scope.tenantId, scope.clinicId, sopRunId]
      )
    ).rows.map(mapSopRunItemRow);
    return { run: mapSopRunRow(runResult.rows[0]), items };
  }

  async #findPatientByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<PatientRecord | null> {
    const result = await client.query<PatientRow>(
      `
        select *
        from patients
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, patientId]
    );
    return result.rows[0] ? mapPatientRow(result.rows[0]) : null;
  }

  async #findLeadByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    leadId: UUID
  ): Promise<LeadRecord | null> {
    const result = await client.query<LeadRow>(
      `
        select *
        from leads
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, leadId]
    );
    return result.rows[0] ? mapLeadRow(result.rows[0]) : null;
  }

  async #findAppointmentByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    appointmentId: UUID
  ): Promise<AppointmentRecord | null> {
    const result = await client.query<AppointmentRow>(
      `
        select *
        from appointments
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, appointmentId]
    );
    return result.rows[0] ? mapAppointmentRow(result.rows[0]) : null;
  }

  async #findIntakeFormTemplateByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    templateId: UUID
  ): Promise<IntakeFormTemplateRecord | null> {
    const result = await client.query<IntakeFormTemplateRow>(
      `
        select *
        from form_templates
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, templateId]
    );
    return result.rows[0] ? mapIntakeFormTemplateRow(result.rows[0]) : null;
  }

  async #listPatientConsentsInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<ConsentRecord[]> {
    const result = await client.query<ConsentRow>(
      `
        select *
        from consents
        where tenant_id = $1 and clinic_id = $2 and patient_id = $3
        order by created_at desc
      `,
      [scope.tenantId, scope.clinicId, patientId]
    );
    return result.rows.map(mapConsentRow);
  }

  async #findEncounterByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    encounterId: UUID
  ): Promise<EncounterRecord | null> {
    const result = await client.query<EncounterRow>(
      `
        select *
        from encounters
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, encounterId]
    );
    return result.rows[0] ? mapEncounterRow(result.rows[0]) : null;
  }

  async #findAiSessionByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    sessionId: UUID
  ): Promise<AiSessionRecord | null> {
    const result = await client.query<AiSessionRow>(
      `
        select *
        from ai_sessions
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, sessionId]
    );
    return result.rows[0] ? mapAiSessionRow(result.rows[0]) : null;
  }

  async #listAiSourceAnchorsInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    sessionId: UUID
  ): Promise<AiSourceAnchorRecord[]> {
    const result = await client.query<AiSourceAnchorRow>(
      `
        select *
        from ai_source_anchors
        where tenant_id = $1 and clinic_id = $2 and session_id = $3
        order by created_at
      `,
      [scope.tenantId, scope.clinicId, sessionId]
    );
    return result.rows.map(mapAiSourceAnchorRow);
  }

  async #createAiSourceAnchorInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    session: AiSessionRecord,
    input: CreateAiSourceAnchorInput
  ): Promise<AiSourceAnchorRecord> {
    const supported = input.supported ?? input.anchorType === "transcript_segment";
    const result = await client.query<AiSourceAnchorRow>(
      `
        insert into ai_source_anchors (
          id,
          tenant_id,
          clinic_id,
          session_id,
          patient_id,
          encounter_id,
          anchor_type,
          source_record_type,
          source_record_id,
          transcript_segment_id,
          starts_at_ms,
          ends_at_ms,
          text_quote_digest,
          supported,
          unsupported_reason
        )
        values (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
        returning *
      `,
      [
        input.id ?? null,
        scope.tenantId,
        scope.clinicId,
        session.id,
        session.patientId,
        session.encounterId,
        input.anchorType,
        input.sourceRecordType,
        input.sourceRecordId,
        input.transcriptSegmentId ?? null,
        input.startsAtMs ?? null,
        input.endsAtMs ?? null,
        input.textQuoteDigest ?? null,
        supported,
        input.unsupportedReason ?? (supported ? null : "unsupported_source_anchor")
      ]
    );
    return mapAiSourceAnchorRow(result.rows[0]);
  }

  async #findLatestClinicalNoteVersionInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    encounterId: UUID,
    status: ClinicalNoteVersionRecord["status"]
  ): Promise<ClinicalNoteVersionRecord | null> {
    const result = await client.query<ClinicalNoteVersionRow>(
      `
        select *
        from clinical_note_versions
        where tenant_id = $1 and clinic_id = $2 and encounter_id = $3 and status = $4
        order by version_number desc
        limit 1
      `,
      [scope.tenantId, scope.clinicId, encounterId, status]
    );
    return result.rows[0] ? mapClinicalNoteVersionRow(result.rows[0]) : null;
  }

  async #findLatestSignedClinicalNoteVersionInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    encounterId: UUID
  ): Promise<ClinicalNoteVersionRecord | null> {
    const result = await client.query<ClinicalNoteVersionRow>(
      `
        select *
        from clinical_note_versions
        where tenant_id = $1
          and clinic_id = $2
          and encounter_id = $3
          and status in ('signed', 'amended')
        order by version_number desc
        limit 1
      `,
      [scope.tenantId, scope.clinicId, encounterId]
    );
    return result.rows[0] ? mapClinicalNoteVersionRow(result.rows[0]) : null;
  }

  async #nextClinicalNoteVersionNumber(
    client: SqlQueryClient,
    scope: RepositoryScope,
    encounterId: UUID
  ): Promise<number> {
    const result = await client.query<{ next_version: number }>(
      `
        select coalesce(max(version_number), 0) + 1 as next_version
        from clinical_note_versions
        where tenant_id = $1 and clinic_id = $2 and encounter_id = $3
      `,
      [scope.tenantId, scope.clinicId, encounterId]
    );
    return Number(result.rows[0]?.next_version ?? 1);
  }

  async #findPrescriptionByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    prescriptionId: UUID
  ): Promise<PrescriptionRecord | null> {
    const result = await client.query<PrescriptionRow>(
      `
        select *
        from prescriptions
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, prescriptionId]
    );
    return result.rows[0] ? mapPrescriptionRow(result.rows[0]) : null;
  }

  async #findMediaUploadReservationByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    uploadId: UUID
  ): Promise<MediaUploadReservationRecord | null> {
    const result = await client.query<MediaUploadReservationRow>(
      `
        select *
        from media_uploads
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, uploadId]
    );
    return result.rows[0] ? mapMediaUploadReservationRow(result.rows[0]) : null;
  }

  async #findPricebookProcedureByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    procedureId: UUID
  ): Promise<PricebookProcedureRecord | null> {
    const result = await client.query<PricebookProcedureRow>(
      `
        select *
        from pricebook_procedures
        where tenant_id = $1 and clinic_id = $2 and id = $3 and status = 'active'
      `,
      [scope.tenantId, scope.clinicId, procedureId]
    );
    return result.rows[0] ? mapPricebookProcedureRow(result.rows[0]) : null;
  }

  async #findTreatmentPlanRowInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    treatmentPlanId: UUID
  ): Promise<TreatmentPlanRecord | null> {
    const result = await client.query<TreatmentPlanRow>(
      `
        select *
        from treatment_plans
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, treatmentPlanId]
    );
    return result.rows[0] ? mapTreatmentPlanRow(result.rows[0]) : null;
  }

  async #findTreatmentPlanDetailInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    treatmentPlanId: UUID
  ): Promise<TreatmentPlanDetail | null> {
    const treatmentPlan = await this.#findTreatmentPlanRowInTransaction(
      client,
      scope,
      treatmentPlanId
    );
    if (!treatmentPlan) return null;

    const phases = (
      await client.query<TreatmentPlanPhaseRow>(
        `
          select *
          from treatment_plan_phases
          where tenant_id = $1 and clinic_id = $2 and treatment_plan_id = $3
          order by phase_index
        `,
        [scope.tenantId, scope.clinicId, treatmentPlanId]
      )
    ).rows.map(mapTreatmentPlanPhaseRow);
    const items = (
      await client.query<TreatmentPlanEstimateItemRow>(
        `
          select *
          from treatment_plan_estimate_items
          where tenant_id = $1 and clinic_id = $2 and treatment_plan_id = $3
          order by created_at
        `,
        [scope.tenantId, scope.clinicId, treatmentPlanId]
      )
    ).rows.map(mapTreatmentPlanEstimateItemRow);

    return {
      treatmentPlan,
      phases: phases.map((phase) => ({
        ...phase,
        estimateItems: items.filter((item) => item.phaseId === phase.id)
      }))
    };
  }

  async #replaceTreatmentPlanPhasesInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    plan: TreatmentPlanRecord,
    phases: CreateTreatmentPlanInput["phases"]
  ): Promise<void> {
    if (phases.length === 0) {
      throw new Error("Treatment plan requires at least one phase.");
    }

    for (const [phaseIndex, phaseInput] of phases.entries()) {
      if (phaseInput.items.length === 0) {
        throw new Error("Treatment plan phases require at least one estimate item.");
      }

      const phaseResult = await client.query<TreatmentPlanPhaseRow>(
        `
          insert into treatment_plan_phases (
            tenant_id,
            clinic_id,
            treatment_plan_id,
            phase_index,
            title,
            description,
            estimated_start_after_days
          )
          values ($1, $2, $3, $4, $5, $6, $7)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          plan.id,
          phaseIndex + 1,
          phaseInput.title.trim(),
          phaseInput.description?.trim() || null,
          phaseInput.estimatedStartAfterDays ?? null
        ]
      );
      const phase = mapTreatmentPlanPhaseRow(phaseResult.rows[0]);

      for (const itemInput of phaseInput.items) {
        const procedure = await this.#findPricebookProcedureByIdInTransaction(
          client,
          scope,
          itemInput.pricebookProcedureId
        );
        if (!procedure) {
          throw new Error("Pricebook procedure is not active or not available.");
        }
        if (itemInput.dentalFindingId) {
          const finding = await this.#findDentalFindingByIdInTransaction(
            client,
            scope,
            itemInput.dentalFindingId
          );
          if (!finding || finding.patientId !== plan.patientId) {
            throw new Error("Dental finding does not belong to the treatment plan patient.");
          }
        }

        const quantity = itemInput.quantity ?? 1;
        const unitPriceMinor = itemInput.unitPriceMinor ?? procedure.defaultUnitPriceMinor;
        const taxRateBasisPoints = itemInput.taxRateBasisPoints ?? procedure.taxRateBasisPoints;
        const totals = calculateBillingLineTotals({
          quantity,
          unitPriceMinor,
          discountMinor: itemInput.discountMinor ?? 0,
          taxRateBasisPoints
        });
        await client.query(
          `
            insert into treatment_plan_estimate_items (
              tenant_id,
              clinic_id,
              treatment_plan_id,
              phase_id,
              pricebook_procedure_id,
              dental_finding_id,
              tooth_number,
              quantity,
              unit_price_minor,
              discount_minor,
              tax_rate_basis_points,
              tax_minor,
              total_minor,
              estimated_visits,
              priority,
              notes,
              status
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
          `,
          [
            scope.tenantId,
            scope.clinicId,
            plan.id,
            phase.id,
            procedure.id,
            itemInput.dentalFindingId ?? null,
            itemInput.toothNumber ? normalizeDentalToothNumber(itemInput.toothNumber) : null,
            quantity,
            unitPriceMinor,
            totals.discountMinor,
            taxRateBasisPoints,
            totals.taxMinor,
            totals.totalMinor,
            itemInput.estimatedVisits ?? 1,
            itemInput.priority?.trim() || null,
            itemInput.notes?.trim() || null,
            plan.status === "accepted" ? "accepted" : "planned"
          ]
        );
      }
    }
  }

  async #recalculateTreatmentPlanTotalsInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    treatmentPlanId: UUID
  ): Promise<void> {
    await client.query(
      `
        update treatment_plans
        set
          subtotal_minor = coalesce(totals.subtotal_minor, 0),
          discount_minor = coalesce(totals.discount_minor, 0),
          tax_minor = coalesce(totals.tax_minor, 0),
          total_minor = coalesce(totals.total_minor, 0),
          updated_by_user_id = $4
        from (
          select
            treatment_plan_id,
            sum(quantity * unit_price_minor)::bigint as subtotal_minor,
            sum(discount_minor)::bigint as discount_minor,
            sum(tax_minor)::bigint as tax_minor,
            sum(total_minor)::bigint as total_minor
          from treatment_plan_estimate_items
          where tenant_id = $1 and clinic_id = $2 and treatment_plan_id = $3
          group by treatment_plan_id
        ) totals
        where treatment_plans.tenant_id = $1
          and treatment_plans.clinic_id = $2
          and treatment_plans.id = $3
      `,
      [scope.tenantId, scope.clinicId, treatmentPlanId, scope.actorUserId]
    );
  }

  async #listCompletedProceduresForInvoiceInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    input: CreateInvoiceInput
  ): Promise<ProcedurePerformedRecord[]> {
    const ids = input.procedurePerformedIds ?? [];
    const result = await client.query<ProcedurePerformedRow>(
      `
        select *
        from procedure_performed_records
        where tenant_id = $1
          and clinic_id = $2
          and status = 'completed'
          and invoice_id is null
          and ($3::uuid is null or patient_id = $3)
          and ($4::uuid is null or treatment_plan_id = $4)
          and (cardinality($5::uuid[]) = 0 or id = any($5::uuid[]))
        order by performed_at
      `,
      [scope.tenantId, scope.clinicId, input.patientId ?? null, input.treatmentPlanId ?? null, ids]
    );
    return result.rows.map(mapProcedurePerformedRow);
  }

  async #findInvoiceRowInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    invoiceId: UUID
  ): Promise<InvoiceRecord | null> {
    const result = await client.query<InvoiceRow>(
      `
        select *
        from invoices
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, invoiceId]
    );
    return result.rows[0] ? mapInvoiceRow(result.rows[0]) : null;
  }

  async #findInvoiceDetailInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    invoiceId: UUID
  ): Promise<InvoiceDetail | null> {
    await this.#recalculateInvoicePaymentStateInTransaction(client, scope, invoiceId);
    const invoice = await this.#findInvoiceRowInTransaction(client, scope, invoiceId);
    if (!invoice) return null;
    const items = (
      await client.query<InvoiceItemRow>(
        `
          select *
          from invoice_items
          where tenant_id = $1 and clinic_id = $2 and invoice_id = $3
          order by created_at
        `,
        [scope.tenantId, scope.clinicId, invoiceId]
      )
    ).rows.map(mapInvoiceItemRow);
    const paymentRequests = (
      await client.query<PaymentRequestRow>(
        `
          select *
          from payment_requests
          where tenant_id = $1 and clinic_id = $2 and invoice_id = $3
          order by created_at desc
        `,
        [scope.tenantId, scope.clinicId, invoiceId]
      )
    ).rows.map(mapPaymentRequestRow);
    const payments = (
      await client.query<PaymentTransactionRow>(
        `
          select *
          from payment_transactions
          where tenant_id = $1 and clinic_id = $2 and invoice_id = $3
          order by received_at desc
        `,
        [scope.tenantId, scope.clinicId, invoiceId]
      )
    ).rows.map(mapPaymentTransactionRow);
    const receipts = (
      await client.query<ReceiptRow>(
        `
          select *
          from receipts
          where tenant_id = $1 and clinic_id = $2 and invoice_id = $3
          order by generated_at desc
        `,
        [scope.tenantId, scope.clinicId, invoiceId]
      )
    ).rows.map(mapReceiptRow);

    return { invoice, items, paymentRequests, payments, receipts };
  }

  async #nextInvoiceNumber(client: SqlQueryClient, scope: RepositoryScope): Promise<string> {
    const result = await client.query<{ next_sequence: number }>(
      `
        select count(*)::integer + 1 as next_sequence
        from invoices
        where tenant_id = $1 and clinic_id = $2
      `,
      [scope.tenantId, scope.clinicId]
    );
    return `INV-${await this.#clinicDateKey(client, scope)}-${String(
      Number(result.rows[0]?.next_sequence ?? 1)
    ).padStart(4, "0")}`;
  }

  async #nextReceiptNumber(client: SqlQueryClient, scope: RepositoryScope): Promise<string> {
    const result = await client.query<{ next_sequence: number }>(
      `
        select count(*)::integer + 1 as next_sequence
        from receipts
        where tenant_id = $1 and clinic_id = $2
      `,
      [scope.tenantId, scope.clinicId]
    );
    return `RCT-${await this.#clinicDateKey(client, scope)}-${String(
      Number(result.rows[0]?.next_sequence ?? 1)
    ).padStart(4, "0")}`;
  }

  async #recalculateInvoicePaymentStateInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    invoiceId: UUID
  ): Promise<void> {
    const invoice = await this.#findInvoiceRowInTransaction(client, scope, invoiceId);
    if (!invoice) return;
    const payments = (
      await client.query<PaymentTransactionRow>(
        `
          select *
          from payment_transactions
          where tenant_id = $1 and clinic_id = $2 and invoice_id = $3
        `,
        [scope.tenantId, scope.clinicId, invoiceId]
      )
    ).rows.map(mapPaymentTransactionRow);
    const requestCount = Number(
      (
        await client.query<{ count: string }>(
          `
            select count(*) as count
            from payment_requests
            where tenant_id = $1 and clinic_id = $2 and invoice_id = $3
          `,
          [scope.tenantId, scope.clinicId, invoiceId]
        )
      ).rows[0]?.count ?? 0
    );
    const paidMinor = payments
      .filter((payment) => isSettledPaymentTransaction(payment))
      .reduce((total, payment) => total + payment.amountMinor, 0);
    const refundedMinor = payments
      .filter((payment) => payment.status === "refunded")
      .reduce((total, payment) => total + payment.amountMinor, 0);
    const hasReconciliationIssue = payments.some(
      (payment) =>
        payment.status === "reconciliation_required" ||
        payment.reconciliationStatus === "requires_review"
    );
    const paymentStatus = calculateInvoicePaymentStatus({
      totalMinor: invoice.totalMinor,
      paidMinor,
      refundedMinor,
      hasPaymentRequest: requestCount > 0,
      hasReconciliationIssue,
      invoiceStatus: invoice.status
    });

    await client.query(
      `
        update invoices
        set
          paid_minor = $4,
          refunded_minor = $5,
          balance_minor = greatest(total_minor - $4 + $5, 0),
          payment_status = $6
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, invoiceId, paidMinor, refundedMinor, paymentStatus]
    );
  }

  async #ensureDentalChartInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<DentalChartRecord | null> {
    const patient = await this.#findPatientByIdInTransaction(client, scope, patientId);
    if (!patient) return null;

    const created = await client.query<DentalChartRow>(
      `
        insert into dental_charts (
          tenant_id,
          clinic_id,
          patient_id,
          numbering_system,
          created_by_user_id,
          updated_by_user_id
        )
        values ($1, $2, $3, 'fdi', $4, $4)
        on conflict (tenant_id, clinic_id, patient_id) do nothing
        returning *
      `,
      [scope.tenantId, scope.clinicId, patientId, scope.actorUserId]
    );
    if (created.rows[0]) return mapDentalChartRow(created.rows[0]);

    const existing = await client.query<DentalChartRow>(
      `
        select *
        from dental_charts
        where tenant_id = $1 and clinic_id = $2 and patient_id = $3
      `,
      [scope.tenantId, scope.clinicId, patientId]
    );
    return existing.rows[0] ? mapDentalChartRow(existing.rows[0]) : null;
  }

  async #listDentalFindingsInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<DentalFindingRecord[]> {
    const result = await client.query<DentalFindingRow>(
      `
        select *
        from dental_findings
        where tenant_id = $1 and clinic_id = $2 and patient_id = $3
        order by tooth_number, surface nulls first, created_at desc
      `,
      [scope.tenantId, scope.clinicId, patientId]
    );
    return result.rows.map(mapDentalFindingRow);
  }

  async #listDentalChartSnapshotsInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<DentalChartSnapshotRecord[]> {
    const result = await client.query<DentalChartSnapshotRow>(
      `
        select *
        from dental_chart_snapshots
        where tenant_id = $1 and clinic_id = $2 and patient_id = $3
        order by snapshot_version desc
      `,
      [scope.tenantId, scope.clinicId, patientId]
    );
    return result.rows.map(mapDentalChartSnapshotRow);
  }

  async #findDentalFindingByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    findingId: UUID
  ): Promise<DentalFindingRecord | null> {
    const result = await client.query<DentalFindingRow>(
      `
        select *
        from dental_findings
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, findingId]
    );
    return result.rows[0] ? mapDentalFindingRow(result.rows[0]) : null;
  }

  async #nextDentalChartSnapshotVersion(
    client: SqlQueryClient,
    scope: RepositoryScope,
    patientId: UUID
  ): Promise<number> {
    const result = await client.query<{ next_version: number }>(
      `
        select coalesce(max(snapshot_version), 0) + 1 as next_version
        from dental_chart_snapshots
        where tenant_id = $1 and clinic_id = $2 and patient_id = $3
      `,
      [scope.tenantId, scope.clinicId, patientId]
    );
    return Number(result.rows[0]?.next_version ?? 1);
  }

  async #appendDentalFindingHistory(
    client: SqlQueryClient,
    scope: RepositoryScope,
    input: {
      finding: DentalFindingRecord;
      changeType: DentalFindingHistoryRecord["changeType"];
      reason: string | null;
      beforeState: DentalFindingHistoryRecord["beforeState"];
      provenance: Record<string, unknown>;
    }
  ): Promise<DentalFindingHistoryRecord> {
    const afterState = toDentalFindingSnapshotFinding(input.finding);
    const result = await client.query<DentalFindingHistoryRow>(
      `
        insert into dental_finding_history (
          tenant_id,
          clinic_id,
          finding_id,
          patient_id,
          encounter_id,
          change_type,
          changed_by_user_id,
          reason,
          before_state,
          after_state,
          provenance
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11::jsonb)
        returning *
      `,
      [
        scope.tenantId,
        scope.clinicId,
        input.finding.id,
        input.finding.patientId,
        input.finding.encounterId,
        input.changeType,
        scope.actorUserId,
        input.reason,
        JSON.stringify(input.beforeState),
        JSON.stringify(afterState),
        JSON.stringify(input.provenance)
      ]
    );
    return mapDentalFindingHistoryRow(result.rows[0]);
  }

  async #findLabVendorByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    vendorId: UUID
  ): Promise<LabVendorRecord | null> {
    const result = await client.query<LabVendorRow>(
      `
        select *
        from lab_vendors
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, vendorId]
    );
    return result.rows[0] ? mapLabVendorRow(result.rows[0]) : null;
  }

  async #findLabCaseDetailInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    labCaseId: UUID
  ): Promise<LabCaseDetail | null> {
    const labCaseResult = await client.query<LabCaseRow>(
      `
        select *
        from lab_cases
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, labCaseId]
    );
    if (!labCaseResult.rows[0]) return null;
    const labCase = mapLabCaseRow(labCaseResult.rows[0]);
    const vendor = await this.#findLabVendorByIdInTransaction(client, scope, labCase.vendorId);
    if (!vendor) return null;
    const items = (
      await client.query<LabCaseItemRow>(
        `
          select *
          from lab_case_items
          where tenant_id = $1 and clinic_id = $2 and lab_case_id = $3
          order by created_at asc
        `,
        [scope.tenantId, scope.clinicId, labCaseId]
      )
    ).rows.map(mapLabCaseItemRow);
    const statusHistory = (
      await client.query<LabCaseStatusHistoryRow>(
        `
          select *
          from lab_case_status_history
          where tenant_id = $1 and clinic_id = $2 and lab_case_id = $3
          order by changed_at asc
        `,
        [scope.tenantId, scope.clinicId, labCaseId]
      )
    ).rows.map(mapLabCaseStatusHistoryRow);
    return { labCase, vendor, items, statusHistory };
  }

  async #findLabCaseRowForUpdate(
    client: SqlQueryClient,
    scope: RepositoryScope,
    labCaseId: UUID
  ): Promise<LabCaseRow | null> {
    const result = await client.query<LabCaseRow>(
      `
        select *
        from lab_cases
        where tenant_id = $1 and clinic_id = $2 and id = $3
        for update
      `,
      [scope.tenantId, scope.clinicId, labCaseId]
    );
    return result.rows[0] ?? null;
  }

  async #nextLabSlipNumber(client: SqlQueryClient, scope: RepositoryScope): Promise<string> {
    const result = await client.query<{ next_count: number }>(
      `
        select count(*)::integer + 1 as next_count
        from lab_cases
        where tenant_id = $1 and clinic_id = $2
      `,
      [scope.tenantId, scope.clinicId]
    );
    return `LAB-${await this.#clinicDateKey(client, scope)}-${String(result.rows[0]?.next_count ?? 1).padStart(4, "0")}`;
  }

  async #clinicDateKey(client: SqlQueryClient, scope: RepositoryScope): Promise<string> {
    return (await this.#clinicCalendar(client, scope)).date.replace(/-/g, "");
  }

  async #clinicCalendar(
    client: SqlQueryClient,
    scope: RepositoryScope
  ): Promise<{ date: string; timezone: string }> {
    const result = await client.query<{ timezone: string }>(
      `select timezone from clinics where tenant_id = $1 and id = $2`,
      [scope.tenantId, scope.clinicId]
    );
    const timezone = result.rows[0]?.timezone;
    if (!timezone) throw new Error("Clinic timezone is required for clinic-local identifiers.");
    return { date: clinicLocalDateFromClock(this.#clock, timezone), timezone };
  }

  async #appendLabCaseStatusHistory(
    client: SqlQueryClient,
    scope: RepositoryScope,
    labCase: LabCaseRecord,
    fromStatus: LabCaseStatusHistoryRecord["fromStatus"],
    toStatus: LabCaseStatusHistoryRecord["toStatus"],
    reason: string | null,
    evidence: Record<string, unknown>
  ): Promise<void> {
    await client.query(
      `
        insert into lab_case_status_history (
          tenant_id,
          clinic_id,
          lab_case_id,
          patient_id,
          from_status,
          to_status,
          reason,
          evidence,
          changed_by_user_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      `,
      [
        scope.tenantId,
        scope.clinicId,
        labCase.id,
        labCase.patientId,
        fromStatus,
        toStatus,
        reason,
        JSON.stringify(evidence),
        scope.actorUserId
      ]
    );
  }

  async #findInventoryItemByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    itemId: UUID,
    forUpdate = false
  ): Promise<InventoryItemRecord | null> {
    const result = await client.query<InventoryItemRow>(
      `
        select *
        from inventory_items
        where tenant_id = $1 and clinic_id = $2 and id = $3
        ${forUpdate ? "for update" : ""}
      `,
      [scope.tenantId, scope.clinicId, itemId]
    );
    return result.rows[0] ? mapInventoryItemRow(result.rows[0]) : null;
  }

  async #insertStockLedgerEntryInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    item: InventoryItemRecord,
    input: Pick<
      CreateStockLedgerEntryInput,
      | "movementType"
      | "quantityDelta"
      | "unitCostMinor"
      | "currency"
      | "sourceTable"
      | "sourceId"
      | "reason"
      | "evidence"
    >
  ): Promise<StockLedgerEntryRecord> {
    const quantityAfter = item.currentQuantity + input.quantityDelta;
    assertFiniteQuantity(quantityAfter, "quantityAfter");
    await client.query(
      `
        update inventory_items
        set current_quantity = $4, updated_by_user_id = $5
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, item.id, quantityAfter, scope.actorUserId]
    );
    const result = await client.query<StockLedgerEntryRow>(
      `
        insert into stock_ledger_entries (
          tenant_id,
          clinic_id,
          item_id,
          movement_type,
          quantity_delta,
          quantity_after,
          unit_cost_minor,
          currency,
          source_table,
          source_id,
          reason,
          evidence,
          recorded_by_user_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
        returning *
      `,
      [
        scope.tenantId,
        scope.clinicId,
        item.id,
        input.movementType,
        input.quantityDelta,
        quantityAfter,
        input.unitCostMinor ?? null,
        input.currency ?? null,
        input.sourceTable ?? null,
        input.sourceId ?? null,
        input.reason,
        JSON.stringify(input.evidence ?? {}),
        scope.actorUserId
      ]
    );
    return mapStockLedgerEntryRow(result.rows[0]);
  }

  async #listInventoryCheckTemplateLines(
    client: SqlQueryClient,
    scope: RepositoryScope,
    templateId: UUID
  ): Promise<InventoryCheckTemplateLineRecord[]> {
    return (
      await client.query<InventoryCheckTemplateLineRow>(
        `
          select *
          from inventory_check_template_lines
          where tenant_id = $1 and clinic_id = $2 and template_id = $3
          order by sequence
        `,
        [scope.tenantId, scope.clinicId, templateId]
      )
    ).rows.map(mapInventoryCheckTemplateLineRow);
  }

  async #findInventoryCheckRunDetailInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    checkRunId: UUID
  ): Promise<InventoryCheckRunDetail | null> {
    const runResult = await client.query<InventoryCheckRunRow>(
      `
        select *
        from inventory_check_runs
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, checkRunId]
    );
    if (!runResult.rows[0]) return null;
    const run = mapInventoryCheckRunRow(runResult.rows[0]);
    const templateResult = await client.query<InventoryCheckTemplateRow>(
      `
        select *
        from inventory_check_templates
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, run.templateId]
    );
    if (!templateResult.rows[0]) return null;
    const lines = (
      await client.query<InventoryCheckRunLineRow>(
        `
          select *
          from inventory_check_run_lines
          where tenant_id = $1 and clinic_id = $2 and check_run_id = $3
          order by sequence
        `,
        [scope.tenantId, scope.clinicId, run.id]
      )
    ).rows.map(mapInventoryCheckRunLineRow);
    const procurementSuggestions = (
      await client.query<ProcurementSuggestionRow>(
        `
          select *
          from procurement_suggestions
          where tenant_id = $1 and clinic_id = $2 and source_check_run_id = $3
          order by created_at
        `,
        [scope.tenantId, scope.clinicId, run.id]
      )
    ).rows.map(mapProcurementSuggestionRow);
    return {
      run,
      template: mapInventoryCheckTemplateRow(templateResult.rows[0]),
      lines,
      procurementSuggestions
    };
  }

  async #ensureProcurementSuggestion(
    client: SqlQueryClient,
    scope: RepositoryScope,
    item: InventoryItemRecord,
    sourceCheckRunLineId: UUID,
    sourceCheckRunId: UUID,
    exceptionType: string
  ): Promise<ProcurementSuggestionRecord> {
    const existing = await client.query<ProcurementSuggestionRow>(
      `
        select *
        from procurement_suggestions
        where tenant_id = $1
          and clinic_id = $2
          and item_id = $3
          and source_check_run_line_id = $4
          and status = 'suggested'
        limit 1
      `,
      [scope.tenantId, scope.clinicId, item.id, sourceCheckRunLineId]
    );
    if (existing.rows[0]) return mapProcurementSuggestionRow(existing.rows[0]);

    const result = await client.query<ProcurementSuggestionRow>(
      `
        insert into procurement_suggestions (
          tenant_id,
          clinic_id,
          item_id,
          source_check_run_id,
          source_check_run_line_id,
          suggested_quantity,
          reason,
          evidence,
          created_by_user_id
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
        returning *
      `,
      [
        scope.tenantId,
        scope.clinicId,
        item.id,
        sourceCheckRunId,
        sourceCheckRunLineId,
        Math.max(item.reorderQuantity, item.minimumQuantity - item.currentQuantity),
        `${item.displayName} is below minimum stock after inventory check.`,
        JSON.stringify({ exceptionType, taskCreation: "suggested_not_created" }),
        scope.actorUserId
      ]
    );
    return mapProcurementSuggestionRow(result.rows[0]);
  }

  async #findProcurementSuggestionForLine(
    client: SqlQueryClient,
    scope: RepositoryScope,
    lineId: UUID
  ): Promise<ProcurementSuggestionRecord | null> {
    const result = await client.query<ProcurementSuggestionRow>(
      `
        select *
        from procurement_suggestions
        where tenant_id = $1 and clinic_id = $2 and source_check_run_line_id = $3 and status = 'suggested'
        limit 1
      `,
      [scope.tenantId, scope.clinicId, lineId]
    );
    return result.rows[0] ? mapProcurementSuggestionRow(result.rows[0]) : null;
  }

  async #findOpenProcurementSuggestionForItem(
    client: SqlQueryClient,
    scope: RepositoryScope,
    itemId: UUID
  ): Promise<ProcurementSuggestionRecord | null> {
    const result = await client.query<ProcurementSuggestionRow>(
      `
        select *
        from procurement_suggestions
        where tenant_id = $1 and clinic_id = $2 and item_id = $3 and status = 'suggested'
        order by created_at desc
        limit 1
      `,
      [scope.tenantId, scope.clinicId, itemId]
    );
    return result.rows[0] ? mapProcurementSuggestionRow(result.rows[0]) : null;
  }

  async #findIncidentByIdInTransaction(
    client: SqlQueryClient,
    scope: RepositoryScope,
    incidentId: UUID
  ): Promise<IncidentRecord | null> {
    const result = await client.query<IncidentRow>(
      `
        select *
        from incidents
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, incidentId]
    );
    return result.rows[0] ? mapIncidentRow(result.rows[0]) : null;
  }

  async #appendEncounterStatusHistory(
    client: SqlQueryClient,
    scope: RepositoryScope,
    encounter: EncounterRecord,
    fromStatus: EncounterRecord["status"] | null,
    reason: string | null
  ): Promise<void> {
    await client.query(
      `
        insert into encounter_status_history (
          tenant_id,
          clinic_id,
          encounter_id,
          from_status,
          to_status,
          changed_by_user_id,
          reason
        )
        values ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        scope.tenantId,
        scope.clinicId,
        encounter.id,
        fromStatus,
        encounter.status,
        scope.actorUserId,
        reason
      ]
    );
  }

  async #appendTimeline(
    client: SqlQueryClient,
    scope: RepositoryScope,
    input: {
      patientId: UUID;
      itemType: PatientTimelineItem["itemType"];
      sourceTable: string;
      sourceId: UUID;
      title: string;
      summary: string | null;
      metadata: Record<string, unknown>;
    }
  ): Promise<void> {
    await client.query(
      `
        insert into patient_timeline_items (
          tenant_id,
          clinic_id,
          patient_id,
          item_type,
          source_table,
          source_id,
          occurred_at,
          title,
          summary,
          metadata
        )
        values ($1, $2, $3, $4, $5, $6, now(), $7, $8, $9::jsonb)
      `,
      [
        scope.tenantId,
        scope.clinicId,
        input.patientId,
        input.itemType,
        input.sourceTable,
        input.sourceId,
        input.title,
        input.summary,
        JSON.stringify(input.metadata)
      ]
    );
  }
}

async function withTransaction<T>(
  connectionFactory: SqlConnectionFactory,
  callback: (client: SqlQueryClient) => Promise<T>
): Promise<T> {
  if (connectionFactory.inTransaction) {
    return callback(connectionFactory);
  }
  const client = connectionFactory.connect ? await connectionFactory.connect() : connectionFactory;

  try {
    await client.query("begin");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release?.();
  }
}

class TransactionBoundSqlClient implements SqlConnectionFactory {
  readonly inTransaction = true;
  readonly #client: SqlQueryClient;

  constructor(client: SqlQueryClient) {
    this.#client = client;
  }

  query<T = Record<string, unknown>>(
    sql: string,
    values?: readonly unknown[]
  ): Promise<SqlQueryResult<T>> {
    return this.#client.query<T>(sql, values);
  }
}

interface IdentityAccessRow {
  tenant_id: UUID;
  tenant_slug: string;
  tenant_legal_name: string;
  tenant_display_name: string;
  tenant_status: Tenant["status"];
  user_id: UUID;
  user_display_name: string;
  user_email: string | null;
  user_phone: string | null;
  user_status: ClinicUser["status"];
  membership_status: TenantMembership["status"];
  clinic_id: UUID;
  clinic_slug: string;
  clinic_display_name: string;
  clinic_status: Clinic["status"];
  clinic_timezone: string;
  clinic_assignment_status: ClinicAssignment["status"];
  role_slug: RoleAssignment["roleSlug"] | null;
  role_clinic_id: UUID | null;
}

interface PatientRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  full_name: string;
  phone: string | null;
  email: string | null;
  date_of_birth: Date | string | null;
  gender: PatientGender;
  abha_address: string | null;
  source: PatientRecord["source"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface PatientTimelineRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  item_type: PatientTimelineItem["itemType"];
  source_table: string;
  source_id: UUID;
  occurred_at: Date | string;
  title: string;
  summary: string | null;
  metadata: Record<string, unknown>;
}

interface AuditEventReviewJoinedRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID | null;
  actor_type: AuditEventForReviewRecord["actorType"];
  actor_id: string;
  action: string;
  category: AuditEventForReviewRecord["category"];
  risk_level: AuditEventForReviewRecord["riskLevel"];
  phi_involved: boolean;
  resource_type: string | null;
  resource_id: string | null;
  patient_id: UUID | null;
  ip_address: string | null;
  user_agent: string | null;
  correlation_id: string | null;
  metadata: Record<string, unknown>;
  occurred_at: Date | string;
  review_id: UUID | null;
  review_clinic_id: UUID | null;
  review_status: AuditReviewRecord["reviewStatus"] | null;
  disposition: string | null;
  review_notes: string | null;
  reviewed_by_user_id: UUID | null;
  reviewed_at: Date | string | null;
  review_created_at: Date | string | null;
}

interface AuditReviewRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  audit_event_id: UUID;
  review_status: AuditReviewRecord["reviewStatus"];
  disposition: string;
  notes: string | null;
  reviewed_by_user_id: UUID;
  reviewed_at: Date | string;
  created_at: Date | string;
}

interface PatientRecordExportRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  status: PatientRecordExportRecord["status"];
  format: "json";
  sections: PatientRecordExportSection[];
  requested_by_user_id: UUID;
  completed_by_user_id: UUID | null;
  requested_at: Date | string;
  completed_at: Date | string | null;
  manifest: PatientRecordExportRecord["manifest"];
  export_payload: PatientRecordExportSnapshot | null;
  payload_digest: string | null;
  failure_reason: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DeletionRequestRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  request_type: DeletionRequestRecord["requestType"];
  status: DeletionRequestRecord["status"];
  reason: string;
  requested_by_user_id: UUID;
  requested_at: Date | string;
  reviewed_by_user_id: UUID | null;
  reviewed_at: Date | string | null;
  review_reason: string | null;
  scope: DeletionRequestRecord["scope"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface RetentionRunRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  mode: RetentionRunRecord["mode"];
  status: RetentionRunRecord["status"];
  policy_code: string;
  as_of: Date | string;
  deletion_request_id: UUID | null;
  started_by_user_id: UUID;
  started_at: Date | string;
  completed_at: Date | string;
  summary: RetentionRunRecord["summary"];
  created_at: Date | string;
}

interface RetentionActionRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  run_id: UUID;
  patient_id: UUID | null;
  action_kind: RetentionActionRecord["actionKind"];
  status: RetentionActionRecord["status"];
  target_type: string;
  target_id: string;
  protected_record: boolean;
  evidence: Record<string, unknown>;
  completed_at: Date | string | null;
  created_at: Date | string;
}

interface BreakGlassAccessRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  user_id: UUID;
  patient_id: UUID;
  reason: string;
  status: BreakGlassAccessRecord["status"];
  requested_at: Date | string;
  expires_at: Date | string;
  reviewed_by_user_id: UUID | null;
  reviewed_at: Date | string | null;
  review_reason: string | null;
  revoked_at: Date | string | null;
  access_categories: BreakGlassAccessRecord["accessCategories"];
  access_scope: BreakGlassAccessRecord["accessScope"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface MigrationBatchRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  import_type: MigrationBatchRecord["importType"];
  source_system: string;
  source_file_name: string | null;
  source_checksum: string | null;
  state: MigrationBatchRecord["state"];
  uploaded_by_user_id: UUID;
  committed_by_user_id: UUID | null;
  rolled_back_by_user_id: UUID | null;
  row_count: number | string;
  valid_row_count: number | string;
  invalid_row_count: number | string;
  conflict_row_count: number | string;
  ready_row_count: number | string;
  committed_row_count: number | string;
  rolled_back_row_count: number | string;
  failed_row_count: number | string;
  committed_at: Date | string | null;
  rolled_back_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MigrationRowRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  batch_id: UUID;
  row_number: number;
  import_type: MigrationRowRecord["importType"];
  external_record_id: string | null;
  raw_payload_digest: string;
  normalized_record: MigrationRowRecord["normalizedRecord"] | null;
  validation_errors: MigrationRowRecord["validationErrors"];
  status: MigrationRowRecord["status"];
  match_status: MigrationRowRecord["matchStatus"];
  resolution_action: MigrationRowRecord["resolutionAction"];
  resolution_target_record_type: string | null;
  resolution_target_record_id: UUID | null;
  resolution_note: string | null;
  committed_record_type: string | null;
  committed_record_id: UUID | null;
  error_message: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MigrationConflictRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  batch_id: UUID;
  row_id: UUID;
  conflict_type: MigrationConflictRecord["conflictType"];
  severity: MigrationConflictRecord["severity"];
  target_record_type: string | null;
  target_record_id: UUID | null;
  field_name: string | null;
  summary: string;
  evidence: Record<string, unknown>;
  status: MigrationConflictRecord["status"];
  resolution_action: MigrationConflictRecord["resolutionAction"];
  resolved_by_user_id: UUID | null;
  resolved_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface IntegrationDeadLetterRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID | null;
  raw_event_id: UUID | null;
  normalized_event_id: UUID | null;
  provider_key: string;
  failure_stage: IntegrationDeadLetterRecord["failureStage"];
  failure_code: string;
  failure_summary: string;
  retry_count: number | string;
  next_retry_at: Date | string | null;
  status: IntegrationDeadLetterRecord["status"];
  last_error_digest: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MigrationCommitRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  batch_id: UUID;
  action: MigrationCommitRecord["action"];
  status: MigrationCommitRecord["status"];
  idempotency_key: string | null;
  requested_by_user_id: UUID;
  summary: Record<string, unknown>;
  error_summary: Record<string, unknown> | null;
  started_at: Date | string;
  finished_at: Date | string | null;
}

interface ImportedRecordLinkRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  batch_id: UUID;
  row_id: UUID;
  import_type: ImportedRecordLinkRecord["importType"];
  source_system: string;
  external_record_id: string | null;
  target_record_type: string;
  target_record_id: UUID;
  link_type: ImportedRecordLinkRecord["linkType"];
  verification_status: ImportedRecordLinkRecord["verificationStatus"];
  verified_by_user_id: UUID | null;
  verified_at: Date | string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: UUID;
  created_at: Date | string;
  updated_at: Date | string;
}

interface LeadRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID | null;
  primary_contact: string;
  status: LeadRecord["status"];
  intent: LeadRecord["intent"];
  source: LeadRecord["source"];
  source_detail: Record<string, unknown>;
  first_seen_at: Date | string;
  last_activity_at: Date | string;
  created_by_user_id: UUID | null;
}

interface AppointmentTypeRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  code: string;
  display_name: string;
  default_duration_minutes: number;
  color: string | null;
  active: boolean;
}

interface ChairRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  code: string;
  display_name: string;
  active: boolean;
}

interface ProviderScheduleRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  provider_user_id: UUID;
  day_of_week: number;
  starts_at: string;
  ends_at: string;
  effective_from: Date | string;
  effective_until: Date | string | null;
  active: boolean;
}

interface AppointmentRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  lead_id: UUID | null;
  provider_user_id: UUID;
  appointment_type_id: UUID;
  chair_id: UUID | null;
  status: AppointmentStatus;
  start_at: Date | string;
  end_at: Date | string;
  source: AppointmentRecord["source"];
  reason: string | null;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface QueueEntryRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  appointment_id: UUID;
  patient_id: UUID;
  provider_user_id: UUID;
  status: QueueStatus;
  position: number;
  checked_in_at: Date | string;
  called_at: Date | string | null;
  completed_at: Date | string | null;
}

interface TaskRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID | null;
  lead_id: UUID | null;
  appointment_id: UUID | null;
  invoice_id: UUID | null;
  encounter_id: UUID | null;
  treatment_plan_id: UUID | null;
  procedure_performed_id: UUID | null;
  task_type: TaskRecord["taskType"];
  source_workflow: TaskRecord["sourceWorkflow"];
  source_record_type: string | null;
  source_record_id: UUID | null;
  title: string;
  description: string | null;
  priority: TaskRecord["priority"];
  status: TaskRecord["status"];
  due_at: Date | string | null;
  assigned_to_user_id: UUID | null;
  assigned_by_user_id: UUID | null;
  completed_by_user_id: UUID | null;
  completed_at: Date | string | null;
  completion_evidence: Record<string, unknown>;
  cancelled_reason: string | null;
  idempotency_key: string | null;
  created_by_user_id: UUID | null;
  updated_by_user_id: UUID | null;
  status_changed_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RecallRuleRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  code: string;
  title: string;
  status: RecallRuleRecord["status"];
  anchor: RecallRuleRecord["anchor"];
  offset_days: number;
  procedure_category: string | null;
  pricebook_procedure_id: UUID | null;
  default_task_title: string;
  default_task_priority: RecallRuleRecord["defaultTaskPriority"];
  created_by_user_id: UUID;
  updated_by_user_id: UUID | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface RecallRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  recall_rule_id: UUID;
  patient_id: UUID;
  source_procedure_performed_id: UUID | null;
  source_invoice_id: UUID | null;
  task_id: UUID | null;
  appointment_id: UUID | null;
  status: RecallRecord["status"];
  due_at: Date | string;
  last_action_at: Date | string | null;
  action_evidence: Record<string, unknown>;
  created_by_user_id: UUID | null;
  updated_by_user_id: UUID | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SopTemplateRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  code: string;
  title: string;
  description: string | null;
  status: SopTemplateRecord["status"];
  created_by_user_id: UUID;
  updated_by_user_id: UUID | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SopTemplateItemRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  template_id: UUID;
  item_index: number;
  title: string;
  instructions: string | null;
  evidence_required: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SopScheduleRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  template_id: UUID;
  title: string;
  status: SopScheduleRecord["status"];
  recurrence_type: SopScheduleRecord["recurrenceType"];
  interval_days: number | null;
  day_of_week: number | null;
  day_of_month: number | null;
  due_time: string;
  timezone: string;
  starts_on: Date | string;
  ends_on: Date | string | null;
  assigned_to_user_id: UUID | null;
  default_task_priority: SopScheduleRecord["defaultTaskPriority"];
  created_by_user_id: UUID;
  updated_by_user_id: UUID | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SopRunRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  template_id: UUID;
  schedule_id: UUID;
  task_id: UUID | null;
  due_at: Date | string;
  status: SopRunStatus;
  assigned_to_user_id: UUID | null;
  started_by_user_id: UUID | null;
  started_at: Date | string | null;
  completed_by_user_id: UUID | null;
  completed_at: Date | string | null;
  completion_evidence: Record<string, unknown>;
  generated_from_key: string;
  created_at: Date | string;
  updated_at: Date | string;
}

interface SopRunItemRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  sop_run_id: UUID;
  template_item_id: UUID | null;
  item_index: number;
  title: string;
  instructions: string | null;
  evidence_required: boolean;
  status: SopRunItemStatus;
  evidence: Record<string, unknown>;
  completed_by_user_id: UUID | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface AttributionTouchRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID | null;
  lead_id: UUID | null;
  appointment_id: UUID | null;
  invoice_id: UUID | null;
  source: AttributionTouchRecord["source"];
  medium: string | null;
  campaign: string | null;
  external_ref: string | null;
  touch_type: AttributionTouchRecord["touchType"];
  occurred_at: Date | string;
  metadata: Record<string, unknown>;
}

interface IntakeFormTemplateRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  code: string;
  display_name: string;
  form_type: IntakeFormTemplateRecord["formType"];
  version: number;
  schema: Record<string, unknown>;
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface IntakeFormSubmissionRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  template_id: UUID;
  template_version: number;
  source: IntakeFormSubmissionRecord["source"];
  responses: Record<string, unknown>;
  medical_history_snapshot: Record<string, unknown>;
  provenance: Record<string, unknown>;
  submitted_by_user_id: UUID;
  submitted_at: Date | string;
}

interface ConsentRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  purpose: ConsentRecord["purpose"];
  status: ConsentRecord["status"];
  template_code: string;
  template_version: number;
  capture_method: ConsentRecord["captureMethod"];
  granted_by_name: string | null;
  relationship_to_patient: string | null;
  evidence: Record<string, unknown>;
  provenance: Record<string, unknown>;
  created_by_user_id: UUID;
  created_at: Date | string;
  revoked_by_user_id: UUID | null;
  revoked_at: Date | string | null;
  revocation_reason: string | null;
}

interface EncounterRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  appointment_id: UUID | null;
  provider_user_id: UUID;
  status: EncounterRecord["status"];
  reason: string | null;
  medical_history_snapshot: Record<string, unknown>;
  started_at: Date | string | null;
  closed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ClinicalNoteVersionRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  encounter_id: UUID;
  patient_id: UUID;
  version_number: number;
  status: ClinicalNoteVersionRecord["status"];
  content: ClinicalNoteVersionRecord["content"];
  amendment_reason: string | null;
  amended_from_version_id: UUID | null;
  signed_by_user_id: UUID | null;
  signed_at: Date | string | null;
  created_by_user_id: UUID;
  created_at: Date | string;
}

interface PrescriptionRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  encounter_id: UUID;
  patient_id: UUID;
  status: PrescriptionRecord["status"];
  medications: PrescriptionRecord["medications"];
  notes: string | null;
  created_by_user_id: UUID;
  created_at: Date | string;
  signed_by_user_id: UUID | null;
  signed_at: Date | string | null;
}

interface PatientInstructionRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  channel: PatientInstructionRecord["channel"];
  template_id: string;
  title: string;
  body: string;
  status: PatientInstructionRecord["status"];
  rendered_at: Date | string;
  print_job_id: string | null;
  outbox_event_id: UUID | null;
  provider_confirmation_received: boolean;
  provider_delivery_confirmed_at: Date | string | null;
  delivered_at: Date | string | null;
  read_at: Date | string | null;
  created_by_user_id: UUID;
  created_at: Date | string;
}

interface AiSessionRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  encounter_id: UUID;
  status: AiSessionRecord["status"];
  provider_mode: AiSessionRecord["providerMode"];
  llm_provider_key: string;
  transcription_provider_key: string;
  consent_snapshot: AiSessionRecord["consentSnapshot"];
  retention_policy: AiSessionRecord["retentionPolicy"];
  language_hint: string | null;
  started_by_user_id: UUID;
  started_at: Date | string;
  ended_at: Date | string | null;
  raw_audio_deleted_at: Date | string | null;
  transcript_deleted_at: Date | string | null;
  metadata: Record<string, unknown>;
}

interface AiTranscriptSegmentRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  session_id: UUID;
  patient_id: UUID;
  encounter_id: UUID;
  sequence: number;
  speaker_role: AiTranscriptSegmentRecord["speakerRole"];
  text: string;
  starts_at_ms: number;
  ends_at_ms: number;
  source_hash: string;
  created_by_user_id: UUID;
  created_at: Date | string;
}

interface AiSourceAnchorRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  session_id: UUID;
  patient_id: UUID;
  encounter_id: UUID;
  anchor_type: AiSourceAnchorRecord["anchorType"];
  source_record_type: string;
  source_record_id: UUID | string;
  transcript_segment_id: UUID | null;
  starts_at_ms: number | null;
  ends_at_ms: number | null;
  text_quote_digest: string | null;
  supported: boolean;
  unsupported_reason: string | null;
  created_at: Date | string;
}

interface AiJobRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  session_id: UUID;
  patient_id: UUID;
  encounter_id: UUID;
  job_type: AiJobRecord["jobType"];
  status: AiJobRecord["status"];
  provider_mode: AiJobRecord["providerMode"];
  provider_key: string;
  input_digest: string;
  output_summary: Record<string, unknown>;
  error_code: string | null;
  error_message: string | null;
  created_by_user_id: UUID;
  created_at: Date | string;
  completed_at: Date | string | null;
}

interface AiDraftOutputRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  session_id: UUID;
  job_id: UUID | null;
  patient_id: UUID;
  encounter_id: UUID;
  output_type: AiDraftOutputRecord["outputType"];
  review_status: AiDraftOutputRecord["reviewStatus"];
  content: AiDraftOutputRecord["content"];
  confidence: number | string;
  warnings: string[];
  source_anchor_ids: UUID[];
  unsupported_source_anchor_ids: UUID[];
  schema_version: string;
  provider_mode: AiDraftOutputRecord["providerMode"];
  provider_request_digest: string;
  created_by_user_id: UUID;
  created_at: Date | string;
  reviewed_by_user_id: UUID | null;
  reviewed_at: Date | string | null;
}

interface AiActionProposalRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  session_id: UUID;
  output_id: UUID | null;
  patient_id: UUID;
  encounter_id: UUID;
  proposal_type: AiActionProposalRecord["proposalType"];
  review_status: AiActionProposalRecord["reviewStatus"];
  title: string;
  description: string;
  proposed_payload: Record<string, unknown>;
  required_permission: string;
  source_anchor_ids: UUID[];
  unsupported_source_anchor_ids: UUID[];
  provider_mode: AiActionProposalRecord["providerMode"];
  created_by_user_id: UUID;
  created_at: Date | string;
  reviewed_by_user_id: UUID | null;
  reviewed_at: Date | string | null;
}

interface AiReviewDecisionRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  session_id: UUID;
  target_type: AiReviewDecisionRecord["targetType"];
  target_id: UUID;
  decision: AiReviewDecisionRecord["decision"];
  reason: string;
  edited_content: Record<string, unknown> | null;
  applied_workflow: AiReviewDecisionRecord["appliedWorkflow"];
  applied_record_id: null;
  reviewed_by_user_id: UUID;
  reviewed_at: Date | string;
}

interface MediaUploadReservationRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  encounter_id: UUID | null;
  tooth_number: string | null;
  dental_finding_id: UUID | null;
  media_type: MediaUploadReservationRecord["mediaType"];
  original_filename: string;
  mime_type: string;
  expected_file_size_bytes: number | string;
  expected_sha256_digest: string | null;
  object_key: string;
  storage_provider: MediaStorageProviderKey;
  storage_region: string | null;
  status: MediaUploadReservationRecord["status"];
  expires_at: Date | string;
  created_by_user_id: UUID;
  created_at: Date | string;
  completed_at: Date | string | null;
  media_asset_id: UUID | null;
  tags: unknown;
  provenance: Record<string, unknown>;
}

interface MediaAssetRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  encounter_id: UUID | null;
  tooth_number: string | null;
  dental_finding_id: UUID | null;
  media_type: MediaAssetRecord["mediaType"];
  original_filename: string;
  mime_type: string;
  file_size_bytes: number | string;
  sha256_digest: string | null;
  object_key: string;
  object_version: string | null;
  storage_provider: MediaStorageProviderKey;
  storage_region: string | null;
  status: MediaAssetRecord["status"];
  scan_status: MediaScanStatus;
  quarantine_reason: string | null;
  tags: unknown;
  provenance: Record<string, unknown>;
  dicom_metadata: Record<string, unknown>;
  created_by_user_id: UUID;
  uploaded_by_user_id: UUID;
  created_at: Date | string;
  uploaded_at: Date | string;
  updated_at: Date | string;
}

interface DentalChartRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  numbering_system: DentalChartRecord["numberingSystem"];
  created_by_user_id: UUID;
  updated_by_user_id: UUID | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DentalFindingRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  encounter_id: UUID | null;
  tooth_number: DentalFindingRecord["toothNumber"];
  numbering_system: DentalFindingRecord["numberingSystem"];
  surface: DentalFindingRecord["surface"];
  finding_type: DentalFindingRecord["findingType"];
  severity: string | null;
  status: DentalFindingRecord["status"];
  review_status: DentalFindingRecord["reviewStatus"];
  source: DentalFindingRecord["source"];
  confidence: number | string | null;
  notes: string | null;
  provenance: DentalFindingRecord["provenance"];
  treatment_reference: DentalFindingRecord["treatmentReference"];
  created_by_user_id: UUID;
  updated_by_user_id: UUID | null;
  reviewed_by_user_id: UUID | null;
  reviewed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface DentalFindingHistoryRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  finding_id: UUID;
  patient_id: UUID;
  encounter_id: UUID | null;
  change_type: DentalFindingHistoryRecord["changeType"];
  changed_by_user_id: UUID;
  changed_at: Date | string;
  reason: string | null;
  before_state: DentalFindingHistoryRecord["beforeState"];
  after_state: DentalFindingHistoryRecord["afterState"];
  provenance: Record<string, unknown>;
}

interface DentalChartSnapshotRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  encounter_id: UUID | null;
  snapshot_version: number;
  chart_state: DentalChartSnapshotRecord["chartState"];
  reason: string | null;
  provenance: Record<string, unknown>;
  created_by_user_id: UUID;
  created_at: Date | string;
}

interface PricebookProcedureRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  code: string;
  display_name: string;
  category: string;
  description: string | null;
  default_unit_price_minor: number | string;
  currency: PricebookProcedureRecord["currency"];
  tax_rate_basis_points: number;
  status: PricebookProcedureRecord["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface TreatmentPlanRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  encounter_id: UUID | null;
  title: string;
  status: TreatmentPlanRecord["status"];
  currency: TreatmentPlanRecord["currency"];
  subtotal_minor: number | string;
  discount_minor: number | string;
  tax_minor: number | string;
  total_minor: number | string;
  clinical_summary: string | null;
  presented_at: Date | string | null;
  accepted_at: Date | string | null;
  accepted_by_user_id: UUID | null;
  accepted_by_name: string | null;
  acceptance_evidence: Record<string, unknown>;
  created_by_user_id: UUID;
  updated_by_user_id: UUID | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TreatmentPlanPhaseRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  treatment_plan_id: UUID;
  phase_index: number;
  title: string;
  description: string | null;
  estimated_start_after_days: number | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface TreatmentPlanEstimateItemRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  treatment_plan_id: UUID;
  phase_id: UUID;
  pricebook_procedure_id: UUID;
  dental_finding_id: UUID | null;
  tooth_number: TreatmentPlanEstimateItemRecord["toothNumber"];
  quantity: number;
  unit_price_minor: number | string;
  discount_minor: number | string;
  tax_rate_basis_points: number;
  tax_minor: number | string;
  total_minor: number | string;
  estimated_visits: number;
  priority: string | null;
  notes: string | null;
  status: TreatmentPlanEstimateItemRecord["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProcedurePerformedRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  encounter_id: UUID;
  treatment_plan_id: UUID;
  treatment_plan_estimate_item_id: UUID;
  pricebook_procedure_id: UUID;
  dental_finding_id: UUID | null;
  invoice_id: UUID | null;
  tooth_number: ProcedurePerformedRecord["toothNumber"];
  quantity: number;
  unit_price_minor: number | string;
  discount_minor: number | string;
  tax_rate_basis_points: number;
  tax_minor: number | string;
  total_minor: number | string;
  status: ProcedurePerformedRecord["status"];
  performed_by_user_id: UUID;
  performed_at: Date | string;
  notes: string | null;
  outcome: string | null;
  provenance: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ProcedureRecallSourceRow extends ProcedurePerformedRow {
  procedure_category: string;
}

interface InvoiceRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID;
  invoice_number: string;
  status: InvoiceRecord["status"];
  payment_status: InvoiceRecord["paymentStatus"];
  currency: InvoiceRecord["currency"];
  subtotal_minor: number | string;
  discount_minor: number | string;
  tax_minor: number | string;
  total_minor: number | string;
  paid_minor: number | string;
  refunded_minor: number | string;
  balance_minor: number | string;
  treatment_plan_id: UUID | null;
  issued_at: Date | string;
  due_at: Date | string | null;
  created_by_user_id: UUID;
  updated_by_user_id: UUID | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface InvoiceItemRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  invoice_id: UUID;
  patient_id: UUID;
  procedure_performed_id: UUID;
  treatment_plan_estimate_item_id: UUID;
  pricebook_procedure_id: UUID;
  description: string;
  quantity: number;
  unit_price_minor: number | string;
  discount_minor: number | string;
  tax_rate_basis_points: number;
  tax_minor: number | string;
  total_minor: number | string;
  created_at: Date | string;
}

interface PaymentRequestRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  invoice_id: UUID;
  patient_id: UUID;
  provider: PaymentRequestRecord["provider"];
  request_type: PaymentRequestRecord["requestType"];
  status: PaymentRequestRecord["status"];
  amount_minor: number | string;
  currency: PaymentRequestRecord["currency"];
  provider_reference_id: string | null;
  provider_url: string | null;
  provider_qr_payload: string | null;
  expires_at: Date | string | null;
  metadata: Record<string, unknown>;
  created_by_user_id: UUID;
  created_at: Date | string;
  updated_at: Date | string;
}

interface PaymentTransactionRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  invoice_id: UUID;
  patient_id: UUID;
  payment_request_id: UUID | null;
  provider: PaymentTransactionRecord["provider"];
  provider_payment_id: string | null;
  provider_order_id: string | null;
  amount_minor: number | string;
  currency: PaymentTransactionRecord["currency"];
  method: string;
  status: PaymentTransactionRecord["status"];
  verification_status: PaymentTransactionRecord["verificationStatus"];
  reconciliation_status: PaymentTransactionRecord["reconciliationStatus"];
  idempotency_key: string | null;
  received_at: Date | string;
  recorded_by_user_id: UUID | null;
  receipt_id: UUID | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
}

interface ReceiptRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  invoice_id: UUID;
  patient_id: UUID;
  receipt_number: string;
  status: ReceiptRecord["status"];
  amount_minor: number | string;
  currency: ReceiptRecord["currency"];
  payment_allocations: ReceiptRecord["paymentAllocations"];
  generated_by_user_id: UUID;
  generated_at: Date | string;
  voided_by_user_id: UUID | null;
  voided_at: Date | string | null;
  void_reason: string | null;
}

interface LabVendorRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  display_name: string;
  phone: string | null;
  email: string | null;
  address: Record<string, unknown>;
  tax_registration_number: string | null;
  payment_terms_days: number | null;
  status: LabVendorRecord["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface LabCaseRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  vendor_id: UUID;
  patient_id: UUID;
  encounter_id: UUID | null;
  treatment_plan_id: UUID | null;
  treatment_plan_estimate_item_id: UUID | null;
  procedure_performed_id: UUID | null;
  title: string;
  status: LabCaseRecord["status"];
  priority: LabCaseRecord["priority"];
  due_at: Date | string;
  clinical_notes: string | null;
  internal_notes: string | null;
  slip_number: string;
  slip_version: number;
  slip_generated_at: Date | string;
  slip_generated_by_user_id: UUID;
  slip_metadata: Record<string, unknown>;
  expected_cost_minor: number | string | null;
  currency: LabCaseRecord["currency"];
  sent_at: Date | string | null;
  received_at: Date | string | null;
  completed_at: Date | string | null;
  cancelled_at: Date | string | null;
  cancellation_reason: string | null;
  created_by_user_id: UUID;
  updated_by_user_id: UUID | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface LabCaseItemRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  lab_case_id: UUID;
  item_type: string;
  tooth_number: LabCaseItemRecord["toothNumber"];
  material: string | null;
  shade: string | null;
  quantity: number;
  notes: string | null;
  created_at: Date | string;
}

interface LabCaseStatusHistoryRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  lab_case_id: UUID;
  patient_id: UUID;
  from_status: LabCaseStatusHistoryRecord["fromStatus"];
  to_status: LabCaseStatusHistoryRecord["toStatus"];
  reason: string | null;
  evidence: Record<string, unknown>;
  changed_by_user_id: UUID;
  changed_at: Date | string;
}

interface LabReconciliationRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  vendor_id: UUID;
  period_start: Date | string;
  period_end: Date | string;
  status: LabReconciliationRecord["status"];
  invoice_reference: string | null;
  invoice_amount_minor: number | string | null;
  expected_amount_minor: number | string;
  variance_amount_minor: number | string;
  currency: LabReconciliationRecord["currency"];
  evidence: Record<string, unknown>;
  created_by_user_id: UUID;
  approved_by_user_id: UUID | null;
  approved_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface LabReconciliationEntryRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  reconciliation_id: UUID;
  lab_case_id: UUID;
  patient_id: UUID;
  status: LabReconciliationEntryRecord["status"];
  expected_amount_minor: number | string;
  invoice_amount_minor: number | string | null;
  variance_amount_minor: number | string;
  notes: string | null;
  created_at: Date | string;
}

interface InventoryCategoryRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  code: string;
  display_name: string;
  kind: InventoryCategoryRecord["kind"];
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface InventoryItemRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  category_id: UUID;
  sku: string;
  display_name: string;
  unit_of_measure: string;
  storage_location: string;
  track_quantity: boolean;
  minimum_quantity: number | string;
  reorder_quantity: number | string;
  current_quantity: number | string;
  status: InventoryItemRecord["status"];
  created_at: Date | string;
  updated_at: Date | string;
}

interface StockLedgerEntryRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  item_id: UUID;
  movement_type: StockLedgerEntryRecord["movementType"];
  quantity_delta: number | string;
  quantity_after: number | string;
  unit_cost_minor: number | string | null;
  currency: StockLedgerEntryRecord["currency"];
  source_table: string | null;
  source_id: UUID | null;
  reason: string;
  evidence: Record<string, unknown>;
  recorded_by_user_id: UUID;
  recorded_at: Date | string;
}

interface InventoryCheckTemplateRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  code: string;
  display_name: string;
  cadence: InventoryCheckTemplateRecord["cadence"];
  active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
}

interface InventoryCheckTemplateLineRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  template_id: UUID;
  item_id: UUID;
  sequence: number;
  drawer_location: string;
  expected_quantity: number | string | null;
  required: boolean;
  instructions: string | null;
}

interface InventoryCheckRunRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  template_id: UUID;
  status: InventoryCheckRunRecord["status"];
  started_by_user_id: UUID;
  completed_by_user_id: UUID | null;
  started_at: Date | string;
  completed_at: Date | string | null;
  notes: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface InventoryCheckRunLineRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  check_run_id: UUID;
  template_line_id: UUID;
  item_id: UUID;
  sequence: number;
  drawer_location: string;
  expected_quantity: number | string;
  counted_quantity: number | string | null;
  variance_quantity: number | string | null;
  exception_type: InventoryCheckRunLineRecord["exceptionType"];
  exception_notes: string | null;
  counted_by_user_id: UUID | null;
  counted_at: Date | string | null;
}

interface ProcurementSuggestionRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  item_id: UUID;
  source_check_run_id: UUID | null;
  source_check_run_line_id: UUID | null;
  status: ProcurementSuggestionRecord["status"];
  suggested_quantity: number | string;
  reason: string;
  task_id: UUID | null;
  evidence: Record<string, unknown>;
  created_by_user_id: UUID;
  created_at: Date | string;
  updated_at: Date | string;
}

interface IncidentRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  patient_id: UUID | null;
  appointment_id: UUID | null;
  lab_case_id: UUID | null;
  inventory_item_id: UUID | null;
  category: IncidentRecord["category"];
  severity: IncidentRecord["severity"];
  status: IncidentRecord["status"];
  occurred_at: Date | string;
  location: string | null;
  summary: string;
  description: string;
  impact: string | null;
  learning: string | null;
  immediate_action: string | null;
  evidence: Record<string, unknown>;
  reported_by_user_id: UUID;
  owner_user_id: UUID | null;
  resolved_at: Date | string | null;
  closed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface CorrectiveActionRow {
  id: UUID;
  tenant_id: UUID;
  clinic_id: UUID;
  incident_id: UUID | null;
  action_type: CorrectiveActionRecord["actionType"];
  title: string;
  description: string;
  status: CorrectiveActionRecord["status"];
  owner_user_id: UUID;
  due_at: Date | string;
  completed_at: Date | string | null;
  completed_by_user_id: UUID | null;
  completion_evidence: Record<string, unknown>;
  verification_evidence: Record<string, unknown>;
  created_by_user_id: UUID;
  updated_by_user_id: UUID | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function mapPatientRow(row: PatientRow): PatientRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    dateOfBirth: row.date_of_birth ? isoDateOnly(row.date_of_birth) : null,
    gender: row.gender,
    abhaAddress: row.abha_address,
    source: row.source,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapTimelineRow(row: PatientTimelineRow): PatientTimelineItem {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    itemType: row.item_type,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    occurredAt: toIso(row.occurred_at),
    title: row.title,
    summary: row.summary,
    metadata: row.metadata
  };
}

function mapAuditEventForReviewRow(row: AuditEventReviewJoinedRow): AuditEventForReviewRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    action: row.action,
    category: row.category,
    riskLevel: row.risk_level,
    phiInvolved: row.phi_involved,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    patientId: row.patient_id,
    metadata: row.metadata,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    correlationId: row.correlation_id,
    occurredAt: toIso(row.occurred_at),
    review: row.review_id
      ? {
          id: row.review_id,
          tenantId: row.tenant_id,
          clinicId:
            row.review_clinic_id ??
            row.clinic_id ??
            ("00000000-0000-4000-8000-000000000000" as UUID),
          auditEventId: row.id,
          reviewStatus: row.review_status ?? "reviewed",
          disposition: row.disposition ?? "",
          notes: row.review_notes,
          reviewedByUserId:
            row.reviewed_by_user_id ?? ("00000000-0000-4000-8000-000000000000" as UUID),
          reviewedAt: row.reviewed_at ? toIso(row.reviewed_at) : toIso(row.occurred_at),
          createdAt: row.review_created_at ? toIso(row.review_created_at) : toIso(row.occurred_at)
        }
      : null
  };
}

function mapAuditReviewRow(row: AuditReviewRow): AuditReviewRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    auditEventId: row.audit_event_id,
    reviewStatus: row.review_status,
    disposition: row.disposition,
    notes: row.notes,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: toIso(row.reviewed_at),
    createdAt: toIso(row.created_at)
  };
}

function mapPatientRecordExportRow(row: PatientRecordExportRow): PatientRecordExportRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    status: row.status,
    format: row.format,
    sections: row.sections,
    requestedByUserId: row.requested_by_user_id,
    completedByUserId: row.completed_by_user_id,
    requestedAt: toIso(row.requested_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    manifest: row.manifest,
    payload: row.export_payload,
    payloadDigest: row.payload_digest,
    failureReason: row.failure_reason,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapDeletionRequestRow(row: DeletionRequestRow): DeletionRequestRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    requestType: row.request_type,
    status: row.status,
    reason: row.reason,
    requestedByUserId: row.requested_by_user_id,
    requestedAt: toIso(row.requested_at),
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? toIso(row.reviewed_at) : null,
    reviewReason: row.review_reason,
    scope: row.scope,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapRetentionRunRow(row: RetentionRunRow): RetentionRunRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    mode: row.mode,
    status: row.status,
    policyCode: row.policy_code,
    asOf: toIso(row.as_of),
    deletionRequestId: row.deletion_request_id,
    startedByUserId: row.started_by_user_id,
    startedAt: toIso(row.started_at),
    completedAt: toIso(row.completed_at),
    summary: row.summary,
    createdAt: toIso(row.created_at)
  };
}

function mapRetentionActionRow(row: RetentionActionRow): RetentionActionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    runId: row.run_id,
    patientId: row.patient_id,
    actionKind: row.action_kind,
    status: row.status,
    targetType: row.target_type,
    targetId: row.target_id,
    protectedRecord: row.protected_record,
    evidence: row.evidence,
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    createdAt: toIso(row.created_at)
  };
}

function mapBreakGlassAccessRow(row: BreakGlassAccessRow): BreakGlassAccessRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    requestedByUserId: row.user_id,
    patientId: row.patient_id,
    reason: row.reason,
    status: row.status,
    accessCategories: row.access_categories,
    accessScope: row.access_scope,
    requestedAt: toIso(row.requested_at),
    expiresAt: toIso(row.expires_at),
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? toIso(row.reviewed_at) : null,
    reviewReason: row.review_reason,
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapMigrationBatchRow(row: MigrationBatchRow): MigrationBatchRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    importType: row.import_type,
    sourceSystem: row.source_system,
    sourceFileName: row.source_file_name,
    sourceChecksum: row.source_checksum,
    state: row.state,
    uploadedByUserId: row.uploaded_by_user_id,
    committedByUserId: row.committed_by_user_id,
    rolledBackByUserId: row.rolled_back_by_user_id,
    rowCount: Number(row.row_count),
    validRowCount: Number(row.valid_row_count),
    invalidRowCount: Number(row.invalid_row_count),
    conflictRowCount: Number(row.conflict_row_count),
    readyRowCount: Number(row.ready_row_count),
    committedRowCount: Number(row.committed_row_count),
    rolledBackRowCount: Number(row.rolled_back_row_count),
    failedRowCount: Number(row.failed_row_count),
    committedAt: row.committed_at ? toIso(row.committed_at) : null,
    rolledBackAt: row.rolled_back_at ? toIso(row.rolled_back_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapMigrationRowRow(
  row: MigrationRowRow,
  conflicts: MigrationConflictRecord[]
): MigrationRowRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    batchId: row.batch_id,
    rowNumber: row.row_number,
    importType: row.import_type,
    externalRecordId: row.external_record_id,
    rawPayloadDigest: row.raw_payload_digest,
    rawPayloadRef: {
      rowId: row.id,
      digest: row.raw_payload_digest,
      retained: true
    },
    normalizedRecord: row.normalized_record,
    validationErrors: row.validation_errors ?? [],
    status: row.status,
    matchStatus: row.match_status,
    resolutionAction: row.resolution_action,
    resolutionTargetRecordType: row.resolution_target_record_type,
    resolutionTargetRecordId: row.resolution_target_record_id,
    resolutionNote: row.resolution_note,
    committedRecordType: row.committed_record_type,
    committedRecordId: row.committed_record_id,
    errorMessage: row.error_message,
    conflicts,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapMigrationConflictRow(row: MigrationConflictRow): MigrationConflictRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    batchId: row.batch_id,
    rowId: row.row_id,
    conflictType: row.conflict_type,
    severity: row.severity,
    targetRecordType: row.target_record_type,
    targetRecordId: row.target_record_id,
    fieldName: row.field_name,
    summary: row.summary,
    evidence: row.evidence ?? {},
    status: row.status,
    resolutionAction: row.resolution_action,
    resolvedByUserId: row.resolved_by_user_id,
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapIntegrationDeadLetterRow(row: IntegrationDeadLetterRow): IntegrationDeadLetterRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    rawEventId: row.raw_event_id,
    normalizedEventId: row.normalized_event_id,
    providerKey: row.provider_key,
    failureStage: row.failure_stage,
    failureCode: row.failure_code,
    failureSummary: row.failure_summary,
    retryCount: Number(row.retry_count),
    nextRetryAt: row.next_retry_at ? toIso(row.next_retry_at) : null,
    status: row.status,
    lastErrorDigest: row.last_error_digest,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapMigrationCommitRow(row: MigrationCommitRow): MigrationCommitRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    batchId: row.batch_id,
    action: row.action,
    status: row.status,
    idempotencyKey: row.idempotency_key,
    requestedByUserId: row.requested_by_user_id,
    summary: row.summary ?? {},
    errorSummary: row.error_summary,
    startedAt: toIso(row.started_at),
    finishedAt: row.finished_at ? toIso(row.finished_at) : null
  };
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mapImportedRecordLinkRow(row: ImportedRecordLinkRow): ImportedRecordLinkRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    batchId: row.batch_id,
    rowId: row.row_id,
    importType: row.import_type,
    sourceSystem: row.source_system,
    externalRecordId: row.external_record_id,
    targetRecordType: row.target_record_type,
    targetRecordId: row.target_record_id,
    linkType: row.link_type,
    verificationStatus: row.verification_status,
    verifiedByUserId: row.verified_by_user_id,
    verifiedAt: row.verified_at ? toIso(row.verified_at) : null,
    metadata: row.metadata ?? {},
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapLeadRow(row: LeadRow): LeadRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    primaryContact: row.primary_contact,
    status: row.status,
    intent: row.intent,
    source: row.source,
    sourceDetail: row.source_detail,
    firstSeenAt: toIso(row.first_seen_at),
    lastActivityAt: toIso(row.last_activity_at),
    createdByUserId: row.created_by_user_id
  };
}

function mapAppointmentTypeRow(row: AppointmentTypeRow): AppointmentTypeRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    code: row.code,
    displayName: row.display_name,
    defaultDurationMinutes: row.default_duration_minutes,
    color: row.color,
    active: row.active
  };
}

function mapChairRow(row: ChairRow): ChairOrRoomRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    code: row.code,
    displayName: row.display_name,
    active: row.active
  };
}

function mapProviderScheduleRow(row: ProviderScheduleRow): ProviderScheduleRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    providerUserId: row.provider_user_id,
    dayOfWeek: row.day_of_week,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    effectiveFrom: isoDateOnly(row.effective_from),
    effectiveUntil: row.effective_until ? isoDateOnly(row.effective_until) : null,
    active: row.active
  };
}

function mapAppointmentRow(row: AppointmentRow): AppointmentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    leadId: row.lead_id,
    providerUserId: row.provider_user_id,
    appointmentTypeId: row.appointment_type_id,
    chairId: row.chair_id,
    status: row.status,
    startAt: toIso(row.start_at),
    endAt: toIso(row.end_at),
    source: row.source,
    reason: row.reason,
    notes: row.notes,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapQueueEntryRow(row: QueueEntryRow): QueueEntryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    appointmentId: row.appointment_id,
    patientId: row.patient_id,
    providerUserId: row.provider_user_id,
    status: row.status,
    position: row.position,
    checkedInAt: toIso(row.checked_in_at),
    calledAt: row.called_at ? toIso(row.called_at) : null,
    completedAt: row.completed_at ? toIso(row.completed_at) : null
  };
}

function mapTaskRow(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    leadId: row.lead_id,
    appointmentId: row.appointment_id,
    invoiceId: row.invoice_id ?? null,
    encounterId: row.encounter_id ?? null,
    treatmentPlanId: row.treatment_plan_id ?? null,
    procedurePerformedId: row.procedure_performed_id ?? null,
    taskType: row.task_type,
    sourceWorkflow: row.source_workflow ?? "manual",
    sourceRecordType: row.source_record_type ?? null,
    sourceRecordId: row.source_record_id ?? null,
    title: row.title,
    description: row.description ?? null,
    priority: row.priority ?? "normal",
    status: row.status,
    dueAt: row.due_at ? toIso(row.due_at) : null,
    assignedToUserId: row.assigned_to_user_id,
    assignedByUserId: row.assigned_by_user_id ?? null,
    completedByUserId: row.completed_by_user_id ?? null,
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    completionEvidence: row.completion_evidence ?? {},
    cancelledReason: row.cancelled_reason ?? null,
    idempotencyKey: row.idempotency_key ?? null,
    createdByUserId: row.created_by_user_id ?? null,
    updatedByUserId: row.updated_by_user_id ?? null,
    statusChangedAt: row.status_changed_at ? toIso(row.status_changed_at) : toIso(row.updated_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapRecallRuleRow(row: RecallRuleRow): RecallRuleRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    code: row.code,
    title: row.title,
    status: row.status,
    anchor: row.anchor,
    offsetDays: row.offset_days,
    procedureCategory: row.procedure_category,
    pricebookProcedureId: row.pricebook_procedure_id,
    defaultTaskTitle: row.default_task_title,
    defaultTaskPriority: row.default_task_priority,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapRecallRow(row: RecallRow): RecallRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    recallRuleId: row.recall_rule_id,
    patientId: row.patient_id,
    sourceProcedurePerformedId: row.source_procedure_performed_id,
    sourceInvoiceId: row.source_invoice_id,
    taskId: row.task_id,
    appointmentId: row.appointment_id,
    status: row.status,
    dueAt: toIso(row.due_at),
    lastActionAt: row.last_action_at ? toIso(row.last_action_at) : null,
    actionEvidence: row.action_evidence ?? {},
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapSopTemplateRow(row: SopTemplateRow): SopTemplateRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    code: row.code,
    title: row.title,
    description: row.description,
    status: row.status,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapSopTemplateItemRow(row: SopTemplateItemRow): SopTemplateItemRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    templateId: row.template_id,
    itemIndex: row.item_index,
    title: row.title,
    instructions: row.instructions,
    evidenceRequired: row.evidence_required,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapSopScheduleRow(row: SopScheduleRow): SopScheduleRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    templateId: row.template_id,
    title: row.title,
    status: row.status,
    recurrenceType: row.recurrence_type,
    intervalDays: row.interval_days,
    dayOfWeek: row.day_of_week,
    dayOfMonth: row.day_of_month,
    dueTime: row.due_time,
    timezone: row.timezone,
    startsOn: isoDateOnly(row.starts_on),
    endsOn: row.ends_on ? isoDateOnly(row.ends_on) : null,
    assignedToUserId: row.assigned_to_user_id,
    defaultTaskPriority: row.default_task_priority,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapSopRunRow(row: SopRunRow): SopRunRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    templateId: row.template_id,
    scheduleId: row.schedule_id,
    taskId: row.task_id,
    dueAt: toIso(row.due_at),
    status: row.status,
    assignedToUserId: row.assigned_to_user_id,
    startedByUserId: row.started_by_user_id,
    startedAt: row.started_at ? toIso(row.started_at) : null,
    completedByUserId: row.completed_by_user_id,
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    completionEvidence: row.completion_evidence ?? {},
    generatedFromKey: row.generated_from_key,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapSopRunItemRow(row: SopRunItemRow): SopRunItemRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    sopRunId: row.sop_run_id,
    templateItemId: row.template_item_id,
    itemIndex: row.item_index,
    title: row.title,
    instructions: row.instructions,
    evidenceRequired: row.evidence_required,
    status: row.status,
    evidence: row.evidence ?? {},
    completedByUserId: row.completed_by_user_id,
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapAttributionTouchRow(row: AttributionTouchRow): AttributionTouchRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    leadId: row.lead_id,
    appointmentId: row.appointment_id,
    invoiceId: row.invoice_id,
    source: row.source,
    medium: row.medium,
    campaign: row.campaign,
    externalRef: row.external_ref,
    touchType: row.touch_type,
    occurredAt: toIso(row.occurred_at),
    metadata: row.metadata
  };
}

function mapIntakeFormTemplateRow(row: IntakeFormTemplateRow): IntakeFormTemplateRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    code: row.code,
    displayName: row.display_name,
    formType: row.form_type,
    version: row.version,
    schema: row.schema,
    active: row.active,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapIntakeFormSubmissionRow(row: IntakeFormSubmissionRow): IntakeFormSubmissionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    templateId: row.template_id,
    templateVersion: row.template_version,
    source: row.source,
    responses: row.responses,
    medicalHistorySnapshot: row.medical_history_snapshot,
    provenance: row.provenance,
    submittedByUserId: row.submitted_by_user_id,
    submittedAt: toIso(row.submitted_at)
  };
}

function mapConsentRow(row: ConsentRow): ConsentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    purpose: row.purpose,
    status: row.status,
    templateCode: row.template_code,
    templateVersion: row.template_version,
    captureMethod: row.capture_method,
    grantedByName: row.granted_by_name,
    relationshipToPatient: row.relationship_to_patient,
    evidence: row.evidence,
    provenance: row.provenance,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at),
    revokedByUserId: row.revoked_by_user_id,
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
    revocationReason: row.revocation_reason
  };
}

function mapEncounterRow(row: EncounterRow): EncounterRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    appointmentId: row.appointment_id,
    providerUserId: row.provider_user_id,
    status: row.status,
    reason: row.reason,
    medicalHistorySnapshot: row.medical_history_snapshot,
    startedAt: row.started_at ? toIso(row.started_at) : null,
    closedAt: row.closed_at ? toIso(row.closed_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapClinicalNoteVersionRow(row: ClinicalNoteVersionRow): ClinicalNoteVersionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    encounterId: row.encounter_id,
    patientId: row.patient_id,
    versionNumber: row.version_number,
    status: row.status,
    content: row.content,
    amendmentReason: row.amendment_reason,
    amendedFromVersionId: row.amended_from_version_id,
    signedByUserId: row.signed_by_user_id,
    signedAt: row.signed_at ? toIso(row.signed_at) : null,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at)
  };
}

function mapPrescriptionRow(row: PrescriptionRow): PrescriptionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    encounterId: row.encounter_id,
    patientId: row.patient_id,
    status: row.status,
    medications: row.medications,
    notes: row.notes,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at),
    signedByUserId: row.signed_by_user_id,
    signedAt: row.signed_at ? toIso(row.signed_at) : null
  };
}

function mapPatientInstructionRow(row: PatientInstructionRow): PatientInstructionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    channel: row.channel,
    templateId: row.template_id,
    title: row.title,
    body: row.body,
    status: row.status,
    renderedAt: toIso(row.rendered_at),
    printJobId: row.print_job_id,
    outboxEventId: row.outbox_event_id,
    providerConfirmationReceived: row.provider_confirmation_received,
    providerDeliveryConfirmedAt: row.provider_delivery_confirmed_at
      ? toIso(row.provider_delivery_confirmed_at)
      : null,
    deliveredAt: row.delivered_at ? toIso(row.delivered_at) : null,
    readAt: row.read_at ? toIso(row.read_at) : null,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at)
  };
}

function mapAiSessionRow(row: AiSessionRow): AiSessionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    status: row.status,
    providerMode: row.provider_mode,
    llmProviderKey: row.llm_provider_key,
    transcriptionProviderKey: row.transcription_provider_key,
    consentSnapshot: row.consent_snapshot,
    retentionPolicy: row.retention_policy,
    languageHint: row.language_hint,
    startedByUserId: row.started_by_user_id,
    startedAt: toIso(row.started_at),
    endedAt: row.ended_at ? toIso(row.ended_at) : null,
    rawAudioDeletedAt: row.raw_audio_deleted_at ? toIso(row.raw_audio_deleted_at) : null,
    transcriptDeletedAt: row.transcript_deleted_at ? toIso(row.transcript_deleted_at) : null,
    metadata: row.metadata ?? {}
  };
}

function mapAiTranscriptSegmentRow(row: AiTranscriptSegmentRow): AiTranscriptSegmentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    sessionId: row.session_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    sequence: row.sequence,
    speakerRole: row.speaker_role,
    text: row.text,
    startsAtMs: row.starts_at_ms,
    endsAtMs: row.ends_at_ms,
    sourceHash: row.source_hash,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at)
  };
}

function mapAiSourceAnchorRow(row: AiSourceAnchorRow): AiSourceAnchorRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    sessionId: row.session_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    anchorType: row.anchor_type,
    sourceRecordType: row.source_record_type,
    sourceRecordId: row.source_record_id,
    transcriptSegmentId: row.transcript_segment_id,
    startsAtMs: row.starts_at_ms,
    endsAtMs: row.ends_at_ms,
    textQuoteDigest: row.text_quote_digest,
    supported: row.supported,
    unsupportedReason: row.unsupported_reason,
    createdAt: toIso(row.created_at)
  };
}

function mapAiJobRow(row: AiJobRow): AiJobRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    sessionId: row.session_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    jobType: row.job_type,
    status: row.status,
    providerMode: row.provider_mode,
    providerKey: row.provider_key,
    inputDigest: row.input_digest,
    outputSummary: row.output_summary ?? {},
    errorCode: row.error_code,
    errorMessage: row.error_message,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null
  };
}

function mapAiDraftOutputRow(row: AiDraftOutputRow): AiDraftOutputRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    sessionId: row.session_id,
    jobId: row.job_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    outputType: row.output_type,
    reviewStatus: row.review_status,
    content: row.content,
    confidence: Number(row.confidence),
    warnings: row.warnings ?? [],
    sourceAnchorIds: row.source_anchor_ids ?? [],
    unsupportedSourceAnchorIds: row.unsupported_source_anchor_ids ?? [],
    schemaVersion: row.schema_version,
    providerMode: row.provider_mode,
    providerRequestDigest: row.provider_request_digest,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at),
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? toIso(row.reviewed_at) : null
  };
}

function mapAiActionProposalRow(row: AiActionProposalRow): AiActionProposalRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    sessionId: row.session_id,
    outputId: row.output_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    proposalType: row.proposal_type,
    reviewStatus: row.review_status,
    title: row.title,
    description: row.description,
    proposedPayload: row.proposed_payload ?? {},
    requiredPermission: row.required_permission,
    sourceAnchorIds: row.source_anchor_ids ?? [],
    unsupportedSourceAnchorIds: row.unsupported_source_anchor_ids ?? [],
    providerMode: row.provider_mode,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at),
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? toIso(row.reviewed_at) : null
  };
}

function mapAiReviewDecisionRow(row: AiReviewDecisionRow): AiReviewDecisionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    sessionId: row.session_id,
    targetType: row.target_type,
    targetId: row.target_id,
    decision: row.decision,
    reason: row.reason,
    editedContent: row.edited_content,
    appliedWorkflow: row.applied_workflow,
    appliedRecordId: null,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: toIso(row.reviewed_at)
  };
}

function mapMediaUploadReservationRow(
  row: MediaUploadReservationRow
): MediaUploadReservationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    toothNumber: row.tooth_number,
    dentalFindingId: row.dental_finding_id,
    mediaType: row.media_type,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    expectedFileSizeBytes: Number(row.expected_file_size_bytes),
    expectedSha256Digest: row.expected_sha256_digest,
    objectKey: row.object_key,
    storageProvider: row.storage_provider,
    storageRegion: row.storage_region,
    status: row.status,
    expiresAt: toIso(row.expires_at),
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    mediaAssetId: row.media_asset_id,
    tags: stringArray(row.tags),
    provenance: row.provenance ?? {}
  };
}

function mapMediaAssetRow(row: MediaAssetRow): MediaAssetRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    toothNumber: row.tooth_number,
    dentalFindingId: row.dental_finding_id,
    mediaType: row.media_type,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    fileSizeBytes: Number(row.file_size_bytes),
    sha256Digest: row.sha256_digest,
    objectKey: row.object_key,
    objectVersion: row.object_version,
    storageProvider: row.storage_provider,
    storageRegion: row.storage_region,
    status: row.status,
    scanStatus: row.scan_status,
    quarantineReason: row.quarantine_reason,
    tags: stringArray(row.tags),
    provenance: row.provenance ?? {},
    dicomMetadata: row.dicom_metadata ?? {},
    createdByUserId: row.created_by_user_id,
    uploadedByUserId: row.uploaded_by_user_id,
    createdAt: toIso(row.created_at),
    uploadedAt: toIso(row.uploaded_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapDentalChartRow(row: DentalChartRow): DentalChartRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    numberingSystem: row.numbering_system,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function mapDentalFindingRow(row: DentalFindingRow): DentalFindingRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    toothNumber: row.tooth_number,
    numberingSystem: row.numbering_system,
    surface: row.surface,
    findingType: row.finding_type,
    severity: row.severity,
    status: row.status,
    reviewStatus: row.review_status,
    source: row.source,
    confidence: row.confidence === null ? null : Number(row.confidence),
    notes: row.notes,
    provenance: row.provenance,
    treatmentReference: row.treatment_reference,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    reviewedByUserId: row.reviewed_by_user_id,
    reviewedAt: row.reviewed_at ? toIso(row.reviewed_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapDentalFindingHistoryRow(row: DentalFindingHistoryRow): DentalFindingHistoryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    findingId: row.finding_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    changeType: row.change_type,
    changedByUserId: row.changed_by_user_id,
    changedAt: toIso(row.changed_at),
    reason: row.reason,
    beforeState: row.before_state,
    afterState: row.after_state,
    provenance: row.provenance
  };
}

function mapDentalChartSnapshotRow(row: DentalChartSnapshotRow): DentalChartSnapshotRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    snapshotVersion: Number(row.snapshot_version),
    chartState: row.chart_state,
    reason: row.reason,
    provenance: row.provenance,
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at)
  };
}

function mapPricebookProcedureRow(row: PricebookProcedureRow): PricebookProcedureRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    code: row.code,
    displayName: row.display_name,
    category: row.category,
    description: row.description,
    defaultUnitPriceMinor: Number(row.default_unit_price_minor),
    currency: row.currency,
    taxRateBasisPoints: row.tax_rate_basis_points,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapTreatmentPlanRow(row: TreatmentPlanRow): TreatmentPlanRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    title: row.title,
    status: row.status,
    currency: row.currency,
    subtotalMinor: Number(row.subtotal_minor),
    discountMinor: Number(row.discount_minor),
    taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor),
    clinicalSummary: row.clinical_summary,
    presentedAt: row.presented_at ? toIso(row.presented_at) : null,
    acceptedAt: row.accepted_at ? toIso(row.accepted_at) : null,
    acceptedByUserId: row.accepted_by_user_id,
    acceptedByName: row.accepted_by_name,
    acceptanceEvidence: row.acceptance_evidence ?? {},
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapTreatmentPlanPhaseRow(row: TreatmentPlanPhaseRow): TreatmentPlanPhaseRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    treatmentPlanId: row.treatment_plan_id,
    phaseIndex: row.phase_index,
    title: row.title,
    description: row.description,
    estimatedStartAfterDays: row.estimated_start_after_days,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapTreatmentPlanEstimateItemRow(
  row: TreatmentPlanEstimateItemRow
): TreatmentPlanEstimateItemRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    treatmentPlanId: row.treatment_plan_id,
    phaseId: row.phase_id,
    pricebookProcedureId: row.pricebook_procedure_id,
    dentalFindingId: row.dental_finding_id,
    toothNumber: row.tooth_number,
    quantity: row.quantity,
    unitPriceMinor: Number(row.unit_price_minor),
    discountMinor: Number(row.discount_minor),
    taxRateBasisPoints: row.tax_rate_basis_points,
    taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor),
    estimatedVisits: row.estimated_visits,
    priority: row.priority,
    notes: row.notes,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapProcedurePerformedRow(row: ProcedurePerformedRow): ProcedurePerformedRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    treatmentPlanId: row.treatment_plan_id,
    treatmentPlanEstimateItemId: row.treatment_plan_estimate_item_id,
    pricebookProcedureId: row.pricebook_procedure_id,
    dentalFindingId: row.dental_finding_id,
    invoiceId: row.invoice_id,
    toothNumber: row.tooth_number,
    quantity: row.quantity,
    unitPriceMinor: Number(row.unit_price_minor),
    discountMinor: Number(row.discount_minor),
    taxRateBasisPoints: row.tax_rate_basis_points,
    taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor),
    status: row.status,
    performedByUserId: row.performed_by_user_id,
    performedAt: toIso(row.performed_at),
    notes: row.notes,
    outcome: row.outcome,
    provenance: row.provenance ?? {},
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapInvoiceRow(row: InvoiceRow): InvoiceRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    invoiceNumber: row.invoice_number,
    status: row.status,
    paymentStatus: row.payment_status,
    currency: row.currency,
    subtotalMinor: Number(row.subtotal_minor),
    discountMinor: Number(row.discount_minor),
    taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor),
    paidMinor: Number(row.paid_minor),
    refundedMinor: Number(row.refunded_minor),
    balanceMinor: Number(row.balance_minor),
    treatmentPlanId: row.treatment_plan_id,
    issuedAt: toIso(row.issued_at),
    dueAt: row.due_at ? toIso(row.due_at) : null,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapInvoiceItemRow(row: InvoiceItemRow): InvoiceItemRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    invoiceId: row.invoice_id,
    patientId: row.patient_id,
    procedurePerformedId: row.procedure_performed_id,
    treatmentPlanEstimateItemId: row.treatment_plan_estimate_item_id,
    pricebookProcedureId: row.pricebook_procedure_id,
    description: row.description,
    quantity: row.quantity,
    unitPriceMinor: Number(row.unit_price_minor),
    discountMinor: Number(row.discount_minor),
    taxRateBasisPoints: row.tax_rate_basis_points,
    taxMinor: Number(row.tax_minor),
    totalMinor: Number(row.total_minor),
    createdAt: toIso(row.created_at)
  };
}

function mapPaymentRequestRow(row: PaymentRequestRow): PaymentRequestRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    invoiceId: row.invoice_id,
    patientId: row.patient_id,
    provider: row.provider,
    requestType: row.request_type,
    status: row.status,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    providerReferenceId: row.provider_reference_id,
    providerUrl: row.provider_url,
    providerQrPayload: row.provider_qr_payload,
    expiresAt: row.expires_at ? toIso(row.expires_at) : null,
    metadata: row.metadata ?? {},
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapPaymentTransactionRow(row: PaymentTransactionRow): PaymentTransactionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    invoiceId: row.invoice_id,
    patientId: row.patient_id,
    paymentRequestId: row.payment_request_id,
    provider: row.provider,
    providerPaymentId: row.provider_payment_id,
    providerOrderId: row.provider_order_id,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    method: row.method,
    status: row.status,
    verificationStatus: row.verification_status,
    reconciliationStatus: row.reconciliation_status,
    idempotencyKey: row.idempotency_key,
    receivedAt: toIso(row.received_at),
    recordedByUserId: row.recorded_by_user_id,
    receiptId: row.receipt_id,
    metadata: row.metadata ?? {},
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapReceiptRow(row: ReceiptRow): ReceiptRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    invoiceId: row.invoice_id,
    patientId: row.patient_id,
    receiptNumber: row.receipt_number,
    status: row.status,
    amountMinor: Number(row.amount_minor),
    currency: row.currency,
    paymentAllocations: row.payment_allocations,
    generatedByUserId: row.generated_by_user_id,
    generatedAt: toIso(row.generated_at),
    voidedByUserId: row.voided_by_user_id,
    voidedAt: row.voided_at ? toIso(row.voided_at) : null,
    voidReason: row.void_reason
  };
}

function mapLabVendorRow(row: LabVendorRow): LabVendorRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email,
    address: row.address ?? {},
    taxRegistrationNumber: row.tax_registration_number,
    paymentTermsDays: row.payment_terms_days,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapLabCaseRow(row: LabCaseRow): LabCaseRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    vendorId: row.vendor_id,
    patientId: row.patient_id,
    encounterId: row.encounter_id,
    treatmentPlanId: row.treatment_plan_id,
    treatmentPlanEstimateItemId: row.treatment_plan_estimate_item_id,
    procedurePerformedId: row.procedure_performed_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    dueAt: toIso(row.due_at),
    clinicalNotes: row.clinical_notes,
    internalNotes: row.internal_notes,
    slipNumber: row.slip_number,
    slipVersion: row.slip_version,
    slipGeneratedAt: toIso(row.slip_generated_at),
    slipGeneratedByUserId: row.slip_generated_by_user_id,
    slipMetadata: row.slip_metadata ?? {},
    expectedCostMinor: row.expected_cost_minor === null ? null : Number(row.expected_cost_minor),
    currency: row.currency,
    sentAt: row.sent_at ? toIso(row.sent_at) : null,
    receivedAt: row.received_at ? toIso(row.received_at) : null,
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    cancelledAt: row.cancelled_at ? toIso(row.cancelled_at) : null,
    cancellationReason: row.cancellation_reason,
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapLabCaseItemRow(row: LabCaseItemRow): LabCaseItemRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    labCaseId: row.lab_case_id,
    itemType: row.item_type,
    toothNumber: row.tooth_number,
    material: row.material,
    shade: row.shade,
    quantity: row.quantity,
    notes: row.notes,
    createdAt: toIso(row.created_at)
  };
}

function mapLabCaseStatusHistoryRow(row: LabCaseStatusHistoryRow): LabCaseStatusHistoryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    labCaseId: row.lab_case_id,
    patientId: row.patient_id,
    fromStatus: row.from_status,
    toStatus: row.to_status,
    reason: row.reason,
    evidence: row.evidence ?? {},
    changedByUserId: row.changed_by_user_id,
    changedAt: toIso(row.changed_at)
  };
}

function mapLabReconciliationRow(row: LabReconciliationRow): LabReconciliationRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    vendorId: row.vendor_id,
    periodStart: toIso(row.period_start).slice(0, 10),
    periodEnd: toIso(row.period_end).slice(0, 10),
    status: row.status,
    invoiceReference: row.invoice_reference,
    invoiceAmountMinor: row.invoice_amount_minor === null ? null : Number(row.invoice_amount_minor),
    expectedAmountMinor: Number(row.expected_amount_minor),
    varianceAmountMinor: Number(row.variance_amount_minor),
    currency: row.currency,
    evidence: row.evidence ?? {},
    createdByUserId: row.created_by_user_id,
    approvedByUserId: row.approved_by_user_id,
    approvedAt: row.approved_at ? toIso(row.approved_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapLabReconciliationEntryRow(
  row: LabReconciliationEntryRow
): LabReconciliationEntryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    reconciliationId: row.reconciliation_id,
    labCaseId: row.lab_case_id,
    patientId: row.patient_id,
    status: row.status,
    expectedAmountMinor: Number(row.expected_amount_minor),
    invoiceAmountMinor: row.invoice_amount_minor === null ? null : Number(row.invoice_amount_minor),
    varianceAmountMinor: Number(row.variance_amount_minor),
    notes: row.notes,
    createdAt: toIso(row.created_at)
  };
}

function mapInventoryCategoryRow(row: InventoryCategoryRow): InventoryCategoryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    code: row.code,
    displayName: row.display_name,
    kind: row.kind,
    active: row.active,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapInventoryItemRow(row: InventoryItemRow): InventoryItemRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    categoryId: row.category_id,
    sku: row.sku,
    displayName: row.display_name,
    unitOfMeasure: row.unit_of_measure,
    storageLocation: row.storage_location,
    trackQuantity: row.track_quantity,
    minimumQuantity: Number(row.minimum_quantity),
    reorderQuantity: Number(row.reorder_quantity),
    currentQuantity: Number(row.current_quantity),
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapStockLedgerEntryRow(row: StockLedgerEntryRow): StockLedgerEntryRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    itemId: row.item_id,
    movementType: row.movement_type,
    quantityDelta: Number(row.quantity_delta),
    quantityAfter: Number(row.quantity_after),
    unitCostMinor: row.unit_cost_minor === null ? null : Number(row.unit_cost_minor),
    currency: row.currency,
    sourceTable: row.source_table,
    sourceId: row.source_id,
    reason: row.reason,
    evidence: row.evidence ?? {},
    recordedByUserId: row.recorded_by_user_id,
    recordedAt: toIso(row.recorded_at)
  };
}

function mapInventoryCheckTemplateRow(
  row: InventoryCheckTemplateRow
): InventoryCheckTemplateRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    code: row.code,
    displayName: row.display_name,
    cadence: row.cadence,
    active: row.active,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapInventoryCheckTemplateLineRow(
  row: InventoryCheckTemplateLineRow
): InventoryCheckTemplateLineRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    templateId: row.template_id,
    itemId: row.item_id,
    sequence: row.sequence,
    drawerLocation: row.drawer_location,
    expectedQuantity: row.expected_quantity === null ? null : Number(row.expected_quantity),
    required: row.required,
    instructions: row.instructions
  };
}

function mapInventoryCheckRunRow(row: InventoryCheckRunRow): InventoryCheckRunRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    templateId: row.template_id,
    status: row.status,
    startedByUserId: row.started_by_user_id,
    completedByUserId: row.completed_by_user_id,
    startedAt: toIso(row.started_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    notes: row.notes,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapInventoryCheckRunLineRow(row: InventoryCheckRunLineRow): InventoryCheckRunLineRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    checkRunId: row.check_run_id,
    templateLineId: row.template_line_id,
    itemId: row.item_id,
    sequence: row.sequence,
    drawerLocation: row.drawer_location,
    expectedQuantity: Number(row.expected_quantity),
    countedQuantity: row.counted_quantity === null ? null : Number(row.counted_quantity),
    varianceQuantity: row.variance_quantity === null ? null : Number(row.variance_quantity),
    exceptionType: row.exception_type,
    exceptionNotes: row.exception_notes,
    countedByUserId: row.counted_by_user_id,
    countedAt: row.counted_at ? toIso(row.counted_at) : null
  };
}

function mapProcurementSuggestionRow(row: ProcurementSuggestionRow): ProcurementSuggestionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    itemId: row.item_id,
    sourceCheckRunId: row.source_check_run_id,
    sourceCheckRunLineId: row.source_check_run_line_id,
    status: row.status,
    suggestedQuantity: Number(row.suggested_quantity),
    reason: row.reason,
    taskId: row.task_id,
    evidence: row.evidence ?? {},
    createdByUserId: row.created_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapIncidentRow(row: IncidentRow): IncidentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    patientId: row.patient_id,
    appointmentId: row.appointment_id,
    labCaseId: row.lab_case_id,
    inventoryItemId: row.inventory_item_id,
    category: row.category,
    severity: row.severity,
    status: row.status,
    occurredAt: toIso(row.occurred_at),
    location: row.location,
    summary: row.summary,
    description: row.description,
    impact: row.impact,
    learning: row.learning,
    immediateAction: row.immediate_action,
    evidence: row.evidence ?? {},
    reportedByUserId: row.reported_by_user_id,
    ownerUserId: row.owner_user_id,
    resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
    closedAt: row.closed_at ? toIso(row.closed_at) : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapCorrectiveActionRow(row: CorrectiveActionRow): CorrectiveActionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clinicId: row.clinic_id,
    incidentId: row.incident_id,
    actionType: row.action_type,
    title: row.title,
    description: row.description,
    status: row.status,
    ownerUserId: row.owner_user_id,
    dueAt: toIso(row.due_at),
    completedAt: row.completed_at ? toIso(row.completed_at) : null,
    completedByUserId: row.completed_by_user_id,
    completionEvidence: row.completion_evidence ?? {},
    verificationEvidence: row.verification_evidence ?? {},
    createdByUserId: row.created_by_user_id,
    updatedByUserId: row.updated_by_user_id,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function toInventoryException(
  item: InventoryItemRecord,
  line: InventoryCheckRunLineRecord | null,
  procurementSuggestion: ProcurementSuggestionRecord | null
): InventoryExceptionRecord {
  return {
    item,
    checkRunLine: line,
    procurementSuggestion,
    exceptionType: line?.exceptionType ?? "low_stock",
    quantityAvailable: line?.countedQuantity ?? item.currentQuantity,
    thresholdQuantity: item.minimumQuantity,
    suggestedTask: {
      taskType: "procurement",
      title: `Review procurement for ${item.displayName}`,
      status: "suggested_not_created"
    }
  };
}

function normalizeCreateDentalFindingInput(
  input: CreateDentalFindingInput
): Required<CreateDentalFindingInput> {
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

function normalizeUpdateDentalFindingInput(
  existing: DentalFindingRecord,
  input: UpdateDentalFindingRepositoryInput
): Required<CreateDentalFindingInput> {
  const normalized = {
    encounterId: input.encounterId === undefined ? existing.encounterId : input.encounterId,
    toothNumber: normalizeDentalToothNumber(input.toothNumber ?? existing.toothNumber),
    surface: input.surface === undefined ? existing.surface : normalizeDentalSurface(input.surface),
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

function sopDueAtForAsOf(schedule: SopScheduleRecord, asOf: Date): string | null {
  const asOfDate = asOf.toISOString().slice(0, 10);
  if (asOfDate < schedule.startsOn) return null;
  if (schedule.endsOn && asOfDate > schedule.endsOn) return null;

  const dayMatches =
    schedule.recurrenceType === "daily" ||
    (schedule.recurrenceType === "weekly" && asOf.getUTCDay() === schedule.dayOfWeek) ||
    (schedule.recurrenceType === "monthly" && asOf.getUTCDate() === schedule.dayOfMonth) ||
    (schedule.recurrenceType === "interval_days" &&
      schedule.intervalDays !== null &&
      daysBetween(schedule.startsOn, asOfDate) % schedule.intervalDays === 0);

  if (!dayMatches) return null;
  const dueAt = new Date(`${asOfDate}T${schedule.dueTime.replace(/Z$/, "")}Z`);
  if (Number.isNaN(dueAt.getTime())) return null;
  return dueAt.toISOString();
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  return Math.floor((end - start) / 86_400_000);
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoDateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}
