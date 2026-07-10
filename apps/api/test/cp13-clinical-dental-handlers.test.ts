import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { AccessContext } from "@clinic-os/auth";
import type { ParsedOperationRequest } from "@clinic-os/api-contracts";
import {
  CHECKPOINT1_SEED_IDS,
  type ClinicRepositoryModules,
  type RepositoryScope,
  type TransactionEvidencePort
} from "@clinic-os/db";
import type {
  ClinicRoleSlug,
  Clock,
  DomainEventType,
  MediaAssetRecord,
  MediaScanStatus,
  UUID
} from "@clinic-os/domain";
import { createClinicalDentalHandlerMap } from "../src/features/clinical-dental/index.ts";
import type {
  ClinicalDentalHandlerDependencies,
  ClinicalDentalHandlerMap,
  ClinicalDentalOperationId
} from "../src/features/clinical-dental/types.ts";
import type {
  ClinicFeatureExecutionContext,
  ClinicFeatureOperationRequest
} from "../src/features/contracts.ts";
import { LocalFixtureClinicOperationsRepository } from "../src/local-fixture.ts";
import type {
  MediaSignedReadAccess,
  MediaStorageProvider,
  MediaUploadTarget,
  StoredMediaObject
} from "../src/media-storage.ts";
import { InMemoryAtomicMutationCoordinator } from "../src/framework/in-memory-test-doubles.ts";

const NOW = new Date("2032-02-03T04:05:06.000Z");
const PATIENT_ID = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;
const SECOND_PATIENT_ID = "10000000-0000-4000-8000-000000002099" as UUID;
const SECOND_DOCTOR_ID = "10000000-0000-4000-8000-000000001099" as UUID;

