import {
  parseRuntimeSchema,
  schema,
  type JsonValue,
  type RuntimeSchema,
  type RuntimeSchemaIssue,
  type RuntimeSchemaResult
} from "./runtime-schema.ts";

export type HttpMethod = "GET" | "PATCH" | "POST" | "PUT";
export type EvidenceCheckpoint =
  "CP1" | "CP2" | "CP3" | "CP4" | "CP5" | "CP6" | "CP7" | "CP8" | "CP9" | "CP10";
export type OperationAuth = "bearer" | "none" | "razorpay_signature";

export interface IdempotencyContract {
  readonly mode: "header" | "none" | "provider_event";
  readonly header?: "idempotency-key";
  readonly required: boolean;
  readonly replaySemantics: string;
}

export interface OptimisticConcurrencyContract {
  readonly mode: "if-match" | "none";
  readonly header?: "if-match";
  readonly required: boolean;
  readonly semantics: string;
}

export interface PaginationContract {
  readonly mode: "bounded" | "none";
  readonly defaultLimit?: number;
  readonly maximumLimit?: number;
  readonly cursor: false;
}

export interface HttpBodyContract {
  readonly contentType: "application/json" | "application/octet-stream";
  readonly maximumBytes: number;
  readonly schema: RuntimeSchema;
}

export interface HttpResponseContract {
  readonly description: string;
  readonly schema: RuntimeSchema;
}

export interface HttpOperationContract {
  readonly operationId: string;
  readonly checkpoint: EvidenceCheckpoint;
  readonly method: HttpMethod;
  readonly path: string;
  readonly summary: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly auth: OperationAuth;
  readonly phi: "none" | "read" | "write";
  readonly cache: "no-store" | "public-health";
  readonly request: {
    readonly path: RuntimeSchema;
    readonly query: RuntimeSchema;
    readonly headers: RuntimeSchema;
    readonly body?: HttpBodyContract;
  };
  readonly responses: Readonly<Record<number, HttpResponseContract>>;
  readonly idempotency: IdempotencyContract;
  readonly concurrency: OptimisticConcurrencyContract;
  readonly pagination: PaginationContract;
  readonly integration: {
    readonly nativeRuntimeEnforcement: "body-parser-only" | "partial" | "route-parity";
    readonly requiredMasterWiring: readonly string[];
  };
}

export interface OperationRequestInput {
  readonly path?: unknown;
  readonly query?: unknown;
  readonly headers?: unknown;
  readonly body?: unknown;
}

export interface ParsedOperationRequest {
  readonly path: JsonValue;
  readonly query: JsonValue;
  readonly headers: JsonValue;
  readonly body?: JsonValue | Uint8Array;
}

export interface OperationRequestIssue extends RuntimeSchemaIssue {
  readonly location: "body" | "headers" | "path" | "query";
}

export type OperationRequestResult =
  | { readonly success: true; readonly data: ParsedOperationRequest }
  | { readonly success: false; readonly issues: readonly OperationRequestIssue[] };

export const EMPTY_OBJECT_SCHEMA = schema.object({});
export const UUID_PATH_SCHEMA = schema.uuid({ minLength: 36, maxLength: 36 });
export const REQUEST_ID_SCHEMA = schema.string({ minLength: 1, maxLength: 128 });
export const IDEMPOTENCY_KEY_SCHEMA = schema.string({
  minLength: 8,
  maxLength: 128,
  pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$"
});
export const IF_MATCH_SCHEMA = schema.string({
  minLength: 1,
  maxLength: 128,
  pattern: '^(W/)?\\"?[A-Za-z0-9._:-]+\\"?$'
});
export const LIMIT_SCHEMA = schema.integer({ minimum: 1, maximum: 100 });

export const API_ERROR_CODES = [
  "BAD_REQUEST",
  "UNAUTHENTICATED",
  "PERMISSION_DENIED",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "RATE_LIMITED",
  "INTERNAL_ERROR",
  "AI_PROVIDER_UNAVAILABLE",
  "DEPENDENCY_UNAVAILABLE",
  "CONFIGURATION_ERROR"
] as const;

