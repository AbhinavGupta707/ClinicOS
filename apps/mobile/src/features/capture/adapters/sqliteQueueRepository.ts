import { File } from "expo-file-system";
import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type {
  QueueStats,
  UploadQueueItem,
  UploadQueueRepository,
  UploadQueueStatus
} from "../types";
import { ProtectedCaptureDirectory } from "./protectedDirectory";
import { SecureCaptureKeyVault } from "./secureKeyVault";

interface QueueRow {
  id: string;
  kind: string;
  tenant_id: string;
  clinic_id: string;
  patient_id: string;
  encounter_id: string | null;
  blob_id: string;
  mime_type: string;
  byte_length: number;
  sha256_digest: string;
  captured_at: string;
  duration_ms: number | null;
  status: string;
  attempts: number;
  next_attempt_at: string;
  lease_owner: string | null;
  lease_expires_at: string | null;
  reservation_sequence: number;
  reservation_json: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

const databaseName = "capture-queue-v1.db";

export class ExpoSqlCipherQueueRepository implements UploadQueueRepository {
  readonly #root: ProtectedCaptureDirectory;
  readonly #keys: SecureCaptureKeyVault;
  #database: SQLiteDatabase | null = null;
  #directoryPath: string | null = null;
  #directoryUri: string | null = null;

  constructor(root: ProtectedCaptureDirectory, keys: SecureCaptureKeyVault) {
    this.#root = root;
    this.#keys = keys;
  }

  async initialize(): Promise<void> {
    if (process.env.EXPO_OS === "web") {
      throw new Error("Encrypted native SQLite queue is unavailable on web.");
    }
    const { directory, path } = await this.#root.prepare();
    this.#directoryPath = path;
    this.#directoryUri = directory.uri;
    const key = await this.#keys.getDatabaseKeyHex();
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error("Encrypted queue key is invalid.");
    const database = await openDatabaseAsync(databaseName, {}, path);
    await database.execAsync(`PRAGMA key = "x'${key}'";`);
    const cipher = await database.getFirstAsync<Record<string, unknown>>("PRAGMA cipher_version;");
    if (!cipher || Object.values(cipher).every((value) => typeof value !== "string" || !value)) {
      await database.closeAsync();
      throw new Error("SQLCipher is not active; protected queue initialization refused.");
    }
    await database.execAsync(`
      PRAGMA cipher_memory_security = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA secure_delete = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS capture_queue (
        id TEXT PRIMARY KEY NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('photo', 'audio')),
        tenant_id TEXT NOT NULL,
        clinic_id TEXT NOT NULL,
        patient_id TEXT NOT NULL,
        encounter_id TEXT,
        blob_id TEXT UNIQUE NOT NULL,
        mime_type TEXT NOT NULL,
        byte_length INTEGER NOT NULL CHECK (byte_length > 0),
        sha256_digest TEXT NOT NULL CHECK (length(sha256_digest) = 64),
        captured_at TEXT NOT NULL,
        duration_ms INTEGER,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL CHECK (attempts >= 0),
        next_attempt_at TEXT NOT NULL,
        lease_owner TEXT,
        lease_expires_at TEXT,
        reservation_sequence INTEGER NOT NULL DEFAULT 0 CHECK (reservation_sequence >= 0),
        reservation_json TEXT,
        last_error_code TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS capture_queue_due_idx
        ON capture_queue (status, next_attempt_at, created_at);
      CREATE INDEX IF NOT EXISTS capture_queue_binding_idx
        ON capture_queue (tenant_id, clinic_id, patient_id, kind);
    `);
    const columns = await database.getAllAsync<{ name: string }>("PRAGMA table_info(capture_queue);");
    if (!columns.some((column) => column.name === "reservation_sequence")) {
      await database.execAsync(
        "ALTER TABLE capture_queue ADD COLUMN reservation_sequence INTEGER NOT NULL DEFAULT 0;"
      );
    }
    await database.execAsync("PRAGMA user_version = 2;");
    this.#database = database;
  }

  async verifyIntegrity(): Promise<boolean> {
    const database = this.#db();
    const cipher = await database.getFirstAsync<Record<string, unknown>>("PRAGMA cipher_integrity_check;");
    const sqlite = await database.getFirstAsync<Record<string, unknown>>("PRAGMA integrity_check;");
    return pragmaOk(cipher) && pragmaOk(sqlite);
  }

