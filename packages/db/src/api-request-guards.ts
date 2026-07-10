import { Buffer } from "node:buffer";
import type { UUID } from "@clinic-os/domain";
import type { RepositoryPortTransactionLease } from "./modules/core/scoped-repository-port.ts";
import type { SqlQueryClient, SqlQueryResult } from "./postgres.ts";
import type { RepositoryScope } from "./repositories.ts";
import { buildSetLocalRlsStatements } from "./rls.ts";

const REQUEST_DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const OPERATION_ID_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/u;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})$/u;
const MAX_REPLAY_HEADERS_BYTES = 16_384;
const MAX_REPLAY_BODY_BYTES = 2_097_152;

/** Prevents a caller from persisting an effectively permanent processing lock. */
export const API_IDEMPOTENCY_MAX_LEASE_MILLISECONDS = 5 * 60 * 1_000;
/** Bounds how long a completed response, which may contain PHI, can remain replayable. */
export const API_IDEMPOTENCY_MAX_REPLAY_RETENTION_MILLISECONDS = 24 * 60 * 60 * 1_000;
/** Matches the runtime-contract JSON guard and prevents pre-serialization stack exhaustion. */
export const API_IDEMPOTENCY_MAX_REPLAY_JSON_DEPTH = 12;

export const API_REPLAY_RESPONSE_HEADER_ALLOWLIST = Object.freeze([
  "cache-control",
  "content-language",
  "content-type",
  "etag",
  "location"
] as const);

type ApiReplayResponseHeaderName = (typeof API_REPLAY_RESPONSE_HEADER_ALLOWLIST)[number];

export type ApiReplayJsonValue =
  | boolean
  | number
  | string
  | null
  | readonly ApiReplayJsonValue[]
  | { readonly [key: string]: ApiReplayJsonValue };

export interface ApiReplayResponse {
  readonly status: number;
  readonly headers: Readonly<Partial<Record<ApiReplayResponseHeaderName, string>>>;
  readonly body: ApiReplayJsonValue;
}

export interface ApiIdempotencyClaimInput {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly requestDigest: string;
  readonly now: string;
  readonly leaseOwner: string;
  readonly leaseExpiresAt: string;
}

export interface ApiIdempotencyClaim {
  readonly recordId: UUID;
  readonly requestDigest: string;
  readonly leaseOwner: string;
}

export type ApiIdempotencyClaimResult =
  | {
      readonly outcome: "claimed";
      readonly claim: ApiIdempotencyClaim;
      readonly reclaimed: boolean;
    }
  | { readonly outcome: "digest_conflict" }
  | { readonly outcome: "in_progress" }
  | { readonly outcome: "expired" }
  | {
      readonly outcome: "replay";
      readonly response: ApiReplayResponse;
      readonly completedAt: string;
      readonly expiresAt: string;
    };

export interface ApiIdempotencyCompleteInput {
  readonly claim: ApiIdempotencyClaim;
  readonly response: ApiReplayResponse;
  readonly completedAt: string;
  readonly expiresAt: string;
}

export type ApiIdempotencyCompleteResult =
  { readonly outcome: "completed" } | { readonly outcome: "not_owned" };

export const OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES = Object.freeze({
  updatePatient: "patients",
  updateLeadStatus: "leads",
  updateAppointment: "appointments",
  updateQueueEntry: "queue_entries",
  saveEncounterClinicalNoteDraft: "encounters",
  updateDentalFinding: "dental_findings",
  updateTreatmentPlan: "treatment_plans",
  updateTask: "tasks",
  updateSopRun: "sop_runs",
  updateLabCase: "lab_cases",
  updateInventoryCheckRun: "inventory_check_runs",
  updateCorrectiveAction: "corrective_actions"
} as const);

export type OptimisticConcurrencyOperationId = keyof typeof OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES;

export interface OptimisticConcurrencyResourceInput {
  readonly operationId: OptimisticConcurrencyOperationId;
  readonly resourceId: UUID;
}

export interface OptimisticConcurrencyAdvanceInput extends OptimisticConcurrencyResourceInput {
  readonly expectedVersion: number;
}

export type OptimisticConcurrencyReadResult =
  { readonly outcome: "found"; readonly rowVersion: number } | { readonly outcome: "not_found" };

export type OptimisticConcurrencyAdvanceResult =
  | { readonly outcome: "advanced"; readonly rowVersion: number }
  | { readonly outcome: "precondition_not_matched" };

