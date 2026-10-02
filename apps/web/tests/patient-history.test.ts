import { describe, expect, it, vi } from "vitest";
import type { ClinicOsApiClient, PublicJsonObject } from "@clinic-os/api-client-generated";
import {
  compareDentalSnapshots,
  historySource,
  readHistorySource
} from "../features/cp13/clinical-dental/patient-history";
const id = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const finding = {
  findingId: id,
  toothNumber: "16",
  status: "active",
  notes: "Synthetic prior evidence"
};
const snapshot = (version: number, findings: PublicJsonObject[]) => ({
  patientId: id,
  tenantId: id,
  clinicId: id,
  snapshotVersion: version,
  chartState: { findingCount: findings.length, findings }
});
describe("patient history source safety", () => {
  it("allows only recognized internal source contracts with the required permission", () => {
    const row = { resourceId: id, sourceTable: "encounters", rawItemType: "encounter_created" };
    expect(historySource(row, [])).toBeNull();
    expect(
      historySource({ ...row, sourceTable: "https://external.invalid" }, ["clinical.note.read"])
    ).toBeNull();
    expect(historySource({ ...row, resourceId: "../../other" }, ["clinical.note.read"])).toBeNull();
    expect(historySource(row, ["clinical.note.read"])).toEqual({ kind: "encounter", id });
  });
  it("does not substitute a newer note for a missing linked version", async () => {
    const client = {
      getEncounter: vi.fn(async () => ({
        encounter: { id: other, patientId: id },
        noteVersions: [{ id: other, patientId: id }]
      }))
    } as unknown as ClinicOsApiClient;
    await expect(
      readHistorySource(client, id, { kind: "note", id, encounterId: other })
    ).rejects.toThrow("No other version");
  });
  it("rejects a source belonging to another patient before returning its content", async () => {
    const client = {
      getInvoice: vi.fn(async () => ({ invoice: { patientId: other } }))
    } as unknown as ClinicOsApiClient;
    await expect(readHistorySource(client, id, { kind: "invoice", id })).rejects.toThrow(
      "selected patient"
    );
  });
  it("finds the exact prescription beyond the first page and guards repeated cursors", async () => {
    const getEncounter = vi.fn(async () => ({
      encounter: { id: other, patientId: id },
      noteVersions: []
    }));
    const listEncounterPrescriptions = vi
      .fn()
      .mockResolvedValueOnce({ prescriptions: [], nextCursor: other })
      .mockResolvedValueOnce({ prescriptions: [{ id, patientId: id }], nextCursor: null });
    const client = { getEncounter, listEncounterPrescriptions } as unknown as ClinicOsApiClient;
    expect(
      (await readHistorySource(client, id, { kind: "prescription", id, encounterId: other })).value
        .id
    ).toBe(id);
    expect(listEncounterPrescriptions.mock.calls[1]![0].query.cursor).toBe(other);
    listEncounterPrescriptions
      .mockReset()
      .mockResolvedValue({ prescriptions: [], nextCursor: other });
    await expect(
      readHistorySource(client, id, { kind: "prescription", id, encounterId: other })
    ).rejects.toThrow("did not advance");
  });
});
describe("dental snapshot comparison", () => {
  it("distinguishes added, changed and absent without inferring treatment", () => {
    const result = compareDentalSnapshots(
      snapshot(1, [finding, { ...finding, findingId: other }]),
      snapshot(2, [
        { ...finding, status: "treated" },
        { ...finding, findingId: "10000000-0000-4000-8000-000000000003" }
      ])
    );
    expect(result.map((r) => r.change)).toEqual(["changed", "not_in_later_snapshot", "added"]);
    expect(result[0]!.changedFields).toEqual(["status"]);
  });
  it("rejects foreign, reversed, duplicate and incomplete snapshots", () => {
    const a = snapshot(1, [finding]),
      b = snapshot(2, [finding]);
    expect(() => compareDentalSnapshots(a, { ...b, patientId: other })).toThrow("same patient");
    expect(() => compareDentalSnapshots(b, a)).toThrow("earlier");
    expect(() => compareDentalSnapshots(a, snapshot(2, [finding, finding]))).toThrow("identity");
    expect(() =>
      compareDentalSnapshots(a, { ...b, chartState: { findingCount: 2, findings: [finding] } })
    ).toThrow("incomplete");
  });
});

it("rejects a substituted source record even for the same patient", async () => {
  const client = {
    getInvoice: async () => ({ invoice: { id: other, patientId: id } })
  } as unknown as ClinicOsApiClient;
  await expect(readHistorySource(client, id, { kind: "invoice", id })).rejects.toThrow(
    "No other record"
  );
});
