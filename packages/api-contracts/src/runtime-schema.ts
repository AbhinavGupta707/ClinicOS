export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface RuntimeSchema {
  readonly type?: "array" | "boolean" | "integer" | "number" | "object" | "string";
  readonly description?: string;
  readonly format?: "binary" | "date" | "date-time" | "email" | "sha256" | "uuid";
  readonly pattern?: string;
  readonly enum?: readonly JsonPrimitive[];
  readonly properties?: Readonly<Record<string, RuntimeSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | RuntimeSchema;
  readonly items?: RuntimeSchema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minProperties?: number;
  readonly maxProperties?: number;
  readonly anyOf?: readonly RuntimeSchema[];
  readonly oneOf?: readonly RuntimeSchema[];
  readonly nullable?: boolean;
  readonly deprecated?: boolean;
  readonly readOnly?: boolean;
  readonly writeOnly?: boolean;
  readonly "x-clinicos-json-kind"?: "public" | "writable";
  readonly "x-clinicos-forbidden-property-names"?: readonly string[];
}

export interface RuntimeSchemaIssue {
  readonly path: string;
  readonly code:
    | "authority_field"
    | "format"
    | "invalid_type"
    | "missing_required"
    | "out_of_range"
    | "unknown_field"
    | "unsupported_value";
  readonly message: string;
}

export type RuntimeSchemaResult<T = JsonValue> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly RuntimeSchemaIssue[] };

export class RuntimeSchemaValidationError extends Error {
  readonly code = "CONTRACT_VALIDATION_FAILED";
  readonly issues: readonly RuntimeSchemaIssue[];