test("CP13 clinical/dental factory implements all 22 operations with durable evidence and safe media", async () => {
  const harness = createHarness();
  const handlers = createClinicalDentalHandlerMap(harness.dependencies);
  assert.equal(Object.keys(handlers).length, 22);

  const treatmentConsent = await handlers.createPatientConsent(
    request("createPatientConsent", "assistant", {
      path: { patientId: PATIENT_ID },
      body: consentBody("treatment_registration"),
      idempotencyKey: "cp13-treatment-consent"
    }),
    harness.context
  );
  assert.equal(treatmentConsent.status, 201);
  const photoCapture = await handlers.createPatientConsent(
    request("createPatientConsent", "assistant", {
      path: { patientId: PATIENT_ID },
      body: consentBody("photo_capture"),
      idempotencyKey: "cp13-photo-capture"
    }),
    harness.context
  );
  const photoSharing = await handlers.createPatientConsent(
    request("createPatientConsent", "assistant", {
      path: { patientId: PATIENT_ID },
      body: consentBody("photo_sharing"),
      idempotencyKey: "cp13-photo-sharing"
    }),
    harness.context
  );
  const listedConsents = await handlers.listPatientConsents(
    request("listPatientConsents", "assistant", { path: { patientId: PATIENT_ID } }),
    harness.context
  );
  assert.equal((listedConsents.body as { consents: unknown[] }).consents.length, 3);

  const encounterResponse = await handlers.createEncounter(
    request("createEncounter", "assistant", {
      body: {
        patientId: PATIENT_ID,
        providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
        reason: "Synthetic consultation"
      },
      idempotencyKey: "cp13-encounter-create"
    }),
    harness.context
  );
  const encounterId = entityId(encounterResponse.body, "encounter");
  await handlers.getEncounter(
    request("getEncounter", "doctor", { path: { encounterId } }),
    harness.context
  );
  await handlers.startEncounter(
    request("startEncounter", "assistant", {
      path: { encounterId },
      idempotencyKey: "cp13-encounter-start"
    }),
    harness.context
  );
  await handlers.saveEncounterClinicalNoteDraft(
    request("saveEncounterClinicalNoteDraft", "assistant", {
      path: { encounterId },
      body: {
        content: { examination: "Synthetic tenderness", diagnosis: "Synthetic diagnosis" },
        readyForSign: true
      },
      idempotencyKey: "cp13-note-draft"
    }),
    harness.context
  );
  const signedNote = await handlers.signEncounterClinicalNote(
    request("signEncounterClinicalNote", "doctor", {
      path: { encounterId },
      idempotencyKey: "cp13-note-sign"
    }),
    harness.context
  );
  const amended = await handlers.amendEncounterClinicalNote(
    request("amendEncounterClinicalNote", "doctor", {
      path: { encounterId },
      body: {
        content: { followUpInstructions: "Synthetic follow-up" },
        amendmentReason: "Document synthetic follow-up"
      },
      idempotencyKey: "cp13-note-amend"
    }),
    harness.context
  );
  assert.notEqual(entityId(signedNote.body, "note"), entityId(amended.body, "note"));

  const prescriptionResponse = await handlers.createEncounterPrescription(
    request("createEncounterPrescription", "assistant", {
      path: { encounterId },
      body: {
        medications: [{ name: "Synthetic medicine", frequency: "OD", duration: "2 days" }]
      },
      idempotencyKey: "cp13-prescription-create"
    }),
    harness.context
  );
  const prescriptionId = entityId(prescriptionResponse.body, "prescription");
  await handlers.signPrescription(
    request("signPrescription", "doctor", {
      path: { prescriptionId },
      idempotencyKey: "cp13-prescription-sign"
    }),
    harness.context
  );

  await handlers.getPatientDentalChart(
    request("getPatientDentalChart", "doctor", { path: { patientId: PATIENT_ID } }),
    harness.context
  );
  const findingResponse = await handlers.createPatientDentalFinding(
    request("createPatientDentalFinding", "assistant", {
      path: { patientId: PATIENT_ID },
      body: {
        encounterId,
        toothNumber: "16",
        surface: "occlusal",
        findingType: "caries",
        source: "ai_draft",
        reviewStatus: "needs_review",
        notes: "Synthetic draft"
      },
      idempotencyKey: "cp13-finding-create"
    }),
    harness.context
  );
  const findingId = entityId(findingResponse.body, "finding");
  assert.equal(entityField(findingResponse.body, "finding", "reviewStatus"), "needs_review");
  await handlers.createEncounterDentalFinding(
    request("createEncounterDentalFinding", "doctor", {
      path: { encounterId },
      body: {
        toothNumber: "26",
        findingType: "watch_item",
        source: "manual",
        reviewStatus: "reviewed"
      },
      idempotencyKey: "cp13-encounter-finding"
    }),
    harness.context
  );
  await handlers.updateDentalFinding(
    request("updateDentalFinding", "doctor", {
      path: { findingId },
      body: {
        reviewStatus: "reviewed",
        source: "ai_draft",
        changeReason: "Doctor confirmed synthetic draft"
      },
      idempotencyKey: "cp13-finding-update"
    }),
    harness.context
  );
  await handlers.listDentalFindingHistory(
    request("listDentalFindingHistory", "doctor", { path: { findingId } }),
    harness.context
  );
  await handlers.createDentalChartSnapshot(
    request("createDentalChartSnapshot", "doctor", {
      path: { patientId: PATIENT_ID },
      body: { encounterId, reason: "Synthetic checkpoint" },
      idempotencyKey: "cp13-chart-snapshot"
    }),
    harness.context
  );

  const bytes = new TextEncoder().encode("synthetic-clinical-image");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const uploadResponse = await handlers.requestMediaUploadUrl(
    request("requestMediaUploadUrl", "assistant", {
      body: {
        patientId: PATIENT_ID,
        encounterId,
        dentalFindingId: findingId,
        toothNumber: "16",
        mediaType: "intraoral_photo",
        originalFilename: "synthetic.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: bytes.byteLength,
        sha256Digest: digest,
        provenance: { source: "automated_test" }
      },
      idempotencyKey: "cp13-media-reserve"
    }),
    harness.context
  );
  const uploadId = entityId(uploadResponse.body, "upload");
  const publicFilename = entityField(uploadResponse.body, "upload", "originalFilename");
  assert.equal(publicFilename, `clinical-media-${uploadId}.jpg`);
  assert.equal(harness.repository.mediaUploadReservations[0]?.originalFilename, publicFilename);
  assert.notEqual(publicFilename, "synthetic.jpg");
  assertSafeMediaResponse(uploadResponse.body, { allowSignedUrl: true });
  const contentResponse = await handlers.receiveMediaUploadContent(
    request("receiveMediaUploadContent", "assistant", {
      path: { uploadId },
      body: bytes,
      idempotencyKey: "cp13-media-content"
    }),
    harness.context
  );
  assertSafeMediaResponse(contentResponse.body);

  // Recreate both handler factory and transaction facade before completion. Persisted repository
  // and provider object state survive the simulated process restart.
  const restartedContext = harness.createContext();
  const restartedHandlers = createClinicalDentalHandlerMap(harness.dependencies);
  const completeResponse = await restartedHandlers.completeMediaUpload(
    request("completeMediaUpload", "assistant", {
      path: { uploadId },
      body: {
        patientId: PATIENT_ID,
        encounterId,
        contentLength: bytes.byteLength,
        sha256Digest: digest,
        mimeType: "image/jpeg"
      },
      idempotencyKey: "cp13-media-complete"
    }),
    restartedContext
  );
  const mediaAssetId = entityId(completeResponse.body, "mediaAsset");
  assertSafeMediaResponse(completeResponse.body);
  const listedMedia = await restartedHandlers.listPatientMediaAssets(
    request("listPatientMediaAssets", "doctor", {
      path: { patientId: PATIENT_ID },
      query: { limit: 10 }
    }),
    restartedContext
  );
  assertSafeMediaResponse(listedMedia.body);
  const access = await restartedHandlers.createSignedMediaAccess(
    request("createSignedMediaAccess", "doctor", {
      path: { mediaAssetId },
      body: { expiresInSeconds: 120 },
      idempotencyKey: "cp13-media-access"
    }),
    restartedContext
  );
  assertSafeMediaResponse(access.body, { allowSignedUrl: true });

  await restartedHandlers.revokePatientConsent(
    request("revokePatientConsent", "assistant", {
      path: { patientId: PATIENT_ID, consentId: entityId(photoSharing.body, "consent") },
      body: { reason: "Synthetic patient withdrew sharing" },
      idempotencyKey: "cp13-photo-sharing-revoke"
    }),
    restartedContext
  );
  await assert.rejects(
    restartedHandlers.createSignedMediaAccess(
      request("createSignedMediaAccess", "doctor", {
        path: { mediaAssetId },
        body: { expiresInSeconds: 120 },
        idempotencyKey: "cp13-media-access-after-revocation"
      }),
      restartedContext
    ),
    hasStatus(409)
  );

  assert.ok(harness.auditEvents.some((event) => event.action === "clinical_note.signed"));
  assert.ok(harness.auditEvents.some((event) => event.action === "media.viewed"));
  assert.ok(harness.outboxEvents.some((event) => event.eventType === "dental.finding.updated"));
  assert.ok(harness.outboxEvents.some((event) => event.eventType === "media.upload_completed"));
  assert.ok(
    harness.outboxEvents.some(
      (event) =>
        event.eventType === "consent.created" &&
        event.idempotencyKey?.endsWith(":createPatientConsent:cp13-treatment-consent")
    )
  );
  assert.ok(
    harness.repository.timelineItems.some((item) => item.itemType === "clinical_note_amended")
  );
  assert.ok(harness.repository.timelineItems.some((item) => item.itemType === "media_uploaded"));
  assert.equal(entityId(photoCapture.body, "consent").length, 36);
});

