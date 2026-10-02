import type { PatientTimelineItemType } from "./patient.ts";
import type { PermissionKey } from "./permissions.ts";

export const PATIENT_HISTORY_CATEGORIES = [
  "visits",
  "prescriptions",
  "dental",
  "treatment",
  "billing",
  "intake",
  "media",
  "appointments",
  "follow_up",
  "lab",
  "operations",
  "identity",
  "ai"
] as const;
export type PatientHistoryCategory = (typeof PATIENT_HISTORY_CATEGORIES)[number];

const categories: Record<PatientHistoryCategory, readonly PatientTimelineItemType[]> = {
  visits: [
    "encounter_created",
    "encounter_started",
    "encounter_completed",
    "clinical_note_draft_created",
    "clinical_note_signed",
    "clinical_note_amended"
  ],
  prescriptions: [
    "prescription_draft_created",
    "prescription_signed",
    "instruction_print_requested",
    "instruction_send_requested"
  ],
  dental: ["dental_finding_created", "dental_finding_updated", "dental_chart_snapshot_created"],
  treatment: ["treatment_plan_created", "treatment_plan_accepted", "procedure_completed"],
  billing: [
    "invoice_created",
    "payment_recorded",
    "receipt_generated",
    "payment_requested",
    "payment_succeeded",
    "payment_manually_recorded",
    "payment_reconciliation_required"
  ],
  intake: ["form_response_submitted", "consent_created", "consent_revoked"],
  media: ["media_uploaded"],
  appointments: [
    "appointment_created",
    "appointment_confirmed",
    "patient_checked_in",
    "queue_entry_created",
    "appointment_no_show"
  ],
  follow_up: [
    "task_created",
    "task_status_changed",
    "task_completed",
    "recall_due",
    "recall_action_recorded"
  ],
  lab: ["lab_case_created", "lab_case_sent", "lab_case_returned", "lab_case_completed"],
  operations: ["incident_created", "corrective_action_created", "corrective_action_completed"],
  identity: ["patient_created", "attribution_touch_created", "lead_created", "lead_matched"],
  ai: [
    "ai_session_started",
    "ai_draft_generated",
    "ai_review_decision_recorded",
    "ai_retention_deleted"
  ]
};
const required: Record<PatientHistoryCategory, readonly PermissionKey[]> = {
  visits: ["clinical.note.read"],
  prescriptions: ["clinical.note.read", "prescription.write", "patient_instruction.write"],
  dental: ["dental.chart.read"],
  treatment: ["dental.chart.read"],
  billing: ["billing.read"],
  intake: ["clinical.note.read"],
  media: ["media.read"],
  appointments: ["schedule.read", "queue.manage"],
  follow_up: ["task.manage", "recall.manage"],
  lab: ["lab.manage"],
  operations: ["incident.manage", "corrective_action.manage"],
  identity: ["patient.read", "message.read"],
  ai: ["ai.scribe.read"]
};
export function patientHistoryCategory(type: string): PatientHistoryCategory | null {
  return (
    PATIENT_HISTORY_CATEGORIES.find((category) =>
      (categories[category] as readonly string[]).includes(type)
    ) ?? null
  );
}
export function allowedPatientHistoryCategories(
  permissions: readonly string[]
): PatientHistoryCategory[] {
  if (!permissions.includes("patient.read") || !permissions.includes("patient.phi.read")) return [];
  return PATIENT_HISTORY_CATEGORIES.filter((category) =>
    required[category].every((p) => permissions.includes(p))
  );
}
export function patientHistoryItemTypes(
  allowed: readonly PatientHistoryCategory[]
): PatientTimelineItemType[] {
  return allowed.flatMap((category) => [...categories[category]]);
}
export interface PatientHistoryPageInput {
  readonly cursor?: string;
  readonly limit?: number;
  readonly itemTypes: readonly PatientTimelineItemType[];
}
export function historyPageLimit(value: number | undefined): number {
  const limit = value ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new RangeError("History page size must be between 1 and 100.");
  return limit;
}
export function assertHistoryCursor(cursor: string | undefined): void {
  if (
    cursor !== undefined &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cursor)
  )
    throw new RangeError("Invalid history cursor.");
}
