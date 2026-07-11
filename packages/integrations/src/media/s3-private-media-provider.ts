import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { PrivateMediaError } from "./errors.js";
import {
  privateMediaChildEffectId,
  privateMediaOperationSemanticFingerprint
} from "./operation-fingerprint.js";
import type {
  ClinicalMediaKind,
  DetectedMediaFile,
  MagicByteDetector,
  MalwareEvidenceSignatureVerifier,
  MalwareScannerTransport,
  PrivateMediaAtomicOperation,
  PrivateMediaAtomicPersistence,
  PrivateMediaAuditAction,
  PrivateMediaAuditEvent,
  PrivateMediaAuthority,
  PrivateMediaDeleteReasonCode,
  PrivateMediaRecord,
  PrivateMediaReconciliationIntentKind,
  PrivateMediaRestoreReasonCode,
  PrivateMediaScope,
  PrivateMediaState,
  PublicMediaInspection,
  PublicMediaLifecycleReceipt,
  PublicMediaReservation,
  PublicSignedMediaRequest,
  PublicVerifiedMedia,
  S3ObjectLocator,
  S3ObjectSnapshot,
  S3PresigningTransport,
  S3PrivateObjectTransport,
  SignedMalwareEvidence,
  SignedMalwareEvidencePayload,
  SignedTransportRequest
} from "./types.js";