test("CP13 clinical safety denies wrong role, revoked consent, wrong patient, tenant and invalid state", async () => {
  const harness = createHarness();
  const handlers = createClinicalDentalHandlerMap(harness.dependencies);
  const treatment = await handlers.createPatientConsent(
    request("createPatientConsent", "assistant", {
      path: { patientId: PATIENT_ID },
      body: consentBody("treatment_registration"),
      idempotencyKey: "cp13-negative-consent"
    }),
    harness.context
  );
  const encounter = await handlers.createEncounter(
    request("createEncounter", "assistant", {
      body: { patientId: PATIENT_ID, providerUserId: CHECKPOINT1_SEED_IDS.users.doctor },
      idempotencyKey: "cp13-negative-encounter"
    }),
    harness.context
  );
  const encounterId = entityId(encounter.body, "encounter");
  await handlers.startEncounter(
    request("startEncounter", "assistant", {
      path: { encounterId },
      idempotencyKey: "cp13-negative-start"
    }),
    harness.context
  );
  await handlers.saveEncounterClinicalNoteDraft(
    request("saveEncounterClinicalNoteDraft", "assistant", {
      path: { encounterId },
      body: { content: { diagnosis: "Synthetic" }, readyForSign: true },
      idempotencyKey: "cp13-negative-draft"
    }),
    harness.context
  );
  await assert.rejects(
    handlers.signEncounterClinicalNote(
      request("signEncounterClinicalNote", "assistant", {
        path: { encounterId },
        idempotencyKey: "cp13-assistant-sign-denied"
      }),
      harness.context
    ),
    hasStatus(403)
  );

  await handlers.revokePatientConsent(
    request("revokePatientConsent", "assistant", {
      path: { patientId: PATIENT_ID, consentId: entityId(treatment.body, "consent") },
      body: { reason: "Synthetic withdrawal" },
      idempotencyKey: "cp13-negative-revoke"
    }),
    harness.context
  );
  await assert.rejects(
    handlers.signEncounterClinicalNote(
      request("signEncounterClinicalNote", "doctor", {
        path: { encounterId },
        idempotencyKey: "cp13-revoked-sign-denied"
      }),
      harness.context
    ),
    hasStatus(409)
  );
  await assert.rejects(
    handlers.startEncounter(
      request("startEncounter", "assistant", {
        path: { encounterId },
        idempotencyKey: "cp13-repeat-start-denied"
      }),
      harness.context
    ),
    hasStatus(409)
  );

  harness.repository.patients.push({
    ...harness.repository.patients[0],
    id: SECOND_PATIENT_ID,
    fullName: "Second Synthetic Patient",
    phone: "+919999999999"
  });
  const seededAppointment = await harness.repository.createAppointment(harness.scope, {
    patientId: PATIENT_ID,
    providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
    appointmentTypeId: CHECKPOINT1_SEED_IDS.appointmentTypes.consultation,
    status: "booked",
    startAt: "2032-02-03T05:00:00.000Z",
    endAt: "2032-02-03T05:30:00.000Z",
    source: "manual"
  });
  await assert.rejects(
    handlers.createEncounter(
      request("createEncounter", "assistant", {
        body: {
          patientId: SECOND_PATIENT_ID,
          appointmentId: seededAppointment.id,
          providerUserId: CHECKPOINT1_SEED_IDS.users.doctor
        },
        idempotencyKey: "cp13-wrong-patient-denied"
      }),
      harness.context
    ),
    hasStatus(400)
  );

  const otherClinicHarness = createHarness({
    clinicId: "10000000-0000-4000-8000-000000000099" as UUID,
    repository: harness.repository
  });
  await assert.rejects(
    handlers.getEncounter(
      request("getEncounter", "doctor", {
        path: { encounterId },
        clinicId: otherClinicHarness.scope.clinicId
      }),
      otherClinicHarness.context
    ),
    hasStatus(404)
  );
});

