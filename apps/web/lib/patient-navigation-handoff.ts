export interface PatientNavigationHandoff {
  readonly clinicId: string;
  readonly patientId: string;
  readonly tenantId: string;
  readonly userId: string;
}

let currentHandoff: PatientNavigationHandoff | null = null;

export function readPatientNavigationHandoff(): PatientNavigationHandoff | null {
  return currentHandoff;
}

export function rememberPatientNavigation(
  tenantId: string,
  clinicId: string,
  userId: string,
  patientId: string
): PatientNavigationHandoff {
  const normalizedTenantId = tenantId.trim();
  const normalizedClinicId = clinicId.trim();
  const normalizedUserId = userId.trim();
  const normalizedPatientId = patientId.trim();
  if (!normalizedTenantId || !normalizedClinicId || !normalizedUserId || !normalizedPatientId) {
    throw new Error(
      "Tenant, clinic, user, and patient identifiers are required for navigation handoff."
    );
  }
  currentHandoff = {
    clinicId: normalizedClinicId,
    patientId: normalizedPatientId,
    tenantId: normalizedTenantId,
    userId: normalizedUserId
  };
  return currentHandoff;
}

export function patientNavigationHandoffMatchesIdentity(
  handoff: PatientNavigationHandoff,
  tenantId: string,
  clinicId: string,
  userId: string
): boolean {
  return (
    handoff.tenantId === tenantId && handoff.clinicId === clinicId && handoff.userId === userId
  );
}

export function clearPatientNavigationHandoff(): void {
  currentHandoff = null;
}
