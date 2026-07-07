#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");

export const CP4_SCENARIO_PATH = path.join(
  REPO_ROOT,
  "fixtures",
  "synthetic",
  "cp4",
  "dental_chart_media_imaging_flow.json"
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
const TEST_EMAIL_PATTERN = /^[^@\s]+@example\.test$/;
const TEST_PHONE_PATTERN = /^\+91994000\d{4}$/;
const DICOM_UID_PATTERN = /^2\.25\.\d{30,}$/;
const STORAGE_PATH_PATTERNS = [
  /s3:\/\//i,
  /gs:\/\//i,
  /az:\/\//i,
  /file:\/\//i,
  /storage\.googleapis\.com/i,
  /amazonaws\.com/i,
  /blob\.core\.windows\.net/i,
  /raw[-_]?bucket/i
];
const REQUIRED_EVENTS = [
  "dental_finding.created",
  "dental_finding.updated",
  "dental_chart.snapshot_created",
  "media.created",
  "media.upload_completed",
  "imaging.dicom_metadata_imported",
  "external_media_link.created",
  "media.linked",
  "media.viewed"
];
const REQUIRED_STEPS = [
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
];

function assertUuid(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string UUID`);
  assert.match(value, UUID_PATTERN, `${label} must be a deterministic v4-style UUID`);
}

function assertIsoWithOffset(value, label) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.match(
    value,
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/,
    `${label} must include a timezone offset`
  );
}

function assertUniqueEntityId(ids, value, label) {
  assertUuid(value, label);
  assert.ok(!ids.has(value), `${label} duplicates entity id ${value}`);
  ids.add(value);
}

function assertKnownReference(ids, value, label) {
  assertUuid(value, label);
  assert.ok(ids.has(value), `${label} references unknown id ${value}`);
}

function assertKnownKey(keys, value, label) {
  assert.equal(typeof value, "string", `${label} must be a string key`);
  assert.ok(keys.has(value), `${label} references unknown key ${value}`);
}

function byKey(collection, key, label) {
  const match = collection.find((item) => item.key === key);
  assert.ok(match, `Unknown ${label} key: ${key}`);
  return match;
}

function normalizeStatusList(status) {
  return Array.isArray(status) ? status : [status];
}

function flattenEventNames(scenario) {
  const names = new Set();

  for (const step of scenario.flow.steps) {
    for (const eventName of step.expectedEvents ?? []) names.add(eventName);
  }

  return names;
}

function flattenTimelineEntries(scenario) {
  const entries = new Set();

  for (const patient of scenario.patients) {
    for (const entry of patient.timelineSeed ?? []) entries.add(entry.type);
  }

  for (const step of scenario.flow.steps) {
    for (const expectation of step.timelineExpectations ?? []) {
      entries.add(expectation.entryType);
    }
  }

  return entries;
}

function assertLocalSyntheticOnly(scenario) {
  assert.equal(scenario.fixtureUse.localOnly, true, "fixture must be marked local-only");
  assert.equal(scenario.fixtureUse.syntheticOnly, true, "fixture must be marked synthetic-only");
  assert.equal(
    scenario.fixtureUse.productionUseDenied,
    true,
    "fixture must explicitly deny production use"
  );
  assert.deepEqual(
    scenario.fixtureUse.allowedEnvironments,
    ["local", "development", "test", "ci"],
    "fixture environments must be constrained to local/dev/test/ci"
  );

  const serialized = JSON.stringify(scenario);
  const emails = serialized.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  for (const email of emails) {
    assert.match(email, TEST_EMAIL_PATTERN, `${email} must use .example.test`);
  }

  const forbiddenPatterns = [
    /@gmail\.com/i,
    /@yahoo\./i,
    /@hotmail\./i,
    /razorpay_live/i,
    /sk_live/i,
    /whatsapp_access_token/i,
    /abha[_-]?(address|number)/i,
    /aadhaar/i,
    /pan[_-]?card/i
  ];

  for (const pattern of forbiddenPatterns) {
    assert.equal(
      pattern.test(serialized),
      false,
      `fixture contains forbidden live-data pattern ${pattern}`
    );
  }

  for (const pattern of STORAGE_PATH_PATTERNS) {
    assert.equal(
      pattern.test(serialized),
      false,
      `fixture contains an actual storage path or provider URL matching ${pattern}`
    );
  }
}

function assertStoragePrivacyExpectations(scenario) {
  const forbiddenFields = scenario.responseAssertions.mediaPrivacy.publicResponsesMustNotExpose;
  assert.deepEqual(forbiddenFields, ["objectKey", "rawStoragePath", "bucket", "storagePath"]);
  assert.equal(scenario.responseAssertions.mediaPrivacy.signedAccessOnly, true);
  assert.equal(scenario.responseAssertions.mediaPrivacy.actualStoragePathFixturesIncluded, false);
  assert.equal(scenario.responseAssertions.mediaPrivacy.signedUrlTtlSecondsMax <= 900, true);

  for (const mediaAsset of scenario.mediaAssets) {
    assert.ok(mediaAsset.privacy, `mediaAsset ${mediaAsset.key} needs privacy contract`);
    assert.equal(
      mediaAsset.privacy.objectKeyUserVisible,
      false,
      `mediaAsset ${mediaAsset.key} must hide object keys`
    );
    assert.equal(
      mediaAsset.privacy.rawStoragePathUserVisible,
      false,
      `mediaAsset ${mediaAsset.key} must hide raw storage paths`
    );
    assert.notEqual(mediaAsset.privacy.access, "public", `mediaAsset ${mediaAsset.key} is public`);
    assert.equal(
      mediaAsset.privacy.signedUrlTtlSeconds <=
        scenario.responseAssertions.mediaPrivacy.signedUrlTtlSecondsMax,
      true,
      `mediaAsset ${mediaAsset.key} signed URL TTL exceeds max`
    );
  }

  for (const step of scenario.flow.steps) {
    const included = step.expectedBodyIncludes ?? [];
    for (const field of forbiddenFields) {
      assert.equal(
        included.includes(field),
        false,
        `step ${step.key} must not expect ${field} in public response`
      );
    }

    const responseHasMediaSurface =
      step.path.includes("/media") ||
      step.path.includes("/imaging") ||
      step.key === "read-patient-timeline-after-media";

    if (responseHasMediaSurface && (included.length > 0 || step.key.includes("timeline"))) {
      assert.deepEqual(
        step.expectedBodyMustNotInclude,
        forbiddenFields,
        `step ${step.key} must assert raw storage fields are absent`
      );
    }
  }

  const uploadUrlSteps = scenario.flow.steps.filter((step) =>
    (step.expectedBodyIncludes ?? []).includes("uploadUrl")
  );
  assert.deepEqual(
    uploadUrlSteps.map((step) => step.key),
    ["request-xray-upload-url"],
    "uploadUrl should only be expected from upload initialization"
  );

  const signedUrlSteps = scenario.flow.steps.filter((step) =>
    (step.expectedBodyIncludes ?? []).includes("signedUrl")
  );
  assert.deepEqual(
    signedUrlSteps.map((step) => step.key),
    ["request-signed-media-view"],
    "signedUrl should only be expected from mediated signed access"
  );
}

export async function loadCp4Scenario(scenarioPath = CP4_SCENARIO_PATH) {
  const raw = await readFile(scenarioPath, "utf8");
  return JSON.parse(raw);
}

export function validateCp4Scenario(scenario) {
  assert.equal(scenario.schemaVersion, "clinic-os.cp4.qa-fixture.v1");
  assertLocalSyntheticOnly(scenario);

  assert.equal(scenario.clock.businessDate, "2026-07-07");
  assert.equal(scenario.clock.timezone, "Asia/Kolkata");
  assertIsoWithOffset(scenario.clock.fixedNow, "clock.fixedNow");

  const entityIds = new Set();
  const knownTenantIds = new Set();
  const knownClinicIds = new Set();
  const knownActorKeys = new Set();
  const knownPatientIds = new Set();
  const knownAppointmentIds = new Set();
  const knownEncounterIds = new Set();
  const knownChartIds = new Set();
  const knownFindingIds = new Set();
  const knownSnapshotIds = new Set();
  const knownMediaAssetIds = new Set();
  const knownExternalMediaLinkIds = new Set();

  for (const tenant of scenario.tenants) {
    assertUniqueEntityId(entityIds, tenant.id, `tenant ${tenant.key}.id`);
    knownTenantIds.add(tenant.id);
  }

  for (const clinic of scenario.clinics) {
    assertUniqueEntityId(entityIds, clinic.id, `clinic ${clinic.key}.id`);
    assertKnownReference(knownTenantIds, clinic.tenantId, `clinic ${clinic.key}.tenantId`);
    knownClinicIds.add(clinic.id);
  }

  for (const actor of scenario.actors) {
    assertUniqueEntityId(entityIds, actor.id, `actor ${actor.key}.id`);
    assert.match(actor.email, TEST_EMAIL_PATTERN, `actor ${actor.key}.email must be synthetic`);
    assertKnownReference(knownTenantIds, actor.tenantId, `actor ${actor.key}.tenantId`);
    assertKnownReference(knownClinicIds, actor.clinicId, `actor ${actor.key}.clinicId`);
    knownActorKeys.add(actor.key);
  }

  for (const patient of scenario.patients) {
    assertUniqueEntityId(entityIds, patient.id, `patient ${patient.key}.id`);
    assert.match(patient.email, TEST_EMAIL_PATTERN, `patient ${patient.key}.email`);
    assert.match(
      patient.phone,
      TEST_PHONE_PATTERN,
      `patient ${patient.key}.phone must use reserved CP4 fixture range`
    );
    assertKnownReference(knownTenantIds, patient.tenantId, `patient ${patient.key}.tenantId`);
    assertKnownReference(knownClinicIds, patient.clinicId, `patient ${patient.key}.clinicId`);
    knownPatientIds.add(patient.id);

    for (const entry of patient.timelineSeed ?? []) {
      assertIsoWithOffset(entry.occurredAt, `patient ${patient.key}.timelineSeed.occurredAt`);
    }
  }

  for (const appointment of scenario.appointments) {
    assertUniqueEntityId(entityIds, appointment.id, `appointment ${appointment.key}.id`);
    assertKnownReference(
      knownTenantIds,
      appointment.tenantId,
      `appointment ${appointment.key}.tenantId`
    );
    assertKnownReference(
      knownClinicIds,
      appointment.clinicId,
      `appointment ${appointment.key}.clinicId`
    );
    assertKnownReference(
      knownPatientIds,
      appointment.patientId,
      `appointment ${appointment.key}.patientId`
    );
    assertKnownKey(
      knownActorKeys,
      appointment.providerActorKey,
      `appointment ${appointment.key}.providerActorKey`
    );
    assertIsoWithOffset(
      appointment.scheduledStart,
      `appointment ${appointment.key}.scheduledStart`
    );
    assertIsoWithOffset(appointment.scheduledEnd, `appointment ${appointment.key}.scheduledEnd`);
    assert.ok(
      appointment.statusSequence.includes("encounter_started"),
      `appointment ${appointment.key} must reach encounter_started`
    );
    knownAppointmentIds.add(appointment.id);
  }

  for (const encounter of scenario.encounters) {
    assertUniqueEntityId(entityIds, encounter.id, `encounter ${encounter.key}.id`);
    assertKnownReference(knownTenantIds, encounter.tenantId, `encounter ${encounter.key}.tenantId`);
    assertKnownReference(knownClinicIds, encounter.clinicId, `encounter ${encounter.key}.clinicId`);
    assertKnownReference(
      knownPatientIds,
      encounter.patientId,
      `encounter ${encounter.key}.patientId`
    );
    assertKnownReference(
      knownAppointmentIds,
      encounter.appointmentId,
      `encounter ${encounter.key}.appointmentId`
    );
    assertKnownKey(
      knownActorKeys,
      encounter.providerActorKey,
      `encounter ${encounter.key}.providerActorKey`
    );
    assertIsoWithOffset(encounter.startedAt, `encounter ${encounter.key}.startedAt`);
    assert.ok(
      encounter.lifecycle.includes("dental_charting"),
      `encounter ${encounter.key} must include dental_charting`
    );
    knownEncounterIds.add(encounter.id);
  }

  for (const chart of scenario.dentalCharts) {
    assertUniqueEntityId(entityIds, chart.id, `dentalChart ${chart.key}.id`);
    assertKnownReference(knownTenantIds, chart.tenantId, `dentalChart ${chart.key}.tenantId`);
    assertKnownReference(knownClinicIds, chart.clinicId, `dentalChart ${chart.key}.clinicId`);
    assertKnownReference(knownPatientIds, chart.patientId, `dentalChart ${chart.key}.patientId`);
    assert.equal(chart.numberingSystem, "FDI", `dentalChart ${chart.key} must use FDI`);
    assert.equal(chart.dentition, "adult", `dentalChart ${chart.key} must be adult dentition`);
    knownChartIds.add(chart.id);
  }

  for (const finding of scenario.dentalFindings) {
    assertUniqueEntityId(entityIds, finding.id, `dentalFinding ${finding.key}.id`);
    assertKnownReference(knownChartIds, finding.chartId, `dentalFinding ${finding.key}.chartId`);
    assertKnownReference(knownTenantIds, finding.tenantId, `dentalFinding ${finding.key}.tenantId`);
    assertKnownReference(knownClinicIds, finding.clinicId, `dentalFinding ${finding.key}.clinicId`);
    assertKnownReference(
      knownPatientIds,
      finding.patientId,
      `dentalFinding ${finding.key}.patientId`
    );
    assertKnownReference(
      knownEncounterIds,
      finding.encounterId,
      `dentalFinding ${finding.key}.encounterId`
    );
    assert.match(finding.toothNumber, /^\d{2}$/, `dentalFinding ${finding.key} needs FDI tooth`);
    assert.ok(finding.surfaces.length > 0, `dentalFinding ${finding.key} needs surfaces`);
    assertKnownKey(
      knownActorKeys,
      finding.createdByActorKey,
      `dentalFinding ${finding.key}.createdByActorKey`
    );
    assertIsoWithOffset(finding.createdAt, `dentalFinding ${finding.key}.createdAt`);
    assertKnownKey(
      knownActorKeys,
      finding.lastReviewedByActorKey,
      `dentalFinding ${finding.key}.lastReviewedByActorKey`
    );
    assertIsoWithOffset(finding.lastReviewedAt, `dentalFinding ${finding.key}.lastReviewedAt`);
    assert.ok(finding.history.length >= 2, `dentalFinding ${finding.key} needs history`);
    knownFindingIds.add(finding.id);
  }

  for (const snapshot of scenario.dentalChartSnapshots) {
    assertUniqueEntityId(entityIds, snapshot.id, `dentalChartSnapshot ${snapshot.key}.id`);
    assertKnownReference(
      knownChartIds,
      snapshot.chartId,
      `dentalChartSnapshot ${snapshot.key}.chartId`
    );
    assertKnownReference(
      knownPatientIds,
      snapshot.patientId,
      `dentalChartSnapshot ${snapshot.key}.patientId`
    );
    assertKnownReference(
      knownEncounterIds,
      snapshot.encounterId,
      `dentalChartSnapshot ${snapshot.key}.encounterId`
    );
    assertKnownKey(
      knownActorKeys,
      snapshot.createdByActorKey,
      `dentalChartSnapshot ${snapshot.key}.createdByActorKey`
    );
    assertIsoWithOffset(snapshot.createdAt, `dentalChartSnapshot ${snapshot.key}.createdAt`);
    for (const findingId of snapshot.findingIds) {
      assertKnownReference(
        knownFindingIds,
        findingId,
        `dentalChartSnapshot ${snapshot.key}.findingIds`
      );
    }
    knownSnapshotIds.add(snapshot.id);
  }

  for (const chart of scenario.dentalCharts) {
    assertKnownReference(
      knownSnapshotIds,
      chart.activeSnapshotId,
      `dentalChart ${chart.key}.activeSnapshotId`
    );
  }

  for (const mediaAsset of scenario.mediaAssets) {
    assertUniqueEntityId(entityIds, mediaAsset.id, `mediaAsset ${mediaAsset.key}.id`);
    assertKnownReference(
      knownTenantIds,
      mediaAsset.tenantId,
      `mediaAsset ${mediaAsset.key}.tenantId`
    );
    assertKnownReference(
      knownClinicIds,
      mediaAsset.clinicId,
      `mediaAsset ${mediaAsset.key}.clinicId`
    );
    assertKnownReference(
      knownPatientIds,
      mediaAsset.patientId,
      `mediaAsset ${mediaAsset.key}.patientId`
    );
    assertKnownKey(
      knownActorKeys,
      mediaAsset.createdByActorKey,
      `mediaAsset ${mediaAsset.key}.createdByActorKey`
    );
    assertIsoWithOffset(mediaAsset.createdAt, `mediaAsset ${mediaAsset.key}.createdAt`);
    assert.ok(mediaAsset.tags.length > 0, `mediaAsset ${mediaAsset.key} needs tags`);
    assert.ok(
      ["manual_upload", "metadata_import"].includes(mediaAsset.uploadMode),
      `mediaAsset ${mediaAsset.key} uploadMode must be coexistence-first`
    );
    knownMediaAssetIds.add(mediaAsset.id);
  }

  for (const attachment of scenario.mediaAttachments) {
    assertUniqueEntityId(entityIds, attachment.id, `mediaAttachment ${attachment.key}.id`);
    assertKnownReference(
      knownMediaAssetIds,
      attachment.mediaAssetId,
      `mediaAttachment ${attachment.key}.mediaAssetId`
    );
    assert.ok(
      ["patient", "encounter", "tooth", "dental_finding"].includes(attachment.contextType),
      `mediaAttachment ${attachment.key} has unsupported contextType`
    );
    if (attachment.contextType === "patient") {
      assertKnownReference(
        knownPatientIds,
        attachment.contextId,
        `mediaAttachment ${attachment.key}.contextId`
      );
    }
    if (attachment.contextType === "encounter") {
      assertKnownReference(
        knownEncounterIds,
        attachment.contextId,
        `mediaAttachment ${attachment.key}.contextId`
      );
    }
    if (attachment.contextType === "dental_finding") {
      assertKnownReference(
        knownFindingIds,
        attachment.contextId,
        `mediaAttachment ${attachment.key}.contextId`
      );
    }
    if (attachment.contextType === "tooth") {
      assert.match(
        attachment.contextId,
        /^[0-9a-f-]{36}:FDI:\d{2}$/,
        `mediaAttachment ${attachment.key}.tooth contextId must include patient and FDI tooth`
      );
    }
    assertKnownKey(
      knownActorKeys,
      attachment.createdByActorKey,
      `mediaAttachment ${attachment.key}.createdByActorKey`
    );
    assertIsoWithOffset(attachment.createdAt, `mediaAttachment ${attachment.key}.createdAt`);
  }

  for (const study of scenario.imagingStudies) {
    assertUniqueEntityId(entityIds, study.id, `imagingStudy ${study.key}.id`);
    assertKnownReference(knownTenantIds, study.tenantId, `imagingStudy ${study.key}.tenantId`);
    assertKnownReference(knownClinicIds, study.clinicId, `imagingStudy ${study.key}.clinicId`);
    assertKnownReference(knownPatientIds, study.patientId, `imagingStudy ${study.key}.patientId`);
    assertKnownReference(
      knownEncounterIds,
      study.encounterId,
      `imagingStudy ${study.key}.encounterId`
    );
    for (const mediaAssetId of study.mediaAssetIds) {
      assertKnownReference(
        knownMediaAssetIds,
        mediaAssetId,
        `imagingStudy ${study.key}.mediaAssetIds`
      );
    }
  }

  for (const dicomMetadata of scenario.dicomMetadataFixtures) {
    assertKnownReference(
      knownMediaAssetIds,
      dicomMetadata.mediaAssetId,
      `dicomMetadata ${dicomMetadata.key}.mediaAssetId`
    );
    assert.match(dicomMetadata.studyInstanceUid, DICOM_UID_PATTERN);
    assert.match(dicomMetadata.seriesInstanceUid, DICOM_UID_PATTERN);
    assert.match(dicomMetadata.sopInstanceUid, DICOM_UID_PATTERN);
    assert.equal(dicomMetadata.pixelDataIncluded, false, "DICOM fixture must be metadata-only");
    assert.equal(dicomMetadata.modality, "DX", "DICOM fixture must preserve modality");
    assert.deepEqual(dicomMetadata.toothNumbers, ["16"], "DICOM fixture must preserve tooth hint");
  }

  for (const externalLink of scenario.externalMediaLinks) {
    assertUniqueEntityId(entityIds, externalLink.id, `externalMediaLink ${externalLink.key}.id`);
    assertKnownReference(
      knownTenantIds,
      externalLink.tenantId,
      `externalMediaLink ${externalLink.key}.tenantId`
    );
    assertKnownReference(
      knownClinicIds,
      externalLink.clinicId,
      `externalMediaLink ${externalLink.key}.clinicId`
    );
    assertKnownReference(
      knownPatientIds,
      externalLink.patientId,
      `externalMediaLink ${externalLink.key}.patientId`
    );
    assertKnownReference(
      knownEncounterIds,
      externalLink.encounterId,
      `externalMediaLink ${externalLink.key}.encounterId`
    );
    assert.equal(externalLink.referenceType, "manual_external_reference");
    assert.equal(externalLink.launchUrlStored, false);
    assert.equal(externalLink.provenance.coexistenceFirst, true);
    assert.equal(externalLink.provenance.doesNotReplaceExternalSoftware, true);
    assert.equal(externalLink.provenance.doesNotAutomateExternalUi, true);
    assertKnownKey(
      knownActorKeys,
      externalLink.createdByActorKey,
      `externalMediaLink ${externalLink.key}.createdByActorKey`
    );
    assertIsoWithOffset(externalLink.createdAt, `externalMediaLink ${externalLink.key}.createdAt`);
    knownExternalMediaLinkIds.add(externalLink.id);
  }

  assert.deepEqual(
    scenario.flow.steps.map((step) => step.key),
    REQUIRED_STEPS,
    "CP4 flow step order changed unexpectedly"
  );
  assert.deepEqual(
    scenario.flow.actorSequence,
    scenario.flow.steps.map((step) => step.actorKey),
    "actorSequence must mirror step actor keys"
  );

  for (const step of scenario.flow.steps) {
    assertKnownKey(knownActorKeys, step.actorKey, `flow step ${step.key}.actorKey`);
    assert.ok(step.method && step.path, `flow step ${step.key} must declare method/path`);
    assert.ok(step.idempotencyKey, `flow step ${step.key} must declare idempotencyKey`);
    assert.ok(
      normalizeStatusList(step.expectedStatus).every((status) => Number.isInteger(status)),
      `flow step ${step.key} must declare integer expectedStatus`
    );
    assert.ok(
      Array.isArray(step.expectedEvents),
      `flow step ${step.key} must declare expectedEvents`
    );
    assert.ok(
      Array.isArray(step.expectedAudit),
      `flow step ${step.key} must declare expectedAudit`
    );
    if (step.method !== "GET") {
      assert.ok(step.requestBody, `flow step ${step.key} must declare requestBody`);
    }

    for (const event of step.expectedAudit) {
      assert.ok(event.action, `flow step ${step.key} audit event needs action`);
      assert.ok(
        Array.isArray(event.phiFields),
        `flow step ${step.key} audit event needs phiFields`
      );
      assert.ok(
        event.phiFields.length > 0,
        `flow step ${step.key} audit event must name PHI-sensitive fields`
      );
      if (UUID_PATTERN.test(event.resourceId)) {
        assertUuid(event.resourceId, `flow step ${step.key} audit resourceId`);
      }
    }

    for (const expectation of step.timelineExpectations) {
      assertKnownReference(
        knownPatientIds,
        expectation.patientId,
        `flow step ${step.key}.timeline.patientId`
      );
      assert.ok(expectation.entryType, `flow step ${step.key}.timeline entryType`);
    }
  }

  const eventNames = flattenEventNames(scenario);
  for (const eventName of REQUIRED_EVENTS) {
    assert.ok(eventNames.has(eventName), `fixture must expect ${eventName}`);
  }

  const timelineEntries = flattenTimelineEntries(scenario);
  for (const entryType of scenario.responseAssertions.timeline.chartingPatientMustInclude) {
    assert.ok(timelineEntries.has(entryType), `fixture must require ${entryType} timeline entry`);
  }

  for (const expectation of scenario.roleTenantExpectations) {
    assertKnownKey(knownActorKeys, expectation.actorKey, `role expectation ${expectation.key}`);
    assertKnownReference(
      knownTenantIds,
      expectation.targetTenantId,
      `role expectation ${expectation.key}.targetTenantId`
    );
    assertKnownReference(
      knownClinicIds,
      expectation.targetClinicId,
      `role expectation ${expectation.key}.targetClinicId`
    );
    assert.ok(
      expectation.requiredPermissions.length > 0,
      `role expectation ${expectation.key} needs permissions`
    );
    assert.ok(
      ["allow", "deny"].includes(expectation.expected),
      `role expectation ${expectation.key} expected must be allow/deny`
    );
    if (expectation.expected === "deny") {
      assert.ok(expectation.expectedReason, `denial ${expectation.key} needs expectedReason`);
      assert.ok(expectation.method && expectation.path, `denial ${expectation.key} needs request`);
      assert.ok(
        normalizeStatusList(expectation.expectedStatus).length > 0,
        `denial ${expectation.key} needs expectedStatus`
      );
    }
  }

  for (const [key, reason] of [
    ["accountant-cannot-read-dental-chart", "missing_permission"],
    ["accountant-cannot-request-signed-media", "missing_permission"],
    ["wrong-tenant-assistant-cannot-read-dental-chart", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-request-signed-media", "tenant_mismatch"],
    ["wrong-tenant-assistant-cannot-link-media", "tenant_mismatch"]
  ]) {
    assert.equal(
      byKey(scenario.roleTenantExpectations, key, "roleTenantExpectation").expectedReason,
      reason
    );
  }

  const contextTypes = new Set(
    scenario.mediaAttachments.map((attachment) => attachment.contextType)
  );
  for (const contextType of scenario.responseAssertions.attachmentContexts.mustInclude) {
    assert.ok(contextTypes.has(contextType), `fixture must attach media to ${contextType}`);
  }

  assertStoragePrivacyExpectations(scenario);

  assert.deepEqual(scenario.responseAssertions.imagingCoexistence, {
    manualUploadSupported: true,
    metadataImportSupported: true,
    externalReferenceLinkSupported: true,
    dicomMetadataPreservedWhenAvailable: true,
    pacsReplacementRequired: false,
    dicomwebAdapterRequiredInCp4: false,
    unauthorizedExternalUiAutomationAllowed: false
  });

  assert.ok(
    scenario.e2eSelectorContract.requiredTestIds.length >= 20,
    "E2E selector contract must name expected browser workflow selectors"
  );

  return true;
}

export function summarizeCp4Scenario(scenario) {
  return {
    tenants: scenario.tenants.length,
    clinics: scenario.clinics.length,
    actors: scenario.actors.length,
    patients: scenario.patients.length,
    appointments: scenario.appointments.length,
    encounters: scenario.encounters.length,
    dentalFindings: scenario.dentalFindings.length,
    dentalChartSnapshots: scenario.dentalChartSnapshots.length,
    mediaAssets: scenario.mediaAssets.length,
    mediaAttachments: scenario.mediaAttachments.length,
    imagingStudies: scenario.imagingStudies.length,
    dicomMetadataFixtures: scenario.dicomMetadataFixtures.length,
    externalMediaLinks: scenario.externalMediaLinks.length,
    flowSteps: scenario.flow.steps.length,
    roleTenantExpectations: scenario.roleTenantExpectations.length
  };
}

async function main() {
  const scenario = await loadCp4Scenario();
  validateCp4Scenario(scenario);
  const summary = summarizeCp4Scenario(scenario);
  console.log("CP4 fixture validation passed.");
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
