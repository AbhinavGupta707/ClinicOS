import { randomUUID } from "node:crypto";
import { assertAuthorized, type AccessContext, type AuthorizationRequest } from "@clinic-os/auth";
import type {
  ClinicOperationsRepository,
  CreateAppointmentInput,
  CreateLeadInput,
  CreatePatientInput,
  RepositoryScope
} from "@clinic-os/db";
import {
  assertAppointmentTransition,
  assertLeadTransition,
  assertPatientCreateMinimum,
  buildMorningDashboard,
  buildPatientDuplicateSuggestions,
  calculateEndAt,
  isAppointmentStatus,
  isValidLeadStatus,
  isUuid,
  type AppointmentRecord,
  type AppointmentStatus,
  type DomainEventType,
  type LeadIntent,
  type LeadSource,
  type LeadStatus,
  type PatientTimelineItem as DomainPatientTimelineItem,
  type PatientSource,
  type QueueStatus,
  type UUID
} from "@clinic-os/domain";
import {
  createAuditEvent,
  type AuditEventRecord,
  type KnownAuditAction
} from "@clinic-os/security";
import { ApiError } from "./errors.ts";

export interface OperationsRequestContext {
  requestId: string;
  accessContext: AccessContext;
  clinicId: UUID;
  ipAddress?: string | null;
  userAgent?: string | null;
  idempotencyKey?: string | null;
}

export interface OperationsDependencies {
  repository: ClinicOperationsRepository;
  auditSink?: {
    appendAuditEvent(event: AuditEventRecord): Promise<void>;
  };
}

export interface ApiSuccess<T> {
  status: number;
  body: T;
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
      occurredAt: new Date().toISOString(),
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

type PublicTimelineItemType =
  | "patient"
  | "attribution"
  | "lead"
  | "appointment"
  | "queue"
  | "message"
  | "clinical_note"
  | "prescription"
  | "media"
  | "invoice"
  | "payment"
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
    case "prescription_draft_created":
    case "prescription_signed":
      return "prescription";
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
    case "prescription_draft_created":
      return "prescription.draft_created";
    case "prescription_signed":
      return "prescription.signed";
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
      correlationId: context.requestId
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
    occurredAt: new Date().toISOString()
  });
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

function parseQueueStatus(value: string): QueueStatus {
  if (!QUEUE_STATUSES.has(value as QueueStatus)) {
    throw validation("Invalid queue status.", { field: "status", value });
  }
  return value as QueueStatus;
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

function numberField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validation(`${field} must be a number.`, { field });
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

function ok<T>(body: T): ApiSuccess<T> {
  return { status: 200, body };
}

function created<T>(body: T): ApiSuccess<T> {
  return { status: 201, body };
}

function notFound(message: string, details: Record<string, unknown>): ApiError {
  return new ApiError(404, "NOT_FOUND", message, details);
}

function validation(message: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", message, details);
}

export function randomRequestId(): string {
  return randomUUID();
}
