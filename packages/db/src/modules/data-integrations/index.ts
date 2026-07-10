import type { ClinicOperationsRepository, RepositoryScope } from "../../repositories.ts";
import {
  bindScopedRepositoryPort,
  type BoundClinicRepositoryPort,
  type RepositoryPortTransactionLease
} from "../core/scoped-repository-port.ts";

export const DATA_INTEGRATIONS_OPERATIONS = [
  "createMigrationBatch",
  "listMigrationBatches",
  "findMigrationBatchById",
  "listMigrationRows",
  "resolveMigrationRow",
  "commitMigrationBatch",
  "rollbackMigrationBatch",
  "listIntegrationDeadLetters",
  "requestIntegrationDeadLetterReplay"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type DataIntegrationsRepositoryPort = BoundClinicRepositoryPort<
  (typeof DATA_INTEGRATIONS_OPERATIONS)[number]
>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindDataIntegrationsRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): DataIntegrationsRepositoryPort {
  return bindScopedRepositoryPort(repository, scope, DATA_INTEGRATIONS_OPERATIONS, lease);
}