  constructor(issues: readonly RuntimeSchemaIssue[]) {
    super("Contract payload failed runtime validation.");
    this.name = "RuntimeSchemaValidationError";
    this.issues = issues;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export const schema = {
  string(options: Omit<RuntimeSchema, "type"> = {}): RuntimeSchema {
    return { type: "string", maxLength: 4096, ...options };
  },
  uuid(options: Omit<RuntimeSchema, "type" | "format"> = {}): RuntimeSchema {
    return { type: "string", format: "uuid", ...options };
  },
  date(options: Omit<RuntimeSchema, "type" | "format"> = {}): RuntimeSchema {
    return { type: "string", format: "date", ...options };
  },
  dateTime(options: Omit<RuntimeSchema, "type" | "format"> = {}): RuntimeSchema {
    return { type: "string", format: "date-time", ...options };
  },
  sha256(options: Omit<RuntimeSchema, "type" | "format"> = {}): RuntimeSchema {
    return { type: "string", format: "sha256", ...options };
  },
  boolean(options: Omit<RuntimeSchema, "type"> = {}): RuntimeSchema {
    return { type: "boolean", ...options };
  },
  number(options: Omit<RuntimeSchema, "type"> = {}): RuntimeSchema {
    return { type: "number", ...options };
  },
  integer(options: Omit<RuntimeSchema, "type"> = {}): RuntimeSchema {
    return { type: "integer", ...options };
  },
  enum(values: readonly JsonPrimitive[], options: Omit<RuntimeSchema, "enum"> = {}): RuntimeSchema {
    return { ...options, enum: values };
  },
  array(items: RuntimeSchema, options: Omit<RuntimeSchema, "type" | "items"> = {}): RuntimeSchema {
    return { type: "array", items, maxItems: 100, ...options };
  },
  object(
    properties: Readonly<Record<string, RuntimeSchema>>,
    required: readonly string[] = [],
    options: Omit<RuntimeSchema, "type" | "properties" | "required" | "additionalProperties"> = {}
  ): RuntimeSchema {
    return {
      type: "object",
      properties,
      required,
      additionalProperties: false,
      maxProperties: Math.max(Object.keys(properties).length, 1),
      ...options
    };
  },
  writableJsonObject(
    options: Omit<RuntimeSchema, "type" | "additionalProperties"> = {}
  ): RuntimeSchema {
    return {
      type: "object",
      additionalProperties: true,
      maxProperties: 64,
      "x-clinicos-json-kind": "writable",
      "x-clinicos-forbidden-property-names": WRITABLE_AUTHORITY_FIELDS,
      ...options
    };
  },
  publicJsonObject(
    options: Omit<RuntimeSchema, "type" | "additionalProperties"> = {}
  ): RuntimeSchema {
    return {
      type: "object",
      additionalProperties: true,
      maxProperties: 256,
      "x-clinicos-json-kind": "public",
      "x-clinicos-forbidden-property-names": PUBLIC_PRIVATE_FIELDS,
      ...options
    };
  },
  nullable(value: RuntimeSchema): RuntimeSchema {
    return { ...value, nullable: true };
  }
} as const;

export const WRITABLE_AUTHORITY_FIELDS = [
  "amount",
  "amountMinor",
  "amountPaise",
  "actor",
  "actorId",
  "actorUserId",
  "clinicId",
  "createdByUserId",
  "currencyAuthority",
  "discountMinor",
  "objectKey",
  "price",
  "priceAuthority",
  "providerSecret",
  "quarantineReason",
  "rawProviderPayload",
  "scanStatus",
  "signedAt",
  "signedBy",
  "signedByUserId",
  "signerId",
  "signature",
  "signatureValue",
  "storageBucket",
  "taxRateBasisPoints",
  "tenantId",
  "totalAuthority",
  "totalMinor",
  "unitPrice",
  "unitPriceMinor"
] as const;

export const PUBLIC_PRIVATE_FIELDS = [
  "accessToken",
  "apiKey",
  "apiToken",
  "appSecret",
  "bucket",
  "clientSecret",
  "keySecret",
  "objectVersion",
  "objectKey",
  "privatePayload",
  "providerPayload",
  "providerSecret",
  "rawBody",
  "rawPayload",
  "refreshToken",
  "storageProvider",
  "storageRegion",
  "storageKey",
  "storagePath",
  "webhookVerifyToken",
  "webhookSecret"
] as const;

export function parseRuntimeSchema<T = JsonValue>(
  definition: RuntimeSchema,
  input: unknown
): RuntimeSchemaResult<T> {
  const issues: RuntimeSchemaIssue[] = [];
  validateSchema(definition, input, "$", issues, 0);
  if (issues.length > 0) return { success: false, issues };
  return { success: true, data: input as T };
}

export function assertRuntimeSchema<T = JsonValue>(definition: RuntimeSchema, input: unknown): T {
  const result = parseRuntimeSchema<T>(definition, input);
  if (!result.success) throw new RuntimeSchemaValidationError(result.issues);
  return result.data;
}

function validateSchema(
  definition: RuntimeSchema,
  input: unknown,
  path: string,
  issues: RuntimeSchemaIssue[],
  depth: number
): void {
  if (input === null) {
    if (!definition.nullable && !definition.enum?.includes(null)) {
      issue(issues, path, "invalid_type", "Null is not allowed.");
    }
    return;
  }

  if (definition.oneOf) {
    const matches = definition.oneOf.filter((candidate) => {
      const candidateIssues: RuntimeSchemaIssue[] = [];
      validateSchema(candidate, input, path, candidateIssues, depth);
      return candidateIssues.length === 0;
    });
    if (matches.length !== 1) {
      issue(issues, path, "unsupported_value", "Value must match exactly one allowed schema.");
    }
    return;
  }

  if (definition.anyOf) {
    const matches = definition.anyOf.some((candidate) => {
      const candidateIssues: RuntimeSchemaIssue[] = [];
      validateSchema(candidate, input, path, candidateIssues, depth);
      return candidateIssues.length === 0;
    });
    if (!matches)
      issue(issues, path, "unsupported_value", "Value does not match an allowed schema.");
  }

  if (definition.enum && !definition.enum.includes(input as JsonPrimitive)) {
    issue(issues, path, "unsupported_value", `Expected one of: ${definition.enum.join(", ")}.`);
    return;
  }

  switch (definition.type) {
    case "string":
      validateString(definition, input, path, issues);
      return;
    case "boolean":
      if (typeof input !== "boolean") issue(issues, path, "invalid_type", "Expected a boolean.");
      return;
    case "integer":
    case "number":
      validateNumber(definition, input, path, issues);
      return;
    case "array":
      validateArray(definition, input, path, issues, depth);
      return;
    case "object":
      validateObject(definition, input, path, issues, depth);
      return;
    case undefined:
      validateJsonValue(
        input,
        path,
        issues,
        depth,
        definition["x-clinicos-forbidden-property-names"]
      );
  }
}

function validateString(
  definition: RuntimeSchema,
  input: unknown,
  path: string,
  issues: RuntimeSchemaIssue[]
): void {
  if (definition.format === "binary" && input instanceof Uint8Array) return;
  if (typeof input !== "string") {
    issue(issues, path, "invalid_type", "Expected a string.");
    return;
  }
  if (definition.minLength !== undefined && input.length < definition.minLength) {
    issue(
      issues,
      path,
      "out_of_range",
      `String must contain at least ${definition.minLength} characters.`
    );
  }
  if (definition.maxLength !== undefined && input.length > definition.maxLength) {
    issue(
      issues,
      path,
      "out_of_range",
      `String must contain at most ${definition.maxLength} characters.`
    );
  }
  if (definition.pattern && !new RegExp(definition.pattern).test(input)) {
    issue(issues, path, "format", "String does not match the required pattern.");
  }
  if (definition.format === "uuid" && !UUID_PATTERN.test(input)) {
    issue(issues, path, "format", "Expected a UUID.");
  }
  if (definition.format === "date" && !DATE_PATTERN.test(input)) {
    issue(issues, path, "format", "Expected a YYYY-MM-DD date.");
  }
  if (definition.format === "date-time" && Number.isNaN(Date.parse(input))) {
    issue(issues, path, "format", "Expected an ISO date-time.");
  }
  if (definition.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input)) {
    issue(issues, path, "format", "Expected an email address.");
  }
  if (definition.format === "sha256" && !SHA256_PATTERN.test(input)) {
    issue(issues, path, "format", "Expected a SHA-256 hexadecimal digest.");
  }
}

function validateNumber(
  definition: RuntimeSchema,
  input: unknown,
  path: string,
  issues: RuntimeSchemaIssue[]
): void {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    issue(issues, path, "invalid_type", "Expected a finite number.");
    return;
  }
  if (definition.type === "integer" && !Number.isInteger(input)) {
    issue(issues, path, "invalid_type", "Expected an integer.");
  }
  if (definition.minimum !== undefined && input < definition.minimum) {
    issue(issues, path, "out_of_range", `Number must be at least ${definition.minimum}.`);
  }
  if (definition.maximum !== undefined && input > definition.maximum) {
    issue(issues, path, "out_of_range", `Number must be at most ${definition.maximum}.`);
  }
}

