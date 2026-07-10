import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SqlQueryClient, SqlQueryResult } from "@clinic-os/db";
import {
  privateMediaOperationSemanticFingerprint,
  type PrivateMediaAtomicOperation,
  type PrivateMediaRecord,
  type PrivateMediaScope,
  type SignedMalwareEvidence
} from "../../../packages/integrations/dist/media/index.js";
import {
  PostgresPrivateMediaAtomicPersistence,
  PostgresPrivateMediaPersistenceError
} from "../src/providers/media/postgres-private-media-persistence.ts";

const scope: PrivateMediaScope = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  clinicId: "10000000-0000-4000-8000-000000000002",
  mediaId: "10000000-0000-4000-8000-000000000004",
  uploadId: "10000000-0000-4000-8000-000000000004"
};
const actorId = "10000000-0000-4000-8000-000000000005";

test("CP14 Postgres adapter requires caller transaction RLS and never starts or commits one", async () => {
  const database = new FakeDatabase();
  const client = database.autocommitClient();
  const persistence = adapter(client);
  await assert.rejects(persistence.get(scope), (error: unknown) => {
    assert.ok(error instanceof PostgresPrivateMediaPersistenceError);
    assert.equal(error.code, "transaction_context_required");
    return true;
  });
  assert.equal(
    client.queries.some((query) => /\b(?:begin|commit|rollback|savepoint)\b/iu.test(query.sql)),
    false
  );
});

test("CP14 Postgres reserve is atomic, replayable, conflicting, parameterized, and PHI-free", async () => {
  const database = new FakeDatabase();
  const tx = database.begin();
  const persistence = adapter(tx);
  const record = reservedRecord(scope);
  const operation = operationFor(
    record,
    "media.upload_reserved",
    "upload_reservation_created",
    null
  );
  assert.equal(await persistence.reserve({ record, operation }), "applied");
  tx.commit();
  assert.equal(database.state.records.size, 1);
  assert.equal(database.state.operations.size, 1);
  assert.equal(database.state.audits.size, 1);
  assert.equal(database.state.outbox.size, 1);
  const audit = [...database.state.audits.values()][0];
  const outbox = [...database.state.outbox.values()][0];
  assert.equal(audit?.patient_id, "10000000-0000-4000-8000-000000000006");
  assert.equal(outbox?.patient_id, "10000000-0000-4000-8000-000000000006");
  assert.equal(outbox?.idempotency_key, operation.reconciliationIntent.intentId);
  assert.equal(
    tx.queries.some(
      (query) => query.sql.includes("from media_uploads") && query.sql.includes("for update")
    ),
    true
  );

  const replayTx = database.begin();
  assert.equal(await adapter(replayTx).reserve({ record, operation }), "replayed");
  replayTx.commit();

  const conflicting = withChangedOperationMeaning(operation);
  const conflictTx = database.begin();
  assert.equal(
    await adapter(conflictTx).reserve({ record, operation: conflicting }),
    "operation_conflict"
  );
  conflictTx.commit();

  const queryText = tx.queries.map((query) => query.sql).join("\n");
  assert.doesNotMatch(queryText, new RegExp(record.locator.key, "u"));
  assert.doesNotMatch(queryText, /patient-name|signed-url|SECRET/iu);
  assert.equal(
    tx.queries.every((query) => !query.sql.includes(record.locator.bucket)),
    true
  );
  assert.equal(
    tx.queries.some((query) => query.values.includes(record.locator.key)),
    true
  );
});

test("CP14 Postgres rejects state that diverges from the canonical media_upload reservation", async () => {
  const database = new FakeDatabase();
  const upload = database.state.mediaUploads.get(scope.uploadId);
  assert.ok(upload);
  upload.object_key = "staging/another-object";
  const tx = database.begin();
  const record = reservedRecord(scope);
  await assert.rejects(
    adapter(tx).reserve({
      record,
      operation: operationFor(record, "media.upload_reserved", "upload_reservation_created", null)
    }),
    (error: unknown) =>
      error instanceof PostgresPrivateMediaPersistenceError && error.code === "invalid_contract"
  );
  tx.rollback();
  assert.equal(database.state.records.size, 0);
  assert.equal(database.state.audits.size, 0);
  assert.equal(database.state.outbox.size, 0);
});

test("CP14 Postgres get rejects drifted canonical state before returning available media", async () => {
  const database = await databaseWithReservation();
  const record = database.state.records.get(scopeKey(scope));
  const upload = database.state.mediaUploads.get(scope.uploadId);
  assert.ok(record);
  assert.ok(upload);
  Object.assign(record, {
    revision: 2,
    state: "available",
    detected_mime_type: "image/jpeg",
    object_version_id: "version-1",
    object_identity_sha256: "b".repeat(64),
    last_evidence_id: "evidence-available",
    last_evidence_digest_sha256: "c".repeat(64),
    last_scanned_at: "2026-07-10T10:01:30.000Z",
    updated_at: "2026-07-10T10:01:30.000Z"
  });
  upload.status = "completed";
  upload.object_key = "staging/drifted-object";

  const tx = database.begin();
  await assert.rejects(
    adapter(tx).get(scope),
    (error: unknown) =>
      error instanceof PostgresPrivateMediaPersistenceError && error.code === "invalid_contract"
  );
  tx.rollback();
});

