import { randomUUID } from "node:crypto";
import {
  API_IDEMPOTENCY_MAX_LEASE_MILLISECONDS,
  API_IDEMPOTENCY_MAX_REPLAY_RETENTION_MILLISECONDS,
  API_REPLAY_RESPONSE_HEADER_ALLOWLIST,
  type ApiIdempotencyClaimResult,
  type ApiReplayJsonValue,
  type ClinicOperationsRepository,
  type ScopedApiRequestGuardsPort
} from "@clinic-os/db";
import { BoundaryError, type AuditEventRecord } from "@clinic-os/security";
import type {
  ApiResponse,
  ApiTransactionContext,
  AtomicMutationCoordinator,
  AtomicMutationRequest,
  AtomicMutationResult,
  AuditSink
} from "./contracts.ts";

const PROCESSING_LEASE_MILLISECONDS = Math.min(60_000, API_IDEMPOTENCY_MAX_LEASE_MILLISECONDS);
const REPLAY_RETENTION_MILLISECONDS = Math.min(
  24 * 60 * 60 * 1_000,
  API_IDEMPOTENCY_MAX_REPLAY_RETENTION_MILLISECONDS
);

interface TransactionalMutationUnitOfWork {
  run<T>(
    callback: (context: {
      repository: ClinicOperationsRepository;
      auditSink: { appendAuditEvent(event: AuditEventRecord): Promise<void> };
      requestGuards: ScopedApiRequestGuardsPort;
    }) => Promise<T>
  ): Promise<T>;
}

type ClaimRejection = Exclude<ApiIdempotencyClaimResult["outcome"], "claimed" | "replay">;

type TransactionOutcome =
  | { kind: "result"; result: AtomicMutationResult }
  | { kind: "claim_rejected"; outcome: ClaimRejection };

class RollbackResponse extends Error {
  readonly result: AtomicMutationResult;

  constructor(result: AtomicMutationResult) {
    super("ClinicOS mutation returned a non-success response.");
    this.name = "RollbackResponse";
    this.result = result;
  }
}

/**
 * Owns idempotency, optimistic concurrency, domain writes, audit/outbox writes, response
 * validation (inside `effect`), and replay completion in one Postgres transaction.
 */
export class PostgresAtomicMutationCoordinator implements AtomicMutationCoordinator {
  readonly durability = "durable_transactional" as const;
  readonly #unitOfWork: TransactionalMutationUnitOfWork;
  readonly #readinessProbe: () => Promise<unknown>;

  constructor(input: {
    unitOfWork: TransactionalMutationUnitOfWork;
    readinessProbe: () => Promise<unknown>;
  }) {
    this.#unitOfWork = input.unitOfWork;
    this.#readinessProbe = input.readinessProbe;
  }

  async readiness(): Promise<void> {
    try {
      await this.#readinessProbe();
    } catch {
      throw new BoundaryError({
        code: "DEPENDENCY_UNAVAILABLE",
        message: "A required mutation-coordination dependency is unavailable.",
        details: { dependency: "postgres_mutation_coordinator" }
      });
    }
  }

