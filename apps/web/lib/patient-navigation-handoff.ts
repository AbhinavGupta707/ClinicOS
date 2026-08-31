export interface PatientNavigationHandoff {
  readonly clinicId: string;
  readonly patientId: string;
}

let currentHandoff: PatientNavigationHandoff | null = null;

export function readPatientNavigationHandoff(): PatientNavigationHandoff | null {
  return currentHandoff;
}

export function rememberPatientNavigation(
  clinicId: string,
  patientId: string
): PatientNavigationHandoff {
  const normalizedClinicId = clinicId.trim();
  const normalizedPatientId = patientId.trim();
  if (!normalizedClinicId || !normalizedPatientId) {
    throw new Error("Clinic and patient identifiers are required for navigation handoff.");
  }
  currentHandoff = {
    clinicId: normalizedClinicId,
    patientId: normalizedPatientId
  };
  return currentHandoff;
}

export function clearPatientNavigationHandoff(): void {
  currentHandoff = null;
}
