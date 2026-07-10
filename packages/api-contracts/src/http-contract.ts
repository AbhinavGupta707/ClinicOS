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
  readonly strongEtagFormat?: '"rv-<rowVersion>"';
  readonly versionProperty?: "rowVersion";
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
  readonly headers: Readonly<Record<string, HttpResponseHeaderContract>>;
}

export interface HttpResponseHeaderContract {
  readonly description: string;
  readonly required: boolean;
  readonly schema: RuntimeSchema;
  readonly sourceProperty?: string;
}

export type HttpResponseDefinition = Omit<HttpResponseContract, "headers">;

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
export const ROW_VERSION_SCHEMA = schema.integer({
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
  description: "Positive safe integer incremented by each successful conditional write."
});
export const STRONG_ROW_VERSION_ETAG_SCHEMA = schema.string({
  minLength: 6,
  maxLength: 21,
  format: "strong-row-version-etag",
  pattern: '^"rv-[1-9][0-9]{0,15}"$',
  description:
    'Canonical strong ETag derived from rowVersion: rowVersion 7 is represented as "rv-7".'
});
export const IF_MATCH_SCHEMA = STRONG_ROW_VERSION_ETAG_SCHEMA;
export const IDEMPOTENCY_REPLAYED_HEADER_SCHEMA = schema.enum(["false", "true"], {
  type: "string",
  description:
    "Required wire boolean: false on first execution and true when a persisted response is replayed."
});
export const RETRY_AFTER_SECONDS_HEADER_SCHEMA = schema.string({
  minLength: 1,
  maxLength: 5,
  format: "retry-after-seconds",
  pattern: "^[1-9][0-9]{0,4}$",
  description: "Bounded delta-seconds before the client should retry a rate-limited request."
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
export const VERSIONED_PUBLIC_RESOURCE_SCHEMA: RuntimeSchema = {
  ...schema.publicJsonObject({
    description:
      "A bounded public resource with a discoverable optimistic-concurrency version. Additional fields retain recursive public-field filtering.",
    properties: {
      id: UUID_PATH_SCHEMA,
      rowVersion: ROW_VERSION_SCHEMA
    },
    required: ["id", "rowVersion"],
    minProperties: 2
  }),
  "x-clinicos-json-kind": "versioned-public"
};
export const VERSIONED_PUBLIC_RESOURCE_ARRAY_SCHEMA = schema.array(
  VERSIONED_PUBLIC_RESOURCE_SCHEMA,
  { maxItems: 100 }
);
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
    "idempotency" | "concurrency" | "pagination" | "integration" | "responses"
  > & {
    readonly responses: Readonly<Record<number, HttpResponseDefinition>>;
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
  const idempotency: IdempotencyContract = input.providerEventIdempotency
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
        };
  const concurrency: OptimisticConcurrencyContract = optimisticConcurrency
    ? {
        mode: "if-match",
        header: "if-match",
        required: true,
        strongEtagFormat: '"rv-<rowVersion>"',
        versionProperty: "rowVersion",
        semantics:
          'If-Match must contain the current canonical strong ETag "rv-<rowVersion>" and the repository must compare/increment rowVersion atomically.'
      }
    : {
        mode: "none",
        required: false,
        semantics: "This operation does not replace mutable resource state."
      };
  const responses = Object.fromEntries(
    Object.entries(input.responses).map(([status, response]) => [
      Number(status),
      {
        ...response,
        headers: responseHeaders({
          status: Number(status),
          idempotency,
          schema: response.schema
        })
      }
    ])
  );
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
    responses,
    idempotency,
    concurrency,
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

function responseHeaders(input: {
  readonly status: number;
  readonly idempotency: IdempotencyContract;
  readonly schema: RuntimeSchema;
}): Readonly<Record<string, HttpResponseHeaderContract>> {
  const headers: Record<string, HttpResponseHeaderContract> = {
    "x-request-id": {
      description: "Stable request correlation identifier.",
      required: true,
      schema: REQUEST_ID_SCHEMA
    }
  };
  const successful = input.status >= 200 && input.status < 300;
  if (successful && input.idempotency.mode === "header") {
    headers["idempotency-replayed"] = {
      description:
        "Literal wire value false on first execution and true when the response was replayed from the persisted idempotency record.",
      required: true,
      schema: IDEMPOTENCY_REPLAYED_HEADER_SCHEMA
    };
  }
  const versionedProperty = successful
    ? unambiguousSingletonVersionedResourcePath(input.schema)
    : undefined;
  if (versionedProperty) {
    headers.ETag = {
      description: `Canonical strong ETag derived from ${versionedProperty}.rowVersion.`,
      required: true,
      schema: STRONG_ROW_VERSION_ETAG_SCHEMA,
      sourceProperty: versionedProperty
    };
  }
  if (input.status === 429) {
    headers["Retry-After"] = {
      description: "Bounded delta-seconds before the request should be retried.",
      required: true,
      schema: RETRY_AFTER_SECONDS_HEADER_SCHEMA
    };
  }
  return headers;
}

function unambiguousSingletonVersionedResourcePath(definition: RuntimeSchema): string | undefined {
  const paths = collectSingletonVersionedResourcePaths(definition, "");
  return paths.length === 1 ? paths[0] : undefined;
}

function collectSingletonVersionedResourcePaths(definition: RuntimeSchema, path: string): string[] {
  if (definition["x-clinicos-json-kind"] === "versioned-public") return [path];
  if (definition.type !== "object") return [];
  return Object.entries(definition.properties ?? {}).flatMap(([name, property]) => {
    if (property.type === "array") return [];
    const nestedPath = path ? `${path}.${name}` : name;
    return collectSingletonVersionedResourcePaths(property, nestedPath);
  });
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

export function parseOperationResponseHeaders(
  operation: HttpOperationContract,
  status: number,
  input: unknown
): RuntimeSchemaResult {
  const response = operation.responses[status];
  if (!response) {
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
  const available = normalizeHeaders(input);
  const properties = Object.fromEntries(
    Object.entries(response.headers).map(([name, contract]) => [
      name.toLowerCase(),
      contract.schema
    ])
  );
  const required = Object.entries(response.headers)
    .filter(([, contract]) => contract.required)
    .map(([name]) => name.toLowerCase());
  const selected = Object.fromEntries(
    Object.keys(properties)
      .filter((name) => available[name] !== undefined)
      .map((name) => [name, available[name]])
  );
  return parseRuntimeSchema(schema.object(properties, required), selected);
}

function normalizeHeaders(input: unknown): Record<string, unknown> {
  if (
    input &&
    typeof input === "object" &&
    "entries" in input &&
    typeof (input as { entries?: unknown }).entries === "function"
  ) {
    return Object.fromEntries(
      Array.from(
        (input as { entries(): IterableIterator<[string, string]> }).entries(),
        ([key, value]) => [key.toLowerCase(), value]
      )
    );
  }
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
