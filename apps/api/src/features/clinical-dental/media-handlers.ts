import { randomUUID } from "node:crypto";
import {
  assertMediaMimeType,
  isDentalToothNumber,
  isMediaScanStatus,
  isMediaType,
  mediaAssetCanBeViewed,
  toPublicMediaAsset,
  toPublicMediaUploadReservation,
  type MediaAssetRecord,
  type MediaType,
  type MediaUploadReservationRecord,
  type UUID
} from "@clinic-os/domain";
import {
  assertClinicalMediaBudget,
  CLINICAL_MEDIA_ACCESS_MAX_SECONDS,
  CLINICAL_MEDIA_ACCESS_MIN_SECONDS,
  CLINICAL_MEDIA_UPLOAD_TTL_MS
} from "@clinic-os/domain";
import type {
  MediaSignedReadAccess,
  MediaUploadTarget,
  StoredMediaObject
} from "../../media-storage.ts";
import type { ClinicFeatureExecutionContext } from "../contracts.ts";
import {
  appendAudit,
  appendMutationEvidence,
  assertDentalFindingPatient,
  assertPatientExists,
  configuration,
  conflict,
  created,
  notFound,
  ok,
  parsedBinaryBody,
  parsedBody,
  parsedPathId,
  parsedQueryInteger,
  requireClinicalConsent,
  validation,
  type ClinicalDentalRequest,
  type ParsedJsonObject
} from "./shared.ts";
import type {
  ClinicalDentalHandlerDependencies,
  ClinicalMediaInspectionProvider
} from "./types.ts";

interface RequestMediaUploadBody extends ParsedJsonObject {
  readonly patientId: UUID;
  readonly encounterId?: UUID | null;
  readonly toothNumber?: string | null;
  readonly dentalFindingId?: UUID | null;
  readonly mediaType: MediaType;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
  readonly sha256Digest?: string | null;
  readonly tags?: readonly string[];
  readonly provenance?: Readonly<Record<string, unknown>>;
}

interface CompleteMediaUploadBody extends ParsedJsonObject {
  readonly patientId: UUID;
  readonly encounterId?: UUID | null;
  readonly contentLength?: number | null;
  readonly sha256Digest?: string | null;
  readonly mimeType?: string | null;
}

interface SignedMediaAccessBody extends ParsedJsonObject {
  readonly expiresInSeconds?: number;
}