const HEX_SHA256 = /^[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const SAFE_PROVIDER_KEY_ID = /^[A-Za-z0-9][A-Za-z0-9:/_.-]{0,511}$/u;
const SAFE_ENVIRONMENT = /^[a-z0-9][a-z0-9-]{0,39}$/u;
const PRIVATE_METADATA_BINDING = "clinicos-binding";
const QUARANTINE_TAG = "clinicos_state";
const UPLOAD_TAG_VALUE = "quarantine";

export interface S3PrivateMediaProviderConfig {
  readonly environment: string;
  readonly bucket: string;
  readonly region: string;
  readonly kmsKeyId: string;
  readonly bindingSecret: string | Uint8Array;
  readonly presignedEndpointAllowlist: readonly string[];
  readonly scannerSigningKeyIds: readonly string[];
  readonly maxUploadTtlSeconds?: number;
  readonly maxAccessTtlSeconds?: number;
  readonly maxBytes?: number;
  readonly magicReadBytes?: number;
  readonly inspectionLeaseSeconds?: number;
  readonly maxScanAttempts?: number;
  readonly restoreWindowSeconds?: number;
  readonly maxScannerClockSkewSeconds?: number;
}

export interface S3PrivateMediaProviderDependencies {
  readonly objects: S3PrivateObjectTransport;
  readonly signer: S3PresigningTransport;
  readonly detector: MagicByteDetector;
  readonly scanner: MalwareScannerTransport;
  readonly evidenceVerifier: MalwareEvidenceSignatureVerifier;
  readonly persistence: PrivateMediaAtomicPersistence;
  readonly now?: () => Date;
  readonly randomId?: () => string;
  readonly randomKeyBytes?: (size: number) => Uint8Array;
}

export interface ReservePrivateMediaUploadInput {
  readonly authority: PrivateMediaAuthority;
  readonly internalObjectKey: string;
  readonly kind: ClinicalMediaKind;
  readonly declaredMimeType: string;
  readonly expectedBytes: number;
  readonly expectedSha256Hex: string;
  readonly expiresAt: string;
}

export class S3PrivateMediaProvider {
  readonly #config: Required<
    Pick<
      S3PrivateMediaProviderConfig,
      | "maxUploadTtlSeconds"
      | "maxAccessTtlSeconds"
      | "maxBytes"
      | "magicReadBytes"
      | "inspectionLeaseSeconds"
      | "maxScanAttempts"
      | "restoreWindowSeconds"
      | "maxScannerClockSkewSeconds"
    >
  > &
    Pick<
      S3PrivateMediaProviderConfig,
      | "environment"
      | "bucket"
      | "region"
      | "kmsKeyId"
      | "presignedEndpointAllowlist"
      | "scannerSigningKeyIds"
    >;
  readonly #bindingSecret: Buffer;
  readonly #objects: S3PrivateObjectTransport;
  readonly #signer: S3PresigningTransport;
  readonly #detector: MagicByteDetector;
  readonly #scanner: MalwareScannerTransport;
  readonly #evidenceVerifier: MalwareEvidenceSignatureVerifier;
  readonly #persistence: PrivateMediaAtomicPersistence;
  readonly #now: () => Date;
  readonly #randomId: () => string;
  readonly #randomKeyBytes: (size: number) => Uint8Array;

  constructor(
    config: S3PrivateMediaProviderConfig,
    dependencies: S3PrivateMediaProviderDependencies
  ) {
    validateProviderConfig(config);
    this.#config = {
      environment: config.environment,
      bucket: config.bucket,
      region: config.region,
      kmsKeyId: config.kmsKeyId,
      presignedEndpointAllowlist: Object.freeze(
        config.presignedEndpointAllowlist.map((endpoint) => new URL(endpoint).origin)
      ),
      scannerSigningKeyIds: Object.freeze([...config.scannerSigningKeyIds]),
      maxUploadTtlSeconds: config.maxUploadTtlSeconds ?? 600,
      maxAccessTtlSeconds: config.maxAccessTtlSeconds ?? 300,
      maxBytes: config.maxBytes ?? 100 * 1024 * 1024,
      magicReadBytes: config.magicReadBytes ?? 8_192,
      inspectionLeaseSeconds: config.inspectionLeaseSeconds ?? 120,
      maxScanAttempts: config.maxScanAttempts ?? 5,
      restoreWindowSeconds: config.restoreWindowSeconds ?? 30 * 24 * 60 * 60,
      maxScannerClockSkewSeconds: config.maxScannerClockSkewSeconds ?? 300
    };
    this.#bindingSecret = Buffer.from(config.bindingSecret);
    this.#objects = dependencies.objects;
    this.#signer = dependencies.signer;
    this.#detector = dependencies.detector;
    this.#scanner = dependencies.scanner;
    this.#evidenceVerifier = dependencies.evidenceVerifier;
    this.#persistence = dependencies.persistence;
    this.#now = dependencies.now ?? (() => new Date());
    this.#randomId = dependencies.randomId ?? randomUUID;
    this.#randomKeyBytes = dependencies.randomKeyBytes ?? randomBytes;
  }

  allocateInternalObjectKey(scope: PrivateMediaScope): string {
    validateScope(scope);
    const nonce = Buffer.from(this.#randomKeyBytes(32)).toString("base64url");
    if (nonce.length < 40 || !/^[A-Za-z0-9_-]+$/u.test(nonce)) {
      throw new PrivateMediaError({
        code: "provider_error",
        message: "The private media key generator returned invalid entropy."
      });
    }
    return [
      this.#config.environment,
      "tenants",
      scope.tenantId,
      "clinics",
      scope.clinicId,
      "media",
      scope.mediaId,
      scope.uploadId,
      nonce
    ].join("/");
  }

  scopeFromInternalObjectKey(key: string): PrivateMediaScope {
    const segments = key.split("/");
    if (
      segments.length !== 9 ||
      segments[0] !== this.#config.environment ||
      segments[1] !== "tenants" ||
      segments[3] !== "clinics" ||
      segments[5] !== "media" ||
      !segments[8] ||
      !/^[A-Za-z0-9_-]{40,128}$/u.test(segments[8])
    ) {
      throw new PrivateMediaError({
        code: "authority_mismatch",
        message: "The private media object does not belong to the requested authority."
      });
    }
    const scope = {
      tenantId: segments[2] ?? "",
      clinicId: segments[4] ?? "",
      mediaId: segments[6] ?? "",
      uploadId: segments[7] ?? ""
    };
    validateScope(scope);
    return scope;
  }

  async reserveUpload(input: ReservePrivateMediaUploadInput): Promise<PublicMediaReservation> {
    const now = this.#now();
    validateAuthority(input.authority);
    this.#assertObjectKeyAuthority(input.internalObjectKey, input.authority);
    const mimeType = normalizedMimeType(input.declaredMimeType);
    assertKindMimeType(input.kind, mimeType);
    assertByteBudget(input.expectedBytes, this.#config.maxBytes);
    const sha256Hex = normalizedSha256(input.expectedSha256Hex);
    const expiresAt = boundedFutureExpiry(
      input.expiresAt,
      now,
      this.#config.maxUploadTtlSeconds,
      "upload"
    );
    const binding = this.#objectBinding(input.authority, sha256Hex, input.expectedBytes, mimeType);
    const locator = this.#locator(input.internalObjectKey);
    const createdAt = now.toISOString();
    const record: PrivateMediaRecord = {
      revision: 1,
      scope: scopeOnly(input.authority),
      locator,
      kind: input.kind,
      declaredMimeType: mimeType,
      detectedMimeType: null,
      expectedBytes: input.expectedBytes,
      expectedSha256Hex: sha256Hex,
      binding,
      state: "reserved",
      expiresAt,
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
      createdAt,
      updatedAt: createdAt
    };

    const reserveOperation = this.#atomicOperation({
      authority: input.authority,
      expectedRevision: null,
      targetRevision: record.revision,
      action: "media.upload_reserved",
      outcome: "succeeded",
      metadata: {
        kind: input.kind,
        mimeType,
        expectedBytes: input.expectedBytes,
        expiresAt
      },
      intentKind: "upload_reservation_created",
      intentPayload: {
        expectedBytes: input.expectedBytes,
        expectedSha256Hex: sha256Hex,
        expiresAt,
        state: record.state
      }
    });
    const createResult = await this.#persistence.reserve({
      record,
      operation: reserveOperation
    });
    if (createResult === "operation_conflict") throw operationConflictError();
    if (createResult === "conflict") {
      await this.#recordAuditAndIntent({
        authority: input.authority,
        action: "media.upload_rejected",
        outcome: "denied",
        metadata: { reason: "reservation_conflict" },
        intentKind: "security_audit_recorded",
        intentPayload: { reason: "reservation_conflict" },
        discriminator: `reservation_conflict:${input.authority.correlationId}`
      });
      throw new PrivateMediaError({
        code: "reservation_conflict",
        message: "A different private media reservation already uses this identity."
      });
    }
    if (createResult === "replayed") {
      const existing = await this.#requireRecord(input.authority);
      assertSameReservation(existing, record);
    }

    const auditUploadSigningFailure = async (
      failureClass: "invalid_signer_response" | "signer_transport_failure"
    ): Promise<void> => {
      await this.#recordAuditAndIntent({
        authority: input.authority,
        action: "media.upload_signing_failed",
        outcome: "failed",
        metadata: { failureClass, method: "PUT" },
        intentKind: "upload_signing_failed",
        intentPayload: { failureClass, method: "PUT", state: record.state },
        discriminator: `upload-signing-failed:${reserveOperation.operationId}:${failureClass}`
      });
    };
    let transportRequest: SignedTransportRequest;
    try {
      transportRequest = await this.#signer.signPutObject({
        locator,
        expiresAt,
        contentLength: input.expectedBytes,
        contentType: mimeType,
        checksumSha256Base64: Buffer.from(sha256Hex, "hex").toString("base64"),
        metadata: { [PRIVATE_METADATA_BINDING]: binding },
        tags: { [QUARANTINE_TAG]: UPLOAD_TAG_VALUE }
      });
    } catch {
      await auditUploadSigningFailure("signer_transport_failure");
      throw sanitizedSignerTransportError();
    }
    let upload: PublicSignedMediaRequest<"PUT">;
    try {
      upload = publicSignedRequest(transportRequest, {
        method: "PUT",
        requestedExpiresAt: expiresAt,
        now,
        allowedOrigins: this.#config.presignedEndpointAllowlist,
        locator,
        objectVersionId: null,
        requiredHeaders: {
          "content-type": mimeType,
          "content-length": String(input.expectedBytes),
          "x-amz-checksum-sha256": Buffer.from(sha256Hex, "hex").toString("base64"),
          "x-amz-meta-clinicos-binding": binding,
          "x-amz-tagging": `${QUARANTINE_TAG}=${UPLOAD_TAG_VALUE}`,
          "x-amz-server-side-encryption": "aws:kms",
          "x-amz-server-side-encryption-aws-kms-key-id": this.#config.kmsKeyId
        }
      });
    } catch (error) {
      await auditUploadSigningFailure("invalid_signer_response");
      if (error instanceof PrivateMediaError && error.code === "provider_error") throw error;
      throw sanitizedSignerTransportError();
    }
    return Object.freeze({
      mediaId: input.authority.mediaId,
      uploadId: input.authority.uploadId,
      state: "reserved",
      expiresAt,
      upload: Object.freeze({ ...upload, maxBytes: input.expectedBytes })
    });
  }

  async ingestProxiedUpload(
    input: Readonly<{
      authority: PrivateMediaAuthority;
      body: Uint8Array;
      contentType: string;
    }>
  ): Promise<PublicVerifiedMedia> {
    const record = await this.#requireRecord(input.authority);
    this.#assertReservationOpen(record, this.#now());
    if (input.body.byteLength !== record.expectedBytes) {
      throw integrityError("Uploaded media size did not match its reservation.");
    }
    const digest = createHash("sha256").update(input.body).digest("hex");
    if (!safeEqual(digest, record.expectedSha256Hex)) {
      throw integrityError("Uploaded media digest did not match its reservation.");
    }
    if (normalizedMimeType(input.contentType) !== record.declaredMimeType) {
      throw integrityError("Uploaded media type did not match its reservation.");
    }
    await this.#objects.putObject({
      locator: record.locator,
      body: input.body,
      contentType: record.declaredMimeType,
      checksumSha256Hex: record.expectedSha256Hex,
      metadata: { [PRIVATE_METADATA_BINDING]: record.binding },
      tags: { [QUARANTINE_TAG]: UPLOAD_TAG_VALUE }
    });
    return this.verifyUploadCompletion(input.authority);
  }

  async verifyUploadCompletion(authority: PrivateMediaAuthority): Promise<PublicVerifiedMedia> {
    const now = this.#now();
    let record = await this.#requireRecord(authority);
    if (record.state === "reserved") this.#assertReservationOpen(record, now);
    if (
      [
        "delete_in_progress",
        "deleted",
        "restore_in_progress",
        "purge_in_progress",
        "purged"
      ].includes(record.state)
    ) {
      throw new PrivateMediaError({ code: "quarantined", message: "Media is unavailable." });
    }
    const snapshot = await this.#objects.headObject(record.locator);
    if (!snapshot) {
      throw new PrivateMediaError({
        code: "object_missing",
        message: "The reserved media object has not completed upload.",
        retryable: true
      });
    }
    try {
      this.#validateSnapshot(record, snapshot);
      const prefix = await this.#objects.readObjectRange({
        locator: record.locator,
        versionId: snapshot.versionId,
        start: 0,
        endInclusive: Math.min(snapshot.contentLength, this.#config.magicReadBytes) - 1
      });
      if (prefix.byteLength < Math.min(snapshot.contentLength, 16)) {
        throw new PrivateMediaError({
          code: "object_incomplete",
          message: "The uploaded media object is incomplete.",
          retryable: true
        });
      }
      const detected = await this.#detector.detect(prefix);
      this.#validateDetectedType(record, detected);
      const objectIdentitySha256 = objectIdentityDigest(record.locator, snapshot.versionId);
      if (record.state === "reserved") {
        const next: PrivateMediaRecord = {
          ...record,
          revision: record.revision + 1,
          state: "upload_verified",
          detectedMimeType: detected.mimeType,
          objectVersionId: snapshot.versionId,
          objectIdentitySha256,
          updatedAt: now.toISOString()
        };
        await this.#transition(record, ["reserved"], next, {
          authority,
          action: "media.upload_verified",
          outcome: "succeeded",
          metadata: {
            kind: record.kind,
            detectedMimeType: detected.mimeType,
            contentLength: snapshot.contentLength,
            checksumVerified: true,
            kmsVerified: true,
            multipartComplete: true
          },
          intentKind: "upload_object_verified",
          intentPayload: {
            objectIdentitySha256,
            contentLength: snapshot.contentLength,
            detectedMimeType: detected.mimeType,
            state: next.state
          }
        });
        record = next;
      } else {
        assertStableObject(record, snapshot, detected, objectIdentitySha256);
      }
      return Object.freeze({
        mediaId: record.scope.mediaId,
        uploadId: record.scope.uploadId,
        state: "quarantined",
        contentLength: snapshot.contentLength,
        sha256Digest: snapshot.checksumSha256Hex,
        detectedMimeType: detected.mimeType,
        storedAt: snapshot.lastModifiedAt
      });
    } catch (error) {
      if (
        error instanceof PrivateMediaError &&
        !["object_missing", "object_incomplete"].includes(error.code)
      ) {
        await this.#quarantineOnIntegrityFailure(record, now, authority, error.code);
      }
      throw error;
    }
  }

  async inspectQuarantinedMedia(authority: PrivateMediaAuthority): Promise<PublicMediaInspection> {
    const now = this.#now();
    let record = await this.#requireRecord(authority);
    if (record.state === "available") {
      return Object.freeze({
        mediaId: record.scope.mediaId,
        uploadId: record.scope.uploadId,
        state: "available",
        scanStatus: "clean",
        evidenceId: record.lastEvidenceId,
        scannedAt: record.lastScannedAt ?? record.updatedAt
      });
    }
    if (!record.objectVersionId || !record.objectIdentitySha256 || !record.detectedMimeType) {
      throw new PrivateMediaError({
        code: "quarantined",
        message: "Media upload verification must complete before inspection."
      });
    }
    const objectVersionId = record.objectVersionId;
    const objectIdentitySha256 = record.objectIdentitySha256;
    const detectedMimeType = record.detectedMimeType;
    if (record.state === "scan_in_progress") {
      const leaseExpiry = Date.parse(record.inspectionLeaseExpiresAt ?? "");
      if (Number.isFinite(leaseExpiry) && leaseExpiry > now.getTime()) {
        throw new PrivateMediaError({
          code: "scan_in_progress",
          message: "Media inspection is already in progress.",
          retryable: true
        });
      }
    } else if (!["upload_verified", "scan_failed"].includes(record.state)) {
      throw new PrivateMediaError({
        code: "quarantined",
        message: "Media remains quarantined and cannot be inspected automatically."
      });
    }
    if (record.scanAttempts >= this.#config.maxScanAttempts) {
      throw new PrivateMediaError({
        code: "retry_exhausted",
        message: "Media inspection retry limit has been reached."
      });
    }

    const leaseId = this.#randomId();
    const leaseExpiresAt = new Date(
      now.getTime() + this.#config.inspectionLeaseSeconds * 1000
    ).toISOString();
    const scanOperation = this.#atomicOperation({
      authority,
      expectedRevision: record.revision,
      targetRevision: record.revision + 1,
      action: "media.scan_started",
      outcome: "succeeded",
      metadata: { attempt: record.scanAttempts + 1 },
      intentKind: "scan_execution_requested",
      intentPayload: {
        attempt: record.scanAttempts + 1,
        objectIdentitySha256,
        leaseExpiresAt
      }
    });
    const claimed: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      state: "scan_in_progress",
      scanAttempts: record.scanAttempts + 1,
      inspectionLeaseId: leaseId,
      inspectionLeaseExpiresAt: leaseExpiresAt,
      pendingOperationId: scanOperation.operationId,
      updatedAt: now.toISOString()
    };
    await this.#transitionWithOperation(record, [record.state], claimed, scanOperation);
    record = claimed;

    let evidence: SignedMalwareEvidence;
    try {
      evidence = await this.#scanner.scan({
        authority,
        operationId: scanOperation.operationId,
        intentId: scanOperation.reconciliationIntent.intentId,
        locator: record.locator,
        objectVersionId,
        objectIdentitySha256,
        contentSha256Hex: record.expectedSha256Hex,
        contentLength: record.expectedBytes,
        detectedMimeType,
        attempt: record.scanAttempts
      });
    } catch {
      await this.#recordScanFailure(record, authority, "scanner_transport_failure");
      throw new PrivateMediaError({
        code: "scan_failed",
        message: "Media inspection failed; the object remains unavailable.",
        retryable: true
      });
    }

    try {
      this.#validateEvidence(record, evidence, now);
      if (!(await this.#evidenceVerifier.verify(evidence))) {
        throw new PrivateMediaError({
          code: "scan_evidence_invalid",
          message: "Media inspection evidence signature could not be verified."
        });
      }
      const evidenceDigestSha256 = digestCanonicalEvidence(evidence);
      const nextState: PrivateMediaState =
        evidence.payload.verdict === "clean"
          ? "available"
          : evidence.payload.verdict === "error"
            ? "scan_failed"
            : "quarantined";
      const completed: PrivateMediaRecord = {
        ...record,
        revision: record.revision + 1,
        state: nextState,
        lastEvidenceId: evidence.payload.evidenceId,
        lastEvidenceDigestSha256: evidenceDigestSha256,
        lastScannedAt: evidence.payload.scannedAt,
        inspectionLeaseId: null,
        inspectionLeaseExpiresAt: null,
        pendingOperationId: null,
        updatedAt: now.toISOString()
      };
      const successOperation = this.#atomicOperation({
        authority,
        expectedRevision: record.revision,
        targetRevision: completed.revision,
        action: evidence.payload.verdict === "error" ? "media.scan_failed" : "media.scan_completed",
        outcome: evidence.payload.verdict === "error" ? "failed" : "succeeded",
        metadata: {
          verdict: evidence.payload.verdict,
          evidenceId: evidence.payload.evidenceId,
          evidenceDigestSha256,
          scanner: evidence.payload.scanner,
          definitionsVersion: evidence.payload.definitionsVersion,
          attempt: record.scanAttempts
        },
        intentKind:
          evidence.payload.verdict === "error" ? "scan_failure_committed" : "scan_result_committed",
        intentPayload: {
          verdict: evidence.payload.verdict,
          evidenceId: evidence.payload.evidenceId,
          evidenceDigestSha256,
          attempt: record.scanAttempts,
          state: completed.state
        }
      });
      const evidenceConflictRecord: PrivateMediaRecord = {
        ...record,
        revision: record.revision + 1,
        state: "scan_failed",
        inspectionLeaseId: null,
        inspectionLeaseExpiresAt: null,
        pendingOperationId: null,
        updatedAt: now.toISOString()
      };
      const conflictOperation = this.#atomicOperation({
        authority,
        expectedRevision: record.revision,
        targetRevision: evidenceConflictRecord.revision,
        action: "media.scan_failed",
        outcome: "failed",
        metadata: {
          reason: "scan_evidence_conflict",
          evidenceId: evidence.payload.evidenceId,
          attempt: record.scanAttempts
        },
        intentKind: "scan_failure_committed",
        intentPayload: {
          reason: "scan_evidence_conflict",
          evidenceId: evidence.payload.evidenceId,
          attempt: record.scanAttempts,
          state: evidenceConflictRecord.state
        }
      });
      const persistenceResult = await this.#persistence.commitScanResult({
        scope: record.scope,
        expectedRevision: record.revision,
        expectedStates: ["scan_in_progress"],
        evidence: {
          evidenceId: evidence.payload.evidenceId,
          evidenceDigestSha256,
          evidence,
          recordedAt: now.toISOString()
        },
        success: { next: completed, operation: successOperation },
        evidenceConflict: {
          next: evidenceConflictRecord,
          operation: conflictOperation
        }
      });
      if (persistenceResult === "operation_conflict") throw operationConflictError();
      if (persistenceResult === "concurrent_change") throw concurrentChangeError();
      if (persistenceResult === "evidence_conflict") {
        throw new PrivateMediaError({
          code: "scan_evidence_conflict",
          message: "Conflicting media inspection evidence was detected."
        });
      }
      return Object.freeze({
        mediaId: record.scope.mediaId,
        uploadId: record.scope.uploadId,
        state:
          nextState === "available"
            ? "available"
            : nextState === "scan_failed"
              ? "scan_failed"
              : "quarantined",
        scanStatus:
          nextState === "available"
            ? "clean"
            : nextState === "scan_failed"
              ? "failed"
              : "quarantined",
        evidenceId: evidence.payload.evidenceId,
        scannedAt: evidence.payload.scannedAt
      });
    } catch (error) {
      await this.#recordScanFailure(
        record,
        authority,
        error instanceof PrivateMediaError ? error.code : "invalid_scanner_evidence"
      );
      throw error;
    }
  }

  async createSignedReadAccess(
    authority: PrivateMediaAuthority,
    expiresAt: string
  ): Promise<PublicSignedMediaRequest<"GET">> {
    const now = this.#now();
    const record = await this.#requireRecord(authority);
    if (record.state !== "available" || !record.objectVersionId) {
      await this.#recordAuditAndIntent({
        authority,
        action: "media.access_signed",
        outcome: "denied",
        metadata: { reason: "quarantined" },
        intentKind: "security_audit_recorded",
        intentPayload: { reason: "quarantined", state: record.state },
        discriminator: `access-denied:${authority.correlationId}`
      });
      throw new PrivateMediaError({
        code: "quarantined",
        message: "Media is unavailable until signed inspection evidence clears it."
      });
    }
    const boundedExpiry = boundedFutureExpiry(
      expiresAt,
      now,
      this.#config.maxAccessTtlSeconds,
      "access"
    );
    await this.#recordAuditAndIntent({
      authority,
      action: "media.access_signing_requested",
      outcome: "succeeded",
      metadata: { expiresAt: boundedExpiry, method: "GET" },
      intentKind: "access_signing_requested",
      intentPayload: {
        expiresAt: boundedExpiry,
        method: "GET",
        objectIdentitySha256: record.objectIdentitySha256
      },
      discriminator: `access-request:${boundedExpiry}:${authority.correlationId}`
    });
    const auditAccessSigningFailure = async (
      failureClass: "invalid_signer_response" | "signer_transport_failure"
    ): Promise<void> => {
      await this.#recordAuditAndIntent({
        authority,
        action: "media.access_signing_failed",
        outcome: "failed",
        metadata: { failureClass, method: "GET" },
        intentKind: "access_signing_failed",
        intentPayload: {
          failureClass,
          method: "GET",
          objectIdentitySha256: record.objectIdentitySha256,
          state: record.state
        },
        discriminator: `access-signing-failed:${boundedExpiry}:${authority.correlationId}:${failureClass}`
      });
    };
    let signed: SignedTransportRequest;
    try {
      signed = await this.#signer.signGetObject({
        locator: record.locator,
        versionId: record.objectVersionId,
        expiresAt: boundedExpiry,
        responseContentType: record.detectedMimeType ?? record.declaredMimeType
      });
    } catch {
      await auditAccessSigningFailure("signer_transport_failure");
      throw sanitizedSignerTransportError();
    }
    let access: PublicSignedMediaRequest<"GET">;
    try {
      access = publicSignedRequest(signed, {
        method: "GET",
        requestedExpiresAt: boundedExpiry,
        now,
        allowedOrigins: this.#config.presignedEndpointAllowlist,
        locator: record.locator,
        objectVersionId: record.objectVersionId,
        requiredHeaders: {}
      });
    } catch (error) {
      await auditAccessSigningFailure("invalid_signer_response");
      if (error instanceof PrivateMediaError && error.code === "provider_error") throw error;
      throw sanitizedSignerTransportError();
    }
    await this.#recordAuditAndIntent({
      authority,
      action: "media.access_signed",
      outcome: "succeeded",
      metadata: { expiresAt: access.expiresAt, method: "GET" },
      intentKind: "access_capability_issued",
      intentPayload: {
        expiresAt: access.expiresAt,
        method: "GET",
        objectIdentitySha256: record.objectIdentitySha256
      },
      discriminator: `access-issued:${access.expiresAt}:${authority.correlationId}`
    });
    return access;
  }

  async deleteMedia(
    input: Readonly<{
      authority: PrivateMediaAuthority;
      reasonCode: PrivateMediaDeleteReasonCode;
    }>
  ): Promise<PublicMediaLifecycleReceipt> {
    const now = this.#now();
    const record = await this.#requireRecord(input.authority);
    if (record.legalHold) {
      throw new PrivateMediaError({
        code: "legal_hold",
        message: "Media cannot be deleted while a legal hold is active."
      });
    }
    if (record.state === "purged") {
      throw new PrivateMediaError({ code: "not_found", message: "Media no longer exists." });
    }
    if (record.state === "deleted") {
      return lifecycleReceipt(record, "deleted", record.deletedAt ?? now.toISOString());
    }
    if (["delete_in_progress", "restore_in_progress", "purge_in_progress"].includes(record.state)) {
      throw reconciliationPendingError(record.state);
    }
    const reasonCode = requireDeleteReasonCode(input.reasonCode);
    const requestOperation = this.#atomicOperation({
      authority: input.authority,
      expectedRevision: record.revision,
      targetRevision: record.revision + 1,
      action: "media.delete_requested",
      outcome: "succeeded",
      metadata: { reasonCode },
      intentKind: "s3_delete_marker_requested",
      intentPayload: {
        reasonCode,
        requestedAt: now.toISOString(),
        state: "delete_in_progress"
      }
    });
    const deleting: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      state: "delete_in_progress",
      pendingOperationId: requestOperation.operationId,
      inspectionLeaseId: null,
      inspectionLeaseExpiresAt: null,
      updatedAt: now.toISOString()
    };
    await this.#transitionWithOperation(record, [record.state], deleting, requestOperation);
    const deletion = await this.#objects.ensureDeleteMarker({
      locator: deleting.locator,
      operationId: requestOperation.operationId,
      requestedAt: now.toISOString()
    });
    const recoverableUntil = new Date(
      now.getTime() + this.#config.restoreWindowSeconds * 1000
    ).toISOString();
    const deleted: PrivateMediaRecord = {
      ...deleting,
      revision: deleting.revision + 1,
      state: "deleted",
      pendingOperationId: null,
      deleteMarkerVersionId: requireOpaqueProviderValue(
        deletion.deleteMarkerVersionId,
        "delete marker"
      ),
      deletedAt: deletion.deletedAt,
      recoverableUntil,
      inspectionLeaseId: null,
      inspectionLeaseExpiresAt: null,
      updatedAt: now.toISOString()
    };
    await this.#transition(deleting, ["delete_in_progress"], deleted, {
      authority: input.authority,
      action: "media.deleted",
      outcome: "succeeded",
      metadata: { reasonCode, recoverableUntil },
      intentKind: "s3_delete_marker_confirmed",
      intentPayload: {
        requestOperationId: requestOperation.operationId,
        deleteMarkerFingerprint: sha256Text(deletion.deleteMarkerVersionId),
        recoverableUntil,
        state: deleted.state
      }
    });
    return lifecycleReceipt(deleted, "deleted", deletion.deletedAt);
  }

  async restoreMedia(
    input: Readonly<{
      authority: PrivateMediaAuthority;
      reasonCode: PrivateMediaRestoreReasonCode;
    }>
  ): Promise<PublicMediaLifecycleReceipt> {
    const now = this.#now();
    const record = await this.#requireRecord(input.authority);
    const reasonCode = requireRestoreReasonCode(input.reasonCode);
    if (record.state !== "deleted" || !record.deleteMarkerVersionId || !record.objectVersionId) {
      throw new PrivateMediaError({
        code: "invalid_request",
        message: "Only recoverably deleted media can be restored."
      });
    }
    if (Date.parse(record.recoverableUntil ?? "") <= now.getTime()) {
      throw new PrivateMediaError({
        code: "restore_window_expired",
        message: "The governed media restore window has expired."
      });
    }
    const requestOperation = this.#atomicOperation({
      authority: input.authority,
      expectedRevision: record.revision,
      targetRevision: record.revision + 1,
      action: "media.restore_requested",
      outcome: "succeeded",
      metadata: { reasonCode },
      intentKind: "s3_restore_requested",
      intentPayload: {
        reasonCode,
        deleteMarkerFingerprint: sha256Text(record.deleteMarkerVersionId),
        requestedAt: now.toISOString(),
        state: "restore_in_progress"
      }
    });
    const restoring: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      state: "restore_in_progress",
      pendingOperationId: requestOperation.operationId,
      updatedAt: now.toISOString()
    };
    await this.#transitionWithOperation(record, ["deleted"], restoring, requestOperation);
    await this.#objects.removeDeleteMarker({
      locator: restoring.locator,
      deleteMarkerVersionId: record.deleteMarkerVersionId,
      operationId: requestOperation.operationId,
      requestedAt: now.toISOString()
    });
    const snapshot = await this.#objects.headObjectVersion({
      locator: restoring.locator,
      versionId: record.objectVersionId
    });
    if (!snapshot) {
      throw new PrivateMediaError({
        code: "object_missing",
        message: "The restored media version could not be verified."
      });
    }
    this.#validateSnapshot(restoring, snapshot);
    if (
      snapshot.versionId !== restoring.objectVersionId ||
      objectIdentityDigest(restoring.locator, snapshot.versionId) !== restoring.objectIdentitySha256
    ) {
      throw integrityError("The restored media version does not match immutable provenance.");
    }
    const restored: PrivateMediaRecord = {
      ...restoring,
      revision: restoring.revision + 1,
      state: "upload_verified",
      pendingOperationId: null,
      deleteMarkerVersionId: null,
      deletedAt: null,
      recoverableUntil: null,
      lastEvidenceId: null,
      lastEvidenceDigestSha256: null,
      lastScannedAt: null,
      inspectionLeaseId: null,
      inspectionLeaseExpiresAt: null,
      updatedAt: now.toISOString()
    };
    await this.#transition(restoring, ["restore_in_progress"], restored, {
      authority: input.authority,
      action: "media.restored",
      outcome: "succeeded",
      metadata: { reasonCode, rescanRequired: true },
      intentKind: "s3_restore_confirmed",
      intentPayload: {
        requestOperationId: requestOperation.operationId,
        objectIdentitySha256: restored.objectIdentitySha256,
        rescanRequired: true,
        state: restored.state
      }
    });
    return lifecycleReceipt(restored, "quarantined", now.toISOString());
  }

  async purgeExpiredDeletedMedia(
    authority: PrivateMediaAuthority
  ): Promise<PublicMediaLifecycleReceipt> {
    const now = this.#now();
    const record = await this.#requireRecord(authority);
    if (record.legalHold) {
      throw new PrivateMediaError({
        code: "legal_hold",
        message: "Media cannot be purged while a legal hold is active."
      });
    }
    if (
      record.state !== "deleted" ||
      !record.objectVersionId ||
      Date.parse(record.recoverableUntil ?? "") > now.getTime()
    ) {
      throw new PrivateMediaError({
        code: "invalid_request",
        message: "Media is not eligible for permanent lifecycle deletion."
      });
    }
    const requestOperation = this.#atomicOperation({
      authority,
      expectedRevision: record.revision,
      targetRevision: record.revision + 1,
      action: "media.purge_requested",
      outcome: "succeeded",
      metadata: { retentionWindowExpired: true },
      intentKind: "s3_purge_requested",
      intentPayload: {
        objectIdentitySha256: record.objectIdentitySha256,
        requestedAt: now.toISOString(),
        state: "purge_in_progress"
      }
    });
    const purging: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      state: "purge_in_progress",
      pendingOperationId: requestOperation.operationId,
      updatedAt: now.toISOString()
    };
    await this.#transitionWithOperation(record, ["deleted"], purging, requestOperation);
    const objectVersionEffectId = privateMediaChildEffectId(
      requestOperation.operationId,
      "purge_object_version",
      sha256Text(record.objectVersionId)
    );
    await this.#objects.deleteObjectVersion({
      locator: purging.locator,
      versionId: record.objectVersionId,
      operationId: objectVersionEffectId,
      requestedAt: now.toISOString()
    });
    if (record.deleteMarkerVersionId) {
      const deleteMarkerEffectId = privateMediaChildEffectId(
        requestOperation.operationId,
        "purge_delete_marker",
        sha256Text(record.deleteMarkerVersionId)
      );
      await this.#objects.deleteObjectVersion({
        locator: purging.locator,
        versionId: record.deleteMarkerVersionId,
        operationId: deleteMarkerEffectId,
        requestedAt: now.toISOString()
      });
    }
    const purged: PrivateMediaRecord = {
      ...purging,
      revision: purging.revision + 1,
      state: "purged",
      pendingOperationId: null,
      deleteMarkerVersionId: null,
      updatedAt: now.toISOString()
    };
    await this.#transition(purging, ["purge_in_progress"], purged, {
      authority,
      action: "media.purged",
      outcome: "succeeded",
      metadata: { retentionWindowExpired: true },
      intentKind: "s3_purge_confirmed",
      intentPayload: {
        requestOperationId: requestOperation.operationId,
        retentionWindowExpired: true,
        state: purged.state
      }
    });
    return lifecycleReceipt(purged, "purged", now.toISOString());
  }

  async setLegalHold(authority: PrivateMediaAuthority, legalHold: boolean): Promise<void> {
    const record = await this.#requireRecord(authority);
    if (record.state === "purged") {
      throw new PrivateMediaError({
        code: "not_found",
        message: "Legal hold cannot be changed after media is permanently purged."
      });
    }
    if (["delete_in_progress", "restore_in_progress", "purge_in_progress"].includes(record.state)) {
      throw reconciliationPendingError(record.state);
    }
    if (record.legalHold === legalHold) return;
    const next: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      legalHold,
      updatedAt: this.#now().toISOString()
    };
    await this.#transition(record, [record.state], next, {
      authority,
      action: "media.legal_hold_changed",
      outcome: "succeeded",
      metadata: {
        previousLegalHold: record.legalHold,
        legalHold,
        state: record.state
      },
      intentKind: "legal_hold_changed",
      intentPayload: {
        previousLegalHold: record.legalHold,
        legalHold,
        state: record.state
      }
    });
  }

  async internalSnapshot(authority: PrivateMediaAuthority): Promise<
    Readonly<{
      objectKey: string;
      contentLength: number;
      mimeType: string;
      sha256Digest: string;
      objectVersionId: string;
      storedAt: string;
    }>
  > {
    const record = await this.#requireRecord(authority);
    if (
      !record.objectVersionId ||
      !record.objectIdentitySha256 ||
      !record.detectedMimeType ||
      [
        "reserved",
        "delete_in_progress",
        "deleted",
        "restore_in_progress",
        "purge_in_progress",
        "purged"
      ].includes(record.state)
    ) {
      throw new PrivateMediaError({
        code: "quarantined",
        message: "No verified private media version is available for an internal snapshot."
      });
    }
    const snapshot = await this.#objects.headObjectVersion({
      locator: record.locator,
      versionId: record.objectVersionId
    });
    if (!snapshot) {
      throw new PrivateMediaError({
        code: "object_missing",
        message: "The verified media object version is missing."
      });
    }
    this.#validateSnapshot(record, snapshot);
    const identity = objectIdentityDigest(record.locator, snapshot.versionId);
    if (
      snapshot.versionId !== record.objectVersionId ||
      !safeEqual(identity, record.objectIdentitySha256)
    ) {
      throw integrityError("Internal media snapshot did not match pinned object provenance.");
    }
    return Object.freeze({
      objectKey: record.locator.key,
      contentLength: snapshot.contentLength,
      mimeType: snapshot.contentType,
      sha256Digest: snapshot.checksumSha256Hex,
      objectVersionId: snapshot.versionId,
      storedAt: snapshot.lastModifiedAt
    });
  }

  #locator(key: string): S3ObjectLocator {
    return { bucket: this.#config.bucket, key, region: this.#config.region };
  }

  #assertObjectKeyAuthority(key: string, scope: PrivateMediaScope): void {
    const parsed = this.scopeFromInternalObjectKey(key);
    if (!sameScope(parsed, scope)) {
      throw new PrivateMediaError({
        code: "authority_mismatch",
        message: "The private media object does not belong to the requested authority."
      });
    }
  }

  #objectBinding(
    scope: PrivateMediaScope,
    sha256Hex: string,
    bytes: number,
    mimeType: string
  ): string {
    return createHmac("sha256", this.#bindingSecret)
      .update(
        [
          this.#config.environment,
          scope.tenantId,
          scope.clinicId,
          scope.mediaId,
          scope.uploadId,
          sha256Hex,
          String(bytes),
          mimeType
        ].join("\u001f")
      )
      .digest("base64url");
  }

  async #requireRecord(authority: PrivateMediaAuthority): Promise<PrivateMediaRecord> {
    validateAuthority(authority);
    const record = await this.#persistence.get(scopeOnly(authority));
    if (!record) {
      throw new PrivateMediaError({ code: "not_found", message: "Media was not found." });
    }
    if (!sameScope(record.scope, authority)) {
      throw new PrivateMediaError({
        code: "authority_mismatch",
        message: "Media does not belong to the requested tenant and clinic."
      });
    }
    this.#assertObjectKeyAuthority(record.locator.key, authority);
    return record;
  }

  #assertReservationOpen(record: PrivateMediaRecord, now: Date): void {
    if (record.state !== "reserved") {
      throw new PrivateMediaError({
        code: "reservation_conflict",
        message: "Media upload reservation is no longer open."
      });
    }
    if (Date.parse(record.expiresAt) <= now.getTime()) {
      throw new PrivateMediaError({
        code: "reservation_expired",
        message: "Media upload reservation has expired."
      });
    }
  }

  #validateSnapshot(record: PrivateMediaRecord, snapshot: S3ObjectSnapshot): void {
    if (snapshot.multipartStatus === "incomplete") {
      throw new PrivateMediaError({
        code: "object_incomplete",
        message: "Multipart media upload is incomplete.",
        retryable: true
      });
    }
    if (snapshot.contentLength !== record.expectedBytes) {
      throw integrityError("Stored media size did not match its reservation.");
    }
    if (normalizedMimeType(snapshot.contentType) !== record.declaredMimeType) {
      throw integrityError("Stored media type did not match its reservation.");
    }
    if (!safeEqual(normalizedSha256(snapshot.checksumSha256Hex), record.expectedSha256Hex)) {
      throw integrityError("Stored media digest did not match its reservation.");
    }
    const binding = snapshot.metadata[PRIVATE_METADATA_BINDING];
    if (!binding || !safeEqual(binding, record.binding)) {
      throw integrityError("Stored media authority metadata did not match its reservation.");
    }
    if (snapshot.tags[QUARANTINE_TAG] !== UPLOAD_TAG_VALUE) {
      throw integrityError("Stored media did not enter through the quarantine policy.");
    }
    if (
      snapshot.serverSideEncryption !== "aws:kms" ||
      !snapshot.kmsKeyId ||
      !safeEqual(snapshot.kmsKeyId, this.#config.kmsKeyId)
    ) {
      throw new PrivateMediaError({
        code: "kms_policy_mismatch",
        message: "Stored media does not meet the required KMS encryption policy."
      });
    }
    requireOpaqueProviderValue(snapshot.versionId, "object version");
  }

  #validateDetectedType(
    record: PrivateMediaRecord,
    detected: DetectedMediaFile | null
  ): asserts detected is DetectedMediaFile {
    if (!detected) {
      throw new PrivateMediaError({
        code: "magic_type_mismatch",
        message: "Media magic bytes do not identify an approved clinical file type."
      });
    }
    const detectedMime = normalizedMimeType(detected.mimeType);
    try {
      assertKindMimeType(record.kind, detectedMime);
    } catch (error) {
      if (!(error instanceof PrivateMediaError) || error.code !== "invalid_request") throw error;
      throw new PrivateMediaError({
        code: "magic_type_mismatch",
        message: "Media magic bytes identify a type outside the reserved clinical media kind."
      });
    }
    if (!mimeTypesEquivalent(record.declaredMimeType, detectedMime)) {
      throw new PrivateMediaError({
        code: "magic_type_mismatch",
        message: "Declared media type does not match its magic bytes."
      });
    }
  }

  #validateEvidence(
    record: PrivateMediaRecord,
    untrustedEvidence: unknown,
    now: Date
  ): asserts untrustedEvidence is SignedMalwareEvidence {
    if (
      !isPlainRecord(untrustedEvidence) ||
      !hasExactKeys(untrustedEvidence, ["payload", "signature"])
    ) {
      throw invalidEvidence("Media inspection evidence envelope is malformed.");
    }
    const payloadValue = untrustedEvidence.payload;
    const signatureValue = untrustedEvidence.signature;
    const payloadKeys = [
      "evidenceId",
      "tenantId",
      "clinicId",
      "mediaId",
      "uploadId",
      "scanOperationId",
      "objectIdentitySha256",
      "objectVersionId",
      "contentSha256Hex",
      "contentLength",
      "detectedMimeType",
      "verdict",
      "scanner",
      "engineVersion",
      "definitionsVersion",
      "scannedAt"
    ] as const;
    if (!isPlainRecord(payloadValue) || !hasExactKeys(payloadValue, payloadKeys)) {
      throw invalidEvidence("Media inspection evidence payload fields are malformed.");
    }
    const stringPayloadKeys = payloadKeys.filter((key) => key !== "contentLength");
    if (
      stringPayloadKeys.some((key) => typeof payloadValue[key] !== "string") ||
      !Number.isSafeInteger(payloadValue.contentLength) ||
      (payloadValue.contentLength as number) <= 0
    ) {
      throw invalidEvidence("Media inspection evidence payload types are invalid.");
    }
    if (
      !isPlainRecord(signatureValue) ||
      !hasExactKeys(signatureValue, ["keyId", "algorithm", "valueBase64"]) ||
      typeof signatureValue.keyId !== "string" ||
      typeof signatureValue.algorithm !== "string" ||
      typeof signatureValue.valueBase64 !== "string"
    ) {
      throw invalidEvidence("Media inspection evidence signature fields are malformed.");
    }
    const payload = payloadValue as unknown as SignedMalwareEvidencePayload;
    const signature = signatureValue as unknown as SignedMalwareEvidence["signature"];
    if (
      !["clean", "malicious", "suspicious", "error"].includes(payload.verdict) ||
      !SAFE_ID.test(payload.evidenceId) ||
      !SAFE_ID.test(payload.scanner) ||
      !SAFE_ID.test(payload.engineVersion) ||
      !SAFE_ID.test(payload.definitionsVersion)
    ) {
      throw invalidEvidence("Media inspection evidence identifiers or verdict are invalid.");
    }
    if (
      !SAFE_PROVIDER_KEY_ID.test(signature.keyId) ||
      !this.#config.scannerSigningKeyIds.includes(signature.keyId) ||
      !["RSASSA_PSS_SHA_256", "ECDSA_SHA_256"].includes(signature.algorithm) ||
      !isStrictBoundedBase64Signature(signature.valueBase64)
    ) {
      throw invalidEvidence("Media inspection evidence signature is invalid.");
    }
    const expected = {
      tenantId: record.scope.tenantId,
      clinicId: record.scope.clinicId,
      mediaId: record.scope.mediaId,
      uploadId: record.scope.uploadId,
      scanOperationId: record.pendingOperationId,
      objectIdentitySha256: record.objectIdentitySha256,
      objectVersionId: record.objectVersionId,
      contentSha256Hex: record.expectedSha256Hex,
      contentLength: record.expectedBytes,
      detectedMimeType: record.detectedMimeType
    };
    for (const [key, value] of Object.entries(expected)) {
      if (payload[key as keyof SignedMalwareEvidencePayload] !== value) {
        throw new PrivateMediaError({
          code: "scan_evidence_invalid",
          message: "Media inspection evidence does not match immutable object provenance."
        });
      }
    }
    if (!HEX_SHA256.test(payload.contentSha256Hex)) {
      throw invalidEvidence("Media inspection evidence digest is invalid.");
    }
    const scannedAt = Date.parse(payload.scannedAt);
    if (
      !Number.isFinite(scannedAt) ||
      Math.abs(scannedAt - now.getTime()) > this.#config.maxScannerClockSkewSeconds * 1000
    ) {
      throw invalidEvidence("Media inspection evidence is outside the accepted time window.");
    }
  }

  async #transition(
    previous: PrivateMediaRecord,
    expectedStates: readonly PrivateMediaState[],
    next: PrivateMediaRecord,
    operationInput: Readonly<{
      authority: PrivateMediaAuthority;
      action: PrivateMediaAuditAction;
      outcome: PrivateMediaAuditEvent["outcome"];
      metadata: PrivateMediaAuditEvent["metadata"];
      intentKind: PrivateMediaReconciliationIntentKind;
      intentPayload: PrivateMediaAuditEvent["metadata"];
    }>
  ): Promise<"applied" | "replayed"> {
    const operation = this.#atomicOperation({
      ...operationInput,
      expectedRevision: previous.revision,
      targetRevision: next.revision
    });
    return this.#transitionWithOperation(previous, expectedStates, next, operation);
  }

  async #transitionWithOperation(
    previous: PrivateMediaRecord,
    expectedStates: readonly PrivateMediaState[],
    next: PrivateMediaRecord,
    operation: PrivateMediaAtomicOperation
  ): Promise<"applied" | "replayed"> {
    if (
      next.revision !== previous.revision + 1 ||
      !sameScope(next.scope, previous.scope) ||
      next.locator.key !== previous.locator.key ||
      next.locator.bucket !== previous.locator.bucket
    ) {
      throw new PrivateMediaError({
        code: "provider_error",
        message: "Invalid private media state transition."
      });
    }
    if (
      operation.reconciliationIntent.expectedRevision !== previous.revision ||
      operation.reconciliationIntent.targetRevision !== next.revision
    ) {
      throw new PrivateMediaError({
        code: "provider_error",
        message: "Private media reconciliation intent does not match its state transition."
      });
    }
    if (
      [
        "scan_execution_requested",
        "s3_delete_marker_requested",
        "s3_restore_requested",
        "s3_purge_requested"
      ].includes(operation.reconciliationIntent.kind) &&
      next.pendingOperationId !== operation.operationId
    ) {
      throw new PrivateMediaError({
        code: "provider_error",
        message: "External media work is not bound to its durable operation identity."
      });
    }
    const result = await this.#persistence.transition({
      scope: previous.scope,
      expectedRevision: previous.revision,
      expectedStates,
      next,
      operation
    });
    if (result === "operation_conflict") throw operationConflictError();
    if (result === "concurrent_change") throw concurrentChangeError();
    return result;
  }

  async #quarantineOnIntegrityFailure(
    record: PrivateMediaRecord,
    now: Date,
    authority: PrivateMediaAuthority,
    reason: string
  ): Promise<void> {
    if (
      [
        "delete_in_progress",
        "deleted",
        "restore_in_progress",
        "purge_in_progress",
        "purged",
        "quarantined"
      ].includes(record.state)
    ) {
      return;
    }
    const quarantined: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      state: "quarantined",
      inspectionLeaseId: null,
      inspectionLeaseExpiresAt: null,
      updatedAt: now.toISOString()
    };
    try {
      await this.#transition(record, [record.state], quarantined, {
        authority,
        action: "media.upload_rejected",
        outcome: "failed",
        metadata: { reason },
        intentKind: "upload_object_rejected",
        intentPayload: { reason, state: quarantined.state }
      });
    } catch (error) {
      if (!(error instanceof PrivateMediaError) || error.code !== "concurrent_change") throw error;
    }
  }

  async #recordScanFailure(
    record: PrivateMediaRecord,
    authority: PrivateMediaAuthority,
    reason: string
  ): Promise<void> {
    const now = this.#now();
    const failed: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      state: "scan_failed",
      inspectionLeaseId: null,
      inspectionLeaseExpiresAt: null,
      pendingOperationId: null,
      updatedAt: now.toISOString()
    };
    try {
      await this.#transition(record, ["scan_in_progress"], failed, {
        authority,
        action: "media.scan_failed",
        outcome: "failed",
        metadata: { reason, attempt: record.scanAttempts },
        intentKind: "scan_failure_committed",
        intentPayload: { reason, attempt: record.scanAttempts, state: failed.state }
      });
    } catch (error) {
      if (!(error instanceof PrivateMediaError) || error.code !== "concurrent_change") throw error;
    }
  }

  #atomicOperation(
    input: Readonly<{
      authority: PrivateMediaAuthority;
      expectedRevision: number | null;
      targetRevision: number | null;
      action: PrivateMediaAuditAction;
      outcome: PrivateMediaAuditEvent["outcome"];
      metadata: PrivateMediaAuditEvent["metadata"];
      intentKind: PrivateMediaReconciliationIntentKind;
      intentPayload: PrivateMediaAuditEvent["metadata"];
      discriminator?: string;
    }>
  ): PrivateMediaAtomicOperation {
    assertSafeAuditMetadata(input.metadata);
    assertSafeIntentPayload(input.intentPayload);
    const scope = scopeOnly(input.authority);
    const operationId = `pmop_${sha256Text(
      [
        scope.tenantId,
        scope.clinicId,
        scope.mediaId,
        scope.uploadId,
        input.action,
        String(input.expectedRevision),
        String(input.targetRevision),
        input.intentKind,
        canonicalPrimitiveRecord(input.metadata),
        canonicalPrimitiveRecord(input.intentPayload),
        input.discriminator ?? ""
      ].join("\u001f")
    )}`;
    const occurredAt = this.#now().toISOString();
    const audit = Object.freeze({
      eventId: `pmae_${sha256Text(`${operationId}\u001faudit`)}`,
      action: input.action,
      occurredAt,
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      mediaId: scope.mediaId,
      uploadId: scope.uploadId,
      actorId: input.authority.actorId,
      correlationId: input.authority.correlationId,
      outcome: input.outcome,
      metadata: Object.freeze({ ...input.metadata })
    });
    const reconciliationIntent = Object.freeze({
      intentId: `pmri_${sha256Text(`${operationId}\u001fintent`)}`,
      operationId,
      kind: input.intentKind,
      scope,
      expectedRevision: input.expectedRevision,
      targetRevision: input.targetRevision,
      createdAt: occurredAt,
      payload: Object.freeze({ ...input.intentPayload })
    });
    const semanticFingerprintSha256 = privateMediaOperationSemanticFingerprint({
      operationId,
      audit,
      reconciliationIntent
    });
    return Object.freeze({
      operationId,
      semanticFingerprintSha256,
      audit,
      reconciliationIntent
    });
  }

  async #recordAuditAndIntent(
    input: Readonly<{
      authority: PrivateMediaAuthority;
      action: PrivateMediaAuditAction;
      outcome: PrivateMediaAuditEvent["outcome"];
      metadata: PrivateMediaAuditEvent["metadata"];
      intentKind: PrivateMediaReconciliationIntentKind;
      intentPayload: PrivateMediaAuditEvent["metadata"];
      discriminator: string;
    }>
  ): Promise<void> {
    const operation = this.#atomicOperation({
      ...input,
      expectedRevision: null,
      targetRevision: null
    });
    const result = await this.#persistence.recordAuditAndIntent(operation);
    if (result === "operation_conflict") throw operationConflictError();
  }
}

