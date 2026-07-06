import type { UUID } from "./ids.ts";

export type PatientGender = "female" | "male" | "other" | "unknown";
export type PatientSource = "manual" | "imported" | "external_system";

export interface PatientRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  fullName: string;
  phone: string | null;
  email: string | null;
  dateOfBirth: string | null;
  gender: PatientGender;
  abhaAddress: string | null;
  source: PatientSource;
  createdAt: string;
  updatedAt: string;
}

export const PATIENT_PHI_FIELDS = [
  "fullName",
  "phone",
  "email",
  "dateOfBirth",
  "abhaAddress"
] as const;

export type PatientPhiField = (typeof PATIENT_PHI_FIELDS)[number];

export function isPatientPhiField(value: string): value is PatientPhiField {
  return (PATIENT_PHI_FIELDS as readonly string[]).includes(value);
}

export function patientDisplayLabel(patient: Pick<PatientRecord, "id" | "fullName">): string {
  return `${patient.fullName} (${patient.id})`;
}
