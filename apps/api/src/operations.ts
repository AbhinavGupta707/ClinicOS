import { randomUUID } from "node:crypto";
import {
  assertAuthorized,
  roleSlugsForScope,
  type AccessContext,
  type AuthorizationRequest
} from "@clinic-os/auth";
import type {
  ClinicOperationsRepository,
  CreateAppointmentInput,
  CreateConsentInput,
  CreateDentalChartSnapshotInput,
  CreateEncounterInput,
  CreateInvoiceInput,
  CreateIntakeFormSubmissionInput,
  CreateIntakeFormTemplateInput,
  CreateLeadInput,
  CreatePatientInput,
  CreatePatientInstructionInput,
  CreateProcedurePerformedInput,
  CreatePrescriptionInput,
  CreateReceiptInput,
  CreateTreatmentPlanInput,
  RepositoryScope,
  UpdateDentalFindingRepositoryInput,
  UpdateTreatmentPlanInput
} from "@clinic-os/db";
import {
  assertAppointmentTransition,
  assertEncounterTransition,
  assertMediaMimeType,
  assertManualPaymentEvidence,
  assertPrescriptionMedicationList,
  assertLeadTransition,
  assertPatientCreateMinimum,
  applyPaymentToInvoice,
  buildOwnerDashboardProjection,
  buildMorningDashboard,
  buildPatientDuplicateSuggestions,
  calculateBillingLineTotals,
  calculateEndAt,
  hasClinicalNoteContent,
  isAppointmentStatus,
  isBillingCurrency,
  isConsentCaptureMethod,
  isConsentPurpose,
  isDentalFindingReviewStatus,
  isDentalFindingSource,
  isDentalFindingStatus,
  isDentalFindingType,
  isEncounterStatus,
  isIntakeFormType,
  isIntakeSubmissionSource,
  isPatientInstructionChannel,
  isMediaScanStatus,
  isMediaType,
  isTreatmentPlanStatus,
  isManualPaymentMethod,
  isValidLeadStatus,
  mediaAssetCanBeViewed,
  isUuid,
  toPublicMediaAsset,
  toPublicMediaUploadReservation,
  type AppointmentRecord,
  type AppointmentStatus,
  type ClinicalNoteContent,
  type ConsentCaptureMethod,
  type ConsentPurpose,
  type CreateDentalFindingInput,
  type DomainEventType,
  type EncounterStatus,
  type IntakeFormType,
  type IntakeSubmissionSource,
  type InvoiceDetail,
  type LeadIntent,
  type LeadSource,
  type LeadStatus,
  type MediaScanStatus,
  type MediaType,
  type ManualPaymentMethod,
  type PaymentProviderKey as BillingPaymentProviderKey,
  type PaymentRequestRecord,
  type PaymentRequestType,
  type PaymentTransactionRecord,
  type PatientTimelineItem as DomainPatientTimelineItem,
  type PatientInstructionRecord,
  type PatientSource,
  type PricebookProcedureRecord,
  type PrescriptionMedication,
  type QueueStatus,
  type TreatmentPlanDetail,
  type UUID
} from "@clinic-os/domain";
import {
  PaymentProviderError,
  type PaymentProvider,
  type PaymentProviderRequestKind,
  type PaymentProviderRequestResult,
  type PaymentProviderWebhookEvent,
  type RawPaymentWebhook
} from "@clinic-os/integrations";
import {
  createAuditEvent,
  type AuditEventRecord,
  type KnownAuditAction
} from "@clinic-os/security";
import { ApiError } from "./errors.ts";
import type { MediaStorageProvider } from "./media-storage.ts";

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
  mediaStorage?: MediaStorageProvider;
  paymentProvider?: PaymentProvider;
  paymentRepository?: PaymentOperationsRepository;
}

const SYSTEM_INTEGRATION_ACTOR_USER_ID = "00000000-0000-4000-8000-000000000000" as UUID;

export interface ApiSuccess<T> {
  status: number;
  body: T;
}

export type ApiPaymentState =
  | "payment_requested"
  | "qr_created"
  | "link_created"
  | "partially_paid"
  | "paid"
  | "failed"
  | "reconciliation_required"
  | "manually_recorded";

export interface PaymentRouteInvoiceRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  invoiceNumber: string;
  paymentState: ApiPaymentState;
  totalAmountPaise: number;
  amountPaidPaise: number;
  amountDuePaise: number;
  currency: string;
  updatedAt: string;
}

export interface PaymentRouteRequestRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  invoiceId: UUID;
  requestType: PaymentProviderRequestKind;
  status: "created" | "sent" | "failed" | "cancelled" | "expired";
  providerKey: string;
  providerRequestId: string;
  amountPaise: number;
  currency: string;
  paymentUrl: string | null;
  qrImageUrl: string | null;
  qrString: string | null;
  expiresAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PaymentRouteTransactionRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  invoiceId: UUID;
  source: "provider_webhook" | "manual";
  status: "succeeded" | "failed" | "ignored_duplicate" | "reconciliation_required";
  providerKey: string | null;
  providerPaymentId: string | null;
  providerEventId: string | null;
  idempotencyKey: string;
  amountPaise: number;
  appliedAmountPaise: number;
  currency: string;
  method: string | null;
  recordedByUserId: UUID | null;
  auditReason: string | null;
  reference: string | null;
  receivedAt: string;
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface PaymentRouteReconciliationItemRecord {
  id: UUID;
  tenantId: UUID | null;
  clinicId: UUID | null;
  patientId: UUID | null;
  invoiceId: UUID | null;
  providerKey: string | null;
  providerPaymentId: string | null;
  providerEventId: string | null;
  reason:
    | "overpayment"
    | "duplicate_provider_transaction"
    | "missing_invoice_reference"
    | "currency_mismatch"
    | "provider_failure"
    | "manual_review_required";
  amountPaise: number;
  currency: string | null;
  status: "open" | "resolved";
  createdAt: string;
  metadata: Record<string, unknown>;
}

export interface PaymentWebhookReceiptRecord {
  id: UUID;
  providerKey: string;
  providerEventId: string | null;
  receivedAt: string;
  status: "received" | "verified" | "rejected" | "processed";
  rawBodySha256: string;
}

export interface PaymentProviderWebhookApplicationResult {
  status: "processed" | "duplicate" | "ignored" | "reconciliation_required";
  invoice: PaymentRouteInvoiceRecord | null;
  transaction: PaymentRouteTransactionRecord | null;
  reconciliationItem: PaymentRouteReconciliationItemRecord | null;
  replayed: boolean;
}

export interface PaymentOperationsRepository {
  findPaymentInvoiceById(
    scope: RepositoryScope,
    invoiceId: UUID
  ): Promise<PaymentRouteInvoiceRecord | null>;
  createPaymentRequestFromProvider(
    scope: RepositoryScope,
    input: {
      invoice: PaymentRouteInvoiceRecord;
      providerResult: PaymentProviderRequestResult;
      createdByUserId: UUID;
    }
  ): Promise<{ invoice: PaymentRouteInvoiceRecord; paymentRequest: PaymentRouteRequestRecord }>;
  recordManualPayment(
    scope: RepositoryScope,
    input: {
      invoice: PaymentRouteInvoiceRecord;
      amountPaise: number;
      currency: string;
      method: ManualPaymentMethod;
      reason: string;
      reference: string;
      receivedAt: string;
      idempotencyKey: string;
      evidence: Record<string, unknown>;
    }
  ): Promise<{
    invoice: PaymentRouteInvoiceRecord;
    transaction: PaymentRouteTransactionRecord;
    reconciliationItem: PaymentRouteReconciliationItemRecord | null;
    replayed: boolean;
  }>;
  recordPaymentWebhookReceipt(input: {
    providerKey: string;
    providerEventId: string | null;
    receivedAt: string;
    headers: Record<string, string | undefined>;
    rawBody: string;
  }): Promise<PaymentWebhookReceiptRecord>;
  markPaymentWebhookReceiptRejected(
    receiptId: UUID,
    input: { reason: string; providerEventId?: string | null }
  ): Promise<void>;
  applyPaymentProviderWebhook(
    event: PaymentProviderWebhookEvent,
    input: { receiptId: UUID }
  ): Promise<PaymentProviderWebhookApplicationResult>;
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

const DOCTOR_ONLY_SIGNATURE_PERMISSIONS = new Set([
  "clinical.note.sign",
  "prescription.sign"
] as const);

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

export async function getPatientPrepSummary(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  input: { appointmentId?: UUID | null }
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "clinical.note.read" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);

  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  let appointment: AppointmentRecord | null = null;
  if (input.appointmentId) {
    appointment = await dependencies.repository.findAppointmentById(scope, input.appointmentId);
    if (!appointment) throw notFound("Appointment not found.", { appointment_id: input.appointmentId });
    if (appointment.patientId !== patientId) {
      throw validation("Appointment does not belong to the requested patient.", {
        appointment_id: appointment.id,
        patient_id: patientId
      });
    }
  }

  const [timelineItems, intakeSubmissions, consents, enforcementState] = await Promise.all([
    dependencies.repository.findPatientTimeline(scope, patientId),
    dependencies.repository.listPatientIntakeFormSubmissions(scope, patientId),
    dependencies.repository.listPatientConsents(scope, patientId),
    dependencies.repository.getConsentEnforcementState(scope, patientId)
  ]);
  const timeline = timelineItems.map(toPublicPatientTimelineItem);
  const latestIntake = intakeSubmissions[0] ?? null;
  const priorClinicalTimeline = timeline.filter((item) =>
    ["clinical_note", "prescription", "appointment"].includes(item.type)
  );
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
    generatedAt: new Date().toISOString(),
    latestIntakeResponse: latestIntake,
    consentEnforcementState: enforcementState,
    activeConsentPurposes: consents
      .filter((consent) => consent.status === "active")
      .map((consent) => consent.purpose)
      .sort(),
    timelineHighlights: timeline.slice(0, 10),
    priorClinicalTimeline,
    medicalHistoryChangePromptRequired: latestIntake
      ? Object.keys(latestIntake.medicalHistorySnapshot).length === 0
      : true,
    dataCoverage: {
      dentalMedia: "deferred_to_checkpoint_4",
      treatmentPlans: "deferred_to_checkpoint_5",
      labCases: "deferred_to_checkpoint_7",
      invoicesAndPayments: "deferred_to_checkpoint_5"
    }
  };

  await audit(context, dependencies, "clinical_prep.viewed", {
    patientId,
    resourceType: "patient",
    resourceId: patientId,
    metadata: {
      appointmentId: appointment?.id ?? null,
      latestIntakeResponseId: latestIntake?.id ?? null,
      timelineHighlights: timeline.length
    }
  });

  return ok({ prepSummary, summary: prepSummary });
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

export async function getOwnerDashboard(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  filter: { from?: string | null; to?: string | null }
) {
  authorize(context, { permission: "analytics.read" });
  const range = parseOwnerDashboardRange(filter);
  const data = await dependencies.repository.loadOwnerDashboardProjectionData(
    scopeFrom(context),
    range
  );
  const dashboard = buildOwnerDashboardProjection({
    from: range.startAt,
    to: range.endAt,
    generatedAt: new Date().toISOString(),
    data
  });

  await audit(context, dependencies, "owner_dashboard.viewed", {
    resourceType: "owner_dashboard",
    resourceId: context.clinicId,
    metadata: {
      from: range.startAt,
      to: range.endAt,
      sourceKeys: dashboard.dataSources.map((source) => source.key),
      revenueSources: dashboard.revenue.bySource.map((source) => source.source)
    }
  });

  return ok({ dashboard });
}

export async function listPricebookProcedures(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "billing.read" });
  const procedures = await dependencies.repository.listPricebookProcedures(scopeFrom(context));

  await audit(context, dependencies, "pricebook.procedure_catalog.viewed", {
    resourceType: "pricebook_procedure",
    resourceId: context.clinicId,
    metadata: { procedureCount: procedures.length }
  });

  return ok({ procedures: procedures.map(publicPricebookProcedure) });
}

export async function createPatientTreatmentPlan(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.write" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const input = parseCreateTreatmentPlan(body);
  const result = await billingRepositoryOperation(
    () => dependencies.repository.createTreatmentPlan(scope, patientId, input),
    { patient_id: patientId }
  );
  if (!result) throw notFound("Patient or encounter not found.", { patient_id: patientId });

  await audit(context, dependencies, "treatment_plan.created", {
    patientId,
    resourceType: "treatment_plan",
    resourceId: result.detail.treatmentPlan.id,
    metadata: treatmentPlanAuditMetadata(result.detail)
  });
  await appendOutbox(context, dependencies, {
    eventType: "treatment_plan.created",
    aggregateType: "treatment_plan",
    aggregateId: result.detail.treatmentPlan.id,
    patientId,
    payload: {
      treatmentPlanId: result.detail.treatmentPlan.id,
      patientId,
      status: result.detail.treatmentPlan.status,
      totalMinor: result.detail.treatmentPlan.totalMinor,
      itemCount: treatmentPlanItemCount(result.detail)
    }
  });

  return created({ treatmentPlan: publicTreatmentPlanDetail(result.detail) });
}

export async function updateTreatmentPlan(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  treatmentPlanId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.write" });
  const input = parseUpdateTreatmentPlan(body);
  const result = await billingRepositoryOperation(
    () =>
      dependencies.repository.updateTreatmentPlan(
        scopeFrom(context),
        treatmentPlanId,
        input
      ),
    { treatment_plan_id: treatmentPlanId }
  );
  if (!result) throw notFound("Treatment plan not found.", { treatment_plan_id: treatmentPlanId });

  await audit(context, dependencies, "treatment_plan.updated", {
    patientId: result.detail.treatmentPlan.patientId,
    resourceType: "treatment_plan",
    resourceId: result.detail.treatmentPlan.id,
    metadata: treatmentPlanAuditMetadata(result.detail)
  });

  return ok({ treatmentPlan: publicTreatmentPlanDetail(result.detail) });
}

