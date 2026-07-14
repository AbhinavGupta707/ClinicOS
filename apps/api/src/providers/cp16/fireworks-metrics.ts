import type { FireworksMetricEvent, FireworksMetricsSink } from "@clinic-os/integrations";
import type { MetricRecorder } from "@clinic-os/observability";

/**
 * Emits only bounded provider/task/status dimensions. The input event contains digested
 * attribution for durable reconciliation, but those high-cardinality values never enter metrics.
 */
export class ObservabilityFireworksMetricsSink implements FireworksMetricsSink {
  readonly #metrics: MetricRecorder;

  constructor(metrics: MetricRecorder) {
    this.#metrics = metrics;
  }

  record(event: FireworksMetricEvent): void {
    const tags = { provider: event.provider, task: event.task } as const;
    const outcomeTags = { ...tags, status: event.status } as const;
    this.#metrics.increment("clinic_os.ai.provider_calls", 1, outcomeTags);
    this.#metrics.timing("clinic_os.ai.provider_latency_ms", event.latencyMs, outcomeTags);
    if (event.inputTokens > 0) {
      this.#metrics.increment("clinic_os.ai.input_tokens", event.inputTokens, tags);
    }
    if (event.outputTokens > 0) {
      this.#metrics.increment("clinic_os.ai.output_tokens", event.outputTokens, tags);
    }
    if (event.audioBytes > 0) {
      this.#metrics.increment("clinic_os.ai.audio_bytes", event.audioBytes, tags);
    }
    if (event.audioDurationMs > 0) {
      this.#metrics.increment("clinic_os.ai.audio_duration_ms", event.audioDurationMs, tags);
    }
  }
}
