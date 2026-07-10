import type { JsonValue } from "@clinic-os/api-contracts";
import type {
  CreateAppointmentInput,
  CreateIntakeFormSubmissionInput,
  CreateIntakeFormTemplateInput,
  CreateLeadInput,
  CreatePatientInput
} from "@clinic-os/db";
import {
  assertLeadTransition,
  buildMorningDashboard,
  buildPatientDuplicateSuggestions,
  type AppointmentRecord,
  type AppointmentStatus,
  type DomainEventType,
  type LeadRecord,
  type LeadSource,
  type LeadStatus,
  type PatientRecord,
  type PatientSource,
  type PatientTimelineItem,
  type QueueStatus,
  type UUID
} from "@clinic-os/domain";
import { createAuditEvent, type KnownAuditAction } from "@clinic-os/security";
import {
  appointmentClinicLocalDate,
  assertFrontOfficeAppointmentTransition,
  assertFrontOfficeQueueTransition,
  providerScheduleCoversAppointment,
  resolveAppointmentWindow,
  resolveClinicDay
} from "@clinic-os/domain";
import { ApiError } from "../../errors.ts";
import type {
  ClinicFeatureExecutionContext,
  ClinicFeatureHandlerMap,
  ClinicFeatureOperationHandler,
  ClinicFeatureOperationRequest
} from "../contracts.ts";
import { CP13_FRONT_OFFICE_OPERATION_IDS } from "../cp13-operation-ownership.ts";

export type FrontOfficeOperationId = (typeof CP13_FRONT_OFFICE_OPERATION_IDS)[number];
type FrontOfficeHandler = ClinicFeatureOperationHandler<FrontOfficeOperationId>;

const handlers = {
  listPatients: handleListPatients,
  createPatient: handleCreatePatient,
  getPatient: handleGetPatient,
  updatePatient: handleUpdatePatient,
  getPatientTimeline: handleGetPatientTimeline,
  listLeads: handleListLeads,
  createLead: handleCreateLead,
  matchLeadToPatient: handleMatchLeadToPatient,
  convertLeadToAppointment: handleConvertLeadToAppointment,
  updateLeadStatus: handleUpdateLeadStatus,
  listAppointments: handleListAppointments,
  createAppointment: handleCreateAppointment,
  updateAppointment: handleUpdateAppointment,
  confirmAppointment: handleConfirmAppointment,
  checkInAppointment: handleCheckInAppointment,
  markAppointmentNoShow: handleMarkAppointmentNoShow,
  listAppointmentTypes: handleListAppointmentTypes,
  listChairs: handleListChairs,
  listProviderSchedules: handleListProviderSchedules,
  listQueue: handleListQueue,
  updateQueueEntry: handleUpdateQueueEntry,
  getMorningDashboard: handleGetMorningDashboard,
  listIntakeFormTemplates: handleListIntakeFormTemplates,
  createIntakeFormTemplate: handleCreateIntakeFormTemplate,
  submitPatientIntakeForm: handleSubmitPatientIntakeForm,
  getPatientPrepSummary: handleGetPatientPrepSummary
} satisfies Record<FrontOfficeOperationId, FrontOfficeHandler>;

export const FRONT_OFFICE_FEATURE_HANDLERS: ClinicFeatureHandlerMap<FrontOfficeOperationId> =
  Object.freeze(handlers);

export function createFrontOfficeFeatureHandlerMap(): ClinicFeatureHandlerMap<FrontOfficeOperationId> {
  return FRONT_OFFICE_FEATURE_HANDLERS;
}

async function handleListPatients(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const query = requestRecord(request.parsed.query);
  const patients = await context.repositories.patientAdministration.listPatients({
    query: optionalString(query.query),
    phone: optionalString(query.phone),
    source: optionalString(query.source) as PatientSource | undefined,
    limit: optionalNumber(query.limit)
  });
  return ok({ patients });
}

