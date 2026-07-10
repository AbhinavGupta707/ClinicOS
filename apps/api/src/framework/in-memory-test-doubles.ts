import { API_REPLAY_RESPONSE_HEADER_ALLOWLIST } from "@clinic-os/db";
import { BoundaryError, type AtomicBudgetStore, type BudgetConsumptionRequest } from "@clinic-os/security";
import type {
  ApiResponse,
  AtomicMutationCoordinator,
  AtomicMutationRequest,
  AtomicMutationResult
} from "./contracts.ts";

/** Deterministic single-process test double. It is forbidden for production-like composition. */
export class InMemoryAtomicBudgetStore implements AtomicBudgetStore {
  readonly #buckets = new Map<string, { consumed: number; resetAt: Date }>();

  async consume(request: BudgetConsumptionRequest) {
    const nowMillis = request.now.getTime();
    const current = this.#buckets.get(request.bucketKey);
    const active = current && current.resetAt.getTime() > nowMillis ? current : undefined;
    const resetAt = active
      ? new Date(active.resetAt.getTime())
      : new Date(nowMillis + request.windowSeconds * 1000);
    const consumed = active?.consumed ?? 0;
    const allowed = consumed + request.cost <= request.limit;
    if (allowed) {
      this.#buckets.set(request.bucketKey, {
        consumed: consumed + request.cost,
        resetAt: new Date(resetAt.getTime())
      });
    }
    return {
      allowed,
      remaining: Math.max(0, request.limit - (allowed ? consumed + request.cost : consumed)),
      resetAt
    };
  }
}

interface StoredMutation {
  digest: string;
  response: ApiResponse;
  etag: string | null;
}

/**
 * Typed fixture/test double for the transactional mutation contract. Product runtime must inject a
 * durable transaction-bound implementation supplied with the master-owned schema integration.
 */
export class InMemoryAtomicMutationCoordinator implements AtomicMutationCoordinator {
  readonly durability = "in_memory_test_double" as const;
  readonly #mutations = new Map<string, StoredMutation>();
  readonly #resourceVersions = new Map<string, number>();
  readonly #locks = new Map<string, Promise<void>>();

  readiness(): Promise<void> {
    return Promise.resolve();
  }

  async execute(
    request: AtomicMutationRequest,
    effect: (transaction: undefined) => Promise<ApiResponse>
  ): Promise<AtomicMutationResult> {
    const key = mutationKey(request);
    const versionAdvances = normalizedVersionAdvances(request);
    const lockKeys = [
      `idempotency:${key}`,
      ...versionAdvances.map(
        ({ operationId, resourceId }) => `resource:${operationId}:${resourceId}`
      )
    ];
    return this.#withLocks(lockKeys, async () => {
      const stored = this.#mutations.get(key);
      if (stored) {
        if (stored.digest !== request.idempotency.requestDigest) {
          throw new BoundaryError({
            code: "CONFLICT",
            message: "Idempotency key was already used for a different request.",
            details: { reason: "idempotency_digest_mismatch" }
          });
        }
        return {
          response: cloneResponse(stored.response),
          replayed: true,
          etag: stored.etag
        };
      }

      const stagedVersions = new Map<string, number>();
      const concurrency = request.concurrency;
      for (const resource of versionAdvances) {
        const resourceKey = versionResourceKey(resource);
        const currentVersion = this.#resourceVersions.get(resourceKey) ?? 1;
        const isConditional =
          concurrency !== null &&
          concurrency.operationId === resource.operationId &&
          concurrency.resourceId === resource.resourceId;
        if (isConditional) {
          if (!concurrency) throw new Error("Conditional mutation metadata is missing.");
          if (parseStrongNumericEtag(concurrency.expectedEtag) !== currentVersion) {
            throw new BoundaryError({
              code: "CONFLICT",
              message: "The resource changed before this request was applied.",
              details: { reason: "if_match_failed" }
            });
          }
        }
        stagedVersions.set(resourceKey, currentVersion + 1);
      }

      const effectResponse = await effect(undefined);
      if (!isSuccessfulResponse(effectResponse.status)) {
        return {
          response: publicMutationResponse(effectResponse),
          replayed: false,
          etag: null
        };
      }
      const responseEtag = effectResponse.headers?.etag ?? null;
      assertResponseEtagMatchesAdvance(responseEtag, versionAdvances, stagedVersions);
      const response = publicMutationResponse(effectResponse);
      for (const [resourceKey, nextVersion] of stagedVersions) {
        this.#resourceVersions.set(resourceKey, nextVersion);
      }
      const storedMutation = {
        digest: request.idempotency.requestDigest,
        response: cloneResponse(response),
        etag: responseEtag
      };
      this.#mutations.set(key, storedMutation);
      return { response, replayed: false, etag: responseEtag };
    });
  }

  async #withLocks<T>(keys: readonly string[], callback: () => Promise<T>): Promise<T> {
    const held: Array<{ key: string; tail: Promise<void>; release: () => void }> = [];
    for (const key of [...new Set(keys)].sort()) {
      const previous = this.#locks.get(key) ?? Promise.resolve();
      let release: () => void = () => {};
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = previous.then(() => current);
      this.#locks.set(key, tail);
      await previous;
      held.push({ key, tail, release });
    }
    try {
      return await callback();
    } finally {
      for (const lock of held.reverse()) {
        lock.release();
        if (this.#locks.get(lock.key) === lock.tail) this.#locks.delete(lock.key);
      }
    }
  }
}