export const API_ERROR_SCHEMA = schema.object(
  {
    error: schema.object(
      {
        code: schema.enum(API_ERROR_CODES),
        message: schema.string({ minLength: 1, maxLength: 1024 }),
        details: schema.publicJsonObject(),
        request_id: REQUEST_ID_SCHEMA
      },
      ["code", "message", "details", "request_id"]
    )
  },
  ["error"]
);

export const PUBLIC_RECORD_SCHEMA = schema.publicJsonObject({
  description:
    "A bounded public HTTP record. Runtime validation recursively rejects private storage, raw provider payload, and secret field names."
});
export const PUBLIC_RECORD_ARRAY_SCHEMA = schema.array(PUBLIC_RECORD_SCHEMA, { maxItems: 100 });
export const WRITABLE_JSON_SCHEMA = schema.writableJsonObject({
  description:
    "A bounded writable JSON object. Tenant, actor, signature, price-authority, storage, and provider-secret fields are rejected recursively."
});

export function pathSchema(
  properties: Readonly<Record<string, RuntimeSchema>> = {}
): RuntimeSchema {
  return schema.object(properties, Object.keys(properties));
}

export function querySchema(
  properties: Readonly<Record<string, RuntimeSchema>> = {},
  options: { readonly paginated?: boolean } = {}
): RuntimeSchema {
  const queryProperties = options.paginated ? { ...properties, limit: LIMIT_SCHEMA } : properties;
  return schema.object(queryProperties);
}

export function bodySchema(
  properties: Readonly<Record<string, RuntimeSchema>>,
  required: readonly string[] = [],
  options: Omit<RuntimeSchema, "type" | "properties" | "required" | "additionalProperties"> = {}
): RuntimeSchema {
  return schema.object(properties, required, options);
}

export function responseSchema(
  properties: Readonly<Record<string, RuntimeSchema>>,
  required: readonly string[] = Object.keys(properties)
): RuntimeSchema {
  return schema.object(properties, required);
}

export function headersSchema(input: {
  readonly auth: OperationAuth;
  readonly mutation?: boolean;
  readonly concurrency?: boolean;
  readonly contentType?: "application/json" | "application/octet-stream";
}): RuntimeSchema {
  const properties: Record<string, RuntimeSchema> = {
    "x-request-id": REQUEST_ID_SCHEMA
  };
  const required: string[] = [];
  if (input.auth === "bearer") {
    properties.authorization = schema.string({
      minLength: 8,
      maxLength: 8192,
      pattern: "^Bearer\\s+\\S+$"
    });
    properties["x-clinic-id"] = UUID_PATH_SCHEMA;
    required.push("authorization");
  }
  if (input.auth === "razorpay_signature") {
    properties["x-razorpay-signature"] = schema.string({ minLength: 16, maxLength: 1024 });
    required.push("x-razorpay-signature");
  }
  if (input.mutation && input.auth === "bearer") {
    properties["idempotency-key"] = IDEMPOTENCY_KEY_SCHEMA;
    required.push("idempotency-key");
  }
  if (input.concurrency) {
    properties["if-match"] = IF_MATCH_SCHEMA;
    required.push("if-match");
  }
  if (input.contentType) {
    properties["content-type"] = schema.enum([input.contentType]);
    required.push("content-type");
  }
  return schema.object(properties, required);
}