test("CP13 signatures fail closed unless the doctor is the assigned encounter provider", async () => {
  const harness = createHarness();
  const handlers = createClinicalDentalHandlerMap(harness.dependencies);
  await handlers.createPatientConsent(
    request("createPatientConsent", "assistant", {
      path: { patientId: PATIENT_ID },
      body: consentBody("treatment_registration"),
      idempotencyKey: "cp13-assigned-provider-consent"
    }),
    harness.context
  );
  const encounter = await handlers.createEncounter(
    request("createEncounter", "assistant", {
      body: { patientId: PATIENT_ID, providerUserId: CHECKPOINT1_SEED_IDS.users.doctor },
      idempotencyKey: "cp13-assigned-provider-encounter"
    }),
    harness.context
  );
  const encounterId = entityId(encounter.body, "encounter");
  await handlers.startEncounter(
    request("startEncounter", "assistant", {
      path: { encounterId },
      idempotencyKey: "cp13-assigned-provider-start"
    }),
    harness.context
  );
  await handlers.saveEncounterClinicalNoteDraft(
    request("saveEncounterClinicalNoteDraft", "assistant", {
      path: { encounterId },
      body: { content: { diagnosis: "Synthetic diagnosis" }, readyForSign: true },
      idempotencyKey: "cp13-assigned-provider-draft"
    }),
    harness.context
  );
  await assert.rejects(
    handlers.signEncounterClinicalNote(
      request("signEncounterClinicalNote", "doctor", {
        path: { encounterId },
        userId: SECOND_DOCTOR_ID,
        idempotencyKey: "cp13-unassigned-note-sign"
      }),
      harness.context
    ),
    hasStatus(403)
  );
  await handlers.signEncounterClinicalNote(
    request("signEncounterClinicalNote", "doctor", {
      path: { encounterId },
      idempotencyKey: "cp13-assigned-note-sign"
    }),
    harness.context
  );
  await assert.rejects(
    handlers.amendEncounterClinicalNote(
      request("amendEncounterClinicalNote", "doctor", {
        path: { encounterId },
        userId: SECOND_DOCTOR_ID,
        body: {
          content: { followUpInstructions: "Synthetic correction" },
          amendmentReason: "Synthetic correction reason"
        },
        idempotencyKey: "cp13-unassigned-note-amend"
      }),
      harness.context
    ),
    hasStatus(403)
  );
  const prescription = await handlers.createEncounterPrescription(
    request("createEncounterPrescription", "assistant", {
      path: { encounterId },
      body: {
        medications: [{ name: "Synthetic medicine", frequency: "OD", duration: "2 days" }]
      },
      idempotencyKey: "cp13-assigned-provider-prescription"
    }),
    harness.context
  );
  const prescriptionId = entityId(prescription.body, "prescription");
  await assert.rejects(
    handlers.signPrescription(
      request("signPrescription", "doctor", {
        path: { prescriptionId },
        userId: SECOND_DOCTOR_ID,
        idempotencyKey: "cp13-unassigned-prescription-sign"
      }),
      harness.context
    ),
    hasStatus(403)
  );
  await handlers.signPrescription(
    request("signPrescription", "doctor", {
      path: { prescriptionId },
      idempotencyKey: "cp13-assigned-prescription-sign"
    }),
    harness.context
  );
});

test("CP13 raw audio storage and access require capture plus retention consent", async () => {
  const harness = createHarness();
  const handlers = createClinicalDentalHandlerMap(harness.dependencies);
  const captureConsent = await handlers.createPatientConsent(
    request("createPatientConsent", "assistant", {
      path: { patientId: PATIENT_ID },
      body: consentBody("ai_audio_capture"),
      idempotencyKey: "cp13-audio-capture-consent"
    }),
    harness.context
  );
  const bytes = new TextEncoder().encode("synthetic-audio");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const reserveRequest = (idempotencyKey: string) =>
    request("requestMediaUploadUrl", "assistant", {
      body: {
        patientId: PATIENT_ID,
        mediaType: "audio_chunk",
        originalFilename: "patient-spoken-name.wav",
        mimeType: "audio/wav",
        fileSizeBytes: bytes.byteLength,
        sha256Digest: digest
      },
      idempotencyKey
    });
  await assert.rejects(
    handlers.requestMediaUploadUrl(
      reserveRequest("cp13-audio-reserve-without-retention"),
      harness.context
    ),
    hasStatus(409)
  );
  const retentionConsent = await handlers.createPatientConsent(
    request("createPatientConsent", "assistant", {
      path: { patientId: PATIENT_ID },
      body: consentBody("raw_audio_retention"),
      idempotencyKey: "cp13-audio-retention-consent"
    }),
    harness.context
  );
  const reserved = await handlers.requestMediaUploadUrl(
    reserveRequest("cp13-audio-reserve-with-retention"),
    harness.context
  );
  const uploadId = entityId(reserved.body, "upload");
  assert.equal(
    entityField(reserved.body, "upload", "originalFilename"),
    `clinical-media-${uploadId}.wav`
  );
  await handlers.receiveMediaUploadContent(
    request("receiveMediaUploadContent", "assistant", {
      path: { uploadId },
      body: bytes,
      idempotencyKey: "cp13-audio-content"
    }),
    harness.context
  );
  const completed = await handlers.completeMediaUpload(
    request("completeMediaUpload", "assistant", {
      path: { uploadId },
      body: {
        patientId: PATIENT_ID,
        contentLength: bytes.byteLength,
        sha256Digest: digest,
        mimeType: "audio/wav"
      },
      idempotencyKey: "cp13-audio-complete"
    }),
    harness.context
  );
  const mediaAssetId = entityId(completed.body, "mediaAsset");
  await handlers.revokePatientConsent(
    request("revokePatientConsent", "assistant", {
      path: { patientId: PATIENT_ID, consentId: entityId(retentionConsent.body, "consent") },
      body: { reason: "Synthetic raw audio retention withdrawal" },
      idempotencyKey: "cp13-audio-retention-revoke"
    }),
    harness.context
  );
  await assert.rejects(
    handlers.createSignedMediaAccess(
      request("createSignedMediaAccess", "doctor", {
        path: { mediaAssetId },
        body: { expiresInSeconds: 60 },
        idempotencyKey: "cp13-audio-access-after-retention-revoke"
      }),
      harness.context
    ),
    hasStatus(409)
  );
  assert.equal(entityId(captureConsent.body, "consent").length, 36);
});

