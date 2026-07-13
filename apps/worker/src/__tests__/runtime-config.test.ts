import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkerEnvironment } from "../runtime/config.js";

const databaseUrl = "postgresql://runtime@localhost:5432/clinic_os";

function syntheticPem(label: string, fill: string): string {
  return [`-----BEGIN ${label}-----`, fill.repeat(64), `-----END ${label}-----`].join("\n");
}

test("local worker separates CP13 activity configuration and injects only local-safe defaults", () => {
  const parsed = parseWorkerEnvironment({
    CLINIC_OS_ENV: "local",
    DATABASE_URL: databaseUrl,
    TEMPORAL_ADDRESS: "127.0.0.1:7233",
    PAYMENT_PROVIDER: "simulator"
  });
  assert.equal(parsed.databaseUrl, databaseUrl);
  assert.equal(parsed.activityDatabaseUrl, databaseUrl);
  assert.equal(parsed.paymentProvider, "simulator");
  assert.equal(parsed.officialProviderCallbacksEnabled, false);
  assert.equal(parsed.awsRegion, "ap-south-1");
  assert.match(parsed.dueGenerationCursorSecret ?? "", /^clinicos-local-synthetic/u);
  assert.equal(parsed.providerReconciliationPollIntervalMs, 10_000);
  assert.equal(parsed.providerReconciliationScopeBatchSize, 10);
  assert.equal(parsed.providerReconciliationJobBatchSize, 1);
  assert.equal(parsed.providerReconciliationLeaseMs, 300_000);
});

test("official provider activities require strict enablement and endpoint binding", () => {
  const base = {
    CLINIC_OS_ENV: "local",
    DATABASE_URL: databaseUrl,
    PAYMENT_PROVIDER: "unconfigured"
  };
  assert.throws(
    () =>
      parseWorkerEnvironment({
        ...base,
        CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED: "sometimes"
      }),
    /must be true or false/u
  );
  assert.throws(
    () =>
      parseWorkerEnvironment({
        ...base,
        CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED: "true"
      }),
    /PROVIDER_ENDPOINT_HMAC_SECRET/u
  );

  const parsed = parseWorkerEnvironment({
    ...base,
    CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED: "true",
    CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET: "endpoint-binding-secret-value-00001",
    S3_REGION: "eu-west-2"
  });
  assert.equal(parsed.officialProviderCallbacksEnabled, true);
  assert.equal(parsed.awsRegion, "eu-west-2");
  assert.equal(parsed.providerEndpointHmacSecret, "endpoint-binding-secret-value-00001");
  assert.throws(
    () =>
      parseWorkerEnvironment({
        ...base,
        CLINIC_OS_OFFICIAL_PROVIDER_CALLBACKS_ENABLED: "true",
        CLINIC_OS_PROVIDER_ENDPOINT_HMAC_SECRET: "endpoint-binding-secret-value-00001",
        PROVIDER_RECONCILIATION_JOB_BATCH_SIZE: "2"
      }),
    /PROVIDER_RECONCILIATION_JOB_BATCH_SIZE/u
  );
});

test("production-like worker requires least-privilege outbox and cursor-signing configuration", () => {
  assert.throws(
    () =>
      parseWorkerEnvironment({
        CLINIC_OS_ENV: "staging",
        DATABASE_URL: databaseUrl,
        PAYMENT_PROVIDER: "razorpay"
      }),
    /WORKER_DATABASE_URL/u
  );
  assert.throws(
    () =>
      parseWorkerEnvironment({
        CLINIC_OS_ENV: "staging",
        DATABASE_URL: databaseUrl,
        WORKER_DATABASE_URL: "postgresql://worker@localhost:5432/clinic_os",
        PAYMENT_PROVIDER: "razorpay"
      }),
    /CLINIC_OS_ABUSE_BUDGET_KEY_SECRET/u
  );
});

test("production-like Temporal configuration requires a complete bounded mTLS identity", () => {
  const base = {
    CLINIC_OS_ENV: "staging",
    DATABASE_URL: databaseUrl,
    WORKER_DATABASE_URL: "postgresql://worker@localhost:5432/clinic_os",
    CLINIC_OS_ABUSE_BUDGET_KEY_SECRET: "a".repeat(48),
    TEMPORAL_ADDRESS: "temporal-frontend.clinicos-staging.internal:7233",
    PAYMENT_PROVIDER: "unconfigured"
  };
  assert.throws(() => parseWorkerEnvironment(base), /require mutual TLS/u);
  assert.throws(
    () => parseWorkerEnvironment({ ...base, TEMPORAL_TLS_SERVER_NAME: "temporal.invalid" }),
    /configuration is incomplete/u
  );

  const parsed = parseWorkerEnvironment({
    ...base,
    TEMPORAL_TLS_SERVER_NAME: "temporal.clinicos-staging.internal",
    TEMPORAL_TLS_CA_CERT: syntheticPem("CERTIFICATE", "A"),
    TEMPORAL_TLS_CLIENT_CERT: syntheticPem("CERTIFICATE", "B"),
    TEMPORAL_TLS_CLIENT_KEY: syntheticPem(`PRIVATE${" KEY"}`, "C"),
    TEMPORAL_AUTH_TOKEN_URL:
      "https://auth.staging.example.invalid/realms/clinic-os/protocol/openid-connect/token",
    TEMPORAL_AUTH_CLIENT_ID: "clinic-os-temporal-worker",
    TEMPORAL_AUTH_CLIENT_SECRET: "D".repeat(48)
  });
  assert.equal(parsed.temporalTls?.serverName, "temporal.clinicos-staging.internal");
  assert.equal(parsed.temporalAuth?.clientId, "clinic-os-temporal-worker");
});
