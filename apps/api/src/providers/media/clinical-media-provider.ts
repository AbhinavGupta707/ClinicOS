import type { MediaType, UUID } from "@clinic-os/domain";
import type { ClinicalMediaInspectionProvider } from "../../features/clinical-dental/types.ts";
import type {
  MediaSignedReadAccess,
  MediaStorageProvider,
  MediaUploadTarget,
  StoredMediaObject
} from "../../media-storage.ts";
import type {
  MediaRequestAuthorityFactory,
  MediaServiceAuthorityFactory,
  PrivateMediaGateway,
  PrivateMediaGatewayAuthority,
  PrivateMediaGatewayScope,
  PrivateMediaLifecycleResult
} from "./ports.ts";

export interface S3ClinicalMediaProviderOptions {
  readonly gateway: PrivateMediaGateway;
  readonly region: string;
  readonly authorityFactory: MediaRequestAuthorityFactory;
}

/**
 * Production adapter between the existing clinical handler ports and the private S3/KMS gateway.
 * It does not hold URL capabilities or object state in process memory, so restarts cannot weaken
 * tenant binding or quarantine decisions.
 */
export class S3ClinicalMediaProvider
  implements MediaStorageProvider, ClinicalMediaInspectionProvider
{
  readonly providerKey = "s3" as const;
  readonly region: string;
  readonly #gateway: PrivateMediaGateway;
  readonly #authorityFactory: MediaRequestAuthorityFactory;

  constructor(options: S3ClinicalMediaProviderOptions) {
    if (!options.region.trim()) throw new Error("S3 clinical media region is required.");
    if (!options.authorityFactory || options.authorityFactory.attribution !== "request") {
      throw new Error(
        "S3 clinical media routed composition requires an explicit request authority factory."
      );
    }
    this.region = options.region;
    this.#gateway = options.gateway;
    this.#authorityFactory = options.authorityFactory;
  }

  buildObjectKey(input: {
    tenantId: UUID;
    clinicId: UUID;
    patientId: UUID;
    uploadId: UUID;
    originalFilename: string;
  }): string {
    void input.patientId;
    void input.originalFilename;
    return this.#gateway.allocateInternalObjectKey({
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      mediaId: input.uploadId,
      uploadId: input.uploadId
    });
  }

  async createUploadTarget(
    input: Parameters<MediaStorageProvider["createUploadTarget"]>[0] & {
      readonly mediaType?: MediaType;
    }
  ): Promise<MediaUploadTarget> {
    if (!input.expectedSha256Digest) {
      throw new Error("Production S3 media upload requires a reservation SHA-256 digest.");
    }
    const scope = this.#gateway.scopeFromInternalObjectKey(input.objectKey);
    assertScopeMatches(scope, {
      tenantId: input.tenantId,
      clinicId: input.clinicId,
      mediaId: input.uploadId,
      uploadId: input.uploadId
    });
    const authority = this.#authorityFactory.forScope(scope);
    const reservation = await this.#gateway.reserveUpload({
      authority,
      internalObjectKey: input.objectKey,
      kind: input.mediaType ?? conservativeMediaKind(input.mimeType),
      declaredMimeType: input.mimeType,
      expectedBytes: input.expectedFileSizeBytes,
      expectedSha256Hex: input.expectedSha256Digest,
      expiresAt: input.expiresAt
    });
    return {
      method: "PUT",
      uploadUrl: reservation.upload.url,
      expiresAt: reservation.upload.expiresAt,
      maxBytes: reservation.upload.maxBytes ?? input.expectedFileSizeBytes,
      requiredHeaders: { ...reservation.upload.requiredHeaders }
    };
  }

  async receiveUpload(input: {
    objectKey: string;
    body: Buffer;
    mimeType: string;
    metadata: Record<string, string>;
  }): Promise<StoredMediaObject> {
    const scope = this.#gateway.scopeFromInternalObjectKey(input.objectKey);
    assertMetadataScope(input.metadata, scope);
    const authority = this.#authorityFactory.forScope(scope);
    await this.#gateway.ingestProxiedUpload({
      authority,
      body: input.body,
      contentType: input.mimeType
    });
    return this.#storedObject(authority);
  }

  async statObject(objectKey: string): Promise<StoredMediaObject | null> {
    const scope = this.#gateway.scopeFromInternalObjectKey(objectKey);
    const authority = this.#authorityFactory.forScope(scope);
    try {
      await this.#gateway.verifyUploadCompletion(authority);
      return await this.#storedObject(authority);
    } catch (error) {
      if (providerErrorCode(error) === "object_missing") return null;
      throw error;
    }
  }

  async createSignedReadAccess(input: {
    objectKey: string;
    mimeType: string;
    expiresAt: string;
  }): Promise<MediaSignedReadAccess> {
    const scope = this.#gateway.scopeFromInternalObjectKey(input.objectKey);
    const authority = this.#authorityFactory.forScope(scope);
    const access = await this.#gateway.createSignedReadAccess(authority, input.expiresAt);
    return {
      method: "GET",
      signedUrl: access.url,
      expiresAt: access.expiresAt,
      headers: { ...access.requiredHeaders }
    };
  }

  async inspect(
    input: Parameters<ClinicalMediaInspectionProvider["inspect"]>[0]
  ): Promise<Awaited<ReturnType<ClinicalMediaInspectionProvider["inspect"]>>> {
    const scope = this.#gateway.scopeFromInternalObjectKey(input.reservation.objectKey);
    assertScopeMatches(scope, {
      tenantId: input.reservation.tenantId,
      clinicId: input.reservation.clinicId,
      mediaId: input.reservation.id,
      uploadId: input.reservation.id
    });
    if (input.object.objectKey !== input.reservation.objectKey) {
      throw new Error("Media inspection object does not match its reservation.");
    }
    const authority = this.#authorityFactory.forScope(scope);
    const result = await this.#gateway.inspectQuarantinedMedia(authority);
    const snapshot = await this.#gateway.internalSnapshot(authority);
    return {
      scanStatus:
        result.scanStatus === "clean"
          ? "clean"
          : result.scanStatus === "failed"
            ? "failed"
            : "quarantined",
      quarantineReason:
        result.scanStatus === "clean"
          ? null
          : result.scanStatus === "failed"
            ? "scanner_evidence_failed"
            : "malware_or_suspicious_content",
      objectVersion: snapshot.objectVersionId,
      dicomMetadata: {}
    };
  }

  async #storedObject(authority: PrivateMediaGatewayAuthority): Promise<StoredMediaObject> {
    const snapshot = await this.#gateway.internalSnapshot(authority);
    return {
      objectKey: snapshot.objectKey,
      contentLength: snapshot.contentLength,
      mimeType: snapshot.mimeType,
      sha256Digest: snapshot.sha256Digest,
      metadata: {},
      storedAt: snapshot.storedAt
    };
  }
}