export function createMediaHandlers(dependencies: ClinicalDentalHandlerDependencies) {
  return {
    requestMediaUploadUrl: async (
      request: ClinicalDentalRequest<"requestMediaUploadUrl">,
      context: ClinicFeatureExecutionContext
    ) => {
      const input = parsedBody<RequestMediaUploadBody>(request);
      const storage = mediaStorage(dependencies, request, context);
      if (!isMediaType(input.mediaType)) {
        throw validation("Unsupported clinical media type.", { field: "mediaType" });
      }
      assertClinicalMediaBudget(input.fileSizeBytes);
      try {
        assertMediaMimeType(input.mediaType, input.mimeType);
      } catch (error) {
        throw validation(error instanceof Error ? error.message : "Invalid media MIME type.", {
          field: "mimeType",
          mediaType: input.mediaType
        });
      }
      if (input.toothNumber && !isDentalToothNumber(input.toothNumber)) {
        throw validation("Media tooth number must use valid FDI notation.", {
          field: "toothNumber"
        });
      }
      await assertPatientExists(dependencies, context, input.patientId);
      await requireClinicalConsent(request, context, input.patientId, "media_reserve", {
        mediaType: input.mediaType
      });
      await assertEncounterPatient(context, input.encounterId, input.patientId);
      if (input.dentalFindingId) {
        await assertDentalFindingPatient(
          dependencies,
          context,
          input.dentalFindingId,
          input.patientId
        );
      }

      const uploadId = randomUUID() as UUID;
      const serverFilename = serverGeneratedMediaFilename(
        uploadId,
        input.originalFilename,
        input.mimeType
      );
      const expiresAt = new Date(
        context.clock.now().getTime() + CLINICAL_MEDIA_UPLOAD_TTL_MS
      ).toISOString();
      const objectKey = storage.buildObjectKey({
        tenantId: request.access.context.tenant.id,
        clinicId: request.access.clinicId,
        patientId: input.patientId,
        uploadId,
        originalFilename: serverFilename
      });
      const reservation = await context.repositories.clinicalMedia.createMediaUploadReservation({
        id: uploadId,
        patientId: input.patientId,
        encounterId: input.encounterId,
        toothNumber: input.toothNumber,
        dentalFindingId: input.dentalFindingId,
        mediaType: input.mediaType,
        originalFilename: serverFilename,
        mimeType: input.mimeType.toLowerCase(),
        expectedFileSizeBytes: input.fileSizeBytes,
        expectedSha256Digest: input.sha256Digest,
        objectKey,
        storageProvider: storage.providerKey,
        storageRegion: storage.region,
        expiresAt,
        tags: input.tags ? [...input.tags] : [],
        provenance: input.provenance ? { ...input.provenance } : {}
      });
      const providerUploadTarget = await storage.createUploadTarget({
        uploadId,
        tenantId: request.access.context.tenant.id,
        clinicId: request.access.clinicId,
        patientId: input.patientId,
        objectKey,
        mimeType: reservation.mimeType,
        expectedFileSizeBytes: reservation.expectedFileSizeBytes,
        expectedSha256Digest: reservation.expectedSha256Digest,
        expiresAt
      });
      const uploadTarget = publicUploadTarget(providerUploadTarget, {
        uploadId,
        mimeType: reservation.mimeType,
        expectedFileSizeBytes: reservation.expectedFileSizeBytes,
        requestedExpiresAt: expiresAt,
        nowMs: context.clock.now().getTime()
      });

      await appendMutationEvidence(request, context, {
        auditAction: "media.upload_requested",
        eventType: "media.upload_requested",
        aggregateType: "media_upload",
        aggregateId: reservation.id,
        patientId: reservation.patientId,
        auditMetadata: mediaAuditMetadata(reservation),
        eventPayload: {
          uploadId: reservation.id,
          patientId: reservation.patientId,
          mediaType: reservation.mediaType,
          encounterId: reservation.encounterId,
          toothNumber: reservation.toothNumber,
          dentalFindingId: reservation.dentalFindingId
        }
      });
      return created({
        upload: publicMediaUploadReservation(reservation),
        uploadTarget
      });
    },

    receiveMediaUploadContent: async (
      request: ClinicalDentalRequest<"receiveMediaUploadContent">,
      context: ClinicFeatureExecutionContext
    ) => {
      const uploadId = parsedPathId(request, "uploadId");
      const body = parsedBinaryBody(request);
      const storage = mediaStorage(dependencies, request, context);
      const reservation =
        await context.repositories.clinicalMedia.findMediaUploadReservationById(uploadId);
      if (!reservation) {
        throw notFound("Media upload reservation not found.", { upload_id: uploadId });
      }
      assertStorageMatches(storage.providerKey, reservation);
      assertUploadOpen(reservation, context.clock.now().getTime());
      await requireClinicalConsent(request, context, reservation.patientId, "media_receive", {
        mediaType: reservation.mediaType
      });
      if (body.byteLength !== reservation.expectedFileSizeBytes) {
        throw validation("Uploaded object size does not match the reserved media metadata.", {
          upload_id: uploadId,
          expected_bytes: reservation.expectedFileSizeBytes,
          received_bytes: body.byteLength
        });
      }

      let object = await storage.statObject(reservation.objectKey);
      if (object) {
        validateStoredObject(reservation, object, {});
      } else {
        object = await storage.receiveUpload({
          objectKey: reservation.objectKey,
          body: Buffer.from(body),
          mimeType: reservation.mimeType,
          metadata: {
            tenant_id: reservation.tenantId,
            clinic_id: reservation.clinicId,
            patient_id: reservation.patientId,
            upload_id: reservation.id
          }
        });
        validateStoredObject(reservation, object, {});
      }
      const durableIntegrity = context.repositories.durableIntegrity;
      if (typeof durableIntegrity?.recordClinicalMediaReceipt === "function") {
        const receipt = await durableIntegrity.recordClinicalMediaReceipt({
          uploadId,
          providerKey: storage.providerKey,
          providerArtifactReference: reservation.objectKey,
          contentLength: object.contentLength,
          mimeType: object.mimeType,
          sha256Digest: object.sha256Digest,
          storedAt: object.storedAt,
          receivedAt: context.clock.now().toISOString()
        });
        if (receipt.outcome === "mismatch") {
          throw conflict(
            "Stored media receipt conflicts with previously verified provider evidence.",
            {
              upload_id: uploadId,
              reconciliation_required: true
            }
          );
        }
        if (receipt.outcome === "not_found" || receipt.outcome === "not_receivable") {
          throw conflict("Media upload reservation is no longer receivable.", {
            upload_id: uploadId
          });
        }
      }
      return ok({
        upload: publicMediaUploadReservation(reservation),
        object: publicStoredObject(object)
      });
    },

    completeMediaUpload: async (
      request: ClinicalDentalRequest<"completeMediaUpload">,
      context: ClinicFeatureExecutionContext
    ) => {
      const uploadId = parsedPathId(request, "uploadId");
      const input = parsedBody<CompleteMediaUploadBody>(request);
      const transactionMedia = dependencies.transactionMediaProvider?.(request, context);
      const storage = transactionMedia ?? mediaStorage(dependencies, request, context);
      const inspection = transactionMedia ?? mediaInspection(dependencies, request, context);
      const reservation =
        await context.repositories.clinicalMedia.findMediaUploadReservationById(uploadId);
      if (!reservation) {
        throw notFound("Media upload reservation not found.", { upload_id: uploadId });
      }
      assertStorageMatches(storage.providerKey, reservation);
      assertUploadOpen(reservation, context.clock.now().getTime());
      if (input.patientId !== reservation.patientId) {
        throw validation("Complete-upload patient does not match the reservation.", {
          upload_id: uploadId
        });
      }
      if ((input.encounterId ?? null) !== reservation.encounterId) {
        throw validation("Complete-upload encounter does not match the reservation.", {
          upload_id: uploadId
        });
      }
      await requireClinicalConsent(request, context, reservation.patientId, "media_complete", {
        mediaType: reservation.mediaType
      });
      const object = await storage.statObject(reservation.objectKey);
      if (!object) {
        throw conflict("Reserved media object has not been uploaded.", { upload_id: uploadId });
      }
      validateStoredObject(reservation, object, input);
      const inspectionResult = await inspection.inspect({
        reservation,
        object,
        now: context.clock.now()
      });
      validateInspectionResult(reservation.mediaType, inspectionResult);
      const asset = await context.repositories.clinicalMedia.completeMediaUpload(uploadId, {
        contentLength: object.contentLength,
        sha256Digest: object.sha256Digest,
        objectVersion: inspectionResult.objectVersion,
        scanStatus: inspectionResult.scanStatus,
        quarantineReason: inspectionResult.quarantineReason,
        dicomMetadata: inspectionResult.dicomMetadata ? { ...inspectionResult.dicomMetadata } : {}
      });
      if (!asset) {
        throw conflict("Media upload reservation is no longer completable.", {
          upload_id: uploadId
        });
      }
      await appendMutationEvidence(request, context, {
        auditAction: "media.upload_completed",
        eventType: "media.upload_completed",
        aggregateType: "media_asset",
        aggregateId: asset.id,
        patientId: asset.patientId,
        auditMetadata: mediaAuditMetadata(asset),
        eventPayload: {
          mediaAssetId: asset.id,
          uploadId,
          patientId: asset.patientId,
          mediaType: asset.mediaType,
          encounterId: asset.encounterId,
          toothNumber: asset.toothNumber,
          dentalFindingId: asset.dentalFindingId,
          scanStatus: asset.scanStatus
        }
      });
      return created({ mediaAsset: publicMediaAsset(asset) });
    },

    listPatientMediaAssets: async (
      request: ClinicalDentalRequest<"listPatientMediaAssets">,
      context: ClinicFeatureExecutionContext
    ) => {
      const patientId = parsedPathId(request, "patientId");
      const limit = parsedQueryInteger(request, "limit") ?? 50;
      await assertPatientExists(dependencies, context, patientId);
      const mediaAssets = (
        await context.repositories.clinicalMedia.listPatientMediaAssets(patientId)
      )
        .slice(0, limit)
        .map(publicMediaAsset);
      await appendAudit(request, context, "media.viewed", {
        patientId,
        resourceType: "media_asset_collection",
        resourceId: patientId,
        metadata: { resultCount: mediaAssets.length }
      });
      return ok({ mediaAssets });
    },

    createSignedMediaAccess: async (
      request: ClinicalDentalRequest<"createSignedMediaAccess">,
      context: ClinicFeatureExecutionContext
    ) => {
      const mediaAssetId = parsedPathId(request, "mediaAssetId");
      const input = parsedBody<SignedMediaAccessBody>(request);
      const storage = mediaStorage(dependencies, request, context);
      const asset = await context.repositories.clinicalMedia.findMediaAssetById(mediaAssetId);
      if (!asset) throw notFound("Media asset not found.", { media_asset_id: mediaAssetId });
      assertStorageMatches(storage.providerKey, asset);
      await requireClinicalConsent(request, context, asset.patientId, "media_access", {
        mediaType: asset.mediaType
      });
      if (!mediaAssetCanBeViewed(asset)) {
        throw conflict("Media asset cannot be viewed until scanning clears it.", {
          media_asset_id: mediaAssetId,
          scan_status: asset.scanStatus
        });
      }
      const expiresInSeconds = Math.min(
        Math.max(
          input.expiresInSeconds ?? CLINICAL_MEDIA_ACCESS_MAX_SECONDS,
          CLINICAL_MEDIA_ACCESS_MIN_SECONDS
        ),
        CLINICAL_MEDIA_ACCESS_MAX_SECONDS
      );
      const expiresAt = new Date(
        context.clock.now().getTime() + expiresInSeconds * 1000
      ).toISOString();
      const providerAccess = await storage.createSignedReadAccess({
        objectKey: asset.objectKey,
        mimeType: asset.mimeType,
        expiresAt
      });
      const access = publicSignedReadAccess(providerAccess, {
        requestedExpiresAt: expiresAt,
        nowMs: context.clock.now().getTime()
      });
      await appendAudit(request, context, "media.viewed", {
        patientId: asset.patientId,
        resourceType: "media_asset",
        resourceId: asset.id,
        metadata: {
          mediaType: asset.mediaType,
          expiresAt: access.expiresAt,
          expiresInSeconds
        }
      });
      return ok({ mediaAsset: publicMediaAsset(asset), access });
    }
  } as const;
}

