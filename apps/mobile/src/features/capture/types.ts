import type { PublicMediaAsset, UUID } from "../../lib/apiClient";

export type CaptureCapabilityState = "ready" | "unavailable";

export interface CaptureCapability {
  state: CaptureCapabilityState;
  reason?: string;
  setupAction?: string;
}

export interface PatientCaptureContext {
  patientId: UUID;
  patientLabel: string;
  encounterId: UUID | null;
  encounterLabel: string;
}

export interface CapturedPhoto {
  kind: "photo";
  bytes: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp" | "image/heic" | "image/heif";
  originalFilename: string;
  capturedAt: string;
  deviceLocalId: string;
  width?: number;
  height?: number;
}

export interface PhotoCaptureProvider {
  getCapability(): Promise<CaptureCapability>;
  capturePhoto(context: PatientCaptureContext): Promise<CapturedPhoto>;
}

export type UploadQueueStatus =
  | "queued"
  | "reserving"
  | "uploading"
  | "completing"
  | "completed"
  | "failed";

export interface UploadQueueItem {
  id: string;
  patientId: UUID;
  encounterId: UUID | null;
  localMediaId: string;
  mimeType: CapturedPhoto["mimeType"];
  originalFilename: string;
  byteLength: number;
  sha256Digest: string | null;
  capturedAt: string;
  status: UploadQueueStatus;
  attempts: number;
  lastError: string | null;
  mediaAsset: PublicMediaAsset | null;
}

export interface UploadQueueSnapshotItem {
  id: string;
  patientId: UUID;
  encounterId: UUID | null;
  originalFilename: string;
  byteLength: number;
  capturedAt: string;
  status: UploadQueueStatus;
  attempts: number;
  lastError: string | null;
  mediaAssetId: UUID | null;
  scanStatus: string | null;
}

export interface SecureCaptureCache {
  putPhoto(itemId: string, photo: CapturedPhoto): Promise<void>;
  getPhoto(itemId: string): Promise<CapturedPhoto | null>;
  deletePhoto(itemId: string): Promise<void>;
  snapshot(): Promise<readonly UploadQueueSnapshotItem[]>;
  updateSnapshot(items: readonly UploadQueueSnapshotItem[]): Promise<void>;
}
