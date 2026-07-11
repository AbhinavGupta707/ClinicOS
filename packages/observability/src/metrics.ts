import type { Attributes, Meter } from "@opentelemetry/api";

export interface MetricTags {
  readonly eventType?: string;
  readonly status?: string;
  readonly [key: string]: string | undefined;
}

export interface MetricRecorder {
  increment(name: string, value?: number, tags?: MetricTags): void;
  gauge(name: string, value: number, tags?: MetricTags): void;
  timing(name: string, milliseconds: number, tags?: MetricTags): void;
}

export interface RecordedMetric {
  readonly name: string;
  readonly value: number;
  readonly kind: "counter" | "gauge" | "timing";
  readonly tags: MetricTags;
}

export type MetricDefinition = Readonly<{
  name: string;
  kind: RecordedMetric["kind"];
  unit: string;
  description: string;
  attributes: Readonly<Record<string, readonly string[]>>;
}>;

const statuses = [
  "2xx",
  "3xx",
  "4xx",
  "5xx",
  "available",
  "completed",
  "degraded",
  "denied",
  "error",
  "failed",
  "failed_exhausted",
  "failed_permanent",
  "healthy",
  "not_configured",
  "processed",
  "quarantined",
  "retry_scheduled",
  "success",
  "unavailable",
  "unhealthy",
  "other"
] as const;
const components = [
  "api",
  "auth",
  "backup",
  "cache",
  "database",
  "media",
  "outbox",
  "provider",
  "temporal",
  "worker",
  "other"
] as const;
const operations = [
  "connect",
  "delete",
  "execute",
  "export",
  "inspect",
  "publish",
  "read",
  "reconcile",
  "request",
  "restore",
  "scan",
  "write",
  "other"
] as const;
const routeFamilies = [
  "clinic_day",
  "health",
  "identity",
  "media",
  "operations",
  "provider_callback",
  "other"
] as const;
const workflows = [
  "billing",
  "clinical",
  "continuity",
  "front_office",
  "identity",
  "media",
  "operations",
  "provider",
  "other"
] as const;

export const clinicOsMetricCatalog: readonly MetricDefinition[] = [
  counter("clinic_os.http.requests", { routeFamily: routeFamilies, status: statuses }),
  timing("clinic_os.http.duration_ms", { routeFamily: routeFamilies, status: statuses }),
  counter("clinic_os.dependency.operations", {
    component: components,
    operation: operations,
    status: statuses
  }),
  timing("clinic_os.dependency.duration_ms", {
    component: components,
    operation: operations,
    status: statuses
  }),
  gauge("clinic_os.outbox.depth", { status: statuses }),
  gauge("clinic_os.outbox.oldest_age_seconds", { status: statuses }),
  gauge("clinic_os.outbox.dead_lettered", { status: statuses }),
  counter("clinic_os.outbox.events", { workflow: workflows, status: statuses }),
  timing("clinic_os.temporal.duration_ms", { workflow: workflows, status: statuses }),
  counter("clinic_os.identity.outcomes", { operation: operations, status: statuses }),
  counter("clinic_os.media.outcomes", { operation: operations, status: statuses }),
  counter("clinic_os.provider.outcomes", { operation: operations, status: statuses }),
  counter("clinic_os.worker.executions", { workflow: workflows, status: statuses }),
  gauge("clinic_os.backpressure.state", {
    status: ["normal", "constrained", "shed_noncritical", "not_ready", "other"]
  }),
  gauge("clinic_os.backup.freshness_seconds", { status: statuses }),
  gauge("clinic_os.readiness", { component: components, status: statuses }),
  // Compatibility instruments used by the existing worker until master composition moves to the
  // CP14 worker hooks. Tenant/clinic identifiers are deliberately not accepted.
  timing("worker.outbox.poll.duration_ms", { status: statuses }),
  gauge("worker.outbox.poll.claimed", {}),
  counter("worker.outbox.event.processed", { eventType: workflows, status: statuses }),
  counter("worker.outbox.event.dead_lettered", { eventType: workflows, status: statuses }),
  counter("worker.outbox.event.retry_scheduled", { eventType: workflows, status: statuses })
];

const catalogByName = new Map(
  clinicOsMetricCatalog.map((definition) => [definition.name, definition])
);

