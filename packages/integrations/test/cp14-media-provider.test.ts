import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  RoutedMediaAuthorityFactory,
  S3ClinicalMediaProvider
} from "../../../apps/api/src/providers/media/index.ts";
import {
  ClinicalMediaMagicByteDetector,
  PrivateMediaError,
  S3PrivateMediaProvider,
  privateMediaOperationSemanticFingerprint,
  privateMediaPersistenceWriteFingerprint,
  type MalwareScannerTransport,
  type PrivateMediaAtomicOperation,
  type PrivateMediaAtomicPersistence,
  type PrivateMediaAuditEvent,
  type PrivateMediaAuthority,
  type PrivateMediaRecord,
  type PrivateMediaReconciliationIntent,
  type PrivateMediaScope,
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
  assert.deepEqual(Object.keys(reserved.upload.requiredHeaders).sort(), [
    "content-length",
    "content-type",
    "x-amz-checksum-sha256",
    "x-amz-meta-clinicos-binding",
    "x-amz-tagging"
  ]);
  assert.match(
    reserved.upload.requiredHeaders["x-amz-meta-clinicos-binding"] ?? "",
    /^[A-Za-z0-9_-]{40,}$/u
  );
  assertNoPrivateFields({
    ...reserved,
    upload: { ...reserved.upload, url: "[signed-url-redacted]" }
  });

  const record = await harness.persistence.get(scope(harness.authority));
  assert.ok(record);
  assert.match(
    record.locator.key,
    /tenants\/tenant-1\/clinics\/clinic-1\/media\/media-1\/upload-1\//u
  );
  assert.doesNotMatch(record.locator.key, /patient|\.jpg|filename/iu);
  assert.equal(record.state, "reserved");
  assert.equal(harness.auditEvents[0]?.action, "media.upload_reserved");
  assert.equal(harness.persistence.intents.length, 1);
  assert.equal(
    harness.persistence.operations.has(harness.persistence.intents[0]?.operationId ?? ""),
    true
  );
  assert.match(harness.persistence.intents[0]?.operationId ?? "", /^pmop_[a-f0-9]{64}$/u);
  assert.match(harness.persistence.intents[0]?.intentId ?? "", /^pmri_[a-f0-9]{64}$/u);
  assert.match(
    harness.persistence.operations.values().next().value?.operation.semanticFingerprintSha256 ?? "",
    /^[a-f0-9]{64}$/u
  );
  assertNoPrivateFields(harness.auditEvents);
  assertNoPrivateFields(harness.persistence.intents);
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
      const record = mustRecord(await harness.persistence.get(scope(harness.authority)));
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
    const record = mustRecord(await harness.persistence.get(scope(harness.authority)));
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

test("CP14 API adapter snapshot stays pinned when a new object version appears after scan", async () => {
  let objects!: TestObjectTransport;
  let verifiedRecord!: PrivateMediaRecord;
  const harness = createHarness({
    scannerFactory: (clock) =>
      new TestScanner(clock, "clean", 0, () => {
        objects.overwriteLatest(verifiedRecord, jpeg);
      })
  });
  harness.authority = {
    ...harness.authority,
    mediaId: "media-boundary",
    uploadId: "media-boundary"
  };
  objects = harness.objects;
  const verified = await completeUpload(harness);
  verifiedRecord = mustRecord(await harness.persistence.get(scope(harness.authority)));
  const adapter = new S3ClinicalMediaProvider({
    gateway: harness.provider,
    region: "ap-south-1",
    authorityFactory: new RoutedMediaAuthorityFactory(() => ({
      actorId: harness.authority.actorId,
      correlationId: harness.authority.correlationId
    }))
  });

  const result = await adapter.inspect({
    reservation: {
      id: harness.authority.mediaId,
      tenantId: harness.authority.tenantId,
      clinicId: harness.authority.clinicId,
      objectKey: verifiedRecord.locator.key
    } as never,
    object: { objectKey: verifiedRecord.locator.key } as never,
    now: harness.clock.now
  });

  assert.equal(objects.snapshot?.versionId, "version-2");
  assert.equal(result.scanStatus, "clean");
  assert.equal(result.objectVersion, "version-1");
  assert.equal(verified.sha256Digest, jpegDigest);
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
    assert.equal((await harness.persistence.get(scope(harness.authority)))?.state, "scan_failed");
  });

  await t.test("conflicting evidence id", async () => {
    const harness = createHarness({ evidenceConflict: true });
    await completeUpload(harness);
    await assert.rejects(
      harness.provider.inspectQuarantinedMedia(harness.authority),
      hasMediaCode("scan_evidence_conflict")
    );
    assert.equal((await harness.persistence.get(scope(harness.authority)))?.state, "scan_failed");
  });
});

test("CP14 malformed scanner evidence is rejected before persistence", async (t) => {
  const mutations: ReadonlyArray<readonly [string, (evidence: SignedMalwareEvidence) => unknown]> =
    [
      [
        "verdict",
        (evidence) => ({ ...evidence, payload: { ...evidence.payload, verdict: "unknown" } })
      ],
      [
        "scanner id",
        (evidence) => ({ ...evidence, payload: { ...evidence.payload, scanner: "bad scanner" } })
      ],
      [
        "engine id",
        (evidence) => ({ ...evidence, payload: { ...evidence.payload, engineVersion: "" } })
      ],
      [
        "definitions id",
        (evidence) => ({
          ...evidence,
          payload: { ...evidence.payload, definitionsVersion: "bad\ndefinitions" }
        })
      ],
      [
        "signature key",
        (evidence) => ({
          ...evidence,
          signature: { ...evidence.signature, keyId: "unapproved-signing-key" }
        })
      ],
      [
        "signature algorithm",
        (evidence) => ({
          ...evidence,
          signature: { ...evidence.signature, algorithm: "HMAC_SHA_256" }
        })
      ],
      [
        "signature base64",
        (evidence) => ({
          ...evidence,
          signature: { ...evidence.signature, valueBase64: "not-base64" }
        })
      ],
      [
        "signature size",
        (evidence) => ({
          ...evidence,
          signature: {
            ...evidence.signature,
            valueBase64: Buffer.alloc(1_025).toString("base64")
          }
        })
      ],
      [
        "extra payload field",
        (evidence) => ({
          ...evidence,
          payload: { ...evidence.payload, unexpected: "field" }
        })
      ],
      [
        "missing payload field",
        (evidence) => {
          const payload = { ...evidence.payload } as Record<string, unknown>;
          delete payload.engineVersion;
          return { ...evidence, payload };
        }
      ]
    ];

  for (const [name, mutate] of mutations) {
    await t.test(name, async () => {
      const harness = createHarness({ evidenceMutator: mutate });
      await completeUpload(harness);
      await assert.rejects(
        harness.provider.inspectQuarantinedMedia(harness.authority),
        hasMediaCode("scan_evidence_invalid")
      );
      assert.equal((await harness.persistence.get(scope(harness.authority)))?.state, "scan_failed");
      assert.equal(harness.persistence.evidenceValues.size, 0);
    });
  }
});

