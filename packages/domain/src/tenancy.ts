import type { UUID } from "./ids.ts";
import type { ClinicRoleSlug, PermissionKey } from "./permissions.ts";

export type TenantStatus = "active" | "suspended" | "archived";
export type ClinicStatus = "active" | "inactive" | "archived";
export type UserStatus = "active" | "invited" | "disabled";
export type MembershipStatus = "active" | "invited" | "suspended" | "revoked";

export interface Tenant {
  id: UUID;
  slug: string;
  legalName: string;
  displayName: string;
  status: TenantStatus;
}

export interface Clinic {
  id: UUID;
  tenantId: UUID;
  slug: string;
  displayName: string;
  status: ClinicStatus;
  timezone: string;
}

export interface ClinicUser {
  id: UUID;
  displayName: string;
  email: string | null;
  phone: string | null;
  status: UserStatus;
}

export interface TenantMembership {
  tenantId: UUID;
  userId: UUID;
  status: MembershipStatus;
}

export interface ClinicAssignment {
  tenantId: UUID;
  clinicId: UUID;
  userId: UUID;
  status: MembershipStatus;
}

export interface RoleAssignment {
  tenantId: UUID;
  clinicId: UUID | null;
  userId: UUID;
  roleSlug: ClinicRoleSlug;
}

export interface UserAccessProfile {
  tenant: Tenant;
  user: ClinicUser;
  memberships: TenantMembership[];
  clinicAssignments: ClinicAssignment[];
  roleAssignments: RoleAssignment[];
  effectivePermissions: PermissionKey[];
}

export interface TenantScopedRecord {
  tenantId: UUID;
}

export interface ClinicScopedRecord extends TenantScopedRecord {
  clinicId: UUID;
}
