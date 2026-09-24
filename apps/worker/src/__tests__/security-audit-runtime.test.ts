import assert from "node:assert/strict";
import test from "node:test";
import { SecurityAuditRuntime } from "../identity/security-audit-runtime.js";

test("audit runtime retries outages, recovers readiness, aborts and emits no event payload", async () => {
  const controller = new AbortController();
  const delays: number[] = [];
  const diagnostics: unknown[] = [];
  let calls = 0;
  const runtime: SecurityAuditRuntime = new SecurityAuditRuntime({
    dispatcher: {
      async runOnce() {
        calls++;
        if (calls < 3) throw new Error("subject=private token=private");
        return { delivered: 2, conflicts: 0, scanComplete: true };
      },
      async readiness() {}
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error: (...args) => {
        diagnostics.push(args);
      }
    },
    metrics: {
      gauge() {},
      timing() {},
      increment: (...args) => {
        diagnostics.push(args);
      }
    },
    pollIntervalMs: 100,
    async sleep(ms) {
      delays.push(ms);
      assert.equal((await runtime.healthCheck()).status, calls < 3 ? "unhealthy" : "healthy");
      if (calls === 3) controller.abort();
    }
  });
  assert.equal((await runtime.healthCheck()).status, "unhealthy");
  await runtime.start(controller.signal);
  assert.equal((await runtime.healthCheck()).status, "unhealthy");
  assert.deepEqual(delays, [200, 400, 100]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private|subject=|token=/);
});

test("a stopped or conflicting audit runtime cannot report healthy", async () => {
  const controller = new AbortController();
  const runtime: SecurityAuditRuntime = new SecurityAuditRuntime({
    dispatcher: {
      async runOnce() {
        return { delivered: 1, conflicts: 1, scanComplete: true };
      },
      async readiness() {}
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    metrics: { gauge() {}, timing() {}, increment() {} },
    async sleep() {
      assert.equal((await runtime.healthCheck()).status, "unhealthy");
      controller.abort();
    }
  });
  await runtime.start(controller.signal);
});
