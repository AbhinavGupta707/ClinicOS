import { createHmac } from "node:crypto";
import { BoundaryError } from "./boundary-error.ts";

export interface BodyBudgetPolicy {
  maxBytes: number;
}

export interface QueryBudgetPolicy {
  maxParameters: number;
  maxTotalBytes: number;
  maxKeyBytes: number;
  maxValueBytes: number;
  maxValuesPerKey: number;
}

export interface PaginationBudgetPolicy {
  defaultLimit: number;
  maxLimit: number;
  maxCursorBytes: number;
}

export interface RateBudgetPolicy {
  limit: number;
  windowSeconds: number;
  scope: "ip" | "actor" | "tenant" | "tenant_actor";
}

export interface ExpensiveOperationBudgetPolicy {
  maxUnitsPerRequest: number;
  maxUnitsPerWindow: number;
  windowSeconds: number;
  scope: "actor" | "tenant" | "tenant_actor";
}

export interface AbuseBudgetPolicy {
  body: BodyBudgetPolicy | null;
  query: QueryBudgetPolicy;
  pagination: PaginationBudgetPolicy | null;
  rate: RateBudgetPolicy;
  expensiveOperation: ExpensiveOperationBudgetPolicy | null;
}

export interface BudgetConsumptionRequest {
  bucketKey: string;
  limit: number;
  windowSeconds: number;
  cost: number;
  now: Date;
}

export interface BudgetConsumptionResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export interface AtomicBudgetStore {
  consume(request: BudgetConsumptionRequest): Promise<BudgetConsumptionResult>;
}

export function assertContentLengthWithinBudget(
  contentLength: string | undefined,
  policy: BodyBudgetPolicy
): void {
  assertNonNegativeInteger(policy.maxBytes, "body.maxBytes");
  if (contentLength === undefined) return;
  if (!/^\d+$/.test(contentLength)) {
    throw new BoundaryError({
      code: "BAD_REQUEST",
      message: "Content-Length must be a non-negative integer."
    });
  }
  const parsed = Number(contentLength);
  if (!Number.isSafeInteger(parsed)) {
    throw new BoundaryError({
      code: "BAD_REQUEST",
      message: "Content-Length is outside the supported range."
    });
  }
  if (parsed > policy.maxBytes) throwPayloadTooLarge(policy.maxBytes);
}

export function createBodyBudgetCounter(policy: BodyBudgetPolicy): {
  readonly bytesRead: number;
  observe(chunk: string | ArrayBufferView): void;
} {
  assertNonNegativeInteger(policy.maxBytes, "body.maxBytes");
  let bytesRead = 0;

  return {
    get bytesRead() {
      return bytesRead;
    },
    observe(chunk) {
      bytesRead += typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
      if (bytesRead > policy.maxBytes) throwPayloadTooLarge(policy.maxBytes);
    }
  };
}

export function enforceQueryBudget(searchParams: URLSearchParams, policy: QueryBudgetPolicy): void {
  assertNonNegativeInteger(policy.maxParameters, "query.maxParameters");
  assertNonNegativeInteger(policy.maxTotalBytes, "query.maxTotalBytes");
  assertPositiveInteger(policy.maxKeyBytes, "query.maxKeyBytes");
  assertPositiveInteger(policy.maxValueBytes, "query.maxValueBytes");
  assertPositiveInteger(policy.maxValuesPerKey, "query.maxValuesPerKey");

  const entries = [...searchParams.entries()];
  if (entries.length > policy.maxParameters) {
    throwBadQueryBudget("parameter_count", policy.maxParameters);
  }

  const counts = new Map<string, number>();
  const totalBytes = Buffer.byteLength(searchParams.toString());
  for (const [key, value] of entries) {
    const keyBytes = Buffer.byteLength(key);
    const valueBytes = Buffer.byteLength(value);
    if (keyBytes > policy.maxKeyBytes) throwBadQueryBudget("key_bytes", policy.maxKeyBytes);
    if (valueBytes > policy.maxValueBytes) throwBadQueryBudget("value_bytes", policy.maxValueBytes);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count > policy.maxValuesPerKey) {
      throwBadQueryBudget("values_per_key", policy.maxValuesPerKey);
    }
  }
  if (totalBytes > policy.maxTotalBytes) {
    throwBadQueryBudget("total_bytes", policy.maxTotalBytes);
  }
}

export function parsePaginationBudget(
  input: { limit?: string | null; cursor?: string | null },
  policy: PaginationBudgetPolicy
): { limit: number; cursor: string | null } {
  assertPositiveInteger(policy.defaultLimit, "pagination.defaultLimit");
  assertPositiveInteger(policy.maxLimit, "pagination.maxLimit");
  assertPositiveInteger(policy.maxCursorBytes, "pagination.maxCursorBytes");
  if (policy.defaultLimit > policy.maxLimit) {
    throw new Error("Pagination defaultLimit cannot exceed maxLimit.");
  }

  const rawLimit = input.limit?.trim();
  let limit = policy.defaultLimit;
  if (rawLimit) {
    if (!/^\d+$/.test(rawLimit)) {
      throwValidation("Pagination limit must be a positive integer.", "limit");
    }
    limit = Number(rawLimit);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > policy.maxLimit) {
      throwValidation(`Pagination limit must be between 1 and ${policy.maxLimit}.`, "limit");
    }
  }

  const cursor = input.cursor?.trim() || null;
  if (cursor && Buffer.byteLength(cursor) > policy.maxCursorBytes) {
    throwValidation("Pagination cursor exceeds the configured byte limit.", "cursor");
  }
  return { limit, cursor };
}