export interface ScopedApiIdempotencyPort {
  claim(
    scope: Readonly<RepositoryScope>,
    input: ApiIdempotencyClaimInput
  ): Promise<ApiIdempotencyClaimResult>;
  complete(
    scope: Readonly<RepositoryScope>,
    input: ApiIdempotencyCompleteInput
  ): Promise<ApiIdempotencyCompleteResult>;
}

export interface ScopedOptimisticConcurrencyPort {
  readCurrentVersion(
    scope: Readonly<RepositoryScope>,
    input: OptimisticConcurrencyResourceInput
  ): Promise<OptimisticConcurrencyReadResult>;
  advanceVersion(
    scope: Readonly<RepositoryScope>,
    input: OptimisticConcurrencyAdvanceInput
  ): Promise<OptimisticConcurrencyAdvanceResult>;
}

export interface ScopedApiRequestGuardsPort {
  readonly idempotency: ScopedApiIdempotencyPort;
  readonly optimisticConcurrency: ScopedOptimisticConcurrencyPort;
}

export interface ApiIdempotencyPort {
  claim(input: ApiIdempotencyClaimInput): Promise<ApiIdempotencyClaimResult>;
  complete(input: ApiIdempotencyCompleteInput): Promise<ApiIdempotencyCompleteResult>;
}

export interface OptimisticConcurrencyPort {
  readCurrentVersion(
    input: OptimisticConcurrencyResourceInput
  ): Promise<OptimisticConcurrencyReadResult>;
  advanceVersion(
    input: OptimisticConcurrencyAdvanceInput
  ): Promise<OptimisticConcurrencyAdvanceResult>;
}

export interface ApiRequestGuardsPort {
  readonly idempotency: ApiIdempotencyPort;
  readonly optimisticConcurrency: OptimisticConcurrencyPort;
}

export interface TransactionBoundRequestGuardSqlClient extends SqlQueryClient {
  readonly inTransaction: true;
}

interface ApiIdempotencyRow {
  readonly id: UUID;
  readonly request_digest: string;
  readonly state: "completed" | "expired" | "processing";
  readonly lease_expires_at: Date | string | null;
  readonly response_status: number | null;
  readonly response_headers: unknown;
  readonly response_body: unknown;
  readonly completed_at: Date | string | null;
  readonly expires_at: Date | string | null;
}

interface RowVersionRow {
  readonly row_version: number | string;
}

class PostgresApiRequestGuardsAdapter {
  readonly #client: TransactionBoundRequestGuardSqlClient;

  constructor(client: TransactionBoundRequestGuardSqlClient) {
    if (client.inTransaction !== true) {
      throw new Error("API request guards require an active transaction-bound SQL client.");
    }
    this.#client = client;
  }

