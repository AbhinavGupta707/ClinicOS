export const COMMUNICATION_STATES = ["open", "waiting", "handled"] as const;
export type CommunicationState = (typeof COMMUNICATION_STATES)[number];

export interface CommunicationThread {
  id: string;
  accountId: string;
  contact: string;
  status: CommunicationState;
  assignedUserId: string | null;
  assignedName: string | null;
  patientId: string | null;
  patientName: string | null;
  leadId: string | null;
  rowVersion: number;
  latestSequence: number;
  unread: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface CommunicationMessage {
  id: string;
  sequence: number;
  kind: "inbound" | "manual_contact" | "appointment_request";
  text: string | null;
  unsupportedContent: boolean;
  occurredAt: string;
  recordedAt: string;
  recordedBy: string | null;
  requestId: string | null;
  dispatchStatus: string | null;
  deliveryStatus: string | null;
  failureCode: string | null;
}
export interface CommunicationTemplate {
  id: string;
  accountId: string;
  name: string;
  language: string;
  lifecycle: string;
  syncStatus: "not_synced" | "queued" | "ready" | "unsupported" | "failed" | "stale";
  body: string | null;
  verifiedAt: string | null;
}
export interface CommunicationConfiguration {
  accounts: Array<{ id: string; name: string; activation: string }>;
  templates: CommunicationTemplate[];
  staff: Array<{ id: string; name: string }>;
  nextTemplateCursor: string | null;
}
export interface AppointmentMessagePreview {
  threadId: string;
  appointmentId: string;
  templateId: string;
  patientId: string;
  recipient: string;
  text: string;
  parameter: string;
  templateName: string;
  language: string;
  digest: string;
}
export type CommunicationCommand =
  | { kind: "start"; accountId: string; patientId: string }
  | {
      kind: "update";
      threadId: string;
      expectedVersion: number;
      status: CommunicationState;
      assignedUserId: string | null;
    }
  | {
      kind: "link";
      threadId: string;
      expectedVersion: number;
      patientId: string | null;
      leadId: string | null;
      reason: string;
    }
  | { kind: "read"; threadId: string; throughSequence: number }
  | { kind: "manual_contact"; threadId: string; expectedVersion: number; evidence: string }
  | { kind: "sync_template"; templateId: string }
  | {
      kind: "approve";
      threadId: string;
      appointmentId: string;
      templateId: string;
      expectedDigest: string;
    }
  | { kind: "cancel_request"; requestId: string };

export function communicationPhone(value: string): string | null {
  return /^\+?[1-9][0-9]{7,14}$/u.test(value) ? `+${value.replace(/^\+/u, "")}` : null;
}

/** Only plain BODY templates with one positional text parameter are supported. */
export function approvedAppointmentTemplate(value: unknown): {
  id: string;
  name: string;
  language: string;
  body: string;
} | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (
    r.status !== "APPROVED" ||
    r.category !== "UTILITY" ||
    typeof r.id !== "string" ||
    !/^[1-9][0-9]{1,31}$/u.test(r.id) ||
    typeof r.name !== "string" ||
    !/^[a-z0-9_]{1,512}$/u.test(r.name) ||
    typeof r.language !== "string" ||
    !/^[a-z]{2,3}(?:_[A-Z]{2})?$/u.test(r.language) ||
    !Array.isArray(r.components) ||
    r.components.length !== 1
  )
    return null;
  const body = r.components[0] as Record<string, unknown> | null;
  if (
    !body ||
    body.type !== "BODY" ||
    typeof body.text !== "string" ||
    !body.text.includes("{{1}}") ||
    body.text.length > 1024 ||
    body.text.indexOf("{{1}}") !== body.text.lastIndexOf("{{1}}") ||
    /[{}]/u.test(body.text.replaceAll("{{1}}", "")) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(body.text)
  )
    return null;
  return { id: r.id, name: r.name, language: r.language, body: body.text };
}

export function appointmentMessageParameter(input: {
  clinic: string;
  doctor: string;
  startsAt: string;
  timezone: string;
}): string {
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: input.timezone,
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).format(new Date(input.startsAt));
  const result = `Your appointment at ${input.clinic} with ${input.doctor} is on ${when} (${input.timezone}).`;
  if (result.length > 512 || /[\u0000-\u001f]/u.test(result))
    throw new RangeError("Appointment details cannot be represented in this message.");
  return result;
}