function mutationKey(request: AtomicMutationRequest): string {
  return [
    request.identity.tenantId,
    request.identity.clinicId,
    request.identity.actorUserId,
    request.idempotency.operationId,
    request.idempotency.key
  ].join("\u0000");
}

function versionResourceKey(resource: {
  operationId: string;
  resourceId: string;
}): string {
  return `${resource.operationId}:${resource.resourceId}`;
}

function parseStrongNumericEtag(value: string): number {
  const match = /^"rv-([1-9][0-9]{0,15})"$/u.exec(value);
  const parsed = match ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new BoundaryError({
      code: "VALIDATION_ERROR",
      message: "If-Match must contain a canonical strong numeric ETag.",
      details: { field: "if-match" }
    });
  }
  return parsed;
}

function publicMutationResponse(response: ApiResponse): ApiResponse {
  const effectHeaders = allowlistedEffectHeaders(response.headers);
  return {
    status: response.status,
    body: response.body,
    headers: {
      ...effectHeaders,
      "cache-control": "no-store",
      "content-type": effectHeaders["content-type"] ?? "application/json; charset=utf-8"
    }
  };
}

function allowlistedEffectHeaders(
  input: Readonly<Record<string, string>> | undefined
): Record<string, string> {
  const allowed = new Set<string>(API_REPLAY_RESPONSE_HEADER_ALLOWLIST);
  const result: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(input ?? {})) {
    const name = rawName.toLowerCase();
    if (!allowed.has(name)) continue;
    if (/\r|\n/u.test(value)) {
      throw new BoundaryError({
        code: "INTERNAL_ERROR",
        message: "The mutation response headers could not be completed safely."
      });
    }
    result[name] = value;
  }
  return result;
}

function assertResponseEtagMatchesAdvance(
  responseEtag: string | null,
  versionAdvances: readonly AtomicMutationRequest["versionAdvances"][number][],
  advancedVersions: ReadonlyMap<string, number>
): void {
  if (responseEtag === null) return;
  let expected: string;
  if (versionAdvances.length === 0) {
    expected = '"rv-1"';
  } else if (versionAdvances.length === 1) {
    const version = advancedVersions.get(versionResourceKey(versionAdvances[0]));
    if (!version) throw new Error("Advanced response resource version is missing.");
    expected = `"rv-${version}"`;
  } else {
    throw new BoundaryError({
      code: "INTERNAL_ERROR",
      message: "The mutation response ETag source was ambiguous."
    });
  }
  if (responseEtag !== expected) {
    throw new BoundaryError({
      code: "INTERNAL_ERROR",
      message: "The mutation response ETag did not match its committed row version."
    });
  }
}

function isSuccessfulResponse(status: number): boolean {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

function normalizedVersionAdvances(request: AtomicMutationRequest) {
  if (!Array.isArray(request.versionAdvances) || request.versionAdvances.length > 16) {
    throw new Error("Mutation version advances must be a bounded array.");
  }
  const byKey = new Map<string, (typeof request.versionAdvances)[number]>();
  for (const resource of request.versionAdvances) {
    byKey.set(versionResourceKey(resource), resource);
  }
  if (
    request.concurrency &&
    !byKey.has(versionResourceKey(request.concurrency))
  ) {
    throw new Error("If-Match concurrency resource must be included in version advances.");
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, resource]) => resource);
}

function cloneResponse(response: ApiResponse): ApiResponse {
  return {
    status: response.status,
    body: structuredClone(response.body),
    ...(response.headers ? { headers: { ...response.headers } } : {})
  };
}
