import test from "node:test";
import assert from "node:assert/strict";
import { classifyAuditAction, createAuditEvent, redactPhi } from "../src/index.ts";

test("PHI audit actions require patient id", () => {
  assert.throws(
    () =>
      createAuditEvent({
        tenantId: "10000000-0000-4000-8000-000000000001",
        actor: { type: "user", id: "10000000-0000-4000-8000-000000001001" },
        action: "patient.record.viewed"
      }),
    /requires patientId/
  );
});

test("audit classifications mark sensitive access", () => {
  const classification = classifyAuditAction("media.viewed");
  assert.equal(classification.phiInvolved, true);
  assert.equal(classification.riskLevel, "high");
  assert.equal(classification.category, "phi_access");
});

test("checkpoint 2 workflow audit actions are PHI-linked where patient state changes", () => {
  for (const action of [
    "appointment.created",
    "appointment.confirmed",
    "patient.checked_in",
    "queue.entry_created",
    "lead.matched_to_patient"
  ] as const) {
    const classification = classifyAuditAction(action);
    assert.equal(classification.phiInvolved, true);
    assert.equal(classification.requiresPatientId, true);
  }
});

test("PHI redaction masks nested patient and free-text identifiers", () => {
  const redacted = redactPhi({
    event: "patient.record.viewed",
    patient: {
      fullName: "Rhea Synthetic",
      phone: "+91 98765 43210",
      email: "rhea.synthetic@example.test"
    },
    message: "Call +91 98765 43210 or email rhea.synthetic@example.test"
  });

  assert.equal(redacted.patient.fullName, "[REDACTED]");
  assert.equal(redacted.patient.phone, "[REDACTED]");
  assert.equal(redacted.patient.email, "[REDACTED]");
  assert.match(redacted.message, /\*+3210/);
  assert.match(redacted.message, /r\*\*\*@example\.test/);
});
