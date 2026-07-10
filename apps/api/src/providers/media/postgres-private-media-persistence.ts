import { createHash, timingSafeEqual } from "node:crypto";
import type { SqlQueryClient, SqlQueryResult } from "@clinic-os/db";
/*
 * The root integration barrel export is master-owned. CP14 integration must export media/index.js
 * there before this adapter is wired; this lane owns only the media sub-barrel.
 */
import {
  privateMediaOperationSemanticFingerprint,
  privateMediaPersistenceWriteFingerprint,
  type PrivateMediaAtomicOperation,
  type PrivateMediaAtomicPersistence,
  type PrivateMediaRecord,
  type PrivateMediaScope,
  type PrivateMediaState,
  type SignedMalwareEvidence
} from "@clinic-os/integrations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface PostgresPrivateMediaTransactionContext {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly userId?: string | null;
}

export class PostgresPrivateMediaPersistenceError extends Error {
  readonly code: "invalid_contract" | "transaction_context_required" | "persistence_unavailable";
  readonly retryable: boolean;

  constructor(
    code: PostgresPrivateMediaPersistenceError["code"],
    message: string,
    retryable = false
  ) {
    super(message);
    this.name = "PostgresPrivateMediaPersistenceError";
    this.code = code;
    this.retryable = retryable;
  }
}

interface PrivateMediaRecordRow extends Record<string, unknown> {
  tenant_id: string;
  clinic_id: string;
  media_id: string;
  upload_id: string;
  revision: string | number;
  bucket: string;
  object_key: string;
  region: string;
  kind: PrivateMediaRecord["kind"];
  declared_mime_type: string;
  detected_mime_type: string | null;
  expected_bytes: string | number;
  expected_sha256_hex: string;
  authority_binding: string;
  state: PrivateMediaState;
  expires_at: string | Date;
  object_version_id: string | null;
  object_identity_sha256: string | null;
  scan_attempts: string | number;
  last_evidence_id: string | null;
  last_evidence_digest_sha256: string | null;
  last_scanned_at: string | Date | null;
  inspection_lease_id: string | null;
  inspection_lease_expires_at: string | Date | null;
  pending_operation_id: string | null;
  delete_marker_version_id: string | null;
  deleted_at: string | Date | null;
  recoverable_until: string | Date | null;
  legal_hold: boolean;
  created_at: string | Date;
  updated_at: string | Date;
}

interface OperationRow extends Record<string, unknown> {
  operation_id: string;
  operation_kind: string;
  tenant_id: string;
  clinic_id: string;
  media_id: string;
  upload_id: string;
  semantic_fingerprint_sha256: string;
  write_fingerprint_sha256: string;
}

interface EvidenceRow extends Record<string, unknown> {
  evidence_id: string;
  tenant_id: string;
  clinic_id: string;
  media_id: string;
  upload_id: string;
  evidence_digest_sha256: string;
}

interface CanonicalMediaUploadRow extends Record<string, unknown> {
  tenant_id: string;
  clinic_id: string;
  id: string;
  patient_id: string;
  media_type: PrivateMediaRecord["kind"];
  mime_type: string;
  expected_file_size_bytes: string | number;
  expected_sha256_digest: string | null;
  object_key: string;
  storage_provider: string;
  storage_region: string | null;
  status: string;
  expires_at: string | Date;
}

/**
 * The client must already be inside the caller's unit-of-work transaction. This adapter never
 * issues BEGIN, COMMIT, ROLLBACK, or SAVEPOINT; a failed SQL statement aborts the caller's unit.
 */
export class PostgresPrivateMediaAtomicPersistence implements PrivateMediaAtomicPersistence {
  readonly #client: SqlQueryClient;
  readonly #context: Required<PostgresPrivateMediaTransactionContext>;

