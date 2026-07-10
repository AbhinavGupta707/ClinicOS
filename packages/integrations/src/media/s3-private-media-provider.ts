import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { PrivateMediaError } from "./errors.js";
import type {
  ClinicalMediaKind,
  DetectedMediaFile,
  MagicByteDetector,
  MalwareEvidenceSignatureVerifier,
  MalwareEvidenceStore,
  MalwareScannerTransport,
  PrivateMediaAuditAction,
  PrivateMediaAuditEvent,
  PrivateMediaAuditSink,
  PrivateMediaAuthority,
  PrivateMediaRecord,
  PrivateMediaScope,
  PrivateMediaState,
  PrivateMediaStateStore,
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
  readonly state: PrivateMediaStateStore;
  readonly evidence: MalwareEvidenceStore;
  readonly audit: PrivateMediaAuditSink;
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
    Pick<S3PrivateMediaProviderConfig, "environment" | "bucket" | "region" | "kmsKeyId">;
  readonly #bindingSecret: Buffer;
  readonly #objects: S3PrivateObjectTransport;
  readonly #signer: S3PresigningTransport;
  readonly #detector: MagicByteDetector;
  readonly #scanner: MalwareScannerTransport;
  readonly #evidenceVerifier: MalwareEvidenceSignatureVerifier;
  readonly #state: PrivateMediaStateStore;
  readonly #evidence: MalwareEvidenceStore;
  readonly #audit: PrivateMediaAuditSink;
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
    this.#state = dependencies.state;
    this.#evidence = dependencies.evidence;
    this.#audit = dependencies.audit;
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
      deleteMarkerVersionId: null,
      deletedAt: null,
      recoverableUntil: null,
      legalHold: false,
      createdAt,
      updatedAt: createdAt
    };

    const createResult = await this.#state.create(record);
    if (createResult === "conflict") {
      await this.#appendAudit(input.authority, "media.upload_rejected", "denied", {
        reason: "reservation_conflict"
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

    const transportRequest = await this.#signer.signPutObject({
      locator,
      expiresAt,
      contentLength: input.expectedBytes,
      contentType: mimeType,
      checksumSha256Base64: Buffer.from(sha256Hex, "hex").toString("base64"),
      metadata: { [PRIVATE_METADATA_BINDING]: binding },
      tags: { [QUARANTINE_TAG]: UPLOAD_TAG_VALUE }
    });
    const upload = publicSignedRequest(transportRequest, {
      method: "PUT",
      requestedExpiresAt: expiresAt,
      now,
      requiredHeaders: {
        "content-type": mimeType,
        "content-length": String(input.expectedBytes),
        "x-amz-checksum-sha256": Buffer.from(sha256Hex, "hex").toString("base64"),
        "x-amz-meta-clinicos-binding": binding,
        "x-amz-tagging": `${QUARANTINE_TAG}=${UPLOAD_TAG_VALUE}`
      }
    });
    await this.#appendAudit(input.authority, "media.upload_reserved", "succeeded", {
      kind: input.kind,
      mimeType,
      expectedBytes: input.expectedBytes,
      expiresAt
    });
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
    if (["deleted", "purged"].includes(record.state)) {
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
        await this.#transition(record, ["reserved"], next);
        record = next;
      } else {
        assertStableObject(record, snapshot, detected, objectIdentitySha256);
      }
      await this.#appendAudit(authority, "media.upload_verified", "succeeded", {
        kind: record.kind,
        detectedMimeType: detected.mimeType,
        contentLength: snapshot.contentLength,
        checksumVerified: true,
        kmsVerified: true,
        multipartComplete: true
      });
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
        await this.#quarantineOnIntegrityFailure(record, now);
        await this.#appendAudit(authority, "media.upload_rejected", "failed", {
          reason: error.code
        });
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
    const claimed: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      state: "scan_in_progress",
      scanAttempts: record.scanAttempts + 1,
      inspectionLeaseId: leaseId,
      inspectionLeaseExpiresAt: new Date(
        now.getTime() + this.#config.inspectionLeaseSeconds * 1000
      ).toISOString(),
      updatedAt: now.toISOString()
    };
    await this.#transition(record, [record.state], claimed);
    record = claimed;
    await this.#appendAudit(authority, "media.scan_started", "succeeded", {
      attempt: record.scanAttempts
    });

    let evidence: SignedMalwareEvidence;
    try {
      evidence = await this.#scanner.scan({
        authority,
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
      this.#validateEvidencePayload(record, evidence.payload, now);
      if (!(await this.#evidenceVerifier.verify(evidence))) {
        throw new PrivateMediaError({
          code: "scan_evidence_invalid",
          message: "Media inspection evidence signature could not be verified."
        });
      }
      const evidenceDigestSha256 = digestCanonicalEvidence(evidence);
      const evidenceOutcome = await this.#evidence.append({
        scope: record.scope,
        evidenceId: evidence.payload.evidenceId,
        evidenceDigestSha256,
        evidence,
        recordedAt: now.toISOString()
      });
      if (evidenceOutcome === "conflict") {
        throw new PrivateMediaError({
          code: "scan_evidence_conflict",
          message: "Conflicting media inspection evidence was detected."
        });
      }
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
        updatedAt: now.toISOString()
      };
      await this.#transition(record, ["scan_in_progress"], completed);
      await this.#appendAudit(
        authority,
        evidence.payload.verdict === "error" ? "media.scan_failed" : "media.scan_completed",
        evidence.payload.verdict === "error" ? "failed" : "succeeded",
        {
          verdict: evidence.payload.verdict,
          evidenceId: evidence.payload.evidenceId,
          evidenceDigestSha256,
          scanner: evidence.payload.scanner,
          definitionsVersion: evidence.payload.definitionsVersion,
          attempt: record.scanAttempts
        }
      );
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
      await this.#appendAudit(authority, "media.access_signed", "denied", {
        reason: "quarantined"
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
    const signed = await this.#signer.signGetObject({
      locator: record.locator,
      versionId: record.objectVersionId,
      expiresAt: boundedExpiry,
      responseContentType: record.detectedMimeType ?? record.declaredMimeType
    });
    const access = publicSignedRequest(signed, {
      method: "GET",
      requestedExpiresAt: boundedExpiry,
      now,
      requiredHeaders: {}
    });
    await this.#appendAudit(authority, "media.access_signed", "succeeded", {
      expiresAt: access.expiresAt,
      method: "GET"
    });
    return access;
  }

  async deleteMedia(
    input: Readonly<{
      authority: PrivateMediaAuthority;
      reason: string;
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
    requireReason(input.reason);
    const deletion = await this.#objects.createDeleteMarker(record.locator);
    const recoverableUntil = new Date(
      now.getTime() + this.#config.restoreWindowSeconds * 1000
    ).toISOString();
    const deleted: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      state: "deleted",
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
    await this.#transition(record, [record.state], deleted);
    await this.#appendAudit(input.authority, "media.deleted", "succeeded", {
      reason: input.reason.trim().slice(0, 200),
      recoverableUntil
    });
    return lifecycleReceipt(deleted, "deleted", deletion.deletedAt);
  }

  async restoreMedia(
    input: Readonly<{
      authority: PrivateMediaAuthority;
      reason: string;
    }>
  ): Promise<PublicMediaLifecycleReceipt> {
    const now = this.#now();
    const record = await this.#requireRecord(input.authority);
    requireReason(input.reason);
    if (record.state !== "deleted" || !record.deleteMarkerVersionId) {
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
    await this.#objects.removeDeleteMarker({
      locator: record.locator,
      deleteMarkerVersionId: record.deleteMarkerVersionId
    });
    const snapshot = await this.#objects.headObject(record.locator);
    if (!snapshot) {
      throw new PrivateMediaError({
        code: "object_missing",
        message: "The restored media version could not be verified."
      });
    }
    this.#validateSnapshot(record, snapshot);
    if (
      snapshot.versionId !== record.objectVersionId ||
      objectIdentityDigest(record.locator, snapshot.versionId) !== record.objectIdentitySha256
    ) {
      throw integrityError("The restored media version does not match immutable provenance.");
    }
    const restored: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      state: "upload_verified",
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
    await this.#transition(record, ["deleted"], restored);
    await this.#appendAudit(input.authority, "media.restored", "succeeded", {
      reason: input.reason.trim().slice(0, 200),
      rescanRequired: true
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
    await this.#objects.deleteObjectVersion({
      locator: record.locator,
      versionId: record.objectVersionId
    });
    if (record.deleteMarkerVersionId) {
      await this.#objects.deleteObjectVersion({
        locator: record.locator,
        versionId: record.deleteMarkerVersionId
      });
    }
    const purged: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      state: "purged",
      deleteMarkerVersionId: null,
      updatedAt: now.toISOString()
    };
    await this.#transition(record, ["deleted"], purged);
    await this.#appendAudit(authority, "media.purged", "succeeded", {
      retentionWindowExpired: true
    });
    return lifecycleReceipt(purged, "purged", now.toISOString());
  }

  async setLegalHold(authority: PrivateMediaAuthority, legalHold: boolean): Promise<void> {
    const record = await this.#requireRecord(authority);
    const next = {
      ...record,
      revision: record.revision + 1,
      legalHold,
      updatedAt: this.#now().toISOString()
    };
    await this.#transition(record, [record.state], next);
  }

  async internalSnapshot(authority: PrivateMediaAuthority): Promise<
    Readonly<{
      objectKey: string;
      contentLength: number;
      mimeType: string;
      sha256Digest: string;
      objectVersionId: string | null;
      storedAt: string;
    }>
  > {
    const record = await this.#requireRecord(authority);
    const snapshot = await this.#objects.headObject(record.locator);
    if (!snapshot) {
      throw new PrivateMediaError({ code: "object_missing", message: "Media object is missing." });
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
    const record = await this.#state.get(scopeOnly(authority));
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

  #validateEvidencePayload(
    record: PrivateMediaRecord,
    payload: SignedMalwareEvidencePayload,
    now: Date
  ): void {
    const expected = {
      tenantId: record.scope.tenantId,
      clinicId: record.scope.clinicId,
      mediaId: record.scope.mediaId,
      uploadId: record.scope.uploadId,
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
    if (!SAFE_ID.test(payload.evidenceId) || !SAFE_ID.test(payload.scanner)) {
      throw new PrivateMediaError({
        code: "scan_evidence_invalid",
        message: "Media inspection evidence identifiers are invalid."
      });
    }
    if (!HEX_SHA256.test(payload.contentSha256Hex)) {
      throw new PrivateMediaError({
        code: "scan_evidence_invalid",
        message: "Media inspection evidence digest is invalid."
      });
    }
    const scannedAt = Date.parse(payload.scannedAt);
    if (
      !Number.isFinite(scannedAt) ||
      Math.abs(scannedAt - now.getTime()) > this.#config.maxScannerClockSkewSeconds * 1000
    ) {
      throw new PrivateMediaError({
        code: "scan_evidence_invalid",
        message: "Media inspection evidence is outside the accepted time window."
      });
    }
  }

  async #transition(
    previous: PrivateMediaRecord,
    expectedStates: readonly PrivateMediaState[],
    next: PrivateMediaRecord
  ): Promise<void> {
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
    const changed = await this.#state.compareAndSwap({
      scope: previous.scope,
      expectedRevision: previous.revision,
      expectedStates,
      next
    });
    if (!changed) {
      throw new PrivateMediaError({
        code: "concurrent_change",
        message: "Private media state changed concurrently; retry from authoritative state.",
        retryable: true
      });
    }
  }

  async #quarantineOnIntegrityFailure(record: PrivateMediaRecord, now: Date): Promise<void> {
    if (["deleted", "purged", "quarantined"].includes(record.state)) return;
    const quarantined: PrivateMediaRecord = {
      ...record,
      revision: record.revision + 1,
      state: "quarantined",
      inspectionLeaseId: null,
      inspectionLeaseExpiresAt: null,
      updatedAt: now.toISOString()
    };
    try {
      await this.#transition(record, [record.state], quarantined);
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
      updatedAt: now.toISOString()
    };
    try {
      await this.#transition(record, ["scan_in_progress"], failed);
    } catch (error) {
      if (!(error instanceof PrivateMediaError) || error.code !== "concurrent_change") throw error;
    }
    await this.#appendAudit(authority, "media.scan_failed", "failed", {
      reason,
      attempt: record.scanAttempts
    });
  }

  async #appendAudit(
    authority: PrivateMediaAuthority,
    action: PrivateMediaAuditAction,
    outcome: PrivateMediaAuditEvent["outcome"],
    metadata: PrivateMediaAuditEvent["metadata"]
  ): Promise<void> {
    assertSafeAuditMetadata(metadata);
    await this.#audit.append(
      Object.freeze({
        eventId: this.#randomId(),
        action,
        occurredAt: this.#now().toISOString(),
        tenantId: authority.tenantId,
        clinicId: authority.clinicId,
        mediaId: authority.mediaId,
        uploadId: authority.uploadId,
        actorId: authority.actorId,
        correlationId: authority.correlationId,
        outcome,
        metadata: Object.freeze({ ...metadata })
      })
    );
  }
}

function validateProviderConfig(config: S3PrivateMediaProviderConfig): void {
  if (!SAFE_ENVIRONMENT.test(config.environment)) invalidConfig("environment");
  if (!config.bucket || config.bucket.length > 255) invalidConfig("bucket");
  if (!config.region || config.region.length > 64) invalidConfig("region");
  if (!config.kmsKeyId || config.kmsKeyId.length > 512) invalidConfig("KMS key");
  if (Buffer.from(config.bindingSecret).byteLength < 32) invalidConfig("binding secret");
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
    value.url.length > 8192
  ) {
    throw new PrivateMediaError({
      code: "provider_error",
      message: "Media signer returned an insecure URL."
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

function safeEqual(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

function requireReason(value: string): void {
  if (!value.trim() || value.length > 500) {
    throw new PrivateMediaError({
      code: "invalid_request",
      message: "A bounded lifecycle reason is required."
    });
  }
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
