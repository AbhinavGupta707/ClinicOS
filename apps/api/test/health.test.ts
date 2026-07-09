import assert from "node:assert/strict";
import test from "node:test";
import { ApiHealthMonitor } from "../src/health.ts";

test("readiness fails closed, recovers, and startup becomes sticky only after success", async () => {
  let databaseAvailable = false;
  const monitor = new ApiHealthMonitor({
    repositoryMode: "postgres",
    authMode: "local_synthetic_fixture",
    probes: [
      {
        name: "postgres_schema",
        required: true,
        async check() {
          if (!databaseAvailable) throw new Error("synthetic dependency fault");
        }
      }
    ]
  });

  const unavailable = await monitor.readiness();
  assert.equal(unavailable.status, "unavailable");
  assert.deepEqual(unavailable.dependencies, [
    {
      name: "postgres_schema",
      required: true,
      status: "unavailable",
      code: "probe_failed"
    }
  ]);
  assert.equal((await monitor.startup()).status, "unavailable");

  databaseAvailable = true;
  assert.equal((await monitor.startup()).status, "ready");
  assert.equal(await monitor.ensureStartup(), true);

  databaseAvailable = false;
  assert.equal((await monitor.startup()).status, "ready");
  assert.equal((await monitor.readiness()).status, "unavailable");
});

test("readiness bounds slow probes and never exposes dependency error messages", async () => {
  const monitor = new ApiHealthMonitor({
    repositoryMode: "postgres",
    authMode: "keycloak_jwks",
    probes: [
      {
        name: "keycloak_jwks",
        required: true,
        timeoutMs: 50,
        check: () => new Promise(() => undefined)
      }
    ]
  });

  const report = await monitor.readiness();
  assert.deepEqual(report.dependencies, [
    {
      name: "keycloak_jwks",
      required: true,
      status: "unavailable",
      code: "probe_timeout"
    }
  ]);
  assert.doesNotMatch(JSON.stringify(report), /secret|password|stack|message/iu);
});

test("fixture readiness is explicitly classified as E2 rather than durable evidence", async () => {
  const fixture = new ApiHealthMonitor({
    repositoryMode: "fixture",
    authMode: "local_synthetic_fixture"
  });
  const injected = new ApiHealthMonitor({
    repositoryMode: "injected",
    authMode: "keycloak_jwks"
  });

  assert.equal((await fixture.readiness()).evidence_tier, "E2_fixture");
  assert.equal((await fixture.readiness()).status, "ready");
  assert.equal((await injected.readiness()).status, "unavailable");
});