test("CP14 scanner timeout stays unavailable and can retry without duplicate completion", async () => {
  const harness = createHarness({ scannerFailures: 1 });
  await completeUpload(harness);
  await assert.rejects(
    harness.provider.inspectQuarantinedMedia(harness.authority),
    hasMediaCode("scan_failed")
  );
  assert.equal((await harness.persistence.get(scope(harness.authority)))?.state, "scan_failed");

  const retried = await harness.provider.inspectQuarantinedMedia(harness.authority);
  assert.equal(retried.state, "available");
  assert.equal((await harness.persistence.get(scope(harness.authority)))?.scanAttempts, 2);
  assert.equal(harness.scanner.calls, 2);
});

test("CP14 atomic persistence rolls back reservation and scan-result units on failure", async (t) => {
  for (const failure of ["audit", "persistence"] as const) {
    await t.test(`reservation ${failure} failure`, async () => {
      const harness = createHarness();
      harness.persistence.failNext = failure;
      await assert.rejects(reserve(harness), new RegExp(`atomic ${failure} failure`, "u"));
      assert.equal(await harness.persistence.get(scope(harness.authority)), null);
      assert.equal(harness.persistence.auditEvents.length, 0);
      assert.equal(harness.persistence.intents.length, 0);
      assert.equal(harness.persistence.operations.size, 0);
    });
  }

  for (const failure of ["audit", "evidence", "persistence"] as const) {
    await t.test(`scan completion ${failure} failure`, async () => {
      const harness = createHarness({ scanCommitFailure: failure });
      await completeUpload(harness);
      await assert.rejects(
        harness.provider.inspectQuarantinedMedia(harness.authority),
        new RegExp(`atomic ${failure} failure`, "u")
      );
      const record = await harness.persistence.get(scope(harness.authority));
      assert.equal(record?.state, "scan_failed");
      assert.equal(harness.persistence.evidenceValues.size, 0);
      assert.equal(
        harness.persistence.auditEvents.some((event) => event.action === "media.scan_completed"),
        false
      );
      assert.equal(
        harness.persistence.auditEvents.some((event) => event.action === "media.scan_failed"),
        true
      );
      assert.equal(harness.persistence.auditEvents.length, harness.persistence.intents.length);
    });
  }
});

test("CP14 semantic persistence fingerprints are stable across time and conflict on changed meaning", async (t) => {
  const harness = createHarness();
  await reserve(harness);
  const record = mustRecord(await harness.persistence.get(scope(harness.authority)));
  const reservationOperation = committedOperationByAction(
    harness.persistence,
    "media.upload_reserved"
  );

  const timeOnlyReplay: PrivateMediaAtomicOperation = {
    ...reservationOperation,
    audit: { ...reservationOperation.audit, occurredAt: "2026-07-10T10:00:09.000Z" },
    reconciliationIntent: {
      ...reservationOperation.reconciliationIntent,
      createdAt: "2026-07-10T10:00:09.000Z"
    }
  };
  assert.equal(
    await harness.persistence.reserve({
      record: {
        ...record,
        createdAt: "2026-07-10T10:00:09.000Z",
        updatedAt: "2026-07-10T10:00:09.000Z"
      },
      operation: timeOnlyReplay
    }),
    "replayed"
  );

  const semanticMutations: ReadonlyArray<readonly [string, PrivateMediaAtomicOperation]> = [
    [
      "actor",
      recomputeOperationFingerprint({
        ...reservationOperation,
        audit: { ...reservationOperation.audit, actorId: "actor-2" }
      })
    ],
    [
      "correlation",
      recomputeOperationFingerprint({
        ...reservationOperation,
        audit: { ...reservationOperation.audit, correlationId: "correlation-2" }
      })
    ],
    [
      "audit",
      recomputeOperationFingerprint({
        ...reservationOperation,
        audit: {
          ...reservationOperation.audit,
          metadata: { ...reservationOperation.audit.metadata, expectedBytes: 999 }
        }
      })
    ],
    [
      "intent",
      recomputeOperationFingerprint({
        ...reservationOperation,
        reconciliationIntent: {
          ...reservationOperation.reconciliationIntent,
          payload: { ...reservationOperation.reconciliationIntent.payload, expectedBytes: 999 }
        }
      })
    ]
  ];
  for (const [name, operation] of semanticMutations) {
    await t.test(name, async () => {
      assert.equal(await harness.persistence.reserve({ record, operation }), "operation_conflict");
    });
  }

  await t.test("state", async () => {
    assert.equal(
      await harness.persistence.reserve({
        record: { ...record, expectedBytes: record.expectedBytes + 1 },
        operation: reservationOperation
      }),
      "operation_conflict"
    );
  });
  await t.test("scope", async () => {
    const malformedScope = recomputeOperationFingerprint({
      ...reservationOperation,
      audit: { ...reservationOperation.audit, tenantId: "tenant-2" },
      reconciliationIntent: {
        ...reservationOperation.reconciliationIntent,
        scope: { ...reservationOperation.reconciliationIntent.scope, tenantId: "tenant-2" }
      }
    });
    assert.equal(
      await harness.persistence.reserve({ record, operation: malformedScope }),
      "operation_conflict"
    );
  });
  await t.test("revisions", async () => {
    const malformedRevision = recomputeOperationFingerprint({
      ...reservationOperation,
      reconciliationIntent: {
        ...reservationOperation.reconciliationIntent,
        expectedRevision: 0
      }
    });
    assert.equal(
      await harness.persistence.reserve({ record, operation: malformedRevision }),
      "operation_conflict"
    );
  });
  await t.test("malformed operation", async () => {
    assert.equal(
      await harness.persistence.reserve({
        record,
        operation: { ...reservationOperation, audit: undefined } as never
      }),
      "operation_conflict"
    );
  });
});

