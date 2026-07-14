import { randomUUID } from "node:crypto";
import type { SqlQueryClient } from "@clinic-os/db";
import {
  FireworksUsageGuardError,
  type FireworksModelCatalog,
  type FireworksTask,
  type FireworksUsageActual,
  type FireworksUsageGuard,
  type FireworksUsageRequest,
  type FireworksUsageReservation,
  type FireworksUsageSettlement
} from "@clinic-os/integrations";
import {
  safePositiveInteger,
  sha256Digest,
  uuid,
  withAiScope,
  type Cp16AiScope,
  type Cp16AiUnitOfWork
} from "./postgres-ai-shared.ts";

const RESERVATION_LEASE_MILLISECONDS = 10 * 60_000;
const DEFAULT_MAXIMUM_CLINIC_CONCURRENCY = 8;
const MICRO_USD_PER_CENT = 10_000n;

interface UsageRow extends Record<string, unknown> {
  readonly id: string;
  readonly tenant_id: string;
  readonly clinic_id: string;
  readonly actor_user_id: string;
  readonly task: FireworksTask;
  readonly idempotency_digest: string;
  readonly correlation_digest: string;
  readonly request_digest: string;
  readonly model_id: string;
  readonly status: "reserved" | "settled" | "cancelled" | "uncertain";
  readonly estimated_input_tokens: number;
  readonly maximum_output_tokens: number;
  readonly estimated_audio_bytes: number;
  readonly estimated_audio_duration_ms: number;
  readonly maximum_attempts: number;
  readonly estimated_cost_microusd: string | number | bigint;
  readonly tenant_month_start: string | Date;
  readonly clinic_day_start: string | Date;
  readonly lease_expires_at: string | Date | null;
}

interface CounterRow extends Record<string, unknown> {
  readonly scope_kind: "tenant_month" | "clinic_day";
  readonly reserved_cost_microusd: string | number | bigint;
  readonly settled_cost_microusd: string | number | bigint;
  readonly uncertain_cost_microusd: string | number | bigint;
}

interface Price {
  readonly inputMicroUsdPerMillion: bigint;
  readonly outputMicroUsdPerMillion: bigint;
  readonly audioMicroUsdPerMinute: bigint;
}

const FIREWORKS_STANDARD_PRICES: Readonly<Record<FireworksTask, Price>> = Object.freeze({
  clinical_structured_draft: price(1_740_000, 3_480_000),
  clinical_safety_review: price(1_400_000, 4_400_000),
  bounded_extraction: price(140_000, 280_000),
  long_context_summary: price(950_000, 4_000_000),
  retrieval_embedding: price(100_000, 0),
  retrieval_rerank: price(200_000, 0),
  speech_quality: price(0, 0, 1_500),
  speech_low_latency: price(0, 0, 900)
});

/**
 * Atomic, forced-RLS Fireworks budget and concurrency guard. Prices are integer micro-USD and
 * deliberately reserve the configured task maximum for every possible attempt. Received transient
 * attempts are conservatively costed at that maximum because providers may omit usage on errors.
 */
export class PostgresFireworksUsageGuard implements FireworksUsageGuard {
  readonly #unitOfWork: Cp16AiUnitOfWork;
  readonly #catalog: FireworksModelCatalog;
  readonly #tenantMonthlyLimit: bigint;
  readonly #clinicDailyLimit: bigint;
  readonly #maximumClinicConcurrency: number;
  readonly #now: () => Date;

