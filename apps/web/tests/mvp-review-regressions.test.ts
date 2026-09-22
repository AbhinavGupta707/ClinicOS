import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FrontOfficePatientWorkspacePanel } from "../features/cp13/front-office/components";
import { MigrationOperationsPanel } from "../components/migration-operations-panel";
import type {
  FrontOfficeDayData,
  FrontOfficeLoadState
} from "../features/cp13/front-office/loaders";
import { createFixtureCp7IntegrationOpsData } from "../lib/cp7-integration-ops";

function renderPatient(dayState?: FrontOfficeLoadState<FrontOfficeDayData>) {
  const data = patientData();
  return renderToStaticMarkup(
    createElement(FrontOfficePatientWorkspacePanel, {
      dayState,
      timeZone: "Asia/Kolkata",
      onOpenFullProfile: () => {},
      state: { status: "ready", refreshedAt: "2026-09-20T09:00:00Z", data }
    })
  );
}

describe("patient day-data truth", () => {
  it("preserves loading, unavailable and error states when patient details are ready", () => {
    for (const state of [
      undefined,
      { status: "loading" } as const,
      {
        status: "unavailable",
        reason: "dependency_unavailable",
        message: "Day dependency unavailable",
        requestId: null
      } as const,
      { status: "error", message: "Day request failed", requestId: null, retryable: true } as const
    ]) {
      const html = renderPatient(state);
      expect(html).not.toContain("No appointment on");
      expect(html).not.toContain("No queue entry");
      expect(html).not.toContain("No open tasks");
      expect(html).not.toContain("No linked open leads");
      expect(html).toContain(
        state && "message" in state
          ? state.message
          : state
            ? "Loading clinic-day context"
            : "has not been loaded"
      );
    }
  });
  it("does not infer appointment absence from a truncated clinic day", () => {
    const data = dayData();
    data.dashboard.appointmentsTruncated = true;
    const html = renderPatient({ status: "ready", data, refreshedAt: "2026-09-20T09:00:00Z" });
    expect(html).toContain("appointment list is incomplete");
    expect(html).toContain("No appointment appears in the loaded portion");
    expect(html).not.toContain("No appointment on");
  });
  it("uses the clinic timezone including a midnight boundary", () => {
    const data = dayData();
    data.dashboard.clinicDayAppointments[0]!.patientId = "patient";
    data.dashboard.clinicDayAppointments[0]!.startAt = "2026-09-20T20:00:00Z";
    const html = renderPatient({ status: "ready", data, refreshedAt: "2026-09-20T20:00:00Z" });
    const expected = new Intl.DateTimeFormat("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Asia/Kolkata"
    }).format(new Date("2026-09-20T20:00:00Z"));
    // Assert the actual clinic-day rollover and time rather than the host timezone.
    expect(html).toContain("21 Sept");
    expect(html).toMatch(/1:30/);
    expect(expected).toMatch(/21 Sept/);
  });
});

describe("migration duplicate selection", () => {
  it("shows both named candidates and disables linking until deliberate selection", () => {
    const batch = createFixtureCp7IntegrationOpsData("2026-09-20").migrationBatches[0]!;
    const first = batch.conflicts[0]!;
    first.candidatePatient = { fullName: "Synthetic Parent", phone: "+919999997002" };
    batch.conflicts.push({
      ...first,
      id: "second-match",
      targetRecordId: "second-patient",
      candidatePatient: { fullName: "Synthetic Child", phone: "+919999997002" }
    });
    const html = renderToStaticMarkup(
      createElement(MigrationOperationsPanel, {
        actionBusy: false,
        batches: [batch],
        eligibleDoctors: [],
        fixtureMode: false,
        onCommit: async () => {},
        onCreate: async () => {},
        onRefresh: async () => {},
        onResolve: async () => {},
        onRollback: async () => {},
        onSelectBatch: () => {},
        selectedBatchId: batch.id
      })
    );
    expect(html).toContain("Synthetic Parent");
    expect(html).toContain("Synthetic Child");
    expect(html).toMatch(/<option value="" selected="">Select a patient/);
    expect(html).toMatch(/<button[^>]*data-testid="cp7-resolve-migration-conflict"[^>]*disabled/);
  });
});

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
          patientKind: "returning" as const,
          providerUserId: "10000000-0000-4000-8000-000000001002",
          providerName: "Dr Kabir Doctor",
          appointmentTypeId: "10000000-0000-4000-8000-000000003001",
          appointmentTypeName: "Consultation",
          chairId: "10000000-0000-4000-8000-000000004001",
          chairName: "Operatory 1",
          status: "booked" as const,
          startAt: "2026-07-11T12:00:00.000Z",
          endAt: "2026-07-11T12:30:00.000Z",
          source: "practo" as const,
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
