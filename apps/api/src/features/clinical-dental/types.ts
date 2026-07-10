import type { UUID, MediaScanStatus, MediaUploadReservationRecord } from "@clinic-os/domain";
import type {
  ClinicFeatureExecutionContext,
  ClinicFeatureOperationHandler,
  ClinicFeatureOperationRequest
} from "../contracts.ts";
import type { CP13_CLINICAL_DENTAL_OPERATION_IDS } from "../cp13-operation-ownership.ts";
import type { MediaStorageProvider, StoredMediaObject } from "../../media-storage.ts";

export type ClinicalDentalOperationId = (typeof CP13_CLINICAL_DENTAL_OPERATION_IDS)[number];

export type ClinicalDentalHandlerMap = Readonly<{
  [TOperationId in ClinicalDentalOperationId]: ClinicFeatureOperationHandler<TOperationId>;
}>;

/**
 * Master-owned composition implements this port with transaction-bound patient/scheduling reads.
 * It is required because the frozen clinical port intentionally cannot resolve appointment or
 * staff-role relationships and request bodies never establish those relationships as authority.
 */
export interface ClinicalDentalRelationshipAuthority {
  patientExists(context: ClinicFeatureExecutionContext, patientId: UUID): Promise<boolean>;
  appointmentBelongsToPatient(
    context: ClinicFeatureExecutionContext,
    input: Readonly<{ appointmentId: UUID; patientId: UUID }>
  ): Promise<boolean>;
  providerCanOwnEncounter(
    context: ClinicFeatureExecutionContext,
    providerUserId: UUID
  ): Promise<boolean>;
  dentalFindingBelongsToPatient(
    context: ClinicFeatureExecutionContext,
    input: Readonly<{ dentalFindingId: UUID; patientId: UUID }>
  ): Promise<boolean>;
}

export interface ClinicalMediaInspectionResult {
  readonly scanStatus: MediaScanStatus;
  readonly quarantineReason?: string | null;
  readonly objectVersion?: string | null;
  readonly dicomMetadata?: Readonly<Record<string, unknown>>;
}

/**
 * Server-authoritative malware/quarantine inspection. Public completion bodies never supply any of
 * these fields. Production composition must provide a real scanner or keep completion unavailable.
 */
export interface ClinicalMediaInspectionProvider {
  inspect(
    input: Readonly<{
      reservation: MediaUploadReservationRecord;
      object: StoredMediaObject;
      now: Date;
    }>
  ): Promise<ClinicalMediaInspectionResult>;
}

export interface ClinicalDentalHandlerDependencies {
  readonly relationshipAuthority?: ClinicalDentalRelationshipAuthority;
  readonly mediaStorage?: MediaStorageProvider;
  readonly mediaInspection?: ClinicalMediaInspectionProvider;
  /** Production factory: creates one provider bound to the already-open request transaction. */
  readonly transactionMediaProvider?: (
    request: ClinicFeatureOperationRequest<ClinicalDentalOperationId>,
    context: ClinicFeatureExecutionContext
  ) => MediaStorageProvider & ClinicalMediaInspectionProvider;
}
