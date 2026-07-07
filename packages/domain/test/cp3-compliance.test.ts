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
  type ClinicalNotePolicySubject,
  type ConsentPurpose,
  type ConsentRecordLike,
  type PrescriptionPolicySubject
} from "../src/index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000101";
const patientId = "10000000-0000-4000-8000-000000002001";
const encounterId = "10000000-0000-4000-8000-000000010001";

test("consent revocation blocks future AI/audio readiness", () => {
  const granted = consent(
    "10000000-0000-4000-8000-000000011001",
    "ai_audio_capture",
    "granted",
    {
      grantedAt: "2026-07-07T09:00:00.000Z",
      expiresAt: "2026-12-31T18:30:00.000Z"
    }
  );
  const revoked = consent("10000000-0000-4000-8000-000000011002", "ai_audio_capture", "revoked", {
    grantedAt: "2026-07-07T09:00:00.000Z",
    revokedAt: "2026-07-07T10:00:00.000Z"
  });

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
  const aiConsent = consent("10000000-0000-4000-8000-000000011003", "ai_audio_capture", "granted", {
    grantedAt: "2026-07-07T09:00:00.000Z"
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
    grantedAt: "2026-07-07T09:00:00.000Z",
    revokedAt: "2026-07-07T10:00:00.000Z"
  });
  const reconsented = consent(
    "10000000-0000-4000-8000-000000011005",
    "ai_audio_capture",
    "granted",
    {
      grantedAt: "2026-07-07T11:00:00.000Z"
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
  assert.doesNotThrow(() => assertClinicalNoteCanBeSigned(note("ready_for_sign")));
  assert.throws(() => assertClinicalNoteCanBeSigned(note("signed")), /cannot be signed/);

  assert.doesNotThrow(() => assertPrescriptionCanBeSigned(prescription("draft")));
  assert.throws(() => assertPrescriptionCanBeSigned(prescription("signed")), /cannot be signed/);
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
  status: ConsentRecordLike["status"],
  dates: Pick<ConsentRecordLike, "grantedAt"> &
    Partial<Pick<ConsentRecordLike, "revokedAt" | "expiresAt">>
): ConsentRecordLike {
  return {
    id,
    patientId,
    purpose,
    status,
    grantedAt: dates.grantedAt,
    revokedAt: dates.revokedAt ?? null,
    expiresAt: dates.expiresAt ?? null,
    templateVersion: "cp3-consent-v1",
    provenance: "assistant_entered_paper_card"
  };
}

function note(status: string): ClinicalNotePolicySubject {
  return {
    id: "10000000-0000-4000-8000-000000012001",
    patientId,
    encounterId,
    status,
    signedAt: status === "signed" ? "2026-07-07T09:30:00.000Z" : null
  };
}

function prescription(status: string): PrescriptionPolicySubject {
  return {
    id: "10000000-0000-4000-8000-000000013001",
    patientId,
    encounterId,
    status,
    signedAt: status === "signed" ? "2026-07-07T09:35:00.000Z" : null
  };
}
