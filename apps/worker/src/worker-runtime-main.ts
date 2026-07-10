import { Pool } from "pg";
import { createPaymentProvider } from "@clinic-os/integrations";
import { systemClock, type Clock } from "@clinic-os/domain";
import { createClinicTemporalWorker, createTemporalClient } from "@clinic-os/workflow";
import {
  InstrumentationHooks,
  createJsonLogger,
  redactForLogs,
  type ObservabilityRuntime
} from "@clinic-os/observability";
import { startWorkerHealthServer } from "./health/health-server.js";
import { createCp13WorkerComposition } from "./cp13/create-cp13-worker-composition.js";
import {
  createCp14WorkerObservability,
  createTemporalActivityTraceInterceptor,
  createTemporalWorkflowClientTraceInterceptor
} from "./cp14-observability/index.js";
import { APPROVAL_WORKFLOW_REQUESTED_EVENT } from "./outbox/handlers/approval-workflow-requested.js";
import { CP13_PAYMENT_REQUEST_RECOVERY_REQUESTED_EVENT } from "./outbox/handlers/cp13-payment-request-recovery-requested.js";
import { createPostgresCp13ActivityPorts } from "./cp13/postgres-cp13-activity-ports.js";
import type { OutboxEventHandler } from "./outbox/types.js";
import { PostgresOutboxRepository } from "./postgres/postgres-outbox-repository.js";
import { parseWorkerEnvironment } from "./runtime/config.js";
import { createWorkerRuntime } from "./runtime/create-worker-runtime.js";