function mediaStorage(
  dependencies: ClinicalDentalHandlerDependencies,
  request: ClinicalDentalRequest<ClinicalDentalRequestOperationId>,
  context: ClinicFeatureExecutionContext
) {
  const transactionMedia = dependencies.transactionMediaProvider?.(request, context);
  if (transactionMedia) return transactionMedia;
  if (!dependencies.mediaStorage) {
    throw configuration("Media storage provider is not configured for this ClinicOS runtime.");
  }
  return dependencies.mediaStorage;
}

function mediaInspection(
  dependencies: ClinicalDentalHandlerDependencies,
  request: ClinicalDentalRequest<ClinicalDentalRequestOperationId>,
  context: ClinicFeatureExecutionContext
): ClinicalMediaInspectionProvider {
  const transactionMedia = dependencies.transactionMediaProvider?.(request, context);
  if (transactionMedia) return transactionMedia;
  if (!dependencies.mediaInspection) {
    throw configuration(
      "Media inspection and quarantine provider is not configured for this ClinicOS runtime."
    );
  }
  return dependencies.mediaInspection;
}

type ClinicalDentalRequestOperationId = Parameters<
  NonNullable<ClinicalDentalHandlerDependencies["transactionMediaProvider"]>
>[0]["operationId"];

async function assertEncounterPatient(
  context: ClinicFeatureExecutionContext,
  encounterId: UUID | null | undefined,
  patientId: UUID
): Promise<void> {
  if (!encounterId) return;
  const encounter = await context.repositories.clinicalCare.findEncounterById(encounterId);
  if (!encounter || encounter.patientId !== patientId) {
    throw validation("Encounter does not belong to the media patient.", {
      encounter_id: encounterId,
      patient_id: patientId
    });
  }
}

