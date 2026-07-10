import assert from "node:assert/strict";
import test from "node:test";
import { PendingLocalClinicalMediaInspectionSimulator } from "../src/media-inspection.ts";

test("CP13 local media inspection evidence remains pending and never invents a clean scan", async () => {
  const result = await new PendingLocalClinicalMediaInspectionSimulator().inspect({
    reservation: {
      id: "10000000-0000-4000-8000-000000000001",
      tenantId: "10000000-0000-4000-8000-000000000002",
      clinicId: "10000000-0000-4000-8000-000000000003",
      patientId: "10000000-0000-4000-8000-000000000004",
      encounterId: null,
      toothNumber: null,
      dentalFindingId: null,
      mediaType: "intraoral_photo",
      originalFilename: "clinical-media-10000000-0000-4000-8000-000000000001.jpg",
      mimeType: "image/jpeg",
      expectedFileSizeBytes: 9,
      expectedSha256Digest: "a".repeat(64),
      objectKey: "private-test-object",
      storageProvider: "local_simulator",
      storageRegion: "ap-south-1",
      status: "reserved",
      expiresAt: "2026-07-10T15:00:00.000Z",
      createdByUserId: "10000000-0000-4000-8000-000000000005",
      createdAt: "2026-07-10T14:00:00.000Z",
      completedAt: null,
      mediaAssetId: null,
      tags: [],
      provenance: { synthetic: true }
    },
    object: {
      objectKey: "private-test-object",
      contentLength: 9,
      mimeType: "image/jpeg",
      sha256Digest: "a".repeat(64),
      metadata: {},
      storedAt: "2026-07-10T14:01:00.000Z"
    },
    now: new Date("2026-07-10T14:02:00.000Z")
  });

  assert.deepEqual(result, {
    scanStatus: "pending",
    quarantineReason: null,
    objectVersion: `sha256:${"a".repeat(64)}`,
    dicomMetadata: {}
  });
});
