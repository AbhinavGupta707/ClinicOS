import { describe, expect, it } from "vitest";
import {
  ObservabilityConfigurationError,
  defineObservabilityConfiguration,
  observabilityConfigurationFromEnvironment
} from "./config.js";
import { injectSpanContext, sanitizeTraceCarrier } from "./context.js";
import {
  TelemetryStartupError,
  createObservabilityRuntime,
  type TelemetrySdkAdapter
} from "./runtime.js";

const productionConfiguration = () =>
  defineObservabilityConfiguration({
    serviceName: "clinic-os-api",
    serviceVersion: "ac82e8b7",
    serviceInstanceId: "api-synthetic-001",
    environment: "staging",
    region: "ap-south-1",
    traceEndpoint: "https://collector.internal.example/v1/traces",
    metricEndpoint: "https://collector.internal.example/v1/metrics"
  });

describe("observability configuration", () => {
  it("fails closed in production-like environments without both OTLP endpoints", () => {
    expect(() =>
      defineObservabilityConfiguration({
        serviceName: "clinic-os-api",
        serviceVersion: "ac82e8b7",
        serviceInstanceId: "api-synthetic-001",
        environment: "pilot-prod",
        region: "ap-south-1"
      })
    ).toThrowError(
      expect.objectContaining<Partial<ObservabilityConfigurationError>>({
        code: "TELEMETRY_EXPORT_ENDPOINT_REQUIRED"
      })
    );
  });

  it("permits explicitly disabled local telemetry without console metric success", () => {
    const configuration = observabilityConfigurationFromEnvironment(
      { CLINIC_OS_ENV: "local", OTEL_SDK_DISABLED: "true" },
      {
        serviceName: "clinic-os-worker",
        serviceVersion: "test",
        serviceInstanceId: "worker-synthetic-001",
        region: "local"
      }
    );
    expect(configuration).toMatchObject({ enabled: false, requireExport: false });
  });

  it("keeps exporter authorization headers non-enumerable", () => {
    const configuration = defineObservabilityConfiguration({
      serviceName: "clinic-os-api",
      serviceVersion: "test",
      serviceInstanceId: "api-synthetic-001",
      environment: "local",
      region: "local",
      enabled: true,
      traceEndpoint: "http://127.0.0.1:4318/v1/traces",
      metricEndpoint: "http://127.0.0.1:4318/v1/metrics",
      exporterHeaders: { authorization: "secret-exporter-token" }
    });
    expect(configuration.exporterHeaders.authorization).toBe("secret-exporter-token");
    expect(JSON.stringify(configuration)).not.toMatch(/authorization|secret-exporter-token/u);
  });

  it("rejects remote plaintext exporters but permits a local ADOT sidecar", () => {
    expect(() =>
      defineObservabilityConfiguration({
        serviceName: "clinic-os-api",
        serviceVersion: "test",
        serviceInstanceId: "api-synthetic-001",
        environment: "staging",
        region: "ap-south-1",
        traceEndpoint: "http://collector.internal/v1/traces",
        metricEndpoint: "http://collector.internal/v1/metrics"
      })
    ).toThrowError("TELEMETRY_PLAINTEXT_REMOTE_ENDPOINT_FORBIDDEN");
    expect(
      defineObservabilityConfiguration({
        serviceName: "clinic-os-api",
        serviceVersion: "test",
        serviceInstanceId: "api-synthetic-001",
        environment: "staging",
        region: "ap-south-1",
        traceEndpoint: "http://127.0.0.1:4318/v1/traces",
        metricEndpoint: "http://127.0.0.1:4318/v1/metrics"
      }).enabled
    ).toBe(true);
  });
});