  constructor(client: SqlQueryClient, context: PostgresPrivateMediaTransactionContext) {
    if (!UUID.test(context.tenantId) || !UUID.test(context.clinicId)) {
      throw invalidContract("Private media transaction scope is invalid.");
    }
    if (context.userId != null && context.userId !== "" && !UUID.test(context.userId)) {
      throw invalidContract("Private media transaction user context is invalid.");
    }
    this.#client = client;
    this.#context = {
      tenantId: context.tenantId,
      clinicId: context.clinicId,
      userId: context.userId ?? null
    };
  }

  async get(scope: PrivateMediaScope): Promise<PrivateMediaRecord | null> {
    this.#assertScope(scope);
    await this.#ensureTransactionRlsContext();
    const upload = await this.#loadCanonicalUpload(scope, false);
    const record = await this.#loadRecord(scope, false);
    if (!record) return null;
    assertCanonicalUploadMatchesRecord(upload, record);
    return record;
  }

  async reserve(
    input: Parameters<PrivateMediaAtomicPersistence["reserve"]>[0]
  ): ReturnType<PrivateMediaAtomicPersistence["reserve"]> {
    this.#assertRecord(input.record);
    this.#assertScope(input.record.scope);
    this.#assertOperation(input.operation, input.record.scope, null, input.record.revision);
    if (input.record.revision !== 1 || input.record.state !== "reserved") {
      throw invalidContract("Private media reservation state is invalid.");
    }
    const writeFingerprint = privateMediaPersistenceWriteFingerprint({
      kind: "reserve",
      operation: input.operation,
      scope: input.record.scope,
      expectedRevision: null,
      expectedStates: [],
      next: input.record
    });
    await this.#ensureTransactionRlsContext();
    await this.#lock(input.record.scope, [input.operation.operationId]);
    const upload = await this.#loadCanonicalUpload(input.record.scope, true);
    assertCanonicalUploadMatchesRecord(upload, input.record);
    const current = await this.#loadRecord(input.record.scope, true);
    if (current) assertCanonicalUploadMatchesRecord(upload, current);
    const replay = await this.#operationReplay(
      input.operation,
      "reserve",
      writeFingerprint,
      input.record.scope
    );
    if (replay) return replay;

    if (current) return "conflict";
    const inserted = await this.#query<Record<string, unknown>>(
      `/* private_media:insert_record */
       insert into private_media_records (
         tenant_id, clinic_id, media_id, upload_id, revision,
         bucket, object_key, region, kind, declared_mime_type, detected_mime_type,
         expected_bytes, expected_sha256_hex, authority_binding, state, expires_at,
         object_version_id, object_identity_sha256, scan_attempts,
         last_evidence_id, last_evidence_digest_sha256, last_scanned_at,
         inspection_lease_id, inspection_lease_expires_at, pending_operation_id,
         delete_marker_version_id, deleted_at, recoverable_until, legal_hold,
         created_at, updated_at
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5,
         $6, $7, $8, $9, $10, $11,
         $12, $13, $14, $15, $16::timestamptz,
         $17, $18, $19,
         $20, $21, $22::timestamptz,
         $23, $24::timestamptz, $25,
         $26, $27::timestamptz, $28::timestamptz, $29,
         $30::timestamptz, $31::timestamptz
       )
       returning revision`,
      recordValues(input.record)
    );
    if (inserted.rows.length !== 1) throw persistenceUnavailable();
    await this.#appendOperationEffects(
      input.operation,
      "reserve",
      writeFingerprint,
      upload.patient_id
    );
    return "applied";
  }

  async transition(
    input: Parameters<PrivateMediaAtomicPersistence["transition"]>[0]
  ): ReturnType<PrivateMediaAtomicPersistence["transition"]> {
    this.#assertTransitionInput(input);
    const writeFingerprint = privateMediaPersistenceWriteFingerprint({
      kind: "transition",
      operation: input.operation,
      scope: input.scope,
      expectedRevision: input.expectedRevision,
      expectedStates: input.expectedStates,
      next: input.next
    });
    await this.#ensureTransactionRlsContext();
    await this.#lock(input.scope, [input.operation.operationId]);
    const upload = await this.#loadCanonicalUpload(input.scope, true);
    const current = await this.#loadRecord(input.scope, true);
    if (current) assertCanonicalUploadMatchesRecord(upload, current);
    const replay = await this.#operationReplay(
      input.operation,
      "transition",
      writeFingerprint,
      input.scope
    );
    if (replay) return replay;

    if (
      !current ||
      current.revision !== input.expectedRevision ||
      !input.expectedStates.includes(current.state)
    ) {
      return "concurrent_change";
    }
    assertStaticRecordFields(current, input.next);
    assertCanonicalUploadMatchesRecord(upload, input.next);
    if (!(await this.#updateRecordCas(input.next, input.expectedRevision, input.expectedStates))) {
      return "concurrent_change";
    }
    await this.#appendOperationEffects(
      input.operation,
      "transition",
      writeFingerprint,
      upload.patient_id
    );
    return "applied";
  }

  async commitScanResult(
    input: Parameters<PrivateMediaAtomicPersistence["commitScanResult"]>[0]
  ): ReturnType<PrivateMediaAtomicPersistence["commitScanResult"]> {
    this.#assertScope(input.scope);
    this.#assertRecord(input.success.next);
    this.#assertRecord(input.evidenceConflict.next);
    this.#assertOperation(
      input.success.operation,
      input.scope,
      input.expectedRevision,
      input.success.next.revision
    );
    this.#assertOperation(
      input.evidenceConflict.operation,
      input.scope,
      input.expectedRevision,
      input.evidenceConflict.next.revision
    );
    if (
      input.expectedStates.length !== 1 ||
      input.expectedStates[0] !== "scan_in_progress" ||
      input.success.next.revision !== input.expectedRevision + 1 ||
      input.evidenceConflict.next.revision !== input.expectedRevision + 1 ||
      input.evidenceConflict.next.state !== "scan_failed"
    ) {
      throw invalidContract("Private media scan result revisions are invalid.");
    }
    this.#assertEvidence(input.evidence, input.scope);
    const successFingerprint = privateMediaPersistenceWriteFingerprint({
      kind: "scan_success",
      operation: input.success.operation,
      scope: input.scope,
      expectedRevision: input.expectedRevision,
      expectedStates: input.expectedStates,
      next: input.success.next,
      evidence: input.evidence
    });
    const conflictFingerprint = privateMediaPersistenceWriteFingerprint({
      kind: "scan_conflict",
      operation: input.evidenceConflict.operation,
      scope: input.scope,
      expectedRevision: input.expectedRevision,
      expectedStates: input.expectedStates,
      next: input.evidenceConflict.next,
      evidence: input.evidence
    });

    await this.#ensureTransactionRlsContext();
    await this.#lock(input.scope, [
      input.success.operation.operationId,
      input.evidenceConflict.operation.operationId,
      `evidence:${input.evidence.evidenceId}`
    ]);
    const upload = await this.#loadCanonicalUpload(input.scope, true);
    const current = await this.#loadRecord(input.scope, true);
    if (current) assertCanonicalUploadMatchesRecord(upload, current);
    const successReplay = await this.#operationReplay(
      input.success.operation,
      "scan_success",
      successFingerprint,
      input.scope
    );
    if (successReplay) return successReplay;
    const conflictReplay = await this.#operationReplay(
      input.evidenceConflict.operation,
      "scan_conflict",
      conflictFingerprint,
      input.scope
    );
    if (conflictReplay === "operation_conflict") return "operation_conflict";
    if (conflictReplay === "replayed") return "evidence_conflict";

    if (
      !current ||
      current.revision !== input.expectedRevision ||
      current.state !== "scan_in_progress"
    ) {
      return "concurrent_change";
    }
    assertCanonicalUploadMatchesRecord(upload, current);
    assertStaticRecordFields(current, input.success.next);
    assertStaticRecordFields(current, input.evidenceConflict.next);
    assertCanonicalUploadMatchesRecord(upload, input.success.next);
    assertCanonicalUploadMatchesRecord(upload, input.evidenceConflict.next);

    const existingEvidence = await this.#loadEvidence(input.scope, input.evidence.evidenceId);
    if (existingEvidence) {
      const sameEvidence =
        sameScopeRow(existingEvidence, input.scope) &&
        safeEqual(existingEvidence.evidence_digest_sha256, input.evidence.evidenceDigestSha256);
      if (sameEvidence) {
        throw invalidContract("Private media evidence exists without its atomic operation.");
      }
      if (
        !(await this.#updateRecordCas(
          input.evidenceConflict.next,
          input.expectedRevision,
          input.expectedStates
        ))
      ) {
        return "concurrent_change";
      }
      await this.#appendOperationEffects(
        input.evidenceConflict.operation,
        "scan_conflict",
        conflictFingerprint,
        upload.patient_id
      );
      return "evidence_conflict";
    }

    const evidenceInserted = await this.#query<Record<string, unknown>>(
      `/* private_media:insert_evidence */
       insert into private_media_scan_evidence (
         evidence_id, tenant_id, clinic_id, media_id, upload_id,
         evidence_digest_sha256, evidence, recorded_at
       ) values ($1, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::jsonb, $8::timestamptz)
       returning evidence_id`,
      [
        input.evidence.evidenceId,
        input.scope.tenantId,
        input.scope.clinicId,
        input.scope.mediaId,
        input.scope.uploadId,
        input.evidence.evidenceDigestSha256,
        JSON.stringify(input.evidence.evidence),
        input.evidence.recordedAt
      ]
    );
    if (evidenceInserted.rows.length !== 1) throw persistenceUnavailable();
    if (
      !(await this.#updateRecordCas(
        input.success.next,
        input.expectedRevision,
        input.expectedStates
      ))
    ) {
      throw invalidContract(
        "Private media evidence insertion lost its protected CAS; caller transaction must roll back."
      );
    }
    await this.#appendOperationEffects(
      input.success.operation,
      "scan_success",
      successFingerprint,
      upload.patient_id
    );
    return "applied";
  }

  async recordAuditAndIntent(
    operation: PrivateMediaAtomicOperation
  ): ReturnType<PrivateMediaAtomicPersistence["recordAuditAndIntent"]> {
    const scope = operation.reconciliationIntent.scope;
    this.#assertScope(scope);
    this.#assertOperation(operation, scope, null, null);
    const writeFingerprint = privateMediaPersistenceWriteFingerprint({
      kind: "audit",
      operation,
      scope,
      expectedRevision: null,
      expectedStates: []
    });
    await this.#ensureTransactionRlsContext();
    await this.#lock(scope, [operation.operationId]);
    const upload = await this.#loadCanonicalUpload(scope, true);
    const record = await this.#loadRecord(scope, true);
    if (!record) throw invalidContract("Private media audit is not bound to durable state.");
    assertCanonicalUploadMatchesRecord(upload, record);
    const replay = await this.#operationReplay(operation, "audit", writeFingerprint, scope);
    if (replay) return replay;
    await this.#appendOperationEffects(operation, "audit", writeFingerprint, upload.patient_id);
    return "applied";
  }

  async #ensureTransactionRlsContext(): Promise<void> {
    await this.#query(
      `/* private_media:set_rls */
       select
         set_config('app.tenant_id', $1, true),
         set_config('app.clinic_id', $2, true),
         set_config('app.user_id', $3, true)`,
      [this.#context.tenantId, this.#context.clinicId, this.#context.userId ?? ""]
    );
    const validation = await this.#query<{
      tenant_id: string | null;
      clinic_id: string | null;
      user_id: string | null;
    }>(
      `/* private_media:validate_rls */
       select
         nullif(current_setting('app.tenant_id', true), '') as tenant_id,
         nullif(current_setting('app.clinic_id', true), '') as clinic_id,
         nullif(current_setting('app.user_id', true), '') as user_id`
    );
    const row = validation.rows[0];
    if (
      row?.tenant_id !== this.#context.tenantId ||
      row.clinic_id !== this.#context.clinicId ||
      row.user_id !== this.#context.userId
    ) {
      throw new PostgresPrivateMediaPersistenceError(
        "transaction_context_required",
        "Private media persistence requires a caller-owned transaction with exact RLS scope."
      );
    }
  }

  async #lock(scope: PrivateMediaScope, identities: readonly string[]): Promise<void> {
    const resources = [
      `scope:${scope.tenantId}:${scope.clinicId}:${scope.mediaId}:${scope.uploadId}`,
      ...identities.map((identity) => `operation:${identity}`)
    ];
    await this.#query(
      `/* private_media:advisory_locks */
       select pg_advisory_xact_lock(hashtextextended(resource, 0))
       from unnest($1::text[]) as locks(resource)
       order by hashtextextended(resource, 0)`,
      [resources]
    );
  }

  async #operationReplay(
    operation: PrivateMediaAtomicOperation,
    operationKind: string,
    writeFingerprint: string,
    scope: PrivateMediaScope
  ): Promise<"replayed" | "operation_conflict" | null> {
    const result = await this.#query<OperationRow>(
      `/* private_media:load_operation */
       select operation_id, operation_kind, tenant_id, clinic_id, media_id, upload_id,
              semantic_fingerprint_sha256, write_fingerprint_sha256
       from private_media_operations
       where operation_id = $1
       for update`,
      [operation.operationId]
    );
    const existing = result.rows[0];
    if (!existing) return null;
    return existing.operation_kind === operationKind &&
      sameScopeRow(existing, scope) &&
      safeEqual(existing.semantic_fingerprint_sha256, operation.semanticFingerprintSha256) &&
      safeEqual(existing.write_fingerprint_sha256, writeFingerprint)
      ? "replayed"
      : "operation_conflict";
  }

  async #appendOperationEffects(
    operation: PrivateMediaAtomicOperation,
    operationKind: string,
    writeFingerprint: string,
    patientId: string
  ): Promise<void> {
    const scope = operation.reconciliationIntent.scope;
    const auditUuid = deterministicUuid(operation.audit.eventId);
    const actorType = this.#context.userId ? "user" : "system";
    const auditInserted = await this.#query<Record<string, unknown>>(
      `/* private_media:insert_audit */
       insert into audit_events (
         id, tenant_id, clinic_id, actor_type, actor_id, action, category, risk_level,
         phi_involved, resource_type, resource_id, patient_id, correlation_id, metadata, occurred_at
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4, $5, $6, 'clinical_media', 'high',
         true, 'private_media', $7, $8::uuid, $9, $10::jsonb, $11::timestamptz
       ) returning id`,
      [
        auditUuid,
        scope.tenantId,
        scope.clinicId,
        actorType,
        operation.audit.actorId,
        operation.audit.action,
        scope.mediaId,
        patientId,
        operation.audit.correlationId,
        JSON.stringify({
          ...operation.audit.metadata,
          privateMediaEventId: operation.audit.eventId,
          uploadId: scope.uploadId,
          outcome: operation.audit.outcome
        }),
        operation.audit.occurredAt
      ]
    );
    if (auditInserted.rows.length !== 1) throw persistenceUnavailable();

    const outboxUuid = deterministicUuid(operation.reconciliationIntent.intentId);
    const outboxPayload = {
      intentId: operation.reconciliationIntent.intentId,
      operationId: operation.operationId,
      kind: operation.reconciliationIntent.kind,
      mediaId: scope.mediaId,
      uploadId: scope.uploadId,
      expectedRevision: operation.reconciliationIntent.expectedRevision,
      targetRevision: operation.reconciliationIntent.targetRevision,
      payload: operation.reconciliationIntent.payload
    };
    if (containsForbiddenAuthority(outboxPayload) || JSON.stringify(outboxPayload).length > 8_192) {
      throw invalidContract("Private media outbox payload is unsafe.");
    }
    const outboxInserted = await this.#query<Record<string, unknown>>(
      `/* private_media:insert_outbox */
       insert into outbox_events (
         id, tenant_id, clinic_id, event_type, schema_version,
         actor_type, actor_id, aggregate_type, aggregate_id, patient_id,
         idempotency_key, correlation_id, payload, occurred_at
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4, '1.0',
         $5, $6, 'private_media', $7::uuid, $8::uuid,
         $9, $10, $11::jsonb, $12::timestamptz
       ) returning id`,
      [
        outboxUuid,
        scope.tenantId,
        scope.clinicId,
        `private_media.${operation.reconciliationIntent.kind}`,
        actorType,
        operation.audit.actorId,
        scope.mediaId,
        patientId,
        operation.reconciliationIntent.intentId,
        operation.audit.correlationId,
        JSON.stringify(outboxPayload),
        operation.reconciliationIntent.createdAt
      ]
    );
    if (outboxInserted.rows.length !== 1) throw persistenceUnavailable();

    const operationInserted = await this.#query<Record<string, unknown>>(
      `/* private_media:insert_operation */
       insert into private_media_operations (
         operation_id, operation_kind, tenant_id, clinic_id, media_id, upload_id,
         semantic_fingerprint_sha256, write_fingerprint_sha256,
         expected_revision, target_revision, audit_event_id, audit_event_uuid,
         intent_id, outbox_event_uuid, created_at
       ) values (
         $1, $2, $3::uuid, $4::uuid, $5::uuid, $6::uuid,
         $7, $8, $9, $10, $11, $12::uuid, $13, $14::uuid, $15::timestamptz
       ) returning operation_id`,
      [
        operation.operationId,
        operationKind,
        scope.tenantId,
        scope.clinicId,
        scope.mediaId,
        scope.uploadId,
        operation.semanticFingerprintSha256,
        writeFingerprint,
        operation.reconciliationIntent.expectedRevision,
        operation.reconciliationIntent.targetRevision,
        operation.audit.eventId,
        auditUuid,
        operation.reconciliationIntent.intentId,
        outboxUuid,
        operation.reconciliationIntent.createdAt
      ]
    );
    if (operationInserted.rows.length !== 1) throw persistenceUnavailable();
  }

  async #loadCanonicalUpload(
    scope: PrivateMediaScope,
    forUpdate: boolean
  ): Promise<CanonicalMediaUploadRow> {
    const result = await this.#query<CanonicalMediaUploadRow>(
      `/* private_media:load_canonical_upload */
       select tenant_id, clinic_id, id, patient_id, media_type, mime_type,
              expected_file_size_bytes, expected_sha256_digest,
              object_key, storage_provider, storage_region, status, expires_at
       from media_uploads
       where tenant_id = $1::uuid and clinic_id = $2::uuid and id = $3::uuid
       ${forUpdate ? "for update" : ""}`,
      [scope.tenantId, scope.clinicId, scope.uploadId]
    );
    const upload = result.rows[0];
    if (
      !upload ||
      upload.tenant_id !== scope.tenantId ||
      upload.clinic_id !== scope.clinicId ||
      upload.id !== scope.uploadId ||
      !UUID.test(upload.patient_id) ||
      !["reserved", "completed"].includes(upload.status) ||
      !isDatabaseInstant(upload.expires_at)
    ) {
      throw invalidContract("Private media state is not bound to a canonical media upload.");
    }
    return upload;
  }

  async #loadRecord(
    scope: PrivateMediaScope,
    forUpdate: boolean
  ): Promise<PrivateMediaRecord | null> {
    const result = await this.#query<PrivateMediaRecordRow>(
      `/* private_media:load_record */
       select * from private_media_records
       where tenant_id = $1::uuid and clinic_id = $2::uuid
         and media_id = $3::uuid and upload_id = $4::uuid
       ${forUpdate ? "for update" : ""}`,
      [scope.tenantId, scope.clinicId, scope.mediaId, scope.uploadId]
    );
    return result.rows[0] ? mapRecord(result.rows[0]) : null;
  }

  async #loadEvidence(scope: PrivateMediaScope, evidenceId: string): Promise<EvidenceRow | null> {
    const result = await this.#query<EvidenceRow>(
      `/* private_media:load_evidence */
       select evidence_id, tenant_id, clinic_id, media_id, upload_id, evidence_digest_sha256
       from private_media_scan_evidence
       where tenant_id = $1::uuid and clinic_id = $2::uuid and evidence_id = $3
       for update`,
      [scope.tenantId, scope.clinicId, evidenceId]
    );
    return result.rows[0] ?? null;
  }

  async #updateRecordCas(
    next: PrivateMediaRecord,
    expectedRevision: number,
    expectedStates: readonly PrivateMediaState[]
  ): Promise<boolean> {
    const result = await this.#query<Record<string, unknown>>(
      `/* private_media:update_record_cas */
       update private_media_records set
         revision = $5, detected_mime_type = $6, state = $7,
         object_version_id = $8, object_identity_sha256 = $9, scan_attempts = $10,
         last_evidence_id = $11, last_evidence_digest_sha256 = $12,
         last_scanned_at = $13::timestamptz,
         inspection_lease_id = $14, inspection_lease_expires_at = $15::timestamptz,
         pending_operation_id = $16, delete_marker_version_id = $17,
         deleted_at = $18::timestamptz, recoverable_until = $19::timestamptz,
         legal_hold = $20, updated_at = $21::timestamptz
       where tenant_id = $1::uuid and clinic_id = $2::uuid
         and media_id = $3::uuid and upload_id = $4::uuid
         and revision = $22 and state = any($23::text[])
       returning revision`,
      [
        next.scope.tenantId,
        next.scope.clinicId,
        next.scope.mediaId,
        next.scope.uploadId,
        next.revision,
        next.detectedMimeType,
        next.state,
        next.objectVersionId,
        next.objectIdentitySha256,
        next.scanAttempts,
        next.lastEvidenceId,
        next.lastEvidenceDigestSha256,
        next.lastScannedAt,
        next.inspectionLeaseId,
        next.inspectionLeaseExpiresAt,
        next.pendingOperationId,
        next.deleteMarkerVersionId,
        next.deletedAt,
        next.recoverableUntil,
        next.legalHold,
        next.updatedAt,
        expectedRevision,
        [...expectedStates]
      ]
    );
    return result.rows.length === 1;
  }

  #assertTransitionInput(input: Parameters<PrivateMediaAtomicPersistence["transition"]>[0]): void {
    this.#assertScope(input.scope);
    this.#assertRecord(input.next);
    if (
      input.expectedStates.length === 0 ||
      new Set(input.expectedStates).size !== input.expectedStates.length ||
      input.next.revision !== input.expectedRevision + 1 ||
      !sameScope(input.next.scope, input.scope)
    ) {
      throw invalidContract("Private media CAS transition is invalid.");
    }
    this.#assertOperation(
      input.operation,
      input.scope,
      input.expectedRevision,
      input.next.revision
    );
  }

  #assertScope(scope: PrivateMediaScope): void {
    if (
      scope.tenantId !== this.#context.tenantId ||
      scope.clinicId !== this.#context.clinicId ||
      !UUID.test(scope.mediaId) ||
      !UUID.test(scope.uploadId) ||
      scope.mediaId !== scope.uploadId
    ) {
      throw invalidContract("Private media scope does not match its transaction authority.");
    }
  }

  #assertRecord(record: PrivateMediaRecord): void {
    this.#assertScope(record.scope);
    if (!isCompleteRecord(record)) {
      throw invalidContract("Private media record is malformed.");
    }
  }

  #assertOperation(
    operation: PrivateMediaAtomicOperation,
    scope: PrivateMediaScope,
    expectedRevision: number | null,
    targetRevision: number | null
  ): void {
    const recomputed = privateMediaOperationSemanticFingerprint({
      operationId: operation.operationId,
      audit: operation.audit,
      reconciliationIntent: operation.reconciliationIntent
    });
    if (
      !SAFE_ID.test(operation.operationId) ||
      !SAFE_ID.test(operation.audit.eventId) ||
      !SAFE_ID.test(operation.reconciliationIntent.intentId) ||
      !SHA256.test(operation.semanticFingerprintSha256) ||
      !safeEqual(operation.semanticFingerprintSha256, recomputed) ||
      operation.reconciliationIntent.operationId !== operation.operationId ||
      operation.reconciliationIntent.expectedRevision !== expectedRevision ||
      operation.reconciliationIntent.targetRevision !== targetRevision ||
      !sameScope(operation.reconciliationIntent.scope, scope) ||
      operation.audit.tenantId !== scope.tenantId ||
      operation.audit.clinicId !== scope.clinicId ||
      operation.audit.mediaId !== scope.mediaId ||
      operation.audit.uploadId !== scope.uploadId ||
      !SAFE_ID.test(operation.audit.actorId) ||
      (this.#context.userId !== null && operation.audit.actorId !== this.#context.userId) ||
      !SAFE_ID.test(operation.audit.correlationId) ||
      !isIsoInstant(operation.audit.occurredAt) ||
      !isIsoInstant(operation.reconciliationIntent.createdAt) ||
      containsForbiddenAuthority(operation.audit.metadata) ||
      containsForbiddenAuthority(operation.reconciliationIntent.payload)
    ) {
      throw invalidContract("Private media atomic operation is malformed.");
    }
  }

  #assertEvidence(
    evidence: Readonly<{
      evidenceId: string;
      evidenceDigestSha256: string;
      evidence: SignedMalwareEvidence;
      recordedAt: string;
    }>,
    scope: PrivateMediaScope
  ): void {
    const canonicalDigest = canonicalEvidenceDigest(evidence.evidence);
    if (
      evidence.evidenceId !== evidence.evidence.payload.evidenceId ||
      !SAFE_ID.test(evidence.evidenceId) ||
      !SHA256.test(evidence.evidenceDigestSha256) ||
      !safeEqual(evidence.evidenceDigestSha256, canonicalDigest) ||
      evidence.evidence.payload.tenantId !== scope.tenantId ||
      evidence.evidence.payload.clinicId !== scope.clinicId ||
      evidence.evidence.payload.mediaId !== scope.mediaId ||
      evidence.evidence.payload.uploadId !== scope.uploadId ||
      !isIsoInstant(evidence.recordedAt)
    ) {
      throw invalidContract("Private media scan evidence is malformed.");
    }
  }

  async #query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<Row>> {
    try {
      return await this.#client.query<Row>(sql, values);
    } catch {
      throw persistenceUnavailable();
    }
  }
}

