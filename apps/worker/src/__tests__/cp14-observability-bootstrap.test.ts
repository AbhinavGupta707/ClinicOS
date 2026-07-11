import assert from "node:assert/strict";
import test from "node:test";
import { startWorkerObservability } from "../observability-bootstrap.js";

test("CP14 worker permits explicitly disabled telemetry only for local development", async () => {
  const runtime = await startWorkerObservability({
    CLINIC_OS_ENV: "local",
    OTEL_SDK_DISABLED: "true"
  });

  assert.equal(runtime.state(), "disabled");
  await runtime.readiness();
  await runtime.shutdown();
});

test("CP14 worker production-like telemetry requires immutable resource identity", async () => {
  await assert.rejects(
    startWorkerObservability({
      CLINIC_OS_ENV: "staging",
      AWS_REGION: "ap-south-1",
      CLINIC_OS_SERVICE_INSTANCE_ID: "worker-synthetic-001",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:4318"
    }),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "TELEMETRY_SERVICE_VERSION_REQUIRED"
  );
});
