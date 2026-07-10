import { createHmac } from "node:crypto";
import { createClient } from "redis";

const REDIS_PREFIX_PATTERN = /^[a-z][a-z0-9:-]{2,63}$/;

/**
 * The bounded subset of the official `redis` client used by CP14 security adapters.
 * Keeping the port structural permits deterministic doubles without introducing another client.
 */
export interface RedisScriptClient {
  readonly isOpen: boolean;
  readonly isReady: boolean;
  connect(): Promise<unknown>;
  ping(): Promise<string>;
  eval(
    script: string,
    options: { keys: readonly string[]; arguments: readonly string[] }
  ): Promise<unknown>;
  sendCommand(args: readonly string[]): Promise<unknown>;
  quit(): Promise<unknown>;
  on(event: "error", listener: (error: unknown) => void): unknown;
}

export interface RedisRuntimeClientOptions {
  redisUrl?: string;
  client?: RedisScriptClient;
  commandsQueueMaxLength?: number;
  connectTimeoutMs?: number;
  onConnectionError?: (code: string) => void;
}

export class RedisRuntimeDependency {
  readonly client: RedisScriptClient;
  #connecting: Promise<void> | null = null;
  #nonClusterTopologyVerified = false;

  constructor(options: RedisRuntimeClientOptions) {
    if (!options.client && !options.redisUrl) {
      throw new Error("A required Redis dependency URL is missing.");
    }
    const commandsQueueMaxLength = options.commandsQueueMaxLength ?? 128;
    if (
      !Number.isSafeInteger(commandsQueueMaxLength) ||
      commandsQueueMaxLength < 1 ||
      commandsQueueMaxLength > 1_024
    ) {
      throw new Error("Redis command queue capacity is outside policy.");
    }
    const connectTimeoutMs = options.connectTimeoutMs ?? 3_000;
    if (
      !Number.isSafeInteger(connectTimeoutMs) ||
      connectTimeoutMs < 100 ||
      connectTimeoutMs > 10_000
    ) {
      throw new Error("Redis connection timeout is outside policy.");
    }
    this.client =
      options.client ??
      (createClient({
        url: options.redisUrl,
        commandsQueueMaxLength,
        disableOfflineQueue: true,
        socket: {
          connectTimeout: connectTimeoutMs,
          reconnectStrategy: false
        }
      }) as unknown as RedisScriptClient);
    const onConnectionError = options.onConnectionError ?? (() => undefined);
    this.client.on("error", (error) => onConnectionError(safeRedisErrorCode(error)));
  }

  async ensureReady(): Promise<void> {
    if (!this.client.isReady) {
      if (this.client.isOpen) {
        throw new Error("A required Redis dependency is reconnecting.");
      }
      if (!this.#connecting) {
        this.#connecting = this.client.connect().then(() => undefined);
      }
      try {
        await this.#connecting;
      } finally {
        this.#connecting = null;
      }
    }
    if (!this.client.isReady) {
      throw new Error("A required Redis dependency did not become ready.");
    }
  }

  async ping(): Promise<void> {
    await this.ensureReady();
    if ((await this.client.ping()) !== "PONG") {
      throw new Error("A required Redis dependency did not pass its bounded probe.");
    }
  }

  /**
   * CP14 deliberately targets a writable Redis primary with replicas/failover, not Redis Cluster.
   * The single-command session/audit representation is one authority hash; silently pinning that
   * hash to one Cluster slot would create a hot shard while overstating horizontal scalability.
   */
  async ensureNonClusterPrimaryTopology(): Promise<void> {
    if (this.#nonClusterTopologyVerified) return;
    await this.ensureReady();
    const reply = await this.client.sendCommand(["INFO", "cluster"]);
    const text = Buffer.isBuffer(reply) ? reply.toString("utf8") : reply;
    if (
      typeof text !== "string" ||
      Buffer.byteLength(text) > 16_384 ||
      !/(?:^|\r?\n)cluster_enabled:0(?:\r?\n|$)/.test(text)
    ) {
      throw new Error("The Redis security-state topology is not an accepted non-cluster primary.");
    }
    this.#nonClusterTopologyVerified = true;
  }

  async evaluate(
    script: string,
    keys: readonly string[],
    args: readonly string[]
  ): Promise<unknown> {
    await this.ensureNonClusterPrimaryTopology();
    return this.client.eval(script, { keys, arguments: args });
  }

  async close(): Promise<void> {
    if (this.client.isOpen) await this.client.quit();
  }
}

export class OpaqueRedisKeyspace {
  readonly prefix: string;
  readonly #key: Buffer;

  constructor(input: { prefix: string; hmacKey: Uint8Array }) {
    if (!REDIS_PREFIX_PATTERN.test(input.prefix)) {
      throw new Error("Redis key prefix is malformed.");
    }
    this.#key = Buffer.from(input.hmacKey);
    if (this.#key.byteLength < 32) {
      throw new Error("Redis key HMAC material must contain at least 32 bytes.");
    }
    this.prefix = input.prefix;
  }

  key(kind: string, opaqueIdentifier: string): string {
    if (!/^[a-z][a-z0-9-]{1,31}$/.test(kind)) {
      throw new Error("Redis key kind is malformed.");
    }
    return `${this.prefix}:${kind}:${this.digest(`${kind}\u0000${opaqueIdentifier}`)}`;
  }

  singleton(kind: string): string {
    return this.key(kind, "singleton");
  }

  private digest(value: string): string {
    return createHmac("sha256", this.#key).update(value).digest("hex");
  }
}

function safeRedisErrorCode(error: unknown): string {
  if (!error || typeof error !== "object" || !("code" in error)) return "unknown";
  const value = (error as { code?: unknown }).code;
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "unknown";
}
