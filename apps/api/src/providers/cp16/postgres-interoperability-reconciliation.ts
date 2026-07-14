import { randomUUID } from "node:crypto";
import { buildSetLocalRlsStatements, type SqlQueryClient } from "@clinic-os/db";
import { asUuid } from "@clinic-os/domain";
import {
  CLINIC_OS_CANONICALIZATION_VERSION,
  CLINIC_OS_INTEROPERABILITY_CAPABILITY_VERSION,
  digestClinicOsJson,
  type FhirIdentifier,
  type MinimizedClinicalSummaryImport,
  validateClinicalSummaryDocument
} from "@clinic-os/fhir";
import type {
  AuthenticatedInteroperabilityContext,
  ImportReconciliationRecord,
  InteroperabilityDurableReconciliationPort,
  InteroperabilityExportClaim,
  InteroperabilityExportResult,
  InteroperabilityFailureScope,
  InteroperabilityImportClaim,
  InteroperabilityImportResult,
  InteroperabilityReconciliationTransaction,
  InteroperabilityReviewResult
} from "../../features/cp16-interoperability/index.ts";
import {
  assertProtectedPayload,
  protectedPayloadFromDatabase,
  type Cp16ProtectedPayloadCodec
} from "./protected-payload.ts";
import {
  appendInteroperabilityEvidence,
  assertInteroperabilityContext,
  iso,
  positiveInteger,
  sha256,
  uuid,
  withInteroperabilityScope,
  type Cp16InteroperabilityUnitOfWork
} from "./postgres-interoperability-shared.ts";

const FHIR_EXPORT_MAX_CIPHERTEXT_BYTES = 8 * 1024 * 1024;
const FHIR_IMPORT_MAX_CIPHERTEXT_BYTES = 2 * 1024 * 1024;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

interface ExportRow extends Record<string, unknown> {
  readonly id: string;
  readonly patient_id: string;
  readonly encounter_id: string;
  readonly status: "completed" | "failed" | "in_progress";
  readonly request_digest: string;
  readonly bundle_digest: string | null;
  readonly bundle_ciphertext: Uint8Array | null;
  readonly bundle_encryption_key_ref: string | null;
  readonly bundle_encryption_algorithm: string | null;
  readonly payload_plaintext_digest: string | null;
  readonly lease_expires_at: string | Date | null;
}

interface ImportRow extends Record<string, unknown> {
  readonly id: string;
  readonly patient_id: string;
  readonly source_encounter_id: string;
  readonly encounter_id: string | null;
  readonly status:
    | "in_progress"
    | "pending_review"
    | "quarantined"
    | "accepted_pending_apply"
    | "applied"
    | "rejected"
    | "failed";
  readonly request_digest: string;
  readonly bundle_digest: string;
  readonly minimized_ciphertext: Uint8Array | null;
  readonly payload_encryption_key_ref: string | null;
  readonly payload_encryption_algorithm: string | null;
  readonly minimized_plaintext_digest: string | null;
  readonly expected_patient_version: string | number;
  readonly expected_encounter_version: string | number;
  readonly candidate_count: string | number | null;
  readonly quarantine_reason: InteroperabilityImportResult["quarantineReason"];
  readonly row_version: string | number;
  readonly lease_expires_at: string | Date | null;
}

interface VersionRow extends Record<string, unknown> {
  readonly row_version: string | number;
}

interface PendingExportClaim {
  readonly exchangeId: string;
  readonly idempotencyDigest: string;
  readonly requestDigest: string;
  readonly existing: boolean;
}

interface PendingImportClaim {
  readonly reconciliationId: string;
  readonly idempotencyDigest: string;
  readonly requestDigest: string;
  readonly bundleDigest: string;
  readonly existing: boolean;
  readonly requestedAt: string;
}

export class PostgresInteroperabilityReconciliation implements InteroperabilityDurableReconciliationPort {
  readonly durability = "durable_transactional" as const;
  readonly #unitOfWork: Cp16InteroperabilityUnitOfWork;
  readonly #payloads: Cp16ProtectedPayloadCodec;

  constructor(input: {
    readonly unitOfWork: Cp16InteroperabilityUnitOfWork;
    readonly payloads: Cp16ProtectedPayloadCodec;
  }) {
    this.#unitOfWork = input.unitOfWork;
    this.#payloads = input.payloads;
  }

