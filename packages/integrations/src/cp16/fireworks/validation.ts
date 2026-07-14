import { sanitizedFireworksError } from "./errors.js";

const MAXIMUM_JSON_BYTES = 16 * 1024 * 1024;
const MAXIMUM_JSON_DEPTH = 64;
const MAXIMUM_JSON_NODES = 200_000;
const MAXIMUM_JSON_KEYS = 100_000;
const MAXIMUM_ARRAY_ITEMS = 100_000;
const MAXIMUM_STRING_LENGTH = 1_000_000;
const MAXIMUM_KEY_LENGTH = 512;

export function parseBoundedJson(body: Uint8Array): unknown {
  if (!(body instanceof Uint8Array) || body.byteLength > MAXIMUM_JSON_BYTES) invalid();
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw sanitizedFireworksError("invalid_response", "Fireworks returned invalid UTF-8.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw sanitizedFireworksError("invalid_response", "Fireworks returned invalid JSON.");
  }
  validateJsonStructure(value);
  return value;
}

export function strictObject(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = []
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const object = value as Record<string, unknown>;
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  if (requiredKeys.some((key) => !(key in object))) invalid();
  if (Object.keys(object).some((key) => !allowed.has(key))) invalid();
  return object;
}

export function boundedString(value: unknown, minimum = 1, maximum = 4_096): string {
  if (typeof value !== "string" || value.length < minimum || value.length > maximum || /\0/u.test(value)) {
    invalid();
  }
  return value;
}

export function boundedStringArray(
  value: unknown,
  minimumItems: number,
  maximumItems: number,
  maximumStringLength: number
): readonly string[] {
  if (!Array.isArray(value) || value.length < minimumItems || value.length > maximumItems) invalid();
  return Object.freeze(value.map((item) => boundedString(item, 1, maximumStringLength)));
}

export function finiteNumber(value: unknown, minimum: number, maximum: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    invalid();
  }
  return value;
}

export function safeInteger(value: unknown, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    invalid();
  }
  return value as number;
}

export function exactEnum<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) invalid();
  return value as T;
}

export function providerUsage(
  value: unknown,
  maximumInputTokens: number,
  maximumOutputTokens: number
): { readonly inputTokens: number; readonly outputTokens: number } {
  const usage = strictObject(value, ["prompt_tokens", "total_tokens"], [
    "completion_tokens",
    "prompt_tokens_details"
  ]);
  const inputTokens = safeInteger(usage.prompt_tokens, 0, maximumInputTokens);
  const outputTokens = safeInteger(usage.completion_tokens ?? 0, 0, maximumOutputTokens);
  const total = safeInteger(
    usage.total_tokens,
    0,
    maximumInputTokens + maximumOutputTokens
  );
  if (total < inputTokens + outputTokens) invalid();
  return Object.freeze({ inputTokens, outputTokens });
}

export function opaqueIdentifier(value: string, field: string, maximum = 256): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[A-Za-z0-9._:@/-]+$/u.test(value)
  ) {
    throw sanitizedFireworksError("invalid_request", `Fireworks ${field} is invalid.`);
  }
  return value;
}

export function boundedInputText(value: string, maximumBytes: number): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    Buffer.byteLength(value, "utf8") > maximumBytes ||
    /\0/u.test(value)
  ) {
    throw sanitizedFireworksError("invalid_request", "Fireworks input text is invalid or oversized.");
  }
  return value;
}

export function invalid(): never {
  throw sanitizedFireworksError("invalid_response", "Fireworks response failed strict validation.");
}

function validateJsonStructure(root: unknown): void {
  const pending: Array<{ readonly value: unknown; readonly depth: number }> = [
    { value: root, depth: 0 }
  ];
  let nodes = 0;
  let keys = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    nodes += 1;
    if (nodes > MAXIMUM_JSON_NODES || current.depth > MAXIMUM_JSON_DEPTH) invalid();
    if (typeof current.value === "string") {
      if (current.value.length > MAXIMUM_STRING_LENGTH) invalid();
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    if (Array.isArray(current.value)) {
      if (current.value.length > MAXIMUM_ARRAY_ITEMS) invalid();
      for (const item of current.value) {
        pending.push({ value: item, depth: current.depth + 1 });
      }
      continue;
    }
    const entries = Object.entries(current.value as Record<string, unknown>);
    keys += entries.length;
    if (keys > MAXIMUM_JSON_KEYS) invalid();
    for (const [key, value] of entries) {
      if (
        key.length > MAXIMUM_KEY_LENGTH ||
        key === "__proto__" ||
        key === "prototype" ||
        key === "constructor"
      ) invalid();
      pending.push({ value, depth: current.depth + 1 });
    }
  }
}
