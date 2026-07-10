import assert from "node:assert/strict";

export const LEGACY_ERROR_TRANSITIONS = Object.freeze({
  malformed_transport: Object.freeze({
    legacy: Object.freeze({ status: 400, code: "VALIDATION_ERROR" }),
    candidate: Object.freeze({ status: 400, code: "BAD_REQUEST" })
  }),
  semantic_validation: Object.freeze({
    legacy: Object.freeze({ status: 400, code: "VALIDATION_ERROR" }),
    candidate: Object.freeze({ status: 422, code: "VALIDATION_ERROR" })
  }),
  payload_too_large: Object.freeze({
    legacy: Object.freeze({ status: 400, code: "VALIDATION_ERROR" }),
    candidate: Object.freeze({ status: 413, code: "PAYLOAD_TOO_LARGE" })
  })
});

export async function runLegacyParitySuite(input) {
  assert.ok(Array.isArray(input.cases) && input.cases.length > 0, "parity cases are required");
  const ids = input.cases.map((scenario) => scenario.id);
  assert.equal(new Set(ids).size, ids.length, "parity case ids must be unique");
  const results = [];

  for (const scenario of input.cases) {
    assert.equal(scenario.skip, undefined, `${scenario.id} must not be skipped`);
    const legacy = normalizeResult(await input.invokeLegacy(scenario));
    const candidate = normalizeResult(await input.invokeCandidate(scenario));

    if (scenario.transition) {
      const transition = LEGACY_ERROR_TRANSITIONS[scenario.transition];
      assert.ok(transition, `${scenario.id} names an unsupported transition`);
      assertErrorShape(scenario.id, legacy, transition.legacy);
      assertErrorShape(scenario.id, candidate, transition.candidate);
    } else {
      assert.equal(candidate.status, legacy.status, `${scenario.id} status drift`);
      assert.deepEqual(candidate.body, legacy.body, `${scenario.id} body drift`);
    }

    if (candidate.status === 429) {
      assert.match(candidate.headers["retry-after"] ?? "", /^\d+$/);
    }
    results.push({ id: scenario.id, legacy, candidate });
  }

  return results;
}

function assertErrorShape(caseId, result, expected) {
  assert.equal(result.status, expected.status, `${caseId} status transition mismatch`);
  assert.equal(result.body?.error?.code, expected.code, `${caseId} code transition mismatch`);
  assert.equal(typeof result.body?.error?.message, "string", `${caseId} missing public message`);
  assert.deepEqual(result.body?.error?.request_id, "<request-id>");
}

function normalizeResult(result) {
  assert.ok(result && typeof result === "object", "parity invocation must return a result object");
  assert.ok(Number.isInteger(result.status), "parity result requires an integer status");
  const body = structuredClone(result.body ?? null);
  if (body?.error && typeof body.error === "object" && "request_id" in body.error) {
    body.error.request_id = "<request-id>";
  }
  const headers = Object.fromEntries(
    Object.entries(result.headers ?? {}).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
  return { status: result.status, body, headers };
}
