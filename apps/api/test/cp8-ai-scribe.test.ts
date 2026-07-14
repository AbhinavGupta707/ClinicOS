import assert from "node:assert/strict";
import test from "node:test";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import type { ClinicRoleSlug } from "@clinic-os/domain";
import {
  createAiScribeSession,
  createAiScribeSourceAnchor,
  createAiScribeTranscriptSegment,
  createEncounter,
  createPatientConsent,
  deleteAiScribeRetainedPayloads,
  generateAiScribeDrafts,
  getAiScribeSession,
  InMemoryAuditSink,
  LocalFixtureClinicOperationsRepository,
  recordAiScribeReviewDecision,
  revokePatientConsent,
  startEncounter,
  type OperationsDependencies,
  type OperationsRequestContext
} from "../src/index.ts";

const config = {
  nodeEnv: "development",
  clinicOsEnv: "local",
  isProductionLike: false,
  services: {
    databaseUrl: "postgresql://clinic_os:clinic_os@localhost:5432/clinic_os",
    redisUrl: "redis://localhost:6379",
    temporalAddress: "localhost:7233"
  },
  auth: {
    keycloakBaseUrl: "http://localhost:8080",
    keycloakRealm: "clinic-os-local",
    keycloakClientId: "clinic-os-web"
  },
  storage: {
    region: "ap-south-1",
    bucket: "clinic-os-local"
  },
  providers: {
    whatsapp: { provider: "simulator", appSecretProofRequired: false },
    payment: { provider: "simulator", qrMode: "payment_link_qr" },
    telephony: { provider: "simulator", regionSubdomain: "api.in.exotel.com" },
    ai: { llmProvider: "simulator", transcriptionProvider: "simulator" }
  },
  pilotInputs: {
    syntheticDataOnly: true
  }
};

test("CP8 AI scribe blocks missing consent before capture", async () => {
  const dependencies = dependenciesForCp8();
  const assistant = operationsContext("assistant", "assistant", "cp8-no-consent");
  const encounter = await createStartedEncounter(assistant, dependencies);

  await assert.rejects(
    () =>
      createAiScribeSession(assistant, dependencies, encounter.body.encounter.id, {
        captureSurface: "mobile"
      }),
    (error) =>
      error instanceof Error &&
      "status" in error &&
      error.status === 409 &&
      "details" in error &&
      typeof error.details === "object" &&
      error.details !== null &&
      "code" in error.details &&
      error.details.code === "AI_AUDIO_CONSENT_REQUIRED"
  );

  assert.equal(dependencies.repository.aiSessions.length, 0);
  assert.ok(
    dependencies.auditSink.events.some((event) => event.action === "consent.enforcement.checked")
  );
});