export async function acceptTreatmentPlan(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  treatmentPlanId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.write" });
  const input = parseAcceptTreatmentPlan(body);
  const result = await billingRepositoryOperation(
    () =>
      dependencies.repository.acceptTreatmentPlan(
        scopeFrom(context),
        treatmentPlanId,
        input
      ),
    { treatment_plan_id: treatmentPlanId }
  );
  if (!result) throw notFound("Treatment plan not found.", { treatment_plan_id: treatmentPlanId });

  await audit(context, dependencies, "treatment_plan.accepted", {
    patientId: result.detail.treatmentPlan.patientId,
    resourceType: "treatment_plan",
    resourceId: result.detail.treatmentPlan.id,
    metadata: treatmentPlanAuditMetadata(result.detail)
  });
  await appendOutbox(context, dependencies, {
    eventType: "treatment_plan.accepted",
    aggregateType: "treatment_plan",
    aggregateId: result.detail.treatmentPlan.id,
    patientId: result.detail.treatmentPlan.patientId,
    payload: {
      treatmentPlanId: result.detail.treatmentPlan.id,
      patientId: result.detail.treatmentPlan.patientId,
      acceptedAt: result.detail.treatmentPlan.acceptedAt,
      totalMinor: result.detail.treatmentPlan.totalMinor
    }
  });

  return ok({ treatmentPlan: publicTreatmentPlanDetail(result.detail) });
}

export async function createEncounterProcedurePerformed(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "clinical.note.write" });
  const input = parseCreateProcedurePerformed(body);
  const result = await billingRepositoryOperation(
    () =>
      dependencies.repository.createProcedurePerformed(
        scopeFrom(context),
        encounterId,
        input
      ),
    {
      encounter_id: encounterId,
      treatment_plan_id: input.treatmentPlanId,
      treatment_plan_estimate_item_id: input.treatmentPlanEstimateItemId
    }
  );
  if (!result) throw notFound("Encounter or accepted treatment plan item not found.", {
    encounter_id: encounterId
  });

  await audit(context, dependencies, "procedure.completed", {
    patientId: result.procedure.patientId,
    resourceType: "procedure_performed",
    resourceId: result.procedure.id,
    metadata: {
      encounterId,
      treatmentPlanId: result.procedure.treatmentPlanId,
      estimateItemId: result.procedure.treatmentPlanEstimateItemId,
      totalMinor: result.procedure.totalMinor
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "procedure.completed",
    aggregateType: "procedure_performed",
    aggregateId: result.procedure.id,
    patientId: result.procedure.patientId,
    payload: {
      procedurePerformedId: result.procedure.id,
      encounterId,
      patientId: result.procedure.patientId,
      treatmentPlanId: result.procedure.treatmentPlanId,
      treatmentPlanEstimateItemId: result.procedure.treatmentPlanEstimateItemId
    }
  });

  return created({
    procedure: publicProcedurePerformed(result.procedure),
    treatmentPlan: publicTreatmentPlanDetail(result.treatmentPlan)
  });
}

export async function createInvoice(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "billing.write" });
  const input = parseCreateInvoice(body);
  const result = await billingRepositoryOperation(
    () => dependencies.repository.createInvoice(scopeFrom(context), input),
    {
      treatment_plan_id: input.treatmentPlanId ?? null,
      procedure_performed_ids: input.procedurePerformedIds ?? []
    }
  );
  if (!result) {
    throw conflict("Invoice requires completed, accepted, uninvoiced procedure evidence.", {
      treatment_plan_id: input.treatmentPlanId ?? null,
      procedure_performed_ids: input.procedurePerformedIds ?? []
    });
  }

  await audit(context, dependencies, "invoice.created", {
    patientId: result.invoiceDetail.invoice.patientId,
    resourceType: "invoice",
    resourceId: result.invoiceDetail.invoice.id,
    metadata: invoiceAuditMetadata(result.invoiceDetail)
  });
  await appendOutbox(context, dependencies, {
    eventType: "invoice.created",
    aggregateType: "invoice",
    aggregateId: result.invoiceDetail.invoice.id,
    patientId: result.invoiceDetail.invoice.patientId,
    payload: {
      invoiceId: result.invoiceDetail.invoice.id,
      invoiceNumber: result.invoiceDetail.invoice.invoiceNumber,
      patientId: result.invoiceDetail.invoice.patientId,
      totalMinor: result.invoiceDetail.invoice.totalMinor,
      procedurePerformedIds: result.procedures.map((procedure) => procedure.id)
    }
  });

  return created({ invoice: publicInvoiceDetail(result.invoiceDetail) });
}

export async function getInvoice(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  invoiceId: UUID
) {
  authorize(context, { permission: "billing.read" });
  const invoice = await dependencies.repository.findInvoiceById(scopeFrom(context), invoiceId);
  if (!invoice) throw notFound("Invoice not found.", { invoice_id: invoiceId });

  await audit(context, dependencies, "invoice.viewed", {
    patientId: invoice.invoice.patientId,
    resourceType: "invoice",
    resourceId: invoice.invoice.id,
    metadata: invoiceAuditMetadata(invoice)
  });

  return ok({ invoice: publicInvoiceDetail(invoice) });
}

export async function createInvoiceReceipt(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  invoiceId: UUID,
  body: unknown
) {
  authorize(context, { permission: "billing.write" });
  const input = parseCreateReceipt(body);
  const result = await billingRepositoryOperation(
    () => dependencies.repository.createReceipt(scopeFrom(context), invoiceId, input),
    {
      invoice_id: invoiceId,
      payment_transaction_ids: input.paymentTransactionIds ?? []
    }
  );
  if (!result) throw notFound("Invoice not found.", { invoice_id: invoiceId });

  await audit(context, dependencies, "receipt.generated", {
    patientId: result.receipt.patientId,
    resourceType: "receipt",
    resourceId: result.receipt.id,
    metadata: {
      invoiceId,
      receiptNumber: result.receipt.receiptNumber,
      amountMinor: result.receipt.amountMinor,
      paymentTransactionIds: result.receipt.paymentAllocations.map(
        (allocation) => allocation.paymentTransactionId
      )
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "receipt.generated",
    aggregateType: "receipt",
    aggregateId: result.receipt.id,
    patientId: result.receipt.patientId,
    payload: {
      receiptId: result.receipt.id,
      invoiceId,
      patientId: result.receipt.patientId,
      receiptNumber: result.receipt.receiptNumber,
      amountMinor: result.receipt.amountMinor
    }
  });

  return created({
    receipt: publicReceipt(result.receipt),
    invoice: publicInvoiceDetail(result.invoiceDetail)
  });
}

export async function listIntakeFormTemplates(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  authorize(context, { permission: "patient.read" });
  const templates = await dependencies.repository.listIntakeFormTemplates(scopeFrom(context));
  return ok({ templates });
}

export async function createIntakeFormTemplate(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "clinic.manage" });
  const template = await dependencies.repository.createIntakeFormTemplate(
    scopeFrom(context),
    parseCreateIntakeFormTemplate(body)
  );
  return created({ template });
}

export async function submitPatientIntakeForm(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "intake.write" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const input = parseCreateIntakeFormSubmission(body, patientId);
  const template = await dependencies.repository.findIntakeFormTemplateById(scope, input.templateId);
  if (!template || !template.active) {
    throw notFound("Intake form template not found.", { template_id: input.templateId });
  }

  const formResponse = await dependencies.repository.createIntakeFormSubmission(scope, input);

  await audit(context, dependencies, "form_response.submitted", {
    patientId,
    resourceType: "form_response",
    resourceId: formResponse.id,
    metadata: { templateId: input.templateId, source: input.source }
  });
  await appendOutbox(context, dependencies, {
    eventType: "form_response.submitted",
    aggregateType: "form_response",
    aggregateId: formResponse.id,
    patientId,
    payload: {
      formResponseId: formResponse.id,
      patientId,
      templateId: input.templateId,
      source: input.source
    }
  });

  return created({ formResponse, submission: formResponse });
}

export async function listPatientConsents(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const consents = await dependencies.repository.listPatientConsents(scope, patientId);
  const enforcementState = await dependencies.repository.getConsentEnforcementState(scope, patientId);

  await audit(context, dependencies, "consent.enforcement.checked", {
    patientId,
    resourceType: "consent",
    resourceId: patientId,
    metadata: {
      activePurposes: enforcementState.activePurposes,
      revokedPurposes: enforcementState.revokedPurposes
    }
  });

  return ok({ consents, enforcementState });
}

export async function createPatientConsent(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "intake.write" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const input = parseCreateConsent(body, patientId);
  const existing = await dependencies.repository.listPatientConsents(scope, patientId);
  const duplicateActiveConsent = existing.find(
    (consent) => consent.purpose === input.purpose && consent.status === "active"
  );
  if (duplicateActiveConsent) {
    throw conflict("An active consent already exists for this purpose.", {
      consent_id: duplicateActiveConsent.id,
      purpose: input.purpose
    });
  }

  const consent = await dependencies.repository.createConsent(scope, input);
  const enforcementState = await dependencies.repository.getConsentEnforcementState(scope, patientId);

  await audit(context, dependencies, "consent.created", {
    patientId,
    resourceType: "consent",
    resourceId: consent.id,
    metadata: { purpose: consent.purpose, captureMethod: consent.captureMethod }
  });
  await appendOutbox(context, dependencies, {
    eventType: "consent.created",
    aggregateType: "consent",
    aggregateId: consent.id,
    patientId,
    payload: {
      consentId: consent.id,
      patientId,
      purpose: consent.purpose,
      enforcementState
    }
  });

  return created({ consent, enforcementState });
}

export async function revokePatientConsent(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  consentId: UUID,
  body: unknown
) {
  authorize(context, { permission: "intake.write" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const existing = (await dependencies.repository.listPatientConsents(scope, patientId)).find(
    (consent) => consent.id === consentId
  );
  if (!existing) throw notFound("Consent not found.", { consent_id: consentId });
  if (existing.status !== "active") {
    throw conflict("Consent is already revoked.", { consent_id: consentId });
  }

  const consent = await dependencies.repository.revokeConsent(scope, consentId, {
    revocationReason: requiredString(objectBody(body).reason, "reason")
  });
  if (!consent) throw notFound("Consent not found.", { consent_id: consentId });

  const enforcementState = await dependencies.repository.getConsentEnforcementState(scope, patientId);

  await audit(context, dependencies, "consent.revoked", {
    patientId,
    resourceType: "consent",
    resourceId: consent.id,
    metadata: { purpose: consent.purpose, enforcementState }
  });
  await appendOutbox(context, dependencies, {
    eventType: "consent.revoked",
    aggregateType: "consent",
    aggregateId: consent.id,
    patientId,
    payload: {
      consentId: consent.id,
      patientId,
      purpose: consent.purpose,
      enforcementState
    }
  });

  return ok({ consent, enforcementState });
}

export async function createEncounter(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "clinical.note.write" });
  const scope = scopeFrom(context);
  const input = parseCreateEncounter(body);
  const patient = await dependencies.repository.findPatientById(scope, input.patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: input.patientId });

  if (input.appointmentId) {
    const appointment = await dependencies.repository.findAppointmentById(scope, input.appointmentId);
    if (!appointment) throw notFound("Appointment not found.", { appointment_id: input.appointmentId });
    if (appointment.patientId !== input.patientId) {
      throw validation("Appointment does not belong to the encounter patient.", {
        appointment_id: appointment.id,
        patient_id: input.patientId
      });
    }
  }

  const encounter = await dependencies.repository.createEncounter(scope, input);

  await audit(context, dependencies, "encounter.created", {
    patientId: encounter.patientId,
    resourceType: "encounter",
    resourceId: encounter.id,
    metadata: { appointmentId: encounter.appointmentId, providerUserId: encounter.providerUserId }
  });
  await appendOutbox(context, dependencies, {
    eventType: "encounter.created",
    aggregateType: "encounter",
    aggregateId: encounter.id,
    patientId: encounter.patientId,
    payload: { encounterId: encounter.id, patientId: encounter.patientId, status: encounter.status }
  });

  return created({ encounter });
}

export async function getEncounter(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID
) {
  authorize(context, { permission: "clinical.note.read" });
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  const noteVersions = await dependencies.repository.listClinicalNoteVersions(scope, encounterId);
  return ok({ encounter, noteVersions });
}

export async function startEncounter(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID
) {
  authorize(context, { permission: "clinical.note.write" });
  const scope = scopeFrom(context);
  const existing = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!existing) throw notFound("Encounter not found.", { encounter_id: encounterId });

  try {
    assertEncounterTransition(existing.status, "drafting");
  } catch (error) {
    throw conflict(error instanceof Error ? error.message : "Invalid encounter transition.", {
      encounter_id: encounterId,
      from_status: existing.status,
      to_status: "drafting"
    });
  }
  const encounter = await dependencies.repository.transitionEncounter(
    scope,
    encounterId,
    "drafting",
    "encounter_started"
  );
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  await audit(context, dependencies, "encounter.started", {
    patientId: encounter.patientId,
    resourceType: "encounter",
    resourceId: encounter.id,
    metadata: { appointmentId: encounter.appointmentId }
  });
  await appendOutbox(context, dependencies, {
    eventType: "encounter.started",
    aggregateType: "encounter",
    aggregateId: encounter.id,
    patientId: encounter.patientId,
    payload: { encounterId: encounter.id, patientId: encounter.patientId, status: encounter.status }
  });

  return ok({ encounter });
}

export async function saveEncounterClinicalNoteDraft(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID,
  body: unknown
) {
  authorize(context, { permission: "clinical.note.write" });
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });
  if (["signed", "amended", "closed", "cancelled"].includes(encounter.status)) {
    throw conflict("Signed or closed encounters cannot be edited through the draft endpoint.", {
      encounter_id: encounterId,
      status: encounter.status
    });
  }

  const input = parseSaveClinicalNoteDraft(body);
  if (!hasClinicalNoteContent(input.content)) {
    throw validation("Clinical note draft requires at least one note section.", {
      field: "content"
    });
  }

  const note = await dependencies.repository.saveClinicalNoteDraft(scope, encounterId, input);
  if (!note) {
    throw conflict("Clinical note draft could not be saved for this encounter state.", {
      encounter_id: encounterId,
      status: encounter.status
    });
  }
  const updatedEncounter = await dependencies.repository.findEncounterById(scope, encounterId);

  await audit(context, dependencies, "clinical_note.draft_created", {
    patientId: encounter.patientId,
    resourceType: "clinical_note",
    resourceId: note.id,
    metadata: { encounterId, readyForSign: input.readyForSign === true }
  });
  await appendOutbox(context, dependencies, {
    eventType: "clinical_note.draft_created",
    aggregateType: "clinical_note",
    aggregateId: note.id,
    patientId: encounter.patientId,
    payload: { encounterId, noteVersionId: note.id, versionNumber: note.versionNumber }
  });

  return ok({ encounter: updatedEncounter, note });
}