describe("observability runtime", () => {
  it("re-verifies export during readiness after a successful startup", async () => {
    let verifyCalls = 0;
    const runtime = createObservabilityRuntime({
      configuration: productionConfiguration(),
      sdkFactory: () => ({
        start: () => undefined,
        verifyExport: async () => {
          verifyCalls += 1;
        },
        forceFlush: async () => undefined,
        shutdown: async () => undefined
      })
    });

    await runtime.start();
    await runtime.readiness();

    expect(verifyCalls).toBe(2);
    expect(runtime.state()).toBe("ready");
  });

  it("fails readiness with a bounded code when export becomes unavailable", async () => {
    let verifyCalls = 0;
    const runtime = createObservabilityRuntime({
      configuration: productionConfiguration(),
      sdkFactory: () => ({
        start: () => undefined,
        verifyExport: async () => {
          verifyCalls += 1;
          if (verifyCalls > 1) throw new Error("secret collector response");
        },
        forceFlush: async () => undefined,
        shutdown: async () => undefined
      })
    });

    await runtime.start();

    await expect(runtime.readiness()).rejects.toEqual(
      expect.objectContaining<Partial<TelemetryStartupError>>({
        code: "TELEMETRY_EXPORT_VERIFICATION_FAILED"
      })
    );
  });

  it("treats explicitly disabled non-production telemetry as ready", async () => {
    const configuration = observabilityConfigurationFromEnvironment(
      { CLINIC_OS_ENV: "local", OTEL_SDK_DISABLED: "true" },
      {
        serviceName: "clinic-os-api",
        serviceVersion: "test",
        serviceInstanceId: "api-synthetic-001",
        region: "local"
      }
    );
    const runtime = createObservabilityRuntime({ configuration });

    await runtime.start();

    await expect(runtime.readiness()).resolves.toBeUndefined();
    expect(runtime.state()).toBe("disabled");
  });

  it("fails startup and shuts the SDK down when required export verification fails", async () => {
    const calls: string[] = [];
    const adapter: TelemetrySdkAdapter = {
      start: () => calls.push("start"),
      verifyExport: async () => {
        calls.push("verify");
        throw new Error("secret upstream exporter detail");
      },
      forceFlush: async () => undefined,
      shutdown: async () => {
        calls.push("shutdown");
      }
    };
    const runtime = createObservabilityRuntime({
      configuration: productionConfiguration(),
      sdkFactory: () => adapter
    });

    await expect(runtime.start()).rejects.toEqual(
      expect.objectContaining<Partial<TelemetryStartupError>>({
        code: "TELEMETRY_EXPORT_VERIFICATION_FAILED"
      })
    );
    expect(runtime.state()).toBe("failed");
    expect(calls).toEqual(["start", "verify", "shutdown"]);
    expect(JSON.stringify(calls)).not.toContain("secret upstream exporter detail");
  });

  it("flushes and shuts down independently so one failure cannot skip cleanup", async () => {
    const calls: string[] = [];
    const runtime = createObservabilityRuntime({
      configuration: productionConfiguration(),
      sdkFactory: () => ({
        start: () => calls.push("start"),
        verifyExport: async () => calls.push("verify"),
        forceFlush: async () => {
          calls.push("flush");
          throw new Error("flush failed");
        },
        shutdown: async () => calls.push("shutdown")
      })
    });
    await runtime.start();
    const result = await runtime.shutdown();
    expect(result).toEqual({ ok: false, errors: ["TELEMETRY_FORCE_FLUSH_FAILED"] });
    expect(calls).toEqual(["start", "verify", "flush", "shutdown"]);
    expect(runtime.state()).toBe("stopped");
  });
});

describe("W3C trace context", () => {
  it("propagates only W3C trace context and rejects baggage or malformed carriers", () => {
    expect(
      injectSpanContext({
        traceId: "10000000000000000000000000000001",
        spanId: "1000000000000001",
        traceFlags: 1
      })
    ).toEqual({
      traceparent: "00-10000000000000000000000000000001-1000000000000001-01"
    });
    expect(
      sanitizeTraceCarrier({
        traceparent: "00-not-a-trace-id-1000000000000001-01",
        baggage: "patient=rhea",
        authorization: "secret"
      })
    ).toEqual({});
  });
});