async function handleCreatePatient(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const body = bodyRecord(request);
  const input: CreatePatientInput = {
    fullName: stringValue(body.fullName),
    phone: stringValue(body.phone),
    email: optionalNullableString(body.email),
    dateOfBirth: optionalNullableString(body.dateOfBirth),
    gender: (optionalString(body.gender) ?? "unknown") as PatientRecord["gender"],
    source: stringValue(body.source) as PatientSource,
    sourceDetail: optionalRecord(body.sourceDetail) ?? {}
  };
  const sourceLeadId = optionalNullableString(body.leadId) as UUID | null | undefined;
  const sourceLead = sourceLeadId
    ? await context.repositories.patientAdministration.findLeadById(sourceLeadId)
    : null;
  if (sourceLeadId && !sourceLead)
    throw notFound("Source lead not found.", { lead_id: sourceLeadId });
  if (sourceLead?.patientId) {
    throw conflict("Source lead is already matched to a patient.", {
      lead_id: sourceLead.id,
      patient_id: sourceLead.patientId
    });
  }
  if (sourceLead) domainInvariant(() => assertLeadTransition(sourceLead.status, "matched"));

  const candidates =
    await context.repositories.patientAdministration.findPatientDuplicateCandidates({
      fullName: input.fullName,
      phone: input.phone
    });
  const duplicateSuggestions = buildPatientDuplicateSuggestions(input, candidates);
  if (duplicateSuggestions.length > 0) {
    throw conflict(
      "Potential duplicate patients require explicit resolution before patient creation.",
      { duplicate_suggestions: duplicateSuggestions }
    );
  }
  const patient = await context.repositories.patientAdministration.createPatient(input);
  const attributionSource = toLeadSource(input.source);
  if (attributionSource) {
    const touch = await context.repositories.patientAdministration.createAttributionTouch({
      patientId: patient.id,
      leadId: sourceLead?.id ?? null,
      source: attributionSource,
      touchType: "first_touch",
      occurredAt: nowIso(context),
      metadata: input.sourceDetail ?? {}
    });
    await appendAudit(request, context, "attribution.touch.created", {
      patientId: patient.id,
      resourceType: "attribution_touch",
      resourceId: touch.id,
      metadata: { source: touch.source, touchType: "first_touch" }
    });
    await appendOutbox(request, context, {
      eventType: "attribution.touch.created",
      aggregateType: "attribution_touch",
      aggregateId: touch.id,
      patientId: patient.id,
      payload: { attributionTouchId: touch.id, patientId: patient.id, source: touch.source }
    });
  }
  await appendAudit(request, context, "patient.record.created", {
    patientId: patient.id,
    resourceType: "patient",
    resourceId: patient.id,
    metadata: { source: patient.source, duplicateSuggestionCount: duplicateSuggestions.length }
  });
  await appendOutbox(request, context, {
    eventType: "patient.created",
    aggregateType: "patient",
    aggregateId: patient.id,
    patientId: patient.id,
    payload: { patientId: patient.id, source: patient.source }
  });

  const matchedLead = sourceLead
    ? await context.repositories.patientAdministration.matchLeadToPatient(sourceLead.id, patient.id)
    : null;
  if (sourceLead && !matchedLead)
    throw notFound("Source lead not found after patient creation.", { lead_id: sourceLead.id });
  if (matchedLead) await recordLeadMatch(request, context, matchedLead, patient.id, true);
  return created({ patient, duplicateSuggestions, matchedLead });
}

async function handleGetPatient(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const patientId = pathUuid(request, "patientId");
  const patient = await context.repositories.patientAdministration.findPatientById(patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });
  await appendAudit(request, context, "patient.record.viewed", {
    patientId,
    resourceType: "patient",
    resourceId: patientId
  });
  return ok({ patient });
}

async function handleUpdatePatient(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const patientId = pathUuid(request, "patientId");
  const body = bodyRecord(request);
  const patient = await context.repositories.patientAdministration.updatePatient(patientId, {
    fullName: optionalString(body.fullName),
    phone: optionalNullableString(body.phone),
    email: optionalNullableString(body.email),
    dateOfBirth: optionalNullableString(body.dateOfBirth),
    gender: optionalString(body.gender) as PatientRecord["gender"] | undefined
  });
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });
  await appendAudit(request, context, "patient.record.updated", {
    patientId,
    resourceType: "patient",
    resourceId: patientId
  });
  await appendOutbox(request, context, {
    eventType: "patient.updated",
    aggregateType: "patient",
    aggregateId: patientId,
    patientId,
    payload: { patientId }
  });
  return ok({ patient });
}

async function handleGetPatientTimeline(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const patientId = pathUuid(request, "patientId");
  const patient = await context.repositories.patientAdministration.findPatientById(patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });
  const limit = optionalNumber(requestRecord(request.parsed.query).limit) ?? 50;
  const timeline = (await context.repositories.patientAdministration.findPatientTimeline(patientId))
    .slice(0, limit)
    .map(publicTimelineItem);
  await appendAudit(request, context, "patient.timeline.viewed", {
    patientId,
    resourceType: "patient_timeline",
    resourceId: patientId
  });
  return ok({ timeline, items: timeline });
}

async function handleListLeads(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const query = requestRecord(request.parsed.query);
  const leads = await context.repositories.patientAdministration.listLeads({
    source: optionalString(query.source) as LeadSource | undefined,
    status: optionalString(query.status) as LeadStatus | undefined,
    limit: optionalNumber(query.limit)
  });
  return ok({ leads });
}

async function handleCreateLead(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const body = bodyRecord(request);
  const input: CreateLeadInput = {
    primaryContact: stringValue(body.primaryContact),
    intent: (optionalString(body.intent) ?? "unknown") as CreateLeadInput["intent"],
    source: stringValue(body.source) as LeadSource,
    sourceDetail: optionalRecord(body.sourceDetail) ?? {}
  };
  const lead = await context.repositories.patientAdministration.createLead(input);
  const candidates =
    await context.repositories.patientAdministration.findPatientDuplicateCandidates({
      fullName:
        typeof input.sourceDetail.patientName === "string"
          ? input.sourceDetail.patientName
          : input.primaryContact,
      phone: input.primaryContact
    });
  const touch = await context.repositories.patientAdministration.createAttributionTouch({
    leadId: lead.id,
    source: lead.source,
    touchType: "first_touch",
    occurredAt: lead.firstSeenAt,
    externalRef:
      typeof lead.sourceDetail.externalRef === "string" ? lead.sourceDetail.externalRef : null,
    metadata: lead.sourceDetail
  });
  await appendAudit(request, context, "lead.created", {
    resourceType: "lead",
    resourceId: lead.id,
    metadata: { source: lead.source, intent: lead.intent }
  });
  await appendAudit(request, context, "attribution.touch.created", {
    resourceType: "attribution_touch",
    resourceId: touch.id,
    metadata: { source: touch.source, touchType: "first_touch", leadId: lead.id }
  });
  await appendOutbox(request, context, {
    eventType: "lead.created",
    aggregateType: "lead",
    aggregateId: lead.id,
    payload: { leadId: lead.id, source: lead.source, intent: lead.intent }
  });
  await appendOutbox(request, context, {
    eventType: "attribution.touch.created",
    aggregateType: "attribution_touch",
    aggregateId: touch.id,
    payload: { attributionTouchId: touch.id, leadId: lead.id, source: lead.source }
  });
  return created({
    lead,
    patientMatchSuggestions: buildPatientDuplicateSuggestions(
      {
        fullName:
          typeof input.sourceDetail.patientName === "string"
            ? input.sourceDetail.patientName
            : input.primaryContact,
        phone: input.primaryContact
      },
      candidates
    )
  });
}

