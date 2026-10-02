import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_NATIVE_HTTP_OPERATIONS } from "../src/native-http-contracts.ts";
import { parseOperationRequest } from "../src/http-contract.ts";
const op = ACTIVE_NATIVE_HTTP_OPERATIONS.find(
  (o) => o.operationId === "executeCommunicationCommand"
)!;
const id = "10000000-0000-4000-8000-000000002001";
test("communication commands reject caller-controlled recipients, text, scope and malformed variants", () => {
  const base = {
    headers: {
      authorization: "Bearer synthetic",
      "x-clinic-id": id,
      "idempotency-key": "synthetic-communication-command",
      "content-type": "application/json"
    },
    path: {},
    query: {}
  };
  for (const body of [
    {
      kind: "approve",
      threadId: id,
      appointmentId: id,
      templateId: id,
      expectedDigest: "a".repeat(64),
      recipient: "+919999888877"
    },
    { kind: "read", threadId: id, throughSequence: -1 },
    {
      kind: "link",
      threadId: id,
      expectedVersion: 1,
      patientId: id,
      leadId: null,
      reason: "test",
      tenantId: id
    },
    {
      kind: "approve",
      threadId: id,
      appointmentId: id,
      templateId: id,
      expectedDigest: "a".repeat(64),
      text: "secret"
    }
  ])
    assert.equal(parseOperationRequest(op, { ...base, body }).success, false);
  assert.equal(
    parseOperationRequest(op, {
      ...base,
      body: {
        kind: "approve",
        threadId: id,
        appointmentId: id,
        templateId: id,
        expectedDigest: "a".repeat(64)
      }
    }).success,
    true
  );
});
