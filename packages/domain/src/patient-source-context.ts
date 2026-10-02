export const PATIENT_CONTEXT_PROFILE = "practo_ray_patients_context_v2" as const;
export const PATIENT_DEMOGRAPHICS_PROFILE = "practo_ray_patients_v1" as const;
export type PatientImportProfile =
  typeof PATIENT_CONTEXT_PROFILE | typeof PATIENT_DEMOGRAPHICS_PROFILE;

// These are source labels, not inferred clinical facts or permission to contact.
export const PATIENT_SOURCE_FIELDS = [
  "Contact Number",
  "Secondary Mobile",
  "Address",
  "Locality",
  "City",
  "Pincode",
  "Blood Group",
  "Remarks",
  "Medical History",
  "Referred By",
  "Groups",
  "Patient Notes"
] as const;
export type PatientSourceField = (typeof PATIENT_SOURCE_FIELDS)[number];
export type PatientSourceFields = Partial<Record<PatientSourceField, string>>;

export function patientSourceFields(value: unknown): PatientSourceFields {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new RangeError("Historical context must be a supported field object.");
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !(PATIENT_SOURCE_FIELDS as readonly string[]).includes(key)))
    throw new RangeError("Historical context contains an unsupported field.");
  const result: PatientSourceFields = {};
  for (const key of PATIENT_SOURCE_FIELDS) {
    const text = input[key];
    if (text === undefined) continue;
    if (
      typeof text !== "string" ||
      text.length > 8192 ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(text)
    )
      throw new RangeError(
        "A historical field has an unsupported value or exceeds 8,192 characters. Nothing was truncated."
      );
    if (text.trim()) result[key] = text;
  }
  if (new TextEncoder().encode(JSON.stringify(result)).length > 32_768)
    throw new RangeError("Patient historical context exceeds 32 KiB. Nothing was truncated.");
  return result;
}

export function parsePatientSourceFields(value: unknown): PatientSourceFields {
  if (typeof value !== "string" || value.length > 65_536)
    throw new RangeError("Historical context must be bounded JSON text.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new RangeError("Historical context is not valid JSON.");
  }
  return patientSourceFields(parsed);
}

export type SourceContextReviewDecision = "reviewed" | "needs_clarification";
export interface PatientSourceContextRecord {
  id: string;
  patientId: string;
  sourceSystem: string;
  externalReference: string;
  sourceFormat: typeof PATIENT_CONTEXT_PROFILE;
  version: number;
  fields: PatientSourceFields;
  contactUnavailable: boolean;
  importedAt: string;
  sourceRecordDate: null;
  review: null | {
    decision: SourceContextReviewDecision;
    note: string;
    reviewedByUserId: string;
    reviewedAt: string;
  };
}