  async claimIdempotency(
    scope: Readonly<RepositoryScope>,
    input: ApiIdempotencyClaimInput
  ): Promise<ApiIdempotencyClaimResult> {
    assertRepositoryScope(scope);
    assertIdempotencyClaimInput(input);

    const inserted = await queryWithRls<{ id: UUID }>(
      this.#client,
      scope,
      `
        insert into api_idempotency_records (
          tenant_id,
          clinic_id,
          actor_user_id,
          operation_id,
          idempotency_key,
          request_digest,
          state,
          lease_owner,
          lease_expires_at,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, 'processing', $7, $8, $9)
        on conflict (tenant_id, clinic_id, actor_user_id, operation_id, idempotency_key)
        do nothing
        returning id
      `,
      [
        scope.tenantId,
        scope.clinicId,
        scope.actorUserId,
        input.operationId,
        input.idempotencyKey,
        input.requestDigest,
        input.leaseOwner,
        input.leaseExpiresAt,
        input.now
      ]
    );
    if (inserted.rows[0]) {
      return claimedResult(inserted.rows[0].id, input, false);
    }

    const scrubbed = await queryWithRls<{ request_digest: string }>(
      this.#client,
      scope,
      `
        update api_idempotency_records
        set
          state = 'expired',
          lease_owner = null,
          lease_expires_at = null,
          response_status = null,
          response_headers = '{}'::jsonb,
          response_body = null,
          expired_at = $6
        where tenant_id = $1
          and clinic_id = $2
          and actor_user_id = $3
          and operation_id = $4
          and idempotency_key = $5
          and state = 'completed'
          and expires_at <= $6
        returning request_digest
      `,
      [
        scope.tenantId,
        scope.clinicId,
        scope.actorUserId,
        input.operationId,
        input.idempotencyKey,
        input.now
      ]
    );
    if (scrubbed.rows[0]) {
      return scrubbed.rows[0].request_digest === input.requestDigest
        ? { outcome: "expired" }
        : { outcome: "digest_conflict" };
    }

    const reclaimed = await queryWithRls<{ id: UUID }>(
      this.#client,
      scope,
      `
        update api_idempotency_records
        set lease_owner = $7, lease_expires_at = $8
        where tenant_id = $1
          and clinic_id = $2
          and actor_user_id = $3
          and operation_id = $4
          and idempotency_key = $5
          and request_digest = $6
          and state = 'processing'
          and lease_expires_at <= $9
        returning id
      `,
      [
        scope.tenantId,
        scope.clinicId,
        scope.actorUserId,
        input.operationId,
        input.idempotencyKey,
        input.requestDigest,
        input.leaseOwner,
        input.leaseExpiresAt,
        input.now
      ]
    );
    if (reclaimed.rows[0]) {
      return claimedResult(reclaimed.rows[0].id, input, true);
    }

    const current = await queryWithRls<ApiIdempotencyRow>(
      this.#client,
      scope,
      `
        select
          id,
          request_digest,
          state,
          lease_expires_at,
          response_status,
          response_headers,
          response_body,
          completed_at,
          expires_at
        from api_idempotency_records
        where tenant_id = $1
          and clinic_id = $2
          and actor_user_id = $3
          and operation_id = $4
          and idempotency_key = $5
      `,
      [scope.tenantId, scope.clinicId, scope.actorUserId, input.operationId, input.idempotencyKey]
    );
    const record = current.rows[0];
    if (!record) {
      throw new Error("Idempotency record could not be resolved in the active request scope.");
    }
    if (record.request_digest !== input.requestDigest) {
      return { outcome: "digest_conflict" };
    }
    if (record.state === "expired") {
      return { outcome: "expired" };
    }
    if (record.state === "processing") {
      return { outcome: "in_progress" };
    }

    if (!record.expires_at || instantMillis(record.expires_at) <= instantMillis(input.now)) {
      await this.#scrubCompletedRecordById(scope, record.id, input.now);
      return { outcome: "expired" };
    }
    if (
      record.response_status === null ||
      record.completed_at === null ||
      record.expires_at === null
    ) {
      throw new Error("Completed idempotency record is missing replay fields.");
    }

    return {
      outcome: "replay",
      response: Object.freeze({
        status: assertReplayStatus(record.response_status),
        headers: replayHeadersFromDatabase(record.response_headers),
        body: replayBodyFromDatabase(record.response_body)
      }),
      completedAt: databaseInstant(record.completed_at),
      expiresAt: databaseInstant(record.expires_at)
    };
  }

  async completeIdempotency(
    scope: Readonly<RepositoryScope>,
    input: ApiIdempotencyCompleteInput
  ): Promise<ApiIdempotencyCompleteResult> {
    assertRepositoryScope(scope);
    assertIdempotencyClaim(input.claim);
    const completedAt = assertIsoInstant("completedAt", input.completedAt);
    const expiresAt = assertIsoInstant("expiresAt", input.expiresAt);
    if (instantMillis(expiresAt) <= instantMillis(completedAt)) {
      throw new Error("Idempotency replay expiry must be after completion.");
    }
    if (
      instantMillis(expiresAt) - instantMillis(completedAt) >
      API_IDEMPOTENCY_MAX_REPLAY_RETENTION_MILLISECONDS
    ) {
      throw new Error("Idempotency replay retention exceeds the maximum duration.");
    }
    const response = serializeReplayResponse(input.response);

    const completed = await queryWithRls<{ id: UUID }>(
      this.#client,
      scope,
      `
        update api_idempotency_records
        set
          state = 'completed',
          lease_owner = null,
          lease_expires_at = null,
          response_status = $6,
          response_headers = $7::jsonb,
          response_body = $8::jsonb,
          completed_at = $9,
          expires_at = $10,
          expired_at = null
        where tenant_id = $1
          and clinic_id = $2
          and id = $3
          and state = 'processing'
          and lease_owner = $4
          and request_digest = $5
        returning id
      `,
      [
        scope.tenantId,
        scope.clinicId,
        input.claim.recordId,
        input.claim.leaseOwner,
        input.claim.requestDigest,
        response.status,
        response.headersJson,
        response.bodyJson,
        completedAt,
        expiresAt
      ]
    );

    return completed.rows[0] ? { outcome: "completed" } : { outcome: "not_owned" };
  }

