import {
  assertAppointmentTransition,
  calculateEndAt,
  type AppointmentRecord,
  type AppointmentStatus,
  type QueueStatus
} from "../../appointment.ts";
import type {
  ConsentEnforcementState,
  ConsentRecord,
  IntakeFormSubmissionRecord
} from "../../clinical.ts";
import type { Clock } from "../../time.ts";
import { clinicLocalDateFromClock } from "../../time.ts";
import type { PatientRecord, PatientTimelineItem } from "../../patient.ts";

export interface FrontOfficeAppointmentDraft {
  readonly startAt: string;
  readonly endAt?: string;
  readonly durationMinutes?: number;
}

export function resolveAppointmentWindow(input: FrontOfficeAppointmentDraft): {
  startAt: string;
  endAt: string;
} {
  const startMs = Date.parse(input.startAt);
  if (!Number.isFinite(startMs)) {
    throw new Error("Appointment startAt must be a valid date-time.");
  }

  const endAt = input.endAt ?? calculateEndAt(input.startAt, input.durationMinutes ?? 30);
  const endMs = Date.parse(endAt);
  if (!Number.isFinite(endMs) || endMs <= startMs) {
    throw new Error("Appointment endAt must be later than startAt.");
  }

  return { startAt: new Date(startMs).toISOString(), endAt: new Date(endMs).toISOString() };
}

export function assertFrontOfficeAppointmentTransition(
  current: AppointmentStatus,
  requested: AppointmentStatus
): void {
  assertAppointmentTransition(current, requested);
}

const QUEUE_TRANSITIONS: Readonly<Record<QueueStatus, readonly QueueStatus[]>> = {
  waiting: ["called", "cancelled"],
  called: ["waiting", "in_consult", "cancelled"],
  in_consult: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

export function assertFrontOfficeQueueTransition(
  current: QueueStatus,
  requested: QueueStatus
): void {
  if (current === requested) return;
  if (!QUEUE_TRANSITIONS[current].includes(requested)) {
    throw new Error(`Queue status cannot transition from ${current} to ${requested}.`);
  }
}

export function resolveClinicDay(input: {
  readonly requestedDate?: string | null;
  readonly clock: Clock;
  readonly clinicTimeZone: string;
}): string {
  return input.requestedDate ?? clinicLocalDateFromClock(input.clock, input.clinicTimeZone);
}

export interface FrontOfficePrepSummary {
  readonly patient: Pick<PatientRecord, "id" | "fullName" | "phone" | "dateOfBirth" | "gender">;
  readonly appointment: Pick<
    AppointmentRecord,
    "id" | "status" | "startAt" | "endAt" | "providerUserId" | "reason"
  > | null;
  readonly generatedAt: string;
  readonly latestIntakeResponse: IntakeFormSubmissionRecord | null;
  readonly consentEnforcementState: ConsentEnforcementState;
  readonly activeConsentPurposes: readonly ConsentRecord["purpose"][];
  readonly timelineHighlights: readonly PatientTimelineItem[];
  readonly priorClinicalTimeline: readonly PatientTimelineItem[];
  readonly medicalHistoryChangePromptRequired: boolean;
  readonly dataCoverage: Readonly<Record<string, "available">>;
}

export function buildFrontOfficePrepSummary(input: {
  readonly patient: PatientRecord;
  readonly appointment: AppointmentRecord | null;
  readonly generatedAt: string;
  readonly intakeSubmissions: readonly IntakeFormSubmissionRecord[];
  readonly consents: readonly ConsentRecord[];
  readonly consentEnforcementState: ConsentEnforcementState;
  readonly timeline: readonly PatientTimelineItem[];
}): FrontOfficePrepSummary {
  const latestIntakeResponse =
    [...input.intakeSubmissions].sort((left, right) =>
      right.submittedAt.localeCompare(left.submittedAt)
    )[0] ?? null;
  const clinicalItemTypes = new Set<PatientTimelineItem["itemType"]>([
    "encounter_created",
    "encounter_started",
    "encounter_completed",
    "clinical_note_draft_created",
    "clinical_note_signed",
    "clinical_note_amended",
    "prescription_draft_created",
    "prescription_signed",
    "dental_finding_created",
    "dental_finding_updated",
    "dental_chart_snapshot_created"
  ]);

  return {
    patient: {
      id: input.patient.id,
      fullName: input.patient.fullName,
      phone: input.patient.phone,
      dateOfBirth: input.patient.dateOfBirth,
      gender: input.patient.gender
    },
    appointment: input.appointment
      ? {
          id: input.appointment.id,
          status: input.appointment.status,
          startAt: input.appointment.startAt,
          endAt: input.appointment.endAt,
          providerUserId: input.appointment.providerUserId,
          reason: input.appointment.reason
        }
      : null,
    generatedAt: input.generatedAt,
    latestIntakeResponse,
    consentEnforcementState: input.consentEnforcementState,
    activeConsentPurposes: input.consents
      .filter((consent) => consent.status === "active")
      .map((consent) => consent.purpose)
      .sort(),
    timelineHighlights: input.timeline.slice(0, 10),
    priorClinicalTimeline: input.timeline.filter((item) => clinicalItemTypes.has(item.itemType)),
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
}
