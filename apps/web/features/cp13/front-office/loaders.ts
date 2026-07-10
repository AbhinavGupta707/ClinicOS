import {
  ClinicOsApiClient,
  ClinicOsApiError,
  type CheckInAppointmentResponse,
  type ClinicOsApiClientOptions,
  type CreatePatientRequest,
  type CreatePatientResponse,
  type GetMorningDashboardResponse,
  type GetPatientPrepSummaryResponse,
  type GetPatientResponse,
  type GetPatientTimelineResponse,
  type ListAppointmentTypesResponse,
  type ListChairsResponse,
  type ListIntakeFormTemplatesResponse,
  type ListLeadsResponse,
  type ListProviderSchedulesResponse,
  type ListQueueResponse,
  type SubmitPatientIntakeFormRequest,
  type SubmitPatientIntakeFormResponse
} from "@clinic-os/api-client-generated";

export type FrontOfficeUnavailableReason =
  "dependency_unavailable" | "endpoint_not_registered" | "authentication_unavailable";

export type FrontOfficeLoadState<T> =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly data: T; readonly refreshedAt: string }
  | {
      readonly status: "unavailable";
      readonly reason: FrontOfficeUnavailableReason;
      readonly message: string;
      readonly requestId: string | null;
    }
  | {
      readonly status: "error";
      readonly message: string;
      readonly requestId: string | null;
      readonly retryable: boolean;
    };

export interface FrontOfficeDayData {
  readonly dashboard: GetMorningDashboardResponse["dashboard"];
  readonly queue: ListQueueResponse["queue"];
  readonly leads: ListLeadsResponse["leads"];
  readonly intakeTemplates: ListIntakeFormTemplatesResponse["templates"];
}

export interface FrontOfficePatientWorkspaceData {
  readonly patient: GetPatientResponse["patient"];
  readonly timeline: GetPatientTimelineResponse["timeline"];
  readonly prepSummary: GetPatientPrepSummaryResponse["prepSummary"];
}

export interface FrontOfficeSchedulingConfigurationData {
  readonly appointmentTypes: ListAppointmentTypesResponse["appointmentTypes"];
  readonly chairs: ListChairsResponse["chairs"];
  readonly providerSchedules: ListProviderSchedulesResponse["providerSchedules"];
}

export type FrontOfficeApiClient = Pick<
  ClinicOsApiClient,
  | "checkInAppointment"
  | "createPatient"
  | "getMorningDashboard"
  | "getPatient"
  | "getPatientPrepSummary"
  | "getPatientTimeline"
  | "listAppointmentTypes"
  | "listChairs"
  | "listIntakeFormTemplates"
  | "listLeads"
  | "listProviderSchedules"
  | "listQueue"
  | "submitPatientIntakeForm"
>;

export function createFrontOfficeApiClient(options: ClinicOsApiClientOptions): ClinicOsApiClient {
  return new ClinicOsApiClient(options);
}

export async function loadFrontOfficeDay(
  client: FrontOfficeApiClient,
  input: { readonly date?: string; readonly refreshedAt?: string } = {}
): Promise<FrontOfficeLoadState<FrontOfficeDayData>> {
  try {
    const [dashboard, queue, leads, templates] = await Promise.all([
      client.getMorningDashboard({ query: input.date ? { date: input.date } : undefined }),
      client.listQueue({ query: input.date ? { date: input.date } : undefined }),
      client.listLeads(),
      client.listIntakeFormTemplates()
    ]);
    return {
      status: "ready",
      refreshedAt: input.refreshedAt ?? new Date().toISOString(),
      data: {
        dashboard: dashboard.dashboard,
        queue: queue.queue,
        leads: leads.leads,
        intakeTemplates: templates.templates
      }
    };
  } catch (error) {
    return classifyFrontOfficeLoadFailure(error, { notFound: "endpoint" });
  }
}

export async function refreshFrontOfficeDay(
  client: FrontOfficeApiClient,
  input: { readonly date?: string; readonly refreshedAt?: string } = {}
): Promise<FrontOfficeLoadState<FrontOfficeDayData>> {
  // Refresh never returns stale ready data after a failed request.
  return loadFrontOfficeDay(client, input);
}