test("CP14 Postgres rejects rejected, expired, and expiry-drifted canonical uploads", async () => {
  for (const status of ["rejected", "expired"] as const) {
    const database = await databaseWithReservation();
    const upload = database.state.mediaUploads.get(scope.uploadId);
    assert.ok(upload);
    upload.status = status;
    const tx = database.begin();
    await assert.rejects(
      adapter(tx).get(scope),
      (error: unknown) =>
        error instanceof PostgresPrivateMediaPersistenceError && error.code === "invalid_contract"
    );
    tx.rollback();
  }

  const drifted = await databaseWithReservation();
  const upload = drifted.state.mediaUploads.get(scope.uploadId);
  assert.ok(upload);
  upload.expires_at = "2026-07-10T10:06:00.000Z";
  const tx = drifted.begin();
  await assert.rejects(
    adapter(tx).get(scope),
    (error: unknown) =>
      error instanceof PostgresPrivateMediaPersistenceError && error.code === "invalid_contract"
  );
  tx.rollback();
});

test("CP14 Postgres CAS rejects stale writers without partial audit or outbox", async () => {
  const database = await databaseWithReservation();
  const tx = database.begin();
  const current = reservedRecord(scope);
  const next = {
    ...current,
    revision: 3,
    state: "upload_verified" as const,
    detectedMimeType: "image/jpeg",
    objectVersionId: "version-1",
    objectIdentitySha256: "b".repeat(64),
    updatedAt: "2026-07-10T10:01:00.000Z"
  };
  const operation = operationFor(next, "media.upload_verified", "upload_object_verified", 2);
  const result = await adapter(tx).transition({
    scope,
    expectedRevision: 2,
    expectedStates: ["reserved"],
    next,
    operation
  });
  assert.equal(result, "concurrent_change");
  tx.commit();
  assert.equal(database.state.records.get(scopeKey(scope))?.revision, 1);
  assert.equal(database.state.audits.size, 1);
  assert.equal(database.state.outbox.size, 1);
});

test("CP14 Postgres refuses audit actors that do not match the user RLS authority", async () => {
  const database = new FakeDatabase();
  const tx = database.begin();
  const record = reservedRecord(scope);
  const original = operationFor(
    record,
    "media.upload_reserved",
    "upload_reservation_created",
    null
  );
  const audit = {
    ...original.audit,
    actorId: "10000000-0000-4000-8000-000000000099"
  };
  const mismatched = {
    ...original,
    audit,
    semanticFingerprintSha256: privateMediaOperationSemanticFingerprint({
      operationId: original.operationId,
      audit,
      reconciliationIntent: original.reconciliationIntent
    })
  };
  await assert.rejects(
    adapter(tx).reserve({ record, operation: mismatched }),
    (error: unknown) =>
      error instanceof PostgresPrivateMediaPersistenceError && error.code === "invalid_contract"
  );
  tx.rollback();
  assert.equal(database.state.records.size, 0);
});

