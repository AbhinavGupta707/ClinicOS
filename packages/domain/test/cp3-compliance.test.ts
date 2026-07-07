import test from "node:test";
import assert from "node:assert/strict";
import {
  CP3_EVENT_TYPES,
  assertClinicalNoteAmendmentAllowed,
  assertClinicalNoteCanBeSigned,
  assertClinicalNoteDraftMutationAllowed,
  assertPrescriptionCanBeSigned,
  createDomainEventEnvelope,
  evaluateAiAudioReadiness,
  evaluateConsentRequirement,
  isCp3EventType,
  isDomainEventType,
  type ConsentPurpose,
  type ClinicalNoteVersionRecord,
  type ConsentRecord,
  type PrescriptionRecord
} from "../src/index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000101";
const patientId = "10000000-0000-4000-8000-000000002001";
const encounterId = "10000000-0000-4000-8000-000000010001";

test("consent revocation blocks future AI/audio readiness", () => {
  const granted = consent(
    "10000000-0000-4000-8000-000000011001",
    "ai_audio_capture",
    "active",
    {
      createdAt: "2026-07-07T09:00:00.000Z"
    }
  );
  const revoked = consent(
    "10000000-0000-4000-8000-000000011002",
    "ai_audio_capture",
    "revoked",
    {
      createdAt: "2026-07-07T09:00:00.000Z",
      revokedAt: "2026-07-07T10:00:00.000Z"
    }
  );

  const readiness = evaluateAiAudioReadiness([granted, revoked], {
    evaluatedAt: "2026-07-07T10:01:00.000Z"
  });

  assert.equal(readiness.allowed, false);
  assert.deepEqual(
    readiness.blockedReasons.map((decision) => decision.reason),
    ["consent_revoked"]
  );
  assert.equal(readiness.blockedReasons[0]?.consentId, revoked.id);
});

test("AI/audio readiness can require separate raw audio retention consent", () => {
  const aiConsent = consent("10000000-0000-4000-8000-000000011003", "ai_audio_capture", "active", {
    createdAt: "2026-07-07T09:00:00.000Z"
  });

  const readiness = evaluateAiAudioReadiness([aiConsent], {
    evaluatedAt: "2026-07-07T09:05:00.000Z",
    requireRawAudioRetention: true
  });

  assert.equal(readiness.allowed, false);
  assert.deepEqual(readiness.requiredPurposes, ["ai_audio_capture", "raw_audio_retention"]);
  assert.deepEqual(
    readiness.blockedReasons.map((decision) => [decision.purpose, decision.reason]),
    [["raw_audio_retention", "consent_missing"]]
  );
});

