import assert from "node:assert/strict";
import test from "node:test";
import {
  createConsoleMetricRecorder,
  createJsonLogger,
  type MetricRecorder
} from "@clinic-os/observability";
import { permanentOutboxFailure, transientOutboxFailure } from "../outbox/errors.js";
import { OutboxProcessor } from "../outbox/processor.js";
import type {
  OutboxAttemptRecord,
  OutboxBacklogStats,
  OutboxClaimRequest,
  OutboxDeadLetterRequest,
  OutboxEventHandler,
  OutboxEventRecord,
  OutboxHandlerContext,
  OutboxRepository,
  OutboxRetrySchedule
} from "../outbox/types.js";

const fixedNow = new Date("2026-07-06T09:00:00.000Z");

test("processes an outbox event and marks the attempt succeeded", async () => {
  const event = createEvent();
  const repository = new MemoryOutboxRepository([event]);
  const handled: string[] = [];
  const processor = createProcessor(repository, [
    {
      eventType: event.eventType,
      async handle(received) {
        handled.push(received.eventId);
      }
    }
  ]);

  const result = await processor.pollOnce();

  assert.deepEqual(result, {
    claimed: 1,
    processed: 1,
    retried: 0,
    deadLettered: 0
  });
  assert.deepEqual(handled, [event.eventId]);
  assert.deepEqual(repository.lastClaimRequest?.eventTypes, ["test.event"]);
  assert.equal(repository.events.get(event.eventId)?.status, "processed");
  assert.equal(repository.attempts[0]?.status, "succeeded");
});

test("schedules retry for transient handler failures", async () => {
  const event = createEvent();
  const repository = new MemoryOutboxRepository([event]);
  const processor = createProcessor(repository, [
    {
      eventType: event.eventType,
      async handle() {
        throw transientOutboxFailure("PROVIDER_TIMEOUT", "provider timed out");
      }
    }
  ]);

  const result = await processor.pollOnce();

  assert.equal(result.retried, 1);
  assert.equal(repository.events.get(event.eventId)?.status, "retry_scheduled");
  assert.equal(repository.attempts[0]?.status, "retry_scheduled");
  assert.equal(repository.retries[0]?.nextAttemptAt, "2026-07-06T09:00:01.000Z");
});

test("moves permanent failures to dead letter review", async () => {
  const event = createEvent();
  const repository = new MemoryOutboxRepository([event]);
  const processor = createProcessor(repository, [
    {
      eventType: event.eventType,
      async handle() {
        throw permanentOutboxFailure("INVALID_PROVIDER_PAYLOAD", "payload cannot be normalized");
      }
    }
  ]);

  const result = await processor.pollOnce();

  assert.equal(result.deadLettered, 1);
  assert.equal(repository.events.get(event.eventId)?.status, "dead_lettered");
  assert.equal(repository.deadLetters[0]?.failureCode, "INVALID_PROVIDER_PAYLOAD");
  assert.equal(repository.deadLetters[0]?.attemptStatus, "failed_permanent");
});

test("moves exhausted transient failures to dead letter review", async () => {
  const event = createEvent({ attemptCount: 7 });
  const repository = new MemoryOutboxRepository([event]);
  const processor = createProcessor(repository, [
    {
      eventType: event.eventType,
      async handle() {
        throw transientOutboxFailure("PAYMENT_PROVIDER_DOWN", "provider unavailable");
      }
    }
  ]);

  const result = await processor.pollOnce();

  assert.equal(result.deadLettered, 1);
  assert.equal(repository.deadLetters[0]?.attemptStatus, "failed_exhausted");
});

test("dead letters events without a registered handler", async () => {
  const event = createEvent({ eventType: "unknown.event" });
  const repository = new MemoryOutboxRepository([event]);
  const processor = createProcessor(repository, []);

  const result = await processor.pollOnce();

  assert.equal(result.deadLettered, 1);
  assert.equal(repository.deadLetters[0]?.failureCode, "OUTBOX_HANDLER_NOT_REGISTERED");
});

test("backpressure can stop claims or admit only explicitly selected event families", async () => {
  const event = createEvent();
  const repository = new MemoryOutboxRepository([event]);
  const processor = createProcessor(
    repository,
    [{ eventType: event.eventType, handle: async () => undefined }],
    async () => []
  );

  assert.deepEqual(await processor.pollOnce(), {
    claimed: 0,
    processed: 0,
    retried: 0,
    deadLettered: 0
  });
  assert.equal(repository.lastClaimRequest, null);
});

function createProcessor(
  repository: OutboxRepository,
  handlers: readonly OutboxEventHandler[],
  admitEventTypes?: (registeredEventTypes: readonly string[]) => Promise<readonly string[]>
): OutboxProcessor {
  return new OutboxProcessor({
    workerId: "worker-test-001",
    repository,
    handlers,
    logger: createJsonLogger({
      service: "worker-test",
      environment: "test",
      sink: () => undefined
    }),
    metrics: createConsoleMetricRecorder(() => undefined) as MetricRecorder,
    batchSize: 10,
    pollIntervalMs: 1,
    maxAttempts: 8,
    baseRetryDelayMs: 1000,
    maxRetryDelayMs: 60000,
    now: () => fixedNow,
    sleep: async () => undefined,
    ...(admitEventTypes ? { admitEventTypes } : {})
  });
}

