import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";

test("CP11 real TypeScript gate rejects an invalid cross-package branded identifier", () => {
  const executable = join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "tsc.cmd" : "tsc"
  );
  const result = spawnSync(
    executable,
    ["--noEmit", "-p", "tests/fixtures/typecheck/tsconfig.invalid.json"],
    { encoding: "utf8" }
  );
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;

  assert.notEqual(result.status, 0, "The invalid cross-package fixture must fail TypeScript.");
  assert.match(output, /Type 'string' is not assignable to type 'UUID'/);
});
