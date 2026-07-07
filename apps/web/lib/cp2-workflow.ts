export type WorkflowSource =
  | "google"
  | "instagram"
  | "manual"
  | "phone"
  | "practo"
  | "recall"
  | "referral"
  | "walk_in"
  | "whatsapp"
  | "website";

export type PatientKind = "new" | "returning";

export type LeadStatus = "booked" | "duplicate" | "lost" | "matched" | "new" | "pending" | "spam";

export type AppointmentStatus =
  | "booked"
  | "cancelled"
  | "checked_in"
  | "completed"
  | "confirmed"
  | "in_consult"
  | "no_show"
  | "requested";

export type ConfirmationState = "confirmed" | "draft_ready" | "not_sent" | "sent";

export type QueueState = "called" | "not_checked_in" | "waiting" | "with_doctor";

export interface AttributionTouch {
  capturedAt: string;
  detail?: string;
  externalRef?: string;
  source: WorkflowSource;
}

export interface PatientSummary {
  attribution: AttributionTouch[];
  displayName: string;
  id: string;
  kind: PatientKind;
  lastVisitAt?: string;
  phone: string;
}

export interface DuplicateSuggestion {
  matchedOn: "name" | "phone";
  patient: PatientSummary;
  score: number;
}

export interface LeadSummary {
  attribution: AttributionTouch;
  contactName: string;
  deliveryStatus?: string;
  id: string;
  intent: "appointment_request" | "callback_request" | "document_received" | "other";
  matchedPatientId?: string;
  messageSnippet: string;
  phone: string;
  receivedAt: string;
  requestedWindow?: string;
  slaMinutesRemaining: number;
  status: LeadStatus;
}

export interface AppointmentSummary {
  appointmentType: string;
  chair: string;
  confirmationState: ConfirmationState;
  endAt: string;
  id: string;
  leadId?: string;
  patientId: string;
  patientKind: PatientKind;
  patientName: string;
  providerName: string;
  source: WorkflowSource;
  startAt: string;
  status: AppointmentStatus;
}

export interface QueueEntrySummary {
  appointmentId: string;
  checkedInAt?: string;
  id: string;
  patientId: string;
  patientKind: PatientKind;
  patientName: string;
  providerName: string;
  state: QueueState;
  waitMinutes: number;
}

export interface Cp2WorkflowData {
  api?: {
    environment?: string;
    requestIds: string[];
  };
  appointments: AppointmentSummary[];
  leads: LeadSummary[];
  patients: PatientSummary[];
  queue: QueueEntrySummary[];
  source: "api" | "cp2_fixture";
  today: string;
}

export type WorkflowProblemCode =
  | "AUTH_REQUIRED"
  | "CONTRACT_MISMATCH"
  | "CP2_ENDPOINT_NOT_REGISTERED"
  | "NETWORK_UNAVAILABLE"
  | "SERVER_ERROR"
  | "UNKNOWN";

export interface WorkflowEndpointIssue {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export interface WorkflowProblem {
  code: WorkflowProblemCode;
  detail?: string;
  endpoints: WorkflowEndpointIssue[];
  message: string;
}

export type Cp2WorkflowLoadState =
  | { data: Cp2WorkflowData; status: "ready" }
  | { problem: WorkflowProblem; status: "unavailable" | "unauthenticated" };

export interface PatientCreateInput {
  displayName: string;
  phone: string;
  source: WorkflowSource;
}

export interface LeadCreateInput {
  contactName: string;
  messageSnippet: string;
  phone: string;
  source: WorkflowSource;
}

export interface AppointmentCreateInput {
  appointmentType: string;
  chair: string;
  durationMinutes: number;
  leadId: string;
  patientId: string;
  providerName: string;
  source: WorkflowSource;
  startAt: string;
}

export interface DashboardSummary {
  bookedToday: number;
  checkedIn: number;
  confirmed: number;
  leadTasks: number;
  newPatientsToday: number;
  noShowRisk: number;
  queueWaiting: number;
  returningPatientsToday: number;
  unconfirmed: number;
}

interface EndpointResponse {
  endpoint: string;
  payload: unknown;
  requestId?: string;
  status: number;
}

interface EndpointFailure {
  endpoint: string;
  message: string;
  requestId?: string;
  status?: number;
}

export const CP2_REQUIRED_ENDPOINTS = [
  "GET /v1/appointments?date=",
  "GET /v1/queue?date=",
  "GET /v1/leads?status=",
  "GET /v1/patients?query=&phone=&source=",
  "POST /v1/leads"
] as const;

export const SOURCE_LABELS: Record<WorkflowSource, string> = {
  google: "Google",
  instagram: "Instagram",
  manual: "Manual",
  phone: "Phone",
  practo: "Practo",
  recall: "Recall campaign",
  referral: "Referral",
  walk_in: "Walk-in",
  whatsapp: "WhatsApp",
  website: "Website"
};

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  booked: "Booked",
  duplicate: "Duplicate",
  lost: "Lost",
  matched: "Matched",
  new: "New",
  pending: "Pending",
  spam: "Spam"
};

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  booked: "Booked",
  cancelled: "Cancelled",
  checked_in: "Checked in",
  completed: "Completed",
  confirmed: "Confirmed",
  in_consult: "In consult",
  no_show: "No-show",
  requested: "Requested"
};

