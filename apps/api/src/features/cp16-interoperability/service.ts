import {
  assertClinicalSummaryAuthorizedScope,
  assertConsentAllows,
  buildClinicalSummaryDocument,
  ClinicOsFhirError,
  decideExactAuthorizedEncounterMatch,
  decideExactAuthorizedPatientMatch,
  digestClinicOsJson,
  minimizeClinicalSummaryImport,
  parseClinicalSummaryDocument,
  validateClinicalSummaryDocument,
  type ClinicalSummaryRecipient,
  type ClinicalSummaryImportMatchFailure,
  type ExactEncounterMatchDecision,
  type ExactPatientMatchDecision,
  type AuthorizedEncounterMatchCandidate,
  type AuthorizedPatientMatchCandidate,
  type FhirIdentifier,
  type InteroperabilityAction
} from "@clinic-os/fhir";
import type {
  AuthenticatedInteroperabilityContext,
  ExportClinicalSummaryCommand,
  ImportClinicalSummaryCommand,
  InteroperabilityCapability,
  InteroperabilityClinicalSourcePort,
  InteroperabilityClock,
  InteroperabilityConsentPort,
  InteroperabilityDurableReconciliationPort,
  InteroperabilityExportResult,
  InteroperabilityFailureScope,
  InteroperabilityImportResult,
  InteroperabilityReviewResult,
  ReviewClinicalSummaryImportCommand
} from "./contracts.ts";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export class InteroperabilityExchangeService {
  private readonly dependencies: {
    readonly clock: InteroperabilityClock;
    readonly consent: InteroperabilityConsentPort;
    readonly reconciliation: InteroperabilityDurableReconciliationPort;
    readonly source: InteroperabilityClinicalSourcePort;
    readonly testOnlyAllowInMemoryReconciliation?: true;
  };

  constructor(dependencies: {
    readonly clock: InteroperabilityClock;
    readonly consent: InteroperabilityConsentPort;
    readonly reconciliation: InteroperabilityDurableReconciliationPort;
    readonly source: InteroperabilityClinicalSourcePort;
    readonly testOnlyAllowInMemoryReconciliation?: true;
  }) {
    this.dependencies = dependencies;
  }

  async exportClinicalSummary(
    command: ExportClinicalSummaryCommand
  ): Promise<InteroperabilityExportResult> {
    return this.withFailureEvidence(
      "clinical_summary_export",
      command,
      () => failureScopeForPatient(command.patientId),
      async () => {
        assertCapability(command.context, "interoperability.fhir_r4.export");
        await assertAvailable(
          this.dependencies.reconciliation,
          this.dependencies.testOnlyAllowInMemoryReconciliation
        );
        validateCommon(command);
        positiveVersion(command.expectedSourceVersion, "expectedSourceVersion");
        validateRecipient(command.recipient);
        const generatedAt = nowIso(this.dependencies.clock);
        const sourceRead = await this.dependencies.source.loadClinicalSummary({
          context: command.context,
          encounterId: command.encounterId,
          expectedSourceVersion: command.expectedSourceVersion,
          patientId: command.patientId
        });
        if (sourceRead.kind === "not_found") {
          throw failure(
            404,
            "FHIR_CLINICAL_SUMMARY_NOT_FOUND",
            "not-found",
            "No authorized clinical summary source was found.",
            "Encounter"
          );
        }
        if (sourceRead.kind === "version_conflict") {
          throw failure(
            409,
            "FHIR_SOURCE_VERSION_CONFLICT",
            "conflict",
            "The clinical source changed; reload it and retry with its current version.",
            "Encounter.meta.versionId"
          );
        }
        if (sourceRead.source.sourceVersion !== command.expectedSourceVersion) {
          throw failure(
            409,
            "FHIR_SOURCE_VERSION_CONFLICT",
            "conflict",
            "The source port returned a snapshot that does not match the conditional version.",
            "source.sourceVersion"
          );
        }
        const authorization = await this.dependencies.consent.authorize({
          action: "clinical_summary_export",
          context: command.context,
          evaluatedAt: generatedAt,
          patientId: command.patientId,
          recipient: command.recipient,
          scope: "encounter_clinical_summary"
        });
        assertConsentAllows(authorization, {
          action: "clinical_summary_export",
          tenantId: command.context.tenantId,
          clinicId: command.context.clinicId,
          patientId: command.patientId,
          evaluatedAt: generatedAt
        });
        const requestDigest = digestClinicOsJson({
          operation: "clinical_summary_export",
          tenantId: command.context.tenantId,
          clinicId: command.context.clinicId,
          actorUserId: command.context.actorUserId,
          patientId: command.patientId,
          encounterId: command.encounterId,
          expectedSourceVersion: command.expectedSourceVersion,
          recipient: command.recipient
        }).value;
        return this.dependencies.reconciliation.transaction(
          command.context,
          async (transaction) => {
            const claim = await transaction.claimExport({
              idempotencyKey: command.idempotencyKey,
              requestDigest,
              requestedAt: generatedAt
            });
            if (claim.outcome === "replay") return { ...claim.result, replayed: true };
            if (claim.outcome === "in_progress") {
              throw failure(
                409,
                "FHIR_EXPORT_IN_PROGRESS",
                "transient",
                "An identical export is already in progress.",
                "Idempotency-Key",
                true
              );
            }
            if (claim.outcome === "conflict") {
              throw failure(
                409,
                "FHIR_IDEMPOTENCY_CONFLICT",
                "conflict",
                "The idempotency key was already used with a different export request.",
                "Idempotency-Key"
              );
            }
            const artifact = buildClinicalSummaryDocument({
              actor: {
                userId: command.context.actorUserId,
                displayName: command.context.actorDisplayName
              },
              bundleId: claim.exchangeId,
              consent: authorization,
              generatedAt,
              source: sourceRead.source
            });
            const validation = validateClinicalSummaryDocument(artifact.bundle);
            if (!validation.valid) {
              throw failure(
                500,
                "FHIR_GENERATED_DOCUMENT_INVALID",
                "processing",
                "The generated document failed the local deterministic validation gate.",
                "Bundle",
                false
              );
            }
            const result: InteroperabilityExportResult = {
              artifact,
              exchangeId: claim.exchangeId,
              replayed: false,
              status: "completed"
            };
            const effects = await transaction.completeExport({
              exchangeId: claim.exchangeId,
              requiredAtomicEffects: ["exchange", "audit", "outbox"],
              requestDigest,
              result
            });
            if (!effects.exchangeStored || !effects.auditAppended || !effects.outboxAppended) {
              throw invalidDurableEffects("export");
            }
            return result;
          }
        );
      }
    );
  }

  async importClinicalSummary(
    command: ImportClinicalSummaryCommand
  ): Promise<InteroperabilityImportResult> {
    return this.withFailureEvidence(
      "clinical_summary_import",
      command,
      () => failureScopeForPatient(command.patientId),
      async () => {
        assertCapability(command.context, "interoperability.fhir_r4.import");
        await assertAvailable(
          this.dependencies.reconciliation,
          this.dependencies.testOnlyAllowInMemoryReconciliation
        );
        validateCommon(command);
        positiveVersion(command.expectedPatientVersion, "expectedPatientVersion");
        const evaluatedAt = nowIso(this.dependencies.clock);
        const bundle = parseClinicalSummaryDocument(command.rawBody);
        assertClinicalSummaryAuthorizedScope(bundle, {
          tenantId: command.context.tenantId,
          clinicId: command.context.clinicId,
          patientId: command.patientId
        });
        const minimized = minimizeClinicalSummaryImport(bundle);
        const recipient = localRecipient(command.context);
        const authorization = await this.dependencies.consent.authorize({
          action: "clinical_summary_import",
          context: command.context,
          evaluatedAt,
          patientId: command.patientId,
          recipient,
          scope: "encounter_clinical_summary"
        });
        assertConsentAllows(authorization, {
          action: "clinical_summary_import",
          tenantId: command.context.tenantId,
          clinicId: command.context.clinicId,
          patientId: command.patientId,
          evaluatedAt
        });
        const candidates = await this.dependencies.source.findExactPatientMatches({
          context: command.context,
          identifiers: minimized.patientIdentifiers
        });
        const patientMatch = decideExactAuthorizedPatientMatch({
          candidates,
          expectedPatientVersion: command.expectedPatientVersion,
          identifiers: minimized.patientIdentifiers,
          scope: {
            tenantId: command.context.tenantId,
            clinicId: command.context.clinicId,
            patientId: command.patientId
          }
        });
        const encounterCandidates = await this.dependencies.source.findExactEncounterMatches({
          context: command.context,
          identifier: minimized.encounter.identifier,
          patientId: command.patientId
        });
        const encounterMatch = decideExactAuthorizedEncounterMatch({
          candidates: encounterCandidates,
          expectedEncounterVersion: minimized.encounter.version,
          identifier: minimized.encounter.identifier,
          scope: {
            tenantId: command.context.tenantId,
            clinicId: command.context.clinicId,
            patientId: command.patientId
          }
        });
        const match = combinedImportMatch(patientMatch, encounterMatch);
        const requestDigest = digestClinicOsJson({
          operation: "clinical_summary_import",
          tenantId: command.context.tenantId,
          clinicId: command.context.clinicId,
          actorUserId: command.context.actorUserId,
          patientId: command.patientId,
          expectedPatientVersion: command.expectedPatientVersion,
          bundleDigest: minimized.bundleDigest.value
        }).value;
        return this.dependencies.reconciliation.transaction(
          command.context,
          async (transaction) => {
            const claim = await transaction.claimImport({
              bundleDigest: minimized.bundleDigest.value,
              idempotencyKey: command.idempotencyKey,
              requestDigest,
              requestedAt: evaluatedAt
            });
            if (claim.outcome === "replay") return { ...claim.result, replayed: true };
            if (claim.outcome === "in_progress") {
              throw failure(
                409,
                "FHIR_IMPORT_IN_PROGRESS",
                "transient",
                "An identical import is already being staged.",
                "Idempotency-Key",
                true
              );
            }
            if (claim.outcome === "conflict") {
              throw failure(
                409,
                "FHIR_IDEMPOTENCY_CONFLICT",
                "conflict",
                "The idempotency key was already used with a different import document.",
                "Idempotency-Key"
              );
            }
            const result: InteroperabilityImportResult = {
              bundleDigest: minimized.bundleDigest.value,
              candidateCount: match.kind === "matched" ? 1 : match.candidateCount,
              encounterId: minimized.encounter.id,
              patientId: command.patientId,
              quarantineReason: match.kind === "quarantine" ? match.reason : null,
              reconciliationId: claim.reconciliationId,
              reconciliationVersion: 1,
              replayed: false,
              status: match.kind === "matched" ? "pending_review" : "quarantined"
            };
            const effects = await transaction.stageImport({
              encounterId: minimized.encounter.id,
              expectedEncounterVersion: minimized.encounter.version,
              expectedPatientVersion: command.expectedPatientVersion,
              match,
              minimized,
              patientId: command.patientId,
              reconciliationId: claim.reconciliationId,
              requiredAtomicEffects: ["reconciliation", "audit", "outbox"],
              result
            });
            if (
              !effects.reconciliationStaged ||
              !effects.auditAppended ||
              !effects.outboxAppended
            ) {
              throw invalidDurableEffects("import staging");
            }
            return result;
          }
        );
      }
    );
  }

  async reviewClinicalSummaryImport(
    command: ReviewClinicalSummaryImportCommand
  ): Promise<InteroperabilityReviewResult> {
    let failureScope: InteroperabilityFailureScope = {
      kind: "unscoped",
      subject: "reconciliation_request"
    };
    return this.withFailureEvidence(
      "clinical_summary_import",
      command,
      () => failureScope,
      async () => {
        assertCapability(command.context, "interoperability.fhir_r4.reconcile");
        await assertAvailable(
          this.dependencies.reconciliation,
          this.dependencies.testOnlyAllowInMemoryReconciliation
        );
        assertUuid(command.reconciliationId, "reconciliationId");
        positiveVersion(command.expectedReconciliationVersion, "expectedReconciliationVersion");
        requiredToken(command.requestId, "requestId", 128);
        const reason = requiredToken(command.reason, "reason", 500);
        const reviewedAt = nowIso(this.dependencies.clock);
        const record = await this.dependencies.reconciliation.loadImportForReview({
          context: command.context,
          reconciliationId: command.reconciliationId
        });
        if (!record) {
          throw failure(
            404,
            "FHIR_RECONCILIATION_NOT_FOUND",
            "not-found",
            "No scoped import reconciliation was found.",
            "reconciliationId"
          );
        }
        assertUuid(record.patientId, "reconciliation.patientId");
        assertUuid(record.encounterId, "reconciliation.encounterId");
        positiveVersion(record.expectedPatientVersion, "reconciliation.expectedPatientVersion");
        positiveVersion(record.expectedEncounterVersion, "reconciliation.expectedEncounterVersion");
        failureScope = { kind: "patient", patientId: record.patientId };
        if (command.decision === "accept") {
          if (record.status !== "pending_review") {
            throw failure(
              409,
              "FHIR_RECONCILIATION_STATE_CONFLICT",
              "conflict",
              "Only an exact-match pending reconciliation can be accepted.",
              "reconciliation.status"
            );
          }
          const recipient = localRecipient(command.context);
          const authorization = await this.dependencies.consent.authorize({
            action: "clinical_summary_import",
            context: command.context,
            evaluatedAt: reviewedAt,
            patientId: record.patientId,
            recipient,
            scope: "encounter_clinical_summary"
          });
          assertConsentAllows(authorization, {
            action: "clinical_summary_import",
            tenantId: command.context.tenantId,
            clinicId: command.context.clinicId,
            patientId: record.patientId,
            evaluatedAt: reviewedAt
          });
          const candidates = await this.dependencies.source.findExactPatientMatches({
            context: command.context,
            identifiers: record.identifiers
          });
          const patientMatch = decideExactAuthorizedPatientMatch({
            candidates,
            expectedPatientVersion: record.expectedPatientVersion,
            identifiers: record.identifiers,
            scope: {
              tenantId: command.context.tenantId,
              clinicId: command.context.clinicId,
              patientId: record.patientId
            }
          });
          const encounterCandidates = await this.dependencies.source.findExactEncounterMatches({
            context: command.context,
            identifier: record.minimized.encounter.identifier,
            patientId: record.patientId
          });
          const encounterMatch = decideExactAuthorizedEncounterMatch({
            candidates: encounterCandidates,
            expectedEncounterVersion: record.expectedEncounterVersion,
            identifier: record.minimized.encounter.identifier,
            scope: {
              tenantId: command.context.tenantId,
              clinicId: command.context.clinicId,
              patientId: record.patientId
            }
          });
          if (patientMatch.kind !== "matched" || encounterMatch.kind !== "matched") {
            throw failure(
              409,
              "FHIR_PATIENT_MATCH_CHANGED",
              "conflict",
              "Exact patient or encounter identity/version no longer matches; the import remains unapplied.",
              "Bundle.entry.resource.identifier"
            );
          }
        }
        return this.dependencies.reconciliation.transaction(
          command.context,
          async (transaction) => {
            const outcome = await transaction.completeImportReview({
              application:
                command.decision === "accept"
                  ? {
                      mode: "apply_minimized",
                      encounterId: record.encounterId,
                      minimized: record.minimized,
                      patientId: record.patientId,
                      requiredAtomicEffects: ["clinical_state", "audit", "outbox"]
                    }
                  : {
                      mode: "reject_only",
                      encounterId: record.encounterId,
                      patientId: record.patientId
                    },
              actorUserId: command.context.actorUserId,
              decision: command.decision,
              expectedEncounterVersion: record.expectedEncounterVersion,
              expectedPatientVersion: record.expectedPatientVersion,
              expectedReconciliationVersion: command.expectedReconciliationVersion,
              reason,
              reconciliationId: command.reconciliationId,
              reviewedAt
            });
            if (outcome.outcome === "completed") {
              assertReviewCompletion(outcome.result, command.decision, record);
              return outcome.result;
            }
            if (outcome.outcome === "not_found") {
              throw failure(
                404,
                "FHIR_RECONCILIATION_NOT_FOUND",
                "not-found",
                "No scoped import reconciliation was found.",
                "reconciliationId"
              );
            }
            throw failure(
              409,
              outcome.outcome === "patient_version_conflict"
                ? "FHIR_PATIENT_VERSION_CONFLICT"
                : outcome.outcome === "reconciliation_version_conflict"
                  ? "FHIR_RECONCILIATION_VERSION_CONFLICT"
                  : "FHIR_RECONCILIATION_STATE_CONFLICT",
              "conflict",
              "The reconciliation state or conditional version changed; reload before retrying.",
              "If-Match"
            );
          }
        );
      }
    );
  }

  private async withFailureEvidence<T>(
    action: InteroperabilityAction,
    command: {
      readonly context: AuthenticatedInteroperabilityContext;
      readonly requestId: string;
    },
    failureScope: () => InteroperabilityFailureScope,
    execute: () => Promise<T>
  ): Promise<T> {
    try {
      return await execute();
    } catch (error) {
      const failureCode =
        error instanceof ClinicOsFhirError
          ? (error.outcome.issue[0]?.details?.coding?.[0]?.code ?? "FHIR_INTEROPERABILITY_FAILED")
          : "FHIR_INTEROPERABILITY_FAILED";
      try {
        await this.dependencies.reconciliation.recordFailure({
          action,
          clinicId: command.context.clinicId,
          failureCode,
          occurredAt: nowIso(this.dependencies.clock),
          requestId: command.requestId,
          retryable: error instanceof ClinicOsFhirError ? error.retryable : true,
          scope: failureScope(),
          tenantId: command.context.tenantId
        });
      } catch {
        // The original safe failure remains authoritative when the failure-evidence store is down.
      }
      throw error;
    }
  }
}

