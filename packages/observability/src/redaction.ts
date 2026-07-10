const sensitiveKeyFragments = [
  "abha",
  "authorization",
  "address",
  "allergy",
  "body",
  "bucket",
  "clinical",
  "cookie",
  "diagnosis",
  "dob",
  "email",
  "filename",
  "free_text",
  "header",
  "jwt",
  "medication",
  "name",
  "note",
  "object_key",
  "objectkey",
  "path",
  "phone",
  "prescription",
  "query",
  "request",
  "response",
  "secret",
  "signed_url",
  "signedurl",
  "sql",
  "token",
  "transcript",
  "url"
];

const diagnosticFieldKeys = new Set([
  "attemptNumber",
  "attemptsExhausted",
  "backpressureState",
  "component",
  "correlationId",
  "dependency",
  "durationMs",
  "environment",
  "errorCode",
  "event",
  "exportState",
  "failureCode",
  "httpStatus",
  "operation",
  "provider",
  "queueDepthBand",
  "reasonCode",
  "routeFamily",
  "scannerState",
  "service",
  "spanId",
  "status",
  "traceId",
  "workflow"
]);

const safeValuePattern = /^[A-Za-z0-9._:@/-]{1,128}$/u;
const correlationPattern =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|synthetic-(?:request|correlation)-[0-9]{4,16})$/u;
const traceIdPattern = /^[0-9a-f]{32}$/u;
const spanIdPattern = /^[0-9a-f]{16}$/u;

export function redactForLogs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactForLogs(item));
  if (!value || typeof value !== "object") return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    redacted[key] = sensitiveKeyFragments.some((fragment) => normalizedKey.includes(fragment))
      ? "[REDACTED]"
      : redactForLogs(fieldValue);
  }

  return redacted;
}

export interface DiagnosticFieldSanitization {
  readonly fields: Record<string, string | number | boolean>;
  readonly violations: readonly string[];
}

/**
 * Diagnostic telemetry is allowlisted separately from the authoritative audit record. Unknown,
 * nested, identifier-bearing, or free-text fields are dropped rather than partially masked.
 */
export function allowlistDiagnosticFields(
  value: Readonly<Record<string, unknown>>
): DiagnosticFieldSanitization {
  const fields: Record<string, string | number | boolean> = {};
  const violations: string[] = [];

  for (const [key, fieldValue] of Object.entries(value)) {
    if (!diagnosticFieldKeys.has(key)) {
      violations.push(`field_not_allowed:${safeViolationKey(key)}`);
      continue;
    }
    if (fieldValue === undefined) continue;

    const sanitized = sanitizeDiagnosticValue(key, fieldValue);
    if (sanitized === null) {
      violations.push(`field_value_not_allowed:${key}`);
      continue;
    }
    fields[key] = sanitized;
  }

  return { fields, violations };
}

export function safeDiagnosticEventCode(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9_.-]{2,127}$/u.test(value)
    ? value
    : "diagnostic.event";
}

function sanitizeDiagnosticValue(key: string, value: unknown): string | number | boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER ? value : null;
  }
  if (typeof value !== "string") return null;
  if (key === "traceId") return traceIdPattern.test(value) ? value : null;
  if (key === "spanId") return spanIdPattern.test(value) ? value : null;
  if (key === "correlationId") return correlationPattern.test(value) ? value : null;
  return safeValuePattern.test(value) ? value : null;
}

function safeViolationKey(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_.-]/gu, "_").slice(0, 64);
  return normalized || "unknown";
}
