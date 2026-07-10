import assert from "node:assert/strict";
import test from "node:test";
import { defaultPayloadConverter } from "@temporalio/common";
import type { ActivityInput, WorkflowExecuteInput } from "@temporalio/workflow";
import { interceptors } from "../workflow-trace-interceptor.js";

const traceparent = "00-10000000000000000000000000000001-1000000000000001-01";

test("workflow interceptor deterministically copies validated trace context into activity headers", async () => {
  const configured = interceptors();
  const payload = defaultPayloadConverter.toPayload(traceparent);
  await configured.inbound![0].execute!(
    { args: [], headers: { traceparent: payload } } as WorkflowExecuteInput,
    async () => undefined
  );

  let captured: ActivityInput | undefined;
  await configured.outbound![0].scheduleActivity!(
    { args: [], headers: {}, activityType: "synthetic", options: {}, seq: 1 } as ActivityInput,
    async (input) => {
      captured = input;
      return undefined;
    }
  );

  assert.equal(captured!.headers.traceparent, payload);
});

test("workflow interceptor drops malformed trace metadata", async () => {
  const configured = interceptors();
  await configured.inbound![0].execute!(
    {
      args: [],
      headers: { traceparent: defaultPayloadConverter.toPayload("patient-123") }
    } as WorkflowExecuteInput,
    async () => undefined
  );

  let captured: ActivityInput | undefined;
  await configured.outbound![0].scheduleActivity!(
    { args: [], headers: {}, activityType: "synthetic", options: {}, seq: 1 } as ActivityInput,
    async (input) => {
      captured = input;
      return undefined;
    }
  );

  assert.deepEqual(captured!.headers, {});
});