function validateProviderConfig(config: S3PrivateMediaProviderConfig): void {
  if (!SAFE_ENVIRONMENT.test(config.environment)) invalidConfig("environment");
  if (!config.bucket || config.bucket.length > 255) invalidConfig("bucket");
  if (!config.region || config.region.length > 64) invalidConfig("region");
  if (!config.kmsKeyId || config.kmsKeyId.length > 512) invalidConfig("KMS key");
  if (Buffer.from(config.bindingSecret).byteLength < 32) invalidConfig("binding secret");
  if (
    !Array.isArray(config.scannerSigningKeyIds) ||
    config.scannerSigningKeyIds.length === 0 ||
    config.scannerSigningKeyIds.length > 16 ||
    config.scannerSigningKeyIds.some(
      (keyId) => typeof keyId !== "string" || !SAFE_PROVIDER_KEY_ID.test(keyId)
    ) ||
    new Set(config.scannerSigningKeyIds).size !== config.scannerSigningKeyIds.length
  ) {
    invalidConfig("scanner signing key allowlist");
  }
  validatePresignedEndpointAllowlist(config);
  for (const [name, value] of Object.entries({
    maxUploadTtlSeconds: config.maxUploadTtlSeconds ?? 600,
    maxAccessTtlSeconds: config.maxAccessTtlSeconds ?? 300,
    maxBytes: config.maxBytes ?? 100 * 1024 * 1024,
    magicReadBytes: config.magicReadBytes ?? 8_192,
    inspectionLeaseSeconds: config.inspectionLeaseSeconds ?? 120,
    maxScanAttempts: config.maxScanAttempts ?? 5,
    restoreWindowSeconds: config.restoreWindowSeconds ?? 30 * 24 * 60 * 60,
    maxScannerClockSkewSeconds: config.maxScannerClockSkewSeconds ?? 300
  })) {
    if (!Number.isSafeInteger(value) || value <= 0) invalidConfig(name);
  }
  if ((config.maxUploadTtlSeconds ?? 600) > 900) invalidConfig("maxUploadTtlSeconds");
  if ((config.maxAccessTtlSeconds ?? 300) > 300) invalidConfig("maxAccessTtlSeconds");
  if ((config.maxBytes ?? 100 * 1024 * 1024) > 512 * 1024 * 1024) {
    invalidConfig("maxBytes");
  }
  if ((config.magicReadBytes ?? 8_192) > 65_536) invalidConfig("magicReadBytes");
  if ((config.inspectionLeaseSeconds ?? 120) > 900) invalidConfig("inspectionLeaseSeconds");
  if ((config.maxScanAttempts ?? 5) > 10) invalidConfig("maxScanAttempts");
  if ((config.maxScannerClockSkewSeconds ?? 300) > 900) {
    invalidConfig("maxScannerClockSkewSeconds");
  }
}

