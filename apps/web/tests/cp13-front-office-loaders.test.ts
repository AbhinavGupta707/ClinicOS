import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { ClinicOsApiError } from "@clinic-os/api-client-generated";
import {
  classifyFrontOfficeLoadFailure,
  loadFrontOfficeDay,
  loadFrontOfficePatientWorkspace,
  refreshFrontOfficeDay,
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
    const apiError = (status: number, code: string, requestId: string) =>
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
    expect(source).toContain("repeat(auto-fit, minmax(min(100%, 18rem), 1fr))");
    expect(source).toContain('maxWidth: "100%"');
    expect(source).toContain("Open tasks");
    expect(source).toContain("Medical history needs review");
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
    createPatient: vi.fn(),
    checkInAppointment: vi.fn(),
    submitPatientIntakeForm: vi.fn()
  } as unknown as FrontOfficeApiClient;
}

function dayData() {
  return {
    dashboard: {
      date: "2026-07-11",
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
