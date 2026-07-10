import { describe, expect, it } from "vitest";
import type { Meter } from "@opentelemetry/api";
import { createOtelMetricRecorder } from "./metrics.js";

describe("createOtelMetricRecorder", () => {
  it("uses the runtime method for counters, synchronous gauges, and histograms", () => {
    const calls: string[] = [];
    const meter = {
      createCounter() {
        return { add: () => calls.push("counter.add") };
      },
      createGauge() {
        return { record: () => calls.push("gauge.record") };
      },
      createHistogram() {
        return { record: () => calls.push("histogram.record") };
      }
    } as unknown as Meter;
    const metrics = createOtelMetricRecorder({ meter });

    metrics.increment("clinic_os.http.requests", 1, {
      routeFamily: "health",
      status: "success"
    });
    metrics.gauge("clinic_os.outbox.depth", 4, { status: "healthy" });
    metrics.timing("clinic_os.http.duration_ms", 12, {
      routeFamily: "health",
      status: "success"
    });

    expect(calls).toEqual(["counter.add", "gauge.record", "histogram.record"]);
  });
});