function validatePresignedEndpointAllowlist(config: S3PrivateMediaProviderConfig): void {
  if (
    !Array.isArray(config.presignedEndpointAllowlist) ||
    config.presignedEndpointAllowlist.length === 0 ||
    config.presignedEndpointAllowlist.length > 8
  ) {
    invalidConfig("presigned endpoint allowlist");
  }
  const supportedHosts = new Set([
    `${config.bucket}.s3.${config.region}.amazonaws.com`,
    `${config.bucket}.s3.dualstack.${config.region}.amazonaws.com`,
    `s3.${config.region}.amazonaws.com`,
    `s3.dualstack.${config.region}.amazonaws.com`
  ]);
  const origins = new Set<string>();
  for (const configuredEndpoint of config.presignedEndpointAllowlist) {
    if (typeof configuredEndpoint !== "string") {
      invalidConfig("presigned endpoint allowlist");
    }
    let endpoint: URL;
    try {
      endpoint = new URL(configuredEndpoint);
    } catch {
      invalidConfig("presigned endpoint allowlist");
    }
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      endpoint.port ||
      endpoint.pathname !== "/" ||
      endpoint.search ||
      endpoint.hash ||
      !supportedHosts.has(endpoint.hostname)
    ) {
      invalidConfig("presigned endpoint allowlist");
    }
    origins.add(endpoint.origin);
  }
  if (origins.size !== config.presignedEndpointAllowlist.length) {
    invalidConfig("presigned endpoint allowlist");
  }
}