function recordValues(record: PrivateMediaRecord): readonly unknown[] {
  return [
    record.scope.tenantId,
    record.scope.clinicId,
    record.scope.mediaId,
    record.scope.uploadId,
    record.revision,
    record.locator.bucket,
    record.locator.key,
    record.locator.region,
    record.kind,
    record.declaredMimeType,
    record.detectedMimeType,
    record.expectedBytes,
    record.expectedSha256Hex,
    record.binding,
    record.state,
    record.expiresAt,
    record.objectVersionId,
    record.objectIdentitySha256,
    record.scanAttempts,
    record.lastEvidenceId,
    record.lastEvidenceDigestSha256,
    record.lastScannedAt,
    record.inspectionLeaseId,
    record.inspectionLeaseExpiresAt,
    record.pendingOperationId,
    record.deleteMarkerVersionId,
    record.deletedAt,
    record.recoverableUntil,
    record.legalHold,
    record.createdAt,
    record.updatedAt
  ];
}

function mapRecord(row: PrivateMediaRecordRow): PrivateMediaRecord {
  const record: PrivateMediaRecord = {
    revision: safeInteger(row.revision),
    scope: {
      tenantId: row.tenant_id,
      clinicId: row.clinic_id,
      mediaId: row.media_id,
      uploadId: row.upload_id
    },
    locator: { bucket: row.bucket, key: row.object_key, region: row.region },
    kind: row.kind,
    declaredMimeType: row.declared_mime_type,
    detectedMimeType: row.detected_mime_type,
    expectedBytes: safeInteger(row.expected_bytes),
    expectedSha256Hex: row.expected_sha256_hex,
    binding: row.authority_binding,
    state: row.state,
    expiresAt: isoValue(row.expires_at),
    objectVersionId: row.object_version_id,
    objectIdentitySha256: row.object_identity_sha256,
    scanAttempts: safeInteger(row.scan_attempts),
    lastEvidenceId: row.last_evidence_id,
    lastEvidenceDigestSha256: row.last_evidence_digest_sha256,
    lastScannedAt: nullableIsoValue(row.last_scanned_at),
    inspectionLeaseId: row.inspection_lease_id,
    inspectionLeaseExpiresAt: nullableIsoValue(row.inspection_lease_expires_at),
    pendingOperationId: row.pending_operation_id,
    deleteMarkerVersionId: row.delete_marker_version_id,
    deletedAt: nullableIsoValue(row.deleted_at),
    recoverableUntil: nullableIsoValue(row.recoverable_until),
    legalHold: row.legal_hold,
    createdAt: isoValue(row.created_at),
    updatedAt: isoValue(row.updated_at)
  };
  if (!isCompleteRecord(record)) throw persistenceUnavailable();
  return Object.freeze(record);
}