test("CP13 handler execution remains idempotent under the frozen mutation coordinator", async () => {
  const harness = createHarness();
  const handlers = createClinicalDentalHandlerMap(harness.dependencies);
  const coordinator = new InMemoryAtomicMutationCoordinator();
  const operationRequest = request("createPatientConsent", "assistant", {
    path: { patientId: PATIENT_ID },
    body: consentBody("treatment_registration"),
    idempotencyKey: "cp13-coordinator-retry"
  });
  const mutation = {
    identity: {
      tenantId: harness.scope.tenantId,
      clinicId: harness.scope.clinicId,
      actorUserId: CHECKPOINT1_SEED_IDS.users.assistant
    },
    idempotency: {
      operationId: "createPatientConsent",
      key: "cp13-coordinator-retry",
      requestDigest: "digest-one"
    },
    concurrency: null,
    versionAdvances: [],
    requestId: "cp13-idempotent-request",
    now: NOW
  } as const;
  const first = await coordinator.execute(mutation, () =>
    handlers.createPatientConsent(operationRequest, harness.context)
  );
  const replay = await coordinator.execute(mutation, () =>
    handlers.createPatientConsent(operationRequest, harness.context)
  );
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.response, first.response);
  assert.equal(
    harness.repository.consents.filter((consent) => consent.purpose === "treatment_registration")
      .length,
    1
  );
  assert.equal(
    harness.outboxEvents.filter((event) => event.eventType === "consent.created").length,
    1
  );
});

test("CP13 patient-supplied media cannot bypass inspection with not_required", async () => {
  const harness = createHarness({ inspectionScanStatus: "not_required" });
  const handlers = createClinicalDentalHandlerMap(harness.dependencies);
  for (const purpose of ["treatment_registration", "photo_capture"] as const) {
    await handlers.createPatientConsent(
      request("createPatientConsent", "assistant", {
        path: { patientId: PATIENT_ID },
        body: consentBody(purpose),
        idempotencyKey: `cp13-inspection-${purpose}`
      }),
      harness.context
    );
  }
  const bytes = new TextEncoder().encode("scan-required");
  const digest = createHash("sha256").update(bytes).digest("hex");
  const reserved = await handlers.requestMediaUploadUrl(
    request("requestMediaUploadUrl", "assistant", {
      body: {
        patientId: PATIENT_ID,
        mediaType: "intraoral_photo",
        originalFilename: "synthetic.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: bytes.byteLength,
        sha256Digest: digest
      },
      idempotencyKey: "cp13-inspection-reserve"
    }),
    harness.context
  );
  const uploadId = entityId(reserved.body, "upload");
  await handlers.receiveMediaUploadContent(
    request("receiveMediaUploadContent", "assistant", {
      path: { uploadId },
      body: bytes,
      idempotencyKey: "cp13-inspection-content"
    }),
    harness.context
  );
  await assert.rejects(
    handlers.completeMediaUpload(
      request("completeMediaUpload", "assistant", {
        path: { uploadId },
        body: {
          patientId: PATIENT_ID,
          contentLength: bytes.byteLength,
          sha256Digest: digest,
          mimeType: "image/jpeg"
        },
        idempotencyKey: "cp13-inspection-complete"
      }),
      harness.context
    ),
    hasStatus(503)
  );
  assert.equal(harness.repository.mediaAssets.length, 0);
});

