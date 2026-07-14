import assert from "node:assert/strict";
import test from "node:test";
import {
  CP16_PROTECTED_PAYLOAD_ALGORITHM,
  assertProtectedPayload,
  cp16PayloadContextDigest,
  protectedPayloadFromDatabase
} from "../src/providers/cp16/protected-payload.ts";

const context = {
  tenantId: "10000000-0000-4000-8000-000000000001",
  clinicId: "10000000-0000-4000-8000-000000000101",
  patientId: "10000000-0000-4000-8000-000000001001",
  resourceType: "fhir_import_minimized" as const,
  resourceId: "10000000-0000-4000-8000-000000002001"
};

test("CP16 protected payload context binds every scope and resource field", () => {
  const digest = cp16PayloadContextDigest(context);
  assert.match(digest, /^[0-9a-f]{64}$/u);
  assert.notEqual(cp16PayloadContextDigest({ ...context, patientId: context.tenantId }), digest);
  assert.notEqual(cp16PayloadContextDigest({ ...context, resourceType: "fhir_export" }), digest);
});

test("CP16 protected payload rejects unbounded or malformed envelopes", () => {
  const valid = {
    algorithm: CP16_PROTECTED_PAYLOAD_ALGORITHM,
    ciphertext: new Uint8Array([1, 2, 3]),
    keyReference: "approved-key-reference/clinicos/cp16",
    plaintextDigest: "a".repeat(64)
  };
  assert.equal(assertProtectedPayload(valid, 100), valid);
  assert.throws(() => assertProtectedPayload({ ...valid, ciphertext: new Uint8Array() }, 100));
  assert.throws(() => assertProtectedPayload({ ...valid, keyReference: "raw\nsecret" }, 100));
  assert.throws(() =>
    protectedPayloadFromDatabase({
      ciphertext: valid.ciphertext,
      keyReference: valid.keyReference,
      algorithm: "plaintext",
      plaintextDigest: valid.plaintextDigest
    })
  );
});