test("CP14 Postgres evidence conflict commits the fail-closed branch and never overwrites evidence", async () => {
  const database = await databaseWithReservation();
  const claimTx = database.begin();
  const reserved = mustRecord(database.state.records.get(scopeKey(scope)));
  const claimed: PrivateMediaRecord = {
    ...reserved,
    revision: 2,
    state: "scan_in_progress",
    detectedMimeType: "image/jpeg",
    objectVersionId: "version-1",
    objectIdentitySha256: "b".repeat(64),
    scanAttempts: 1,
    inspectionLeaseId: "lease-1",
    inspectionLeaseExpiresAt: "2026-07-10T10:02:00.000Z",
    pendingOperationId: `pmop_${"c".repeat(64)}`,
    updatedAt: "2026-07-10T10:01:00.000Z"
  };
  assert.equal(
    await adapter(claimTx).transition({
      scope,
      expectedRevision: 1,
      expectedStates: ["reserved"],
      next: claimed,
      operation: operationFor(claimed, "media.scan_started", "scan_execution_requested", 1)
    }),
    "applied"
  );
  claimTx.commit();

  const evidence = signedEvidence(claimed);
  const digest = evidenceDigest(evidence);
  database.state.evidence.set(
    evidenceKey(scope.tenantId, scope.clinicId, evidence.payload.evidenceId),
    {
      evidence_id: evidence.payload.evidenceId,
      tenant_id: scope.tenantId,
      clinic_id: scope.clinicId,
      media_id: scope.mediaId,
      upload_id: scope.uploadId,
      evidence_digest_sha256: "d".repeat(64)
    }
  );
  const success: PrivateMediaRecord = {
    ...claimed,
    revision: 3,
    state: "available",
    lastEvidenceId: evidence.payload.evidenceId,
    lastEvidenceDigestSha256: digest,
    lastScannedAt: evidence.payload.scannedAt,
    inspectionLeaseId: null,
    inspectionLeaseExpiresAt: null,
    pendingOperationId: null,
    updatedAt: "2026-07-10T10:01:30.000Z"
  };
  const evidenceConflict: PrivateMediaRecord = {
    ...claimed,
    revision: 3,
    state: "scan_failed",
    inspectionLeaseId: null,
    inspectionLeaseExpiresAt: null,
    pendingOperationId: null,
    updatedAt: "2026-07-10T10:01:30.000Z"
  };
  const tx = database.begin();
  const result = await adapter(tx).commitScanResult({
    scope,
    expectedRevision: 2,
    expectedStates: ["scan_in_progress"],
    evidence: {
      evidenceId: evidence.payload.evidenceId,
      evidenceDigestSha256: digest,
      evidence,
      recordedAt: "2026-07-10T10:01:30.000Z"
    },
    success: {
      next: success,
      operation: operationFor(success, "media.scan_completed", "scan_result_committed", 2)
    },
    evidenceConflict: {
      next: evidenceConflict,
      operation: operationFor(evidenceConflict, "media.scan_failed", "scan_failure_committed", 2, {
        reason: "scan_evidence_conflict"
      })
    }
  });
  assert.equal(result, "evidence_conflict");
  tx.commit();
  assert.equal(database.state.records.get(scopeKey(scope))?.state, "scan_failed");
  assert.equal(
    database.state.evidence.get(
      evidenceKey(scope.tenantId, scope.clinicId, evidence.payload.evidenceId)
    )?.evidence_digest_sha256,
    "d".repeat(64)
  );
  assert.equal(database.state.evidence.size, 1);
});

test("CP14 Postgres scan commit rejects canonical reservation drift before evidence insertion", async () => {
  const database = await databaseWithReservation();
  const claimed = forceScanInProgress(database);
  const upload = database.state.mediaUploads.get(scope.uploadId);
  assert.ok(upload);
  upload.expires_at = "2026-07-10T10:06:00.000Z";

  const tx = database.begin();
  await assert.rejects(
    adapter(tx).commitScanResult(scanResultInput(claimed)),
    (error: unknown) =>
      error instanceof PostgresPrivateMediaPersistenceError && error.code === "invalid_contract"
  );
  tx.rollback();
  assert.equal(database.state.evidence.size, 0);
  assert.equal(database.state.records.get(scopeKey(scope))?.state, "scan_in_progress");
});

test("CP14 Postgres evidence replay lookup is tenant scoped", async () => {
  const database = await databaseWithReservation();
  const claimed = forceScanInProgress(database);
  const input = scanResultInput(claimed);
  const otherTenant = "20000000-0000-4000-8000-000000000001";
  const otherClinic = "20000000-0000-4000-8000-000000000002";
  database.state.evidence.set(evidenceKey(otherTenant, otherClinic, input.evidence.evidenceId), {
    evidence_id: input.evidence.evidenceId,
    tenant_id: otherTenant,
    clinic_id: otherClinic,
    media_id: "20000000-0000-4000-8000-000000000004",
    upload_id: "20000000-0000-4000-8000-000000000004",
    evidence_digest_sha256: "d".repeat(64)
  });

  const tx = database.begin();
  assert.equal(await adapter(tx).commitScanResult(input), "applied");
  const evidenceLookup = tx.queries.find((query) =>
    query.sql.includes("private_media:load_evidence")
  );
  assert.deepEqual(evidenceLookup?.values, [
    scope.tenantId,
    scope.clinicId,
    input.evidence.evidenceId
  ]);
  tx.commit();
  assert.equal(database.state.evidence.size, 2);
  assert.ok(
    database.state.evidence.has(
      evidenceKey(scope.tenantId, scope.clinicId, input.evidence.evidenceId)
    )
  );
  assert.ok(
    database.state.evidence.has(evidenceKey(otherTenant, otherClinic, input.evidence.evidenceId))
  );
});

