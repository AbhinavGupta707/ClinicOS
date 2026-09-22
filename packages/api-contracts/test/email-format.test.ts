import assert from "node:assert/strict";
import test from "node:test";
import { parseRuntimeSchema } from "../src/runtime-schema.ts";

test("email format rejects oversized adversarial input even with a prior length issue", () => {
  const definition = { type: "string", format: "email", maxLength: 320 } as const;
  for (const value of ["!@" + "!.".repeat(20_000) + " ", "a@b@c.test", "a@b", "a @b.test"]) {
    const result = parseRuntimeSchema(definition, value);
    assert.equal(result.success, false);
    if (!result.success) assert.ok(result.issues.some((issue) => issue.code === "format"));
  }
  assert.equal(parseRuntimeSchema(definition, "synthetic+trial@example.test").success, true);
});