function assertUploadOpen(reservation: MediaUploadReservationRecord, nowMs: number): void {
  if (reservation.status !== "reserved") {
    throw conflict("Media upload reservation is not open.", {
      upload_id: reservation.id,
      status: reservation.status
    });
  }
  if (new Date(reservation.expiresAt).getTime() <= nowMs) {
    throw conflict("Media upload reservation has expired.", {
      upload_id: reservation.id,
      expires_at: reservation.expiresAt
    });
  }
}

function validateStoredObject(
  reservation: MediaUploadReservationRecord,
  object: StoredMediaObject,
  claimed: Readonly<{
    contentLength?: number | null;
    sha256Digest?: string | null;
    mimeType?: string | null;
  }>
): void {
  if (object.objectKey !== reservation.objectKey) {
    throw configuration("Media storage provider returned an object outside the reservation.");
  }
  if (object.contentLength !== reservation.expectedFileSizeBytes) {
    throw validation("Stored media object size does not match the upload reservation.", {
      upload_id: reservation.id
    });
  }
  if (object.mimeType.toLowerCase() !== reservation.mimeType.toLowerCase()) {
    throw validation("Stored media MIME type does not match the upload reservation.", {
      upload_id: reservation.id
    });
  }
  if (
    reservation.expectedSha256Digest &&
    object.sha256Digest !== reservation.expectedSha256Digest
  ) {
    throw validation("Stored media digest does not match the upload reservation.", {
      upload_id: reservation.id
    });
  }
  if (claimed.contentLength && claimed.contentLength !== object.contentLength) {
    throw validation("Complete-upload size does not match stored object metadata.", {
      upload_id: reservation.id
    });
  }
  if (claimed.mimeType && claimed.mimeType.toLowerCase() !== object.mimeType.toLowerCase()) {
    throw validation("Complete-upload MIME type does not match stored object metadata.", {
      upload_id: reservation.id
    });
  }
  if (claimed.sha256Digest && claimed.sha256Digest !== object.sha256Digest) {
    throw validation("Complete-upload digest does not match stored object metadata.", {
      upload_id: reservation.id
    });
  }
}

