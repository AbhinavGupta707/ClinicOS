import type { PublicJsonObject } from "./loaders";
export type UploadFileType = "document" | "xray" | "intraoral_photo";
export type PatientFileType = UploadFileType | "audio_chunk" | "generated_document";
const mimeTypes: Record<UploadFileType, readonly string[]> = {
  document: ["application/pdf", "image/jpeg", "image/png"],
  xray: ["application/dicom", "image/jpeg", "image/png", "image/tiff"],
  intraoral_photo: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]
};
export function fileMimeAllowed(type: UploadFileType, mime: string) {
  return mimeTypes[type].includes(mime.toLowerCase());
}
/** Some browsers leave DICOM/HEIC MIME empty or generic. This is a declaration only;
 * the server still verifies bytes and requires authoritative scan evidence. */
export function declaredFileMime(file: { name: string; type: string }): string {
  if (file.type && file.type.toLowerCase() !== "application/octet-stream")
    return file.type.toLowerCase();
  const extension = file.name.trim().toLowerCase().split(".").at(-1) ?? "";
  const known: Readonly<Record<string, string>> = {
    pdf: "application/pdf",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    tif: "image/tiff",
    tiff: "image/tiff",
    heic: "image/heic",
    heif: "image/heif",
    dcm: "application/dicom",
    dicom: "application/dicom"
  };
  return known[extension] ?? "";
}
export function fileContext(asset: PublicJsonObject): {
  source: string | null;
  recordDate: string | null;
} {
  const provenance = asset.provenance;
  const context =
    provenance && typeof provenance === "object" && !Array.isArray(provenance)
      ? (provenance as PublicJsonObject).clinicalFile
      : null;
  const value =
    context && typeof context === "object" && !Array.isArray(context)
      ? (context as PublicJsonObject)
      : {};
  return {
    source: typeof value.source === "string" ? value.source : null,
    recordDate: typeof value.recordDate === "string" ? value.recordDate : null
  };
}
