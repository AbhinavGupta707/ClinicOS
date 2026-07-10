export {
  ClinicModuleUnitOfWork,
  createPostgresClinicModuleUnitOfWork,
  runWithClinicModuleTransactionContext,
  type ClinicModuleScopeResolver,
  type ClinicModuleTransactionContext,
  type ClinicRepositoryModules,
  type ClinicRepositoryUnitOfWorkPort
} from "./clinic-module-unit-of-work.ts";
export {
  ALL_CLINIC_MODULE_OPERATIONS,
  CLINIC_MODULE_OPERATION_OWNERS,
  type ClinicModuleOperationCoverage,
  type ClinicModuleOperationName
} from "./operation-registry.ts";
export type { AiScribeRepositoryPort } from "./ai-scribe/index.ts";
export type { BillingRepositoryPort } from "./billing/index.ts";
export type { ClinicOperationsRepositoryPort } from "./clinic-operations/index.ts";
export type { ClinicalCareRepositoryPort } from "./clinical-care/index.ts";
export type { ClinicalMediaRepositoryPort } from "./clinical-media/index.ts";
export type { ContinuityRepositoryPort } from "./continuity/index.ts";
export type { DataIntegrationsRepositoryPort } from "./data-integrations/index.ts";
export type { DentalTreatmentRepositoryPort } from "./dental-treatment/index.ts";
export {
  DURABLE_INTEGRITY_OPERATIONS,
  DurableIntegrityRepositoryUnavailableError,
  type DurableIntegrityRepositoryPort
} from "./durable-integrity/index.ts";
export type { PatientAdministrationRepositoryPort } from "./patient-administration/index.ts";
export type { PrivacySecurityRepositoryPort } from "./privacy-security/index.ts";
export type { SchedulingRepositoryPort } from "./scheduling/index.ts";
export type { RequestAuditEventInput, TransactionEvidencePort } from "./transaction-evidence.ts";