async function handleMatchLeadToPatient(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const leadId = pathUuid(request, "leadId");
  const patientId = bodyUuid(request, "patientId");
  const [lead, patient] = await Promise.all([
    context.repositories.patientAdministration.findLeadById(leadId),
    context.repositories.patientAdministration.findPatientById(patientId)
  ]);
  if (!lead) throw notFound("Lead not found.", { lead_id: leadId });
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });
  if (lead.patientId === patientId && lead.status === "matched") return ok({ lead });
  if (lead.patientId && lead.patientId !== patientId) {
    throw conflict(
      "Lead is already matched to another patient; automatic reassignment is forbidden.",
      {
        lead_id: leadId
      }
    );
  }
  domainInvariant(() => assertLeadTransition(lead.status, "matched"));
  const matchedLead = await context.repositories.patientAdministration.matchLeadToPatient(
    leadId,
    patientId
  );
  if (!matchedLead) throw notFound("Lead not found.", { lead_id: leadId });
  await recordLeadMatch(request, context, matchedLead, patientId, false);
  return ok({ lead: matchedLead });
}

async function handleConvertLeadToAppointment(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const leadId = pathUuid(request, "leadId");
  const lead = await context.repositories.patientAdministration.findLeadById(leadId);
  if (!lead) throw notFound("Lead not found.", { lead_id: leadId });
  if (!lead.patientId)
    throw conflict("Lead must be explicitly matched before appointment conversion.", {
      lead_id: leadId
    });
  domainInvariant(() => assertLeadTransition(lead.status, "booked"));
  const appointment = await bookAppointment(
    request,
    context,
    appointmentInput(request, {
      patientId: lead.patientId,
      leadId,
      source: lead.source
    })
  );
  const bookedLead = await context.repositories.patientAdministration.updateLeadStatus(
    leadId,
    "booked"
  );
  if (!bookedLead)
    throw notFound("Lead not found after appointment creation.", { lead_id: leadId });
  const touch = await context.repositories.patientAdministration.createAttributionTouch({
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
  await appendAudit(request, context, "lead.converted_to_appointment", {
    patientId: appointment.patientId,
    resourceType: "lead",
    resourceId: leadId,
    metadata: { appointmentId: appointment.id }
  });
  await appendAudit(request, context, "attribution.touch.created", {
    patientId: appointment.patientId,
    resourceType: "attribution_touch",
    resourceId: touch.id,
    metadata: { source: touch.source, touchType: "booking_touch", leadId }
  });
  await appendOutbox(request, context, {
    eventType: "lead.converted_to_appointment",
    aggregateType: "lead",
    aggregateId: leadId,
    patientId: appointment.patientId,
    payload: { leadId, patientId: appointment.patientId, appointmentId: appointment.id }
  });
  await appendOutbox(request, context, {
    eventType: "attribution.touch.created",
    aggregateType: "attribution_touch",
    aggregateId: touch.id,
    patientId: appointment.patientId,
    payload: { attributionTouchId: touch.id, appointmentId: appointment.id, leadId }
  });
  return created({ lead: bookedLead, appointment });
}

async function handleUpdateLeadStatus(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const leadId = pathUuid(request, "leadId");
  const status = stringValue(bodyRecord(request).status) as LeadStatus;
  const lead = await context.repositories.patientAdministration.findLeadById(leadId);
  if (!lead) throw notFound("Lead not found.", { lead_id: leadId });
  if (lead.status === status) return ok({ lead });
  domainInvariant(() => assertLeadTransition(lead.status, status));
  const updated = await context.repositories.patientAdministration.updateLeadStatus(leadId, status);
  if (!updated) throw notFound("Lead not found.", { lead_id: leadId });
  return ok({ lead: updated });
}

async function handleListAppointments(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const query = requestRecord(request.parsed.query);
  const appointments = (
    await context.repositories.scheduling.listAppointments({
      date: optionalString(query.date),
      providerUserId: optionalString(query.providerId) as UUID | undefined,
      status: optionalString(query.status) as AppointmentStatus | undefined
    })
  ).slice(0, optionalNumber(query.limit) ?? 50);
  return ok({ appointments });
}

async function handleCreateAppointment(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  return created({
    appointment: await bookAppointment(request, context, appointmentInput(request))
  });
}

async function handleUpdateAppointment(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const appointmentId = pathUuid(request, "appointmentId");
  const status = stringValue(bodyRecord(request).status) as AppointmentStatus;
  if (status === "checked_in") {
    const { appointment } = await checkInAppointmentIdempotently(request, context, appointmentId);
    return ok({ appointment });
  }
  const appointment = await transitionAppointment(request, context, appointmentId, status);
  return ok({ appointment });
}

async function handleConfirmAppointment(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  return ok({
    appointment: await transitionAppointment(
      request,
      context,
      pathUuid(request, "appointmentId"),
      "confirmed"
    )
  });
}

async function handleCheckInAppointment(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  return ok(
    await checkInAppointmentIdempotently(request, context, pathUuid(request, "appointmentId"))
  );
}

async function handleMarkAppointmentNoShow(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  return ok({
    appointment: await transitionAppointment(
      request,
      context,
      pathUuid(request, "appointmentId"),
      "no_show"
    )
  });
}

async function handleListAppointmentTypes(
  _request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  return ok({ appointmentTypes: await context.repositories.scheduling.listAppointmentTypes() });
}

async function handleListChairs(
  _request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  return ok({ chairs: await context.repositories.scheduling.listChairs() });
}

async function handleListProviderSchedules(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const providerId = optionalString(requestRecord(request.parsed.query).providerId) as
    UUID | undefined;
  return ok({
    providerSchedules: await context.repositories.scheduling.listProviderSchedules(providerId)
  });
}

async function handleListQueue(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const date = requestClinicDay(request, context);
  const limit = optionalNumber(requestRecord(request.parsed.query).limit) ?? 50;
  return ok({
    queue: (await context.repositories.scheduling.listQueueEntries(date)).slice(0, limit)
  });
}

async function handleUpdateQueueEntry(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const queueEntryId = pathUuid(request, "queueEntryId");
  const status = stringValue(bodyRecord(request).status) as QueueStatus;
  const todaysQueue = await context.repositories.scheduling.listQueueEntries(
    requestClinicDay(request, context)
  );
  const existing = todaysQueue.find((entry) => entry.id === queueEntryId);
  if (!existing)
    throw notFound("Queue entry not found for the active clinic day.", {
      queue_entry_id: queueEntryId
    });
  if (existing.status === status) return ok({ queueEntry: existing });
  domainInvariant(() => assertFrontOfficeQueueTransition(existing.status, status));
  const queueEntry = await context.repositories.scheduling.updateQueueEntry(queueEntryId, status);
  if (!queueEntry) throw notFound("Queue entry not found.", { queue_entry_id: queueEntryId });
  await appendAudit(request, context, "queue.entry_updated", {
    patientId: queueEntry.patientId,
    resourceType: "queue_entry",
    resourceId: queueEntry.id,
    metadata: { fromStatus: existing.status, toStatus: queueEntry.status }
  });
  await appendOutbox(request, context, {
    eventType: status === "called" ? "queue.entry_called" : "queue.entry_updated",
    aggregateType: "queue_entry",
    aggregateId: queueEntry.id,
    patientId: queueEntry.patientId,
    payload: { queueEntryId: queueEntry.id, appointmentId: queueEntry.appointmentId, status }
  });
  return ok({ queueEntry });
}

async function handleGetMorningDashboard(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const date = requestClinicDay(request, context);
  const data = await context.repositories.clinicOperations.loadDashboardData(date);
  return ok({ dashboard: buildMorningDashboard({ date, ...data }) });
}

async function handleListIntakeFormTemplates(
  _request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  return ok({ templates: await context.repositories.clinicalCare.listIntakeFormTemplates() });
}

async function handleCreateIntakeFormTemplate(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const body = bodyRecord(request);
  const input: CreateIntakeFormTemplateInput = {
    code: stringValue(body.code),
    displayName: stringValue(body.displayName),
    formType: stringValue(body.formType) as CreateIntakeFormTemplateInput["formType"],
    version: optionalNumber(body.version) ?? 1,
    schema: recordValue(body.schema),
    active: optionalBoolean(body.active) ?? true
  };
  return created({
    template: await context.repositories.clinicalCare.createIntakeFormTemplate(input)
  });
}

async function handleSubmitPatientIntakeForm(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const patientId = pathUuid(request, "patientId");
  const patient = await context.repositories.patientAdministration.findPatientById(patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });
  const body = bodyRecord(request);
  const input: CreateIntakeFormSubmissionInput = {
    patientId,
    templateId: stringValue(body.templateId) as UUID,
    source: (optionalString(body.source) ?? "digital") as CreateIntakeFormSubmissionInput["source"],
    responses: recordValue(body.responses),
    medicalHistorySnapshot: optionalRecord(body.medicalHistorySnapshot) ?? {},
    provenance: optionalRecord(body.provenance) ?? {}
  };
  const template = await context.repositories.clinicalCare.findIntakeFormTemplateById(
    input.templateId
  );
  if (!template || !template.active)
    throw notFound("Active intake form template not found.", { template_id: input.templateId });
  const submission = await context.repositories.clinicalCare.createIntakeFormSubmission(input);
  await appendAudit(request, context, "form_response.submitted", {
    patientId,
    resourceType: "form_response",
    resourceId: submission.id,
    metadata: { templateId: input.templateId, source: input.source }
  });
  await appendOutbox(request, context, {
    eventType: "form_response.submitted",
    aggregateType: "form_response",
    aggregateId: submission.id,
    patientId,
    payload: {
      formResponseId: submission.id,
      patientId,
      templateId: input.templateId,
      source: input.source
    }
  });
  return created({ formResponse: submission, submission });
}

async function handleGetPatientPrepSummary(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
) {
  const patientId = pathUuid(request, "patientId");
  const patient = await context.repositories.patientAdministration.findPatientById(patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });
  const appointmentId = optionalString(requestRecord(request.parsed.query).appointmentId) as
    UUID | undefined;
  const appointment = appointmentId
    ? await context.repositories.scheduling.findAppointmentById(appointmentId)
    : null;
  if (appointmentId && !appointment)
    throw notFound("Appointment not found.", { appointment_id: appointmentId });
  if (appointment && appointment.patientId !== patientId) {
    throw conflict("Appointment does not belong to the requested patient.", {
      appointment_id: appointment.id
    });
  }
  const [timeline, intakeSubmissions, consents, consentEnforcementState] = await Promise.all([
    context.repositories.patientAdministration.findPatientTimeline(patientId),
    context.repositories.clinicalCare.listPatientIntakeFormSubmissions(patientId),
    context.repositories.clinicalCare.listPatientConsents(patientId),
    context.repositories.clinicalCare.getConsentEnforcementState(patientId)
  ]);
  const latestIntakeResponse =
    [...intakeSubmissions].sort((left, right) =>
      right.submittedAt.localeCompare(left.submittedAt)
    )[0] ?? null;
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
    generatedAt: nowIso(context),
    latestIntakeResponse,
    consentEnforcementState,
    activeConsentPurposes: consents
      .filter((consent) => consent.status === "active")
      .map((consent) => consent.purpose)
      .sort(),
    timelineHighlights: timeline.slice(0, 10),
    priorClinicalTimeline: timeline.filter(
      (item) =>
        item.itemType.startsWith("encounter_") ||
        item.itemType.startsWith("clinical_note_") ||
        item.itemType.startsWith("prescription_") ||
        item.itemType.startsWith("dental_")
    ),
    medicalHistoryChangePromptRequired:
      latestIntakeResponse === null ||
      Object.keys(latestIntakeResponse.medicalHistorySnapshot).length === 0,
    dataCoverage: {
      appointment: "available",
      consent: "available",
      intake: "available",
      timeline: "available"
    }
  };
  await appendAudit(request, context, "clinical_prep.viewed", {
    patientId,
    resourceType: "patient",
    resourceId: patientId,
    metadata: {
      appointmentId: appointment?.id ?? null,
      latestIntakeResponseId: prepSummary.latestIntakeResponse?.id ?? null
    }
  });
  return ok({
    prepSummary: publicPrepSummary(prepSummary),
    summary: publicPrepSummary(prepSummary)
  });
}

