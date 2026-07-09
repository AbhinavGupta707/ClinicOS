import { createTemporalClient } from "@clinic-os/workflow";
import {
  createConsoleMetricRecorder,
  createJsonLogger,
  redactForLogs
} from "@clinic-os/observability";
import { startWorkerHealthServer } from "./health/health-server.js";
import { ApprovalWorkflowRequestedHandler } from "./outbox/handlers/approval-workflow-requested.js";
import type { OutboxEventHandler } from "./outbox/types.js";
import { PostgresOutboxRepository } from "./postgres/postgres-outbox-repository.js";
import { parseWorkerEnvironment } from "./runtime/config.js";
import { createWorkerRuntime } from "./runtime/create-worker-runtime.js";

async function main(): Promise<void> {
  const env = parseWorkerEnvironment(process.env);
  const logger = createJsonLogger({
    service: "clinic-os-worker",
    environment: env.clinicOsEnv,
    redact: redactForLogs
  });
  const metrics = createConsoleMetricRecorder();
  const repository = new PostgresOutboxRepository({ connectionString: env.databaseUrl });
  const temporalClient = env.temporalAddress
    ? await createTemporalClient({
        address: env.temporalAddress,
        namespace: env.temporalNamespace
      })
    : undefined;
  const handlers: OutboxEventHandler[] = [];

  if (temporalClient) {
    handlers.push(
      new ApprovalWorkflowRequestedHandler({
        temporalClient,
        taskQueue: env.temporalTaskQueue
      })
    );
  }

  const runtime = createWorkerRuntime({
    workerId: env.workerId,
    repository,
    handlers,
    logger,
    metrics,
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
      if (server.listening) {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        });
      }
      await repository.close();
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
    await runtime.start(abortController.signal);
  } catch (error) {
    if (!abortController.signal.aborted) throw error;
  } finally {
    await stop();
  }
}

main().catch((error) => {
  const logger = createJsonLogger({
    service: "clinic-os-worker",
    environment: process.env.CLINIC_OS_ENV ?? "local",
    redact: redactForLogs
  });
  logger.error("worker crashed during startup", {
    event: "worker.startup.failed",
    errorMessage: error instanceof Error ? error.message : String(error)
  });
  process.exitCode = 1;
});
