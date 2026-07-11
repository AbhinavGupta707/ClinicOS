import { defaultPayloadConverter } from "@temporalio/common";
import type {
  Next as ClientNext,
  WorkflowClientInterceptor,
  WorkflowStartInput,
  WorkflowStartOutput
} from "@temporalio/client";
import type {
  ActivityExecuteInput,
  ActivityInboundCallsInterceptor,
  ActivityInterceptorsFactory,
  Next as WorkerNext
} from "@temporalio/worker";
import {
  injectW3cTraceContext,
  sanitizeTraceCarrier,
  type InstrumentationHooks,
  type TraceCarrier
} from "@clinic-os/observability";

export function createTemporalWorkflowClientTraceInterceptor(
  traceContextProvider: () => TraceCarrier = injectW3cTraceContext
): WorkflowClientInterceptor {
  return {
    startWithDetails(
      input: WorkflowStartInput,
      next: ClientNext<WorkflowClientInterceptor, "startWithDetails">
    ): Promise<WorkflowStartOutput> {
      const traceparent = sanitizeTraceCarrier(traceContextProvider()).traceparent;
      if (!traceparent) return next(input);
      return next({
        ...input,
        headers: {
          ...input.headers,
          traceparent: defaultPayloadConverter.toPayload(traceparent)
        }
      });
    }
  };
}

export function createTemporalActivityTraceInterceptor(
  instrumentation: Pick<InstrumentationHooks, "run">
): ActivityInterceptorsFactory {
  return () => ({
    inbound: {
      execute(
        input: ActivityExecuteInput,
        next: WorkerNext<ActivityInboundCallsInterceptor, "execute">
      ): Promise<unknown> {
        const carrier = traceCarrierFromTemporalHeaders(input.headers);
        return instrumentation.run(
          {
            domain: "temporal",
            operation: "execute",
            workflow: "other",
            ...(carrier ? { carrier } : {})
          },
          () => next(input)
        );
      }
    }
  });
}

function traceCarrierFromTemporalHeaders(
  headers: Readonly<Record<string, import("@temporalio/common").Payload>>
) {
  const payload = headers.traceparent;
  if (!payload) return undefined;
  try {
    const traceparent = defaultPayloadConverter.fromPayload<string>(payload);
    const carrier = sanitizeTraceCarrier({ traceparent });
    return carrier.traceparent ? carrier : undefined;
  } catch {
    return undefined;
  }
}
