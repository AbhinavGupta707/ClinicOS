#!/usr/bin/env node
import {
  authorizeSyntheticHarness,
  boundedInteger,
  parseCp14Arguments,
  readSyntheticJson,
  safeJson,
  stopRequested
} from "./cp14-observability-harness-lib.mjs";

const statuses = [
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
];
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
];
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
];
const routeFamilies = [
  "clinic_day",
  "health",
  "identity",
  "media",
  "operations",
  "provider_callback",
  "other"
];
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
];
const metricPolicies = new Map([
  ["clinic_os.http.requests", { routeFamily: routeFamilies, status: statuses }],
  ["clinic_os.http.duration_ms", { routeFamily: routeFamilies, status: statuses }],
  [
    "clinic_os.dependency.operations",
    { component: components, operation: operations, status: statuses }
  ],
  [
    "clinic_os.dependency.duration_ms",
    { component: components, operation: operations, status: statuses }
  ],
  ["clinic_os.outbox.depth", { status: statuses }],
  ["clinic_os.outbox.oldest_age_seconds", { status: statuses }],
  ["clinic_os.outbox.events", { workflow: workflows, status: statuses }],
  ["clinic_os.temporal.duration_ms", { workflow: workflows, status: statuses }],
  ["clinic_os.identity.outcomes", { operation: operations, status: statuses }],
  ["clinic_os.media.outcomes", { operation: operations, status: statuses }],
  ["clinic_os.provider.outcomes", { operation: operations, status: statuses }],
  ["clinic_os.worker.executions", { workflow: workflows, status: statuses }],
  [
    "clinic_os.backpressure.state",
    { status: ["normal", "constrained", "shed_noncritical", "not_ready", "other"] }
  ],
  ["clinic_os.backup.freshness_seconds", { status: statuses }],
  ["clinic_os.readiness", { component: components, status: statuses }],
  ["clinic_os.telemetry.startup_probe", { status: ["probe"] }],
  ["worker.outbox.poll.duration_ms", { status: statuses }],
  ["worker.outbox.poll.claimed", {}],
  ["worker.outbox.event.processed", { eventType: workflows, status: statuses }],
  ["worker.outbox.event.dead_lettered", { eventType: workflows, status: statuses }],
  ["worker.outbox.event.retry_scheduled", { eventType: workflows, status: statuses }]
]);
const domains = [
  "http",
  "postgres",
  "redis",
  "outbox",
  "temporal",
  "identity",
  "media",
  "provider",
  "worker"
];
const logEventCodes = new Set([
  "diagnostic.event",
  "media.scan.failed",
  "telemetry.http.failed",
  "telemetry.identity.failed",
  "telemetry.media.failed",
  "telemetry.outbox.failed",
  "telemetry.postgres.failed",
  "telemetry.provider.failed",
  "telemetry.redis.failed",
  "telemetry.temporal.failed",
  "telemetry.worker.failed",
  "worker.health.started",
  "worker.outbox.event",
  "worker.outbox.started",
  "worker.startup.failed"
]);
const errorCodes = new Set([
  "ABORTED",
  "AGGREGATE_ERROR",
  "ERROR",
  "RANGE_ERROR",
  "REFERENCE_ERROR",
  "SYNTAX_ERROR",
  "TIMEOUT",
  "TYPE_ERROR",
  "UNCLASSIFIED_ERROR",
  "URI_ERROR"
]);

export function verifySyntheticTelemetry(input, options = {}) {
  const result = validateTelemetry(input, options, true);
  return {
    ...result,
    status: result.violationCodes.length === 0 ? "pass" : "fail",
    verificationMode: "evidence"
  };
}

export function validateSyntheticTelemetryRecords(input, options = {}) {
  const result = validateTelemetry(input, options, false);
  return {
    ...result,
    status: result.violationCodes.length === 0 ? "valid" : "invalid",
    validationMode: "partial_unit"
  };
}

function validateTelemetry(input, options, requireAllSignals) {
  const maximumSeriesPerMetric = boundedInteger(
    options.maximumSeriesPerMetric,
    200,
    25,
    500,
    "CP14_CARDINALITY_LIMIT_INVALID"
  );
  const violations = [];
  const series = new Map();
  validateEnvelope(input, violations, series, requireAllSignals);
  for (const [metricName, attributeSets] of series) {
    if (attributeSets.size > maximumSeriesPerMetric) {
      violations.push(`metric_cardinality_exceeded:${metricName}`);
    }
  }
  return {
    violationCodes: [...new Set(violations)].sort(),
    metricCount: series.size,
    maximumSeriesPerMetric
  };
}