  constructor(input: {
    readonly unitOfWork: Cp16AiUnitOfWork;
    readonly catalog: FireworksModelCatalog;
    readonly monthlyBudgetCents: number;
    readonly perClinicDailyBudgetCents: number;
    readonly maximumClinicConcurrency?: number;
    readonly now: () => Date;
  }) {
    this.#unitOfWork = input.unitOfWork;
    this.#catalog = input.catalog;
    this.#tenantMonthlyLimit = cents(input.monthlyBudgetCents, "monthly budget");
    this.#clinicDailyLimit = cents(input.perClinicDailyBudgetCents, "daily budget");
    this.#maximumClinicConcurrency = safePositiveInteger(
      input.maximumClinicConcurrency ?? DEFAULT_MAXIMUM_CLINIC_CONCURRENCY,
      "clinic concurrency",
      64
    );
    this.#now = input.now;
  }

  async reserve(input: FireworksUsageRequest): Promise<FireworksUsageReservation> {
    validateUsageRequest(input);
    const configuration = this.#catalog[input.task];
    const now = validDate(this.#now());
    const tenantMonthStart = monthStart(now);
    const clinicDayStart = dayStart(now);
    const singleAttemptCost = requestMaximumCost(input, configuration);
    const estimatedCost = singleAttemptCost * BigInt(input.maximumAttempts);
    const scope = usageScope(input);
    const reservationId = await withAiScope(this.#unitOfWork, scope, async (client) => {
      await quarantineExpiredReservations(client, scope, now);
      const existing = await usageByDigest(client, input.idempotencyDigest);
      if (existing) {
        if (
          !matchesUsage(existing, input, configuration.modelId) ||
          existing.status !== "reserved"
        ) {
          throw new FireworksUsageGuardError("idempotency_conflict");
        }
        return existing.id;
      }

      const counters = await ensureAndLockCounters(client, scope, tenantMonthStart, clinicDayStart);
      const active = await client.query<{ readonly count: string | number }>(
        `select count(*)::text as count from cp16_ai_usage_reservations
          where tenant_id = $1 and clinic_id = $2 and status = 'reserved'
            and lease_expires_at > $3::timestamptz`,
        [scope.tenantId, scope.clinicId, now.toISOString()]
      );
      if (Number(active.rows[0]?.count ?? 0) >= this.#maximumClinicConcurrency) {
        throw new FireworksUsageGuardError("budget_exhausted");
      }
      assertWithinBudget(counters, estimatedCost, this.#tenantMonthlyLimit, this.#clinicDailyLimit);

      const id = randomUUID();
      const inserted = await client.query<{ readonly id: string }>(
        `insert into cp16_ai_usage_reservations (
           id, tenant_id, clinic_id, actor_user_id, provider_key, task,
           idempotency_digest, correlation_digest, request_digest, model_id, status,
           estimated_input_tokens, maximum_output_tokens, estimated_audio_bytes,
           estimated_audio_duration_ms, maximum_attempts, estimated_cost_microusd,
           tenant_month_start, clinic_day_start, reserved_at, lease_expires_at
         ) values (
           $1,$2,$3,$4,'fireworks',$5,$6,$7,$8,$9,'reserved',$10,$11,$12,$13,$14,$15,
           $16::date,$17::date,$18::timestamptz,$19::timestamptz
         ) returning id`,
        [
          id,
          input.tenantId,
          input.clinicId,
          input.actorUserId,
          input.task,
          input.idempotencyDigest,
          input.correlationDigest,
          input.requestDigest,
          configuration.modelId,
          input.estimatedInputTokens,
          input.maximumOutputTokens,
          input.audioBytes,
          input.audioDurationMs,
          input.maximumAttempts,
          estimatedCost.toString(),
          tenantMonthStart,
          clinicDayStart,
          now.toISOString(),
          new Date(now.getTime() + RESERVATION_LEASE_MILLISECONDS).toISOString()
        ]
      );
      if (inserted.rows.length !== 1) throw new Error("AI usage reservation was not persisted.");
      await moveCounterAmount(client, scope, tenantMonthStart, clinicDayStart, {
        reserved: estimatedCost
      });
      return id;
    });
    return new PostgresFireworksUsageReservation({
      unitOfWork: this.#unitOfWork,
      catalog: this.#catalog,
      scope,
      reservationId,
      now: this.#now
    });
  }
}

async function quarantineExpiredReservations(
  client: SqlQueryClient,
  scope: Cp16AiScope,
  now: Date
): Promise<void> {
  const expired = await client.query<UsageRow>(
    `select * from cp16_ai_usage_reservations
      where tenant_id = $1 and clinic_id = $2 and status = 'reserved'
        and lease_expires_at <= $3::timestamptz
      order by tenant_month_start, clinic_day_start, id
      limit 100
      for update`,
    [scope.tenantId, scope.clinicId, now.toISOString()]
  );
  for (const row of expired.rows) {
    const month = dateOnly(row.tenant_month_start);
    const day = dateOnly(row.clinic_day_start);
    const amount = bigint(row.estimated_cost_microusd, "expired reservation cost");
    await ensureAndLockCounters(client, scope, month, day);
    const updated = await client.query<{ readonly id: string }>(
      `update cp16_ai_usage_reservations
          set status = 'uncertain', settled_cost_microusd = estimated_cost_microusd,
              uncertain_reason = 'reservation_lease_expired', lease_expires_at = null,
              settled_at = $4::timestamptz
        where tenant_id = $1 and clinic_id = $2 and id = $3 and status = 'reserved'
        returning id`,
      [scope.tenantId, scope.clinicId, row.id, now.toISOString()]
    );
    if (updated.rows.length !== 1) throw new Error("Expired AI reservation was not quarantined.");
    await moveCounterAmount(client, scope, month, day, {
      reserved: -amount,
      uncertain: amount
    });
  }
}

