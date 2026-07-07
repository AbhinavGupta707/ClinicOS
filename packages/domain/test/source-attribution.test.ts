import test from "node:test";
import assert from "node:assert/strict";
import {
  createConversionSourceSnapshot,
  createManualMissedCallCaptureEvidence,
  createManualSourceAttribution,
  normalizeAcquisitionSourceType,
  normalizeSourceAttribution,
  preserveConversionSource,
  sourceAttributionToEventSource,
  sourceAttributionToLeadSource
} from "../src/index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000101";
const userId = "10000000-0000-4000-8000-000000001001";

test("source attribution normalizes acquisition channels without losing external context", () => {
  assert.equal(normalizeAcquisitionSourceType("walk-in"), "walk_in");
  assert.equal(normalizeAcquisitionSourceType("Google Business Profile"), "google");

  const attribution = createManualSourceAttribution({
    sourceType: "Practo Prime",
    sourceDetail: { bookingMode: "profile_call", assistantNote: "entered from clinic-approved note" },
    externalReference: "practo-booking-42",
    campaign: "implant-consult",
    utmSource: "practo",
    utmMedium: "marketplace",
    capturedByUserId: userId,
    capturedAt: "2026-07-07T09:00:00.000Z"
  });

  assert.equal(attribution.sourceType, "practo");
  assert.equal(attribution.externalSystemId, "practo");
  assert.equal(attribution.externalReference, "practo-booking-42");
  assert.equal(attribution.confidence, 1);
  assert.equal(sourceAttributionToLeadSource(attribution), "practo");

  const eventSource = sourceAttributionToEventSource(attribution);
  assert.equal(eventSource.kind, "manual_entry");
  assert.equal(eventSource.providerKey, "practo");
  assert.equal(eventSource.externalRef, "practo-booking-42");

  const providerAttribution = normalizeSourceAttribution({
    sourceType: "whatsapp",
    capturedAt: "2026-07-07T09:05:00.000Z"
  });
  assert.equal(providerAttribution.captureMethod, "provider_webhook");
  assert.equal(providerAttribution.capturedBy.type, "integration");
});

test("manual missed-call entry is first-class auditable evidence", () => {
  const evidence = createManualMissedCallCaptureEvidence({
    tenantId,
    clinicId,
    callerNumber: "98765 43210",
    calledNumber: "+91 80444 45555",
    occurredAt: "2026-07-07T10:15:00.000Z",
    capturedAt: "2026-07-07T10:20:00.000Z",
    capturedByUserId: userId,
    notes: "Caller disconnected before assistant could answer.",
    callbackDueAt: "2026-07-07T10:35:00.000Z"
  });

  assert.equal(evidence.captureMethod, "manual_missed_call_entry");
  assert.equal(evidence.normalizedCallerNumber, "+919876543210");
  assert.equal(evidence.sourceAttribution.sourceType, "phone");
  assert.equal(evidence.sourceAttribution.captureMethod, "manual_entry");
  assert.equal(evidence.auditMetadata.requiresAuditEvent, true);
  assert.equal(evidence.auditMetadata.suggestedTaskType, "missed_call");
  assert.equal(evidence.recording.availability, "not_available");

  assert.throws(
    () =>
      createManualMissedCallCaptureEvidence({
        tenantId,
        clinicId,
        callerNumber: "98765 43210",
        calledNumber: "+91 80444 45555",
        occurredAt: "2026-07-07T10:15:00.000Z",
        capturedAt: "2026-07-07T10:20:00.000Z",
        capturedByUserId: userId,
        sourceAttribution: createManualSourceAttribution({
          sourceType: "google",
          capturedByUserId: userId,
          capturedAt: "2026-07-07T10:20:00.000Z"
        })
      }),
    /must use phone source attribution/
  );
});

test("conversion source snapshots preserve first touch through payment and analytics stages", () => {
  const firstTouch = createManualSourceAttribution({
    sourceType: "Google",
    sourceDetail: { linkType: "booking_link" },
    externalReference: "gbp-call-click-101",
    utmSource: "google",
    utmMedium: "organic",
    utmCampaign: "smile-design",
    capturedByUserId: userId,
    capturedAt: "2026-07-07T08:30:00.000Z"
  });
  const leadSnapshot = createConversionSourceSnapshot({
    stage: "lead",
    recordId: "lead-1",
    patientId: null,
    sourceAttribution: firstTouch,
    preservedAt: "2026-07-07T08:31:00.000Z"
  });
  const appointmentSnapshot = preserveConversionSource({
    from: leadSnapshot,
    toStage: "appointment",
    toRecordId: "appointment-1",
    patientId: "patient-1",
    preservedAt: "2026-07-07T08:45:00.000Z"
  });
  const invoiceSnapshot = preserveConversionSource({
    from: appointmentSnapshot,
    toStage: "invoice",
    toRecordId: "invoice-1",
    preservedAt: "2026-07-07T11:30:00.000Z"
  });
  const paymentSnapshot = preserveConversionSource({
    from: invoiceSnapshot,
    toStage: "payment",
    toRecordId: "payment-1",
    preservedAt: "2026-07-07T11:45:00.000Z"
  });
  const analyticsSnapshot = preserveConversionSource({
    from: paymentSnapshot,
    toStage: "analytics",
    toRecordId: null,
    preservedAt: "2026-07-07T12:00:00.000Z"
  });

  assert.equal(analyticsSnapshot.sourceAttribution.sourceType, "google");
  assert.equal(analyticsSnapshot.firstTouch.externalReference, "gbp-call-click-101");
  assert.equal(analyticsSnapshot.bookingTouch?.sourceType, "google");
  assert.equal(analyticsSnapshot.preservationTrail.length, 4);
  assert.deepEqual(
    analyticsSnapshot.preservationTrail.map((entry) => entry.toStage),
    ["appointment", "invoice", "payment", "analytics"]
  );
});