function validateInspectionResult(
  mediaType: MediaType,
  result: Awaited<ReturnType<ClinicalMediaInspectionProvider["inspect"]>>
): void {
  if (!isMediaScanStatus(result.scanStatus)) {
    throw configuration("Media inspection provider returned an unsupported scan state.");
  }
  if (result.scanStatus === "quarantined" && !result.quarantineReason?.trim()) {
    throw configuration("Quarantined media requires a provider-owned quarantine reason.");
  }
  if (result.scanStatus === "not_required" && mediaType !== "generated_document") {
    throw configuration(
      "Patient-supplied clinical media cannot bypass malware and quarantine inspection."
    );
  }
  if (result.dicomMetadata) {
    assertNoPrivateMediaKeys(result.dicomMetadata, "inspection metadata");
  }
}

function publicStoredObject(object: StoredMediaObject) {
  return {
    contentLength: object.contentLength,
    mimeType: object.mimeType,
    sha256Digest: object.sha256Digest,
    storedAt: object.storedAt
  };
}

function mediaAuditMetadata(
  input: Pick<
    MediaUploadReservationRecord | MediaAssetRecord,
    "mediaType" | "mimeType" | "encounterId" | "toothNumber" | "dentalFindingId" | "tags"
  > & { readonly scanStatus?: string }
) {
  return {
    mediaType: input.mediaType,
    mimeType: input.mimeType,
    encounterId: input.encounterId,
    toothNumber: input.toothNumber,
    dentalFindingId: input.dentalFindingId,
    tagCount: input.tags.length,
    ...(input.scanStatus ? { scanStatus: input.scanStatus } : {})
  };
}