export async function signEncounterClinicalNote(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID
) {
  authorizeDoctorSignature(context, "clinical.note.sign");
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  const draft = (await dependencies.repository.listClinicalNoteVersions(scope, encounterId)).find(
    (note) => note.status === "draft"
  );
  if (!draft) {
    throw validation("Encounter does not have a draft clinical note to sign.", {
      encounter_id: encounterId
    });
  }
  if (!hasClinicalNoteContent(draft.content)) {
    throw validation("Clinical note content is required before signing.", {
      clinical_note_version_id: draft.id
    });
  }

  const result = await dependencies.repository.signClinicalNote(scope, encounterId);
  if (!result) throw notFound("Encounter not found.", { encounter_id: encounterId });

  await audit(context, dependencies, "clinical_note.signed", {
    patientId: result.note.patientId,
    resourceType: "clinical_note",
    resourceId: result.note.id,
    metadata: { encounterId, versionNumber: result.note.versionNumber }
  });
  await appendOutbox(context, dependencies, {
    eventType: "clinical_note.signed",
    aggregateType: "clinical_note",
    aggregateId: result.note.id,
    patientId: result.note.patientId,
    payload: { encounterId, noteVersionId: result.note.id, versionNumber: result.note.versionNumber }
  });

  return ok(result);
}

export async function amendEncounterClinicalNote(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID,
  body: unknown
) {
  authorizeDoctorSignature(context, "clinical.note.sign");
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  const input = parseAmendClinicalNote(body);
  if (!hasClinicalNoteContent(input.content)) {
    throw validation("Clinical note amendment requires at least one note section.", {
      field: "content"
    });
  }

  const result = await dependencies.repository.amendClinicalNote(scope, encounterId, input);
  if (!result) {
    throw conflict("Encounter does not have a signed note to amend.", {
      encounter_id: encounterId
    });
  }

  await audit(context, dependencies, "clinical_note.amended", {
    patientId: result.note.patientId,
    resourceType: "clinical_note",
    resourceId: result.note.id,
    metadata: {
      encounterId,
      versionNumber: result.note.versionNumber,
      amendedFromVersionId: result.amendedFrom.id
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "clinical_note.amended",
    aggregateType: "clinical_note",
    aggregateId: result.note.id,
    patientId: result.note.patientId,
    payload: {
      encounterId,
      noteVersionId: result.note.id,
      amendedFromVersionId: result.amendedFrom.id,
      versionNumber: result.note.versionNumber
    }
  });

  return ok(result);
}

export async function createEncounterPrescription(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID,
  body: unknown
) {
  authorize(context, { permission: "prescription.write" });
  const input = parseCreatePrescription(body);
  try {
    assertPrescriptionMedicationList(input.medications);
  } catch (error) {
    throw validation(error instanceof Error ? error.message : "Invalid prescription medications.", {
      field: "medications"
    });
  }
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  const prescription = await dependencies.repository.createPrescription(scope, encounterId, input);
  if (!prescription) throw notFound("Encounter not found.", { encounter_id: encounterId });

  await audit(context, dependencies, "prescription.draft_created", {
    patientId: prescription.patientId,
    resourceType: "prescription",
    resourceId: prescription.id,
    metadata: { encounterId, medicationCount: prescription.medications.length }
  });
  await appendOutbox(context, dependencies, {
    eventType: "prescription.draft_created",
    aggregateType: "prescription",
    aggregateId: prescription.id,
    patientId: prescription.patientId,
    payload: {
      prescriptionId: prescription.id,
      encounterId,
      patientId: prescription.patientId,
      medicationCount: prescription.medications.length
    }
  });

  return created({ prescription });
}

export async function signPrescription(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  prescriptionId: UUID
) {
  authorizeDoctorSignature(context, "prescription.sign");
  const scope = scopeFrom(context);
  const existing = await dependencies.repository.findPrescriptionById(scope, prescriptionId);
  if (!existing) throw notFound("Prescription not found.", { prescription_id: prescriptionId });
  if (existing.status !== "draft") {
    throw conflict("Prescription is already signed.", { prescription_id: prescriptionId });
  }

  const prescription = await dependencies.repository.signPrescription(scope, prescriptionId);
  if (!prescription) throw notFound("Prescription not found.", { prescription_id: prescriptionId });

  await audit(context, dependencies, "prescription.signed", {
    patientId: prescription.patientId,
    resourceType: "prescription",
    resourceId: prescription.id,
    metadata: { encounterId: prescription.encounterId, medicationCount: prescription.medications.length }
  });
  await appendOutbox(context, dependencies, {
    eventType: "prescription.signed",
    aggregateType: "prescription",
    aggregateId: prescription.id,
    patientId: prescription.patientId,
    payload: {
      prescriptionId: prescription.id,
      encounterId: prescription.encounterId,
      patientId: prescription.patientId,
      medicationCount: prescription.medications.length
    }
  });

  return ok({ prescription });
}

export async function createPatientInstruction(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient_instruction.write" });
  const input = parseCreatePatientInstruction(body);
  const outboxEventId = input.channel === "whatsapp" ? (randomUUID() as UUID) : null;
  const instruction = await dependencies.repository.createPatientInstruction(
    scopeFrom(context),
    patientId,
    {
      ...input,
      outboxEventId
    }
  );
  if (!instruction) throw notFound("Patient not found.", { patient_id: patientId });

  const eventType =
    instruction.channel === "print" ? "instruction.print_requested" : "instruction.send_requested";
  const payload = {
    instructionId: instruction.id,
    patientId,
    templateId: instruction.templateId,
    channel: instruction.channel,
    status: instruction.status,
    printJobId: instruction.printJobId,
    outboxEventId: instruction.outboxEventId,
    providerConfirmationReceived: false,
    providerDeliveryConfirmedAt: null,
    deliveredAt: null,
    readAt: null
  };

  await audit(context, dependencies, eventType, {
    patientId,
    resourceType: "patient_instruction",
    resourceId: instruction.id,
    metadata: payload
  });
  await appendOutbox(context, dependencies, {
    eventType,
    aggregateType: "patient_instruction",
    aggregateId: instruction.id,
    patientId,
    payload
  });

  const responseBody = { instruction: publicPatientInstruction(instruction) };
  return instruction.channel === "whatsapp" ? accepted(responseBody) : created(responseBody);
}

export async function getPatientDentalChart(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.read" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const view = await dependencies.repository.getDentalChart(scope, patientId);
  if (!view) throw notFound("Dental chart not found.", { patient_id: patientId });

  const history = await Promise.all(
    view.findings.map(async (finding) => ({
      findingId: finding.id,
      entries: (await dependencies.repository.listDentalFindingHistory(scope, finding.id)).map(
        publicDentalFindingHistory
      )
    }))
  );

  await audit(context, dependencies, "dental_chart.viewed", {
    patientId,
    resourceType: "dental_chart",
    resourceId: view.chart.id,
    metadata: {
      findingCount: view.findings.length,
      snapshotCount: view.snapshots.length,
      numberingSystem: publicDentalNumberingSystem(view.chart.numberingSystem)
    }
  });

  return ok({
    dentalChart: publicDentalChart(view.chart),
    findings: view.findings.map(publicDentalFinding),
    history,
    snapshots: view.snapshots.map(publicDentalChartSnapshot)
  });
}

export async function createPatientDentalFinding(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  const input = parseCreateDentalFinding(body);
  return createDentalFindingForPatient(context, dependencies, patientId, input);
}

export async function createEncounterDentalFinding(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  encounterId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.write" });
  const scope = scopeFrom(context);
  const encounter = await dependencies.repository.findEncounterById(scope, encounterId);
  if (!encounter) throw notFound("Encounter not found.", { encounter_id: encounterId });

  const input = parseCreateDentalFinding(body, { encounterId });
  return createDentalFindingForPatient(context, dependencies, encounter.patientId, input, {
    preauthorized: true
  });
}

export async function updateDentalFinding(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  findingId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.write" });
  const input = parseUpdateDentalFinding(body);
  const result = await dependencies.repository.updateDentalFinding(
    scopeFrom(context),
    findingId,
    input
  );
  if (!result) throw notFound("Dental finding not found.", { dental_finding_id: findingId });

  await audit(context, dependencies, "dental_finding.updated", {
    patientId: result.finding.patientId,
    resourceType: "dental_finding",
    resourceId: result.finding.id,
    metadata: dentalFindingAuditMetadata(result.finding)
  });
  await appendOutbox(context, dependencies, {
    eventType: "dental.finding.updated",
    aggregateType: "dental_finding",
    aggregateId: result.finding.id,
    patientId: result.finding.patientId,
    payload: {
      findingId: result.finding.id,
      patientId: result.finding.patientId,
      encounterId: result.finding.encounterId,
      toothNumber: result.finding.toothNumber,
      surface: result.finding.surface,
      findingType: result.finding.findingType,
      reviewStatus: result.finding.reviewStatus
    }
  });

  return ok({
    finding: publicDentalFinding(result.finding),
    history: publicDentalFindingHistory(result.history)
  });
}

export async function listDentalFindingHistory(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  findingId: UUID
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.read" });
  const history = await dependencies.repository.listDentalFindingHistory(
    scopeFrom(context),
    findingId
  );

  return ok({ history: history.map(publicDentalFindingHistory) });
}

export async function createDentalChartSnapshot(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  body: unknown
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "dental.chart.snapshot" });
  const input = parseDentalChartSnapshot(body);
  const snapshot = await dependencies.repository.createDentalChartSnapshot(
    scopeFrom(context),
    patientId,
    input
  );
  if (!snapshot) throw notFound("Patient or dental chart context not found.", { patient_id: patientId });

  await audit(context, dependencies, "dental_chart.snapshot_created", {
    patientId: snapshot.patientId,
    resourceType: "dental_chart_snapshot",
    resourceId: snapshot.id,
    metadata: {
      encounterId: snapshot.encounterId,
      snapshotVersion: snapshot.snapshotVersion,
      findingCount: snapshot.chartState.findingCount
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "dental.chart.snapshot_created",
    aggregateType: "dental_chart_snapshot",
    aggregateId: snapshot.id,
    patientId: snapshot.patientId,
    payload: {
      snapshotId: snapshot.id,
      patientId: snapshot.patientId,
      encounterId: snapshot.encounterId,
      snapshotVersion: snapshot.snapshotVersion,
      findingCount: snapshot.chartState.findingCount
    }
  });

  return created({ snapshot: publicDentalChartSnapshot(snapshot) });
}

export async function requestMediaUploadUrl(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  body: unknown
) {
  authorize(context, { permission: "media.write" });
  const storage = mediaStorageFrom(dependencies);
  const input = parseMediaUploadRequest(body);
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, input.patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: input.patientId });

  if (input.encounterId) {
    const encounter = await dependencies.repository.findEncounterById(scope, input.encounterId);
    if (!encounter) throw notFound("Encounter not found.", { encounter_id: input.encounterId });
    if (encounter.patientId !== input.patientId) {
      throw validation("Encounter does not belong to the media patient.", {
        encounter_id: encounter.id,
        patient_id: input.patientId
      });
    }
  }

  const uploadId = randomUUID() as UUID;
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const objectKey = storage.buildObjectKey({
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    patientId: input.patientId,
    uploadId,
    originalFilename: input.originalFilename
  });
  const reservation = await dependencies.repository.createMediaUploadReservation(scope, {
    id: uploadId,
    patientId: input.patientId,
    encounterId: input.encounterId,
    toothNumber: input.toothNumber,
    dentalFindingId: input.dentalFindingId,
    mediaType: input.mediaType,
    originalFilename: input.originalFilename,
    mimeType: input.mimeType,
    expectedFileSizeBytes: input.fileSizeBytes,
    expectedSha256Digest: input.sha256Digest,
    objectKey,
    storageProvider: storage.providerKey,
    storageRegion: storage.region,
    expiresAt,
    tags: input.tags,
    provenance: input.provenance
  });
  const uploadTarget = await storage.createUploadTarget({
    uploadId,
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    patientId: input.patientId,
    objectKey,
    mimeType: input.mimeType,
    expectedFileSizeBytes: input.fileSizeBytes,
    expectedSha256Digest: input.sha256Digest,
    expiresAt
  });

  await audit(context, dependencies, "media.upload_requested", {
    patientId: input.patientId,
    resourceType: "media_upload",
    resourceId: reservation.id,
    metadata: mediaAuditMetadata(reservation)
  });
  await appendOutbox(context, dependencies, {
    eventType: "media.upload_requested",
    aggregateType: "media_upload",
    aggregateId: reservation.id,
    patientId: input.patientId,
    payload: {
      uploadId: reservation.id,
      patientId: input.patientId,
      mediaType: input.mediaType,
      encounterId: input.encounterId,
      toothNumber: input.toothNumber,
      dentalFindingId: input.dentalFindingId
    }
  });

  return created({
    upload: toPublicMediaUploadReservation(reservation),
    uploadTarget
  });
}

