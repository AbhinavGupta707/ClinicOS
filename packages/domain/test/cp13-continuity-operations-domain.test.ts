import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCorrectiveActionTransition,
  assertNoProviderOrProcurementCompletionClaim,
  assertOwnerAnalyticsRange,
  assertRecallAction,
  inventoryExceptionAnalyticsSource,
  ownerAnalyticsFreshness
} from "../src/cp13/continuity-operations/index.ts";

test("CP13 recall actions require attributable evidence and a booked appointment reference", () => {
  assert.equal(
    assertRecallAction({
      currentStatus: "due",
      actionType: "manual_contacted",
      evidence: { method: "phone", outcome: "answered" }
    }),
    "contacted"
  );
  assert.throws(
    () =>
      assertRecallAction({
        currentStatus: "due",
        actionType: "appointment_booked",
        evidence: { method: "in_person" }
      }),
    /appointment reference/
  );
  assert.throws(
    () =>
      assertRecallAction({
        currentStatus: "completed",
        actionType: "manual_contacted",
        evidence: { method: "phone" }
      }),
    /cannot accept/
  );
});

test("CP13 CAPA completion is terminal and requires completion plus verification evidence", () => {
  assert.doesNotThrow(() =>
    assertCorrectiveActionTransition({
      current: { status: "in_progress" },
      nextStatus: "completed",
      completionEvidence: { summary: "Procedure updated" },
      verificationEvidence: { reviewedBy: "owner-role" }
    })
  );
  assert.throws(
    () =>
      assertCorrectiveActionTransition({
        current: { status: "completed" },
        nextStatus: "in_progress",
        completionEvidence: {},
        verificationEvidence: {}
      }),
    /cannot transition/
  );
  assert.throws(
    () =>
      assertCorrectiveActionTransition({
        current: { status: "in_progress" },
        nextStatus: "completed",
        completionEvidence: { summary: "Procedure updated" },
        verificationEvidence: {}
      }),
    /verification requires attributable evidence/
  );
});

test("CP13 manual evidence cannot claim provider, purchase, or vendor completion", () => {
  assert.throws(
    () => assertNoProviderOrProcurementCompletionClaim({ providerDelivered: true }),
    /cannot be asserted/
  );
  assert.throws(
    () => assertNoProviderOrProcurementCompletionClaim({ purchaseExecuted: true }),
    /cannot be asserted/
  );
  assert.doesNotThrow(() =>
    assertNoProviderOrProcurementCompletionClaim({ method: "manual", receiptReference: "redacted" })
  );
});

test("CP13 owner analytics has a bounded range and explicit source freshness", () => {
  assert.doesNotThrow(() =>
    assertOwnerAnalyticsRange("2026-07-01T00:00:00.000Z", "2026-07-31T23:59:59.999Z")
  );
  assert.throws(
    () => assertOwnerAnalyticsRange("2026-01-01T00:00:00.000Z", "2026-07-31T23:59:59.999Z"),
    /cannot exceed/
  );
  assert.deepEqual(
    ownerAnalyticsFreshness({
      generatedAt: "2026-07-10T12:00:00.000Z",
      observedAt: new Date("2026-07-10T12:00:02.000Z"),
      dataSources: [
        {
          key: "durable-continuity",
          label: "Durable continuity",
          status: "ready",
          recordCount: 12,
          provenance: ["tasks", "recalls"]
        }
      ]
    }),
    {
      status: "fresh",
      generatedAt: "2026-07-10T12:00:00.000Z",
      ageSeconds: 2,
      staleAfterSeconds: 300,
      projectionMode: "transactional_request_time",
      rebuild: {
        supported: false,
        reason: "request_time_projection_has_no_materialized_state"
      },
      unavailableSources: []
    }
  );
});

test("CP13 inventory analytics derives timestamps and suggestion state from durable rows", () => {
  const source = inventoryExceptionAnalyticsSource({
    item: {
      id: id("1001"),
      tenantId: id("0001"),
      clinicId: id("0002"),
      categoryId: id("1000"),
      sku: "RESTORATIVE-A2",
      displayName: "Composite A2",
      unitOfMeasure: "capsule",
      storageLocation: "Drawer A",
      trackQuantity: true,
      minimumQuantity: 4,
      reorderQuantity: 8,
      currentQuantity: 0,
      status: "active",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-10T08:00:00.000Z"
    },
    checkRunLine: null,
    procurementSuggestion: {
      id: id("2001"),
      tenantId: id("0001"),
      clinicId: id("0002"),
      itemId: id("1001"),
      sourceCheckRunId: id("3001"),
      sourceCheckRunLineId: id("3002"),
      status: "converted_to_task",
      suggestedQuantity: 8,
      reason: "Below minimum",
      taskId: id("4001"),
      evidence: { source: "inventory_check" },
      createdByUserId: id("5001"),
      createdAt: "2026-07-10T07:00:00.000Z",
      updatedAt: "2026-07-10T07:30:00.000Z"
    },
    exceptionType: "missing_item",
    quantityAvailable: 0,
    thresholdQuantity: 4,
    suggestedTask: {
      taskType: "procurement",
      title: "Review composite stock",
      status: "suggested_not_created"
    }
  });
  assert.deepEqual(source, {
    id: id("2001"),
    itemKey: "RESTORATIVE-A2",
    severity: "high",
    status: "procurement_requested",
    detectedAt: "2026-07-10T07:00:00.000Z",
    resolvedAt: null,
    procurementTaskId: id("4001")
  });
});

function id(suffix: string) {
  return `00000000-0000-4000-8000-${suffix.padStart(12, "0")}` as const;
}