function isCompleteRecord(record: PrivateMediaRecord): boolean {
  const kinds: readonly PrivateMediaRecord["kind"][] = [
    "intraoral_photo",
    "xray",
    "document",
    "audio_chunk",
    "generated_document"
  ];
  const states: readonly PrivateMediaState[] = [
    "reserved",
    "upload_verified",
    "scan_in_progress",
    "available",
    "quarantined",
    "scan_failed",
    "delete_in_progress",
    "deleted",
    "restore_in_progress",
    "purge_in_progress",
    "purged"
  ];
  const nullableOpaqueValues = [
    record.detectedMimeType,
    record.objectVersionId,
    record.lastEvidenceId,
    record.inspectionLeaseId,
    record.pendingOperationId,
    record.deleteMarkerVersionId
  ];
  const nullableInstants = [
    record.lastScannedAt,
    record.inspectionLeaseExpiresAt,
    record.deletedAt,
    record.recoverableUntil
  ];
  return (
    UUID.test(record.scope.tenantId) &&
    UUID.test(record.scope.clinicId) &&
    UUID.test(record.scope.mediaId) &&
    record.scope.mediaId === record.scope.uploadId &&
    Number.isSafeInteger(record.revision) &&
    record.revision > 0 &&
    Number.isSafeInteger(record.expectedBytes) &&
    record.expectedBytes > 0 &&
    Number.isSafeInteger(record.scanAttempts) &&
    record.scanAttempts >= 0 &&
    kinds.includes(record.kind) &&
    states.includes(record.state) &&
    typeof record.declaredMimeType === "string" &&
    /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/u.test(
      record.declaredMimeType
    ) &&
    (record.detectedMimeType === null ||
      /^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/u.test(
        record.detectedMimeType
      )) &&
    SHA256.test(record.expectedSha256Hex) &&
    (record.objectIdentitySha256 === null || SHA256.test(record.objectIdentitySha256)) &&
    (record.lastEvidenceDigestSha256 === null || SHA256.test(record.lastEvidenceDigestSha256)) &&
    typeof record.binding === "string" &&
    record.binding.length >= 32 &&
    record.binding.length <= 256 &&
    typeof record.locator.bucket === "string" &&
    record.locator.bucket.length > 0 &&
    record.locator.bucket.length <= 255 &&
    typeof record.locator.key === "string" &&
    record.locator.key.length > 0 &&
    record.locator.key.length <= 1_024 &&
    !/[\r\n\u0000]/u.test(record.locator.key) &&
    typeof record.locator.region === "string" &&
    /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(record.locator.region) &&
    nullableOpaqueValues.every(
      (value) =>
        value === null || (typeof value === "string" && value.length > 0 && value.length <= 1_024)
    ) &&
    nullableInstants.every((value) => value === null || isIsoInstant(value)) &&
    typeof record.legalHold === "boolean" &&
    isIsoInstant(record.createdAt) &&
    isIsoInstant(record.updatedAt) &&
    isIsoInstant(record.expiresAt) &&
    recordStateIsConsistent(record)
  );
}

