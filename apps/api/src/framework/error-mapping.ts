import type { IncomingMessage, ServerResponse } from "node:http";
import {
  parseNativeOperationResponse,
  parseNativeOperationResponseHeaders
} from "@clinic-os/api-contracts";
import { AuthenticationError, AuthorizationError, RequestScopeResolutionError } from "@clinic-os/auth";
import {
  BoundaryError,
  maskFreeTextPhi,
  normalizeUnknownBoundaryError,
  redactDiagnosticMetadata,
  serializeBoundaryError
} from "@clinic-os/security";
import { ApiError } from "../errors.ts";
import { matchClinicOsRoute } from "./route-registry.ts";
import { attachedRequestId, requestUrl } from "./request-utils.ts";

export interface SerializedCentralizedError {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

export function sendCentralizedError(
  request: IncomingMessage,
  response: ServerResponse,
  error: unknown,
  fallbackRequestId: string
): void {
  const serialized = serializeCentralizedError(request, error, fallbackRequestId);
  response.statusCode = serialized.status;
  for (const [name, value] of Object.entries(serialized.headers)) response.setHeader(name, value);
  response.end(`${JSON.stringify(serialized.body)}\n`);
}

export function serializeCentralizedError(
  request: IncomingMessage,
  error: unknown,
  fallbackRequestId: string
): SerializedCentralizedError {
  const requestId = attachedRequestId(request) ?? fallbackRequestId;
  const candidate = serializeKnownError(error, requestId);
  if (errorResponseMatchesRouteContract(request, candidate)) return candidate;

  const fallback = serializeBoundaryError(
    new BoundaryError({
      code: "INTERNAL_ERROR",
      message: "The request could not be completed."
    }),
    requestId
  );
  return { status: fallback.status, headers: fallback.headers, body: fallback.body };
}

function serializeKnownError(error: unknown, requestId: string): SerializedCentralizedError {
  const bodyParserError = normalizeBodyParserError(error);
  if (bodyParserError) return serializedBoundary(bodyParserError, requestId);
  if (error instanceof BoundaryError) return serializedBoundary(error, requestId);
  if (error instanceof AuthenticationError) {
    return serializedBoundary(
      new BoundaryError({ code: "UNAUTHENTICATED", message: "Authentication is required." }),
      requestId
    );
  }
  if (error instanceof AuthorizationError || error instanceof RequestScopeResolutionError) {
    return serializedBoundary(
      new BoundaryError({
        code: "PERMISSION_DENIED",
        message: "The verified identity is not authorized for this operation.",
        details: {
          reason: error.reason,
          ...(error instanceof AuthorizationError
            ? { required_permission: error.requiredPermission }
            : {})
        }
      }),
      requestId
    );
  }
  if (error instanceof ApiError) return serializeApiError(error, requestId);
  return serializedBoundary(normalizeUnknownBoundaryError(error), requestId);
}

function serializedBoundary(
  error: BoundaryError,
  requestId: string
): SerializedCentralizedError {
  const serialized = serializeBoundaryError(error, requestId);
  return { status: serialized.status, headers: serialized.headers, body: serialized.body };
}

function serializeApiError(error: ApiError, requestId: string): SerializedCentralizedError {
  const status = normalizedApiStatus(error);
  const publicMessage =
    error.code === "CONFIGURATION_ERROR"
      ? "The request could not be completed because a required capability is unavailable."
      : error.code === "UNAUTHENTICATED"
        ? "Authentication is required."
        : error.code === "PERMISSION_DENIED"
          ? "The verified identity is not authorized for this operation."
          : maskFreeTextPhi(error.message);
  return {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-request-id": requestId
    },
    body: {
      error: {
        code: error.code,
        message: publicMessage,
        details: redactDiagnosticMetadata(error.details),
        request_id: requestId
      }
    }
  };
}

function errorResponseMatchesRouteContract(
  request: IncomingMessage,
  response: SerializedCentralizedError
): boolean {
  const matched = matchClinicOsRoute(
    (request.method ?? "GET").toUpperCase(),
    requestUrl(request).pathname
  );
  if (!matched) return true;
  const body = parseNativeOperationResponse(
    matched.operation.operationId,
    response.status,
    response.body
  );
  if (!body.success) return false;
  const headers = parseNativeOperationResponseHeaders(
    matched.operation.operationId,
    response.status,
    response.headers
  );
  return headers.success;
}

function normalizedApiStatus(error: ApiError): number {
  if (error.code === "VALIDATION_ERROR") return 422;
  if (error.code === "CONFIGURATION_ERROR") return 503;
  return error.status;
}

function normalizeBodyParserError(error: unknown): BoundaryError | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as { type?: unknown; status?: unknown };
  if (candidate.type === "entity.too.large" || candidate.status === 413) {
    return new BoundaryError({
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body exceeds the configured byte limit."
    });
  }
  if (candidate.type === "entity.parse.failed") {
    return new BoundaryError({ code: "BAD_REQUEST", message: "Request body must be valid JSON." });
  }
  return null;
}