  async readCurrentVersion(
    scope: Readonly<RepositoryScope>,
    input: OptimisticConcurrencyResourceInput
  ): Promise<OptimisticConcurrencyReadResult> {
    assertRepositoryScope(scope);
    const table = optimisticConcurrencyTable(input.operationId);
    assertUuid("resourceId", input.resourceId);
    const result = await queryWithRls<RowVersionRow>(
      this.#client,
      scope,
      `
        select row_version
        from ${table}
        where tenant_id = $1 and clinic_id = $2 and id = $3
      `,
      [scope.tenantId, scope.clinicId, input.resourceId]
    );
    return result.rows[0]
      ? { outcome: "found", rowVersion: positiveRowVersion(result.rows[0].row_version) }
      : { outcome: "not_found" };
  }

  async advanceVersion(
    scope: Readonly<RepositoryScope>,
    input: OptimisticConcurrencyAdvanceInput
  ): Promise<OptimisticConcurrencyAdvanceResult> {
    assertRepositoryScope(scope);
    const table = optimisticConcurrencyTable(input.operationId);
    assertUuid("resourceId", input.resourceId);
    const expectedVersion = positiveRowVersion(input.expectedVersion);
    const result = await queryWithRls<RowVersionRow>(
      this.#client,
      scope,
      `
        update ${table}
        set row_version = row_version + 1
        where tenant_id = $1
          and clinic_id = $2
          and id = $3
          and row_version = $4
        returning row_version
      `,
      [scope.tenantId, scope.clinicId, input.resourceId, expectedVersion]
    );
    return result.rows[0]
      ? { outcome: "advanced", rowVersion: positiveRowVersion(result.rows[0].row_version) }
      : { outcome: "precondition_not_matched" };
  }

  async #scrubCompletedRecordById(
    scope: Readonly<RepositoryScope>,
    recordId: UUID,
    now: string
  ): Promise<void> {
    await queryWithRls(
      this.#client,
      scope,
      `
        update api_idempotency_records
        set
          state = 'expired',
          lease_owner = null,
          lease_expires_at = null,
          response_status = null,
          response_headers = '{}'::jsonb,
          response_body = null,
          expired_at = $4
        where tenant_id = $1
          and clinic_id = $2
          and id = $3
          and state = 'completed'
          and expires_at <= $4
      `,
      [scope.tenantId, scope.clinicId, recordId, now]
    );
  }
}

/** @internal Constructed only by PostgresClinicUnitOfWork after BEGIN. */
export function createScopedPostgresApiRequestGuards(
  client: TransactionBoundRequestGuardSqlClient,
  lease: RepositoryPortTransactionLease
): ScopedApiRequestGuardsPort {
  const adapter = new PostgresApiRequestGuardsAdapter(client);
  return Object.freeze({
    idempotency: Object.freeze({
      claim: (scope: Readonly<RepositoryScope>, input: ApiIdempotencyClaimInput) =>
        lease.execute(() => adapter.claimIdempotency(scope, input)),
      complete: (scope: Readonly<RepositoryScope>, input: ApiIdempotencyCompleteInput) =>
        lease.execute(() => adapter.completeIdempotency(scope, input))
    }),
    optimisticConcurrency: Object.freeze({
      readCurrentVersion: (
        scope: Readonly<RepositoryScope>,
        input: OptimisticConcurrencyResourceInput
      ) => lease.execute(() => adapter.readCurrentVersion(scope, input)),
      advanceVersion: (
        scope: Readonly<RepositoryScope>,
        input: OptimisticConcurrencyAdvanceInput
      ) => lease.execute(() => adapter.advanceVersion(scope, input))
    })
  });
}

/** @internal Binds verified authority and the module transaction lease once per callback. */
export function bindApiRequestGuardsPort(
  guards: ScopedApiRequestGuardsPort,
  scope: Readonly<RepositoryScope>,
  lease: RepositoryPortTransactionLease
): ApiRequestGuardsPort {
  return Object.freeze({
    idempotency: Object.freeze({
      claim: (input: ApiIdempotencyClaimInput) =>
        lease.execute(() => guards.idempotency.claim(scope, input)),
      complete: (input: ApiIdempotencyCompleteInput) =>
        lease.execute(() => guards.idempotency.complete(scope, input))
    }),
    optimisticConcurrency: Object.freeze({
      readCurrentVersion: (input: OptimisticConcurrencyResourceInput) =>
        lease.execute(() => guards.optimisticConcurrency.readCurrentVersion(scope, input)),
      advanceVersion: (input: OptimisticConcurrencyAdvanceInput) =>
        lease.execute(() => guards.optimisticConcurrency.advanceVersion(scope, input))
    })
  });
}

