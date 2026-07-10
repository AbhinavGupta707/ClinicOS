export type TelemetryEnvironment = "local" | "test" | "staging" | "pilot-prod" | "prod";

export interface ObservabilityConfiguration {
  readonly enabled: boolean;
  readonly requireExport: boolean;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly serviceInstanceId: string;
  readonly environment: TelemetryEnvironment;
  readonly region: string;
  readonly traceEndpoint?: string;
  readonly metricEndpoint?: string;
  readonly exporterHeaders: Readonly<Record<string, string>>;
  readonly traceSampleRatio: number;
  readonly metricExportIntervalMs: number;
  readonly metricExportTimeoutMs: number;
  readonly metricCardinalityLimit: number;
  readonly startupExportTimeoutMs: number;
}

export interface ObservabilityConfigurationInput {
  readonly enabled?: boolean;
  readonly serviceName: string;
  readonly serviceVersion: string;
  readonly serviceInstanceId: string;
  readonly environment: string;
  readonly region: string;
  readonly traceEndpoint?: string;
  readonly metricEndpoint?: string;
  readonly exporterHeaders?: Readonly<Record<string, string>>;
  readonly traceSampleRatio?: number;
  readonly metricExportIntervalMs?: number;
  readonly metricExportTimeoutMs?: number;
  readonly metricCardinalityLimit?: number;
  readonly startupExportTimeoutMs?: number;
}

export class ObservabilityConfigurationError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "ObservabilityConfigurationError";
    this.code = code;
  }
}

export function defineObservabilityConfiguration(
  input: ObservabilityConfigurationInput
): ObservabilityConfiguration {
  const environment = parseEnvironment(input.environment);
  const requireExport = isProductionLikeTelemetryEnvironment(environment);
  const enabled = input.enabled ?? requireExport;
  const traceEndpoint = input.traceEndpoint
    ? validateEndpoint(input.traceEndpoint, environment, "trace")
    : undefined;
  const metricEndpoint = input.metricEndpoint
    ? validateEndpoint(input.metricEndpoint, environment, "metric")
    : undefined;

  if (requireExport && !enabled) {
    throw new ObservabilityConfigurationError("TELEMETRY_DISABLED_IN_PRODUCTION_LIKE_ENVIRONMENT");
  }
  if (enabled && (!traceEndpoint || !metricEndpoint)) {
    throw new ObservabilityConfigurationError("TELEMETRY_EXPORT_ENDPOINT_REQUIRED");
  }

  const configuration = {
    enabled,
    requireExport,
    serviceName: boundedIdentifier(input.serviceName, "TELEMETRY_SERVICE_NAME_INVALID"),
    serviceVersion: boundedIdentifier(input.serviceVersion, "TELEMETRY_SERVICE_VERSION_INVALID"),
    serviceInstanceId: boundedIdentifier(
      input.serviceInstanceId,
      "TELEMETRY_SERVICE_INSTANCE_ID_INVALID"
    ),
    environment,
    region: boundedIdentifier(input.region, "TELEMETRY_REGION_INVALID"),
    ...(traceEndpoint ? { traceEndpoint } : {}),
    ...(metricEndpoint ? { metricEndpoint } : {}),
    traceSampleRatio: boundedNumber(
      input.traceSampleRatio ?? 0.05,
      0.001,
      1,
      "TELEMETRY_SAMPLE_RATIO_INVALID"
    ),
    metricExportIntervalMs: boundedInteger(
      input.metricExportIntervalMs ?? 30_000,
      5_000,
      300_000,
      "TELEMETRY_METRIC_INTERVAL_INVALID"
    ),
    metricExportTimeoutMs: boundedInteger(
      input.metricExportTimeoutMs ?? 10_000,
      1_000,
      30_000,
      "TELEMETRY_METRIC_TIMEOUT_INVALID"
    ),
    metricCardinalityLimit: boundedInteger(
      input.metricCardinalityLimit ?? 200,
      25,
      500,
      "TELEMETRY_CARDINALITY_LIMIT_INVALID"
    ),
    startupExportTimeoutMs: boundedInteger(
      input.startupExportTimeoutMs ?? 10_000,
      1_000,
      30_000,
      "TELEMETRY_STARTUP_TIMEOUT_INVALID"
    )
  } as Omit<ObservabilityConfiguration, "exporterHeaders"> & {
    exporterHeaders?: Readonly<Record<string, string>>;
  };
  Object.defineProperty(configuration, "exporterHeaders", {
    value: validateExporterHeaders(input.exporterHeaders ?? {}),
    enumerable: false,
    configurable: false,
    writable: false
  });
  return Object.freeze(configuration) as ObservabilityConfiguration;
}

