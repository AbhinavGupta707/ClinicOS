import { BoundaryError } from "./boundary-error.ts";

const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface RuntimeValidationIssue {
  path: readonly (string | number)[];
  code: string;
  message?: string;
}

export type RuntimeValidationResult<T> =
  { success: true; data: T } | { success: false; issues: readonly RuntimeValidationIssue[] };

export interface RuntimeValidator<T> {
  safeParse(value: unknown): RuntimeValidationResult<T>;
}

export type ValidationSource = "body" | "path" | "query" | "response";

export function parseJsonRequestBody(text: string): unknown {
  if (text.trim().length === 0) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new BoundaryError({
      code: "BAD_REQUEST",
      message: "Request body must be valid JSON."
    });
  }
}

export function assertStrictObject(
  value: unknown,
  allowedFields: readonly string[],
  location = "body"
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BoundaryError({
      code: "VALIDATION_ERROR",
      message: `${location} must be a JSON object.`,
      details: { location }
    });
  }

  const allowed = new Set(allowedFields);
  const keys = Object.keys(value);
  const forbidden = keys.filter((key) => PROTOTYPE_POLLUTION_KEYS.has(key));
  if (forbidden.length > 0) {
    throw new BoundaryError({
      code: "VALIDATION_ERROR",
      message: "Request contains forbidden object keys.",
      details: { location, fields: forbidden.sort() }
    });
  }

  const unknown = keys.filter((key) => !allowed.has(key)).sort();
  if (unknown.length > 0) {
    throw new BoundaryError({
      code: "VALIDATION_ERROR",
      message: "Request contains unknown fields.",
      details: { location, fields: unknown }
    });
  }

  return value as Record<string, unknown>;
}

export function validateRuntimeValue<T>(
  validator: RuntimeValidator<T>,
  value: unknown,
  source: ValidationSource
): T {
  const result = validator.safeParse(value);
  if (result.success) return result.data;

  throw new BoundaryError({
    code: source === "response" ? "INTERNAL_ERROR" : "VALIDATION_ERROR",
    message:
      source === "response"
        ? "The response failed its runtime contract."
        : `Request ${source} failed validation.`,
    details: {
      source,
      issues: result.issues.slice(0, 50).map((issue) => ({
        path: issue.path.map(String).join("."),
        code: issue.code
      }))
    }
  });
}