function validateEnvelope(input, violations, series, requireAllSignals) {
  if (!isPlainObject(input)) {
    violations.push("telemetry_envelope_invalid");
    return;
  }
  allowOnlyKeys(
    input,
    ["schemaVersion", "dataClassification", "metrics", "spans", "logs"],
    violations,
    "telemetry_field_not_allowed"
  );
  if (input.schemaVersion !== 1) violations.push("telemetry_schema_version_invalid");
  if (input.dataClassification !== "synthetic-only") {
    violations.push("telemetry_data_classification_invalid");
  }
  if (requireAllSignals) {
    if (!Array.isArray(input.metrics) || input.metrics.length === 0) {
      violations.push("metric_records_required");
    }
    if (!Array.isArray(input.spans) || input.spans.length === 0) {
      violations.push("span_records_required");
    }
    if (!Array.isArray(input.logs) || input.logs.length === 0) {
      violations.push("log_records_required");
    }
  }
  validateArray(input.metrics, "metrics", violations, (record) =>
    validateMetric(record, violations, series)
  );
  validateArray(input.spans, "spans", violations, (record) => validateSpan(record, violations));
  validateArray(input.logs, "logs", violations, (record) => validateLog(record, violations));
}

function validateMetric(record, violations, series) {
  if (!isPlainObject(record)) {
    violations.push("metric_record_invalid");
    return;
  }
  allowOnlyKeys(record, ["name", "value", "attributes"], violations, "metric_field_not_allowed");
  if (
    !Object.hasOwn(record, "name") ||
    !Object.hasOwn(record, "value") ||
    !Object.hasOwn(record, "attributes")
  ) {
    violations.push("metric_field_required");
  }
  const policy = typeof record.name === "string" ? metricPolicies.get(record.name) : undefined;
  if (!policy) {
    violations.push("metric_name_not_allowed");
    return;
  }
  if (typeof record.value !== "number" || !Number.isFinite(record.value)) {
    violations.push("metric_value_invalid");
  }
  if (!isPlainObject(record.attributes)) {
    violations.push("metric_attributes_invalid");
    return;
  }
  let attributesValid = true;
  for (const [key, value] of Object.entries(record.attributes)) {
    const allowedValues = policy[key];
    if (!allowedValues) {
      violations.push("metric_attribute_not_allowed");
      attributesValid = false;
    } else if (typeof value !== "string" || !allowedValues.includes(value)) {
      violations.push("metric_attribute_value_invalid");
      attributesValid = false;
    }
  }
  if (Object.keys(policy).some((key) => !Object.hasOwn(record.attributes, key))) {
    violations.push("metric_attribute_required");
    attributesValid = false;
  }
  if (attributesValid) {
    const attributeSet = JSON.stringify(
      Object.entries(record.attributes).sort(([left], [right]) => left.localeCompare(right))
    );
    const values = series.get(record.name) ?? new Set();
    values.add(attributeSet);
    series.set(record.name, values);
  }
}

function validateSpan(record, violations) {
  if (!isPlainObject(record)) {
    violations.push("span_record_invalid");
    return;
  }
  allowOnlyKeys(record, ["name", "status", "attributes"], violations, "span_field_not_allowed");
  if (
    !Object.hasOwn(record, "name") ||
    !Object.hasOwn(record, "status") ||
    !Object.hasOwn(record, "attributes")
  ) {
    violations.push("span_field_required");
  }
  const operationMatch =
    typeof record.name === "string"
      ? /^clinic_os\.(http|postgres|redis|outbox|temporal|identity|media|provider|worker)\.(connect|delete|execute|export|inspect|publish|read|reconcile|request|restore|scan|write|other)$/u.exec(
          record.name
        )
      : null;
  if (
    typeof record.name !== "string" ||
    (!operationMatch && record.name !== "clinic_os.telemetry.startup_probe")
  ) {
    violations.push("span_name_not_allowed");
  }
  if (!["ok", "error", "unset"].includes(record.status)) violations.push("span_status_invalid");
  if (!isPlainObject(record.attributes)) {
    violations.push("span_attributes_invalid");
    return;
  }
  for (const [key, value] of Object.entries(record.attributes)) {
    if (!validSpanAttribute(key, value)) violations.push("span_attribute_invalid");
  }
  if (
    operationMatch &&
    (record.attributes["clinic_os.domain"] !== operationMatch[1] ||
      record.attributes["clinic_os.operation"] !== operationMatch[2])
  ) {
    violations.push("span_identity_mismatch");
  }
  if (
    record.name === "clinic_os.telemetry.startup_probe" &&
    record.attributes["clinic_os.export.probe"] !== true
  ) {
    violations.push("span_identity_mismatch");
  }
}

function validSpanAttribute(key, value) {
  if (key === "clinic_os.domain") return domains.includes(value);
  if (key === "clinic_os.operation") return operations.includes(value);
  if (key === "clinic_os.route.family") return routeFamilies.includes(value);
  if (key === "clinic_os.workflow") return workflows.includes(value);
  if (key === "clinic_os.http.kind") return ["client", "server"].includes(value);
  if (
    [
      "http.target",
      "http.url",
      "url.full",
      "url.path",
      "url.query",
      "db.statement",
      "db.query.text"
    ].includes(key)
  ) {
    return value === "[REDACTED]";
  }
  if (key === "db.operation.name")
    return [
      "BEGIN",
      "COMMIT",
      "DELETE",
      "INSERT",
      "OTHER",
      "ROLLBACK",
      "SELECT",
      "SET",
      "UPDATE",
      "WITH"
    ].includes(value);
  if (key === "error.type") return errorCodes.has(value);
  if (key === "clinic_os.export.probe") return value === true;
  return false;
}

