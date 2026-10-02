import { describe, it, expect } from "vitest";
import { prepareAppointmentFile, APPOINTMENT_HEADERS } from "../lib/practo-appointment-file";
const file = (rows: string) => new Blob([APPOINTMENT_HEADERS.join(",") + "\n" + rows]);
describe("source appointment evidence boundary", () => {
  it("preserves identifiers and excludes notes/attendance before hashing or transfer", async () => {
    const result = await prepareAppointmentFile(
      file(
        "'2026-11-20 11:00:00',0007,Synthetic Patient,PRIVATE NOTE,Doctor Demo,'Scheduled',PRIVATE CHECKIN,PRIVATE CHECKOUT\n"
      )
    );
    expect(result.rows).toEqual([
      {
        date: "2026-11-20 11:00:00",
        patientNumber: "0007",
        patientName: "Synthetic Patient",
        doctorName: "Doctor Demo",
        status: "Scheduled"
      }
    ]);
    expect(JSON.stringify(result)).not.toContain("PRIVATE");
    expect(result.digest).toMatch(/^[a-f0-9]{64}$/);
    const changed = await prepareAppointmentFile(
      file("2026-11-20 11:00:00,0007,Synthetic Patient,DIFFERENT,Doctor Demo,Scheduled,,\n")
    );
    expect(changed.digest).toBe(result.digest);
  });
  it("rejects malformed, impossible and unknown evidence without guessing", async () => {
    for (const row of [
      "2026-02-30 11:00:00,7,Demo,,Doctor,Scheduled,,",
      "2026-11-20 11:00:00,7,Demo,,Doctor,Completed,,",
      "2026-11-20 11:00:00,7,Demo,,Doctor,Scheduled,",
      "2026-11-20 11:00:00,,Demo,,Doctor,Scheduled,,"
    ])
      await expect(prepareAppointmentFile(file(row))).rejects.toThrow();
  });
  it("rejects an oversized row count as a whole file", async () => {
    const row = "2026-11-20 11:00:00,7,Demo,,Doctor,Scheduled,,\n";
    await expect(prepareAppointmentFile(file(row.repeat(5001)))).rejects.toThrow("5,000");
  });
});
