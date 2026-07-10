import assert from "node:assert/strict";
import test from "node:test";
import { defaultPayloadConverter } from "@temporalio/common";
import type { WorkflowStartInput } from "@temporalio/client";
import type { ActivityExecuteInput } from "@temporalio/worker";
import {
  createTemporalActivityTraceInterceptor,
  createTemporalWorkflowClientTraceInterceptor
} from "../cp14-observability/index.js";

const traceparent = "00-10000000000000000000000000000001-1000000000000001-01";

test("Temporal client interceptor injects only the active W3C traceparent header", async () => {
  const interceptor = createTemporalWorkflowClientTraceInterceptor(() => ({ traceparent }));
  let captured: WorkflowStartInput | undefined;
  const input = { headers: {}, options: {}, workflowType: "synthetic" } as WorkflowStartInput;

  await interceptor.startWithDetails!(input, async (nextInput) => {
    captured = nextInput;
    return { runId: "synthetic", eagerlyStarted: false };
  });

  assert.equal(defaultPayloadConverter.fromPayload(captured!.headers.traceparent!), traceparent);
  assert.deepEqual(Object.keys(captured!.headers), ["traceparent"]);
});

test("Temporal activity interceptor extracts validated trace context before execution", async () => {
  let capturedCarrier: unknown;
  const factory = createTemporalActivityTraceInterceptor({
    run: async (operation, execute) => {
      capturedCarrier = operation.carrier;
      return execute();
    }
  });
  const inbound = factory({} as never).inbound!;
  const result = await inbound.execute!(
    {
      args: [],
      headers: { traceparent: defaultPayloadConverter.toPayload(traceparent) }
    } as ActivityExecuteInput,
    async () => "completed"
  );

  assert.equal(result, "completed");
  assert.deepEqual(capturedCarrier, { traceparent });
});
