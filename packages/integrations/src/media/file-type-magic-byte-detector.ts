import { fileTypeFromBuffer } from "file-type";
import { ClinicalMediaMagicByteDetector } from "./magic-bytes.js";
import type { DetectedMediaFile, MagicByteDetector } from "./types.js";

const APPROVED_FILE_TYPES = new Map<string, string>([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/tiff", "tiff"],
  ["image/heic", "heic"],
  ["image/heif", "heif"],
  ["application/pdf", "pdf"],
  ["audio/wav", "wav"],
  ["audio/webm", "webm"],
  ["audio/mpeg", "mp3"],
  ["audio/mp4", "m4a"]
]);

/**
 * Production file-type adapter. ClinicOS' explicit detector runs first so DICOM and ISO-BMFF
 * clinical-media brands retain the stricter product semantics instead of accepting a generic
 * container classification from the library.
 */
export class FileTypeMagicByteDetector implements MagicByteDetector {
  readonly #explicitDetector: MagicByteDetector;
  readonly #maxDetectionBytes: number;

  constructor(options: Readonly<{ maxDetectionBytes?: number }> = {}) {
    const maxDetectionBytes = options.maxDetectionBytes ?? 65_536;
    if (
      !Number.isSafeInteger(maxDetectionBytes) ||
      maxDetectionBytes < 4_100 ||
      maxDetectionBytes > 65_536
    ) {
      throw new TypeError("File-type media detection byte budget is invalid.");
    }
    this.#explicitDetector = new ClinicalMediaMagicByteDetector();
    this.#maxDetectionBytes = maxDetectionBytes;
  }

  async detect(bytes: Uint8Array): Promise<DetectedMediaFile | null> {
    const bounded = bytes.subarray(0, this.#maxDetectionBytes);
    const explicit = await this.#explicitDetector.detect(bounded);
    if (explicit) return explicit;

    try {
      const detected = await fileTypeFromBuffer(bounded);
      if (!detected) return null;
      const extension = APPROVED_FILE_TYPES.get(detected.mime);
      return extension ? Object.freeze({ mimeType: detected.mime, extension }) : null;
    } catch {
      return null;
    }
  }
}
