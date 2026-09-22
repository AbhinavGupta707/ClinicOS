import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ClinicOsApiError, type ClinicOsApiErrorCode } from "@clinic-os/api-client-generated";
import {
  classifyFrontOfficeLoadFailure,
  loadFrontOfficeDay,
  loadFrontOfficePatientWorkspace,
  refreshFrontOfficeDay,
  searchFrontOfficePatients,
  type FrontOfficeApiClient
} from "../features/cp13/front-office/loaders";

describe("CP13 front-office durable loaders", () => {
  it("loads the generated-client route family without fixture fallback", async () => {
    const client = frontOfficeClient();
    const state = await loadFrontOfficeDay(client, {
      date: "2026-07-11",
      refreshedAt: "2026-07-10T20:00:00.000Z"
    });

    expect(state.status).toBe("ready");
    if (state.status !== "ready") throw new Error("Expected ready state.");
    expect(state.data.dashboard.openTasks).toHaveLength(1);
    expect(state.data.dashboard.clinicDayAppointments[0]).toMatchObject({
      patientName: "Synthetic Trial Patient",
      providerName: "Dr Kabir Doctor",
      appointmentTypeName: "Consultation",
      chairName: "Operatory 1",
      source: "practo",
      status: "booked"
    });
    expect(client.getMorningDashboard).toHaveBeenCalledWith({ query: { date: "2026-07-11" } });
    expect(client.listQueue).toHaveBeenCalledWith({ query: { date: "2026-07-11" } });
  });

  it("refresh failure clears stale ready data and reports unavailable honestly", async () => {
    const client = frontOfficeClient();
    const first = await loadFrontOfficeDay(client);
    expect(first.status).toBe("ready");
    vi.mocked(client.getMorningDashboard).mockRejectedValueOnce(
      new ClinicOsApiError(503, {
        error: {
          code: "DEPENDENCY_UNAVAILABLE",
          message: "Postgres unavailable",
          details: {},
          request_id: "cp13-request-unavailable"
        }
      })
    );

    const refreshed = await refreshFrontOfficeDay(client);
    expect(refreshed).toEqual({
      status: "unavailable",
      reason: "dependency_unavailable",
      message:
        "Front-office data is temporarily unavailable; no local or fixture fallback was used.",
      requestId: "cp13-request-unavailable"
    });
    expect("data" in refreshed).toBe(false);
  });

  it("searches patients by operator-friendly name or phone without fixture fallback", async () => {
    const client = frontOfficeClient();
    vi.mocked(client.listPatients).mockResolvedValueOnce({
      patients: [
        {
          id: "10000000-0000-4000-8000-000000009002",
          fullName: "  Synthetic Trial Patient  ",
          phone: "+91 99900 01001",
          source: "practo"
        }
      ]
    } as never);

    const state = await searchFrontOfficePatients(client, "  Synthetic  ");

    expect(client.listPatients).toHaveBeenCalledWith({
      query: { limit: 25, query: "Synthetic" }
    });
    expect(state).toMatchObject({
      status: "ready",
      data: {
        query: "Synthetic",
        patients: [
          {
            id: "10000000-0000-4000-8000-000000009002",
            fullName: "Synthetic Trial Patient",
            phone: "+91 99900 01001",
            source: "practo"
          }
        ]
      }
    });
  });

  it("does not issue a patient request for fewer than two characters", async () => {
    const client = frontOfficeClient();
    const state = await searchFrontOfficePatients(client, " S ");
    expect(client.listPatients).not.toHaveBeenCalled();
    expect(state).toMatchObject({ status: "ready", data: { patients: [], query: "S" } });
  });

  it("loads patient, timeline and prep from generated granular routes", async () => {
    const client = frontOfficeClient();
    const state = await loadFrontOfficePatientWorkspace(client, {
      patientId: "10000000-0000-4000-8000-000000000004",
      appointmentId: "10000000-0000-4000-8000-000000000006",
      refreshedAt: "2026-07-10T20:00:00.000Z"
    });
    expect(state.status).toBe("ready");
    expect(client.getPatientPrepSummary).toHaveBeenCalledWith({
      path: { patientId: "10000000-0000-4000-8000-000000000004" },
      query: { appointmentId: "10000000-0000-4000-8000-000000000006" }
    });
  });

  it("distinguishes a scoped missing patient from missing endpoint registration", async () => {
    const client = frontOfficeClient();
    vi.mocked(client.getPatient).mockRejectedValueOnce(
      new ClinicOsApiError(404, {
        error: {
          code: "NOT_FOUND",
          message: "Patient not found",
          details: {},
          request_id: "cp13-patient-not-found"
        }
      })
    );
    const state = await loadFrontOfficePatientWorkspace(client, { patientId: "missing" });
    expect(state).toEqual({
      status: "error",
      message: "The requested clinic record was not found in the verified clinic scope.",
      requestId: "cp13-patient-not-found",
      retryable: false
    });
  });

  it("distinguishes authentication from permission denial and masks unknown errors", () => {
    const apiError = (status: number, code: ClinicOsApiErrorCode, requestId: string) =>
      new ClinicOsApiError(status, {
        error: { code, message: "Sensitive upstream detail", details: {}, request_id: requestId }
      });
    expect(classifyFrontOfficeLoadFailure(apiError(401, "UNAUTHENTICATED", "request-401"))).toEqual(
      {
        status: "unavailable",
        reason: "authentication_unavailable",
        message: "Your verified clinic session cannot load this front-office workspace.",
        requestId: "request-401"
      }
    );
    expect(
      classifyFrontOfficeLoadFailure(apiError(403, "PERMISSION_DENIED", "request-403"))
    ).toEqual({
      status: "unavailable",
      reason: "permission_denied",
      message: "Your verified clinic session does not have permission to load this workspace.",
      requestId: "request-403"
    });
    expect(classifyFrontOfficeLoadFailure(new Error("secret provider failure"))).toEqual({
      status: "error",
      message: "The front-office request failed unexpectedly.",
      requestId: null,
      retryable: true
    });
  });

  it("defines loading, unavailable and ready components with mobile-safe structure", () => {
    const source = readFileSync(
      new URL("../features/cp13/front-office/components.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("Loading clinic day");
    expect(source).toContain("Clinic day unavailable");
    expect(source).toContain("cp13-schedule-table");
    expect(source).toContain('maxWidth: "100%"');
    expect(source).toContain("Open tasks");
    expect(source).toContain("appointmentsTruncated");
    for (const durableField of ["patientName", "providerName", "appointmentTypeName", "chairName"])
      expect(source).toContain(durableField);
    expect(source).toContain("Search by name or phone");
    expect(source).toContain("Open full profile");
    expect(source.toLowerCase()).not.toContain("fixture patient");
  });
});

function frontOfficeClient(): FrontOfficeApiClient {
  return {
    getMorningDashboard: vi.fn(async () => ({ dashboard: dayData().dashboard })),
    listQueue: vi.fn(async () => ({ queue: dayData().queue })),
    listLeads: vi.fn(async () => ({ leads: dayData().leads })),
    listIntakeFormTemplates: vi.fn(async () => ({ templates: dayData().intakeTemplates })),
    getPatient: vi.fn(async () => ({ patient: patientData().patient })),
    getPatientTimeline: vi.fn(async () => ({
      timeline: patientData().timeline,
      items: patientData().timeline
    })),
    getPatientPrepSummary: vi.fn(async () => ({
      prepSummary: patientData().prepSummary,
      summary: patientData().prepSummary
    })),
    listAppointmentTypes: vi.fn(async () => ({ appointmentTypes: [] })),
    listChairs: vi.fn(async () => ({ chairs: [] })),
    listProviderSchedules: vi.fn(async () => ({ providerSchedules: [] })),
    listPatients: vi.fn(async () => ({ patients: [] })),
    createPatient: vi.fn(),
    checkInAppointment: vi.fn(),
    submitPatientIntakeForm: vi.fn()
  } as unknown as FrontOfficeApiClient;
}

function dayData() {
  return {
    dashboard: {
      date: "2026-07-11",
      dataAsOf: "2026-07-11T12:01:00.000Z",
      appointmentsTruncated: false,
      appointmentCounts: {
        requested: 0,
        booked: 1,
        confirmed: 0,
        checked_in: 0,
        in_consult: 0,
        completed: 0,
        cancelled: 0,
        no_show: 0
      },
      totalAppointments: 1,
      clinicDayAppointments: [
        {
          id: "10000000-0000-4000-8000-000000009001",
          rowVersion: 1,
          patientId: "10000000-0000-4000-8000-000000009002",
          patientName: "Synthetic Trial Patient",
          patientPhone: null,
          patientKind: "returning",
          providerUserId: "10000000-0000-4000-8000-000000001002",
          providerName: "Dr Kabir Doctor",
          appointmentTypeId: "10000000-0000-4000-8000-000000003001",
          appointmentTypeName: "Consultation",
          chairId: "10000000-0000-4000-8000-000000004001",
          chairName: "Operatory 1",
          status: "booked",
          startAt: "2026-07-11T12:00:00.000Z",
          endAt: "2026-07-11T12:30:00.000Z",
          source: "practo",
          reason: null,
          queueEntryId: null,
          queueStatus: null,
          queuePosition: null,
          checkedInAt: null,
          updatedAt: "2026-07-11T12:01:00.000Z"
        }
      ],
      unconfirmedAppointments: [{ id: "appointment", rowVersion: 1, status: "booked" }],
      todaysAppointments: [{ id: "appointment", rowVersion: 1, status: "booked" }],
      openLeads: [{ id: "lead", rowVersion: 1, status: "new" }],
      openTasks: [{ id: "task", rowVersion: 1, title: "Confirm appointment" }],
      queue: [],
      newPatientAppointmentIds: [],
      returningPatientAppointmentIds: ["appointment"]
    },
    queue: [],
    leads: [{ id: "lead", rowVersion: 1, status: "new" }],
    intakeTemplates: [{ id: "template", displayName: "Patient intake" }]
  };
}

function patientData() {
  return {
    patient: { id: "patient", rowVersion: 1, fullName: "Synthetic Patient" },
    timeline: [{ id: "timeline", eventType: "patient.created" }],
    prepSummary: {
      patient: {
        id: "patient",
        fullName: "Synthetic Patient",
        phone: null,
        dateOfBirth: null,
        gender: "unknown" as const
      },
      appointment: null,
      generatedAt: "2026-07-10T20:00:00.000Z",
      latestIntakeResponse: null,
      consentEnforcementState: {},
      activeConsentPurposes: [],
      timelineHighlights: [],
      priorClinicalTimeline: [],
      medicalHistoryChangePromptRequired: true,
      dataCoverage: { appointment: "available" }
    }
  };
}
