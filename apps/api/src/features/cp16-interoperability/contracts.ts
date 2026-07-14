import type {
  AuthorizedEncounterMatchCandidate,
  AuthorizedPatientMatchCandidate,
  ClinicalSummaryDocumentArtifact,
  ClinicalSummaryRecipient,
  ClinicalSummarySourceSnapshot,
  FhirIdentifier,
  InteroperabilityAction,
  InteroperabilityConsentDecision,
  MinimizedClinicalSummaryImport,
  ClinicalSummaryImportMatchFailure
} from "@clinic-os/fhir";

export type InteroperabilityCapability =
  | "interoperability.fhir_r4.export"
  | "interoperability.fhir_r4.import"
  | "interoperability.fhir_r4.reconcile";

export interface AuthenticatedInteroperabilityContext {
  readonly actorDisplayName: string;
  readonly actorUserId: string;
  readonly capabilities: ReadonlySet<InteroperabilityCapability>;
  readonly clinicId: string;
  readonly tenantId: string;
  readonly verified: true;
}

export interface InteroperabilityClock {
  now(): Date;
}

export interface InteroperabilityConsentPort {
  /** Must query the shared authoritative consent model at evaluatedAt; cached grants are unsafe. */
  authorize(input: {
    readonly action: InteroperabilityAction;
    readonly context: AuthenticatedInteroperabilityContext;
    readonly evaluatedAt: string;
    readonly patientId: string;
    readonly recipient: ClinicalSummaryRecipient;
    readonly scope: "encounter_clinical_summary";
  }): Promise<InteroperabilityConsentDecision>;
}

export type ClinicalSummarySourceRead =
  | { readonly kind: "found"; readonly source: ClinicalSummarySourceSnapshot }
  | { readonly kind: "not_found" }
  | { readonly kind: "version_conflict"; readonly actualVersion: number };

export interface InteroperabilityClinicalSourcePort {
  loadClinicalSummary(input: {
    readonly context: AuthenticatedInteroperabilityContext;
    readonly encounterId: string;
    readonly expectedSourceVersion: number;
    readonly patientId: string;
  }): Promise<ClinicalSummarySourceRead>;
  findExactPatientMatches(input: {
    readonly context: AuthenticatedInteroperabilityContext;
    readonly identifiers: readonly FhirIdentifier[];
  }): Promise<readonly AuthorizedPatientMatchCandidate[]>;
  findExactEncounterMatches(input: {
    readonly context: AuthenticatedInteroperabilityContext;
    readonly identifier: FhirIdentifier;
    readonly patientId: string;
  }): Promise<readonly AuthorizedEncounterMatchCandidate[]>;
}

export interface InteroperabilityExportResult {
  readonly artifact: ClinicalSummaryDocumentArtifact;
  readonly exchangeId: string;
  readonly replayed: boolean;
  readonly status: "completed";
}

export interface InteroperabilityImportResult {
  readonly bundleDigest: string;
  readonly candidateCount: number;
  readonly encounterId: string;
  readonly patientId: string;
  readonly quarantineReason: ClinicalSummaryImportMatchFailure | null;
  readonly reconciliationId: string;
  readonly reconciliationVersion: number;
  readonly replayed: boolean;
  readonly status: "pending_review" | "quarantined";
}

export interface InteroperabilityReviewResult {
  /**
   * Effects committed with the review decision. `applied` is valid only when all three
   * durable effects are true. A pending acceptance or rejection still records audit/outbox.
   */
  readonly effects: {
    readonly auditAppended: boolean;
    readonly clinicalStateApplied: boolean;
    readonly outboxAppended: boolean;
    readonly patientMerged: false;
  };
  readonly encounterId: string;
  readonly patientId: string;
  readonly reconciliationId: string;
  readonly reconciliationVersion: number;
  readonly status: "accepted_pending_apply" | "applied" | "rejected";
}

export type InteroperabilityExportClaim =
  | { readonly outcome: "claimed"; readonly exchangeId: string }
  | { readonly outcome: "conflict" }
  | { readonly outcome: "in_progress" }
  | { readonly outcome: "replay"; readonly result: InteroperabilityExportResult };

export type InteroperabilityImportClaim =
  | { readonly outcome: "claimed"; readonly reconciliationId: string }
  | { readonly outcome: "conflict" }
  | { readonly outcome: "in_progress" }
  | { readonly outcome: "replay"; readonly result: InteroperabilityImportResult };

export interface ImportReconciliationRecord {
  readonly encounterId: string;
  readonly expectedEncounterVersion: number;
  readonly expectedPatientVersion: number;
  readonly identifiers: readonly FhirIdentifier[];
  readonly minimized: MinimizedClinicalSummaryImport;
  readonly patientId: string;
  readonly reconciliationId: string;
  readonly reconciliationVersion: number;
  readonly status: "pending_review" | "quarantined";
}

