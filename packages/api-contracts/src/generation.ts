import {
  ACTIVE_NATIVE_HTTP_OPERATIONS,
  DEFERRED_OR_UNREGISTERED_HTTP_WORKFLOWS,
  VERSIONED_RESOURCE_RESPONSE_CONTRACTS
} from "./native-http-contracts.ts";
import {
  API_ERROR_CODES,
  API_ERROR_SCHEMA,
  PUBLIC_RECORD_SCHEMA,
  VERSIONED_PUBLIC_RESOURCE_SCHEMA,
  WRITABLE_JSON_SCHEMA,
  type HttpOperationContract
} from "./http-contract.ts";
import type { JsonPrimitive, RuntimeSchema } from "./runtime-schema.ts";

export interface NativeOpenApiDocument {
  readonly openapi: "3.1.0";
  readonly jsonSchemaDialect: string;
  readonly info: Readonly<Record<string, string>>;
  readonly paths: Readonly<Record<string, unknown>>;
  readonly components: Readonly<Record<string, unknown>>;
  readonly tags: readonly { readonly name: string }[];
  readonly "x-clinicos-contract-source": string;
  readonly "x-clinicos-deferred-workflows": typeof DEFERRED_OR_UNREGISTERED_HTTP_WORKFLOWS;
  readonly "x-clinicos-versioned-resource-responses": typeof VERSIONED_RESOURCE_RESPONSE_CONTRACTS;
}

export function generateNativeOpenApiDocument(): NativeOpenApiDocument {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of ACTIVE_NATIVE_HTTP_OPERATIONS) {
    const pathItem = (paths[operation.path] ??= {});
    pathItem[operation.method.toLowerCase()] = openApiOperation(operation);
  }
  const tags = [...new Set(ACTIVE_NATIVE_HTTP_OPERATIONS.flatMap((operation) => operation.tags))]
    .sort()
    .map((name) => ({ name }));
  return {
    openapi: "3.1.0",
    jsonSchemaDialect: "https://json-schema.org/draft/2020-12/schema",
    info: {
      title: "ClinicOS Native HTTP Strangler Contract",
      version: "0.12.0",
      description:
        "Generated from the CP12 runtime contract registry. It inventories the registered native HTTP surface without claiming that later NestJS wiring or provider activation is complete."
    },
    paths,
    components: {
      schemas: {
        ApiError: toOpenApiSchema(API_ERROR_SCHEMA, false),
        PublicJsonObject: toOpenApiSchema(PUBLIC_RECORD_SCHEMA, false),
        VersionedPublicResource: toOpenApiSchema(VERSIONED_PUBLIC_RESOURCE_SCHEMA, false),
        WritableJsonObject: toOpenApiSchema(WRITABLE_JSON_SCHEMA, false)
      },
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        razorpaySignature: {
          type: "apiKey",
          in: "header",
          name: "x-razorpay-signature",
          description: "Razorpay HMAC signature over the bounded raw request body."
        }
      }
    },
    tags,
    "x-clinicos-contract-source": "packages/api-contracts/src/native-http-contracts.ts",
    "x-clinicos-deferred-workflows": DEFERRED_OR_UNREGISTERED_HTTP_WORKFLOWS,
    "x-clinicos-versioned-resource-responses": VERSIONED_RESOURCE_RESPONSE_CONTRACTS
  };
}

export function renderNativeOpenApi(): string {
  return `${JSON.stringify(sortJson(generateNativeOpenApiDocument()), null, 2)}\n`;
}