function recordStateIsConsistent(record: PrivateMediaRecord): boolean {
  const hasVerifiedObject =
    record.objectVersionId !== null &&
    record.objectIdentitySha256 !== null &&
    record.detectedMimeType !== null;
  const requiresVerifiedObject = [
    "upload_verified",
    "scan_in_progress",
    "available",
    "scan_failed",
    "restore_in_progress",
    "purge_in_progress",
    "purged"
  ].includes(record.state);
  const scanLeaseConsistent =
    record.state === "scan_in_progress"
      ? record.inspectionLeaseId !== null &&
        record.inspectionLeaseExpiresAt !== null &&
        record.pendingOperationId !== null
      : record.inspectionLeaseId === null && record.inspectionLeaseExpiresAt === null;
  const lifecycleIntentConsistent = [
    "delete_in_progress",
    "restore_in_progress",
    "purge_in_progress"
  ].includes(record.state)
    ? record.pendingOperationId !== null
    : record.state === "scan_in_progress" || record.pendingOperationId === null;
  const deletedConsistent =
    record.state === "deleted"
      ? record.deleteMarkerVersionId !== null &&
        record.deletedAt !== null &&
        record.recoverableUntil !== null
      : true;
  const availableConsistent =
    record.state === "available"
      ? record.lastEvidenceId !== null &&
        record.lastEvidenceDigestSha256 !== null &&
        record.lastScannedAt !== null
      : true;
  const evidencePointerConsistent =
    (record.lastEvidenceId === null) === (record.lastEvidenceDigestSha256 === null) &&
    (record.lastEvidenceId === null) === (record.lastScannedAt === null);
  const reservedConsistent =
    record.state !== "reserved" ||
    (record.detectedMimeType === null &&
      record.objectVersionId === null &&
      record.objectIdentitySha256 === null &&
      record.scanAttempts === 0 &&
      record.lastEvidenceId === null &&
      record.deleteMarkerVersionId === null &&
      record.deletedAt === null &&
      record.recoverableUntil === null);
  const deleteMarkerConsistent = ["deleted", "restore_in_progress", "purge_in_progress"].includes(
    record.state
  )
    ? record.deleteMarkerVersionId !== null
    : record.deleteMarkerVersionId === null;
  return (
    (!requiresVerifiedObject || hasVerifiedObject) &&
    scanLeaseConsistent &&
    lifecycleIntentConsistent &&
    deletedConsistent &&
    availableConsistent &&
    evidencePointerConsistent &&
    reservedConsistent &&
    deleteMarkerConsistent
  );
}

