import { createHash } from "node:crypto";
import {
  CLINIC_ROLE_SLUGS,
  permissionsForRoles,
  type Clinic,
  type ClinicAssignment,
  type ClinicUser,
  type RoleAssignment,
  type Tenant,
  type TenantMembership
} from "@clinic-os/domain";
import type { WebSessionAuthority, WebSessionAuthorityResolver } from "./web-session.ts";

/** Structural port: the production issuer-bound repository implements this contract. */
export interface CurrentIdentityAuthorityRepository {
  findAccessByKeycloakIdentity(identity: { issuer: string; subject: string }): Promise<{
    authorityRevision: string;
    tenant: Tenant;
    user: ClinicUser;
    memberships: readonly TenantMembership[];
    clinicAssignments: readonly ClinicAssignment[];
    roleAssignments: readonly RoleAssignment[];
    clinics: readonly Clinic[];
  } | null>;
}

const inactive: WebSessionAuthority = Object.freeze({
  active: false,
  authorityRevision: "inactive"
});
// Application role grants are the API's current permission authority. A deployment
// changing those grants must invalidate sessions even when database rows are unchanged.
const permissionPolicy = CLINIC_ROLE_SLUGS.map((role) => [
  role,
  [...permissionsForRoles([role])].sort()
]);

export class CurrentSessionAuthorityResolver implements WebSessionAuthorityResolver {
  readonly #repository: CurrentIdentityAuthorityRepository;

  constructor(repository: CurrentIdentityAuthorityRepository) {
    this.#repository = repository;
  }

  async resolve(identity: { issuer: string; subject: string }): Promise<WebSessionAuthority> {
    // No cache or token-embedded roles: every use consults current committed authority.
    const snapshot = await this.#repository.findAccessByKeycloakIdentity(identity);
    if (!snapshot) return inactive;
    if (!/^[0-9a-f]{64}$/.test(snapshot.authorityRevision)) {
      throw new Error("Current session authority is unavailable.");
    }
    const { tenant, user } = snapshot;
    const memberships = snapshot.memberships.filter(
      (m) => m.userId === user.id && m.status === "active"
    );
    if (
      tenant.status !== "active" ||
      user.status !== "active" ||
      memberships.length !== 1 ||
      memberships[0].tenantId !== tenant.id
    )
      return inactive;

    const assigned = new Set(
      snapshot.clinicAssignments
        .filter((a) => a.tenantId === tenant.id && a.userId === user.id && a.status === "active")
        .map((a) => a.clinicId)
    );
    const roles = snapshot.roleAssignments.filter(
      (r) =>
        r.tenantId === tenant.id && r.userId === user.id && CLINIC_ROLE_SLUGS.includes(r.roleSlug)
    );
    const eligible = snapshot.clinics.some(
      (clinic) =>
        clinic.tenantId === tenant.id &&
        clinic.status === "active" &&
        roles.some(
          (r) =>
            (r.clinicId === null || (r.clinicId === clinic.id && assigned.has(clinic.id))) &&
            permissionsForRoles([r.roleSlug]).length > 0
        )
    );
    if (!eligible) return inactive;
    return {
      active: true,
      authorityRevision: createHash("sha256")
        .update(
          JSON.stringify([
            "session-authority-v1",
            identity.issuer,
            identity.subject,
            tenant.id,
            user.id,
            snapshot.authorityRevision,
            permissionPolicy
          ])
        )
        .digest("hex")
    };
  }
}
