import assert from "node:assert/strict";
import test from "node:test";
import {
  MetaDispatchRecoveryService,
  type MetaDispatchPersistence,
  type MetaTemplateSendResult
} from "../dist/cp15/meta-whatsapp/index.js";

test("CP15 dispatch recovery persists acceptance without delivery evidence", async () => {
  const harness = createHarness();
  await harness.service.record({
    result: result({ outcome: "accepted_by_provider", providerMessageId: "wamid.accepted.1", reconciliationRequired: false }),
    attemptedAt: "2026-07-11T10:00:00.000Z",
    nextRetryAt: null
  });
  assert.equal(harness.records[0]?.state, "accepted_by_provider");
  assert.equal(harness.records[0]?.providerMessageId, "wamid.accepted.1");
  assert.equal(harness.records[0]?.reconciliationReason, null);
  assert.equal(harness.records[0]?.outbox.topic, "provider.meta_whatsapp.accepted");
  assert.equal("deliveredAt" in harness.records[0]!, false);
});

test("CP15 dispatch recovery never retries an ambiguous request and schedules reconciliation", async () => {
  const harness = createHarness();
  await harness.service.record({
    result: result({
      outcome: "dispatch_ambiguous",
      providerMessageId: null,
      reconciliationRequired: true,
      retryAutomatically: false
    }),
    attemptedAt: "2026-07-11T10:00:00.000Z",
    nextRetryAt: null
  });
  assert.equal(harness.records[0]?.automaticRetryAllowed, false);
  assert.equal(harness.records[0]?.reconciliationReason, "dispatch_ambiguous");
  assert.equal(harness.records[0]?.outbox.topic, "provider.meta_whatsapp.reconciliation_requested");
});

test("CP15 dispatch recovery permits retry only when transport proved no dispatch", async () => {
  const harness = createHarness();
  await harness.service.record({
    result: result({
      outcome: "not_dispatched",
      providerMessageId: null,
      reconciliationRequired: false,
      retryAutomatically: true
    }),
    attemptedAt: "2026-07-11T10:00:00.000Z",
    nextRetryAt: "2026-07-11T10:01:00.000Z"
  });
  assert.equal(harness.records[0]?.automaticRetryAllowed, true);
  assert.equal(harness.records[0]?.nextRetryAt, "2026-07-11T10:01:00.000Z");
  assert.equal(harness.records[0]?.reconciliationReason, null);
  assert.equal(harness.records[0]?.outbox.topic, "provider.meta_whatsapp.retry_requested");
});

function createHarness() {
  const records: Parameters<MetaDispatchPersistence["recordDispatchOutcome"]>[0][] = [];
  const persistence: MetaDispatchPersistence = {
    async recordDispatchOutcome(input) {
      records.push(input);
      return { outcome: "committed" };
    }
  };
  return {
    records,
    service: new MetaDispatchRecoveryService({
      tenantId: "tenant-1",
      clinicId: "clinic-1",
      externalAccountId: "account-1",
      persistence
    })
  };
}

function result(
  value:
    | Pick<Extract<MetaTemplateSendResult, { outcome: "accepted_by_provider" }>, "outcome" | "providerMessageId" | "reconciliationRequired">
    | Pick<Extract<MetaTemplateSendResult, { outcome: "dispatch_ambiguous" }>, "outcome" | "providerMessageId" | "reconciliationRequired" | "retryAutomatically">
    | Pick<Extract<MetaTemplateSendResult, { outcome: "not_dispatched" }>, "outcome" | "providerMessageId" | "reconciliationRequired" | "retryAutomatically">
): MetaTemplateSendResult {
  return {
    ...value,
    messageRequestId: "request-1",
    idempotencyKey: "idem-1",
    correlationId: "corr-1",
    deliveryState: null
  } as MetaTemplateSendResult;
}