function assertReviewCompletion(
  result: InteroperabilityReviewResult,
  decision: "accept" | "reject",
  record: {
    readonly encounterId: string;
    readonly patientId: string;
    readonly reconciliationId: string;
  }
): void {
  const invalidIdentity =
    result.encounterId !== record.encounterId ||
    result.patientId !== record.patientId ||
    result.reconciliationId !== record.reconciliationId ||
    !Number.isSafeInteger(result.reconciliationVersion) ||
    result.reconciliationVersion < 1;
  const missingDurableEvidence = !result.effects.auditAppended || !result.effects.outboxAppended;
  const invalidStatus =
    result.effects.patientMerged !== false ||
    (result.status === "applied" &&
      (decision !== "accept" || !result.effects.clinicalStateApplied || missingDurableEvidence)) ||
    (result.status === "accepted_pending_apply" &&
      (decision !== "accept" || result.effects.clinicalStateApplied || missingDurableEvidence)) ||
    (result.status === "rejected" &&
      (decision !== "reject" || result.effects.clinicalStateApplied || missingDurableEvidence));
  if (invalidIdentity || invalidStatus) {
    throw failure(
      500,
      "FHIR_RECONCILIATION_EFFECT_INVALID",
      "processing",
      "The durable review result did not prove the required identity, audit, outbox and application effects.",
      "reconciliation.effects"
    );
  }
}