export async function receiveMediaUploadContent(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  uploadId: UUID,
  input: { body: Buffer; contentType?: string | null }
) {
  authorize(context, { permission: "media.write" });
  const storage = mediaStorageFrom(dependencies);
  const reservation = await dependencies.repository.findMediaUploadReservationById(
    scopeFrom(context),
    uploadId
  );
  if (!reservation) throw notFound("Media upload reservation not found.", { upload_id: uploadId });
  assertMediaUploadOpen(reservation);
  if (input.body.byteLength !== reservation.expectedFileSizeBytes) {
    throw validation("Uploaded object size does not match the reserved media metadata.", {
      upload_id: uploadId,
      expected_bytes: reservation.expectedFileSizeBytes,
      received_bytes: input.body.byteLength
    });
  }
  const contentType = input.contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (contentType !== reservation.mimeType.toLowerCase()) {
    throw validation("Uploaded object content-type does not match the reserved media metadata.", {
      upload_id: uploadId,
      expected_mime_type: reservation.mimeType,
      received_mime_type: contentType || null
    });
  }

  const object = await storage.receiveUpload({
    objectKey: reservation.objectKey,
    body: input.body,
    mimeType: reservation.mimeType,
    metadata: {
      tenant_id: reservation.tenantId,
      clinic_id: reservation.clinicId,
      patient_id: reservation.patientId,
      upload_id: reservation.id
    }
  });
  if (
    reservation.expectedSha256Digest &&
    object.sha256Digest !== reservation.expectedSha256Digest
  ) {
    throw validation("Uploaded object digest does not match the reserved media metadata.", {
      upload_id: uploadId
    });
  }

  return ok({
    upload: toPublicMediaUploadReservation(reservation),
    object: {
      contentLength: object.contentLength,
      mimeType: object.mimeType,
      sha256Digest: object.sha256Digest,
      storedAt: object.storedAt
    }
  });
}

export async function completeMediaUpload(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  uploadId: UUID,
  body: unknown
) {
  authorize(context, { permission: "media.write" });
  const storage = mediaStorageFrom(dependencies);
  const input = parseCompleteMediaUpload(body);
  const scope = scopeFrom(context);
  const reservation = await dependencies.repository.findMediaUploadReservationById(scope, uploadId);
  if (!reservation) throw notFound("Media upload reservation not found.", { upload_id: uploadId });
  assertMediaUploadOpen(reservation);
  if (input.patientId !== reservation.patientId) {
    throw validation("Complete-upload patient context does not match the upload reservation.", {
      upload_id: uploadId,
      expected_patient_id: reservation.patientId,
      received_patient_id: input.patientId
    });
  }
  if ((input.encounterId ?? null) !== reservation.encounterId) {
    throw validation("Complete-upload encounter context does not match the upload reservation.", {
      upload_id: uploadId,
      expected_encounter_id: reservation.encounterId,
      received_encounter_id: input.encounterId ?? null
    });
  }

  const object = await storage.statObject(reservation.objectKey);
  if (!object) {
    throw conflict("Reserved media object has not been uploaded.", { upload_id: uploadId });
  }
  validateCompletedMediaObject(reservation, object, input);

  const asset = await dependencies.repository.completeMediaUpload(scope, uploadId, {
    contentLength: object.contentLength,
    sha256Digest: object.sha256Digest,
    objectVersion: input.objectVersion,
    scanStatus: input.scanStatus,
    quarantineReason: input.quarantineReason,
    dicomMetadata: input.dicomMetadata
  });
  if (!asset) throw conflict("Media upload reservation is no longer completable.", { upload_id: uploadId });

  await audit(context, dependencies, "media.upload_completed", {
    patientId: asset.patientId,
    resourceType: "media_asset",
    resourceId: asset.id,
    metadata: mediaAuditMetadata(asset)
  });
  await appendOutbox(context, dependencies, {
    eventType: "media.upload_completed",
    aggregateType: "media_asset",
    aggregateId: asset.id,
    patientId: asset.patientId,
    payload: {
      mediaAssetId: asset.id,
      uploadId,
      patientId: asset.patientId,
      mediaType: asset.mediaType,
      encounterId: asset.encounterId,
      toothNumber: asset.toothNumber,
      dentalFindingId: asset.dentalFindingId,
      scanStatus: asset.scanStatus
    }
  });

  return created({ mediaAsset: toPublicMediaAsset(asset) });
}

export async function listPatientMediaAssets(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID
) {
  authorize(context, { permission: "patient.read" });
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "media.read" });
  const scope = scopeFrom(context);
  const patient = await dependencies.repository.findPatientById(scope, patientId);
  if (!patient) throw notFound("Patient not found.", { patient_id: patientId });

  const mediaAssets = (await dependencies.repository.listPatientMediaAssets(scope, patientId)).map(
    toPublicMediaAsset
  );
  return ok({ mediaAssets });
}

export async function createSignedMediaAccess(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  mediaAssetId: UUID,
  body: unknown = {}
) {
  authorize(context, { permission: "patient.phi.read" });
  authorize(context, { permission: "media.read" });
  const storage = mediaStorageFrom(dependencies);
  const requested = parseSignedMediaAccessRequest(body);
  const asset = await dependencies.repository.findMediaAssetById(scopeFrom(context), mediaAssetId);
  if (!asset) throw notFound("Media asset not found.", { media_asset_id: mediaAssetId });
  if (!mediaAssetCanBeViewed(asset)) {
    throw conflict("Media asset cannot be viewed until scanning clears it.", {
      media_asset_id: mediaAssetId,
      scan_status: asset.scanStatus
    });
  }
  const expiresInSeconds = Math.min(requested.expiresInSeconds ?? 300, 300);
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000).toISOString();
  const access = await storage.createSignedReadAccess({
    objectKey: asset.objectKey,
    mimeType: asset.mimeType,
    expiresAt
  });

  await audit(context, dependencies, "media.viewed", {
    patientId: asset.patientId,
    resourceType: "media_asset",
    resourceId: asset.id,
    metadata: {
      mediaAssetId: asset.id,
      mediaType: asset.mediaType,
      expiresAt: access.expiresAt,
      expiresInSeconds
    }
  });

  return ok({
    mediaAsset: toPublicMediaAsset(asset),
    access
  });
}

export async function createInvoicePaymentRequest(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  invoiceId: UUID,
  body: unknown
) {
  authorize(context, { permission: "billing.write" });
  const provider = paymentProviderFrom(dependencies);
  const scope = scopeFrom(context);
  const invoiceDetail = await dependencies.repository.findInvoiceById(scope, invoiceId);
  if (!invoiceDetail) throw notFound("Invoice not found.", { invoice_id: invoiceId });
  const invoice = invoiceDetail.invoice;
  if (invoice.balanceMinor <= 0) {
    throw conflict("Invoice has no amount due for a new payment request.", {
      invoice_id: invoiceId,
      payment_status: invoice.paymentStatus
    });
  }

  const input = parsePaymentRequest(body, invoice);
  const health = await provider.healthCheck();
  if (!health.capabilities.includes(input.requestType === "invoice_qr" ? "CREATE_PAYMENT_QR" : "CREATE_PAYMENT_LINKS")) {
    await audit(context, dependencies, "payment.provider.unavailable", {
      patientId: invoice.patientId,
      resourceType: "invoice",
      resourceId: invoice.id,
      metadata: { providerKey: provider.providerKey, providerHealth: health }
    });
    throw new ApiError(503, "CONFIGURATION_ERROR", "Payment provider is unavailable for this request type.", {
      provider_health: health,
      request_type: input.requestType
    });
  }

  const providerInput = {
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    patientId: invoice.patientId,
    invoiceId: invoice.id,
    amountPaise: input.amountMinor,
    currency: invoice.currency,
    description: input.description,
    expiresAt: input.expiresAt,
    idempotencyKey: context.idempotencyKey,
    customer: input.customer,
    metadata: input.metadata
  };
  let providerResult: PaymentProviderRequestResult;
  try {
    providerResult =
      input.requestType === "invoice_qr"
        ? await provider.createInvoiceQr(providerInput)
        : await provider.createPaymentLink(providerInput);
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      await audit(context, dependencies, "payment.provider.unavailable", {
        patientId: invoice.patientId,
        resourceType: "invoice",
        resourceId: invoice.id,
        metadata: { providerKey: error.providerKey, providerStatus: error.status, ...error.details }
      });
      throw new ApiError(503, "CONFIGURATION_ERROR", error.message, error.details);
    }
    throw error;
  }

  const paymentRequest = await dependencies.repository.createPaymentRequest(scope, {
    invoiceId: invoice.id,
    provider: normalizeBillingPaymentProvider(providerResult.providerKey),
    requestType: normalizePaymentRequestType(providerResult.requestKind),
    amountMinor: providerResult.amountPaise,
    currency: invoice.currency,
    providerReferenceId: providerResult.providerRequestId,
    providerUrl: providerResult.paymentUrl ?? null,
    providerQrPayload: providerResult.qrString ?? providerResult.qrImageUrl ?? null,
    expiresAt: providerResult.expiresAt ?? null,
    metadata: {
      providerStatus: providerResult.status,
      qrImageUrl: providerResult.qrImageUrl ?? null,
      providerMetadata: providerResult.metadata,
      providerHealth: providerResult.providerHealth
    }
  });
  if (!paymentRequest) {
    throw conflict("Payment request could not be created for this invoice state.", {
      invoice_id: invoice.id,
      payment_status: invoice.paymentStatus
    });
  }
  const updatedInvoiceDetail = await dependencies.repository.findInvoiceById(scope, invoice.id);
  if (!updatedInvoiceDetail) throw notFound("Invoice not found after payment request.", { invoice_id: invoice.id });

  await audit(context, dependencies, "payment.requested", {
    patientId: invoice.patientId,
    resourceType: "payment_request",
    resourceId: paymentRequest.id,
    metadata: {
      invoiceId,
      providerKey: providerResult.providerKey,
      requestType: paymentRequest.requestType,
      amountMinor: paymentRequest.amountMinor,
      providerHealth: providerResult.providerHealth
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "payment.requested",
    aggregateType: "payment_request",
    aggregateId: paymentRequest.id,
    patientId: invoice.patientId,
    payload: {
      invoiceId,
      paymentRequestId: paymentRequest.id,
      providerKey: providerResult.providerKey,
      requestType: paymentRequest.requestType,
      amountMinor: paymentRequest.amountMinor
    }
  });

  return created({
    invoice: publicInvoiceDetail(updatedInvoiceDetail),
    paymentRequest: publicPaymentRequest(paymentRequest),
    provider: {
      key: provider.providerKey,
      health: providerResult.providerHealth
    }
  });
}

export async function recordInvoiceManualPayment(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  invoiceId: UUID,
  body: unknown
) {
  authorize(context, { permission: "billing.write" });
  const scope = scopeFrom(context);
  const invoiceDetail = await dependencies.repository.findInvoiceById(scope, invoiceId);
  if (!invoiceDetail) throw notFound("Invoice not found.", { invoice_id: invoiceId });
  const invoice = invoiceDetail.invoice;

  const input = parseManualPayment(body);
  if (input.currency !== invoice.currency) {
    throw validation("Manual payment currency must match the invoice currency.", {
      invoice_id: invoiceId,
      invoice_currency: invoice.currency,
      payment_currency: input.currency
    });
  }
  if (input.amountMinor > invoice.balanceMinor) {
    throw conflict("Manual payment amount exceeds the invoice amount due.", {
      invoice_id: invoiceId,
      balance_minor: invoice.balanceMinor,
      received_amount_minor: input.amountMinor
    });
  }

  const idempotencyKey = context.idempotencyKey ?? `manual:${invoiceId}:${input.reference}`;
  const existing = invoiceDetail.payments.find(
    (payment) => payment.provider === "manual" && payment.idempotencyKey === idempotencyKey
  );
  const transaction = await dependencies.repository.recordPaymentTransaction(scope, {
    invoiceId: invoice.id,
    provider: "manual",
    amountMinor: input.amountMinor,
    currency: input.currency,
    method: input.method,
    status: "manually_recorded",
    verificationStatus: "not_required_manual",
    reconciliationStatus: "matched",
    receivedAt: input.receivedAt ?? new Date().toISOString(),
    idempotencyKey,
    recordedByUserId: scope.actorUserId,
    metadata: {
      reason: input.reason,
      reference: input.reference,
      evidence: input.evidence
    }
  });
  if (!transaction) throw notFound("Invoice not found.", { invoice_id: invoiceId });
  const updatedInvoiceDetail = await dependencies.repository.findInvoiceById(scope, invoice.id);
  if (!updatedInvoiceDetail) throw notFound("Invoice not found after payment recording.", { invoice_id: invoice.id });
  const replayed = existing?.id === transaction.id;

  await audit(context, dependencies, "payment.manually_recorded", {
    patientId: invoice.patientId,
    resourceType: "payment_transaction",
    resourceId: transaction.id,
    metadata: {
      invoiceId,
      amountMinor: input.amountMinor,
      method: input.method,
      reference: input.reference,
      reason: input.reason,
      replayed
    }
  });
  await appendOutbox(context, dependencies, {
    eventType: "payment.manually_recorded",
    aggregateType: "payment_transaction",
    aggregateId: transaction.id,
    patientId: invoice.patientId,
    payload: {
      invoiceId,
      paymentTransactionId: transaction.id,
      amountMinor: transaction.amountMinor,
      paymentStatus: updatedInvoiceDetail.invoice.paymentStatus,
      replayed
    }
  });

  return created({
    invoice: publicInvoiceDetail(updatedInvoiceDetail),
    transaction: publicPaymentTransaction(transaction),
    reconciliationItem: null,
    replayed
  });
}

