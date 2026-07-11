import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  GetObjectTaggingCommand,
  HeadObjectCommand,
  ListMultipartUploadsCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
  type DeleteObjectCommandOutput,
  type GetObjectCommandOutput,
  type GetObjectTaggingCommandOutput,
  type HeadObjectCommandOutput,
  type ListMultipartUploadsCommandOutput,
  type ListObjectVersionsCommandOutput,
  type PutObjectCommandOutput
} from "@aws-sdk/client-s3";
import {
  AwsKmsMalwareEvidenceSignatureVerifier,
  AwsS3PresigningTransport,
  AwsS3PrivateObjectTransport,
  FileTypeMagicByteDetector,
  PrivateMediaError,
  canonicalMalwareEvidencePayloadBytes,
  type AwsKmsCommandSender,
  type AwsS3ObjectCommandSender,
  type SignedMalwareEvidence
} from "../dist/media/index.js";

const region = "ap-south-1";
const bucket = "private-media-bucket";
const kmsKeyId = "arn:aws:kms:ap-south-1:111122223333:key/00000000-0000-4000-8000-000000000001";
const locator = {
  bucket,
  region,
  key: "staging/tenants/10000000-0000-4000-8000-000000000001/clinics/10000000-0000-4000-8000-000000000002/media/10000000-0000-4000-8000-000000000003/10000000-0000-4000-8000-000000000004/opaque"
};

test("CP14 official AWS getSignedUrl binds the exact seven PUT headers plus host", async () => {
  const now = new Date("2026-07-10T10:00:00.000Z");
  const client = new S3Client({
    region,
    credentials: {
      accessKeyId: "AKIDEXAMPLE",
      secretAccessKey: "test-static-secret-not-a-live-credential",
      sessionToken: "test-static-session-token"
    }
  });
  try {
    const signer = new AwsS3PresigningTransport(client, {
      bucket,
      region,
      kmsKeyId,
      endpointOrigins: [`https://${bucket}.s3.${region}.amazonaws.com`],
      now: () => now
    });
    const signed = await signer.signPutObject({
      locator,
      expiresAt: "2026-07-10T10:05:00.000Z",
      contentLength: 32,
      contentType: "image/jpeg",
      checksumSha256Base64: Buffer.alloc(32, 7).toString("base64"),
      metadata: { "clinicos-binding": "A".repeat(43) },
      tags: { clinicos_state: "quarantine" }
    });
    const parsed = new URL(signed.url);
    assert.deepEqual((parsed.searchParams.get("X-Amz-SignedHeaders") ?? "").split(";").sort(), [
      "content-length",
      "content-type",
      "host",
      "x-amz-checksum-sha256",
      "x-amz-meta-clinicos-binding",
      "x-amz-server-side-encryption",
      "x-amz-server-side-encryption-aws-kms-key-id",
      "x-amz-tagging"
    ]);
    assert.deepEqual(Object.keys(signed.requiredHeaders).sort(), [
      "content-length",
      "content-type",
      "x-amz-checksum-sha256",
      "x-amz-meta-clinicos-binding",
      "x-amz-server-side-encryption",
      "x-amz-server-side-encryption-aws-kms-key-id",
      "x-amz-tagging"
    ]);
    assert.equal(signed.requiredHeaders["x-amz-server-side-encryption"], "aws:kms");
    assert.equal(signed.requiredHeaders["x-amz-server-side-encryption-aws-kms-key-id"], kmsKeyId);
    assert.equal(parsed.searchParams.has("x-amz-server-side-encryption-aws-kms-key-id"), false);
  } finally {
    client.destroy();
  }
});

test("CP14 Terraform storage policy and presigner SSE-KMS capability stay source-compatible", async () => {
  const testDirectory = dirname(fileURLToPath(import.meta.url));
  const terraform = await readFile(
    resolve(testDirectory, "../../../infra/terraform/modules/storage/main.tf"),
    "utf8"
  );
  assert.match(terraform, /Sid\s+=\s+"DenyUnencryptedObjectWrites"/u);
  assert.match(terraform, /"s3:x-amz-server-side-encryption"\s+=\s+"aws:kms"/u);
  assert.match(terraform, /Sid\s+=\s+"DenyWrongKmsKey"/u);
  assert.match(
    terraform,
    /"s3:x-amz-server-side-encryption-aws-kms-key-id"\s+=\s+var\.data_kms_key_arn/u
  );
});

