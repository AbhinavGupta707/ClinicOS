import type {
  CapturedPhoto,
  SecureCaptureCache,
  UploadQueueSnapshotItem
} from "./types";

export class InMemorySecureCaptureCache implements SecureCaptureCache {
  readonly #photos = new Map<string, CapturedPhoto>();
  #snapshot: UploadQueueSnapshotItem[] = [];

  async putPhoto(itemId: string, photo: CapturedPhoto): Promise<void> {
    this.#photos.set(itemId, photo);
  }

  async getPhoto(itemId: string): Promise<CapturedPhoto | null> {
    return this.#photos.get(itemId) ?? null;
  }

  async deletePhoto(itemId: string): Promise<void> {
    this.#photos.delete(itemId);
  }

  async snapshot(): Promise<readonly UploadQueueSnapshotItem[]> {
    return this.#snapshot.map((item) => ({ ...item }));
  }

  async updateSnapshot(items: readonly UploadQueueSnapshotItem[]): Promise<void> {
    this.#snapshot = items.map((item) => sanitizeSnapshotItem(item));
  }
}

export function sanitizeSnapshotItem(item: UploadQueueSnapshotItem): UploadQueueSnapshotItem {
  return {
    id: item.id,
    patientId: item.patientId,
    encounterId: item.encounterId,
    originalFilename: sanitizeFilename(item.originalFilename),
    byteLength: item.byteLength,
    capturedAt: item.capturedAt,
    status: item.status,
    attempts: item.attempts,
    lastError: item.lastError ? sanitizeError(item.lastError) : null,
    mediaAssetId: item.mediaAssetId,
    scanStatus: item.scanStatus
  };
}

export function sanitizeError(message: string): string {
  return message
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted-email]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-phone]")
    .replace(/tenants\/[^"'\s]+/gi, "[redacted-storage-path]")
    .replace(/patients\/[^"'\s]+\/media\/[^"'\s]+/gi, "[redacted-media-path]")
    .replace(/objectKey/gi, "[redacted-storage-field]")
    .slice(0, 240);
}

function sanitizeFilename(filename: string): string {
  const extension = filename.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  return extension ? `chairside-capture.${extension}` : "chairside-capture";
}
