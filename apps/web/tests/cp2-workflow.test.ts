import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyFixtureCreateLead,
  applyFixtureCheckInAppointment,
  classifyEndpointFailures,
  createLiveLead,
  createFixtureWorkflowData,
  duplicateSuggestionDisplayText,
  findDuplicateSuggestions,
  loadCp2Workflow,
  searchLivePatients,
  sourceLabel,
  summarizeDashboard
} from "@/lib/cp2-workflow";
import { getSurface, getVisibleSurfaces } from "@/lib/navigation";

describe("CP2 frontend workflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("activates assistant navigation for checkpoint 2 workflow surfaces", () => {
    const visible = getVisibleSurfaces(["assistant"]);

    expect(
      visible.filter((surface) => surface.availability === "active").map((surface) => surface.id)
    ).toEqual(expect.arrayContaining(["today", "lead-inbox", "appointments", "patients"]));
    expect(getSurface("lead-inbox").requiredApis).toContain(
      "POST /v1/leads/{id}/convert-to-appointment"
    );
  });

  it("classifies missing CP2 endpoint registration before runtime debugging", () => {
    const problem = classifyEndpointFailures([
      {
        endpoint: "HTTP /v1/leads",
        message: "Not found",
        status: 404
      }
    ]);

    expect(problem).toMatchObject({
      code: "CP2_ENDPOINT_NOT_REGISTERED"
    });
  });

  it("formats duplicate patient suggestions with match reason", () => {
    const data = createFixtureWorkflowData("2026-07-07");
    const suggestions = findDuplicateSuggestions(data.patients, {
      phone: "+919900001001"
    });
    const displayText = duplicateSuggestionDisplayText(suggestions[0]!);

    expect(suggestions[0]?.patient.displayName).toBe("Riya Synthetic");
    expect(displayText).toContain("matched by phone");
  });

  it("formats source attribution visibly", () => {
    expect(sourceLabel("whatsapp")).toBe("WhatsApp");
  });

  it("captures a source-attributed lead in fixture mode", () => {
    const data = createFixtureWorkflowData("2026-07-07");
    const result = applyFixtureCreateLead(data, {
      contactName: "Synthetic Web Lead",
      messageSnippet: "Synthetic local lead capture",
      phone: "+910000000404",
      source: "google"
    });

    expect(result.lead.attribution.source).toBe("google");
    expect(result.data.leads[0]?.contactName).toBe("Synthetic Web Lead");
  });

  it("transforms dashboard and queue state after check-in", () => {
    const fixture = createFixtureWorkflowData("2026-07-07");
    const data = {
      ...fixture,
      appointments: fixture.appointments.map((appointment) => ({
        ...appointment,
        confirmationState: "unknown" as const
      }))
    };
    const created = applyFixtureCreateLead(data, {
      contactName: "Ira Synthetic",
      messageSnippet: "Synthetic Google profile lead requesting a new patient visit.",
      phone: "+919900001002",
      source: "google"
    });
    const checkedIn = applyFixtureCheckInAppointment(
      created.data,
      "returningPatientUnconfirmedAppointment"
    );
    const summary = summarizeDashboard(checkedIn);

    expect(summary.checkedIn).toBe(1);
    expect(checkedIn.queue.map((entry) => entry.appointmentId)).toContain(
      "returningPatientUnconfirmedAppointment"
    );
    expect(summary.queueWaiting).toBe(1);
    expect(checkedIn.appointments[0]?.confirmationState).toBe("unknown");
  });

  it("loads Today from the joined clinic-day projection without downloading the patient registry", async () => {
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_USE_CP2_WORKFLOW_FIXTURE", "false");
    vi.stubEnv("NEXT_PUBLIC_CLINIC_OS_ENV", "production");
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.includes("/v1/dashboard/morning?date=2026-07-07")) {
        return jsonResponse({
          dashboard: {
            appointmentsTruncated: false,
            dataAsOf: "2026-07-07T04:30:00.000Z",
            clinicDayAppointments: [
              {
                id: "appointment-1",
                rowVersion: 1,
                patientId: "patient-1",
                patientName: "Rhea Synthetic",
                patientPhone: "+919876543210",
                patientKind: "returning",
                providerUserId: "provider-1",
                providerName: "Dr Kabir Doctor",
                appointmentTypeId: "type-1",
                appointmentTypeName: "Consultation",
                chairId: "chair-1",
                chairName: "Operatory 1",
                status: "checked_in",
                startAt: "2026-07-07T04:00:00.000Z",
                endAt: "2026-07-07T04:30:00.000Z",
                source: "practo",
                reason: "Review",
                queueEntryId: "queue-1",
                queueStatus: "waiting",
                queuePosition: 1,
                checkedInAt: "2026-07-07T03:55:00.000Z",
                updatedAt: "2026-07-07T04:30:00.000Z"
              }
            ]
          }
        });
      }
      if (url.includes("/v1/leads?status=")) return jsonResponse({ leads: [] });
      throw new Error(`Unexpected CP2 fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const state = await loadCp2Workflow(undefined, "2026-07-07");

    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.data.appointments[0]).toMatchObject({
      patientName: "Rhea Synthetic",
      providerName: "Dr Kabir Doctor",
      appointmentType: "Consultation",
      chair: "Operatory 1",
      confirmationState: "unknown"
    });
    expect(state.data.queue[0]).toMatchObject({ id: "queue-1", patientName: "Rhea Synthetic" });
    expect(state.data.api?.dataAsOf).toBe("2026-07-07T04:30:00.000Z");
    expect(state.data.api?.appointmentsTruncated).toBe(false);
    expect(fetchMock.mock.calls.map(([input]) => input.toString()).join("\n")).not.toContain(
      "/v1/patients"
    );
  });

  it("searches patients on demand without changing the Today loader contract", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      expect(input.toString()).toContain("/v1/patients?phone=%2B919876543210");
      return jsonResponse({
        patients: [
          {
            id: "patient-1",
            fullName: "Rhea Synthetic",
            phone: "+919876543210",
            source: "practo",
            createdAt: "2026-07-01T09:00:00.000Z"
          }
        ]
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const patients = await searchLivePatients("+919876543210");

    expect(patients).toEqual([
      expect.objectContaining({
        displayName: "Rhea Synthetic",
        phone: "+919876543210",
        kind: "new"
      })
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves authoritative duplicate suggestions returned during live lead capture", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        primaryContact: "+919876543210",
        sourceDetail: { patientName: "Rhea Synthetic" }
      });
      return jsonResponse(
        {
          lead: {
            id: "lead-1",
            rowVersion: 1,
            source: "practo",
            sourceDetail: { patientName: "Rhea Synthetic" },
            primaryContact: "+919876543210",
            intent: "appointment_request",
            status: "new",
            firstSeenAt: "2026-07-07T03:00:00.000Z",
            createdAt: "2026-07-07T03:00:00.000Z"
          },
          patientMatchSuggestions: [
            {
              patient: {
                id: "patient-1",
                fullName: "Rhea Synthetic",
                phone: "+919876543210",
                email: null,
                createdAt: "2026-07-01T09:00:00.000Z"
              },
              score: 100,
              reasons: ["phone_exact"]
            }
          ]
        },
        201
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await createLiveLead({
      contactName: "Rhea Synthetic",
      messageSnippet: "Needs an appointment",
      phone: "+919876543210",
      source: "practo"
    });

    expect(result.lead.id).toBe("lead-1");
    expect(result.lead.contactName).toBe("Rhea Synthetic");
    expect(result.patientMatchSuggestions).toEqual([
      expect.objectContaining({
        matchedOn: "phone",
        patient: expect.objectContaining({ id: "patient-1" }),
        score: 100
      })
    ]);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status
  });
}
