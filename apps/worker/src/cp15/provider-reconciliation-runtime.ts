import { systemClock, type Clock } from "@clinic-os/domain";
import {
  createHealthCheckResult,
  type HealthCheckResult,
  type Logger,
  type MetricRecorder
} from "@clinic-os/observability";
import type {
  ProviderReconciliationPollResult,
  ProviderReconciliationScope
} from "./provider-reconciliation-processor.js";
import type {
  ClaimedProviderReconciliationScope,
  ProviderReconciliationScopeSource
} from "./postgres-provider-reconciliation-scope-source.js";

export interface ProviderReconciliationPoller {
  pollOnce(scope: ProviderReconciliationScope): Promise<ProviderReconciliationPollResult>;
}

export interface ProviderReconciliationRuntimeOptions {
  readonly workerId: string;
  readonly processor: ProviderReconciliationPoller;
  readonly scopes: ProviderReconciliationScopeSource;
  readonly logger: Logger;
  readonly metrics: MetricRecorder;
  readonly pollIntervalMs: number;
  readonly scopeBatchSize: number;
  readonly scopeLeaseMs: number;
  readonly clock?: Clock;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export class ProviderReconciliationRuntime {
  readonly #workerId: string;
  readonly #processor: ProviderReconciliationPoller;
  readonly #scopes: ProviderReconciliationScopeSource;
  readonly #logger: Logger;
  readonly #metrics: MetricRecorder;
  readonly #pollIntervalMs: number;
  readonly #scopeBatchSize: number;
  readonly #scopeLeaseMs: number;
  readonly #clock: Clock;
  readonly #sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  #started = false;
  #lastLoopFailed = false;

  constructor(options: ProviderReconciliationRuntimeOptions) {
    this.#workerId = boundedWorkerId(options.workerId);
    this.#processor = options.processor;
    this.#scopes = options.scopes;
    this.#logger = options.logger;
    this.#metrics = options.metrics;
    this.#pollIntervalMs = boundedInteger(options.pollIntervalMs, 250, 300_000, "pollIntervalMs");
    this.#scopeBatchSize = boundedInteger(options.scopeBatchSize, 1, 100, "scopeBatchSize");
    this.#scopeLeaseMs = boundedInteger(options.scopeLeaseMs, 5_000, 300_000, "scopeLeaseMs");
    this.#clock = options.clock ?? systemClock;
    this.#sleep = options.sleep ?? abortableSleep;
  }

  async pollOnce(): Promise<Readonly<{ scopes: number; jobs: number; failures: number }>> {
    const startedAt = this.#clock.now();
    const leaseUntil = new Date(startedAt.getTime() + this.#scopeLeaseMs).toISOString();
    const claimed = await this.#scopes.claimDueScopes({
      workerId: this.#workerId,
      limit: this.#scopeBatchSize,
      now: startedAt.toISOString(),
      leaseUntil
    });
    let jobs = 0;
    let failures = 0;
    for (const scope of claimed) {
      try {
        const result = await this.#processor.pollOnce(scope);
        jobs += result.claimed;
        this.#recordResult(result);
      } catch {
        failures += 1;
        this.#metrics.increment("clinic_os.provider.outcomes", 1, {
          operation: "reconcile",
          status: "error"
        });
        this.#logger.error("provider reconciliation scope failed safely", {
          event: "worker.provider_reconciliation.scope_failed",
          failureCode: "PROVIDER_RECONCILIATION_SCOPE_FAILED"
        });
      } finally {
        try {
          const refresh = await this.#scopes.refreshScope(scope, this.#clock.now().toISOString());
          if (refresh === "lease_lost") failures += 1;
        } catch {
          failures += 1;
          this.#logger.error("provider reconciliation scope refresh failed safely", {
            event: "worker.provider_reconciliation.scope_refresh_failed",
            failureCode: "PROVIDER_RECONCILIATION_SCOPE_REFRESH_FAILED"
          });
        }
      }
    }
    this.#lastLoopFailed = failures > 0;
    this.#metrics.timing(
      "clinic_os.dependency.duration_ms",
      Math.max(0, this.#clock.now().getTime() - startedAt.getTime()),
      { component: "provider", operation: "reconcile", status: failures ? "degraded" : "success" }
    );
    return { scopes: claimed.length, jobs, failures };
  }

  async start(signal?: AbortSignal): Promise<void> {
    this.#started = true;
    this.#logger.info("provider reconciliation processor started", {
      event: "worker.provider_reconciliation.started"
    });
    while (!signal?.aborted) {
      try {
        await this.pollOnce();
      } catch {
        this.#lastLoopFailed = true;
        this.#metrics.increment("clinic_os.provider.outcomes", 1, {
          operation: "reconcile",
          status: "error"
        });
        this.#logger.error("provider reconciliation polling failed safely", {
          event: "worker.provider_reconciliation.poll_failed",
          failureCode: "PROVIDER_RECONCILIATION_POLL_FAILED"
        });
      }
      await this.#sleep(this.#pollIntervalMs, signal);
    }
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const dueNow = await this.#scopes.countDue(this.#clock.now().toISOString());
    return createHealthCheckResult(
      "provider_reconciliation",
      !this.#started || this.#lastLoopFailed ? "degraded" : "healthy",
      { details: { dueNow } }
    );
  }

  #recordResult(result: ProviderReconciliationPollResult): void {
    for (const [status, value] of [
      ["success", result.matched],
      ["degraded", result.variances + result.manualReview],
      ["retry_scheduled", result.retriesScheduled],
      ["failed_exhausted", result.deadLettered],
      ["error", result.leaseLost]
    ] as const) {
      if (value > 0) {
        this.#metrics.increment("clinic_os.provider.outcomes", value, {
          operation: "reconcile",
          status
        });
      }
    }
  }
}

function abortableSleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("aborted"));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error("aborted"));
      },
      { once: true }
    );
  });
}

function boundedWorkerId(value: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(value)) {
    throw new Error("Provider reconciliation worker identifier is invalid.");
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}
