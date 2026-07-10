import type { IncomingMessage } from "node:http";
import type { ParsedOperationRequest } from "@clinic-os/api-contracts";
import type { AccessContext } from "@clinic-os/auth";
import type {
  ClinicOperationsRepository,
  IdentityRepository,
  OptimisticConcurrencyOperationId,
  ScopedApiRequestGuardsPort
} from "@clinic-os/db";
import type { Clinic, Clock, UUID } from "@clinic-os/domain";
import type { AtomicBudgetStore } from "@clinic-os/security";
import type { AuditEventRecord } from "@clinic-os/security";

export interface ApiResponse {
  status: number;
  body: unknown;
  headers?: Readonly<Record<string, string>>;
}

export interface ApiTransactionContext {
  repository: ClinicOperationsRepository;
  auditSink: AuditSink;
  requestGuards: ScopedApiRequestGuardsPort;
}

export interface AuditSink {
  appendAuditEvent(event: AuditEventRecord): Promise<void>;
}

export interface ResolvedAccessContext {
  context: AccessContext;
  clinics: Clinic[];
}

export interface VerifiedClinicRequestContext extends ResolvedAccessContext {
  clinicId: UUID;
  clinic: Clinic;
}

export interface MutationIdentity {
  tenantId: UUID;
  clinicId: UUID;
  actorUserId: UUID;
}

export interface IdempotencyMutationContract {
  operationId: string;
  key: string;
  requestDigest: string;
}

export interface OptimisticConcurrencyMutationContract {
  operationId: OptimisticConcurrencyOperationId;
  resourceId: UUID;
  expectedEtag: string;
}

export interface VersionedResourceAdvance {
  operationId: OptimisticConcurrencyOperationId;
  resourceId: UUID;
}

export interface AtomicMutationRequest {
  identity: MutationIdentity;
  idempotency: IdempotencyMutationContract;
  concurrency: OptimisticConcurrencyMutationContract | null;
  versionAdvances: readonly VersionedResourceAdvance[];
  requestId: string;
  now: Date;
}

export interface AtomicMutationResult {
  response: ApiResponse;
  replayed: boolean;
  etag: string | null;
}

/**
 * The durable implementation must own the same database transaction as the domain callback.
 * It may not reserve in Redis and commit the domain effect separately.
 */
export interface AtomicMutationCoordinator {
  readonly durability: "durable_transactional" | "in_memory_test_double";
  readiness(): Promise<void>;
  execute(
    request: AtomicMutationRequest,
    effect: (transaction: ApiTransactionContext | undefined) => Promise<ApiResponse>
  ): Promise<AtomicMutationResult>;
}

export interface ClinicOsNestRuntime {
  clock: Clock;
  budgetStore: AtomicBudgetStore;
  budgetKeySecret: string;
  mutationCoordinator: AtomicMutationCoordinator;
  repositoryMode: "postgres" | "fixture" | "injected";
  useLocalAuthFixture: boolean;
  identityRepository: IdentityRepository;
  health(kind: "liveness" | "readiness" | "startup", requestId: string): Promise<ApiResponse>;
  admitTraffic(): Promise<boolean>;
  resolveAccess(request: IncomingMessage): Promise<ResolvedAccessContext>;
  handleIdentity(
    request: IncomingMessage,
    requestId: string,
    access: ResolvedAccessContext
  ): Promise<ApiResponse>;
  handleWebhook(
    request: IncomingMessage,
    requestId: string,
    rawBody: Buffer,
    transaction?: ApiTransactionContext
  ): Promise<ApiResponse>;
  handleClinicOperation?(
    request: IncomingMessage,
    operationId: string,
    requestId: string,
    access: VerifiedClinicRequestContext,
    parsedRequest: ParsedOperationRequest,
    receivedAt: Date,
    rawBody: Buffer | undefined,
    transaction?: ApiTransactionContext
  ): Promise<ApiResponse>;
  handleLegacyOperation(
    request: IncomingMessage,
    requestId: string,
    access: VerifiedClinicRequestContext,
    body: unknown,
    rawBody: Buffer | undefined,
    transaction?: ApiTransactionContext
  ): Promise<ApiResponse>;
  close?(): Promise<void>;
}
