import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CP6_EVENT_TYPES,
  assertLabCaseTransition,
  buildCp10PilotReadinessPlan,
  calculateInventoryVariance,
  classifyInventoryException,
  correctiveActionEffectiveStatus,
  createDomainEventEnvelope,
  isCp6EventType,
  isDomainEventType
} from "../src/index.ts";

const tenantId = "10000000-0000-4000-8000-000000000001";
const clinicId = "10000000-0000-4000-8000-000000000101";
const patientId = "10000000-0000-4000-8000-000000002001";

test("CP6 lab transitions, inventory exceptions, and CAPA due state are enforced", () => {
  assert.doesNotThrow(() => assertLabCaseTransition("draft", "sent_to_lab"));
  assert.doesNotThrow(() => assertLabCaseTransition("sent_to_lab", "returned"));
  assert.doesNotThrow(() => assertLabCaseTransition("returned", "completed"));
  assert.throws(
    () => assertLabCaseTransition("completed", "sent_to_lab"),
    /cannot transition/
  );

  assert.equal(
    calculateInventoryVariance({ expectedQuantity: 8, countedQuantity: 2 }),
    -6
  );
  assert.equal(
    classifyInventoryException({
      expectedQuantity: 8,
      countedQuantity: 2,
      minimumQuantity: 5
    }),
    "low_stock"
  );
  assert.equal(
    classifyInventoryException({
      expectedQuantity: 8,
      countedQuantity: 0,
      minimumQuantity: 5
    }),
    "missing_item"
  );

  assert.equal(
    correctiveActionEffectiveStatus(
      { status: "open", dueAt: "2026-07-06T08:00:00.000Z" },
      "2026-07-07T08:00:00.000Z"
    ),
    "overdue"
  );
  assert.equal(
    correctiveActionEffectiveStatus(
      { status: "completed", dueAt: "2026-07-06T08:00:00.000Z" },
      "2026-07-07T08:00:00.000Z"
    ),
    "completed"
  );
});

test("CP6 domain event taxonomy covers operational owner analytics events", () => {
  for (const eventType of CP6_EVENT_TYPES) {
    assert.equal(isCp6EventType(eventType), true);
    assert.equal(isDomainEventType(eventType), true);
  }

  const envelope = createDomainEventEnvelope({
    eventType: "lab_case.completed",
    tenantId,
    clinicId,
    actor: { type: "user", id: "10000000-0000-4000-8000-000000001003" },
    correlationId: "cp6-operations-test",
    source: { kind: "manual_entry" },
    aggregate: { type: "lab_case", id: "10000000-0000-4000-8000-000000090101" },
    patientId,
    payload: {
      labCaseId: "10000000-0000-4000-8000-000000090101",
      vendorId: "10000000-0000-4000-8000-000000090001"
    }
  });

  assert.equal(envelope.eventType, "lab_case.completed");
  assert.equal(envelope.aggregate.type, "lab_case");
  assert.equal(envelope.patientId, patientId);
});

test("CP10 pilot readiness fixture separates local configuration from live go-live gates", () => {
  const fixture = JSON.parse(
    readFileSync(
      new URL("../../../fixtures/synthetic/cp10/pilot_readiness_configuration.json", import.meta.url),
      "utf8"
    )
  );
  const readiness = buildCp10PilotReadinessPlan(fixture.input);
  const requiredBlockedItems = new Set(fixture.expected.requiredBlockedItems);

  assert.equal(readiness.schemaVersion, "cp10.pilot_readiness.v1");
  assert.equal(readiness.localConfigurationStatus, fixture.expected.localConfigurationStatus);
  assert.equal(readiness.pilotGoLiveStatus, fixture.expected.pilotGoLiveStatus);
  assert.equal(readiness.safety.noRealPhi, true);
  assert.equal(readiness.safety.noLiveProviderActivation, true);
  assert.ok(readiness.summary.ready >= fixture.expected.minimumReadyItems);

  for (const itemId of requiredBlockedItems) {
    assert.equal(readiness.items.find((item) => item.id === itemId)?.status, "blocked");
  }

  const serialized = JSON.stringify(readiness);
  assert.equal(serialized.includes("Provider success confirmed"), false);
  assert.equal(serialized.includes("KEY_SECRET"), false);
  assert.equal(serialized.includes("ACCESS_TOKEN"), false);
});
