import assert from "node:assert/strict";
import test from "node:test";
import { ClinicOsApiClient, type PublicMediaAsset } from "../src/lib/apiClient.ts";
import { StaticPhotoCaptureProvider } from "../src/features/capture/adapters/photoCaptureProvider.ts";
import { evaluateAudioControl } from "../src/features/capture/audioConsent.ts";
import { InMemorySecureCaptureCache, sanitizeError } from "../src/features/capture/secureCache.ts";
import { MobileUploadQueue } from "../src/features/capture/uploadQueue.ts";
import type { CapturedPhoto, PatientCaptureContext } from "../src/features/capture/types.ts";

const patientId = "10000000-0000-4000-8000-000000002001";
const encounterId = "10000000-0000-4000-8000-000000004001";
const uploadId = "40000000-0000-4000-8000-000000009001";
const mediaAssetId = "40000000-0000-4000-8000-000000008001";

test("audio controls stay disabled without complete AI/audio consent and retention readiness", () => {
  assert.equal(evaluateAudioControl({ patientId: null, enforcementState: null }).enabled, false);

  const missing = evaluateAudioControl({
    patientId,
    enforcementState: {
      aiAudioCaptureAllowed: false,
      rawAudioRetentionAllowed: false,
      activePurposes: [],
      revokedPurposes: []
    }
  });
  assert.equal(missing.enabled, false);
  assert.equal(missing.reason, "consent_missing");

  const revoked = evaluateAudioControl({
    patientId,
    enforcementState: {
      aiAudioCaptureAllowed: false,
      rawAudioRetentionAllowed: false,
      activePurposes: [],
      revokedPurposes: ["ai_audio_capture"]
    }
  });
  assert.equal(revoked.enabled, false);
  assert.equal(revoked.reason, "consent_revoked");

  const noRetention = evaluateAudioControl({
    patientId,
    enforcementState: {
      aiAudioCaptureAllowed: true,
      rawAudioRetentionAllowed: false,
      activePurposes: ["ai_audio_capture"],
      revokedPurposes: []
    }
  });
  assert.equal(noRetention.enabled, false);
  assert.equal(noRetention.reason, "retention_not_configured");

  const ready = evaluateAudioControl({
    patientId,
    enforcementState: {
      aiAudioCaptureAllowed: true,
      rawAudioRetentionAllowed: true,
      activePurposes: ["ai_audio_capture", "raw_audio_retention"],
      revokedPurposes: []
    }
  });
  assert.equal(ready.enabled, true);
});