export function observabilityConfigurationFromEnvironment(
  env: NodeJS.ProcessEnv,
  identity: Readonly<{
    serviceName: string;
    serviceVersion: string;
    serviceInstanceId: string;
    region: string;
  }>
): ObservabilityConfiguration {
  const baseEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT;
  const traceEndpoint =
    env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? appendSignalPath(baseEndpoint, "v1/traces");
  const metricEndpoint =
    env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT ?? appendSignalPath(baseEndpoint, "v1/metrics");
  return defineObservabilityConfiguration({
    serviceName: identity.serviceName,
    serviceVersion: identity.serviceVersion,
    serviceInstanceId: identity.serviceInstanceId,
    environment: env.CLINIC_OS_ENV ?? "local",
    region: identity.region,
    enabled: env.OTEL_SDK_DISABLED === "true" ? false : Boolean(traceEndpoint && metricEndpoint),
    traceEndpoint,
    metricEndpoint,
    exporterHeaders: parseExporterHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
    traceSampleRatio: optionalNumber(env.OTEL_TRACES_SAMPLER_ARG),
    metricExportIntervalMs: optionalNumber(env.OTEL_METRIC_EXPORT_INTERVAL),
    metricExportTimeoutMs: optionalNumber(env.OTEL_METRIC_EXPORT_TIMEOUT),
    metricCardinalityLimit: optionalNumber(env.CLINIC_OS_OTEL_CARDINALITY_LIMIT),
    startupExportTimeoutMs: optionalNumber(env.CLINIC_OS_OTEL_STARTUP_TIMEOUT_MS)
  });
}

export function isProductionLikeTelemetryEnvironment(environment: string): boolean {
  return ["staging", "pilot-prod", "prod"].includes(environment);
}

function parseEnvironment(value: string): TelemetryEnvironment {
  if (["local", "test", "staging", "pilot-prod", "prod"].includes(value)) {
    return value as TelemetryEnvironment;
  }
  throw new ObservabilityConfigurationError("TELEMETRY_ENVIRONMENT_INVALID");
}

function validateEndpoint(
  value: string,
  environment: TelemetryEnvironment,
  signal: string
): string {
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new ObservabilityConfigurationError(`TELEMETRY_${signal.toUpperCase()}_ENDPOINT_INVALID`);
  }
  if (
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new ObservabilityConfigurationError(`TELEMETRY_${signal.toUpperCase()}_ENDPOINT_INVALID`);
  }
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(endpoint.hostname);
  if (
    isProductionLikeTelemetryEnvironment(environment) &&
    endpoint.protocol !== "https:" &&
    !loopback
  ) {
    throw new ObservabilityConfigurationError("TELEMETRY_PLAINTEXT_REMOTE_ENDPOINT_FORBIDDEN");
  }
  return endpoint.toString();
}

function validateExporterHeaders(
  headers: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  const validated: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (
      !/^[A-Za-z0-9-]{1,64}$/u.test(key) ||
      !value ||
      value.length > 4096 ||
      /[\r\n]/u.test(value)
    ) {
      throw new ObservabilityConfigurationError("TELEMETRY_EXPORT_HEADER_INVALID");
    }
    validated[key] = value;
  }
  return Object.freeze(validated);
}

function parseExporterHeaders(value: string | undefined): Readonly<Record<string, string>> {
  if (!value) return {};
  const headers: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const separator = pair.indexOf("=");
    if (separator < 1) {
      throw new ObservabilityConfigurationError("TELEMETRY_EXPORT_HEADER_INVALID");
    }
    const key = pair.slice(0, separator).trim();
    let headerValue: string;
    try {
      headerValue = decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      throw new ObservabilityConfigurationError("TELEMETRY_EXPORT_HEADER_INVALID");
    }
    headers[key] = headerValue;
  }
  return headers;
}

function appendSignalPath(baseEndpoint: string | undefined, path: string): string | undefined {
  if (!baseEndpoint) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(baseEndpoint);
  } catch {
    throw new ObservabilityConfigurationError("TELEMETRY_EXPORT_ENDPOINT_INVALID");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/$/u, "")}/${path}`;
  return parsed.toString();
}

function optionalNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

function boundedIdentifier(value: string, errorCode: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/u.test(value)) {
    throw new ObservabilityConfigurationError(errorCode);
  }
  return value;
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  errorCode: string
): number {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ObservabilityConfigurationError(errorCode);
  }
  return value;
}

function boundedNumber(value: number, minimum: number, maximum: number, errorCode: string): number {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ObservabilityConfigurationError(errorCode);
  }
  return value;
}