export function renderNativeRouteInventory(): string {
  const inventory = {
    generatedFrom: "packages/api-contracts/src/native-http-contracts.ts",
    activeOperationCount: ACTIVE_NATIVE_HTTP_OPERATIONS.length,
    active: ACTIVE_NATIVE_HTTP_OPERATIONS.map((operation) => ({
      operationId: operation.operationId,
      checkpoint: operation.checkpoint,
      method: operation.method,
      path: operation.path,
      auth: operation.auth,
      phi: operation.phi,
      bodyMaximumBytes: operation.request.body?.maximumBytes ?? null,
      idempotency: operation.idempotency,
      concurrency: operation.concurrency,
      pagination: operation.pagination,
      nativeRuntimeEnforcement: operation.integration.nativeRuntimeEnforcement
    })),
    versionedResourceResponseContracts: VERSIONED_RESOURCE_RESPONSE_CONTRACTS,
    deferred: DEFERRED_OR_UNREGISTERED_HTTP_WORKFLOWS
  };
  return `${JSON.stringify(sortJson(inventory), null, 2)}\n`;
}

export function renderGeneratedClient(): string {
  const chunks: string[] = [GENERATED_CLIENT_PREAMBLE];
  for (const operation of ACTIVE_NATIVE_HTTP_OPERATIONS) {
    const typeName = pascalCase(operation.operationId);
    chunks.push(`export type ${typeName}Request = ${operationRequestType(operation)};`);
    chunks.push(`export type ${typeName}Response = ${operationResponseType(operation)};`);
  }
  chunks.push("", "export interface ClinicOsNativeOperationMap {");
  for (const operation of ACTIVE_NATIVE_HTTP_OPERATIONS) {
    const typeName = pascalCase(operation.operationId);
    chunks.push(
      `  readonly ${operation.operationId}: { readonly request: ${typeName}Request; readonly response: ${typeName}Response };`
    );
  }
  chunks.push("}", "", "export class ClinicOsApiClient {", GENERATED_CLIENT_CLASS_CORE);
  for (const operation of ACTIVE_NATIVE_HTTP_OPERATIONS) {
    chunks.push(renderClientMethod(operation));
  }
  chunks.push("}", "");
  return `${chunks
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd()}\n`;
}

function openApiOperation(operation: HttpOperationContract): Record<string, unknown> {
  const parameters = [
    ...schemaParameters(operation.request.path, "path"),
    ...schemaParameters(operation.request.query, "query"),
    ...schemaParameters(
      operation.request.headers,
      "header",
      new Set(["authorization", "content-type", "x-razorpay-signature"])
    )
  ];
  const responses = Object.fromEntries(
    Object.entries(operation.responses)
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([status, response]) => [
        status,
        {
          description: response.description,
          headers: Object.fromEntries(
            Object.entries(response.headers).map(([name, header]) => [
              name,
              {
                description: header.description,
                schema: toOpenApiSchema(header.schema),
                "x-clinicos-required": header.required,
                ...(header.sourceProperty
                  ? { "x-clinicos-source-property": header.sourceProperty }
                  : {})
              }
            ])
          ),
          content: { "application/json": { schema: toOpenApiSchema(response.schema) } }
        }
      ])
  );
  return {
    operationId: operation.operationId,
    summary: operation.summary,
    description: operation.description,
    tags: operation.tags,
    security:
      operation.auth === "bearer"
        ? [{ bearerAuth: [] }]
        : operation.auth === "razorpay_signature"
          ? [{ razorpaySignature: [] }]
          : [],
    parameters,
    ...(operation.request.body
      ? {
          requestBody: {
            required: true,
            content: {
              [operation.request.body.contentType]: {
                schema: toOpenApiSchema(operation.request.body.schema)
              }
            },
            "x-maximum-bytes": operation.request.body.maximumBytes
          }
        }
      : {}),
    responses,
    "x-clinicos-checkpoint": operation.checkpoint,
    "x-clinicos-phi": operation.phi,
    "x-clinicos-cache": operation.cache,
    "x-clinicos-idempotency": operation.idempotency,
    "x-clinicos-concurrency": operation.concurrency,
    "x-clinicos-pagination": operation.pagination,
    "x-clinicos-native-enforcement": operation.integration.nativeRuntimeEnforcement,
    "x-clinicos-required-master-wiring": operation.integration.requiredMasterWiring
  };
}

