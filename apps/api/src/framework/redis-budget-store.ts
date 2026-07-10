import { BoundaryError, type AtomicBudgetStore, type BudgetConsumptionRequest } from "@clinic-os/security";
import { createClient } from "redis";

const CONSUME_BUDGET_SCRIPT = `
local current = redis.call('GET', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
local limit = tonumber(ARGV[1])
local cost = tonumber(ARGV[2])
local window = tonumber(ARGV[3])
if not current or ttl < 1 then
  if cost > limit then
    return {0, limit, window}
  end
  redis.call('SET', KEYS[1], cost, 'PX', window)
  return {1, limit - cost, window}
end
current = tonumber(current)
if current + cost > limit then
  return {0, math.max(0, limit - current), ttl}
end
local next = redis.call('INCRBY', KEYS[1], cost)
ttl = redis.call('PTTL', KEYS[1])
return {1, math.max(0, limit - next), ttl}
`;

interface RedisBudgetClient {
  readonly isOpen: boolean;
  connect(): Promise<unknown>;
  ping(): Promise<string>;
  eval(
    script: string,
    options: { keys: readonly string[]; arguments: readonly string[] }
  ): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: "error", listener: (error: unknown) => void): unknown;
}

export class RedisAtomicBudgetStore implements AtomicBudgetStore {
  readonly #client: RedisBudgetClient;
  readonly #prefix: string;
  #connecting: Promise<void> | null = null;

  constructor(input: { redisUrl: string; keyPrefix?: string; client?: RedisBudgetClient }) {
    if (!input.redisUrl && !input.client) throw new Error("Redis budget store requires a Redis URL.");
    this.#client =
      input.client ??
      (createClient({ url: input.redisUrl }) as unknown as RedisBudgetClient);
    this.#prefix = input.keyPrefix ?? "clinicos:abuse:v1";
    this.#client.on("error", (error) => {
      console.error(
        JSON.stringify({
          level: "error",
          event: "redis.abuse_budget.connection_error",
          code: safeErrorCode(error)
        })
      );
    });
  }

  async readiness(): Promise<void> {
    await this.#ensureConnected();
    if ((await this.#client.ping()) !== "PONG") {
      throw new Error("Redis abuse-budget dependency did not return PONG.");
    }
  }

  async consume(request: BudgetConsumptionRequest) {
    try {
      await this.#ensureConnected();
      const result = await this.#client.eval(CONSUME_BUDGET_SCRIPT, {
        keys: [`${this.#prefix}:${request.bucketKey}`],
        arguments: [
          String(request.limit),
          String(request.cost),
          String(request.windowSeconds * 1000)
        ]
      });
      if (!Array.isArray(result) || result.length !== 3) {
        throw new Error("Redis budget script returned an invalid result.");
      }
      const [allowedRaw, remainingRaw, ttlRaw] = result.map(Number);
      if (
        !Number.isInteger(allowedRaw) ||
        !Number.isInteger(remainingRaw) ||
        !Number.isInteger(ttlRaw) ||
        remainingRaw < 0 ||
        ttlRaw < 1
      ) {
        throw new Error("Redis budget script returned invalid numeric values.");
      }
      return {
        allowed: allowedRaw === 1,
        remaining: remainingRaw,
        resetAt: new Date(request.now.getTime() + ttlRaw)
      };
    } catch (error) {
      if (error instanceof BoundaryError) throw error;
      throw new BoundaryError({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "A required request-budget dependency is unavailable.",
        details: { dependency: "redis_abuse_budget" }
      });
    }
  }

  async close(): Promise<void> {
    if (this.#client.isOpen) await this.#client.quit();
  }

  async #ensureConnected(): Promise<void> {
    if (this.#client.isOpen) return;
    if (!this.#connecting) {
      this.#connecting = this.#client.connect().then(() => undefined);
    }
    try {
      await this.#connecting;
    } finally {
      this.#connecting = null;
    }
  }
}

function safeErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "unknown";
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_]{1,64}$/i.test(code) ? code : "unknown";
}