class PostgresFireworksUsageReservation implements FireworksUsageReservation {
  readonly #unitOfWork: Cp16AiUnitOfWork;
  readonly #catalog: FireworksModelCatalog;
  readonly #scope: Cp16AiScope;
  readonly #reservationId: string;
  readonly #now: () => Date;

  constructor(input: {
    readonly unitOfWork: Cp16AiUnitOfWork;
    readonly catalog: FireworksModelCatalog;
    readonly scope: Cp16AiScope;
    readonly reservationId: string;
    readonly now: () => Date;
  }) {
    this.#unitOfWork = input.unitOfWork;
    this.#catalog = input.catalog;
    this.#scope = input.scope;
    this.#reservationId = input.reservationId;
    this.#now = input.now;
  }

  complete(actual: FireworksUsageSettlement): Promise<void> {
    validateSettlement(actual);
    return this.#transition("settled", actual);
  }

  cancel(): Promise<void> {
    return this.#transition("cancelled", null);
  }

  markUncertain(input: {
    readonly reason:
      | "transport_outcome_unknown"
      | "provider_response_usage_unknown"
      | "completion_outcome_unknown";
  }): Promise<void> {
    return this.#transition("uncertain", null, input.reason);
  }

  async #transition(
    target: "settled" | "cancelled" | "uncertain",
    actual: FireworksUsageSettlement | null,
    uncertainReason?: string
  ): Promise<void> {
    const now = validDate(this.#now()).toISOString();
    await withAiScope(this.#unitOfWork, this.#scope, async (client) => {
      const row = await usageById(client, this.#reservationId);
      if (!row) throw new Error("AI usage reservation is missing.");
      if (row.status === target || (target === "uncertain" && row.status === "settled")) return;
      if (row.status !== "reserved") throw new Error("AI usage reservation is already terminal.");
      const month = dateOnly(row.tenant_month_start);
      const day = dateOnly(row.clinic_day_start);
      const counters = await ensureAndLockCounters(client, this.#scope, month, day);
      const reserved = bigint(row.estimated_cost_microusd, "reserved cost");
      if (
        counters.some(
          (counter) => bigint(counter.reserved_cost_microusd, "reserved budget") < reserved
        )
      ) {
        throw new Error("AI usage reservation is not fully reflected in its budget counters.");
      }
      let settled: bigint | null = null;
      if (target === "settled") {
        const configuration = this.#catalog[row.task];
        settled = conservativeSettlementCost(row.task, configuration, actual!);
        if (settled > reserved) {
          throw new Error("AI usage settlement exceeded its conservative reservation.");
        }
      }
      const updated = await client.query<{ readonly id: string }>(
        `update cp16_ai_usage_reservations
            set status = $4,
                actual_input_tokens = $5, actual_output_tokens = $6,
                actual_audio_bytes = $7, actual_audio_duration_ms = $8,
                actual_attempt_count = $9, settled_cost_microusd = $10,
                uncertain_reason = $11, lease_expires_at = null,
                settled_at = $12::timestamptz
          where tenant_id = $1 and clinic_id = $2 and id = $3 and status = 'reserved'
          returning id`,
        [
          this.#scope.tenantId,
          this.#scope.clinicId,
          this.#reservationId,
          target,
          target === "settled" ? actual!.inputTokens : null,
          target === "settled" ? actual!.outputTokens : null,
          target === "settled" ? actual!.audioBytes : null,
          target === "settled" ? actual!.audioDurationMs : null,
          target === "settled" ? actual!.attemptCount : null,
          target === "settled"
            ? settled!.toString()
            : target === "uncertain"
              ? reserved.toString()
              : null,
          target === "uncertain" ? uncertainReason : null,
          now
        ]
      );
      if (updated.rows.length !== 1) throw new Error("AI usage transition was not committed.");
      await moveCounterAmount(client, this.#scope, month, day, {
        reserved: -reserved,
        ...(target === "settled" ? { settled: settled! } : {}),
        ...(target === "uncertain" ? { uncertain: reserved } : {})
      });
    });
  }
}

async function ensureAndLockCounters(
  client: SqlQueryClient,
  scope: Cp16AiScope,
  month: string,
  day: string
): Promise<readonly CounterRow[]> {
  await client.query(
    `insert into cp16_ai_budget_counters (tenant_id, scope_kind, scope_key, period_start)
     values ($1,'tenant_month',$1,$3::date), ($1,'clinic_day',$2,$4::date)
     on conflict do nothing`,
    [scope.tenantId, scope.clinicId, month, day]
  );
  const rows = await lockedCounters(client, scope, month, day);
  if (rows.length !== 2) throw new Error("AI budget counters are incomplete.");
  return rows;
}