async function bookAppointment(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext,
  input: CreateAppointmentInput & { allowConflictOverride: boolean }
): Promise<AppointmentRecord> {
  if (input.allowConflictOverride) {
    throw conflict(
      "Appointment conflict override is unavailable because durable scheduling constraints cannot honor it safely.",
      { allow_conflict_override: false }
    );
  }
  const patient = await context.repositories.patientAdministration.findPatientById(input.patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: input.patientId });
  if (input.leadId) {
    const lead = await context.repositories.patientAdministration.findLeadById(input.leadId);
    if (!lead) throw notFound("Lead not found.", { lead_id: input.leadId });
    if (lead.patientId !== input.patientId)
      throw conflict("Lead is not matched to the appointment patient.", { lead_id: lead.id });
  }
  const [appointmentTypes, chairs, providerSchedules] = await Promise.all([
    context.repositories.scheduling.listAppointmentTypes(),
    context.repositories.scheduling.listChairs(),
    context.repositories.scheduling.listProviderSchedules(input.providerUserId)
  ]);
  const scope = {
    tenantId: request.access.context.tenant.id,
    clinicId: request.access.clinicId
  };
  const appointmentType = appointmentTypes.find(
    (candidate) =>
      candidate.id === input.appointmentTypeId &&
      candidate.active &&
      candidate.tenantId === scope.tenantId &&
      candidate.clinicId === scope.clinicId
  );
  if (!appointmentType) {
    throw notFound("Active appointment type not found in the verified clinic scope.", {
      appointment_type_id: input.appointmentTypeId
    });
  }
  if (input.chairId) {
    const chair = chairs.find(
      (candidate) =>
        candidate.id === input.chairId &&
        candidate.active &&
        candidate.tenantId === scope.tenantId &&
        candidate.clinicId === scope.clinicId
    );
    if (!chair) {
      throw notFound("Active chair not found in the verified clinic scope.", {
        chair_id: input.chairId
      });
    }
  }
  const providerAvailable = providerSchedules.some(
    (schedule) =>
      schedule.providerUserId === input.providerUserId &&
      schedule.tenantId === scope.tenantId &&
      schedule.clinicId === scope.clinicId &&
      providerScheduleCoversAppointment(schedule, {
        startAt: input.startAt,
        endAt: input.endAt,
        clinicTimeZone: request.access.clinic.timezone
      })
  );
  if (!providerAvailable) {
    throw conflict("Provider is not actively scheduled for the requested clinic-local window.", {
      provider_user_id: input.providerUserId,
      clinic_local_date: appointmentClinicLocalDate(input.startAt, request.access.clinic.timezone)
    });
  }
  const conflicts = await context.repositories.scheduling.findAppointmentConflicts({
    providerUserId: input.providerUserId,
    chairId: input.chairId ?? null,
    startAt: input.startAt,
    endAt: input.endAt
  });
  if (conflicts.length > 0) {
    throw conflict("Appointment conflicts with an existing booking.", { conflicts });
  }
  const { allowConflictOverride: _override, ...createInput } = input;
  const appointment = await context.repositories.scheduling.createAppointment(createInput);
  await appendAudit(request, context, "appointment.created", {
    patientId: appointment.patientId,
    resourceType: "appointment",
    resourceId: appointment.id,
    metadata: {
      source: appointment.source,
      status: appointment.status,
      conflictOverride: false
    }
  });
  await appendOutbox(request, context, {
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
      status: appointment.status,
      conflictOverride: false
    }
  });
  await appendOutbox(request, context, {
    eventType: "appointment.confirmation_requested",
    aggregateType: "appointment",
    aggregateId: appointment.id,
    patientId: appointment.patientId,
    payload: { appointmentId: appointment.id, taskType: "confirmation" }
  });
  return appointment;
}

