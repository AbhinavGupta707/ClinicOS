import type { KeycloakAccessTokenClaims } from "@clinic-os/auth";
import {
  CHECKPOINT1_SEED_IDS,
  CHECKPOINT1_SEED_USERS,
  type IdentityAccessSnapshot,
  type IdentityRepository
} from "@clinic-os/db";
import type { AuditEventRecord } from "@clinic-os/security";

const tenant = {
  id: CHECKPOINT1_SEED_IDS.tenantId,
  slug: "clinicos-synthetic-tenant",
  legalName: "ClinicOS Synthetic Dental Private Limited",
  displayName: "ClinicOS Synthetic Tenant",
  status: "active" as const
};

const clinic = {
  id: CHECKPOINT1_SEED_IDS.clinicId,
  tenantId: CHECKPOINT1_SEED_IDS.tenantId,
  slug: "synthetic-dental-clinic",
  displayName: "Synthetic Dental Clinic",
  status: "active" as const,
  timezone: "Asia/Kolkata"
};

export class LocalFixtureIdentityRepository implements IdentityRepository {
  async findAccessByKeycloakSubject(subject: string): Promise<IdentityAccessSnapshot | null> {
    const seedUser = CHECKPOINT1_SEED_USERS.find(
      (candidate) => candidate.keycloakSubject === subject
    );

    if (!seedUser) return null;

    const userId = CHECKPOINT1_SEED_IDS.users[seedUser.key];

    return {
      tenant,
      clinics: [clinic],
      user: {
        id: userId,
        displayName: seedUser.displayName,
        email: seedUser.email,
        phone: null,
        status: "active"
      },
      memberships: [
        {
          tenantId: tenant.id,
          userId,
          status: "active"
        }
      ],
      clinicAssignments: [
        {
          tenantId: tenant.id,
          clinicId: clinic.id,
          userId,
          status: "active"
        }
      ],
      roleAssignments: [
        {
          tenantId: tenant.id,
          clinicId: clinic.id,
          userId,
          roleSlug: seedUser.roleSlug
        }
      ]
    };
  }
}

export class InMemoryAuditSink {
  readonly events: AuditEventRecord[] = [];

  async appendAuditEvent(event: AuditEventRecord): Promise<void> {
    this.events.push(event);
  }
}

export function createLocalFixtureClaims(input: {
  subject: string;
  expectedIssuer: string;
  acceptedAudience: string;
  now?: Date;
}): KeycloakAccessTokenClaims {
  const seedUser = CHECKPOINT1_SEED_USERS.find(
    (candidate) => candidate.keycloakSubject === input.subject
  );
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const claims: KeycloakAccessTokenClaims = {
    sub: input.subject,
    iss: input.expectedIssuer,
    aud: input.acceptedAudience,
    azp: input.acceptedAudience,
    exp: nowSeconds + 15 * 60,
    iat: nowSeconds,
    email_verified: true
  };

  if (seedUser) {
    claims.email = seedUser.email;
    claims.name = seedUser.displayName;
    claims.preferred_username = seedUser.email;
    claims.realm_access = { roles: [seedUser.roleSlug] };
  }

  return claims;
}
