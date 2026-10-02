import assert from "node:assert/strict";
import test from "node:test";
import { SecurityAuditRuntime } from "../identity/security-audit-runtime.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

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

test("shutdown drains in-flight delivery and the final lease withdrawal before adapter close", async () => {
  const controller = new AbortController();
  const delivery = deferred();
  const withdrawal = deferred();
  const withdrawing = deferred();
  const events: string[] = [];
  const runtime = new SecurityAuditRuntime({
    dispatcher: {
      async runOnce() {
        events.push("delivery started");
        await delivery.promise;
        events.push("delivery finished");
        return { delivered: 1, conflicts: 0, scanComplete: true };
      },
      async readiness() { events.push("readiness"); }
    },
    async publishReadiness(healthy) {
      assert.equal(healthy, false, "Aborted delivery cannot renew the ready lease.");
      events.push("withdrawal started");
      withdrawing.resolve();
      await withdrawal.promise;
      events.push("withdrawal finished");
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    metrics: { gauge() {}, timing() {}, increment() {} }
  });
  const running = runtime.start(controller.signal);
  controller.abort();
  const closing = runtime.drain().then(() => { events.push("adapters closed"); });
  await Promise.resolve();
  assert.deepEqual(events, ["delivery started"]);
  delivery.resolve();
  await withdrawing.promise;
  assert.equal((await runtime.healthCheck()).status, "unhealthy");
  assert.deepEqual(events, ["delivery started", "delivery finished", "withdrawal started"]);
  await assert.rejects(runtime.start(controller.signal), /already running/);
  withdrawal.resolve();
  await Promise.all([running, closing]);
  assert.deepEqual(events, ["delivery started", "delivery finished", "withdrawal started", "withdrawal finished", "adapters closed"]);
});

test("shutdown during a readiness probe cannot renew the ready lease", async () => {
  const controller = new AbortController();
  const probing = deferred();
  const ready = deferred();
  const published: boolean[] = [];
  const runtime = new SecurityAuditRuntime({
    dispatcher: {
      async runOnce() { return { delivered: 0, conflicts: 0, scanComplete: true }; },
      async readiness() { probing.resolve(); await ready.promise; }
    },
    async publishReadiness(healthy) { published.push(healthy); },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    metrics: { gauge() {}, timing() {}, increment() {} }
  });
  const running = runtime.start(controller.signal);
  await probing.promise;
  controller.abort();
  ready.resolve();
  await Promise.all([running, runtime.drain()]);
  assert.deepEqual(published, [false]);
});
