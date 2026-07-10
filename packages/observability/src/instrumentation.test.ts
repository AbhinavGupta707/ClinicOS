import { describe, expect, it } from "vitest";
import type { Span, Tracer } from "@opentelemetry/api";
import type { Logger } from "./logger.js";
import type { MetricRecorder } from "./metrics.js";
import { InstrumentationHooks } from "./instrumentation.js";

describe("instrumentation error policy", () => {
  it("does not emit a patterned mutable Error.name", async () => {
    const errors: Array<Record<string, unknown>> = [];
    const spanAttributes: Record<string, unknown> = {};
    const span = {
      setStatus: () => undefined,
      setAttribute: (key: string, value: unknown) => {
        spanAttributes[key] = value;
        return span;
      },
      end: () => undefined
    } as unknown as Span;
    const tracer = {
      startActiveSpan: (...args: unknown[]) => {
        const callback = args.at(-1) as (activeSpan: Span) => Promise<unknown>;
        return callback(span);
      }
    } as unknown as Tracer;
    const logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (_message: string, fields?: Record<string, unknown>) => errors.push(fields ?? {})
    } satisfies Logger;
    const metrics = {
      increment: () => undefined,
      gauge: () => undefined,
      timing: () => undefined
    } satisfies MetricRecorder;
    const hooks = new InstrumentationHooks({
      tracer,
      logger,
      metrics,
      monotonicNowMs: () => 10
    });
    const failure = new Error("patient Rhea secret detail");
    failure.name = "PatientRhea";

    await expect(
      hooks.run({ domain: "worker", operation: "execute", workflow: "other" }, async () => {
        throw failure;
      })
    ).rejects.toBe(failure);
    expect(spanAttributes["error.type"]).toBe("UNCLASSIFIED_ERROR");
    expect(errors).toEqual([expect.objectContaining({ errorCode: "UNCLASSIFIED_ERROR" })]);
    expect(JSON.stringify({ spanAttributes, errors })).not.toMatch(
      /PatientRhea|patient Rhea|secret/u
    );
  });
});
