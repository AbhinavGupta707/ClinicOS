import assert from "node:assert/strict";
import test from "node:test";
import { runLegacyParitySuite } from "./legacy-parity-harness.mjs";

const cases = [
  { id: "success-read" },
  { id: "unauthenticated" },
  { id: "cross-tenant-denial" },
  { id: "state-conflict" },
  { id: "malformed-json", transition: "malformed_transport" },
  { id: "unknown-field", transition: "semantic_validation" },
  { id: "oversize-body", transition: "payload_too_large" }
];

test("legacy parity harness preserves behavior and permits only documented hardening transitions", async () => {
  const results = await runLegacyParitySuite({
    cases,
    invokeLegacy: (scenario) => Promise.resolve(legacyResult(scenario.id)),
    invokeCandidate: (scenario) => Promise.resolve(candidateResult(scenario.id))
  });
  assert.equal(results.length, cases.length);
  assert.equal(
    results.filter((result) => result.legacy.status === result.candidate.status).length,
    5
  );
  assert.deepEqual(
    results.map((result) => result.id),
    cases.map((scenario) => scenario.id)
  );
});

test("legacy parity harness fails on silent success drift and skips", async () => {
  await assert.rejects(
    () =>
      runLegacyParitySuite({
        cases: [{ id: "drift" }],
        invokeLegacy: () => Promise.resolve({ status: 200, body: { value: "canonical" } }),
        invokeCandidate: () => Promise.resolve({ status: 200, body: { value: "changed" } })
      }),
    /body drift/
  );
  await assert.rejects(
    () =>
      runLegacyParitySuite({
        cases: [{ id: "skipped", skip: "not available" }],
        invokeLegacy: () => Promise.resolve({ status: 200, body: {} }),
        invokeCandidate: () => Promise.resolve({ status: 200, body: {} })
      }),
    /must not be skipped/
  );
});

function legacyResult(id) {
  switch (id) {
    case "success-read":
      return { status: 200, body: { patient: { id: "synthetic-id", status: "active" } } };
    case "unauthenticated":
      return error(401, "UNAUTHENTICATED", "legacy-id");
    case "cross-tenant-denial":
      return error(403, "PERMISSION_DENIED", "legacy-id");
    case "state-conflict":
      return error(409, "CONFLICT", "legacy-id");
    case "malformed-json":
    case "unknown-field":
    case "oversize-body":
      return error(400, "VALIDATION_ERROR", "legacy-id");
    default:
      throw new Error(`Unknown legacy case: ${id}`);
  }
}

function candidateResult(id) {
  switch (id) {
    case "success-read":
      return { status: 200, body: { patient: { id: "synthetic-id", status: "active" } } };
    case "unauthenticated":
      return error(401, "UNAUTHENTICATED", "candidate-id");
    case "cross-tenant-denial":
      return error(403, "PERMISSION_DENIED", "candidate-id");
    case "state-conflict":
      return error(409, "CONFLICT", "candidate-id");
    case "malformed-json":
      return error(400, "BAD_REQUEST", "candidate-id");
    case "unknown-field":
      return error(422, "VALIDATION_ERROR", "candidate-id");
    case "oversize-body":
      return error(413, "PAYLOAD_TOO_LARGE", "candidate-id");
    default:
      throw new Error(`Unknown candidate case: ${id}`);
  }
}

function error(status, code, requestId) {
  return {
    status,
    headers: { "cache-control": "no-store", "x-request-id": requestId },
    body: {
      error: {
        code,
        message: "Stable public message.",
        details: {},
        request_id: requestId
      }
    }
  };
}
