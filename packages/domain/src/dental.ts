import type { UUID } from "./ids.ts";

export const DENTAL_NUMBERING_SYSTEMS = ["fdi"] as const;
export type DentalNumberingSystem = (typeof DENTAL_NUMBERING_SYSTEMS)[number];

export const FDI_TOOTH_NUMBERS = [
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "21",
  "22",
  "23",
  "24",
  "25",
  "26",
  "27",
  "28",
  "31",
  "32",
  "33",
  "34",
  "35",
  "36",
  "37",
  "38",
  "41",
  "42",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "51",
  "52",
  "53",
  "54",
  "55",
  "61",
  "62",
  "63",
  "64",
  "65",
  "71",
  "72",
  "73",
  "74",
  "75",
  "81",
  "82",
  "83",
  "84",
  "85"
] as const;
export type DentalToothNumber = (typeof FDI_TOOTH_NUMBERS)[number];

export const DENTAL_SURFACES = [
  "distal",
  "occlusal",
  "buccal",
  "lingual",
  "mesial",
  "cervical"
] as const;
export type DentalSurface = (typeof DENTAL_SURFACES)[number];

export const DENTAL_FINDING_TYPES = [
  "caries",
  "cervical_erosion",
  "restoration",
  "crown",
  "missing",
  "mobility",
  "rct",
  "periodontal_note",
  "watch_item"
] as const;
export type DentalFindingType = (typeof DENTAL_FINDING_TYPES)[number];

export const DENTAL_FINDING_STATUSES = [
  "active",
  "watch",
  "treated",
  "historical",
  "entered_in_error"
] as const;
export type DentalFindingStatus = (typeof DENTAL_FINDING_STATUSES)[number];

export const DENTAL_FINDING_REVIEW_STATUSES = ["needs_review", "reviewed"] as const;
export type DentalFindingReviewStatus = (typeof DENTAL_FINDING_REVIEW_STATUSES)[number];

export const DENTAL_FINDING_SOURCES = ["manual", "ai_draft", "imported", "historical"] as const;
export type DentalFindingSource = (typeof DENTAL_FINDING_SOURCES)[number];

export const DENTAL_FINDING_HISTORY_CHANGE_TYPES = ["created", "updated"] as const;
export type DentalFindingHistoryChangeType =
  (typeof DENTAL_FINDING_HISTORY_CHANGE_TYPES)[number];

export interface DentalChartRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  numberingSystem: DentalNumberingSystem;
  createdByUserId: UUID;
  updatedByUserId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

export interface DentalFindingRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  encounterId: UUID | null;
  toothNumber: DentalToothNumber;
  numberingSystem: DentalNumberingSystem;
  surface: DentalSurface | null;
  findingType: DentalFindingType;
  severity: string | null;
  status: DentalFindingStatus;
  reviewStatus: DentalFindingReviewStatus;
  source: DentalFindingSource;
  confidence: number | null;
  notes: string | null;
  provenance: Record<string, unknown>;
  treatmentReference: Record<string, unknown>;
  createdByUserId: UUID;
  updatedByUserId: UUID | null;
  reviewedByUserId: UUID | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DentalFindingHistoryRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  findingId: UUID;
  patientId: UUID;
  encounterId: UUID | null;
  changeType: DentalFindingHistoryChangeType;
  changedByUserId: UUID;
  changedAt: string;
  reason: string | null;
  beforeState: DentalFindingSnapshotFinding | null;
  afterState: DentalFindingSnapshotFinding;
  provenance: Record<string, unknown>;
}

export interface DentalChartSnapshotFinding {
  findingId: UUID;
  toothNumber: DentalToothNumber;
  numberingSystem: DentalNumberingSystem;
  surface: DentalSurface | null;
  findingType: DentalFindingType;
  severity: string | null;
  status: DentalFindingStatus;
  reviewStatus: DentalFindingReviewStatus;
  source: DentalFindingSource;
  confidence: number | null;
  notes: string | null;
  treatmentReference: Record<string, unknown>;
  encounterId: UUID | null;
  createdAt: string;
  updatedAt: string;
}

export interface DentalChartSnapshotState {
  numberingSystem: DentalNumberingSystem;
  generatedAt: string;
  findingCount: number;
  findings: DentalChartSnapshotFinding[];
}

export interface DentalChartSnapshotRecord {
  id: UUID;
  tenantId: UUID;
  clinicId: UUID;
  patientId: UUID;
  encounterId: UUID | null;
  snapshotVersion: number;
  chartState: DentalChartSnapshotState;
  reason: string | null;
  provenance: Record<string, unknown>;
  createdByUserId: UUID;
  createdAt: string;
}

export interface DentalChartView {
  chart: DentalChartRecord;
  findings: DentalFindingRecord[];
  snapshots: DentalChartSnapshotRecord[];
}

export interface CreateDentalFindingInput {
  encounterId?: UUID | null;
  toothNumber: string;
  surface?: string | null;
  findingType: DentalFindingType;
  severity?: string | null;
  status?: DentalFindingStatus;
  reviewStatus?: DentalFindingReviewStatus;
  source?: DentalFindingSource;
  confidence?: number | null;
  notes?: string | null;
  provenance?: Record<string, unknown>;
  treatmentReference?: Record<string, unknown>;
}

