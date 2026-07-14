import type { ConsentEnforcementState, MediaUploadTarget, UUID } from "../../lib/apiClient.ts";

export type CaptureKind = "photo" | "audio";

export interface CaptureBinding {
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  encounterId: UUID | null;
}

export interface CaptureDraft {
  kind: CaptureKind;
  binding: CaptureBinding;
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "audio/mp4";
  capturedAt: string;
  durationMs: number | null;
}

export type UploadQueueStatus =
  | "queued"
  | "leased"
  | "reserved"
  | "uploading"
  | "completing"
  | "retry_wait"
  | "manual_retry_required"
  | "quarantined"
  | "purging"
  | "purge_failed";

export interface UploadReservationState {
  uploadId: UUID;
  target: MediaUploadTarget;
}

export interface UploadQueueItem {
  id: string;
  kind: CaptureKind;
  binding: CaptureBinding;
  blobId: string;
  mimeType: CaptureDraft["mimeType"];
  byteLength: number;
  sha256Digest: string;
  capturedAt: string;
  durationMs: number | null;
  status: UploadQueueStatus;
  attempts: number;
  nextAttemptAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  reservationSequence: number;
  reservation: UploadReservationState | null;
  lastErrorCode: QueueDiagnosticCode | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueStats {
  itemCount: number;
  totalBytes: number;
}

export interface UploadQueueRepository {
  initialize(): Promise<void>;
  verifyIntegrity(): Promise<boolean>;
  recoverInterrupted(now: string): Promise<number>;
  stats(): Promise<QueueStats>;
  list(): Promise<readonly UploadQueueItem[]>;
  get(id: string): Promise<UploadQueueItem | null>;
  insert(item: UploadQueueItem): Promise<void>;
  update(item: UploadQueueItem): Promise<void>;
  delete(id: string): Promise<void>;
  claimNext(input: {
    now: string;
    leaseOwner: string;
    leaseExpiresAt: string;
  }): Promise<UploadQueueItem | null>;
  shutdownAndDelete(): Promise<void>;
}

export interface EncryptedCaptureBlobStore {
  initialize(): Promise<void>;
  availableBytes(): Promise<number>;
  put(id: string, plaintext: Uint8Array): Promise<void>;
  get(id: string): Promise<Uint8Array>;
  delete(id: string): Promise<void>;
  quarantine(id: string): Promise<void>;
  purgeAll(): Promise<void>;
  shutdownAndDelete(): Promise<void>;
}

export interface CaptureDigestProvider {
  sha256Hex(bytes: Uint8Array): Promise<string>;
  randomId(): string;
}

export interface QueueClock {
  now(): Date;
}

export interface NetworkReachability {
  isInternetReachable(): Promise<boolean>;
}

export interface CaptureAuthorization {
  consentForPatient(patientId: UUID): Promise<ConsentEnforcementState>;
  assertUploadAllowed(item: UploadQueueItem, signal: AbortSignal): Promise<void>;
}

export interface MediaUploadReceipt {
  mediaAssetId: UUID;
  scanStatus: string;
}

export interface CaptureUploadTransport {
  reserve(
    item: UploadQueueItem,
    idempotencyKey: string,
    signal: AbortSignal
  ): Promise<UploadReservationState>;
  upload(
    item: UploadQueueItem,
    reservation: UploadReservationState,
    bytes: Uint8Array,
    signal: AbortSignal
  ): Promise<void>;
  complete(
    item: UploadQueueItem,
    reservation: UploadReservationState,
    idempotencyKey: string,
    signal: AbortSignal
  ): Promise<MediaUploadReceipt>;
}

export type QueueDiagnosticCode =
  | "CAPTURE_QUEUED"
  | "UPLOAD_CONFIRMED_AND_PURGED"
  | "NETWORK_OFFLINE"
  | "UPLOAD_RETRY_SCHEDULED"
  | "UPLOAD_MANUAL_RETRY_REQUIRED"
  | "UPLOAD_OUTCOME_UNCERTAIN"
  | "CAPTURE_CORRUPT"
  | "CAPTURE_CONSENT_REVOKED"
  | "SESSION_REVOKED_PURGE_REQUIRED"
  | "LOCAL_PURGE_FAILED"
  | "QUEUE_RECOVERED"
  | "QUEUE_INTEGRITY_FAILED"
  | "APP_INACTIVE_INTERRUPTION";

export interface SafeDiagnosticEvent {
  code: QueueDiagnosticCode;
  at: string;
  attemptCount?: number;
  queueDepth?: number;
  captureKind?: CaptureKind;
}

export interface SafeDiagnosticSink {
  record(event: SafeDiagnosticEvent): void;
}

export interface QueueEvent {
  code: QueueDiagnosticCode;
  itemId: string | null;
}