function schemaParameters(
  definition: RuntimeSchema,
  location: "header" | "path" | "query",
  excluded: ReadonlySet<string> = new Set()
): Record<string, unknown>[] {
  const required = new Set(definition.required ?? []);
  return Object.entries(definition.properties ?? {})
    .filter(([name]) => !excluded.has(name))
    .map(([name, property]) => ({
      name,
      in: location,
      required: location === "path" || required.has(name),
      schema: toOpenApiSchema(property)
    }));
}

function toOpenApiSchema(
  definition: RuntimeSchema,
  useSharedReferences = true
): Record<string, unknown> {
  if (useSharedReferences) {
    if (definition === API_ERROR_SCHEMA) return { $ref: "#/components/schemas/ApiError" };
    if (definition["x-clinicos-json-kind"] === "versioned-public") {
      return { $ref: "#/components/schemas/VersionedPublicResource" };
    }
    if (definition["x-clinicos-json-kind"] === "public") {
      return { $ref: "#/components/schemas/PublicJsonObject" };
    }
    if (definition["x-clinicos-json-kind"] === "writable") {
      return { $ref: "#/components/schemas/WritableJsonObject" };
    }
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(definition)) {
    if (value === undefined) continue;
    if (key === "properties") {
      output.properties = Object.fromEntries(
        Object.entries(value as Record<string, RuntimeSchema>).map(([name, nested]) => [
          name,
          toOpenApiSchema(nested)
        ])
      );
    } else if (key === "items" || key === "additionalProperties") {
      output[key] = typeof value === "object" ? toOpenApiSchema(value as RuntimeSchema) : value;
    } else if (key === "anyOf" || key === "oneOf") {
      output[key] = (value as RuntimeSchema[]).map((nested) => toOpenApiSchema(nested));
    } else if (key !== "nullable") {
      output[key] = value;
    }
  }
  if (definition.nullable) {
    const type = output.type;
    if (typeof type === "string") output.type = [type, "null"];
    else output.anyOf = [...((output.anyOf as unknown[]) ?? []), { type: "null" }];
  }
  return output;
}

function operationRequestType(operation: HttpOperationContract): string {
  const members: string[] = [];
  const pathType = objectType(operation.request.path);
  const queryType = objectType(operation.request.query);
  const manualHeaderSchema = clientHeaderSchema(operation.request.headers);
  const headersType = objectType(manualHeaderSchema);
  if (Object.keys(operation.request.path.properties ?? {}).length > 0)
    members.push(`readonly path: ${pathType}`);
  if (Object.keys(operation.request.query.properties ?? {}).length > 0)
    members.push(`readonly query?: ${queryType}`);
  if (Object.keys(manualHeaderSchema.properties ?? {}).length > 0) {
    const required = (manualHeaderSchema.required ?? []).length > 0;
    members.push(`readonly headers${required ? "" : "?"}: ${headersType}`);
  }
  if (operation.request.body)
    members.push(`readonly body: ${schemaType(operation.request.body.schema)}`);
  return members.length === 0 ? "Readonly<Record<string, never>>" : `{ ${members.join("; ")} }`;
}

function operationResponseType(operation: HttpOperationContract): string {
  const successSchemas = Object.entries(operation.responses)
    .filter(
      ([status]) =>
        Number(status) < 400 || (operation.path.startsWith("/health/") && Number(status) === 503)
    )
    .map(([, response]) => schemaType(response.schema));
  return [...new Set(successSchemas)].join(" | ") || "never";
}

function clientHeaderSchema(definition: RuntimeSchema): RuntimeSchema {
  const excluded = new Set(["authorization", "content-type", "x-clinic-id", "x-request-id"]);
  const properties = Object.fromEntries(
    Object.entries(definition.properties ?? {}).filter(([name]) => !excluded.has(name))
  );
  const required = (definition.required ?? []).filter((name) => !excluded.has(name));
  return { type: "object", properties, required, additionalProperties: false };
}