test("CP14 presigner rejects malicious output and removes signer/provider detail", async () => {
  const signer = new AwsS3PresigningTransport(
    {},
    {
      bucket,
      region,
      kmsKeyId,
      endpointOrigins: [`https://${bucket}.s3.${region}.amazonaws.com`],
      now: () => new Date("2026-07-10T10:00:00.000Z")
    },
    async () =>
      "https://attacker.invalid/private?X-Amz-Signature=SECRET_PROVIDER_SIGNATURE&bucket=private"
  );
  await assert.rejects(
    signer.signPutObject({
      locator,
      expiresAt: "2026-07-10T10:05:00.000Z",
      contentLength: 32,
      contentType: "image/jpeg",
      checksumSha256Base64: Buffer.alloc(32, 7).toString("base64"),
      metadata: { "clinicos-binding": "A".repeat(43) },
      tags: { clinicos_state: "quarantine" }
    }),
    (error: unknown) => {
      assert.ok(error instanceof PrivateMediaError);
      assert.equal(error.code, "provider_error");
      assert.doesNotMatch(JSON.stringify(error), /attacker|signature|bucket|kms|SECRET/iu);
      return true;
    }
  );
});

test("CP14 KMS Verify receives canonical evidence bytes and enforces key/algorithm/signature bounds", async () => {
  const evidence = signedEvidence();
  let commandInput: Record<string, unknown> | null = null;
  const kms: AwsKmsCommandSender = {
    async send(command) {
      commandInput = command.input as Record<string, unknown>;
      return { $metadata: {}, SignatureValid: true };
    }
  };
  const verifier = new AwsKmsMalwareEvidenceSignatureVerifier(kms, {
    keyAlgorithms: { [evidence.signature.keyId]: ["RSASSA_PSS_SHA_256"] }
  });
  assert.equal(await verifier.verify(evidence), true);
  assert.deepEqual(
    Buffer.from(commandInput?.Message as Uint8Array),
    Buffer.from(canonicalMalwareEvidencePayloadBytes(evidence.payload))
  );
  assert.equal(commandInput?.KeyId, evidence.signature.keyId);
  assert.equal(commandInput?.SigningAlgorithm, "RSASSA_PSS_SHA_256");

  assert.equal(
    await verifier.verify({
      ...evidence,
      signature: { ...evidence.signature, keyId: "arn:aws:kms:ap-south-1:111122223333:key/wrong" }
    }),
    false
  );
  assert.equal(
    await verifier.verify({
      ...evidence,
      signature: { ...evidence.signature, algorithm: "ECDSA_SHA_256" }
    }),
    false
  );
  assert.equal(
    await verifier.verify({
      ...evidence,
      signature: { ...evidence.signature, valueBase64: Buffer.alloc(16).toString("base64") }
    }),
    false
  );
});

test("CP14 AWS object transport pins head/tag/range/put operations to an exact version and KMS key", async () => {
  const client = new RecordingS3Sender();
  const transport = new AwsS3PrivateObjectTransport(client, { bucket, region, kmsKeyId });
  const snapshot = await transport.headObject(locator);
  assert.equal(snapshot?.versionId, "version-1");
  assert.equal(snapshot?.checksumSha256Hex, "07".repeat(32));
  assert.equal(snapshot?.tags.clinicos_state, "quarantine");
  const tagging = client.commands.find(
    (command): command is GetObjectTaggingCommand => command instanceof GetObjectTaggingCommand
  );
  assert.equal(tagging?.input.VersionId, "version-1");

  const range = await transport.readObjectRange({
    locator,
    versionId: "version-1",
    start: 0,
    endInclusive: 15
  });
  assert.equal(range.byteLength, 16);
  const get = client.commands.find(
    (command): command is GetObjectCommand => command instanceof GetObjectCommand
  );
  assert.equal(get?.input.VersionId, "version-1");
  assert.equal(get?.input.Range, "bytes=0-15");

  const body = Uint8Array.from(new Array<number>(32).fill(7));
  await transport.putObject({
    locator,
    body,
    contentType: "image/jpeg",
    checksumSha256Hex: createHash("sha256").update(body).digest("hex"),
    metadata: { "clinicos-binding": "A".repeat(43) },
    tags: { clinicos_state: "quarantine" }
  });
  const put = client.commands.find(
    (command): command is PutObjectCommand =>
      command instanceof PutObjectCommand && command.input.Key === locator.key
  );
  assert.equal(put?.input.ServerSideEncryption, "aws:kms");
  assert.equal(put?.input.SSEKMSKeyId, kmsKeyId);
  assert.equal(put?.input.Tagging, "clinicos_state=quarantine");
});

