import type {
  AppointmentConflict,
  AppointmentRecord,
  AppointmentStatus,
  AppointmentTypeRecord,
  AttributionTouchRecord,
  ChairOrRoomRecord,
  Clinic,
  ClinicAssignment,
  ClinicUser,
  DomainEventType,
  PatientRecord,
  PatientSource,
  PatientTimelineItem,
  ProviderScheduleRecord,
  QueueEntryRecord,
  QueueStatus,
  RoleAssignment,
  TaskRecord,
  TaskStatus,
  TaskType,
  Tenant,
  TenantMembership,
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
}
