import assert from "node:assert/strict";
import test from "node:test";
import { buildCp4SmokePlan } from "../../scripts/cp4-contract-smoke.mjs";
import {
  loadCp4Scenario,
  summarizeCp4Scenario,
  validateCp4Scenario
} from "../../scripts/validate-cp4-fixtures.mjs";

test("CP4 synthetic scenario is deterministic and local-test only", async () => {
  const scenario = await loadCp4Scenario();

  assert.equal(validateCp4Scenario(scenario), true);
  assert.deepEqual(summarizeCp4Scenario(scenario), {
    tenants: 2,
    clinics: 2,
    actors: 6,
    patients: 1,
    appointments: 1,
    encounters: 1,
    dentalFindings: 1,
    dentalChartSnapshots: 2,
    mediaAssets: 2,
    mediaAttachments: 4,
    imagingStudies: 1,
    dicomMetadataFixtures: 1,
    externalMediaLinks: 1,
    flowSteps: 12,
    roleTenantExpectations: 7
  });
});

test("CP4 scenario covers encounter to finding to media to timeline", async () => {
  const scenario = await loadCp4Scenario();
  const steps = new Set(scenario.flow.steps.map((step) => step.key));

  for (const stepKey of [
    "read-encounter-for-dental-chart",
    "create-tooth-finding-as-assistant",
    "review-update-finding-as-doctor",
    "create-chart-snapshot",
    "request-xray-upload-url",
    "complete-xray-upload",
    "import-dicom-metadata",
    "link-external-xray-reference",
    "attach-uploaded-xray-to-finding",
    "attach-dicom-import-to-tooth",
    "request-signed-media-view",
    "read-patient-timeline-after-media"
  ]) {
    assert.ok(steps.has(stepKey), `${stepKey} missing from CP4 flow`);
  }

  assert.equal(
    scenario.flow.name,
    "encounter -> dental finding -> media upload/import/link -> signed URL view -> timeline"
  );

  const finding = scenario.dentalFindings.find(
    (candidate) => candidate.key === "tooth16OcclusalCaries"
  );
  assert.equal(finding.toothNumber, "16");
  assert.deepEqual(finding.surfaces, ["occlusal"]);
  assert.equal(finding.reviewState, "reviewed");
});

test("CP4 scenario requires audit, timeline, and domain event evidence", async () => {
  const scenario = await loadCp4Scenario();
  const timelineRequiredSteps = [
    "create-tooth-finding-as-assistant",
    "review-update-finding-as-doctor",
    "create-chart-snapshot",
    "request-xray-upload-url",
    "complete-xray-upload",
    "import-dicom-metadata",
    "link-external-xray-reference",
    "attach-uploaded-xray-to-finding",
    "attach-dicom-import-to-tooth",
    "request-signed-media-view"
  ];

  for (const step of scenario.flow.steps) {
    assert.ok(step.expectedAudit.length > 0, `${step.key} must declare audit evidence`);
    for (const event of step.expectedAudit) {
      assert.ok(event.action, `${step.key} audit expectation needs action`);
      assert.ok(event.phiFields.length > 0, `${step.key} audit must name PHI fields`);
    }
  }

  for (const stepKey of timelineRequiredSteps) {
    const step = scenario.flow.steps.find((candidate) => candidate.key === stepKey);
    assert.ok(step.timelineExpectations.length > 0, `${stepKey} must declare timeline evidence`);
  }

  const allEvents = new Set(scenario.flow.steps.flatMap((step) => step.expectedEvents));
  for (const eventName of [
    "dental_finding.created",
    "dental_finding.updated",
    "dental_chart.snapshot_created",
    "media.created",
    "media.upload_completed",
    "imaging.dicom_metadata_imported",
    "external_media_link.created",
    "media.linked",
    "media.viewed"
  ]) {
    assert.ok(allEvents.has(eventName), `${eventName} missing from expected events`);
  }
});

test("CP4 media expectations use signed mediation without raw storage exposure", async () => {
  const scenario = await loadCp4Scenario();
  const plan = buildCp4SmokePlan(scenario);
  const forbiddenFields = scenario.responseAssertions.mediaPrivacy.publicResponsesMustNotExpose;

  assert.deepEqual(forbiddenFields, ["objectKey", "rawStoragePath", "bucket", "storagePath"]);
  assert.equal(scenario.responseAssertions.mediaPrivacy.signedAccessOnly, true);
  assert.equal(scenario.responseAssertions.mediaPrivacy.actualStoragePathFixturesIncluded, false);

  for (const asset of scenario.mediaAssets) {
    assert.equal(asset.privacy.objectKeyUserVisible, false);
    assert.equal(asset.privacy.rawStoragePathUserVisible, false);
    assert.notEqual(asset.privacy.access, "public");
  }

  const uploadStep = plan.flowRequests.find((step) => step.key === "request-xray-upload-url");
  assert.equal(uploadStep.path, "/v1/media/upload-urls");
  assert.deepEqual(uploadStep.expectedBodyIncludes, [
    "upload",
    "uploadTarget",
    "uploadUrl",
    "expiresAt"
  ]);
  assert.deepEqual(uploadStep.expectedBodyMustNotInclude, forbiddenFields);

  const signedViewStep = plan.flowRequests.find((step) => step.key === "request-signed-media-view");
  assert.equal(signedViewStep.path, "/v1/media/assets/{mediaAssetId}/signed-url");
  assert.deepEqual(signedViewStep.expectedBodyIncludes, [
    "mediaAsset",
    "access",
    "signedUrl",
    "expiresAt"
  ]);
  assert.deepEqual(signedViewStep.expectedBodyMustNotInclude, forbiddenFields);

  const publicExpectationText = JSON.stringify(
    plan.flowRequests.map((step) => step.expectedBodyIncludes ?? [])
  );
  for (const field of forbiddenFields) {
    assert.equal(publicExpectationText.includes(field), false);
  }
});

