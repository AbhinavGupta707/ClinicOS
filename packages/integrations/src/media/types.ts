export type ClinicalMediaKind =
  "intraoral_photo" | "xray" | "document" | "audio_chunk" | "generated_document";

export type PrivateMediaState =
  | "reserved"
  | "upload_verified"
  | "scan_in_progress"
  | "available"
  | "quarantined"
  | "scan_failed"
  | "deleted"
  | "purged";

export type MalwareVerdict = "clean" | "malicious" | "suspicious" | "error";

export interface PrivateMediaScope {
  readonly tenantId: string;
  readonly clinicId: string;
  readonly mediaId: string;
  readonly uploadId: string;
}

export interface PrivateMediaAuthority extends PrivateMediaScope {
  readonly actorId: string;
  readonly correlationId: string;
}

export interface S3ObjectLocator {
  readonly bucket: string;
  readonly key: string;
  readonly region: string;
}

export interface SignedTransportRequest {
  readonly method: "PUT" | "GET";
  readonly url: string;
  readonly expiresAt: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
}

export interface S3PresigningTransport {
  signPutObject(
    input: Readonly<{
      locator: S3ObjectLocator;
      expiresAt: string;
      contentLength: number;
      contentType: string;
      checksumSha256Base64: string;
      metadata: Readonly<Record<string, string>>;
      tags: Readonly<Record<string, string>>;
    }>
  ): Promise<SignedTransportRequest>;

  signGetObject(
    input: Readonly<{
      locator: S3ObjectLocator;
      versionId: string;
      expiresAt: string;
      responseContentType: string;
    }>
  ): Promise<SignedTransportRequest>;
}

export interface S3ObjectSnapshot {
  readonly contentLength: number;
  readonly contentType: string;
  readonly checksumSha256Hex: string;
  readonly versionId: string;
  readonly etag: string | null;
  readonly lastModifiedAt: string;
  readonly serverSideEncryption: "aws:kms" | string | null;
  readonly kmsKeyId: string | null;
  readonly metadata: Readonly<Record<string, string>>;
  readonly tags: Readonly<Record<string, string>>;
  readonly multipartStatus: "none" | "completed" | "incomplete";
}

export interface S3PrivateObjectTransport {
  headObject(locator: S3ObjectLocator): Promise<S3ObjectSnapshot | null>;
  readObjectRange(
    input: Readonly<{
      locator: S3ObjectLocator;
      versionId: string;
      start: number;
      endInclusive: number;
    }>
  ): Promise<Uint8Array>;
  putObject(
    input: Readonly<{
      locator: S3ObjectLocator;
      body: Uint8Array;
      contentType: string;
      checksumSha256Hex: string;
      metadata: Readonly<Record<string, string>>;
      tags: Readonly<Record<string, string>>;
    }>
  ): Promise<S3ObjectSnapshot>;
  createDeleteMarker(locator: S3ObjectLocator): Promise<
    Readonly<{
      deleteMarkerVersionId: string;
      deletedAt: string;
    }>
  >;
  removeDeleteMarker(
    input: Readonly<{
      locator: S3ObjectLocator;
      deleteMarkerVersionId: string;
    }>
  ): Promise<void>;
  deleteObjectVersion(
    input: Readonly<{
      locator: S3ObjectLocator;
      versionId: string;
    }>
  ): Promise<void>;
}

export interface DetectedMediaFile {
  readonly mimeType: string;
  readonly extension: string;
}

export interface MagicByteDetector {
  detect(bytes: Uint8Array): Promise<DetectedMediaFile | null>;
}

export interface SignedMalwareEvidencePayload {
  readonly evidenceId: string;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly mediaId: string;
  readonly uploadId: string;
  readonly objectIdentitySha256: string;
  readonly objectVersionId: string;
  readonly contentSha256Hex: string;
  readonly contentLength: number;
  readonly detectedMimeType: string;
  readonly verdict: MalwareVerdict;
  readonly scanner: string;
  readonly engineVersion: string;
  readonly definitionsVersion: string;
  readonly scannedAt: string;
}

export interface SignedMalwareEvidence {
  readonly payload: SignedMalwareEvidencePayload;
  readonly signature: Readonly<{
    keyId: string;
    algorithm: "RSASSA_PSS_SHA_256" | "ECDSA_SHA_256";
    valueBase64: string;
  }>;
}

