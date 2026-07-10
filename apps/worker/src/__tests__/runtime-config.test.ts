import assert from "node:assert/strict";
import test from "node:test";
import { parseWorkerEnvironment } from "../runtime/config.js";

const databaseUrl = "postgresql://runtime@localhost:5432/clinic_os";

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
  assert.match(parsed.dueGenerationCursorSecret ?? "", /^clinicos-local-synthetic/u);
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