test("CP8 simulator generates review-only outputs without exposing transcript text", async () => {
  const dependencies = dependenciesForCp8();
  const assistant = operationsContext("assistant", "assistant", "cp8-sim");
  const doctor = operationsContext("doctor", "doctor", "cp8-review");
  const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;
  const encounter = await createStartedEncounter(assistant, dependencies);
  await createPatientConsent(assistant, dependencies, patientId, {
    purpose: "ai_audio_capture",
    templateCode: "ai-audio-v1",
    templateVersion: 1,
    captureMethod: "clinic_staff",
    provenance: { kind: "manual_entry" }
  });

  const session = await createAiScribeSession(
    assistant,
    dependencies,
    encounter.body.encounter.id,
    {
      captureSurface: "mobile",
      languageHint: "en-IN"
    }
  );
  assert.equal(session.body.session.providerMode, "simulator");
  assert.equal(session.body.session.retentionPolicy.providerTrainingAllowed, false);

  const segment = await createAiScribeTranscriptSegment(
    assistant,
    dependencies,
    session.body.session.id,
    {
      speakerRole: "doctor",
      text: "Patient reports pain near tooth 36 and visible caries.",
      startsAtMs: 0,
      endsAtMs: 4400
    }
  );
  assert.equal(segment.body.segment.textDigest.length, 64);
  assert.equal("text" in segment.body.segment, false);

  const generated = await generateAiScribeDrafts(
    assistant,
    dependencies,
    session.body.session.id,
    {}
  );
  assert.equal(generated.status, 201);
  assert.equal(generated.body.draftOutputs.length, 2);
  assert.equal(generated.body.actionProposals.length, 1);
  assert.equal(dependencies.repository.clinicalNoteVersions.length, 0);
  assert.equal(dependencies.repository.dentalFindings.length, 0);

  const detail = await getAiScribeSession(doctor, dependencies, session.body.session.id);
  assert.equal(detail.body.aiScribeSession.transcriptSegments[0].textDigest.length, 64);
  assert.equal("text" in detail.body.aiScribeSession.transcriptSegments[0], false);

  const approved = await recordAiScribeReviewDecision(
    doctor,
    dependencies,
    session.body.session.id,
    {
      targetType: "draft_output",
      targetId: generated.body.draftOutputs[0].id,
      decision: "approve",
      reason: "Reviewed transcript anchors; keep as AI draft evidence only."
    }
  );
  assert.equal(approved.body.reviewDecision.appliedWorkflow, "review_only");
  assert.equal(approved.body.reviewDecision.appliedRecordId, null);
  assert.equal(dependencies.repository.clinicalNoteVersions.length, 0);
  assert.ok(
    dependencies.repository.outboxEvents.some(
      (event) => event.eventType === "ai.review_decision.recorded"
    )
  );
});

test("CP8 revoked consent blocks later transcript processing", async () => {
  const dependencies = dependenciesForCp8();
  const assistant = operationsContext("assistant", "assistant", "cp8-revoked");
  const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;
  const encounter = await createStartedEncounter(assistant, dependencies);
  const consent = await createPatientConsent(assistant, dependencies, patientId, {
    purpose: "ai_audio_capture",
    templateCode: "ai-audio-v1",
    templateVersion: 1,
    captureMethod: "clinic_staff"
  });
  const session = await createAiScribeSession(
    assistant,
    dependencies,
    encounter.body.encounter.id,
    {}
  );
  await revokePatientConsent(assistant, dependencies, patientId, consent.body.consent.id, {
    reason: "Patient stopped recording consent"
  });

  await assert.rejects(
    () =>
      createAiScribeTranscriptSegment(assistant, dependencies, session.body.session.id, {
        text: "This segment must be blocked after revocation.",
        startsAtMs: 0,
        endsAtMs: 1000
      }),
    (error) => error instanceof Error && "status" in error && error.status === 409
  );
  assert.equal(dependencies.repository.aiTranscriptSegments.length, 0);
});

test("CP8 unsupported source anchors block draft generation", async () => {
  const dependencies = dependenciesForCp8();
  const assistant = operationsContext("assistant", "assistant", "cp8-anchor");
  const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;
  const encounter = await createStartedEncounter(assistant, dependencies);
  await createPatientConsent(assistant, dependencies, patientId, {
    purpose: "ai_audio_capture",
    templateCode: "ai-audio-v1",
    templateVersion: 1,
    captureMethod: "clinic_staff"
  });
  const session = await createAiScribeSession(
    assistant,
    dependencies,
    encounter.body.encounter.id,
    {}
  );
  await createAiScribeTranscriptSegment(assistant, dependencies, session.body.session.id, {
    text: "Tooth 36 pain with caries.",
    startsAtMs: 0,
    endsAtMs: 1000
  });
  const unsupported = await createAiScribeSourceAnchor(
    assistant,
    dependencies,
    session.body.session.id,
    {
      anchorType: "external_document",
      sourceRecordType: "legacy_pdf",
      sourceRecordId: "legacy-note-1",
      supported: false,
      unsupportedReason: "external_document_parser_not_enabled"
    }
  );

  await assert.rejects(
    () =>
      generateAiScribeDrafts(assistant, dependencies, session.body.session.id, {
        sourceAnchorIds: [unsupported.body.sourceAnchor.id]
      }),
    (error) => error instanceof Error && "status" in error && error.status === 400
  );
});

