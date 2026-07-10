import { defaultPayloadConverter, type Payload } from "@temporalio/common";
import type {
  ActivityInput,
  LocalActivityInput,
  Next,
  WorkflowExecuteInput,
  WorkflowInboundCallsInterceptor,
  WorkflowInterceptorsFactory,
  WorkflowOutboundCallsInterceptor
} from "@temporalio/workflow";

export const interceptors: WorkflowInterceptorsFactory = () => {
  let traceparent: Payload | undefined;
  return {
    inbound: [
      {
        execute(
          input: WorkflowExecuteInput,
          next: Next<WorkflowInboundCallsInterceptor, "execute">
        ): Promise<unknown> {
          traceparent = validatedTraceparentPayload(input.headers.traceparent);
          return next(input);
        }
      }
    ],
    outbound: [
      {
        scheduleActivity(
          input: ActivityInput,
          next: Next<WorkflowOutboundCallsInterceptor, "scheduleActivity">
        ): Promise<unknown> {
          return next(withTraceparent(input, traceparent));
        },
        scheduleLocalActivity(
          input: LocalActivityInput,
          next: Next<WorkflowOutboundCallsInterceptor, "scheduleLocalActivity">
        ): Promise<unknown> {
          return next(withTraceparent(input, traceparent));
        }
      }
    ]
  };
};

function validatedTraceparentPayload(payload: Payload | undefined): Payload | undefined {
  if (!payload) return undefined;
  try {
    const value = defaultPayloadConverter.fromPayload<string>(payload);
    return /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/u.test(value) ? payload : undefined;
  } catch {
    return undefined;
  }
}

function withTraceparent<T extends ActivityInput | LocalActivityInput>(
  input: T,
  traceparent: Payload | undefined
): T {
  if (!traceparent) return input;
  return {
    ...input,
    headers: { ...input.headers, traceparent }
  };
}