export async function processPaymentWebhook(
  dependencies: OperationsDependencies,
  input: {
    requestId: string;
    providerKey: string;
    rawBody: string;
    headers: Record<string, string | undefined>;
    receivedAt: string;
    ipAddress?: string | null;
    userAgent?: string | null;
  }
) {
  const provider = paymentProviderFrom(dependencies);
  const raw: RawPaymentWebhook = {
    providerKey: input.providerKey,
    headers: input.headers,
    rawBody: input.rawBody,
    receivedAt: input.receivedAt
  };
  const verification = await provider.verifyWebhook(raw);

  if (verification.status !== "verified") {
    throw new ApiError(
      verification.status === "invalid_signature" ? 403 : 400,
      verification.status === "invalid_signature" ? "PERMISSION_DENIED" : "VALIDATION_ERROR",
      verification.message,
      { verification_status: verification.status, provider_event_id: verification.providerEventId ?? null }
    );
  }

  let event: PaymentProviderWebhookEvent;
  try {
    event = await provider.parseWebhook(raw);
  } catch (error) {
    throw error;
  }

  const webhookReceiptId = randomUUID() as UUID;
  const eventScope = scopeFromPaymentWebhook(event);
  if (!eventScope || !event.invoiceId || !isUuid(event.invoiceId)) {
    return ok({
      status: "reconciliation_required",
      replayed: false,
      invoice: null,
      transaction: null,
      reconciliationItem: providerReconciliationItem(event, "missing_invoice_reference", event.amountPaise ?? 0),
      providerEvent: publicProviderWebhookEvent(event)
    });
  }

  const invoiceDetail = await dependencies.repository.findInvoiceById(eventScope, event.invoiceId);
  if (!invoiceDetail) {
    return ok({
      status: "reconciliation_required",
      replayed: false,
      invoice: null,
      transaction: null,
      reconciliationItem: providerReconciliationItem(event, "missing_invoice_reference", event.amountPaise ?? 0),
      providerEvent: publicProviderWebhookEvent(event)
    });
  }

  const invoice = invoiceDetail.invoice;
  const providerKey = normalizeBillingPaymentProvider(event.providerKey);
  const existing = invoiceDetail.payments.find(
    (payment) =>
      payment.provider === providerKey &&
      (payment.idempotencyKey === event.idempotencyKey ||
        (event.providerPaymentId && payment.providerPaymentId === event.providerPaymentId))
  );
  if (existing) {
    return ok({
      status: "duplicate",
      replayed: true,
      invoice: publicInvoiceDetail(invoiceDetail),
      transaction: publicPaymentTransaction(existing),
      reconciliationItem: null,
      providerEvent: publicProviderWebhookEvent(event)
    });
  }

  let transaction: PaymentTransactionRecord | null = null;
  let reconciliationItem: PaymentRouteReconciliationItemRecord | null = null;
  let status: "processed" | "ignored" | "reconciliation_required" = "processed";

  if (event.eventKind === "payment_failed") {
    transaction = await dependencies.repository.recordPaymentTransaction(eventScope, {
      invoiceId: invoice.id,
      provider: providerKey,
      providerPaymentId: event.providerPaymentId ?? null,
      providerOrderId: event.providerPaymentRequestId ?? null,
      amountMinor: positiveProviderAmountMinor(event.amountPaise),
      currency: event.currency ?? invoice.currency,
      method: event.method ?? "provider_failure",
      status: "failed",
      verificationStatus: "verified",
      reconciliationStatus: "matched",
      idempotencyKey: event.idempotencyKey,
      receivedAt: event.occurredAt,
      recordedByUserId: null,
      metadata: providerPaymentMetadata(event, { webhookReceiptId })
    });
  } else if (event.eventKind !== "payment_succeeded") {
    status = "ignored";
  } else if (event.currency !== invoice.currency || !event.amountPaise || event.amountPaise <= 0) {
    status = "reconciliation_required";
    reconciliationItem = providerReconciliationItem(
      event,
      event.currency !== invoice.currency ? "currency_mismatch" : "manual_review_required",
      event.amountPaise ?? 0
    );
  } else {
    const appliedAmountMinor = Math.min(event.amountPaise, Math.max(invoice.balanceMinor, 0));
    const overpaymentMinor = Math.max(event.amountPaise - appliedAmountMinor, 0);
    if (appliedAmountMinor > 0) {
      transaction = await dependencies.repository.recordPaymentTransaction(eventScope, {
        invoiceId: invoice.id,
        provider: providerKey,
        providerPaymentId: event.providerPaymentId ?? null,
        providerOrderId: event.providerPaymentRequestId ?? null,
        amountMinor: appliedAmountMinor,
        currency: event.currency,
        method: event.method ?? "provider",
        status: "succeeded",
        verificationStatus: "verified",
        reconciliationStatus: overpaymentMinor > 0 ? "requires_review" : "matched",
        idempotencyKey: event.idempotencyKey,
        receivedAt: event.occurredAt,
        recordedByUserId: null,
        metadata: providerPaymentMetadata(event, {
          webhookReceiptId,
          providerCapturedAmountMinor: event.amountPaise,
          appliedAmountMinor,
          overpaymentMinor
        })
      });
      if (overpaymentMinor > 0) {
        status = "reconciliation_required";
        reconciliationItem = providerReconciliationItem(event, "overpayment", overpaymentMinor);
      }
    } else {
      status = "reconciliation_required";
      transaction = await dependencies.repository.recordPaymentTransaction(eventScope, {
        invoiceId: invoice.id,
        provider: providerKey,
        providerPaymentId: event.providerPaymentId ?? null,
        providerOrderId: event.providerPaymentRequestId ?? null,
        amountMinor: event.amountPaise,
        currency: event.currency,
        method: event.method ?? "provider",
        status: "reconciliation_required",
        verificationStatus: "verified",
        reconciliationStatus: "requires_review",
        idempotencyKey: event.idempotencyKey,
        receivedAt: event.occurredAt,
        recordedByUserId: null,
        metadata: providerPaymentMetadata(event, {
          webhookReceiptId,
          providerCapturedAmountMinor: event.amountPaise,
          appliedAmountMinor: 0,
          overpaymentMinor: event.amountPaise
        })
      });
      reconciliationItem = providerReconciliationItem(event, "overpayment", event.amountPaise);
    }
  }

  const updatedInvoiceDetail = await dependencies.repository.findInvoiceById(eventScope, invoice.id);
  if (!updatedInvoiceDetail) throw notFound("Invoice not found after webhook processing.", { invoice_id: invoice.id });

  if (transaction) {
    const eventType =
      status === "reconciliation_required"
        ? "payment.reconciliation_required"
        : event.eventKind === "payment_failed"
          ? "payment.failed"
          : "payment.succeeded";
    await dependencies.repository.appendOutboxEvent(eventScope, {
      eventType,
      aggregateType: "payment_transaction",
      aggregateId: transaction.id,
      patientId: invoice.patientId,
      payload: {
        invoiceId: invoice.id,
        paymentTransactionId: transaction.id,
        providerKey: event.providerKey,
        providerEventId: event.providerEventId,
        providerPaymentId: event.providerPaymentId ?? null,
        status,
        reconciliationItemId: reconciliationItem?.id ?? null
      }
    });
  }

  if (dependencies.auditSink && updatedInvoiceDetail) {
    const auditAction =
      status === "reconciliation_required"
        ? "payment.reconciliation_required"
        : event.eventKind === "payment_failed"
          ? "payment.failed"
          : "payment.succeeded";
    await dependencies.auditSink.appendAuditEvent(
      createAuditEvent({
        tenantId: updatedInvoiceDetail.invoice.tenantId,
        clinicId: updatedInvoiceDetail.invoice.clinicId,
        actor: { type: "integration", id: event.providerKey },
        action: auditAction,
        patientId: updatedInvoiceDetail.invoice.patientId,
        resourceType: "payment_webhook",
        resourceId: webhookReceiptId,
        metadata: {
          providerKey: event.providerKey,
          providerEventId: event.providerEventId,
          providerPaymentId: event.providerPaymentId ?? null,
          invoiceId: updatedInvoiceDetail.invoice.id,
          replayed: false,
          status,
          reconciliationItemId: reconciliationItem?.id ?? null,
          transactionId: transaction?.id ?? null
        },
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        correlationId: input.requestId
      })
    );
  }

  return ok({
    status,
    replayed: false,
    invoice: publicInvoiceDetail(updatedInvoiceDetail),
    transaction: transaction ? publicPaymentTransaction(transaction) : null,
    reconciliationItem,
    providerEvent: publicProviderWebhookEvent(event)
  });
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

async function createDentalFindingForPatient(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies,
  patientId: UUID,
  input: CreateDentalFindingInput,
  options: { preauthorized?: boolean } = {}
) {
  if (!options.preauthorized) {
    authorize(context, { permission: "patient.read" });
    authorize(context, { permission: "patient.phi.read" });
    authorize(context, { permission: "dental.chart.write" });
  }

  const result = await dependencies.repository.createDentalFinding(
    scopeFrom(context),
    patientId,
    input
  );
  if (!result) throw notFound("Patient or encounter not found.", { patient_id: patientId });

  await audit(context, dependencies, "dental_finding.created", {
    patientId: result.finding.patientId,
    resourceType: "dental_finding",
    resourceId: result.finding.id,
    metadata: dentalFindingAuditMetadata(result.finding)
  });
  await appendOutbox(context, dependencies, {
    eventType: "dental.finding.created",
    aggregateType: "dental_finding",
    aggregateId: result.finding.id,
    patientId: result.finding.patientId,
    payload: {
      findingId: result.finding.id,
      patientId: result.finding.patientId,
      encounterId: result.finding.encounterId,
      toothNumber: result.finding.toothNumber,
      surface: result.finding.surface,
      findingType: result.finding.findingType,
      reviewStatus: result.finding.reviewStatus
    }
  });

  return created({
    finding: publicDentalFinding(result.finding),
    history: publicDentalFindingHistory(result.history)
  });
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

function authorizeDoctorSignature(
  context: OperationsRequestContext,
  permission: "clinical.note.sign" | "prescription.sign"
): void {
  if (!DOCTOR_ONLY_SIGNATURE_PERMISSIONS.has(permission)) {
    throw new ApiError(500, "CONFIGURATION_ERROR", "Invalid doctor-only permission.");
  }

  authorize(context, { permission });
  const roles = roleSlugsForScope(
    context.accessContext,
    context.accessContext.tenant.id,
    context.clinicId
  );

  if (!roles.includes("doctor")) {
    throw new ApiError(403, "PERMISSION_DENIED", "Only doctors can sign clinical records.", {
      required_permission: permission,
      required_role: "doctor"
    });
  }
}

type PublicTimelineItemType =
  | "patient"
  | "attribution"
  | "lead"
  | "appointment"
  | "queue"
  | "message"
  | "clinical_note"
  | "dental"
  | "treatment_plan"
  | "procedure"
  | "prescription"
  | "instruction"
  | "media"
  | "invoice"
  | "payment"
  | "receipt"
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
    case "dental_finding_created":
    case "dental_finding_updated":
    case "dental_chart_snapshot_created":
      return "dental";
    case "treatment_plan_created":
    case "treatment_plan_accepted":
      return "treatment_plan";
    case "procedure_completed":
      return "procedure";
    case "invoice_created":
      return "invoice";
    case "payment_recorded":
      return "payment";
    case "receipt_generated":
      return "receipt";
    case "prescription_draft_created":
    case "prescription_signed":
      return "prescription";
    case "instruction_print_requested":
    case "instruction_send_requested":
      return "instruction";
    case "media_uploaded":
      return "media";
    case "invoice_created":
      return "invoice";
    case "payment_requested":
    case "payment_succeeded":
    case "payment_manually_recorded":
    case "payment_reconciliation_required":
      return "payment";
    case "receipt_generated":
      return "invoice";
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
    case "dental_finding_created":
      return "dental.finding.created";
    case "dental_finding_updated":
      return "dental.finding.updated";
    case "dental_chart_snapshot_created":
      return "dental.chart.snapshot_created";
    case "treatment_plan_created":
      return "treatment_plan.created";
    case "treatment_plan_accepted":
      return "treatment_plan.accepted";
    case "procedure_completed":
      return "procedure.completed";
    case "invoice_created":
      return "invoice.created";
    case "payment_recorded":
      return "payment.succeeded";
    case "receipt_generated":
      return "receipt.generated";
    case "prescription_draft_created":
      return "prescription.draft_created";
    case "prescription_signed":
      return "prescription.signed";
    case "instruction_print_requested":
      return "instruction.print_requested";
    case "instruction_send_requested":
      return "instruction.send_requested";
    case "media_uploaded":
      return "media.upload_completed";
    case "invoice_created":
      return "invoice.created";
    case "payment_requested":
      return "payment.requested";
    case "payment_succeeded":
      return "payment.succeeded";
    case "payment_manually_recorded":
      return "payment.manually_recorded";
    case "payment_reconciliation_required":
      return "payment.reconciliation_required";
    case "receipt_generated":
      return "receipt.generated";
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

function parseCreateIntakeFormTemplate(body: unknown): CreateIntakeFormTemplateInput {
  const input = objectBody(body);
  return {
    code: requiredString(input.code, "code"),
    displayName: requiredString(input.displayName, "displayName"),
    formType: parseIntakeFormType(requiredString(input.formType, "formType")),
    version: integerField(input.version ?? 1, "version", { min: 1 }),
    schema: recordField(input.schema, "schema"),
    active: input.active === undefined ? true : booleanField(input.active, "active")
  };
}

function parseCreateIntakeFormSubmission(
  body: unknown,
  patientId: UUID
): CreateIntakeFormSubmissionInput {
  const input = objectBody(body);
  return {
    patientId,
    templateId: uuidField(input.templateId, "templateId"),
    source: parseIntakeSubmissionSource(requiredString(input.source ?? "digital", "source")),
    responses: recordField(input.responses, "responses"),
    medicalHistorySnapshot: recordField(input.medicalHistorySnapshot, "medicalHistorySnapshot"),
    provenance: recordField(input.provenance, "provenance")
  };
}

function parseCreateConsent(body: unknown, patientId: UUID): CreateConsentInput {
  const input = objectBody(body);
  return {
    patientId,
    purpose: parseConsentPurpose(requiredString(input.purpose, "purpose")),
    templateCode: requiredString(input.templateCode, "templateCode"),
    templateVersion: integerField(input.templateVersion, "templateVersion", { min: 1 }),
    captureMethod: parseConsentCaptureMethod(
      requiredString(input.captureMethod ?? "clinic_staff", "captureMethod")
    ),
    grantedByName: optionalNullableString(input.grantedByName, "grantedByName"),
    relationshipToPatient: optionalNullableString(
      input.relationshipToPatient,
      "relationshipToPatient"
    ),
    evidence: recordField(input.evidence, "evidence"),
    provenance: recordField(input.provenance, "provenance")
  };
}

function parseCreateEncounter(body: unknown): CreateEncounterInput {
  const input = objectBody(body);
  return {
    patientId: uuidField(input.patientId, "patientId"),
    appointmentId: optionalUuid(input.appointmentId, "appointmentId"),
    providerUserId: uuidField(input.providerUserId, "providerUserId"),
    reason: optionalNullableString(input.reason, "reason"),
    medicalHistorySnapshot: recordField(input.medicalHistorySnapshot, "medicalHistorySnapshot")
  };
}

function parseSaveClinicalNoteDraft(body: unknown): {
  content: ClinicalNoteContent;
  readyForSign?: boolean;
} {
  const input = objectBody(body);
  return {
    content: parseClinicalNoteContent(input.content ?? input.sections),
    readyForSign:
      input.readyForSign === undefined ? undefined : booleanField(input.readyForSign, "readyForSign")
  };
}

function parseAmendClinicalNote(body: unknown): {
  content: ClinicalNoteContent;
  amendmentReason: string;
} {
  const input = objectBody(body);
  return {
    content: parseClinicalNoteContent(input.content ?? input.sections),
    amendmentReason: requiredString(input.amendmentReason ?? input.reason, "amendmentReason")
  };
}

function parseCreatePrescription(body: unknown): CreatePrescriptionInput {
  const input = objectBody(body);
  return {
    medications: parsePrescriptionMedications(input.medications),
    notes: optionalNullableString(input.notes, "notes")
  };
}

function parseCreatePatientInstruction(body: unknown): CreatePatientInstructionInput {
  const input = objectBody(body);
  const channel = requiredString(input.channel ?? "print", "channel");
  if (!isPatientInstructionChannel(channel)) {
    throw validation("channel must be print or whatsapp.", { field: "channel" });
  }

  return {
    channel,
    templateId: requiredString(input.templateId, "templateId"),
    title: optionalNullableString(input.title, "title"),
    body: optionalNullableString(input.body, "body")
  };
}

function parseCreateDentalFinding(
  body: unknown,
  defaults: { encounterId?: UUID | null } = {}
): CreateDentalFindingInput {
  const input = objectBody(body);
  const bodyEncounterId = optionalUuid(input.encounterId, "encounterId");
  if (
    defaults.encounterId &&
    bodyEncounterId &&
    bodyEncounterId !== defaults.encounterId
  ) {
    throw validation("Dental finding encounter context does not match the route.", {
      expected_encounter_id: defaults.encounterId,
      received_encounter_id: bodyEncounterId
    });
  }
  const statusFields = parseDentalStatusFields(input.status, input.reviewStatus ?? input.reviewState);

  return {
    encounterId: defaults.encounterId ?? bodyEncounterId,
    toothNumber: requiredString(input.toothNumber, "toothNumber"),
    surface: parseDentalSurfaceField(input.surface ?? input.surfaces),
    findingType: parseDentalFindingType(requiredString(input.findingType, "findingType")),
    severity: optionalNullableString(input.severity, "severity"),
    status: statusFields.status,
    reviewStatus: statusFields.reviewStatus,
    source: input.source === undefined ? undefined : parseDentalFindingSource(requiredString(input.source, "source")),
    confidence: optionalUnitNumber(input.confidence, "confidence"),
    notes: optionalNullableString(input.notes ?? input.note ?? input.doctorNote, "notes"),
    provenance: recordField(input.provenance, "provenance"),
    treatmentReference: recordField(input.treatmentReference, "treatmentReference")
  };
}

function parseUpdateDentalFinding(body: unknown): UpdateDentalFindingRepositoryInput {
  const input = objectBody(body);
  const statusFields = parseDentalStatusFields(input.status, input.reviewStatus ?? input.reviewState);

  return {
    encounterId:
      input.encounterId === undefined ? undefined : optionalUuid(input.encounterId, "encounterId"),
    toothNumber:
      input.toothNumber === undefined ? undefined : requiredString(input.toothNumber, "toothNumber"),
    surface:
      input.surface === undefined && input.surfaces === undefined
        ? undefined
        : parseDentalSurfaceField(input.surface ?? input.surfaces),
    findingType:
      input.findingType === undefined
        ? undefined
        : parseDentalFindingType(requiredString(input.findingType, "findingType")),
    severity:
      input.severity === undefined ? undefined : optionalNullableString(input.severity, "severity"),
    status: statusFields.status,
    reviewStatus: statusFields.reviewStatus,
    source:
      input.source === undefined
        ? undefined
        : parseDentalFindingSource(requiredString(input.source, "source")),
    confidence:
      input.confidence === undefined ? undefined : optionalUnitNumber(input.confidence, "confidence"),
    notes:
      input.notes === undefined && input.note === undefined && input.doctorNote === undefined
        ? undefined
        : optionalNullableString(input.notes ?? input.note ?? input.doctorNote, "notes"),
    provenance: recordField(input.provenance, "provenance"),
    treatmentReference: recordField(input.treatmentReference, "treatmentReference"),
    changeReason: requiredString(
      input.changeReason ?? input.reason ?? input.doctorNote ?? input.note,
      "changeReason"
    )
  };
}

function parseDentalChartSnapshot(body: unknown): CreateDentalChartSnapshotInput {
  const input = objectBody(body);
  return {
    encounterId: optionalUuid(input.encounterId, "encounterId"),
    reason: optionalNullableString(input.reason, "reason"),
    provenance: recordField(input.provenance, "provenance")
  };
}

function parseCreateTreatmentPlan(body: unknown): CreateTreatmentPlanInput {
  const input = objectBody(body);
  return {
    encounterId: optionalUuid(input.encounterId, "encounterId"),
    title: requiredString(input.title, "title"),
    clinicalSummary: optionalNullableString(input.clinicalSummary, "clinicalSummary"),
    status:
      input.status === undefined
        ? undefined
        : parseDraftTreatmentPlanStatus(requiredString(input.status, "status")),
    phases: parseTreatmentPlanPhases(input.phases)
  };
}

function parseUpdateTreatmentPlan(body: unknown): UpdateTreatmentPlanInput {
  const input = objectBody(body);
  return {
    title: input.title === undefined ? undefined : requiredString(input.title, "title"),
    clinicalSummary:
      input.clinicalSummary === undefined
        ? undefined
        : optionalNullableString(input.clinicalSummary, "clinicalSummary"),
    status:
      input.status === undefined
        ? undefined
        : parseMutableTreatmentPlanStatus(requiredString(input.status, "status")),
    phases: input.phases === undefined ? undefined : parseTreatmentPlanPhases(input.phases)
  };
}

function parseAcceptTreatmentPlan(body: unknown) {
  const input = body === undefined ? {} : objectBody(body);
  return {
    acceptedByName: optionalNullableString(input.acceptedByName, "acceptedByName"),
    acceptanceEvidence: recordField(input.acceptanceEvidence, "acceptanceEvidence")
  };
}

function parseCreateProcedurePerformed(body: unknown): CreateProcedurePerformedInput {
  const input = objectBody(body);
  return {
    treatmentPlanId: uuidField(input.treatmentPlanId, "treatmentPlanId"),
    treatmentPlanEstimateItemId: uuidField(
      input.treatmentPlanEstimateItemId ?? input.estimateItemId,
      "treatmentPlanEstimateItemId"
    ),
    performedAt: optionalNullableString(input.performedAt, "performedAt"),
    notes: optionalNullableString(input.notes, "notes"),
    outcome: optionalNullableString(input.outcome, "outcome"),
    provenance: recordField(input.provenance, "provenance")
  };
}

function parseCreateInvoice(body: unknown): CreateInvoiceInput {
  const input = objectBody(body);
  if (input.items !== undefined || input.lineItems !== undefined) {
    throw validation("Invoice line items must be derived from completed procedure evidence.", {
      forbidden_fields: ["items", "lineItems"]
    });
  }
  const procedurePerformedIds = uuidArrayField(
    input.procedurePerformedIds ?? input.procedureIds,
    "procedurePerformedIds"
  );
  const treatmentPlanId = optionalUuid(input.treatmentPlanId, "treatmentPlanId");

  if (!treatmentPlanId && procedurePerformedIds.length === 0) {
    throw validation("Invoice creation requires treatmentPlanId or procedurePerformedIds.", {
      required_any: ["treatmentPlanId", "procedurePerformedIds"]
    });
  }

  return {
    patientId: optionalUuid(input.patientId, "patientId"),
    treatmentPlanId,
    procedurePerformedIds,
    dueAt: optionalNullableString(input.dueAt, "dueAt")
  };
}

function parseCreateReceipt(body: unknown): CreateReceiptInput {
  const input = body === undefined ? {} : objectBody(body);
  return {
    paymentTransactionIds: uuidArrayField(input.paymentTransactionIds, "paymentTransactionIds")
  };
}

function parseTreatmentPlanPhases(value: unknown): CreateTreatmentPlanInput["phases"] {
  if (!Array.isArray(value) || value.length === 0) {
    throw validation("phases must be a non-empty array.", { field: "phases" });
  }

  return value.map((phaseValue, phaseIndex) => {
    const phase = objectField(phaseValue, `phases[${phaseIndex}]`);
    const items = phase.items;
    if (!Array.isArray(items) || items.length === 0) {
      throw validation(`phases[${phaseIndex}].items must be a non-empty array.`, {
        field: `phases[${phaseIndex}].items`
      });
    }

    return {
      title: requiredString(phase.title, `phases[${phaseIndex}].title`),
      description: optionalNullableString(phase.description, `phases[${phaseIndex}].description`),
      estimatedStartAfterDays:
        phase.estimatedStartAfterDays === undefined || phase.estimatedStartAfterDays === null
          ? null
          : integerField(phase.estimatedStartAfterDays, `phases[${phaseIndex}].estimatedStartAfterDays`, {
              min: 0
            }),
      items: items.map((itemValue, itemIndex) => {
        const item = objectField(itemValue, `phases[${phaseIndex}].items[${itemIndex}]`);
        const quantity = integerField(item.quantity ?? 1, `phases[${phaseIndex}].items[${itemIndex}].quantity`, {
          min: 1,
          max: 999
        });
        const unitPriceMinor =
          item.unitPriceMinor === undefined || item.unitPriceMinor === null
            ? null
            : integerField(item.unitPriceMinor, `phases[${phaseIndex}].items[${itemIndex}].unitPriceMinor`, {
                min: 0
              });
        const discountMinor = integerField(
          item.discountMinor ?? 0,
          `phases[${phaseIndex}].items[${itemIndex}].discountMinor`,
          { min: 0 }
        );
        const taxRateBasisPoints =
          item.taxRateBasisPoints === undefined || item.taxRateBasisPoints === null
            ? null
            : integerField(
                item.taxRateBasisPoints,
                `phases[${phaseIndex}].items[${itemIndex}].taxRateBasisPoints`,
                { min: 0, max: 10000 }
              );

        if (unitPriceMinor !== null) {
          try {
            calculateBillingLineTotals({
              quantity,
              unitPriceMinor,
              discountMinor,
              taxRateBasisPoints: taxRateBasisPoints ?? 0
            });
          } catch (error) {
            throw validation(error instanceof Error ? error.message : "Invalid estimate item total.", {
              field: `phases[${phaseIndex}].items[${itemIndex}]`
            });
          }
        }

        return {
          pricebookProcedureId: uuidField(
            item.pricebookProcedureId,
            `phases[${phaseIndex}].items[${itemIndex}].pricebookProcedureId`
          ),
          dentalFindingId: optionalUuid(
            item.dentalFindingId,
            `phases[${phaseIndex}].items[${itemIndex}].dentalFindingId`
          ),
          toothNumber: optionalNullableString(
            item.toothNumber,
            `phases[${phaseIndex}].items[${itemIndex}].toothNumber`
          ),
          quantity,
          unitPriceMinor,
          discountMinor,
          taxRateBasisPoints,
          estimatedVisits: integerField(
            item.estimatedVisits ?? 1,
            `phases[${phaseIndex}].items[${itemIndex}].estimatedVisits`,
            { min: 1, max: 99 }
          ),
          priority: optionalNullableString(
            item.priority,
            `phases[${phaseIndex}].items[${itemIndex}].priority`
          ),
          notes: optionalNullableString(
            item.notes,
            `phases[${phaseIndex}].items[${itemIndex}].notes`
          )
        };
      })
    };
  });
}

function parseMediaUploadRequest(body: unknown): {
  patientId: UUID;
  encounterId: UUID | null;
  toothNumber: string | null;
  dentalFindingId: UUID | null;
  mediaType: MediaType;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Digest: string | null;
  tags: string[];
  provenance: Record<string, unknown>;
} {
  const input = objectBody(body);
  const mediaType = parseMediaType(requiredString(input.mediaType, "mediaType"));
  const mimeType = requiredString(input.mimeType, "mimeType").toLowerCase();

  try {
    assertMediaMimeType(mediaType, mimeType);
  } catch (error) {
    throw validation(error instanceof Error ? error.message : "Invalid media mime type.", {
      field: "mimeType",
      mediaType,
      mimeType
    });
  }

  return {
    patientId: uuidField(input.patientId, "patientId"),
    encounterId: optionalUuid(input.encounterId, "encounterId"),
    toothNumber: optionalNullableString(input.toothNumber, "toothNumber") ?? null,
    dentalFindingId: optionalUuid(input.dentalFindingId, "dentalFindingId"),
    mediaType,
    originalFilename: requiredString(input.originalFilename, "originalFilename"),
    mimeType,
    fileSizeBytes: integerField(input.fileSizeBytes, "fileSizeBytes", {
      min: 1,
      max: 100 * 1024 * 1024
    }),
    sha256Digest: optionalSha256Digest(input.sha256Digest, "sha256Digest"),
    tags: stringArrayField(input.tags, "tags"),
    provenance: recordField(input.provenance, "provenance")
  };
}

function parseCompleteMediaUpload(body: unknown): {
  patientId: UUID;
  encounterId: UUID | null;
  contentLength?: number | null;
  sha256Digest?: string | null;
  mimeType?: string | null;
  objectVersion?: string | null;
  scanStatus: MediaScanStatus;
  quarantineReason?: string | null;
  dicomMetadata: Record<string, unknown>;
} {
  const input = objectBody(body);
  return {
    patientId: uuidField(input.patientId, "patientId"),
    encounterId: optionalUuid(input.encounterId, "encounterId"),
    contentLength:
      input.contentLength === undefined || input.contentLength === null
        ? null
        : integerField(input.contentLength, "contentLength", { min: 1, max: 100 * 1024 * 1024 }),
    sha256Digest: optionalSha256Digest(input.sha256Digest, "sha256Digest"),
    mimeType: optionalNullableString(input.mimeType, "mimeType")?.toLowerCase() ?? null,
    objectVersion: optionalNullableString(input.objectVersion, "objectVersion"),
    scanStatus: parseMediaScanStatus(requiredString(input.scanStatus ?? "pending", "scanStatus")),
    quarantineReason: optionalNullableString(input.quarantineReason, "quarantineReason"),
    dicomMetadata: recordField(input.dicomMetadata, "dicomMetadata")
  };
}

function parseSignedMediaAccessRequest(body: unknown): { expiresInSeconds?: number } {
  const input = body === undefined ? {} : objectBody(body);
  if (input.expiresInSeconds === undefined) return {};
  return {
    expiresInSeconds: integerField(input.expiresInSeconds, "expiresInSeconds", {
      min: 30,
      max: 300
    })
  };
}

function parsePaymentRequest(
  body: unknown,
  invoice: { id: UUID; balanceMinor: number }
): {
  requestType: PaymentProviderRequestKind;
  amountMinor: number;
  expiresAt: string | null;
  description: string | null;
  customer: { name?: string | null; email?: string | null; contact?: string | null } | null;
  metadata: Record<string, unknown>;
} {
  const input = objectBody(body);
  const requestType = parsePaymentRequestType(
    requiredString(input.requestType ?? input.type ?? "payment_link", "requestType")
  );
  const amountMinor =
    input.amountMinor === undefined && input.amountPaise === undefined
      ? invoice.balanceMinor
      : integerField(input.amountMinor ?? input.amountPaise, "amountMinor", { min: 1 });

  if (amountMinor > invoice.balanceMinor) {
    throw conflict("Payment request amount exceeds the invoice amount due.", {
      invoice_id: invoice.id,
      balance_minor: invoice.balanceMinor,
      requested_amount_minor: amountMinor
    });
  }

  return {
    requestType,
    amountMinor,
    expiresAt: optionalNullableString(input.expiresAt, "expiresAt") ?? null,
    description: optionalNullableString(input.description, "description") ?? null,
    customer: parsePaymentCustomer(input.customer),
    metadata: recordField(input.metadata, "metadata")
  };
}

function parseManualPayment(body: unknown): {
  amountMinor: number;
  currency: string;
  method: ManualPaymentMethod;
  reason: string;
  reference: string;
  receivedAt: string | null;
  evidence: Record<string, unknown>;
} {
  const input = objectBody(body);
  const method = parseManualPaymentMethod(requiredString(input.method, "method"));
  const amountMinor = integerField(input.amountMinor ?? input.amountPaise, "amountMinor", { min: 1 });
  const parsed = {
    amountPaise: amountMinor,
    currency: requiredString(input.currency ?? "INR", "currency").toUpperCase(),
    method,
    reason: requiredString(input.reason, "reason"),
    reference: requiredString(input.reference, "reference"),
    receivedAt: optionalNullableString(input.receivedAt, "receivedAt") ?? null,
    evidence: recordField(input.evidence, "evidence")
  };

  try {
    assertManualPaymentEvidence(parsed);
  } catch (error) {
    throw validation(error instanceof Error ? error.message : "Manual payment evidence is invalid.", {
      field: "manualPayment"
    });
  }

  return {
    amountMinor,
    currency: parsed.currency,
    method: parsed.method,
    reason: parsed.reason,
    reference: parsed.reference,
    receivedAt: parsed.receivedAt,
    evidence: parsed.evidence
  };
}

function parsePaymentCustomer(
  value: unknown
): { name?: string | null; email?: string | null; contact?: string | null } | null {
  if (value === undefined || value === null) return null;
  const input = objectField(value, "customer");
  return {
    name: optionalNullableString(input.name, "customer.name"),
    email: optionalNullableString(input.email, "customer.email"),
    contact: optionalNullableString(input.contact, "customer.contact")
  };
}

function parseClinicalNoteContent(value: unknown): ClinicalNoteContent {
  const input = objectField(value, "content");
  return {
    chiefComplaint: optionalString(input.chiefComplaint, "chiefComplaint"),
    history: optionalString(input.history, "history"),
    examination: optionalString(input.examination, "examination"),
    investigations: optionalString(input.investigations, "investigations"),
    diagnosis: optionalString(input.diagnosis, "diagnosis"),
    treatmentPlan: optionalString(input.treatmentPlan, "treatmentPlan"),
    treatmentPerformed: optionalString(input.treatmentPerformed, "treatmentPerformed"),
    followUpInstructions: optionalString(input.followUpInstructions, "followUpInstructions"),
    additionalSections: recordField(input.additionalSections, "additionalSections")
  };
}

function parsePrescriptionMedications(value: unknown): PrescriptionMedication[] {
  if (!Array.isArray(value)) {
    throw validation("medications must be an array.", { field: "medications" });
  }

  return value.map((item, index) => {
    const input = objectField(item, `medications[${index}]`);
    return {
      name: requiredString(input.name, `medications[${index}].name`),
      strength: optionalString(input.strength, `medications[${index}].strength`),
      route: optionalString(input.route, `medications[${index}].route`),
      frequency: requiredString(input.frequency, `medications[${index}].frequency`),
      duration: requiredString(input.duration, `medications[${index}].duration`),
      instructions: optionalString(input.instructions, `medications[${index}].instructions`)
    };
  });
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

function parseIntakeFormType(value: string): IntakeFormType {
  if (!isIntakeFormType(value)) {
    throw validation("Invalid intake form type.", { field: "formType", value });
  }
  return value;
}

function parseIntakeSubmissionSource(value: string): IntakeSubmissionSource {
  if (!isIntakeSubmissionSource(value)) {
    throw validation("Invalid intake submission source.", { field: "source", value });
  }
  return value;
}

function parseConsentPurpose(value: string): ConsentPurpose {
  if (!isConsentPurpose(value)) {
    throw validation("Invalid consent purpose.", { field: "purpose", value });
  }
  return value;
}

function parseConsentCaptureMethod(value: string): ConsentCaptureMethod {
  if (!isConsentCaptureMethod(value)) {
    throw validation("Invalid consent capture method.", { field: "captureMethod", value });
  }
  return value;
}

function parseEncounterStatus(value: string): EncounterStatus {
  if (!isEncounterStatus(value)) {
    throw validation("Invalid encounter status.", { field: "status", value });
  }
  return value;
}

function parseDraftTreatmentPlanStatus(value: string): "draft" | "presented" {
  if (value !== "draft" && value !== "presented") {
    throw validation("Treatment plan creation only supports draft or presented status.", {
      field: "status",
      value
    });
  }
  return value;
}

function parseMutableTreatmentPlanStatus(
  value: string
): "draft" | "presented" | "declined" | "deferred" | "cancelled" {
  if (!isTreatmentPlanStatus(value) || value === "accepted") {
    throw validation("Treatment plan status must be draft, presented, declined, deferred, or cancelled.", {
      field: "status",
      value
    });
  }
  return value;
}

function parseQueueStatus(value: string): QueueStatus {
  if (!QUEUE_STATUSES.has(value as QueueStatus)) {
    throw validation("Invalid queue status.", { field: "status", value });
  }
  return value as QueueStatus;
}

function parseMediaType(value: string): MediaType {
  if (!isMediaType(value)) {
    throw validation("Invalid media type.", { field: "mediaType", value });
  }
  return value;
}

function parseDentalFindingType(value: string): CreateDentalFindingInput["findingType"] {
  if (!isDentalFindingType(value)) {
    throw validation("Invalid dental finding type.", { field: "findingType", value });
  }
  return value;
}

function parseDentalFindingStatus(
  value: string
): NonNullable<UpdateDentalFindingRepositoryInput["status"]> {
  if (!isDentalFindingStatus(value)) {
    throw validation("Invalid dental finding status.", { field: "status", value });
  }
  return value;
}

function parseDentalFindingReviewStatus(
  value: string
): NonNullable<UpdateDentalFindingRepositoryInput["reviewStatus"]> {
  if (!isDentalFindingReviewStatus(value)) {
    throw validation("Invalid dental finding review status.", { field: "reviewStatus", value });
  }
  return value;
}

function parseDentalFindingSource(
  value: string
): NonNullable<UpdateDentalFindingRepositoryInput["source"]> {
  if (!isDentalFindingSource(value)) {
    throw validation("Invalid dental finding source.", { field: "source", value });
  }
  return value;
}

function parseDentalStatusFields(status: unknown, reviewStatus: unknown): {
  status?: UpdateDentalFindingRepositoryInput["status"];
  reviewStatus?: UpdateDentalFindingRepositoryInput["reviewStatus"];
} {
  const parsed: {
    status?: UpdateDentalFindingRepositoryInput["status"];
    reviewStatus?: UpdateDentalFindingRepositoryInput["reviewStatus"];
  } = {};

  if (status !== undefined) {
    const value = requiredString(status, "status");
    if (value === "reviewed") {
      parsed.reviewStatus = "reviewed";
    } else if (value === "resolved") {
      parsed.status = "treated";
    } else {
      parsed.status = parseDentalFindingStatus(value);
    }
  }

  if (reviewStatus !== undefined) {
    parsed.reviewStatus = parseDentalFindingReviewStatus(requiredString(reviewStatus, "reviewStatus"));
  }

  return parsed;
}

function parseDentalSurfaceField(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length > 1) {
      throw validation("Dental findings currently accept one surface per finding row.", {
        field: "surfaces"
      });
    }
    return optionalNullableString(value[0], "surfaces[0]") ?? null;
  }
  return optionalNullableString(value, "surface") ?? null;
}

function parseMediaScanStatus(value: string): MediaScanStatus {
  if (!isMediaScanStatus(value)) {
    throw validation("Invalid media scan status.", { field: "scanStatus", value });
  }
  return value;
}

function parsePaymentRequestType(value: string): PaymentProviderRequestKind {
  if (value === "payment_link") return "payment_link";
  if (value === "invoice_qr" || value === "dynamic_qr" || value === "qr" || value === "qr_code")
    return "invoice_qr";
  throw validation("Invalid payment request type.", { field: "requestType", value });
}

function parseManualPaymentMethod(value: string): ManualPaymentMethod {
  if (!isManualPaymentMethod(value)) {
    throw validation("Invalid manual payment method.", { field: "method", value });
  }
  return value;
}

function normalizePaymentRequestType(kind: PaymentProviderRequestKind): PaymentRequestType {
  return kind === "invoice_qr" ? "dynamic_qr" : "payment_link";
}

function normalizeBillingPaymentProvider(providerKey: string): BillingPaymentProviderKey {
  if (providerKey === "razorpay") return "razorpay";
  if (providerKey === "simulator") return "simulator";
  return "simulator";
}

function scopeFromPaymentWebhook(event: PaymentProviderWebhookEvent): RepositoryScope | null {
  if (!event.tenantId || !event.clinicId || !isUuid(event.tenantId) || !isUuid(event.clinicId)) {
    return null;
  }
  return {
    tenantId: event.tenantId,
    clinicId: event.clinicId,
    actorUserId: SYSTEM_INTEGRATION_ACTOR_USER_ID
  };
}

function positiveProviderAmountMinor(amountMinor: number | null | undefined): number {
  return amountMinor && amountMinor > 0 ? amountMinor : 1;
}

function providerPaymentMetadata(
  event: PaymentProviderWebhookEvent,
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...metadata,
    providerEventId: event.providerEventId,
    providerEventName: event.eventName,
    providerEventKind: event.eventKind,
    rawBodySha256: event.rawBodySha256,
    providerPayload: event.payload
  };
}

