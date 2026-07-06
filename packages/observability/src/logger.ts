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
    const mergedFields: LogFields = {
      service: options.service,
      environment: options.environment,
      ...fields
    };

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      fields: (options.redact ? options.redact(mergedFields) : mergedFields) as LogFields
    };

    sink(entry);
  };

  return {
    debug: (message, fields) => emit("debug", message, fields),
    info: (message, fields) => emit("info", message, fields),
    warn: (message, fields) => emit("warn", message, fields),
    error: (message, fields) => emit("error", message, fields)
  };
}
