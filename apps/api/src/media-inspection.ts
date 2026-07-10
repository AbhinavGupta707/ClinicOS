import type { ClinicalMediaInspectionProvider } from "./features/clinical-dental/index.ts";

/**
 * Local synthetic evidence adapter. It never asserts that patient-supplied content is clean;
 * production-like runtimes must register an approved malware/quarantine provider instead.
 */
export class PendingLocalClinicalMediaInspectionSimulator implements ClinicalMediaInspectionProvider {
  async inspect(
    input: Parameters<ClinicalMediaInspectionProvider["inspect"]>[0]
  ): Promise<Awaited<ReturnType<ClinicalMediaInspectionProvider["inspect"]>>> {
    return {
      scanStatus: "pending",
      quarantineReason: null,
      objectVersion: `sha256:${input.object.sha256Digest}`,
      dicomMetadata: {}
    };
  }
}