  async readiness(): Promise<
    | { readonly status: "available" }
    | { readonly status: "unavailable"; readonly retryable: boolean }
  > {
    try {
      const available = await this.#unitOfWork.run(async ({ sqlClient }) => {
        if (!sqlClient) return false;
        const result = await sqlClient.query<{ readonly ready: boolean }>(
          `select to_regclass('public.cp16_fhir_exports') is not null
                  and to_regclass('public.cp16_fhir_import_reconciliations') is not null
                  and to_regclass('public.cp16_fhir_applied_summaries') is not null
                  and to_regclass('public.cp16_fhir_exchange_failures') is not null as ready`
        );
        return result.rows[0]?.ready === true;
      });
      return available ? { status: "available" } : { status: "unavailable", retryable: false };
    } catch {
      return { status: "unavailable", retryable: true };
    }
  }

  loadImportForReview(input: {
    readonly context: AuthenticatedInteroperabilityContext;
    readonly reconciliationId: string;
  }): Promise<ImportReconciliationRecord | null> {
    if (!uuid(input.reconciliationId)) {
      throw new Error("FHIR reconciliation identity is invalid.");
    }
    return withInteroperabilityScope(this.#unitOfWork, input.context, async (client) => {
      const result = await client.query<ImportRow>(
        `${importSelect()}
          where tenant_id = $1 and clinic_id = $2 and id = $3
            and status in ('pending_review','quarantined')`,
        [input.context.tenantId, input.context.clinicId, input.reconciliationId]
      );
      const row = result.rows[0];
      if (!row) return null;
      const minimized = await this.#revealMinimized(row, input.context);
      return {
        reconciliationId: row.id,
        reconciliationVersion: positiveInteger(row.row_version, "reconciliation row version"),
        patientId: row.patient_id,
        encounterId: row.source_encounter_id,
        expectedPatientVersion: positiveInteger(
          row.expected_patient_version,
          "expected patient version"
        ),
        expectedEncounterVersion: positiveInteger(
          row.expected_encounter_version,
          "expected encounter version"
        ),
        identifiers: minimized.patientIdentifiers,
        minimized,
        status: row.status as "pending_review" | "quarantined"
      };
    });
  }

  transaction<T>(
    context: AuthenticatedInteroperabilityContext,
    execute: (transaction: InteroperabilityReconciliationTransaction) => Promise<T>
  ): Promise<T> {
    return withInteroperabilityScope(this.#unitOfWork, context, (client) =>
      execute(
        new PostgresInteroperabilityReconciliationTransaction(client, context, this.#payloads)
      )
    );
  }

  async recordFailure(input: {
    readonly action: "clinical_summary_export" | "clinical_summary_import";
    readonly clinicId: string;
    readonly failureCode: string;
    readonly occurredAt: string;
    readonly requestId: string;
    readonly retryable: boolean;
    readonly scope: InteroperabilityFailureScope;
    readonly tenantId: string;
  }): Promise<void> {
    if (
      !uuid(input.tenantId) ||
      !uuid(input.clinicId) ||
      !/^[A-Z0-9_]{1,96}$/u.test(input.failureCode) ||
      (input.scope.kind === "patient" && !uuid(input.scope.patientId))
    ) {
      throw new Error("FHIR failure evidence is invalid.");
    }
    const occurredAt = iso(input.occurredAt, "failure occurrence time");
    await this.#unitOfWork.run(async ({ sqlClient }) => {
      if (!sqlClient) throw new Error("FHIR failure evidence requires transactional SQL.");
      for (const statement of buildSetLocalRlsStatements({
        tenantId: asUuid(input.tenantId, "FHIR failure tenantId"),
        clinicId: asUuid(input.clinicId, "FHIR failure clinicId")
      })) {
        await sqlClient.query(statement.sql, [...statement.values]);
      }
      await sqlClient.query(
        `insert into cp16_fhir_exchange_failures (
           tenant_id, clinic_id, patient_id, scope_kind, unscoped_subject, action,
           request_id_digest, failure_code, retryable, occurred_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz)`,
        [
          input.tenantId,
          input.clinicId,
          input.scope.kind === "patient" ? input.scope.patientId : null,
          input.scope.kind,
          input.scope.kind === "unscoped" ? input.scope.subject : null,
          input.action,
          sha256(input.requestId),
          input.failureCode,
          input.retryable,
          occurredAt
        ]
      );
    });
  }

  async #revealMinimized(
    row: ImportRow,
    context: AuthenticatedInteroperabilityContext
  ): Promise<MinimizedClinicalSummaryImport> {
    if (
      !row.minimized_ciphertext ||
      !row.payload_encryption_key_ref ||
      !row.payload_encryption_algorithm ||
      !row.minimized_plaintext_digest
    ) {
      throw new Error("FHIR minimized import payload is unavailable.");
    }
    const value = await this.#payloads.revealJson(
      protectedPayloadFromDatabase({
        ciphertext: row.minimized_ciphertext,
        keyReference: row.payload_encryption_key_ref,
        algorithm: row.payload_encryption_algorithm,
        plaintextDigest: row.minimized_plaintext_digest
      }),
      {
        tenantId: context.tenantId,
        clinicId: context.clinicId,
        patientId: row.patient_id,
        resourceType: "fhir_import_minimized",
        resourceId: row.id
      }
    );
    return assertMinimizedImport(value, row.bundle_digest, row.source_encounter_id);
  }
}

