import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import {
  classifyClinicalCapabilityFailure,
  createLatestClinicalDentalWorkspaceLoader,
  loadClinicalDentalWorkspace,
  requestClinicalMediaAccess,
  uploadClinicalMedia,
  type ClinicalDentalGeneratedClient
} from "../features/cp13/clinical-dental/loaders";

const PATIENT_ID = "10000000-0000-4000-8000-000000002001";
const ENCOUNTER_ID = "10000000-0000-4000-8000-000000003001";
const UPLOAD_ID = "10000000-0000-4000-8000-000000004001";
const MEDIA_ID = "10000000-0000-4000-8000-000000005001";

describe("CP13 clinical/dental generated-client loaders", () => {
  it("loads consent, encounter, dental, and media through exact generated method calls", async () => {
    const client = clientDouble();
    const data = await loadClinicalDentalWorkspace(client, {
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      mediaLimit: 25
    });
    expect(data.patientId).toBe(PATIENT_ID);
    expect(data.encounter?.encounter.status).toBe("drafting");
    expect(client.listPatientConsents).toHaveBeenCalledWith({ path: { patientId: PATIENT_ID } });
    expect(client.getEncounter).toHaveBeenCalledWith({ path: { encounterId: ENCOUNTER_ID } });
    expect(client.getPatientDentalChart).toHaveBeenCalledWith({ path: { patientId: PATIENT_ID } });
    expect(client.listPatientMediaAssets).toHaveBeenCalledWith({
      path: { patientId: PATIENT_ID },
      query: { limit: 25 }
    });
  });

  it("uses the generated reserve/content/complete sequence with digest and independent keys", async () => {
    const client = clientDouble();
    const bytes = new TextEncoder().encode("synthetic-media-content");
    const expectedDigest = createHash("sha256").update(bytes).digest("hex");
    const result = await uploadClinicalMedia(client, {
      patientId: PATIENT_ID,
      encounterId: ENCOUNTER_ID,
      mediaType: "intraoral_photo",
      originalFilename: "synthetic-patient-name.jpg",
      mimeType: "image/jpeg",
      bytes,
      idempotencyKey: "cp13-web-media"
    });
    expect(result.scanStatus).toBe("clean");
    expect(client.requestMediaUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: { "idempotency-key": "cp13-web-media:reserve" },
        body: expect.objectContaining({
          sha256Digest: expectedDigest,
          originalFilename: "clinical-upload.jpg"
        })
      })
    );
    expect(client.receiveMediaUploadContent).toHaveBeenCalledWith({
      path: { uploadId: UPLOAD_ID },
      headers: { "idempotency-key": "cp13-web-media:content" },
      body: bytes
    });
    expect(client.completeMediaUpload).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { uploadId: UPLOAD_ID },
        headers: { "idempotency-key": "cp13-web-media:complete" },
        body: expect.objectContaining({ sha256Digest: expectedDigest })
      })
    );
  });

  it("discards a deferred stale patient load when a newer patient load completes first", async () => {
    const patientA = "10000000-0000-4000-8000-000000002011";
    const patientB = "10000000-0000-4000-8000-000000002012";
    const encounterA = "10000000-0000-4000-8000-000000003011";
    const encounterB = "10000000-0000-4000-8000-000000003012";
    const consentA = deferred<{
      consents: readonly Record<string, string>[];
      enforcementState: Record<string, boolean>;
    }>();
    const consentB = deferred<{
      consents: readonly Record<string, string>[];
      enforcementState: Record<string, boolean>;
    }>();
    const base = clientDouble();
    const client: ClinicalDentalGeneratedClient = {
      ...base,
      listPatientConsents: vi.fn(({ path }) =>
        path.patientId === patientA ? consentA.promise : consentB.promise
      ),
      getEncounter: vi.fn(async ({ path }) => ({
        encounter: { id: path.encounterId, rowVersion: 1, status: "drafting" },
        noteVersions: []
      }))
    };
    const loader = createLatestClinicalDentalWorkspaceLoader(client);

    const loadA = loader.load({ patientId: patientA, encounterId: encounterA });
    const loadB = loader.load({ patientId: patientB, encounterId: encounterB });
    consentB.resolve({
      consents: [{ id: "consent-b", status: "active" }],
      enforcementState: { treatmentAllowed: true }
    });
    await expect(loadB).resolves.toMatchObject({
      status: "applied",
      data: { patientId: patientB, encounter: { encounter: { id: encounterB } } }
    });

    consentA.resolve({
      consents: [{ id: "consent-a", status: "active" }],
      enforcementState: { treatmentAllowed: true }
    });
    await expect(loadA).resolves.toEqual({ status: "stale" });
  });

  it("requests mediated access without exposing storage keys and classifies provider absence honestly", async () => {
    const client = clientDouble();
    const access = await requestClinicalMediaAccess(client, {
      mediaAssetId: MEDIA_ID,
      idempotencyKey: "cp13-web-access"
    });
    expect(access.signedUrl).toBe("https://media.test/access/opaque");
    expect(JSON.stringify(access.response)).not.toContain("objectKey");

    const unavailable = Object.assign(new Error("Media provider is not configured."), {
      code: "CONFIGURATION_ERROR",
      requestId: "request-unavailable"
    });
    expect(classifyClinicalCapabilityFailure(unavailable)).toEqual({
      kind: "unavailable",
      message: "Media provider is not configured.",
      requestId: "request-unavailable"
    });
  });

  it("keeps component loading and provider-unavailable copy truthful with no fixture path", async () => {
    const source = await readFile(
      new URL("../features/cp13/clinical-dental/ClinicalDentalWorkspace.tsx", import.meta.url),
      "utf8"
    );
    expect(source).toContain("Loading clinical record");
    expect(source).toContain("Upload availability is verified when the request starts");
    expect(source).toContain("Clinical workspace unavailable");
    expect(source).not.toContain("USE_CP13");
    expect(source).not.toContain("fixtureData");
  });
});

function clientDouble(): ClinicalDentalGeneratedClient {
  return {
    listPatientConsents: vi.fn(async () => ({
      consents: [{ id: "consent-1", status: "active", purpose: "treatment_registration" }],
      enforcementState: { treatmentAllowed: true }
    })),
    getEncounter: vi.fn(async () => ({
      encounter: { id: ENCOUNTER_ID, rowVersion: 2, status: "drafting" },
      noteVersions: []
    })),
    getPatientDentalChart: vi.fn(async () => ({
      dentalChart: { id: "chart-1", numberingSystem: "FDI" },
      findings: [],
      history: [],
      snapshots: []
    })),
    listPatientMediaAssets: vi.fn(async () => ({ mediaAssets: [] })),
    requestMediaUploadUrl: vi.fn(async () => ({
      upload: { id: UPLOAD_ID },
      uploadTarget: { method: "PUT", uploadUrl: `/v1/media/uploads/${UPLOAD_ID}/content` }
    })),
    receiveMediaUploadContent: vi.fn(async () => ({
      upload: { id: UPLOAD_ID },
      object: { contentLength: 23 }
    })),
    completeMediaUpload: vi.fn(async () => ({
      mediaAsset: { id: MEDIA_ID, scanStatus: "clean" }
    })),
    createSignedMediaAccess: vi.fn(async () => ({
      mediaAsset: { id: MEDIA_ID, scanStatus: "clean" },
      access: {
        signedUrl: "https://media.test/access/opaque",
        expiresAt: "2032-02-03T04:10:06.000Z"
      }
    }))
  } satisfies ClinicalDentalGeneratedClient;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