test("CP13 media sanitizes client filenames and rejects invalid provider DTOs", async () => {
  const filenameHarness = createHarness();
  const filenameHandlers = createClinicalDentalHandlerMap(filenameHarness.dependencies);
  await grantConsents(filenameHandlers, filenameHarness.context, ["photo_capture"], "filename");
  await assert.rejects(
    filenameHandlers.requestMediaUploadUrl(
      request("requestMediaUploadUrl", "assistant", {
        body: {
          patientId: PATIENT_ID,
          mediaType: "intraoral_photo",
          originalFilename: "patient-name.pdf",
          mimeType: "image/jpeg",
          fileSizeBytes: 10
        },
        idempotencyKey: "cp13-invalid-filename-extension"
      }),
      filenameHarness.context
    ),
    hasStatus(400)
  );

  const uploadCases: ReadonlyArray<
    readonly [
      string,
      (input: Parameters<MediaStorageProvider["createUploadTarget"]>[0]) => MediaUploadTarget
    ]
  > = [
    [
      "method",
      (input) =>
        ({
          ...validUploadTarget(input),
          method: "POST"
        }) as unknown as MediaUploadTarget
    ],
    ["url", (input) => ({ ...validUploadTarget(input), uploadUrl: "http://media.test/upload" })],
    [
      "headers",
      (input) => ({
        ...validUploadTarget(input),
        requiredHeaders: {
          ...validUploadTarget(input).requiredHeaders,
          authorization: "private-provider-credential"
        }
      })
    ],
    [
      "expiry",
      (input) => ({
        ...validUploadTarget(input),
        expiresAt: new Date(Date.parse(input.expiresAt) + 1_000).toISOString()
      })
    ]
  ];
  for (const [caseName, createTarget] of uploadCases) {
    const harness = createHarness({
      storageOverrides: { createUploadTarget: async (input) => createTarget(input) }
    });
    const handlers = createClinicalDentalHandlerMap(harness.dependencies);
    await grantConsents(handlers, harness.context, ["photo_capture"], `upload-${caseName}`);
    await assert.rejects(
      handlers.requestMediaUploadUrl(
        request("requestMediaUploadUrl", "assistant", {
          body: {
            patientId: PATIENT_ID,
            mediaType: "intraoral_photo",
            originalFilename: "synthetic.jpg",
            mimeType: "image/jpeg",
            fileSizeBytes: 10
          },
          idempotencyKey: `cp13-invalid-upload-${caseName}`
        }),
        harness.context
      ),
      hasStatus(503),
      caseName
    );
  }

  const accessCases: ReadonlyArray<
    readonly [
      string,
      (
        input: Parameters<MediaStorageProvider["createSignedReadAccess"]>[0]
      ) => MediaSignedReadAccess
    ]
  > = [
    [
      "method",
      (input) =>
        ({ ...validSignedAccess(input), method: "POST" }) as unknown as MediaSignedReadAccess
    ],
    ["url", (input) => ({ ...validSignedAccess(input), signedUrl: "http://media.test/access" })],
    [
      "headers",
      (input) => ({
        ...validSignedAccess(input),
        headers: { authorization: "private-provider-credential" }
      })
    ],
    [
      "expiry",
      (input) => ({
        ...validSignedAccess(input),
        expiresAt: new Date(Date.parse(input.expiresAt) + 1_000).toISOString()
      })
    ]
  ];
  for (const [caseName, createAccess] of accessCases) {
    const harness = createHarness({
      storageOverrides: { createSignedReadAccess: async (input) => createAccess(input) }
    });
    const handlers = createClinicalDentalHandlerMap(harness.dependencies);
    const mediaAssetId = await createViewablePhotoAsset(
      handlers,
      harness.context,
      `access-${caseName}`
    );
    await assert.rejects(
      handlers.createSignedMediaAccess(
        request("createSignedMediaAccess", "doctor", {
          path: { mediaAssetId },
          body: { expiresInSeconds: 60 },
          idempotencyKey: `cp13-invalid-access-${caseName}`
        }),
        harness.context
      ),
      hasStatus(503),
      caseName
    );
  }
});

async function grantConsents(
  handlers: ClinicalDentalHandlerMap,
  context: ClinicFeatureExecutionContext,
  purposes: readonly string[],
  keyPrefix: string
): Promise<void> {
  for (const purpose of purposes) {
    await handlers.createPatientConsent(
      request("createPatientConsent", "assistant", {
        path: { patientId: PATIENT_ID },
        body: consentBody(purpose),
        idempotencyKey: `cp13-${keyPrefix}-${purpose}`
      }),
      context
    );
  }
}

async function createViewablePhotoAsset(
  handlers: ClinicalDentalHandlerMap,
  context: ClinicFeatureExecutionContext,
  keyPrefix: string
): Promise<UUID> {
  await grantConsents(handlers, context, ["photo_capture", "photo_sharing"], keyPrefix);
  const bytes = new TextEncoder().encode(`synthetic-${keyPrefix}`);
  const digest = createHash("sha256").update(bytes).digest("hex");
  const reserved = await handlers.requestMediaUploadUrl(
    request("requestMediaUploadUrl", "assistant", {
      body: {
        patientId: PATIENT_ID,
        mediaType: "intraoral_photo",
        originalFilename: "synthetic.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: bytes.byteLength,
        sha256Digest: digest
      },
      idempotencyKey: `cp13-${keyPrefix}-reserve`
    }),
    context
  );
  const uploadId = entityId(reserved.body, "upload");
  await handlers.receiveMediaUploadContent(
    request("receiveMediaUploadContent", "assistant", {
      path: { uploadId },
      body: bytes,
      idempotencyKey: `cp13-${keyPrefix}-content`
    }),
    context
  );
  const completed = await handlers.completeMediaUpload(
    request("completeMediaUpload", "assistant", {
      path: { uploadId },
      body: {
        patientId: PATIENT_ID,
        contentLength: bytes.byteLength,
        sha256Digest: digest,
        mimeType: "image/jpeg"
      },
      idempotencyKey: `cp13-${keyPrefix}-complete`
    }),
    context
  );
  return entityId(completed.body, "mediaAsset");
}