async function transitionAppointment(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext,
  appointmentId: UUID,
  status: AppointmentStatus
): Promise<AppointmentRecord> {
  const existing = await context.repositories.scheduling.findAppointmentById(appointmentId);
  if (!existing) throw notFound("Appointment not found.", { appointment_id: appointmentId });
  if (existing.status === status) return existing;
  domainInvariant(() => assertFrontOfficeAppointmentTransition(existing.status, status));
  const appointment = await context.repositories.scheduling.updateAppointmentStatus(
    appointmentId,
    status
  );
  if (!appointment) throw notFound("Appointment not found.", { appointment_id: appointmentId });
  const action: KnownAuditAction =
    status === "confirmed"
      ? "appointment.confirmed"
      : status === "checked_in"
        ? "patient.checked_in"
        : status === "no_show"
          ? "appointment.no_show"
          : "appointment.updated";
  const eventType: DomainEventType =
    status === "confirmed"
      ? "appointment.confirmed"
      : status === "checked_in"
        ? "patient.checked_in"
        : status === "no_show"
          ? "appointment.no_show"
          : status === "cancelled"
            ? "appointment.cancelled"
            : "appointment.updated";
  await appendAudit(request, context, action, {
    patientId: appointment.patientId,
    resourceType: "appointment",
    resourceId: appointment.id,
    metadata: { fromStatus: existing.status, toStatus: status }
  });
  await appendOutbox(request, context, {
    eventType,
    aggregateType: "appointment",
    aggregateId: appointment.id,
    patientId: appointment.patientId,
    payload: {
      appointmentId: appointment.id,
      patientId: appointment.patientId,
      fromStatus: existing.status,
      toStatus: status
    }
  });
  return appointment;
}

