import { randomUUID } from "node:crypto";

export interface WorkerEnvironment {
  readonly nodeEnv: string;
  readonly clinicOsEnv: string;
  readonly workerId: string;
  readonly databaseUrl: string;
  readonly temporalAddress?: string;
  readonly temporalNamespace?: string;
  readonly temporalTaskQueue?: string;
  readonly healthPort: number;
  readonly outboxBatchSize: number;
  readonly outboxPollIntervalMs: number;
  readonly outboxMaxAttempts: number;
}

export function parseWorkerEnvironment(env: NodeJS.ProcessEnv): WorkerEnvironment {
  const databaseUrl = requiredEnv(env, "DATABASE_URL");

  return {
    nodeEnv: env.NODE_ENV ?? "development",
    clinicOsEnv: env.CLINIC_OS_ENV ?? "local",
    workerId: env.WORKER_ID ?? `worker-${randomUUID()}`,
    databaseUrl,
    ...(env.TEMPORAL_ADDRESS ? { temporalAddress: env.TEMPORAL_ADDRESS } : {}),
    ...(env.TEMPORAL_NAMESPACE ? { temporalNamespace: env.TEMPORAL_NAMESPACE } : {}),
    ...(env.TEMPORAL_TASK_QUEUE ? { temporalTaskQueue: env.TEMPORAL_TASK_QUEUE } : {}),
    healthPort: parsePositiveInteger(env.WORKER_HEALTH_PORT, 8082),
    outboxBatchSize: parsePositiveInteger(env.OUTBOX_BATCH_SIZE, 25),
    outboxPollIntervalMs: parsePositiveInteger(env.OUTBOX_POLL_INTERVAL_MS, 1000),
    outboxMaxAttempts: parsePositiveInteger(env.OUTBOX_MAX_ATTEMPTS, 8)
  };
}

function requiredEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected positive integer but received ${value}`);
  }
  return parsed;
}
