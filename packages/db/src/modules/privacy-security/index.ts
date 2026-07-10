import type { ClinicOperationsRepository, RepositoryScope } from "../../repositories.ts";
import {
  bindScopedRepositoryPort,
  type BoundClinicRepositoryPort,
  type RepositoryPortTransactionLease
} from "../core/scoped-repository-port.ts";

export const PRIVACY_SECURITY_OPERATIONS = [
  "listAuditEvents",
  "createAuditReview",
  "buildPatientRecordExportSnapshot",
  "createPatientRecordExport",
  "listPatientRecordExports",
  "createDeletionRequest",
  "findDeletionRequestById",
  "listDeletionRequests",
  "reviewDeletionRequest",
  "runRetentionJob",
  "createBreakGlassAccessRequest",
  "listBreakGlassAccessRequests",
  "reviewBreakGlassAccessRequest",
  "findActiveBreakGlassAccess"
] as const satisfies readonly (keyof ClinicOperationsRepository)[];

export type PrivacySecurityRepositoryPort = BoundClinicRepositoryPort<
  (typeof PRIVACY_SECURITY_OPERATIONS)[number]
>;

/** @internal Constructed only inside the clinic module unit of work. */
export function bindPrivacySecurityRepository(
  repository: ClinicOperationsRepository,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): PrivacySecurityRepositoryPort {
  return bindScopedRepositoryPort(repository, scope, PRIVACY_SECURITY_OPERATIONS, lease);
}