export function createConsoleMetricRecorder(
  sink: (metric: RecordedMetric) => void = (metric) => console.log(JSON.stringify({ metric }))
): MetricRecorder {
  return {
    increment: (name, value = 1, tags = {}) => sink({ name, value, kind: "counter", tags }),
    gauge: (name, value, tags = {}) => sink({ name, value, kind: "gauge", tags }),
    timing: (name, milliseconds, tags = {}) =>
      sink({ name, value: milliseconds, kind: "timing", tags })
  };
}

export interface OtelMetricRecorderOptions {
  readonly meter: Meter;
  readonly onPolicyViolation?: (codes: readonly string[]) => void;
}

export function createOtelMetricRecorder(options: OtelMetricRecorderOptions): MetricRecorder {
  const instruments = new Map<
    string,
    | ReturnType<Meter["createCounter"]>
    | ReturnType<Meter["createGauge"]>
    | ReturnType<Meter["createHistogram"]>
  >();

  const record = (
    name: string,
    expectedKind: RecordedMetric["kind"],
    value: number,
    tags: MetricTags
  ) => {
    if (
      !Number.isFinite(value) ||
      Math.abs(value) > Number.MAX_SAFE_INTEGER ||
      ((expectedKind === "counter" || expectedKind === "timing") && value < 0)
    ) {
      options.onPolicyViolation?.(["metric_value_invalid"]);
      return;
    }
    const definition = catalogByName.get(name);
    if (!definition || definition.kind !== expectedKind) {
      options.onPolicyViolation?.(["metric_not_in_catalog"]);
      return;
    }
    const sanitized = sanitizeMetricAttributes(definition, tags);
    if (sanitized.violations.length > 0) {
      options.onPolicyViolation?.(sanitized.violations);
    }
    const instrument = instruments.get(name) ?? createInstrument(options.meter, definition);
    instruments.set(name, instrument);
    if (definition.kind === "timing") {
      (instrument as ReturnType<Meter["createHistogram"]>).record(value, sanitized.attributes);
    } else if (definition.kind === "gauge") {
      (instrument as ReturnType<Meter["createGauge"]>).record(value, sanitized.attributes);
    } else {
      (instrument as ReturnType<Meter["createCounter"]>).add(value, sanitized.attributes);
    }
  };

  return {
    increment: (name, value = 1, tags = {}) => record(name, "counter", value, tags),
    gauge: (name, value, tags = {}) => record(name, "gauge", value, tags),
    timing: (name, milliseconds, tags = {}) => record(name, "timing", milliseconds, tags)
  };
}

export function sanitizeMetricAttributes(
  definition: MetricDefinition,
  tags: MetricTags
): { readonly attributes: Attributes; readonly violations: readonly string[] } {
  const attributes: Attributes = {};
  const violations: string[] = [];
  for (const [key, value] of Object.entries(tags)) {
    if (value === undefined) continue;
    const allowedValues = definition.attributes[key];
    if (!allowedValues) {
      violations.push(`metric_attribute_not_allowed:${safeMetricKey(key)}`);
      continue;
    }
    attributes[key] = allowedValues.includes(value) ? value : "other";
    if (!allowedValues.includes(value)) {
      violations.push(`metric_attribute_value_bucketed:${key}`);
    }
  }
  return { attributes, violations };
}

function createInstrument(meter: Meter, definition: MetricDefinition) {
  const options = { unit: definition.unit, description: definition.description };
  if (definition.kind === "counter") return meter.createCounter(definition.name, options);
  if (definition.kind === "gauge") return meter.createGauge(definition.name, options);
  return meter.createHistogram(definition.name, options);
}

function counter(
  name: string,
  attributes: Readonly<Record<string, readonly string[]>>
): MetricDefinition {
  return { name, kind: "counter", unit: "1", description: name, attributes };
}

function gauge(
  name: string,
  attributes: Readonly<Record<string, readonly string[]>>
): MetricDefinition {
  return { name, kind: "gauge", unit: "1", description: name, attributes };
}

function timing(
  name: string,
  attributes: Readonly<Record<string, readonly string[]>>
): MetricDefinition {
  return { name, kind: "timing", unit: "ms", description: name, attributes };
}

function safeMetricKey(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 64) || "unknown";
}
