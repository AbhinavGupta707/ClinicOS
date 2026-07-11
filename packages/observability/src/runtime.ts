import {
  ROOT_CONTEXT,
  TraceFlags,
  metrics,
  trace,
  type Meter,
  type Tracer
} from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { NodeSDK, core, tracing } from "@opentelemetry/sdk-node";
import type { ObservabilityConfiguration } from "./config.js";
import { createPhiSafeAutoInstrumentations } from "./instrumentations.js";
import { createOtelMetricRecorder, type MetricRecorder } from "./metrics.js";

export type ObservabilityRuntimeState =
  "created" | "disabled" | "starting" | "ready" | "failed" | "stopped";

export interface TelemetryOperationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export interface TelemetrySdkAdapter {
  start(): void;
  verifyExport(timeoutMs: number): Promise<void>;
  forceFlush(timeoutMs: number): Promise<void>;
  shutdown(timeoutMs: number): Promise<void>;
}

export interface ObservabilityRuntime {
  readonly configuration: ObservabilityConfiguration;
  readonly tracer: Tracer;
  readonly meter: Meter;
  readonly metrics: MetricRecorder;
  state(): ObservabilityRuntimeState;
  start(): Promise<void>;
  readiness(): Promise<void>;
  forceFlush(): Promise<TelemetryOperationResult>;
  shutdown(): Promise<TelemetryOperationResult>;
}

export interface ObservabilityRuntimeOptions {
  readonly configuration: ObservabilityConfiguration;
  readonly sdkFactory?: (configuration: ObservabilityConfiguration) => TelemetrySdkAdapter;
  readonly onMetricPolicyViolation?: (codes: readonly string[]) => void;
}

export class TelemetryStartupError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "TelemetryStartupError";
    this.code = code;
  }
}

export function createObservabilityRuntime(
  options: ObservabilityRuntimeOptions
): ObservabilityRuntime {
  const { configuration } = options;
  const tracer = trace.getTracer(configuration.serviceName, configuration.serviceVersion);
  const meter = metrics.getMeter(configuration.serviceName, configuration.serviceVersion);
  const metricRecorder = createOtelMetricRecorder({
    meter,
    ...(options.onMetricPolicyViolation
      ? { onPolicyViolation: options.onMetricPolicyViolation }
      : {})
  });
  let state: ObservabilityRuntimeState = "created";
  let sdk: TelemetrySdkAdapter | undefined;

  return {
    configuration,
    tracer,
    meter,
    metrics: metricRecorder,
    state: () => state,
    async start() {
      if (state !== "created") throw new TelemetryStartupError("TELEMETRY_START_INVALID_STATE");
      if (!configuration.enabled) {
        state = "disabled";
        return;
      }
      state = "starting";
      try {
        sdk = (options.sdkFactory ?? createDefaultTelemetrySdk)(configuration);
        sdk.start();
        await sdk.verifyExport(configuration.startupExportTimeoutMs);
        state = "ready";
      } catch {
        state = "failed";
        await sdk?.shutdown(configuration.startupExportTimeoutMs).catch(() => undefined);
        throw new TelemetryStartupError("TELEMETRY_EXPORT_VERIFICATION_FAILED");
      }
    },
    async readiness() {
      if (state === "disabled" && !configuration.requireExport) return;
      if (state !== "ready" || !sdk) {
        throw new TelemetryStartupError("TELEMETRY_NOT_READY");
      }
      try {
        await sdk.verifyExport(configuration.startupExportTimeoutMs);
      } catch {
        throw new TelemetryStartupError("TELEMETRY_EXPORT_VERIFICATION_FAILED");
      }
    },
    async forceFlush() {
      if (!sdk || state === "disabled" || state === "stopped") return { ok: true, errors: [] };
      try {
        await sdk.forceFlush(configuration.startupExportTimeoutMs);
        return { ok: true, errors: [] };
      } catch {
        return { ok: false, errors: ["TELEMETRY_FORCE_FLUSH_FAILED"] };
      }
    },
    async shutdown() {
      if (state === "stopped") return { ok: true, errors: [] };
      if (!sdk) {
        state = "stopped";
        return { ok: true, errors: [] };
      }
      const errors: string[] = [];
      try {
        await sdk.forceFlush(configuration.startupExportTimeoutMs);
      } catch {
        errors.push("TELEMETRY_FORCE_FLUSH_FAILED");
      }
      try {
        await sdk.shutdown(configuration.startupExportTimeoutMs);
      } catch {
        errors.push("TELEMETRY_SHUTDOWN_FAILED");
      }
      state = "stopped";
      return { ok: errors.length === 0, errors };
    }
  };
}

