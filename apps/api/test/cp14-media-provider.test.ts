import assert from "node:assert/strict";
import test from "node:test";
import type { MediaUploadReservationRecord, UUID } from "@clinic-os/domain";
import {
  PrivateMediaLifecycleService,
  RoutedMediaAuthorityFactory,
  S3ClinicalMediaProvider,
  ServiceMediaAuthorityFactory
} from "../src/providers/media/index.ts";
import type {
  PrivateMediaGateway,
  PrivateMediaGatewayAuthority,
  PrivateMediaGatewayScope
} from "../src/providers/media/ports.ts";

const ids = {
  tenantId: "10000000-0000-4000-8000-000000000001" as UUID,
  clinicId: "10000000-0000-4000-8000-000000000002" as UUID,
  patientId: "10000000-0000-4000-8000-000000000003" as UUID,
  uploadId: "10000000-0000-4000-8000-000000000004" as UUID,
  actorId: "10000000-0000-4000-8000-000000000005" as UUID
};

test("CP14 API adapter maps the typed S3 gateway without exposing provider internals", async () => {
  const gateway = new TestGateway();
  const provider = new S3ClinicalMediaProvider({
    gateway,
    region: "ap-south-1",
    authorityFactory: routedAuthorityFactory()
  });
  const key = provider.buildObjectKey({
    tenantId: ids.tenantId,
    clinicId: ids.clinicId,
    patientId: ids.patientId,
    uploadId: ids.uploadId,
    originalFilename: "patient-name.jpg"
  });
  assert.equal(
    key,
    `staging/tenants/${ids.tenantId}/clinics/${ids.clinicId}/media/${ids.uploadId}/${ids.uploadId}/opaque`
  );
  assert.doesNotMatch(key, /patient-name/iu);

  const upload = await provider.createUploadTarget({
    uploadId: ids.uploadId,
    tenantId: ids.tenantId,
    clinicId: ids.clinicId,
    patientId: ids.patientId,
    objectKey: key,
    mimeType: "image/jpeg",
    mediaType: "xray",
    expectedFileSizeBytes: 123,
    expectedSha256Digest: "a".repeat(64),
    expiresAt: "2026-07-10T10:05:00.000Z"
  });
  assert.equal(upload.method, "PUT");
  assert.equal(upload.maxBytes, 123);
  assert.equal(gateway.reservation?.kind, "xray");
  assert.equal(gateway.reservation?.authority.tenantId, ids.tenantId);
  assert.equal(gateway.reservation?.authority.clinicId, ids.clinicId);
  assert.equal(gateway.reservation?.authority.mediaId, ids.uploadId);
  assert.doesNotMatch(
    JSON.stringify({ ...upload, uploadUrl: "[signed-url-redacted]" }),
    /bucket|objectKey|versionId|providerToken/iu
  );

  const stored = await provider.statObject(key);
  assert.equal(stored?.contentLength, 123);
  assert.equal(stored?.sha256Digest, "a".repeat(64));
  assert.equal(gateway.verified, 1);

  const inspection = await provider.inspect({
    reservation: reservation(key),
    object: stored!,
    now: new Date("2026-07-10T10:02:00.000Z")
  });
  assert.equal(inspection.scanStatus, "clean");
  assert.equal(inspection.objectVersion, "version-private-1");
  assert.equal(inspection.quarantineReason, null);

  const access = await provider.createSignedReadAccess({
    objectKey: key,
    mimeType: "image/jpeg",
    expiresAt: "2026-07-10T10:04:00.000Z"
  });
  assert.deepEqual(access, {
    method: "GET",
    signedUrl: "https://access.example.test/opaque",
    expiresAt: "2026-07-10T10:04:00.000Z",
    headers: {}
  });
});