function providerReconciliationItem(
  event: PaymentProviderWebhookEvent,
  reason: PaymentRouteReconciliationItemRecord["reason"],
  amountMinor: number
): PaymentRouteReconciliationItemRecord {
  return {
    id: randomUUID() as UUID,
    tenantId: event.tenantId && isUuid(event.tenantId) ? event.tenantId : null,
    clinicId: event.clinicId && isUuid(event.clinicId) ? event.clinicId : null,
    patientId: event.patientId && isUuid(event.patientId) ? event.patientId : null,
    invoiceId: event.invoiceId && isUuid(event.invoiceId) ? event.invoiceId : null,
    providerKey: event.providerKey,
    providerPaymentId: event.providerPaymentId ?? null,
    providerEventId: event.providerEventId,
    reason,
    amountPaise: amountMinor,
    currency: event.currency ?? null,
    status: "open",
    createdAt: new Date().toISOString(),
    metadata: providerPaymentMetadata(event, {})
  };
}

function publicProviderWebhookEvent(event: PaymentProviderWebhookEvent) {
  return {
    providerKey: event.providerKey,
    providerEventId: event.providerEventId,
    eventName: event.eventName,
    eventKind: event.eventKind
  };
}

function mediaStorageFrom(dependencies: OperationsDependencies): MediaStorageProvider {
  if (!dependencies.mediaStorage) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "Media storage provider is not configured for this ClinicOS runtime."
    );
  }
  return dependencies.mediaStorage;
}

