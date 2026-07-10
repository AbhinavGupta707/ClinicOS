import type { ClinicOperationsRepository, RepositoryScope } from "../../repositories.ts";
import {
  bindScopedRepositoryPort,
  type BoundClinicRepositoryPort,
  type RepositoryPortTransactionLease
} from "../core/scoped-repository-port.ts";

export const CLINICAL_CARE_OPERATIONS = [
  "listIntakeFormTemplates",
  "findIntakeFormTemplateById",
  "createIntakeFormTemplate",
  "createIntakeFormSubmission",
  "listPatientIntakeFormSubmissions",
  "listPatientConsents",
  "createConsent",
  "revokeConsent",
  "getConsentEnforcementState",
  "createEncounter",
  "findEncounterById",
  "transitionEncounter",
  "saveClinicalNoteDraft",
  "listClinicalNoteVersions",
  "signClinicalNote",
  "amendClinicalNote",
  "createPrescription",
  "findPrescriptionById",
  "signPrescription",
  "createPatientInstruction"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type ClinicalCareRepositoryPort = BoundClinicRepositoryPort<
  (typeof CLINICAL_CARE_OPERATIONS)[number]
>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindClinicalCareRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): ClinicalCareRepositoryPort {
  return bindScopedRepositoryPort(repository, scope, CLINICAL_CARE_OPERATIONS, lease);
}