function objectType(definition: RuntimeSchema): string {
  return schemaType(definition);
}

function schemaType(definition: RuntimeSchema): string {
  let result: string;
  if (definition.enum) {
    result = definition.enum.map(literalType).join(" | ");
  } else if (definition.oneOf || definition.anyOf) {
    const variants = definition.oneOf ?? definition.anyOf ?? [];
    if (definition.type === "object" || definition.properties) {
      result = variants
        .map((variant) =>
          schemaType({
            ...definition,
            ...variant,
            type: variant.type ?? definition.type,
            properties: {
              ...(definition.properties ?? {}),
              ...(variant.properties ?? {})
            },
            required: [...new Set([...(definition.required ?? []), ...(variant.required ?? [])])],
            nullable: false,
            oneOf: undefined,
            anyOf: undefined
          })
        )
        .join(" | ");
    } else {
      result = variants.map(schemaType).join(" | ");
    }
  } else if (definition.type === "string") {
    result = definition.format === "binary" ? "Uint8Array" : "string";
  } else if (definition.type === "number" || definition.type === "integer") {
    result = "number";
  } else if (definition.type === "boolean") {
    result = "boolean";
  } else if (definition.type === "array") {
    result = `readonly (${schemaType(definition.items ?? {})})[]`;
  } else if (definition.type === "object") {
    if (definition["x-clinicos-json-kind"] === "versioned-public")
      result = "VersionedPublicResource";
    else if (definition["x-clinicos-json-kind"] === "public") result = "PublicJsonObject";
    else if (definition["x-clinicos-json-kind"] === "writable") result = "WritableJsonObject";
    else {
      const required = new Set(definition.required ?? []);
      const properties = Object.entries(definition.properties ?? {}).map(
        ([name, nested]) =>
          `readonly ${propertyName(name)}${required.has(name) ? "" : "?"}: ${schemaType(nested)}`
      );
      result =
        properties.length > 0 ? `{ ${properties.join("; ")} }` : "Readonly<Record<string, never>>";
    }
  } else {
    result = "JsonValue";
  }
  return definition.nullable && !result.includes("null") ? `${result} | null` : result;
}

function renderClientMethod(operation: HttpOperationContract): string {
  const typeName = pascalCase(operation.operationId);
  const requestRequired = generatedRequestRequired(operation);
  const successStatuses = Object.keys(operation.responses)
    .map(Number)
    .filter((status) => status < 400 || (operation.path.startsWith("/health/") && status === 503));
  const contentType = operation.request.body?.contentType ?? null;
  const bodyEncoding = operation.request.body?.schema.format === "binary" ? "raw" : "json";
  return `
  async ${operation.operationId}(input${requestRequired ? "" : "?"}: ${typeName}Request): Promise<${typeName}Response> {
    return this.execute<${typeName}Response>({
      method: ${JSON.stringify(operation.method)},
      pathTemplate: ${JSON.stringify(operation.path)},
      auth: ${JSON.stringify(operation.auth)},
      contentType: ${JSON.stringify(contentType)},
      bodyEncoding: ${JSON.stringify(bodyEncoding)},
      successStatuses: ${JSON.stringify(successStatuses)},
      input: input ?? {}
    });
  }

  async ${operation.operationId}WithMetadata(input${requestRequired ? "" : "?"}: ${typeName}Request): Promise<ClinicOsApiResponse<${typeName}Response>> {
    return this.executeWithMetadata<${typeName}Response>({
      method: ${JSON.stringify(operation.method)},
      pathTemplate: ${JSON.stringify(operation.path)},
      auth: ${JSON.stringify(operation.auth)},
      contentType: ${JSON.stringify(contentType)},
      bodyEncoding: ${JSON.stringify(bodyEncoding)},
      successStatuses: ${JSON.stringify(successStatuses)},
      input: input ?? {}
    });
  }`;
}