class PostgresInteroperabilityReconciliationTransaction implements InteroperabilityReconciliationTransaction {
  readonly #client: SqlQueryClient;
  readonly #context: AuthenticatedInteroperabilityContext;
  readonly #payloads: Cp16ProtectedPayloadCodec;
  #exportClaim: PendingExportClaim | null = null;
  #importClaim: PendingImportClaim | null = null;

  constructor(
    client: SqlQueryClient,
    context: AuthenticatedInteroperabilityContext,
    payloads: Cp16ProtectedPayloadCodec
  ) {
    assertInteroperabilityContext(context);
    this.#client = client;
    this.#context = context;
    this.#payloads = payloads;
  }

  async claimExport(input: {
    readonly idempotencyKey: string;
    readonly requestDigest: string;
    readonly requestedAt: string;
  }): Promise<InteroperabilityExportClaim> {
    const idempotencyDigest = claimInput(input);
    await advisoryLock(this.#client, this.#context, "export", idempotencyDigest);
    const result = await this.#client.query<ExportRow>(
      `${exportSelect()}
        where tenant_id = $1 and clinic_id = $2 and actor_user_id = $3
          and idempotency_key_digest = $4
        for update`,
      [this.#context.tenantId, this.#context.clinicId, this.#context.actorUserId, idempotencyDigest]
    );
    const row = result.rows[0];
    if (row) {
      if (row.request_digest !== input.requestDigest) return { outcome: "conflict" };
      if (row.status === "completed") {
        return { outcome: "replay", result: await this.#revealExport(row) };
      }
      if (row.status !== "in_progress" || activeLease(row.lease_expires_at, input.requestedAt)) {
        return { outcome: "in_progress" };
      }
      this.#exportClaim = {
        exchangeId: row.id,
        idempotencyDigest,
        requestDigest: input.requestDigest,
        existing: true
      };
      return { outcome: "claimed", exchangeId: row.id };
    }
    const exchangeId = randomUUID();
    this.#exportClaim = {
      exchangeId,
      idempotencyDigest,
      requestDigest: input.requestDigest,
      existing: false
    };
    return { outcome: "claimed", exchangeId };
  }