test("CP14 API adapter fails closed on missing digest, cross-scope key, and proxied metadata tamper", async () => {
  const gateway = new TestGateway();
  assert.throws(
    () =>
      new S3ClinicalMediaProvider({
        gateway,
        region: "ap-south-1",
        authorityFactory: undefined as never
      }),
    /explicit request authority factory/u
  );
  assert.throws(
    () =>
      new S3ClinicalMediaProvider({
        gateway,
        region: "ap-south-1",
        authorityFactory: new ServiceMediaAuthorityFactory(
          ids.actorId,
          () => "background-correlation"
        ) as never
      }),
    /explicit request authority factory/u
  );
  const provider = new S3ClinicalMediaProvider({
    gateway,
    region: "ap-south-1",
    authorityFactory: routedAuthorityFactory()
  });
  const key = gateway.allocateInternalObjectKey({
    tenantId: ids.tenantId,
    clinicId: ids.clinicId,
    mediaId: ids.uploadId,
    uploadId: ids.uploadId
  });

  await assert.rejects(
    provider.createUploadTarget({
      uploadId: ids.uploadId,
      tenantId: ids.tenantId,
      clinicId: ids.clinicId,
      patientId: ids.patientId,
      objectKey: key,
      mimeType: "image/jpeg",
      expectedFileSizeBytes: 123,
      expectedSha256Digest: null,
      expiresAt: "2026-07-10T10:05:00.000Z"
    }),
    /SHA-256/u
  );

  const otherClinic = "10000000-0000-4000-8000-000000000099" as UUID;
  await assert.rejects(
    provider.createUploadTarget({
      uploadId: ids.uploadId,
      tenantId: ids.tenantId,
      clinicId: otherClinic,
      patientId: ids.patientId,
      objectKey: key,
      mimeType: "image/jpeg",
      expectedFileSizeBytes: 123,
      expectedSha256Digest: "a".repeat(64),
      expiresAt: "2026-07-10T10:05:00.000Z"
    }),
    /scope/u
  );

  await assert.rejects(
    provider.receiveUpload({
      objectKey: key,
      body: Buffer.alloc(123),
      mimeType: "image/jpeg",
      metadata: { tenant_id: ids.tenantId, clinic_id: otherClinic, upload_id: ids.uploadId }
    }),
    /metadata/u
  );
});

test("CP14 routed authority requires a real actor and correlation id", () => {
  const scope: PrivateMediaGatewayScope = {
    tenantId: ids.tenantId,
    clinicId: ids.clinicId,
    mediaId: ids.uploadId,
    uploadId: ids.uploadId
  };

  assert.throws(
    () =>
      new RoutedMediaAuthorityFactory(() => ({ actorId: "", correlationId: "trace" })).forScope(
        scope
      ),
    /actor and correlation attribution/u
  );
  assert.throws(
    () =>
      new RoutedMediaAuthorityFactory(() => ({
        actorId: ids.actorId,
        correlationId: ""
      })).forScope(scope),
    /actor and correlation attribution/u
  );
});

test("CP14 API lifecycle service preserves opaque deletion and restore receipts", async () => {
  const gateway = new TestGateway();
  const service = new PrivateMediaLifecycleService(gateway);
  const authority: PrivateMediaGatewayAuthority = {
    tenantId: ids.tenantId,
    clinicId: ids.clinicId,
    mediaId: ids.uploadId,
    uploadId: ids.uploadId,
    actorId: ids.actorId,
    correlationId: "correlation-lifecycle"
  };

  const deleted = await service.delete({ authority, reason: "retention disposition" });
  const restored = await service.restore({ authority, reason: "approved restore" });
  await service.setLegalHold(authority, true);
  const purged = await service.purgeExpired(authority);

  assert.equal(deleted.state, "deleted");
  assert.equal(restored.state, "quarantined");
  assert.equal(purged.state, "purged");
  assert.equal(gateway.legalHold, true);
  assert.doesNotMatch(
    JSON.stringify({ deleted, restored, purged }),
    /bucket|objectKey|path|version|providerToken/iu
  );
});

class TestGateway implements PrivateMediaGateway {
  reservation: Parameters<PrivateMediaGateway["reserveUpload"]>[0] | null = null;
  verified = 0;
  legalHold = false;

  allocateInternalObjectKey(scope: PrivateMediaGatewayScope): string {
    return `staging/tenants/${scope.tenantId}/clinics/${scope.clinicId}/media/${scope.mediaId}/${scope.uploadId}/opaque`;
  }

  scopeFromInternalObjectKey(key: string): PrivateMediaGatewayScope {
    const segments = key.split("/");
    if (segments.length !== 9) throw new Error("invalid private media key");
    return {
      tenantId: segments[2] ?? "",
      clinicId: segments[4] ?? "",
      mediaId: segments[6] ?? "",
      uploadId: segments[7] ?? ""
    };
  }