function validateArray(
  definition: RuntimeSchema,
  input: unknown,
  path: string,
  issues: RuntimeSchemaIssue[],
  depth: number
): void {
  if (!Array.isArray(input)) {
    issue(issues, path, "invalid_type", "Expected an array.");
    return;
  }
  if (definition.minItems !== undefined && input.length < definition.minItems) {
    issue(
      issues,
      path,
      "out_of_range",
      `Array must contain at least ${definition.minItems} items.`
    );
  }
  if (definition.maxItems !== undefined && input.length > definition.maxItems) {
    issue(issues, path, "out_of_range", `Array must contain at most ${definition.maxItems} items.`);
  }
  if (definition.items) {
    input.forEach((value, index) =>
      validateSchema(definition.items!, value, `${path}[${index}]`, issues, depth + 1)
    );
  }
}

function validateObject(
  definition: RuntimeSchema,
  input: unknown,
  path: string,
  issues: RuntimeSchemaIssue[],
  depth: number
): void {
  if (!input || typeof input !== "object" || Array.isArray(input) || input instanceof Uint8Array) {
    issue(issues, path, "invalid_type", "Expected an object.");
    return;
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record);
  if (definition.minProperties !== undefined && keys.length < definition.minProperties) {
    issue(
      issues,
      path,
      "out_of_range",
      `Object must contain at least ${definition.minProperties} properties.`
    );
  }
  if (definition.maxProperties !== undefined && keys.length > definition.maxProperties) {
    issue(
      issues,
      path,
      "out_of_range",
      `Object must contain at most ${definition.maxProperties} properties.`
    );
  }
  for (const required of definition.required ?? []) {
    if (!(required in record) || record[required] === undefined) {
      issue(issues, `${path}.${required}`, "missing_required", "Required field is missing.");
    }
  }
  const forbidden = new Set(
    (definition["x-clinicos-forbidden-property-names"] ?? []).map(normalizePropertyName)
  );
  for (const key of keys) {
    const propertyPath = `${path}.${key}`;
    if (forbidden.has(normalizePropertyName(key))) {
      issue(
        issues,
        propertyPath,
        "authority_field",
        "Authority or private field is not allowed here."
      );
      continue;
    }
    const propertySchema = definition.properties?.[key];
    if (propertySchema) {
      validateSchema(propertySchema, record[key], propertyPath, issues, depth + 1);
      continue;
    }
    if (definition.additionalProperties === false) {
      issue(issues, propertyPath, "unknown_field", "Unknown field is not allowed.");
      continue;
    }
    if (definition.additionalProperties && typeof definition.additionalProperties === "object") {
      validateSchema(definition.additionalProperties, record[key], propertyPath, issues, depth + 1);
      continue;
    }
    if (definition["x-clinicos-json-kind"]) {
      validateJsonValue(
        record[key],
        propertyPath,
        issues,
        depth + 1,
        definition["x-clinicos-forbidden-property-names"]
      );
    }
  }
}

