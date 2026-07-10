import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { SignCommand } from "@aws-sdk/client-kms";
import { GetObjectTaggingCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import {
  GUARDDUTY_EVIDENCE_POLLING,
  GuardDutyEvidenceError,
  GuardDutyS3MalwareScannerTransport,
  canonicalMalwareEvidencePayloadBytes,
  createGuardDutyS3MalwareEvidenceLambdaHandler,
  createGuardDutyS3MalwareEvidenceLambdaHandlerFromEnvironment,
  type GuardDutyKmsSignCommandSender,
  type GuardDutyMalwareScanStatus,
  type GuardDutyS3CommandSender,
  type MalwareScannerTransport,
  type SignedMalwareEvidence
} from "../dist/media/index.js";

const region = "ap-south-1";
const bucket = "clinicos-private-media";
const objectKmsKeyId =
  "arn:aws:kms:ap-south-1:111122223333:key/00000000-0000-4000-8000-000000000001";
const signingKeyId = "arn:aws:kms:ap-south-1:111122223333:key/00000000-0000-4000-8000-000000000002";
const prefix = "staging/tenants/";
const body = Uint8Array.from(new Array<number>(64).fill(7));
const contentSha256Hex = createHash("sha256").update(body).digest("hex");
const versionId = "version-0001";

test("CP14 GuardDuty maps only official statuses and signs the canonical exact-version evidence", async (t) => {
  const cases: ReadonlyArray<
    readonly [GuardDutyMalwareScanStatus, "clean" | "malicious" | "error"]
  > = [
    ["NO_THREATS_FOUND", "clean"],
    ["THREATS_FOUND", "malicious"],
    ["UNSUPPORTED", "error"],
    ["ACCESS_DENIED", "error"],
    ["FAILED", "error"]
  ];

  for (const [status, expectedVerdict] of cases) {
    await t.test(status, async () => {
      const harness = createHarness(status);
      const evidence = await harness.scanner.scan(scanRequest());
      assert.equal(evidence.payload.verdict, expectedVerdict);
      assert.equal(evidence.payload.scanner, "aws-guardduty-s3");
      assert.equal(evidence.payload.engineVersion, "guardduty-s3-managed");
      assert.equal(evidence.payload.definitionsVersion, "not-disclosed-by-aws");
      assert.match(evidence.payload.evidenceId, /^gdmp_[a-f0-9]{64}$/u);
      assert.equal(evidence.signature.keyId, signingKeyId);
      assert.equal(evidence.signature.algorithm, "RSASSA_PSS_SHA_256");
      assert.equal(Buffer.from(evidence.signature.valueBase64, "base64").byteLength, 256);

      assert.equal(harness.s3.headCommands.length, 2);
      assert.equal(harness.s3.tagCommands.length, 2);
      for (const command of harness.s3.headCommands) {
        assert.equal(command.input.Bucket, bucket);
        assert.equal(command.input.Key, scanRequest().locator.key);
        assert.equal(command.input.VersionId, versionId);
        assert.equal(command.input.ChecksumMode, "ENABLED");
      }
      for (const command of harness.s3.tagCommands) {
        assert.equal(command.input.VersionId, versionId);
      }
      const sign = harness.kms.commands[0];
      assert.ok(sign);
      assert.equal(sign.input.KeyId, signingKeyId);
      assert.equal(sign.input.MessageType, "RAW");
      assert.equal(sign.input.SigningAlgorithm, "RSASSA_PSS_SHA_256");
      assert.deepEqual(
        Buffer.from(sign.input.Message ?? []),
        Buffer.from(canonicalMalwareEvidencePayloadBytes(evidence.payload))
      );
      assert.deepEqual(Object.keys(evidence).sort(), ["payload", "signature"]);
    });
  }
});

test("CP14 missing GuardDuty tag is an explicit retryable pending result with no internal polling or signing", async () => {
  const harness = createHarness(null);
  assert.deepEqual(GUARDDUTY_EVIDENCE_POLLING, {
    mode: "external-bounded-retry",
    internalAttemptsPerInvocation: 1
  });
  await assert.rejects(harness.scanner.scan(scanRequest()), (error: unknown) => {
    assert.ok(error instanceof GuardDutyEvidenceError);
    assert.equal(error.code, "scan_pending");
    assert.equal(error.retryable, true);
    return true;
  });
  assert.equal(harness.s3.headCommands.length, 1);
  assert.equal(harness.s3.tagCommands.length, 1);
  assert.equal(harness.kms.commands.length, 0);
});

test("CP14 rejects caller verdicts and malformed Lambda envelopes before any AWS call", async () => {
  const harness = createHarness("NO_THREATS_FOUND");
  const handler = createGuardDutyS3MalwareEvidenceLambdaHandler(
    { s3: harness.s3, kms: harness.kms, now: fixedNow },
    scannerConfig()
  );
  await assert.rejects(
    handler({ ...scanRequest(), verdict: "clean" }),
    hasGuardDutyCode("invalid_request", false)
  );
  await assert.rejects(
    handler({ request: scanRequest() }),
    hasGuardDutyCode("invalid_request", false)
  );
  await assert.rejects(handler(null), hasGuardDutyCode("invalid_request", false));
  assert.equal(harness.s3.commands.length, 0);
  assert.equal(harness.kms.commands.length, 0);
});

test("CP14 Lambda handler returns exactly SignedMalwareEvidence without duplicating signer logic", async () => {
  const harness = createHarness("NO_THREATS_FOUND");
  const handler = createGuardDutyS3MalwareEvidenceLambdaHandler(
    { s3: harness.s3, kms: harness.kms, now: fixedNow },
    scannerConfig()
  );
  const output: SignedMalwareEvidence = await handler(scanRequest());
  assert.deepEqual(Object.keys(output).sort(), ["payload", "signature"]);
  assert.equal(output.payload.scanOperationId, scanRequest().operationId);
  assert.equal(output.payload.objectVersionId, versionId);
  assert.equal(harness.kms.commands.length, 1);
});

test("CP14 image entrypoint factory consumes the exact Terraform environment contract", () => {
  const handler = createGuardDutyS3MalwareEvidenceLambdaHandlerFromEnvironment({
    AWS_REGION: region,
    CLINICOS_GUARDDUTY_BUCKET: bucket,
    CLINICOS_GUARDDUTY_SUPPORTED_REGIONS: JSON.stringify([region]),
    CLINICOS_GUARDDUTY_QUARANTINE_PREFIXES: JSON.stringify([prefix]),
    CLINICOS_GUARDDUTY_OBJECT_KMS_KEY_ID: objectKmsKeyId,
    CLINICOS_GUARDDUTY_SIGNING_KEY_ID: signingKeyId,
    CLINICOS_GUARDDUTY_SIGNING_ALGORITHM: "RSASSA_PSS_SHA_256"
  });
  assert.equal(typeof handler, "function");
  assert.throws(
    () =>
      createGuardDutyS3MalwareEvidenceLambdaHandlerFromEnvironment({
        AWS_REGION: region,
        CLINICOS_GUARDDUTY_BUCKET: bucket,
        CLINICOS_GUARDDUTY_SUPPORTED_REGIONS: "not-json",
        CLINICOS_GUARDDUTY_QUARANTINE_PREFIXES: JSON.stringify([prefix]),
        CLINICOS_GUARDDUTY_OBJECT_KMS_KEY_ID: objectKmsKeyId,
        CLINICOS_GUARDDUTY_SIGNING_KEY_ID: signingKeyId,
        CLINICOS_GUARDDUTY_SIGNING_ALGORITHM: "RSASSA_PSS_SHA_256"
      }),
    hasGuardDutyCode("invalid_configuration", false)
  );
});

test("CP14 replay drift retains one evidence identity for durable conflict rejection", async () => {
  const s3 = new RecordingS3("NO_THREATS_FOUND");
  const kms = new RecordingKms();
  let now = new Date("2026-07-11T09:00:00.000Z");
  const scanner = new GuardDutyS3MalwareScannerTransport(
    { s3, kms, now: () => now },
    scannerConfig()
  );
  const first = await scanner.scan(scanRequest());
  now = new Date("2026-07-11T09:00:01.000Z");
  const replay = await scanner.scan(scanRequest());
  assert.equal(replay.payload.evidenceId, first.payload.evidenceId);
  assert.notEqual(replay.payload.scannedAt, first.payload.scannedAt);
  assert.notDeepEqual(
    Buffer.from(canonicalMalwareEvidencePayloadBytes(replay.payload)),
    Buffer.from(canonicalMalwareEvidencePayloadBytes(first.payload))
  );
});

test("CP14 exact authority, object identity, bucket, region, and quarantine prefix are mandatory", async (t) => {
  const cases: ReadonlyArray<readonly [string, () => ReturnType<typeof scanRequest>]> = [
    [
      "bucket",
      () => ({ ...scanRequest(), locator: { ...scanRequest().locator, bucket: "other-bucket" } })
    ],
    [
      "region",
      () => ({ ...scanRequest(), locator: { ...scanRequest().locator, region: "us-east-1" } })
    ],
    ["identity", () => ({ ...scanRequest(), objectIdentitySha256: "a".repeat(64) })],
    [
      "tenant path",
      () => ({
        ...scanRequest(),
        locator: {
          ...scanRequest().locator,
          key: scanRequest().locator.key.replace("tenant-1", "tenant-2")
        }
      })
    ],
    [
      "unprotected prefix",
      () => ({
        ...scanRequest(),
        locator: { ...scanRequest().locator, key: `other/${scanRequest().locator.key}` }
      })
    ]
  ];
  for (const [name, request] of cases) {
    await t.test(name, async () => {
      const harness = createHarness("NO_THREATS_FOUND");
      await assert.rejects(harness.scanner.scan(request()), (error: unknown) => {
        assert.ok(error instanceof GuardDutyEvidenceError);
        assert.ok(["unsupported_scope", "object_state_invalid"].includes(error.code));
        assert.equal(error.retryable, false);
        return true;
      });
      assert.equal(harness.kms.commands.length, 0);
    });
  }
});

test("CP14 object version, ETag, binding, checksum, and scan-tag drift fail closed", async (t) => {
  const cases: ReadonlyArray<readonly [string, (s3: RecordingS3) => void]> = [
    ["version", (s3) => (s3.secondHead = { ...s3.baseHead, VersionId: "version-0002" })],
    ["etag", (s3) => (s3.secondHead = { ...s3.baseHead, ETag: `"${"b".repeat(32)}"` })],
    [
      "binding",
      (s3) => (s3.secondHead = { ...s3.baseHead, Metadata: { "clinicos-binding": "B".repeat(43) } })
    ],
    [
      "checksum",
      (s3) =>
        (s3.secondHead = {
          ...s3.baseHead,
          ChecksumSHA256: Buffer.alloc(32, 9).toString("base64")
        })
    ],
    ["tag", (s3) => (s3.secondStatus = "THREATS_FOUND")]
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      const harness = createHarness("NO_THREATS_FOUND");
      mutate(harness.s3);
      await assert.rejects(
        harness.scanner.scan(scanRequest()),
        hasGuardDutyCode("object_state_invalid", false)
      );
      assert.equal(harness.kms.commands.length, 0);
    });
  }
});

