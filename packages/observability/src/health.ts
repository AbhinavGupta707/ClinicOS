export type HealthStatus = "healthy" | "degraded" | "unhealthy";

export type HealthCheckName =
  | "outbox_repository"
  | "temporal_connection"
  | "registered_handlers"
  | "provider_health"
  | "worker_runtime";

export interface HealthCheckResult {
  readonly name: HealthCheckName | string;
  readonly status: HealthStatus;
  readonly observedAt: string;
  readonly message?: string;
  readonly details?: Record<string, unknown>;
}

export interface HealthProbe {
  readonly name: HealthCheckName | string;
  check(): Promise<HealthCheckResult>;
}

export interface HealthReport {
  readonly service: string;
  readonly status: HealthStatus;
  readonly checkedAt: string;
  readonly checks: readonly HealthCheckResult[];
}

export function createHealthCheckResult(
  name: HealthCheckName | string,
  status: HealthStatus,
  options: {
    readonly observedAt?: Date;
    readonly message?: string;
    readonly details?: Record<string, unknown>;
  } = {}
): HealthCheckResult {
  return {
    name,
    status,
    observedAt: (options.observedAt ?? new Date()).toISOString(),
    ...(options.message ? { message: safeHealthMessage(options.message) } : {}),
    ...(options.details ? { details: allowlistHealthDetails(options.details) } : {})
  };
}

function safeHealthMessage(message: string): string {
  return message === "health_check_failed" ? "health_check_failed" : "health_detail_available";
}

export function aggregateHealthStatus(results: readonly HealthCheckResult[]): HealthStatus {
  if (results.some((result) => result.status === "unhealthy")) return "unhealthy";
  if (results.some((result) => result.status === "degraded")) return "degraded";
  return "healthy";
}

export class HealthRegistry {
  readonly #service: string;
  readonly #probes: HealthProbe[] = [];

  constructor(service: string) {
    this.#service = service;
  }

  register(probe: HealthProbe): void {
    this.#probes.push(probe);
  }

  async report(): Promise<HealthReport> {
    const checkedAt = new Date().toISOString();
    const checks = await Promise.all(
      this.#probes.map(async (probe) => {
        try {
          return await probe.check();
        } catch (error) {
          void error;
          return createHealthCheckResult(probe.name, "unhealthy", {
            message: "health_check_failed"
          });
        }
      })
    );

    return {
      service: this.#service,
      status: aggregateHealthStatus(checks),
      checkedAt,
      checks
    };
  }
}

function allowlistHealthDetails(
  details: Readonly<Record<string, unknown>>
): Record<string, string | number | boolean | readonly string[]> {
  const allowed = new Set([
    "capabilities",
    "deadLettered",
    "dueNow",
    "eventTypes",
    "latencyMs",
    "oldestPendingOccurredAt",
    "pending",
    "providerKey",
    "retryScheduled"
  ]);
  const result: Record<string, string | number | boolean | readonly string[]> = {};
  for (const [key, value] of Object.entries(details)) {
    if (!allowed.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else if (typeof value === "boolean") result[key] = value;
    else if (typeof value === "string" && /^[A-Za-z0-9._:@/-]{1,128}$/u.test(value)) {
      result[key] = value;
    } else if (
      Array.isArray(value) &&
      value.length <= 64 &&
      value.every((item) => typeof item === "string" && /^[A-Za-z0-9._:@/-]{1,128}$/u.test(item))
    ) {
      result[key] = value;
    }
  }
  return result;
}
