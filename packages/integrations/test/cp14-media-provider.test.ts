import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  ClinicalMediaMagicByteDetector,
  PrivateMediaError,
  S3PrivateMediaProvider,
  type MalwareEvidenceStore,
  type MalwareScannerTransport,
  type PrivateMediaAuditEvent,
  type PrivateMediaAuditSink,
  type PrivateMediaAuthority,
  type PrivateMediaRecord,
  type PrivateMediaScope,
  type PrivateMediaStateStore,
  type S3ObjectLocator,
  type S3ObjectSnapshot,
  type S3PresigningTransport,
  type S3PrivateObjectTransport,
  type SignedMalwareEvidence
} from "../dist/media/index.js";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array<number>(28).fill(0)]);
const jpegDigest = createHash("sha256").update(jpeg).digest("hex");

test("CP14 reservation is short-lived, scope-bound, quarantined, and redacted", async () => {
  const harness = createHarness();
  const reserved = await reserve(harness);

  assert.equal(reserved.upload.method, "PUT");
  assert.equal(reserved.upload.maxBytes, jpeg.byteLength);
  assert.equal(reserved.upload.requiredHeaders["content-type"], "image/jpeg");
  assert.equal(reserved.upload.requiredHeaders["content-length"], String(jpeg.byteLength));
  assert.equal(reserved.upload.requiredHeaders["x-amz-tagging"], "clinicos_state=quarantine");
  assert.match(
    reserved.upload.requiredHeaders["x-amz-meta-clinicos-binding"] ?? "",
    /^[A-Za-z0-9_-]{40,}$/u
  );
  assertNoPrivateFields({
    ...reserved,
    upload: { ...reserved.upload, url: "[signed-url-redacted]" }
  });

  const record = await harness.state.get(scope(harness.authority));
  assert.ok(record);
  assert.match(
    record.locator.key,
    /tenants\/tenant-1\/clinics\/clinic-1\/media\/media-1\/upload-1\//u
  );
  assert.doesNotMatch(record.locator.key, /patient|\.jpg|filename/iu);
  assert.equal(record.state, "reserved");
  assert.equal(harness.auditEvents[0]?.action, "media.upload_reserved");
  assertNoPrivateFields(harness.auditEvents);
});

test("CP14 completion rejects expired, incomplete, size, type, digest, metadata, and magic-byte tamper", async (t) => {
  const cases: ReadonlyArray<{
    name: string;
    mutate: (harness: Harness, snapshot: S3ObjectSnapshot) => S3ObjectSnapshot;
    code: string;
  }> = [
    {
      name: "incomplete multipart",
      mutate: (_harness, snapshot) => ({ ...snapshot, multipartStatus: "incomplete" }),
      code: "object_incomplete"
    },
    {
      name: "wrong size",
      mutate: (_harness, snapshot) => ({ ...snapshot, contentLength: snapshot.contentLength + 1 }),
      code: "integrity_mismatch"
    },
    {
      name: "wrong declared type",
      mutate: (_harness, snapshot) => ({ ...snapshot, contentType: "image/png" }),
      code: "integrity_mismatch"
    },
    {
      name: "wrong digest",
      mutate: (_harness, snapshot) => ({ ...snapshot, checksumSha256Hex: "a".repeat(64) }),
      code: "integrity_mismatch"
    },
    {
      name: "wrong authority metadata",
      mutate: (_harness, snapshot) => ({
        ...snapshot,
        metadata: { "clinicos-binding": "tampered-binding" }
      }),
      code: "integrity_mismatch"
    },
    {
      name: "missing KMS",
      mutate: (_harness, snapshot) => ({ ...snapshot, serverSideEncryption: null, kmsKeyId: null }),
      code: "kms_policy_mismatch"
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const harness = createHarness();
      await reserve(harness);
      const record = mustRecord(await harness.state.get(scope(harness.authority)));
      const snapshot = harness.objects.upload(record, jpeg);
      harness.objects.snapshot = scenario.mutate(harness, snapshot);
      await assert.rejects(
        harness.provider.verifyUploadCompletion(harness.authority),
        hasMediaCode(scenario.code)
      );
    });
  }

  await t.test("magic-byte mismatch", async () => {
    const harness = createHarness();
    const pdfBytes = new TextEncoder().encode("%PDF-1.7 fake image");
    harness.authority = { ...harness.authority, mediaId: "media-pdf", uploadId: "upload-pdf" };
    await reserve(harness, {
      expectedBytes: pdfBytes.byteLength,
      expectedSha256Hex: sha256(pdfBytes)
    });
    const record = mustRecord(await harness.state.get(scope(harness.authority)));
    harness.objects.upload(record, pdfBytes);
    await assert.rejects(
      harness.provider.verifyUploadCompletion(harness.authority),
      hasMediaCode("magic_type_mismatch")
    );
  });

  await t.test("expired reservation", async () => {
    const harness = createHarness();
    await reserve(harness);
    harness.clock.now = new Date("2026-07-10T10:11:00.000Z");
    await assert.rejects(
      harness.provider.verifyUploadCompletion(harness.authority),
      hasMediaCode("reservation_expired")
    );
  });

  await t.test("object version changes after completion", async () => {
    const harness = createHarness();
    await completeUpload(harness);
    assert.ok(harness.objects.snapshot);
    harness.objects.snapshot = { ...harness.objects.snapshot, versionId: "version-2" };
    await assert.rejects(
      harness.provider.verifyUploadCompletion(harness.authority),
      hasMediaCode("integrity_mismatch")
    );
  });
});

