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
  EncounterRecord,
  IntakeFormSubmissionRecord,
  IntakeFormTemplateRecord,
  LeadRecord,
  PatientGender,
  PatientRecord,
  PatientTimelineItem,
  PrescriptionRecord,
  ProviderScheduleRecord,
  QueueEntryRecord,
  QueueStatus,
  RoleAssignment,
  TaskRecord,
  Tenant,
  TenantMembership,
  UUID
} from "@clinic-os/domain";
import {
  assertClinicalNoteCanBeAmended,
  assertClinicalNoteCanBeSigned,
  assertPrescriptionCanBeSigned,
  buildConsentEnforcementState,
  normalizeClinicalNoteContent,
  normalizePhone
} from "@clinic-os/domain";
import { buildSetLocalRlsStatements } from "./rls.ts";
import type {
  AppointmentConflictFilter,
  AppointmentSearchFilter,
  AmendClinicalNoteInput,
  AmendClinicalNoteResult,
  ClinicOperationsRepository,
  CreateAppointmentInput,
  CreateAttributionTouchInput,
  CreateConsentInput,
  CreateEncounterInput,
  CreateIntakeFormSubmissionInput,
  CreateIntakeFormTemplateInput,
  CreateLeadInput,
  CreatePatientInput,
  CreatePrescriptionInput,
  CreateTaskInput,
  DashboardDataSet,
  IdentityAccessSnapshot,
  IdentityRepository,
  LeadSearchFilter,
  OutboxEventInput,
  PatientSearchFilter,
  RepositoryScope,
  RevokeConsentInput,
  SaveClinicalNoteDraftInput,
  SignClinicalNoteResult,
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
        itemType: "prescription_created",
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

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isoDateOnly(value: Date | string): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}
