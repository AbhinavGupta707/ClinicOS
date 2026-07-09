import { randomUUID } from "node:crypto";
import { Pool, type Pool as PgPool } from "pg";
import type {
  OutboxAttemptRecord,
  OutboxActor,
  OutboxBacklogStats,
  OutboxClaimRequest,
  OutboxDeadLetterRequest,
  OutboxEventEnvelope,
  OutboxEventRecord,
  OutboxRepository,
  OutboxRetrySchedule,
  OutboxSource
} from "../outbox/types.js";

type PoolLike = Pick<PgPool, "connect" | "query" | "end">;

export interface PostgresOutboxRepositoryOptions {
  readonly connectionString?: string;
  readonly pool?: PoolLike;
}

export class PostgresOutboxRepository implements OutboxRepository {
  readonly #pool: PoolLike;
  readonly #ownsPool: boolean;

  constructor(options: PostgresOutboxRepositoryOptions) {
    if (options.pool) {
      this.#pool = options.pool;
      this.#ownsPool = false;
    } else if (options.connectionString) {
      this.#pool = new Pool({ connectionString: options.connectionString });
      this.#ownsPool = true;
    } else {
      throw new Error("PostgresOutboxRepository requires connectionString or pool");
    }
  }

  async close(): Promise<void> {
    if (this.#ownsPool) await this.#pool.end();
  }

  async claimDueEvents(request: OutboxClaimRequest): Promise<readonly OutboxEventRecord[]> {
    const eventTypeFilter =
      request.eventTypes && request.eventTypes.length > 0 ? "AND event_type = ANY($5::text[])" : "";
    const values =
      request.eventTypes && request.eventTypes.length > 0
        ? [request.workerId, request.leaseUntil, request.batchSize, request.now, request.eventTypes]
        : [request.workerId, request.leaseUntil, request.batchSize, request.now];

    const sql = `
      WITH due AS (
        SELECT id
        FROM outbox_events
        WHERE status IN ('pending', 'retry_scheduled')
          AND (next_attempt_at IS NULL OR next_attempt_at <= $4::timestamptz)
          ${eventTypeFilter}
        ORDER BY next_attempt_at NULLS FIRST, occurred_at
        LIMIT $3
        FOR UPDATE SKIP LOCKED
      )
      UPDATE outbox_events event
      SET status = 'processing',
          locked_by = $1,
          locked_until = $2::timestamptz,
          updated_at = now()
      FROM due
      WHERE event.id = due.id
      RETURNING event.*
    `;

    const result = await this.#pool.query(sql, values);
    return result.rows.map(mapOutboxEventRow);
  }

  async recordAttemptStarted(
    event: OutboxEventRecord,
    workerId: string,
    startedAt: string
  ): Promise<OutboxAttemptRecord> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const eventResult = await client.query(
        `
          UPDATE outbox_events
          SET attempt_count = attempt_count + 1,
              updated_at = now()
          WHERE id = $1
          RETURNING attempt_count
        `,
        [event.eventId]
      );

      const attemptNumber = Number(eventResult.rows[0]?.attempt_count ?? event.attemptCount + 1);
      const attemptId = randomUUID();
      const attemptResult = await client.query(
        `
          INSERT INTO outbox_attempts (
            attempt_id,
            event_id,
            tenant_id,
            clinic_id,
            attempt_number,
            worker_id,
            status,
            started_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'started', $7::timestamptz)
          RETURNING *
        `,
        [
          attemptId,
          event.eventId,
          event.tenantId,
          event.clinicId,
          attemptNumber,
          workerId,
          startedAt
        ]
      );
      await client.query("COMMIT");
      return mapOutboxAttemptRow(attemptResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async markAttemptSucceeded(attemptId: string, finishedAt: string): Promise<void> {
    await this.#pool.query(
      `
        UPDATE outbox_attempts
        SET status = 'succeeded',
            finished_at = $2::timestamptz
        WHERE attempt_id = $1
      `,
      [attemptId, finishedAt]
    );
  }

  async markProcessed(eventId: string, processedAt: string): Promise<void> {
    await this.#pool.query(
      `
        UPDATE outbox_events
        SET status = 'processed',
            processed_at = $2::timestamptz,
            published_at = $2::timestamptz,
            locked_by = NULL,
            locked_until = NULL,
            updated_at = now()
        WHERE id = $1
      `,
      [eventId, processedAt]
    );
  }

