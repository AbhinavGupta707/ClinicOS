import { trace } from "@opentelemetry/api";
import { allowlistDiagnosticFields, safeDiagnosticEventCode } from "./redaction.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  readonly service: string;
  readonly environment: string;
  readonly correlationId?: string;
  readonly tenantId?: string;
  readonly clinicId?: string;
  readonly event?: string;
  readonly [key: string]: unknown;
}

export interface LogEntry {
  readonly timestamp: string;
  readonly level: LogLevel;
  readonly message: string;
  readonly fields: LogFields;
}

export interface Logger {
  debug(message: string, fields?: Partial<LogFields>): void;
  info(message: string, fields?: Partial<LogFields>): void;
  warn(message: string, fields?: Partial<LogFields>): void;
  error(message: string, fields?: Partial<LogFields>): void;
}

export interface LoggerOptions {
  readonly service: string;
  readonly environment: string;
  readonly redact?: (value: unknown) => unknown;
  readonly sink?: (entry: LogEntry) => void;
  readonly onPolicyViolation?: (codes: readonly string[]) => void;
}

export function createJsonLogger(options: LoggerOptions): Logger {
  const sink =
    options.sink ??
    ((entry) => {
      const line = JSON.stringify(entry);
      if (entry.level === "error") {
        console.error(line);
      } else if (entry.level === "warn") {
        console.warn(line);
      } else {
        console.log(line);
      }
    });

  const emit = (level: LogLevel, message: string, fields: Partial<LogFields> = {}) => {
    const spanContext = trace.getActiveSpan()?.spanContext();
    const mergedFields: Record<string, unknown> = {
      service: options.service,
      environment: options.environment,
      ...fields,
      ...(spanContext?.traceId ? { traceId: spanContext.traceId } : {}),
      ...(spanContext?.spanId ? { spanId: spanContext.spanId } : {})
    };
    const allowed = allowlistDiagnosticFields(mergedFields);
    if (allowed.violations.length > 0) options.onPolicyViolation?.(allowed.violations);
    const eventCode = safeDiagnosticEventCode(fields.event);

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      // Free-text messages are never emitted. The stable event code is the diagnostic message.
      message: eventCode,
      fields: (options.redact ? options.redact(allowed.fields) : allowed.fields) as LogFields
    };

    void message;

    sink(entry);
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields)
  };
}