export class PrivateMediaLifecycleService {
  readonly #gateway: PrivateMediaGateway;

  constructor(gateway: PrivateMediaGateway) {
    this.#gateway = gateway;
  }

  delete(
    input: Readonly<{
      authority: PrivateMediaGatewayAuthority;
      reason: string;
    }>
  ): Promise<PrivateMediaLifecycleResult> {
    return this.#gateway.deleteMedia(input);
  }

  restore(
    input: Readonly<{
      authority: PrivateMediaGatewayAuthority;
      reason: string;
    }>
  ): Promise<PrivateMediaLifecycleResult> {
    return this.#gateway.restoreMedia(input);
  }

  purgeExpired(authority: PrivateMediaGatewayAuthority): Promise<PrivateMediaLifecycleResult> {
    return this.#gateway.purgeExpiredDeletedMedia(authority);
  }

  setLegalHold(authority: PrivateMediaGatewayAuthority, legalHold: boolean): Promise<void> {
    return this.#gateway.setLegalHold(authority, legalHold);
  }
}

export class RoutedMediaAuthorityFactory implements MediaRequestAuthorityFactory {
  readonly attribution = "request" as const;
  readonly #resolve: () => Readonly<{ actorId: string; correlationId: string }>;

  constructor(resolve: () => Readonly<{ actorId: string; correlationId: string }>) {
    this.#resolve = resolve;
  }

  forScope(
    scope: Readonly<{
      tenantId: UUID | string;
      clinicId: UUID | string;
      mediaId: UUID | string;
      uploadId: UUID | string;
    }>
  ): PrivateMediaGatewayAuthority {
    const attribution = this.#resolve();
    if (!attribution.actorId.trim() || !attribution.correlationId.trim()) {
      throw new Error("Verified media request actor and correlation attribution are required.");
    }
    return {
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      mediaId: scope.mediaId,
      uploadId: scope.uploadId,
      actorId: attribution.actorId,
      correlationId: attribution.correlationId
    };
  }
}

/** Explicit factory for narrowly scoped background/reconciliation jobs, never routed user calls. */
export class ServiceMediaAuthorityFactory implements MediaServiceAuthorityFactory {
  readonly attribution = "service" as const;
  readonly #actorId: string;
  readonly #correlationId: () => string;

  constructor(actorId: string, correlationId: () => string) {
    if (!actorId.trim()) throw new Error("Media service actor id is required.");
    this.#actorId = actorId;
    this.#correlationId = correlationId;
  }

  forScope(
    scope: Readonly<{
      tenantId: UUID | string;
      clinicId: UUID | string;
      mediaId: UUID | string;
      uploadId: UUID | string;
    }>
  ): PrivateMediaGatewayAuthority {
    return {
      tenantId: scope.tenantId,
      clinicId: scope.clinicId,
      mediaId: scope.mediaId,
      uploadId: scope.uploadId,
      actorId: this.#actorId,
      correlationId: this.#correlationId()
    };
  }
}

function conservativeMediaKind(mimeType: string): MediaType {
  const normalized = mimeType.split(";", 1)[0]?.trim().toLowerCase();
  if (normalized?.startsWith("audio/")) return "audio_chunk";
  if (normalized === "application/dicom" || normalized === "image/tiff") return "xray";
  if (normalized === "application/pdf") return "document";
  return "intraoral_photo";
}

function assertScopeMatches(
  actual: PrivateMediaGatewayScope,
  expected: PrivateMediaGatewayScope
): void {
  if (
    actual.tenantId !== expected.tenantId ||
    actual.clinicId !== expected.clinicId ||
    actual.mediaId !== expected.mediaId ||
    actual.uploadId !== expected.uploadId
  ) {
    throw new Error("Private media object scope does not match request authority.");
  }
}

function assertMetadataScope(
  metadata: Readonly<Record<string, string>>,
  scope: PrivateMediaGatewayScope
): void {
  const expected: Readonly<Record<string, string>> = {
    tenant_id: scope.tenantId,
    clinic_id: scope.clinicId,
    upload_id: scope.uploadId
  };
  for (const [key, value] of Object.entries(expected)) {
    if (metadata[key] !== undefined && metadata[key] !== value) {
      throw new Error("Proxied media metadata does not match private object authority.");
    }
  }
}

function providerErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}
