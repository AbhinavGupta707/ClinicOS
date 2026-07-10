import { createHash } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { HttpOperationContract, ParsedOperationRequest } from "@clinic-os/api-contracts";
import { BoundaryError } from "@clinic-os/security";

const SECURITY_HEADER_NAMES = new Set([
  "authorization",
  "content-length",
  "content-type",
  "idempotency-key",
  "if-match",
  "x-clinic-id",
  "x-clinic-os-dev-subject",
  "x-clinicos-dev-subject",
  "x-razorpay-signature"
]);

export interface ParsedIncomingRequest extends IncomingMessage {
  body?: unknown;
  rawBody?: Buffer;
  originalUrl?: string;
}

export function requestUrl(request: ParsedIncomingRequest): URL {
  return new URL(request.originalUrl ?? request.url ?? "/", "http://clinic-os.local");
}

export function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

export function requestIdHeader(request: IncomingMessage): string | readonly string[] | null {
  const values = rawHeaderValues(request, "x-request-id");
  if (values.length === 0) return null;
  return values.length === 1 ? values[0] : values;
}

export function assertUnambiguousSecurityHeaders(request: IncomingMessage): void {
  for (const name of SECURITY_HEADER_NAMES) {
    const values = rawHeaderValues(request, name);
    if (values.length > 1) {
      throw new BoundaryError({
        code: "BAD_REQUEST",
        message: "Request contains an ambiguous security header.",
        details: { header: name }
      });
    }
  }
}

export function selectContractHeaders(
  request: IncomingMessage,
  operation: HttpOperationContract,
  requestId: string,
  useLocalAuthFixture: boolean
): Record<string, unknown> {
  const selected: Record<string, unknown> = {};
  const declared = Object.keys(operation.request.headers.properties ?? {});
  for (const name of declared) {
    if (name === "x-request-id") {
      selected[name] = requestId;
      continue;
    }
    const value = headerValue(request, name);
    if (value !== undefined) selected[name] = value;
  }
  if (
    useLocalAuthFixture &&
    operation.auth === "bearer" &&
    selected.authorization === undefined
  ) {
    selected.authorization = "Bearer local-synthetic-fixture";
  }
  if (
    useLocalAuthFixture &&
    operation.auth === "razorpay_signature" &&
    selected["x-razorpay-signature"] === undefined
  ) {
    const simulatorSignature = headerValue(request, "x-clinic-os-simulator-signature");
    if (simulatorSignature) selected["x-razorpay-signature"] = simulatorSignature;
  }
  return selected;
}

export function rawRequestBody(request: ParsedIncomingRequest): Buffer | undefined {
  if (Buffer.isBuffer(request.rawBody)) return request.rawBody;
  if (Buffer.isBuffer(request.body)) return request.body;
  return undefined;
}

export function requestBodyForContract(
  request: ParsedIncomingRequest,
  operation: HttpOperationContract
): unknown {
  const rawBody = rawRequestBody(request);
  if (!operation.request.body) {
    if ((rawBody?.byteLength ?? 0) > 0) {
      throw new BoundaryError({
        code: "VALIDATION_ERROR",
        message: "This operation does not accept a request body.",
        details: { source: "body", reason: "body_not_allowed" }
      });
    }
    return undefined;
  }
  if (
    operation.request.body.contentType === "application/octet-stream" ||
    operation.request.body.schema.format === "binary"
  ) {
    return rawBody ?? Buffer.alloc(0);
  }
  return request.body;
}

export function canonicalRequestDigest(
  operation: HttpOperationContract,
  request: ParsedOperationRequest
): string {
  const canonical = {
    operationId: operation.operationId,
    method: operation.method,
    path: request.path,
    query: request.query,
    semanticHeaders: {
      ifMatch: (request.headers as Record<string, unknown>)["if-match"] ?? null
    },
    body:
      request.body instanceof Uint8Array
        ? {
            byteLength: request.body.byteLength,
            sha256: createHash("sha256").update(request.body).digest("hex")
          }
        : request.body ?? null
  };
  return createHash("sha256").update(canonicalJson(canonical)).digest("hex");
}

export function attachRequestId(request: IncomingMessage, requestId: string): void {
  Object.defineProperty(request, "clinicOsRequestId", {
    configurable: true,
    enumerable: false,
    value: requestId,
    writable: false
  });
}

export function attachedRequestId(request: IncomingMessage): string | undefined {
  const value = (request as IncomingMessage & { clinicOsRequestId?: unknown }).clinicOsRequestId;
  return typeof value === "string" ? value : undefined;
}

function rawHeaderValues(request: IncomingMessage, requestedName: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === requestedName) {
      values.push(request.rawHeaders[index + 1] ?? "");
    }
  }
  return values;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
    .join(",")}}`;
}
