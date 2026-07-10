import type { ParsedOperationRequest } from "@clinic-os/api-contracts";
import type { ClinicModuleTransactionContext } from "@clinic-os/db";
import type { Clock, UUID } from "@clinic-os/domain";
import type { ApiResponse, VerifiedClinicRequestContext } from "../framework/contracts.ts";
import type { Cp13ClinicFeatureOperationId } from "./cp13-operation-ownership.ts";

export interface ClinicFeatureRequestMetadata {
  readonly requestId: string;
  readonly receivedAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
}

export interface ClinicFeatureOperationRequest<
  TOperationId extends Cp13ClinicFeatureOperationId = Cp13ClinicFeatureOperationId
> {
  readonly operationId: TOperationId;
  readonly access: VerifiedClinicRequestContext;
  readonly parsed: ParsedOperationRequest;
  readonly metadata: ClinicFeatureRequestMetadata;
}

export interface ClinicFeatureExecutionContext extends ClinicModuleTransactionContext {
  readonly clock: Clock;
}

export type ClinicFeatureOperationHandler<
  TOperationId extends Cp13ClinicFeatureOperationId = Cp13ClinicFeatureOperationId
> = (
  request: ClinicFeatureOperationRequest<TOperationId>,
  context: ClinicFeatureExecutionContext
) => Promise<ApiResponse>;

export type ClinicFeatureHandlerMap<
  TOperationId extends Cp13ClinicFeatureOperationId = Cp13ClinicFeatureOperationId
> = Readonly<Partial<Record<TOperationId, ClinicFeatureOperationHandler<TOperationId>>>>;

export interface ClinicFeatureScope {
  readonly tenantId: UUID;
  readonly clinicId: UUID;
  readonly actorUserId: UUID;
}

export function featureOutboxIdempotencyKey(
  request: ClinicFeatureOperationRequest,
  input: Readonly<{ eventType: string; aggregateId: UUID; ordinal?: number }>
): string | null {
  const headers = request.parsed.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return null;
  const requestKey = (headers as Readonly<Record<string, unknown>>)["idempotency-key"];
  if (typeof requestKey !== "string" || requestKey.length === 0) return null;
  return [
    request.access.context.tenant.id,
    request.access.clinicId,
    request.access.context.user.id,
    request.operationId,
    requestKey,
    input.eventType,
    input.aggregateId,
    input.ordinal ?? 0
  ].join(":");
}