test("CP14 persistence returns operation conflicts distinctly for transition, scan, and audit", async () => {
  const harness = createHarness();
  await completeUpload(harness);
  const verified = mustRecord(await harness.persistence.get(scope(harness.authority)));
  const transitionOperation = committedOperationByAction(
    harness.persistence,
    "media.upload_verified"
  );
  assert.equal(
    await harness.persistence.transition({
      scope: scope(harness.authority),
      expectedRevision: transitionOperation.reconciliationIntent.expectedRevision!,
      expectedStates: ["reserved"],
      next: verified,
      operation: recomputeOperationFingerprint({
        ...transitionOperation,
        audit: { ...transitionOperation.audit, actorId: "actor-2" }
      })
    }),
    "operation_conflict"
  );
  assert.equal(
    await harness.persistence.transition({
      scope: scope(harness.authority),
      expectedRevision: transitionOperation.reconciliationIntent.expectedRevision!,
      expectedStates: ["scan_failed"],
      next: verified,
      operation: transitionOperation
    }),
    "operation_conflict"
  );
  assert.equal(
    await harness.persistence.transition({
      scope: scope(harness.authority),
      expectedRevision: transitionOperation.reconciliationIntent.expectedRevision!,
      expectedStates: ["reserved"],
      next: { ...verified, scope: { ...verified.scope, tenantId: "tenant-2" } },
      operation: transitionOperation
    }),
    "operation_conflict"
  );

  await harness.provider.inspectQuarantinedMedia(harness.authority);
  const available = mustRecord(await harness.persistence.get(scope(harness.authority)));
  const scanOperation = committedOperationByAction(harness.persistence, "media.scan_completed");
  const evidence = harness.persistence.evidenceRecords.get(available.lastEvidenceId ?? "");
  assert.ok(evidence);
  assert.equal(
    await harness.persistence.commitScanResult({
      scope: scope(harness.authority),
      expectedRevision: scanOperation.reconciliationIntent.expectedRevision!,
      expectedStates: ["scan_in_progress"],
      evidence,
      success: {
        next: available,
        operation: recomputeOperationFingerprint({
          ...scanOperation,
          reconciliationIntent: {
            ...scanOperation.reconciliationIntent,
            payload: { ...scanOperation.reconciliationIntent.payload, verdict: "malicious" }
          }
        })
      },
      evidenceConflict: { next: available, operation: scanOperation }
    }),
    "operation_conflict"
  );

  const auditHarness = createHarness();
  await reserve(auditHarness);
  await assert.rejects(
    auditHarness.provider.createSignedReadAccess(
      auditHarness.authority,
      "2026-07-10T10:04:00.000Z"
    ),
    hasMediaCode("quarantined")
  );
  const auditOperation = committedOperationByAction(
    auditHarness.persistence,
    "media.access_signed"
  );
  assert.equal(
    await auditHarness.persistence.recordAuditAndIntent(
      recomputeOperationFingerprint({
        ...auditOperation,
        audit: { ...auditOperation.audit, correlationId: "correlation-2" }
      })
    ),
    "operation_conflict"
  );
});

test("CP14 concurrent scan success/failure races cannot overwrite the winning revision", async (t) => {
  await t.test("newer clean result wins over stale scanner failure", async () => {
    let controlled!: ControlledScanner;
    const harness = createHarness({
      scannerFactory: (clock) => (controlled = new ControlledScanner(clock))
    });
    await completeUpload(harness);

    const first = outcome(harness.provider.inspectQuarantinedMedia(harness.authority));
    await waitForScannerCalls(controlled, 1);
    harness.clock.now = new Date("2026-07-10T10:03:00.000Z");
    const second = outcome(harness.provider.inspectQuarantinedMedia(harness.authority));
    await waitForScannerCalls(controlled, 2);

    controlled.resolveCall(1, "clean");
    assert.equal((await second).value?.state, "available");
    controlled.rejectCall(0);
    assert.equal((await first).errorCode, "scan_failed");

    const record = await harness.persistence.get(scope(harness.authority));
    assert.equal(record?.state, "available");
    assert.equal(record?.lastEvidenceId, "evidence-race-2");
    assert.equal(harness.persistence.evidenceValues.size, 1);
  });

  await t.test("newer scanner failure wins over stale clean result", async () => {
    let controlled!: ControlledScanner;
    const harness = createHarness({
      scannerFactory: (clock) => (controlled = new ControlledScanner(clock))
    });
    await completeUpload(harness);

    const first = outcome(harness.provider.inspectQuarantinedMedia(harness.authority));
    await waitForScannerCalls(controlled, 1);
    harness.clock.now = new Date("2026-07-10T10:03:00.000Z");
    const second = outcome(harness.provider.inspectQuarantinedMedia(harness.authority));
    await waitForScannerCalls(controlled, 2);

    controlled.rejectCall(1);
    assert.equal((await second).errorCode, "scan_failed");
    controlled.resolveCall(0, "clean");
    assert.equal((await first).errorCode, "concurrent_change");

    const record = await harness.persistence.get(scope(harness.authority));
    assert.equal(record?.state, "scan_failed");
    assert.equal(record?.lastEvidenceId, null);
    assert.equal(harness.persistence.evidenceValues.size, 0);
  });
});

test("CP14 lifecycle uses delete markers, governed restore, rescan, legal hold, and permanent purge", async () => {
  const harness = createHarness({ restoreWindowSeconds: 60 });
  await completeUpload(harness);
  await harness.provider.inspectQuarantinedMedia(harness.authority);

  await harness.provider.setLegalHold(harness.authority, true);
  await assert.rejects(
    harness.provider.deleteMedia({
      authority: harness.authority,
      reasonCode: "patient_erasure_request"
    }),
    hasMediaCode("legal_hold")
  );
  await harness.provider.setLegalHold(harness.authority, false);

  const deleted = await harness.provider.deleteMedia({
    authority: harness.authority,
    reasonCode: "retention_policy"
  });
  assert.equal(deleted.state, "deleted");
  assert.equal(deleted.recoverableUntil, "2026-07-10T10:01:00.000Z");
  await assert.rejects(
    harness.provider.createSignedReadAccess(harness.authority, "2026-07-10T10:00:30.000Z"),
    hasMediaCode("quarantined")
  );

  const restored = await harness.provider.restoreMedia({
    authority: harness.authority,
    reasonCode: "authorized_restore"
  });
  assert.equal(restored.state, "quarantined");
  await assert.rejects(
    harness.provider.createSignedReadAccess(harness.authority, "2026-07-10T10:00:30.000Z"),
    hasMediaCode("quarantined")
  );
  const rescanned = await harness.provider.inspectQuarantinedMedia(harness.authority);
  assert.equal(rescanned.state, "available");

  await harness.provider.deleteMedia({
    authority: harness.authority,
    reasonCode: "retention_policy"
  });
  harness.clock.now = new Date("2026-07-10T10:02:00.000Z");
  const purged = await harness.provider.purgeExpiredDeletedMedia(harness.authority);
  assert.equal(purged.state, "purged");
  assert.equal(harness.objects.deletedVersions.includes("version-1"), true);
  const legalHoldAudits = harness.auditEvents.filter(
    (event) => event.action === "media.legal_hold_changed"
  );
  assert.deepEqual(
    legalHoldAudits.map((event) => event.metadata.legalHold),
    [true, false]
  );
  await assert.rejects(
    harness.provider.setLegalHold(harness.authority, true),
    hasMediaCode("not_found")
  );
  assert.equal(
    harness.auditEvents.filter((event) => event.action === "media.legal_hold_changed").length,
    2
  );
  assertNoPrivateFields(harness.auditEvents);
});

test("CP14 lifecycle accepts governed reason codes and rejects caller free text", async () => {
  const harness = createHarness();
  await completeUpload(harness);
  await harness.provider.inspectQuarantinedMedia(harness.authority);

  await assert.rejects(
    harness.provider.deleteMedia({
      authority: harness.authority,
      reasonCode: "patient Jane Doe requested deletion" as never
    }),
    hasMediaCode("invalid_request")
  );
  assert.doesNotMatch(
    JSON.stringify({ audits: harness.auditEvents, intents: harness.persistence.intents }),
    /Jane Doe/u
  );
});

