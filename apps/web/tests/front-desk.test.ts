import { describe, expect, it, vi } from "vitest";
import { ClinicOsApiError } from "@clinic-os/api-client-generated";
import {
  clinicDateTime,
  clinicDateTimeToInstant,
  createFrontDeskCommand,
  frontDeskCommandForScope,
  loadBookingConfiguration,
  mutationProblem
} from "../features/cp13/front-office/front-desk";

describe("clinic-local appointment entry", () => {
  it("resolves Gurgaon time without using the Mac timezone", () => {
    expect(clinicDateTimeToInstant("2026-09-26T09:15", "Asia/Kolkata")).toBe(
      "2026-09-26T03:45:00.000Z"
    );
    expect(clinicDateTime("2026-09-25T20:00:00Z", "Asia/Kolkata")).toBe("2026-09-26T01:30");
  });
  it.each(["2026-02-30T09:00", "2026-01-01T24:01", "", "2026-01-01T09:00Z"])(
    "rejects invalid local input %s",
    (local) => {
      expect(() => clinicDateTimeToInstant(local, "Asia/Kolkata")).toThrow();
    }
  );
  it("rejects skipped and repeated DST times", () => {
    expect(() => clinicDateTimeToInstant("2026-03-08T02:30", "America/New_York")).toThrow(
      "does not exist"
    );
    expect(() => clinicDateTimeToInstant("2026-11-01T01:30", "America/New_York")).toThrow(
      "occurs twice"
    );
    expect(clinicDateTimeToInstant("2026-11-01T03:30", "America/New_York")).toBe(
      "2026-11-01T08:30:00.000Z"
    );
    expect(() => clinicDateTimeToInstant("2026-04-05T01:45", "Australia/Lord_Howe")).toThrow(
      "occurs twice"
    );
  });
});

function apiError(status: number, details = {}) {
  return new ClinicOsApiError(status, {
    error: { code: "CONFLICT", message: "Conflict", details, request_id: "synthetic" }
  });
}
describe("front desk recovery and configuration contracts", () => {
  it("reuses the exact action and key after a lost response, never a newly edited payload", async () => {
    const command = createFrontDeskCommand();
    const keys: string[] = [];
    const first = vi.fn(async (key: string) => {
      keys.push(key);
      if (keys.length === 1) throw new TypeError("network");
      return "booked";
    });
    await expect(command.execute(first)).rejects.toThrow();
    const second = vi.fn(async () => "different patient");
    expect(await command.execute(second)).toBe("booked");
    expect(keys[0]).toBe(keys[1]);
    expect(second).not.toHaveBeenCalled();
    expect(await command.execute(second)).toBe("different patient");
  });
  it("allows a new reviewed operation after a definitive conflict", async () => {
    const command = createFrontDeskCommand();
    const keys: string[] = [];
    await expect(
      command.execute(async (key) => {
        keys.push(key);
        throw apiError(409);
      })
    ).rejects.toThrow();
    await command.execute(async (key) => {
      keys.push(key);
    });
    expect(keys[0]).not.toBe(keys[1]);
    expect(mutationProblem(apiError(409, { reason: "if_match_failed" })).message).toContain(
      "Another staff member"
    );
    expect(mutationProblem(apiError(503)).uncertain).toBe(true);
    expect(mutationProblem(apiError(403)).uncertain).toBe(false);
  });
  it("loads named configuration through existing generated methods and fails incomplete config", async () => {
    const client = {
      listClinicDoctors: vi.fn(async () => ({
        clinicDoctors: [{ providerUserId: "doctor", displayName: "Dr Synthetic" }]
      })),
      listAppointmentTypes: vi.fn(async () => ({
        appointmentTypes: [
          { id: "type", displayName: "Consultation", defaultDurationMinutes: 30, active: true }
        ]
      })),
      listChairs: vi.fn(async () => ({
        chairs: [
          { id: "chair", displayName: "Chair 1", active: true },
          { id: "old", displayName: "Old", active: false }
        ]
      }))
    };
    expect(await loadBookingConfiguration(client)).toEqual({
      doctors: [{ id: "doctor", name: "Dr Synthetic" }],
      types: [{ id: "type", name: "Consultation", durationMinutes: 30 }],
      chairs: [{ id: "chair", name: "Chair 1" }]
    });
    client.listAppointmentTypes.mockResolvedValue({
      appointmentTypes: [
        { id: "type", displayName: "Consultation", defaultDurationMinutes: 0, active: true }
      ]
    });
    await expect(loadBookingConfiguration(client)).rejects.toThrow("duration");
  });
});

it("deduplicates simultaneous retry clicks and retains an in-progress operation", async () => {
  const command = createFrontDeskCommand();
  let finish!: () => void;
  const action = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const first = command.execute(action);
  const second = command.execute(action);
  await Promise.resolve();
  expect(action).toHaveBeenCalledTimes(1);
  expect(command.hasPending()).toBe(true);
  finish();
  await Promise.all([first, second]);
  expect(command.hasPending()).toBe(false);
  expect(
    mutationProblem(apiError(409, { reason: "idempotency_request_in_progress" })).uncertain
  ).toBe(true);
});

it("retains recovery across same-identity navigation without sharing another actor's request", async () => {
  const command = frontDeskCommandForScope("tenant:clinic:receptionist");
  await expect(
    command.execute(async () => {
      throw new TypeError("lost response");
    })
  ).rejects.toThrow();
  expect(frontDeskCommandForScope("tenant:clinic:receptionist")).toBe(command);
  expect(frontDeskCommandForScope("tenant:clinic:receptionist").hasPending()).toBe(true);
  expect(frontDeskCommandForScope("tenant:clinic:doctor").hasPending()).toBe(false);
});

it("does not invent a recovery when a navigated-away request already finished", async () => {
  const command = createFrontDeskCommand();
  let finish!: () => void;
  const action = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const running = command.execute(action);
  await Promise.resolve();
  expect(command.recover()).toBe(running);
  finish();
  await running;
  expect(command.recover()).toBeNull();
  expect(action).toHaveBeenCalledTimes(1);
  expect(command.hasPending()).toBe(false);
});
