import assert from "node:assert/strict";
import test from "node:test";
import { maskEmail, maskFreeTextPhi, redactPhi } from "../src/redaction.ts";

test("email masking preserves normal free-text behavior and bounds adversarial runs", () => {
  const normal = "Contact rhea@example.test or second@clinic.example.test.";
  assert.equal(maskEmail(normal), "Contact r***@example.test or s***@clinic.example.test.");
  const noAddress = "%".repeat(100_000);
  assert.equal(maskEmail(noAddress), noAddress);
  assert.equal(maskFreeTextPhi(noAddress), noAddress);
  for (const address of [
    "%".repeat(100_000) + "@example.test",
    "r@" + "a.".repeat(50_000) + "test"
  ]) {
    assert.equal(maskEmail(`Before ${address} after`), "Before [REDACTED] after");
    assert.equal(maskFreeTextPhi(address, "[PRIVATE]"), "[PRIVATE]");
    assert.deepEqual(redactPhi({ message: address }), { message: "[REDACTED]" });
  }
});
