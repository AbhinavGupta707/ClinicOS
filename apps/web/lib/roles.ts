export const CLINIC_ROLES = [
  "owner",
  "doctor",
  "assistant",
  "receptionist",
  "accountant",
  "platform_admin"
] as const;

export type ClinicRole = (typeof CLINIC_ROLES)[number];

export const ROLE_LABELS: Record<ClinicRole, string> = {
  accountant: "Accountant",
  assistant: "Assistant",
  doctor: "Doctor",
  owner: "Owner",
  platform_admin: "Platform admin",
  receptionist: "Receptionist"
};

const ROLE_ALIASES: Record<string, ClinicRole> = {
  admin: "owner",
  clinic_admin: "owner",
  clinic_owner: "owner",
  front_desk: "receptionist",
  platform: "platform_admin",
  platformAdmin: "platform_admin",
  platform_admin: "platform_admin",
  super_admin: "platform_admin"
};

export function normalizeRole(value: unknown): ClinicRole | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/-/g, "_");
  const directMatch = CLINIC_ROLES.find((role) => role === normalized);

  return directMatch ?? ROLE_ALIASES[normalized] ?? null;
}

export function normalizeRoles(values: unknown): ClinicRole[] {
  if (!Array.isArray(values)) {
    return [];
  }

  return Array.from(new Set(values.map(normalizeRole).filter(Boolean))) as ClinicRole[];
}