  async completeExport(input: {
    readonly exchangeId: string;
    readonly requiredAtomicEffects: readonly ["exchange", "audit", "outbox"];
    readonly requestDigest: string;
    readonly result: InteroperabilityExportResult;
  }): Promise<{
    readonly auditAppended: boolean;
    readonly exchangeStored: boolean;
    readonly outboxAppended: boolean;
  }> {
    const claim = this.#exportClaim;
    if (
      !claim ||
      claim.exchangeId !== input.exchangeId ||
      claim.requestDigest !== input.requestDigest ||
      input.result.exchangeId !== input.exchangeId ||
      input.result.status !== "completed"
    ) {
      throw new Error("FHIR export completion does not match its transaction claim.");
    }
    const identities = exportIdentities(input.result);
    const payload = assertProtectedPayload(
      await this.#payloads.protectJson(input.result, {
        tenantId: this.#context.tenantId,
        clinicId: this.#context.clinicId,
        patientId: identities.patientId,
        resourceType: "fhir_export",
        resourceId: input.exchangeId
      }),
      FHIR_EXPORT_MAX_CIPHERTEXT_BYTES
    );
    const values = [
      this.#context.tenantId,
      this.#context.clinicId,
      identities.patientId,
      identities.encounterId,
      this.#context.actorUserId,
      claim.idempotencyDigest,
      claim.requestDigest,
      input.result.artifact.digest.value,
      Buffer.from(payload.ciphertext),
      payload.keyReference,
      payload.algorithm,
      payload.plaintextDigest,
      input.result.artifact.generatedAt,
      input.exchangeId
    ];
    const stored = claim.existing
      ? await this.#client.query<{ readonly id: string }>(
          `update cp16_fhir_exports
              set patient_id=$3, encounter_id=$4, status='completed', bundle_digest=$8,
                  bundle_ciphertext=$9, bundle_encryption_key_ref=$10,
                  bundle_encryption_algorithm=$11, payload_plaintext_digest=$12,
                  completed_at=$13::timestamptz,
                  lease_expires_at=null
            where tenant_id=$1 and clinic_id=$2 and id=$14 and actor_user_id=$5
              and idempotency_key_digest=$6 and request_digest=$7 and status='in_progress'
            returning id`,
          values
        )
      : await this.#client.query<{ readonly id: string }>(
          `insert into cp16_fhir_exports (
             id, tenant_id, clinic_id, patient_id, encounter_id, actor_user_id, status,
             idempotency_key_digest, request_digest, bundle_digest, bundle_ciphertext,
             bundle_encryption_key_ref, bundle_encryption_algorithm, payload_plaintext_digest,
             completed_at
           ) values (
             $14,$1,$2,$3,$4,$5,'completed',$6,$7,$8,$9,$10,$11,$12,$13::timestamptz
           ) returning id`,
          values
        );
    if (stored.rows.length !== 1) throw new Error("FHIR export completion lost its claim.");
    const evidence = await appendInteroperabilityEvidence(this.#client, {
      context: this.#context,
      action: "fhir.clinical_summary.exported",
      eventType: "fhir.clinical_summary.exported",
      aggregateType: "cp16_fhir_export",
      aggregateId: input.exchangeId,
      patientId: identities.patientId,
      correlationId: input.exchangeId,
      idempotencyKey: `cp16:fhir:export:${input.exchangeId}`,
      occurredAt: input.result.artifact.generatedAt,
      metadata: {
        bundle_digest: input.result.artifact.digest.value,
        source_version: input.result.artifact.sourceVersion,
        consent_id: input.result.artifact.consentId
      }
    });
    return { exchangeStored: true, ...evidence };
  }

  async claimImport(input: {
    readonly bundleDigest: string;
    readonly idempotencyKey: string;
    readonly requestDigest: string;
    readonly requestedAt: string;
  }): Promise<InteroperabilityImportClaim> {
    const idempotencyDigest = claimInput(input);
    requireDigest(input.bundleDigest, "bundle digest");
    await advisoryLock(this.#client, this.#context, "import", idempotencyDigest);
    const result = await this.#client.query<ImportRow>(
      `${importSelect()}
        where tenant_id = $1 and clinic_id = $2 and actor_user_id = $3
          and idempotency_key_digest = $4
        for update`,
      [this.#context.tenantId, this.#context.clinicId, this.#context.actorUserId, idempotencyDigest]
    );
    const row = result.rows[0];
    if (row) {
      if (row.request_digest !== input.requestDigest || row.bundle_digest !== input.bundleDigest) {
        return { outcome: "conflict" };
      }
      if (row.status !== "in_progress" && row.status !== "failed") {
        return { outcome: "replay", result: importResult(row) };
      }
      if (row.status !== "in_progress" || activeLease(row.lease_expires_at, input.requestedAt)) {
        return { outcome: "in_progress" };
      }
      this.#importClaim = {
        reconciliationId: row.id,
        idempotencyDigest,
        requestDigest: input.requestDigest,
        bundleDigest: input.bundleDigest,
        existing: true,
        requestedAt: input.requestedAt
      };
      return { outcome: "claimed", reconciliationId: row.id };
    }
    const reconciliationId = randomUUID();
    this.#importClaim = {
      reconciliationId,
      idempotencyDigest,
      requestDigest: input.requestDigest,
      bundleDigest: input.bundleDigest,
      existing: false,
      requestedAt: input.requestedAt
    };
    return { outcome: "claimed", reconciliationId };
  }

  async stageImport(
    input: Parameters<InteroperabilityReconciliationTransaction["stageImport"]>[0]
  ) {
    const claim = this.#importClaim;
    if (
      !claim ||
      claim.reconciliationId !== input.reconciliationId ||
      input.result.reconciliationId !== input.reconciliationId ||
      input.result.bundleDigest !== claim.bundleDigest ||
      input.minimized.bundleDigest.value !== claim.bundleDigest ||
      input.result.patientId !== input.patientId ||
      input.result.encounterId !== input.encounterId ||
      input.result.reconciliationVersion !== 1
    ) {
      throw new Error("FHIR import staging does not match its transaction claim.");
    }
    const targetEncounterId =
      input.match.kind === "matched" ? input.match.encounterCandidate.encounterId : null;
    const payload = assertProtectedPayload(
      await this.#payloads.protectJson(input.minimized, {
        tenantId: this.#context.tenantId,
        clinicId: this.#context.clinicId,
        patientId: input.patientId,
        resourceType: "fhir_import_minimized",
        resourceId: input.reconciliationId
      }),
      FHIR_IMPORT_MAX_CIPHERTEXT_BYTES
    );
    const values = [
      this.#context.tenantId,
      this.#context.clinicId,
      input.patientId,
      input.encounterId,
      targetEncounterId,
      this.#context.actorUserId,
      input.result.status,
      claim.idempotencyDigest,
      claim.requestDigest,
      claim.bundleDigest,
      Buffer.from(payload.ciphertext),
      payload.keyReference,
      payload.algorithm,
      payload.plaintextDigest,
      input.expectedPatientVersion,
      input.expectedEncounterVersion,
      input.result.candidateCount,
      input.result.quarantineReason,
      input.reconciliationId
    ];
    const stored = claim.existing
      ? await this.#client.query<{ readonly id: string }>(
          `update cp16_fhir_import_reconciliations
              set patient_id=$3, source_encounter_id=$4, encounter_id=$5, status=$7,
                  minimized_ciphertext=$11, payload_encryption_key_ref=$12,
                  payload_encryption_algorithm=$13, minimized_plaintext_digest=$14,
                  expected_patient_version=$15, expected_encounter_version=$16,
                  candidate_count=$17, quarantine_reason=$18, lease_expires_at=null
            where tenant_id=$1 and clinic_id=$2 and id=$19 and actor_user_id=$6
              and idempotency_key_digest=$8 and request_digest=$9 and bundle_digest=$10
              and status='in_progress'
            returning id`,
          values
        )
      : await this.#client.query<{ readonly id: string }>(
          `insert into cp16_fhir_import_reconciliations (
             id, tenant_id, clinic_id, patient_id, source_encounter_id, encounter_id,
             actor_user_id, status, idempotency_key_digest, request_digest, bundle_digest,
             minimized_ciphertext, payload_encryption_key_ref, payload_encryption_algorithm,
             minimized_plaintext_digest,
             expected_patient_version, expected_encounter_version, candidate_count,
             quarantine_reason
           ) values (
             $19,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
           ) returning id`,
          values
        );
    if (stored.rows.length !== 1) throw new Error("FHIR import staging lost its claim.");
    const evidence = await appendInteroperabilityEvidence(this.#client, {
      context: this.#context,
      action: "fhir.clinical_summary.import_staged",
      eventType: "fhir.clinical_summary.import_staged",
      aggregateType: "cp16_fhir_import_reconciliation",
      aggregateId: input.reconciliationId,
      patientId: input.patientId,
      correlationId: input.reconciliationId,
      idempotencyKey: `cp16:fhir:import:${input.reconciliationId}`,
      occurredAt: claim.requestedAt,
      metadata: {
        bundle_digest: claim.bundleDigest,
        candidate_count: input.result.candidateCount,
        status: input.result.status,
        quarantine_reason: input.result.quarantineReason
      }
    });
    return { reconciliationStaged: true, ...evidence };
  }

  async completeImportReview(
    input: Parameters<InteroperabilityReconciliationTransaction["completeImportReview"]>[0]
  ): ReturnType<InteroperabilityReconciliationTransaction["completeImportReview"]> {
    if (
      !uuid(input.reconciliationId) ||
      input.actorUserId !== this.#context.actorUserId ||
      !input.reason.trim() ||
      input.reason.length > 500
    ) {
      throw new Error("FHIR review completion is invalid.");
    }
    const reviewedAt = iso(input.reviewedAt, "review time");
    const loaded = await this.#client.query<ImportRow>(
      `${importSelect()}
        where tenant_id=$1 and clinic_id=$2 and id=$3
        for update`,
      [this.#context.tenantId, this.#context.clinicId, input.reconciliationId]
    );
    const row = loaded.rows[0];
    if (!row) return { outcome: "not_found" };
    if (
      positiveInteger(row.row_version, "reconciliation row version") !==
      input.expectedReconciliationVersion
    ) {
      return { outcome: "reconciliation_version_conflict" };
    }
    if (row.status !== "pending_review" && row.status !== "quarantined") {
      return { outcome: "state_conflict" };
    }
    if (
      row.patient_id !== input.application.patientId ||
      row.source_encounter_id !== input.application.encounterId ||
      positiveInteger(row.expected_patient_version, "expected patient version") !==
        input.expectedPatientVersion ||
      positiveInteger(row.expected_encounter_version, "expected encounter version") !==
        input.expectedEncounterVersion
    ) {
      return { outcome: "state_conflict" };
    }
    if (input.decision === "accept") {
      if (
        row.status !== "pending_review" ||
        input.application.mode !== "apply_minimized" ||
        !row.encounter_id ||
        row.encounter_id !== input.application.encounterId
      ) {
        return { outcome: "state_conflict" };
      }
      const storedMinimized = await revealMinimized(this.#payloads, row, this.#context);
      if (
        digestClinicOsJson(storedMinimized).value !==
        digestClinicOsJson(input.application.minimized).value
      ) {
        throw new Error("FHIR review payload changed after staging.");
      }
      const [patient, encounter] = await Promise.all([
        this.#client.query<VersionRow>(
          `select row_version from patients
            where tenant_id=$1 and clinic_id=$2 and id=$3 for update`,
          [this.#context.tenantId, this.#context.clinicId, row.patient_id]
        ),
        this.#client.query<VersionRow>(
          `select row_version from encounters
            where tenant_id=$1 and clinic_id=$2 and id=$3 and patient_id=$4 for update`,
          [this.#context.tenantId, this.#context.clinicId, row.encounter_id, row.patient_id]
        )
      ]);
      const patientVersion = patient.rows[0]?.row_version;
      if (patientVersion === undefined) return { outcome: "patient_version_conflict" };
      if (positiveInteger(patientVersion, "patient row version") !== input.expectedPatientVersion) {
        return { outcome: "patient_version_conflict" };
      }
      const encounterVersion = encounter.rows[0]?.row_version;
      if (encounterVersion === undefined) return { outcome: "state_conflict" };
      if (
        positiveInteger(encounterVersion, "encounter row version") !==
        input.expectedEncounterVersion
      ) {
        return { outcome: "state_conflict" };
      }
      const patientAdvanced = await this.#client.query<{ readonly id: string }>(
        `update patients set row_version=row_version+1
          where tenant_id=$1 and clinic_id=$2 and id=$3 and row_version=$4
          returning id`,
        [
          this.#context.tenantId,
          this.#context.clinicId,
          row.patient_id,
          input.expectedPatientVersion
        ]
      );
      if (patientAdvanced.rows.length !== 1) return { outcome: "patient_version_conflict" };
      const encounterAdvanced = await this.#client.query<{ readonly id: string }>(
        `update encounters set row_version=row_version+1, updated_by_user_id=$5
          where tenant_id=$1 and clinic_id=$2 and id=$3 and row_version=$4
          returning id`,
        [
          this.#context.tenantId,
          this.#context.clinicId,
          row.encounter_id,
          input.expectedEncounterVersion,
          this.#context.actorUserId
        ]
      );
      if (encounterAdvanced.rows.length !== 1) return { outcome: "state_conflict" };
      await this.#client.query(
        `insert into cp16_fhir_applied_summaries (
           reconciliation_id, tenant_id, clinic_id, patient_id, encounter_id, bundle_digest,
           composition_id, composition_status, composition_date,
           source_medication_request_count, applied_by_user_id, applied_at
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10,$11,$12::timestamptz)`,
        [
          row.id,
          this.#context.tenantId,
          this.#context.clinicId,
          row.patient_id,
          row.encounter_id,
          row.bundle_digest,
          storedMinimized.composition.id,
          storedMinimized.composition.status,
          storedMinimized.composition.date,
          storedMinimized.medicationRequests.length,
          this.#context.actorUserId,
          reviewedAt
        ]
      );
    } else if (input.application.mode !== "reject_only") {
      return { outcome: "state_conflict" };
    }
    const status = input.decision === "accept" ? "applied" : "rejected";
    const updated = await this.#client.query<{ readonly row_version: string | number }>(
      `update cp16_fhir_import_reconciliations
          set status=$4, review_reason=$5, reviewed_by_user_id=$6,
              reviewed_at=$7::timestamptz, row_version=row_version+1
        where tenant_id=$1 and clinic_id=$2 and id=$3 and row_version=$8
        returning row_version`,
      [
        this.#context.tenantId,
        this.#context.clinicId,
        row.id,
        status,
        input.reason.trim(),
        this.#context.actorUserId,
        reviewedAt,
        input.expectedReconciliationVersion
      ]
    );
    if (updated.rows.length !== 1) return { outcome: "reconciliation_version_conflict" };
    const evidence = await appendInteroperabilityEvidence(this.#client, {
      context: this.#context,
      action:
        status === "applied" ? "fhir.clinical_summary.applied" : "fhir.clinical_summary.rejected",
      eventType:
        status === "applied" ? "fhir.clinical_summary.applied" : "fhir.clinical_summary.rejected",
      aggregateType: "cp16_fhir_import_reconciliation",
      aggregateId: row.id,
      patientId: row.patient_id,
      correlationId: row.id,
      idempotencyKey: `cp16:fhir:review:${row.id}:${input.expectedReconciliationVersion}`,
      occurredAt: reviewedAt,
      metadata: { bundle_digest: row.bundle_digest, status }
    });
    const result: InteroperabilityReviewResult = {
      effects: {
        ...evidence,
        clinicalStateApplied: status === "applied",
        patientMerged: false
      },
      encounterId: row.source_encounter_id,
      patientId: row.patient_id,
      reconciliationId: row.id,
      reconciliationVersion: positiveInteger(
        updated.rows[0]!.row_version,
        "updated reconciliation version"
      ),
      status
    };
    return { outcome: "completed", result };
  }

  async #revealExport(row: ExportRow): Promise<InteroperabilityExportResult> {
    if (
      !row.bundle_ciphertext ||
      !row.bundle_encryption_key_ref ||
      !row.bundle_encryption_algorithm ||
      !row.bundle_digest ||
      !row.payload_plaintext_digest
    ) {
      throw new Error("FHIR export replay payload is unavailable.");
    }
    const value = await this.#payloads.revealJson(
      protectedPayloadFromDatabase({
        ciphertext: row.bundle_ciphertext,
        keyReference: row.bundle_encryption_key_ref,
        algorithm: row.bundle_encryption_algorithm,
        plaintextDigest: row.payload_plaintext_digest
      }),
      {
        tenantId: this.#context.tenantId,
        clinicId: this.#context.clinicId,
        patientId: row.patient_id,
        resourceType: "fhir_export",
        resourceId: row.id
      }
    );
    return assertExportResult(value, row);
  }
}