function invalidDurableEffects(operation: string): ClinicOsFhirError {
  return failure(
    500,
    "FHIR_DURABLE_EFFECT_INVALID",
    "processing",
    `The ${operation} transaction did not prove state, audit and outbox effects.`,
    "reconciliation.effects"
  );
}

function combinedImportMatch(
  patient: ExactPatientMatchDecision,
  encounter: ExactEncounterMatchDecision
):
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
    } {
  if (patient.kind === "quarantine") return patient;
  if (encounter.kind === "quarantine") return encounter;
  return {
    kind: "matched",
    encounterCandidate: encounter.candidate,
    matchedEncounterIdentifier: encounter.matchedIdentifier,
    matchedPatientIdentifiers: patient.matchedIdentifiers,
    patientCandidate: patient.candidate
  };
}

function failureScopeForPatient(patientId: string): InteroperabilityFailureScope {
  return UUID_PATTERN.test(patientId)
    ? { kind: "patient", patientId }
    : { kind: "unscoped", subject: "patient_request" };
}

function assertCapability(
  context: AuthenticatedInteroperabilityContext,
  capability: InteroperabilityCapability
): void {
  if (context.verified !== true || !context.capabilities.has(capability)) {
    throw failure(
      403,
      "FHIR_CAPABILITY_FORBIDDEN",
      "forbidden",
      "The authenticated actor lacks the required interoperability capability.",
      "authorization"
    );
  }
}

