import {
  assertAppointmentTransition,
  calculateEndAt,
  type AppointmentRecord,
  type AppointmentStatus,
  type ProviderScheduleRecord,
  type QueueStatus
} from "../../appointment.ts";
import type {
  ConsentEnforcementState,
  ConsentRecord,
  IntakeFormSubmissionRecord
} from "../../clinical.ts";
import type { Clock } from "../../time.ts";
import { clinicLocalDate, clinicLocalDateFromClock } from "../../time.ts";
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

export function appointmentClinicLocalDate(startAt: string, clinicTimeZone: string): string {
  const instant = new Date(startAt);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("Appointment startAt must be a valid date-time.");
  }
  return clinicLocalDate(instant, clinicTimeZone);
}

export function providerScheduleCoversAppointment(
  schedule: Readonly<ProviderScheduleRecord>,
  input: Readonly<{ startAt: string; endAt: string; clinicTimeZone: string }>
): boolean {
  if (!schedule.active) return false;
  const start = new Date(input.startAt);
  const end = new Date(input.endAt);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end.getTime() <= start.getTime()
  ) {
    return false;
  }

  const startDate = clinicLocalDate(start, input.clinicTimeZone);
  const endDate = clinicLocalDate(end, input.clinicTimeZone);
  if (startDate !== endDate) return false;
  if (startDate < schedule.effectiveFrom) return false;
  if (schedule.effectiveUntil && startDate > schedule.effectiveUntil) return false;
  if (new Date(`${startDate}T00:00:00.000Z`).getUTCDay() !== schedule.dayOfWeek) return false;

  const startSecond = clinicLocalSecondOfDay(start, input.clinicTimeZone);
  const endSecond = clinicLocalSecondOfDay(end, input.clinicTimeZone);
  const scheduleStartSecond = scheduleSecondOfDay(schedule.startsAt);
  const scheduleEndSecond = scheduleSecondOfDay(schedule.endsAt);
  return startSecond >= scheduleStartSecond && endSecond <= scheduleEndSecond;
}

function clinicLocalSecondOfDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(instant);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const hour = Number(byType.get("hour"));
  const minute = Number(byType.get("minute"));
  const second = Number(byType.get("second"));
  if (![hour, minute, second].every(Number.isInteger)) {
    throw new Error(`Unable to derive clinic-local time for timezone ${timeZone}.`);
  }
  return hour * 3600 + minute * 60 + second;
}

function scheduleSecondOfDay(value: string): number {
  const match = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(value);
  if (!match) throw new Error("Provider schedule time is invalid.");
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3] ?? "0");
  if (hour > 23 || minute > 59 || second > 59) {
    throw new Error("Provider schedule time is invalid.");
  }
  return hour * 3600 + minute * 60 + second;
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
