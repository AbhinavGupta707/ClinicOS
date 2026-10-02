import assert from "node:assert/strict";
import test from "node:test";
import {
  assertMediaMimeType,
  validateClinicalFileContext,
  validateMediaPage
} from "../src/media.ts";

test("file source dates remain evidence and reject invalid or authority-bearing context", () => {
  for (const value of [
    undefined,
    { source: "Clinic export", recordDate: null },
    { source: "Clinic export", recordDate: "2024-02-29" }
  ])
    validateClinicalFileContext(value);
  for (const value of [
    null,
    [],
    {},
    { source: " " },
    { source: "a".repeat(121) },
    { source: "Clinic", recordDate: "2025-02-29" },
    { source: "Clinic", recordDate: "2026-13-01" },
    { source: "Clinic", scanStatus: "clean" }
  ])
    assert.throws(() => validateClinicalFileContext(value), RangeError);
});
test("media filters are bounded and MIME suffixes cannot evade the type allowlist", () => {
  assert.equal(validateMediaPage({ limit: 100, mediaType: "xray" }), 100);
  for (const input of [
    { limit: 0 },
    { limit: 101 },
    { cursor: "../other" },
    { mediaType: "invented" }
  ])
    assert.throws(() => validateMediaPage(input as never), RangeError);
  assertMediaMimeType("document", "application/pdf");
  assertMediaMimeType("audio_chunk", "audio/webm");
  for (const mime of ["application/pdf-evil", "application/pdf;evil=1", "image/svg+xml"])
    assert.throws(() => assertMediaMimeType("document", mime));
});