function generatedRequestRequired(operation: HttpOperationContract): boolean {
  if (operation.request.body) return true;
  if ((operation.request.path.required ?? []).length > 0) return true;
  const manualHeaders = clientHeaderSchema(operation.request.headers);
  return (manualHeaders.required ?? []).length > 0;
}

function literalType(value: JsonPrimitive): string {
  return value === null ? "null" : JSON.stringify(value);
}

function propertyName(value: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value);
}

function pascalCase(value: string): string {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, sortJson(nested)])
  );
}

const GENERATED_CLIENT_PREAMBLE = `/* eslint-disable */
// Generated by scripts/cp12-openapi-generate.mjs. Do not edit by hand.

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type PublicJsonObject = Readonly<Record<string, JsonValue>>;
export type VersionedPublicResource = PublicJsonObject & { readonly id: string; readonly rowVersion: number };
export type WritableJsonObject = Readonly<Record<string, JsonValue>>;
export type ClinicOsApiErrorCode = ${API_ERROR_CODES.map((code) => JSON.stringify(code)).join(" | ")};

export interface ClinicOsApiResponseMetadata {
  readonly status: number;
  readonly requestId: string | null;
  readonly etag: string | null;
  readonly idempotencyReplayed: boolean;
  readonly retryAfterSeconds: number | null;
}

export interface ClinicOsApiResponse<T> {
  readonly body: T;
  readonly metadata: ClinicOsApiResponseMetadata;
}

export interface ClinicOsApiClientOptions {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly getAccessToken?: () => string | null | Promise<string | null>;
  readonly clinicId?: string;
  readonly getRequestId?: () => string | undefined;
}

export interface ClinicOsApiErrorBody {
  readonly error: {
    readonly code: ClinicOsApiErrorCode;
    readonly message: string;
    readonly details: PublicJsonObject;
    readonly request_id: string;
  };
}

export class ClinicOsApiError extends Error {
  readonly status: number;
  readonly code: ClinicOsApiErrorCode;
  readonly details: PublicJsonObject;
  readonly requestId: string;
  readonly responseMetadata: ClinicOsApiResponseMetadata;

  constructor(status: number, body: ClinicOsApiErrorBody, metadata?: ClinicOsApiResponseMetadata) {
    super(body.error.message);
    this.name = "ClinicOsApiError";
    this.status = status;
    this.code = body.error.code;
    this.details = body.error.details;
    this.requestId = body.error.request_id;
    this.responseMetadata = metadata ?? {
      status,
      requestId: body.error.request_id,
      etag: null,
      idempotencyReplayed: false,
      retryAfterSeconds: null
    };
  }
}

interface GeneratedRequestInput {
  readonly path?: Readonly<Record<string, unknown>>;
  readonly query?: Readonly<Record<string, unknown>>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

interface ExecuteInput {
  readonly method: "GET" | "PATCH" | "POST" | "PUT";
  readonly pathTemplate: string;
  readonly auth: "bearer" | "none" | "razorpay_signature";
  readonly contentType: "application/json" | "application/octet-stream" | null;
  readonly bodyEncoding: "json" | "raw";
  readonly successStatuses: readonly number[];
  readonly input: GeneratedRequestInput;
}

function interpolatePath(template: string, values: Readonly<Record<string, unknown>>): string {
  return template.replace(/\\{([^}]+)\\}/g, (_match, key: string) => {
    const value = values[key];
    if (typeof value !== "string" || value.length === 0) {
      throw new TypeError("Missing generated-client path parameter: " + key);
    }
    return encodeURIComponent(value);
  });
}

function appendQuery(url: string, values?: Readonly<Record<string, unknown>>): string {
  if (!values) return url;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((item) => query.append(key, String(item)));
    else query.set(key, String(value));
  }
  const serialized = query.toString();
  return serialized ? url + "?" + serialized : url;
}

function parseIdempotencyReplayed(value: string | null): boolean {
  if (value === null || value === "false") return false;
  if (value === "true") return true;
  throw new TypeError("Invalid idempotency-replayed response header.");
}

function parseRetryAfterSeconds(value: string | null): number | null {
  if (value === null) return null;
  if (!/^[1-9][0-9]{0,4}$/.test(value)) {
    throw new TypeError("Invalid Retry-After response header.");
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400) {
    throw new TypeError("Retry-After response header is outside the supported delta-seconds range.");
  }
  return seconds;
}

function parseStrongRowVersionEtag(value: string | null): string | null {
  if (value === null) return null;
  const match = /^"rv-([1-9][0-9]{0,15})"$/.exec(value);
  const rowVersion = Number(match?.[1]);
  if (!match || !Number.isSafeInteger(rowVersion) || rowVersion < 1) {
    throw new TypeError("Invalid strong row-version ETag response header.");
  }
  return value;
}

function extractResponseMetadata(response: Response): ClinicOsApiResponseMetadata {
  return {
    status: response.status,
    requestId: response.headers.get("x-request-id"),
    etag: parseStrongRowVersionEtag(response.headers.get("etag")),
    idempotencyReplayed: parseIdempotencyReplayed(
      response.headers.get("idempotency-replayed")
    ),
    retryAfterSeconds: parseRetryAfterSeconds(response.headers.get("retry-after"))
  };
}`;

