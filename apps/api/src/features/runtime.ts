import type { IncomingMessage } from "node:http";
import type { ParsedOperationRequest } from "@clinic-os/api-contracts";
import { runWithClinicModuleTransactionContext } from "@clinic-os/db";
import type { Clock } from "@clinic-os/domain";
import type {
  ApiResponse,
  ApiTransactionContext,
  VerifiedClinicRequestContext
} from "../framework/contracts.ts";
import { headerValue } from "../framework/request-utils.ts";
import type { ClinicFeatureOperationHandler, ClinicFeatureOperationRequest } from "./contracts.ts";
import type { Cp13ClinicFeatureOperationId } from "./cp13-operation-ownership.ts";

export async function runClinicFeatureOperation(input: {
  operationId: Cp13ClinicFeatureOperationId;
  handler: ClinicFeatureOperationHandler;
  request: IncomingMessage;
  requestId: string;
  access: VerifiedClinicRequestContext;
  parsedRequest: ParsedOperationRequest;
  receivedAt: Date;
  transaction: ApiTransactionContext;
  clock: Clock;
}): Promise<ApiResponse> {
  assertValidReceivedAt(input.receivedAt);
  const scope = {
    tenantId: input.access.context.tenant.id,
    clinicId: input.access.clinicId,
    actorUserId: input.access.context.user.id
  };
  const request: ClinicFeatureOperationRequest = Object.freeze({
    operationId: input.operationId,
    access: input.access,
    parsed: input.parsedRequest,
    metadata: Object.freeze({
      requestId: input.requestId,
      receivedAt: new Date(input.receivedAt.getTime()),
      ipAddress: boundedAuditValue(input.request.socket.remoteAddress, 64),
      userAgent: boundedAuditValue(headerValue(input.request, "user-agent"), 512)
    })
  });

  return runWithClinicModuleTransactionContext(
    {
      repository: input.transaction.repository,
      auditSink: input.transaction.auditSink,
      requestGuards: input.transaction.requestGuards,
      ...(input.transaction.sqlClient ? { sqlClient: input.transaction.sqlClient } : {}),
      scope
    },
    (context) => input.handler(request, { ...context, clock: input.clock })
  );
}

function boundedAuditValue(value: string | undefined, maximumLength: number): string | null {
  if (!value) return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  return normalized.length > 0 ? normalized.slice(0, maximumLength) : null;
}

function assertValidReceivedAt(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error("Clinic feature execution requires a valid injected request instant.");
  }
}
