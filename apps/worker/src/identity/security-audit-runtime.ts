import { setTimeout as delay } from "node:timers/promises";
import {
  createHealthCheckResult,
  type Logger,
  type MetricRecorder
} from "@clinic-os/observability";

export interface SecurityAuditDispatchPort {
  runOnce(): Promise<{ delivered: number; conflicts: number; scanComplete: boolean }>;
  readiness(): Promise<void>;
}

/** Inject into createWorkerRuntime only with the reviewed Redis and worker-role DB adapters. */
export class SecurityAuditRuntime {
  readonly #dispatcher: SecurityAuditDispatchPort;
  readonly #logger: Logger;
  readonly #metrics: MetricRecorder;
  readonly #sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  readonly #pollIntervalMs: number;
  readonly #publish?: (healthy: boolean) => Promise<void>;
  #running = false;
  #failed = true;

  constructor(input: {
    dispatcher: SecurityAuditDispatchPort;
    publishReadiness?: (healthy: boolean) => Promise<void>;
    logger: Logger;
    metrics: MetricRecorder;
    pollIntervalMs?: number;
    sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  }) {
    this.#dispatcher = input.dispatcher;
    this.#publish = input.publishReadiness;
    this.#logger = input.logger;
    this.#metrics = input.metrics;
    this.#pollIntervalMs = input.pollIntervalMs ?? 1000;
    if (
      !Number.isSafeInteger(this.#pollIntervalMs) ||
      this.#pollIntervalMs < 100 ||
      this.#pollIntervalMs > 5000
    )
      throw new Error("Invalid security audit polling policy.");
    this.#sleep = input.sleep ?? ((ms, signal) => delay(ms, undefined, { signal }));
  }

  async start(signal?: AbortSignal): Promise<void> {
    if (this.#running) throw new Error("Security audit runtime is already running.");
    this.#running = true;
    let failures = 0;
    try {
      while (!signal?.aborted) {
        try {
          const result = await this.#dispatcher.runOnce();
          this.#failed = result.conflicts > 0;
          failures = this.#failed ? Math.min(failures + 1, 5) : 0;
          this.#metrics.increment("clinic_os.outbox.events", result.delivered, {
            workflow: "identity",
            status: "success"
          });
          if (result.conflicts) {
            this.#metrics.increment("clinic_os.outbox.events", result.conflicts, {
              workflow: "identity",
              status: "denied"
            });
            this.#logger.error("Required security audit conflict", {
              event: "worker.security_audit.conflict"
            });
          }
        } catch {
          this.#failed = true;
          failures = Math.min(failures + 1, 5);
          this.#metrics.increment("clinic_os.outbox.events", 1, {
            workflow: "identity",
            status: "error"
          });
          this.#logger.error("Required security audit delivery unavailable", {
            event: "worker.security_audit.unavailable"
          });
        }
        if (this.#publish) {
          try { await this.#dispatcher.readiness(); await this.#publish(!this.#failed); }
          catch { this.#failed = true; await this.#publish(false).catch(() => undefined); }
        }
        try {
          await this.#sleep(Math.min(10_000, this.#pollIntervalMs * 2 ** failures), signal);
        } catch {
          if (!signal?.aborted) throw new Error("Security audit scheduling unavailable.");
        }
      }
    } finally {
      this.#running = false;
      this.#failed = true;
      await this.#publish?.(false).catch(() => undefined);
    }
  }

  async healthCheck() {
    try {
      if (!this.#running || this.#failed) throw new Error("not ready");
      await this.#dispatcher.readiness();
      return createHealthCheckResult("identity_security_audit_dispatcher", "healthy");
    } catch {
      return createHealthCheckResult("identity_security_audit_dispatcher", "unhealthy");
    }
  }
}
