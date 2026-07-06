const DEFAULT_REDACTION = "[REDACTED]";

const SENSITIVE_KEY_PATTERNS = [
  /(^|_)full_?name$/i,
  /patient.*name/i,
  /^phone$/i,
  /mobile/i,
  /^email$/i,
  /abha/i,
  /clinical.*note/i,
  /transcript/i,
  /raw.*audio/i,
  /diagnosis/i,
  /prescription/i,
  /allerg/i
];

const PHONE_PATTERN = /(\+?\d[\d -]{7,}\d)/g;
const EMAIL_PATTERN = /([a-zA-Z0-9._%+-])([a-zA-Z0-9._%+-]*)(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const ABHA_PATTERN = /\b\d{2}-?\d{4}-?\d{4}-?\d{4}\b/g;

export interface RedactionOptions {
  replacement?: string;
  keepShape?: boolean;
}

export function isSensitiveFieldName(fieldName: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(fieldName));
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return DEFAULT_REDACTION;
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

export function maskEmail(value: string): string {
  return value.replace(EMAIL_PATTERN, (_match, first: string, _rest: string, domain: string) => {
    return `${first}***${domain}`;
  });
}

export function maskFreeTextPhi(value: string, replacement = DEFAULT_REDACTION): string {
  return value
    .replace(EMAIL_PATTERN, (_match, first: string, _rest: string, domain: string) => `${first}***${domain}`)
    .replace(PHONE_PATTERN, (match) => maskPhone(match))
    .replace(ABHA_PATTERN, replacement);
}

export function redactPhi<T>(value: T, options: RedactionOptions = {}): T {
  const replacement = options.replacement ?? DEFAULT_REDACTION;

  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return maskFreeTextPhi(value, replacement) as T;
  }

  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.map((item) => redactPhi(item, options)) as T;
  }

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(input)) {
    if (isSensitiveFieldName(key)) {
      output[key] =
        options.keepShape && typeof nestedValue === "string"
          ? maskFreeTextPhi(nestedValue, replacement)
          : replacement;
      continue;
    }

    output[key] = redactPhi(nestedValue, options);
  }

  return output as T;
}