test("CP14 legal hold cannot race claimed delete or purge effects", async (t) => {
  await t.test("delete claim", async () => {
    const harness = createHarness();
    await completeUpload(harness);
    await harness.provider.inspectQuarantinedMedia(harness.authority);
    const gate = deferred<void>();
    harness.objects.ensureDeleteMarkerGate = gate.promise;

    const deleting = harness.provider.deleteMedia({
      authority: harness.authority,
      reasonCode: "retention_policy"
    });
    await waitForState(harness, "delete_in_progress");
    await assert.rejects(
      harness.provider.setLegalHold(harness.authority, true),
      hasMediaCode("concurrent_change")
    );
    assert.equal((await harness.persistence.get(scope(harness.authority)))?.legalHold, false);
    gate.resolve();
    assert.equal((await deleting).state, "deleted");
  });

  await t.test("purge claim and distinct retry-safe child effects", async () => {
    const harness = createHarness({ restoreWindowSeconds: 60 });
    await completeUpload(harness);
    await harness.provider.inspectQuarantinedMedia(harness.authority);
    await harness.provider.deleteMedia({
      authority: harness.authority,
      reasonCode: "retention_policy"
    });
    harness.clock.now = new Date("2026-07-10T10:02:00.000Z");
    const gate = deferred<void>();
    harness.objects.deleteObjectVersionGate = gate.promise;

    const purging = harness.provider.purgeExpiredDeletedMedia(harness.authority);
    await waitForState(harness, "purge_in_progress");
    await assert.rejects(
      harness.provider.setLegalHold(harness.authority, true),
      hasMediaCode("concurrent_change")
    );
    gate.resolve();
    assert.equal((await purging).state, "purged");

    const requests = harness.objects.deletedVersionRequests;
    assert.equal(requests.length, 2);
    assert.notEqual(requests[0]?.operationId, requests[1]?.operationId);
    assert.match(requests[0]?.operationId ?? "", /^pmef_[a-f0-9]{64}$/u);
    assert.match(requests[1]?.operationId ?? "", /^pmef_[a-f0-9]{64}$/u);
    for (const request of requests) await harness.objects.deleteObjectVersion(request);
    assert.equal(harness.objects.deletedVersions.length, 2);
    await assert.rejects(
      harness.objects.deleteObjectVersion({
        ...requests[0]!,
        versionId: requests[1]!.versionId
      }),
      /effect target conflict/u
    );
  });
});

test("CP14 signer cannot return expired or broadened URL authority", async () => {
  const harness = createHarness({ signerExpiry: "2026-07-10T09:59:59.000Z" });
  await assert.rejects(reserve(harness), (error: unknown) => {
    assert.ok(error instanceof PrivateMediaError);
    assert.equal(error.code, "provider_error");
    assert.equal(error.retryable, false);
    assert.equal(error.message, "Media signer returned an invalid expiry.");
    return true;
  });

  const wrongMethod = createHarness({ signerMethod: "GET" });
  await assert.rejects(reserve(wrongMethod), hasMediaCode("provider_error"));
});

test("CP14 signed capability endpoints reject malicious HTTPS destinations for PUT and GET", async (t) => {
  assert.throws(
    () => createHarness({ presignedEndpointAllowlist: ["https://attacker.example"] }),
    hasMediaCode("invalid_request")
  );
  assert.throws(
    () =>
      createHarness({
        presignedEndpointAllowlist: ["https://private-media-bucket.s3-accelerate.amazonaws.com"]
      }),
    hasMediaCode("invalid_request")
  );
  for (const [name, url] of [
    ["unapproved host", "https://attacker.example/collect"],
    ["userinfo", "https://attacker@private-media-bucket.s3.ap-south-1.amazonaws.com/collect"],
    ["fragment", "https://private-media-bucket.s3.ap-south-1.amazonaws.com/collect#leak"],
    ["port", "https://private-media-bucket.s3.ap-south-1.amazonaws.com:8443/collect"],
    [
      "wrong object path",
      "https://private-media-bucket.s3.ap-south-1.amazonaws.com/other-object?X-Amz-Signature=redacted"
    ]
  ] as const) {
    await t.test(`PUT ${name}`, async () => {
      const harness = createHarness({ signerPutUrl: url });
      await assert.rejects(reserve(harness), hasMediaCode("provider_error"));
      assert.equal(harness.auditEvents.at(-1)?.action, "media.upload_signing_failed");
      assert.equal(harness.auditEvents.at(-1)?.metadata.failureClass, "invalid_signer_response");
    });
  }

  await t.test("GET unapproved host", async () => {
    const harness = createHarness({ signerGetUrl: "https://attacker.example/collect" });
    await completeUpload(harness);
    await harness.provider.inspectQuarantinedMedia(harness.authority);
    await assert.rejects(
      harness.provider.createSignedReadAccess(harness.authority, "2026-07-10T10:04:00.000Z"),
      hasMediaCode("provider_error")
    );
    assert.equal(harness.auditEvents.at(-1)?.action, "media.access_signing_failed");
    assert.equal(harness.auditEvents.at(-1)?.metadata.failureClass, "invalid_signer_response");
  });
});

test("CP14 signer transport failures append classified redacted audit/outbox evidence", async () => {
  const uploadTransportError = secretBearingSignerError("PUT");
  const uploadHarness = createHarness({ signerPutFailure: uploadTransportError });
  await assert.rejects(reserve(uploadHarness), isSanitizedSignerTransportError);
  const uploadFailure = uploadHarness.auditEvents.at(-1);
  assert.equal(uploadFailure?.action, "media.upload_signing_failed");
  assert.deepEqual(uploadFailure?.metadata, {
    failureClass: "signer_transport_failure",
    method: "PUT"
  });
  assertNoPrivateFields(uploadHarness.auditEvents);
  assertNoPrivateFields(uploadHarness.persistence.intents);

  const accessTransportError = secretBearingSignerError("GET");
  const accessHarness = createHarness({ signerGetFailure: accessTransportError });
  await completeUpload(accessHarness);
  await accessHarness.provider.inspectQuarantinedMedia(accessHarness.authority);
  await assert.rejects(
    accessHarness.provider.createSignedReadAccess(
      accessHarness.authority,
      "2026-07-10T10:04:00.000Z"
    ),
    isSanitizedSignerTransportError
  );
  const accessFailure = accessHarness.auditEvents.at(-1);
  assert.equal(accessFailure?.action, "media.access_signing_failed");
  assert.deepEqual(accessFailure?.metadata, {
    failureClass: "signer_transport_failure",
    method: "GET"
  });
  assertNoPrivateFields(accessHarness.auditEvents);
  assertNoPrivateFields(accessHarness.persistence.intents);
  assert.match(uploadTransportError.message, /SECRET_SIGNED_CAPABILITY/u);
  assert.match(accessTransportError.message, /SECRET_SIGNED_CAPABILITY/u);
});

