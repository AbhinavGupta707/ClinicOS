import type { ClinicOsApiClient, PublicJsonObject } from "@clinic-os/api-client-generated";
import { fieldText, record, valueList } from "../shared/workflow-values";

export const HISTORY_LABELS: Readonly<Record<string, string>> = {
  visits: "Visits and notes",
  prescriptions: "Prescriptions and instructions",
  dental: "Dental findings and snapshots",
  treatment: "Treatment",
  billing: "Billing",
  intake: "Intake and consent",
  media: "Files and images",
  appointments: "Appointments and queue",
  follow_up: "Tasks and recalls",
  lab: "Laboratory",
  operations: "Quality and operations",
  identity: "Registration and source",
  ai: "Reviewed AI workflow"
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type HistorySource = {
  kind: "encounter" | "note" | "prescription" | "finding" | "snapshot" | "invoice" | "media";
  id: string;
  encounterId?: string;
};
export function historySource(
  item: PublicJsonObject,
  permissions: readonly string[]
): HistorySource | null {
  const id = fieldText(item, "resourceId"),
    table = fieldText(item, "sourceTable"),
    type = fieldText(item, "rawItemType");
  if (!uuid.test(id)) return null;
  if (
    table === "encounters" &&
    type.startsWith("encounter_") &&
    permissions.includes("clinical.note.read")
  )
    return { kind: "encounter", id };
  if(table === "media_assets" && type === "media_uploaded" && permissions.includes("media.read")) return {kind:"media",id};
  const encounterId = fieldText(record(item.metadata), "encounterId");
  if (
    table === "clinical_note_versions" &&
    type.startsWith("clinical_note_") &&
    uuid.test(encounterId) &&
    permissions.includes("clinical.note.read")
  )
    return { kind: "note", id, encounterId };
  if (
    table === "prescriptions" &&
    type.startsWith("prescription_") &&
    uuid.test(encounterId) &&
    permissions.includes("prescription.write")
  )
    return { kind: "prescription", id, encounterId };
  if (
    table === "dental_findings" &&
    type.startsWith("dental_finding_") &&
    permissions.includes("dental.chart.read")
  )
    return { kind: "finding", id };
  if (
    table === "dental_chart_snapshots" &&
    type === "dental_chart_snapshot_created" &&
    permissions.includes("dental.chart.read")
  )
    return { kind: "snapshot", id };
  if (table === "invoices" && type === "invoice_created" && permissions.includes("billing.read"))
    return { kind: "invoice", id };
  return null;
}

export interface HistorySourceDetail {
  readonly kind: HistorySource["kind"];
  readonly value: PublicJsonObject;
  readonly related: readonly PublicJsonObject[];
}
function assertPatient(value: PublicJsonObject, patientId: string): void {
  if (fieldText(value, "patientId") !== patientId)
    throw new Error(
      "This source record is not associated with the selected patient. Refresh history."
    );
}
function assertSourceId(value: PublicJsonObject, id: string): void {
  if (fieldText(value, "id") !== id)
    throw new Error(
      "The requested source record was not returned. No other record has been substituted."
    );
}
export async function readHistorySource(
  client: ClinicOsApiClient,
  patientId: string,
  source: HistorySource
): Promise<HistorySourceDetail> {
  if (source.kind === "media") {
    const response=await client.getPatientMediaAsset({path:{patientId,mediaAssetId:source.id}});
    assertPatient(response.mediaAsset,patientId);assertSourceId(response.mediaAsset,source.id);
    return {kind:"media",value:response.mediaAsset,related:[]};
  }
  if (source.kind === "note" || source.kind === "encounter" || source.kind === "prescription") {
    const encounterId = source.encounterId ?? source.id;
    const visit = await client.getEncounter({ path: { encounterId } });
    assertPatient(visit.encounter, patientId);
    assertSourceId(visit.encounter, encounterId);
    if (source.kind === "note") {
      const note = visit.noteVersions.find((n) => fieldText(n, "id") === source.id);
      if (!note)
        throw new Error(
          "The linked note version was not returned. No other version has been substituted."
        );
      assertPatient(note, patientId);
      return { kind: "note", value: note, related: [] };
    }
    if (source.kind === "prescription") {
      // Page until the exact source is found. Every request is bounded; no guessing
      // that the newest prescription is the one referenced by the event.
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await client.listEncounterPrescriptions({
          path: { encounterId },
          query: { limit: 100, cursor }
        });
        const value = page.prescriptions.find((p) => fieldText(p, "id") === source.id);
        if (value) {
          assertPatient(value, patientId);
          return { kind: "prescription", value, related: [] };
        }
        cursor = page.nextCursor ?? undefined;
        if (cursor && seen.has(cursor))
          throw new Error("Prescription history did not advance. Refresh the record.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      throw new Error(
        "The linked prescription is unavailable. No other prescription has been substituted."
      );
    }
    visit.noteVersions.forEach((note) => assertPatient(note, patientId));
    return { kind: "encounter", value: visit.encounter, related: visit.noteVersions };
  }
  if (source.kind === "snapshot") {
    const { snapshot } = await client.getPatientDentalSnapshot({
      path: { patientId, snapshotId: source.id }
    });
    assertPatient(snapshot, patientId);
    assertSourceId(snapshot, source.id);
    return { kind: "snapshot", value: snapshot, related: [] };
  }
  if (source.kind === "finding") {
    const { history } = await client.listDentalFindingHistory({ path: { findingId: source.id } });
    if (!history.length) throw new Error("No finding history was returned.");
    history.forEach((row) => assertPatient(row, patientId));
    return { kind: "finding", value: record(history[0]?.afterState), related: history };
  }
  const { invoice } = await client.getInvoice({ path: { invoiceId: source.id } });
  assertPatient(invoice, patientId);
  assertSourceId(invoice, source.id);
  return { kind: "invoice", value: invoice, related: [] };
}

const comparedFields = [
  "toothNumber",
  "surface",
  "findingType",
  "severity",
  "status",
  "reviewStatus",
  "source",
  "confidence",
  "notes"
] as const;
export interface SnapshotDifference {
  readonly findingId: string;
  readonly change: "added" | "changed" | "not_in_later_snapshot" | "unchanged";
  readonly before: PublicJsonObject | null;
  readonly after: PublicJsonObject | null;
  readonly changedFields: readonly string[];
}
export function compareDentalSnapshots(
  before: PublicJsonObject,
  after: PublicJsonObject
): SnapshotDifference[] {
  if (
    !fieldText(before, "patientId") ||
    before.patientId !== after.patientId ||
    before.clinicId !== after.clinicId ||
    before.tenantId !== after.tenantId
  )
    throw new Error("Compare snapshots from the same patient and clinic only.");
  if (
    typeof before.snapshotVersion !== "number" ||
    typeof after.snapshotVersion !== "number" ||
    before.snapshotVersion >= after.snapshotVersion
  )
    throw new Error("Choose an earlier snapshot and a later snapshot.");
  function indexed(snapshot: PublicJsonObject) {
    const state = record(snapshot.chartState);
    if (!Array.isArray(state.findings) || state.findingCount !== state.findings.length)
      throw new Error("Snapshot contents are incomplete; comparison is unavailable.");
    const map = new Map<string, PublicJsonObject>();
    for (const raw of valueList(state.findings)) {
      const row = record(raw);
      const id = fieldText(row, "findingId");
      if (!uuid.test(id) || map.has(id)) throw new Error("Snapshot finding identity is invalid.");
      map.set(id, row);
    }
    return map;
  }
  const left = indexed(before),
    right = indexed(after);
  return [...new Set([...left.keys(), ...right.keys()])].map((findingId) => {
    const a = left.get(findingId) ?? null,
      b = right.get(findingId) ?? null;
    const changedFields =
      a && b ? comparedFields.filter((k) => (a[k] ?? null) !== (b[k] ?? null)) : [];
    return {
      findingId,
      before: a,
      after: b,
      changedFields,
      change: !a
        ? "added"
        : !b
          ? "not_in_later_snapshot"
          : changedFields.length
            ? "changed"
            : "unchanged"
    };
  });
}
