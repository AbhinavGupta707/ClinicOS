import assert from "node:assert/strict";
import test from "node:test";
import {
  getActiveCaptureSurfaces,
  getAvailableMobileSurfaces,
  getUnavailableMobileSurfaces,
  mobileSurfaces
} from "../src/features/shell/surfaceModel.ts";

test("mobile shell registers the CP16 native surfaces without stale unavailable adapters", () => {
  assert.equal(
    getActiveCaptureSurfaces()
      .map((surface) => surface.id)
      .join(","),
    "session,chairside-media,offline-upload"
  );
  assert.equal(getAvailableMobileSurfaces().length, 3);
  assert.equal(getUnavailableMobileSurfaces().length, 1);
  assert.equal(getUnavailableMobileSurfaces()[0]?.id, "native-on-web");
  assert.equal(
    mobileSurfaces.every((surface) => surface.apiBoundary.length > 0),
    true
  );
  assert.match(
    mobileSurfaces.find((surface) => surface.id === "chairside-media")?.apiBoundary ?? "",
    /upload-urls.*uploads\/\{uploadId\}\/content.*complete/
  );
});
