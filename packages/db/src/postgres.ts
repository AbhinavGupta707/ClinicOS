import { randomUUID } from "node:crypto";
import type {
  AppointmentConflict,
  AppointmentRecord,
  AppointmentStatus,
  AppointmentTypeRecord,
  AttributionTouchRecord,
  ChairOrRoomRecord,
  ClinicalNoteVersionRecord,
  Clinic,
  ClinicAssignment,
  ClinicUser,
  ConsentEnforcementState,
  ConsentRecord,
  AcceptTreatmentPlanInput,
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
  IntakeFormSubmissionRecord,
  IntakeFormTemplateRecord,
  LeadRecord,
  MediaAssetRecord,
  MediaScanStatus,
  MediaStorageProviderKey,
  MediaUploadReservationRecord,
  PaymentRequestRecord,
  PaymentTransactionRecord,
  PatientGender,
  PatientInstructionRecord,
  PatientRecord,
  PatientTimelineItem,
  PricebookProcedureRecord,
  PrescriptionRecord,
  ProcedurePerformedRecord,
  ProviderScheduleRecord,
  QueueEntryRecord,
  QueueStatus,
  ReceiptRecord,
  RoleAssignment,
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
  assertInvoiceReceiptable,
  assertDentalFindingUpdateReason,
  assertClinicalNoteCanBeAmended,
  assertClinicalNoteCanBeSigned,
  assertPrescriptionCanBeSigned,
  assertPositiveMinorCurrencyAmount,
  assertTreatmentPlanAcceptable,
  assertTreatmentPlanMutable,
  assertValidDentalFinding,
  buildDentalChartSnapshotState,
  calculateBillingLineTotals,
  calculateInvoicePaymentStatus,
  normalizeDentalSurface,
  normalizeDentalToothNumber,
  buildConsentEnforcementState,
  isSettledPaymentTransaction,
  mediaAssetStatusForScan,
  normalizeClinicalNoteContent,
  normalizePhone,
  toDentalFindingSnapshotFinding
} from "@clinic-os/domain";
import { buildSetLocalRlsStatements } from "./rls.ts";
import type {
  AppointmentConflictFilter,
  AppointmentSearchFilter,
  AmendClinicalNoteInput,
  AmendClinicalNoteResult,
  ClinicOperationsRepository,
  CreateInvoiceInput,
  CreatePaymentRequestInput,
  CreateProcedurePerformedInput,
  CreateReceiptInput,
  CreateDentalChartSnapshotInput,
  CreateAppointmentInput,
  CreateAttributionTouchInput,
  CreateConsentInput,
  CreateEncounterInput,
  CreateIntakeFormSubmissionInput,
  CreateIntakeFormTemplateInput,
  CreateLeadInput,
  CreateMediaUploadReservationInput,
  CreatePatientInput,
  CreatePatientInstructionInput,
  CreatePrescriptionInput,
  CreateTaskInput,
  DashboardDataSet,
  CompleteMediaUploadInput,
  DentalFindingMutationResult,
  IdentityAccessSnapshot,
  IdentityRepository,
  LeadSearchFilter,
  OutboxEventInput,
  PatientSearchFilter,
  RecordPaymentTransactionInput,
  RepositoryScope,
  RevokeConsentInput,
  SaveClinicalNoteDraftInput,
  SignClinicalNoteResult,
  UpdateDentalFindingRepositoryInput,
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
    const result = await this.#client.query<IdentityAccessRow>(
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

export class PostgresClinicOperationsRepository implements ClinicOperationsRepository {
  readonly #client: SqlConnectionFactory;

  constructor(client: SqlConnectionFactory) {
    this.#client = client;
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
        values.push(`${filter.date}T00:00:00.000Z`, `${filter.date}T23:59:59.999Z`);
        where.push(`start_at between $${values.length - 1} and $${values.length}`);
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
      const result = await client.query<QueueEntryRow>(
        `
          insert into queue_entries (
            tenant_id,
            clinic_id,
            appointment_id,
            patient_id,
            provider_user_id,
            position,
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
              (select max(position) + 1 from queue_entries where tenant_id = $1 and clinic_id = $2 and checked_in_at::date = now()::date),
              1
            ),
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
          scope.actorUserId
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
          select *
          from queue_entries
          where tenant_id = $1 and clinic_id = $2 and checked_in_at between $3 and $4
          order by position, checked_in_at
        `,
        [scope.tenantId, scope.clinicId, `${date}T00:00:00.000Z`, `${date}T23:59:59.999Z`]
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
            task_type,
            title,
            status,
            due_at,
            assigned_to_user_id,
            created_by_user_id,
            updated_by_user_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $11)
          returning *
        `,
        [
          scope.tenantId,
          scope.clinicId,
          input.patientId ?? null,
          input.leadId ?? null,
          input.appointmentId ?? null,
          input.taskType,
          input.title,
          input.status ?? "open",
          input.dueAt ?? null,
          input.assignedToUserId ?? null,
          scope.actorUserId
        ]
      );

      return mapTaskRow(result.rows[0]);
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
      const dayStart = `${date}T00:00:00.000Z`;
      const dayEnd = `${date}T23:59:59.999Z`;
      const appointments = (
        await client.query<AppointmentRow>(
          `
            select *
            from appointments
            where tenant_id = $1 and clinic_id = $2 and start_at between $3 and $4
            order by start_at
          `,
          [scope.tenantId, scope.clinicId, dayStart, dayEnd]
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
              and (due_at is null or due_at <= $3)
            order by due_at nulls last, created_at desc
            limit 50
          `,
          [scope.tenantId, scope.clinicId, dayEnd]
        )
      ).rows.map(mapTaskRow);
      const queue = (
        await client.query<QueueEntryRow>(
          `
            select *
            from queue_entries
            where tenant_id = $1 and clinic_id = $2 and checked_in_at between $3 and $4
            order by position, checked_in_at
          `,
          [scope.tenantId, scope.clinicId, dayStart, dayEnd]
        )
      ).rows.map(mapQueueEntryRow);
      const returningRows = await client.query<{ patient_id: UUID }>(
        `
          select patient_id
          from appointments
          where tenant_id = $1 and clinic_id = $2 and start_at < $3
          group by patient_id
        `,
        [scope.tenantId, scope.clinicId, dayStart]
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
        metadata: { templateId: input.templateId, templateVersion: template.version, source: input.source }
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

  async createEncounter(scope: RepositoryScope, input: CreateEncounterInput): Promise<EncounterRecord> {
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
        metadata: { appointmentId: encounter.appointmentId, providerUserId: encounter.providerUserId }
      });

      return encounter;
    });
  }

  async findEncounterById(scope: RepositoryScope, encounterId: UUID): Promise<EncounterRecord | null> {
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

      await this.#appendEncounterStatusHistory(client, scope, encounter, existing.status, reason ?? null);

      if (status === "drafting" && existing.status === "scheduled") {
        await this.#appendTimeline(client, scope, {
          patientId: encounter.patientId,
          itemType: "encounter_started",
          sourceTable: "encounters",
          sourceId: encounter.id,
          title: "Encounter started",
          summary: encounter.reason,
          metadata: { appointmentId: encounter.appointmentId, providerUserId: encounter.providerUserId }
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

      await this.#appendEncounterStatusHistory(client, scope, updatedEncounter, encounter.status, "clinical_note_signed");
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

      await this.#appendEncounterStatusHistory(client, scope, updatedEncounter, encounter.status, "clinical_note_amended");
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
        metadata: { encounterId: prescription.encounterId, signedByUserId: prescription.signedByUserId }
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

      const now = new Date().toISOString();
      const status = input.channel === "print" ? "ready_for_print" : "send_requested";
      const printJobId = input.channel === "print" ? `print_${randomUUID()}` : null;
      const outboxEventId = input.channel === "whatsapp" ? (input.outboxEventId ?? (randomUUID() as UUID)) : null;
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
        itemType: input.channel === "print" ? "instruction_print_requested" : "instruction_send_requested",
        sourceTable: "patient_instruction_requests",
        sourceId: instruction.id,
        title: input.channel === "print" ? "Instruction print requested" : "Instruction send requested",
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
        const encounter = await this.#findEncounterByIdInTransaction(client, scope, input.encounterId);
        if (!encounter || encounter.patientId !== patientId) return null;
      }

      await this.#ensureDentalChartInTransaction(client, scope, patientId);
      const normalized = normalizeCreateDentalFindingInput(input);
      const reviewedAt =
        normalized.reviewStatus === "reviewed" ? new Date().toISOString() : null;
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
        const encounter = await this.#findEncounterByIdInTransaction(client, scope, input.encounterId);
        if (!encounter || encounter.patientId !== existing.patientId) return null;
      }

      const next = normalizeUpdateDentalFindingInput(existing, input);
      const reviewedByUserId =
        next.reviewStatus === "reviewed"
          ? existing.reviewedByUserId ?? scope.actorUserId
          : null;
      const reviewedAt =
        next.reviewStatus === "reviewed"
          ? existing.reviewedAt ?? new Date().toISOString()
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
        const encounter = await this.#findEncounterByIdInTransaction(client, scope, input.encounterId);
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
        const encounter = await this.#findEncounterByIdInTransaction(client, scope, input.encounterId);
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
      const existing = await this.#findTreatmentPlanRowInTransaction(client, scope, treatmentPlanId);
      if (!existing) return null;
      assertTreatmentPlanMutable(existing);

      if (input.status === "accepted") {
        throw new Error("Use acceptTreatmentPlan to record patient acceptance evidence.");
      }

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
          input.clinicalSummary === undefined ? existing.clinicalSummary : input.clinicalSummary?.trim() || null,
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

      const detail = await this.#findTreatmentPlanDetailInTransaction(client, scope, treatmentPlanId);
      return detail ? { detail } : null;
    });
  }

  async acceptTreatmentPlan(
    scope: RepositoryScope,
    treatmentPlanId: UUID,
    input: AcceptTreatmentPlanInput
  ) {
    return this.#withRls(scope, async (client) => {
      const detail = await this.#findTreatmentPlanDetailInTransaction(client, scope, treatmentPlanId);
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
      const accepted = await this.#findTreatmentPlanDetailInTransaction(client, scope, treatmentPlanId);
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
      const plan = await this.#findTreatmentPlanDetailInTransaction(client, scope, input.treatmentPlanId);
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
      const procedures = await this.#listCompletedProceduresForInvoiceInTransaction(client, scope, input);
      if (procedures.length === 0) return null;
      const patientIds = new Set(procedures.map((procedure) => procedure.patientId));
      if (patientIds.size !== 1) throw new Error("Invoice procedures must belong to exactly one patient.");

      const subtotalMinor = procedures.reduce(
        (total, procedure) => total + procedure.unitPriceMinor * procedure.quantity,
        0
      );
      const discountMinor = procedures.reduce((total, procedure) => total + procedure.discountMinor, 0);
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
      if (input.status === "manually_recorded" && input.verificationStatus !== "not_required_manual") {
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

  async createReceipt(
    scope: RepositoryScope,
    invoiceId: UUID,
    input: CreateReceiptInput
  ) {
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
        const taxRateBasisPoints =
          itemInput.taxRateBasisPoints ?? procedure.taxRateBasisPoints;
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
      [
        scope.tenantId,
        scope.clinicId,
        input.patientId ?? null,
        input.treatmentPlanId ?? null,
        ids
      ]
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
    return `INV-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(
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
    return `RCT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(
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
  task_type: TaskRecord["taskType"];
  title: string;
  status: TaskRecord["status"];
  due_at: Date | string | null;
  assigned_to_user_id: UUID | null;
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
    taskType: row.task_type,
    title: row.title,
    status: row.status,
    dueAt: row.due_at ? toIso(row.due_at) : null,
    assignedToUserId: row.assigned_to_user_id,
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

function normalizeCreateDentalFindingInput(input: CreateDentalFindingInput): Required<CreateDentalFindingInput> {
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

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoDateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}