async function queryWithRls<TResult = Record<string, unknown>>(
  client: TransactionBoundRequestGuardSqlClient,
  scope: Readonly<RepositoryScope>,
  sql: string,
  values: readonly unknown[]
): Promise<SqlQueryResult<TResult>> {
  for (const statement of buildSetLocalRlsStatements({
    tenantId: scope.tenantId,
    clinicId: scope.clinicId,
    userId: scope.actorUserId
  })) {
    await client.query(statement.sql, statement.values);
  }
  return client.query<TResult>(sql, values);
}

function claimedResult(
  recordId: UUID,
  input: ApiIdempotencyClaimInput,
  reclaimed: boolean
): ApiIdempotencyClaimResult {
  return {
    outcome: "claimed",
    claim: Object.freeze({
      recordId,
      requestDigest: input.requestDigest,
      leaseOwner: input.leaseOwner
    }),
    reclaimed
  };
}

function assertRepositoryScope(scope: Readonly<RepositoryScope>): void {
  assertUuid("tenantId", scope.tenantId);
  assertUuid("clinicId", scope.clinicId);
  assertUuid("actorUserId", scope.actorUserId);
}

function assertIdempotencyClaimInput(input: ApiIdempotencyClaimInput): void {
  if (
    input.operationId.length < 1 ||
    input.operationId.length > 160 ||
    !OPERATION_ID_PATTERN.test(input.operationId)
  ) {
    throw new Error("Idempotency operationId is invalid.");
  }
  if (input.idempotencyKey.length < 8 || input.idempotencyKey.length > 200) {
    throw new Error("Idempotency key length is invalid.");
  }
  if (!REQUEST_DIGEST_PATTERN.test(input.requestDigest)) {
    throw new Error("Idempotency request digest must be a lowercase SHA-256 hex digest.");
  }
  if (input.leaseOwner.length < 1 || input.leaseOwner.length > 200) {
    throw new Error("Idempotency lease owner length is invalid.");
  }
  const now = assertIsoInstant("now", input.now);
  const leaseExpiresAt = assertIsoInstant("leaseExpiresAt", input.leaseExpiresAt);
  const leaseDuration = instantMillis(leaseExpiresAt) - instantMillis(now);
  if (leaseDuration <= 0) {
    throw new Error("Idempotency processing lease must expire after claim time.");
  }
  if (leaseDuration > API_IDEMPOTENCY_MAX_LEASE_MILLISECONDS) {
    throw new Error("Idempotency processing lease exceeds the maximum duration.");
  }
}

function assertIdempotencyClaim(claim: ApiIdempotencyClaim): void {
  assertUuid("claim.recordId", claim.recordId);
  if (!REQUEST_DIGEST_PATTERN.test(claim.requestDigest)) {
    throw new Error("Idempotency claim digest is invalid.");
  }
  if (claim.leaseOwner.length < 1 || claim.leaseOwner.length > 200) {
    throw new Error("Idempotency claim lease owner is invalid.");
  }
}

function assertUuid(name: string, value: unknown): asserts value is UUID {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new Error(`${name} must be a valid UUID.`);
  }
}

function assertIsoInstant(name: string, value: unknown): string {
  if (typeof value !== "string" || !isRfc3339Instant(value)) {
    throw new Error(`${name} must be a valid ISO instant.`);
  }
  return value;
}

function isRfc3339Instant(value: string): boolean {
  const match = ISO_INSTANT_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isCalendarDate(year, month, day)) return false;
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (hour > 23 || minute > 59 || second > 59) return false;
  const offset = match[8];
  if (!offset) return false;
  if (offset !== "Z") {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return Number.isFinite(Date.parse(value));
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const daysInMonth = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= (daysInMonth[month - 1] ?? 0);
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function instantMillis(value: Date | string): number {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(result)) throw new Error("Database idempotency instant is invalid.");
  return result;
}

function databaseInstant(value: Date | string): string {
  const result = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(result.getTime())) {
    throw new Error("Database idempotency instant is invalid.");
  }
  return result.toISOString();
}