async function assertAvailable(
  port: InteroperabilityDurableReconciliationPort,
  testOnlyAllowInMemoryReconciliation: true | undefined
): Promise<void> {
  if (port.durability !== "durable_transactional" && testOnlyAllowInMemoryReconciliation !== true) {
    throw failure(
      503,
      "FHIR_DURABLE_RECONCILIATION_REQUIRED",
      "not-supported",
      "A durable transactional interoperability reconciliation adapter is required.",
      "reconciliation",
      false
    );
  }
  const readiness = await port.readiness();
  if (readiness.status === "unavailable") {
    throw failure(
      503,
      "FHIR_RECONCILIATION_UNAVAILABLE",
      "transient",
      "Durable interoperability reconciliation is unavailable; no exchange effect was recorded.",
      "reconciliation",
      readiness.retryable
    );
  }
}

function validateCommon(command: {
  readonly context: AuthenticatedInteroperabilityContext;
  readonly idempotencyKey: string;
  readonly patientId: string;
  readonly requestId: string;
}): void {
  assertUuid(command.context.tenantId, "context.tenantId");
  assertUuid(command.context.clinicId, "context.clinicId");
  assertUuid(command.context.actorUserId, "context.actorUserId");
  assertUuid(command.patientId, "patientId");
  requiredToken(command.idempotencyKey, "Idempotency-Key", 128, 16);
  requiredToken(command.requestId, "requestId", 128);
}

