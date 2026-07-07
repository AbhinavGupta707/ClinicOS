import assert from "node:assert/strict";
import test from "node:test";
import {
  getActiveCaptureSurfaces,
  getAvailableMobileSurfaces,
  getUnavailableMobileSurfaces,
  mobileSurfaces
} from "../src/features/shell/surfaceModel.ts";

test("mobile shell exposes Checkpoint 8 capture surfaces without stale routes", () => {
  assert.equal(
    getActiveCaptureSurfaces()
      .map((surface) => surface.id)
      .join(","),
    "session,chairside-media,voice-note,offline-upload"
  );
  assert.equal(getAvailableMobileSurfaces().length, 4);
  assert.equal(getUnavailableMobileSurfaces().length, 0);
  assert.equal(
    mobileSurfaces.every((surface) => surface.apiBoundary.length > 0),
    true
  );
  assert.match(
    mobileSurfaces.find((surface) => surface.id === "chairside-media")?.apiBoundary ?? "",
    /upload-urls.*uploads\/\{uploadId\}\/content.*complete/
  );
});
