import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachLiveMedia,
  applyFixtureAddFinding,
  applyFixtureAttachMedia,
  applyFixtureUpdateFinding,
  applyFixtureViewMedia,
  classifyCp4EndpointFailures,
  createFixtureCp4WorkflowData,
  getFindingsForTooth,
  getMediaForContext,
  requestLiveMediaView
} from "@/lib/cp4-workflow";

describe("CP4 dental chart and media workflow", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("adds tooth findings with chart snapshots, timeline events, and provenance history", () => {
    const data = createFixtureCp4WorkflowData("2026-07-07");
    const next = applyFixtureAddFinding(data, {
      actorName: "doctor fixture user",
      actorRole: "doctor",
      encounterId: "cp4SyntheticEncounter",
      note: "Synthetic caries finding for workflow test.",
      patientId: "cp4SyntheticPatient",
      severity: "high",
      status: "active",
      surfaces: ["occlusal", "mesial"],
      toothNumber: "36",
      type: "caries"
    });

    const toothFindings = getFindingsForTooth(next, "cp4SyntheticPatient", "36");
    const createdFinding = toothFindings.find((finding) => finding.type === "caries");

    expect(createdFinding).toMatchObject({
      authorRole: "doctor",
      reviewState: "reviewed",
      severity: "high",
      type: "caries"
    });
    expect(createdFinding?.history[0]).toMatchObject({
      actorName: "doctor fixture user",
      kind: "created"
    });
    expect(next.chartHistory[0]).toMatchObject({ title: "Finding added" });
    expect(next.timeline.some((item) => item.kind === "dental_finding.created")).toBe(true);
    expect(next.timeline.some((item) => item.kind === "dental_chart.snapshot_created")).toBe(true);
  });

  it("updates finding status without dropping the prior finding history", () => {
    const data = applyFixtureAddFinding(createFixtureCp4WorkflowData("2026-07-07"), {
      actorName: "assistant fixture user",
      actorRole: "assistant",
      encounterId: "cp4SyntheticEncounter",
      note: "Synthetic assistant-entered finding.",
      patientId: "cp4SyntheticPatient",
      severity: "moderate",
      status: "watch",
      surfaces: ["buccal"],
      toothNumber: "46",
      type: "restoration"
    });
    const finding = data.findings[0]!;
    const next = applyFixtureUpdateFinding(data, {
      actorName: "doctor fixture user",
      actorRole: "doctor",
      findingId: finding.id,
      note: "Reviewed by doctor in synthetic fixture.",
      status: "reviewed"
    });
    const updated = next.findings.find((item) => item.id === finding.id)!;

    expect(updated.status).toBe("reviewed");
    expect(updated.reviewState).toBe("reviewed");
    expect(updated.history.map((item) => item.kind)).toEqual(["reviewed", "created"]);
    expect(next.timeline.some((item) => item.kind === "dental_finding.updated")).toBe(true);
  });

  it("attaches and views media through mediated signed access without exposing object keys", () => {
    const data = applyFixtureAddFinding(createFixtureCp4WorkflowData("2026-07-07"), {
      actorName: "doctor fixture user",
      actorRole: "doctor",
      encounterId: "cp4SyntheticEncounter",
      note: "Synthetic media target finding.",
      patientId: "cp4SyntheticPatient",
      severity: "moderate",
      status: "active",
      surfaces: ["occlusal"],
      toothNumber: "36",
      type: "crown"
    });
    const finding = data.findings[0]!;
    const linked = applyFixtureAttachMedia(data, {
      actorName: "assistant fixture user",
      actorRole: "assistant",
      encounterId: "cp4SyntheticEncounter",
      externalReference: "Synthetic X-ray import reference XR-CP4",
      findingId: finding.id,
      kind: "xray",
      patientId: "cp4SyntheticPatient",
      tag: "xray",
      target: "finding",
      toothNumber: "36"
    });
    const media = getMediaForContext(linked, "cp4SyntheticPatient", "36", finding.id).find(
      (asset) => asset.referenceLabel === "Synthetic X-ray import reference XR-CP4"
    )!;
    const viewed = applyFixtureViewMedia(linked, {
      actorName: "doctor fixture user",
      mediaId: media.id
    });
    const viewedMedia = viewed.mediaAssets.find((asset) => asset.id === media.id)!;

    expect(media.context).toMatchObject({ findingId: finding.id, target: "finding" });
    expect(viewedMedia.signedAccess).toMatchObject({ state: "issued" });
    expect(viewed.timeline.some((item) => item.kind === "media.viewed")).toBe(true);
    expect(JSON.stringify(viewed).toLowerCase()).not.toContain("objectkey");
    expect(JSON.stringify(viewed).toLowerCase()).not.toContain("bucket");
  });

  it("classifies missing CP4 endpoint registration before runtime debugging", () => {
    expect(
      classifyCp4EndpointFailures([
        {
          endpoint: "HTTP /v1/clinical-workflows/cp4",
          message: "Not found",
          status: 404
        }
      ])
    ).toMatchObject({
      code: "CP4_ENDPOINT_NOT_REGISTERED",
      message: "One or more CP4 workflow endpoints are not registered in this environment."
    });
  });

  it("uses the durable live media upload and signed access route contract", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url.endsWith("/v1/media/upload-urls")) {
        return jsonResponse({
          upload: {
            id: "40000000-0000-4000-8000-000000009001",
            patientId: "40000000-0000-4000-8000-000000002001"
          },
          uploadTarget: {
            requiredHeaders: {
              "x-clinic-os-upload-id": "40000000-0000-4000-8000-000000009001"
            },
            uploadUrl:
              "/v1/media/uploads/40000000-0000-4000-8000-000000009001/content"
          }
        });
      }

      if (url.endsWith("/v1/media/uploads/40000000-0000-4000-8000-000000009001/content")) {
        expect(init?.method).toBe("PUT");
        expect(init?.headers).toMatchObject({
          "Content-Type": "image/jpeg",
          "x-clinic-os-upload-id": "40000000-0000-4000-8000-000000009001"
        });
        return new Response(null, { status: 200 });
      }

      if (url.endsWith("/v1/media/uploads/40000000-0000-4000-8000-000000009001/complete")) {
        return jsonResponse({
          mediaAsset: {
            id: "40000000-0000-4000-8000-000000008001",
            patientId: "40000000-0000-4000-8000-000000002001",
            scanStatus: "clean"
          }
        });
      }

      if (url.endsWith("/v1/media/assets/40000000-0000-4000-8000-000000008001/signed-url")) {
        return jsonResponse({
          access: {
            expiresAt: "2026-07-07T09:05:00.000Z",
            method: "GET",
            signedUrl: "/media-access/synthetic-token"
          }
        });
      }

      throw new Error(`Unexpected fetch URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await attachLiveMedia({
      actorName: "assistant fixture user",
      actorRole: "assistant",
      encounterId: "40000000-0000-4000-8000-000000003001",
      externalReference: "Synthetic bitewing import reference",
      file: new File(["synthetic-bitewing"], "bitewing.jpg", { type: "image/jpeg" }),
      findingId: "40000000-0000-4000-8000-000000006001",
      kind: "xray",
      patientId: "40000000-0000-4000-8000-000000002001",
      tag: "xray",
      target: "finding",
      toothNumber: "36"
    });
    await requestLiveMediaView({
      actorName: "doctor fixture user",
      mediaId: "40000000-0000-4000-8000-000000008001"
    });

    const reserveBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(reserveBody).toMatchObject({
      dentalFindingId: "40000000-0000-4000-8000-000000006001",
      encounterId: "40000000-0000-4000-8000-000000003001",
      fileSizeBytes: 18,
      mediaType: "xray",
      mimeType: "image/jpeg",
      originalFilename: "bitewing.jpg",
      patientId: "40000000-0000-4000-8000-000000002001",
      tags: ["xray"],
      toothNumber: "36"
    });
    expect(reserveBody.sha256Digest).toMatch(/^[a-f0-9]{64}$/);

    const completeBody = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string);
    expect(completeBody).toMatchObject({
      contentLength: 18,
      encounterId: "40000000-0000-4000-8000-000000003001",
      mimeType: "image/jpeg",
      patientId: "40000000-0000-4000-8000-000000002001",
      scanStatus: "clean"
    });

    const signedBody = JSON.parse(fetchMock.mock.calls[3]?.[1]?.body as string);
    expect(signedBody).toMatchObject({ expiresInSeconds: 300, purpose: "clinical_review" });
    expect(fetchMock.mock.calls.map((call) => call[0].toString())).toEqual([
      "http://localhost/v1/media/upload-urls",
      "http://localhost/v1/media/uploads/40000000-0000-4000-8000-000000009001/content",
      "http://localhost/v1/media/uploads/40000000-0000-4000-8000-000000009001/complete",
      "http://localhost/v1/media/assets/40000000-0000-4000-8000-000000008001/signed-url"
    ]);
  });

  it("keeps live external imaging links deferred as a whole workflow", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      attachLiveMedia({
        actorName: "assistant fixture user",
        actorRole: "assistant",
        encounterId: "40000000-0000-4000-8000-000000003001",
        externalReference: "External X-ray software accession XR-900",
        kind: "external_link",
        patientId: "40000000-0000-4000-8000-000000002001",
        tag: "xray",
        target: "encounter",
        toothNumber: "36"
      })
    ).rejects.toThrow(/deferred/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json"
    },
    status: 200
  });
}