  async scheduleRetry(
    event: OutboxEventRecord,
    attempt: OutboxAttemptRecord,
    retry: OutboxRetrySchedule
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          UPDATE outbox_attempts
          SET status = 'retry_scheduled',
              finished_at = now(),
              error_code = $2,
              error_message = $3,
              next_attempt_at = $4::timestamptz
          WHERE attempt_id = $1
        `,
        [attempt.attemptId, retry.failureCode, retry.failureMessage, retry.nextAttemptAt]
      );
      await client.query(
        `
          UPDATE outbox_events
          SET status = 'retry_scheduled',
              next_attempt_at = $2::timestamptz,
              locked_by = NULL,
              locked_until = NULL,
              updated_at = now()
          WHERE id = $1
        `,
        [event.eventId, retry.nextAttemptAt]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async moveToDeadLetter(
    event: OutboxEventRecord,
    attempt: OutboxAttemptRecord,
    deadLetter: OutboxDeadLetterRequest
  ): Promise<void> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `
          UPDATE outbox_attempts
          SET status = $2,
              finished_at = $3::timestamptz,
              error_code = $4,
              error_message = $5
          WHERE attempt_id = $1
        `,
        [
          attempt.attemptId,
          deadLetter.attemptStatus,
          deadLetter.failedAt,
          deadLetter.failureCode,
          deadLetter.failureMessage
        ]
      );
      await client.query(
        `
          INSERT INTO dead_letter_events (
            dead_letter_id,
            event_id,
            event_type,
            tenant_id,
            clinic_id,
            aggregate_type,
            aggregate_id,
            correlation_id,
            idempotency_key,
            failed_attempt_id,
            failed_at,
            failure_code,
            failure_message,
            review_status,
            event
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9,
            $10, $11::timestamptz, $12, $13, 'unreviewed', $14::jsonb
          )
          ON CONFLICT (event_id) DO UPDATE
          SET failed_attempt_id = EXCLUDED.failed_attempt_id,
              failed_at = EXCLUDED.failed_at,
              failure_code = EXCLUDED.failure_code,
              failure_message = EXCLUDED.failure_message,
              event = EXCLUDED.event
        `,
        [
          randomUUID(),
          event.eventId,
          event.eventType,
          event.tenantId,
          event.clinicId,
          event.aggregateType,
          event.aggregateId,
          event.correlationId,
          event.idempotencyKey,
          attempt.attemptId,
          deadLetter.failedAt,
          deadLetter.failureCode,
          deadLetter.failureMessage,
          JSON.stringify(toOutboxEventEnvelope(event))
        ]
      );
      await client.query(
        `
          UPDATE outbox_events
          SET status = 'dead_lettered',
              locked_by = NULL,
              locked_until = NULL,
              updated_at = now()
          WHERE id = $1
        `,
        [event.eventId]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async getBacklogStats(now: string): Promise<OutboxBacklogStats> {
    const result = await this.#pool.query(
      `
        SELECT
          count(*) FILTER (WHERE status = 'pending')::int AS pending,
          count(*) FILTER (WHERE status = 'processing')::int AS processing,
          count(*) FILTER (WHERE status = 'retry_scheduled')::int AS retry_scheduled,
          count(*) FILTER (WHERE status = 'dead_lettered')::int AS dead_lettered,
          min(occurred_at) FILTER (WHERE status IN ('pending', 'retry_scheduled')) AS oldest_pending_occurred_at,
          count(*) FILTER (
            WHERE status IN ('pending', 'retry_scheduled')
              AND (next_attempt_at IS NULL OR next_attempt_at <= $1::timestamptz)
          )::int AS due_now
        FROM outbox_events
      `,
      [now]
    );

    const row = result.rows[0] ?? {};
    return {
      pending: Number(row.pending ?? 0),
      processing: Number(row.processing ?? 0),
      retryScheduled: Number(row.retry_scheduled ?? 0),
      deadLettered: Number(row.dead_lettered ?? 0),
      ...(row.oldest_pending_occurred_at
        ? { oldestPendingOccurredAt: toIsoString(row.oldest_pending_occurred_at) }
        : {}),
      dueNow: Number(row.due_now ?? 0)
    };
  }

  async healthCheck(): Promise<void> {
    await this.#pool.query("SELECT 1");
  }
}

function mapOutboxEventRow(row: Record<string, unknown>): OutboxEventRecord {
  return {
    eventId: String(row.id),
    eventType: String(row.event_type),
    schemaVersion: String(row.schema_version),
    tenantId: String(row.tenant_id),
    clinicId: String(row.clinic_id),
    aggregateType: String(row.aggregate_type),
    aggregateId: String(row.aggregate_id),
    actor: mapOutboxActor(row),
    correlationId: String(row.correlation_id),
    idempotencyKey: String(row.idempotency_key),
    ...(row.source ? { source: mapOutboxSource(row.source) } : {}),
    payload: mapJsonObject(row.payload),
    occurredAt: toIsoString(row.occurred_at),
    status: String(row.status) as OutboxEventRecord["status"],
    attemptCount: Number(row.attempt_count ?? 0),
    ...(row.next_attempt_at ? { nextAttemptAt: toIsoString(row.next_attempt_at) } : {}),
    ...(row.locked_by ? { lockedBy: String(row.locked_by) } : {}),
    ...(row.locked_until ? { lockedUntil: toIsoString(row.locked_until) } : {}),
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}

function mapOutboxAttemptRow(row: Record<string, unknown>): OutboxAttemptRecord {
  return {
    attemptId: String(row.attempt_id),
    eventId: String(row.event_id),
    attemptNumber: Number(row.attempt_number),
    workerId: String(row.worker_id),
    status: String(row.status) as OutboxAttemptRecord["status"],
    startedAt: toIsoString(row.started_at),
    ...(row.finished_at ? { finishedAt: toIsoString(row.finished_at) } : {}),
    ...(row.error_code ? { errorCode: String(row.error_code) } : {}),
    ...(row.error_message ? { errorMessage: String(row.error_message) } : {}),
    ...(row.next_attempt_at ? { nextAttemptAt: toIsoString(row.next_attempt_at) } : {})
  };
}

function toOutboxEventEnvelope(event: OutboxEventRecord): OutboxEventEnvelope {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    schemaVersion: event.schemaVersion,
    tenantId: event.tenantId,
    clinicId: event.clinicId,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    actor: event.actor,
    correlationId: event.correlationId,
    idempotencyKey: event.idempotencyKey,
    ...(event.source ? { source: event.source } : {}),
    payload: event.payload,
    occurredAt: event.occurredAt
  };
}

function mapJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function mapOutboxActor(value: Record<string, unknown>): OutboxActor {
  if (typeof value.actor_type !== "string" || typeof value.actor_id !== "string") {
    throw new Error("outbox_events actor_type and actor_id must be strings");
  }
  return {
    type: value.actor_type as OutboxActor["type"],
    id: value.actor_id
  };
}

function mapOutboxSource(value: unknown): OutboxSource {
  const source = mapJsonObject(value);
  if (typeof source.kind !== "string") {
    throw new Error("outbox_events.source must include string kind when present");
  }
  return {
    kind: source.kind as OutboxSource["kind"],
    ...(typeof source.providerKey === "string" ? { providerKey: source.providerKey } : {}),
    ...(typeof source.externalRef === "string" ? { externalRef: source.externalRef } : {}),
    ...(typeof source.rawEventId === "string" ? { rawEventId: source.rawEventId } : {})
  };
}

function toIsoString(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