export const CONFIRMATION_LABELS: Record<ConfirmationState, string> = {
  confirmed: "Confirmed",
  draft_ready: "Draft ready",
  not_sent: "Not sent",
  sent: "Sent"
};

export const QUEUE_STATE_LABELS: Record<QueueState, string> = {
  called: "Called",
  not_checked_in: "Not checked in",
  waiting: "Waiting",
  with_doctor: "With doctor"
};

const DEFAULT_APPOINTMENT_DURATION_MINUTES = 30;
const FIXTURE_ENVIRONMENTS = new Set(["development", "dev", "local", "test"]);
let fixtureIdCounter = 0;

export function getTodayInputValue(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

export function isCp2FixtureAllowed() {
  const fixtureRequested = process.env.NEXT_PUBLIC_CLINIC_OS_USE_CP2_WORKFLOW_FIXTURE === "true";
  const environment = process.env.NEXT_PUBLIC_CLINIC_OS_ENV ?? process.env.NODE_ENV;

  return fixtureRequested && FIXTURE_ENVIRONMENTS.has(environment);
}

export function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "");
}

export function sourceLabel(source: WorkflowSource) {
  return SOURCE_LABELS[source] ?? source;
}

export function formatPatientKind(kind: PatientKind) {
  return kind === "new" ? "New patient" : "Returning patient";
}

export function duplicateSuggestionDisplayText(suggestion: DuplicateSuggestion) {
  return `${suggestion.patient.phone} · ${formatPatientKind(suggestion.patient.kind)} · matched by ${
    suggestion.matchedOn
  }`;
}

export function summarizeDashboard(data: Cp2WorkflowData): DashboardSummary {
  const bookedToday = data.appointments.filter(
    (appointment) => !["cancelled", "no_show"].includes(appointment.status)
  ).length;
  const confirmed = data.appointments.filter(
    (appointment) =>
      appointment.status === "confirmed" ||
      appointment.status === "checked_in" ||
      appointment.confirmationState === "confirmed"
  ).length;
  const checkedIn = data.appointments.filter(
    (appointment) => appointment.status === "checked_in"
  ).length;
  const newPatientsToday = data.appointments.filter(
    (appointment) => appointment.patientKind === "new"
  ).length;

  return {
    bookedToday,
    checkedIn,
    confirmed,
    leadTasks: data.leads.filter((lead) => ["new", "pending", "matched"].includes(lead.status))
      .length,
    newPatientsToday,
    noShowRisk: data.appointments.filter(
      (appointment) =>
        appointment.status === "requested" || appointment.confirmationState === "not_sent"
    ).length,
    queueWaiting: data.queue.filter(
      (entry) => entry.state === "waiting" || entry.state === "called"
    ).length,
    returningPatientsToday: bookedToday - newPatientsToday,
    unconfirmed: data.appointments.filter(
      (appointment) =>
        appointment.status === "booked" ||
        appointment.status === "requested" ||
        appointment.confirmationState === "draft_ready" ||
        appointment.confirmationState === "sent" ||
        appointment.confirmationState === "not_sent"
    ).length
  };
}

export function findDuplicateSuggestions(
  patients: PatientSummary[],
  input: { displayName?: string; phone?: string }
): DuplicateSuggestion[] {
  const phone = normalizePhone(input.phone ?? "");
  const name = (input.displayName ?? "").trim().toLowerCase();

  if (!phone && name.length < 3) {
    return [];
  }

  const suggestions = patients
    .flatMap((patient) => {
      const suggestions: DuplicateSuggestion[] = [];
      const patientPhone = normalizePhone(patient.phone);
      const patientName = patient.displayName.trim().toLowerCase();

      if (phone && patientPhone && patientPhone === phone) {
        suggestions.push({
          matchedOn: "phone",
          patient,
          score: 100
        });
      }

      if (name.length >= 3 && patientName.includes(name)) {
        suggestions.push({
          matchedOn: "name",
          patient,
          score: patientName === name ? 90 : 65
        });
      }

      return suggestions;
    })
    .sort((first, second) => second.score - first.score);
  const byPatient = new Map<string, DuplicateSuggestion>();

  for (const suggestion of suggestions) {
    if (!byPatient.has(suggestion.patient.id)) {
      byPatient.set(suggestion.patient.id, suggestion);
    }
  }

  return [...byPatient.values()].slice(0, 5);
}