test("CP14 clean signed evidence is required before least-scope read access", async () => {
  const harness = createHarness();
  await completeUpload(harness);

  await assert.rejects(
    harness.provider.createSignedReadAccess(harness.authority, "2026-07-10T10:04:00.000Z"),
    hasMediaCode("quarantined")
  );

  const inspected = await harness.provider.inspectQuarantinedMedia(harness.authority);
  assert.equal(inspected.state, "available");
  assert.equal(inspected.scanStatus, "clean");
  assert.equal(inspected.evidenceId, "evidence-1");

  const access = await harness.provider.createSignedReadAccess(
    harness.authority,
    "2026-07-10T10:04:00.000Z"
  );
  assert.equal(access.method, "GET");
  assert.equal(access.expiresAt, "2026-07-10T10:04:00.000Z");
  assert.deepEqual(access.requiredHeaders, {});
  assertNoPrivateFields({ ...access, url: "[signed-url-redacted]" });
  assert.equal(harness.signer.lastGet?.versionId, "version-1");

  await assert.rejects(
    harness.provider.createSignedReadAccess(
      { ...harness.authority, tenantId: "tenant-2" },
      "2026-07-10T10:04:00.000Z"
    ),
    hasMediaCode("not_found")
  );
  assert.equal(
    harness.auditEvents.some((event) => event.action === "media.access_signed"),
    true
  );
  assertNoPrivateFields(harness.auditEvents);
});

test("CP14 malicious, invalid-signature, and conflicting evidence never becomes available", async (t) => {
  await t.test("malicious verdict", async () => {
    const harness = createHarness({ scannerVerdict: "malicious" });
    await completeUpload(harness);
    const result = await harness.provider.inspectQuarantinedMedia(harness.authority);
    assert.equal(result.state, "quarantined");
    await assert.rejects(
      harness.provider.createSignedReadAccess(harness.authority, "2026-07-10T10:04:00.000Z"),
      hasMediaCode("quarantined")
    );
  });

  await t.test("invalid signature", async () => {
    const harness = createHarness({ validEvidenceSignature: false });
    await completeUpload(harness);
    await assert.rejects(
      harness.provider.inspectQuarantinedMedia(harness.authority),
      hasMediaCode("scan_evidence_invalid")
    );
    assert.equal((await harness.state.get(scope(harness.authority)))?.state, "scan_failed");
  });

  await t.test("conflicting evidence id", async () => {
    const harness = createHarness({ evidenceConflict: true });
    await completeUpload(harness);
    await assert.rejects(
      harness.provider.inspectQuarantinedMedia(harness.authority),
      hasMediaCode("scan_evidence_conflict")
    );
    assert.equal((await harness.state.get(scope(harness.authority)))?.state, "scan_failed");
  });
});

test("CP14 scanner timeout stays unavailable and can retry without duplicate completion", async () => {
  const harness = createHarness({ scannerFailures: 1 });
  await completeUpload(harness);
  await assert.rejects(
    harness.provider.inspectQuarantinedMedia(harness.authority),
    hasMediaCode("scan_failed")
  );
  assert.equal((await harness.state.get(scope(harness.authority)))?.state, "scan_failed");

  const retried = await harness.provider.inspectQuarantinedMedia(harness.authority);
  assert.equal(retried.state, "available");
  assert.equal((await harness.state.get(scope(harness.authority)))?.scanAttempts, 2);
  assert.equal(harness.scanner.calls, 2);
});

