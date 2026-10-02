import { PATIENT_CONTEXT_PROFILE, type PatientImportProfile } from "./patient-source-context.ts";

export interface MigrationAssuranceRows {
  invalid: number;
  needsReview: number;
  ready: number;
  committed: number;
  skipped: number;
  rolledBack: number;
  failed: number;
}
export interface MigrationAssuranceFacts {
  runId: string;
  profile: PatientImportProfile | null;
  expected: number | null;
  sealed: boolean | null;
  rows: MigrationAssuranceRows;
  manifestProblems: number;
  counterMismatches: number;
  openConflicts: number;
  patients: {
    committedRows: number;
    distinctPatients: number;
    createdPatients: number;
    missingLinks: number;
  };
  context: {
    versionsAdded: number;
    retainedVersions: number;
    missingRows: number;
    reviewed: number;
    needsClarification: number;
    unreviewed: number;
  };
  comparison: null | {
    runId: string;
    eligibility:
      | "comparable"
      | "incomplete"
      | "different_profile"
      | "ambiguous_identifiers"
      | "integrity_mismatch";
    added: number;
    changed: number;
    unchanged: number;
    absent: number;
  };
  appointments: null | {
    importId: string;
    expected: number;
    sealed: boolean;
    pending: number;
    history: number;
    excluded: number;
    linked: number;
    created: number;
    missingLinks: number;
  };
}
export const MIGRATION_ASSURANCE_ISSUES = {
  incomplete_upload: "Reselect the original file and finish uploading and sealing its groups.",
  integrity_mismatch:
    "Stored receipts, counters or identity links disagree. Stop this import and request a technical review.",
  review_required: "Resolve the remaining identity conflicts and review rows before committing.",
  ready_rows:
    "Reviewed rows remain uncommitted. Use the existing commit controls after checking exclusions.",
  excluded_rows:
    "Invalid, skipped, failed or rolled-back rows remain outside the successful import. Review each affected group.",
  context_review:
    "Historical context still needs clinician review. Imported text is not current clinical truth.",
  comparison_unavailable:
    "Choose two complete patient files with the same profile and unambiguous source identifiers.",
  changed_source:
    "The compared export contains changed or absent source rows. Review the source; no update, deletion or cancellation is inferred.",
  appointment_upload: "Finish uploading and sealing the separately selected appointment file.",
  appointment_review:
    "Review pending appointment observations in Appointment import. History and exclusions are not bookings."
} as const;
export type MigrationAssuranceIssue = keyof typeof MIGRATION_ASSURANCE_ISSUES;
export interface MigrationAssuranceReport extends MigrationAssuranceFacts {
  version: 1;
  observedAt: string;
  received: number;
  state: "incomplete" | "action_required" | "accounted_for";
  issues: MigrationAssuranceIssue[];
  coverage: "canonical_rows_only" | "practo_demographics" | "practo_demographics_and_context";
  sourceFreshness: "unknown";
  clinicApproval: "not_assessed";
}

// Reconciliation is an observation, never a write, clinic approval, or a claim
// that the vendor export contains every clinical/financial record.
export function buildMigrationAssuranceReport(
  facts: MigrationAssuranceFacts,
  observedAt: string
): MigrationAssuranceReport {
  const received = Object.values(facts.rows).reduce((sum, n) => sum + n, 0);
  const issues: MigrationAssuranceIssue[] = [];
  const incomplete =
    received === 0 || (facts.expected !== null && (facts.expected !== received || !facts.sealed));
  if (incomplete) issues.push("incomplete_upload");
  if (
    facts.manifestProblems ||
    facts.counterMismatches ||
    facts.patients.missingLinks ||
    facts.context.missingRows ||
    facts.appointments?.missingLinks
  )
    issues.push("integrity_mismatch");
  if (facts.rows.needsReview || facts.openConflicts) issues.push("review_required");
  if (facts.rows.ready) issues.push("ready_rows");
  if (facts.rows.invalid + facts.rows.skipped + facts.rows.failed + facts.rows.rolledBack)
    issues.push("excluded_rows");
  if (facts.context.unreviewed || facts.context.needsClarification) issues.push("context_review");
  if (facts.comparison && facts.comparison.eligibility !== "comparable")
    issues.push("comparison_unavailable");
  else if (facts.comparison && (facts.comparison.changed || facts.comparison.absent))
    issues.push("changed_source");
  if (facts.appointments) {
    const a = facts.appointments;
    if (!a.sealed || a.expected !== a.pending + a.history + a.excluded + a.linked + a.created)
      issues.push("appointment_upload");
    if (a.pending) issues.push("appointment_review");
  }
  return {
    ...facts,
    // Noncomparable counts must not be mistaken for a meaningful difference.
    comparison:
      facts.comparison?.eligibility !== "comparable" && facts.comparison
        ? { ...facts.comparison, added: 0, changed: 0, unchanged: 0, absent: 0 }
        : facts.comparison,
    version: 1,
    observedAt,
    received,
    state: incomplete ? "incomplete" : issues.length ? "action_required" : "accounted_for",
    issues,
    coverage:
      facts.profile === PATIENT_CONTEXT_PROFILE
        ? "practo_demographics_and_context"
        : facts.profile === "practo_ray_patients_v1"
          ? "practo_demographics"
          : "canonical_rows_only",
    sourceFreshness: "unknown",
    clinicApproval: "not_assessed"
  };
}