export function createFixtureWorkflowData(today = getTodayInputValue()): Cp2WorkflowData {
  const patients: PatientSummary[] = [
    {
      attribution: [
        {
          capturedAt: `${today}T03:05:00.000Z`,
          detail: "Synthetic local fixture lead",
          source: "whatsapp"
        }
      ],
      displayName: "Riya Synthetic",
      id: "returningPatient",
      kind: "returning",
      lastVisitAt: "2026-01-08T05:30:00.000Z",
      phone: "+919900001001"
    }
  ];

  const leads: LeadSummary[] = [
    {
      attribution: {
        capturedAt: `${today}T03:00:00.000Z`,
        detail: "Inbound message normalized from local fixture",
        externalRef: "fixture-whatsapp-001",
        source: "whatsapp"
      },
      contactName: "Riya Synthetic",
      deliveryStatus: "read",
      id: "whatsappReturningLead",
      intent: "appointment_request",
      matchedPatientId: "returningPatient",
      messageSnippet: "Synthetic appointment request for today afternoon.",
      phone: "+919900001001",
      receivedAt: `${today}T03:00:00.000Z`,
      requestedWindow: "Today afternoon",
      slaMinutesRemaining: 12,
      status: "matched"
    },
    {
      attribution: {
        capturedAt: `${today}T03:24:00.000Z`,
        detail: "Google Business Profile request normalized from local fixture",
        externalRef: "gmb-cp2-lead-001",
        source: "google"
      },
      contactName: "Ira Synthetic",
      deliveryStatus: "received",
      id: "googleNewPatientLead",
      intent: "appointment_request",
      messageSnippet: "Synthetic Google profile lead requesting a new patient visit.",
      phone: "+919900001002",
      receivedAt: `${today}T03:24:00.000Z`,
      requestedWindow: "Today late morning",
      slaMinutesRemaining: 24,
      status: "new"
    }
  ];

  const appointments: AppointmentSummary[] = [
    {
      appointmentType: "Consultation",
      chair: "Chair 1",
      confirmationState: "not_sent",
      endAt: `${today}T04:30:00.000Z`,
      id: "returningPatientUnconfirmedAppointment",
      leadId: "whatsappReturningLead",
      patientId: "returningPatient",
      patientKind: "returning",
      patientName: "Riya Synthetic",
      providerName: "Synthetic Doctor",
      source: "whatsapp",
      startAt: `${today}T04:00:00.000Z`,
      status: "booked"
    }
  ];

  return {
    api: {
      environment: "local synthetic fixture",
      requestIds: ["fixture-cp2-workflow"]
    },
    appointments,
    leads,
    patients,
    queue: [],
    source: "cp2_fixture",
    today
  };
}

export async function loadCp2Workflow(
  signal?: AbortSignal,
  today = getTodayInputValue()
): Promise<Cp2WorkflowLoadState> {
  if (isCp2FixtureAllowed()) {
    return {
      data: createFixtureWorkflowData(today),
      status: "ready"
    };
  }

  try {
    const [appointments, queue, leads, patients] = await Promise.allSettled([
      fetchEndpoint("/v1/appointments", { date: today }, signal),
      fetchEndpoint("/v1/queue", { date: today }, signal),
      fetchEndpoint("/v1/leads", { status: "" }, signal),
      fetchEndpoint("/v1/patients", { phone: "", query: "", source: "" }, signal)
    ]);

    const failures = collectFailures([appointments, queue, leads, patients]);

    if (failures.length > 0) {
      return stateFromEndpointFailures(failures);
    }

    const successful = [appointments, queue, leads, patients].map((result) => {
      if (result.status !== "fulfilled") {
        throw new Error("Endpoint failure should have been handled before normalization.");
      }

      return result.value;
    });

    return {
      data: {
        api: {
          environment: "api",
          requestIds: successful
            .map((result) => result.requestId)
            .filter((requestId): requestId is string => Boolean(requestId))
        },
        appointments: normalizeAppointmentList(successful[0]?.payload),
        leads: normalizeLeadList(successful[2]?.payload),
        patients: normalizePatientList(successful[3]?.payload),
        queue: normalizeQueueList(successful[1]?.payload),
        source: "api",
        today
      },
      status: "ready"
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }

    return {
      problem: {
        code: "NETWORK_UNAVAILABLE",
        detail: error instanceof Error ? error.message : undefined,
        endpoints: CP2_REQUIRED_ENDPOINTS.map((endpoint) => ({
          endpoint,
          message: "The endpoint could not be reached from the web app."
        })),
        message: "The CP2 workflow API could not be reached."
      },
      status: "unavailable"
    };
  }
}

