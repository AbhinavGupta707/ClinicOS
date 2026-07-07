import { describe, expect, it } from "vitest";

import {
  applyFixtureCreateLead,
  applyFixtureCheckInAppointment,
  classifyEndpointFailures,
  createFixtureWorkflowData,
  duplicateSuggestionDisplayText,
  findDuplicateSuggestions,
  sourceLabel,
  summarizeDashboard
} from "@/lib/cp2-workflow";
import { getSurface, getVisibleSurfaces } from "@/lib/navigation";

describe("CP2 frontend workflow", () => {
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
    const data = createFixtureWorkflowData("2026-07-07");
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
  });
});
