import type { ClinicOperationsRepository, RepositoryScope } from "../../repositories.ts";
import {
  bindScopedRepositoryPort,
  type BoundClinicRepositoryPort,
  type RepositoryPortTransactionLease
} from "../core/scoped-repository-port.ts";

export const CLINICAL_MEDIA_OPERATIONS = [
  "createMediaUploadReservation",
  "findMediaUploadReservationById",
  "completeMediaUpload",
  "listPatientMediaAssets",
  "findMediaAssetById"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type ClinicalMediaRepositoryPort = BoundClinicRepositoryPort<
  (typeof CLINICAL_MEDIA_OPERATIONS)[number]
>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindClinicalMediaRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): ClinicalMediaRepositoryPort {
  return bindScopedRepositoryPort(repository, scope, CLINICAL_MEDIA_OPERATIONS, lease);
}