function assertStaticRecordFields(previous: PrivateMediaRecord, next: PrivateMediaRecord): void {
  if (
    !sameScope(previous.scope, next.scope) ||
    previous.locator.bucket !== next.locator.bucket ||
    previous.locator.key !== next.locator.key ||
    previous.locator.region !== next.locator.region ||
    previous.kind !== next.kind ||
    previous.declaredMimeType !== next.declaredMimeType ||
    previous.expectedBytes !== next.expectedBytes ||
    previous.expectedSha256Hex !== next.expectedSha256Hex ||
    previous.binding !== next.binding ||
    previous.expiresAt !== next.expiresAt ||
    previous.createdAt !== next.createdAt
  ) {
    throw invalidContract("Private media transition changed immutable reservation data.");
  }
}

function assertCanonicalUploadMatchesRecord(
  upload: CanonicalMediaUploadRow,
  record: PrivateMediaRecord
): void {
  if (
    record.scope.mediaId !== record.scope.uploadId ||
    upload.id !== record.scope.uploadId ||
    upload.object_key !== record.locator.key ||
    upload.storage_provider !== "s3" ||
    upload.storage_region !== record.locator.region ||
    upload.media_type !== record.kind ||
    upload.mime_type.split(";", 1)[0]?.trim().toLowerCase() !== record.declaredMimeType ||
    safeInteger(upload.expected_file_size_bytes) !== record.expectedBytes ||
    upload.expected_sha256_digest !== record.expectedSha256Hex ||
    isoValue(upload.expires_at) !== record.expiresAt
  ) {
    throw invalidContract("Private media state conflicts with its canonical media upload.");
  }
}

