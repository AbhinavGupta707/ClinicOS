import type { ClinicOsApiClient, PublicMediaAsset } from "../../lib/apiClient";
import type {
  CapturedPhoto,
  PatientCaptureContext,
  SecureCaptureCache,
  UploadQueueItem,
  UploadQueueSnapshotItem
} from "./types";
import { sanitizeError } from "./secureCache.ts";

export interface MobileUploadQueueOptions {
  api: Pick<ClinicOsApiClient, "reserveMediaUpload" | "uploadMediaContent" | "completeMediaUpload">;
  cache: SecureCaptureCache;
  now?: () => string;
  idFactory?: () => string;
}

export class MobileUploadQueue {
  readonly #api: MobileUploadQueueOptions["api"];
  readonly #cache: SecureCaptureCache;
  readonly #now: () => string;
  readonly #idFactory: () => string;
  #items: UploadQueueItem[] = [];

  constructor(options: MobileUploadQueueOptions) {
    this.#api = options.api;
    this.#cache = options.cache;
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#idFactory = options.idFactory ?? createLocalId;
  }

  get items(): readonly UploadQueueItem[] {
    return this.#items.map((item) => ({ ...item }));
  }

  async enqueuePhoto(context: PatientCaptureContext, photo: CapturedPhoto): Promise<UploadQueueItem> {
    const id = this.#idFactory();
    const sha256Digest = await sha256Hex(photo.bytes);
    const item: UploadQueueItem = {
      id,
      patientId: context.patientId,
      encounterId: context.encounterId,
      localMediaId: photo.deviceLocalId,
      mimeType: photo.mimeType,
      originalFilename: photo.originalFilename,
      byteLength: photo.bytes.byteLength,
      sha256Digest,
      capturedAt: photo.capturedAt || this.#now(),
      status: "queued",
      attempts: 0,
      lastError: null,
      mediaAsset: null
    };
    await this.#cache.putPhoto(id, photo);
    this.#items = [item, ...this.#items];
    await this.#persistSnapshot();
    return item;
  }

  async processNext(): Promise<UploadQueueItem | null> {
    const item = this.#items.find((candidate) => candidate.status === "queued" || candidate.status === "failed");
    if (!item) return null;
    return this.processItem(item.id);
  }

  async processItem(itemId: string): Promise<UploadQueueItem> {
    const existing = this.#items.find((candidate) => candidate.id === itemId);
    if (!existing) throw new Error("Upload queue item not found.");
    const photo = await this.#cache.getPhoto(itemId);
    if (!photo) {
      return this.#replaceItem(itemId, {
        ...existing,
        status: "failed",
        attempts: existing.attempts + 1,
        lastError: "Secure capture cache no longer has the queued media bytes."
      });
    }

    try {
      const reserving = await this.#replaceItem(itemId, {
        ...existing,
        status: "reserving",
        attempts: existing.attempts + 1,
        lastError: null
      });
      const { upload } = await this.#api.reserveMediaUpload({
        patientId: reserving.patientId,
        encounterId: reserving.encounterId,
        mediaType: "intraoral_photo",
        originalFilename: reserving.originalFilename,
        mimeType: reserving.mimeType,
        fileSizeBytes: reserving.byteLength,
        sha256Digest: reserving.sha256Digest,
        tags: ["mobile-capture", "chairside"],
        provenance: {
          captureSurface: "expo_mobile",
          capturedAt: reserving.capturedAt,
          localMediaId: reserving.localMediaId,
          digestComputed: reserving.sha256Digest !== null
        }
      });

      await this.#replaceItem(itemId, { ...reserving, status: "uploading" });
      await this.#api.uploadMediaContent(upload.id, photo.bytes, reserving.mimeType);

      await this.#replaceItem(itemId, { ...reserving, status: "completing" });
      const mediaAsset = await this.#api.completeMediaUpload({
        uploadId: upload.id,
        patientId: reserving.patientId,
        encounterId: reserving.encounterId,
        contentLength: reserving.byteLength,
        sha256Digest: reserving.sha256Digest,
        mimeType: reserving.mimeType,
        scanStatus: "pending"
      });
      await this.#cache.deletePhoto(itemId);
      return this.#replaceItem(itemId, {
        ...reserving,
        status: "completed",
        mediaAsset,
        lastError: null
      });
    } catch (error) {
      return this.#replaceItem(itemId, {
        ...existing,
        status: "failed",
        attempts: existing.attempts + 1,
        lastError: sanitizeError(error instanceof Error ? error.message : "Upload failed.")
      });
    }
  }

  async #replaceItem(itemId: string, next: UploadQueueItem): Promise<UploadQueueItem> {
    this.#items = this.#items.map((item) => (item.id === itemId ? next : item));
    await this.#persistSnapshot();
    return { ...next };
  }

  async #persistSnapshot(): Promise<void> {
    await this.#cache.updateSnapshot(this.#items.map(toSnapshotItem));
  }
}

export function toSnapshotItem(item: UploadQueueItem): UploadQueueSnapshotItem {
  return {
    id: item.id,
    patientId: item.patientId,
    encounterId: item.encounterId,
    originalFilename: item.originalFilename,
    byteLength: item.byteLength,
    capturedAt: item.capturedAt,
    status: item.status,
    attempts: item.attempts,
    lastError: item.lastError,
    mediaAssetId: item.mediaAsset?.id ?? null,
    scanStatus: item.mediaAsset?.scanStatus ?? null
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null;
  const buffer = new Uint8Array(bytes).buffer;
  const digest = await subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createLocalId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return randomUuid ?? `mobile-capture-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function completedAssetMessage(asset: PublicMediaAsset): string {
  return asset.scanStatus === "clean" || asset.scanStatus === "not_required"
    ? "Photo uploaded and cleared for viewing."
    : "Photo uploaded. Backend scanning must clear it before viewing.";
}