test("CP4 imaging coexistence preserves upload, import, link, and DICOM metadata", async () => {
  const scenario = await loadCp4Scenario();

  assert.deepEqual(scenario.responseAssertions.imagingCoexistence, {
    manualUploadSupported: true,
    metadataImportSupported: true,
    externalReferenceLinkSupported: true,
    dicomMetadataPreservedWhenAvailable: true,
    pacsReplacementRequired: false,
    dicomwebAdapterRequiredInCp4: false,
    unauthorizedExternalUiAutomationAllowed: false
  });

  const uploadModes = new Set(scenario.mediaAssets.map((asset) => asset.uploadMode));
  assert.ok(uploadModes.has("manual_upload"));
  assert.ok(uploadModes.has("metadata_import"));

  const dicom = scenario.dicomMetadataFixtures.find(
    (candidate) => candidate.key === "syntheticBitewingDicomMetadata"
  );
  assert.equal(dicom.pixelDataIncluded, false);
  assert.equal(dicom.modality, "DX");
  assert.equal(dicom.bodyPartExamined, "TEETH");
  assert.deepEqual(dicom.toothNumbers, ["16"]);

  const externalLink = scenario.externalMediaLinks.find(
    (candidate) => candidate.key === "externalXraySoftwareReference"
  );
  assert.equal(externalLink.provenance.coexistenceFirst, true);
  assert.equal(externalLink.provenance.doesNotReplaceExternalSoftware, true);
  assert.equal(externalLink.provenance.doesNotAutomateExternalUi, true);
});

test("CP4 scenario includes accountant and wrong-tenant media/chart denials", async () => {
  const scenario = await loadCp4Scenario();

  for (const expectation of [
    ["accountant-cannot-read-dental-chart", "missing_permission"],
    ["accountant-cannot-request-signed-media", "missing_permission"],
    ["wrong-tenant-assistant-cannot-read-dental-chart", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-request-signed-media", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-link-media", "tenant_mismatch"]
  ]) {
    const [key, expectedReason] = expectation;
    assert.ok(
      scenario.roleTenantExpectations.some(
        (candidate) =>
          candidate.key === key &&
          candidate.expected === "deny" &&
          candidate.expectedReason === expectedReason
      ),
      `${key} denial missing`
    );
  }

  assert.ok(
    scenario.roleTenantExpectations.some(
      (expectation) =>
        expectation.key === "doctor-can-read-dental-chart" && expectation.expected === "allow"
    )
  );
  assert.ok(
    scenario.roleTenantExpectations.some(
      (expectation) =>
        expectation.key === "assistant-can-link-media" && expectation.expected === "allow"
    )
  );
});

test("CP4 smoke plan can be built from documented contracts", async () => {
  const scenario = await loadCp4Scenario();
  const plan = buildCp4SmokePlan(scenario);

  assert.equal(plan.flowRequests.length, 10);
  assert.equal(plan.fixtureOnlyRequests.length, 4);
  assert.equal(plan.negativeRequests.length, 4);
  assert.equal(plan.postFlowVerification.length, 3);
  assert.deepEqual(
    plan.flowRequests.map((request) => `${request.method} ${request.path}`),
    [
      "GET /v1/encounters/40000000-0000-4000-8000-000000004001",
      "POST /v1/encounters/40000000-0000-4000-8000-000000004001/dental-findings",
      "PATCH /v1/dental-findings/40000000-0000-4000-8000-000000006001",
      "POST /v1/patients/40000000-0000-4000-8000-000000002001/dental-chart/snapshots",
      "POST /v1/media/upload-urls",
      "PUT {uploadUrl}",
      "POST /v1/media/uploads/{uploadId}/complete",
      "GET /v1/patients/40000000-0000-4000-8000-000000002001/media",
      "POST /v1/media/assets/{mediaAssetId}/signed-url",
      "GET /v1/patients/40000000-0000-4000-8000-000000002001/timeline"
    ]
  );
  assert.deepEqual(
    plan.fixtureOnlyRequests.map((request) => `${request.method} ${request.path}`),
    [
      "POST /v1/patients/40000000-0000-4000-8000-000000002001/imaging/dicom-metadata",
      "POST /v1/patients/40000000-0000-4000-8000-000000002001/external-media-links",
      "POST /v1/media-assets/40000000-0000-4000-8000-000000008001/links",
      "POST /v1/media-assets/40000000-0000-4000-8000-000000008002/links"
    ]
  );

  const livePlanText = JSON.stringify([
    plan.flowRequests,
    plan.negativeRequests,
    plan.postFlowVerification
  ]);
  assert.equal(/\/v1\/patients\/[^"]+\/media\/upload-url/.test(livePlanText), false);
  for (const staleRouteFragment of [
    "/complete-upload",
    "/signed-access",
    "/links",
    "/external-media-links",
    "/imaging/dicom-metadata"
  ]) {
    assert.equal(livePlanText.includes(staleRouteFragment), false);
  }

  assert.ok(
    plan.postFlowVerification.every((request) =>
      request.expectedBodyMustNotInclude.includes("objectKey")
    )
  );
});