export async function createLivePatient(input: PatientCreateInput, signal?: AbortSignal) {
  return postEndpoint(
    "/v1/patients",
    {
      fullName: input.displayName,
      phone: input.phone,
      source: input.source
    },
    signal
  );
}

export async function createLiveLead(input: LeadCreateInput, signal?: AbortSignal) {
  return postEndpoint(
    "/v1/leads",
    {
      intent: "appointment_request",
      primaryContact: input.phone,
      source: input.source,
      sourceDetail: {
        rawNotificationText: input.messageSnippet
      },
      contactName: input.contactName
    },
    signal
  );
}

export async function matchLiveLeadToPatient(
  leadId: string,
  patientId: string,
  signal?: AbortSignal
) {
  return postEndpoint(
    `/v1/leads/${encodeURIComponent(leadId)}/match-patient`,
    { patientId },
    signal
  );
}

export async function convertLiveLeadToAppointment(
  input: AppointmentCreateInput,
  signal?: AbortSignal
) {
  return postEndpoint(
    `/v1/leads/${encodeURIComponent(input.leadId)}/convert-to-appointment`,
    {
      appointmentType: input.appointmentType,
      chair: input.chair,
      durationMinutes: input.durationMinutes,
      patientId: input.patientId,
      providerName: input.providerName,
      source: input.source,
      startAt: input.startAt
    },
    signal
  );
}

export async function confirmLiveAppointment(appointmentId: string, signal?: AbortSignal) {
  return postEndpoint(`/v1/appointments/${encodeURIComponent(appointmentId)}/confirm`, {}, signal);
}

export async function checkInLiveAppointment(appointmentId: string, signal?: AbortSignal) {
  return postEndpoint(`/v1/appointments/${encodeURIComponent(appointmentId)}/check-in`, {}, signal);
}

export function applyFixtureCreatePatient(data: Cp2WorkflowData, input: PatientCreateInput) {
  const normalizedPhone = normalizePhone(input.phone);
  const isCanonicalCp2NewPatient =
    normalizedPhone === "+919900001002" ||
    input.displayName.trim().toLowerCase() === "ira synthetic";
  const patientId = isCanonicalCp2NewPatient ? "expectedNewPatient" : nextFixtureId("patient");
  const existingPatient = data.patients.find((patient) => patient.id === patientId);

  if (existingPatient) {
    return {
      data,
      patient: existingPatient
    };
  }

  const patient: PatientSummary = {
    attribution: [
      {
        capturedAt: new Date().toISOString(),
        detail: "Created in local CP2 workflow fixture",
        source: input.source
      }
    ],
    displayName: input.displayName.trim(),
    id: patientId,
    kind: "new",
    phone: normalizedPhone
  };

  return {
    data: {
      ...data,
      patients: [patient, ...data.patients]
    },
    patient
  };
}

export function applyFixtureCreateLead(data: Cp2WorkflowData, input: LeadCreateInput) {
  const lead: LeadSummary = {
    attribution: {
      capturedAt: new Date().toISOString(),
      detail: "Captured in local CP2 workflow fixture",
      source: input.source
    },
    contactName: input.contactName.trim(),
    deliveryStatus: input.source === "phone" ? "callback due" : "received",
    id: nextFixtureId("lead"),
    intent: "appointment_request",
    messageSnippet: input.messageSnippet.trim() || "Synthetic lead captured from assistant entry.",
    phone: normalizePhone(input.phone),
    receivedAt: new Date().toISOString(),
    slaMinutesRemaining: 30,
    status: "new"
  };

  return {
    data: {
      ...data,
      leads: [lead, ...data.leads]
    },
    lead
  };
}