test("CP14 rejects malformed official AWS responses and KMS signature shapes", async (t) => {
  const objectCases: ReadonlyArray<readonly [string, (s3: RecordingS3) => void]> = [
    ["missing version", (s3) => (s3.baseHead = { ...s3.baseHead, VersionId: undefined })],
    ["delete marker", (s3) => (s3.baseHead = { ...s3.baseHead, DeleteMarker: true })],
    ["missing checksum", (s3) => (s3.baseHead = { ...s3.baseHead, ChecksumSHA256: undefined })],
    ["wrong KMS key", (s3) => (s3.baseHead = { ...s3.baseHead, SSEKMSKeyId: signingKeyId })],
    ["unknown status", (s3) => (s3.firstRawStatus = "PENDING")],
    ["missing quarantine", (s3) => (s3.includeQuarantineTag = false)]
  ];
  for (const [name, mutate] of objectCases) {
    await t.test(name, async () => {
      const harness = createHarness("NO_THREATS_FOUND");
      mutate(harness.s3);
      await assert.rejects(
        harness.scanner.scan(scanRequest()),
        hasGuardDutyCode("object_state_invalid", false)
      );
      assert.equal(harness.kms.commands.length, 0);
    });
  }

  const signatureCases: ReadonlyArray<readonly [string, (kms: RecordingKms) => void]> = [
    ["missing signature", (kms) => (kms.signature = undefined)],
    ["short signature", (kms) => (kms.signature = Uint8Array.from([1, 2, 3]))],
    ["wrong key", (kms) => (kms.returnedKeyId = objectKmsKeyId)],
    ["wrong algorithm", (kms) => (kms.returnedAlgorithm = "ECDSA_SHA_256")]
  ];
  for (const [name, mutate] of signatureCases) {
    await t.test(name, async () => {
      const harness = createHarness("NO_THREATS_FOUND");
      mutate(harness.kms);
      await assert.rejects(
        harness.scanner.scan(scanRequest()),
        hasGuardDutyCode("signing_failure", false)
      );
    });
  }
});