function invalidConfig(field: string): never {
  throw new PrivateMediaError({
    code: "invalid_request",
    message: `Private media provider ${field} configuration is invalid.`
  });
}

function validateScope(scope: PrivateMediaScope): void {
  for (const [name, value] of Object.entries(scope)) {
    if (!SAFE_ID.test(value)) {
      throw new PrivateMediaError({
        code: "invalid_request",
        message: `Private media ${name} is invalid.`
      });
    }
  }
}

function validateAuthority(authority: PrivateMediaAuthority): void {
  validateScope(authority);
  if (!SAFE_ID.test(authority.actorId) || !SAFE_ID.test(authority.correlationId)) {
    throw new PrivateMediaError({
      code: "invalid_request",
      message: "Private media actor or correlation authority is invalid."
    });
  }
}

function scopeOnly(value: PrivateMediaScope): PrivateMediaScope {
  return {
    tenantId: value.tenantId,
    clinicId: value.clinicId,
    mediaId: value.mediaId,
    uploadId: value.uploadId
  };
}

function sameScope(left: PrivateMediaScope, right: PrivateMediaScope): boolean {
  return (
    safeEqual(left.tenantId, right.tenantId) &&
    safeEqual(left.clinicId, right.clinicId) &&
    safeEqual(left.mediaId, right.mediaId) &&
    safeEqual(left.uploadId, right.uploadId)
  );
}

