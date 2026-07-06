import type { Clinic, PermissionKey, RoleAssignment, Tenant, UUID } from "@clinic-os/domain";
import type { AccessContext } from "./authorization.ts";

export interface MeClinicSummary {
  id: UUID;
  tenantId: UUID;
  slug: string;
  displayName: string;
  timezone: string;
  roleSlugs: string[];
}

export interface MeResponse {
  user: {
    id: UUID;
    displayName: string;
    email: string | null;
    phone: string | null;
    status: string;
  };
  tenant: Pick<Tenant, "id" | "slug" | "displayName" | "status">;
  clinics: MeClinicSummary[];
  permissions: PermissionKey[];
  keycloak: {
    subject: string;
    issuer: string;
    roles: string[];
  };
}

export function buildMeResponse(context: AccessContext, clinics: readonly Clinic[]): MeResponse {
  const rolesByClinic = new Map<UUID, RoleAssignment[]>();

  for (const assignment of context.roleAssignments) {
    if (!assignment.clinicId) continue;
    const existing = rolesByClinic.get(assignment.clinicId) ?? [];
    existing.push(assignment);
    rolesByClinic.set(assignment.clinicId, existing);
  }

  return {
    user: {
      id: context.user.id,
      displayName: context.user.displayName,
      email: context.user.email,
      phone: context.user.phone,
      status: context.user.status
    },
    tenant: {
      id: context.tenant.id,
      slug: context.tenant.slug,
      displayName: context.tenant.displayName,
      status: context.tenant.status
    },
    clinics: clinics.map((clinic) => ({
      id: clinic.id,
      tenantId: clinic.tenantId,
      slug: clinic.slug,
      displayName: clinic.displayName,
      timezone: clinic.timezone,
      roleSlugs: [...new Set((rolesByClinic.get(clinic.id) ?? []).map((assignment) => assignment.roleSlug))].sort()
    })),
    permissions: context.permissions,
    keycloak: {
      subject: context.principal.subject,
      issuer: context.principal.issuer,
      roles: context.principal.keycloakRoles
    }
  };
}
