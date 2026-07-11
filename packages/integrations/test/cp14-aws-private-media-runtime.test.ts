import assert from "node:assert/strict";
import test from "node:test";
import { createAwsPrivateMediaRuntime } from "../dist/media/aws-private-media-runtime.js";

test("composes the production AWS media runtime without granting the API a signing adapter", () => {
  const runtime = createAwsPrivateMediaRuntime({
    region: "ap-south-1",
    bucket: "clinicos-staging-media",
    objectKmsKeyId: "arn:aws:kms:ap-south-1:123456789012:key/11111111-1111-1111-1111-111111111111",
    scannerFunctionName:
      "arn:aws:lambda:ap-south-1:123456789012:function:clinicos-staging-media-scanner",
    scannerSigningKeyId:
      "arn:aws:kms:ap-south-1:123456789012:key/22222222-2222-2222-2222-222222222222",
    presignedEndpointOrigins: ["https://clinicos-staging-media.s3.ap-south-1.amazonaws.com"],
    now: () => new Date("2026-07-10T20:00:00.000Z")
  });

  assert.deepEqual(Object.keys(runtime).sort(), [
    "detector",
    "evidenceVerifier",
    "objects",
    "scanner",
    "signer"
  ]);
  assert.equal("sign" in runtime, false);
  assert.equal("kms" in runtime, false);
});

test("fails at composition on ambiguous origins or scanner identifiers", () => {
  assert.throws(
    () =>
      createAwsPrivateMediaRuntime({
        region: "ap-south-1",
        bucket: "clinicos-staging-media",
        objectKmsKeyId: "key",
        scannerFunctionName: "../scanner",
        scannerSigningKeyId: "key",
        presignedEndpointOrigins: ["https://example.invalid"]
      }),
    /endpoint|function name/u
  );
});
