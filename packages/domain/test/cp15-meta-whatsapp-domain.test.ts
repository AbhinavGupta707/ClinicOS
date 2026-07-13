import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyInboundConsentCommand,
  decideMetaStatusTransition,
  evaluateMetaOutboundPolicy,
  normalizeMetaTemplateState,
  serviceWindowExpiryFromInbound
} from "../src/cp15/meta-whatsapp/index.ts";

test("CP15 Meta lifecycle advances without inventing intermediate delivery evidence", () => {
  assert.deepEqual(decideMetaStatusTransition("accepted_by_provider", "read"), {
    decision: "apply",
    current: "accepted_by_provider",
    next: "read",
    observed: "read",
    reason: "monotonic_advance"
  });
  assert.equal(decideMetaStatusTransition("read", "delivered").decision, "ignore_stale");
  assert.equal(decideMetaStatusTransition("delivered", "failed").decision, "reconcile");
  assert.equal(decideMetaStatusTransition("sent", "deleted").decision, "reconcile");
  assert.equal(decideMetaStatusTransition("sent", "unknown").decision, "reconcile");
});

test("CP15 outbound policy fails closed for consent, templates, and service window", () => {
  const now = "2026-07-11T10:00:00.000Z";
  assert.equal(
    evaluateMetaOutboundPolicy({ consent: "unknown", purpose: "appointment", mode: "approved_template", templateState: "approved", now }).code,
    "consent_required"
  );
  assert.equal(
    evaluateMetaOutboundPolicy({ consent: "revoked", purpose: "care_instruction", mode: "approved_template", templateState: "approved", now }).code,
    "recipient_opted_out"
  );
  assert.equal(
    evaluateMetaOutboundPolicy({ consent: "granted", purpose: "appointment", mode: "approved_template", templateState: "pending", now }).code,
    "template_not_approved"
  );
  assert.equal(
    evaluateMetaOutboundPolicy({ consent: "granted", purpose: "human_reply", mode: "freeform", serviceWindowExpiresAt: now, now }).code,
    "service_window_closed"
  );
  assert.equal(
    evaluateMetaOutboundPolicy({ consent: "granted", purpose: "human_reply", mode: "freeform", serviceWindowExpiresAt: "2026-07-11T10:00:01.000Z", now }).allowed,
    true
  );
});

test("CP15 inbound consent commands require exact normalized commands", () => {
  assert.equal(classifyInboundConsentCommand(" STOP "), "opt_out");
  assert.equal(classifyInboundConsentCommand("start"), "opt_in_request");
  assert.equal(classifyInboundConsentCommand("cancel"), "none");
  assert.equal(classifyInboundConsentCommand("please stop the pain"), "none");
  assert.equal(classifyInboundConsentCommand(null), "none");
  assert.equal(serviceWindowExpiryFromInbound("2026-07-11T10:00:00.000Z"), "2026-07-12T10:00:00.000Z");
});

test("CP15 template lifecycle maps known provider events and preserves unknown", () => {
  assert.equal(normalizeMetaTemplateState("APPROVED"), "approved");
  assert.equal(normalizeMetaTemplateState("PENDING"), "pending");
  assert.equal(normalizeMetaTemplateState("future_event"), "unknown");
});