function validateJsonValue(
  input: unknown,
  path: string,
  issues: RuntimeSchemaIssue[],
  depth: number,
  forbiddenNames: readonly string[] = []
): void {
  if (depth > 12) {
    issue(issues, path, "out_of_range", "JSON nesting exceeds the maximum depth of 12.");
    return;
  }
  if (input === null || typeof input === "boolean" || typeof input === "number") return;
  if (typeof input === "string") {
    if (input.length > 32_768)
      issue(issues, path, "out_of_range", "String exceeds 32768 characters.");
    return;
  }
  if (Array.isArray(input)) {
    if (input.length > 256) issue(issues, path, "out_of_range", "Array exceeds 256 items.");
    input.forEach((value, index) =>
      validateJsonValue(value, `${path}[${index}]`, issues, depth + 1, forbiddenNames)
    );
    return;
  }
  if (!input || typeof input !== "object" || input instanceof Uint8Array) {
    issue(issues, path, "invalid_type", "Expected a JSON value.");
    return;
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length > 256)
    issue(issues, path, "out_of_range", "Object exceeds 256 properties.");
  const forbidden = new Set(forbiddenNames.map(normalizePropertyName));
  for (const [key, value] of Object.entries(record)) {
    const propertyPath = `${path}.${key}`;
    if (forbidden.has(normalizePropertyName(key))) {
      issue(
        issues,
        propertyPath,
        "authority_field",
        "Authority or private field is not allowed here."
      );
    } else {
      validateJsonValue(value, propertyPath, issues, depth + 1, forbiddenNames);
    }
  }
}

function normalizePropertyName(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function issue(
  issues: RuntimeSchemaIssue[],
  path: string,
  code: RuntimeSchemaIssue["code"],
  message: string
): void {
  issues.push({ path, code, message });
}
