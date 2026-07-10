import { randomUUID } from "node:crypto";
import type { UUID } from "./ids.ts";

export const MEDIA_TYPES = [
  "intraoral_photo",
  "xray",
  "document",
  "audio_chunk",
  "generated_document"
] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export const MEDIA_UPLOAD_RESERVATION_STATUSES = [
  "reserved",
  "completed",
  "expired",
  "rejected"
] as const;
export type MediaUploadReservationStatus =
  (typeof MEDIA_UPLOAD_RESERVATION_STATUSES)[number];

export const MEDIA_ASSET_STATUSES = [
  "uploaded",
  "scan_pending",
  "scan_clean",
  "quarantined",
  "scan_failed",
  "deleted"
] as const;
export type MediaAssetStatus = (typeof MEDIA_ASSET_STATUSES)[number];

export const MEDIA_SCAN_STATUSES = [
  "not_required",
  "pending",
  "clean",
  "quarantined",
  "failed"
] as const;
export type MediaScanStatus = (typeof MEDIA_SCAN_STATUSES)[number];

export const MEDIA_STORAGE_PROVIDERS = ["local_simulator", "s3"] as const;
export type MediaStorageProviderKey = (typeof MEDIA_STORAGE_PROVIDERS)[number];

export interface MediaUploadReservationRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  encounterId: UUID | null;
  toothNumber: string | null;
  dentalFindingId: UUID | null;
  mediaType: MediaType;
  originalFilename: string;
  mimeType: string;
  expectedFileSizeBytes: number;
  expectedSha256Digest: string | null;
  objectKey: string;
  storageProvider: MediaStorageProviderKey;
  storageRegion: string | null;
  status: MediaUploadReservationStatus;
  expiresAt: string;
  createdByUserId: UUID;
  createdAt: string;
  completedAt: string | null;
  mediaAssetId: UUID | null;
  tags: string[];
  provenance: Record<string, unknown>;
}

export interface MediaAssetRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  encounterId: UUID | null;
  toothNumber: string | null;
  dentalFindingId: UUID | null;
  mediaType: MediaType;
  originalFilename: string;
  mimeType: string;
  fileSizeBytes: number;
  sha256Digest: string | null;
  objectKey: string;
  objectVersion: string | null;
  storageProvider: MediaStorageProviderKey;
  storageRegion: string | null;
  status: MediaAssetStatus;
  scanStatus: MediaScanStatus;
  quarantineReason: string | null;
  tags: string[];
  provenance: Record<string, unknown>;
  dicomMetadata: Record<string, unknown>;
  createdByUserId: UUID;
  uploadedByUserId: UUID;
  createdAt: string;
  uploadedAt: string;
  updatedAt: string;
}

export type PublicMediaUploadReservation = Omit<
  MediaUploadReservationRecord,
  "objectKey" | "storageProvider" | "storageRegion"
>;

export type PublicMediaAsset = Omit<
  MediaAssetRecord,
  "objectKey" | "objectVersion" | "storageProvider" | "storageRegion"
>;

export function isMediaType(value: unknown): value is MediaType {
  return typeof value === "string" && (MEDIA_TYPES as readonly string[]).includes(value);
}

export function isMediaScanStatus(value: unknown): value is MediaScanStatus {
  return (
    typeof value === "string" && (MEDIA_SCAN_STATUSES as readonly string[]).includes(value)
  );
}

export function assertMediaMimeType(mediaType: MediaType, mimeType: string): void {
  const normalized = mimeType.trim().toLowerCase();
  const allowed = mediaMimeTypes(mediaType);

  if (!allowed.some((candidate) => normalized === candidate || normalized.startsWith(candidate))) {
    throw new Error(`Mime type ${mimeType} is not allowed for media type ${mediaType}.`);
  }
}

export function mediaAssetStatusForScan(scanStatus: MediaScanStatus): MediaAssetStatus {
  switch (scanStatus) {
    case "clean":
    case "not_required":
      return "scan_clean";
    case "pending":
      return "scan_pending";
    case "quarantined":
      return "quarantined";
    case "failed":
      return "scan_failed";
  }
}

export function mediaAssetCanBeViewed(asset: Pick<MediaAssetRecord, "scanStatus" | "status">): boolean {
  return (
    (asset.scanStatus === "clean" || asset.scanStatus === "not_required") &&
    asset.status !== "deleted" &&
    asset.status !== "quarantined" &&
    asset.status !== "scan_failed"
  );
}

export function toPublicMediaUploadReservation(
  reservation: MediaUploadReservationRecord
): PublicMediaUploadReservation {
  const { objectKey: _objectKey, storageProvider: _provider, storageRegion: _region, ...publicRecord } =
    reservation;
  return publicRecord;
}

export function toPublicMediaAsset(asset: MediaAssetRecord): PublicMediaAsset {
  const {
    objectKey: _objectKey,
    objectVersion: _objectVersion,
    storageProvider: _provider,
    storageRegion: _region,
    ...publicRecord
  } = asset;
  return publicRecord;
}

export function buildPrivateMediaObjectKey(input: {
  environment: string;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  uploadId: UUID;
  originalFilename: string;
}): string {
  const extension = extensionFromFilename(input.originalFilename);
  const suffix = extension ? `.${extension}` : "";

  return [
    sanitizeObjectKeySegment(input.environment),
    "tenants",
    input.tenantId,
    "clinics",
    input.clinicId,
    "patients",
    input.patientId,
    "media",
    input.uploadId,
    `${randomUUID()}${suffix}`
  ].join("/");
}

function mediaMimeTypes(mediaType: MediaType): readonly string[] {
  switch (mediaType) {
    case "intraoral_photo":
      return ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
    case "xray":
      return ["image/jpeg", "image/png", "image/tiff", "application/dicom"];
    case "document":
    case "generated_document":
      return ["application/pdf", "image/jpeg", "image/png"];
    case "audio_chunk":
      return ["audio/wav", "audio/webm", "audio/mp4", "audio/mpeg"];
  }
}

function extensionFromFilename(filename: string): string | null {
  const match = filename.trim().toLowerCase().match(/\.([a-z0-9]{1,12})$/);
  if (!match) return null;
  return sanitizeObjectKeySegment(match[1]);
}

function sanitizeObjectKeySegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}