function normalizedMimeType(value: string): string {
  const normalized = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!/^[a-z0-9][a-z0-9!#$&^_.+-]{0,63}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,127}$/u.test(normalized)) {
    throw new PrivateMediaError({ code: "invalid_request", message: "Media type is invalid." });
  }
  return normalized;
}

function normalizedSha256(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!HEX_SHA256.test(normalized)) {
    throw new PrivateMediaError({
      code: "invalid_request",
      message: "A complete SHA-256 media digest is required."
    });
  }
  return normalized;
}

function assertByteBudget(value: number, max: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new PrivateMediaError({
      code: "invalid_request",
      message: "Media size is outside the configured upload budget."
    });
  }
}

function assertKindMimeType(kind: ClinicalMediaKind, mimeType: string): void {
  const allowed: Readonly<Record<ClinicalMediaKind, readonly string[]>> = {
    intraoral_photo: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
    xray: ["image/jpeg", "image/png", "image/tiff", "application/dicom"],
    document: ["application/pdf", "image/jpeg", "image/png"],
    audio_chunk: ["audio/wav", "audio/webm", "audio/mp4", "audio/mpeg"],
    generated_document: ["application/pdf", "image/jpeg", "image/png"]
  };
  if (!allowed[kind]?.includes(mimeType)) {
    throw new PrivateMediaError({
      code: "invalid_request",
      message: "Media type is not allowed for the requested clinical media kind."
    });
  }
}