async function revealMinimized(
  payloads: Cp16ProtectedPayloadCodec,
  row: ImportRow,
  context: AuthenticatedInteroperabilityContext
): Promise<MinimizedClinicalSummaryImport> {
  if (
    !row.minimized_ciphertext ||
    !row.payload_encryption_key_ref ||
    !row.payload_encryption_algorithm ||
    !row.minimized_plaintext_digest
  ) {
    throw new Error("FHIR minimized import payload is unavailable.");
  }
  const value = await payloads.revealJson(
    protectedPayloadFromDatabase({
      ciphertext: row.minimized_ciphertext,
      keyReference: row.payload_encryption_key_ref,
      algorithm: row.payload_encryption_algorithm,
      plaintextDigest: row.minimized_plaintext_digest
    }),
    {
      tenantId: context.tenantId,
      clinicId: context.clinicId,
      patientId: row.patient_id,
      resourceType: "fhir_import_minimized",
      resourceId: row.id
    }
  );
  return assertMinimizedImport(value, row.bundle_digest, row.source_encounter_id);
}

function exportSelect(): string {
  return `select id, patient_id, encounter_id, status, request_digest, bundle_digest,
                 bundle_ciphertext, bundle_encryption_key_ref, bundle_encryption_algorithm,
                 payload_plaintext_digest,
                 lease_expires_at
            from cp16_fhir_exports`;
}