function createEvent(overrides: Partial<OutboxEventRecord> = {}): OutboxEventRecord {
  return {
    eventId: "event-001",
    eventType: "test.event",
    schemaVersion: "1.0",
    tenantId: "tenant-001",
    clinicId: "clinic-001",
    aggregateType: "test",
    aggregateId: "aggregate-001",
    actor: {
      type: "system",
      id: "system"
    },
    correlationId: "corr-001",
    idempotencyKey: "idem-001",
    payload: {},
    occurredAt: "2026-07-06T08:59:00.000Z",
    status: "pending",
    attemptCount: 0,
    createdAt: "2026-07-06T08:59:00.000Z",
    updatedAt: "2026-07-06T08:59:00.000Z",
    ...overrides
  };
}

class MemoryOutboxRepository implements OutboxRepository {
  readonly events = new Map<string, OutboxEventRecord>();
  readonly attempts: OutboxAttemptRecord[] = [];
  readonly retries: OutboxRetrySchedule[] = [];
  readonly deadLetters: OutboxDeadLetterRequest[] = [];
  lastClaimRequest: OutboxClaimRequest | null = null;

  constructor(events: readonly OutboxEventRecord[]) {
    for (const event of events) this.events.set(event.eventId, event);
  }

  async claimDueEvents(request: OutboxClaimRequest): Promise<readonly OutboxEventRecord[]> {
    this.lastClaimRequest = request;
    const claimed = [...this.events.values()].filter(
      (event) => event.status === "pending" || event.status === "retry_scheduled"
    );
    for (const event of claimed) {
      this.events.set(event.eventId, { ...event, status: "processing" });
    }
    return claimed;
  }

  async recordAttemptStarted(
    event: OutboxEventRecord,
    workerId: string,
    startedAt: string
  ): Promise<OutboxAttemptRecord> {
    const attemptNumber = event.attemptCount + 1;
    const attempt: OutboxAttemptRecord = {
      attemptId: `attempt-${attemptNumber}`,
      eventId: event.eventId,
      attemptNumber,
      workerId,
      status: "started",
      startedAt
    };
    this.attempts.push(attempt);
    this.events.set(event.eventId, {
      ...event,
      status: "processing",
      attemptCount: attemptNumber
    });
    return attempt;
  }

  async markAttemptSucceeded(attemptId: string, finishedAt: string): Promise<void> {
    this.replaceAttempt(attemptId, { status: "succeeded", finishedAt });
  }

  async markProcessed(eventId: string, processedAt: string): Promise<void> {
    const event = this.events.get(eventId);
    assert.ok(event);
    this.events.set(eventId, {
      ...event,
      status: "processed",
      updatedAt: processedAt
    });
  }

  async scheduleRetry(
    event: OutboxEventRecord,
    attempt: OutboxAttemptRecord,
    retry: OutboxRetrySchedule
  ): Promise<void> {
    this.retries.push(retry);
    this.replaceAttempt(attempt.attemptId, {
      status: "retry_scheduled",
      errorCode: retry.failureCode,
      errorMessage: retry.failureMessage,
      nextAttemptAt: retry.nextAttemptAt
    });
    this.events.set(event.eventId, {
      ...event,
      status: "retry_scheduled",
      nextAttemptAt: retry.nextAttemptAt,
      attemptCount: attempt.attemptNumber
    });
  }

  async moveToDeadLetter(
    event: OutboxEventRecord,
    attempt: OutboxAttemptRecord,
    deadLetter: OutboxDeadLetterRequest
  ): Promise<void> {
    this.deadLetters.push(deadLetter);
    this.replaceAttempt(attempt.attemptId, {
      status: deadLetter.attemptStatus,
      errorCode: deadLetter.failureCode,
      errorMessage: deadLetter.failureMessage,
      finishedAt: deadLetter.failedAt
    });
    this.events.set(event.eventId, {
      ...event,
      status: "dead_lettered",
      attemptCount: attempt.attemptNumber
    });
  }

  async getBacklogStats(): Promise<OutboxBacklogStats> {
    const events = [...this.events.values()];
    return {
      pending: events.filter((event) => event.status === "pending").length,
      processing: events.filter((event) => event.status === "processing").length,
      retryScheduled: events.filter((event) => event.status === "retry_scheduled").length,
      deadLettered: events.filter((event) => event.status === "dead_lettered").length,
      dueNow: events.filter(
        (event) => event.status === "pending" || event.status === "retry_scheduled"
      ).length
    };
  }

  async healthCheck(): Promise<void> {
    return undefined;
  }

  private replaceAttempt(attemptId: string, patch: Partial<OutboxAttemptRecord>): void {
    const index = this.attempts.findIndex((attempt) => attempt.attemptId === attemptId);
    assert.notEqual(index, -1);
    this.attempts[index] = {
      ...this.attempts[index],
      ...patch
    } as OutboxAttemptRecord;
  }
}