export function defineOperation(
  input: Omit<
    HttpOperationContract,
    "idempotency" | "concurrency" | "pagination" | "integration"
  > & {
    readonly mutation?: boolean;
    readonly optimisticConcurrency?: boolean;
    readonly paginated?: boolean;
    readonly providerEventIdempotency?: boolean;
    readonly integration?: Partial<HttpOperationContract["integration"]>;
  }
): HttpOperationContract {
  const mutation = input.mutation ?? false;
  const optimisticConcurrency = input.optimisticConcurrency ?? false;
  const paginated = input.paginated ?? false;
  return {
    operationId: input.operationId,
    checkpoint: input.checkpoint,
    method: input.method,
    path: input.path,
    summary: input.summary,
    description: input.description,
    tags: input.tags,
    auth: input.auth,
    phi: input.phi,
    cache: input.cache,
    request: input.request,
    responses: input.responses,
    idempotency: input.providerEventIdempotency
      ? {
          mode: "provider_event",
          required: true,
          replaySemantics:
            "The verified provider event identifier is the replay key; duplicate effects are forbidden."
        }
      : mutation && input.auth === "bearer"
        ? {
            mode: "header",
            header: "idempotency-key",
            required: true,
            replaySemantics:
              "The same actor, clinic, operation, key, and canonical request digest must replay the original result."
          }
        : {
            mode: "none",
            required: false,
            replaySemantics: "This operation has no client mutation effect."
          },
    concurrency: optimisticConcurrency
      ? {
          mode: "if-match",
          header: "if-match",
          required: true,
          semantics: "The version/ETag must match the current resource version before mutation."
        }
      : {
          mode: "none",
          required: false,
          semantics: "This operation does not replace mutable resource state."
        },
    pagination: paginated
      ? { mode: "bounded", defaultLimit: 50, maximumLimit: 100, cursor: false }
      : { mode: "none", cursor: false },
    integration: {
      nativeRuntimeEnforcement: input.integration?.nativeRuntimeEnforcement ?? "body-parser-only",
      requiredMasterWiring: input.integration?.requiredMasterWiring ?? [
        "Invoke the runtime contract before the native or NestJS handler.",
        ...(mutation && input.auth === "bearer"
          ? [
              "Persist and replay idempotency records by actor, clinic, operation, key, and request digest."
            ]
          : []),
        ...(optimisticConcurrency
          ? ["Emit resource ETags and enforce If-Match atomically in the repository write."]
          : [])
      ]
    }
  };
}

export function parseOperationRequest(
  operation: HttpOperationContract,
  input: OperationRequestInput
): OperationRequestResult {
  const normalizedHeaders = normalizeHeaders(input.headers);
  const locations = [
    ["path", operation.request.path, input.path ?? {}],
    ["query", operation.request.query, normalizeQuery(input.query)],
    ["headers", operation.request.headers, normalizedHeaders]
  ] as const;
  const issues: OperationRequestIssue[] = [];
  const parsed: {
    path: JsonValue;
    query: JsonValue;
    headers: JsonValue;
    body?: JsonValue | Uint8Array;
  } = { path: {}, query: {}, headers: {} };

  for (const [location, definition, value] of locations) {
    const result = parseRuntimeSchema(definition, value);
    if (result.success) parsed[location] = result.data;
    else issues.push(...result.issues.map((candidate) => ({ ...candidate, location })));
  }

  if (operation.request.body) {
    const result = parseRuntimeSchema<JsonValue | Uint8Array>(
      operation.request.body.schema,
      input.body
    );
    if (result.success) parsed.body = result.data;
    else
      issues.push(
        ...result.issues.map((candidate) => ({ ...candidate, location: "body" as const }))
      );
  } else if (input.body !== undefined) {
    issues.push({
      location: "body",
      path: "$",
      code: "unknown_field",
      message: "This operation does not accept a request body."
    });
  }

  return issues.length > 0 ? { success: false, issues } : { success: true, data: parsed };
}

export function parseOperationResponse(
  operation: HttpOperationContract,
  status: number,
  body: unknown
): RuntimeSchemaResult {
  const response = operation.responses[status];
  if (response) return parseRuntimeSchema(response.schema, body);
  if (status >= 400) return parseRuntimeSchema(API_ERROR_SCHEMA, body);
  return {
    success: false,
    issues: [
      {
        path: "$",
        code: "unsupported_value",
        message: `Status ${status} is not declared for ${operation.operationId}.`
      }
    ]
  };
}

function normalizeHeaders(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).map(([key, value]) => [
      key.toLowerCase(),
      value
    ])
  );
}

function normalizeQuery(input: unknown): unknown {
  if (input instanceof URLSearchParams) {
    return Object.fromEntries(
      [...input.entries()].map(([key, value]) => {
        if (key === "limit") return [key, Number(value)];
        if (value === "true") return [key, true];
        if (value === "false") return [key, false];
        return [key, value];
      })
    );
  }
  return input ?? {};
}
