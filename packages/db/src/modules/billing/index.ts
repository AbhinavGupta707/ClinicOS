import type { ClinicOperationsRepository, RepositoryScope } from "../../repositories.ts";
import {
  bindScopedRepositoryPort,
  type BoundClinicRepositoryPort,
  type RepositoryPortTransactionLease
} from "../core/scoped-repository-port.ts";

export const BILLING_OPERATIONS = [
  "listPricebookProcedures",
  "findPricebookProcedureById",
  "createInvoice",
  "findInvoiceById",
  "createPaymentRequest",
  "recordPaymentTransaction",
  "createReceipt"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type BillingRepositoryPort = BoundClinicRepositoryPort<(typeof BILLING_OPERATIONS)[number]>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindBillingRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): BillingRepositoryPort {
  return bindScopedRepositoryPort(repository, scope, BILLING_OPERATIONS, lease);
}