export function createDefaultTelemetrySdk(
  configuration: ObservabilityConfiguration
): TelemetrySdkAdapter {
  if (!configuration.traceEndpoint || !configuration.metricEndpoint) {
    throw new TelemetryStartupError("TELEMETRY_EXPORT_ENDPOINT_REQUIRED");
  }
  const traceExporter = new OTLPTraceExporter({
    url: configuration.traceEndpoint,
    headers: { ...configuration.exporterHeaders },
    timeoutMillis: configuration.startupExportTimeoutMs
  });
  const metricExporter = new OTLPMetricExporter({
    url: configuration.metricEndpoint,
    headers: { ...configuration.exporterHeaders },
    timeoutMillis: configuration.metricExportTimeoutMs
  });
  const spanProcessor = new tracing.BatchSpanProcessor(traceExporter, {
    maxQueueSize: 2048,
    maxExportBatchSize: 256,
    scheduledDelayMillis: 5_000,
    exportTimeoutMillis: configuration.startupExportTimeoutMs
  });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: configuration.metricExportIntervalMs,
    exportTimeoutMillis: configuration.metricExportTimeoutMs,
    maxExportBatchSize: 512,
    cardinalityLimits: {
      default: configuration.metricCardinalityLimit
    }
  });
  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      "service.name": configuration.serviceName,
      "service.version": configuration.serviceVersion,
      "service.instance.id": configuration.serviceInstanceId,
      "service.namespace": "clinic_os",
      "deployment.environment.name": configuration.environment,
      "cloud.provider": "aws",
      "cloud.region": configuration.region
    }),
    sampler: new tracing.ParentBasedSampler({
      root: new tracing.TraceIdRatioBasedSampler(configuration.traceSampleRatio)
    }),
    textMapPropagator: new core.W3CTraceContextPropagator(),
    autoDetectResources: false,
    resourceDetectors: [],
    spanProcessors: [spanProcessor],
    metricReaders: [metricReader],
    instrumentations: [...createPhiSafeAutoInstrumentations()],
    spanLimits: {
      attributeCountLimit: 32,
      attributeValueLengthLimit: 256,
      eventCountLimit: 16,
      linkCountLimit: 16,
      attributePerEventCountLimit: 16,
      attributePerLinkCountLimit: 8
    }
  });

  const flush = async (timeoutMs: number) => {
    await Promise.all([
      withTimeout(spanProcessor.forceFlush(), timeoutMs, "TELEMETRY_TRACE_EXPORT_TIMEOUT"),
      withTimeout(
        metricReader.forceFlush({ timeoutMillis: timeoutMs }),
        timeoutMs,
        "TELEMETRY_METRIC_EXPORT_TIMEOUT"
      )
    ]);
  };

  return {
    start: () => sdk.start(),
    async verifyExport(timeoutMs) {
      const sampledParent = trace.setSpanContext(ROOT_CONTEXT, {
        traceId: "10000000000000000000000000000001",
        spanId: "1000000000000001",
        traceFlags: TraceFlags.SAMPLED,
        isRemote: true
      });
      const span = trace
        .getTracer(configuration.serviceName, configuration.serviceVersion)
        .startSpan("clinic_os.telemetry.startup_probe", {}, sampledParent);
      span.setAttribute("clinic_os.export.probe", true);
      span.end();
      metrics
        .getMeter(configuration.serviceName, configuration.serviceVersion)
        .createCounter("clinic_os.telemetry.startup_probe")
        .add(1, { status: "probe" });
      await flush(timeoutMs);
    },
    forceFlush: flush,
    shutdown: (timeoutMs) =>
      withTimeout(sdk.shutdown(), timeoutMs, "TELEMETRY_SDK_SHUTDOWN_TIMEOUT")
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorCode: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new TelemetryStartupError(errorCode)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}
