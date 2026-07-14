import { createHash } from "node:crypto";

export const CLINIC_OS_CANONICALIZATION_VERSION = "clinic-os-json-sort-v1";

export interface ClinicOsSha256Digest {
  readonly algorithm: "sha-256";
  readonly canonicalization: typeof CLINIC_OS_CANONICALIZATION_VERSION;
  readonly value: string;
}

/**
 * Deterministic ClinicOS JSON serialization for replay/integrity comparison. This is not a claim
 * to implement an HL7 digital-signature canonicalization profile.
 */
export function canonicalizeClinicOsJson(value: unknown): string {
  return JSON.stringify(normalize(value, "$"));
}

export function digestClinicOsJson(value: unknown): ClinicOsSha256Digest {
  const canonical = canonicalizeClinicOsJson(value);
  return {
    algorithm: "sha-256",
    canonicalization: CLINIC_OS_CANONICALIZATION_VERSION,
    value: createHash("sha256").update(canonical, "utf8").digest("hex")
  };
}

function normalize(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path} contains a non-finite number.`);
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalize(item, `${path}[${index}]`));
  }
  if (typeof value !== "object") {
    throw new Error(`${path} contains a non-JSON value.`);
  }

  const record = value as Record<string, unknown>;
  const normalized = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(record).sort()) {
    const nested = record[key];
    if (nested === undefined) throw new Error(`${path}.${key} is undefined.`);
    normalized[key] = normalize(nested, `${path}.${key}`);
  }
  return normalized;
}
