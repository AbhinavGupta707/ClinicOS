import type { ClinicOperationsRepository, RepositoryScope } from "../../repositories.ts";
import {
  bindScopedRepositoryPort,
  type BoundClinicRepositoryPort,
  type RepositoryPortTransactionLease
} from "../core/scoped-repository-port.ts";

export const DENTAL_TREATMENT_OPERATIONS = [
  "getDentalChart",
  "createDentalFinding",
  "updateDentalFinding",
  "listDentalFindingHistory",
  "createDentalChartSnapshot",
  "createTreatmentPlan",
  "findTreatmentPlanById",
  "updateTreatmentPlan",
  "acceptTreatmentPlan",
  "createProcedurePerformed",
  "listCompletedProceduresForInvoice"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type DentalTreatmentRepositoryPort = BoundClinicRepositoryPort<
  (typeof DENTAL_TREATMENT_OPERATIONS)[number]
>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindDentalTreatmentRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): DentalTreatmentRepositoryPort {
  return bindScopedRepositoryPort(repository, scope, DENTAL_TREATMENT_OPERATIONS, lease);
}
