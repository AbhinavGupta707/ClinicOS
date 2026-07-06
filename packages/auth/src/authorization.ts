import {
  permissionsForRoles,
  type ClinicAssignment,
  type ClinicRoleSlug,
  type ClinicUser,
  type PermissionKey,
  type RoleAssignment,
  type Tenant,
  type TenantMembership,
  type UUID
} from "@clinic-os/domain";
import type { AuthenticatedPrincipal } from "./keycloak.ts";

export interface PrincipalAccessInput {
  principal: AuthenticatedPrincipal;
  tenant: Tenant;
  user: ClinicUser;
  memberships: readonly TenantMembership[];
  clinicAssignments: readonly ClinicAssignment[];
  roleAssignments: readonly RoleAssignment[];
}

export interface AccessContext {
  principal: AuthenticatedPrincipal;
  tenant: Tenant;
  user: ClinicUser;
  memberships: readonly TenantMembership[];
  clinicAssignments: readonly ClinicAssignment[];
  roleAssignments: readonly RoleAssignment[];
  roleSlugs: ClinicRoleSlug[];
  permissions: PermissionKey[];
}

export interface AuthorizationRequest {
  tenantId: UUID;
  clinicId?: UUID | null;
  permission: PermissionKey;
  resourceTenantId?: UUID | null;
  resourceClinicId?: UUID | null;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: "allowed" | "tenant_mismatch" | "clinic_mismatch" | "inactive_membership" | "missing_permission";
  requiredPermission: PermissionKey;
}

export class AuthorizationError extends Error {
  readonly code = "PERMISSION_DENIED";
  readonly requiredPermission: PermissionKey;
  readonly reason: AuthorizationDecision["reason"];

  constructor(decision: AuthorizationDecision) {
    super(`Permission denied: ${decision.reason}`);
    this.name = "AuthorizationError";
    this.requiredPermission = decision.requiredPermission;
    this.reason = decision.reason;
  }
}

export function buildAccessContext(input: PrincipalAccessInput): AccessContext {
  const roleSlugs = [...new Set(input.roleAssignments.map((assignment) => assignment.roleSlug))].sort();
  const permissions = permissionsForRoles(roleSlugs);

  return {
    ...input,
    roleSlugs,
    permissions
  };
}

export function roleSlugsForScope(
  context: AccessContext,
  tenantId: UUID,
  clinicId?: UUID | null
): ClinicRoleSlug[] {
  return [
    ...new Set(
      context.roleAssignments
        .filter((assignment) => {
          if (assignment.tenantId !== tenantId) return false;
          return assignment.clinicId === null || !clinicId || assignment.clinicId === clinicId;
        })
        .map((assignment) => assignment.roleSlug)
    )
  ].sort();
}

export function permissionsForScope(
  context: AccessContext,
  tenantId: UUID,
  clinicId?: UUID | null
): PermissionKey[] {
  return permissionsForRoles(roleSlugsForScope(context, tenantId, clinicId));
}

export function authorize(context: AccessContext, request: AuthorizationRequest): AuthorizationDecision {
  const tenantMatches = context.tenant.id === request.tenantId;
  const resourceTenantMatches = !request.resourceTenantId || request.resourceTenantId === request.tenantId;

  if (!tenantMatches || !resourceTenantMatches) {
    return { allowed: false, reason: "tenant_mismatch", requiredPermission: request.permission };
  }

  const hasActiveMembership = context.memberships.some(
    (membership) => membership.tenantId === request.tenantId && membership.status === "active"
  );

  if (!hasActiveMembership) {
    return { allowed: false, reason: "inactive_membership", requiredPermission: request.permission };
  }

  if (request.clinicId) {
    const hasClinicAssignment = context.clinicAssignments.some(
      (assignment) =>
        assignment.tenantId === request.tenantId &&
        assignment.clinicId === request.clinicId &&
        assignment.status === "active"
    );

    const hasTenantWideRole = context.roleAssignments.some(
      (assignment) => assignment.tenantId === request.tenantId && assignment.clinicId === null
    );

    if (!hasClinicAssignment && !hasTenantWideRole) {
      return { allowed: false, reason: "clinic_mismatch", requiredPermission: request.permission };
    }
  }

  if (request.resourceClinicId && request.clinicId && request.resourceClinicId !== request.clinicId) {
    return { allowed: false, reason: "clinic_mismatch", requiredPermission: request.permission };
  }

  const scopedPermissions = permissionsForScope(context, request.tenantId, request.clinicId ?? null);

  if (!scopedPermissions.includes(request.permission)) {
    return { allowed: false, reason: "missing_permission", requiredPermission: request.permission };
  }

  return { allowed: true, reason: "allowed", requiredPermission: request.permission };
}

export function assertAuthorized(context: AccessContext, request: AuthorizationRequest): void {
  const decision = authorize(context, request);

  if (!decision.allowed) {
    throw new AuthorizationError(decision);
  }
}