export async function runWorker(
  observability: ObservabilityRuntime,
  clock: Clock = systemClock
): Promise<void> {
  const env = parseWorkerEnvironment(process.env);
  const logger = createJsonLogger({
    service: "clinic-os-worker",
    environment: env.clinicOsEnv,
    redact: redactForLogs
  });
  const instrumentation = new InstrumentationHooks({
    tracer: observability.tracer,
    metrics: observability.metrics,
    logger,
    monotonicNowMs: () => performance.now()
  });
  const repository = new PostgresOutboxRepository({ connectionString: env.databaseUrl });
  const temporalClient = env.temporalAddress
    ? await createTemporalClient({
        address: env.temporalAddress,
        namespace: env.temporalNamespace,
        workflowInterceptors: [createTemporalWorkflowClientTraceInterceptor()]
      })
    : undefined;
  const handlers: OutboxEventHandler[] = [];
  const activityPool = env.temporalAddress
    ? new Pool({ connectionString: env.activityDatabaseUrl })
    : undefined;
  let temporalWorker: Awaited<ReturnType<typeof createClinicTemporalWorker>> | undefined;

  if (temporalClient && activityPool && env.temporalAddress) {
    const paymentProvider = createPaymentProvider({
      provider: env.paymentProvider,
      qrMode: env.paymentQrMode,
      razorpayKeyId: env.razorpayKeyId,
      razorpayKeySecret: env.razorpayKeySecret,
      razorpayWebhookSecret: env.razorpayWebhookSecret,
      razorpayWebhookUrl: env.razorpayWebhookUrl
    });
    const composition = createCp13WorkerComposition({
      temporalClient,
      cp13ActivityPorts: createPostgresCp13ActivityPorts({
        pool: activityPool,
        paymentProvider,
        workerId: env.workerId,
        dueGenerationCursorSecret: env.dueGenerationCursorSecret
      }),
      ...(env.temporalTaskQueue ? { taskQueue: env.temporalTaskQueue } : {})
    });
    handlers.push(...composition.handlers);
    temporalWorker = await createClinicTemporalWorker({
      address: env.temporalAddress,
      namespace: env.temporalNamespace,
      taskQueue: env.temporalTaskQueue,
      activities: composition.activities,
      activityInterceptors: [createTemporalActivityTraceInterceptor(instrumentation)]
    });
  }

  const workerObservability = createCp14WorkerObservability({
    runner: instrumentation,
    metrics: observability.metrics,
    traceContextStore: repository
  });
  const criticalEventTypes = new Set([
    APPROVAL_WORKFLOW_REQUESTED_EVENT,
    CP13_PAYMENT_REQUEST_RECOVERY_REQUESTED_EVENT
  ]);
  const observeBackpressure = async () => {
    const observedAt = clock.now();
    const stats = await repository.getBacklogStats(observedAt.toISOString());
    const oldestAgeSeconds = stats.oldestPendingOccurredAt
      ? Math.max(
          0,
          Math.floor((observedAt.getTime() - Date.parse(stats.oldestPendingOccurredAt)) / 1_000)
        )
      : 0;
    return workerObservability.observeBackpressure(
      {
        queueDepth: stats.pending + stats.processing + stats.retryScheduled,
        dueNow: stats.dueNow,
        oldestAgeSeconds,
        deadLettered: stats.deadLettered,
        dependencyHealthy: observability.state() === "ready" || observability.state() === "disabled"
      },
      [
        { component: "database", required: true, state: "healthy" },
        {
          component: "telemetry",
          required: observability.configuration.requireExport,
          state:
            observability.state() === "ready"
              ? "healthy"
              : observability.state() === "disabled"
                ? "not_configured"
                : "unhealthy"
        }
      ]
    );
  };
  const backpressure = {
    async observe() {
      return (await observeBackpressure()).readiness;
    },
    async admitEventTypes(eventTypes: readonly string[]) {
      const decision = (await observeBackpressure()).backpressure;
      if (!decision.acceptCritical) return [];
      return decision.acceptNoncritical
        ? eventTypes
        : eventTypes.filter((eventType) => criticalEventTypes.has(eventType));
    }
  };

  const runtime = createWorkerRuntime({
    workerId: env.workerId,
    repository,
    handlers: handlers.map((handler) => workerObservability.wrapOutboxHandler(handler)),
    logger,
    metrics: observability.metrics,
    observability,
    backpressure,
    ...(temporalClient ? { temporalClient } : {}),
    outboxBatchSize: env.outboxBatchSize,
    outboxPollIntervalMs: env.outboxPollIntervalMs,
    outboxMaxAttempts: env.outboxMaxAttempts
  });

  const server = await startWorkerHealthServer({
    registry: runtime.healthRegistry,
    port: env.healthPort
  });

  const abortController = new AbortController();
  let stopPromise: Promise<void> | undefined;
  const stop = () => {
    stopPromise ??= (async () => {
      abortController.abort(new Error("worker shutdown requested"));
      temporalWorker?.shutdown();
      const serverClose = server.listening
        ? new Promise<void>((resolve, reject) => {
            server.close((error) => (error ? reject(error) : resolve()));
          })
        : Promise.resolve();
      const results = await Promise.allSettled([
        serverClose,
        repository.close(),
        activityPool?.end() ?? Promise.resolve(),
        observability.shutdown()
      ]);
      const rejected = results.filter((result) => result.status === "rejected").length;
      const telemetryResult = results[3];
      const telemetryErrors =
        telemetryResult?.status === "fulfilled" ? telemetryResult.value.errors : [];
      if (rejected > 0 || telemetryErrors.length > 0) {
        logger.error("worker shutdown completed with bounded cleanup failures", {
          event: "worker.shutdown.failed",
          errorCode: rejected > 0 ? "RESOURCE_CLOSE_FAILED" : telemetryErrors[0]
        });
      }
    })();
    return stopPromise;
  };

  process.once("SIGINT", () => void stop().catch(() => undefined));
  process.once("SIGTERM", () => void stop().catch(() => undefined));

  logger.info("worker health server started", {
    event: "worker.health.started",
    workerId: env.workerId,
    port: env.healthPort
  });

  try {
    await Promise.all([
      runtime.start(abortController.signal),
      ...(temporalWorker ? [temporalWorker.run()] : [])
    ]);
  } catch (error) {
    if (!abortController.signal.aborted) throw error;
  } finally {
    await stop();
  }
}
