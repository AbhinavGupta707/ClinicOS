import assert from "node:assert/strict";
import test from "node:test";
import {
  getAvailableMobileSurfaces,
  getUnavailableMobileSurfaces,
  mobileSurfaces
} from "../src/features/shell/surfaceModel.ts";

test("mobile shell exposes only session context in Checkpoint 1", () => {
  assert.equal(
    getAvailableMobileSurfaces()
      .map((surface) => surface.id)
      .join(","),
    "session"
  );
  assert.equal(getUnavailableMobileSurfaces().length, 3);
  assert.equal(
    mobileSurfaces.every((surface) => surface.apiBoundary.length > 0),
    true
  );
});
