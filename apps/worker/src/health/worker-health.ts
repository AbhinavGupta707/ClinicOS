import {
  HealthRegistry,
  createHealthCheckResult,
  type HealthProbe,
  type ObservabilityRuntime
} from "@clinic-os/observability";
import type { ExternalAdapter } from "@clinic-os/integrations";
import type { Client } from "@temporalio/client";
import type { OutboxProcessor } from "../outbox/processor.js";
import type { OutboxRepository } from "../outbox/types.js";
import type { WorkerBackpressurePort } from "../runtime/create-worker-runtime.js";

export interface WorkerHealthOptions {
  readonly service: string;
  readonly repository: OutboxRepository;
  readonly processor: OutboxProcessor;
  readonly temporalClient?: Client;
  readonly providerAdapters?: readonly ExternalAdapter[];
  readonly observability?: ObservabilityRuntime;
  readonly backpressure?: WorkerBackpressurePort;
}

export function createWorkerHealthRegistry(options: WorkerHealthOptions): HealthRegistry {
  const registry = new HealthRegistry(options.service);
  registry.register(createOutboxRepositoryProbe(options.repository));
  registry.register(createRegisteredHandlersProbe(options.processor));
  if (options.observability) {
    registry.register({
      name: "telemetry_export",
      async check() {
        await options.observability!.readiness();
        return createHealthCheckResult("telemetry_export", "healthy");
      }
    });
  }
  if (options.backpressure) {
    registry.register({
      name: "backpressure",
      async check() {
        const decision = await options.backpressure!.observe();
        return createHealthCheckResult("backpressure", decision.state);
      }
    });
  }

  if (options.temporalClient) {
    registry.register(createTemporalConnectionProbe(options.temporalClient));
  }

  for (const adapter of options.providerAdapters ?? []) {
    registry.register(createProviderHealthProbe(adapter));
  }

  return registry;
}

function createOutboxRepositoryProbe(repository: OutboxRepository): HealthProbe {
  return {
    name: "outbox_repository",
    async check() {
      await repository.healthCheck();
      const stats = await repository.getBacklogStats(new Date().toISOString());
      return createHealthCheckResult(
        "outbox_repository",
        stats.deadLettered > 0 ? "degraded" : "healthy",
        {
          details: {
            pending: stats.pending,
            retryScheduled: stats.retryScheduled,
            dueNow: stats.dueNow,
            deadLettered: stats.deadLettered,
            oldestPendingOccurredAt: stats.oldestPendingOccurredAt
          }
        }
      );
    }
  };
}

function createRegisteredHandlersProbe(processor: OutboxProcessor): HealthProbe {
  return {
    name: "registered_handlers",
    async check() {
      const eventTypes = processor.registeredEventTypes();
      return createHealthCheckResult(
        "registered_handlers",
        eventTypes.length > 0 ? "healthy" : "degraded",
        {
          message: eventTypes.length > 0 ? undefined : "no outbox handlers are registered",
          details: {
            eventTypes
          }
        }
      );
    }
  };
}

function createTemporalConnectionProbe(client: Client): HealthProbe {
  return {
    name: "temporal_connection",
    async check() {
      await client.workflowService.getSystemInfo({});
      return createHealthCheckResult("temporal_connection", "healthy");
    }
  };
}

function createProviderHealthProbe(adapter: ExternalAdapter): HealthProbe {
  return {
    name: `provider_health:${adapter.providerKey}`,
    async check() {
      const providerHealth = await adapter.healthCheck();
      return createHealthCheckResult(
        `provider_health:${adapter.providerKey}`,
        providerHealth.status === "available"
          ? "healthy"
          : providerHealth.status === "degraded" || providerHealth.status === "not_configured"
            ? "degraded"
            : "unhealthy",
        {
          message: providerHealth.message,
          details: {
            providerKey: providerHealth.providerKey,
            accountId: providerHealth.accountId,
            capabilities: providerHealth.capabilities,
            latencyMs: providerHealth.latencyMs
          }
        }
      );
    }
  };
}