function validUploadTarget(
  input: Parameters<MediaStorageProvider["createUploadTarget"]>[0]
): MediaUploadTarget {
  return {
    method: "PUT",
    uploadUrl: `/v1/media/uploads/${input.uploadId}/content`,
    expiresAt: input.expiresAt,
    maxBytes: input.expectedFileSizeBytes,
    requiredHeaders: {
      "content-type": input.mimeType,
      "x-clinic-os-upload-id": input.uploadId
    }
  };
}

function validSignedAccess(
  input: Parameters<MediaStorageProvider["createSignedReadAccess"]>[0]
): MediaSignedReadAccess {
  return {
    method: "GET",
    signedUrl: "https://media.test/access/opaque-token",
    expiresAt: input.expiresAt,
    headers: { accept: input.mimeType }
  };
}

function createHarness(
  options: {
    readonly clinicId?: UUID;
    readonly repository?: LocalFixtureClinicOperationsRepository;
    readonly inspectionScanStatus?: MediaScanStatus;
    readonly storageOverrides?: DurableTestMediaStorageOptions;
  } = {}
) {
  const repository = options.repository ?? new LocalFixtureClinicOperationsRepository({ clock });
  const scope: RepositoryScope = {
    tenantId: CHECKPOINT1_SEED_IDS.tenantId,
    clinicId: options.clinicId ?? CHECKPOINT1_SEED_IDS.clinicId,
    actorUserId: CHECKPOINT1_SEED_IDS.users.assistant
  };
  const auditEvents: Array<Record<string, unknown>> = [];
  const outboxEvents: Array<{
    eventType: DomainEventType;
    idempotencyKey: string | null;
    payload: Record<string, unknown>;
  }> = [];
  const evidence: TransactionEvidencePort = {
    async appendAuditEvent(event) {
      auditEvents.push(event);
    },
    async appendOutboxEvent(event) {
      outboxEvents.push({
        eventType: event.eventType,
        idempotencyKey: event.idempotencyKey ?? null,
        payload: event.payload
      });
      await repository.appendOutboxEvent(scope, event);
    }
  };
  const storage = new DurableTestMediaStorage(options.storageOverrides);
  const dependencies: ClinicalDentalHandlerDependencies = {
    mediaStorage: storage,
    mediaInspection: {
      async inspect() {
        return {
          scanStatus: options.inspectionScanStatus ?? "clean",
          objectVersion: "test-version-1",
          dicomMetadata: {}
        };
      }
    },
    relationshipAuthority: {
      async patientExists(_context, patientId) {
        return repository.patients.some(
          (patient) =>
            patient.id === patientId &&
            patient.tenantId === scope.tenantId &&
            patient.clinicId === scope.clinicId
        );
      },
      async appointmentBelongsToPatient(_context, input) {
        return repository.appointments.some(
          (appointment) =>
            appointment.id === input.appointmentId &&
            appointment.patientId === input.patientId &&
            appointment.tenantId === scope.tenantId &&
            appointment.clinicId === scope.clinicId
        );
      },
      async providerCanOwnEncounter(_context, providerUserId) {
        return providerUserId === CHECKPOINT1_SEED_IDS.users.doctor;
      },
      async dentalFindingBelongsToPatient(_context, input) {
        return repository.dentalFindings.some(
          (finding) =>
            finding.id === input.dentalFindingId &&
            finding.patientId === input.patientId &&
            finding.tenantId === scope.tenantId &&
            finding.clinicId === scope.clinicId
        );
      }
    }
  };
  const createContext = (): ClinicFeatureExecutionContext => ({
    repositories: boundModules(repository, scope),
    evidence,
    requestGuards: {} as ClinicFeatureExecutionContext["requestGuards"],
    clock
  });
  return {
    repository,
    scope,
    auditEvents,
    outboxEvents,
    dependencies,
    createContext,
    context: createContext()
  };
}

function boundModules(
  repository: LocalFixtureClinicOperationsRepository,
  scope: RepositoryScope
): ClinicRepositoryModules {
  return new Proxy(
    {},
    {
      get(_target, _moduleName) {
        return new Proxy(
          {},
          {
            get(_module, operationName) {
              const operation = repository[operationName as keyof typeof repository];
              if (typeof operation !== "function") return undefined;
              return (...args: unknown[]) =>
                (
                  operation as (scope: RepositoryScope, ...args: unknown[]) => Promise<unknown>
                ).call(repository, scope, ...args);
            }
          }
        );
      }
    }
  ) as ClinicRepositoryModules;
}

function request<TOperationId extends ClinicalDentalOperationId>(
  operationId: TOperationId,
  role: ClinicRoleSlug,
  input: {
    readonly path?: Record<string, unknown>;
    readonly query?: Record<string, unknown>;
    readonly body?: unknown;
    readonly idempotencyKey?: string;
    readonly clinicId?: UUID;
    readonly userId?: UUID;
  }
): ClinicFeatureOperationRequest<TOperationId> {
  const clinicId = input.clinicId ?? CHECKPOINT1_SEED_IDS.clinicId;
  const userId =
    input.userId ??
    (role === "doctor" ? CHECKPOINT1_SEED_IDS.users.doctor : CHECKPOINT1_SEED_IDS.users.assistant);
  const accessContext = {
    tenant: { id: CHECKPOINT1_SEED_IDS.tenantId, status: "active" },
    user: { id: userId, status: "active" },
    roleAssignments: [{ tenantId: CHECKPOINT1_SEED_IDS.tenantId, clinicId, userId, roleSlug: role }]
  } as unknown as AccessContext;
  return {
    operationId,
    access: {
      context: accessContext,
      clinics: [],
      clinicId,
      clinic: { id: clinicId } as never
    },
    parsed: {
      path: (input.path ?? {}) as never,
      query: (input.query ?? {}) as never,
      headers: (input.idempotencyKey ? { "idempotency-key": input.idempotencyKey } : {}) as never,
      ...(input.body === undefined ? {} : { body: input.body as never })
    } as ParsedOperationRequest,
    metadata: {
      requestId: `request-${operationId}-${input.idempotencyKey ?? "read"}`,
      receivedAt: NOW,
      ipAddress: "127.0.0.1",
      userAgent: "cp13-clinical-dental-test"
    }
  };
}