function sameScope(left: PrivateMediaScope, right: PrivateMediaScope): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.clinicId === right.clinicId &&
    left.mediaId === right.mediaId &&
    left.uploadId === right.uploadId
  );
}

function sameScopeRow(
  row: Pick<OperationRow, "tenant_id" | "clinic_id" | "media_id" | "upload_id">,
  scope: PrivateMediaScope
): boolean {
  return (
    row.tenant_id === scope.tenantId &&
    row.clinic_id === scope.clinicId &&
    row.media_id === scope.mediaId &&
    row.upload_id === scope.uploadId
  );
}

function canonicalEvidenceDigest(evidence: SignedMalwareEvidence): string {
  const payload = evidence.payload;
  return createHash("sha256")
    .update(
      JSON.stringify({
        payload: {
          evidenceId: payload.evidenceId,
          tenantId: payload.tenantId,
          clinicId: payload.clinicId,
          mediaId: payload.mediaId,
          uploadId: payload.uploadId,
          scanOperationId: payload.scanOperationId,
          objectIdentitySha256: payload.objectIdentitySha256,
          objectVersionId: payload.objectVersionId,
          contentSha256Hex: payload.contentSha256Hex,
          contentLength: payload.contentLength,
          detectedMimeType: payload.detectedMimeType,
          verdict: payload.verdict,
          scanner: payload.scanner,
          engineVersion: payload.engineVersion,
          definitionsVersion: payload.definitionsVersion,
          scannedAt: payload.scannedAt
        },
        signature: {
          algorithm: evidence.signature.algorithm,
          keyId: evidence.signature.keyId,
          valueBase64: evidence.signature.valueBase64
        }
      })
    )
    .digest("hex");
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function containsForbiddenAuthority(value: Readonly<Record<string, unknown>>): boolean {
  const serialized = JSON.stringify(value);
  return (
    serialized.length > 8_192 ||
    /(?:bucket|object[_-]?key|version[_-]?id|signed[_-]?url|provider[_-]?token|authorization|kms[_-]?key|x-amz-server-side)/iu.test(
      serialized
    )
  );
}

function safeInteger(value: string | number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) throw persistenceUnavailable();
  return parsed;
}

function isoValue(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw persistenceUnavailable();
  return date.toISOString();
}

function nullableIsoValue(value: string | Date | null): string | null {
  return value === null ? null : isoValue(value);
}

function isIsoInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isDatabaseInstant(value: string | Date): boolean {
  return Number.isFinite((value instanceof Date ? value : new Date(value)).getTime());
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function invalidContract(message: string): PostgresPrivateMediaPersistenceError {
  return new PostgresPrivateMediaPersistenceError("invalid_contract", message);
}

function persistenceUnavailable(): PostgresPrivateMediaPersistenceError {
  return new PostgresPrivateMediaPersistenceError(
    "persistence_unavailable",
    "Private media persistence is temporarily unavailable.",
    true
  );
}