function importSelect(): string {
  return `select id, patient_id, source_encounter_id, encounter_id, status, request_digest,
                 bundle_digest, minimized_ciphertext, payload_encryption_key_ref,
                 payload_encryption_algorithm, minimized_plaintext_digest,
                 expected_patient_version,
                 expected_encounter_version, candidate_count, quarantine_reason,
                 row_version, lease_expires_at
            from cp16_fhir_import_reconciliations`;
}

function claimInput(input: {
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly requestedAt: string;
}): string {
  if (!IDEMPOTENCY_KEY.test(input.idempotencyKey))
    throw new Error("FHIR idempotency key is invalid.");
  requireDigest(input.requestDigest, "request digest");
  iso(input.requestedAt, "request time");
  return sha256(input.idempotencyKey);
}

async function advisoryLock(
  client: SqlQueryClient,
  context: AuthenticatedInteroperabilityContext,
  operation: "export" | "import",
  idempotencyDigest: string
): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `cp16:fhir:${operation}:${context.tenantId}:${context.clinicId}:${context.actorUserId}:${idempotencyDigest}`
  ]);
}

function activeLease(value: string | Date | null, requestedAt: string): boolean {
  return (
    value !== null &&
    Date.parse(iso(value, "lease expiry")) > Date.parse(iso(requestedAt, "request time"))
  );
}

