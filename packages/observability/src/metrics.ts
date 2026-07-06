export interface MetricTags {
  readonly tenantId?: string;
  readonly clinicId?: string;
  readonly eventType?: string;
  readonly status?: string;
  readonly [key: string]: string | undefined;
}

export interface MetricRecorder {
  increment(name: string, value?: number, tags?: MetricTags): void;
  gauge(name: string, value: number, tags?: MetricTags): void;
  timing(name: string, milliseconds: number, tags?: MetricTags): void;
}

export interface RecordedMetric {
  readonly name: string;
  readonly value: number;
  readonly kind: "counter" | "gauge" | "timing";
  readonly tags: MetricTags;
}

export function createConsoleMetricRecorder(
  sink: (metric: RecordedMetric) => void = (metric) => console.log(JSON.stringify({ metric }))
): MetricRecorder {
  return {
    increment: (name, value = 1, tags = {}) => sink({ name, value, kind: "counter", tags }),
    gauge: (name, value, tags = {}) => sink({ name, value, kind: "gauge", tags }),
    timing: (name, milliseconds, tags = {}) =>
      sink({ name, value: milliseconds, kind: "timing", tags })
  };
}