export function applyFixtureMatchLead(
  data: Cp2WorkflowData,
  leadId: string,
  patientId: string
): Cp2WorkflowData {
  return {
    ...data,
    leads: data.leads.map((lead) =>
      lead.id === leadId
        ? {
            ...lead,
            matchedPatientId: patientId,
            status: "matched"
          }
        : lead
    )
  };
}

export function applyFixtureConvertLeadToAppointment(
  data: Cp2WorkflowData,
  input: AppointmentCreateInput
): { appointment: AppointmentSummary; data: Cp2WorkflowData } {
  const patient = data.patients.find((item) => item.id === input.patientId);
  const lead = data.leads.find((item) => item.id === input.leadId);
  const endAt = addMinutes(input.startAt, input.durationMinutes);
  const appointment: AppointmentSummary = {
    appointmentType: input.appointmentType,
    chair: input.chair,
    confirmationState: "draft_ready",
    endAt,
    id:
      input.leadId === "googleNewPatientLead"
        ? "newPatientAppointment"
        : nextFixtureId("appointment"),
    leadId: input.leadId,
    patientId: input.patientId,
    patientKind: patient?.kind ?? "new",
    patientName: patient?.displayName ?? lead?.contactName ?? "Synthetic patient",
    providerName: input.providerName,
    source: input.source,
    startAt: input.startAt,
    status: "booked"
  };

  return {
    appointment,
    data: {
      ...data,
      appointments: [
        ...data.appointments.filter((item) => item.id !== appointment.id),
        appointment
      ].sort((first, second) => Date.parse(first.startAt) - Date.parse(second.startAt)),
      leads: data.leads.map((item) =>
        item.id === input.leadId
          ? {
              ...item,
              matchedPatientId: input.patientId,
              status: "booked"
            }
          : item
      )
    }
  };
}

export function applyFixtureConfirmAppointment(
  data: Cp2WorkflowData,
  appointmentId: string
): Cp2WorkflowData {
  return {
    ...data,
    appointments: data.appointments.map((appointment) =>
      appointment.id === appointmentId
        ? {
            ...appointment,
            confirmationState: "confirmed",
            status: "confirmed"
          }
        : appointment
    )
  };
}

export function applyFixtureCheckInAppointment(
  data: Cp2WorkflowData,
  appointmentId: string
): Cp2WorkflowData {
  const appointment = data.appointments.find((item) => item.id === appointmentId);

  if (!appointment) {
    return data;
  }

  const existingEntry = data.queue.find((entry) => entry.appointmentId === appointmentId);
  const queueEntry: QueueEntrySummary = existingEntry ?? {
    appointmentId,
    checkedInAt: new Date().toISOString(),
    id:
      appointmentId === "newPatientAppointment"
        ? "newPatientAppointmentQueueEntry"
        : nextFixtureId("queue"),
    patientId: appointment.patientId,
    patientKind: appointment.patientKind,
    patientName: appointment.patientName,
    providerName: appointment.providerName,
    state: "waiting",
    waitMinutes: 0
  };

  return {
    ...data,
    appointments: data.appointments.map((item) =>
      item.id === appointmentId
        ? {
            ...item,
            confirmationState: "confirmed",
            status: "checked_in"
          }
        : item
    ),
    queue: existingEntry
      ? data.queue.map((entry) =>
          entry.appointmentId === appointmentId
            ? {
                ...entry,
                checkedInAt: entry.checkedInAt ?? new Date().toISOString(),
                state: "waiting"
              }
            : entry
        )
      : [...data.queue, queueEntry]
  };
}

export function normalizePatientList(payload: unknown): PatientSummary[] {
  return readPayloadArray(payload).map(normalizePatient).filter(isPatientSummary);
}

export function normalizeLeadList(payload: unknown): LeadSummary[] {
  return readPayloadArray(payload).map(normalizeLead).filter(isLeadSummary);
}

export function normalizeAppointmentList(payload: unknown): AppointmentSummary[] {
  return readPayloadArray(payload)
    .map(normalizeAppointment)
    .filter(isAppointmentSummary)
    .sort((first, second) => Date.parse(first.startAt) - Date.parse(second.startAt));
}

export function normalizeQueueList(payload: unknown): QueueEntrySummary[] {
  return readPayloadArray(payload).map(normalizeQueueEntry).filter(isQueueEntrySummary);
}