function exportIdentities(result: InteroperabilityExportResult): {
  readonly patientId: string;
  readonly encounterId: string;
} {
  const patient = result.artifact.bundle.entry.find(
    (entry) => entry.resource.resourceType === "Patient"
  )?.resource;
  const encounter = result.artifact.bundle.entry.find(
    (entry) => entry.resource.resourceType === "Encounter"
  )?.resource;
  if (
    patient?.resourceType !== "Patient" ||
    encounter?.resourceType !== "Encounter" ||
    !uuid(patient.id) ||
    !uuid(encounter.id)
  ) {
    throw new Error("FHIR export identities are invalid.");
  }
  return { patientId: patient.id, encounterId: encounter.id };
}

function importResult(row: ImportRow): InteroperabilityImportResult {
  const candidateCount = Number(row.candidate_count);
  if (!Number.isSafeInteger(candidateCount) || candidateCount < 0) {
    throw new Error("FHIR import replay candidate count is invalid.");
  }
  return {
    bundleDigest: row.bundle_digest,
    candidateCount,
    encounterId: row.source_encounter_id,
    patientId: row.patient_id,
    quarantineReason: row.quarantine_reason,
    reconciliationId: row.id,
    reconciliationVersion: 1,
    replayed: true,
    status: row.quarantine_reason ? "quarantined" : "pending_review"
  };
}

