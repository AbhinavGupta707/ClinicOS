import {
  addOptional,
  ensureAllowedKeys,
  optionalString,
  parseRequestContext,
  parseWithIssues,
  requiredString,
  type ContractParseResult,
  type RequestContext
} from "./validation.ts";

export interface AssistantMorningDashboardRequest extends RequestContext {
  date: string;
  timezone: string;
  providerId?: string;
}

export interface DashboardAppointmentSlice {
  appointmentId: string;
  patientId: string;
  patientDisplayName: string;
  status: "requested" | "booked" | "confirmed" | "checked_in" | "in_consult" | "completed" | "cancelled" | "no_show";
  startAt: string;
  endAt: string;
  providerUserId: string;
  newOrReturning: "new" | "returning" | "unknown";
  confirmationStatus: "not_requested" | "requested" | "confirmed" | "failed";
  noShowRisk: "low" | "medium" | "high" | "unknown";
}

export interface DashboardTaskSlice {
  taskId: string;
  taskType:
    | "lead_follow_up"
    | "missed_call"
    | "appointment_confirmation"
    | "recall"
    | "payment_follow_up"
    | "lab_follow_up"
    | "sop";
  title: string;
  patientId: string | null;
  leadId: string | null;
  dueAt: string;
  sourceEventType: string;
}

export interface AssistantMorningDashboardResponse {
  date: string;
  timezone: string;
  appointments: DashboardAppointmentSlice[];
  unconfirmedAppointments: DashboardAppointmentSlice[];
  queue: {
    waiting: number;
    inConsult: number;
    completed: number;
  };
  tasks: DashboardTaskSlice[];
  counts: {
    leadsNew: number;
    missedCalls: number;
    dueFollowUps: number;
    pendingPayments: number;
    pendingLabCases: number;
    sopTasksDue: number;
  };
  generatedAt: string;
}

export function parseAssistantMorningDashboardRequest(
  input: unknown
): ContractParseResult<AssistantMorningDashboardRequest> {
  return parseWithIssues(input, (record, issues) => {
    ensureAllowedKeys(
      record,
      [
        "tenantId",
        "clinicId",
        "actor",
        "correlationId",
        "requestId",
        "date",
        "timezone",
        "providerId"
      ],
      "$",
      issues
    );

    const request: AssistantMorningDashboardRequest = {
      ...parseRequestContext(record, "$", issues),
      date: requiredString(record, "date", "$", issues, { dateOnly: true }),
      timezone: requiredString(record, "timezone", "$", issues)
    };
    addOptional(request, "providerId", optionalString(record, "providerId", "$", issues, { uuid: true }));

    return request;
  });
}
