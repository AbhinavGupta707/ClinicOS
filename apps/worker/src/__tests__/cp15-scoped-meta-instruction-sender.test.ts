import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { createScopedMetaInstructionSender } from "../cp15/scoped-meta-instruction-sender.js";

// Actual dispatch, SQL constraints, RLS and fault races run in the guarded real
// PostgreSQL probe scripts/test-instruction-dispatch-repositories.mjs, including CI.
// A permissive SQL mock cannot establish any of those properties.
test("instruction sender rejects an invalid endpoint key before database/provider access", () => {
  let touched = false;
  assert.throws(
    () =>
      createScopedMetaInstructionSender({
        pool: {
          async connect() {
            touched = true;
            throw new Error("must not connect");
          }
        } as unknown as Pool,
        secrets: {
          async resolveSecret() {
            touched = true;
            throw new Error("must not resolve");
          }
        },
        endpointHmacSecret: new Uint8Array(31)
      }),
    /at least 32 bytes/
  );
  assert.equal(touched, false);
});
