import type { ClinicOperationsRepository, RepositoryScope } from "../../repositories.ts";
import {
  bindScopedRepositoryPort,
  type BoundClinicRepositoryPort,
  type RepositoryPortTransactionLease
} from "../core/scoped-repository-port.ts";

export const CLINIC_OPERATIONS_OPERATIONS = [
  "listLabVendors",
  "findLabVendorById",
  "createLabVendor",
  "listLabCases",
  "findLabCaseById",
  "createLabCase",
  "updateLabCaseStatus",
  "createLabReconciliation",
  "listInventoryCategories",
  "createInventoryCategory",
  "listInventoryItems",
  "findInventoryItemById",
  "createInventoryItem",
  "createStockLedgerEntry",
  "listInventoryCheckTemplates",
  "createInventoryCheckTemplate",
  "createInventoryCheckRun",
  "updateInventoryCheckRun",
  "listInventoryExceptions",
  "listIncidents",
  "createIncident",
  "listCorrectiveActions",
  "createCorrectiveAction",
  "updateCorrectiveAction",
  "loadDashboardData",
  "loadOwnerDashboardProjectionData"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type ClinicOperationsRepositoryPort = BoundClinicRepositoryPort<
  (typeof CLINIC_OPERATIONS_OPERATIONS)[number]
>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindClinicOperationsRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): ClinicOperationsRepositoryPort {
  return bindScopedRepositoryPort(repository, scope, CLINIC_OPERATIONS_OPERATIONS, lease);
}