test("CP14 AWS object transport uses version-bound purge and redacts provider failures", async () => {
  const client = new RecordingS3Sender();
  const transport = new AwsS3PrivateObjectTransport(client, { bucket, region, kmsKeyId });
  await transport.deleteObjectVersion({
    locator,
    versionId: "version-1",
    operationId: `pmef_${"a".repeat(64)}`,
    requestedAt: "2026-07-10T10:00:00.000Z"
  });
  const deleteCommand = client.commands.find(
    (command): command is DeleteObjectCommand =>
      command instanceof DeleteObjectCommand && command.input.Key === locator.key
  );
  assert.equal(deleteCommand?.input.VersionId, "version-1");
  assert.ok(
    client.commands.some(
      (command) =>
        command instanceof PutObjectCommand &&
        command.input.Key?.startsWith(".clinicos-private-media-effects/purge-version/")
    )
  );

  client.failure = new Error(`SECRET ${bucket} ${locator.key} ${kmsKeyId}`);
  await assert.rejects(transport.headObject(locator), (error: unknown) => {
    assert.ok(error instanceof PrivateMediaError);
    assert.doesNotMatch(JSON.stringify(error), /SECRET|private-media-bucket|tenants|kms/iu);
    return true;
  });
});

test("CP14 AWS delete-marker creation and exact-marker restore reconcile deterministic retries", async () => {
  const client = new RecordingS3Sender();
  const transport = new AwsS3PrivateObjectTransport(client, { bucket, region, kmsKeyId });
  const deletionInput = {
    locator,
    operationId: `pmop_${"d".repeat(64)}`,
    requestedAt: "2026-07-10T10:00:00.000Z"
  };
  const first = await transport.ensureDeleteMarker(deletionInput);
  const replay = await transport.ensureDeleteMarker(deletionInput);
  assert.equal(first.deleteMarkerVersionId, "delete-marker-1");
  assert.deepEqual(replay, first);
  assert.equal(
    client.commands.filter(
      (command) =>
        command instanceof DeleteObjectCommand &&
        command.input.Key === locator.key &&
        command.input.VersionId === undefined
    ).length,
    1
  );

  const restoreInput = {
    locator,
    deleteMarkerVersionId: first.deleteMarkerVersionId,
    operationId: `pmop_${"e".repeat(64)}`,
    requestedAt: "2026-07-10T10:01:00.000Z"
  };
  await transport.removeDeleteMarker(restoreInput);
  await transport.removeDeleteMarker(restoreInput);
  assert.equal(
    client.commands.filter(
      (command) =>
        command instanceof DeleteObjectCommand &&
        command.input.VersionId === first.deleteMarkerVersionId
    ).length,
    1
  );
});

test("CP14 file-type adapter preserves explicit DICOM handling and rejects unapproved formats", async () => {
  const detector = new FileTypeMagicByteDetector();
  const dicom = new Uint8Array(256);
  dicom.set(Buffer.from("DICM"), 128);
  assert.deepEqual(await detector.detect(dicom), {
    mimeType: "application/dicom",
    extension: "dcm"
  });
  assert.equal(await detector.detect(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])), null);
});

class RecordingS3Sender implements AwsS3ObjectCommandSender {
  readonly commands: Parameters<AwsS3ObjectCommandSender["send"]>[0][] = [];
  failure: Error | null = null;
  versionExists = true;
  deleteMarkerExists = false;

