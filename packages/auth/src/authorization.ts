import {
  permissionsForRoles,
  type Clinic,
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
  reason:
    | "allowed"
    | "tenant_mismatch"
    | "clinic_mismatch"
    | "inactive_identity"
    | "inactive_membership"
    | "missing_permission";
  requiredPermission: PermissionKey;
}

export interface VerifiedRequestScope {
  tenantId: UUID;
  clinicId: UUID;
  actorUserId: UUID;
  subject: string;
  issuer: string;
  roleSlugs: ClinicRoleSlug[];
  permissions: PermissionKey[];
  provenance: {
    tenant: "verified_active_membership";
    clinic: "verified_active_assignment" | "verified_tenant_wide_role";
    actor: "verified_identity_subject";
  };
}

export interface VerifiedRequestScopeInput {
  context: AccessContext;
  clinics: readonly Clinic[];
  selectedClinicId?: UUID | null;
}

export class RequestScopeResolutionError extends Error {
  readonly code = "PERMISSION_DENIED";
  readonly reason: "inactive_identity" | "inactive_membership" | "clinic_mismatch";

  constructor(reason: RequestScopeResolutionError["reason"]) {
    super(`Request scope could not be derived: ${reason}`);
    this.name = "RequestScopeResolutionError";
    this.reason = reason;
  }
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
  const memberships = input.memberships.filter(
    (membership) => membership.tenantId === input.tenant.id && membership.userId === input.user.id
  );
  const clinicAssignments = input.clinicAssignments.filter(
    (assignment) => assignment.tenantId === input.tenant.id && assignment.userId === input.user.id
  );
  const activeClinicIds = new Set(
    clinicAssignments
      .filter((assignment) => assignment.status === "active")
      .map((assignment) => assignment.clinicId)
  );
  const identityCanHoldRoles =
    input.tenant.status === "active" &&
    input.user.status === "active" &&
    memberships.some((membership) => membership.status === "active");
  const roleAssignments = input.roleAssignments.filter(
    (assignment) =>
      identityCanHoldRoles &&
      assignment.tenantId === input.tenant.id &&
      assignment.userId === input.user.id &&
      (assignment.clinicId === null || activeClinicIds.has(assignment.clinicId))
  );
  const roleSlugs = [...new Set(roleAssignments.map((assignment) => assignment.roleSlug))].sort();
  const permissions = permissionsForRoles(roleSlugs);

  return {
    ...input,
    memberships,
    clinicAssignments,
    roleAssignments,
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

export function authorize(
  context: AccessContext,
  request: AuthorizationRequest
): AuthorizationDecision {
  if (context.tenant.status !== "active" || context.user.status !== "active") {
    return { allowed: false, reason: "inactive_identity", requiredPermission: request.permission };
  }

  const tenantMatches = context.tenant.id === request.tenantId;
  const resourceTenantMatches =
    !request.resourceTenantId || request.resourceTenantId === request.tenantId;

  if (!tenantMatches || !resourceTenantMatches) {
    return { allowed: false, reason: "tenant_mismatch", requiredPermission: request.permission };
  }

  const hasActiveMembership = context.memberships.some(
    (membership) => membership.tenantId === request.tenantId && membership.status === "active"
  );

  if (!hasActiveMembership) {
    return {
      allowed: false,
      reason: "inactive_membership",
      requiredPermission: request.permission
    };
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

  if (
    request.resourceClinicId &&
    request.clinicId &&
    request.resourceClinicId !== request.clinicId
  ) {
    return { allowed: false, reason: "clinic_mismatch", requiredPermission: request.permission };
  }

  const scopedPermissions = permissionsForScope(
    context,
    request.tenantId,
    request.clinicId ?? null
  );

  if (!scopedPermissions.includes(request.permission)) {
    return { allowed: false, reason: "missing_permission", requiredPermission: request.permission };
  }

  return { allowed: true, reason: "allowed", requiredPermission: request.permission };
}

export function deriveVerifiedRequestScope(input: VerifiedRequestScopeInput): VerifiedRequestScope {
  const { context } = input;

  if (context.tenant.status !== "active" || context.user.status !== "active") {
    throw new RequestScopeResolutionError("inactive_identity");
  }

  const activeMembership = context.memberships.some(
    (membership) =>
      membership.tenantId === context.tenant.id &&
      membership.userId === context.user.id &&
      membership.status === "active"
  );
  if (!activeMembership) {
    throw new RequestScopeResolutionError("inactive_membership");
  }

  const activeClinics = input.clinics
    .filter((clinic) => clinic.tenantId === context.tenant.id && clinic.status === "active")
    .sort((left, right) => left.id.localeCompare(right.id));
  const activeAssignmentIds = new Set(
    context.clinicAssignments
      .filter(
        (assignment) =>
          assignment.tenantId === context.tenant.id &&
          assignment.userId === context.user.id &&
          assignment.status === "active"
      )
      .map((assignment) => assignment.clinicId)
  );
  const hasTenantWideRole = context.roleAssignments.some(
    (assignment) =>
      assignment.tenantId === context.tenant.id &&
      assignment.userId === context.user.id &&
      assignment.clinicId === null
  );
  const eligibleClinics = activeClinics.filter(
    (clinic) => activeAssignmentIds.has(clinic.id) || hasTenantWideRole
  );
  const clinic = input.selectedClinicId
    ? eligibleClinics.find((candidate) => candidate.id === input.selectedClinicId)
    : eligibleClinics[0];

  if (!clinic) {
    throw new RequestScopeResolutionError("clinic_mismatch");
  }

  return {
    tenantId: context.tenant.id,
    clinicId: clinic.id,
    actorUserId: context.user.id,
    subject: context.principal.subject,
    issuer: context.principal.issuer,
    roleSlugs: roleSlugsForScope(context, context.tenant.id, clinic.id),
    permissions: permissionsForScope(context, context.tenant.id, clinic.id),
    provenance: {
      tenant: "verified_active_membership",
      clinic: activeAssignmentIds.has(clinic.id)
        ? "verified_active_assignment"
        : "verified_tenant_wide_role",
      actor: "verified_identity_subject"
    }
  };
}

export function assertAuthorized(context: AccessContext, request: AuthorizationRequest): void {
  const decision = authorize(context, request);

  if (!decision.allowed) {
    throw new AuthorizationError(decision);
  }
}
