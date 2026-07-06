export const DOMAIN_EVENT_TYPES = [
  "lead.created",
  "lead.matched_to_patient",
  "lead.converted_to_appointment",
  "patient.created",
  "patient.updated",
  "patient.duplicate_detected",
  "appointment.requested",
  "appointment.created",
  "appointment.confirmation_requested",
  "appointment.confirmed",
  "appointment.rescheduled",
  "appointment.cancelled",
  "appointment.no_show",
  "patient.checked_in",
  "queue.entry_created",
  "queue.entry_called",
  "attribution.touch.created"
] as const;

export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export interface DomainEventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventId: string;
  eventType: DomainEventType;
  schemaVersion: "1.0";
  tenantId: string;
  clinicId: string;
  actor: {
    type: "user" | "system" | "integration" | "ai";
    id: string;
  };
  occurredAt: string;
  idempotencyKey: string | null;
  correlationId: string | null;
  payload: TPayload;
}