function lockedCounters(
  client: SqlQueryClient,
  scope: Cp16AiScope,
  month: string,
  day: string
): Promise<readonly CounterRow[]> {
  return client
    .query<CounterRow>(
      `select scope_kind, reserved_cost_microusd, settled_cost_microusd,
              uncertain_cost_microusd
         from cp16_ai_budget_counters
        where tenant_id = $1
          and ((scope_kind = 'tenant_month' and scope_key = $1 and period_start = $3::date)
            or (scope_kind = 'clinic_day' and scope_key = $2 and period_start = $4::date))
        order by scope_kind
        for update`,
      [scope.tenantId, scope.clinicId, month, day]
    )
    .then((result) => result.rows);
}

async function moveCounterAmount(
  client: SqlQueryClient,
  scope: Cp16AiScope,
  month: string,
  day: string,
  amounts: { readonly reserved?: bigint; readonly settled?: bigint; readonly uncertain?: bigint }
): Promise<void> {
  const result = await client.query<{ readonly scope_kind: string }>(
    `update cp16_ai_budget_counters
        set reserved_cost_microusd = reserved_cost_microusd + $5::bigint,
            settled_cost_microusd = settled_cost_microusd + $6::bigint,
            uncertain_cost_microusd = uncertain_cost_microusd + $7::bigint
      where tenant_id = $1
        and ((scope_kind = 'tenant_month' and scope_key = $1 and period_start = $3::date)
          or (scope_kind = 'clinic_day' and scope_key = $2 and period_start = $4::date))
        and reserved_cost_microusd + $5::bigint >= 0
        and settled_cost_microusd + $6::bigint >= 0
        and uncertain_cost_microusd + $7::bigint >= 0
      returning scope_kind`,
    [
      scope.tenantId,
      scope.clinicId,
      month,
      day,
      (amounts.reserved ?? 0n).toString(),
      (amounts.settled ?? 0n).toString(),
      (amounts.uncertain ?? 0n).toString()
    ]
  );
  if (result.rows.length !== 2) throw new Error("AI budget counters were not updated atomically.");
}

function assertWithinBudget(
  counters: readonly CounterRow[],
  amount: bigint,
  monthlyLimit: bigint,
  dailyLimit: bigint
): void {
  for (const row of counters) {
    const used =
      bigint(row.reserved_cost_microusd, "reserved budget") +
      bigint(row.settled_cost_microusd, "settled budget") +
      bigint(row.uncertain_cost_microusd, "uncertain budget");
    const limit = row.scope_kind === "tenant_month" ? monthlyLimit : dailyLimit;
    if (limit <= 0n || used + amount > limit) {
      throw new FireworksUsageGuardError("budget_exhausted");
    }
  }
}

async function usageByDigest(client: SqlQueryClient, digest: string): Promise<UsageRow | null> {
  const result = await client.query<UsageRow>(
    `select * from cp16_ai_usage_reservations
      where tenant_id = clinic_os.current_tenant_id()
        and clinic_id = clinic_os.current_clinic_id()
        and idempotency_digest = $1
      for update`,
    [digest]
  );
  return result.rows[0] ?? null;
}

async function usageById(client: SqlQueryClient, id: string): Promise<UsageRow | null> {
  const result = await client.query<UsageRow>(
    `select * from cp16_ai_usage_reservations
      where tenant_id = clinic_os.current_tenant_id()
        and clinic_id = clinic_os.current_clinic_id() and id = $1
      for update`,
    [id]
  );
  return result.rows[0] ?? null;
}

function matchesUsage(row: UsageRow, input: FireworksUsageRequest, modelId: string): boolean {
  return (
    row.tenant_id === input.tenantId &&
    row.clinic_id === input.clinicId &&
    row.actor_user_id === input.actorUserId &&
    row.task === input.task &&
    row.idempotency_digest === input.idempotencyDigest &&
    row.correlation_digest === input.correlationDigest &&
    row.request_digest === input.requestDigest &&
    row.model_id === modelId &&
    Number(row.estimated_input_tokens) === input.estimatedInputTokens &&
    Number(row.maximum_output_tokens) === input.maximumOutputTokens &&
    Number(row.estimated_audio_bytes) === input.audioBytes &&
    Number(row.estimated_audio_duration_ms) === input.audioDurationMs &&
    Number(row.maximum_attempts) === input.maximumAttempts
  );
}