export interface UpdateDentalFindingInput {
  encounterId?: UUID | null;
  toothNumber?: string;
  surface?: string | null;
  findingType?: DentalFindingType;
  severity?: string | null;
  status?: DentalFindingStatus;
  reviewStatus?: DentalFindingReviewStatus;
  source?: DentalFindingSource;
  confidence?: number | null;
  notes?: string | null;
  provenance?: Record<string, unknown>;
  treatmentReference?: Record<string, unknown>;
  changeReason: string;
}

const FDI_TOOTH_NUMBER_SET = new Set<string>(FDI_TOOTH_NUMBERS);
const SURFACE_SET = new Set<string>(DENTAL_SURFACES);
const FINDING_TYPE_SET = new Set<string>(DENTAL_FINDING_TYPES);
const FINDING_STATUS_SET = new Set<string>(DENTAL_FINDING_STATUSES);
const REVIEW_STATUS_SET = new Set<string>(DENTAL_FINDING_REVIEW_STATUSES);
const FINDING_SOURCE_SET = new Set<string>(DENTAL_FINDING_SOURCES);

export function isDentalToothNumber(value: string): value is DentalToothNumber {
  return FDI_TOOTH_NUMBER_SET.has(value);
}

export function isDentalSurface(value: string): value is DentalSurface {
  return SURFACE_SET.has(value);
}

export function isDentalFindingType(value: string): value is DentalFindingType {
  return FINDING_TYPE_SET.has(value);
}

export function isDentalFindingStatus(value: string): value is DentalFindingStatus {
  return FINDING_STATUS_SET.has(value);
}

export function isDentalFindingReviewStatus(value: string): value is DentalFindingReviewStatus {
  return REVIEW_STATUS_SET.has(value);
}

export function isDentalFindingSource(value: string): value is DentalFindingSource {
  return FINDING_SOURCE_SET.has(value);
}

export function normalizeDentalToothNumber(value: string): DentalToothNumber {
  const normalized = value.trim();

  if (!/^\d{2}$/.test(normalized)) {
    throw new Error("Dental tooth number must be a two-digit FDI notation value.");
  }

  if (!isDentalToothNumber(normalized)) {
    throw new Error(`Invalid FDI tooth number: ${normalized}.`);
  }

  return normalized;
}

export function normalizeDentalSurface(value: string | null | undefined): DentalSurface | null {
  if (value === undefined || value === null || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();

  if (!isDentalSurface(normalized)) {
    throw new Error(`Invalid dental surface: ${value}.`);
  }

  return normalized;
}

export function assertValidDentalFinding(input: {
  toothNumber: string;
  surface?: string | null;
  findingType: DentalFindingType;
  source?: DentalFindingSource;
  confidence?: number | null;
}): void {
  normalizeDentalToothNumber(input.toothNumber);
  const surface = normalizeDentalSurface(input.surface);

  if (!isDentalFindingType(input.findingType)) {
    throw new Error(`Invalid dental finding type: ${input.findingType}.`);
  }

  if (input.findingType === "missing" && surface) {
    throw new Error("Missing-tooth findings must be tooth-level and cannot specify a surface.");
  }

  if (input.source && !isDentalFindingSource(input.source)) {
    throw new Error(`Invalid dental finding source: ${input.source}.`);
  }

  if (
    input.confidence !== undefined &&
    input.confidence !== null &&
    (input.confidence < 0 || input.confidence > 1)
  ) {
    throw new Error("Dental finding confidence must be between 0 and 1.");
  }
}

export function assertDentalFindingUpdateReason(reason: string): void {
  if (!reason.trim()) {
    throw new Error("Dental finding updates require a changeReason for audit history.");
  }
}

export function toDentalFindingSnapshotFinding(
  finding: DentalFindingRecord
): DentalChartSnapshotFinding {
  return {
    findingId: finding.id,
    toothNumber: finding.toothNumber,
    numberingSystem: finding.numberingSystem,
    surface: finding.surface,
    findingType: finding.findingType,
    severity: finding.severity,
    status: finding.status,
    reviewStatus: finding.reviewStatus,
    source: finding.source,
    confidence: finding.confidence,
    notes: finding.notes,
    treatmentReference: finding.treatmentReference,
    encounterId: finding.encounterId,
    createdAt: finding.createdAt,
    updatedAt: finding.updatedAt
  };
}

export function buildDentalChartSnapshotState(
  findings: readonly DentalFindingRecord[],
  generatedAt = new Date().toISOString()
): DentalChartSnapshotState {
  const snapshotFindings = findings
    .filter((finding) => finding.status !== "entered_in_error")
    .map(toDentalFindingSnapshotFinding)
    .sort(compareSnapshotFindings);

  return {
    numberingSystem: "fdi",
    generatedAt,
    findingCount: snapshotFindings.length,
    findings: snapshotFindings
  };
}

function compareSnapshotFindings(
  left: DentalChartSnapshotFinding,
  right: DentalChartSnapshotFinding
): number {
  return (
    left.toothNumber.localeCompare(right.toothNumber) ||
    (left.surface ?? "").localeCompare(right.surface ?? "") ||
    left.findingType.localeCompare(right.findingType) ||
    left.createdAt.localeCompare(right.createdAt)
  );
}