export function classifyEndpointFailures(failures: WorkflowEndpointIssue[]): WorkflowProblem {
  const hasAuthFailure = failures.some(
    (failure) => failure.status === 401 || failure.status === 403
  );
  const hasMissingEndpoint = failures.some((failure) => failure.status === 404);
  const hasServerFailure = failures.some((failure) => failure.status && failure.status >= 500);

  if (hasAuthFailure) {
    return {
      code: "AUTH_REQUIRED",
      endpoints: failures,
      message: "Sign in through the configured identity provider before opening CP2 workflows."
    };
  }

  if (hasMissingEndpoint) {
    return {
      code: "CP2_ENDPOINT_NOT_REGISTERED",
      endpoints: failures,
      message: "One or more CP2 workflow endpoints are not registered in this environment."
    };
  }

  if (hasServerFailure) {
    return {
      code: "SERVER_ERROR",
      endpoints: failures,
      message: "The ClinicOS API is reachable but could not load the CP2 workflow."
    };
  }

  return {
    code: "UNKNOWN",
    endpoints: failures,
    message: "The CP2 workflow API returned an unexpected response."
  };
}

function isPatientSummary(value: PatientSummary | null): value is PatientSummary {
  return value !== null;
}

function isLeadSummary(value: LeadSummary | null): value is LeadSummary {
  return value !== null;
}

function isAppointmentSummary(value: AppointmentSummary | null): value is AppointmentSummary {
  return value !== null;
}

function isQueueEntrySummary(value: QueueEntrySummary | null): value is QueueEntrySummary {
  return value !== null;
}

function getWorkflowApiBaseUrl() {
  return process.env.NEXT_PUBLIC_CLINIC_OS_API_BASE_URL ?? "";
}

