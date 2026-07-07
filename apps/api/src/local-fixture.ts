import { randomUUID } from "node:crypto";
import type { KeycloakAccessTokenClaims } from "@clinic-os/auth";
import {
  CHECKPOINT1_SEED_IDS,
  CHECKPOINT1_SEED_USERS,
  type AppointmentSearchFilter,
  type AmendClinicalNoteInput,
  type AmendClinicalNoteResult,
  type ClinicOperationsRepository,
  type CreateAppointmentInput,
  type CreateAttributionTouchInput,
  type CreateConsentInput,
  type CreateDentalChartSnapshotInput,
  type CreateEncounterInput,
  type CreateDentalFindingInput,
  type CreateIntakeFormSubmissionInput,
  type CreateIntakeFormTemplateInput,
  type CreateLeadInput,
  type CreatePatientInput,
  type CreatePrescriptionInput,
  type CreateTaskInput,
  type DashboardDataSet,
  type DentalFindingMutationResult,
  type IdentityAccessSnapshot,
  type IdentityRepository,
  type LeadSearchFilter,
  type OutboxEventInput,
  type PatientSearchFilter,
  type RepositoryScope,
  type RevokeConsentInput,
  type SaveClinicalNoteDraftInput,
  type SignClinicalNoteResult,
  type UpdateDentalFindingRepositoryInput,
  type UpdatePatientInput
} from "@clinic-os/db";
import {
  assertDentalFindingUpdateReason,
  assertClinicalNoteCanBeAmended,
  assertClinicalNoteCanBeSigned,
  assertEncounterTransition,
  assertPrescriptionCanBeSigned,
  assertValidDentalFinding,
  buildDentalChartSnapshotState,
  buildConsentEnforcementState,
  detectAppointmentConflicts,
  normalizeClinicalNoteContent,
  normalizeDentalSurface,
  normalizeDentalToothNumber,
  normalizePhone,
  toDentalFindingSnapshotFinding,
  type AppointmentConflict,
  type AppointmentRecord,
  type AppointmentStatus,
  type AppointmentTypeRecord,
  type AttributionTouchRecord,
  type ChairOrRoomRecord,
  type ClinicalNoteVersionRecord,
  type ConsentRecord,
  type DentalChartRecord,
  type DentalChartSnapshotRecord,
  type DentalFindingHistoryRecord,
  type DentalFindingRecord,
  type EncounterRecord,
  type IntakeFormSubmissionRecord,
  type IntakeFormTemplateRecord,
  type LeadRecord,
  type PatientRecord,
  type PatientTimelineItem,
  type PrescriptionRecord,
  type ProviderScheduleRecord,
  type QueueEntryRecord,
  type QueueStatus,
  type TaskRecord,
  type UUID
} from "@clinic-os/domain";
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
  readonly patients: PatientRecord[] = [
    {
      id: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
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
    const now = new Date().toISOString();
    const patient: PatientRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
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
      timeline(scope, patient.id, "patient_created", "patients", patient.id, "Patient registered")
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

    Object.assign(patient, {
      fullName: input.fullName ?? patient.fullName,
      phone: input.phone === undefined ? patient.phone : input.phone,
      email: input.email === undefined ? patient.email : input.email,
      dateOfBirth: input.dateOfBirth === undefined ? patient.dateOfBirth : input.dateOfBirth,
      gender: input.gender ?? patient.gender,
      updatedAt: new Date().toISOString()
    });

    return patient;
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
    const now = new Date().toISOString();
    const lead: LeadRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
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
    lead.status = status;
    lead.lastActivityAt = new Date().toISOString();
    return lead;
  }

  async matchLeadToPatient(
    scope: RepositoryScope,
    leadId: UUID,
    patientId: UUID
  ): Promise<LeadRecord | null> {
    const lead = await this.findLeadById(scope, leadId);
    if (!lead) return null;
    lead.patientId = patientId;
    lead.status = "matched";
    lead.lastActivityAt = new Date().toISOString();
    this.timelineItems.push(
      timeline(scope, patientId, "lead_matched", "leads", leadId, "Lead matched to patient")
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
    const now = new Date().toISOString();
    const appointment: AppointmentRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
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
      timeline(
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
    appointment.status = status;
    appointment.updatedAt = new Date().toISOString();

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
        timeline(
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
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      providerUserId: appointment.providerUserId,
      status: "waiting",
      position: this.queueEntries.filter((entry) => matchesScope(entry, scope)).length + 1,
      checkedInAt: new Date().toISOString(),
      calledAt: null,
      completedAt: null
    };

    this.queueEntries.push(queueEntry);
    this.timelineItems.push(
      timeline(
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
    queueEntry.status = status;
    if (status === "called") queueEntry.calledAt = queueEntry.calledAt ?? new Date().toISOString();
    if (status === "completed")
      queueEntry.completedAt = queueEntry.completedAt ?? new Date().toISOString();
    return queueEntry;
  }

  async createTask(scope: RepositoryScope, input: CreateTaskInput): Promise<TaskRecord> {
    const now = new Date().toISOString();
    const task: TaskRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      patientId: input.patientId ?? null,
      leadId: input.leadId ?? null,
      appointmentId: input.appointmentId ?? null,
      taskType: input.taskType,
      title: input.title,
      status: input.status ?? "open",
      dueAt: input.dueAt ?? null,
      assignedToUserId: input.assignedToUserId ?? null,
      createdAt: now,
      updatedAt: now
    };

    this.tasks.push(task);
    return task;
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
        timeline(
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
    const now = new Date().toISOString();
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
    const submittedAt = new Date().toISOString();
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
      timeline(
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
    const now = new Date().toISOString();
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
      timeline(scope, input.patientId, "consent_created", "consents", consent.id, "Consent recorded")
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
    consent.revokedAt = new Date().toISOString();
    consent.revocationReason = input.revocationReason;
    this.timelineItems.push(
      timeline(scope, consent.patientId, "consent_revoked", "consents", consent.id, "Consent revoked")
    );
    return consent;
  }

  async getConsentEnforcementState(scope: RepositoryScope, patientId: UUID) {
    return buildConsentEnforcementState(patientId, await this.listPatientConsents(scope, patientId));
  }

  async createEncounter(scope: RepositoryScope, input: CreateEncounterInput): Promise<EncounterRecord> {
    const now = new Date().toISOString();
    const encounter: EncounterRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
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
      timeline(scope, input.patientId, "encounter_created", "encounters", encounter.id, "Encounter created")
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
    encounter.status = status;
    encounter.updatedAt = new Date().toISOString();
    if (status === "drafting") encounter.startedAt = encounter.startedAt ?? encounter.updatedAt;
    if (status === "closed") encounter.closedAt = encounter.closedAt ?? encounter.updatedAt;

    if (previous === "scheduled" && status === "drafting") {
      this.timelineItems.push(
        timeline(
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
      encounter.status = input.readyForSign ? "ready_for_sign" : "drafting";
      encounter.updatedAt = new Date().toISOString();
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
      createdAt: new Date().toISOString()
    };

    this.clinicalNoteVersions.push(note);
    this.timelineItems.push(
      timeline(
        scope,
        encounter.patientId,
        "clinical_note_draft_created",
        "clinical_note_versions",
        note.id,
        "Clinical note drafted"
      )
    );
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
    draft.status = "signed";
    draft.signedByUserId = scope.actorUserId;
    draft.signedAt = new Date().toISOString();
    encounter.status = "signed";
    encounter.updatedAt = draft.signedAt;
    this.timelineItems.push(
      timeline(
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
    const now = new Date().toISOString();
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
    encounter.status = "amended";
    encounter.updatedAt = now;
    this.timelineItems.push(
      timeline(
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
      createdAt: new Date().toISOString(),
      signedByUserId: null,
      signedAt: null
    };

    this.prescriptions.push(prescription);
    this.timelineItems.push(
      timeline(
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
    prescription.signedAt = new Date().toISOString();
    this.timelineItems.push(
      timeline(
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
    const now = new Date().toISOString();
    const finding: DentalFindingRecord = {
      id: uuid(),
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
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
      ...timeline(
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
    const now = new Date().toISOString();
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
      ...timeline(
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
    const now = new Date().toISOString();
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
      ...timeline(
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
      const now = new Date().toISOString();
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
      changedAt: new Date().toISOString(),
      reason: input.reason,
      beforeState: input.beforeState,
      afterState: toDentalFindingSnapshotFinding(finding),
      provenance: input.provenance
    };
    this.dentalFindingHistory.push(history);
    return history;
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

function matchesScope(record: { tenantId: UUID; clinicId: UUID }, scope: RepositoryScope): boolean {
  return record.tenantId === scope.tenantId && record.clinicId === scope.clinicId;
}

function timeline(
  scope: RepositoryScope,
  patientId: UUID,
  itemType: PatientTimelineItem["itemType"],
  sourceTable: string,
  sourceId: UUID,
  title: string
): PatientTimelineItem {
  return {
    id: uuid(),
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    patientId,
    itemType,
    sourceTable,
    sourceId,
    occurredAt: new Date().toISOString(),
    title,
    summary: null,
    metadata: {}
  };
}