  async send(
    command: Parameters<AwsS3ObjectCommandSender["send"]>[0]
  ): ReturnType<AwsS3ObjectCommandSender["send"]> {
    this.commands.push(command);
    if (this.failure) throw this.failure;
    if (command instanceof HeadObjectCommand) {
      if (command.input.Key?.startsWith(".clinicos-private-media-effects/")) {
        const missing = Object.assign(new Error("not found"), {
          name: "NotFound",
          $metadata: { httpStatusCode: 404 }
        });
        const receiptPut = [...this.commands]
          .reverse()
          .find(
            (candidate): candidate is PutObjectCommand =>
              candidate instanceof PutObjectCommand && candidate.input.Key === command.input.Key
          );
        if (!receiptPut) throw missing;
        return {
          $metadata: {},
          Metadata: receiptPut.input.Metadata,
          VersionId: "receipt-version-1"
        } satisfies HeadObjectCommandOutput;
      }
      return {
        $metadata: {},
        ContentLength: 32,
        ContentType: "image/jpeg",
        ChecksumSHA256: Buffer.alloc(32, 7).toString("base64"),
        VersionId: command.input.VersionId ?? "version-1",
        ETag: '"opaque-etag"',
        LastModified: new Date("2026-07-10T10:00:00.000Z"),
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: kmsKeyId,
        Metadata: { "clinicos-binding": "A".repeat(43) }
      } satisfies HeadObjectCommandOutput;
    }
    if (command instanceof GetObjectTaggingCommand) {
      return {
        $metadata: {},
        TagSet: [{ Key: "clinicos_state", Value: "quarantine" }]
      } satisfies GetObjectTaggingCommandOutput;
    }
    if (command instanceof ListMultipartUploadsCommand) {
      return {
        $metadata: {},
        IsTruncated: false,
        Uploads: []
      } satisfies ListMultipartUploadsCommandOutput;
    }
    if (command instanceof GetObjectCommand) {
      return {
        $metadata: {},
        VersionId: command.input.VersionId,
        ContentRange: "bytes 0-15/32",
        Body: Uint8Array.from(new Array<number>(16).fill(7)) as GetObjectCommandOutput["Body"]
      } satisfies GetObjectCommandOutput;
    }
    if (command instanceof PutObjectCommand) {
      return { $metadata: {}, VersionId: "version-1" } satisfies PutObjectCommandOutput;
    }
    if (command instanceof ListObjectVersionsCommand) {
      return {
        $metadata: {},
        IsTruncated: false,
        Versions: this.versionExists
          ? [
              {
                Key: locator.key,
                VersionId: "version-1",
                IsLatest: !this.deleteMarkerExists,
                LastModified: new Date("2026-07-10T09:59:00.000Z")
              }
            ]
          : [],
        DeleteMarkers: this.deleteMarkerExists
          ? [
              {
                Key: locator.key,
                VersionId: "delete-marker-1",
                IsLatest: true,
                LastModified: new Date("2026-07-10T10:00:01.000Z")
              }
            ]
          : []
      } satisfies ListObjectVersionsCommandOutput;
    }
    if (command instanceof DeleteObjectCommand) {
      if (command.input.VersionId === undefined) {
        this.deleteMarkerExists = true;
        return {
          $metadata: {},
          VersionId: "delete-marker-1",
          DeleteMarker: true
        } satisfies DeleteObjectCommandOutput;
      }
      if (command.input.VersionId === "delete-marker-1") {
        this.deleteMarkerExists = false;
        return {
          $metadata: {},
          VersionId: "delete-marker-1",
          DeleteMarker: true
        } satisfies DeleteObjectCommandOutput;
      }
      this.versionExists = false;
      return {
        $metadata: {},
        VersionId: command.input.VersionId,
        DeleteMarker: false
      } satisfies DeleteObjectCommandOutput;
    }
    throw new Error("Unexpected typed S3 command.");
  }
}

function signedEvidence(): SignedMalwareEvidence {
  return {
    payload: {
      evidenceId: "evidence-1",
      tenantId: "10000000-0000-4000-8000-000000000001",
      clinicId: "10000000-0000-4000-8000-000000000002",
      mediaId: "10000000-0000-4000-8000-000000000003",
      uploadId: "10000000-0000-4000-8000-000000000004",
      scanOperationId: `pmop_${"a".repeat(64)}`,
      objectIdentitySha256: "b".repeat(64),
      objectVersionId: "version-1",
      contentSha256Hex: "c".repeat(64),
      contentLength: 32,
      detectedMimeType: "image/jpeg",
      verdict: "clean",
      scanner: "scanner-1",
      engineVersion: "engine-1",
      definitionsVersion: "definitions-1",
      scannedAt: "2026-07-10T10:00:00.000Z"
    },
    signature: {
      keyId: "arn:aws:kms:ap-south-1:111122223333:key/00000000-0000-4000-8000-000000000009",
      algorithm: "RSASSA_PSS_SHA_256",
      valueBase64: Buffer.alloc(64, 9).toString("base64")
    }
  };
}
