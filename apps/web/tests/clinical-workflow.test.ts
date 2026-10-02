import { describe, expect, it, vi } from "vitest";
import { ClinicOsApiError } from "@clinic-os/api-client-generated";
import { assertFdiTooth, intakeFields, intakeResponses, prescriptionMedications } from "../features/cp13/clinical-dental/clinical-workflow";
import { createWorkflowCommand, workflowProblem } from "../features/cp13/shared/WorkflowAction";
import { etag } from "../features/cp13/shared/workflow-values";

describe("clinical form contracts", () => {
  it("renders the fixture template and creates typed responses", () => {
    const fields = intakeFields({ schema: { fields: ["chiefComplaint", "allergies"] } });
    expect(fields.map((field) => field.key)).toEqual(["chiefComplaint", "allergies"]);
    expect(intakeResponses(fields, { chiefComplaint: "Pain", allergies: "Penicillin" })).toEqual({
      chiefComplaint: "Pain", allergies: "Penicillin"
    });
  });
  it("rejects unsupported schema elements and invalid choice values", () => {
    expect(() => intakeFields({ schema: { properties: { nested: { type: "object" } } } })).toThrow();
    const fields = intakeFields({ schema: { required: ["allergy"], properties: {
      allergy: { type: "string", enum: ["none", "known"] }
    } } });
    expect(() => intakeResponses(fields, { allergy: "unknown" })).toThrow();
    expect(() => intakeResponses(fields, {})).toThrow();
  });
  it("validates FDI notation and every medication row", () => {
    expect(assertFdiTooth("16")).toBe("16");
    expect(assertFdiTooth("85")).toBe("85");
    expect(() => assertFdiTooth("19")).toThrow();
    expect(() => assertFdiTooth("51a")).toThrow();
    expect(() => prescriptionMedications([{ name: "A", strength: "", route: "", frequency: "", duration: "5d", instructions: "" }])).toThrow();
    expect(prescriptionMedications([{ name: "A", strength: "", route: "", frequency: "daily", duration: "5d", instructions: "" }])).toEqual([
      { name: "A", frequency: "daily", duration: "5d" }
    ]);
  });
  it("uses strong row-version preconditions", () => {
    expect(etag({ id: "record", rowVersion: 3 })).toBe('"rv-3"');
    expect(() => etag({ id: "record", rowVersion: 0 })).toThrow();
  });
});

function conflict(reason: string) {
  return new ClinicOsApiError(409, {
    error: { code: "CONFLICT", message: "Conflict", details: { reason }, request_id: "synthetic" }
  });
}

describe("clinical command recovery", () => {
  it("replays the same payload and key after an uncertain outcome", async () => {
    const command = createWorkflowCommand();
    const request = { patient: "first" };
    const observed: string[] = [];
    const original = vi.fn(async (key: string) => {
      observed.push(key);
      if (observed.length === 1) throw new TypeError("lost response");
      return request.patient;
    });
    await expect(command.execute(original,"patient first")).rejects.toThrow();
    expect(command.hasPending()).toBe(true);
    expect(command.pendingLabel()).toBe("patient first");
    const replacement = vi.fn(async () => "other patient");
    expect(await command.execute(replacement)).toBe("first");
    expect(replacement).not.toHaveBeenCalled();
    expect(observed[0]).toBe(observed[1]);
    expect(command.hasPending()).toBe(false);
  });
  it("retains in-progress conflicts and clears stale-version conflicts", async () => {
    const command = createWorkflowCommand();
    await expect(command.execute(async () => { throw conflict("idempotency_request_in_progress"); })).rejects.toThrow();
    expect(command.hasPending()).toBe(true);
    expect(workflowProblem(conflict("idempotency_request_in_progress")).uncertain).toBe(true);
    const fresh = createWorkflowCommand();
    await expect(fresh.execute(async () => { throw conflict("if_match_failed"); })).rejects.toThrow();
    expect(fresh.hasPending()).toBe(false);
  });
});
