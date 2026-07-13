import type { Client } from "@temporalio/client";
import type {
  HealthCheckResult,
  Logger,
  MetricRecorder,
  ObservabilityRuntime
} from "@clinic-os/observability";
import { createWorkerHealthRegistry } from "../health/worker-health.js";
import { OutboxProcessor } from "../outbox/processor.js";
import type { OutboxEventHandler, OutboxRepository } from "../outbox/types.js";

export interface WorkerBackgroundRuntimePort {
  start(signal?: AbortSignal): Promise<void>;
  healthCheck(): Promise<HealthCheckResult>;
}

export interface WorkerBackpressurePort {
  observe(): Promise<Readonly<{ ready: boolean; state: "healthy" | "degraded" | "unhealthy" }>>;
  admitEventTypes(registeredEventTypes: readonly string[]): Promise<readonly string[]>;
}

export interface WorkerRuntimeOptions {
  readonly workerId: string;
  readonly repository: OutboxRepository;
  readonly handlers: readonly OutboxEventHandler[];
  readonly logger: Logger;
  readonly metrics: MetricRecorder;
  readonly observability?: ObservabilityRuntime;
  readonly backpressure?: WorkerBackpressurePort;
  readonly temporalClient?: Client;
  readonly outboxBatchSize: number;
  readonly outboxPollIntervalMs: number;
  readonly outboxMaxAttempts: number;
  readonly providerReconciliation?: WorkerBackgroundRuntimePort;
}

export interface WorkerRuntime {
  readonly processor: OutboxProcessor;
  readonly healthRegistry: ReturnType<typeof createWorkerHealthRegistry>;
  readonly providerReconciliation?: WorkerBackgroundRuntimePort;
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
    maxAttempts: options.outboxMaxAttempts,
    ...(options.backpressure
      ? { admitEventTypes: (eventTypes) => options.backpressure!.admitEventTypes(eventTypes) }
      : {})
  });

  const healthRegistry = createWorkerHealthRegistry({
    service: "clinic-os-worker",
    repository: options.repository,
    processor,
    ...(options.temporalClient ? { temporalClient: options.temporalClient } : {}),
    ...(options.observability ? { observability: options.observability } : {}),
    ...(options.backpressure ? { backpressure: options.backpressure } : {}),
    ...(options.providerReconciliation
      ? { providerReconciliation: options.providerReconciliation }
      : {})
  });

  return {
    processor,
    healthRegistry,
    ...(options.providerReconciliation
      ? { providerReconciliation: options.providerReconciliation }
      : {}),
    start: async (signal) => {
      await Promise.all([
        processor.start(signal),
        ...(options.providerReconciliation ? [options.providerReconciliation.start(signal)] : [])
      ]);
    }
  };
}
