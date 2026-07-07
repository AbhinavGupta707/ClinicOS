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
    "session,chairside-media,offline-upload"
  );
  assert.equal(getAvailableMobileSurfaces().length, 3);
  assert.equal(getUnavailableMobileSurfaces().length, 1);
  assert.equal(getUnavailableMobileSurfaces()[0]?.id, "voice-note");
  assert.equal(
    mobileSurfaces.every((surface) => surface.apiBoundary.length > 0),
    true
  );
  assert.match(
    mobileSurfaces.find((surface) => surface.id === "chairside-media")?.apiBoundary ?? "",
    /upload-urls.*uploads\/\{uploadId\}\/content.*complete/
  );
});