function requestMaximumCost(
  input: FireworksUsageRequest,
  configuration: FireworksModelCatalog[FireworksTask]
): bigint {
  const rate = FIREWORKS_STANDARD_PRICES[input.task];
  return input.task.startsWith("speech_")
    ? audioCost(input.audioDurationMs, rate.audioMicroUsdPerMinute)
    : tokenCost(configuration.maximumInputTokens, configuration.maximumOutputTokens, rate);
}

function conservativeSettlementCost(
  task: FireworksTask,
  configuration: FireworksModelCatalog[FireworksTask],
  actual: FireworksUsageSettlement
): bigint {
  const rate = FIREWORKS_STANDARD_PRICES[task];
  const priorAttempts = BigInt(actual.attemptCount - 1);
  const maximumPrior = task.startsWith("speech_")
    ? audioCost(actual.audioDurationMs, rate.audioMicroUsdPerMinute)
    : tokenCost(configuration.maximumInputTokens, configuration.maximumOutputTokens, rate);
  const final = task.startsWith("speech_")
    ? audioCost(actual.audioDurationMs, rate.audioMicroUsdPerMinute)
    : tokenCost(actual.inputTokens, actual.outputTokens, rate);
  return maximumPrior * priorAttempts + final;
}

function tokenCost(inputTokens: number, outputTokens: number, rate: Price): bigint {
  return (
    divideUp(BigInt(inputTokens) * rate.inputMicroUsdPerMillion, 1_000_000n) +
    divideUp(BigInt(outputTokens) * rate.outputMicroUsdPerMillion, 1_000_000n)
  );
}

function audioCost(durationMs: number, microUsdPerMinute: bigint): bigint {
  return divideUp(BigInt(durationMs) * microUsdPerMinute, 60_000n);
}

function price(input: number, output: number, audio = 0): Price {
  return {
    inputMicroUsdPerMillion: BigInt(input),
    outputMicroUsdPerMillion: BigInt(output),
    audioMicroUsdPerMinute: BigInt(audio)
  };
}

function divideUp(value: bigint, denominator: bigint): bigint {
  return (value + denominator - 1n) / denominator;
}

function validateUsageRequest(input: FireworksUsageRequest): void {
  if (!uuid(input.tenantId) || !uuid(input.clinicId) || !uuid(input.actorUserId)) {
    throw new FireworksUsageGuardError("idempotency_conflict");
  }
  if (
    !sha256Digest(input.tenantDigest) ||
    !sha256Digest(input.correlationDigest) ||
    !sha256Digest(input.requestDigest) ||
    !sha256Digest(input.idempotencyDigest)
  ) {
    throw new FireworksUsageGuardError("idempotency_conflict");
  }
  for (const [field, value, maximum] of [
    ["estimated input", input.estimatedInputTokens, 200_000],
    ["maximum output", input.maximumOutputTokens, 16_384],
    ["audio bytes", input.audioBytes, 100 * 1024 * 1024],
    ["audio duration", input.audioDurationMs, 4 * 60 * 60_000]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
      throw new Error(`AI ${field} usage is invalid.`);
    }
  }
  safePositiveInteger(input.maximumAttempts, "maximum attempts", 4);
}

function validateSettlement(actual: FireworksUsageSettlement): void {
  for (const value of [
    actual.inputTokens,
    actual.outputTokens,
    actual.audioBytes,
    actual.audioDurationMs
  ]) {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("AI usage settlement is invalid.");
  }
  safePositiveInteger(actual.attemptCount, "actual attempt count", 4);
}

function usageScope(input: FireworksUsageRequest): Cp16AiScope {
  return {
    tenantId: input.tenantId,
    clinicId: input.clinicId,
    actorUserId: input.actorUserId
  };
}

function cents(value: number, field: string): bigint {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`AI ${field} is invalid.`);
  return BigInt(value) * MICRO_USD_PER_CENT;
}

function bigint(value: string | number | bigint, field: string): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`AI ${field} is invalid.`);
  }
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("AI usage clock is invalid.");
  }
  return value;
}

function monthStart(value: Date): string {
  return `${value.toISOString().slice(0, 7)}-01`;
}

function dayStart(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function dateOnly(value: string | Date): string {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  // node-postgres materializes a PostgreSQL `date` at local midnight. UTC
  // serialization can shift it to the prior calendar day in positive-offset
  // timezones (for example Europe/London during BST), so preserve its local
  // calendar components exactly.
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate()
  ).padStart(2, "0")}`;
}