test("CP14 signer headers are exact and reject metadata, tag, or authorization injection", async (t) => {
  for (const [name, headers] of [
    ["metadata", { "x-amz-meta-attacker": "injected" }],
    ["extra tag", { "x-amz-tagging-extra": "unsafe=true" }],
    ["tag value", { "x-amz-tagging": "clinicos_state=quarantine&attacker=true" }],
    ["authorization", { authorization: "Bearer unsafe" }]
  ] as const) {
    await t.test(`PUT ${name} header`, async () => {
      const harness = createHarness({ signerExtraPutHeaders: headers });
      await assert.rejects(reserve(harness), hasMediaCode("provider_error"));
    });
  }

  await t.test("GET authorization header", async () => {
    const harness = createHarness({
      signerExtraGetHeaders: { authorization: "Bearer unsafe" }
    });
    await completeUpload(harness);
    await harness.provider.inspectQuarantinedMedia(harness.authority);
    await assert.rejects(
      harness.provider.createSignedReadAccess(harness.authority, "2026-07-10T10:04:00.000Z"),
      hasMediaCode("provider_error")
    );
    assert.equal(
      harness.auditEvents.some((event) => event.action === "media.access_signed"),
      false
    );
    assert.equal(
      harness.auditEvents.some((event) => event.action === "media.access_signing_requested"),
      true
    );
  });
});

interface HarnessOptions {
  readonly scannerVerdict?: "clean" | "malicious" | "suspicious" | "error";
  readonly validEvidenceSignature?: boolean;
  readonly evidenceConflict?: boolean;
  readonly scannerFailures?: number;
  readonly restoreWindowSeconds?: number;
  readonly signerExpiry?: string;
  readonly signerMethod?: "PUT" | "GET";
  readonly signerExtraPutHeaders?: Readonly<Record<string, string>>;
  readonly signerExtraGetHeaders?: Readonly<Record<string, string>>;
  readonly signerPutUrl?: string;
  readonly signerGetUrl?: string;
  readonly signerPutFailure?: unknown;
  readonly signerGetFailure?: unknown;
  readonly presignedEndpointAllowlist?: readonly string[];
  readonly evidenceMutator?: (evidence: SignedMalwareEvidence) => unknown;
  readonly scanCommitFailure?: PersistenceFailurePoint;
  readonly scannerFactory?: (clock: {
    now: Date;
  }) => MalwareScannerTransport & { readonly calls: number };
}

interface Harness {
  authority: PrivateMediaAuthority;
  readonly provider: S3PrivateMediaProvider;
  readonly persistence: TestAtomicPersistence;
  readonly objects: TestObjectTransport;
  readonly signer: TestSigner;
  readonly scanner: MalwareScannerTransport & { readonly calls: number };
  readonly clock: { now: Date };
  readonly auditEvents: PrivateMediaAuditEvent[];
}

