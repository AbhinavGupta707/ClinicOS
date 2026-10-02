import type { ClinicOsApiClient, GetImportRunResponse } from "@clinic-os/api-client-generated";
import { normalizeClinicDoctors, normalizeLiveMigrationBatch } from "./cp7-integration-ops";
import type { MeProfile } from "./me";

export type ImportRunDetail = Omit<GetImportRunResponse, "batches"> & {
  batches: NonNullable<ReturnType<typeof normalizeLiveMigrationBatch>>[];
};

export const IMPORT_RUN_STATUS_LABELS: Record<GetImportRunResponse["status"], string> = {
  awaiting_patients: "Add patients",
  awaiting_practitioners: "Map practitioners",
  awaiting_appointments: "Add appointments",
  review_required: "Review required",
  partial: "Exceptions remain",
  complete: "All staged rows committed",
  rolled_back: "Rolled back"
};

export function normalizeImportRun(value: GetImportRunResponse): ImportRunDetail {
  const batches = value.batches.map(normalizeLiveMigrationBatch);
  if (batches.some((batch) => !batch) || batches.length > 3) {
    throw new Error("The saved import could not be read safely. Refresh before continuing.");
  }
  return { ...value, batches: batches as ImportRunDetail["batches"] };
}

// Only a random run identifier is retained. CSV, patient data and credentials are never stored.
export function importRunStorageKey(
  profile: Pick<MeProfile, "tenant" | "clinic" | "user">
): string {
  return `clinicos:import-run:${profile.tenant.id}:${profile.clinic.id}:${profile.user.id}`;
}
export function readImportRunId(storage: Pick<Storage, "getItem">, key: string): string | null {
  try {
    const value = storage.getItem(key);
    return value &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

export async function loadImportRunWorkspace(
  client: Pick<ClinicOsApiClient, "getImportRun" | "listClinicDoctors">,
  id: string
) {
  const [runResult, doctorResult] = await Promise.allSettled([
    client.getImportRun({ path: { runId: id } }),
    client.listClinicDoctors()
  ]);
  if (runResult.status === "rejected") throw runResult.reason;
  const doctors =
    doctorResult.status === "fulfilled" ? normalizeClinicDoctors(doctorResult.value) : null;
  return {
    detail: normalizeImportRun(runResult.value),
    doctors: doctors ?? [],
    doctorsUnavailable: doctors === null
  };
}
