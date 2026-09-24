import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import test from "node:test";
import { LATEST_DATABASE_SCHEMA_VERSION } from "../src/schema.ts";

test("application readiness version matches the complete contiguous migration catalog", () => {
  const versions = readdirSync(new URL("../migrations/", import.meta.url))
    .filter((file) => /^\d{4}_.+\.sql$/u.test(file))
    .map((file) => Number.parseInt(file.slice(0, 4), 10))
    .sort((a, b) => a - b);
  assert.ok(versions.length > 0);
  assert.deepEqual(versions, Array.from({ length: versions.length }, (_, index) => index + 1));
  // Flyway's configured prefix is the first zero; the remaining three digits are its version.
  assert.equal(LATEST_DATABASE_SCHEMA_VERSION, String(versions.at(-1)).padStart(3, "0"));
});
