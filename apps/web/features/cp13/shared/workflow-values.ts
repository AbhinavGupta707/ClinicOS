import type {
  JsonValue,
  PublicJsonObject,
  VersionedPublicResource
} from "@clinic-os/api-client-generated";

export function record(value: unknown): PublicJsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as PublicJsonObject)
    : {};
}

export function valueText(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

export function fieldText(value: unknown, field: string): string {
  return valueText(record(value)[field]);
}

export function valueList(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export function etag(resource: VersionedPublicResource): string {
  if (!Number.isSafeInteger(resource.rowVersion) || resource.rowVersion < 1) {
    throw new Error("Record version is unavailable. Refresh before changing this record.");
  }
  return `"rv-${resource.rowVersion}"`;
}

export function fdiTooth(value: string): boolean {
  return /^(?:[1-4][1-8]|[5-8][1-5])$/.test(value);
}

export function clinicDisplayTime(value: string, timeZone: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone,
      dateStyle: "medium",
      timeStyle: "short"
    }).format(date);
  } catch {
    return "Date unavailable";
  }
}
