import {
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer
} from "@opentelemetry/api";
import type { Logger } from "./logger.js";
import type { MetricRecorder } from "./metrics.js";
import { extractW3cTraceContext, type TraceCarrier } from "./context.js";

export type InstrumentationDomain =
  | "http"
  | "postgres"
  | "redis"
  | "outbox"
  | "temporal"
  | "identity"
  | "media"
  | "provider"
  | "worker";

export interface InstrumentedOperation {
  readonly domain: InstrumentationDomain;
  readonly operation:
    | "connect"
    | "delete"
    | "execute"
    | "export"
    | "inspect"
    | "publish"
    | "read"
    | "reconcile"
    | "request"
    | "restore"
    | "scan"
    | "write"
    | "other";
  readonly routeFamily?:
    "clinic_day" | "health" | "identity" | "media" | "operations" | "provider_callback" | "other";
  readonly workflow?:
    | "billing"
    | "clinical"
    | "continuity"
    | "front_office"
    | "identity"
    | "media"
    | "operations"
    | "provider"
    | "other";
  readonly carrier?: TraceCarrier;
  readonly spanKind?: SpanKind;
}

export interface InstrumentationHooksOptions {
  readonly tracer: Tracer;
  readonly metrics: MetricRecorder;
  readonly logger: Logger;
  readonly monotonicNowMs: () => number;
}

export class InstrumentationHooks {
  readonly #tracer: Tracer;
  readonly #metrics: MetricRecorder;
  readonly #logger: Logger;
  readonly #monotonicNowMs: () => number;

  constructor(options: InstrumentationHooksOptions) {
    this.#tracer = options.tracer;
    this.#metrics = options.metrics;
    this.#logger = options.logger;
    this.#monotonicNowMs = options.monotonicNowMs;
  }

  run<T>(operation: InstrumentedOperation, execute: () => Promise<T>): Promise<T> {
    const parent = operation.carrier ? extractW3cTraceContext(operation.carrier) : undefined;
    const spanName = `clinic_os.${operation.domain}.${operation.operation}`;
    const attributes = operationAttributes(operation);
    const callback = async (span: Span): Promise<T> => {
      const startedAt = this.#monotonicNowMs();
      try {
        const result = await execute();
        const durationMs = Math.max(0, this.#monotonicNowMs() - startedAt);
        span.setStatus({ code: SpanStatusCode.OK });
        this.#record(operation, "success", durationMs);
        return result;
      } catch (error) {
        const durationMs = Math.max(0, this.#monotonicNowMs() - startedAt);
        const errorCode = boundedErrorCode(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorCode });
        span.setAttribute("error.type", errorCode);
        this.#record(operation, "error", durationMs);
        this.#logger.error("instrumented operation failed", {
          event: `telemetry.${operation.domain}.failed`,
          component: domainComponent(operation.domain),
          operation: operation.operation,
          status: "error",
          errorCode
        });
        throw error;
      } finally {
        span.end();
      }
    };
    const spanOptions = {
      kind: operation.spanKind ?? spanKind(operation.domain),
      attributes
    };
    return parent
      ? this.#tracer.startActiveSpan(spanName, spanOptions, parent, callback)
      : this.#tracer.startActiveSpan(spanName, spanOptions, callback);
  }

  activeTraceContext(): ReturnType<typeof trace.getActiveSpan> {
    return trace.getActiveSpan();
  }

  #record(operation: InstrumentedOperation, status: "success" | "error", durationMs: number) {
    if (operation.domain === "http") {
      const tags = { routeFamily: operation.routeFamily ?? "other", status };
      this.#metrics.increment("clinic_os.http.requests", 1, tags);
      this.#metrics.timing("clinic_os.http.duration_ms", durationMs, tags);
      return;
    }
    if (operation.domain === "outbox") {
      this.#metrics.increment("clinic_os.outbox.events", 1, {
        workflow: operation.workflow ?? "other",
        status
      });
      return;
    }
    if (operation.domain === "temporal") {
      this.#metrics.timing("clinic_os.temporal.duration_ms", durationMs, {
        workflow: operation.workflow ?? "other",
        status
      });
      return;
    }
    if (
      operation.domain === "identity" ||
      operation.domain === "media" ||
      operation.domain === "provider"
    ) {
      this.#metrics.increment(`clinic_os.${operation.domain}.outcomes`, 1, {
        operation: operation.operation,
        status
      });
      return;
    }
    if (operation.domain === "worker") {
      this.#metrics.increment("clinic_os.worker.executions", 1, {
        workflow: operation.workflow ?? "other",
        status
      });
      return;
    }
    const component = domainComponent(operation.domain);
    const tags = { component, operation: operation.operation, status };
    this.#metrics.increment("clinic_os.dependency.operations", 1, tags);
    this.#metrics.timing("clinic_os.dependency.duration_ms", durationMs, tags);
  }
}

function operationAttributes(operation: InstrumentedOperation): Attributes {
  return {
    "clinic_os.domain": operation.domain,
    "clinic_os.operation": operation.operation,
    ...(operation.routeFamily ? { "clinic_os.route.family": operation.routeFamily } : {}),
    ...(operation.workflow ? { "clinic_os.workflow": operation.workflow } : {})
  };
}

function spanKind(domain: InstrumentationDomain): SpanKind {
  if (domain === "http") return SpanKind.SERVER;
  if (["postgres", "redis", "provider"].includes(domain)) return SpanKind.CLIENT;
  if (domain === "outbox") return SpanKind.CONSUMER;
  return SpanKind.INTERNAL;
}

function domainComponent(domain: InstrumentationDomain): string {
  if (domain === "postgres") return "database";
  if (domain === "redis") return "cache";
  if (domain === "temporal") return "temporal";
  return domain;
}

function boundedErrorCode(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = error.code;
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{2,63}$/u.test(code)) return code;
  }
  if (error instanceof Error) {
    const standardErrorCodes: Readonly<Record<string, string>> = {
      AbortError: "ABORTED",
      AggregateError: "AGGREGATE_ERROR",
      Error: "ERROR",
      RangeError: "RANGE_ERROR",
      ReferenceError: "REFERENCE_ERROR",
      SyntaxError: "SYNTAX_ERROR",
      TimeoutError: "TIMEOUT",
      TypeError: "TYPE_ERROR",
      URIError: "URI_ERROR"
    };
    return standardErrorCodes[error.name] ?? "UNCLASSIFIED_ERROR";
  }
  return "UNCLASSIFIED_ERROR";
}