test("CP14 lifecycle uses delete markers, governed restore, rescan, legal hold, and permanent purge", async () => {
  const harness = createHarness({ restoreWindowSeconds: 60 });
  await completeUpload(harness);
  await harness.provider.inspectQuarantinedMedia(harness.authority);

  await harness.provider.setLegalHold(harness.authority, true);
  await assert.rejects(
    harness.provider.deleteMedia({ authority: harness.authority, reason: "patient request" }),
    hasMediaCode("legal_hold")
  );
  await harness.provider.setLegalHold(harness.authority, false);

  const deleted = await harness.provider.deleteMedia({
    authority: harness.authority,
    reason: "governed retention disposition"
  });
  assert.equal(deleted.state, "deleted");
  assert.equal(deleted.recoverableUntil, "2026-07-10T10:01:00.000Z");
  await assert.rejects(
    harness.provider.createSignedReadAccess(harness.authority, "2026-07-10T10:00:30.000Z"),
    hasMediaCode("quarantined")
  );

  const restored = await harness.provider.restoreMedia({
    authority: harness.authority,
    reason: "approved clinical restoration"
  });
  assert.equal(restored.state, "quarantined");
  await assert.rejects(
    harness.provider.createSignedReadAccess(harness.authority, "2026-07-10T10:00:30.000Z"),
    hasMediaCode("quarantined")
  );
  const rescanned = await harness.provider.inspectQuarantinedMedia(harness.authority);
  assert.equal(rescanned.state, "available");

  await harness.provider.deleteMedia({ authority: harness.authority, reason: "retention elapsed" });
  harness.clock.now = new Date("2026-07-10T10:02:00.000Z");
  const purged = await harness.provider.purgeExpiredDeletedMedia(harness.authority);
  assert.equal(purged.state, "purged");
  assert.equal(harness.objects.deletedVersions.includes("version-1"), true);
  assertNoPrivateFields(harness.auditEvents);
});

test("CP14 signer cannot return expired or broadened URL authority", async () => {
  const harness = createHarness({ signerExpiry: "2026-07-10T09:59:59.000Z" });
  await assert.rejects(reserve(harness), hasMediaCode("provider_error"));

  const wrongMethod = createHarness({ signerMethod: "GET" });
  await assert.rejects(reserve(wrongMethod), hasMediaCode("provider_error"));
});

interface HarnessOptions {
  readonly scannerVerdict?: "clean" | "malicious" | "suspicious" | "error";
  readonly validEvidenceSignature?: boolean;
  readonly evidenceConflict?: boolean;
  readonly scannerFailures?: number;
  readonly restoreWindowSeconds?: number;
  readonly signerExpiry?: string;
  readonly signerMethod?: "PUT" | "GET";
}

interface Harness {
  authority: PrivateMediaAuthority;
  readonly provider: S3PrivateMediaProvider;
  readonly state: TestStateStore;
  readonly objects: TestObjectTransport;
  readonly signer: TestSigner;
  readonly scanner: TestScanner;
  readonly clock: { now: Date };
  readonly auditEvents: PrivateMediaAuditEvent[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const clock = { now: new Date("2026-07-10T10:00:00.000Z") };
  const state = new TestStateStore();
  const objects = new TestObjectTransport();
  const signer = new TestSigner(options.signerExpiry, options.signerMethod);
  const auditEvents: PrivateMediaAuditEvent[] = [];
  const scanner = new TestScanner(
    clock,
    options.scannerVerdict ?? "clean",
    options.scannerFailures ?? 0
  );
  let id = 0;
  const provider = new S3PrivateMediaProvider(
    {
      environment: "staging",
      bucket: "private-media-bucket",
      region: "ap-south-1",
      kmsKeyId: "kms-media-key-1",
      bindingSecret: "0123456789abcdef0123456789abcdef",
      restoreWindowSeconds: options.restoreWindowSeconds ?? 2_592_000
    },
    {
      objects,
      signer,
      detector: new ClinicalMediaMagicByteDetector(),
      scanner,
      evidenceVerifier: {
        async verify() {
          return options.validEvidenceSignature ?? true;
        }
      },
      state,
      evidence: new TestEvidenceStore(options.evidenceConflict ?? false),
      audit: {
        async append(event) {
          auditEvents.push(event);
        }
      } satisfies PrivateMediaAuditSink,
      now: () => new Date(clock.now),
      randomId: () => `event-${++id}`,
      randomKeyBytes: () => Uint8Array.from(new Array<number>(32).fill(7))
    }
  );
  return {
    authority: {
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      mediaId: "media-1",
      uploadId: "upload-1",
      actorId: "actor-1",
      correlationId: "correlation-1"
    },
    provider,
    state,
    objects,
    signer,
    scanner,
    clock,
    auditEvents
  };
}

async function reserve(
  harness: Harness,
  overrides: Partial<{
    expectedBytes: number;
    expectedSha256Hex: string;
    declaredMimeType: string;
  }> = {}
) {
  const internalObjectKey = harness.provider.allocateInternalObjectKey(scope(harness.authority));
  return harness.provider.reserveUpload({
    authority: harness.authority,
    internalObjectKey,
    kind: "intraoral_photo",
    declaredMimeType: overrides.declaredMimeType ?? "image/jpeg",
    expectedBytes: overrides.expectedBytes ?? jpeg.byteLength,
    expectedSha256Hex: overrides.expectedSha256Hex ?? jpegDigest,
    expiresAt: "2026-07-10T10:10:00.000Z"
  });
}

async function completeUpload(harness: Harness) {
  await reserve(harness);
  const record = mustRecord(await harness.state.get(scope(harness.authority)));
  harness.objects.upload(record, jpeg);
  return harness.provider.verifyUploadCompletion(harness.authority);
}

class TestStateStore implements PrivateMediaStateStore {
  readonly records = new Map<string, PrivateMediaRecord>();

