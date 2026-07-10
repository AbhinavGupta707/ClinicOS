import { randomUUID } from "node:crypto";

export interface WorkerEnvironment {
  readonly nodeEnv: string;
  readonly clinicOsEnv: string;
  readonly workerId: string;
  readonly databaseUrl: string;
  readonly activityDatabaseUrl: string;
  readonly temporalAddress?: string;
  readonly temporalNamespace?: string;
  readonly temporalTaskQueue?: string;
  readonly healthPort: number;
  readonly outboxBatchSize: number;
  readonly outboxPollIntervalMs: number;
  readonly outboxMaxAttempts: number;
  readonly dueGenerationCursorSecret?: string;
  readonly paymentProvider: "simulator" | "razorpay" | "unconfigured" | "manual_clinic_approved";
  readonly paymentQrMode: "payment_link_qr" | "razorpay_qr";
  readonly razorpayKeyId?: string;
  readonly razorpayKeySecret?: string;
  readonly razorpayWebhookSecret?: string;
  readonly razorpayWebhookUrl?: string;
}

export function parseWorkerEnvironment(env: NodeJS.ProcessEnv): WorkerEnvironment {
  const activityDatabaseUrl = requiredEnv(env, "DATABASE_URL");
  const productionLike = ["staging", "pilot-prod", "prod"].includes(env.CLINIC_OS_ENV ?? "local");
  const databaseUrl =
    env.WORKER_DATABASE_URL ??
    (productionLike ? requiredEnv(env, "WORKER_DATABASE_URL") : activityDatabaseUrl);
  const paymentProvider = parsePaymentProvider(env.PAYMENT_PROVIDER);
  const dueGenerationCursorSecret =
    env.CLINIC_OS_ABUSE_BUDGET_KEY_SECRET ??
    (productionLike ? undefined : "clinicos-local-synthetic-budget-secret-000000000000");
  if (productionLike && !dueGenerationCursorSecret) {
    throw new Error("CLINIC_OS_ABUSE_BUDGET_KEY_SECRET is required for CP13 workflow activities");
  }

  return {
    nodeEnv: env.NODE_ENV ?? "development",
    clinicOsEnv: env.CLINIC_OS_ENV ?? "local",
    workerId: env.WORKER_ID ?? `worker-${randomUUID()}`,
    databaseUrl,
    activityDatabaseUrl,
    ...(env.TEMPORAL_ADDRESS ? { temporalAddress: env.TEMPORAL_ADDRESS } : {}),
    ...(env.TEMPORAL_NAMESPACE ? { temporalNamespace: env.TEMPORAL_NAMESPACE } : {}),
    ...(env.TEMPORAL_TASK_QUEUE ? { temporalTaskQueue: env.TEMPORAL_TASK_QUEUE } : {}),
    healthPort: parsePositiveInteger(env.WORKER_HEALTH_PORT, 8082),
    outboxBatchSize: parsePositiveInteger(env.OUTBOX_BATCH_SIZE, 25),
    outboxPollIntervalMs: parsePositiveInteger(env.OUTBOX_POLL_INTERVAL_MS, 1000),
    outboxMaxAttempts: parsePositiveInteger(env.OUTBOX_MAX_ATTEMPTS, 8),
    ...(dueGenerationCursorSecret ? { dueGenerationCursorSecret } : {}),
    paymentProvider,
    paymentQrMode: env.PAYMENT_QR_MODE === "razorpay_qr" ? "razorpay_qr" : "payment_link_qr",
    ...(env.RAZORPAY_KEY_ID ? { razorpayKeyId: env.RAZORPAY_KEY_ID } : {}),
    ...(env.RAZORPAY_KEY_SECRET ? { razorpayKeySecret: env.RAZORPAY_KEY_SECRET } : {}),
    ...(env.RAZORPAY_WEBHOOK_SECRET ? { razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET } : {}),
    ...(env.RAZORPAY_WEBHOOK_URL ? { razorpayWebhookUrl: env.RAZORPAY_WEBHOOK_URL } : {})
  };
}

function parsePaymentProvider(value: string | undefined): WorkerEnvironment["paymentProvider"] {
  const provider = value ?? "simulator";
  if (["simulator", "razorpay", "unconfigured", "manual_clinic_approved"].includes(provider)) {
    return provider as WorkerEnvironment["paymentProvider"];
  }
  throw new Error(`Unsupported PAYMENT_PROVIDER ${provider}`);
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