export function deriveAbuseBudgetKey(input: {
  secret: string;
  routeId: string;
  scope: RateBudgetPolicy["scope"];
  identity: string;
}): string {
  if (Buffer.byteLength(input.secret) < 32) {
    throw new Error("Abuse-budget key secret must contain at least 32 bytes.");
  }
  if (!/^[a-z][a-z0-9_.-]{2,127}$/.test(input.routeId)) {
    throw new Error("Abuse-budget route id must be a stable non-PHI identifier.");
  }
  const identityBytes = Buffer.byteLength(input.identity);
  if (identityBytes < 1 || identityBytes > 512) {
    throw new Error("Abuse-budget identity must contain between 1 and 512 bytes.");
  }
  return createHmac("sha256", input.secret)
    .update(`${input.routeId}\u0000${input.scope}\u0000${input.identity}`)
    .digest("hex");
}

export async function enforceRateBudget(input: {
  store: AtomicBudgetStore;
  bucketKey: string;
  policy: RateBudgetPolicy;
  cost?: number;
  now: Date;
}): Promise<BudgetConsumptionResult> {
  assertPositiveInteger(input.policy.limit, "rate.limit");
  assertPositiveInteger(input.policy.windowSeconds, "rate.windowSeconds");
  const cost = input.cost ?? 1;
  assertPositiveInteger(cost, "rate.cost");
  const now = trustedInstant(input.now, "rate.now");
  const result = await input.store.consume({
    bucketKey: input.bucketKey,
    limit: input.policy.limit,
    windowSeconds: input.policy.windowSeconds,
    cost,
    now
  });
  validateConsumptionResult(result, now);
  if (!result.allowed) throwRateLimited(result.resetAt, now);
  return result;
}

export async function enforceExpensiveOperationBudget(input: {
  store: AtomicBudgetStore;
  bucketKey: string;
  requestedUnits: number;
  policy: ExpensiveOperationBudgetPolicy;
  now: Date;
}): Promise<BudgetConsumptionResult> {
  assertPositiveInteger(input.requestedUnits, "expensiveOperation.requestedUnits");
  assertPositiveInteger(input.policy.maxUnitsPerRequest, "expensiveOperation.maxUnitsPerRequest");
  assertPositiveInteger(input.policy.maxUnitsPerWindow, "expensiveOperation.maxUnitsPerWindow");
  assertPositiveInteger(input.policy.windowSeconds, "expensiveOperation.windowSeconds");
  if (input.requestedUnits > input.policy.maxUnitsPerRequest) {
    throwValidation("Requested operation cost exceeds the per-request ceiling.", "cost_units");
  }

  const now = trustedInstant(input.now, "expensiveOperation.now");
  const result = await input.store.consume({
    bucketKey: input.bucketKey,
    limit: input.policy.maxUnitsPerWindow,
    windowSeconds: input.policy.windowSeconds,
    cost: input.requestedUnits,
    now
  });
  validateConsumptionResult(result, now);
  if (!result.allowed) throwRateLimited(result.resetAt, now);
  return result;
}

function validateConsumptionResult(result: BudgetConsumptionResult, now: Date): void {
  if (
    !Number.isInteger(result.remaining) ||
    result.remaining < 0 ||
    Number.isNaN(result.resetAt.getTime()) ||
    result.resetAt.getTime() <= now.getTime()
  ) {
    throw new Error("Atomic budget store returned an invalid consumption result.");
  }
}

function throwPayloadTooLarge(maxBytes: number): never {
  throw new BoundaryError({
    code: "PAYLOAD_TOO_LARGE",
    message: "Request body exceeds the configured byte limit.",
    details: { max_bytes: maxBytes }
  });
}

function throwBadQueryBudget(kind: string, limit: number): never {
  throw new BoundaryError({
    code: "BAD_REQUEST",
    message: "Query string exceeds the configured request budget.",
    details: { budget: kind, limit }
  });
}

function throwValidation(message: string, field: string): never {
  throw new BoundaryError({
    code: "VALIDATION_ERROR",
    message,
    details: { field }
  });
}

function throwRateLimited(resetAt: Date, now: Date): never {
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));
  throw new BoundaryError({
    code: "RATE_LIMITED",
    message: "Request budget exhausted. Retry later.",
    retryAfterSeconds
  });
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
}

function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer.`);
  }
}

function trustedInstant(value: Date, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${field} must be a valid injected instant.`);
  }
  return new Date(value.getTime());
}