  async create(record: PrivateMediaRecord) {
    const key = stateKey(record.scope);
    const existing = this.records.get(key);
    if (!existing) {
      this.records.set(key, structuredClone(record));
      return "created" as const;
    }
    return JSON.stringify(existing) === JSON.stringify(record)
      ? ("replayed" as const)
      : ("conflict" as const);
  }

  async get(scopeValue: PrivateMediaScope) {
    const record = this.records.get(stateKey(scopeValue));
    return record ? structuredClone(record) : null;
  }

  async compareAndSwap(input: {
    scope: PrivateMediaScope;
    expectedRevision: number;
    expectedStates: readonly PrivateMediaRecord["state"][];
    next: PrivateMediaRecord;
  }) {
    const key = stateKey(input.scope);
    const current = this.records.get(key);
    if (
      !current ||
      current.revision !== input.expectedRevision ||
      !input.expectedStates.includes(current.state)
    ) {
      return false;
    }
    this.records.set(key, structuredClone(input.next));
    return true;
  }
}

class TestObjectTransport implements S3PrivateObjectTransport {
  snapshot: S3ObjectSnapshot | null = null;
  body = new Uint8Array();
  deleteMarker: string | null = null;
  readonly deletedVersions: string[] = [];

  upload(record: PrivateMediaRecord, bytes: Uint8Array): S3ObjectSnapshot {
    this.body = Uint8Array.from(bytes);
    this.snapshot = {
      contentLength: bytes.byteLength,
      contentType: record.declaredMimeType,
      checksumSha256Hex: sha256(bytes),
      versionId: "version-1",
      etag: "etag-1",
      lastModifiedAt: "2026-07-10T10:00:01.000Z",
      serverSideEncryption: "aws:kms",
      kmsKeyId: "kms-media-key-1",
      metadata: { "clinicos-binding": record.binding },
      tags: { clinicos_state: "quarantine" },
      multipartStatus: "none"
    };
    return this.snapshot;
  }

  async headObject() {
    return this.deleteMarker ? null : this.snapshot;
  }

  async readObjectRange(input: { start: number; endInclusive: number }) {
    return this.body.slice(input.start, input.endInclusive + 1);
  }

  async putObject(input: {
    locator: S3ObjectLocator;
    body: Uint8Array;
    contentType: string;
    checksumSha256Hex: string;
    metadata: Readonly<Record<string, string>>;
    tags: Readonly<Record<string, string>>;
  }) {
    this.body = Uint8Array.from(input.body);
    this.snapshot = {
      contentLength: input.body.byteLength,
      contentType: input.contentType,
      checksumSha256Hex: input.checksumSha256Hex,
      versionId: "version-1",
      etag: "etag-1",
      lastModifiedAt: "2026-07-10T10:00:01.000Z",
      serverSideEncryption: "aws:kms",
      kmsKeyId: "kms-media-key-1",
      metadata: input.metadata,
      tags: input.tags,
      multipartStatus: "none"
    };
    return this.snapshot;
  }

  async createDeleteMarker() {
    this.deleteMarker = "delete-marker-1";
    return { deleteMarkerVersionId: this.deleteMarker, deletedAt: "2026-07-10T10:00:00.000Z" };
  }

  async removeDeleteMarker(input: { deleteMarkerVersionId: string }) {
    assert.equal(input.deleteMarkerVersionId, this.deleteMarker);
    this.deleteMarker = null;
  }

