import { maskFreeTextPhi, redactDiagnosticMetadata } from "./redaction.ts";

export const BOUNDARY_ERROR_STATUS = {
  BAD_REQUEST: 400,
  UNAUTHENTICATED: 401,
  PERMISSION_DENIED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  VALIDATION_ERROR: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  DEPENDENCY_UNAVAILABLE: 503
} as const;

export type BoundaryErrorCode = keyof typeof BOUNDARY_ERROR_STATUS;
export type BoundaryErrorStatus = (typeof BOUNDARY_ERROR_STATUS)[BoundaryErrorCode];

export interface BoundaryErrorBody {
  error: {
    code: BoundaryErrorCode;
    message: string;
    details: Record<string, unknown>;
    request_id: string;
  };
}

export interface SerializedBoundaryError {
  status: BoundaryErrorStatus;
  headers: Readonly<Record<string, string>>;
  body: BoundaryErrorBody;
}

export class BoundaryError extends Error {
  readonly code: BoundaryErrorCode;
  readonly status: BoundaryErrorStatus;
  readonly publicMessage: string;
  readonly safeDetails: Record<string, unknown>;
  readonly retryAfterSeconds: number | null;

  constructor(input: {
    code: BoundaryErrorCode;
    message: string;
    details?: Record<string, unknown>;
    retryAfterSeconds?: number | null;
  }) {
    super(input.message);
    this.name = "BoundaryError";
    this.code = input.code;
    this.status = BOUNDARY_ERROR_STATUS[input.code];
    this.publicMessage = input.message;
    this.safeDetails = input.details ?? {};
    this.retryAfterSeconds = input.retryAfterSeconds ?? null;

    if (input.code === "RATE_LIMITED") {
      if (
        this.retryAfterSeconds === null ||
        !Number.isInteger(this.retryAfterSeconds) ||
        this.retryAfterSeconds < 1
      ) {
        throw new Error("RATE_LIMITED boundary errors require a positive Retry-After value.");
      }
    } else if (this.retryAfterSeconds !== null) {
      throw new Error("Retry-After is only valid for RATE_LIMITED boundary errors.");
    }
  }
}

export function serializeBoundaryError(
  error: BoundaryError,
  requestId: string
): SerializedBoundaryError {
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId
  };
  if (error.retryAfterSeconds !== null) {
    headers["retry-after"] = String(error.retryAfterSeconds);
  }

  return {
    status: error.status,
    headers,
    body: {
      error: {
        code: error.code,
        message: maskFreeTextPhi(error.publicMessage),
        details: redactDiagnosticMetadata(error.safeDetails),
        request_id: requestId
      }
    }
  };
}

export function normalizeUnknownBoundaryError(error: unknown): BoundaryError {
  if (error instanceof BoundaryError) return error;
  return new BoundaryError({
    code: "INTERNAL_ERROR",
    message: "The request could not be completed."
  });
}