async function checkInAppointmentIdempotently(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext,
  appointmentId: UUID
) {
  const existing = await context.repositories.scheduling.findAppointmentById(appointmentId);
  if (!existing) throw notFound("Appointment not found.", { appointment_id: appointmentId });
  const activeQueueDay = requestClinicDay(request, context);
  const appointmentDay = appointmentClinicLocalDate(
    existing.startAt,
    request.access.clinic.timezone
  );
  if (appointmentDay !== activeQueueDay) {
    throw conflict("Appointment clinic-local date does not match the active queue day.", {
      appointment_id: appointmentId,
      appointment_date: appointmentDay,
      active_queue_date: activeQueueDay
    });
  }
  const durableIntegrity = context.repositories.durableIntegrity;
  if (durableIntegrity) {
    const result = await durableIntegrity.checkInAppointmentWithQueue(appointmentId, "arrived");
    if (result.outcome === "not_found" || !result.appointment) {
      throw notFound("Appointment not found.", { appointment_id: appointmentId });
    }
    if (result.outcome === "invalid_state" || !result.queueEntry) {
      throw conflict("Appointment cannot be checked in from its current durable state.", {
        appointment_id: appointmentId,
        appointment_status: result.appointment.status
      });
    }
    if (result.appointmentStatusChanged) {
      await appendAudit(request, context, "patient.checked_in", {
        patientId: result.appointment.patientId,
        resourceType: "appointment",
        resourceId: result.appointment.id,
        metadata: { toStatus: "checked_in", atomicQueuePreserved: true }
      });
      await appendOutbox(request, context, {
        eventType: "patient.checked_in",
        aggregateType: "appointment",
        aggregateId: result.appointment.id,
        patientId: result.appointment.patientId,
        payload: {
          appointmentId: result.appointment.id,
          patientId: result.appointment.patientId,
          toStatus: "checked_in"
        }
      });
    }
    if (result.queueEntryCreated) {
      await appendAudit(request, context, "queue.entry_created", {
        patientId: result.appointment.patientId,
        resourceType: "queue_entry",
        resourceId: result.queueEntry.id,
        metadata: { appointmentId: result.appointment.id }
      });
      await appendOutbox(request, context, {
        eventType: "queue.entry_created",
        aggregateType: "queue_entry",
        aggregateId: result.queueEntry.id,
        patientId: result.appointment.patientId,
        payload: {
          queueEntryId: result.queueEntry.id,
          appointmentId: result.appointment.id
        }
      });
    }
    return { appointment: result.appointment, queueEntry: result.queueEntry };
  }
  if (existing.status === "checked_in") {
    const queue = await context.repositories.scheduling.listQueueEntries(activeQueueDay);
    const queueEntry = queue.find((entry) => entry.appointmentId === appointmentId);
    if (!queueEntry) {
      throw conflict("Checked-in appointment is missing its atomic queue entry.", {
        appointment_id: appointmentId,
        reconciliation_required: true
      });
    }
    return { appointment: existing, queueEntry };
  }
  const appointment = await transitionAppointment(request, context, appointmentId, "checked_in");
  const queueEntry = await ensureQueueEntry(request, context, appointment);
  return { appointment, queueEntry };
}