function assertStorageMatches(
  configuredProvider: string,
  record: Pick<MediaUploadReservationRecord | MediaAssetRecord, "storageProvider">
): void {
  if (record.storageProvider !== configuredProvider) {
    throw configuration(
      "Configured media storage provider does not own the persisted media object."
    );
  }
}

function serverGeneratedMediaFilename(
  uploadId: UUID,
  originalFilename: string,
  mimeType: string
): string {
  const extension = validatedMediaExtension(originalFilename, mimeType);
  if (!extension) {
    throw validation("Clinical media filename extension does not match its MIME type.", {
      field: "originalFilename"
    });
  }
  return `clinical-media-${uploadId}.${extension}`;
}

function publicMediaUploadReservation(reservation: MediaUploadReservationRecord) {
  return {
    ...toPublicMediaUploadReservation(reservation),
    originalFilename: publicServerFilename(reservation)
  };
}

function publicMediaAsset(asset: MediaAssetRecord) {
  return {
    ...toPublicMediaAsset(asset),
    originalFilename: publicServerFilename(asset)
  };
}

function publicServerFilename(
  record: Pick<
    MediaUploadReservationRecord | MediaAssetRecord,
    "id" | "originalFilename" | "mimeType"
  >
): string {
  const extension =
    validatedMediaExtension(record.originalFilename, record.mimeType) ??
    canonicalMediaExtension(record.mimeType);
  if (!extension) {
    throw configuration("Persisted clinical media MIME type has no safe public extension.");
  }
  return `clinical-media-${record.id}.${extension}`;
}

function validatedMediaExtension(filename: string, mimeType: string): string | null {
  const extension = filename
    .trim()
    .toLowerCase()
    .match(/\.([a-z0-9]{1,12})$/u)?.[1];
  if (!extension) return null;
  return extensionsForMimeType(mimeType).includes(extension) ? extension : null;
}

function canonicalMediaExtension(mimeType: string): string | null {
  return extensionsForMimeType(mimeType)[0] ?? null;
}

function extensionsForMimeType(mimeType: string): readonly string[] {
  switch (mimeType.split(";", 1)[0]?.trim().toLowerCase()) {
    case "image/jpeg":
      return ["jpg", "jpeg"];
    case "image/png":
      return ["png"];
    case "image/webp":
      return ["webp"];
    case "image/heic":
      return ["heic"];
    case "image/heif":
      return ["heif"];
    case "image/tiff":
      return ["tif", "tiff"];
    case "application/dicom":
      return ["dcm", "dicom"];
    case "application/pdf":
      return ["pdf"];
    case "audio/wav":
      return ["wav"];
    case "audio/webm":
      return ["webm"];
    case "audio/mp4":
      return ["m4a", "mp4"];
    case "audio/mpeg":
      return ["mp3", "mpeg"];
    default:
      return [];
  }
}

function publicUploadTarget(
  value: MediaUploadTarget,
  expected: Readonly<{
    uploadId: UUID;
    mimeType: string;
    expectedFileSizeBytes: number;
    requestedExpiresAt: string;
    nowMs: number;
  }>
): MediaUploadTarget {
  const record = providerRecord(value, "upload target");
  if (record.method !== "PUT") {
    throw configuration("Media upload provider must use the PUT method.");
  }
  if (record.maxBytes !== expected.expectedFileSizeBytes) {
    throw configuration("Media upload provider returned an inconsistent byte budget.");
  }
  const requiredHeaders = publicProviderHeaders(record.requiredHeaders, "upload target", "upload");
  if (requiredHeaders["content-type"]?.toLowerCase() !== expected.mimeType.toLowerCase()) {
    throw configuration("Media upload provider returned an inconsistent content-type header.");
  }
  if (
    requiredHeaders["x-clinic-os-upload-id"] !== undefined &&
    requiredHeaders["x-clinic-os-upload-id"] !== expected.uploadId
  ) {
    throw configuration("Media upload provider returned an inconsistent upload identifier.");
  }
  return {
    method: "PUT",
    uploadUrl: publicProviderUrl(record.uploadUrl, "upload URL", {
      allowedRelativePath: `/v1/media/uploads/${expected.uploadId}/content`
    }),
    expiresAt: publicProviderExpiry(
      record.expiresAt,
      expected.requestedExpiresAt,
      expected.nowMs,
      "upload target"
    ),
    maxBytes: expected.expectedFileSizeBytes,
    requiredHeaders
  };
}

