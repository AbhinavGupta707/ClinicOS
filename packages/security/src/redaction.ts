const DEFAULT_REDACTION = "[REDACTED]";

const SENSITIVE_KEY_PATTERNS = [
  /(^|_)full_?name$/i,
  /patient.*name/i,
  /^phone$/i,
  /mobile/i,
  /^email$/i,
  /abha/i,
  /intake/i,
  /form.*response/i,
  /export.*payload/i,
  /export.*snapshot/i,
  /chief.*complaint/i,
  /symptom/i,
  /medical.*history/i,
  /clinical.*note/i,
  /observations?/i,
  /examination/i,
  /investigation/i,
  /transcript/i,
  /raw.*audio/i,
  /raw.*payload/i,
  /private.*payload/i,
  /diagnosis/i,
  /treatment.*plan/i,
  /treatment.*performed/i,
  /original.*file.*name/i,
  /file.*name/i,
  /object.*key/i,
  /storage.*key/i,
  /storage.*path/i,
  /bucket.*name/i,
  /^bucket$/i,
  /signed.*url/i,
  /upload.*url/i,
  /download.*url/i,
  /media.*url/i,
  /dicom/i,
  /prescription/i,
  /medication/i,
  /dosage/i,
  /instruction/i,
  /allerg/i,
  /signature/i,
  /guardian/i,
  /authorization/i,
  /cookie/i,
  /password/i,
  /passphrase/i,
  /secret/i,
  /api.*key/i,
  /access.*token/i,
  /refresh.*token/i,
  /private.*key/i,
  /stack/i,
  /sql/i,
  /query.*text/i,
  /connection.*string/i
];

const PHONE_PATTERN = /(\+?\d[\d -]{7,}\d)/g;
const EMAIL_PATTERN = /([a-zA-Z0-9._%+-])([a-zA-Z0-9._%+-]*)(@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
const ABHA_PATTERN = /\b\d{2}-?\d{4}-?\d{4}-?\d{4}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const KEY_VALUE_SECRET_PATTERN =
  /\b(api[_-]?key|client[_-]?secret|password|passphrase|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s,;]+/gi;

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
    .replace(BEARER_PATTERN, replacement)
    .replace(JWT_PATTERN, replacement)
    .replace(KEY_VALUE_SECRET_PATTERN, replacement)
    .replace(
      EMAIL_PATTERN,
      (_match, first: string, _rest: string, domain: string) => `${first}***${domain}`
    )
    .replace(PHONE_PATTERN, (match) => maskPhone(match))
    .replace(ABHA_PATTERN, replacement);
}

export function redactDiagnosticMetadata(
  value: Record<string, unknown>,
  options: {
    maxDepth?: number;
    maxKeys?: number;
    maxArrayItems?: number;
    maxStringLength?: number;
  } = {}
): Record<string, unknown> {
  const maxDepth = options.maxDepth ?? 6;
  const maxKeys = options.maxKeys ?? 50;
  const maxArrayItems = options.maxArrayItems ?? 50;
  const maxStringLength = options.maxStringLength ?? 512;

  function visit(input: unknown, depth: number): unknown {
    if (depth > maxDepth) return "[TRUNCATED]";
    if (typeof input === "bigint") return input.toString();
    if (typeof input === "function" || typeof input === "symbol") return "[UNSERIALIZABLE]";
    if (typeof input === "number" && !Number.isFinite(input)) return null;
    if (typeof input === "string") {
      const truncated =
        input.length > maxStringLength ? `${input.slice(0, maxStringLength)}…` : input;
      return maskFreeTextPhi(truncated);
    }
    if (input === null || input === undefined || typeof input !== "object") return input;
    if (Array.isArray(input)) {
      return input.slice(0, maxArrayItems).map((entry) => visit(entry, depth + 1));
    }

    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(input).slice(0, maxKeys)) {
      output[key] = isSensitiveFieldName(key) ? DEFAULT_REDACTION : visit(nested, depth + 1);
    }
    return output;
  }

  return visit(value, 0) as Record<string, unknown>;
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