test("CP14 Postgres post-evidence CAS impossibility aborts the caller transaction", async () => {
  const database = await databaseWithReservation();
  const row = database.state.records.get(scopeKey(scope));
  assert.ok(row);
  Object.assign(row, {
    revision: 2,
    state: "scan_in_progress",
    detected_mime_type: "image/jpeg",
    object_version_id: "version-1",
    object_identity_sha256: "b".repeat(64),
    scan_attempts: 1,
    inspection_lease_id: "lease-1",
    inspection_lease_expires_at: "2026-07-10T10:02:00.000Z",
    pending_operation_id: `pmop_${"c".repeat(64)}`,
    updated_at: "2026-07-10T10:01:00.000Z"
  });
  const claimed = mustRecord(row);
  const evidence = signedEvidence(claimed);
  const digest = evidenceDigest(evidence);
  const success: PrivateMediaRecord = {
    ...claimed,
    revision: 3,
    state: "available",
    lastEvidenceId: evidence.payload.evidenceId,
    lastEvidenceDigestSha256: digest,
    lastScannedAt: evidence.payload.scannedAt,
    inspectionLeaseId: null,
    inspectionLeaseExpiresAt: null,
    pendingOperationId: null,
    updatedAt: "2026-07-10T10:01:30.000Z"
  };
  const conflict: PrivateMediaRecord = { ...success, state: "scan_failed" };
  const tx = database.begin();
  tx.forceCasMissAfterEvidence = true;
  await assert.rejects(
    adapter(tx).commitScanResult({
      scope,
      expectedRevision: 2,
      expectedStates: ["scan_in_progress"],
      evidence: {
        evidenceId: evidence.payload.evidenceId,
        evidenceDigestSha256: digest,
        evidence,
        recordedAt: "2026-07-10T10:01:30.000Z"
      },
      success: {
        next: success,
        operation: operationFor(success, "media.scan_completed", "scan_result_committed", 2)
      },
      evidenceConflict: {
        next: conflict,
        operation: operationFor(conflict, "media.scan_failed", "scan_failure_committed", 2, {
          reason: "scan_evidence_conflict"
        })
      }
    }),
    (error: unknown) =>
      error instanceof PostgresPrivateMediaPersistenceError && error.code === "invalid_contract"
  );
  assert.equal(tx.state.evidence.size, 1);
  tx.rollback();
  assert.equal(database.state.evidence.size, 0);
  assert.equal(database.state.records.get(scopeKey(scope))?.state, "scan_in_progress");
});

test("CP14 Postgres corrupt durable rows fail closed before returning state", async () => {
  const database = await databaseWithReservation();
  const corrupt = database.state.records.get(scopeKey(scope));
  assert.ok(corrupt);
  corrupt.state = "available";
  corrupt.object_identity_sha256 = "not-a-sha256";
  const tx = database.begin();
  await assert.rejects(adapter(tx).get(scope), (error: unknown) => {
    assert.ok(error instanceof PostgresPrivateMediaPersistenceError);
    assert.equal(error.code, "persistence_unavailable");
    return true;
  });
  tx.rollback();
});

test("CP14 caller rollback removes state, operation, audit, evidence, and intent after a late failure", async () => {
  const database = new FakeDatabase();
  const secondScope = {
    ...scope,
    mediaId: "20000000-0000-4000-8000-000000000004",
    uploadId: "20000000-0000-4000-8000-000000000004"
  };
  const record = reservedRecord(secondScope);
  database.seedUpload(record);
  const tx = database.begin();
  tx.failAt = "private_media:insert_outbox";
  await assert.rejects(
    adapter(tx).reserve({
      record,
      operation: operationFor(record, "media.upload_reserved", "upload_reservation_created", null)
    }),
    (error: unknown) => {
      assert.ok(error instanceof PostgresPrivateMediaPersistenceError);
      assert.equal(error.code, "persistence_unavailable");
      assert.doesNotMatch(JSON.stringify(error), /SECRET|forbidden_outbox/iu);
      return true;
    }
  );
  tx.rollback();
  assert.equal(database.state.records.size, 0);
  assert.equal(database.state.operations.size, 0);
  assert.equal(database.state.audits.size, 0);
  assert.equal(database.state.outbox.size, 0);
  assert.equal(database.state.evidence.size, 0);
});

test("CP14 absent Postgres schema fails closed with a redacted error", async () => {
  const database = new FakeDatabase();
  const tx = database.begin();
  tx.failAt = "private_media:load_record";
  tx.failure = new Error("SECRET db host private_media_records object_key");
  await assert.rejects(adapter(tx).get(scope), (error: unknown) => {
    assert.ok(error instanceof PostgresPrivateMediaPersistenceError);
    assert.equal(error.code, "persistence_unavailable");
    assert.doesNotMatch(JSON.stringify(error), /SECRET|host|object_key|private_media_records/iu);
    return true;
  });
  tx.rollback();
});

