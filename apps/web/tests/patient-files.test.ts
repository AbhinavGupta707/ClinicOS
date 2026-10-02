import { expect, it } from "vitest";
import {
  fileContext,
  fileMimeAllowed,
  declaredFileMime
} from "../features/cp13/clinical-dental/patient-files";
it("keeps missing historical dates unknown and separates source evidence from uploaded time", () => {
  expect(fileContext({ uploadedAt: "2026-10-02", provenance: { source: "legacy" } })).toEqual({
    source: null,
    recordDate: null
  });
  expect(
    fileContext({
      uploadedAt: "2026-10-02",
      provenance: { clinicalFile: { source: "Former clinic", recordDate: "2015-11-20" } }
    })
  ).toEqual({ source: "Former clinic", recordDate: "2015-11-20" });
  expect(fileMimeAllowed("xray", "application/pdf")).toBe(false);
  expect(fileMimeAllowed("document", "application/pdf-evil")).toBe(false);
  expect(fileMimeAllowed("xray", "image/jpeg")).toBe(true);
});

it("declares uncommon browser file types while preserving a specific supplied MIME", () => {
  expect(declaredFileMime({ name: "scan.dcm", type: "" })).toBe("application/dicom");
  expect(declaredFileMime({ name: "scan.dcm", type: "application/octet-stream" })).toBe(
    "application/dicom"
  );
  expect(declaredFileMime({ name: "scan.dcm", type: "image/jpeg" })).toBe("image/jpeg");
  expect(declaredFileMime({ name: "scan.exe", type: "" })).toBe("");
});