function assertExportResult(value: unknown, row: ExportRow): InteroperabilityExportResult {
  if (!record(value)) throw new Error("FHIR export replay result is invalid.");
  const result = value as unknown as InteroperabilityExportResult;
  if (
    result.status !== "completed" ||
    result.exchangeId !== row.id ||
    result.artifact?.capabilityVersion !== CLINIC_OS_INTEROPERABILITY_CAPABILITY_VERSION ||
    result.artifact?.digest?.algorithm !== "sha-256" ||
    result.artifact?.digest?.canonicalization !== CLINIC_OS_CANONICALIZATION_VERSION ||
    result.artifact?.digest?.value !== row.bundle_digest ||
    digestClinicOsJson(result.artifact?.bundle).value !== row.bundle_digest ||
    !positiveFhirVersion(result.artifact?.sourceVersion) ||
    !uuid(result.artifact?.consentId) ||
    typeof result.artifact?.generatedAt !== "string" ||
    !Number.isFinite(Date.parse(result.artifact.generatedAt)) ||
    !Array.isArray(result.artifact?.bundle?.entry)
  ) {
    throw new Error("FHIR export replay result is invalid.");
  }
  const validation = validateClinicalSummaryDocument(result.artifact.bundle);
  if (!validation.valid || !validation.bundle) {
    throw new Error("FHIR export replay document is invalid.");
  }
  const identities = exportIdentities(result);
  if (identities.patientId !== row.patient_id || identities.encounterId !== row.encounter_id) {
    throw new Error("FHIR export replay scope is invalid.");
  }
  return { ...result, replayed: true };
}

function assertMinimizedImport(
  value: unknown,
  expectedBundleDigest: string,
  expectedEncounterId: string
): MinimizedClinicalSummaryImport {
  if (
    !record(value) ||
    !exactKeys(value, [
      "bundleDigest",
      "bundleId",
      "composition",
      "encounter",
      "medicationRequests",
      "patientIdentifiers",
      "sourceDocumentReferenceIds"
    ]) ||
    !record(value.bundleDigest) ||
    !exactKeys(value.bundleDigest, ["algorithm", "canonicalization", "value"]) ||
    !record(value.composition) ||
    !exactKeys(value.composition, ["date", "id", "status", "title"]) ||
    !record(value.encounter) ||
    !exactKeys(value.encounter, ["id", "identifier", "version"])
  ) {
    throw new Error("FHIR minimized import payload is invalid.");
  }
  const digest = value.bundleDigest;
  const composition = value.composition;
  const encounter = value.encounter;
  if (
    digest.algorithm !== "sha-256" ||
    digest.canonicalization !== CLINIC_OS_CANONICALIZATION_VERSION ||
    digest.value !== expectedBundleDigest ||
    !bounded(value.bundleId, 64) ||
    encounter.id !== expectedEncounterId ||
    !uuid(encounter.id) ||
    !positiveFhirVersion(encounter.version) ||
    !identifier(encounter.identifier) ||
    !bounded(composition.id, 64) ||
    (composition.status !== "amended" && composition.status !== "final") ||
    !bounded(composition.title, 256) ||
    typeof composition.date !== "string" ||
    !Number.isFinite(Date.parse(composition.date)) ||
    !Array.isArray(value.patientIdentifiers) ||
    value.patientIdentifiers.length < 1 ||
    value.patientIdentifiers.length > 16 ||
    !value.patientIdentifiers.every(identifier) ||
    !Array.isArray(value.medicationRequests) ||
    value.medicationRequests.length > 128 ||
    !value.medicationRequests.every(minimizedMedication) ||
    !Array.isArray(value.sourceDocumentReferenceIds) ||
    value.sourceDocumentReferenceIds.length > 16 ||
    !value.sourceDocumentReferenceIds.every((item) => bounded(item, 64))
  ) {
    throw new Error("FHIR minimized import payload is invalid.");
  }
  return structuredClone(value) as unknown as MinimizedClinicalSummaryImport;
}

function minimizedMedication(value: unknown): boolean {
  return (
    record(value) &&
    exactKeys(value, [
      "authoredOn",
      "dosageText",
      "id",
      "medicationText",
      "prescriptionIdentifier"
    ]) &&
    bounded(value.id, 64) &&
    (value.authoredOn === null ||
      (typeof value.authoredOn === "string" && Number.isFinite(Date.parse(value.authoredOn)))) &&
    bounded(value.dosageText, 2_000, true) &&
    bounded(value.medicationText, 512) &&
    identifier(value.prescriptionIdentifier)
  );
}

function identifier(value: unknown): value is FhirIdentifier {
  return (
    record(value) &&
    exactOptionalKeys(value, ["value"], ["system"]) &&
    (value.system === undefined || bounded(value.system, 512)) &&
    bounded(value.value, 256)
  );
}

function positiveFhirVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function bounded(value: unknown, maximum: number, allowEmpty = false): value is string {
  return (
    typeof value === "string" && value.length <= maximum && (allowEmpty || value.trim().length > 0)
  );
}

function requireDigest(value: string, field: string): void {
  if (!SHA256.test(value)) throw new Error(`FHIR ${field} is invalid.`);
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function exactOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[]
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => key in value) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}