  async deleteObjectVersion(input: { versionId: string }) {
    this.deletedVersions.push(input.versionId);
    if (input.versionId === "version-1") this.snapshot = null;
    if (input.versionId === this.deleteMarker) this.deleteMarker = null;
  }
}

class TestSigner implements S3PresigningTransport {
  lastGet: { versionId: string } | null = null;
  readonly forcedExpiry?: string;
  readonly forcedPutMethod?: "PUT" | "GET";

  constructor(forcedExpiry?: string, forcedPutMethod?: "PUT" | "GET") {
    this.forcedExpiry = forcedExpiry;
    this.forcedPutMethod = forcedPutMethod;
  }

  async signPutObject(input: Parameters<S3PresigningTransport["signPutObject"]>[0]) {
    return {
      method: this.forcedPutMethod ?? "PUT",
      url: "https://media-upload.example.test/opaque-capability",
      expiresAt: this.forcedExpiry ?? input.expiresAt,
      requiredHeaders: {
        "content-type": input.contentType,
        "content-length": String(input.contentLength),
        "x-amz-checksum-sha256": input.checksumSha256Base64,
        "x-amz-meta-clinicos-binding": input.metadata["clinicos-binding"] ?? "",
        "x-amz-tagging": "clinicos_state=quarantine"
      }
    } as const;
  }

  async signGetObject(input: Parameters<S3PresigningTransport["signGetObject"]>[0]) {
    this.lastGet = { versionId: input.versionId };
    return {
      method: "GET" as const,
      url: "https://media-access.example.test/opaque-capability",
      expiresAt: input.expiresAt,
      requiredHeaders: {}
    };
  }
}

class TestScanner implements MalwareScannerTransport {
  calls = 0;
  readonly clock: { now: Date };
  readonly verdict: "clean" | "malicious" | "suspicious" | "error";
  readonly failures: number;

  constructor(
    clock: { now: Date },
    verdict: "clean" | "malicious" | "suspicious" | "error",
    failures: number
  ) {
    this.clock = clock;
    this.verdict = verdict;
    this.failures = failures;
  }

  async scan(
    input: Parameters<MalwareScannerTransport["scan"]>[0]
  ): Promise<SignedMalwareEvidence> {
    this.calls += 1;
    if (this.calls <= this.failures) throw new Error("scanner timeout");
    return {
      payload: {
        evidenceId: "evidence-1",
        tenantId: input.authority.tenantId,
        clinicId: input.authority.clinicId,
        mediaId: input.authority.mediaId,
        uploadId: input.authority.uploadId,
        objectIdentitySha256: input.objectIdentitySha256,
        objectVersionId: input.objectVersionId,
        contentSha256Hex: input.contentSha256Hex,
        contentLength: input.contentLength,
        detectedMimeType: input.detectedMimeType,
        verdict: this.verdict,
        scanner: "scanner-1",
        engineVersion: "engine-1",
        definitionsVersion: "definitions-1",
        scannedAt: this.clock.now.toISOString()
      },
      signature: {
        keyId: "kms-signing-key-1",
        algorithm: "RSASSA_PSS_SHA_256",
        valueBase64: "c2lnbmF0dXJl"
      }
    };
  }
}

class TestEvidenceStore implements MalwareEvidenceStore {
  readonly values = new Map<string, string>();
  readonly forceConflict: boolean;

  constructor(forceConflict: boolean) {
    this.forceConflict = forceConflict;
  }

  async append(input: Parameters<MalwareEvidenceStore["append"]>[0]) {
    if (this.forceConflict) return "conflict" as const;
    const existing = this.values.get(input.evidenceId);
    if (!existing) {
      this.values.set(input.evidenceId, input.evidenceDigestSha256);
      return "recorded" as const;
    }
    return existing === input.evidenceDigestSha256 ? ("replayed" as const) : ("conflict" as const);
  }
}

function scope(authority: PrivateMediaAuthority): PrivateMediaScope {
  return {
    tenantId: authority.tenantId,
    clinicId: authority.clinicId,
    mediaId: authority.mediaId,
    uploadId: authority.uploadId
  };
}

function stateKey(value: PrivateMediaScope): string {
  return [value.tenantId, value.clinicId, value.mediaId, value.uploadId].join("|");
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function mustRecord(record: PrivateMediaRecord | null): PrivateMediaRecord {
  assert.ok(record);
  return record;
}

function hasMediaCode(code: string) {
  return (error: unknown) => error instanceof PrivateMediaError && error.code === code;
}

function assertNoPrivateFields(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(
    serialized,
    /"(?:bucket|key|objectKey|objectVersionId|deleteMarkerVersionId|kmsKeyId|providerToken|signedUrl)"/iu
  );
}