test("latest re-consent after revocation restores future processing readiness", () => {
  const revoked = consent("10000000-0000-4000-8000-000000011004", "ai_audio_capture", "revoked", {
    createdAt: "2026-07-07T09:00:00.000Z",
    revokedAt: "2026-07-07T10:00:00.000Z"
  });
  const reconsented = consent(
    "10000000-0000-4000-8000-000000011005",
    "ai_audio_capture",
    "active",
    {
      createdAt: "2026-07-07T11:00:00.000Z"
    }
  );

  const decision = evaluateConsentRequirement([revoked, reconsented], "ai_audio_capture", {
    evaluatedAt: "2026-07-07T11:01:00.000Z"
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.reason, "consent_granted");
  assert.equal(decision.consentId, reconsented.id);
});

test("signed clinical notes reject direct overwrite and require reasoned amendments", () => {
  const signed = note("signed");

  assert.throws(() => assertClinicalNoteDraftMutationAllowed(signed), /immutable/);
  assert.throws(
    () => assertClinicalNoteAmendmentAllowed(note("draft"), { reason: "Corrected history." }),
    /Only signed clinical notes/
  );
  assert.throws(() => assertClinicalNoteAmendmentAllowed(signed, { reason: " " }), /require a reason/);
  assert.doesNotThrow(() =>
    assertClinicalNoteAmendmentAllowed(signed, { reason: "Patient clarified medication timing." })
  );
});

test("clinical note and prescription signing guards reject non-draft states", () => {
  assert.doesNotThrow(() => assertClinicalNoteCanBeSigned(note("draft")));
  assert.throws(() => assertClinicalNoteCanBeSigned(note("signed")), /Only a draft/);

  assert.doesNotThrow(() => assertPrescriptionCanBeSigned(prescription("draft")));
  assert.throws(() => assertPrescriptionCanBeSigned(prescription("signed")), /Only a draft/);
});

test("CP3 domain event taxonomy covers intake consent encounter note prescription and timeline events", () => {
  for (const eventType of CP3_EVENT_TYPES) {
    assert.equal(isCp3EventType(eventType), true);
    assert.equal(isDomainEventType(eventType), true);
  }

  const envelope = createDomainEventEnvelope({
    eventType: "clinical_note.signed",
    tenantId,
    clinicId,
    actor: { type: "user", id: "10000000-0000-4000-8000-000000001002" },
    correlationId: "cp3-security-test",
    source: { kind: "manual_entry" },
    aggregate: { type: "clinical_note", id: "10000000-0000-4000-8000-000000012001" },
    patientId,
    payload: { encounterId, noteId: "10000000-0000-4000-8000-000000012001" }
  });

  assert.equal(envelope.eventType, "clinical_note.signed");
  assert.equal(envelope.patientId, patientId);
  assert.equal(envelope.schemaVersion, "1.0");
});

function consent(
  id: string,
  purpose: ConsentPurpose,
  status: ConsentRecord["status"],
  dates: Pick<ConsentRecord, "createdAt"> & Partial<Pick<ConsentRecord, "revokedAt">>
): ConsentRecord {
  return {
    id,
    tenantId,
    clinicId,
    patientId,
    purpose,
    status,
    templateCode: "cp3-consent-v1",
    templateVersion: 1,
    captureMethod: "clinic_staff",
    grantedByName: "Rhea Synthetic",
    relationshipToPatient: "self",
    evidence: {},
    provenance: { kind: "manual_entry" },
    createdByUserId: "10000000-0000-4000-8000-000000001003",
    createdAt: dates.createdAt,
    revokedByUserId: status === "revoked" ? "10000000-0000-4000-8000-000000001003" : null,
    revokedAt: dates.revokedAt ?? null,
    revocationReason: status === "revoked" ? "Patient withdrew consent" : null
  };
}

function note(status: ClinicalNoteVersionRecord["status"]): ClinicalNoteVersionRecord {
  return {
    id: "10000000-0000-4000-8000-000000012001",
    tenantId,
    clinicId,
    patientId,
    encounterId,
    status,
    versionNumber: 1,
    content: { diagnosis: "Reversible pulpitis" },
    amendmentReason: status === "amended" ? "Corrected diagnosis wording" : null,
    amendedFromVersionId:
      status === "amended" ? "10000000-0000-4000-8000-000000012000" : null,
    signedByUserId: status === "draft" ? null : "10000000-0000-4000-8000-000000001002",
    signedAt: status === "draft" ? null : "2026-07-07T09:30:00.000Z",
    createdByUserId: "10000000-0000-4000-8000-000000001003",
    createdAt: "2026-07-07T09:20:00.000Z"
  };
}

function prescription(status: PrescriptionRecord["status"]): PrescriptionRecord {
  return {
    id: "10000000-0000-4000-8000-000000013001",
    tenantId,
    clinicId,
    patientId,
    encounterId,
    status,
    medications: [
      {
        name: "Ibuprofen",
        frequency: "TDS",
        duration: "3 days"
      }
    ],
    notes: null,
    createdByUserId: "10000000-0000-4000-8000-000000001003",
    createdAt: "2026-07-07T09:35:00.000Z",
    signedByUserId: status === "draft" ? null : "10000000-0000-4000-8000-000000001002",
    signedAt: status === "signed" ? "2026-07-07T09:35:00.000Z" : null
  };
}
