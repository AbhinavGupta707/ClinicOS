import type { ClinicOperationsRepository, RepositoryScope } from "../../repositories.ts";
import {
  bindScopedRepositoryPort,
  type BoundClinicRepositoryPort,
  type RepositoryPortTransactionLease
} from "../core/scoped-repository-port.ts";

export const CONTINUITY_OPERATIONS = [
  "listTasks",
  "findTaskById",
  "createTask",
  "updateTask",
  "createRecallRule",
  "listRecalls",
  "recordRecallAction",
  "generateDueContinuityTasks",
  "createSopTemplate",
  "createSopSchedule",
  "generateDueSopRuns",
  "listSopRuns",
  "updateSopRun"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type ContinuityRepositoryPort = BoundClinicRepositoryPort<
  (typeof CONTINUITY_OPERATIONS)[number]
>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindContinuityRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): ContinuityRepositoryPort {
  return bindScopedRepositoryPort(repository, scope, CONTINUITY_OPERATIONS, lease);
}