export interface MalwareScannerTransport {
  scan(
    input: Readonly<{
      authority: PrivateMediaAuthority;
      locator: S3ObjectLocator;
      objectVersionId: string;
      objectIdentitySha256: string;
      contentSha256Hex: string;
      contentLength: number;
      detectedMimeType: string;
      attempt: number;
    }>
  ): Promise<SignedMalwareEvidence>;
}

/** A production implementation is expected to use KMS Verify or an equivalent approved verifier. */
export interface MalwareEvidenceSignatureVerifier {
  verify(evidence: SignedMalwareEvidence): Promise<boolean>;
}

export interface PrivateMediaRecord {
  readonly revision: number;
  readonly scope: PrivateMediaScope;
  readonly locator: S3ObjectLocator;
  readonly kind: ClinicalMediaKind;
  readonly declaredMimeType: string;
  readonly detectedMimeType: string | null;
  readonly expectedBytes: number;
  readonly expectedSha256Hex: string;
  readonly binding: string;
  readonly state: PrivateMediaState;
  readonly expiresAt: string;
  readonly objectVersionId: string | null;
  readonly objectIdentitySha256: string | null;
  readonly scanAttempts: number;
  readonly lastEvidenceId: string | null;
  readonly lastEvidenceDigestSha256: string | null;
  readonly lastScannedAt: string | null;
  readonly inspectionLeaseId: string | null;
  readonly inspectionLeaseExpiresAt: string | null;
  readonly deleteMarkerVersionId: string | null;
  readonly deletedAt: string | null;
  readonly recoverableUntil: string | null;
  readonly legalHold: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PrivateMediaStateStore {
  create(record: PrivateMediaRecord): Promise<"created" | "replayed" | "conflict">;
  get(scope: PrivateMediaScope): Promise<PrivateMediaRecord | null>;
  compareAndSwap(
    input: Readonly<{
      scope: PrivateMediaScope;
      expectedRevision: number;
      expectedStates: readonly PrivateMediaState[];
      next: PrivateMediaRecord;
    }>
  ): Promise<boolean>;
}

export interface MalwareEvidenceStore {
  append(
    input: Readonly<{
      scope: PrivateMediaScope;
      evidenceId: string;
      evidenceDigestSha256: string;
      evidence: SignedMalwareEvidence;
      recordedAt: string;
    }>
  ): Promise<"recorded" | "replayed" | "conflict">;
}

export type PrivateMediaAuditAction =
  | "media.upload_reserved"
  | "media.upload_verified"
  | "media.upload_rejected"
  | "media.scan_started"
  | "media.scan_completed"
  | "media.scan_failed"
  | "media.access_signed"
  | "media.deleted"
  | "media.restored"
  | "media.purged";

export interface PrivateMediaAuditEvent {
  readonly eventId: string;
  readonly action: PrivateMediaAuditAction;
  readonly occurredAt: string;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly mediaId: string;
  readonly uploadId: string;
  readonly actorId: string;
  readonly correlationId: string;
  readonly outcome: "succeeded" | "denied" | "failed";
  readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
}

/** Append-only authoritative audit sink; diagnostic logs are not a valid implementation. */
export interface PrivateMediaAuditSink {
  append(event: PrivateMediaAuditEvent): Promise<void>;
}

export interface PublicSignedMediaRequest<TMethod extends "PUT" | "GET" = "PUT" | "GET"> {
  readonly method: TMethod;
  readonly url: string;
  readonly expiresAt: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
  readonly maxBytes?: number;
}

export interface PublicMediaReservation {
  readonly mediaId: string;
  readonly uploadId: string;
  readonly state: "reserved";
  readonly expiresAt: string;
  readonly upload: PublicSignedMediaRequest<"PUT">;
}

export interface PublicVerifiedMedia {
  readonly mediaId: string;
  readonly uploadId: string;
  readonly state: "quarantined";
  readonly contentLength: number;
  readonly sha256Digest: string;
  readonly detectedMimeType: string;
  readonly storedAt: string;
}

export interface PublicMediaInspection {
  readonly mediaId: string;
  readonly uploadId: string;
  readonly state: "available" | "quarantined" | "scan_failed";
  readonly scanStatus: "clean" | "quarantined" | "failed";
  readonly evidenceId: string | null;
  readonly scannedAt: string;
}

export interface PublicMediaLifecycleReceipt {
  readonly mediaId: string;
  readonly uploadId: string;
  readonly state: "deleted" | "quarantined" | "purged";
  readonly occurredAt: string;
  readonly recoverableUntil: string | null;
}
