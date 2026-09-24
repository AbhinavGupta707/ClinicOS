import { OpaqueRedisKeyspace, RedisRuntimeDependency } from "./redis-runtime.ts";
import type { StaffIdentityConfiguration } from "./staff-identity-configuration.ts";

/** Worker-owned expiring readiness lease, shared by the API and BFF admission gates. */
export class AuditDeliveryHealth {
  readonly #redis: RedisRuntimeDependency;
  readonly #key: string;
  constructor(configuration: StaffIdentityConfiguration) {
    this.#redis = new RedisRuntimeDependency({ redisUrl: configuration.redisUrl });
    this.#key = new OpaqueRedisKeyspace({
      prefix: configuration.namespace,
      hmacKey: configuration.storeKey
    }).singleton("audit-delivery-health");
  }
  async publish(healthy: boolean): Promise<void> {
    await this.#bounded(
      this.#redis.evaluate(
        "return redis.call('SET', KEYS[1], ARGV[1], 'PX', 10000)",
        [this.#key],
        [healthy ? "ready" : "unavailable"]
      )
    );
  }
  async readiness(): Promise<void> {
    const result = await this.#bounded(
      this.#redis.evaluate("return redis.call('GET', KEYS[1])", [this.#key], [])
    );
    if (result !== "ready") throw new Error("Required audit delivery is unavailable.");
  }
  async close() {
    await this.#bounded(this.#redis.close());
  }
  async #bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Required audit delivery is unavailable.")),
            3000
          );
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
}
