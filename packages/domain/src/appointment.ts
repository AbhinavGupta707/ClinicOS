import type { UUID } from "./ids.ts";
import type { LeadSource } from "./lead.ts";

export type AppointmentStatus =
  | "requested"
  | "booked"
  | "confirmed"
  | "checked_in"
  | "in_consult"
  | "completed"
  | "cancelled"
  | "no_show";

export interface AppointmentTypeRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  code: string;
  displayName: string;
  defaultDurationMinutes: number;
  color: string | null;
  active: boolean;
}

export interface ProviderScheduleRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  providerUserId: UUID;
  dayOfWeek: number;
  startsAt: string;
  endsAt: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  active: boolean;
}

export interface ChairOrRoomRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  code: string;
  displayName: string;
  active: boolean;
}

export interface AppointmentRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  rowVersion: number;
  patientId: UUID;
  leadId: UUID | null;
  providerUserId: UUID;
  appointmentTypeId: UUID;
  chairId: UUID | null;
  status: AppointmentStatus;
  startAt: string;
  endAt: string;
  source: LeadSource;
  reason: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppointmentStatusHistoryRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  appointmentId: UUID;
  fromStatus: AppointmentStatus | null;
  toStatus: AppointmentStatus;
  changedByUserId: UUID | null;
  changedAt: string;
  reason: string | null;
}

export type QueueStatus = "waiting" | "called" | "in_consult" | "completed" | "cancelled";

export interface QueueEntryRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  rowVersion: number;
  appointmentId: UUID;
  patientId: UUID;
  providerUserId: UUID;
  status: QueueStatus;
  position: number;
  checkedInAt: string;
  calledAt: string | null;
  completedAt: string | null;
}

export interface AppointmentConflict {
  appointmentId: UUID;
  patientId: UUID;
  providerUserId: UUID;
  chairId: UUID | null;
  startAt: string;
  endAt: string;
  reason: "provider_overlap" | "chair_overlap";
}

export interface AppointmentWindow {
  startAt: string | Date;
  endAt: string | Date;
}

const ACTIVE_CONFLICT_STATUSES = new Set<AppointmentStatus>([
  "requested",
  "booked",
  "confirmed",
  "checked_in",
  "in_consult"
]);

const ALLOWED_APPOINTMENT_TRANSITIONS: Readonly<Record<AppointmentStatus, readonly AppointmentStatus[]>> = {
  requested: ["booked", "confirmed", "cancelled", "no_show"],
  booked: ["confirmed", "checked_in", "cancelled", "no_show"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_consult", "completed", "cancelled", "no_show"],
  in_consult: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: ["booked"]
};

export function assertAppointmentTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (from === to) return;

  if (!ALLOWED_APPOINTMENT_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Appointment status cannot transition from ${from} to ${to}.`);
  }
}

export function isAppointmentStatus(value: string): value is AppointmentStatus {
  return value in ALLOWED_APPOINTMENT_TRANSITIONS;
}

export function appointmentBlocksTime(status: AppointmentStatus): boolean {
  return ACTIVE_CONFLICT_STATUSES.has(status);
}

export function windowsOverlap(left: AppointmentWindow, right: AppointmentWindow): boolean {
  const leftStart = new Date(left.startAt).getTime();
  const leftEnd = new Date(left.endAt).getTime();
  const rightStart = new Date(right.startAt).getTime();
  const rightEnd = new Date(right.endAt).getTime();

  return leftStart < rightEnd && rightStart < leftEnd;
}

export function detectAppointmentConflicts(
  candidate: Pick<AppointmentRecord, "providerUserId" | "chairId" | "startAt" | "endAt">,
  existingAppointments: readonly AppointmentRecord[]
): AppointmentConflict[] {
  const conflicts: AppointmentConflict[] = [];

  for (const appointment of existingAppointments) {
    if (!appointmentBlocksTime(appointment.status)) continue;
    if (!windowsOverlap(candidate, appointment)) continue;

    if (appointment.providerUserId === candidate.providerUserId) {
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

    if (candidate.chairId && appointment.chairId === candidate.chairId) {
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
  }

  return conflicts;
}

export function calculateEndAt(startAt: string | Date, durationMinutes: number): string {
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0 || durationMinutes > 24 * 60) {
    throw new Error("Appointment durationMinutes must be a positive whole number below 24 hours.");
  }

  const startMs = new Date(startAt).getTime();

  if (!Number.isFinite(startMs)) {
    throw new Error("Appointment startAt must be a valid date-time.");
  }

  return new Date(startMs + durationMinutes * 60 * 1000).toISOString();
}