function optimisticConcurrencyTable(operationId: OptimisticConcurrencyOperationId): string {
  if (!Object.hasOwn(OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES, operationId)) {
    throw new Error("Optimistic concurrency operation is not allowlisted.");
  }
  const table = (OPTIMISTIC_CONCURRENCY_RESOURCE_TABLES as Readonly<Record<string, unknown>>)[
    operationId
  ];
  if (typeof table !== "string") {
    throw new Error("Optimistic concurrency operation is not allowlisted.");
  }
  return table;
}

function positiveRowVersion(value: number | string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("row_version must be a positive safe integer.");
  }
  return parsed;
}

function serializeReplayResponse(response: ApiReplayResponse): {
  readonly status: number;
  readonly headersJson: string;
  readonly bodyJson: string;
} {
  const status = assertReplayStatus(response.status);
  const headers = normalizeReplayHeaders(response.headers);
  const headersJson = JSON.stringify(headers);
  if (Buffer.byteLength(headersJson, "utf8") > MAX_REPLAY_HEADERS_BYTES) {
    throw new Error("Idempotency replay headers exceed the bounded storage limit.");
  }
  assertReplayJsonValue(response.body, new Set<object>());
  const bodyJson = JSON.stringify(response.body);
  if (bodyJson === undefined || Buffer.byteLength(bodyJson, "utf8") > MAX_REPLAY_BODY_BYTES) {
    throw new Error("Idempotency replay body exceeds the bounded JSON storage limit.");
  }
  return { status, headersJson, bodyJson };
}

function assertReplayStatus(status: number): number {
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new Error("Idempotency replay status must be an integer from 200 through 599.");
  }
  return status;
}

function normalizeReplayHeaders(
  headers: Readonly<Partial<Record<ApiReplayResponseHeaderName, string>>>
): Readonly<Partial<Record<ApiReplayResponseHeaderName, string>>> {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    throw new Error("Idempotency replay headers must be an object.");
  }
  const prototype = Object.getPrototypeOf(headers);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("Idempotency replay headers must use a plain JSON object.");
  }
  const allowed = new Set<string>(API_REPLAY_RESPONSE_HEADER_ALLOWLIST);
  const normalized: Partial<Record<ApiReplayResponseHeaderName, string>> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (!allowed.has(name)) {
      throw new Error(`Idempotency replay header ${rawName} is not allowlisted.`);
    }
    if (typeof rawValue !== "string" || /[\r\n]/u.test(rawValue)) {
      throw new Error(`Idempotency replay header ${rawName} has an invalid value.`);
    }
    normalized[name as ApiReplayResponseHeaderName] = rawValue;
  }
  return Object.freeze(normalized);
}

function replayHeadersFromDatabase(value: unknown): ApiReplayResponse["headers"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Stored idempotency replay headers are invalid.");
  }
  return normalizeReplayHeaders(value as Record<ApiReplayResponseHeaderName, string>);
}

function replayBodyFromDatabase(value: unknown): ApiReplayJsonValue {
  assertReplayJsonValue(value, new Set<object>());
  return JSON.parse(JSON.stringify(value)) as ApiReplayJsonValue;
}

function assertReplayJsonValue(
  value: unknown,
  ancestors: Set<object>,
  depth = 0
): asserts value is ApiReplayJsonValue {
  if (depth > API_IDEMPOTENCY_MAX_REPLAY_JSON_DEPTH) {
    throw new Error("Idempotency replay JSON exceeds the maximum nesting depth.");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new Error("Idempotency replay JSON contains a non-finite number.");
    return;
  }
  if (typeof value !== "object") {
    throw new Error("Idempotency replay body must contain JSON values only.");
  }
  if (ancestors.has(value)) throw new Error("Idempotency replay body must not be cyclic.");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) assertReplayJsonValue(item, ancestors, depth + 1);
      return;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error("Idempotency replay body must use plain JSON objects.");
    }
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isUnsafeJsonPropertyName(key)) {
        throw new Error("Idempotency replay JSON contains a prototype-mutating property name.");
      }
      assertReplayJsonValue(item, ancestors, depth + 1);
    }
  } finally {
    ancestors.delete(value);
  }
}

function isUnsafeJsonPropertyName(value: string): boolean {
  const normalized = value.replace(/[^a-z0-9]/giu, "").toLowerCase();
  return normalized === "proto" || normalized === "constructor" || normalized === "prototype";
}
