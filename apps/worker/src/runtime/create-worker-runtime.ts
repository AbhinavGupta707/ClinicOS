import type { Client } from "@temporalio/client";
import type { Logger, MetricRecorder } from "@clinic-os/observability";
import { createWorkerHealthRegistry } from "../health/worker-health.js";
import { OutboxProcessor } from "../outbox/processor.js";
import type { OutboxEventHandler, OutboxRepository } from "../outbox/types.js";

export interface WorkerRuntimeOptions {
  readonly workerId: string;
  readonly repository: OutboxRepository;
  readonly handlers: readonly OutboxEventHandler[];
  readonly logger: Logger;
  readonly metrics: MetricRecorder;
  readonly temporalClient?: Client;
  readonly outboxBatchSize: number;
  readonly outboxPollIntervalMs: number;
  readonly outboxMaxAttempts: number;
}

export interface WorkerRuntime {
  readonly processor: OutboxProcessor;
  readonly healthRegistry: ReturnType<typeof createWorkerHealthRegistry>;
  start(signal?: AbortSignal): Promise<void>;
}

export function createWorkerRuntime(options: WorkerRuntimeOptions): WorkerRuntime {
  const processor = new OutboxProcessor({
    workerId: options.workerId,
    repository: options.repository,
    handlers: options.handlers,
    logger: options.logger,
    metrics: options.metrics,
    batchSize: options.outboxBatchSize,
    pollIntervalMs: options.outboxPollIntervalMs,
    maxAttempts: options.outboxMaxAttempts
  });

  const healthRegistry = createWorkerHealthRegistry({
    service: "clinic-os-worker",
    repository: options.repository,
    processor,
    ...(options.temporalClient ? { temporalClient: options.temporalClient } : {})
  });

  return {
    processor,
    healthRegistry,
    start: (signal) => processor.start(signal)
  };
}