function consentBody(purpose: string) {
  return {
    purpose,
    templateCode: `synthetic-${purpose}`,
    templateVersion: 1,
    captureMethod: "clinic_staff",
    evidence: { recorded: true },
    provenance: { source: "automated_test" }
  };
}

function entityId(body: unknown, key: string): UUID {
  const value = entityField(body, key, "id");
  assert.equal(typeof value, "string");
  return value as UUID;
}

function entityField(body: unknown, key: string, field: string): unknown {
  assert.ok(body && typeof body === "object");
  const entity = (body as Record<string, unknown>)[key];
  assert.ok(entity && typeof entity === "object");
  return (entity as Record<string, unknown>)[field];
}

function hasStatus(status: number) {
  return (error: unknown) => error instanceof Error && "status" in error && error.status === status;
}

function assertSafeMediaResponse(
  value: unknown,
  options: { readonly allowSignedUrl?: boolean } = {}
): void {
  walk(value, (key) => {
    assert.notEqual(key, "objectKey");
    assert.notEqual(key, "storageProvider");
    assert.notEqual(key, "storageRegion");
    assert.notEqual(key, "providerSecret");
    assert.notEqual(key, "localPath");
    if (!options.allowSignedUrl) assert.notEqual(key, "signedUrl");
  });
}

function walk(value: unknown, visitKey: (key: string) => void): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visitKey));
    return;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    visitKey(key);
    walk(child, visitKey);
  }
}

const clock: Clock = { now: () => new Date(NOW.getTime()) };

interface DurableTestMediaStorageOptions {
  readonly createUploadTarget?: MediaStorageProvider["createUploadTarget"];
  readonly createSignedReadAccess?: MediaStorageProvider["createSignedReadAccess"];
  readonly includePrivateProviderFields?: boolean;
}

class DurableTestMediaStorage implements MediaStorageProvider {
  readonly providerKey = "local_simulator" as const;
  readonly region = "test-region";
  readonly objects = new Map<string, StoredMediaObject>();
  readonly options: DurableTestMediaStorageOptions;

  constructor(options: DurableTestMediaStorageOptions = {}) {
    this.options = options;
  }

  buildObjectKey(input: { uploadId: UUID }): string {
    return `private/test/${input.uploadId}`;
  }

  async createUploadTarget(
    input: Parameters<MediaStorageProvider["createUploadTarget"]>[0]
  ): Promise<MediaUploadTarget> {
    const target = this.options.createUploadTarget
      ? await this.options.createUploadTarget(input)
      : {
          method: "PUT",
          uploadUrl: `/v1/media/uploads/${input.uploadId}/content`,
          expiresAt: input.expiresAt,
          maxBytes: input.expectedFileSizeBytes,
          requiredHeaders: {
            "content-type": input.mimeType,
            "x-clinic-os-upload-id": input.uploadId
          }
        };
    return this.withPrivateProviderFields(target);
  }

  async receiveUpload(input: {
    objectKey: string;
    body: Buffer;
    mimeType: string;
    metadata: Record<string, string>;
  }): Promise<StoredMediaObject> {
    const stored: StoredMediaObject = {
      objectKey: input.objectKey,
      contentLength: input.body.byteLength,
      mimeType: input.mimeType,
      sha256Digest: createHash("sha256").update(input.body).digest("hex"),
      metadata: input.metadata,
      storedAt: NOW.toISOString()
    };
    this.objects.set(input.objectKey, stored);
    return stored;
  }

  async statObject(objectKey: string): Promise<StoredMediaObject | null> {
    return this.objects.get(objectKey) ?? null;
  }

  async createSignedReadAccess(
    input: Parameters<MediaStorageProvider["createSignedReadAccess"]>[0]
  ): Promise<MediaSignedReadAccess> {
    assert.ok(this.objects.has(input.objectKey));
    const access = this.options.createSignedReadAccess
      ? await this.options.createSignedReadAccess(input)
      : {
          method: "GET" as const,
          signedUrl: "https://media.test/access/opaque-token",
          expiresAt: input.expiresAt,
          headers: { accept: input.mimeType }
        };
    return this.withPrivateProviderFields(access);
  }

  private withPrivateProviderFields<T extends MediaUploadTarget | MediaSignedReadAccess>(
    value: T
  ): T {
    if (this.options.includePrivateProviderFields === false) return value;
    return {
      ...value,
      objectKey: "private/provider/object-key",
      providerSecret: "test-only-provider-secret",
      localPath: "/private/provider/path"
    } as T;
  }
}
