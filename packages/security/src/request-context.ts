import { randomUUID } from "node:crypto";

const REQUEST_ID_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._:-]{0,127})$/;
const HTTP_METHOD_PATTERN = /^[A-Z]{3,10}$/;
const ROUTE_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/;

export type RequestIdProvenance =
  "generated" | "generated_after_invalid_client_value" | "validated_client_value";

export interface RequestCorrelationContext {
  requestId: string;
  requestIdProvenance: RequestIdProvenance;
  receivedAt: string;
  method: string;
  routeId: string;
}

export interface RequestAuthorityMetadata {
  tenantId: string;
  clinicId: string | null;
  actorId: string;
  authorityProvenance: "verified_identity_and_active_membership";
}

export function createRequestCorrelationContext(input: {
  requestIdHeader?: string | readonly string[] | null;
  method: string;
  routeId: string;
  now?: Date;
  generateId?: () => string;
}): RequestCorrelationContext {
  if (!HTTP_METHOD_PATTERN.test(input.method)) {
    throw new Error("Request context requires a normalized uppercase HTTP method.");
  }
  if (!ROUTE_ID_PATTERN.test(input.routeId)) {
    throw new Error("Request context requires a stable, non-PHI route id.");
  }

  const supplied = Array.isArray(input.requestIdHeader)
    ? input.requestIdHeader.length === 1
      ? input.requestIdHeader[0]
      : null
    : input.requestIdHeader;
  const headerWasProvided = input.requestIdHeader !== undefined && input.requestIdHeader !== null;
  const validSupplied = typeof supplied === "string" && REQUEST_ID_PATTERN.test(supplied);
  const requestId = validSupplied ? supplied : (input.generateId ?? randomUUID)();

  if (!REQUEST_ID_PATTERN.test(requestId)) {
    throw new Error("Generated request id does not meet the ClinicOS request-id contract.");
  }

  return {
    requestId,
    requestIdProvenance: validSupplied
      ? "validated_client_value"
      : headerWasProvided
        ? "generated_after_invalid_client_value"
        : "generated",
    receivedAt: (input.now ?? new Date()).toISOString(),
    method: input.method,
    routeId: input.routeId
  };
}

export function safeRequestAuditMetadata(
  context: RequestCorrelationContext,
  authority?: RequestAuthorityMetadata
): Record<string, unknown> {
  return {
    requestId: context.requestId,
    requestIdProvenance: context.requestIdProvenance,
    receivedAt: context.receivedAt,
    method: context.method,
    routeId: context.routeId,
    ...(authority
      ? {
          tenantId: authority.tenantId,
          clinicId: authority.clinicId,
          actorId: authority.actorId,
          authorityProvenance: authority.authorityProvenance
        }
      : {})
  };
}
