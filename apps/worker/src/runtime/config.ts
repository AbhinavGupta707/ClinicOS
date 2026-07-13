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
  readonly temporalTls?: {
    readonly serverName: string;
    readonly caCertificate: string;
    readonly clientCertificate: string;
    readonly clientKey: string;
  };
  readonly temporalAuth?: {
    readonly tokenUrl: string;
    readonly clientId: string;
    readonly clientSecret: string;
  };
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
  readonly officialProviderCallbacksEnabled: boolean;
  readonly awsRegion: string;
  readonly providerEndpointHmacSecret?: string;
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
  const temporalTls = parseTemporalTls(env);
  const temporalAuth = parseTemporalAuth(env);
  const officialProviderCallbacksEnabled = parseBoolean(
    env.CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED
  );
  const awsRegion = env.S3_REGION ?? "ap-south-1";
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/u.test(awsRegion)) {
    throw new Error("S3_REGION must be a canonical AWS region for official provider secrets");
  }
  const providerEndpointHmacSecret = env.CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET;
  if (
    officialProviderCallbacksEnabled &&
    (!providerEndpointHmacSecret || Buffer.byteLength(providerEndpointHmacSecret, "utf8") < 32)
  ) {
    throw new Error(
      "CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET is required for official provider activities"
    );
  }
  if (productionLike && env.TEMPORAL_ADDRESS && !temporalTls) {
    throw new Error("Production-like Temporal connections require mutual TLS");
  }
  if (productionLike && env.TEMPORAL_ADDRESS && !temporalAuth) {
    throw new Error("Production-like Temporal connections require OAuth authorization");
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
    ...(temporalTls ? { temporalTls } : {}),
    ...(temporalAuth ? { temporalAuth } : {}),
    healthPort: parsePositiveInteger(env.WORKER_HEALTH_PORT, 8082),
    outboxBatchSize: parsePositiveInteger(env.OUTBOX_BATCH_SIZE, 25),
    outboxPollIntervalMs: parsePositiveInteger(env.OUTBOX_POLL_INTERVAL_MS, 1000),
    outboxMaxAttempts: parsePositiveInteger(env.OUTBOX_MAX_ATTEMPTS, 8),
    ...(dueGenerationCursorSecret ? { dueGenerationCursorSecret } : {}),
    paymentProvider,
    officialProviderCallbacksEnabled,
    awsRegion,
    ...(providerEndpointHmacSecret ? { providerEndpointHmacSecret } : {}),
    paymentQrMode: env.PAYMENT_QR_MODE === "razorpay_qr" ? "razorpay_qr" : "payment_link_qr",
    ...(env.RAZORPAY_KEY_ID ? { razorpayKeyId: env.RAZORPAY_KEY_ID } : {}),
    ...(env.RAZORPAY_KEY_SECRET ? { razorpayKeySecret: env.RAZORPAY_KEY_SECRET } : {}),
    ...(env.RAZORPAY_WEBHOOK_SECRET ? { razorpayWebhookSecret: env.RAZORPAY_WEBHOOK_SECRET } : {}),
    ...(env.RAZORPAY_WEBHOOK_URL ? { razorpayWebhookUrl: env.RAZORPAY_WEBHOOK_URL } : {})
  };
}

function parseBoolean(value: string | undefined): boolean {
  if (value === undefined || value === "false") return false;
  if (value === "true") return true;
  throw new Error("CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED must be true or false");
}

function parseTemporalAuth(env: NodeJS.ProcessEnv): WorkerEnvironment["temporalAuth"] {
  const names = [
    "TEMPORAL_AUTH_TOKEN_URL",
    "TEMPORAL_AUTH_CLIENT_ID",
    "TEMPORAL_AUTH_CLIENT_SECRET"
  ] as const;
  const supplied = names.filter((name) => Boolean(env[name]));
  if (supplied.length === 0) return undefined;
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Temporal OAuth configuration is incomplete: ${missing.join(", ")}`);
  }
  const tokenUrl = env.TEMPORAL_AUTH_TOKEN_URL as string;
  const clientId = env.TEMPORAL_AUTH_CLIENT_ID as string;
  const clientSecret = env.TEMPORAL_AUTH_CLIENT_SECRET as string;
  let parsed: URL;
  try {
    parsed = new URL(tokenUrl);
  } catch {
    throw new Error("TEMPORAL_AUTH_TOKEN_URL must be a canonical HTTPS endpoint");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    tokenUrl !== `${parsed.origin}${parsed.pathname}` ||
    !/^\/realms\/[a-z][a-z0-9-]{2,62}\/protocol\/openid-connect\/token$/u.test(parsed.pathname)
  ) {
    throw new Error("TEMPORAL_AUTH_TOKEN_URL must be a canonical HTTPS realm token endpoint");
  }
  if (
    clientId !== "clinic-os-temporal-worker" ||
    clientSecret.length < 32 ||
    clientSecret.length > 512
  ) {
    throw new Error("Temporal OAuth client identity or secret is outside the approved contract");
  }
  return { tokenUrl, clientId, clientSecret };
}

function parseTemporalTls(env: NodeJS.ProcessEnv): WorkerEnvironment["temporalTls"] {
  const names = [
    "TEMPORAL_TLS_SERVER_NAME",
    "TEMPORAL_TLS_CA_CERT",
    "TEMPORAL_TLS_CLIENT_CERT",
    "TEMPORAL_TLS_CLIENT_KEY"
  ] as const;
  const supplied = names.filter((name) => Boolean(env[name]));
  if (supplied.length === 0) return undefined;
  const missing = names.filter((name) => !env[name]);
  if (missing.length) {
    throw new Error(`Temporal mTLS configuration is incomplete: ${missing.join(", ")}`);
  }

  const serverName = env.TEMPORAL_TLS_SERVER_NAME as string;
  const caCertificate = boundedPem(
    env.TEMPORAL_TLS_CA_CERT as string,
    "TEMPORAL_TLS_CA_CERT",
    /-----BEGIN CERTIFICATE-----/u
  );
  const clientCertificate = boundedPem(
    env.TEMPORAL_TLS_CLIENT_CERT as string,
    "TEMPORAL_TLS_CLIENT_CERT",
    /-----BEGIN CERTIFICATE-----/u
  );
  const clientKey = boundedPem(
    env.TEMPORAL_TLS_CLIENT_KEY as string,
    "TEMPORAL_TLS_CLIENT_KEY",
    /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/u
  );
  if (
    serverName.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      serverName
    )
  ) {
    throw new Error("TEMPORAL_TLS_SERVER_NAME must be a bounded canonical DNS name");
  }
  return { serverName, caCertificate, clientCertificate, clientKey };
}

function boundedPem(value: string, name: string, marker: RegExp): string {
  if (value.length < 64 || value.length > 65_536 || !marker.test(value)) {
    throw new Error(`${name} must contain one bounded PEM value`);
  }
  return value;
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