interface FakeRecordRow extends Record<string, unknown> {
  tenant_id: string;
  clinic_id: string;
  media_id: string;
  upload_id: string;
  revision: number;
  bucket: string;
  object_key: string;
  region: string;
  kind: PrivateMediaRecord["kind"];
  declared_mime_type: string;
  detected_mime_type: string | null;
  expected_bytes: number;
  expected_sha256_hex: string;
  authority_binding: string;
  state: PrivateMediaRecord["state"];
  expires_at: string;
  object_version_id: string | null;
  object_identity_sha256: string | null;
  scan_attempts: number;
  last_evidence_id: string | null;
  last_evidence_digest_sha256: string | null;
  last_scanned_at: string | null;
  inspection_lease_id: string | null;
  inspection_lease_expires_at: string | null;
  pending_operation_id: string | null;
  delete_marker_version_id: string | null;
  deleted_at: string | null;
  recoverable_until: string | null;
  legal_hold: boolean;
  created_at: string;
  updated_at: string;
}

interface FakeState {
  mediaUploads: Map<string, Record<string, unknown>>;
  records: Map<string, FakeRecordRow>;
  operations: Map<string, Record<string, unknown>>;
  evidence: Map<string, Record<string, unknown>>;
  audits: Map<string, Record<string, unknown>>;
  outbox: Map<string, Record<string, unknown>>;
}

class FakeDatabase {
  state: FakeState = emptyState();

  constructor() {
    this.seedUpload(reservedRecord(scope));
  }

  seedUpload(record: PrivateMediaRecord): void {
    this.state.mediaUploads.set(record.scope.uploadId, {
      tenant_id: record.scope.tenantId,
      clinic_id: record.scope.clinicId,
      id: record.scope.uploadId,
      patient_id: "10000000-0000-4000-8000-000000000006",
      media_type: record.kind,
      mime_type: record.declaredMimeType,
      expected_file_size_bytes: record.expectedBytes,
      expected_sha256_digest: record.expectedSha256Hex,
      object_key: record.locator.key,
      storage_provider: "s3",
      storage_region: record.locator.region,
      status: "reserved",
      expires_at: record.expiresAt
    });
  }

  begin(): FakeTransactionClient {
    return new FakeTransactionClient(this, structuredClone(this.state), true);
  }

  autocommitClient(): FakeTransactionClient {
    return new FakeTransactionClient(this, structuredClone(this.state), false);
  }
}

class FakeTransactionClient implements SqlQueryClient {
  readonly queries: Array<{ sql: string; values: readonly unknown[] }> = [];
  readonly #database: FakeDatabase;
  readonly #inTransaction: boolean;
  state: FakeState;
  rls: { tenantId: string; clinicId: string; userId: string | null } | null = null;
  failAt: string | null = null;
  failure: Error = new Error("SECRET injected database failure");
  forceCasMissAfterEvidence = false;

  constructor(database: FakeDatabase, state: FakeState, inTransaction: boolean) {
    this.#database = database;
    this.state = state;
    this.#inTransaction = inTransaction;
  }

