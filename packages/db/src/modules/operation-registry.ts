import type { ClinicOperationsRepository } from "../repositories.ts";
import { AI_SCRIBE_OPERATIONS } from "./ai-scribe/index.ts";
import { BILLING_OPERATIONS } from "./billing/index.ts";
import { CLINIC_OPERATIONS_OPERATIONS } from "./clinic-operations/index.ts";
import { CLINICAL_CARE_OPERATIONS } from "./clinical-care/index.ts";
import { CLINICAL_MEDIA_OPERATIONS } from "./clinical-media/index.ts";
import { CONTINUITY_OPERATIONS } from "./continuity/index.ts";
import { DATA_INTEGRATIONS_OPERATIONS } from "./data-integrations/index.ts";
import { DENTAL_TREATMENT_OPERATIONS } from "./dental-treatment/index.ts";
import { PATIENT_ADMINISTRATION_OPERATIONS } from "./patient-administration/index.ts";
import { PRIVACY_SECURITY_OPERATIONS } from "./privacy-security/index.ts";
import { SCHEDULING_OPERATIONS } from "./scheduling/index.ts";
import { TRANSACTION_EVIDENCE_OPERATIONS } from "./transaction-evidence.ts";
import type { ScopedRepositoryOperationName } from "./core/scoped-repository-port.ts";

export const CLINIC_MODULE_OPERATION_OWNERS = Object.freeze({
  patientAdministration: PATIENT_ADMINISTRATION_OPERATIONS,
  scheduling: SCHEDULING_OPERATIONS,
  clinicalCare: CLINICAL_CARE_OPERATIONS,
  dentalTreatment: DENTAL_TREATMENT_OPERATIONS,
  billing: BILLING_OPERATIONS,
  continuity: CONTINUITY_OPERATIONS,
  clinicOperations: CLINIC_OPERATIONS_OPERATIONS,
  privacySecurity: PRIVACY_SECURITY_OPERATIONS,
  dataIntegrations: DATA_INTEGRATIONS_OPERATIONS,
  aiScribe: AI_SCRIBE_OPERATIONS,
  clinicalMedia: CLINICAL_MEDIA_OPERATIONS,
  transactionEvidence: TRANSACTION_EVIDENCE_OPERATIONS
});

type ClinicModuleOperationTuple =
  (typeof CLINIC_MODULE_OPERATION_OWNERS)[keyof typeof CLINIC_MODULE_OPERATION_OWNERS];
export type ClinicModuleOperationName = ClinicModuleOperationTuple[number];

export const ALL_CLINIC_MODULE_OPERATIONS = Object.freeze(
  Object.values(CLINIC_MODULE_OPERATION_OWNERS).flat()
) as readonly ClinicModuleOperationName[];

type MissingLegacyOperation = Exclude<keyof ClinicOperationsRepository, ClinicModuleOperationName>;
type UnknownModuleOperation = Exclude<ClinicModuleOperationName, keyof ClinicOperationsRepository>;
type AssertNoOperationDrift<TValue extends never> = TValue;

/** A compile-time complement to the runtime duplicate and source-inventory architecture tests. */
export type ClinicModuleOperationCoverage = AssertNoOperationDrift<
  MissingLegacyOperation | UnknownModuleOperation
>;

const _allModuleOperationsAreScoped: readonly ScopedRepositoryOperationName[] =
  ALL_CLINIC_MODULE_OPERATIONS;
void _allModuleOperationsAreScoped;