function validateLog(record, violations) {
  if (!isPlainObject(record)) {
    violations.push("log_record_invalid");
    return;
  }
  allowOnlyKeys(
    record,
    ["timestamp", "level", "message", "fields"],
    violations,
    "log_field_not_allowed"
  );
  if (
    !Object.hasOwn(record, "timestamp") ||
    !Object.hasOwn(record, "level") ||
    !Object.hasOwn(record, "message") ||
    !Object.hasOwn(record, "fields")
  ) {
    violations.push("log_record_field_required");
  }
  if (
    typeof record.timestamp !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(record.timestamp)
  ) {
    violations.push("log_timestamp_invalid");
  }
  if (!["debug", "info", "warn", "error"].includes(record.level))
    violations.push("log_level_invalid");
  if (typeof record.message !== "string" || !logEventCodes.has(record.message)) {
    violations.push("log_event_code_invalid");
  }
  if (!isPlainObject(record.fields)) {
    violations.push("log_fields_invalid");
    return;
  }
  if (
    !Object.hasOwn(record.fields, "service") ||
    !Object.hasOwn(record.fields, "environment") ||
    !Object.hasOwn(record.fields, "event")
  ) {
    violations.push("log_field_required");
  }
  for (const [key, value] of Object.entries(record.fields)) {
    if (!validLogField(key, value, record.message)) violations.push("log_field_value_invalid");
  }
}

function validLogField(key, value, message) {
  if (key === "service")
    return ["clinic-os-api", "clinic-os-worker", "clinic-os-web", "clinic-os-mobile"].includes(
      value
    );
  if (key === "environment")
    return ["local", "test", "staging", "pilot-prod", "prod"].includes(value);
  if (key === "event") return value === message && logEventCodes.has(value);
  if (key === "component") return components.includes(value);
  if (key === "operation") return operations.includes(value);
  if (key === "status")
    return [...statuses, "normal", "constrained", "shed_noncritical", "not_ready"].includes(value);
  if (key === "workflow") return workflows.includes(value);
  if (key === "backpressureState")
    return ["normal", "constrained", "shed_noncritical", "not_ready"].includes(value);
  if (key === "scannerState")
    return ["clean", "quarantined", "failed", "unavailable"].includes(value);
  if (key === "queueDepthBand")
    return ["empty", "low", "medium", "high", "critical"].includes(value);
  if (key === "exportState")
    return ["disabled", "starting", "ready", "failed", "stopped"].includes(value);
  if (key === "errorCode" || key === "failureCode") return errorCodes.has(value);
  if (key === "traceId") return typeof value === "string" && /^[0-9a-f]{32}$/u.test(value);
  if (key === "spanId") return typeof value === "string" && /^[0-9a-f]{16}$/u.test(value);
  if (key === "correlationId")
    return (
      typeof value === "string" &&
      (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value) ||
        /^synthetic-(?:request|correlation)-[0-9]{4,16}$/u.test(value))
    );
  if (["durationMs", "attemptNumber", "httpStatus"].includes(key))
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (key === "attemptsExhausted") return typeof value === "boolean";
  if (key === "dependency")
    return [
      "postgres",
      "redis",
      "temporal",
      "keycloak",
      "media_scanner",
      "provider",
      "other"
    ].includes(value);
  if (key === "provider")
    return ["meta", "razorpay", "telephony", "media_scanner", "manual", "other"].includes(value);
  if (key === "reasonCode")
    return ["dependency_unhealthy", "policy_denied", "rate_limited", "timeout", "other"].includes(
      value
    );
  return false;
}

function validateArray(value, field, violations, validate) {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 10_000) {
    violations.push(`${field}_invalid`);
    return;
  }
  value.forEach(validate);
}

function allowOnlyKeys(record, allowed, violations, code) {
  const allowlist = new Set(allowed);
  if (Object.keys(record).some((key) => !allowlist.has(key))) violations.push(code);
}

function isPlainObject(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function runObservabilityVerification(argv) {
  const args = parseCp14Arguments(argv);
  const authorization = authorizeSyntheticHarness(args, "observability_verify");
  if (stopRequested(authorization.stopFile)) {
    return { status: "stopped", authorization };
  }
  if (typeof args.input !== "string") throw new Error("CP14_SYNTHETIC_INPUT_REQUIRED");
  const result = verifySyntheticTelemetry(readSyntheticJson(args.input), {
    maximumSeriesPerMetric: args["maximum-series-per-metric"]
  });
  return { ...result, authorization };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = runObservabilityVerification(process.argv.slice(2));
    process.stdout.write(safeJson(result));
    if (result.status === "fail") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "CP14_VERIFICATION_FAILED"}\n`
    );
    process.exitCode = 1;
  }
}
