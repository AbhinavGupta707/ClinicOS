import { describe, expect, it } from "vitest";

import {
  applyFixtureAddFinding,
  applyFixtureAttachMedia,
  applyFixtureUpdateFinding,
  applyFixtureViewMedia,
  classifyCp4EndpointFailures,
  createFixtureCp4WorkflowData,
  getFindingsForTooth,
  getMediaForContext
} from "@/lib/cp4-workflow";

describe("CP4 dental chart and media workflow", () => {
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
});