  commit(): void {
    if (!this.#inTransaction) throw new Error("not a transaction");
    this.#database.state = structuredClone(this.state);
  }

  rollback(): void {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: readonly unknown[] = []
  ): Promise<SqlQueryResult<Row>> {
    this.queries.push({ sql, values });
    const marker = /private_media:[a-z_]+/u.exec(sql)?.[0] ?? "";
    if (this.failAt && marker === this.failAt) throw this.failure;
    if (marker === "private_media:set_rls") {
      if (this.#inTransaction) {
        this.rls = {
          tenantId: String(values[0]),
          clinicId: String(values[1]),
          userId: values[2] ? String(values[2]) : null
        };
      }
      return rows<Row>([]);
    }
    if (marker === "private_media:validate_rls") {
      return rows<Row>([
        {
          tenant_id: this.rls?.tenantId ?? null,
          clinic_id: this.rls?.clinicId ?? null,
          user_id: this.rls?.userId ?? null
        }
      ]);
    }
    if (marker === "private_media:advisory_locks") return rows<Row>([]);
    if (marker === "private_media:load_canonical_upload") {
      const upload = this.state.mediaUploads.get(String(values[2]));
      return rows<Row>(upload ? [structuredClone(upload)] : []);
    }
    if (marker === "private_media:load_record") {
      const key = values.slice(0, 4).map(String).join(":");
      const record = this.state.records.get(key);
      return rows<Row>(record ? [structuredClone(record)] : []);
    }
    if (marker === "private_media:insert_record") {
      const row = recordRow(values);
      const key = scopeKeyFromRow(row);
      if (this.state.records.has(key)) throw new Error("duplicate record");
      this.state.records.set(key, row);
      return rows<Row>([{ revision: row.revision }]);
    }
    if (marker === "private_media:update_record_cas") {
      const key = values.slice(0, 4).map(String).join(":");
      const record = this.state.records.get(key);
      const expectedRevision = Number(values[21]);
      const expectedStates = values[22] as readonly string[];
      if (
        (this.forceCasMissAfterEvidence && this.state.evidence.size > 0) ||
        !record ||
        record.revision !== expectedRevision ||
        !expectedStates.includes(record.state)
      ) {
        return rows<Row>([]);
      }
      Object.assign(record, {
        revision: Number(values[4]),
        detected_mime_type: values[5] as string | null,
        state: values[6] as PrivateMediaRecord["state"],
        object_version_id: values[7] as string | null,
        object_identity_sha256: values[8] as string | null,
        scan_attempts: Number(values[9]),
        last_evidence_id: values[10] as string | null,
        last_evidence_digest_sha256: values[11] as string | null,
        last_scanned_at: values[12] as string | null,
        inspection_lease_id: values[13] as string | null,
        inspection_lease_expires_at: values[14] as string | null,
        pending_operation_id: values[15] as string | null,
        delete_marker_version_id: values[16] as string | null,
        deleted_at: values[17] as string | null,
        recoverable_until: values[18] as string | null,
        legal_hold: Boolean(values[19]),
        updated_at: String(values[20])
      });
      return rows<Row>([{ revision: record.revision }]);
    }
    if (marker === "private_media:load_operation") {
      const operation = this.state.operations.get(String(values[0]));
      return rows<Row>(operation ? [structuredClone(operation)] : []);
    }
    if (marker === "private_media:insert_audit") {
      this.state.audits.set(String(values[0]), {
        patient_id: values[7],
        metadata: JSON.parse(String(values[9]))
      });
      return rows<Row>([{ id: values[0] }]);
    }
    if (marker === "private_media:insert_outbox") {
      this.state.outbox.set(String(values[0]), {
        patient_id: values[7],
        idempotency_key: values[8],
        payload: JSON.parse(String(values[10]))
      });
      return rows<Row>([{ id: values[0] }]);
    }
    if (marker === "private_media:insert_operation") {
      const operation = {
        operation_id: String(values[0]),
        operation_kind: String(values[1]),
        tenant_id: String(values[2]),
        clinic_id: String(values[3]),
        media_id: String(values[4]),
        upload_id: String(values[5]),
        semantic_fingerprint_sha256: String(values[6]),
        write_fingerprint_sha256: String(values[7])
      };
      this.state.operations.set(operation.operation_id, operation);
      return rows<Row>([{ operation_id: operation.operation_id }]);
    }
    if (marker === "private_media:load_evidence") {
      const evidence = this.state.evidence.get(
        evidenceKey(String(values[0]), String(values[1]), String(values[2]))
      );
      return rows<Row>(evidence ? [structuredClone(evidence)] : []);
    }
    if (marker === "private_media:insert_evidence") {
      this.state.evidence.set(
        evidenceKey(String(values[1]), String(values[2]), String(values[0])),
        {
          evidence_id: String(values[0]),
          tenant_id: String(values[1]),
          clinic_id: String(values[2]),
          media_id: String(values[3]),
          upload_id: String(values[4]),
          evidence_digest_sha256: String(values[5])
        }
      );
      return rows<Row>([{ evidence_id: values[0] }]);
    }
    throw new Error(`Unhandled fake SQL marker: ${marker}`);
  }
}

function adapter(client: SqlQueryClient): PostgresPrivateMediaAtomicPersistence {
  return new PostgresPrivateMediaAtomicPersistence(client, {
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    userId: actorId
  });
}

async function databaseWithReservation(): Promise<FakeDatabase> {
  const database = new FakeDatabase();
  const tx = database.begin();
  const record = reservedRecord(scope);
  assert.equal(
    await adapter(tx).reserve({
      record,
      operation: operationFor(record, "media.upload_reserved", "upload_reservation_created", null)
    }),
    "applied"
  );
  tx.commit();
  return database;
}

function reservedRecord(value: PrivateMediaScope): PrivateMediaRecord {
  return {
    revision: 1,
    scope: value,
    locator: {
      bucket: "private-media-bucket",
      region: "ap-south-1",
      key: `staging/tenants/${value.tenantId}/clinics/${value.clinicId}/media/${value.mediaId}/${value.uploadId}/opaque`
    },
    kind: "intraoral_photo",
    declaredMimeType: "image/jpeg",
    detectedMimeType: null,
    expectedBytes: 32,
    expectedSha256Hex: "a".repeat(64),
    binding: "A".repeat(43),
    state: "reserved",
    expiresAt: "2026-07-10T10:05:00.000Z",
    objectVersionId: null,
    objectIdentitySha256: null,
    scanAttempts: 0,
    lastEvidenceId: null,
    lastEvidenceDigestSha256: null,
    lastScannedAt: null,
    inspectionLeaseId: null,
    inspectionLeaseExpiresAt: null,
    pendingOperationId: null,
    deleteMarkerVersionId: null,
    deletedAt: null,
    recoverableUntil: null,
    legalHold: false,
    createdAt: "2026-07-10T10:00:00.000Z",
    updatedAt: "2026-07-10T10:00:00.000Z"
  };
}

function operationFor(
  record: PrivateMediaRecord,
  action: PrivateMediaAtomicOperation["audit"]["action"],
  intentKind: PrivateMediaAtomicOperation["reconciliationIntent"]["kind"],
  expectedRevision: number | null,
  metadata: Readonly<Record<string, string | number | boolean | null>> = { state: record.state }
): PrivateMediaAtomicOperation {
  const seed = createHash("sha256")
    .update(
      `${record.scope.mediaId}:${record.scope.uploadId}:${action}:${expectedRevision}:${record.revision}`
    )
    .digest("hex");
  const operationId = `pmop_${seed}`;
  const occurredAt = "2026-07-10T10:00:00.000Z";
  const audit = {
    eventId: `pmae_${createHash("sha256").update(`${operationId}:audit`).digest("hex")}`,
    action,
    occurredAt,
    tenantId: record.scope.tenantId,
    clinicId: record.scope.clinicId,
    mediaId: record.scope.mediaId,
    uploadId: record.scope.uploadId,
    actorId,
    correlationId: "correlation-1",
    outcome: "succeeded" as const,
    metadata
  };
  const reconciliationIntent = {
    intentId: `pmri_${createHash("sha256").update(`${operationId}:intent`).digest("hex")}`,
    operationId,
    kind: intentKind,
    scope: record.scope,
    expectedRevision,
    targetRevision: record.revision,
    createdAt: occurredAt,
    payload: metadata
  };
  return {
    operationId,
    semanticFingerprintSha256: privateMediaOperationSemanticFingerprint({
      operationId,
      audit,
      reconciliationIntent
    }),
    audit,
    reconciliationIntent
  };
}

function withChangedOperationMeaning(
  operation: PrivateMediaAtomicOperation
): PrivateMediaAtomicOperation {
  const audit = { ...operation.audit, correlationId: "correlation-changed" };
  return {
    ...operation,
    audit,
    semanticFingerprintSha256: privateMediaOperationSemanticFingerprint({
      operationId: operation.operationId,
      audit,
      reconciliationIntent: operation.reconciliationIntent
    })
  };
}

function signedEvidence(record: PrivateMediaRecord): SignedMalwareEvidence {
  return {
    payload: {
      evidenceId: "evidence-1",
      tenantId: record.scope.tenantId,
      clinicId: record.scope.clinicId,
      mediaId: record.scope.mediaId,
      uploadId: record.scope.uploadId,
      scanOperationId: record.pendingOperationId!,
      objectIdentitySha256: record.objectIdentitySha256!,
      objectVersionId: record.objectVersionId!,
      contentSha256Hex: record.expectedSha256Hex,
      contentLength: record.expectedBytes,
      detectedMimeType: record.detectedMimeType!,
      verdict: "clean",
      scanner: "scanner-1",
      engineVersion: "engine-1",
      definitionsVersion: "definitions-1",
      scannedAt: "2026-07-10T10:01:30.000Z"
    },
    signature: {
      keyId: "kms-signing-key-1",
      algorithm: "RSASSA_PSS_SHA_256",
      valueBase64: Buffer.alloc(64, 9).toString("base64")
    }
  };
}

function forceScanInProgress(database: FakeDatabase): PrivateMediaRecord {
  const row = database.state.records.get(scopeKey(scope));
  assert.ok(row);
  Object.assign(row, {
    revision: 2,
    state: "scan_in_progress",
    detected_mime_type: "image/jpeg",
    object_version_id: "version-1",
    object_identity_sha256: "b".repeat(64),
    scan_attempts: 1,
    inspection_lease_id: "lease-1",
    inspection_lease_expires_at: "2026-07-10T10:02:00.000Z",
    pending_operation_id: `pmop_${"c".repeat(64)}`,
    updated_at: "2026-07-10T10:01:00.000Z"
  });
  return mustRecord(row);
}

function scanResultInput(claimed: PrivateMediaRecord) {
  const evidence = signedEvidence(claimed);
  const digest = evidenceDigest(evidence);
  const success: PrivateMediaRecord = {
    ...claimed,
    revision: claimed.revision + 1,
    state: "available",
    lastEvidenceId: evidence.payload.evidenceId,
    lastEvidenceDigestSha256: digest,
    lastScannedAt: evidence.payload.scannedAt,
    inspectionLeaseId: null,
    inspectionLeaseExpiresAt: null,
    pendingOperationId: null,
    updatedAt: "2026-07-10T10:01:30.000Z"
  };
  const conflict: PrivateMediaRecord = {
    ...claimed,
    revision: claimed.revision + 1,
    state: "scan_failed",
    inspectionLeaseId: null,
    inspectionLeaseExpiresAt: null,
    pendingOperationId: null,
    updatedAt: "2026-07-10T10:01:30.000Z"
  };
  return {
    scope,
    expectedRevision: claimed.revision,
    expectedStates: ["scan_in_progress"] as const,
    evidence: {
      evidenceId: evidence.payload.evidenceId,
      evidenceDigestSha256: digest,
      evidence,
      recordedAt: "2026-07-10T10:01:30.000Z"
    },
    success: {
      next: success,
      operation: operationFor(
        success,
        "media.scan_completed",
        "scan_result_committed",
        claimed.revision
      )
    },
    evidenceConflict: {
      next: conflict,
      operation: operationFor(
        conflict,
        "media.scan_failed",
        "scan_failure_committed",
        claimed.revision,
        { reason: "scan_evidence_conflict" }
      )
    }
  };
}

function evidenceDigest(evidence: SignedMalwareEvidence): string {
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

function recordRow(values: readonly unknown[]): FakeRecordRow {
  return {
    tenant_id: String(values[0]),
    clinic_id: String(values[1]),
    media_id: String(values[2]),
    upload_id: String(values[3]),
    revision: Number(values[4]),
    bucket: String(values[5]),
    object_key: String(values[6]),
    region: String(values[7]),
    kind: values[8] as PrivateMediaRecord["kind"],
    declared_mime_type: String(values[9]),
    detected_mime_type: values[10] as string | null,
    expected_bytes: Number(values[11]),
    expected_sha256_hex: String(values[12]),
    authority_binding: String(values[13]),
    state: values[14] as PrivateMediaRecord["state"],
    expires_at: String(values[15]),
    object_version_id: values[16] as string | null,
    object_identity_sha256: values[17] as string | null,
    scan_attempts: Number(values[18]),
    last_evidence_id: values[19] as string | null,
    last_evidence_digest_sha256: values[20] as string | null,
    last_scanned_at: values[21] as string | null,
    inspection_lease_id: values[22] as string | null,
    inspection_lease_expires_at: values[23] as string | null,
    pending_operation_id: values[24] as string | null,
    delete_marker_version_id: values[25] as string | null,
    deleted_at: values[26] as string | null,
    recoverable_until: values[27] as string | null,
    legal_hold: Boolean(values[28]),
    created_at: String(values[29]),
    updated_at: String(values[30])
  };
}

function emptyState(): FakeState {
  return {
    mediaUploads: new Map(),
    records: new Map(),
    operations: new Map(),
    evidence: new Map(),
    audits: new Map(),
    outbox: new Map()
  };
}

function rows<Row extends Record<string, unknown>>(
  values: readonly Record<string, unknown>[]
): SqlQueryResult<Row> {
  return { rows: values as Row[] };
}

function scopeKey(value: PrivateMediaScope): string {
  return [value.tenantId, value.clinicId, value.mediaId, value.uploadId].join(":");
}

function scopeKeyFromRow(row: FakeRecordRow): string {
  return [row.tenant_id, row.clinic_id, row.media_id, row.upload_id].join(":");
}

function evidenceKey(tenantId: string, clinicId: string, evidenceId: string): string {
  return [tenantId, clinicId, evidenceId].join(":");
}

function mustRecord(value: FakeRecordRow | undefined): PrivateMediaRecord {
  assert.ok(value);
  return {
    revision: value.revision,
    scope: {
      tenantId: value.tenant_id,
      clinicId: value.clinic_id,
      mediaId: value.media_id,
      uploadId: value.upload_id
    },
    locator: { bucket: value.bucket, key: value.object_key, region: value.region },
    kind: value.kind,
    declaredMimeType: value.declared_mime_type,
    detectedMimeType: value.detected_mime_type,
    expectedBytes: value.expected_bytes,
    expectedSha256Hex: value.expected_sha256_hex,
    binding: value.authority_binding,
    state: value.state,
    expiresAt: value.expires_at,
    objectVersionId: value.object_version_id,
    objectIdentitySha256: value.object_identity_sha256,
    scanAttempts: value.scan_attempts,
    lastEvidenceId: value.last_evidence_id,
    lastEvidenceDigestSha256: value.last_evidence_digest_sha256,
    lastScannedAt: value.last_scanned_at,
    inspectionLeaseId: value.inspection_lease_id,
    inspectionLeaseExpiresAt: value.inspection_lease_expires_at,
    pendingOperationId: value.pending_operation_id,
    deleteMarkerVersionId: value.delete_marker_version_id,
    deletedAt: value.deleted_at,
    recoverableUntil: value.recoverable_until,
    legalHold: value.legal_hold,
    createdAt: value.created_at,
    updatedAt: value.updated_at
  };
}
