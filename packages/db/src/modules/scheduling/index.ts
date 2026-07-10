import type { ClinicOperationsRepository, RepositoryScope } from "../../repositories.ts";
import {
  bindScopedRepositoryPort,
  type BoundClinicRepositoryPort,
  type RepositoryPortTransactionLease
} from "../core/scoped-repository-port.ts";

export const SCHEDULING_OPERATIONS = [
  "listAppointmentTypes",
  "listChairs",
  "listProviderSchedules",
  "listAppointments",
  "findAppointmentById",
  "findAppointmentConflicts",
  "createAppointment",
  "updateAppointmentStatus",
  "createQueueEntry",
  "listQueueEntries",
  "updateQueueEntry"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type SchedulingRepositoryPort = BoundClinicRepositoryPort<
  (typeof SCHEDULING_OPERATIONS)[number]
>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindSchedulingRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): SchedulingRepositoryPort {
  return bindScopedRepositoryPort(repository, scope, SCHEDULING_OPERATIONS, lease);
}