test("CP8 retention deletion removes transcript payloads but keeps evaluation outputs", async () => {
  const dependencies = dependenciesForCp8();
  const assistant = operationsContext("assistant", "assistant", "cp8-retention");
  const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;
  const encounter = await createStartedEncounter(assistant, dependencies);
  await createPatientConsent(assistant, dependencies, patientId, {
    purpose: "ai_audio_capture",
    templateCode: "ai-audio-v1",
    templateVersion: 1,
    captureMethod: "clinic_staff"
  });
  const session = await createAiScribeSession(
    assistant,
    dependencies,
    encounter.body.encounter.id,
    {}
  );
  await createAiScribeTranscriptSegment(assistant, dependencies, session.body.session.id, {
    text: "Tooth 36 pain with caries.",
    startsAtMs: 0,
    endsAtMs: 1000
  });
  await generateAiScribeDrafts(assistant, dependencies, session.body.session.id, {});

  const deleted = await deleteAiScribeRetainedPayloads(
    assistant,
    dependencies,
    session.body.session.id
  );
  assert.equal(deleted.body.deletedTranscriptSegments, 1);
  assert.equal(dependencies.repository.aiTranscriptSegments.length, 0);
  assert.equal(dependencies.repository.aiDraftOutputs.length, 2);
  assert.equal(deleted.body.session.status, "retention_deleted");
  assert.ok(
    dependencies.repository.outboxEvents.some((event) => event.eventType === "ai.retention.deleted")
  );
});

function dependenciesForCp8(): OperationsDependencies & {
  repository: LocalFixtureClinicOperationsRepository;
  auditSink: InMemoryAuditSink;
} {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  return { repository, auditSink, runtimeConfig: config };
}

async function createStartedEncounter(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  const encounter = await createEncounter(context, dependencies, {
    patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
    providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
    reason: "CP8 AI scribe consultation"
  });
  await startEncounter(context, dependencies, encounter.body.encounter.id);
  return encounter;
}

function operationsContext(
  role: ClinicRoleSlug,
  userKey: keyof typeof CHECKPOINT1_SEED_IDS.users,
  requestId: string
): OperationsRequestContext {
  return {
    requestId,
    idempotencyKey: `${requestId}-idempotency`,
    clinicId: CHECKPOINT1_SEED_IDS.clinicId,
    accessContext: {
      principal: {
        subject: `local-${role}`,
        issuer: "http://localhost:8080/realms/clinic-os-local",
        email: null,
        displayName: `CP8 ${role}`,
        username: null,
        keycloakRoles: [role]
      },
      tenant: {
        id: CHECKPOINT1_SEED_IDS.tenantId,
        slug: "clinicos-synthetic-tenant",
        legalName: "ClinicOS Synthetic Dental Private Limited",
        displayName: "ClinicOS Synthetic Tenant",
        status: "active"
      },
      user: {
        id: CHECKPOINT1_SEED_IDS.users[userKey],
        displayName: `CP8 ${role}`,
        email: `${role}@example.test`,
        phone: null,
        status: "active"
      },
      memberships: [
        {
          tenantId: CHECKPOINT1_SEED_IDS.tenantId,
          userId: CHECKPOINT1_SEED_IDS.users[userKey],
          status: "active"
        }
      ],
      clinicAssignments: [
        {
          tenantId: CHECKPOINT1_SEED_IDS.tenantId,
          clinicId: CHECKPOINT1_SEED_IDS.clinicId,
          userId: CHECKPOINT1_SEED_IDS.users[userKey],
          status: "active"
        }
      ],
      roleAssignments: [
        {
          tenantId: CHECKPOINT1_SEED_IDS.tenantId,
          clinicId: CHECKPOINT1_SEED_IDS.clinicId,
          userId: CHECKPOINT1_SEED_IDS.users[userKey],
          roleSlug: role
        }
      ],
      roleSlugs: [role],
      permissions: []
    }
  };
}
