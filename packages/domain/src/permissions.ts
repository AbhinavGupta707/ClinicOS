export const PERMISSIONS = [
  "tenant.manage",
  "clinic.manage",
  "user.manage",
  "role.manage",
  "security.manage",
  "integration.manage",
  "audit.read",
  "patient.read",
  "patient.write",
  "patient.export",
  "patient.phi.read",
  "schedule.read",
  "schedule.write",
  "queue.manage",
  "intake.write",
  "clinical.note.read",
  "clinical.note.write",
  "clinical.note.sign",
  "dental.chart.read",
  "dental.chart.write",
  "dental.chart.snapshot",
  "prescription.write",
  "prescription.sign",
  "patient_instruction.write",
  "media.read",
  "media.write",
  "billing.read",
  "billing.write",
  "billing.export",
  "message.read",
  "message.write",
  "task.manage",
  "lab.manage",
  "inventory.manage",
  "analytics.read",
  "break_glass.request",
  "break_glass.approve"
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number];

export const CLINIC_ROLE_SLUGS = [
  "owner_admin",
  "doctor",
  "assistant",
  "receptionist",
  "accountant",
  "auditor",
  "platform_admin"
] as const;

export type ClinicRoleSlug = (typeof CLINIC_ROLE_SLUGS)[number];

const ALL_PERMISSIONS = [...PERMISSIONS];

export const DEFAULT_ROLE_PERMISSION_GRANTS = {
  owner_admin: [
    "tenant.manage",
    "clinic.manage",
    "user.manage",
    "role.manage",
    "security.manage",
    "integration.manage",
    "audit.read",
    "patient.read",
    "patient.write",
    "patient.export",
    "patient.phi.read",
    "schedule.read",
    "schedule.write",
    "queue.manage",
    "intake.write",
    "clinical.note.read",
    "clinical.note.write",
    "clinical.note.sign",
    "dental.chart.read",
    "dental.chart.write",
    "dental.chart.snapshot",
    "prescription.write",
    "prescription.sign",
    "patient_instruction.write",
    "media.read",
    "media.write",
    "billing.read",
    "billing.write",
    "billing.export",
    "message.read",
    "message.write",
    "task.manage",
    "lab.manage",
    "inventory.manage",
    "analytics.read",
    "break_glass.request",
    "break_glass.approve"
  ],
  doctor: [
    "patient.read",
    "patient.write",
    "patient.phi.read",
    "schedule.read",
    "queue.manage",
    "intake.write",
    "clinical.note.read",
    "clinical.note.write",
    "clinical.note.sign",
    "dental.chart.read",
    "dental.chart.write",
    "dental.chart.snapshot",
    "prescription.write",
    "prescription.sign",
    "patient_instruction.write",
    "media.read",
    "media.write",
    "billing.read",
    "message.read",
    "message.write",
    "task.manage",
    "lab.manage",
    "break_glass.request"
  ],
  assistant: [
    "patient.read",
    "patient.write",
    "patient.phi.read",
    "schedule.read",
    "schedule.write",
    "queue.manage",
    "intake.write",
    "clinical.note.read",
    "clinical.note.write",
    "dental.chart.read",
    "dental.chart.write",
    "dental.chart.snapshot",
    "prescription.write",
    "patient_instruction.write",
    "media.read",
    "media.write",
    "billing.read",
    "message.read",
    "message.write",
    "task.manage",
    "lab.manage",
    "inventory.manage"
  ],
  receptionist: [
    "patient.read",
    "patient.write",
    "schedule.read",
    "schedule.write",
    "queue.manage",
    "billing.read",
    "billing.write",
    "patient_instruction.write",
    "message.read",
    "message.write",
    "task.manage"
  ],
  accountant: ["billing.read", "billing.write", "billing.export", "analytics.read"],
  auditor: ["audit.read", "analytics.read"],
  platform_admin: ALL_PERMISSIONS
} satisfies Record<ClinicRoleSlug, readonly PermissionKey[]>;

const PERMISSION_SET = new Set<PermissionKey>(PERMISSIONS);
const CLINIC_ROLE_SET = new Set<ClinicRoleSlug>(CLINIC_ROLE_SLUGS);

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && PERMISSION_SET.has(value as PermissionKey);
}

export function isClinicRoleSlug(value: unknown): value is ClinicRoleSlug {
  return typeof value === "string" && CLINIC_ROLE_SET.has(value as ClinicRoleSlug);
}

export function permissionsForRoles(roleSlugs: readonly ClinicRoleSlug[]): PermissionKey[] {
  const permissions = new Set<PermissionKey>();

  for (const roleSlug of roleSlugs) {
    for (const permission of DEFAULT_ROLE_PERMISSION_GRANTS[roleSlug]) {
      permissions.add(permission);
    }
  }

  return [...permissions].sort();
}

export function roleGrantsPermission(roleSlug: ClinicRoleSlug, permission: PermissionKey): boolean {
  return DEFAULT_ROLE_PERMISSION_GRANTS[roleSlug].includes(permission);
}

export function normalizePermissionList(values: readonly string[]): PermissionKey[] {
  const normalized = new Set<PermissionKey>();

  for (const value of values) {
    if (!isPermissionKey(value)) {
      throw new Error(`Unknown permission key: ${value}`);
    }

    normalized.add(value);
  }

  return [...normalized].sort();
}

export function isClinicalPermission(permission: PermissionKey): boolean {
  return (
    permission.startsWith("clinical.") ||
    permission.startsWith("dental.") ||
    permission.startsWith("prescription.") ||
    permission.startsWith("patient_instruction.") ||
    permission === "media.read" ||
    permission === "media.write" ||
    permission === "patient.phi.read"
  );
}