function validateRecipient(recipient: ClinicalSummaryRecipient): void {
  if (!(["authorized_organization", "authorized_system"] as const).includes(recipient.type)) {
    throw failure(
      422,
      "FHIR_RECIPIENT_INVALID",
      "value",
      "Recipient type is unsupported.",
      "recipient.type"
    );
  }
  requiredToken(recipient.identifier, "recipient.identifier", 200, 8);
}

function localRecipient(context: AuthenticatedInteroperabilityContext): ClinicalSummaryRecipient {
  return {
    type: "authorized_system",
    identifier: `clinicos:${context.tenantId}:${context.clinicId}`
  };
}

function positiveVersion(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw failure(
      428,
      "FHIR_CONDITIONAL_VERSION_REQUIRED",
      "required",
      `${field} must be a positive safe integer from If-Match.`,
      field
    );
  }
}

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw failure(422, "FHIR_IDENTIFIER_INVALID", "value", `${field} must be a UUID.`, field);
  }
}

function requiredToken(value: string, field: string, maximum: number, minimum = 1): string {
  const normalized = value.trim();
  if (
    normalized.length < minimum ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    throw failure(
      422,
      "FHIR_INPUT_INVALID",
      "value",
      `${field} must contain ${minimum}-${maximum} safe characters.`,
      field
    );
  }
  return normalized;
}

function nowIso(clock: InteroperabilityClock): string {
  const now = clock.now();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Interoperability clock returned an invalid Date.");
  }
  return now.toISOString();
}

function failure(
  httpStatus: number,
  clinicOsCode: string,
  code: ConstructorParameters<typeof ClinicOsFhirError>[0]["issues"][number]["code"],
  diagnostics: string,
  expression: string,
  retryable = false
): ClinicOsFhirError {
  return new ClinicOsFhirError({
    httpStatus,
    retryable,
    issues: [{ clinicOsCode, code, diagnostics, expression: [expression] }]
  });
}
