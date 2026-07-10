import type { DetectedMediaFile, MagicByteDetector } from "./types.js";

const ascii = (bytes: Uint8Array, start: number, length: number): string =>
  String.fromCharCode(...bytes.slice(start, start + length));

const matches = (bytes: Uint8Array, offset: number, signature: readonly number[]): boolean =>
  signature.every((value, index) => bytes[offset + index] === value);

/**
 * Bounded, deterministic detector for the clinical formats ClinicOS accepts. It deliberately
 * returns null for ambiguous/unknown bytes. A `file-type` adapter can be injected at composition,
 * but the provider still performs the DICOM and container-brand checks defined here.
 */
export class ClinicalMediaMagicByteDetector implements MagicByteDetector {
  async detect(bytes: Uint8Array): Promise<DetectedMediaFile | null> {
    if (matches(bytes, 0, [0xff, 0xd8, 0xff])) return { mimeType: "image/jpeg", extension: "jpg" };
    if (matches(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
      return { mimeType: "image/png", extension: "png" };
    }
    if (ascii(bytes, 0, 5) === "%PDF-") return { mimeType: "application/pdf", extension: "pdf" };
    if (bytes.length >= 132 && ascii(bytes, 128, 4) === "DICM") {
      return { mimeType: "application/dicom", extension: "dcm" };
    }
    if (
      matches(bytes, 0, [0x49, 0x49, 0x2a, 0x00]) ||
      matches(bytes, 0, [0x4d, 0x4d, 0x00, 0x2a])
    ) {
      return { mimeType: "image/tiff", extension: "tiff" };
    }
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
      return { mimeType: "image/webp", extension: "webp" };
    }
    if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WAVE") {
      return { mimeType: "audio/wav", extension: "wav" };
    }
    if (matches(bytes, 0, [0x1a, 0x45, 0xdf, 0xa3])) {
      return { mimeType: "audio/webm", extension: "webm" };
    }
    if (matches(bytes, 0, [0x49, 0x44, 0x33]) || matches(bytes, 0, [0xff, 0xfb])) {
      return { mimeType: "audio/mpeg", extension: "mp3" };
    }
    if (bytes.length >= 12 && ascii(bytes, 4, 4) === "ftyp") {
      const brand = ascii(bytes, 8, 4).toLowerCase();
      if (["heic", "heix", "hevc", "hevx"].includes(brand)) {
        return { mimeType: "image/heic", extension: "heic" };
      }
      if (["mif1", "msf1"].includes(brand)) {
        return { mimeType: "image/heif", extension: "heif" };
      }
      if (["m4a ", "m4b ", "isom", "mp41", "mp42"].includes(brand)) {
        return { mimeType: "audio/mp4", extension: "m4a" };
      }
    }
    return null;
  }
}