  async recoverInterrupted(now: string): Promise<number> {
    const first = await this.#db().runAsync(
      `UPDATE capture_queue
       SET status = 'retry_wait', lease_owner = NULL, lease_expires_at = NULL,
           next_attempt_at = ?, last_error_code = 'APP_INACTIVE_INTERRUPTION', updated_at = ?
       WHERE status IN ('leased', 'reserved', 'uploading', 'completing')
         AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`,
      now,
      now,
      now
    );
    const second = await this.#db().runAsync(
      `UPDATE capture_queue
       SET status = 'purge_failed', lease_owner = NULL, lease_expires_at = NULL,
           last_error_code = 'LOCAL_PURGE_FAILED', updated_at = ?
       WHERE status = 'purging'`,
      now
    );
    return first.changes + second.changes;
  }

  async stats(): Promise<QueueStats> {
    const row = await this.#db().getFirstAsync<{ item_count: number; total_bytes: number }>(
      "SELECT count(*) AS item_count, coalesce(sum(byte_length), 0) AS total_bytes FROM capture_queue"
    );
    return { itemCount: Number(row?.item_count ?? 0), totalBytes: Number(row?.total_bytes ?? 0) };
  }

  async list(): Promise<readonly UploadQueueItem[]> {
    const rows = await this.#db().getAllAsync<QueueRow>(
      "SELECT * FROM capture_queue ORDER BY created_at DESC"
    );
    return rows.map(fromRow);
  }

  async get(id: string): Promise<UploadQueueItem | null> {
    const row = await this.#db().getFirstAsync<QueueRow>(
      "SELECT * FROM capture_queue WHERE id = ?",
      id
    );
    return row ? fromRow(row) : null;
  }

  async insert(item: UploadQueueItem): Promise<void> {
    await this.#db().runAsync(
      `INSERT INTO capture_queue (
        id, kind, tenant_id, clinic_id, patient_id, encounter_id, blob_id, mime_type,
        byte_length, sha256_digest, captured_at, duration_ms, status, attempts,
        next_attempt_at, lease_owner, lease_expires_at, reservation_sequence, reservation_json,
        last_error_code, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...toParams(item)
    );
  }

  async update(item: UploadQueueItem): Promise<void> {
    const result = await this.#db().runAsync(
      `UPDATE capture_queue SET
        kind = ?, tenant_id = ?, clinic_id = ?, patient_id = ?, encounter_id = ?,
        blob_id = ?, mime_type = ?, byte_length = ?, sha256_digest = ?, captured_at = ?,
        duration_ms = ?, status = ?, attempts = ?, next_attempt_at = ?, lease_owner = ?,
        lease_expires_at = ?, reservation_sequence = ?, reservation_json = ?, last_error_code = ?,
        created_at = ?, updated_at = ?
       WHERE id = ?`,
      ...toParams(item).slice(1),
      item.id
    );
    if (result.changes !== 1) throw new Error("Encrypted queue update lost its target row.");
  }

  async delete(id: string): Promise<void> {
    await this.#db().runAsync("DELETE FROM capture_queue WHERE id = ?", id);
  }

  async claimNext(input: {
    now: string;
    leaseOwner: string;
    leaseExpiresAt: string;
  }): Promise<UploadQueueItem | null> {
    let claimed: UploadQueueItem | null = null;
    await this.#db().withExclusiveTransactionAsync(async (transaction) => {
      const row = await transaction.getFirstAsync<QueueRow>(
        `SELECT * FROM capture_queue
         WHERE status IN ('queued', 'retry_wait') AND next_attempt_at <= ?
         ORDER BY next_attempt_at ASC, created_at ASC LIMIT 1`,
        input.now
      );
      if (!row) return;
      const result = await transaction.runAsync(
        `UPDATE capture_queue
         SET status = 'leased', attempts = attempts + 1, lease_owner = ?,
             lease_expires_at = ?, updated_at = ?
         WHERE id = ? AND status IN ('queued', 'retry_wait')`,
        input.leaseOwner,
        input.leaseExpiresAt,
        input.now,
        row.id
      );
      if (result.changes !== 1) return;
      const next = await transaction.getFirstAsync<QueueRow>(
        "SELECT * FROM capture_queue WHERE id = ?",
        row.id
      );
      claimed = next ? fromRow(next) : null;
    });
    return claimed;
  }

  async shutdownAndDelete(): Promise<void> {
    const database = this.#database;
    const directoryPath = this.#directoryPath;
    const directoryUri = this.#directoryUri;
    this.#database = null;
    const failures: unknown[] = [];
    if (database) {
      await database.execAsync("PRAGMA wal_checkpoint(TRUNCATE);").catch((error) => failures.push(error));
      await database.closeAsync().catch((error) => failures.push(error));
    }
    if (!directoryPath || !directoryUri) {
      failures.push(new Error("Protected database directory was not initialized."));
    } else {
      await deleteDatabaseAsync(databaseName, directoryPath).catch((error) => failures.push(error));
      for (const name of databaseFiles()) {
        const file = new File(directoryUri, name);
        if (file.exists) {
          try {
            file.delete();
          } catch (error) {
            failures.push(error);
          }
        }
      }
      if (databaseFiles().some((name) => new File(directoryUri, name).exists)) {
        failures.push(new Error("Protected SQLCipher database deletion could not be verified."));
      }
    }
    if (failures.length > 0) {
      throw new Error("Protected SQLCipher database shutdown and deletion did not complete.");
    }
  }

  #db(): SQLiteDatabase {
    if (!this.#database) throw new Error("Encrypted queue repository is not initialized.");
    return this.#database;
  }
}

function databaseFiles(): readonly string[] {
  return [databaseName, `${databaseName}-wal`, `${databaseName}-shm`, `${databaseName}-journal`];
}

function toParams(item: UploadQueueItem): (string | number | null)[] {
  return [
    item.id,
    item.kind,
    item.binding.tenantId,
    item.binding.clinicId,
    item.binding.patientId,
    item.binding.encounterId,
    item.blobId,
    item.mimeType,
    item.byteLength,
    item.sha256Digest,
    item.capturedAt,
    item.durationMs,
    item.status,
    item.attempts,
    item.nextAttemptAt,
    item.leaseOwner,
    item.leaseExpiresAt,
    item.reservationSequence,
    item.reservation ? JSON.stringify(item.reservation) : null,
    item.lastErrorCode,
    item.createdAt,
    item.updatedAt
  ];
}

function fromRow(row: QueueRow): UploadQueueItem {
  const status = parseStatus(row.status);
  const kind = row.kind === "photo" || row.kind === "audio" ? row.kind : null;
  if (
    !kind ||
    !/^[a-f0-9]{64}$/i.test(row.sha256_digest) ||
    !Number.isSafeInteger(row.reservation_sequence) ||
    row.reservation_sequence < 0 ||
    !Number.isSafeInteger(row.byte_length) ||
    row.byte_length < 1 ||
    !Number.isSafeInteger(row.attempts) ||
    row.attempts < 0
  ) {
    throw new Error("Encrypted queue row failed validation.");
  }
  const reservation = row.reservation_json
    ? (JSON.parse(row.reservation_json) as UploadQueueItem["reservation"])
    : null;
  if (reservation && !isReservation(reservation)) {
    throw new Error("Encrypted queue reservation failed validation.");
  }
  return {
    id: row.id,
    kind,
    binding: {
      tenantId: row.tenant_id,
      clinicId: row.clinic_id,
      patientId: row.patient_id,
      encounterId: row.encounter_id
    },
    blobId: row.blob_id,
    mimeType: parseMime(row.mime_type),
    byteLength: row.byte_length,
    sha256Digest: row.sha256_digest,
    capturedAt: row.captured_at,
    durationMs: row.duration_ms,
    status,
    attempts: row.attempts,
    nextAttemptAt: row.next_attempt_at,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at,
    reservationSequence: row.reservation_sequence,
    reservation,
    lastErrorCode: parseDiagnosticCode(row.last_error_code),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function parseStatus(value: string): UploadQueueStatus {
  const statuses: UploadQueueStatus[] = [
    "queued",
    "leased",
    "reserved",
    "uploading",
    "completing",
    "retry_wait",
    "manual_retry_required",
    "quarantined",
    "purging",
    "purge_failed"
  ];
  if (!statuses.includes(value as UploadQueueStatus)) throw new Error("Encrypted queue status is invalid.");
  return value as UploadQueueStatus;
}

function parseMime(value: string): UploadQueueItem["mimeType"] {
  if (value === "image/jpeg" || value === "image/png" || value === "audio/mp4") return value;
  throw new Error("Encrypted queue MIME type is invalid.");
}

function isReservation(value: NonNullable<UploadQueueItem["reservation"]>): boolean {
  if (typeof value !== "object" || value === null || typeof value.target !== "object" || value.target === null) {
    return false;
  }
  return (
    typeof value.uploadId === "string" &&
    value.target.method === "PUT" &&
    typeof value.target.uploadUrl === "string" &&
    typeof value.target.expiresAt === "string" &&
    Number.isSafeInteger(value.target.maxBytes) &&
    typeof value.target.requiredHeaders === "object" &&
    value.target.requiredHeaders !== null
  );
}

function parseDiagnosticCode(value: string | null): UploadQueueItem["lastErrorCode"] {
  if (value === null) return null;
  const values: NonNullable<UploadQueueItem["lastErrorCode"]>[] = [
    "CAPTURE_QUEUED",
    "UPLOAD_CONFIRMED_AND_PURGED",
    "NETWORK_OFFLINE",
    "UPLOAD_RETRY_SCHEDULED",
    "UPLOAD_MANUAL_RETRY_REQUIRED",
    "UPLOAD_OUTCOME_UNCERTAIN",
    "CAPTURE_CORRUPT",
    "CAPTURE_CONSENT_REVOKED",
    "SESSION_REVOKED_PURGE_REQUIRED",
    "LOCAL_PURGE_FAILED",
    "QUEUE_RECOVERED",
    "QUEUE_INTEGRITY_FAILED",
    "APP_INACTIVE_INTERRUPTION"
  ];
  if (!values.includes(value as NonNullable<UploadQueueItem["lastErrorCode"]>)) {
    throw new Error("Encrypted queue diagnostic code is invalid.");
  }
  return value as NonNullable<UploadQueueItem["lastErrorCode"]>;
}

function pragmaOk(row: Record<string, unknown> | null): boolean {
  return Boolean(row && Object.values(row).some((value) => String(value).toLowerCase() === "ok"));
}
