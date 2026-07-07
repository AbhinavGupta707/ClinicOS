import type { UUID } from "./ids.ts";

export type PatientGender = "female" | "male" | "other" | "unknown";
export type PatientSource =
  | "manual"
  | "whatsapp"
  | "phone"
  | "call"
  | "walkin"
  | "practo"
  | "google"
  | "website"
  | "instagram"
  | "referral"
  | "recall_campaign"
  | "imported"
  | "external_system";

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

export type PatientContactType = "phone" | "whatsapp" | "email" | "guardian_phone" | "other";

export interface PatientContactRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  contactType: PatientContactType;
  value: string;
  normalizedValue: string;
  isPrimary: boolean;
  consentToContact: boolean;
  source: PatientSource;
  createdAt: string;
}

export type PatientTimelineItemType =
  | "patient_created"
  | "attribution_touch_created"
  | "lead_created"
  | "lead_matched"
  | "appointment_created"
  | "appointment_confirmed"
  | "patient_checked_in"
  | "queue_entry_created"
  | "appointment_no_show"
  | "task_created";

export interface PatientTimelineItem {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  itemType: PatientTimelineItemType;
  sourceTable: string;
  sourceId: UUID;
  occurredAt: string;
  title: string;
  summary: string | null;
  metadata: Record<string, unknown>;
}

export type DuplicateMatchReason = "phone_exact" | "name_exact" | "name_similar";

export interface PatientDuplicateCandidate {
  patient: Pick<PatientRecord, "id" | "fullName" | "phone" | "email" | "createdAt">;
  score: number;
  reasons: DuplicateMatchReason[];
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

export function normalizePatientName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (trimmed.startsWith("+")) return `+${digits}`;
  return digits;
}

export function assertPatientCreateMinimum(input: {
  fullName?: string | null;
  phone?: string | null;
}): void {
  if (!input.fullName?.trim()) {
    throw new Error("Patient fullName is required.");
  }

  if (!input.phone?.trim()) {
    throw new Error("Patient phone is required.");
  }
}

export function buildPatientDuplicateSuggestions(
  input: { fullName: string; phone: string },
  candidates: readonly PatientRecord[]
): PatientDuplicateCandidate[] {
  const normalizedInputPhone = normalizePhone(input.phone);
  const normalizedInputName = normalizePatientName(input.fullName);

  return candidates
    .map((patient) => {
      const reasons: DuplicateMatchReason[] = [];
      let score = 0;

      if (patient.phone && normalizePhone(patient.phone) === normalizedInputPhone) {
        reasons.push("phone_exact");
        score += 80;
      }

      const candidateName = normalizePatientName(patient.fullName);

      if (candidateName === normalizedInputName) {
        reasons.push("name_exact");
        score += 30;
      } else if (nameTokensOverlap(normalizedInputName, candidateName)) {
        reasons.push("name_similar");
        score += 12;
      }

      return {
        patient: {
          id: patient.id,
          fullName: patient.fullName,
          phone: patient.phone,
          email: patient.email,
          createdAt: patient.createdAt
        },
        score: Math.min(score, 100),
        reasons
      };
    })
    .filter((candidate) => candidate.reasons.length > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.patient.fullName.localeCompare(right.patient.fullName)
    );
}

function nameTokensOverlap(left: string, right: string): boolean {
  const leftTokens = new Set(left.split(" ").filter((token) => token.length >= 3));
  const rightTokens = right.split(" ").filter((token) => token.length >= 3);

  if (leftTokens.size === 0 || rightTokens.length === 0) return false;

  const overlap = rightTokens.filter((token) => leftTokens.has(token)).length;
  return overlap >= Math.min(2, Math.min(leftTokens.size, rightTokens.length));
}