test("CP14 provider and signing failures expose bounded classifications without AWS detail or PHI", async () => {
  const provider = createHarness("NO_THREATS_FOUND");
  provider.s3.failure = new Error(
    `SECRET patient name ${bucket} ${scanRequest().locator.key} ${objectKmsKeyId}`
  );
  await assert.rejects(provider.scanner.scan(scanRequest()), (error: unknown) => {
    assert.ok(error instanceof GuardDutyEvidenceError);
    assert.equal(error.code, "provider_failure");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(JSON.stringify(error), /SECRET|patient|clinicos-private|tenant-1|kms/iu);
    return true;
  });

  const signer = createHarness("NO_THREATS_FOUND");
  signer.kms.failure = new Error(`SECRET ${signingKeyId}`);
  await assert.rejects(signer.scanner.scan(scanRequest()), (error: unknown) => {
    assert.ok(error instanceof GuardDutyEvidenceError);
    assert.equal(error.code, "signing_failure");
    assert.equal(error.retryable, true);
    assert.doesNotMatch(JSON.stringify(error), /SECRET|kms|00000000/iu);
    return true;
  });
});

test("CP14 configuration rejects unsupported regions, overlapping prefixes, and unsafe signing bounds", () => {
  const dependencies = { s3: new RecordingS3("NO_THREATS_FOUND"), kms: new RecordingKms() };
  assert.throws(
    () =>
      new GuardDutyS3MalwareScannerTransport(dependencies, {
        ...scannerConfig(),
        supportedRegions: ["eu-west-1"]
      }),
    hasGuardDutyCode("invalid_configuration", false)
  );
  assert.throws(
    () =>
      new GuardDutyS3MalwareScannerTransport(dependencies, {
        ...scannerConfig(),
        quarantinePrefixes: [prefix, `${prefix}nested/tenants/`]
      }),
    hasGuardDutyCode("invalid_configuration", false)
  );
  assert.throws(
    () =>
      new GuardDutyS3MalwareScannerTransport(dependencies, {
        ...scannerConfig(),
        maximumSignatureBytes: 2_048
      }),
    hasGuardDutyCode("invalid_configuration", false)
  );
});