export interface InteroperabilityReconciliationTransaction {
  claimExport(input: {
    readonly idempotencyKey: string;
    readonly requestDigest: string;
    readonly requestedAt: string;
  }): Promise<InteroperabilityExportClaim>;
  completeExport(input: {
    readonly exchangeId: string;
    readonly requiredAtomicEffects: readonly ["exchange", "audit", "outbox"];
    readonly requestDigest: string;
    readonly result: InteroperabilityExportResult;
  }): Promise<{
    readonly auditAppended: boolean;
    readonly exchangeStored: boolean;
    readonly outboxAppended: boolean;
  }>;
  claimImport(input: {
    readonly bundleDigest: string;
    readonly idempotencyKey: string;
    readonly requestDigest: string;
    readonly requestedAt: string;
  }): Promise<InteroperabilityImportClaim>;
  stageImport(input: {
    readonly encounterId: string;
    readonly expectedEncounterVersion: number;
    readonly expectedPatientVersion: number;
    readonly match:
      | {
          readonly kind: "matched";
          readonly encounterCandidate: AuthorizedEncounterMatchCandidate;
          readonly matchedEncounterIdentifier: FhirIdentifier;
          readonly matchedPatientIdentifiers: readonly FhirIdentifier[];
          readonly patientCandidate: AuthorizedPatientMatchCandidate;
        }
      | {
          readonly kind: "quarantine";
          readonly reason: ClinicalSummaryImportMatchFailure;
          readonly candidateCount: number;
        };
    readonly minimized: MinimizedClinicalSummaryImport;
    readonly patientId: string;
    readonly reconciliationId: string;
    readonly requiredAtomicEffects: readonly ["reconciliation", "audit", "outbox"];
    readonly result: InteroperabilityImportResult;
  }): Promise<{
    readonly auditAppended: boolean;
    readonly outboxAppended: boolean;
    readonly reconciliationStaged: boolean;
  }>;
  completeImportReview(input: {
    readonly application:
      | {
          /**
           * The durable adapter must apply only this minimized allowlist to the already matched
           * patient/encounter, conditionally advance both versions, append audit and append outbox
           * in this same transaction. Patient/encounter identifiers are immutable: the transaction
           * must never merge, create or relink either identity.
           */
          readonly mode: "apply_minimized";
          readonly encounterId: string;
          readonly minimized: MinimizedClinicalSummaryImport;
          readonly patientId: string;
          readonly requiredAtomicEffects: readonly ["clinical_state", "audit", "outbox"];
        }
      | {
          readonly encounterId: string;
          readonly mode: "reject_only";
          readonly patientId: string;
        };
    readonly actorUserId: string;
    readonly decision: "accept" | "reject";
    readonly expectedEncounterVersion: number;
    readonly expectedPatientVersion: number;
    readonly expectedReconciliationVersion: number;
    readonly reason: string;
    readonly reconciliationId: string;
    readonly reviewedAt: string;
  }): Promise<
    | { readonly outcome: "completed"; readonly result: InteroperabilityReviewResult }
    | { readonly outcome: "not_found" }
    | { readonly outcome: "patient_version_conflict" }
    | { readonly outcome: "reconciliation_version_conflict" }
    | { readonly outcome: "state_conflict" }
  >;
}

export interface InteroperabilityDurableReconciliationPort {
  readonly durability: "durable_transactional" | "in_memory_test_double";
  readiness(): Promise<
    | { readonly status: "available" }
    | { readonly status: "unavailable"; readonly retryable: boolean }
  >;
  loadImportForReview(input: {
    readonly context: AuthenticatedInteroperabilityContext;
    readonly reconciliationId: string;
  }): Promise<ImportReconciliationRecord | null>;
  transaction<T>(
    context: AuthenticatedInteroperabilityContext,
    execute: (transaction: InteroperabilityReconciliationTransaction) => Promise<T>
  ): Promise<T>;
  recordFailure(input: {
    readonly action: InteroperabilityAction;
    readonly clinicId: string;
    readonly failureCode: string;
    readonly occurredAt: string;
    readonly requestId: string;
    readonly retryable: boolean;
    readonly scope: InteroperabilityFailureScope;
    readonly tenantId: string;
  }): Promise<void>;
}

export type InteroperabilityFailureScope =
  | { readonly kind: "patient"; readonly patientId: string }
  | {
      /** No patient UUID has been validated; this must not be stored as patient-scoped evidence. */
      readonly kind: "unscoped";
      readonly subject: "patient_request" | "reconciliation_request";
    };

export interface ExportClinicalSummaryCommand {
  readonly context: AuthenticatedInteroperabilityContext;
  readonly encounterId: string;
  readonly expectedSourceVersion: number;
  readonly idempotencyKey: string;
  readonly patientId: string;
  readonly recipient: ClinicalSummaryRecipient;
  readonly requestId: string;
}

export interface ImportClinicalSummaryCommand {
  readonly context: AuthenticatedInteroperabilityContext;
  readonly expectedPatientVersion: number;
  readonly idempotencyKey: string;
  readonly patientId: string;
  readonly rawBody: Uint8Array;
  readonly requestId: string;
}

export interface ReviewClinicalSummaryImportCommand {
  readonly context: AuthenticatedInteroperabilityContext;
  readonly decision: "accept" | "reject";
  readonly expectedReconciliationVersion: number;
  readonly reason: string;
  readonly reconciliationId: string;
  readonly requestId: string;
}