async function ensureQueueEntry(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext,
  appointment: AppointmentRecord
) {
  const queueEntry = await context.repositories.scheduling.createQueueEntry(appointment);
  await appendAudit(request, context, "queue.entry_created", {
    patientId: appointment.patientId,
    resourceType: "queue_entry",
    resourceId: queueEntry.id,
    metadata: { appointmentId: appointment.id }
  });
  await appendOutbox(request, context, {
    eventType: "queue.entry_created",
    aggregateType: "queue_entry",
    aggregateId: queueEntry.id,
    patientId: appointment.patientId,
    payload: { queueEntryId: queueEntry.id, appointmentId: appointment.id }
  });
  return queueEntry;
}

function appointmentInput(
  request: ClinicFeatureOperationRequest,
  defaults: Partial<CreateAppointmentInput> = {}
): CreateAppointmentInput & { allowConflictOverride: boolean } {
  const body = bodyRecord(request);
  const window = resolveAppointmentWindow({
    startAt: stringValue(body.startAt),
    endAt: optionalString(body.endAt),
    durationMinutes: optionalNumber(body.durationMinutes)
  });
  return {
    patientId: defaults.patientId ?? (stringValue(body.patientId) as UUID),
    leadId: defaults.leadId ?? (optionalNullableString(body.leadId) as UUID | null | undefined),
    providerUserId: stringValue(body.providerUserId) as UUID,
    appointmentTypeId: stringValue(body.appointmentTypeId) as UUID,
    chairId: optionalNullableString(body.chairId) as UUID | null | undefined,
    status: (optionalString(body.status) ?? defaults.status ?? "booked") as AppointmentStatus,
    ...window,
    source: defaults.source ?? ((optionalString(body.source) ?? "manual") as LeadSource),
    reason: optionalNullableString(body.reason),
    notes: optionalNullableString(body.notes),
    allowConflictOverride: optionalBoolean(body.allowConflictOverride) ?? false
  };
}

async function recordLeadMatch(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext,
  lead: LeadRecord,
  patientId: UUID,
  createdPatient: boolean
) {
  await appendAudit(request, context, "lead.matched_to_patient", {
    patientId,
    resourceType: "lead",
    resourceId: lead.id,
    metadata: { source: lead.source, createdPatient }
  });
  await appendOutbox(request, context, {
    eventType: "lead.matched_to_patient",
    aggregateType: "lead",
    aggregateId: lead.id,
    patientId,
    payload: { leadId: lead.id, patientId, createdPatient }
  });
}

