const sensitiveKeyFragments = [
  "abha",
  "address",
  "allergy",
  "body",
  "clinical",
  "diagnosis",
  "dob",
  "email",
  "medication",
  "name",
  "note",
  "phone",
  "prescription",
  "secret",
  "token",
  "transcript"
];

export function redactForLogs(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactForLogs(item));
  if (!value || typeof value !== "object") return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, fieldValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    redacted[key] = sensitiveKeyFragments.some((fragment) => normalizedKey.includes(fragment))
      ? "[REDACTED]"
      : redactForLogs(fieldValue);
  }

  return redacted;
}