function buildWorkflowUrl(path: string, params?: Record<string, string>) {
  const baseUrl = getWorkflowApiBaseUrl().replace(/\/$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`, getBrowserOrigin());

  Object.entries(params ?? {}).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  return url.toString();
}

function getBrowserOrigin() {
  if (typeof window !== "undefined") {
    return window.location.origin;
  }

  return "http://localhost";
}

async function fetchEndpoint(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal
): Promise<EndpointResponse> {
  const response = await fetch(buildWorkflowUrl(path, params), {
    credentials: "include",
    headers: {
      Accept: "application/json"
    },
    signal
  });
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw endpointFailureFromResponse(path, response, payload);
  }

  return {
    endpoint: `GET ${path}`,
    payload,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

async function postEndpoint(path: string, body: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch(buildWorkflowUrl(path), {
    body: JSON.stringify(body),
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Idempotency-Key": `web-${crypto.randomUUID()}`
    },
    method: "POST",
    signal
  });
  const payload = await parseJsonSafely(response);

  if (!response.ok) {
    throw endpointFailureFromResponse(path, response, payload);
  }

  return payload;
}

async function parseJsonSafely(response: Response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    return null;
  }

  return response.json() as Promise<unknown>;
}

function endpointFailureFromResponse(
  path: string,
  response: Response,
  payload: unknown
): EndpointFailure {
  return {
    endpoint: `${response.status === 0 ? "FETCH" : "HTTP"} ${path}`,
    message: readErrorMessage(payload) ?? `HTTP ${response.status}`,
    requestId: getRequestId(response, payload),
    status: response.status
  };
}

function collectFailures(results: PromiseSettledResult<EndpointResponse>[]) {
  return results.flatMap((result) => {
    if (result.status === "fulfilled") {
      return [];
    }

    const reason = result.reason;

    if (isEndpointFailure(reason)) {
      return [reason];
    }

    return [
      {
        endpoint: "unknown CP2 endpoint",
        message: reason instanceof Error ? reason.message : "Unknown endpoint failure"
      }
    ];
  });
}

function stateFromEndpointFailures(failures: EndpointFailure[]): Cp2WorkflowLoadState {
  const problem = classifyEndpointFailures(failures);

  return {
    problem,
    status: problem.code === "AUTH_REQUIRED" ? "unauthenticated" : "unavailable"
  };
}

function isEndpointFailure(value: unknown): value is EndpointFailure {
  return typeof value === "object" && value !== null && "endpoint" in value && "message" in value;
}

function readPayloadArray(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!isRecord(payload)) {
    return [];
  }

  for (const key of ["items", "data", "results", "patients", "leads", "appointments", "queue"]) {
    const value = payload[key];

    if (Array.isArray(value)) {
      return value;
    }
  }

  return [];
}

function normalizePatient(value: unknown): PatientSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value, ["id", "patientId", "patient_id"]);
  const displayName = readString(value, [
    "displayName",
    "display_name",
    "fullName",
    "full_name",
    "name"
  ]);
  const phone = readString(value, ["phone", "primaryPhone", "primary_phone", "primaryContact"]);

  if (!id || !displayName || !phone) {
    return null;
  }

  return {
    attribution: normalizeAttributionList(
      value.attribution ?? value.sourceTouches ?? value.source_touches
    ),
    displayName,
    id,
    kind: normalizePatientKind(value.kind ?? value.patientKind ?? value.patient_kind),
    lastVisitAt: readString(value, ["lastVisitAt", "last_visit_at"]) ?? undefined,
    phone
  };
}

function normalizeLead(value: unknown): LeadSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value, ["id", "leadId", "lead_id"]);
  const phone = readString(value, ["phone", "primaryContact", "primary_contact"]);
  const source = normalizeSource(value.source);

  if (!id || !phone || !source) {
    return null;
  }

  return {
    attribution: {
      capturedAt:
        readString(value, ["capturedAt", "captured_at", "receivedAt", "received_at"]) ??
        new Date().toISOString(),
      detail: readString(value, ["sourceDetail", "source_detail", "detail"]) ?? undefined,
      externalRef: readString(value, ["externalRef", "external_ref"]) ?? undefined,
      source
    },
    contactName: readString(value, ["contactName", "contact_name", "name"]) ?? "Unknown lead",
    deliveryStatus:
      readString(value, ["deliveryStatus", "delivery_status", "messageStatus"]) ?? undefined,
    id,
    intent: normalizeIntent(value.intent),
    matchedPatientId:
      readString(value, ["matchedPatientId", "matched_patient_id", "patientId", "patient_id"]) ??
      undefined,
    messageSnippet:
      readString(value, ["messageSnippet", "message_snippet", "rawNotificationText", "body"]) ??
      "No message preview available.",
    phone,
    receivedAt:
      readString(value, ["receivedAt", "received_at", "createdAt", "created_at"]) ??
      new Date().toISOString(),
    requestedWindow: readString(value, ["requestedWindow", "requested_window"]) ?? undefined,
    slaMinutesRemaining: readNumber(value, ["slaMinutesRemaining", "sla_minutes_remaining"]) ?? 0,
    status: normalizeLeadStatus(value.status)
  };
}

function normalizeAppointment(value: unknown): AppointmentSummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value, ["id", "appointmentId", "appointment_id"]);
  const patientId = readString(value, ["patientId", "patient_id"]);
  const startAt = readString(value, ["startAt", "start_at"]);
  const source = normalizeSource(value.source);

  if (!id || !patientId || !startAt || !source) {
    return null;
  }

  return {
    appointmentType:
      readString(value, [
        "appointmentType",
        "appointment_type",
        "appointmentTypeName",
        "appointment_type_name"
      ]) ?? "Appointment",
    chair: readString(value, ["chair", "room", "chairName", "chair_name"]) ?? "Unassigned",
    confirmationState: normalizeConfirmationState(
      value.confirmationState ?? value.confirmation_state
    ),
    endAt:
      readString(value, ["endAt", "end_at"]) ??
      addMinutes(
        startAt,
        readNumber(value, ["durationMinutes", "duration_minutes"]) ??
          DEFAULT_APPOINTMENT_DURATION_MINUTES
      ),
    id,
    leadId: readString(value, ["leadId", "lead_id"]) ?? undefined,
    patientId,
    patientKind: normalizePatientKind(value.patientKind ?? value.patient_kind),
    patientName:
      readString(value, [
        "patientName",
        "patient_name",
        "patientDisplayName",
        "patient_display_name"
      ]) ?? "Unknown patient",
    providerName:
      readString(value, ["providerName", "provider_name", "doctorName", "doctor_name"]) ??
      "Unassigned provider",
    source,
    startAt,
    status: normalizeAppointmentStatus(value.status)
  };
}

function normalizeQueueEntry(value: unknown): QueueEntrySummary | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = readString(value, ["id", "queueEntryId", "queue_entry_id"]);
  const appointmentId = readString(value, ["appointmentId", "appointment_id"]);
  const patientId = readString(value, ["patientId", "patient_id"]);

  if (!id || !appointmentId || !patientId) {
    return null;
  }

  return {
    appointmentId,
    checkedInAt: readString(value, ["checkedInAt", "checked_in_at"]) ?? undefined,
    id,
    patientId,
    patientKind: normalizePatientKind(value.patientKind ?? value.patient_kind),
    patientName: readString(value, ["patientName", "patient_name"]) ?? "Unknown patient",
    providerName: readString(value, ["providerName", "provider_name"]) ?? "Unassigned provider",
    state: normalizeQueueState(value.state ?? value.status),
    waitMinutes: readNumber(value, ["waitMinutes", "wait_minutes"]) ?? 0
  };
}

function normalizeAttributionList(value: unknown): AttributionTouch[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const source = normalizeSource(item.source);

    if (!source) {
      return [];
    }

    return [
      {
        capturedAt:
          readString(item, ["capturedAt", "captured_at", "createdAt", "created_at"]) ??
          new Date().toISOString(),
        detail: readString(item, ["detail", "sourceDetail", "source_detail"]) ?? undefined,
        externalRef: readString(item, ["externalRef", "external_ref"]) ?? undefined,
        source
      }
    ];
  });
}

function normalizeSource(value: unknown): WorkflowSource | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase().replace(/[-\s]/g, "_");
  const aliases: Record<string, WorkflowSource> = {
    call: "phone",
    direct_booking: "website",
    google_business_profile: "google",
    missed_call: "phone",
    practo_booking: "practo",
    whatsapp_direct: "whatsapp"
  };

  if (normalized in SOURCE_LABELS) {
    return normalized as WorkflowSource;
  }

  return aliases[normalized] ?? null;
}

function normalizePatientKind(value: unknown): PatientKind {
  return value === "returning" || value === "existing" ? "returning" : "new";
}

function normalizeLeadStatus(value: unknown): LeadStatus {
  if (typeof value !== "string") {
    return "new";
  }

  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  const statuses = new Set<LeadStatus>([
    "booked",
    "duplicate",
    "lost",
    "matched",
    "new",
    "pending",
    "spam"
  ]);

  return statuses.has(normalized as LeadStatus) ? (normalized as LeadStatus) : "new";
}

function normalizeAppointmentStatus(value: unknown): AppointmentStatus {
  if (typeof value !== "string") {
    return "booked";
  }

  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  const statuses = new Set<AppointmentStatus>([
    "booked",
    "cancelled",
    "checked_in",
    "completed",
    "confirmed",
    "in_consult",
    "no_show",
    "requested"
  ]);

  return statuses.has(normalized as AppointmentStatus)
    ? (normalized as AppointmentStatus)
    : "booked";
}

function normalizeConfirmationState(value: unknown): ConfirmationState {
  if (typeof value !== "string") {
    return "not_sent";
  }

  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  const states = new Set<ConfirmationState>(["confirmed", "draft_ready", "not_sent", "sent"]);

  return states.has(normalized as ConfirmationState)
    ? (normalized as ConfirmationState)
    : "not_sent";
}

function normalizeQueueState(value: unknown): QueueState {
  if (typeof value !== "string") {
    return "not_checked_in";
  }

  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  const states = new Set<QueueState>(["called", "not_checked_in", "waiting", "with_doctor"]);

  return states.has(normalized as QueueState) ? (normalized as QueueState) : "not_checked_in";
}

function normalizeIntent(value: unknown): LeadSummary["intent"] {
  if (typeof value !== "string") {
    return "other";
  }

  const normalized = value.trim().toLowerCase().replace(/-/g, "_");
  const intents = new Set<LeadSummary["intent"]>([
    "appointment_request",
    "callback_request",
    "document_received",
    "other"
  ]);

  return intents.has(normalized as LeadSummary["intent"])
    ? (normalized as LeadSummary["intent"])
    : "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function readNumber(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
  }

  return null;
}

function readErrorMessage(payload: unknown) {
  if (!isRecord(payload)) {
    return null;
  }

  const error = payload.error;

  if (isRecord(error)) {
    return readString(error, ["message", "detail", "code"]);
  }

  return readString(payload, ["message", "detail", "code"]);
}

function getRequestId(response: Response, payload: unknown) {
  if (isRecord(payload)) {
    const topLevel = readString(payload, [
      "request_id",
      "requestId",
      "correlation_id",
      "correlationId"
    ]);
    const error = payload.error;
    const nested = isRecord(error)
      ? readString(error, ["request_id", "requestId", "correlation_id", "correlationId"])
      : null;

    return topLevel ?? nested ?? response.headers.get("x-request-id") ?? undefined;
  }

  return response.headers.get("x-request-id") ?? undefined;
}

function addMinutes(isoValue: string, minutes: number) {
  const date = new Date(isoValue);

  if (Number.isNaN(date.getTime())) {
    return isoValue;
  }

  date.setMinutes(date.getMinutes() + minutes);

  return date.toISOString();
}

function nextFixtureId(prefix: string) {
  fixtureIdCounter += 1;

  return `fixture-${prefix}-${fixtureIdCounter}`;
}