async function appendAudit(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext,
  action: KnownAuditAction,
  input: {
    patientId?: UUID | null;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const event = createAuditEvent({
    tenantId: request.access.context.tenant.id,
    clinicId: request.access.clinicId,
    actor: { type: "user", id: request.access.context.user.id },
    action,
    patientId: input.patientId ?? null,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    metadata: input.metadata,
    ipAddress: request.metadata.ipAddress,
    userAgent: request.metadata.userAgent,
    correlationId: request.metadata.requestId,
    occurredAt: context.clock.now()
  });
  const {
    tenantId: _tenantId,
    clinicId: _clinicId,
    actorType: _actorType,
    actorId: _actorId,
    ...scopedEvent
  } = event;
  await context.evidence.appendAuditEvent(scopedEvent);
}

async function appendOutbox(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext,
  input: {
    eventType: DomainEventType;
    aggregateType: string;
    aggregateId: UUID;
    patientId?: UUID | null;
    payload: Record<string, unknown>;
  }
) {
  await context.evidence.appendOutboxEvent({
    ...input,
    idempotencyKey:
      optionalString(requestRecord(request.parsed.headers)["idempotency-key"]) ?? null,
    correlationId: request.metadata.requestId,
    occurredAt: nowIso(context)
  });
}

function publicTimelineItem(item: PatientTimelineItem) {
  return {
    id: item.id,
    patientId: item.patientId,
    itemType: publicTimelineCategory(item.itemType),
    eventType: TIMELINE_EVENT_TYPES[item.itemType],
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

function publicTimelineCategory(itemType: PatientTimelineItem["itemType"]): string {
  if (itemType.startsWith("appointment")) return "appointment";
  if (itemType.startsWith("attribution")) return "attribution";
  if (itemType.startsWith("lead")) return "lead";
  if (itemType.startsWith("queue") || itemType === "patient_checked_in") return "queue";
  if (itemType.startsWith("consent")) return "consent";
  if (itemType.includes("dental")) return "dental";
  if (itemType.startsWith("treatment_plan")) return "treatment_plan";
  if (itemType === "procedure_completed") return "procedure";
  if (itemType.startsWith("prescription")) return "prescription";
  if (itemType.startsWith("instruction")) return "instruction";
  if (itemType === "media_uploaded") return "media";
  if (itemType.startsWith("invoice")) return "invoice";
  if (itemType.startsWith("payment")) return "payment";
  if (itemType.startsWith("receipt")) return "receipt";
  if (itemType.startsWith("lab_case")) return "lab";
  if (itemType.startsWith("incident") || itemType.startsWith("corrective_action")) return "quality";
  if (
    itemType.includes("clinical_note") ||
    itemType.includes("encounter") ||
    itemType === "form_response_submitted"
  )
    return "clinical_note";
  if (itemType.startsWith("patient")) return "patient";
  return "task";
}

const TIMELINE_EVENT_TYPES: Readonly<Record<PatientTimelineItem["itemType"], DomainEventType>> = {
  patient_created: "patient.created",
  attribution_touch_created: "attribution.touch.created",
  lead_created: "lead.created",
  lead_matched: "lead.matched_to_patient",
  appointment_created: "appointment.created",
  appointment_confirmed: "appointment.confirmed",
  patient_checked_in: "patient.checked_in",
  queue_entry_created: "queue.entry_created",
  appointment_no_show: "appointment.no_show",
  task_created: "task.created",
  task_status_changed: "task.status_changed",
  task_completed: "task.completed",
  recall_due: "recall.due",
  recall_action_recorded: "recall.action_recorded",
  form_response_submitted: "form_response.submitted",
  consent_created: "consent.created",
  consent_revoked: "consent.revoked",
  encounter_created: "encounter.created",
  encounter_started: "encounter.started",
  encounter_completed: "encounter.completed",
  clinical_note_draft_created: "clinical_note.draft_created",
  clinical_note_signed: "clinical_note.signed",
  clinical_note_amended: "clinical_note.amended",
  dental_finding_created: "dental.finding.created",
  dental_finding_updated: "dental.finding.updated",
  dental_chart_snapshot_created: "dental.chart.snapshot_created",
  treatment_plan_created: "treatment_plan.created",
  treatment_plan_accepted: "treatment_plan.accepted",
  procedure_completed: "procedure.completed",
  invoice_created: "invoice.created",
  payment_recorded: "payment.succeeded",
  receipt_generated: "receipt.generated",
  prescription_draft_created: "prescription.draft_created",
  prescription_signed: "prescription.signed",
  instruction_print_requested: "instruction.print_requested",
  instruction_send_requested: "instruction.send_requested",
  media_uploaded: "media.upload_completed",
  payment_requested: "payment.requested",
  payment_succeeded: "payment.succeeded",
  payment_manually_recorded: "payment.manually_recorded",
  payment_reconciliation_required: "payment.reconciliation_required",
  lab_case_created: "lab_case.created",
  lab_case_sent: "lab_case.sent",
  lab_case_returned: "lab_case.returned",
  lab_case_completed: "lab_case.completed",
  incident_created: "incident.created",
  corrective_action_created: "corrective_action.created",
  corrective_action_completed: "corrective_action.completed",
  ai_session_started: "ai.session.started",
  ai_draft_generated: "ai.draft.generated",
  ai_review_decision_recorded: "ai.review_decision.recorded",
  ai_retention_deleted: "ai.retention.deleted"
};

function publicPrepSummary(summary: {
  timelineHighlights: readonly PatientTimelineItem[];
  priorClinicalTimeline: readonly PatientTimelineItem[];
  [key: string]: unknown;
}) {
  return {
    ...summary,
    timelineHighlights: summary.timelineHighlights.map(publicTimelineItem),
    priorClinicalTimeline: summary.priorClinicalTimeline.map(publicTimelineItem)
  };
}

function requestClinicDay(
  request: ClinicFeatureOperationRequest,
  context: ClinicFeatureExecutionContext
): string {
  return resolveClinicDay({
    requestedDate: optionalString(requestRecord(request.parsed.query).date),
    clock: context.clock,
    clinicTimeZone: request.access.clinic.timezone
  });
}

function pathUuid(request: ClinicFeatureOperationRequest, key: string): UUID {
  return stringValue(requestRecord(request.parsed.path)[key]) as UUID;
}

function bodyUuid(request: ClinicFeatureOperationRequest, key: string): UUID {
  return stringValue(bodyRecord(request)[key]) as UUID;
}

function bodyRecord(request: ClinicFeatureOperationRequest): Readonly<Record<string, JsonValue>> {
  return requestRecord(request.parsed.body);
}

function requestRecord(
  value: JsonValue | Uint8Array | undefined
): Readonly<Record<string, JsonValue>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || value instanceof Uint8Array) {
    throw new ApiError(
      500,
      "CONFIGURATION_ERROR",
      "Parsed front-office request shape is unavailable."
    );
  }
  return value as Readonly<Record<string, JsonValue>>;
}

function recordValue(value: JsonValue | undefined): Record<string, unknown> {
  return { ...requestRecord(value) };
}

function optionalRecord(value: JsonValue | undefined): Record<string, unknown> | undefined {
  return value === undefined ? undefined : recordValue(value);
}

function stringValue(value: JsonValue | undefined): string {
  if (typeof value !== "string")
    throw new ApiError(500, "CONFIGURATION_ERROR", "Parsed string field is unavailable.");
  return value;
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return value === undefined ? undefined : stringValue(value);
}

function optionalNullableString(value: JsonValue | undefined): string | null | undefined {
  return value === null ? null : optionalString(value);
}

function optionalNumber(value: JsonValue | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number")
    throw new ApiError(500, "CONFIGURATION_ERROR", "Parsed number field is unavailable.");
  return value;
}

function optionalBoolean(value: JsonValue | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean")
    throw new ApiError(500, "CONFIGURATION_ERROR", "Parsed boolean field is unavailable.");
  return value;
}

function toLeadSource(source: PatientSource): LeadSource | null {
  return source === "imported" || source === "external_system" ? null : source;
}

function domainInvariant(operation: () => void): void {
  try {
    operation();
  } catch (error) {
    throw conflict(
      error instanceof Error ? error.message : "Front-office state transition is invalid."
    );
  }
}

function nowIso(context: ClinicFeatureExecutionContext): string {
  return context.clock.now().toISOString();
}

function ok(body: unknown) {
  return { status: 200, body };
}

function created(body: unknown) {
  return { status: 201, body };
}

function notFound(message: string, details: Record<string, unknown>) {
  return new ApiError(404, "NOT_FOUND", message, details);
}

function conflict(message: string, details: Record<string, unknown> = {}) {
  return new ApiError(409, "CONFLICT", message, details);
}
