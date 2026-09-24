import type { RedisSecurityAuditOutboxPage } from "./redis-web-session-store.ts";
import {
  SecurityAuditSinkError,
  type DurableSecurityAuditSink
} from "./postgres-security-audit-sink.ts";

type PendingAudit = RedisSecurityAuditOutboxPage["items"][number];
export interface PendingSecurityAuditSource {
  scanPendingAudits(cursor?: string, count?: number): Promise<RedisSecurityAuditOutboxPage>;
  acknowledgePendingAudit(
    item: Pick<PendingAudit, "deduplicationKey" | "serializedRecord">
  ): Promise<"acknowledged" | "missing" | "changed">;
  readiness(): Promise<void>;
}
export class SecurityAuditDispatchError extends Error {
  constructor() {
    super("Required security audit delivery is unavailable.");
    this.name = "SecurityAuditDispatchError";
  }
}

/** Caller-scheduled at-least-once delivery; construction starts no timer or service. */
export class SecurityAuditDispatcher {
  readonly #source: PendingSecurityAuditSource;
  readonly #sink: DurableSecurityAuditSink;
  readonly #batchSize: number;
  readonly #now: () => Date;
  readonly #maximumSilenceMs: number;
  #cursor = "0";
  #pending: PendingAudit[] = [];
  #running = false;
  #lastCleanSweep: number | null = null;
  #failed = false;
  #sweepConflict = false;

  constructor(input: {
    source: PendingSecurityAuditSource;
    sink: DurableSecurityAuditSink;
    now: () => Date;
    batchSize?: number;
    maximumSilenceMs?: number;
  }) {
    this.#source = input.source;
    this.#sink = input.sink;
    this.#now = input.now;
    this.#batchSize = input.batchSize ?? 100;
    this.#maximumSilenceMs = input.maximumSilenceMs ?? 30_000;
    if (
      input.sink.durability !== "durable_append_only" ||
      typeof input.now !== "function" ||
      !Number.isSafeInteger(this.#batchSize) ||
      this.#batchSize < 1 ||
      this.#batchSize > 500 ||
      !Number.isSafeInteger(this.#maximumSilenceMs) ||
      this.#maximumSilenceMs < 1000 ||
      this.#maximumSilenceMs > 300_000
    )
      throw new Error("Invalid security audit delivery policy.");
  }

  async runOnce(): Promise<{ delivered: number; conflicts: number; scanComplete: boolean }> {
    if (this.#running) throw new SecurityAuditDispatchError();
    this.#running = true;
    let delivered = 0;
    let conflicts = 0;
    try {
      if (this.#pending.length === 0) {
        const page = await this.#source.scanPendingAudits(this.#cursor, this.#batchSize);
        if (!/^\d{1,20}$/.test(page.nextCursor)) throw new SecurityAuditDispatchError();
        this.#cursor = page.nextCursor;
        // HSCAN COUNT is a hint. Preserve the remainder rather than losing events.
        this.#pending = [...page.items];
      }
      for (let attempts = 0; this.#pending.length && attempts < this.#batchSize; attempts++) {
        const item = this.#pending[0];
        if (item.deduplicationKey !== item.intent.deduplicationKey)
          throw new SecurityAuditDispatchError();
        try {
          await this.#sink.append(item.intent);
          const acknowledgement = await this.#source.acknowledgePendingAudit(item);
          if (acknowledgement === "changed")
            throw new SecurityAuditSinkError("conflicting_evidence");
          delivered++;
        } catch (error) {
          if (!(error instanceof SecurityAuditSinkError) || error.code !== "conflicting_evidence")
            throw error;
          // Keep poison evidence in Redis, continue unrelated delivery, and remove
          // readiness. The next scan retries it; it is never discarded/dead-lettered.
          this.#sweepConflict = true;
          this.#failed = true;
          conflicts++;
        }
        this.#pending.shift();
      }
      const scanComplete = this.#pending.length === 0 && this.#cursor === "0";
      if (scanComplete) {
        this.#failed = this.#sweepConflict;
        if (!this.#failed) this.#lastCleanSweep = this.#instant();
        this.#sweepConflict = false;
      }
      return { delivered, conflicts, scanComplete };
    } catch {
      this.#failed = true;
      throw new SecurityAuditDispatchError();
    } finally {
      this.#running = false;
    }
  }

  async readiness(): Promise<void> {
    try {
      const now = this.#instant();
      if (
        this.#failed ||
        this.#lastCleanSweep === null ||
        now < this.#lastCleanSweep ||
        now - this.#lastCleanSweep > this.#maximumSilenceMs
      )
        throw new SecurityAuditDispatchError();
      await this.#source.readiness();
      await this.#sink.readiness();
    } catch {
      throw new SecurityAuditDispatchError();
    }
  }

  #instant(): number {
    const instant = this.#now().getTime();
    if (!Number.isFinite(instant)) throw new SecurityAuditDispatchError();
    return instant;
  }
}
