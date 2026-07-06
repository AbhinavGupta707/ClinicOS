import type {
  Clinic,
  ClinicAssignment,
  ClinicUser,
  PatientRecord,
  RoleAssignment,
  Tenant,
  TenantMembership,
  UUID
} from "@clinic-os/domain";

export interface IdentityAccessSnapshot {
  tenant: Tenant;
  user: ClinicUser;
  memberships: TenantMembership[];
  clinicAssignments: ClinicAssignment[];
  roleAssignments: RoleAssignment[];
  clinics: Clinic[];
}

export interface IdentityRepository {
  findAccessByKeycloakSubject(subject: string): Promise<IdentityAccessSnapshot | null>;
}

export interface PatientRepository {
  findPatientById(scope: { tenantId: UUID; clinicId: UUID; patientId: UUID }): Promise<PatientRecord | null>;
}

export interface AuditEventSink<TAuditEvent> {
  appendAuditEvent(event: TAuditEvent): Promise<void>;
}