const GENERATED_CLIENT_CLASS_CORE = `  readonly #options: ClinicOsApiClientOptions;
  readonly #fetch: typeof fetch;

  constructor(options: ClinicOsApiClientOptions) {
    this.#options = options;
    this.#fetch = options.fetchImpl ?? fetch;
  }

  async execute<T>(operation: ExecuteInput): Promise<T> {
    return (await this.executeWithMetadata<T>(operation)).body;
  }

  async executeWithMetadata<T>(operation: ExecuteInput): Promise<ClinicOsApiResponse<T>> {
    const headers: Record<string, string> = { ...(operation.input.headers ?? {}) };
    if (operation.auth === "bearer") {
      const token = await this.#options.getAccessToken?.();
      if (!token) throw new Error("ClinicOS bearer authentication is required for this operation.");
      headers.authorization = \`Bearer \${token}\`;
      if (this.#options.clinicId) headers["x-clinic-id"] = this.#options.clinicId;
    }
    const requestId = this.#options.getRequestId?.();
    if (requestId) headers["x-request-id"] = requestId;
    let body: string | Uint8Array<ArrayBuffer> | undefined;
    if (operation.bodyEncoding === "raw") {
      if (!operation.contentType) throw new TypeError("Raw ClinicOS operations require a content type.");
      headers["content-type"] = operation.contentType;
      if (!(operation.input.body instanceof Uint8Array)) {
        throw new TypeError("Binary ClinicOS operations require a Uint8Array body.");
      }
      const rawBody = new Uint8Array(operation.input.body.byteLength);
      rawBody.set(operation.input.body);
      body = rawBody;
    } else if (operation.contentType === "application/json") {
      headers["content-type"] = "application/json";
      body = JSON.stringify(operation.input.body ?? {});
    }
    const path = interpolatePath(operation.pathTemplate, operation.input.path ?? {});
    const url = appendQuery(\`\${this.#options.baseUrl.replace(/\\/$/, "")}\${path}\`, operation.input.query);
    const response = await this.#fetch(url, { method: operation.method, headers, ...(body === undefined ? {} : { body }) });
    const metadata = extractResponseMetadata(response);
    const payload = (await response.json()) as T | ClinicOsApiErrorBody;
    if (!operation.successStatuses.includes(response.status)) {
      throw new ClinicOsApiError(response.status, payload as ClinicOsApiErrorBody, metadata);
    }
    return { body: payload as T, metadata };
  }`;
