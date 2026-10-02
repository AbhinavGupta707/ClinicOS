import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import {
  assertMediaMimeType,
  validateClinicalFileContext,
  validateMediaPage
} from "../src/media.ts";

test("private object key sanitizing preserves normal keys and bounds adversarial hyphen processing", () => {
  // The separate process makes the deadline enforceable even if a regression
  // blocks JavaScript's event loop with a polynomial regular expression.
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import assert from 'node:assert/strict';
    import {buildPrivateMediaObjectKey} from ${JSON.stringify(new URL("../src/media.ts", import.meta.url).href)};
    const ids={tenantId:'10000000-0000-4000-8000-000000000001',clinicId:'10000000-0000-4000-8000-000000000101',patientId:'10000000-0000-4000-8000-000000002001',uploadId:'10000000-0000-4000-8000-000000004001',originalFilename:'private-source.JPG'};
    const normal=buildPrivateMediaObjectKey({...ids,environment:' -- Local ! ENV-- '});
    assert.ok(normal.startsWith('local-env/tenants/'));
    assert.ok(normal.endsWith('.jpg'));assert.ok(!normal.includes('private-source'));
    assert.ok(buildPrivateMediaObjectKey({...ids,environment:'---'}).startsWith('unknown/'));
    const hostile=buildPrivateMediaObjectKey({...ids,environment:'a'+'-'.repeat(200000)+'b'});
    assert.equal(hostile.split('/')[0],'a'+'-'.repeat(79));
  `
    ],
    { encoding: "utf8", timeout: 3000 }
  );
  assert.equal(
    result.error,
    undefined,
    "adversarial key generation must finish within the process deadline"
  );
  assert.equal(result.status, 0, result.stderr);
});

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
