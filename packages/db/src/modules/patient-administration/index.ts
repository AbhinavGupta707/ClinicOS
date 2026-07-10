import type { ClinicOperationsRepository } from "../../repositories.ts";
import {
  bindScopedRepositoryPort,
  type BoundClinicRepositoryPort,
  type RepositoryPortTransactionLease
} from "../core/scoped-repository-port.ts";
import type { RepositoryScope } from "../../repositories.ts";

export const PATIENT_ADMINISTRATION_OPERATIONS = [
  "listPatients",
  "findPatientById",
  "findPatientTimeline",
  "findPatientDuplicateCandidates",
  "createPatient",
  "updatePatient",
  "listLeads",
  "findLeadById",
  "createLead",
  "updateLeadStatus",
  "matchLeadToPatient",
  "createAttributionTouch"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type PatientAdministrationRepositoryPort = BoundClinicRepositoryPort<
  (typeof PATIENT_ADMINISTRATION_OPERATIONS)[number]
>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindPatientAdministrationRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): PatientAdministrationRepositoryPort {
  return bindScopedRepositoryPort(repository, scope, PATIENT_ADMINISTRATION_OPERATIONS, lease);
}
