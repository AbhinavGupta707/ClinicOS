export type UUID = string & { readonly __clinicOsUuidBrand: unique symbol };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is UUID {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function asUuid(value: string, label = "uuid"): UUID {
  if (!isUuid(value)) {
    throw new Error(`${label} must be a valid UUID.`);
  }

  return value as UUID;
}