function createHarness(status: GuardDutyMalwareScanStatus | null): {
  scanner: GuardDutyS3MalwareScannerTransport;
  s3: RecordingS3;
  kms: RecordingKms;
} {
  const s3 = new RecordingS3(status);
  const kms = new RecordingKms();
  return {
    scanner: new GuardDutyS3MalwareScannerTransport({ s3, kms, now: fixedNow }, scannerConfig()),
    s3,
    kms
  };
}

function scannerConfig() {
  return {
    bucket,
    region,
    supportedRegions: [region],
    quarantinePrefixes: [prefix],
    objectKmsKeyId,
    signingKeyId,
    signingAlgorithm: "RSASSA_PSS_SHA_256" as const
  };
}

function scanRequest(): Parameters<MalwareScannerTransport["scan"]>[0] {
  const locator = {
    bucket,
    region,
    key: `${prefix}tenant-1/clinics/clinic-1/media/media-1/upload-1/${"n".repeat(40)}`
  };
  return {
    authority: {
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      mediaId: "media-1",
      uploadId: "upload-1",
      actorId: "actor-1",
      correlationId: "correlation-1"
    },
    operationId: "operation-1",
    intentId: "intent-1",
    locator,
    objectVersionId: versionId,
    objectIdentitySha256: createHash("sha256")
      .update([locator.region, locator.bucket, locator.key, versionId].join("\u001f"))
      .digest("hex"),
    contentSha256Hex,
    contentLength: body.byteLength,
    detectedMimeType: "image/jpeg",
    attempt: 1
  };
}

