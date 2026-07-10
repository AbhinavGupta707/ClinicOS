import { ROOT_CONTEXT, context, trace, type Context, type SpanContext } from "@opentelemetry/api";
import { core } from "@opentelemetry/sdk-node";

export interface TraceCarrier {
  readonly traceparent?: string;
  readonly tracestate?: string;
}

const carrierSetter = {
  set(carrier: Record<string, string>, key: string, value: string) {
    carrier[key.toLowerCase()] = value;
  }
};
const carrierGetter = {
  keys(carrier: TraceCarrier) {
    return Object.keys(carrier);
  },
  get(carrier: TraceCarrier, key: string) {
    return carrier[key.toLowerCase() as keyof TraceCarrier];
  }
};
const propagator = new core.W3CTraceContextPropagator();

export function injectW3cTraceContext(source: Context = context.active()): TraceCarrier {
  const carrier: Record<string, string> = {};
  propagator.inject(source, carrier, carrierSetter);
  return sanitizeTraceCarrier(carrier);
}

export function injectSpanContext(spanContext: SpanContext): TraceCarrier {
  return injectW3cTraceContext(trace.setSpanContext(ROOT_CONTEXT, spanContext));
}

export function extractW3cTraceContext(carrier: TraceCarrier): Context {
  return propagator.extract(ROOT_CONTEXT, sanitizeTraceCarrier(carrier), carrierGetter);
}

export function sanitizeTraceCarrier(carrier: object): TraceCarrier {
  const values = carrier as Readonly<Record<string, unknown>>;
  const traceparent =
    typeof values.traceparent === "string" &&
    /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u.test(values.traceparent)
      ? values.traceparent
      : undefined;
  return {
    ...(traceparent ? { traceparent } : {})
  };
}

export function activeTraceCorrelation(): Readonly<{
  traceId?: string;
  spanId?: string;
}> {
  const spanContext = trace.getActiveSpan()?.spanContext();
  if (!spanContext || !trace.isSpanContextValid(spanContext)) return {};
  return { traceId: spanContext.traceId, spanId: spanContext.spanId };
}