  async reserveUpload(input: Parameters<PrivateMediaGateway["reserveUpload"]>[0]) {
    this.reservation = input;
    return {
      mediaId: input.authority.mediaId,
      uploadId: input.authority.uploadId,
      state: "reserved" as const,
      expiresAt: input.expiresAt,
      upload: {
        method: "PUT" as const,
        url: "https://upload.example.test/opaque",
        expiresAt: input.expiresAt,
        requiredHeaders: {
          "content-type": input.declaredMimeType,
          "content-length": String(input.expectedBytes),
          "x-amz-meta-clinicos-binding": "opaque-binding"
        },
        maxBytes: input.expectedBytes
      }
    };
  }

  async ingestProxiedUpload() {
    return {};
  }

  async verifyUploadCompletion() {
    this.verified += 1;
    return {};
  }

  async inspectQuarantinedMedia(authority: PrivateMediaGatewayAuthority) {
    return {
      mediaId: authority.mediaId,
      uploadId: authority.uploadId,
      state: "available" as const,
      scanStatus: "clean" as const,
      evidenceId: "evidence-1",
      scannedAt: "2026-07-10T10:02:00.000Z"
    };
  }

  async createSignedReadAccess(_authority: PrivateMediaGatewayAuthority, expiresAt: string) {
    return {
      method: "GET" as const,
      url: "https://access.example.test/opaque",
      expiresAt,
      requiredHeaders: {}
    };
  }

  async internalSnapshot(authority: PrivateMediaGatewayAuthority) {
    return {
      objectKey: this.allocateInternalObjectKey(authority),
      contentLength: 123,
      mimeType: "image/jpeg",
      sha256Digest: "a".repeat(64),
      objectVersionId: "version-private-1",
      storedAt: "2026-07-10T10:01:00.000Z"
    };
  }

  async deleteMedia(input: Parameters<PrivateMediaGateway["deleteMedia"]>[0]) {
    return {
      mediaId: input.authority.mediaId,
      uploadId: input.authority.uploadId,
      state: "deleted" as const,
      occurredAt: "2026-07-10T10:03:00.000Z",
      recoverableUntil: "2026-08-09T10:03:00.000Z"
    };
  }

  async restoreMedia(input: Parameters<PrivateMediaGateway["restoreMedia"]>[0]) {
    return {
      mediaId: input.authority.mediaId,
      uploadId: input.authority.uploadId,
      state: "quarantined" as const,
      occurredAt: "2026-07-10T10:04:00.000Z",
      recoverableUntil: null
    };
  }

  async purgeExpiredDeletedMedia(authority: PrivateMediaGatewayAuthority) {
    return {
      mediaId: authority.mediaId,
      uploadId: authority.uploadId,
      state: "purged" as const,
      occurredAt: "2026-08-09T10:04:00.000Z",
      recoverableUntil: null
    };
  }

  async setLegalHold(_authority: PrivateMediaGatewayAuthority, legalHold: boolean) {
    this.legalHold = legalHold;
  }
}

function reservation(objectKey: string): MediaUploadReservationRecord {
  return {
    id: ids.uploadId,
    tenantId: ids.tenantId,
    clinicId: ids.clinicId,
    patientId: ids.patientId,
    encounterId: null,
    toothNumber: null,
    dentalFindingId: null,
    mediaType: "xray",
    originalFilename: `clinical-media-${ids.uploadId}.jpg`,
    mimeType: "image/jpeg",
    expectedFileSizeBytes: 123,
    expectedSha256Digest: "a".repeat(64),
    objectKey,
    storageProvider: "s3",
    storageRegion: "ap-south-1",
    status: "reserved",
    expiresAt: "2026-07-10T10:05:00.000Z",
    createdByUserId: ids.actorId,
    createdAt: "2026-07-10T10:00:00.000Z",
    completedAt: null,
    mediaAssetId: null,
    tags: [],
    provenance: {}
  };
}

function routedAuthorityFactory(): RoutedMediaAuthorityFactory {
  return new RoutedMediaAuthorityFactory(() => ({
    actorId: ids.actorId,
    correlationId: "correlation-1"
  }));
}
