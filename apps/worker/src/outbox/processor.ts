import type { Logger, MetricRecorder } from "@clinic-os/observability";
import { classifyOutboxFailure, permanentOutboxFailure } from "./errors.js";
import { OutboxHandlerRegistry } from "./handler-registry.js";
import type {
  OutboxAttemptRecord,
  OutboxEventHandler,
  OutboxEventRecord,
  OutboxRepository
} from "./types.js";

export interface OutboxProcessorOptions {
  readonly workerId: string;
  readonly repository: OutboxRepository;
  readonly handlers: readonly OutboxEventHandler[];
  readonly logger: Logger;
  readonly metrics: MetricRecorder;
  readonly batchSize?: number;
  readonly pollIntervalMs?: number;
  readonly leaseMs?: number;
  readonly maxAttempts?: number;
  readonly baseRetryDelayMs?: number;
  readonly maxRetryDelayMs?: number;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export interface OutboxPollResult {
  readonly claimed: number;
  readonly processed: number;
  readonly retried: number;
  readonly deadLettered: number;
}

const defaultSleep = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
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

export class OutboxProcessor {
  readonly #workerId: string;
  readonly #repository: OutboxRepository;
  readonly #registry: OutboxHandlerRegistry;
  readonly #logger: Logger;
  readonly #metrics: MetricRecorder;
  readonly #batchSize: number;
  readonly #pollIntervalMs: number;
  readonly #leaseMs: number;
  readonly #maxAttempts: number;
  readonly #baseRetryDelayMs: number;
  readonly #maxRetryDelayMs: number;
  readonly #now: () => Date;
  readonly #sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;

  constructor(options: OutboxProcessorOptions) {
    this.#workerId = options.workerId;
    this.#repository = options.repository;
    this.#registry = new OutboxHandlerRegistry(options.handlers);
    this.#logger = options.logger;
    this.#metrics = options.metrics;
    this.#batchSize = options.batchSize ?? 25;
    this.#pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.#leaseMs = options.leaseMs ?? 30000;
    this.#maxAttempts = options.maxAttempts ?? 8;
    this.#baseRetryDelayMs = options.baseRetryDelayMs ?? 1000;
    this.#maxRetryDelayMs = options.maxRetryDelayMs ?? 300000;
    this.#now = options.now ?? (() => new Date());
    this.#sleep = options.sleep ?? defaultSleep;
  }

  registeredEventTypes(): readonly string[] {
    return this.#registry.eventTypes();
  }

  async pollOnce(): Promise<OutboxPollResult> {
    const startedAt = this.#now();
    const events = await this.#repository.claimDueEvents({
      workerId: this.#workerId,
      batchSize: this.#batchSize,
      leaseUntil: new Date(startedAt.getTime() + this.#leaseMs).toISOString(),
      now: startedAt.toISOString()
    });

    const result = {
      claimed: events.length,
      processed: 0,
      retried: 0,
      deadLettered: 0
    };

    for (const event of events) {
      const eventResult = await this.#processEvent(event);
      result.processed += eventResult.processed;
      result.retried += eventResult.retried;
      result.deadLettered += eventResult.deadLettered;
    }

    const duration = this.#now().getTime() - startedAt.getTime();
    this.#metrics.timing("worker.outbox.poll.duration_ms", duration, {
      status: "completed"
    });
    this.#metrics.gauge("worker.outbox.poll.claimed", events.length);

    return result;
  }

  async start(signal?: AbortSignal): Promise<void> {
    this.#logger.info("outbox processor started", {
      event: "worker.outbox.started",
      registeredEventTypes: this.#registry.eventTypes()
    });

    while (!signal?.aborted) {
      await this.pollOnce();
      await this.#sleep(this.#pollIntervalMs, signal);
    }
  }

  async #processEvent(
    event: OutboxEventRecord
  ): Promise<{ readonly processed: number; readonly retried: number; readonly deadLettered: number }> {
    const attempt = await this.#repository.recordAttemptStarted(
      event,
      this.#workerId,
      this.#now().toISOString()
    );

    const logFields = {
      event: "worker.outbox.event",
      eventId: event.eventId,
      eventType: event.eventType,
      tenantId: event.tenantId,
      clinicId: event.clinicId,
      correlationId: event.correlationId,
      attemptNumber: attempt.attemptNumber
    };

    const handler = this.#registry.get(event.eventType);
    if (!handler) {
      return this.#failEvent(
        event,
        attempt,
        permanentOutboxFailure("OUTBOX_HANDLER_NOT_REGISTERED", `No outbox handler for ${event.eventType}`),
        logFields
      );
    }

    try {
      await handler.handle(event, {
        workerId: this.#workerId,
        attempt,
        correlationId: event.correlationId,
        tenantId: event.tenantId,
        clinicId: event.clinicId,
        idempotencyKey: event.idempotencyKey
      });

      const finishedAt = this.#now().toISOString();
      await this.#repository.markAttemptSucceeded(attempt.attemptId, finishedAt);
      await this.#repository.markProcessed(event.eventId, finishedAt);
      this.#metrics.increment("worker.outbox.event.processed", 1, {
        eventType: event.eventType,
        status: "processed",
        tenantId: event.tenantId,
        clinicId: event.clinicId
      });
      this.#logger.info("outbox event processed", logFields);
      return { processed: 1, retried: 0, deadLettered: 0 };
    } catch (error) {
      return this.#failEvent(event, attempt, error, logFields);
    }
  }

  async #failEvent(
    event: OutboxEventRecord,
    attempt: OutboxAttemptRecord,
    error: unknown,
    logFields: Record<string, unknown>
  ): Promise<{ readonly processed: number; readonly retried: number; readonly deadLettered: number }> {
    const failure = classifyOutboxFailure(error);
    const attemptsExhausted = attempt.attemptNumber >= this.#maxAttempts;

    if (!failure.retryable || attemptsExhausted) {
      await this.#repository.moveToDeadLetter(event, attempt, {
        failureCode: failure.code,
        failureMessage: failure.message,
        failedAt: this.#now().toISOString(),
        attemptStatus: attemptsExhausted ? "failed_exhausted" : "failed_permanent"
      });
      this.#metrics.increment("worker.outbox.event.dead_lettered", 1, {
        eventType: event.eventType,
        status: attemptsExhausted ? "failed_exhausted" : "failed_permanent",
        tenantId: event.tenantId,
        clinicId: event.clinicId
      });
      this.#logger.error("outbox event moved to dead letter", {
        ...logFields,
        failureCode: failure.code,
        failureMessage: failure.message,
        attemptsExhausted
      });
      return { processed: 0, retried: 0, deadLettered: 1 };
    }

    const nextAttemptAt = new Date(
      this.#now().getTime() + this.#retryDelayMs(attempt.attemptNumber)
    ).toISOString();
    await this.#repository.scheduleRetry(event, attempt, {
      nextAttemptAt,
      failureCode: failure.code,
      failureMessage: failure.message
    });
    this.#metrics.increment("worker.outbox.event.retry_scheduled", 1, {
      eventType: event.eventType,
      status: "retry_scheduled",
      tenantId: event.tenantId,
      clinicId: event.clinicId
    });
    this.#logger.warn("outbox event retry scheduled", {
      ...logFields,
      failureCode: failure.code,
      failureMessage: failure.message,
      nextAttemptAt
    });
    return { processed: 0, retried: 1, deadLettered: 0 };
  }

  #retryDelayMs(attemptNumber: number): number {
    return Math.min(this.#baseRetryDelayMs * 2 ** Math.max(0, attemptNumber - 1), this.#maxRetryDelayMs);
  }
}
