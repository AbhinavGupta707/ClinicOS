import assert from "node:assert/strict";
import test from "node:test";
import { DecryptCommand, GenerateDataKeyCommand } from "@aws-sdk/client-kms";
import {
  AwsKmsCp16ProtectedPayloadCodec,
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

test("CP16 KMS codec round-trips only under the exact authenticated scope", async () => {
  const kms = new DeterministicEnvelopeKms();
  const codec = new AwsKmsCp16ProtectedPayloadCodec({
    kms,
    keyId: "alias/clinicos-cp16-data"
  });
  const protectedPayload = await codec.protectJson(
    { reviewOnly: true, clinicalText: "bounded synthetic fixture" },
    context
  );

  assert.equal(protectedPayload.algorithm, "AES-256-GCM");
  assert.match(protectedPayload.keyReference, /^aws-kms:v1:/u);
  assert.deepEqual(await codec.revealJson(protectedPayload, context), {
    reviewOnly: true,
    clinicalText: "bounded synthetic fixture"
  });
  await assert.rejects(
    codec.revealJson(protectedPayload, {
      ...context,
      patientId: "10000000-0000-4000-8000-000000001002"
    }),
    /encryption is unavailable/u
  );
  assert.equal(kms.generateCount, 1);
  assert.equal(kms.decryptCount, 2);
});

test("CP16 KMS codec rejects malformed provider material and ciphertext", async () => {
  assert.throws(
    () =>
      new AwsKmsCp16ProtectedPayloadCodec({
        kms: new DeterministicEnvelopeKms(),
        keyId: "unsafe key"
      }),
    /configuration is invalid/u
  );
  const codec = new AwsKmsCp16ProtectedPayloadCodec({
    kms: new DeterministicEnvelopeKms(),
    keyId: "alias/clinicos-cp16-data"
  });
  const protectedPayload = await codec.protectJson({ resourceType: "Bundle" }, context);
  const tampered = Uint8Array.from(protectedPayload.ciphertext);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(
    codec.revealJson({ ...protectedPayload, ciphertext: tampered }, context),
    /encryption is unavailable/u
  );
});

class DeterministicEnvelopeKms {
  readonly #key = Buffer.alloc(32, 7);
  readonly #wrapped = Buffer.alloc(64, 9);
  readonly #contextByWrapped = new Map<string, string>();
  generateCount = 0;
  decryptCount = 0;

  async send(command: GenerateDataKeyCommand | DecryptCommand) {
    if (command instanceof GenerateDataKeyCommand) {
      this.generateCount += 1;
      this.#contextByWrapped.set(
        this.#wrapped.toString("base64"),
        JSON.stringify(command.input.EncryptionContext)
      );
      return {
        Plaintext: Uint8Array.from(this.#key),
        CiphertextBlob: Uint8Array.from(this.#wrapped)
      };
    }
    this.decryptCount += 1;
    const wrapped = Buffer.from(command.input.CiphertextBlob ?? []).toString("base64");
    if (this.#contextByWrapped.get(wrapped) !== JSON.stringify(command.input.EncryptionContext)) {
      throw new Error("KMS encryption context mismatch");
    }
    return { Plaintext: Uint8Array.from(this.#key) };
  }
}
