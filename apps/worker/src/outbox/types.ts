export type OutboxActorType = "user" | "system" | "integration" | "ai" | "workflow";

export interface OutboxActor {
  readonly type: OutboxActorType;
  readonly id: string;
}

export interface OutboxSource {
  readonly kind: "clinic_os" | "external_system" | "manual_import" | "workflow";
  readonly providerKey?: string;
  readonly externalRef?: string;
  readonly rawEventId?: string;
}

export interface OutboxEventEnvelope<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly eventId: string;
  readonly eventType: string;
  readonly schemaVersion: string;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly actor: OutboxActor;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly source?: OutboxSource;
  readonly payload: TPayload;
  readonly occurredAt: string;
}

export type OutboxEventStatus =
  | "pending"
  | "processing"
  | "processed"
  | "retry_scheduled"
  | "dead_lettered"
  | "cancelled";

export interface OutboxEventRecord<TPayload extends Record<string, unknown> = Record<string, unknown>>
  extends OutboxEventEnvelope<TPayload> {
  readonly status: OutboxEventStatus;
  readonly attemptCount: number;
  readonly nextAttemptAt?: string;
  readonly lockedBy?: string;
  readonly lockedUntil?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type OutboxAttemptStatus =
  | "started"
  | "succeeded"
  | "retry_scheduled"
  | "failed_permanent"
  | "failed_exhausted";

export interface OutboxAttemptRecord {
  readonly attemptId: string;
  readonly eventId: string;
  readonly attemptNumber: number;
  readonly workerId: string;
  readonly status: OutboxAttemptStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly nextAttemptAt?: string;
}

export type DeadLetterReviewStatus = "unreviewed" | "reviewing" | "replayed" | "ignored";

export interface DeadLetterEventRecord {
  readonly deadLetterId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly correlationId: string;
  readonly idempotencyKey: string;
  readonly failedAttemptId: string;
  readonly failedAt: string;
  readonly failureCode: string;
  readonly failureMessage: string;
  readonly reviewStatus: DeadLetterReviewStatus;
  readonly event: OutboxEventEnvelope;
}

export interface OutboxBacklogStats {
  readonly pending: number;
  readonly processing: number;
  readonly retryScheduled: number;
  readonly deadLettered: number;
  readonly oldestPendingOccurredAt?: string;
  readonly dueNow: number;
}

export interface OutboxClaimRequest {
  readonly workerId: string;
  readonly batchSize: number;
  readonly leaseUntil: string;
  readonly now: string;
  readonly eventTypes?: readonly string[];
}

export interface OutboxRetrySchedule {
  readonly nextAttemptAt: string;
  readonly failureCode: string;
  readonly failureMessage: string;
}

export interface OutboxDeadLetterRequest {
  readonly failureCode: string;
  readonly failureMessage: string;
  readonly failedAt: string;
  readonly attemptStatus: "failed_permanent" | "failed_exhausted";
}

export interface OutboxRepository {
  claimDueEvents(request: OutboxClaimRequest): Promise<readonly OutboxEventRecord[]>;
  recordAttemptStarted(event: OutboxEventRecord, workerId: string, startedAt: string): Promise<OutboxAttemptRecord>;
  markAttemptSucceeded(attemptId: string, finishedAt: string): Promise<void>;
  markProcessed(eventId: string, processedAt: string): Promise<void>;
  scheduleRetry(event: OutboxEventRecord, attempt: OutboxAttemptRecord, retry: OutboxRetrySchedule): Promise<void>;
  moveToDeadLetter(
    event: OutboxEventRecord,
    attempt: OutboxAttemptRecord,
    deadLetter: OutboxDeadLetterRequest
  ): Promise<void>;
  getBacklogStats(now: string): Promise<OutboxBacklogStats>;
  healthCheck(): Promise<void>;
}

export interface OutboxHandlerContext {
  readonly workerId: string;
  readonly attempt: OutboxAttemptRecord;
  readonly correlationId: string;
  readonly tenantId: string;
  readonly clinicId: string;
  readonly idempotencyKey: string;
}

export interface OutboxEventHandler<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly eventType: string;
  handle(event: OutboxEventRecord<TPayload>, context: OutboxHandlerContext): Promise<void>;
}