function paymentProviderFrom(dependencies: OperationsDependencies): PaymentProvider {
  if (!dependencies.paymentProvider) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "Payment provider is not configured for this ClinicOS runtime."
    );
  }
  return dependencies.paymentProvider;
}

function paymentRepositoryFrom(dependencies: OperationsDependencies): PaymentOperationsRepository {
  if (!dependencies.paymentRepository) {
    throw new ApiError(
      503,
      "CONFIGURATION_ERROR",
      "Payment repository adapter is not configured yet. Merge the CP5 Billing Domain storage adapter before enabling durable payment routes."
    );
  }
  return dependencies.paymentRepository;
}

function assertMediaUploadOpen(input: {
  id: UUID;
  status: string;
  expiresAt: string;
}): void {
  if (input.status !== "reserved") {
    throw conflict("Media upload reservation is not open.", {
      upload_id: input.id,
      status: input.status
    });
  }
  if (new Date(input.expiresAt).getTime() <= Date.now()) {
    throw conflict("Media upload reservation has expired.", {
      upload_id: input.id,
      expires_at: input.expiresAt
    });
  }
}

function validateCompletedMediaObject(
  reservation: {
    id: UUID;
    expectedFileSizeBytes: number;
    expectedSha256Digest: string | null;
    mimeType: string;
  },
  object: { contentLength: number; sha256Digest: string; mimeType: string },
  input: { contentLength?: number | null; sha256Digest?: string | null; mimeType?: string | null }
): void {
  if (object.contentLength !== reservation.expectedFileSizeBytes) {
    throw validation("Stored media object size does not match the upload reservation.", {
      upload_id: reservation.id
    });
  }
  if (input.contentLength !== undefined && input.contentLength !== null && input.contentLength !== object.contentLength) {
    throw validation("Complete-upload size does not match stored object metadata.", {
      upload_id: reservation.id
    });
  }
  if (object.mimeType.toLowerCase() !== reservation.mimeType.toLowerCase()) {
    throw validation("Stored media object content-type does not match the upload reservation.", {
      upload_id: reservation.id
    });
  }
  if (input.mimeType && input.mimeType.toLowerCase() !== object.mimeType.toLowerCase()) {
    throw validation("Complete-upload content-type does not match stored object metadata.", {
      upload_id: reservation.id
    });
  }
  if (reservation.expectedSha256Digest && object.sha256Digest !== reservation.expectedSha256Digest) {
    throw validation("Stored media object digest does not match the upload reservation.", {
      upload_id: reservation.id
    });
  }
  if (input.sha256Digest && input.sha256Digest !== object.sha256Digest) {
    throw validation("Complete-upload digest does not match stored object metadata.", {
      upload_id: reservation.id
    });
  }
}