function publicSignedReadAccess(
  value: MediaSignedReadAccess,
  expected: Readonly<{ requestedExpiresAt: string; nowMs: number }>
): MediaSignedReadAccess {
  const record = providerRecord(value, "signed media access");
  if (record.method !== "GET") {
    throw configuration("Signed media access provider must use the GET method.");
  }
  return {
    method: "GET",
    signedUrl: publicProviderUrl(record.signedUrl, "signed media URL"),
    expiresAt: publicProviderExpiry(
      record.expiresAt,
      expected.requestedExpiresAt,
      expected.nowMs,
      "signed media access"
    ),
    headers: publicProviderHeaders(record.headers, "signed media access", "access")
  };
}

function providerRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw configuration(`Media provider returned an invalid ${label}.`);
  }
  return value as Record<string, unknown>;
}

function publicProviderUrl(
  value: unknown,
  label: string,
  options: { readonly allowedRelativePath?: string } = {}
): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 8192 ||
    /[\u0000-\u0020\u007f]/u.test(value)
  ) {
    throw configuration(`Media provider returned an invalid ${label}.`);
  }
  if (value.startsWith("/")) {
    if (!options.allowedRelativePath || value !== options.allowedRelativePath) {
      throw configuration(`Media provider returned an unmediated ${label}.`);
    }
    return value;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configuration(`Media provider returned an invalid ${label}.`);
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) {
    throw configuration(`Media provider returned an insecure ${label}.`);
  }
  return parsed.toString();
}

function publicProviderExpiry(
  value: unknown,
  requestedExpiresAt: string,
  nowMs: number,
  label: string
): string {
  if (typeof value !== "string") {
    throw configuration(`Media provider returned an invalid ${label} expiry.`);
  }
  const expiryMs = Date.parse(value);
  const requestedMs = Date.parse(requestedExpiresAt);
  if (!Number.isFinite(expiryMs) || expiryMs <= nowMs || expiryMs > requestedMs) {
    throw configuration(`Media provider returned an invalid ${label} expiry.`);
  }
  return new Date(expiryMs).toISOString();
}

function publicProviderHeaders(
  value: unknown,
  label: string,
  mode: "upload" | "access"
): Record<string, string> {
  const record = providerRecord(value, `${label} headers`);
  const entries = Object.entries(record);
  if (entries.length > 32) {
    throw configuration(`Media provider returned too many ${label} headers.`);
  }
  const headers: Record<string, string> = {};
  for (const [rawName, rawValue] of entries) {
    const name = rawName.toLowerCase();
    if (
      !/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/u.test(name) ||
      !isPublicProviderHeaderName(name, mode) ||
      typeof rawValue !== "string" ||
      rawValue.length > 2048 ||
      /[\r\n\u0000]/u.test(rawValue)
    ) {
      throw configuration(`Media provider returned an unsafe ${label} header.`);
    }
    headers[name] = rawValue;
  }
  return headers;
}

function isPublicProviderHeaderName(name: string, mode: "upload" | "access"): boolean {
  if (mode === "access") {
    return ["accept", "range", "if-match", "if-none-match"].includes(name);
  }
  return (
    [
      "content-type",
      "content-length",
      "content-md5",
      "digest",
      "x-clinic-os-upload-id",
      "x-amz-content-sha256",
      "x-amz-server-side-encryption"
    ].includes(name) ||
    name.startsWith("x-amz-checksum-") ||
    name.startsWith("x-amz-server-side-encryption-")
  );
}

function assertNoPrivateMediaKeys(value: unknown, label: string): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoPrivateMediaKeys(item, label));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (
      normalized === "objectkey" ||
      normalized === "storagepath" ||
      normalized === "bucket" ||
      normalized === "providersecret" ||
      normalized === "localpath"
    ) {
      throw configuration(`Media provider ${label} exposed a private storage field.`);
    }
    assertNoPrivateMediaKeys(child, label);
  }
}
