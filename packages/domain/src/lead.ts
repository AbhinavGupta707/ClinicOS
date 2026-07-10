import type { UUID } from "./ids.ts";
import type { PatientSource } from "./patient.ts";

export type LeadStatus = "new" | "contacted" | "matched" | "booked" | "lost" | "duplicate" | "spam";
export type LeadIntent =
  | "appointment_request"
  | "pricing_query"
  | "followup"
  | "emergency"
  | "lab_vendor"
  | "unknown";

export type LeadSource = Exclude<PatientSource, "imported" | "external_system">;

export interface LeadRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  rowVersion: number;
  patientId: UUID | null;
  primaryContact: string;
  status: LeadStatus;
  intent: LeadIntent;
  source: LeadSource;
  sourceDetail: Record<string, unknown>;
  firstSeenAt: string;
  lastActivityAt: string;
  createdByUserId: UUID | null;
}

export interface AttributionTouchRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID | null;
  leadId: UUID | null;
  appointmentId: UUID | null;
  invoiceId: UUID | null;
  source: LeadSource;
  medium: string | null;
  campaign: string | null;
  externalRef: string | null;
  touchType: "first_touch" | "booking_touch" | "revenue_touch" | "recall_touch";
  occurredAt: string;
  metadata: Record<string, unknown>;
}

const ALLOWED_LEAD_TRANSITIONS: Readonly<Record<LeadStatus, readonly LeadStatus[]>> = {
  new: ["contacted", "matched", "booked", "lost", "duplicate", "spam"],
  contacted: ["matched", "booked", "lost", "duplicate", "spam"],
  matched: ["booked", "lost", "duplicate"],
  booked: [],
  lost: ["contacted"],
  duplicate: [],
  spam: []
};

export function assertLeadTransition(from: LeadStatus, to: LeadStatus): void {
  if (from === to) return;

  if (!ALLOWED_LEAD_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Lead status cannot transition from ${from} to ${to}.`);
  }
}

export function isValidLeadStatus(value: string): value is LeadStatus {
  return value in ALLOWED_LEAD_TRANSITIONS;
}

export function isLeadTerminal(status: LeadStatus): boolean {
  return status === "booked" || status === "duplicate" || status === "spam";
}