  async execute(
    request: AtomicMutationRequest,
    effect: (transaction: ApiTransactionContext) => Promise<ApiResponse>
  ): Promise<AtomicMutationResult> {
    assertValidRequestInstant(request.now);
    const versionAdvances = normalizedVersionAdvances(request);
    const conditionalVersion = request.concurrency
      ? parseStrongNumericEtag(request.concurrency.expectedEtag)
      : null;
    const now = request.now.toISOString();
    const leaseExpiresAt = new Date(
      request.now.getTime() + PROCESSING_LEASE_MILLISECONDS
    ).toISOString();
    const replayExpiresAt = new Date(
      request.now.getTime() + REPLAY_RETENTION_MILLISECONDS
    ).toISOString();
    const leaseOwner = randomUUID();
    const scope = {
      tenantId: request.identity.tenantId,
      clinicId: request.identity.clinicId,
      actorUserId: request.identity.actorUserId
    };

    let outcome: TransactionOutcome;
    try {
      outcome = await this.#unitOfWork.run(async ({ repository, auditSink, requestGuards }) => {
        const claim = await requestGuards.idempotency.claim(scope, {
          operationId: request.idempotency.operationId,
          idempotencyKey: request.idempotency.key,
          requestDigest: request.idempotency.requestDigest,
          now,
          leaseOwner,
          leaseExpiresAt
        });
        if (claim.outcome === "replay") {
          const response = replayResponse(claim.response);
          return {
            kind: "result",
            result: {
              response,
              replayed: true,
              etag: response.headers?.etag ?? null
            }
          };
        }
        if (claim.outcome !== "claimed") {
          return { kind: "claim_rejected", outcome: claim.outcome };
        }

        let unresolvedVersionedResource = false;
        const advancedVersions = new Map<string, number>();
        const concurrency = request.concurrency;
        for (const resource of versionAdvances) {
          const isConditional =
            concurrency !== null &&
            concurrency.operationId === resource.operationId &&
            concurrency.resourceId === resource.resourceId;
          let expectedVersion: number;
          if (isConditional) {
            if (conditionalVersion === null) {
              throw new Error("Conditional version metadata is missing its expected version.");
            }
            expectedVersion = conditionalVersion;
          } else {
            const current = await requestGuards.optimisticConcurrency.readCurrentVersion(
              scope,
              resource
            );
            if (current.outcome === "not_found") {
              unresolvedVersionedResource = true;
              continue;
            }
            expectedVersion = current.rowVersion;
          }
          const advanced = await requestGuards.optimisticConcurrency.advanceVersion(scope, {
            ...resource,
            expectedVersion
          });
          if (advanced.outcome !== "advanced") {
            throw new BoundaryError({
              code: "CONFLICT",
              message: "The resource changed before this request was applied.",
              details: {
                reason: isConditional ? "if_match_failed" : "version_advance_conflict"
              }
            });
          }
          advancedVersions.set(versionAdvanceKey(resource), advanced.rowVersion);
        }

        const transaction: ApiTransactionContext = {
          repository,
          auditSink: auditSink as AuditSink,
          requestGuards
        };
        const effectResponse = await effect(transaction);
        if (!isSuccessfulResponse(effectResponse.status)) {
          throw new RollbackResponse({
            response: publicMutationResponse(effectResponse),
            replayed: false,
            etag: null
          });
        }
        if (unresolvedVersionedResource) {
          throw new BoundaryError({
            code: "INTERNAL_ERROR",
            message: "The mutation could not be completed safely."
          });
        }
        const responseEtag = effectResponse.headers?.etag ?? null;
        assertResponseEtagMatchesAdvance(responseEtag, versionAdvances, advancedVersions);
        const response = publicMutationResponse(effectResponse);
        const result = { response, replayed: false, etag: responseEtag };

        const completed = await requestGuards.idempotency.complete(scope, {
          claim: claim.claim,
          response: {
            status: response.status,
            headers: response.headers ?? {},
            body: response.body as ApiReplayJsonValue
          },
          completedAt: now,
          expiresAt: replayExpiresAt
        });
        if (completed.outcome !== "completed") {
          throw new BoundaryError({
            code: "INTERNAL_ERROR",
            message: "The mutation could not be completed safely."
          });
        }
        return { kind: "result", result };
      });
    } catch (error) {
      if (error instanceof RollbackResponse) return error.result;
      throw error;
    }

    if (outcome.kind === "claim_rejected") throw claimRejection(outcome.outcome);
    return outcome.result;
  }
}

function publicMutationResponse(response: ApiResponse): ApiResponse {
  const headers = allowlistedEffectHeaders(response.headers);
  return {
    status: response.status,
    body: response.body,
    headers: {
      ...headers,
      "cache-control": "no-store",
      "content-type": headers["content-type"] ?? "application/json; charset=utf-8"
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

function replayResponse(response: {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: ApiReplayJsonValue;
}): ApiResponse {
  return {
    status: response.status,
    body: structuredClone(response.body),
    headers: Object.fromEntries(
      Object.entries(response.headers).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    )
  };
}

function claimRejection(outcome: ClaimRejection): BoundaryError {
  const reason =
    outcome === "digest_conflict"
      ? "idempotency_key_conflict"
      : outcome === "in_progress"
        ? "idempotency_request_in_progress"
        : "idempotency_replay_expired";
  return new BoundaryError({
    code: "CONFLICT",
    message: "The idempotency request could not be accepted.",
    details: { reason }
  });
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
    const version = advancedVersions.get(versionAdvanceKey(versionAdvances[0]));
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

function versionAdvanceKey(resource: { operationId: string; resourceId: string }): string {
  return `${resource.operationId}:${resource.resourceId}`;
}

function isSuccessfulResponse(status: number): boolean {
  return Number.isInteger(status) && status >= 200 && status < 300;
}

function assertValidRequestInstant(now: Date): void {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new Error("Mutation coordination requires a valid injected request instant.");
  }
}

function normalizedVersionAdvances(request: AtomicMutationRequest) {
  if (!Array.isArray(request.versionAdvances) || request.versionAdvances.length > 16) {
    throw new Error("Mutation version advances must be a bounded array.");
  }
  const byKey = new Map<string, (typeof request.versionAdvances)[number]>();
  for (const resource of request.versionAdvances) {
    byKey.set(`${resource.operationId}:${resource.resourceId}`, resource);
  }
  if (request.concurrency) {
    const concurrencyKey = `${request.concurrency.operationId}:${request.concurrency.resourceId}`;
    if (!byKey.has(concurrencyKey)) {
      throw new Error("If-Match concurrency resource must be included in version advances.");
    }
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, resource]) => resource);
}
