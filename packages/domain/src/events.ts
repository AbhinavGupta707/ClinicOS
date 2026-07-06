import { randomUUID } from "node:crypto";
import type { AuditActor } from "./audit.ts";
import type { UUID } from "./ids.ts";

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

export type Cp2LeadEventType = (typeof CP2_LEAD_EVENT_TYPES)[number];
export type Cp2PatientEventType = (typeof CP2_PATIENT_EVENT_TYPES)[number];
export type Cp2AppointmentEventType = (typeof CP2_APPOINTMENT_EVENT_TYPES)[number];
export type Cp2DashboardTaskEventType = (typeof CP2_DASHBOARD_TASK_EVENT_TYPES)[number];
export type Cp2EventType = (typeof CP2_EVENT_TYPES)[number];

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
  type: "lead" | "patient" | "appointment" | "queue_entry" | "task" | "attribution_touch";
  id: UUID | string;
}

export interface DomainEventEnvelope<
  TPayload extends Record<string, unknown>,
  TEventType extends string = Cp2EventType
> {
  eventId: UUID | string;
  eventType: TEventType;
  schemaVersion: "1.0";
  tenantId: UUID | string;
  clinicId: UUID | string;
  actor: AuditActor;
  occurredAt: string;
  idempotencyKey?: string;
  correlationId: string;
  source: EventProvenanceSource;
  aggregate?: DomainEventAggregate;
  patientId?: UUID | string;
  payload: TPayload;
}

export interface CreateDomainEventInput<
  TPayload extends Record<string, unknown>,
  TEventType extends string = Cp2EventType
> {
  eventId?: UUID | string;
  eventType: TEventType;
  tenantId: UUID | string;
  clinicId: UUID | string;
  actor: AuditActor;
  occurredAt?: string;
  idempotencyKey?: string;
  correlationId: string;
  source: EventProvenanceSource;
  aggregate?: DomainEventAggregate;
  patientId?: UUID | string;
  payload: TPayload;
}

export function isCp2EventType(value: string): value is Cp2EventType {
  return (CP2_EVENT_TYPES as readonly string[]).includes(value);
}

export function createDomainEventEnvelope<
  TPayload extends Record<string, unknown>,
  TEventType extends string = Cp2EventType
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