test("photo upload queue uses durable CP4 media route contract and does not persist raw bytes in snapshots", async () => {
  const calls: string[] = [];
  const mediaAsset: PublicMediaAsset = {
    id: mediaAssetId,
    patientId,
    encounterId,
    mediaType: "intraoral_photo",
    originalFilename: "chairside.jpg",
    mimeType: "image/jpeg",
    fileSizeBytes: 4,
    sha256Digest: null,
    status: "scan_pending",
    scanStatus: "pending",
    tags: ["mobile-capture"],
    provenance: {},
    createdAt: "2026-07-07T09:00:00.000Z",
    uploadedAt: "2026-07-07T09:00:01.000Z"
  };
  const api = {
    async reserveMediaUpload(input: { patientId: string; encounterId: string | null; provenance: Record<string, unknown> }) {
      calls.push("POST /v1/media/upload-urls");
      assert.equal(input.patientId, patientId);
      assert.equal(input.encounterId, encounterId);
      assert.equal(input.provenance.captureSurface, "expo_mobile");
      return {
        upload: {
          id: uploadId,
          patientId,
          encounterId,
          mediaType: "intraoral_photo",
          originalFilename: "chairside.jpg",
          mimeType: "image/jpeg",
          expectedFileSizeBytes: 4,
          expectedSha256Digest: null,
          status: "reserved",
          expiresAt: "2026-07-07T09:10:00.000Z",
          tags: [],
          provenance: {}
        },
        uploadTarget: {
          method: "PUT" as const,
          url: "http://localhost/v1/media/uploads/40000000-0000-4000-8000-000000009001/content",
          headers: {},
          expiresAt: "2026-07-07T09:10:00.000Z"
        }
      };
    },
    async uploadMediaContent(receivedUploadId: string, bytes: Uint8Array, mimeType: string) {
      calls.push(`PUT /v1/media/uploads/${receivedUploadId}/content`);
      assert.equal(receivedUploadId, uploadId);
      assert.equal(bytes.byteLength, 4);
      assert.equal(mimeType, "image/jpeg");
    },
    async completeMediaUpload(input: { uploadId: string; scanStatus?: string }) {
      calls.push(`POST /v1/media/uploads/${input.uploadId}/complete`);
      assert.equal(input.scanStatus, "pending");
      return mediaAsset;
    }
  };
  const cache = new InMemorySecureCaptureCache();
  const queue = new MobileUploadQueue({
    api,
    cache,
    idFactory: () => "local-upload-1",
    now: () => "2026-07-07T09:00:00.000Z"
  });
  const context: PatientCaptureContext = {
    patientId,
    patientLabel: "Synthetic patient",
    encounterId,
    encounterLabel: "Active encounter"
  };
  const photo: CapturedPhoto = {
    kind: "photo",
    bytes: new Uint8Array([1, 2, 3, 4]),
    mimeType: "image/jpeg",
    originalFilename: "Rhea Synthetic chairside.jpg",
    capturedAt: "2026-07-07T09:00:00.000Z",
    deviceLocalId: "device-photo-1"
  };
  const provider = new StaticPhotoCaptureProvider(photo);

  const captured = await provider.capturePhoto(context);
  await queue.enqueuePhoto(context, captured);
  const queuedSnapshot = await cache.snapshot();
  assert.equal(queuedSnapshot[0]?.originalFilename, "chairside-capture.jpg");
  assert.equal(JSON.stringify(queuedSnapshot).includes("Rhea Synthetic"), false);
  assert.equal(JSON.stringify(queuedSnapshot).includes("bytes"), false);

  const processed = await queue.processNext();
  assert.equal(processed?.status, "completed");
  assert.equal(processed?.mediaAsset?.id, mediaAssetId);
  assert.deepEqual(calls, [
    "POST /v1/media/upload-urls",
    `PUT /v1/media/uploads/${uploadId}/content`,
    `POST /v1/media/uploads/${uploadId}/complete`
  ]);
  assert.equal(await cache.getPhoto("local-upload-1"), null);
});

test("api client rejects private media storage references in upload responses", async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        upload: {
          id: uploadId,
          patientId,
          encounterId: null,
          mediaType: "intraoral_photo",
          originalFilename: "chairside.jpg",
          mimeType: "image/jpeg",
          expectedFileSizeBytes: 4,
          expectedSha256Digest: null,
          objectKey: "local/tenants/private/patients/private/media/file.jpg",
          status: "reserved",
          expiresAt: "2026-07-07T09:10:00.000Z",
          tags: [],
          provenance: {}
        },
        uploadTarget: {
          method: "PUT",
          url: "http://localhost/upload",
          headers: {},
          expiresAt: "2026-07-07T09:10:00.000Z"
        }
      }),
      { status: 201, headers: { "Content-Type": "application/json" } }
    );
  const client = new ClinicOsApiClient({ baseUrl: "http://localhost", fetchImpl });

  await assert.rejects(
    () =>
      client.reserveMediaUpload({
        patientId,
        encounterId: null,
        mediaType: "intraoral_photo",
        originalFilename: "chairside.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 4,
        sha256Digest: null,
        tags: [],
        provenance: {}
      }),
    /private storage reference/i
  );
});

test("secure cache error sanitization redacts PHI and private storage path fragments", () => {
  const sanitized = sanitizeError(
    "Upload failed for rhea.synthetic@example.test at +91 98765 43210 using objectKey local/tenants/t1/patients/p1/media/private.jpg"
  );
  assert.doesNotMatch(sanitized, /rhea\.synthetic|98765|objectKey|tenants\/|patients\/p1\/media/);
});