function mimeTypesEquivalent(declared: string, detected: string): boolean {
  if (declared === detected) return true;
  return (
    (declared === "image/heic" && detected === "image/heif") ||
    (declared === "image/heif" && detected === "image/heic")
  );
}

function boundedFutureExpiry(value: string, now: Date, maxSeconds: number, label: string): string {
  const expires = Date.parse(value);
  if (
    !Number.isFinite(expires) ||
    expires <= now.getTime() ||
    expires > now.getTime() + maxSeconds * 1000
  ) {
    throw new PrivateMediaError({
      code: "invalid_request",
      message: `Private media ${label} expiry is outside the allowed short-lived window.`
    });
  }
  return new Date(expires).toISOString();
}

function publicSignedRequest<TMethod extends "PUT" | "GET">(
  value: SignedTransportRequest,
  expected: Readonly<{
    method: TMethod;
    requestedExpiresAt: string;
    now: Date;
    allowedOrigins: readonly string[];
    locator: S3ObjectLocator;
    objectVersionId: string | null;
    requiredHeaders: Readonly<Record<string, string>>;
  }>
): PublicSignedMediaRequest<TMethod> {
  if (value.method !== expected.method) {
    throw new PrivateMediaError({
      code: "provider_error",
      message: "Media signer returned a broader HTTP method than requested."
    });
  }
  let parsed: URL;
  try {
    parsed = new URL(value.url);
  } catch {
    throw new PrivateMediaError({
      code: "provider_error",
      message: "Media signer returned an invalid URL."
    });
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    parsed.port ||
    !expected.allowedOrigins.includes(parsed.origin) ||
    value.url.length > 8192
  ) {
    throw new PrivateMediaError({
      code: "provider_error",
      message: "Media signer returned an unapproved endpoint URL."
    });
  }
  const encodedKeyPath = `/${expected.locator.key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
  const virtualHosted = parsed.hostname.startsWith(`${expected.locator.bucket}.s3.`);
  const expectedPath = virtualHosted
    ? encodedKeyPath
    : `/${encodeURIComponent(expected.locator.bucket)}${encodedKeyPath}`;
  const versionValues = parsed.searchParams.getAll("versionId");
  if (
    parsed.pathname !== expectedPath ||
    (expected.objectVersionId === null
      ? versionValues.length !== 0
      : versionValues.length !== 1 || versionValues[0] !== expected.objectVersionId)
  ) {
    throw new PrivateMediaError({
      code: "provider_error",
      message: "Media signer returned a capability for an unapproved object scope."
    });
  }
  const signedExpiry = Date.parse(value.expiresAt);
  const requestedExpiry = Date.parse(expected.requestedExpiresAt);
  if (
    !Number.isFinite(signedExpiry) ||
    signedExpiry <= expected.now.getTime() ||
    signedExpiry > requestedExpiry
  ) {
    throw new PrivateMediaError({
      code: "provider_error",
      message: "Media signer returned an invalid expiry."
    });
  }
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(value.requiredHeaders)) {
    const name = rawName.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/u.test(name) ||
      typeof rawValue !== "string" ||
      rawValue.length > 2048 ||
      /[\r\n\u0000]/u.test(rawValue)
    ) {
      throw new PrivateMediaError({
        code: "provider_error",
        message: "Media signer returned unsafe required headers."
      });
    }
    headers[name] = rawValue;
  }
  for (const [name, expectedValue] of Object.entries(expected.requiredHeaders)) {
    if (headers[name] !== expectedValue) {
      throw new PrivateMediaError({
        code: "provider_error",
        message: "Media signer did not bind all required upload constraints."
      });
    }
  }
  const expectedHeaderNames = Object.keys(expected.requiredHeaders).sort();
  const actualHeaderNames = Object.keys(headers).sort();
  if (
    expectedHeaderNames.length !== actualHeaderNames.length ||
    expectedHeaderNames.some((name, index) => actualHeaderNames[index] !== name)
  ) {
    throw new PrivateMediaError({
      code: "provider_error",
      message: "Media signer returned unapproved required headers."
    });
  }
  return Object.freeze({
    method: expected.method,
    url: parsed.toString(),
    expiresAt: new Date(signedExpiry).toISOString(),
    requiredHeaders: Object.freeze(headers)
  });
}

function assertSameReservation(existing: PrivateMediaRecord, requested: PrivateMediaRecord): void {
  if (
    existing.locator.key !== requested.locator.key ||
    existing.kind !== requested.kind ||
    existing.declaredMimeType !== requested.declaredMimeType ||
    existing.expectedBytes !== requested.expectedBytes ||
    !safeEqual(existing.expectedSha256Hex, requested.expectedSha256Hex) ||
    existing.expiresAt !== requested.expiresAt ||
    !safeEqual(existing.binding, requested.binding)
  ) {
    throw new PrivateMediaError({
      code: "reservation_conflict",
      message: "Replayed media reservation does not match immutable reservation metadata."
    });
  }
}

function assertStableObject(
  record: PrivateMediaRecord,
  snapshot: S3ObjectSnapshot,
  detected: DetectedMediaFile,
  objectIdentitySha256: string
): void {
  if (
    record.objectVersionId !== snapshot.versionId ||
    record.objectIdentitySha256 !== objectIdentitySha256 ||
    record.detectedMimeType !== normalizedMimeType(detected.mimeType)
  ) {
    throw integrityError("Stored media changed after authoritative completion verification.");
  }
}

function objectIdentityDigest(locator: S3ObjectLocator, versionId: string): string {
  return createHash("sha256")
    .update([locator.region, locator.bucket, locator.key, versionId].join("\u001f"))
    .digest("hex");
}

function digestCanonicalEvidence(evidence: SignedMalwareEvidence): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        payload: orderedEvidencePayload(evidence.payload),
        signature: {
          algorithm: evidence.signature.algorithm,
          keyId: evidence.signature.keyId,
          valueBase64: evidence.signature.valueBase64
        }
      })
    )
    .digest("hex");
}

function orderedEvidencePayload(payload: SignedMalwareEvidencePayload) {
  return {
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
  };
}

function lifecycleReceipt(
  record: PrivateMediaRecord,
  state: PublicMediaLifecycleReceipt["state"],
  occurredAt: string
): PublicMediaLifecycleReceipt {
  return Object.freeze({
    mediaId: record.scope.mediaId,
    uploadId: record.scope.uploadId,
    state,
    occurredAt,
    recoverableUntil: state === "deleted" ? record.recoverableUntil : null
  });
}

function integrityError(message: string): PrivateMediaError {
  return new PrivateMediaError({ code: "integrity_mismatch", message });
}

function concurrentChangeError(): PrivateMediaError {
  return new PrivateMediaError({
    code: "concurrent_change",
    message: "Private media state changed concurrently; retry from authoritative state.",
    retryable: true
  });
}

function operationConflictError(): PrivateMediaError {
  return new PrivateMediaError({
    code: "operation_conflict",
    message: "A deterministic private media operation ID was reused with different semantics."
  });
}

function reconciliationPendingError(state: PrivateMediaState): PrivateMediaError {
  return new PrivateMediaError({
    code: "concurrent_change",
    message: "A private media lifecycle operation is awaiting durable reconciliation.",
    retryable: true,
    safeDetails: { state }
  });
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalPrimitiveRecord(
  value: Readonly<Record<string, string | number | boolean | null>>
): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
  );
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function requireDeleteReasonCode(value: unknown): PrivateMediaDeleteReasonCode {
  if (
    typeof value !== "string" ||
    ![
      "retention_policy",
      "patient_erasure_request",
      "clinical_correction",
      "security_response",
      "legal_disposition"
    ].includes(value)
  ) {
    throw new PrivateMediaError({
      code: "invalid_request",
      message: "A governed media deletion reason code is required."
    });
  }
  return value as PrivateMediaDeleteReasonCode;
}

function requireRestoreReasonCode(value: unknown): PrivateMediaRestoreReasonCode {
  if (
    typeof value !== "string" ||
    ![
      "authorized_restore",
      "clinical_correction",
      "security_response",
      "legal_disposition"
    ].includes(value)
  ) {
    throw new PrivateMediaError({
      code: "invalid_request",
      message: "A governed media restoration reason code is required."
    });
  }
  return value as PrivateMediaRestoreReasonCode;
}

function sanitizedSignerTransportError(): PrivateMediaError {
  return new PrivateMediaError({
    code: "provider_error",
    message: "The private media signing service is temporarily unavailable.",
    retryable: true
  });
}

function invalidEvidence(message: string): PrivateMediaError {
  return new PrivateMediaError({ code: "scan_evidence_invalid", message });
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  return actual.length === required.length && actual.every((key, index) => key === required[index]);
}

function isStrictBoundedBase64Signature(value: string): boolean {
  if (
    value.length < 44 ||
    value.length > 1_368 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    return false;
  }
  const decoded = Buffer.from(value, "base64");
  return (
    decoded.byteLength >= 32 && decoded.byteLength <= 1_024 && decoded.toString("base64") === value
  );
}

function requireOpaqueProviderValue(value: string, label: string): string {
  if (!value || value.length > 1024 || /[\r\n\u0000]/u.test(value)) {
    throw new PrivateMediaError({
      code: "provider_error",
      message: `Media provider returned an invalid ${label}.`
    });
  }
  return value;
}

function assertSafeAuditMetadata(
  metadata: Readonly<Record<string, string | number | boolean | null>>
): void {
  const serialized = JSON.stringify(metadata);
  if (
    serialized.length > 8192 ||
    /(?:bucket|object[_-]?key|version[_-]?id|signed[_-]?url|provider[_-]?token|authorization)/iu.test(
      serialized
    )
  ) {
    throw new PrivateMediaError({
      code: "provider_error",
      message: "Private media audit metadata contains a forbidden provider authority field."
    });
  }
}

function assertSafeIntentPayload(
  payload: Readonly<Record<string, string | number | boolean | null>>
): void {
  const serialized = JSON.stringify(payload);
  if (
    serialized.length > 8192 ||
    /(?:bucket|object[_-]?key|version[_-]?id|signed[_-]?url|provider[_-]?token|authorization)/iu.test(
      serialized
    )
  ) {
    throw new PrivateMediaError({
      code: "provider_error",
      message: "Private media reconciliation intent contains a forbidden provider authority field."
    });
  }
}
