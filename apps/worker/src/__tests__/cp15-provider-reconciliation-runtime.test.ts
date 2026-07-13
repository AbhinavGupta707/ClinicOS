import assert from "node:assert/strict";
import test from "node:test";
import {
  createConsoleMetricRecorder,
  createJsonLogger,
  type RecordedMetric
} from "@clinic-os/observability";
import { ProviderReconciliationRuntime } from "../cp15/provider-reconciliation-runtime.js";
import type {
  ClaimedProviderReconciliationScope,
  ProviderReconciliationScopeSource
} from "../cp15/postgres-provider-reconciliation-scope-source.js";

const SCOPE: ClaimedProviderReconciliationScope = {
  tenantId: "15000000-0000-4000-8000-000000000001",
  clinicId: "15000000-0000-4000-8000-000000000101",
  leaseOwner: "cp15-runtime-test:scope"
};

test("CP15 reconciliation runtime processes a claimed scope and refreshes its durable schedule", async () => {
  const source = new MemoryScopeSource([SCOPE]);
  const metrics: RecordedMetric[] = [];
  const runtime = new ProviderReconciliationRuntime({
    workerId: "cp15-runtime-test",
    processor: {
      async pollOnce(scope) {
        assert.deepEqual(scope, SCOPE);
        return {
          claimed: 3,
          matched: 1,
          variances: 1,
          retriesScheduled: 1,
          deadLettered: 0,
          manualReview: 0,
          leaseLost: 0
        };
      }
    },
    scopes: source,
    logger: testLogger(),
    metrics: createConsoleMetricRecorder((metric) => metrics.push(metric)),
    pollIntervalMs: 1_000,
    scopeBatchSize: 10,
    scopeLeaseMs: 300_000,
    clock: { now: () => new Date("2026-07-13T12:00:00.000Z") }
  });

  assert.deepEqual(await runtime.pollOnce(), { scopes: 1, jobs: 3, failures: 0 });
  assert.deepEqual(source.refreshed, [SCOPE]);
  assert.deepEqual(
    metrics
      .filter((metric) => metric.name === "clinic_os.provider.outcomes")
      .map((metric) => [metric.tags.status, metric.value]),
    [
      ["success", 1],
      ["degraded", 1],
      ["retry_scheduled", 1]
    ]
  );
});

test("CP15 reconciliation runtime contains a scope failure and still releases the scheduler lease", async () => {
  const source = new MemoryScopeSource([SCOPE]);
  const runtime = new ProviderReconciliationRuntime({
    workerId: "cp15-runtime-test",
    processor: {
      async pollOnce() {
        throw new Error("synthetic provider failure that must not escape");
      }
    },
    scopes: source,
    logger: testLogger(),
    metrics: createConsoleMetricRecorder(() => undefined),
    pollIntervalMs: 1_000,
    scopeBatchSize: 10,
    scopeLeaseMs: 300_000,
    clock: { now: () => new Date("2026-07-13T12:00:00.000Z") }
  });

  assert.deepEqual(await runtime.pollOnce(), { scopes: 1, jobs: 0, failures: 1 });
  assert.deepEqual(source.refreshed, [SCOPE]);
  assert.equal((await runtime.healthCheck()).status, "degraded");
});

test("CP15 reconciliation runtime becomes healthy only after its background loop starts cleanly", async () => {
  const source = new MemoryScopeSource([]);
  const abort = new AbortController();
  const runtime = new ProviderReconciliationRuntime({
    workerId: "cp15-runtime-test",
    processor: {
      async pollOnce() {
        throw new Error("no scope should be processed");
      }
    },
    scopes: source,
    logger: testLogger(),
    metrics: createConsoleMetricRecorder(() => undefined),
    pollIntervalMs: 1_000,
    scopeBatchSize: 10,
    scopeLeaseMs: 300_000,
    clock: { now: () => new Date("2026-07-13T12:00:00.000Z") },
    sleep: async () => {
      abort.abort(new Error("test shutdown"));
    }
  });

  assert.equal((await runtime.healthCheck()).status, "degraded");
  await runtime.start(abort.signal);
  assert.equal((await runtime.healthCheck()).status, "healthy");
});

class MemoryScopeSource implements ProviderReconciliationScopeSource {
  readonly refreshed: ClaimedProviderReconciliationScope[] = [];
  readonly #claimed: ClaimedProviderReconciliationScope[];

  constructor(claimed: readonly ClaimedProviderReconciliationScope[]) {
    this.#claimed = [...claimed];
  }

  async claimDueScopes(): Promise<readonly ClaimedProviderReconciliationScope[]> {
    return this.#claimed.splice(0);
  }

  async refreshScope(
    scope: ClaimedProviderReconciliationScope
  ): Promise<"refreshed" | "removed" | "lease_lost"> {
    this.refreshed.push(scope);
    return "removed";
  }

  async countDue(): Promise<number> {
    return this.#claimed.length;
  }
}

function testLogger() {
  return createJsonLogger({
    service: "cp15-runtime-test",
    environment: "test",
    sink: () => undefined
  });
}
