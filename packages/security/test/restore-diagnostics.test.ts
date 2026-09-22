import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("restore CLI failures never echo untrusted exception details", () => {
  const marker = "synthetic-sensitive-cli-marker";
  const script = fileURLToPath(new URL("../../../scripts/cp9-restore-drill.mjs", import.meta.url));
  // Argument validation fails before environment loading or any service action.
  const result = spawnSync(process.execPath, [script, marker], {
    encoding: "utf8",
    timeout: 5_000,
    env: {}
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /CP9 restore drill failed/);
  assert.equal(`${result.stdout}${result.stderr}`.includes(marker), false);
});