export async function loadFrontOfficePatientWorkspace(
  client: FrontOfficeApiClient,
  input: {
    readonly patientId: string;
    readonly appointmentId?: string;
    readonly refreshedAt?: string;
  }
): Promise<FrontOfficeLoadState<FrontOfficePatientWorkspaceData>> {
  try {
    const [patient, timeline, prep] = await Promise.all([
      client.getPatient({ path: { patientId: input.patientId } }),
      client.getPatientTimeline({ path: { patientId: input.patientId } }),
      client.getPatientPrepSummary({
        path: { patientId: input.patientId },
        query: input.appointmentId ? { appointmentId: input.appointmentId } : undefined
      })
    ]);
    return {
      status: "ready",
      refreshedAt: input.refreshedAt ?? new Date().toISOString(),
      data: {
        patient: patient.patient,
        timeline: timeline.timeline,
        prepSummary: prep.prepSummary
      }
    };
  } catch (error) {
    return classifyFrontOfficeLoadFailure(error, { notFound: "resource" });
  }
}

export async function loadFrontOfficeSchedulingConfiguration(
  client: FrontOfficeApiClient,
  providerId?: string
): Promise<FrontOfficeLoadState<FrontOfficeSchedulingConfigurationData>> {
  try {
    const [appointmentTypes, chairs, providerSchedules] = await Promise.all([
      client.listAppointmentTypes(),
      client.listChairs(),
      client.listProviderSchedules({ query: providerId ? { providerId } : undefined })
    ]);
    return {
      status: "ready",
      refreshedAt: new Date().toISOString(),
      data: {
        appointmentTypes: appointmentTypes.appointmentTypes,
        chairs: chairs.chairs,
        providerSchedules: providerSchedules.providerSchedules
      }
    };
  } catch (error) {
    return classifyFrontOfficeLoadFailure(error, { notFound: "endpoint" });
  }
}

export function createFrontOfficePatient(
  client: FrontOfficeApiClient,
  request: CreatePatientRequest
): Promise<CreatePatientResponse> {
  return client.createPatient(request);
}

export function checkInFrontOfficeAppointment(
  client: FrontOfficeApiClient,
  appointmentId: string,
  idempotencyKey: string
): Promise<CheckInAppointmentResponse> {
  return client.checkInAppointment({
    path: { appointmentId },
    headers: { "idempotency-key": idempotencyKey }
  });
}

export function submitFrontOfficeIntake(
  client: FrontOfficeApiClient,
  request: SubmitPatientIntakeFormRequest
): Promise<SubmitPatientIntakeFormResponse> {
  return client.submitPatientIntakeForm(request);
}

export function classifyFrontOfficeLoadFailure<T = never>(
  error: unknown,
  options: { readonly notFound: "endpoint" | "resource" } = { notFound: "endpoint" }
): FrontOfficeLoadState<T> {
  if (error instanceof ClinicOsApiError) {
    if (error.status === 401 || error.status === 403) {
      return {
        status: "unavailable",
        reason: "authentication_unavailable",
        message: "Your verified clinic session cannot load this front-office workspace.",
        requestId: error.requestId
      };
    }
    if (error.status === 404) {
      if (options.notFound === "resource") {
        return {
          status: "error",
          message: "The requested clinic record was not found in the verified clinic scope.",
          requestId: error.requestId,
          retryable: false
        };
      }
      return {
        status: "unavailable",
        reason: "endpoint_not_registered",
        message: "The durable front-office API is not registered in this environment.",
        requestId: error.requestId
      };
    }
    if (error.status === 503 || error.code === "DEPENDENCY_UNAVAILABLE") {
      return {
        status: "unavailable",
        reason: "dependency_unavailable",
        message:
          "Front-office data is temporarily unavailable; no local or fixture fallback was used.",
        requestId: error.requestId
      };
    }
    return {
      status: "error",
      message: "The front-office request failed without replacing durable data.",
      requestId: error.requestId,
      retryable: error.status >= 500 || error.status === 429
    };
  }

  return {
    status: "error",
    message: error instanceof Error ? error.message : "The front-office request failed.",
    requestId: null,
    retryable: true
  };
}