function mediaAuditMetadata(input: {
  mediaType: MediaType;
  mimeType: string;
  encounterId?: UUID | null;
  toothNumber?: string | null;
  dentalFindingId?: UUID | null;
  tags?: string[];
  scanStatus?: MediaScanStatus;
}) {
  return {
    mediaType: input.mediaType,
    mimeType: input.mimeType,
    encounterId: input.encounterId ?? null,
    toothNumber: input.toothNumber ?? null,
    dentalFindingId: input.dentalFindingId ?? null,
    tagCount: input.tags?.length ?? 0,
    ...(input.scanStatus ? { scanStatus: input.scanStatus } : {})
  };
}

function publicDentalNumberingSystem(value: string): string {
  return value.toUpperCase();
}

function publicDentalChart<T extends { numberingSystem: string }>(chart: T) {
  return {
    ...chart,
    numberingSystem: publicDentalNumberingSystem(chart.numberingSystem),
    notation: publicDentalNumberingSystem(chart.numberingSystem)
  };
}

function publicDentalFinding<T extends { numberingSystem: string; surface?: string | null }>(
  finding: T
) {
  return {
    ...finding,
    numberingSystem: publicDentalNumberingSystem(finding.numberingSystem),
    surfaces: finding.surface ? [finding.surface] : []
  };
}

function publicDentalFindingHistory<T extends {
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown>;
}>(history: T) {
  return {
    ...history,
    beforeState: history.beforeState ? publicDentalSnapshotFinding(history.beforeState) : null,
    afterState: publicDentalSnapshotFinding(history.afterState)
  };
}

function publicDentalSnapshotFinding<T extends Record<string, unknown>>(finding: T) {
  const numberingSystem =
    typeof finding.numberingSystem === "string"
      ? publicDentalNumberingSystem(finding.numberingSystem)
      : "FDI";
  const surface = typeof finding.surface === "string" ? finding.surface : null;

  return {
    ...finding,
    numberingSystem,
    surfaces: surface ? [surface] : []
  };
}

function publicDentalChartSnapshot<T extends { chartState: { numberingSystem: string } }>(
  snapshot: T
) {
  return {
    ...snapshot,
    chartState: {
      ...snapshot.chartState,
      numberingSystem: publicDentalNumberingSystem(snapshot.chartState.numberingSystem)
    }
  };
}

function publicPricebookProcedure(procedure: PricebookProcedureRecord) {
  return {
    id: procedure.id,
    code: procedure.code,
    displayName: procedure.displayName,
    category: procedure.category,
    description: procedure.description,
    defaultUnitPriceMinor: procedure.defaultUnitPriceMinor,
    currency: procedure.currency,
    taxRateBasisPoints: procedure.taxRateBasisPoints,
    status: procedure.status
  };
}

function publicTreatmentPlanDetail(detail: TreatmentPlanDetail) {
  return {
    ...detail.treatmentPlan,
    phases: detail.phases.map((phase) => ({
      ...phase,
      estimateItems: phase.estimateItems.map((item) => ({ ...item }))
    }))
  };
}

function publicProcedurePerformed<T extends { provenance?: Record<string, unknown> }>(
  procedure: T
) {
  const { provenance: _provenance, ...publicProcedure } = procedure;
  return publicProcedure;
}

function publicInvoiceDetail(detail: InvoiceDetail) {
  return {
    ...detail.invoice,
    items: detail.items.map((item) => ({
      id: item.id,
      invoiceId: item.invoiceId,
      patientId: item.patientId,
      procedurePerformedId: item.procedurePerformedId,
      treatmentPlanEstimateItemId: item.treatmentPlanEstimateItemId,
      pricebookProcedureId: item.pricebookProcedureId,
      description: item.description,
      quantity: item.quantity,
      unitPriceMinor: item.unitPriceMinor,
      discountMinor: item.discountMinor,
      taxRateBasisPoints: item.taxRateBasisPoints,
      taxMinor: item.taxMinor,
      totalMinor: item.totalMinor,
      createdAt: item.createdAt
    })),
    paymentRequests: detail.paymentRequests.map((request) => ({
      id: request.id,
      invoiceId: request.invoiceId,
      patientId: request.patientId,
      provider: request.provider,
      requestType: request.requestType,
      status: request.status,
      amountMinor: request.amountMinor,
      currency: request.currency,
      providerReferenceId: request.providerReferenceId,
      providerUrl: request.providerUrl,
      providerQrPayload: request.providerQrPayload,
      expiresAt: request.expiresAt,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt
    })),
    payments: detail.payments.map((payment) => ({
      id: payment.id,
      invoiceId: payment.invoiceId,
      patientId: payment.patientId,
      paymentRequestId: payment.paymentRequestId,
      provider: payment.provider,
      providerPaymentId: payment.providerPaymentId,
      providerOrderId: payment.providerOrderId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      method: payment.method,
      status: payment.status,
      verificationStatus: payment.verificationStatus,
      reconciliationStatus: payment.reconciliationStatus,
      receivedAt: payment.receivedAt,
      receiptId: payment.receiptId,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt
    })),
    receipts: detail.receipts.map(publicReceipt)
  };
}

function publicPaymentRequest(request: PaymentRequestRecord) {
  return {
    id: request.id,
    invoiceId: request.invoiceId,
    patientId: request.patientId,
    provider: request.provider,
    requestType: request.requestType,
    status: request.status,
    amountMinor: request.amountMinor,
    currency: request.currency,
    providerReferenceId: request.providerReferenceId,
    providerUrl: request.providerUrl,
    providerQrPayload: request.providerQrPayload,
    expiresAt: request.expiresAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt
  };
}

function publicPaymentTransaction(payment: PaymentTransactionRecord) {
  return {
    id: payment.id,
    invoiceId: payment.invoiceId,
    patientId: payment.patientId,
    paymentRequestId: payment.paymentRequestId,
    provider: payment.provider,
    providerPaymentId: payment.providerPaymentId,
    providerOrderId: payment.providerOrderId,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    method: payment.method,
    status: payment.status,
    verificationStatus: payment.verificationStatus,
    reconciliationStatus: payment.reconciliationStatus,
    receivedAt: payment.receivedAt,
    receiptId: payment.receiptId,
    createdAt: payment.createdAt,
    updatedAt: payment.updatedAt
  };
}

function publicPatientInstruction(instruction: PatientInstructionRecord) {
  return {
    id: instruction.id,
    patientId: instruction.patientId,
    channel: instruction.channel,
    templateId: instruction.templateId,
    title: instruction.title,
    body: instruction.body,
    status: instruction.status,
    renderedAt: instruction.renderedAt,
    printJobId: instruction.printJobId,
    outboxEventId: instruction.outboxEventId,
    providerConfirmationReceived: instruction.providerConfirmationReceived,
    providerDeliveryConfirmedAt: instruction.providerDeliveryConfirmedAt,
    deliveredAt: instruction.deliveredAt,
    readAt: instruction.readAt,
    createdAt: instruction.createdAt
  };
}

function publicReceipt<T extends {
  id: UUID;
  invoiceId: UUID;
  patientId: UUID;
  receiptNumber: string;
  status: string;
  amountMinor: number;
  currency: string;
  paymentAllocations: readonly unknown[];
  generatedAt: string;
}>(receipt: T) {
  return {
    id: receipt.id,
    invoiceId: receipt.invoiceId,
    patientId: receipt.patientId,
    receiptNumber: receipt.receiptNumber,
    status: receipt.status,
    amountMinor: receipt.amountMinor,
    currency: receipt.currency,
    paymentAllocations: receipt.paymentAllocations,
    generatedAt: receipt.generatedAt
  };
}

function treatmentPlanItemCount(detail: TreatmentPlanDetail): number {
  return detail.phases.reduce((count, phase) => count + phase.estimateItems.length, 0);
}

function treatmentPlanAuditMetadata(detail: TreatmentPlanDetail) {
  return {
    status: detail.treatmentPlan.status,
    phaseCount: detail.phases.length,
    itemCount: treatmentPlanItemCount(detail),
    totalMinor: detail.treatmentPlan.totalMinor,
    currency: detail.treatmentPlan.currency
  };
}

function invoiceAuditMetadata(detail: InvoiceDetail) {
  return {
    invoiceNumber: detail.invoice.invoiceNumber,
    status: detail.invoice.status,
    paymentStatus: detail.invoice.paymentStatus,
    totalMinor: detail.invoice.totalMinor,
    paidMinor: detail.invoice.paidMinor,
    balanceMinor: detail.invoice.balanceMinor,
    itemCount: detail.items.length,
    paymentCount: detail.payments.length,
    receiptCount: detail.receipts.length
  };
}

function dentalFindingAuditMetadata(input: {
  toothNumber: string;
  surface?: string | null;
  findingType: string;
  severity?: string | null;
  status: string;
  reviewStatus: string;
  source: string;
  encounterId?: UUID | null;
}) {
  return {
    toothNumber: input.toothNumber,
    surfaces: input.surface ? [input.surface] : [],
    findingType: input.findingType,
    severity: input.severity ?? null,
    status: input.status,
    reviewState: input.reviewStatus,
    source: input.source,
    encounterId: input.encounterId ?? null
  };
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

function parseOwnerDashboardRange(filter: {
  from?: string | null;
  to?: string | null;
}): { startAt: string; endAt: string } {
  const today = new Date().toISOString().slice(0, 10);
  const startAt = parseDateBoundary(filter.from ?? today, "from", "start");
  const endAt = parseDateBoundary(filter.to ?? today, "to", "end");

  if (Date.parse(startAt) > Date.parse(endAt)) {
    throw validation("Owner dashboard from date must be on or before to date.", {
      from: filter.from,
      to: filter.to
    });
  }

  return { startAt, endAt };
}

function parseDateBoundary(
  value: string,
  field: "from" | "to",
  boundary: "start" | "end"
): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return boundary === "start"
      ? `${trimmed}T00:00:00.000Z`
      : `${trimmed}T23:59:59.999Z`;
  }

  const timestamp = Date.parse(trimmed);
  if (Number.isNaN(timestamp)) {
    throw validation(`${field} must be an ISO date or timestamp.`, { field });
  }

  return new Date(timestamp).toISOString();
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

function optionalUnitNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const number = numberField(value, field);
  if (number < 0 || number > 1) {
    throw validation(`${field} must be between 0 and 1.`, { field });
  }
  return number;
}

function integerField(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {}
): number {
  const number = numberField(value, field);
  if (!Number.isInteger(number)) {
    throw validation(`${field} must be an integer.`, { field });
  }
  if (options.min !== undefined && number < options.min) {
    throw validation(`${field} must be at least ${options.min}.`, { field });
  }
  if (options.max !== undefined && number > options.max) {
    throw validation(`${field} must be at most ${options.max}.`, { field });
  }
  return number;
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") {
    throw validation(`${field} must be a boolean.`, { field });
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

function stringArrayField(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validation(`${field} must be an array.`, { field });

  return value.map((item, index) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw validation(`${field}[${index}] must be a non-empty string.`, {
        field: `${field}[${index}]`
      });
    }
    return item.trim();
  });
}

function uuidArrayField(value: unknown, field: string): UUID[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw validation(`${field} must be an array.`, { field });

  return value.map((item, index) => uuidField(item, `${field}[${index}]`));
}

function optionalSha256Digest(value: unknown, field: string): string | null {
  const digest = optionalNullableString(value, field);
  if (digest === undefined || digest === null) return null;
  if (!/^[a-f0-9]{64}$/i.test(digest)) {
    throw validation(`${field} must be a lowercase SHA-256 hex digest.`, { field });
  }
  return digest.toLowerCase();
}

function objectField(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
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

function accepted<T>(body: T): ApiSuccess<T> {
  return { status: 202, body };
}

function notFound(message: string, details: Record<string, unknown>): ApiError {
  return new ApiError(404, "NOT_FOUND", message, details);
}

function validation(message: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(400, "VALIDATION_ERROR", message, details);
}

function conflict(message: string, details: Record<string, unknown> = {}): ApiError {
  return new ApiError(409, "CONFLICT", message, details);
}

async function billingRepositoryOperation<T>(
  operation: () => Promise<T>,
  details: Record<string, unknown>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw conflict(
      error instanceof Error ? error.message : "Billing operation violated a domain invariant.",
      details
    );
  }
}

export function randomRequestId(): string {
  return randomUUID();
}
