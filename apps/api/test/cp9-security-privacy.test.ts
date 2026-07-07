import assert from "node:assert/strict";
import test from "node:test";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import type { ClinicRoleSlug } from "@clinic-os/domain";
import {
  createAiScribeSession,
  createAiScribeTranscriptSegment,
  createBreakGlassAccessRequest,
  createDeletionRequest,
  createEncounter,
  createPatientConsent,
  createPatientRecordExport,
  listAuditReviewEvents,
  listPatientRecordExports,
  reviewAuditEvent,
  reviewBreakGlassAccessRequest,
  reviewDeletionRequest,
  runRetentionJob,
  startEncounter,
  InMemoryAuditSink,
  LocalFixtureClinicOperationsRepository,
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

test("CP9 audit review records immutable review evidence with PHI-redacted metadata", async () => {
  const dependencies = dependenciesForCp9();
  const auditor = operationsContext("auditor", "auditor", "cp9-audit-list");
  const owner = operationsContext("owner_admin", "owner", "cp9-audit-review");

  const events = await listAuditReviewEvents(auditor, dependencies, {
    patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
    category: "phi_access"
  });
  assert.equal(events.status, 200);
  assert.equal(events.body.auditEvents.length, 1);
  assert.equal(events.body.auditEvents[0].metadata.patientName, "[REDACTED]");

  const review = await reviewAuditEvent(owner, dependencies, events.body.auditEvents[0].id, {
    reviewStatus: "escalated",
    disposition: "Unexpected after-hours record view requires owner follow-up.",
    notes: "Reviewed as CP9 security lane evidence."
  });
  assert.equal(review.status, 201);
  assert.equal(review.body.review.reviewStatus, "escalated");
  assert.ok(dependencies.auditSink.events.some((event) => event.action === "audit_event.reviewed"));
  assert.ok(dependencies.repository.outboxEvents.some((event) => event.eventType === "audit_event.reviewed"));
});

test("CP9 patient record export includes safe payload and export evidence", async () => {
  const dependencies = dependenciesForCp9();
  const owner = operationsContext("owner_admin", "owner", "cp9-export");
  await createRetainableAiTranscript(owner, dependencies);

  const exported = await createPatientRecordExport(
    owner,
    dependencies,
    CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
    {
      sections: ["demographics", "media", "ai_evidence", "privacy_audit"],
      reason: "Patient requested complete handover export."
    }
  );
  assert.equal(exported.status, 201);
  assert.equal(exported.body.export.status, "completed");
  assert.equal(exported.body.export.payloadDigest.length, 64);
  assert.equal(exported.body.export.payload.manifest.safety.rawStorageReferences, "excluded");
  assert.equal(exported.body.export.payload.privacyAuditTrail[0].metadata.patientName, "[REDACTED]");

  const serialized = JSON.stringify(exported.body.export.payload);
  assert.equal(serialized.includes("objectKey"), false);
  assert.equal(serialized.includes("storageProvider"), false);
  assert.equal(serialized.includes("storageRegion"), false);
  assert.equal(/"rawProviderPayload"\s*:/.test(serialized), false);
  assert.equal(/"privatePayload"\s*:/.test(serialized), false);
  assert.ok(dependencies.auditSink.events.some((event) => event.action === "patient.record.exported"));
  assert.ok(
    dependencies.repository.outboxEvents.some(
      (event) => event.eventType === "patient.record_export.completed"
    )
  );

  const listed = await listPatientRecordExports(
    owner,
    dependencies,
    CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
    {}
  );
  assert.equal(listed.body.exports.length, 1);
  assert.equal("payload" in listed.body.exports[0], false);
});

test("CP9 deletion request and retention run only remove eligible transient payloads", async () => {
  const dependencies = dependenciesForCp9();
  const owner = operationsContext("owner_admin", "owner", "cp9-retention");
  await createRetainableAiTranscript(owner, dependencies);
  assert.equal(dependencies.repository.aiTranscriptSegments.length, 1);

  const request = await createDeletionRequest(owner, dependencies, {
    patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
    requestType: "transient_payload_redaction",
    reason: "Patient requested redaction of transient AI transcript payloads.",
    requestedCategories: ["ai_transient_payloads"]
  });
  assert.equal(request.body.deletionRequest.scope.protectedClinicalRecords, "not_deleted");
  assert.equal(request.body.deletionRequest.scope.protectedAuditRecords, "not_deleted");

  const reviewed = await reviewDeletionRequest(owner, dependencies, request.body.deletionRequest.id, {
    decision: "approve",
    reviewReason: "Only transient AI payloads are eligible; clinical and audit records stay protected."
  });
  assert.equal(reviewed.body.deletionRequest.status, "approved_pending_retention_job");

  const dryRun = await runRetentionJob(owner, dependencies, {
    mode: "dry_run",
    asOf: "2026-07-08T00:00:00.000Z",
    patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
    deletionRequestId: request.body.deletionRequest.id,
    transcriptDeleteAfterDays: 0
  });
  assert.equal(dryRun.status, 202);
  assert.equal(dryRun.body.retentionRun.summary.eligibleTransientPayloads, 1);
  assert.equal(dependencies.repository.aiTranscriptSegments.length, 1);
  assert.ok(dryRun.body.actions.some((action) => action.status === "planned"));
  assert.equal(dryRun.body.actions.filter((action) => action.protectedRecord).length, 2);

  const executed = await runRetentionJob(owner, dependencies, {
    mode: "execute",
    asOf: "2026-07-08T00:00:00.000Z",
    patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
    deletionRequestId: request.body.deletionRequest.id,
    transcriptDeleteAfterDays: 0
  });
  assert.equal(executed.body.retentionRun.summary.completedActions, 1);
  assert.equal(dependencies.repository.aiTranscriptSegments.length, 0);
  assert.equal(dependencies.repository.clinicalNoteVersions.length, 0);
  assert.equal(dependencies.repository.deletionRequests[0].status, "completed");
  assert.ok(executed.body.actions.some((action) => action.actionKind === "protected_audit_record_skipped"));
  assert.ok(dependencies.auditSink.events.some((event) => event.action === "retention.job.completed"));
});

test("CP9 break-glass requires reason scope expiry and owner review without permanent access", async () => {
  const dependencies = dependenciesForCp9();
  const doctor = operationsContext("doctor", "doctor", "cp9-break-glass-request");
  const owner = operationsContext("owner_admin", "owner", "cp9-break-glass-review");

  await assert.rejects(
    () =>
      createBreakGlassAccessRequest(doctor, dependencies, {
        patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
        reason: "too short",
        expiresAt: "2026-07-07T12:00:00.000Z",
        accessCategories: ["patient_record"]
      }),
    (error) => error instanceof Error && "status" in error && error.status === 400
  );

  const requested = await createBreakGlassAccessRequest(doctor, dependencies, {
    patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
    reason: "Emergency continuity review before urgent referral.",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    accessCategories: ["patient_record", "clinical_notes"]
  });
  assert.equal(requested.body.breakGlassAccess.status, "requested");
  assert.equal(requested.body.breakGlassAccess.reviewedByUserId, null);

  const approved = await reviewBreakGlassAccessRequest(
    owner,
    dependencies,
    requested.body.breakGlassAccess.id,
    {
      decision: "approve",
      reviewReason: "Owner approved limited emergency continuity access."
    }
  );
  assert.equal(approved.body.breakGlassAccess.status, "approved");
  assert.equal(approved.body.breakGlassAccess.reviewedByUserId, CHECKPOINT1_SEED_IDS.users.owner);
  assert.equal(approved.body.breakGlassAccess.revokedAt, null);

  const active = await dependencies.repository.findActiveBreakGlassAccess(
    {
      tenantId: CHECKPOINT1_SEED_IDS.tenantId,
      clinicId: CHECKPOINT1_SEED_IDS.clinicId,
      actorUserId: CHECKPOINT1_SEED_IDS.users.doctor
    },
    {
      patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
      userId: CHECKPOINT1_SEED_IDS.users.doctor,
      requiredCategory: "clinical_notes",
      at: new Date().toISOString()
    }
  );
  assert.equal(active?.id, requested.body.breakGlassAccess.id);

  const revoked = await reviewBreakGlassAccessRequest(
    owner,
    dependencies,
    requested.body.breakGlassAccess.id,
    {
      decision: "revoke",
      reviewReason: "Emergency continuity access is no longer required."
    }
  );
  assert.equal(revoked.body.breakGlassAccess.status, "revoked");
  assert.ok(revoked.body.breakGlassAccess.revokedAt);
  assert.ok(dependencies.auditSink.events.some((event) => event.action === "break_glass.revoked"));
});

function dependenciesForCp9(): OperationsDependencies & {
  repository: LocalFixtureClinicOperationsRepository;
  auditSink: InMemoryAuditSink;
} {
  const repository = new LocalFixtureClinicOperationsRepository();
  const auditSink = new InMemoryAuditSink();
  return { repository, auditSink, runtimeConfig: config };
}

async function createRetainableAiTranscript(
  context: OperationsRequestContext,
  dependencies: OperationsDependencies
) {
  const encounter = await createEncounter(context, dependencies, {
    patientId: CHECKPOINT1_SEED_IDS.patients.rheaSynthetic,
    providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
    reason: "CP9 transient retention evidence"
  });
  await startEncounter(context, dependencies, encounter.body.encounter.id);
  await createPatientConsent(context, dependencies, CHECKPOINT1_SEED_IDS.patients.rheaSynthetic, {
    purpose: "ai_audio_capture",
    templateCode: "ai-audio-v1",
    templateVersion: 1,
    captureMethod: "clinic_staff"
  });
  const session = await createAiScribeSession(context, dependencies, encounter.body.encounter.id, {
    captureSurface: "mobile",
    requireRawAudioRetention: false
  });
  await createAiScribeTranscriptSegment(context, dependencies, session.body.session.id, {
    text: "Synthetic transcript payload eligible for CP9 retention deletion.",
    startsAtMs: 0,
    endsAtMs: 1200
  });
}

function operationsContext(
  role: ClinicRoleSlug,
  userKey: keyof typeof CHECKPOINT1_SEED_IDS.users,
  requestId: string
): OperationsRequestContext {
  return {
    requestId,
    clinicId: CHECKPOINT1_SEED_IDS.clinicId,
    accessContext: {
      principal: {
        subject: `local-${role}`,
        issuer: "http://localhost:8080/realms/clinic-os-local",
        email: null,
        displayName: `CP9 ${role}`,
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
        displayName: `CP9 ${role}`,
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