class RecordingS3 implements GuardDutyS3CommandSender {
  readonly commands: Array<HeadObjectCommand | GetObjectTaggingCommand> = [];
  readonly headCommands: HeadObjectCommand[] = [];
  readonly tagCommands: GetObjectTaggingCommand[] = [];
  baseHead: Record<string, unknown> = {
    $metadata: {},
    VersionId: versionId,
    ETag: `"${"a".repeat(32)}"`,
    ContentLength: body.byteLength,
    ContentType: "image/jpeg",
    ChecksumSHA256: Buffer.from(contentSha256Hex, "hex").toString("base64"),
    LastModified: new Date("2026-07-11T08:59:00.000Z"),
    ServerSideEncryption: "aws:kms",
    SSEKMSKeyId: objectKmsKeyId,
    Metadata: { "clinicos-binding": "A".repeat(43) }
  };
  secondHead: Record<string, unknown> | null = null;
  firstRawStatus: string | null;
  secondStatus: string | null;
  includeQuarantineTag = true;
  failure: Error | null = null;

  constructor(status: GuardDutyMalwareScanStatus | null) {
    this.firstRawStatus = status;
    this.secondStatus = status;
  }

  async send(command: HeadObjectCommand | GetObjectTaggingCommand): Promise<any> {
    this.commands.push(command);
    if (this.failure) throw this.failure;
    if (command instanceof HeadObjectCommand) {
      this.headCommands.push(command);
      const selected =
        this.headCommands.length === 2 && this.secondHead ? this.secondHead : this.baseHead;
      return { ...selected };
    }
    this.tagCommands.push(command);
    const status = this.tagCommands.length === 1 ? this.firstRawStatus : this.secondStatus;
    const TagSet: Array<{ Key: string; Value: string }> = [];
    if (this.includeQuarantineTag) TagSet.push({ Key: "clinicos_state", Value: "quarantine" });
    if (status !== null) TagSet.push({ Key: "GuardDutyMalwareScanStatus", Value: status });
    return { $metadata: {}, VersionId: versionId, TagSet };
  }
}

class RecordingKms implements GuardDutyKmsSignCommandSender {
  readonly commands: SignCommand[] = [];
  signature: Uint8Array | undefined = Buffer.alloc(256, 7);
  returnedKeyId = signingKeyId;
  returnedAlgorithm = "RSASSA_PSS_SHA_256";
  failure: Error | null = null;

  async send(command: SignCommand): Promise<any> {
    this.commands.push(command);
    if (this.failure) throw this.failure;
    return {
      $metadata: {},
      KeyId: this.returnedKeyId,
      SigningAlgorithm: this.returnedAlgorithm,
      Signature: this.signature
    };
  }
}

function fixedNow(): Date {
  return new Date("2026-07-11T09:00:00.000Z");
}

function hasGuardDutyCode(code: string, retryable: boolean) {
  return (error: unknown): boolean => {
    assert.ok(error instanceof GuardDutyEvidenceError);
    assert.equal(error.code, code);
    assert.equal(error.retryable, retryable);
    return true;
  };
}
