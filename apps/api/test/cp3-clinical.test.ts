import assert from "node:assert/strict";
import test from "node:test";
import { CHECKPOINT1_SEED_IDS } from "@clinic-os/db";
import type { ClinicRoleSlug } from "@clinic-os/domain";
import {
  amendEncounterClinicalNote,
  createClinicOsApiServer,
  createEncounter,
  createEncounterPrescription,
  createPatientConsent,
  InMemoryAuditSink,
  listIntakeFormTemplates,
  LocalFixtureClinicOperationsRepository,
  LocalFixtureIdentityRepository,
  revokePatientConsent,
  saveEncounterClinicalNoteDraft,
  signEncounterClinicalNote,
  signPrescription,
  startEncounter,
  submitPatientIntakeForm,
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

test("CP3 operations enforce consent state, note immutability, and doctor-only prescription signing", async () => {
  const auditSink = new InMemoryAuditSink();
  const operationsRepository = new LocalFixtureClinicOperationsRepository();
  const dependencies: OperationsDependencies = {
    repository: operationsRepository,
    auditSink
  };
  const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;
  const assistant = operationsContext("assistant", "assistant", "cp3-direct-assistant");
  const doctor = operationsContext("doctor", "doctor", "cp3-direct-doctor");

  const templates = await listIntakeFormTemplates(assistant, dependencies);
  const templateId = templates.body.templates[0].id;
  const intake = await submitPatientIntakeForm(assistant, dependencies, patientId, {
    templateId,
    source: "assistant_paper_card",
    responses: { chiefComplaint: "Pain on biting" },
    medicalHistorySnapshot: { allergies: ["penicillin"] },
    provenance: { kind: "manual_entry" }
  });
  assert.equal(intake.status, 201);

  const consent = await createPatientConsent(assistant, dependencies, patientId, {
    purpose: "ai_audio_capture",
    templateCode: "ai-audio-v1",
    templateVersion: 1,
    captureMethod: "clinic_staff",
    provenance: { kind: "manual_entry" }
  });
  assert.equal(consent.body.enforcementState.aiAudioCaptureAllowed, true);

  const revoked = await revokePatientConsent(
    assistant,
    dependencies,
    patientId,
    consent.body.consent.id,
    { reason: "Patient withdrew AI/audio consent" }
  );
  assert.equal(revoked.body.enforcementState.aiAudioCaptureAllowed, false);

  const encounter = await createEncounter(assistant, dependencies, {
    patientId,
    providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
    reason: "Initial consultation"
  });
  await startEncounter(assistant, dependencies, encounter.body.encounter.id);
  const draft = await saveEncounterClinicalNoteDraft(
    assistant,
    dependencies,
    encounter.body.encounter.id,
    {
      content: {
        examination: "Tenderness on percussion",
        diagnosis: "Symptomatic apical periodontitis"
      },
      readyForSign: true
    }
  );
  assert.equal(draft.body.note.status, "draft");

  await assert.rejects(
    () => signEncounterClinicalNote(assistant, dependencies, encounter.body.encounter.id),
    (error) =>
      error instanceof Error &&
      "requiredPermission" in error &&
      error.requiredPermission === "clinical.note.sign"
  );

  const signed = await signEncounterClinicalNote(doctor, dependencies, encounter.body.encounter.id);
  assert.equal(signed.body.note.status, "signed");

  await assert.rejects(
    () =>
      saveEncounterClinicalNoteDraft(doctor, dependencies, encounter.body.encounter.id, {
        content: { diagnosis: "Silent overwrite" }
      }),
    (error) => error instanceof Error && "status" in error && error.status === 409
  );

  const amended = await amendEncounterClinicalNote(
    doctor,
    dependencies,
    encounter.body.encounter.id,
    {
      amendmentReason: "Add follow-up advice",
      content: { followUpInstructions: "Return if swelling develops" }
    }
  );
  assert.equal(amended.body.note.amendedFromVersionId, signed.body.note.id);

  const prescription = await createEncounterPrescription(
    assistant,
    dependencies,
    encounter.body.encounter.id,
    {
      medications: [
        {
          name: "Ibuprofen",
          frequency: "TDS",
          duration: "3 days"
        }
      ]
    }
  );
  assert.equal(prescription.body.prescription.status, "draft");

  await assert.rejects(
    () => signPrescription(assistant, dependencies, prescription.body.prescription.id),
    (error) =>
      error instanceof Error &&
      "requiredPermission" in error &&
      error.requiredPermission === "prescription.sign"
  );

  const signedPrescription = await signPrescription(
    doctor,
    dependencies,
    prescription.body.prescription.id
  );
  assert.equal(signedPrescription.body.prescription.status, "signed");
  assert.ok(operationsRepository.outboxEvents.some((event) => event.eventType === "consent.revoked"));
  assert.ok(
    operationsRepository.outboxEvents.some((event) => event.eventType === "clinical_note.signed")
  );
  assert.ok(
    operationsRepository.outboxEvents.some((event) => event.eventType === "prescription.signed")
  );
  assert.ok(auditSink.events.some((event) => event.action === "prescription.draft_created"));
});

test("CP3 local fixture API supports intake consent encounter note and prescription workflow", async (t) => {
  const auditSink = new InMemoryAuditSink();
  const operationsRepository = new LocalFixtureClinicOperationsRepository();
  const server = createClinicOsApiServer({
    config,
    identityRepository: new LocalFixtureIdentityRepository(),
    operationsRepository,
    auditSink,
    useLocalAuthFixture: true
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      t.skip(
        "Socket binding is blocked in this sandbox; run the API boot smoke outside the sandbox."
      );
      return;
    }

    throw error;
  }

  try {
    const address = server.address();
    assert.equal(typeof address, "object");
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const patientId = CHECKPOINT1_SEED_IDS.patients.rheaSynthetic;

    const templatesResponse = await fetch(`${baseUrl}/v1/form-templates`, {
      headers: assistantHeaders()
    });
    assert.equal(templatesResponse.status, 200);
    const templatesBody = await templatesResponse.json();
    const templateId = templatesBody.templates[0].id;

    const intakeResponse = await postJson(
      baseUrl,
      `/v1/patients/${patientId}/form-responses`,
      {
        templateId,
        source: "assistant_paper_card",
        responses: {
          chiefComplaint: "Pain on biting",
          allergies: ["penicillin"]
        },
        medicalHistorySnapshot: {
          allergies: ["penicillin"]
        },
        provenance: {
          kind: "manual_entry",
          paperCardRef: "local-fixture-card-1"
        }
      },
      assistantHeaders({ "idempotency-key": "cp3-intake" })
    );
    assert.equal(intakeResponse.status, 201);
    assert.equal((await intakeResponse.json()).formResponse.source, "assistant_paper_card");

    const consentResponse = await postJson(
      baseUrl,
      `/v1/patients/${patientId}/consents`,
      {
        purpose: "ai_audio_capture",
        templateCode: "ai-audio-v1",
        templateVersion: 1,
        captureMethod: "clinic_staff",
        grantedByName: "Rhea Synthetic",
        relationshipToPatient: "self",
        provenance: {
          kind: "manual_entry"
        }
      },
      assistantHeaders({ "idempotency-key": "cp3-consent-create" })
    );
    assert.equal(consentResponse.status, 201);
    const consentBody = await consentResponse.json();
    assert.equal(consentBody.enforcementState.aiAudioCaptureAllowed, true);

    const revokeResponse = await postJson(
      baseUrl,
      `/v1/patients/${patientId}/consents/${consentBody.consent.id}/revoke`,
      {
        reason: "Patient withdrew AI/audio consent"
      },
      assistantHeaders({ "idempotency-key": "cp3-consent-revoke" })
    );
    assert.equal(revokeResponse.status, 200);
    const revokeBody = await revokeResponse.json();
    assert.equal(revokeBody.enforcementState.aiAudioCaptureAllowed, false);
    assert.deepEqual(revokeBody.enforcementState.revokedPurposes, ["ai_audio_capture"]);

    const encounterResponse = await postJson(
      baseUrl,
      "/v1/encounters",
      {
        patientId,
        providerUserId: CHECKPOINT1_SEED_IDS.users.doctor,
        reason: "Initial consultation",
        medicalHistorySnapshot: {
          allergies: ["penicillin"]
        }
      },
      assistantHeaders({ "idempotency-key": "cp3-encounter-create" })
    );
    assert.equal(encounterResponse.status, 201);
    const encounterBody = await encounterResponse.json();

    const startResponse = await postJson(
      baseUrl,
      `/v1/encounters/${encounterBody.encounter.id}/start`,
      {},
      assistantHeaders({ "idempotency-key": "cp3-encounter-start" })
    );
    assert.equal(startResponse.status, 200);
    assert.equal((await startResponse.json()).encounter.status, "drafting");

    const draftResponse = await patchJson(
      baseUrl,
      `/v1/encounters/${encounterBody.encounter.id}`,
      {
        content: {
          chiefComplaint: "Pain on biting",
          examination: "Tenderness on percussion",
          diagnosis: "Symptomatic apical periodontitis",
          treatmentPlan: "RCT discussion and analgesic prescription"
        },
        readyForSign: true
      },
      assistantHeaders({ "idempotency-key": "cp3-note-draft" })
    );
    assert.equal(draftResponse.status, 200);
    const draftBody = await draftResponse.json();
    assert.equal(draftBody.note.status, "draft");

    const assistantSignResponse = await postJson(
      baseUrl,
      `/v1/encounters/${encounterBody.encounter.id}/sign-note`,
      {},
      assistantHeaders({ "idempotency-key": "cp3-note-sign-denied" })
    );
    assert.equal(assistantSignResponse.status, 403);
    assert.equal((await assistantSignResponse.json()).error.details.required_permission, "clinical.note.sign");

    const doctorSignResponse = await postJson(
      baseUrl,
      `/v1/encounters/${encounterBody.encounter.id}/sign-note`,
      {},
      doctorHeaders({ "idempotency-key": "cp3-note-sign" })
    );
    assert.equal(doctorSignResponse.status, 200);
    const doctorSignBody = await doctorSignResponse.json();
    assert.equal(doctorSignBody.note.status, "signed");

    const overwriteResponse = await patchJson(
      baseUrl,
      `/v1/encounters/${encounterBody.encounter.id}`,
      {
        content: {
          diagnosis: "Silently changed diagnosis"
        }
      },
      doctorHeaders({ "idempotency-key": "cp3-note-overwrite" })
    );
    assert.equal(overwriteResponse.status, 409);

    const amendResponse = await postJson(
      baseUrl,
      `/v1/encounters/${encounterBody.encounter.id}/amend-note`,
      {
        amendmentReason: "Add follow-up instruction",
        content: {
          followUpInstructions: "Return if swelling develops"
        }
      },
      doctorHeaders({ "idempotency-key": "cp3-note-amend" })
    );
    assert.equal(amendResponse.status, 200);
    const amendBody = await amendResponse.json();
    assert.equal(amendBody.note.status, "amended");
    assert.equal(amendBody.note.amendedFromVersionId, doctorSignBody.note.id);

    const prescriptionResponse = await postJson(
      baseUrl,
      `/v1/encounters/${encounterBody.encounter.id}/prescriptions`,
      {
        medications: [
          {
            name: "Ibuprofen",
            strength: "400mg",
            frequency: "TDS",
            duration: "3 days",
            instructions: "After food"
          }
        ],
        notes: "Review if pain persists"
      },
      assistantHeaders({ "idempotency-key": "cp3-prescription-create" })
    );
    assert.equal(prescriptionResponse.status, 201);
    const prescriptionBody = await prescriptionResponse.json();
    assert.equal(prescriptionBody.prescription.status, "draft");

    const assistantPrescriptionSignResponse = await postJson(
      baseUrl,
      `/v1/prescriptions/${prescriptionBody.prescription.id}/sign`,
      {},
      assistantHeaders({ "idempotency-key": "cp3-prescription-sign-denied" })
    );
    assert.equal(assistantPrescriptionSignResponse.status, 403);

    const doctorPrescriptionSignResponse = await postJson(
      baseUrl,
      `/v1/prescriptions/${prescriptionBody.prescription.id}/sign`,
      {},
      doctorHeaders({ "idempotency-key": "cp3-prescription-sign" })
    );
    assert.equal(doctorPrescriptionSignResponse.status, 200);
    assert.equal((await doctorPrescriptionSignResponse.json()).prescription.status, "signed");

    assert.ok(operationsRepository.outboxEvents.some((event) => event.eventType === "consent.revoked"));
    assert.ok(operationsRepository.outboxEvents.some((event) => event.eventType === "clinical_note.signed"));
    assert.ok(operationsRepository.outboxEvents.some((event) => event.eventType === "prescription.signed"));
    assert.ok(auditSink.events.some((event) => event.action === "clinical_note.signed"));
    assert.ok(auditSink.events.some((event) => event.action === "prescription.signed"));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve(undefined)));
    });
  }
});

function assistantHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    "x-clinic-os-dev-subject": "seed-assistant",
    ...extra
  };
}

function doctorHeaders(extra = {}) {
  return {
    "content-type": "application/json",
    "x-clinic-os-dev-subject": "seed-doctor",
    ...extra
  };
}

function postJson(baseUrl, path, body, headers = assistantHeaders()) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

function patchJson(baseUrl, path, body, headers = assistantHeaders()) {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify(body)
  });
}

function operationsContext(
  userKey: keyof typeof CHECKPOINT1_SEED_IDS.users,
  roleSlug: ClinicRoleSlug,
  requestId: string
): OperationsRequestContext {
  const userId = CHECKPOINT1_SEED_IDS.users[userKey];
  return {
    requestId,
    clinicId: CHECKPOINT1_SEED_IDS.clinicId,
    idempotencyKey: requestId,
    accessContext: {
      principal: {
        subject: `seed-${userKey}`,
        issuer: "http://localhost:8080/realms/clinic-os-local",
        email: null,
        displayName: `Seed ${userKey}`,
        username: null,
        keycloakRoles: [roleSlug]
      },
      tenant: {
        id: CHECKPOINT1_SEED_IDS.tenantId,
        slug: "clinicos-synthetic-tenant",
        legalName: "ClinicOS Synthetic Dental Private Limited",
        displayName: "ClinicOS Synthetic Tenant",
        status: "active"
      },
      user: {
        id: userId,
        displayName: `Seed ${userKey}`,
        email: null,
        phone: null,
        status: "active"
      },
      memberships: [
        {
          tenantId: CHECKPOINT1_SEED_IDS.tenantId,
          userId,
          status: "active"
        }
      ],
      clinicAssignments: [
        {
          tenantId: CHECKPOINT1_SEED_IDS.tenantId,
          clinicId: CHECKPOINT1_SEED_IDS.clinicId,
          userId,
          status: "active"
        }
      ],
      roleAssignments: [
        {
          tenantId: CHECKPOINT1_SEED_IDS.tenantId,
          clinicId: CHECKPOINT1_SEED_IDS.clinicId,
          userId,
          roleSlug
        }
      ],
      roleSlugs: [roleSlug],
      permissions: []
    }
  };
}
