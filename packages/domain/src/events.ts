import { randomUUID } from "node:crypto";
import type { AuditActor } from "./audit.ts";
import type { UUID } from "./ids.ts";

export const DOMAIN_EVENT_TYPES = [
  "lead.created",
  "lead.matched_to_patient",
  "lead.converted_to_appointment",
  "attribution.touch.created",
  "patient.created",
  "patient.updated",
  "patient.duplicate_detected",
  "appointment.requested",
  "appointment.created",
  "appointment.updated",
  "appointment.confirmation_requested",
  "appointment.confirmed",
  "appointment.rescheduled",
  "appointment.cancelled",
  "appointment.no_show",
  "patient.checked_in",
  "queue.entry_created",
  "queue.entry_called",
  "queue.entry_updated",
  "task.created",
  "task.status_changed",
  "task.due",
  "form_response.submitted",
  "consent.created",
  "consent.revoked",
  "encounter.created",
  "encounter.started",
  "encounter.completed",
  "clinical_note.draft_created",
  "clinical_note.signed",
  "clinical_note.amended",
  "dental.finding.created",
  "dental.finding.updated",
  "dental.chart.snapshot_created",
  "prescription.draft_created",
  "prescription.signed",
  "patient.timeline_item.created"
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export const CP2_LEAD_EVENT_TYPES = [
  "lead.created",
  "lead.matched_to_patient",
  "lead.converted_to_appointment",
  "attribution.touch.created"
] as const;

export const CP2_PATIENT_EVENT_TYPES = ["patient.created", "patient.updated"] as const;

export const CP2_APPOINTMENT_EVENT_TYPES = [
  "appointment.created",
  "appointment.confirmation_requested",
  "appointment.confirmed",
  "appointment.no_show",
  "patient.checked_in",
  "queue.entry_created",
  "queue.entry_updated"
] as const;

export const CP2_DASHBOARD_TASK_EVENT_TYPES = [
  "task.created",
  "task.status_changed",
  "task.due"
] as const;

export const CP2_EVENT_TYPES = [
  ...CP2_LEAD_EVENT_TYPES,
  ...CP2_PATIENT_EVENT_TYPES,
  ...CP2_APPOINTMENT_EVENT_TYPES,
  ...CP2_DASHBOARD_TASK_EVENT_TYPES
] as const;

export const CP3_INTAKE_CONSENT_EVENT_TYPES = [
  "form_response.submitted",
  "consent.created",
  "consent.revoked"
] as const;

export const CP3_CLINICAL_EVENT_TYPES = [
  "encounter.created",
  "encounter.started",
  "encounter.completed",
  "clinical_note.draft_created",
  "clinical_note.signed",
  "clinical_note.amended",
  "prescription.draft_created",
  "prescription.signed"
] as const;

export const CP3_TIMELINE_EVENT_TYPES = ["patient.timeline_item.created"] as const;

export const CP3_EVENT_TYPES = [
  ...CP2_EVENT_TYPES,
  ...CP3_INTAKE_CONSENT_EVENT_TYPES,
  ...CP3_CLINICAL_EVENT_TYPES,
  ...CP3_TIMELINE_EVENT_TYPES
] as const;

export const CP4_DENTAL_EVENT_TYPES = [
  "dental.finding.created",
  "dental.finding.updated",
  "dental.chart.snapshot_created"
] as const;

export const CP4_EVENT_TYPES = [...CP3_EVENT_TYPES, ...CP4_DENTAL_EVENT_TYPES] as const;

export type Cp2LeadEventType = (typeof CP2_LEAD_EVENT_TYPES)[number];
export type Cp2PatientEventType = (typeof CP2_PATIENT_EVENT_TYPES)[number];
export type Cp2AppointmentEventType = (typeof CP2_APPOINTMENT_EVENT_TYPES)[number];
export type Cp2DashboardTaskEventType = (typeof CP2_DASHBOARD_TASK_EVENT_TYPES)[number];
export type Cp2EventType = (typeof CP2_EVENT_TYPES)[number];
export type Cp3IntakeConsentEventType = (typeof CP3_INTAKE_CONSENT_EVENT_TYPES)[number];
export type Cp3ClinicalEventType = (typeof CP3_CLINICAL_EVENT_TYPES)[number];
export type Cp3TimelineEventType = (typeof CP3_TIMELINE_EVENT_TYPES)[number];
export type Cp3EventType = (typeof CP3_EVENT_TYPES)[number];
export type Cp4DentalEventType = (typeof CP4_DENTAL_EVENT_TYPES)[number];
export type Cp4EventType = (typeof CP4_EVENT_TYPES)[number];

export type EventSourceKind =
  | "external_system"
  | "manual_entry"
  | "manual_import"
  | "patient_message"
  | "phone_call"
  | "walk_in"
  | "referral"
  | "system";

export interface EventProvenanceSource {
  kind: EventSourceKind;
  providerKey?: string;
  externalRef?: string;
  rawEventId?: string;
  campaign?: string;
  referralSource?: string;
  sourceRecordId?: string;
  capturedAt?: string;
  receivedAt?: string;
}

export interface DomainEventAggregate {
  type:
    | "lead"
    | "patient"
    | "appointment"
    | "queue_entry"
    | "task"
    | "attribution_touch"
    | "form_response"
    | "consent"
    | "encounter"
    | "clinical_note"
    | "dental_finding"
    | "dental_chart_snapshot"
    | "prescription"
    | "patient_timeline_item";
  id: UUID | string;
}

export interface DomainEventEnvelope<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
  TEventType extends string = DomainEventType
> {
  eventId: UUID | string;
  eventType: TEventType;
  schemaVersion: "1.0";
  tenantId: UUID | string;
  clinicId: UUID | string;
  actor: AuditActor;
  occurredAt: string;
  idempotencyKey?: string | null;
  correlationId: string;
  source: EventProvenanceSource;
  aggregate?: DomainEventAggregate;
  patientId?: UUID | string;
  payload: TPayload;
}

export interface CreateDomainEventInput<
  TPayload extends Record<string, unknown>,
  TEventType extends string = DomainEventType
> {
  eventId?: UUID | string;
  eventType: TEventType;
  tenantId: UUID | string;
  clinicId: UUID | string;
  actor: AuditActor;
  occurredAt?: string;
  idempotencyKey?: string | null;
  correlationId: string;
  source: EventProvenanceSource;
  aggregate?: DomainEventAggregate;
  patientId?: UUID | string;
  payload: TPayload;
}

export function isDomainEventType(value: string): value is DomainEventType {
  return (DOMAIN_EVENT_TYPES as readonly string[]).includes(value);
}

export function isCp2EventType(value: string): value is Cp2EventType {
  return (CP2_EVENT_TYPES as readonly string[]).includes(value);
}

export function isCp3EventType(value: string): value is Cp3EventType {
  return (CP3_EVENT_TYPES as readonly string[]).includes(value);
}

export function isCp4EventType(value: string): value is Cp4EventType {
  return (CP4_EVENT_TYPES as readonly string[]).includes(value);
}

export function createDomainEventEnvelope<
  TPayload extends Record<string, unknown>,
  TEventType extends string = DomainEventType
>(input: CreateDomainEventInput<TPayload, TEventType>): DomainEventEnvelope<TPayload, TEventType> {
  if (!input.correlationId.trim()) {
    throw new Error("Domain event correlationId is required.");
  }

  if (!input.source.kind) {
    throw new Error("Domain event source.kind is required.");
  }

  const base = {
    eventId: input.eventId ?? randomUUID(),
    eventType: input.eventType,
    schemaVersion: "1.0" as const,
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    actor: input.actor,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    correlationId: input.correlationId,
    source: input.source,
    payload: input.payload
  };

  return {
    ...base,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
    ...(input.aggregate ? { aggregate: input.aggregate } : {}),
    ...(input.patientId ? { patientId: input.patientId } : {})
  };
}
