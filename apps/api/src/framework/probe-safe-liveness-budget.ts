import type {
  AtomicBudgetStore,
  BudgetConsumptionRequest,
  BudgetConsumptionResult
} from "@clinic-os/security";

/**
 * Process-local, bounded protection used only by the live, ready, and startup probes. Health
 * probes must remain dependency-independent so orchestration can distinguish a live process and
 * dependency reports from Redis loss. All traffic-bearing routes continue to use the injected
 * atomic distributed store.
 */
export class ProbeSafeLivenessBudgetStore implements AtomicBudgetStore {
  static readonly MAX_BUCKETS = 1024;
  readonly #buckets = new Map<string, { consumed: number; resetAt: Date }>();

  consume(request: BudgetConsumptionRequest): Promise<BudgetConsumptionResult> {
    const current = this.#buckets.get(request.bucketKey);
    const active = current && current.resetAt.getTime() > request.now.getTime() ? current : null;
    const resetAt = active
      ? new Date(active.resetAt.getTime())
      : new Date(request.now.getTime() + request.windowSeconds * 1000);
    const consumed = active?.consumed ?? 0;
    const allowed = consumed + request.cost <= request.limit;
    if (allowed) {
      if (!active && this.#buckets.size >= ProbeSafeLivenessBudgetStore.MAX_BUCKETS) {
        for (const [key, bucket] of this.#buckets) {
          if (bucket.resetAt.getTime() <= request.now.getTime()) this.#buckets.delete(key);
        }
        if (this.#buckets.size >= ProbeSafeLivenessBudgetStore.MAX_BUCKETS) {
          const oldestKey = this.#buckets.keys().next().value;
          if (oldestKey) this.#buckets.delete(oldestKey);
        }
      }
      this.#buckets.set(request.bucketKey, { consumed: consumed + request.cost, resetAt });
    }
    return Promise.resolve({
      allowed,
      remaining: Math.max(0, request.limit - (allowed ? consumed + request.cost : consumed)),
      resetAt
    });
  }
}