function createHarness(options: HarnessOptions = {}): Harness {
  const clock = { now: new Date("2026-07-10T10:00:00.000Z") };
  const persistence = new TestAtomicPersistence(options.evidenceConflict ?? false);
  const objects = new TestObjectTransport();
  const signer = new TestSigner({
    forcedExpiry: options.signerExpiry,
    forcedPutMethod: options.signerMethod,
    extraPutHeaders: options.signerExtraPutHeaders,
    extraGetHeaders: options.signerExtraGetHeaders,
    putUrl: options.signerPutUrl,
    getUrl: options.signerGetUrl,
    putFailure: options.signerPutFailure,
    getFailure: options.signerGetFailure
  });
  const scanner =
    options.scannerFactory?.(clock) ??
    new TestScanner(
      clock,
      options.scannerVerdict ?? "clean",
      options.scannerFailures ?? 0,
      () => {
        if (options.scanCommitFailure) {
          persistence.failNext = options.scanCommitFailure;
        }
      },
      options.evidenceMutator
    );
  let id = 0;
  const provider = new S3PrivateMediaProvider(
    {
      environment: "staging",
      bucket: "private-media-bucket",
      region: "ap-south-1",
      kmsKeyId: "kms-media-key-1",
      bindingSecret: "0123456789abcdef0123456789abcdef",
      presignedEndpointAllowlist: options.presignedEndpointAllowlist ?? [
        "https://private-media-bucket.s3.ap-south-1.amazonaws.com"
      ],
      scannerSigningKeyIds: ["kms-signing-key-1"],
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
      persistence,
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
    persistence,
    objects,
    signer,
    scanner,
    clock,
    auditEvents: persistence.auditEvents
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
  const record = mustRecord(await harness.persistence.get(scope(harness.authority)));
  harness.objects.upload(record, jpeg);
  return harness.provider.verifyUploadCompletion(harness.authority);
}

type PersistenceFailurePoint = "audit" | "evidence" | "persistence";

interface CommittedTestOperation {
  readonly operation: PrivateMediaAtomicOperation;
  readonly writeFingerprintSha256: string;
  readonly outcome: "applied" | "evidence_conflict";
}

class TestAtomicPersistence implements PrivateMediaAtomicPersistence {
  readonly records = new Map<string, PrivateMediaRecord>();
  readonly evidenceValues = new Map<string, string>();
  readonly evidenceRecords = new Map<
    string,
    Parameters<PrivateMediaAtomicPersistence["commitScanResult"]>[0]["evidence"]
  >();
  readonly auditEvents: PrivateMediaAuditEvent[] = [];
  readonly intents: PrivateMediaReconciliationIntent[] = [];
  readonly operations = new Map<string, CommittedTestOperation>();
  readonly forceEvidenceConflict: boolean;
  failNext: PersistenceFailurePoint | null = null;
  failAlways: PersistenceFailurePoint | null = null;

  constructor(forceEvidenceConflict: boolean) {
    this.forceEvidenceConflict = forceEvidenceConflict;
  }

  async reserve(input: { record: PrivateMediaRecord; operation: PrivateMediaAtomicOperation }) {
    const fingerprint = privateMediaPersistenceWriteFingerprint({
      kind: "reserve",
      operation: input.operation,
      scope: input.record.scope,
      expectedRevision: null,
      expectedStates: [],
      next: input.record
    });
    const replay = this.replayResult(
      input.operation,
      fingerprint,
      input.record.scope,
      null,
      input.record.revision
    );
    if (replay === "operation_conflict") return replay;
    if (replay) return "replayed" as const;
    const key = stateKey(input.record.scope);
    const existing = this.records.get(key);
    if (existing) return "conflict" as const;
    this.maybeFail("audit");
    this.maybeFail("persistence");
    this.records.set(key, structuredClone(input.record));
    this.commitOperation(input.operation, fingerprint, "applied");
    return "applied" as const;
  }

  async get(scopeValue: PrivateMediaScope) {
    const record = this.records.get(stateKey(scopeValue));
    return record ? structuredClone(record) : null;
  }

  async transition(input: {
    scope: PrivateMediaScope;
    expectedRevision: number;
    expectedStates: readonly PrivateMediaRecord["state"][];
    next: PrivateMediaRecord;
    operation: PrivateMediaAtomicOperation;
  }) {
    if (!sameTestScope(input.next.scope, input.scope)) return "operation_conflict" as const;
    const fingerprint = privateMediaPersistenceWriteFingerprint({
      kind: "transition",
      operation: input.operation,
      scope: input.scope,
      expectedRevision: input.expectedRevision,
      expectedStates: input.expectedStates,
      next: input.next
    });
    const replay = this.replayResult(
      input.operation,
      fingerprint,
      input.scope,
      input.expectedRevision,
      input.next.revision
    );
    if (replay === "operation_conflict") return replay;
    if (replay) return "replayed" as const;
    const key = stateKey(input.scope);
    const current = this.records.get(key);
    if (
      !current ||
      current.revision !== input.expectedRevision ||
      !input.expectedStates.includes(current.state)
    ) {
      return "concurrent_change" as const;
    }
    this.maybeFail("audit");
    this.maybeFail("persistence");
    this.records.set(key, structuredClone(input.next));
    this.commitOperation(input.operation, fingerprint, "applied");
    return "applied" as const;
  }

  async commitScanResult(input: Parameters<PrivateMediaAtomicPersistence["commitScanResult"]>[0]) {
    if (
      !sameTestScope(input.success.next.scope, input.scope) ||
      !sameTestScope(input.evidenceConflict.next.scope, input.scope)
    ) {
      return "operation_conflict" as const;
    }
    const successFingerprint = privateMediaPersistenceWriteFingerprint({
      kind: "scan_success",
      operation: input.success.operation,
      scope: input.scope,
      expectedRevision: input.expectedRevision,
      expectedStates: input.expectedStates,
      next: input.success.next,
      evidence: input.evidence
    });
    const successReplay = this.replayResult(
      input.success.operation,
      successFingerprint,
      input.scope,
      input.expectedRevision,
      input.success.next.revision
    );
    if (successReplay === "operation_conflict") return successReplay;
    if (successReplay === "evidence_conflict") return "evidence_conflict" as const;
    if (successReplay) return "replayed" as const;
    const conflictFingerprint = privateMediaPersistenceWriteFingerprint({
      kind: "scan_conflict",
      operation: input.evidenceConflict.operation,
      scope: input.scope,
      expectedRevision: input.expectedRevision,
      expectedStates: input.expectedStates,
      next: input.evidenceConflict.next,
      evidence: input.evidence
    });
    if (
      !this.validOperation(
        input.evidenceConflict.operation,
        input.scope,
        input.expectedRevision,
        input.evidenceConflict.next.revision
      )
    ) {
      return "operation_conflict" as const;
    }
    const key = stateKey(input.scope);
    const current = this.records.get(key);
    if (
      !current ||
      current.revision !== input.expectedRevision ||
      !input.expectedStates.includes(current.state as "scan_in_progress")
    ) {
      return "concurrent_change" as const;
    }

    this.maybeFail("audit");
    this.maybeFail("evidence");
    this.maybeFail("persistence");
    const existingEvidence = this.evidenceValues.get(input.evidence.evidenceId);
    if (
      this.forceEvidenceConflict ||
      (existingEvidence !== undefined && existingEvidence !== input.evidence.evidenceDigestSha256)
    ) {
      this.records.set(key, structuredClone(input.evidenceConflict.next));
      this.commitOperation(
        input.evidenceConflict.operation,
        conflictFingerprint,
        "evidence_conflict"
      );
      this.operations.set(input.success.operation.operationId, {
        operation: structuredClone(input.success.operation),
        writeFingerprintSha256: successFingerprint,
        outcome: "evidence_conflict"
      });
      return "evidence_conflict" as const;
    }

    this.evidenceValues.set(input.evidence.evidenceId, input.evidence.evidenceDigestSha256);
    this.evidenceRecords.set(input.evidence.evidenceId, structuredClone(input.evidence));
    this.records.set(key, structuredClone(input.success.next));
    this.commitOperation(input.success.operation, successFingerprint, "applied");
    return existingEvidence ? ("replayed" as const) : ("applied" as const);
  }

  async recordAuditAndIntent(operation: PrivateMediaAtomicOperation) {
    const fingerprint = privateMediaPersistenceWriteFingerprint({
      kind: "audit",
      operation,
      scope: operation.reconciliationIntent.scope,
      expectedRevision: null,
      expectedStates: []
    });
    const replay = this.replayResult(
      operation,
      fingerprint,
      operation.reconciliationIntent.scope,
      null,
      null
    );
    if (replay === "operation_conflict") return replay;
    if (replay) return "replayed" as const;
    this.maybeFail("audit");
    this.maybeFail("persistence");
    this.commitOperation(operation, fingerprint, "applied");
    return "applied" as const;
  }

  private commitOperation(
    operation: PrivateMediaAtomicOperation,
    writeFingerprintSha256: string,
    outcome: "applied" | "evidence_conflict"
  ): void {
    this.auditEvents.push(structuredClone(operation.audit));
    this.intents.push(structuredClone(operation.reconciliationIntent));
    this.operations.set(operation.operationId, {
      operation: structuredClone(operation),
      writeFingerprintSha256,
      outcome
    });
  }

  private replayResult(
    operation: PrivateMediaAtomicOperation,
    writeFingerprintSha256: string,
    scopeValue: PrivateMediaScope,
    expectedRevision: number | null,
    targetRevision: number | null
  ): "applied" | "evidence_conflict" | "operation_conflict" | null {
    if (!this.validOperation(operation, scopeValue, expectedRevision, targetRevision)) {
      return "operation_conflict";
    }
    const prior = this.operations.get(operation.operationId);
    if (!prior) return null;
    return prior.operation.semanticFingerprintSha256 === operation.semanticFingerprintSha256 &&
      prior.writeFingerprintSha256 === writeFingerprintSha256
      ? prior.outcome
      : "operation_conflict";
  }

  private validOperation(
    operation: PrivateMediaAtomicOperation,
    scopeValue: PrivateMediaScope,
    expectedRevision: number | null,
    targetRevision: number | null
  ): boolean {
    try {
      const { semanticFingerprintSha256: _fingerprint, ...semanticOperation } = operation;
      return (
        operation.semanticFingerprintSha256 ===
          privateMediaOperationSemanticFingerprint(semanticOperation) &&
        operation.reconciliationIntent.operationId === operation.operationId &&
        operation.reconciliationIntent.intentId ===
          `pmri_${sha256(`${operation.operationId}\u001fintent`)}` &&
        operation.audit.eventId === `pmae_${sha256(`${operation.operationId}\u001faudit`)}` &&
        sameTestScope(operation.reconciliationIntent.scope, scopeValue) &&
        operation.audit.tenantId === scopeValue.tenantId &&
        operation.audit.clinicId === scopeValue.clinicId &&
        operation.audit.mediaId === scopeValue.mediaId &&
        operation.audit.uploadId === scopeValue.uploadId &&
        operation.reconciliationIntent.expectedRevision === expectedRevision &&
        operation.reconciliationIntent.targetRevision === targetRevision
      );
    } catch {
      return false;
    }
  }

  private maybeFail(point: PersistenceFailurePoint): void {
    if (this.failAlways === point || this.failNext === point) {
      if (this.failNext === point) this.failNext = null;
      throw new Error(`injected atomic ${point} failure`);
    }
  }
}

class TestObjectTransport implements S3PrivateObjectTransport {
  snapshot: S3ObjectSnapshot | null = null;
  body = new Uint8Array();
  deleteMarker: string | null = null;
  readonly deletedVersions: string[] = [];
  readonly deletedVersionRequests: Array<
    Parameters<S3PrivateObjectTransport["deleteObjectVersion"]>[0]
  > = [];
  readonly effectTargets = new Map<string, string>();
  readonly versions = new Map<string, S3ObjectSnapshot>();
  readonly versionBodies = new Map<string, Uint8Array>();
  ensureDeleteMarkerGate: Promise<void> | null = null;
  deleteObjectVersionGate: Promise<void> | null = null;

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
    this.versions.set(this.snapshot.versionId, structuredClone(this.snapshot));
    this.versionBodies.set(this.snapshot.versionId, Uint8Array.from(bytes));
    return this.snapshot;
  }

  overwriteLatest(record: PrivateMediaRecord, bytes: Uint8Array): S3ObjectSnapshot {
    this.body = Uint8Array.from(bytes);
    this.snapshot = {
      contentLength: bytes.byteLength,
      contentType: record.declaredMimeType,
      checksumSha256Hex: sha256(bytes),
      versionId: "version-2",
      etag: "etag-2",
      lastModifiedAt: "2026-07-10T10:00:02.000Z",
      serverSideEncryption: "aws:kms",
      kmsKeyId: "kms-media-key-1",
      metadata: { "clinicos-binding": record.binding },
      tags: { clinicos_state: "quarantine" },
      multipartStatus: "none"
    };
    this.versions.set(this.snapshot.versionId, structuredClone(this.snapshot));
    this.versionBodies.set(this.snapshot.versionId, Uint8Array.from(bytes));
    return this.snapshot;
  }

  async headObject() {
    return this.deleteMarker ? null : this.snapshot;
  }

  async headObjectVersion(input: Parameters<S3PrivateObjectTransport["headObjectVersion"]>[0]) {
    return structuredClone(this.versions.get(input.versionId) ?? null);
  }

  async readObjectRange(input: Parameters<S3PrivateObjectTransport["readObjectRange"]>[0]) {
    const versionBody = this.versionBodies.get(input.versionId) ?? this.body;
    return versionBody.slice(input.start, input.endInclusive + 1);
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
    this.versions.set(this.snapshot.versionId, structuredClone(this.snapshot));
    this.versionBodies.set(this.snapshot.versionId, Uint8Array.from(input.body));
    return this.snapshot;
  }

  async ensureDeleteMarker(input: Parameters<S3PrivateObjectTransport["ensureDeleteMarker"]>[0]) {
    if (this.ensureDeleteMarkerGate) await this.ensureDeleteMarkerGate;
    this.recordEffect(input.operationId, `delete-marker:${input.locator.key}`);
    this.deleteMarker = "delete-marker-1";
    return { deleteMarkerVersionId: this.deleteMarker, deletedAt: "2026-07-10T10:00:00.000Z" };
  }

  async removeDeleteMarker(input: Parameters<S3PrivateObjectTransport["removeDeleteMarker"]>[0]) {
    this.recordEffect(
      input.operationId,
      `restore-marker:${input.locator.key}:${input.deleteMarkerVersionId}`
    );
    assert.equal(input.deleteMarkerVersionId, this.deleteMarker);
    this.deleteMarker = null;
  }

  async deleteObjectVersion(input: Parameters<S3PrivateObjectTransport["deleteObjectVersion"]>[0]) {
    if (this.deleteObjectVersionGate) await this.deleteObjectVersionGate;
    const firstApplication = this.recordEffect(
      input.operationId,
      `purge-version:${input.locator.key}:${input.versionId}`
    );
    if (!firstApplication) return;
    this.deletedVersionRequests.push(structuredClone(input));
    this.deletedVersions.push(input.versionId);
    this.versions.delete(input.versionId);
    this.versionBodies.delete(input.versionId);
    if (input.versionId === this.snapshot?.versionId) this.snapshot = null;
    if (input.versionId === this.deleteMarker) this.deleteMarker = null;
  }

  private recordEffect(operationId: string, immutableTarget: string): boolean {
    const priorTarget = this.effectTargets.get(operationId);
    if (priorTarget && priorTarget !== immutableTarget) {
      throw new Error("operation effect target conflict");
    }
    if (priorTarget) return false;
    this.effectTargets.set(operationId, immutableTarget);
    return true;
  }
}

class TestSigner implements S3PresigningTransport {
  lastGet: { versionId: string } | null = null;
  readonly forcedExpiry?: string;
  readonly forcedPutMethod?: "PUT" | "GET";
  readonly extraPutHeaders: Readonly<Record<string, string>>;
  readonly extraGetHeaders: Readonly<Record<string, string>>;
  readonly putUrl?: string;
  readonly getUrl?: string;
  readonly putFailure?: unknown;
  readonly getFailure?: unknown;

  constructor(
    options: Readonly<{
      forcedExpiry?: string;
      forcedPutMethod?: "PUT" | "GET";
      extraPutHeaders?: Readonly<Record<string, string>>;
      extraGetHeaders?: Readonly<Record<string, string>>;
      putUrl?: string;
      getUrl?: string;
      putFailure?: unknown;
      getFailure?: unknown;
    }> = {}
  ) {
    this.forcedExpiry = options.forcedExpiry;
    this.forcedPutMethod = options.forcedPutMethod;
    this.extraPutHeaders = options.extraPutHeaders ?? {};
    this.extraGetHeaders = options.extraGetHeaders ?? {};
    this.putUrl = options.putUrl;
    this.getUrl = options.getUrl;
    this.putFailure = options.putFailure;
    this.getFailure = options.getFailure;
  }

  async signPutObject(input: Parameters<S3PresigningTransport["signPutObject"]>[0]) {
    if (this.putFailure !== undefined) throw this.putFailure;
    return {
      method: this.forcedPutMethod ?? "PUT",
      url: this.putUrl ?? testSignedObjectUrl(input.locator),
      expiresAt: this.forcedExpiry ?? input.expiresAt,
      requiredHeaders: {
        "content-type": input.contentType,
        "content-length": String(input.contentLength),
        "x-amz-checksum-sha256": input.checksumSha256Base64,
        "x-amz-meta-clinicos-binding": input.metadata["clinicos-binding"] ?? "",
        "x-amz-tagging": "clinicos_state=quarantine",
        ...this.extraPutHeaders
      }
    } as const;
  }

  async signGetObject(input: Parameters<S3PresigningTransport["signGetObject"]>[0]) {
    if (this.getFailure !== undefined) throw this.getFailure;
    this.lastGet = { versionId: input.versionId };
    return {
      method: "GET" as const,
      url: this.getUrl ?? testSignedObjectUrl(input.locator, input.versionId),
      expiresAt: input.expiresAt,
      requiredHeaders: { ...this.extraGetHeaders }
    };
  }
}

class TestScanner implements MalwareScannerTransport {
  calls = 0;
  readonly clock: { now: Date };
  readonly verdict: "clean" | "malicious" | "suspicious" | "error";
  readonly failures: number;
  readonly beforeReturn: () => void;
  readonly evidenceMutator: (evidence: SignedMalwareEvidence) => unknown;

  constructor(
    clock: { now: Date },
    verdict: "clean" | "malicious" | "suspicious" | "error",
    failures: number,
    beforeReturn: () => void = () => undefined,
    evidenceMutator: (evidence: SignedMalwareEvidence) => unknown = (evidence) => evidence
  ) {
    this.clock = clock;
    this.verdict = verdict;
    this.failures = failures;
    this.beforeReturn = beforeReturn;
    this.evidenceMutator = evidenceMutator;
  }

  async scan(
    input: Parameters<MalwareScannerTransport["scan"]>[0]
  ): Promise<SignedMalwareEvidence> {
    this.calls += 1;
    if (this.calls <= this.failures) throw new Error("scanner timeout");
    this.beforeReturn();
    return this.evidenceMutator(
      signedEvidence(input, this.clock.now, this.verdict, `evidence-${this.calls}`)
    ) as SignedMalwareEvidence;
  }
}

class ControlledScanner implements MalwareScannerTransport {
  calls = 0;
  readonly clock: { now: Date };
  readonly pending: Array<{
    input: Parameters<MalwareScannerTransport["scan"]>[0];
    resolve: (evidence: SignedMalwareEvidence) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(clock: { now: Date }) {
    this.clock = clock;
  }

  async scan(
    input: Parameters<MalwareScannerTransport["scan"]>[0]
  ): Promise<SignedMalwareEvidence> {
    this.calls += 1;
    return new Promise<SignedMalwareEvidence>((resolve, reject) => {
      this.pending.push({ input, resolve, reject });
    });
  }

  resolveCall(index: number, verdict: "clean" | "malicious" | "suspicious" | "error"): void {
    const pending = this.pending[index];
    assert.ok(pending);
    pending.resolve(
      signedEvidence(pending.input, this.clock.now, verdict, `evidence-race-${index + 1}`)
    );
  }

  rejectCall(index: number): void {
    const pending = this.pending[index];
    assert.ok(pending);
    pending.reject(new Error(`scanner failure ${index + 1}`));
  }
}

function signedEvidence(
  input: Parameters<MalwareScannerTransport["scan"]>[0],
  scannedAt: Date,
  verdict: "clean" | "malicious" | "suspicious" | "error",
  evidenceId: string
): SignedMalwareEvidence {
  return {
    payload: {
      evidenceId,
      tenantId: input.authority.tenantId,
      clinicId: input.authority.clinicId,
      mediaId: input.authority.mediaId,
      uploadId: input.authority.uploadId,
      scanOperationId: input.operationId,
      objectIdentitySha256: input.objectIdentitySha256,
      objectVersionId: input.objectVersionId,
      contentSha256Hex: input.contentSha256Hex,
      contentLength: input.contentLength,
      detectedMimeType: input.detectedMimeType,
      verdict,
      scanner: "scanner-1",
      engineVersion: "engine-1",
      definitionsVersion: "definitions-1",
      scannedAt: scannedAt.toISOString()
    },
    signature: {
      keyId: "kms-signing-key-1",
      algorithm: "RSASSA_PSS_SHA_256",
      valueBase64: Buffer.alloc(64, 7).toString("base64")
    }
  };
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

function testSignedObjectUrl(locator: S3ObjectLocator, versionId?: string): string {
  const path = locator.key
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const version = versionId ? `&versionId=${encodeURIComponent(versionId)}` : "";
  return `https://${locator.bucket}.s3.${locator.region}.amazonaws.com/${path}?X-Amz-Signature=redacted${version}`;
}

function sameTestScope(left: PrivateMediaScope, right: PrivateMediaScope): boolean {
  return stateKey(left) === stateKey(right);
}

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function mustRecord(record: PrivateMediaRecord | null): PrivateMediaRecord {
  assert.ok(record);
  return record;
}

function committedOperationByAction(
  persistence: TestAtomicPersistence,
  action: PrivateMediaAuditEvent["action"]
): PrivateMediaAtomicOperation {
  const committed = [...persistence.operations.values()].find(
    (entry) => entry.operation.audit.action === action
  );
  assert.ok(committed, `missing committed operation for ${action}`);
  return structuredClone(committed.operation);
}

function recomputeOperationFingerprint(
  operation: PrivateMediaAtomicOperation
): PrivateMediaAtomicOperation {
  const { semanticFingerprintSha256: _fingerprint, ...semanticOperation } = operation;
  return {
    ...semanticOperation,
    semanticFingerprintSha256: privateMediaOperationSemanticFingerprint(semanticOperation)
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function waitForState(
  harness: Harness,
  expected: PrivateMediaRecord["state"]
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const record = await harness.persistence.get(scope(harness.authority));
    if (record?.state === expected) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`media did not reach ${expected}`);
}

async function outcome<T>(
  promise: Promise<T>
): Promise<{ value: T | null; errorCode: string | null }> {
  try {
    return { value: await promise, errorCode: null };
  } catch (error) {
    return {
      value: null,
      errorCode: error instanceof PrivateMediaError ? error.code : "unexpected_error"
    };
  }
}

async function waitForScannerCalls(scanner: ControlledScanner, expected: number): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (scanner.calls >= expected) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assert.fail(`scanner did not receive ${expected} calls`);
}

function hasMediaCode(code: string) {
  return (error: unknown) => error instanceof PrivateMediaError && error.code === code;
}

function secretBearingSignerError(method: "PUT" | "GET"): Error {
  return Object.assign(
    new Error(
      `${method} SECRET_SIGNED_CAPABILITY https://secret.example/private?signature=do-not-log`
    ),
    {
      url: "https://secret.example/private?signature=do-not-log",
      headers: { authorization: "SECRET_AUTHORIZATION_HEADER" },
      request: { method, rawProviderMessage: "SECRET_RAW_PROVIDER_MESSAGE" }
    }
  );
}

function isSanitizedSignerTransportError(error: unknown): boolean {
  assert.ok(error instanceof PrivateMediaError);
  assert.equal(error.code, "provider_error");
  assert.equal(error.retryable, true);
  assert.equal(error.message, "The private media signing service is temporarily unavailable.");
  assert.equal("cause" in error, false);
  const exposed = [String(error), error.stack ?? "", JSON.stringify(error)].join("\n");
  assert.doesNotMatch(
    exposed,
    /SECRET_|secret\.example|signature=do-not-log|authorization|rawProviderMessage/iu
  );
  return true;
}

function assertNoPrivateFields(value: unknown): void {
  const serialized = JSON.stringify(value);
  assert.doesNotMatch(
    serialized,
    /"(?:bucket|key|objectKey|objectVersionId|deleteMarkerVersionId|kmsKeyId|providerToken|signedUrl)"/iu
  );
}
