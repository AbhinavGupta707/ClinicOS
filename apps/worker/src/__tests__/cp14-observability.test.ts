import assert from "node:assert/strict";
import test from "node:test";
import type { InstrumentedOperation, MetricRecorder, TraceCarrier } from "@clinic-os/observability";
import {
  classifyWorkerWorkflow,
  createCp14WorkerObservability,
  type WorkerOperationRunner
} from "../cp14-observability/index.js";
import type { OutboxEventHandler, OutboxEventRecord } from "../outbox/types.js";

test("worker instrumentation propagates bounded trace metadata without event payload telemetry", async () => {
  const operations: InstrumentedOperation[] = [];
  const runner: WorkerOperationRunner = {
    async run<T>(operation: InstrumentedOperation, execute: () => Promise<T>): Promise<T> {
      operations.push(operation);
      return execute();
    }
  };
  const metrics = recordedMetrics();
  const carrier: TraceCarrier = {
    traceparent: "00-10000000000000000000000000000001-1000000000000001-01"
  };
  const observed = createCp14WorkerObservability({
    runner,
    metrics: metrics.recorder,
    traceContextStore: {
      durability: "in_memory_test_double",
      loadForEvent: async () => carrier
    }
  });
  let handled = false;
  const handler: OutboxEventHandler = {
    eventType: "billing.payment.recovery.requested",
    handle: async () => {
      handled = true;
    }
  };
  const event = syntheticEvent({
    patientName: "Rhea Synthetic",
    signedUrl: "https://storage.example/object?signature=secret",
    objectKey: "tenant/clinic/patient/xray.jpg"
  });

  await observed.wrapOutboxHandler(handler).handle(event, {
    workerId: "worker-synthetic",
    attempt: {
      attemptId: "attempt-synthetic",
      eventId: event.eventId,
      attemptNumber: 1,
      workerId: "worker-synthetic",
      status: "started",
      startedAt: "2026-07-10T00:00:00.000Z"
    },
    correlationId: event.correlationId,
    tenantId: event.tenantId,
    clinicId: event.clinicId,
    idempotencyKey: event.idempotencyKey
  });

  assert.equal(handled, true);
  assert.deepEqual(operations, [
    {
      domain: "outbox",
      operation: "execute",
      workflow: "billing",
      carrier
    }
  ]);
  const serialized = JSON.stringify(operations);
  assert.doesNotMatch(serialized, /Rhea|signature=|objectKey|tenant-synthetic|clinic-synthetic/u);
});

test("worker backpressure emits bounded signals and removes readiness on dependency loss", () => {
  const metrics = recordedMetrics();
  const observed = createCp14WorkerObservability({
    runner: {
      run: async <T>(_operation: InstrumentedOperation, execute: () => Promise<T>) => execute()
    },
    metrics: metrics.recorder,
    traceContextStore: {
      durability: "in_memory_test_double",
      loadForEvent: async () => undefined
    }
  });

  const result = observed.observeBackpressure(
    {
      queueDepth: 50,
      dueNow: 10,
      oldestAgeSeconds: 30,
      deadLettered: 0,
      dependencyHealthy: false
    },
    [{ component: "postgres", required: true, state: "unhealthy" }]
  );

  assert.equal(result.backpressure.state, "not_ready");
  assert.equal(result.readiness.ready, false);
  assert.deepEqual(
    metrics.records.map((record) => record.name),
    [
      "clinic_os.outbox.depth",
      "clinic_os.outbox.oldest_age_seconds",
      "clinic_os.outbox.dead_lettered",
      "clinic_os.backpressure.state",
      "clinic_os.readiness"
    ]
  );
  assert.doesNotMatch(
    JSON.stringify(metrics.records.map((record) => record.tags)),
    /tenant|clinic|patient/iu
  );
});

test("worker event classification collapses arbitrary event names into bounded families", () => {
  assert.equal(classifyWorkerWorkflow("clinical.note.sign.requested"), "clinical");
  assert.equal(classifyWorkerWorkflow("identity.mfa.denied"), "identity");
  assert.equal(classifyWorkerWorkflow("patient-secret-free-text"), "front_office");
  assert.equal(classifyWorkerWorkflow("unknown-value-123456"), "other");
});

function recordedMetrics(): {
  readonly records: Array<{
    name: string;
    value: number;
    tags: Record<string, string | undefined>;
  }>;
  readonly recorder: MetricRecorder;
} {
  const records: Array<{
    name: string;
    value: number;
    tags: Record<string, string | undefined>;
  }> = [];
  return {
    records,
    recorder: {
      increment: (name, value = 1, tags = {}) => records.push({ name, value, tags: { ...tags } }),
      gauge: (name, value, tags = {}) => records.push({ name, value, tags: { ...tags } }),
      timing: (name, value, tags = {}) => records.push({ name, value, tags: { ...tags } })
    }
  };
}

function syntheticEvent(payload: Record<string, unknown>): OutboxEventRecord {
  return {
    eventId: "event-synthetic",
    eventType: "billing.payment.recovery.requested",
    schemaVersion: "1",
    tenantId: "tenant-synthetic",
    clinicId: "clinic-synthetic",
    aggregateType: "invoice",
    aggregateId: "invoice-synthetic",
    actor: { type: "system", id: "actor-synthetic" },
    correlationId: "correlation-synthetic",
    idempotencyKey: "idempotency-synthetic",
    payload,
    occurredAt: "2026-07-10T00:00:00.000Z",
    status: "processing",
    attemptCount: 1,
    createdAt: "2026-07-10T00:00:00.000Z",
    updatedAt: "2026-07-10T00:00:00.000Z"
  };
}
